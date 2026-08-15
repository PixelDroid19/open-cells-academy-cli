import { lstat, mkdir, readdir, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

import { PathPolicy, normalizeRelativePath } from '../../domain/path-policy.js';
import { typedError } from '../../domain/workspace-session.js';

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function normalizeName(value, code) {
  if (typeof value !== 'string' || value.length === 0) throw typedError(code);
  return normalizeRelativePath(value).join('/');
}

function sameIdentity(left, right) {
  return left.dev === right.dev && left.ino === right.ino;
}

async function pathStatus(candidate) {
  try {
    return await lstat(candidate);
  } catch (cause) {
    if (cause?.code === 'ENOENT') return undefined;
    throw cause;
  }
}

/**
 * Publishes a single documentation file atomically with an owned backup. The
 * target must be a workspace-contained regular-file path (or absent); a
 * same-name symlink or non-regular target is rejected. On any failure the
 * previous target is restored and owned temporaries are removed by identity.
 */
export class DocsWriter {
  #session;
  #filesystem;

  constructor(session, filesystem) {
    if (!isRecord(session) || typeof session.root !== 'string' || !path.isAbsolute(session.root)) throw typedError('WORKSPACE_INVALID');
    if (filesystem === null || typeof filesystem !== 'object' || typeof filesystem.lstat !== 'function' || typeof filesystem.realpath !== 'function' || typeof filesystem.isPathWithin !== 'function' || typeof filesystem.joinPath !== 'function') {
      throw typedError('DOC_FILESYSTEM_INVALID');
    }
    this.#session = session;
    this.#filesystem = filesystem;
    Object.freeze(this);
  }

  async validateTarget(target) {
    const policy = new PathPolicy(this.#session, this.#filesystem);
    const normalized = normalizeName(target, 'DOC_REQUEST_INVALID');
    const resolved = await policy.resolveWrite(normalized);
    if (resolved === this.#session.root) throw typedError('DESTRUCTIVE_ROOT');
    return resolved;
  }

  async exists(target) {
    const policy = new PathPolicy(this.#session, this.#filesystem);
    const normalized = normalizeName(target, 'DOC_REQUEST_INVALID');
    try {
      await policy.resolveRead(normalized);
      return true;
    } catch (cause) {
      if (cause?.code === 'PATH_NOT_FOUND' || cause?.code === 'PATH_INVALID') return false;
      throw cause;
    }
  }

  async write(target, content, { replace }) {
    const policy = new PathPolicy(this.#session, this.#filesystem);
    const normalized = normalizeName(target, 'DOC_REQUEST_INVALID');
    const segments = normalizeRelativePath(normalized);
    const parentName = path.dirname(normalized);
    const parent = parentName === '.' || parentName === '' ? this.#session.root : path.join(this.#session.root, ...normalizeRelativePath(parentName));
    const requested = path.join(this.#session.root, ...segments);
    const finalTarget = await policy.resolveWrite(normalized);
    if (finalTarget === this.#session.root) throw typedError('DESTRUCTIVE_ROOT');

    let parentStatus;
    let createdParent = false;
    try {
      parentStatus = await lstat(parent);
    } catch (cause) {
      if (cause?.code === 'ENOENT') {
        await mkdir(parent, { recursive: false });
        createdParent = true;
        parentStatus = await lstat(parent);
      } else {
        throw typedError('DOC_DEST_INVALID', { target: normalized }, cause);
      }
    }
    if (!parentStatus.isDirectory() || parentStatus.isSymbolicLink()) throw typedError('DOC_DEST_INVALID', { target: normalized });

    const existing = await pathStatus(requested);
    if (existing !== undefined && replace !== true) throw typedError('OUTPUT_EXISTS', { target: normalized });
    if (existing !== undefined && (!existing.isFile() || existing.isSymbolicLink())) throw typedError('DOC_DEST_INVALID', { target: normalized });

    const token = randomUUID();
    const stagingName = `.open-cells-academy-doc-${token}.tmp`;
    const backupName = `.open-cells-academy-doc-${token}.bak`;
    const staging = path.join(parent, stagingName);
    const backup = path.join(parent, backupName);

    try {
      await writeFile(staging, content, { flag: 'wx', mode: 0o600 });
      if (existing !== undefined) {
        await rename(requested, backup);
      }
      try {
        await rename(staging, requested);
      } catch (cause) {
        if (existing !== undefined) {
          const backupStatus = await pathStatus(backup);
          if (backupStatus !== undefined && backupStatus.isFile()) {
            await rename(backup, requested);
          }
        }
        throw typedError('DOC_PUBLISH_FAILED', { target: normalized }, cause);
      }
      if (existing !== undefined) {
        const backupStatus = await pathStatus(backup);
        if (backupStatus !== undefined && backupStatus.isFile() && !backupStatus.isSymbolicLink()) {
          await rm(backup, { force: false });
        }
      }
      return Object.freeze({ destination: finalTarget });
    } catch (cause) {
      const cleanupFailures = [];
      for (const candidate of [staging, backup]) {
        const current = await pathStatus(candidate);
        if (current !== undefined) {
          try {
            await rm(candidate, { force: false });
          } catch (cleanupCause) {
            cleanupFailures.push(cleanupCause);
          }
        }
      }
      if (cause?.code === 'DOC_PUBLISH_FAILED' || cause?.code === 'OUTPUT_EXISTS' || cause?.code === 'DOC_DEST_INVALID' || cause?.code === 'DESTRUCTIVE_ROOT') {
        throw cause;
      }
      if (cleanupFailures.length > 0) {
        throw typedError('TRANSACTION_CLEANUP_FAILED', undefined, cleanupFailures[0]);
      }
      throw typedError('DOC_PUBLISH_FAILED', { target: normalized }, cause);
    } finally {
      if (createdParent) {
        try {
          if ((await readdir(parent)).length === 0) await rm(parent, { recursive: false });
        } catch {}
      }
    }
  }
}
