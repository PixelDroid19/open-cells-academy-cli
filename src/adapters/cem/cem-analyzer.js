import { lstat, readdir, realpath } from 'node:fs/promises';
import path from 'node:path';

import { typedError } from '../../domain/workspace-session.js';
import { identity, isWithin, readStageFile } from '../vite/stage-capture.js';

const SOURCE_EXTENSIONS = new Set(['.js', '.mjs', '.ts']);
const SKIP_DIRECTORIES = new Set(['node_modules', 'test', 'coverage', 'dist', '.git', '__snapshots__', 'build']);
const CEM_OPTIONS = Object.freeze({
  invalidCode: 'DOC_SOURCE_INVALID',
  cleanupCode: 'TRANSACTION_CLEANUP_FAILED',
  failure(cause = undefined) {
    if (cause?.code === 'DOC_SOURCE_INVALID' || cause?.code === 'PATH_CHANGED') return cause;
    return typedError('DOC_SOURCE_INVALID', undefined, cause);
  }
});

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function assertApi(api) {
  if (!isRecord(api) || typeof api.create !== 'function' || api.ts === null || typeof api.ts !== 'object' || typeof api.ts.createSourceFile !== 'function') {
    throw typedError('CEM_API_INVALID');
  }
}

function assertSession(session) {
  if (!isRecord(session) || typeof session.root !== 'string' || !path.isAbsolute(session.root)) throw typedError('WORKSPACE_INVALID');
}

function shouldInclude(relative) {
  const segments = relative.split('/');
  if (segments.some(segment => SKIP_DIRECTORIES.has(segment))) return false;
  if (relative.includes('.test.') || relative.includes('.spec.') || relative.endsWith('.d.ts')) return false;
  return SOURCE_EXTENSIONS.has(path.extname(relative));
}

async function collectSources(session, directory, relative = '') {
  const sources = [];
  const entries = await readdir(directory, { withFileTypes: true });
  for (const entry of entries) {
    const candidate = path.join(directory, entry.name);
    const childRelative = relative === '' ? entry.name : `${relative}/${entry.name}`;
    if (entry.isSymbolicLink()) throw typedError('DOC_SOURCE_INVALID', { path: childRelative });
    if (entry.isDirectory()) {
      if (SKIP_DIRECTORIES.has(entry.name)) continue;
      sources.push(...await collectSources(session, candidate, childRelative));
      continue;
    }
    if (!entry.isFile()) continue;
    if (!shouldInclude(childRelative)) continue;
    let current;
    try {
      current = await lstat(candidate);
    } catch (cause) {
      throw typedError('DOC_SOURCE_INVALID', { path: childRelative }, cause);
    }
    if (!current.isFile() || current.isSymbolicLink()) throw typedError('DOC_SOURCE_INVALID', { path: childRelative });
    const canonical = await realpath(candidate);
    if (!isWithin(session.root, canonical)) throw typedError('DOC_SOURCE_INVALID', { path: childRelative });
    sources.push(Object.freeze({ absolute: candidate, relative: childRelative, identity: identity(current) }));
  }
  return sources;
}

async function moduleSource(entry) {
  const current = await lstat(entry.absolute);
  if (!current.isFile() || current.isSymbolicLink() || !sameIdentity(identity(current), entry.identity)) {
    throw typedError('PATH_CHANGED');
  }
  return readStageFile(entry.absolute, identity(current), CEM_OPTIONS);
}

function sameIdentity(left, right) {
  return left.dev === right.dev && left.ino === right.ino;
}

/**
 * Adapter around the injected public Custom Elements Manifest Analyzer API.
 * The composition root resolves `create`, `ts`, and `litPlugin`, so importing
 * this module never requires the analyzer package to exist.
 */
export class CemAnalyzer {
  #api;

  constructor(api) {
    assertApi(api);
    this.#api = api;
    Object.freeze(this);
  }

  async analyze(session, options = undefined) {
    assertSession(session);
    if (options !== undefined && (options === null || typeof options !== 'object' || Array.isArray(options))) {
      throw typedError('CEM_OPTIONS_INVALID');
    }
    const sources = await collectSources(session, session.root);
    const modules = [];
    for (const entry of sources) {
      const source = await moduleSource(entry);
      const sourceFile = this.#api.ts.createSourceFile(entry.absolute, source.toString('utf8'), this.#api.ts.ScriptTarget.ESNext, true, entry.relative.endsWith('.ts') ? this.#api.ts.ScriptKind.TS : this.#api.ts.ScriptKind.JS);
      modules.push(sourceFile);
    }
    let manifest;
    try {
      manifest = await this.#api.create(Object.freeze({
        modules,
        plugins: [...((this.#api.litPlugin?.() ?? []))],
        context: { dev: false }
      }));
    } catch (cause) {
      throw typedError('DOC_ANALYZER_FAILED', undefined, cause);
    }
    if (!isRecord(manifest) || typeof manifest.schemaVersion !== 'string' || !Array.isArray(manifest.modules)) {
      throw typedError('DOC_ANALYZER_FAILED');
    }
    return manifest;
  }
}
