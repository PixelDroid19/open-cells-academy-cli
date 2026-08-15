import { lstat, open, readFile, realpath, rename, rm } from 'node:fs/promises';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';

import { PathPolicy, normalizeRelativePath } from '../../domain/path-policy.js';
import { typedError } from '../../domain/workspace-session.js';
import { TextDocumentsPort } from '../../ports/text-documents.js';

const DEFAULT_IO = Object.freeze({ lstat, open, readFile, realpath, rename, rm });

function sameIdentity(left, right) {
  return left.dev === right.dev && left.ino === right.ino;
}

function throwIfAborted(signal) {
  if (signal?.aborted === true) {
    throw typedError('INTERRUPTED');
  }
}

function isPathWithin(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}

function assertContent(content) {
  if (typeof content !== 'string' || content.includes('\u0000')) {
    throw typedError('INVALID_INPUT', { field: 'content' });
  }
}

function assertOptions(options) {
  if (options === null || typeof options !== 'object' || Array.isArray(options)) {
    throw typedError('INVALID_INPUT', { field: 'options' });
  }
  if (options.replace !== true && options.replace !== false) {
    throw typedError('INVALID_INPUT', { field: 'replace' });
  }
  if (options.signal !== undefined && (options.signal === null || typeof options.signal !== 'object')) {
    throw typedError('INVALID_INPUT', { field: 'signal' });
  }
  if (options.expectedVersion !== undefined && !isVersionShape(options.expectedVersion)) {
    throw typedError('INVALID_INPUT', { field: 'expectedVersion' });
  }
}

function isVersionShape(version) {
  if (version === null || typeof version !== 'object' || typeof version.exists !== 'boolean') {
    return false;
  }
  if (!version.exists) {
    return Object.keys(version).length === 1;
  }
  return (
    Number.isSafeInteger(version.dev) &&
    Number.isSafeInteger(version.ino) &&
    Number.isSafeInteger(version.size) &&
    typeof version.mtimeMs === 'number' &&
    Number.isFinite(version.mtimeMs) &&
    typeof version.digest === 'string' &&
    /^[0-9a-f]{64}$/.test(version.digest)
  );
}

function freezeAbsentVersion() {
  return Object.freeze({ exists: false });
}

function freezePresentVersion(status, content) {
  return Object.freeze({
    exists: true,
    dev: status.dev,
    ino: status.ino,
    size: status.size,
    mtimeMs: status.mtimeMs,
    digest: createHash('sha256').update(content).digest('hex')
  });
}

function sameVersion(left, right) {
  if (left.exists !== right.exists) {
    return false;
  }
  if (!left.exists) {
    return true;
  }
  return (
    left.dev === right.dev &&
    left.ino === right.ino &&
    left.size === right.size &&
    left.mtimeMs === right.mtimeMs &&
    left.digest === right.digest
  );
}

function normalizeFailure(cause, fallbackCode, details) {
  if (cause?.code === 'INTERRUPTED' || cause?.code === 'PATH_CHANGED' || cause?.code === 'PATH_INVALID' || cause?.code === 'OUTPUT_EXISTS' || cause?.code === 'PATH_NOT_FOUND') {
    return cause;
  }
  return typedError(fallbackCode, details, cause);
}

/**
 * Atomically writes a workspace document through a sibling temporary file.
 * The portable filesystem API cannot make the final pre-rename check and
 * kernel rename one indivisible userspace operation, so identity and byte
 * versions are checked immediately before rename and stale writers fail
 * closed whenever a check observes a change.
 */
export class AtomicTextDocuments extends TextDocumentsPort {
  #io;

  constructor({ io = {} } = {}) {
    super();
    if (io === null || typeof io !== 'object' || Array.isArray(io)) {
      throw typedError('INVALID_INPUT', { field: 'io' });
    }
    const merged = { ...DEFAULT_IO, ...io };
    for (const method of ['lstat', 'open', 'readFile', 'realpath', 'rename', 'rm']) {
      if (typeof merged[method] !== 'function') {
        throw typedError('INVALID_INPUT', { field: 'io' });
      }
    }
    this.#io = Object.freeze(merged);
    Object.freeze(this);
  }

  #policy(session) {
    return new PathPolicy(session, {
      joinPath: path.join,
      lstat: candidate => this.#io.lstat(candidate),
      realpath: candidate => this.#io.realpath(candidate),
      isPathWithin
    });
  }

  async #statusOrAbsent(candidate) {
    try {
      return await this.#io.lstat(candidate);
    } catch (cause) {
      if (cause?.code === 'ENOENT') {
        return undefined;
      }
      throw cause;
    }
  }

  async #validateParent(parent, relativePath) {
    let status;
    try {
      status = await this.#io.lstat(parent);
    } catch (cause) {
      if (cause?.code === 'ENOENT') {
        throw typedError('PATH_NOT_FOUND', { path: relativePath }, cause);
      }
      throw typedError('DOCUMENT_WRITE_FAILED', { path: relativePath }, cause);
    }
    if (!status.isDirectory() || status.isSymbolicLink()) {
      throw typedError('PATH_INVALID', { path: relativePath });
    }
    return status;
  }

  async #captureVersioned(target, relativePath, { changed = false } = {}) {
    let before;
    try {
      before = await this.#statusOrAbsent(target);
    } catch (cause) {
      throw typedError(changed ? 'PATH_CHANGED' : 'DOCUMENT_READ_FAILED', { path: relativePath }, cause);
    }
    if (before === undefined) {
      return Object.freeze({ content: '', version: freezeAbsentVersion() });
    }
    if (!before.isFile() || before.isSymbolicLink()) {
      throw typedError(changed ? 'PATH_CHANGED' : 'PATH_INVALID', { path: relativePath });
    }
    let content;
    try {
      content = await this.#io.readFile(target);
    } catch (cause) {
      throw typedError(changed ? 'PATH_CHANGED' : 'DOCUMENT_READ_FAILED', { path: relativePath }, cause);
    }
    let after;
    try {
      after = await this.#statusOrAbsent(target);
    } catch (cause) {
      throw typedError(changed ? 'PATH_CHANGED' : 'DOCUMENT_READ_FAILED', { path: relativePath }, cause);
    }
    if (
      after === undefined ||
      !after.isFile() ||
      after.isSymbolicLink() ||
      !sameIdentity(before, after) ||
      before.size !== after.size ||
      before.mtimeMs !== after.mtimeMs
    ) {
      throw typedError('PATH_CHANGED', { path: relativePath });
    }
    const bytes = Buffer.isBuffer(content) ? content : Buffer.from(content);
    return Object.freeze({ content: bytes.toString('utf8'), version: freezePresentVersion(after, bytes) });
  }

  async #verifyTemporary(temporary, identity, relativePath) {
    const current = await this.#statusOrAbsent(temporary);
    if (current === undefined || !current.isFile() || current.isSymbolicLink() || !sameIdentity(current, identity)) {
      throw typedError('PATH_CHANGED', { path: relativePath });
    }
  }

  async #removeExactTemporary(temporary, identity) {
    const current = await this.#statusOrAbsent(temporary);
    if (current === undefined) {
      return undefined;
    }
    if (!current.isFile() || current.isSymbolicLink() || !sameIdentity(current, identity)) {
      return undefined;
    }
    await this.#io.rm(temporary, { force: false });
    return undefined;
  }

  async read(session, relativePath) {
    const versioned = await this.readVersioned(session, relativePath);
    if (!versioned.version.exists) {
      throw typedError('PATH_NOT_FOUND', { path: relativePath });
    }
    return versioned.content;
  }

  async readVersioned(session, relativePath) {
    const segments = normalizeRelativePath(relativePath);
    const policy = this.#policy(session);
    const target = await policy.resolveWrite(segments.join('/'));
    await this.#validateParent(path.dirname(target), relativePath);
    const versioned = await this.#captureVersioned(target, relativePath);
    return Object.freeze({ content: versioned.content, version: versioned.version });
  }

  async writeAtomically(session, relativePath, content, options = {}) {
    assertContent(content);
    assertOptions(options);
    const segments = normalizeRelativePath(relativePath);
    const policy = this.#policy(session);
    throwIfAborted(options.signal);
    const target = await policy.resolveWrite(segments.join('/'));
    if (target === session.root) {
      throw typedError('PATH_INVALID', { path: relativePath });
    }
    const parent = path.dirname(target);
    const parentIdentity = await this.#validateParent(parent, relativePath);
    const initial = await this.#captureVersioned(target, relativePath);
    const expected = options.expectedVersion ?? initial.version;
    if (options.expectedVersion !== undefined && !sameVersion(initial.version, options.expectedVersion)) {
      throw typedError('PATH_CHANGED', { path: relativePath });
    }
    if (options.expectedVersion === undefined && initial.version.exists && options.replace !== true) {
      throw typedError('OUTPUT_EXISTS', { path: relativePath });
    }

    const temporary = path.join(parent, `.${path.basename(target)}.open-cells-academy-${randomUUID()}.tmp`);
    let temporaryIdentity;
    let handle;
    let closeAttempted = false;
    let published = false;
    let operationFailure;
    const cleanupFailures = [];

    try {
      throwIfAborted(options.signal);
      handle = await this.#io.open(temporary, 'wx', 0o600);
      temporaryIdentity = await this.#statusOrAbsent(temporary);
      if (temporaryIdentity === undefined || !temporaryIdentity.isFile() || temporaryIdentity.isSymbolicLink()) {
        throw typedError('DOCUMENT_WRITE_FAILED', { path: relativePath });
      }
      await options.hooks?.beforeWrite?.({ temporary, target });
      throwIfAborted(options.signal);
      await handle.writeFile(content, 'utf8');
      await handle.sync();
      closeAttempted = true;
      await handle.close();
      handle = undefined;
      const currentParent = await this.#io.lstat(parent);
      if (!currentParent.isDirectory() || currentParent.isSymbolicLink() || !sameIdentity(currentParent, parentIdentity)) {
        throw typedError('PATH_CHANGED', { path: relativePath });
      }
      const current = await this.#captureVersioned(target, relativePath, { changed: true });
      if (!sameVersion(current.version, expected)) {
        throw typedError('PATH_CHANGED', { path: relativePath });
      }
      await options.hooks?.beforeRename?.({ temporary, target });
      throwIfAborted(options.signal);
      await this.#verifyTemporary(temporary, temporaryIdentity, relativePath);
      const parentImmediatelyBeforeRename = await this.#io.lstat(parent);
      if (
        !parentImmediatelyBeforeRename.isDirectory() ||
        parentImmediatelyBeforeRename.isSymbolicLink() ||
        !sameIdentity(parentImmediatelyBeforeRename, parentIdentity)
      ) {
        throw typedError('PATH_CHANGED', { path: relativePath });
      }
      const immediatelyBeforeRename = await this.#captureVersioned(target, relativePath, { changed: true });
      if (!sameVersion(immediatelyBeforeRename.version, expected)) {
        throw typedError('PATH_CHANGED', { path: relativePath });
      }
      await this.#verifyTemporary(temporary, temporaryIdentity, relativePath);
      await this.#io.rename(temporary, target);
      published = true;
    } catch (cause) {
      operationFailure = normalizeFailure(cause, 'DOCUMENT_WRITE_FAILED', { path: relativePath });
    } finally {
      if (handle !== undefined && !closeAttempted) {
        try {
          await handle.close();
        } catch (cause) {
          cleanupFailures.push(cause);
        }
      }
      if (!published && temporaryIdentity !== undefined) {
        try {
          await this.#removeExactTemporary(temporary, temporaryIdentity);
        } catch (cause) {
          cleanupFailures.push(cause);
        }
      }
    }

    if (operationFailure !== undefined && cleanupFailures.length > 0) {
      throw typedError(
        operationFailure.code,
        operationFailure.details,
        new AggregateError([operationFailure, ...cleanupFailures], 'Document write and cleanup failed')
      );
    }
    if (operationFailure !== undefined) {
      throw operationFailure;
    }
    if (cleanupFailures.length > 0) {
      throw typedError('DOCUMENT_WRITE_FAILED', { reason: 'TEMP_CLEANUP_FAILED' }, new AggregateError(cleanupFailures, 'Document cleanup failed'));
    }
  }
}
