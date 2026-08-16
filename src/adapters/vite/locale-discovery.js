import { lstat, readdir } from 'node:fs/promises';
import path from 'node:path';

import { typedError } from '../../domain/workspace-session.js';

const LOCALE_TAG = /^[A-Za-z]{2,3}(?:[-_][A-Za-z0-9]{2,8})*$/;
const SKIPPED = new Set(['node_modules', 'bower_components', 'coverage', 'e2e', 'demo', 'examples', '.git', '.pnpm']);
const MAX_FILES = 20000;

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

export async function discoverAppLocaleSources(sessionRoot, config = undefined) {
  if (typeof sessionRoot !== 'string' || !path.isAbsolute(sessionRoot)) throw typedError('LOCALES_CONTEXT_INVALID');
  const configured = config?.intlInputFileNames;
  const inputNames = new Set(Array.isArray(configured) ? configured : ['locales']);
  const [appLocaleFiles, componentFiles, packageFiles] = await Promise.all([
    discoverUnder(sessionRoot, 'app', inputNames),
    discoverUnder(sessionRoot, 'components', inputNames),
    discoverUnder(sessionRoot, 'node_modules', inputNames)
  ]);
  return Object.freeze({
    appLocaleFiles,
    componentLocaleFiles: Object.freeze([...new Set([...componentFiles, ...packageFiles])].sort())
  });
}
