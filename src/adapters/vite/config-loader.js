import { readFile, lstat, realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { Worker } from 'node:worker_threads';
import { init as initEsmLexer, parse as parseEsm } from 'es-module-lexer';

import { normalizeRelativePath } from '../../domain/path-policy.js';
import { typedError } from '../../domain/workspace-session.js';

const CONFIG_DIRECTORY = Object.freeze(['app', 'config']);
const EMPTY_CONFIG = Object.freeze({});

function isPlainObject(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function ownDataValue(value, key, { requireEnumerable = true } = {}) {
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  if (descriptor === undefined) return Object.freeze({ present: false, value: undefined });
  if (!Object.hasOwn(descriptor, 'value') || (requireEnumerable && descriptor.enumerable !== true)) {
    throw new TypeError('Selected config data must not contain accessors or hidden fields');
  }
  return Object.freeze({ present: true, value: descriptor.value });
}

function cloneConfigValue(value, seen = new WeakMap(), active = new WeakSet()) {
  if (Array.isArray(value)) {
    if (seen.has(value)) {
      if (active.has(value)) throw new TypeError('Selected config data must not be cyclic');
      return seen.get(value);
    }
    const copy = [];
    seen.set(value, copy);
    active.add(value);
    try {
      const keys = Reflect.ownKeys(value);
      const length = ownDataValue(value, 'length', { requireEnumerable: false }).value;
      if (!Number.isSafeInteger(length) || length < 0 || keys.length !== length + 1) {
        throw new TypeError('Selected config arrays must contain ordinary data indices');
      }
      for (let index = 0; index < length; index += 1) {
        const descriptor = ownDataValue(value, String(index));
        if (!descriptor.present) throw new TypeError('Selected config arrays must not be sparse');
        copy.push(cloneConfigValue(descriptor.value, seen, active));
      }
      for (const key of keys) {
        if (key === 'length') continue;
        if (typeof key !== 'string' || !/^(?:0|[1-9][0-9]*)$/u.test(key) || Number(key) >= length) {
          throw new TypeError('Selected config arrays must contain ordinary data indices');
        }
      }
    } finally {
      active.delete(value);
    }
    return copy;
  }
  if (value === null || typeof value !== 'object') {
    return value;
  }
  if (!isPlainObject(value)) {
    throw new TypeError('Selected config data must be plain objects');
  }
  if (seen.has(value)) {
    if (active.has(value)) throw new TypeError('Selected config data must not be cyclic');
    return seen.get(value);
  }
  const copy = {};
  seen.set(value, copy);
  active.add(value);
  try {
    for (const key of Reflect.ownKeys(value)) {
      if (typeof key !== 'string') throw new TypeError('Selected config data must not contain symbol keys');
      const descriptor = ownDataValue(value, key);
      Object.defineProperty(copy, key, {
        value: cloneConfigValue(descriptor.value, seen, active),
        enumerable: true,
        configurable: true,
        writable: true
      });
    }
  } finally {
    active.delete(value);
  }
  return copy;
}

function copySelectedObject(value) {
  if (!isPlainObject(value)) {
    throw new TypeError('Selected config field must be a plain object');
  }
  return cloneConfigValue(value);
}

function copyStringList(value) {
  const copy = cloneConfigValue(value);
  if (!Array.isArray(copy) || copy.some(item => typeof item !== 'string')) {
    throw new TypeError('Selected config field must be a string array');
  }
  return Object.freeze(copy);
}

function deepFreeze(value, seen = new WeakSet()) {
  if (value === null || typeof value !== 'object' || seen.has(value)) {
    return value;
  }
  seen.add(value);
  for (const key of Reflect.ownKeys(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (descriptor !== undefined && Object.hasOwn(descriptor, 'value')) {
      deepFreeze(descriptor.value, seen);
    }
  }
  return Object.freeze(value);
}

function configDetails(sourcePath) {
  return Object.freeze({ path: sourcePath, trustedProjectConfig: true });
}

function invalidConfig(sourcePath) {
  return typedError('CONFIG_INVALID', configDetails(sourcePath));
}

function assertSession(session) {
  if (session === null || typeof session !== 'object' || typeof session.root !== 'string' || !path.isAbsolute(session.root)) {
    throw typedError('WORKSPACE_INVALID');
  }
}

function sourcePathFromName(configName) {
  try {
    const segments = normalizeRelativePath(configName);
    const fileName = segments.at(-1);
    const directories = segments.slice(0, -1);
    if (
      segments.length === 0 ||
      !/^[A-Za-z0-9][A-Za-z0-9._-]*\.(?:js|mjs)$/.test(fileName) ||
      directories.some(segment => !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(segment))
    ) {
      throw new TypeError('Invalid config filename');
    }
    return `${CONFIG_DIRECTORY.join('/')}/${segments.join('/')}`;
  } catch (cause) {
    throw invalidConfig('app/config');
  }
}

function sameIdentity(left, right) {
  return left.dev === right.dev && left.ino === right.ino;
}

function within(parent, candidate) {
  const relative = path.relative(parent, candidate);
  return relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

function selectField(root, academy, legacy, appProperties, field) {
  const academyValue = ownDataValue(academy, field);
  if (academyValue.present) {
    return academyValue.value;
  }
  if (field === 'app') {
    if (appProperties !== undefined) {
      const appValue = ownDataValue(appProperties, 'app');
      return appValue.present ? appValue.value : appProperties;
    }
    const rootApp = ownDataValue(root, 'app');
    return !rootApp.present || rootApp.value === undefined || isPlainObject(rootApp.value) ? rootApp.value : root;
  }
  const legacyValue = ownDataValue(legacy, field);
  if (legacyValue.present) {
    return legacyValue.value;
  }
  return ownDataValue(root, field).value;
}

function optionalPlainObject(root, field, sourcePath) {
  const selected = ownDataValue(root, field);
  if (!selected.present || selected.value === undefined) {
    return undefined;
  }
  if (!isPlainObject(selected.value)) {
    throw invalidConfig(sourcePath);
  }
  return selected.value;
}

function copyInitialTemplate(value) {
  if (typeof value !== 'string' || value.length === 0 || value.trim() !== value || value.includes('\u0000') || /[\u0001-\u001f\u007f]/u.test(value)) {
    throw new TypeError('Selected runtime initial template must be a non-empty string');
  }
  return value;
}

function normalizeConfig(defaultExport, sourcePath, sourceDependencies = Object.freeze([sourcePath])) {
  try {
    if (!isPlainObject(defaultExport)) {
      throw invalidConfig(sourcePath);
    }
    const academy = optionalPlainObject(defaultExport, 'academy', sourcePath) ?? EMPTY_CONFIG;
    const legacy = optionalPlainObject(defaultExport, 'cells_properties', sourcePath) ?? EMPTY_CONFIG;
    const appProperties = optionalPlainObject(defaultExport, 'app_properties', sourcePath);
    const server = selectField(defaultExport, academy, legacy, appProperties, 'server');
    const app = selectField(defaultExport, academy, legacy, appProperties, 'app');
    const locales = selectField(defaultExport, academy, legacy, appProperties, 'locales');
    const build = selectField(defaultExport, academy, legacy, appProperties, 'build');
    const appModules = selectField(defaultExport, academy, legacy, appProperties, 'appModules');
    const initialTemplate = selectField(defaultExport, academy, legacy, appProperties, 'initialTemplate');
    const normalizedServer = server === undefined ? undefined : copySelectedObject(server);
    const normalizedApp = app === undefined ? undefined : copySelectedObject(app);
    const normalizedLocales = locales === undefined ? undefined : copySelectedObject(locales);
    const normalizedBuild = build === undefined ? undefined : copySelectedObject(build);
    const normalizedPreview = normalizedServer === undefined ? undefined : cloneConfigValue(normalizedServer);
    const normalizedRuntime = initialTemplate === undefined ? undefined : { initialTemplate: copyInitialTemplate(initialTemplate) };
    const record = { sourcePath, sourceDependencies: Object.freeze([...sourceDependencies]), legacy: cloneConfigValue(defaultExport) };
    if (normalizedServer !== undefined) {
      record.server = normalizedServer;
      record.preview = normalizedPreview;
    }
    if (normalizedApp !== undefined) {
      record.app = normalizedApp;
    }
    if (normalizedLocales !== undefined) {
      record.locales = normalizedLocales;
    }
    if (normalizedBuild !== undefined) {
      record.build = normalizedBuild;
    }
    if (normalizedRuntime !== undefined) {
      record.runtime = normalizedRuntime;
    }
    if (appModules !== undefined) {
      record.appModules = copyStringList(appModules);
    }
    const serviceWorker = ownDataValue(defaultExport, 'serviceWorker');
    const enableServiceWorker = ownDataValue(defaultExport, 'enable_sw');
    if (serviceWorker.present) {
      record.serviceWorker = copySelectedObject(serviceWorker.value);
    } else if (enableServiceWorker.present) {
      record.enable_sw = cloneConfigValue(enableServiceWorker.value);
    }
    return deepFreeze(record);
  } catch (cause) {
    if (cause?.code === 'CONFIG_INVALID') {
      throw cause;
    }
    throw invalidConfig(sourcePath);
  }
}

async function verifiedConfigFile(root, sourcePath) {
  const sourceSegments = sourcePath.split('/');
  const relativeSegments = sourceSegments.slice(CONFIG_DIRECTORY.length);
  const candidate = path.join(root, ...sourceSegments);
  const appDirectory = path.join(root, CONFIG_DIRECTORY[0]);
  const expectedDirectory = path.join(root, ...CONFIG_DIRECTORY);
  try {
    const directoryPaths = [
      root,
      appDirectory,
      expectedDirectory,
      ...relativeSegments.slice(0, -1).map((_, index) => path.join(expectedDirectory, ...relativeSegments.slice(0, index + 1)))
    ];
    const directories = [];
    for (const directoryPath of directoryPaths) {
      const initial = await lstat(directoryPath);
      if (!initial.isDirectory() || initial.isSymbolicLink()) {
        throw new TypeError('Config ancestor is not a regular directory');
      }
      directories.push(Object.freeze({
        path: directoryPath,
        canonical: await realpath(directoryPath),
        initial: Object.freeze({ dev: initial.dev, ino: initial.ino })
      }));
    }
    const initial = await lstat(candidate);
    if (!initial.isFile() || initial.isSymbolicLink()) {
      throw new TypeError('Config is not a regular file');
    }
    const canonicalDirectory = await realpath(expectedDirectory);
    const canonicalFile = await realpath(candidate);
    if (!within(canonicalDirectory, canonicalFile) || canonicalFile === canonicalDirectory) {
      throw new TypeError('Config escaped directory');
    }
    const canonicalStatus = await stat(canonicalFile);
    if (!canonicalStatus.isFile() || !sameIdentity(initial, canonicalStatus)) {
      throw new TypeError('Config is not a file');
    }
    return Object.freeze({
      candidate,
      canonicalFile,
      canonicalDirectory,
      initial: Object.freeze({ dev: initial.dev, ino: initial.ino }),
      directories: Object.freeze(directories)
    });
  } catch (cause) {
    throw invalidConfig(sourcePath);
  }
}

async function assertUnchanged(file, sourcePath) {
  try {
    for (const directory of file.directories) {
      const current = await lstat(directory.path);
      if (!current.isDirectory() || current.isSymbolicLink() || !sameIdentity(current, directory.initial)) {
        throw new TypeError('Config ancestor changed');
      }
      if (await realpath(directory.path) !== directory.canonical) {
        throw new TypeError('Config ancestor target changed');
      }
    }
    const current = await lstat(file.candidate);
    if (!current.isFile() || current.isSymbolicLink() || !sameIdentity(current, file.initial)) {
      throw new TypeError('Config path changed');
    }
    if (await realpath(file.candidate) !== file.canonicalFile) {
      throw new TypeError('Config target changed');
    }
  } catch (cause) {
    throw invalidConfig(sourcePath);
  }
}

async function cacheTokenFor(file, sourcePath) {
  try {
    const contents = await readFile(file.canonicalFile);
    return createHash('sha256').update(contents).digest('hex');
  } catch (cause) {
    throw invalidConfig(sourcePath);
  }
}

function cachedChildren(module, configDirectory, output = new Set()) {
  if (module === undefined || output.has(module.filename)) return output;
  if (within(configDirectory, module.filename)) output.add(module.filename);
  for (const child of module.children ?? []) cachedChildren(child, configDirectory, output);
  return output;
}

function clearCommonJsConfigCache(requireFromProject, configDirectory) {
  for (const fileName of Object.keys(requireFromProject.cache)) {
    if (within(configDirectory, fileName)) delete requireFromProject.cache[fileName];
  }
}

async function commonJsConfig(session, file, sourcePath) {
  const requireFromProject = createRequire(path.join(session.root, 'package.json'));
  clearCommonJsConfigCache(requireFromProject, file.canonicalDirectory);
  let resolved;
  try {
    resolved = requireFromProject.resolve(file.canonicalFile);
    const exported = requireFromProject(resolved);
    const defaultExport = exported !== null && typeof exported === 'object' && exported.__esModule === true && Object.hasOwn(exported, 'default')
      ? exported.default
      : exported;
    const dependencyFiles = [...cachedChildren(requireFromProject.cache[resolved], file.canonicalDirectory)].sort();
    const dependencies = [];
    for (const dependency of dependencyFiles) {
      const current = await lstat(dependency);
      if (!current.isFile() || current.isSymbolicLink()) throw new TypeError('Invalid config dependency');
      const canonical = await realpath(dependency);
      if (canonical !== dependency || !within(file.canonicalDirectory, canonical)) throw new TypeError('Config dependency escaped');
      dependencies.push(path.relative(session.root, canonical).split(path.sep).join('/'));
    }
    return Object.freeze({ defaultExport, dependencies: Object.freeze(dependencies.sort()) });
  } catch (cause) {
    if (cause?.code === 'ERR_REQUIRE_ESM' || cause?.code === 'ERR_REQUIRE_ASYNC_MODULE') return undefined;
    throw invalidConfig(sourcePath);
  }
}

async function esmDependencyGraph(session, file, sourcePath) {
  await initEsmLexer;
  const pending = [file.canonicalFile];
  const visited = new Set();
  while (pending.length > 0) {
    const candidate = pending.pop();
    if (visited.has(candidate)) continue;
    visited.add(candidate);
    let source;
    try {
      const current = await lstat(candidate);
      const canonical = await realpath(candidate);
      if (!current.isFile() || current.isSymbolicLink() || canonical !== candidate || !within(file.canonicalDirectory, canonical)) {
        throw new TypeError('Invalid ESM config dependency');
      }
      source = await readFile(canonical, 'utf8');
    } catch (cause) {
      throw invalidConfig(sourcePath);
    }
    let imports;
    try {
      [imports] = parseEsm(source);
    } catch (cause) {
      throw invalidConfig(sourcePath);
    }
    for (const entry of imports) {
      const raw = source.slice(entry.s, entry.e);
      const imported = typeof entry.n === 'string'
        ? entry.n
        : entry.d >= 0 && raw.startsWith('`') && raw.endsWith('`') && !raw.includes('${') && !raw.includes('\\')
          ? raw.slice(1, -1)
          : undefined;
      if (typeof imported !== 'string' || (!imported.startsWith('./') && !imported.startsWith('../'))) continue;
      const specifier = imported.split(/[?#]/, 1)[0];
      let dependency = path.resolve(path.dirname(candidate), specifier);
      if (path.extname(dependency) === '') dependency += '.js';
      if (!within(file.canonicalDirectory, dependency)) throw invalidConfig(sourcePath);
      pending.push(dependency);
    }
  }
  return Object.freeze([...visited]
    .map(dependency => path.relative(session.root, dependency).split(path.sep).join('/'))
    .sort());
}

async function evaluateEsmConfig(file, sourcePath) {
  const workerSource = `
    const { parentPort, workerData } = require('node:worker_threads');
    import(workerData.url).then(
      module => parentPort.postMessage({ ok: true, value: module.default }),
      () => parentPort.postMessage({ ok: false })
    );
  `;
  return new Promise((resolve, reject) => {
    const worker = new Worker(workerSource, {
      eval: true,
      workerData: { url: pathToFileURL(file.canonicalFile).href }
    });
    let settled = false;
    const finish = (operation, value) => {
      if (settled) return;
      settled = true;
      void worker.terminate();
      operation(value);
    };
    worker.once('message', message => {
      if (message?.ok === true) finish(resolve, message.value);
      else finish(reject, invalidConfig(sourcePath));
    });
    worker.once('error', () => finish(reject, invalidConfig(sourcePath)));
    worker.once('exit', () => {
      if (!settled) finish(reject, invalidConfig(sourcePath));
    });
  });
}

/**
 * Loads a trusted project configuration module. Config execution is not
 * sandboxed: import/evaluation failures are reported as trusted project
 * configuration failures without exposing its source contents.
 */
export async function loadCellsConfig(session, configName) {
  assertSession(session);
  const sourcePath = sourcePathFromName(configName);
  const file = await verifiedConfigFile(session.root, sourcePath);
  let defaultExport;
  let dependencies = Object.freeze([sourcePath]);
  try {
    const cacheToken = await cacheTokenFor(file, sourcePath);
    await assertUnchanged(file, sourcePath);
    const commonJs = sourcePath.endsWith('.js') && session.packageMetadata?.type !== 'module'
      ? await commonJsConfig(session, file, sourcePath)
      : undefined;
    if (commonJs === undefined) {
      dependencies = await esmDependencyGraph(session, file, sourcePath);
      defaultExport = await evaluateEsmConfig(file, sourcePath);
    } else {
      defaultExport = commonJs.defaultExport;
      dependencies = commonJs.dependencies;
    }
  } catch (cause) {
    throw invalidConfig(sourcePath);
  }
  await assertUnchanged(file, sourcePath);
  return normalizeConfig(defaultExport, sourcePath, dependencies);
}
