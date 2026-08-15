import { readFile, lstat, realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';

import { normalizeRelativePath } from '../../domain/path-policy.js';
import { typedError } from '../../domain/workspace-session.js';

const CONFIG_DIRECTORY = Object.freeze(['app', 'config']);

function isPlainObject(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function cloneConfigValue(value, seen = new WeakMap()) {
  if (Array.isArray(value)) {
    if (seen.has(value)) {
      throw new TypeError('Selected config data must not be cyclic');
    }
    const copy = [];
    seen.set(value, copy);
    for (const item of value) {
      copy.push(cloneConfigValue(item, seen));
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
    throw new TypeError('Selected config data must not be cyclic');
  }
  const copy = {};
  seen.set(value, copy);
  for (const [key, item] of Object.entries(value)) {
    Object.defineProperty(copy, key, {
      value: cloneConfigValue(item, seen),
      enumerable: true,
      configurable: true,
      writable: true
    });
  }
  return copy;
}

function copySelectedObject(value) {
  if (!isPlainObject(value)) {
    throw new TypeError('Selected config field must be a plain object');
  }
  return cloneConfigValue(value);
}

function deepFreeze(value, seen = new WeakSet()) {
  if (value === null || typeof value !== 'object' || seen.has(value)) {
    return value;
  }
  seen.add(value);
  for (const item of Object.values(value)) {
    deepFreeze(item, seen);
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
    if (segments.length !== 1 || !/^[A-Za-z0-9][A-Za-z0-9._-]*\.(?:js|mjs)$/.test(segments[0])) {
      throw new TypeError('Invalid config filename');
    }
    return `${CONFIG_DIRECTORY.join('/')}/${segments[0]}`;
  } catch (cause) {
    throw invalidConfig('app/config');
  }
}

function selectField(root, academy, legacy, field) {
  if (Object.hasOwn(academy, field)) {
    return academy[field];
  }
  if (field === 'app') {
    if (isPlainObject(root.app_properties)) {
      return Object.hasOwn(root.app_properties, 'app') ? root.app_properties.app : root.app_properties;
    }
    return root.app;
  }
  if (Object.hasOwn(legacy, field)) {
    return legacy[field];
  }
  return root[field];
}

function optionalPlainObject(root, field, sourcePath) {
  if (root[field] === undefined) {
    return {};
  }
  if (!isPlainObject(root[field])) {
    throw invalidConfig(sourcePath);
  }
  return root[field];
}

function normalizeConfig(defaultExport, sourcePath) {
  try {
    if (!isPlainObject(defaultExport)) {
      throw invalidConfig(sourcePath);
    }
    const academy = optionalPlainObject(defaultExport, 'academy', sourcePath);
    const legacy = optionalPlainObject(defaultExport, 'cells_properties', sourcePath);
    optionalPlainObject(defaultExport, 'app_properties', sourcePath);
    const server = selectField(defaultExport, academy, legacy, 'server');
    const app = selectField(defaultExport, academy, legacy, 'app');
    const locales = selectField(defaultExport, academy, legacy, 'locales');
    const build = selectField(defaultExport, academy, legacy, 'build');
    const normalizedServer = server === undefined ? undefined : copySelectedObject(server);
    const normalizedApp = app === undefined ? undefined : copySelectedObject(app);
    const normalizedLocales = locales === undefined ? undefined : copySelectedObject(locales);
    const normalizedBuild = build === undefined ? undefined : copySelectedObject(build);
    const normalizedPreview = normalizedServer === undefined ? undefined : cloneConfigValue(normalizedServer);
    const record = { sourcePath };
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
    if (Object.hasOwn(defaultExport, 'serviceWorker')) {
      record.serviceWorker = copySelectedObject(defaultExport.serviceWorker);
    } else if (Object.hasOwn(defaultExport, 'enable_sw')) {
      record.enable_sw = cloneConfigValue(defaultExport.enable_sw);
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
  const candidate = path.join(root, ...sourcePath.split('/'));
  const appDirectory = path.join(root, CONFIG_DIRECTORY[0]);
  const expectedDirectory = path.join(root, ...CONFIG_DIRECTORY);
  let initial;
  try {
    const appStatus = await lstat(appDirectory);
    if (!appStatus.isDirectory() || appStatus.isSymbolicLink()) {
      throw new TypeError('Application directory is not a regular directory');
    }
    const directoryStatus = await lstat(expectedDirectory);
    if (!directoryStatus.isDirectory() || directoryStatus.isSymbolicLink()) {
      throw new TypeError('Config directory is not a regular directory');
    }
    initial = await lstat(candidate);
    if (!initial.isFile() || initial.isSymbolicLink()) {
      throw new TypeError('Config is not a regular file');
    }
    const canonicalDirectory = await realpath(expectedDirectory);
    const canonicalFile = await realpath(candidate);
    if (path.dirname(canonicalFile) !== canonicalDirectory) {
      throw new TypeError('Config escaped directory');
    }
    const canonicalStatus = await stat(canonicalFile);
    if (!canonicalStatus.isFile()) {
      throw new TypeError('Config is not a file');
    }
    return Object.freeze({ candidate, canonicalFile, initial });
  } catch (cause) {
    throw invalidConfig(sourcePath);
  }
}

async function assertUnchanged(file, sourcePath) {
  try {
    const current = await lstat(file.candidate);
    if (!current.isFile() || current.isSymbolicLink() || current.dev !== file.initial.dev || current.ino !== file.initial.ino) {
      throw new TypeError('Config path changed');
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

/**
 * Loads a trusted project configuration module. Config execution is not
 * sandboxed: import/evaluation failures are reported as trusted project
 * configuration failures without exposing its source contents.
 */
export async function loadCellsConfig(session, configName) {
  assertSession(session);
  const sourcePath = sourcePathFromName(configName);
  const file = await verifiedConfigFile(session.root, sourcePath);
  let imported;
  try {
    const cacheToken = await cacheTokenFor(file, sourcePath);
    await assertUnchanged(file, sourcePath);
    imported = await import(`${pathToFileURL(file.canonicalFile).href}?academyConfig=${encodeURIComponent(cacheToken)}`);
  } catch (cause) {
    throw invalidConfig(sourcePath);
  }
  await assertUnchanged(file, sourcePath);
  return normalizeConfig(imported.default, sourcePath);
}
