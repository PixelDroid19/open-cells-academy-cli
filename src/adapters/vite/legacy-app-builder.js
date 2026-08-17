import { lstat, readdir, realpath } from 'node:fs/promises';
import path from 'node:path';
import { Worker } from 'node:worker_threads';

import { ScaffoldPlan } from '../../domain/scaffold-plan.js';
import { typedError } from '../../domain/workspace-session.js';
import { discoverAppLocaleSources } from './locale-discovery.js';
import { planAppLocales } from './locales-pipeline.js';
import { captureStageDirectory, identity, isWithin, readStageFile, sameIdentity } from './stage-capture.js';

const COPIED_DIRECTORIES = Object.freeze(['data-managers', 'features', 'images', 'resources', 'vendor', 'videos']);
const COPIED_FILES = Object.freeze(['favicon.png', 'manifest.json', 'precache.json', 'robots.txt', 'sw-import.js']);
const COMPOSER_TIMEOUT_MS = 30_000;
const POLYMER_BRIDGE_SOURCE = 'node_modules/@cells/cells-bridge/dist/cells-polymer-bridge.min.js';
const POLYMER_BRIDGE_DESTINATION = 'vendor/cells/cells-polymer-bridge.min.js';
const SOURCE_MAP_LINE = /^[\t ]*\/\/[#@][\t ]*sourceMappingURL[\t ]*=[\t ]*(\S+)[\t ]*$/gmu;

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function buildFailure(cause = undefined) {
  if (cause?.code === 'LEGACY_APP_BUILD_INVALID' || cause?.code === 'PATH_CHANGED' || cause?.code === 'INTERRUPTED') return cause;
  return typedError('LEGACY_APP_BUILD_INVALID', undefined, cause);
}

function throwIfAborted(signal) {
  if (signal?.aborted === true) throw typedError('INTERRUPTED');
}

function sourceOptions() {
  return Object.freeze({
    invalidCode: 'LEGACY_APP_BUILD_INVALID',
    cleanupCode: 'LEGACY_APP_BUILD_INVALID',
    failure: buildFailure
  });
}

async function optionalDirectory(root, relativePath) {
  const candidate = path.join(root, ...relativePath.split('/'));
  try {
    const current = await lstat(candidate);
    if (!current.isDirectory() || current.isSymbolicLink()) throw typedError('LEGACY_APP_BUILD_INVALID');
    const canonicalRoot = await realpath(root);
    const canonical = await realpath(candidate);
    if (!isWithin(canonicalRoot, canonical)) throw typedError('LEGACY_APP_BUILD_INVALID');
    return candidate;
  } catch (cause) {
    if (cause?.code === 'ENOENT') return undefined;
    throw buildFailure(cause);
  }
}

async function optionalFile(root, relativePath) {
  const candidate = path.join(root, ...relativePath.split('/'));
  try {
    const current = await lstat(candidate);
    if (!current.isFile() || current.isSymbolicLink()) throw typedError('LEGACY_APP_BUILD_INVALID');
    const canonicalRoot = await realpath(root);
    const canonical = await realpath(candidate);
    if (!isWithin(canonicalRoot, canonical)) throw typedError('LEGACY_APP_BUILD_INVALID');
    return candidate;
  } catch (cause) {
    if (cause?.code === 'ENOENT') return undefined;
    throw buildFailure(cause);
  }
}

async function readOptionalFile(root, relativePath) {
  const candidate = await optionalFile(root, relativePath);
  if (candidate === undefined) return undefined;
  try {
    const before = await lstat(candidate);
    const captured = identity(before);
    const content = await readStageFile(candidate, captured, sourceOptions());
    const after = await lstat(candidate);
    if (!after.isFile() || after.isSymbolicLink() || !sameIdentity(captured, identity(after))) throw typedError('PATH_CHANGED');
    return content;
  } catch (cause) {
    throw buildFailure(cause);
  }
}

async function capturedFiles(root, relativePath) {
  const directory = await optionalDirectory(root, relativePath);
  if (directory === undefined) return Object.freeze([]);
  return Object.freeze(await captureStageDirectory(directory, directory, [], sourceOptions()));
}

function valueAt(config, token) {
  let current = config;
  for (const segment of token.split('.')) {
    if (!isRecord(current) || !Object.hasOwn(current, segment)) return '';
    current = current[segment];
  }
  return ['string', 'number', 'boolean'].includes(typeof current) ? String(current) : '';
}

function renderTemplate(template, config) {
  return template.replace(/##([A-Za-z0-9_.-]+)##/g, (_match, token) => valueAt(config, token));
}

function serializedConfig(config) {
  try {
    const value = JSON.stringify({ ...config, componentsPath: './bower_components/' });
    if (typeof value !== 'string') throw new TypeError('Invalid configuration');
    return value.replaceAll('\u2028', '\\u2028').replaceAll('\u2029', '\\u2029');
  } catch (cause) {
    throw buildFailure(cause);
  }
}

function configAssignment(source, config) {
  const matches = [...source.matchAll(/window\.AppConfig\s*=\s*/g)];
  if (matches.length !== 1) throw typedError('LEGACY_APP_BUILD_INVALID');
  const start = matches[0].index;
  const objectStart = start + matches[0][0].length;
  if (source[objectStart] !== '{') throw typedError('LEGACY_APP_BUILD_INVALID');
  let depth = 0;
  let quote;
  let escaped = false;
  for (let index = objectStart; index < source.length; index += 1) {
    const character = source[index];
    if (quote !== undefined) {
      if (escaped) escaped = false;
      else if (character === '\\') escaped = true;
      else if (character === quote) quote = undefined;
      continue;
    }
    if (character === '"' || character === "'") quote = character;
    else if (character === '{') depth += 1;
    else if (character === '}') {
      depth -= 1;
      if (depth === 0) {
        return `${source.slice(0, start)}window.AppConfig = ${serializedConfig(config)}${source.slice(index + 1)}`;
      }
    }
  }
  throw typedError('LEGACY_APP_BUILD_INVALID');
}

function litModuleWrapper(entrypoint, eventName = undefined) {
  const dispatch = eventName === undefined
    ? ''
    : `document.body.dispatchEvent(new CustomEvent(${JSON.stringify(eventName)}));`;
  return `<!doctype html><html><head></head><body><script type="module">import './scripts/${entrypoint}.js';${dispatch}</script></body></html>\n`;
}

function injectPolymerBridge(index) {
  if (index.includes(POLYMER_BRIDGE_DESTINATION)) return index;
  const script = `<script src="${POLYMER_BRIDGE_DESTINATION}"></script>`;
  const applicationScript = /[\t ]*<script\b[^>]*\bsrc=["'][^"']*scripts\/[^"']+["'][^>]*><\/script>/iu;
  if (applicationScript.test(index)) return index.replace(applicationScript, match => `${script}\n${match}`);
  if (/<\/body>/iu.test(index)) return index.replace(/<\/body>/iu, `${script}\n</body>`);
  return `${index.trimEnd()}\n${script}\n`;
}

async function withoutMissingSourceMap(root, relativePath, content) {
  if (!relativePath.endsWith('.js')) return content;
  const source = content.toString('utf8');
  const removals = [];
  for (const match of source.matchAll(SOURCE_MAP_LINE)) {
    const reference = match[1].split(/[?#]/u, 1)[0];
    if (/^[A-Za-z][A-Za-z0-9+.-]*:/u.test(reference) || reference.startsWith('//')) continue;
    let decoded;
    try {
      decoded = decodeURIComponent(reference);
    } catch {
      decoded = '';
    }
    const segments = decoded.split('/');
    if (decoded === '' || decoded.includes('\\') || segments.some(segment => segment === '' || segment === '.' || segment === '..')) {
      removals.push(Object.freeze({ start: match.index, end: match.index + match[0].length }));
      continue;
    }
    const sourceDirectory = path.posix.dirname(relativePath);
    const mapPath = path.posix.join('app/scripts', sourceDirectory === '.' ? '' : sourceDirectory, decoded);
    if (await optionalFile(root, mapPath) === undefined) removals.push(Object.freeze({ start: match.index, end: match.index + match[0].length }));
  }
  if (removals.length === 0) return content;
  let output = '';
  let offset = 0;
  for (const removal of removals) {
    output += source.slice(offset, removal.start);
    offset = removal.end;
  }
  return `${output}${source.slice(offset)}`;
}

function addFile(plan, relativePath, content) {
  return plan.addFile(relativePath, content);
}

function copiedEntry(relativePath) {
  const segments = relativePath.split('/');
  return !segments.includes('demo') && !segments.includes('test') && !relativePath.endsWith('.md') && !relativePath.endsWith('/index.html');
}

async function addTree(plan, root, sourcePath, destinationPath, transform = undefined, filter = undefined) {
  let next = plan;
  for (const file of await capturedFiles(root, sourcePath)) {
    if (filter !== undefined && !filter(file.relative)) continue;
    const content = transform === undefined ? file.content : await transform(file.relative, file.content);
    next = addFile(next, `${destinationPath}/${file.relative}`, content);
  }
  return next;
}

function normalizedInitialPages(config) {
  if (!Array.isArray(config.initialBundle)) return Object.freeze([]);
  return Object.freeze(config.initialBundle
    .filter(value => typeof value === 'string')
    .map(value => value.replace(/\.json$/u, ''))
    .filter(value => /^[A-Za-z0-9][A-Za-z0-9_-]*$/u.test(value)));
}

function composerPages(config) {
  const names = new Set(normalizedInitialPages(config));
  if (isRecord(config.routes)) {
    for (const name of Object.keys(config.routes)) {
      if (/^[A-Za-z0-9][A-Za-z0-9_-]*$/u.test(name)) names.add(name);
    }
  }
  return Object.freeze([...names].sort());
}

async function composerFiles(root, config) {
  const files = [];
  for (const name of composerPages(config)) {
    const relative = `app/composerMocksTpl/${name}.js`;
    const candidate = await optionalFile(root, relative);
    if (candidate !== undefined) {
      const source = await readOptionalFile(root, relative);
      if (source === undefined) throw typedError('LEGACY_APP_BUILD_INVALID');
      files.push(Object.freeze({ name, candidate, source: source.toString('utf8') }));
    }
  }
  return Object.freeze(files);
}

async function evaluateComposer(root, config, signal) {
  throwIfAborted(signal);
  const files = await composerFiles(root, config);
  if (files.length === 0) return Object.freeze({ pages: Object.freeze({}), tagsByPage: Object.freeze({}) });
  const workerSource = `
    void (async () => {
      const { createRequire } = await import('node:module');
      const { dirname } = await import('node:path');
      const { parentPort, workerData } = await import('node:worker_threads');
      const { Script } = await import('node:vm');
      console.log = () => undefined;
      console.info = () => undefined;
      console.warn = () => undefined;
      console.error = () => undefined;
      const pages = {};
      const tagsByPage = {};
      const visit = (value, tags) => {
        if (Array.isArray(value)) {
          for (const item of value) visit(item, tags);
          return;
        }
        if (value === null || typeof value !== 'object') return;
        for (const [key, item] of Object.entries(value)) {
          if (key === 'tag' && typeof item === 'string') tags.add(item);
          visit(item, tags);
        }
      };
      try {
        for (const file of workerData.files) {
          const module = { exports: {} };
          const localRequire = createRequire(file.candidate);
          const wrapper = new Script('(function (exports, require, module, __filename, __dirname) {\\n' + file.source + '\\n})', { filename: file.candidate });
          wrapper.runInThisContext()(module.exports, localRequire, module, file.candidate, dirname(file.candidate));
          const exported = module.exports;
          const factory = exported && exported.__esModule === true && Object.hasOwn(exported, 'default') ? exported.default : exported;
          if (typeof factory !== 'function') throw new TypeError('Invalid composer factory');
          const page = factory(workerData.config);
          const tags = new Set();
          visit(page, tags);
          pages[file.name] = JSON.stringify(page);
          tagsByPage[file.name] = [...tags].sort();
        }
        parentPort.postMessage({ ok: true, pages, tagsByPage });
      } catch {
        parentPort.postMessage({ ok: false });
      }
    })();
  `;
  return new Promise((resolve, reject) => {
    const worker = new Worker(workerSource, {
      eval: true,
      workerData: {
        files,
        config
      }
    });
    let settled = false;
    const timer = setTimeout(() => finish(reject, typedError('LEGACY_APP_BUILD_INVALID')), COMPOSER_TIMEOUT_MS);
    const finish = (operation, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener('abort', abortHandler);
      void Promise.resolve(worker.terminate()).finally(() => operation(value));
    };
    const abortHandler = () => finish(reject, typedError('INTERRUPTED'));
    signal?.addEventListener('abort', abortHandler, { once: true });
    if (signal?.aborted === true) abortHandler();
    worker.once('message', message => {
      if (message?.ok === true && isRecord(message.pages) && isRecord(message.tagsByPage)) {
        finish(resolve, Object.freeze({ pages: Object.freeze(message.pages), tagsByPage: Object.freeze(message.tagsByPage) }));
      } else finish(reject, typedError('LEGACY_APP_BUILD_INVALID'));
    });
    worker.once('error', cause => finish(reject, buildFailure(cause)));
    worker.once('exit', () => {
      if (!settled) finish(reject, typedError('LEGACY_APP_BUILD_INVALID'));
    });
  });
}

async function componentEntrypoints(root) {
  const components = await optionalDirectory(root, 'components');
  if (components === undefined) return new Map();
  const entries = new Map();
  async function walk(directory, relative) {
    for (const entry of (await readdir(directory, { withFileTypes: true })).sort((left, right) => left.name.localeCompare(right.name))) {
      if (entry.isSymbolicLink()) continue;
      if (entry.name === 'demo' || entry.name === 'test') continue;
      const candidate = path.join(directory, entry.name);
      const nextRelative = relative === '' ? entry.name : `${relative}/${entry.name}`;
      if (entry.isDirectory()) {
        await walk(candidate, nextRelative);
      } else if (entry.isFile() && entry.name.endsWith('.html')) {
        const tag = entry.name.slice(0, -5);
        const current = entries.get(tag);
        const exact = nextRelative === `${tag}/${tag}.html`;
        if (current === undefined || exact) entries.set(tag, nextRelative);
      }
    }
  }
  await walk(components, '');
  return entries;
}

function importLines(tags, entrypoints) {
  return [...tags]
    .map(tag => entrypoints.get(tag))
    .filter(relative => relative !== undefined)
    .sort()
    .map(relative => `<link rel="import" href="${relative}">`);
}

function mergeInitialTemplate(template, imports) {
  const unique = imports.filter(line => !template.includes(line));
  const marker = '<!-- will be replaced with imports -->';
  if (template.includes(marker)) return template.replace(marker, `${marker}\n${unique.join('\n')}`);
  return `${template.trimEnd()}\n${unique.join('\n')}\n`;
}

async function coreImports(root) {
  const candidates = Object.freeze([
    'polymer/polymer.html',
    'cells-polymer-bridge/cells-polymer-bridge.html'
  ]);
  const imports = [];
  for (const relative of candidates) {
    if (await optionalFile(root, `components/${relative}`) !== undefined) imports.push(`<link rel="import" href="${relative}">`);
  }
  return Object.freeze(imports);
}

async function initialImportsTemplate(root, config) {
  const fallback = 'app/tpls/initial-components-imports.tpl';
  const hasEnabledVariant = Object.entries(config).some(([key, value]) => value === true && /^is[A-Z][A-Za-z0-9]*Mode$/u.test(key));
  if (!hasEnabledVariant) return fallback;
  const variants = (await capturedFiles(root, 'app/tpls'))
    .map(file => file.relative)
    .filter(relative => /^initial-components-imports-[A-Za-z0-9_-]+\.tpl$/u.test(relative));
  return variants.length === 1 ? `app/tpls/${variants[0]}` : fallback;
}

async function bundleFiles(root, config, composer) {
  const templateFile = await optionalFile(root, await initialImportsTemplate(root, config));
  const fallbackTemplate = templateFile === undefined
    ? await optionalFile(root, 'app/tpls/initial-components-imports.tpl')
    : templateFile;
  const templateRelative = fallbackTemplate === undefined ? undefined : path.relative(root, fallbackTemplate).split(path.sep).join('/');
  const template = templateRelative === undefined ? '' : (await readOptionalFile(root, templateRelative))?.toString('utf8') ?? '';
  const entrypoints = await componentEntrypoints(root);
  const initialPages = new Set(normalizedInitialPages(config));
  const initialTags = new Set();
  const deferredTags = new Set();
  for (const [page, tags] of Object.entries(composer.tagsByPage)) {
    for (const tag of tags) (initialPages.has(page) ? initialTags : deferredTags).add(tag);
  }
  for (const tag of initialTags) deferredTags.delete(tag);
  const core = await coreImports(root);
  const initialBody = mergeInitialTemplate(template, importLines(initialTags, entrypoints));
  return Object.freeze({
    initial: `${[...core, initialBody].join('\n').trimEnd()}\n`,
    deferred: `${importLines(deferredTags, entrypoints).join('\n')}\n`
  });
}

async function localePlan(session, filesystem, config, configName) {
  if (!isRecord(config.locales)) {
    let plan = ScaffoldPlan.empty();
    for (const file of await capturedFiles(session.root, 'app/locales-app')) plan = addFile(plan, `locales/${file.relative}`, file.content);
    return plan;
  }
  const sources = await discoverAppLocaleSources(session.root, config.locales, config.appModules);
  const planned = await planAppLocales({
    session,
    filesystem,
    request: Object.freeze({
      config: Object.freeze({ ...config.locales }),
      configName,
      componentLocaleFiles: sources.componentLocaleFiles,
      appLocaleFiles: sources.appLocaleFiles
    })
  });
  let plan = ScaffoldPlan.empty();
  for (const file of planned.files) {
    if (file.path.startsWith('dist/')) plan = addFile(plan, file.path.slice(5), file.content);
  }
  return plan;
}

function mergePlans(left, right) {
  let plan = left;
  for (const directory of right.directories) plan = plan.addDirectory(directory);
  for (const file of right.files) plan = plan.addFile(file.path, file.content, file.mode === undefined ? undefined : { mode: file.mode });
  return plan;
}

async function stylesPlan(session, compiler) {
  const sourceFile = await optionalFile(session.root, 'app/styles/main.scss');
  if (sourceFile === undefined) return ScaffoldPlan.empty();
  if (compiler === undefined || typeof compiler?.compile !== 'function') throw typedError('LEGACY_APP_BUILD_INVALID');
  const source = (await readOptionalFile(session.root, 'app/styles/main.scss'))?.toString('utf8');
  if (source === undefined) throw typedError('LEGACY_APP_BUILD_INVALID');
  const result = await compiler.compile(Object.freeze({
    source,
    inputPath: sourceFile,
    loadPaths: Object.freeze([
      path.join(session.root, 'app', 'styles'),
      session.root,
      path.join(session.root, 'components'),
      path.join(session.root, 'node_modules')
    ]),
    logger: Object.freeze({ warn() {}, debug() {} })
  }));
  return ScaffoldPlan.empty().addFile('styles/main.css', result.css);
}

function assertRequest(request) {
  if (!isRecord(request) || !Object.isFrozen(request) || !isRecord(request.session) || !isRecord(request.config) || !isRecord(request.config.legacy) || typeof request.configName !== 'string' || request.filesystem === undefined || typeof request.filesystem?.applyPlanAtomically !== 'function') {
    throw typedError('LEGACY_APP_BUILD_INVALID');
  }
}

export async function buildLegacyDevelopDist(request) {
  assertRequest(request);
  const { session, filesystem, compiler, configName } = request;
  const config = request.config.legacy;
  let step = 'index';
  try {
    throwIfAborted(request.signal);
    const indexFile = await optionalFile(session.root, 'app/tpls/index.tpl');
    if (indexFile === undefined) throw typedError('LEGACY_APP_BUILD_INVALID');
    const indexSource = (await readOptionalFile(session.root, 'app/tpls/index.tpl'))?.toString('utf8');
    if (indexSource === undefined) throw typedError('LEGACY_APP_BUILD_INVALID');

    const polymerBridge = await readOptionalFile(session.root, POLYMER_BRIDGE_SOURCE);
    const renderedIndex = renderTemplate(indexSource, config);
    let plan = ScaffoldPlan.empty().addFile('index.html', polymerBridge === undefined ? renderedIndex : injectPolymerBridge(renderedIndex));
    if (polymerBridge !== undefined) plan = addFile(plan, POLYMER_BRIDGE_DESTINATION, polymerBridge);
    step = 'scripts';
    plan = await addTree(plan, session.root, 'app/scripts', 'scripts', (relative, content) => {
      if (relative === 'app-bootstrap.js') return configAssignment(content.toString('utf8'), config);
      if (relative === 'app.js') return content.toString('utf8').replaceAll('components/', 'bower_components/');
      return withoutMissingSourceMap(session.root, relative, content);
    });
    if (await optionalFile(session.root, 'app/scripts/lit-initial-components.js') !== undefined) {
      plan = addFile(plan, 'lit-initial-components.html', litModuleWrapper('lit-initial-components', 'lit-initial-components-loaded'));
    }
    if (await optionalFile(session.root, 'app/scripts/lit-components.js') !== undefined) {
      plan = addFile(plan, 'lit-components.html', litModuleWrapper('lit-components'));
    }
    step = 'static-assets';
    for (const directory of COPIED_DIRECTORIES) {
      step = `static-directory:${directory}`;
      plan = await addTree(plan, session.root, `app/${directory}`, directory);
    }
    for (const fileName of COPIED_FILES) {
      step = `static-file:${fileName}`;
      const source = await optionalFile(session.root, `app/${fileName}`);
      if (source === undefined) continue;
      const content = await readOptionalFile(session.root, `app/${fileName}`);
      if (content === undefined) throw typedError('LEGACY_APP_BUILD_INVALID');
      plan = addFile(plan, fileName, content);
    }
    step = 'elements-and-pages';
    plan = await addTree(plan, session.root, 'app/elements', 'elements', undefined, copiedEntry);
    const pagesPath = typeof config.pagesPath === 'string' && config.pagesPath.length > 0 ? config.pagesPath.replace(/^\.\/?|\/$/g, '') : 'pages';
    if (/^[A-Za-z0-9][A-Za-z0-9_./-]*$/u.test(pagesPath) && !pagesPath.split('/').includes('..')) {
      plan = await addTree(plan, session.root, `app/${pagesPath}`, pagesPath, undefined, copiedEntry);
    }
    step = 'templates';
    for (const file of await capturedFiles(session.root, 'app/tpls')) {
      if (file.relative === 'index.tpl' || file.relative.startsWith('initial-components-imports')) continue;
      if (!file.relative.endsWith('.tpl')) continue;
      plan = addFile(plan, `${file.relative.slice(0, -4)}.html`, file.content);
    }

    step = 'composer';
    const composer = await evaluateComposer(session.root, config, request.signal);
    const composerEndpoint = typeof config.composerEndpoint === 'string' && !/^https?:\/\//u.test(config.composerEndpoint)
      ? config.composerEndpoint.replace(/^\.\/?|\/$/g, '')
      : undefined;
    if (composerEndpoint !== undefined && composerEndpoint !== '' && !composerEndpoint.split('/').includes('..')) {
      for (const [name, content] of Object.entries(composer.pages)) plan = addFile(plan, `${composerEndpoint}/${name}.json`, `${content}\n`);
    }
    step = 'bundles';
    const bundles = await bundleFiles(session.root, config, composer);
    plan = addFile(plan, 'bower_components/initial-components.html', bundles.initial);
    plan = addFile(plan, 'bower_components/app-components.html', bundles.deferred);
    step = 'locales';
    plan = mergePlans(plan, await localePlan(session, filesystem, config, configName));
    step = 'styles';
    plan = mergePlans(plan, await stylesPlan(session, compiler));

    step = 'publish';
    return filesystem.applyPlanAtomically(session, plan, 'dist', { replace: true, signal: request.signal });
  } catch (cause) {
    if (cause?.code === 'INTERRUPTED') throw cause;
    throw typedError('LEGACY_APP_BUILD_INVALID', Object.freeze({ step }), cause);
  }
}
