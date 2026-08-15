import { readdir } from 'node:fs/promises';
import path from 'node:path';

import { PathPolicy, normalizeRelativePath } from '../../domain/path-policy.js';
import { ScaffoldPlan } from '../../domain/scaffold-plan.js';
import { hasSystemCode, typedError } from '../../domain/workspace-session.js';

const LOG_LEVELS = new Set(['verbose', 'warn', 'error']);
const SOURCE_SCOPES = Object.freeze([
  Object.freeze({ root: '', recursive: false }),
  Object.freeze({ root: 'src', recursive: true }),
  Object.freeze({ root: 'app/elements', recursive: true }),
  Object.freeze({ root: 'app/styles', recursive: true })
]);
const STYLE_MARKER = 'export default css`';

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function compareText(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function assertSession(session) {
  if (session === null || typeof session !== 'object' || typeof session.root !== 'string' || !path.isAbsolute(session.root)) {
    throw typedError('WORKSPACE_INVALID');
  }
}

function assertFilesystem(filesystem) {
  const required = ['joinPath', 'lstat', 'realpath', 'readFile', 'pathHasSymlink', 'isPathWithin'];
  if (filesystem === null || typeof filesystem !== 'object' || required.some(method => typeof filesystem[method] !== 'function')) {
    throw typedError('SASS_CONTEXT_INVALID');
  }
}

function assertLogger(logger) {
  if (logger === undefined) {
    return Object.freeze({ warn() {}, debug() {} });
  }
  if (logger === null || typeof logger !== 'object' || typeof logger.warn !== 'function' || typeof logger.debug !== 'function') {
    throw typedError('SASS_INPUT_INVALID', { field: 'logger' });
  }
  return logger;
}

function normalizedRequest(context) {
  if (!isRecord(context) || !Object.isFrozen(context)) {
    throw typedError('SASS_INPUT_INVALID', { field: 'context' });
  }
  assertSession(context.session);
  assertFilesystem(context.filesystem);
  if (context.compiler === null || typeof context.compiler !== 'object' || typeof context.compiler.compile !== 'function') {
    throw typedError('SASS_CONTEXT_INVALID');
  }
  const logLevel = context.logLevel ?? 'warn';
  if (!LOG_LEVELS.has(logLevel)) {
    throw typedError('SASS_INPUT_INVALID', { field: 'logLevel' });
  }
  const loadPaths = context.loadPaths ?? [];
  if (!Array.isArray(loadPaths) || loadPaths.some(loadPath => typeof loadPath !== 'string')) {
    throw typedError('SASS_INPUT_INVALID', { field: 'loadPaths' });
  }
  if (context.publisher !== undefined && (context.publisher === null || typeof context.publisher?.publish !== 'function')) {
    throw typedError('SASS_CONTEXT_INVALID');
  }
  return Object.freeze({
    session: context.session,
    filesystem: context.filesystem,
    compiler: context.compiler,
    logLevel,
    loadPaths: Object.freeze([...loadPaths]),
    logger: assertLogger(context.logger),
    publisher: context.publisher,
    signal: context.signal
  });
}

function sourceFailure(input) {
  return typedError('SASS_SOURCE_INVALID', { input });
}

function outputFailure(output) {
  return typedError('SASS_OUTPUT_INVALID', { output });
}

function relativePath(absolute, root) {
  const relative = path.relative(root, absolute).split(path.sep).join('/');
  try {
    return normalizeRelativePath(relative).join('/');
  } catch {
    throw sourceFailure(relative || '.');
  }
}

async function sourceTarget(session, filesystem, policy, relative) {
  const raw = filesystem.joinPath(session.root, ...relative.split('/'));
  let status;
  try {
    status = await filesystem.lstat(raw);
  } catch {
    throw sourceFailure(relative);
  }
  if (!status.isFile() || status.isSymbolicLink()) {
    throw sourceFailure(relative);
  }
  try {
    if (await filesystem.pathHasSymlink(raw)) {
      throw sourceFailure(relative);
    }
    const canonical = await policy.resolveRead(relative);
    if (!filesystem.isPathWithin(session.root, canonical)) {
      throw sourceFailure(relative);
    }
    return canonical;
  } catch (cause) {
    if (cause?.code === 'SASS_SOURCE_INVALID') {
      throw cause;
    }
    throw sourceFailure(relative);
  }
}

async function discoverScope(session, filesystem, policy, scope) {
  const entries = [];
  const scopeAbsolute = scope.root === '' ? session.root : filesystem.joinPath(session.root, ...scope.root.split('/'));

  async function visit(directory, recursive) {
    let status;
    try {
      status = await filesystem.lstat(directory);
    } catch (cause) {
      if (directory === scopeAbsolute && hasSystemCode(cause, 'ENOENT')) {
        return;
      }
      throw sourceFailure(relativePath(directory, session.root));
    }
    const currentRelative = directory === session.root ? '' : relativePath(directory, session.root);
    if (!status.isDirectory() || status.isSymbolicLink()) {
      throw sourceFailure(currentRelative || scope.root || '.');
    }
    try {
      if (await filesystem.pathHasSymlink(directory)) {
        throw sourceFailure(currentRelative || scope.root || '.');
      }
      const canonical = await filesystem.realpath(directory);
      if (!filesystem.isPathWithin(session.root, canonical)) {
        throw sourceFailure(currentRelative || scope.root || '.');
      }
      const children = await readdir(canonical, { withFileTypes: true });
      for (const child of children.sort((left, right) => compareText(left.name, right.name))) {
        if (child.name === 'node_modules') {
          continue;
        }
        const childAbsolute = filesystem.joinPath(canonical, child.name);
        const childRelative = relativePath(childAbsolute, session.root);
        const childStatus = await filesystem.lstat(childAbsolute).catch(() => undefined);
        if (childStatus === undefined || childStatus.isSymbolicLink()) {
          throw sourceFailure(childRelative);
        }
        if (childStatus.isDirectory()) {
          if (recursive) {
            await visit(childAbsolute, true);
          }
          continue;
        }
        if (!childStatus.isFile() || !childRelative.endsWith('.scss') || path.basename(childRelative).startsWith('_')) {
          continue;
        }
        entries.push(Object.freeze({ relative: childRelative, absolute: await sourceTarget(session, filesystem, policy, childRelative) }));
      }
    } catch (cause) {
      if (cause?.code === 'SASS_SOURCE_INVALID') {
        throw cause;
      }
      throw sourceFailure(currentRelative || scope.root || '.');
    }
  }

  await visit(scopeAbsolute, scope.recursive);
  return entries;
}

async function discoverSources(session, filesystem) {
  const policy = new PathPolicy(session, filesystem);
  const sources = [];
  for (const scope of SOURCE_SCOPES) {
    sources.push(...await discoverScope(session, filesystem, policy, scope));
  }
  const unique = new Map();
  for (const source of sources) {
    unique.set(source.relative, source);
  }
  return Object.freeze([...unique.values()].sort((left, right) => compareText(left.relative, right.relative)));
}

async function normalizedLoadPaths(session, filesystem, loadPaths) {
  const policy = new PathPolicy(session, filesystem);
  const resolved = [];
  for (const loadPath of loadPaths) {
    const normalized = normalizeRelativePath(loadPath).join('/');
    const target = await policy.resolveRead(normalized);
    const status = await filesystem.lstat(target);
    if (!status.isDirectory() || status.isSymbolicLink() || await filesystem.pathHasSymlink(target)) {
      throw typedError('SASS_INPUT_INVALID', { field: 'loadPaths' });
    }
    resolved.push(target);
  }
  return Object.freeze([...new Set(resolved)].sort(compareText));
}

function sassLogger(logLevel, logger) {
  return Object.freeze({
    warn(message) {
      if (logLevel !== 'error') {
        logger.warn(message);
      }
    },
    debug(message) {
      if (logLevel === 'verbose') {
        logger.debug(message);
      }
    }
  });
}

function cssModule(css) {
  const escaped = css.replaceAll('\\', '\\\\').replaceAll('`', '\\`').replaceAll('${', '\\${');
  return `import { css } from 'lit';\n\nexport default css\`${escaped}\`;\n`;
}

function replaceStylesModule(contents, css, output) {
  const marker = /(^|\n)([\t ]*)export default css`/g.exec(contents);
  const suffix = /`;(\s*)$/.exec(contents);
  if (marker === null || /(^|\n)[\t ]*export default css`/g.test(contents.slice(marker.index + marker[0].length)) || suffix === null || suffix.index < marker.index + marker[0].length) {
    throw outputFailure(output);
  }
  const markerEnd = marker.index + marker[0].length;
  const escaped = css.replaceAll('\\', '\\\\').replaceAll('`', '\\`').replaceAll('${', '\\${');
  return `${contents.slice(0, markerEnd)}${escaped}${contents.slice(suffix.index)}`;
}

async function existingOutput(session, filesystem, policy, relative) {
  const raw = filesystem.joinPath(session.root, ...relative.split('/'));
  let status;
  try {
    status = await filesystem.lstat(raw);
  } catch (cause) {
    if (hasSystemCode(cause, 'ENOENT')) {
      await policy.resolveWrite(relative);
      return undefined;
    }
    throw outputFailure(relative);
  }
  if (!status.isFile() || status.isSymbolicLink()) {
    throw outputFailure(relative);
  }
  try {
    if (await filesystem.pathHasSymlink(raw)) {
      throw outputFailure(relative);
    }
    const canonical = await policy.resolveRead(relative);
    if (!filesystem.isPathWithin(session.root, canonical)) {
      throw outputFailure(relative);
    }
    return await filesystem.readFile(canonical, 'utf8');
  } catch (cause) {
    if (cause?.code === 'SASS_OUTPUT_INVALID') {
      throw cause;
    }
    throw outputFailure(relative);
  }
}

async function outputFor(session, filesystem, source, css) {
  const policy = new PathPolicy(session, filesystem);
  const base = source.relative.slice(0, -'.scss'.length);
  if (source.relative.startsWith('app/styles/')) {
    const output = `${base}.css`;
    await existingOutput(session, filesystem, policy, output);
    return Object.freeze({ path: output, content: css });
  }
  const stylesOutput = `${base}.styles.js`;
  const styles = await existingOutput(session, filesystem, policy, stylesOutput);
  if (styles !== undefined) {
    return Object.freeze({ path: stylesOutput, content: replaceStylesModule(styles, css, stylesOutput) });
  }
  const output = `${base}.css.js`;
  await existingOutput(session, filesystem, policy, output);
  return Object.freeze({ path: output, content: cssModule(css) });
}

function compileFailure(input) {
  return typedError('SASS_COMPILE_FAILED', { input });
}

async function planSass(context) {
  const loadPaths = await normalizedLoadPaths(context.session, context.filesystem, context.loadPaths);
  const sources = await discoverSources(context.session, context.filesystem);
  const logger = sassLogger(context.logLevel, context.logger);
  let plan = ScaffoldPlan.empty();
  for (const source of sources) {
    let contents;
    try {
      contents = await context.filesystem.readFile(source.absolute, 'utf8');
    } catch {
      throw sourceFailure(source.relative);
    }
    let result;
    try {
      result = await context.compiler.compile(Object.freeze({ source: contents, inputPath: source.absolute, loadPaths, logger }));
    } catch {
      throw compileFailure(source.relative);
    }
    if (result === null || typeof result !== 'object' || typeof result.css !== 'string') {
      throw compileFailure(source.relative);
    }
    const output = await outputFor(context.session, context.filesystem, source, result.css);
    try {
      plan = plan.addFile(output.path, output.content);
    } catch {
      throw outputFailure(output.path);
    }
  }
  return plan;
}

/**
 * Plans deterministic Sass output without writing individual files. An
 * optional transaction owner can publish the complete plan after all sources
 * have compiled successfully.
 */
export async function compileSass(context) {
  const normalized = normalizedRequest(context);
  const plan = await planSass(normalized);
  if (plan.files.length > 0 && normalized.publisher !== undefined) {
    try {
      await normalized.publisher.publish(normalized.session, plan, { signal: normalized.signal });
    } catch {
      throw typedError('SASS_PUBLISH_FAILED');
    }
  }
  return plan;
}
