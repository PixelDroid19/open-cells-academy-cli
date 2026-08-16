import { lstat, readdir, realpath } from 'node:fs/promises';
import path from 'node:path';

import { typedError } from '../../domain/workspace-session.js';

const TEST_FILE = /\.(?:test|spec)\.[cm]?[jt]sx?$/;
const SKIPPED_DIRECTORIES = new Set(['node_modules', 'coverage', 'e2e']);
const MAX_TEST_FILES = 10000;

function sameIdentity(left, right) {
  return left.dev === right.dev && left.ino === right.ino;
}

function isWithin(parent, candidate) {
  const relative = path.relative(parent, candidate);
  return relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

async function status(candidate) {
  try {
    return await lstat(candidate);
  } catch (cause) {
    if (cause?.code === 'ENOENT') return undefined;
    throw typedError('TEST_SOURCE_INVALID', undefined, cause);
  }
}

async function captureGuard(candidate, kind, canonicalRoot) {
  const current = await lstat(candidate);
  if (current.isSymbolicLink() || (kind === 'directory' ? !current.isDirectory() : !current.isFile())) {
    throw typedError('TEST_SOURCE_INVALID');
  }
  const canonical = await realpath(candidate);
  if (!isWithin(canonicalRoot, canonical) && canonical !== canonicalRoot) throw typedError('TEST_SOURCE_INVALID');
  return Object.freeze({ candidate, canonical, identity: Object.freeze({ dev: current.dev, ino: current.ino }), kind });
}

async function verifyGuard(guard) {
  const current = await lstat(guard.candidate);
  if (
    current.isSymbolicLink() ||
    (guard.kind === 'directory' ? !current.isDirectory() : !current.isFile()) ||
    !sameIdentity(current, guard.identity) ||
    await realpath(guard.candidate) !== guard.canonical
  ) throw typedError('TEST_SOURCE_INVALID');
}

async function walk(root, canonicalRoot, directory, relative, files, guards) {
  const directoryGuard = await captureGuard(directory, 'directory', canonicalRoot);
  guards.push(directoryGuard);
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
      if (!SKIPPED_DIRECTORIES.has(entry.name)) await walk(root, canonicalRoot, candidate, candidateRelative, files, guards);
      continue;
    }
    if (!entry.isFile() || !TEST_FILE.test(entry.name)) continue;
    guards.push(await captureGuard(candidate, 'file', canonicalRoot));
    files.add(candidateRelative);
    if (files.size > MAX_TEST_FILES) throw typedError('TEST_SOURCE_INVALID');
  }
  await verifyGuard(directoryGuard);
}

export async function captureProjectTestFiles(root) {
  if (typeof root !== 'string' || !path.isAbsolute(root)) throw typedError('TEST_SOURCE_INVALID');
  let canonicalRoot;
  let rootGuard;
  try {
    canonicalRoot = await realpath(root);
    if (canonicalRoot !== root) throw typedError('TEST_SOURCE_INVALID');
    rootGuard = await captureGuard(root, 'directory', canonicalRoot);
  } catch (cause) {
    if (cause?.code === 'TEST_SOURCE_INVALID') throw cause;
    throw typedError('TEST_SOURCE_INVALID', undefined, cause);
  }
  const files = new Set();
  const guards = [rootGuard];
  for (const relativeRoot of ['app/test', 'test']) {
    const directory = path.join(root, ...relativeRoot.split('/'));
    const current = await status(directory);
    if (current === undefined) continue;
    if (!current.isDirectory() || current.isSymbolicLink()) throw typedError('TEST_SOURCE_INVALID');
    await walk(root, canonicalRoot, directory, relativeRoot, files, guards);
  }
  await verifyGuard(rootGuard);
  const capturedFiles = Object.freeze([...files].sort());
  return Object.freeze({
    files: capturedFiles,
    async verify() {
      for (const guard of guards) await verifyGuard(guard);
    }
  });
}

export async function discoverProjectTestFiles(root) {
  return (await captureProjectTestFiles(root)).files;
}
