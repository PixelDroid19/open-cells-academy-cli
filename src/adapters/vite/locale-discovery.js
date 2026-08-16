import { lstat, readdir, realpath } from 'node:fs/promises';
import path from 'node:path';

import { typedError } from '../../domain/workspace-session.js';

const LOCALE_TAG = /^[A-Za-z]{2,3}(?:[-_][A-Za-z0-9]{2,8})*$/;
const SKIPPED = new Set(['node_modules', 'bower_components', 'coverage', 'e2e', 'demo', 'examples', '.git', '.pnpm']);
const MODULE_SELECTOR = /^(?:@[A-Za-z0-9._-]+(?:\/[A-Za-z0-9._-]+)?|[A-Za-z0-9._-]+)$/;
const DEFAULT_MODULE_SELECTORS = Object.freeze(['@cells', '@open-cells']);
const MAX_FILES = 20000;

function isWithin(parent, candidate) {
  const relative = path.relative(parent, candidate);
  return relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

async function optionalDirectory(candidate) {
  try {
    const current = await lstat(candidate);
    if (current.isSymbolicLink()) return false;
    if (!current.isDirectory()) throw typedError('LOCALES_SOURCE_INVALID');
    return true;
  } catch (cause) {
    if (cause?.code === 'ENOENT') return false;
    if (cause?.code !== undefined) throw cause;
    throw typedError('LOCALES_SOURCE_INVALID', undefined, cause);
  }
}

function acceptedLocaleFile(candidate, inputNames) {
  if (!candidate.endsWith('.json')) return false;
  const directory = path.basename(path.dirname(candidate));
  if (directory !== 'locales' && directory !== 'locales-app') return false;
  const name = path.basename(candidate, '.json');
  return LOCALE_TAG.test(name) || inputNames.has(name);
}

async function walk(sessionRoot, current, relative, inputNames, output) {
  let entries;
  try {
    entries = await readdir(current, { withFileTypes: true });
  } catch (cause) {
    throw typedError('LOCALES_SOURCE_INVALID', undefined, cause);
  }
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    if (entry.isSymbolicLink()) continue;
    const absolute = path.join(current, entry.name);
    const nextRelative = relative === '' ? entry.name : `${relative}/${entry.name}`;
    if (entry.isDirectory()) {
      if (!SKIPPED.has(entry.name)) await walk(sessionRoot, absolute, nextRelative, inputNames, output);
      continue;
    }
    if (!entry.isFile() || !acceptedLocaleFile(absolute, inputNames)) continue;
    const currentStatus = await lstat(absolute);
    if (!currentStatus.isFile() || currentStatus.isSymbolicLink()) throw typedError('LOCALES_SOURCE_INVALID');
    output.push(nextRelative);
    if (output.length > MAX_FILES) throw typedError('LOCALES_SOURCE_INVALID');
  }
}

async function discoverUnder(sessionRoot, relativeRoot, inputNames) {
  const absolute = path.join(sessionRoot, ...relativeRoot.split('/'));
  if (!await optionalDirectory(absolute)) return Object.freeze([]);
  const files = [];
  await walk(sessionRoot, absolute, relativeRoot, inputNames, files);
  return Object.freeze(files.sort());
}

function moduleSelectors(value) {
  if (value === undefined) return DEFAULT_MODULE_SELECTORS;
  if (!Array.isArray(value) || value.some(selector => typeof selector !== 'string' || !MODULE_SELECTOR.test(selector))) {
    throw typedError('LOCALES_CONFIG_INVALID', { field: 'appModules' });
  }
  return Object.freeze([...new Set([...DEFAULT_MODULE_SELECTORS, ...value])].sort());
}

async function resolvedPackageRoot(sessionRoot, nodeModulesRoot, candidate) {
  let candidateStatus;
  try {
    candidateStatus = await lstat(candidate);
  } catch (cause) {
    if (cause?.code === 'ENOENT') return undefined;
    throw typedError('LOCALES_SOURCE_INVALID', undefined, cause);
  }
  let canonical = candidate;
  if (candidateStatus.isSymbolicLink()) {
    try {
      canonical = await realpath(candidate);
    } catch (cause) {
      throw typedError('LOCALES_SOURCE_INVALID', undefined, cause);
    }
  } else if (!candidateStatus.isDirectory()) {
    throw typedError('LOCALES_SOURCE_INVALID');
  }
  const current = await lstat(canonical);
  if (!current.isDirectory() || current.isSymbolicLink() || !isWithin(nodeModulesRoot, canonical)) {
    throw typedError('LOCALES_SOURCE_INVALID');
  }
  return Object.freeze({
    absolute: canonical,
    relative: path.relative(sessionRoot, canonical).split(path.sep).join('/')
  });
}

async function configuredPackageRoots(sessionRoot, selectors) {
  const nodeModulesRoot = path.join(sessionRoot, 'node_modules');
  if (!await optionalDirectory(nodeModulesRoot)) return Object.freeze([]);
  const roots = new Map();
  for (const selector of selectors) {
    const segments = selector.split('/');
    if (selector.startsWith('@') && segments.length === 1) {
      const scope = path.join(nodeModulesRoot, selector);
      let entries;
      try {
        entries = await readdir(scope, { withFileTypes: true });
      } catch (cause) {
        if (cause?.code === 'ENOENT') continue;
        throw typedError('LOCALES_SOURCE_INVALID', undefined, cause);
      }
      for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
        const root = await resolvedPackageRoot(sessionRoot, nodeModulesRoot, path.join(scope, entry.name));
        if (root !== undefined) roots.set(root.relative, root);
      }
      continue;
    }
    const root = await resolvedPackageRoot(sessionRoot, nodeModulesRoot, path.join(nodeModulesRoot, ...segments));
    if (root !== undefined) roots.set(root.relative, root);
  }
  return Object.freeze([...roots.values()].sort((left, right) => left.relative.localeCompare(right.relative)));
}

async function discoverPackages(sessionRoot, inputNames, configuredModules) {
  const files = [];
  const roots = await configuredPackageRoots(sessionRoot, moduleSelectors(configuredModules));
  for (const root of roots) await walk(sessionRoot, root.absolute, root.relative, inputNames, files);
  return Object.freeze([...new Set(files)].sort());
}

export async function discoverAppLocaleSources(sessionRoot, config = undefined, configuredModules = undefined) {
  if (typeof sessionRoot !== 'string' || !path.isAbsolute(sessionRoot)) throw typedError('LOCALES_CONTEXT_INVALID');
  const configured = config?.intlInputFileNames;
  const inputNames = new Set(Array.isArray(configured) ? configured : ['locales']);
  const [appRootFiles, appLegacyFiles, componentFiles, packageFiles] = await Promise.all([
    discoverUnder(sessionRoot, 'app/locales-app', inputNames),
    discoverUnder(sessionRoot, 'app/locales', inputNames),
    discoverUnder(sessionRoot, 'components', inputNames),
    discoverPackages(sessionRoot, inputNames, configuredModules)
  ]);
  return Object.freeze({
    appLocaleFiles: Object.freeze([...new Set([...appRootFiles, ...appLegacyFiles])].sort()),
    componentLocaleFiles: Object.freeze([...new Set([...componentFiles, ...packageFiles])].sort())
  });
}
