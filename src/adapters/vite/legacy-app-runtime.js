import { lstat, readFile, realpath } from 'node:fs/promises';
import path from 'node:path';

import { typedError } from '../../domain/workspace-session.js';
import { loadCellsConfig } from './config-loader.js';

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

async function captureFile(root, relativePath, { optional = false } = {}) {
  const candidate = path.join(root, ...relativePath.split('/'));
  try {
    const source = await lstat(candidate);
    if (!source.isFile() || source.isSymbolicLink()) throw typedError('LEGACY_APP_RUNTIME_INVALID');
    const [canonicalRoot, canonicalFile] = await Promise.all([realpath(root), realpath(candidate)]);
    if (!isWithin(canonicalRoot, canonicalFile)) throw typedError('LEGACY_APP_RUNTIME_INVALID');
    const content = await readFile(candidate, 'utf8');
    const current = await lstat(candidate);
    if (!current.isFile() || current.isSymbolicLink() || !sameIdentity(source, current) || await realpath(candidate) !== canonicalFile) {
      throw typedError('PATH_CHANGED');
    }
    return Object.freeze({ candidate, canonicalFile, content, identity: Object.freeze({ dev: source.dev, ino: source.ino }) });
  } catch (cause) {
    if (optional && cause?.code === 'ENOENT') return undefined;
    throw runtimeFailure(cause);
  }
}

async function verifyFile(source) {
  try {
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

function cleanViteId(id) {
  return typeof id === 'string' ? id.split('?', 1)[0] : '';
}

export async function createLegacyAppPlugins(request) {
  if (!isRecord(request) || !Object.isFrozen(request) || !isRecord(request.session) || !path.isAbsolute(request.session.root) || typeof request.configName !== 'string' || !isRecord(request.config) || !isRecord(request.config.legacy)) {
    throw typedError('LEGACY_APP_RUNTIME_INVALID');
  }
  const appRoot = path.join(request.session.root, 'app');
  let [template, bootstrap, configModule] = await Promise.all([
    captureFile(appRoot, 'tpls/index.tpl', { optional: true }),
    captureFile(appRoot, 'scripts/app-bootstrap.js', { optional: true }),
    captureFile(appRoot, 'config/app.config.js', { optional: true })
  ]);
  const configModulePath = path.join(appRoot, 'config', 'app.config.js');
  const selectedConfigPath = path.join(request.session.root, ...request.config.sourcePath.split('/'));
  const templatePath = path.join(appRoot, 'tpls', 'index.tpl');
  const bootstrapPath = path.join(appRoot, 'scripts', 'app-bootstrap.js');
  let currentConfig = request.config.legacy;
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
    async transformIndexHtml(html) {
      if (template === undefined) return html;
      await verifyFile(template);
      return renderTemplate(template.content, currentConfig);
    }
  });
  const configPlugin = Object.freeze({
    name: 'open-cells-legacy-config',
    enforce: 'pre',
    configureServer(server) {
      server?.watcher?.add?.([selectedConfigPath, templatePath, bootstrapPath, configModulePath]);
    },
    async handleHotUpdate(context) {
      const changed = path.resolve(context.file);
      if (changed === selectedConfigPath) {
        const next = await loadCellsConfig(request.session, request.configName);
        currentConfig = next.legacy;
        configJson = serializedConfig(currentConfig);
        reload(context.server);
        return [];
      }
      if (changed === templatePath) {
        template = await captureFile(appRoot, 'tpls/index.tpl', { optional: true });
        reload(context.server);
        return [];
      }
      if (changed === bootstrapPath) {
        bootstrap = await captureFile(appRoot, 'scripts/app-bootstrap.js', { optional: true });
      } else if (changed === configModulePath) {
        configModule = await captureFile(appRoot, 'config/app.config.js', { optional: true });
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
  return Object.freeze([templatePlugin, configPlugin]);
}
