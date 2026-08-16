import { lstat, readFile, realpath } from 'node:fs/promises';
import path from 'node:path';

import { typedError } from '../../domain/workspace-session.js';
import { loadCellsConfig } from './config-loader.js';
import { readStageFile } from './stage-capture.js';

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function sameIdentity(left, right) {
  return left.dev === right.dev && left.ino === right.ino;
}

function isWithin(parent, candidate) {
  const relative = path.relative(parent, candidate);
  return relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

function runtimeFailure(cause = undefined) {
  if (cause?.code === 'LEGACY_APP_RUNTIME_INVALID' || cause?.code === 'PATH_CHANGED') return cause;
  return typedError('LEGACY_APP_RUNTIME_INVALID', undefined, cause);
}

async function captureDirectory(session, relativePath) {
  const candidate = path.join(session.root, relativePath);
  try {
    const [workspace, directory] = await Promise.all([lstat(session.root), lstat(candidate)]);
    if (
      !workspace.isDirectory() ||
      workspace.isSymbolicLink() ||
      !sameIdentity(workspace, session.rootIdentity) ||
      !directory.isDirectory() ||
      directory.isSymbolicLink()
    ) throw typedError('LEGACY_APP_RUNTIME_INVALID');
    const [canonicalWorkspace, canonicalDirectory] = await Promise.all([realpath(session.root), realpath(candidate)]);
    if (canonicalWorkspace !== session.root || canonicalDirectory !== candidate || !isWithin(canonicalWorkspace, canonicalDirectory)) {
      throw typedError('LEGACY_APP_RUNTIME_INVALID');
    }
    return Object.freeze({
      candidate,
      canonicalDirectory,
      identity: Object.freeze({ dev: directory.dev, ino: directory.ino }),
      workspaceIdentity: session.rootIdentity,
      workspaceRoot: session.root
    });
  } catch (cause) {
    throw runtimeFailure(cause);
  }
}

async function verifyDirectory(directory) {
  try {
    const [workspace, current] = await Promise.all([lstat(directory.workspaceRoot), lstat(directory.candidate)]);
    if (
      !workspace.isDirectory() ||
      workspace.isSymbolicLink() ||
      !sameIdentity(workspace, directory.workspaceIdentity) ||
      !current.isDirectory() ||
      current.isSymbolicLink() ||
      !sameIdentity(current, directory.identity) ||
      await realpath(directory.workspaceRoot) !== directory.workspaceRoot ||
      await realpath(directory.candidate) !== directory.canonicalDirectory
    ) throw typedError('PATH_CHANGED');
  } catch (cause) {
    if (cause?.code === 'PATH_CHANGED') throw cause;
    throw typedError('PATH_CHANGED', undefined, cause);
  }
}

async function captureFile(directory, relativePath, { optional = false } = {}) {
  await verifyDirectory(directory);
  const candidate = path.join(directory.candidate, ...relativePath.split('/'));
  try {
    const source = await lstat(candidate);
    if (!source.isFile() || source.isSymbolicLink()) throw typedError('LEGACY_APP_RUNTIME_INVALID');
    const canonicalFile = await realpath(candidate);
    if (!isWithin(directory.canonicalDirectory, canonicalFile)) throw typedError('LEGACY_APP_RUNTIME_INVALID');
    const content = await readFile(candidate, 'utf8');
    const current = await lstat(candidate);
    if (!current.isFile() || current.isSymbolicLink() || !sameIdentity(source, current) || await realpath(candidate) !== canonicalFile) {
      throw typedError('PATH_CHANGED');
    }
    await verifyDirectory(directory);
    return Object.freeze({ candidate, canonicalFile, content, directory, identity: Object.freeze({ dev: source.dev, ino: source.ino }) });
  } catch (cause) {
    if (optional && cause?.code === 'ENOENT') return undefined;
    throw runtimeFailure(cause);
  }
}

async function verifyFile(source) {
  try {
    await verifyDirectory(source.directory);
    const current = await lstat(source.candidate);
    if (!current.isFile() || current.isSymbolicLink() || !sameIdentity(current, source.identity) || await realpath(source.candidate) !== source.canonicalFile) {
      throw typedError('PATH_CHANGED');
    }
    if (await readFile(source.candidate, 'utf8') !== source.content) throw typedError('PATH_CHANGED');
  } catch (cause) {
    if (cause?.code === 'PATH_CHANGED') throw cause;
    throw typedError('PATH_CHANGED', undefined, cause);
  }
}

function assetPath(pathname) {
  if (typeof pathname !== 'string') throw typedError('LEGACY_APP_RUNTIME_INVALID');
  let decoded;
  try {
    decoded = decodeURIComponent(pathname).replace(/^\/+/, '');
  } catch (cause) {
    throw runtimeFailure(cause);
  }
  if (decoded === '') return 'index.html';
  const segments = decoded.split('/');
  if (decoded.includes('\\') || segments.some(segment => segment === '' || segment === '.' || segment === '..' || segment.includes('\0'))) {
    throw typedError('LEGACY_APP_RUNTIME_INVALID');
  }
  return segments.join('/');
}

async function readAsset(directory, pathname) {
  const relativePath = assetPath(pathname);
  await verifyDirectory(directory);
  const candidate = path.join(directory.candidate, ...relativePath.split('/'));
  try {
    const source = await lstat(candidate);
    if (!source.isFile() || source.isSymbolicLink()) return undefined;
    const canonicalFile = await realpath(candidate);
    if (!isWithin(directory.canonicalDirectory, canonicalFile)) throw typedError('LEGACY_APP_RUNTIME_INVALID');
    const content = await readStageFile(candidate, Object.freeze({ dev: source.dev, ino: source.ino }), {
      invalidCode: 'LEGACY_APP_RUNTIME_INVALID',
      failure: runtimeFailure
    });
    const current = await lstat(candidate);
    if (!current.isFile() || current.isSymbolicLink() || !sameIdentity(source, current) || await realpath(candidate) !== canonicalFile) {
      throw typedError('PATH_CHANGED');
    }
    await verifyDirectory(directory);
    return Object.freeze({ content, relativePath });
  } catch (cause) {
    if (cause?.code === 'ENOENT') return undefined;
    throw runtimeFailure(cause);
  }
}

function valueAt(config, token) {
  let current = config;
  for (const segment of token.split('.')) {
    if (!isRecord(current) || !Object.hasOwn(current, segment)) throw typedError('LEGACY_APP_RUNTIME_INVALID');
    current = current[segment];
  }
  if (!['string', 'number', 'boolean'].includes(typeof current)) throw typedError('LEGACY_APP_RUNTIME_INVALID');
  return String(current);
}

function renderTemplate(template, config) {
  const tokens = [...template.matchAll(/##([A-Za-z0-9_.-]+)##/g)];
  let rendered = template;
  for (const match of tokens) rendered = rendered.replaceAll(match[0], valueAt(config, match[1]));
  if (/##[A-Za-z0-9_.-]+##/.test(rendered)) throw typedError('LEGACY_APP_RUNTIME_INVALID');
  return rendered;
}

function serializedConfig(config) {
  try {
    const value = JSON.stringify(config);
    if (typeof value !== 'string') throw new TypeError('Configuration is not serializable');
    return value.replaceAll('\u2028', '\\u2028').replaceAll('\u2029', '\\u2029');
  } catch (cause) {
    throw runtimeFailure(cause);
  }
}

function assignmentRange(source) {
  const matches = [...source.matchAll(/window\.AppConfig\s*=\s*/g)];
  if (matches.length !== 1) throw typedError('LEGACY_APP_RUNTIME_INVALID');
  const start = matches[0].index;
  const objectStart = start + matches[0][0].length;
  if (source[objectStart] !== '{') throw typedError('LEGACY_APP_RUNTIME_INVALID');
  let depth = 0;
  let quoted = false;
  let escaped = false;
  for (let index = objectStart; index < source.length; index += 1) {
    const character = source[index];
    if (quoted) {
      if (escaped) escaped = false;
      else if (character === '\\') escaped = true;
      else if (character === '"') quoted = false;
      continue;
    }
    if (character === '"') quoted = true;
    else if (character === '{') depth += 1;
    else if (character === '}') {
      depth -= 1;
      if (depth === 0) return Object.freeze({ start, end: index + 1 });
    }
  }
  throw typedError('LEGACY_APP_RUNTIME_INVALID');
}

function replaceAppConfig(source, config) {
  const range = assignmentRange(source);
  return `${source.slice(0, range.start)}window.AppConfig = ${serializedConfig(config)}${source.slice(range.end)}`;
}

function distConfig(config) {
  return Object.freeze({ ...config, componentsPath: './bower_components/' });
}

function cleanViteId(id) {
  return typeof id === 'string' ? id.split('?', 1)[0] : '';
}

const SOURCE_MAP_LINE = /^[\t ]*\/\/[#@][\t ]*sourceMappingURL[\t ]*=[\t ]*(\S+)[\t ]*$/gmu;

async function hasLocalSourceMap(appRoot, sourceFile, reference) {
  if (/^[A-Za-z][A-Za-z0-9+.-]*:/.test(reference) || reference.startsWith('//')) return true;
  const encodedPath = reference.split(/[?#]/, 1)[0];
  let decodedPath;
  try {
    decodedPath = decodeURIComponent(encodedPath);
  } catch {
    return false;
  }
  if (decodedPath.length === 0 || decodedPath.includes('\0')) return false;
  const candidate = decodedPath.startsWith('/')
    ? path.resolve(appRoot, `.${decodedPath}`)
    : path.resolve(path.dirname(sourceFile), decodedPath);
  if (!isWithin(appRoot, candidate)) return false;
  try {
    const current = await lstat(candidate);
    return current.isFile() && !current.isSymbolicLink();
  } catch {
    return false;
  }
}

async function withoutMissingSourceMaps(code, id, appRoot) {
  const sourceFile = cleanViteId(id);
  if (typeof code !== 'string' || !/\.[cm]?js$/u.test(sourceFile) || !isWithin(appRoot, sourceFile)) return undefined;
  const removals = [];
  for (const match of code.matchAll(SOURCE_MAP_LINE)) {
    if (!await hasLocalSourceMap(appRoot, sourceFile, match[1])) {
      removals.push(Object.freeze({ start: match.index, end: match.index + match[0].length }));
    }
  }
  if (removals.length === 0) return undefined;
  let output = '';
  let offset = 0;
  for (const removal of removals) {
    output += code.slice(offset, removal.start);
    offset = removal.end;
  }
  return `${output}${code.slice(offset)}`;
}

function sourceMapPlugin(name, directory) {
  return Object.freeze({
    name,
    enforce: 'pre',
    async load(id) {
      const sourceFile = cleanViteId(id);
      if (!/\.[cm]?js$/u.test(sourceFile) || !isWithin(directory.canonicalDirectory, sourceFile)) return null;
      const relativePath = path.relative(directory.canonicalDirectory, sourceFile).split(path.sep).join('/');
      const source = await captureFile(directory, relativePath, { optional: true });
      if (source === undefined) return null;
      const transformed = await withoutMissingSourceMaps(source.content, source.canonicalFile, directory.canonicalDirectory);
      await verifyFile(source);
      return transformed === undefined ? null : Object.freeze({ code: transformed, map: null });
    }
  });
}

export async function createLegacyAppPlugins(request) {
  if (!isRecord(request) || !Object.isFrozen(request) || !isRecord(request.session) || !path.isAbsolute(request.session.root) || typeof request.configName !== 'string' || !isRecord(request.config) || !isRecord(request.config.legacy)) {
    throw typedError('LEGACY_APP_RUNTIME_INVALID');
  }
  const appDirectory = await captureDirectory(request.session, 'app');
  const appRoot = appDirectory.candidate;
  let [template, bootstrap, configModule] = await Promise.all([
    captureFile(appDirectory, 'tpls/index.tpl', { optional: true }),
    captureFile(appDirectory, 'scripts/app-bootstrap.js', { optional: true }),
    captureFile(appDirectory, 'config/app.config.js', { optional: true })
  ]);
  const configModulePath = path.join(appRoot, 'config', 'app.config.js');
  const selectedConfigPath = path.join(request.session.root, ...request.config.sourcePath.split('/'));
  const templatePath = path.join(appRoot, 'tpls', 'index.tpl');
  const bootstrapPath = path.join(appRoot, 'scripts', 'app-bootstrap.js');
  let currentConfig = request.config.legacy;
  let configDependencies = new Set((request.config.sourceDependencies ?? [request.config.sourcePath]).map(relative => path.join(request.session.root, ...relative.split('/'))));
  let configJson = serializedConfig(currentConfig);
  function invalidate(server, id) {
    const module = server?.moduleGraph?.getModuleById?.(id);
    if (module !== undefined) server.moduleGraph.invalidateModule(module);
  }
  function reload(server) {
    invalidate(server, configModulePath);
    if (bootstrap !== undefined) invalidate(server, bootstrap.canonicalFile);
    server?.ws?.send?.({ type: 'full-reload', path: '*' });
  }
  const templatePlugin = Object.freeze({
    name: 'open-cells-legacy-template',
    transformIndexHtml: Object.freeze({
      order: 'pre',
      async handler(html) {
        if (template === undefined) return html;
        await verifyFile(template);
        return renderTemplate(template.content, currentConfig);
      }
    })
  });
  const configPlugin = Object.freeze({
    name: 'open-cells-legacy-config',
    enforce: 'pre',
    configureServer(server) {
      server?.watcher?.add?.([...configDependencies, templatePath, bootstrapPath, configModulePath]);
    },
    async handleHotUpdate(context) {
      const changed = path.resolve(context.file);
      if (configDependencies.has(changed)) {
        const next = await loadCellsConfig(request.session, request.configName);
        currentConfig = next.legacy;
        configJson = serializedConfig(currentConfig);
        configDependencies = new Set((next.sourceDependencies ?? [next.sourcePath]).map(relative => path.join(request.session.root, ...relative.split('/'))));
        context.server?.watcher?.add?.([...configDependencies]);
        reload(context.server);
        return [];
      }
      if (changed === templatePath) {
        template = await captureFile(appDirectory, 'tpls/index.tpl', { optional: true });
        reload(context.server);
        return [];
      }
      if (changed === bootstrapPath) {
        bootstrap = await captureFile(appDirectory, 'scripts/app-bootstrap.js', { optional: true });
      } else if (changed === configModulePath) {
        configModule = await captureFile(appDirectory, 'config/app.config.js', { optional: true });
        reload(context.server);
        return [];
      }
      return undefined;
    },
    resolveId(source, importer) {
      if (typeof source !== 'string') return null;
      let candidate;
      if (source.startsWith('/')) candidate = path.resolve(appRoot, `.${source}`);
      else if (typeof importer === 'string' && (source.startsWith('./') || source.startsWith('../'))) {
        candidate = path.resolve(path.dirname(cleanViteId(importer)), source);
      }
      return candidate === configModulePath ? configModulePath : null;
    },
    async load(id) {
      if (cleanViteId(id) !== configModulePath) return null;
      if (configModule !== undefined) await verifyFile(configModule);
      return `export default ${configJson};\n`;
    },
    async transform(code, id) {
      if (bootstrap === undefined || cleanViteId(id) !== bootstrap.canonicalFile) return null;
      await verifyFile(bootstrap);
      return Object.freeze({ code: replaceAppConfig(code, currentConfig), map: null });
    }
  });
  return Object.freeze([templatePlugin, configPlugin, sourceMapPlugin('open-cells-legacy-source-map', appDirectory)]);
}

export async function createLegacyDistRuntime(request) {
  if (!isRecord(request) || !Object.isFrozen(request) || !isRecord(request.session) || !path.isAbsolute(request.session.root) || typeof request.configName !== 'string' || !isRecord(request.config) || !isRecord(request.config.legacy)) {
    throw typedError('LEGACY_APP_RUNTIME_INVALID');
  }
  const distDirectory = await captureDirectory(request.session, 'dist');
  const [index, appModule] = await Promise.all([
    captureFile(distDirectory, 'index.html'),
    captureFile(distDirectory, 'app-module.js')
  ]);

  return Object.freeze({
    root: distDirectory.candidate,
    async read(pathname) {
      const asset = await readAsset(distDirectory, pathname);
      if (asset === undefined) return undefined;
      if (asset.relativePath !== 'app-module.js') return asset;
      await verifyFile(appModule);
      const config = distConfig((await loadCellsConfig(request.session, request.configName)).legacy);
      return Object.freeze({
        content: Buffer.from(replaceAppConfig(asset.content.toString('utf8'), config)),
        relativePath: asset.relativePath
      });
    },
    async verify() {
      await Promise.all([verifyDirectory(distDirectory), verifyFile(index), verifyFile(appModule)]);
    }
  });
}
