import { lstat, readdir } from 'node:fs/promises';
import path from 'node:path';

import { typedError } from '../../domain/workspace-session.js';

const TEST_FILE = /\.(?:test|spec)\.[cm]?[jt]sx?$/;
const SKIPPED_DIRECTORIES = new Set(['node_modules', 'coverage', 'e2e']);
const MAX_TEST_FILES = 10000;

async function status(candidate) {
  try {
    return await lstat(candidate);
  } catch (cause) {
    if (cause?.code === 'ENOENT') return undefined;
    throw typedError('TEST_SOURCE_INVALID', undefined, cause);
  }
}

async function walk(root, directory, relative, files) {
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch (cause) {
    throw typedError('TEST_SOURCE_INVALID', undefined, cause);
  }
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    const candidate = path.join(directory, entry.name);
    const candidateRelative = relative === '' ? entry.name : `${relative}/${entry.name}`;
    if (entry.isSymbolicLink()) throw typedError('TEST_SOURCE_INVALID');
    if (entry.isDirectory()) {
      if (!SKIPPED_DIRECTORIES.has(entry.name)) await walk(root, candidate, candidateRelative, files);
      continue;
    }
    if (!entry.isFile() || !TEST_FILE.test(entry.name)) continue;
    const current = await lstat(candidate);
    if (!current.isFile() || current.isSymbolicLink()) throw typedError('TEST_SOURCE_INVALID');
    files.add(candidateRelative);
    if (files.size > MAX_TEST_FILES) throw typedError('TEST_SOURCE_INVALID');
  }
}

export async function discoverProjectTestFiles(root) {
  if (typeof root !== 'string' || !path.isAbsolute(root)) throw typedError('TEST_SOURCE_INVALID');
  const files = new Set();
  for (const relativeRoot of ['app/test', 'test']) {
    const directory = path.join(root, ...relativeRoot.split('/'));
    const current = await status(directory);
    if (current === undefined) continue;
    if (!current.isDirectory() || current.isSymbolicLink()) throw typedError('TEST_SOURCE_INVALID');
    await walk(root, directory, relativeRoot, files);
  }
  return Object.freeze([...files].sort());
}
