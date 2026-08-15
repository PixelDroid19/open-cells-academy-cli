import {
  chmod,
  lstat,
  mkdir,
  mkdtemp,
  open,
  readFile,
  realpath,
  rename,
  rm,
  stat,
  writeFile
} from 'node:fs/promises';
import { constants as fsConstants } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { randomUUID } from 'node:crypto';

import { normalizeRelativePath } from '../../domain/path-policy.js';
import { ScaffoldPlan } from '../../domain/scaffold-plan.js';
import { hasSystemCode, typedError } from '../../domain/workspace-session.js';
import { FilesystemPort } from '../../ports/filesystem.js';

const MARKER = '.open-cells-academy-owned.json';
const SAFE_FILE_MODES = new Set([0o600, 0o640, 0o644, 0o700, 0o750, 0o755]);
const PROC_FD_ROOT = process.platform === 'linux' ? `/proc/${process.pid}/fd` : undefined;
const ROOT_ANCHOR_FLAGS = fsConstants.O_RDONLY | fsConstants.O_DIRECTORY | fsConstants.O_NOFOLLOW;

function throwIfAborted(signal) {
  if (signal?.aborted === true) {
    throw typedError('INTERRUPTED');
  }
}

function isSafeMode(mode) {
  return SAFE_FILE_MODES.has(mode);
}

function sameIdentity(left, right) {
  return left.dev === right.dev && left.ino === right.ino;
}

async function pathStatus(candidate) {
  try {
    return await lstat(candidate);
  } catch (cause) {
    if (hasSystemCode(cause, 'ENOENT')) {
      return undefined;
    }
    throw cause;
  }
}

function ownedName(kind, token) {
  return `.open-cells-academy-${kind}-${token}`;
}

async function readOwnedMarker(candidate, expected) {
  let contents;
  try {
    contents = await readFile(path.join(candidate, MARKER), 'utf8');
  } catch (cause) {
    if (hasSystemCode(cause, 'ENOENT')) {
      return false;
    }
    throw cause;
  }
  try {
    const marker = JSON.parse(contents);
    return marker?.schema === 1 && marker?.token === expected.token && marker?.kind === expected.kind;
  } catch {
    return false;
  }
}

async function createOwnedDirectory(parent, kind) {
  const token = randomUUID();
  const directory = await mkdtemp(path.join(parent, `${ownedName(kind, token)}-`));
  await writeFile(path.join(directory, MARKER), JSON.stringify({ schema: 1, kind, token }), { flag: 'wx', mode: 0o600 });
  const identity = await lstat(directory);
  return Object.freeze({ directory, kind, token, identity });
}

async function createOwnedBackup(parent) {
  const token = randomUUID();
  const directory = path.join(parent, ownedName('backup', token));
  await mkdir(directory, { recursive: false, mode: 0o700 });
  await writeFile(path.join(directory, MARKER), JSON.stringify({ schema: 1, kind: 'backup', token }), { flag: 'wx', mode: 0o600 });
  const identity = await lstat(directory);
  return Object.freeze({ directory, kind: 'backup', token, identity });
}

async function removeOwnedDirectory(owned) {
  if (owned === undefined) {
    return;
  }
  const current = await pathStatus(owned.directory);
  if (current === undefined) {
    return;
  }
  if (!current.isDirectory() || !sameIdentity(current, owned.identity) || !(await readOwnedMarker(owned.directory, owned))) {
    throw typedError('TRANSACTION_CLEANUP_FAILED');
  }
  await rm(owned.directory, { recursive: true, force: false, maxRetries: 2, retryDelay: 20 });
}

async function validatePlan(plan) {
  let snapshot;
  try {
    snapshot = ScaffoldPlan.snapshot(plan);
  } catch (cause) {
    if (cause?.code === 'PLAN_INVALID') {
      throw cause;
    }
    throw typedError('PLAN_INVALID', undefined, cause);
  }

  try {
    const directories = snapshot.directories.map(directory => normalizeRelativePath(directory).join('/'));
    const files = snapshot.files.map(file => {
      const normalizedPath = normalizeRelativePath(file.path).join('/');
      const byteContent = file.content instanceof Uint8Array;
      if (typeof file.content !== 'string' && !byteContent) {
        throw typedError('PLAN_INVALID');
      }
      if (file.mode !== undefined && !isSafeMode(file.mode)) {
        throw typedError('PLAN_INVALID');
      }
      return Object.freeze({
        path: normalizedPath,
        content: byteContent ? new Uint8Array(file.content) : file.content,
        mode: file.mode
      });
    });
    return Object.freeze({ directories: Object.freeze(directories), files: Object.freeze(files) });
  } catch (cause) {
    if (cause?.code === 'PLAN_INVALID') {
      throw cause;
    }
    throw typedError('PLAN_INVALID', undefined, cause);
  }
}

/**
 * Node implementation of the filesystem port. Every owned temporary tree has
 * a random token, marker and captured inode, so cleanup never follows a
 * same-name replacement.
 */
export class NodeFilesystem extends FilesystemPort {
  resolvePath(candidate) {
    return path.resolve(candidate);
  }

  joinPath(...parts) {
    return path.join(...parts);
  }

  async lstat(candidate) {
    return lstat(candidate);
  }

  async stat(candidate) {
    return stat(candidate);
  }

  async realpath(candidate) {
    return realpath(candidate);
  }

  async readFile(candidate, encoding = undefined) {
    return readFile(candidate, encoding);
  }

  isPathWithin(root, candidate) {
    const relative = path.relative(root, candidate);
    return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
  }

  async pathHasSymlink(candidate) {
    const resolved = path.resolve(candidate);
    const parsed = path.parse(resolved);
    const segments = resolved.slice(parsed.root.length).split(path.sep).filter(Boolean);
    let current = parsed.root;
    for (const segment of segments) {
      current = path.join(current, segment);
      const entry = await lstat(current);
      if (entry.isSymbolicLink()) {
        return true;
      }
    }
    return false;
  }

  async #hook(callback, details) {
    if (typeof callback === 'function') {
      await callback(details);
    }
  }

  async #captureParent(parent, anchoredBase) {
    let canonical;
    try {
      canonical = await realpath(parent);
    } catch (cause) {
      if (hasSystemCode(cause, 'ENOENT')) {
        throw typedError('DESTINATION_PARENT_MISSING');
      }
      throw typedError('DESTINATION_PARENT_INVALID', undefined, cause);
    }
    const identity = await lstat(canonical);
    if (!identity.isDirectory()) {
      throw typedError('DESTINATION_PARENT_INVALID');
    }
    const rootCanonical = await realpath(anchoredBase);
    if (!this.isPathWithin(rootCanonical, canonical)) {
      throw typedError('PATH_OUTSIDE_WORKSPACE');
    }
    return Object.freeze({ canonical, identity });
  }

  async #verifyParent(parent, captured, anchoredBase) {
    let canonical;
    try {
      canonical = await realpath(parent);
    } catch (cause) {
      throw typedError('PATH_CHANGED', undefined, cause);
    }
    let rootCanonical;
    try {
      rootCanonical = await realpath(anchoredBase);
    } catch (cause) {
      throw typedError('PATH_CHANGED', undefined, cause);
    }
    if (!this.isPathWithin(rootCanonical, canonical)) {
      throw typedError('PATH_OUTSIDE_WORKSPACE');
    }
    const identity = await lstat(canonical);
    if (!identity.isDirectory() || canonical !== captured.canonical || !sameIdentity(identity, captured.identity)) {
      throw typedError('PATH_CHANGED');
    }
    return canonical;
  }

  /**
   * Opens the workspace root with `O_RDONLY | O_DIRECTORY | O_NOFOLLOW` and
   * verifies the descriptor still refers to the session's immutable root
   * identity. The returned handle anchors every stage, write, backup, rename
   * and cleanup path through `/proc/<pid>/fd/<fd>` so a same-path root
   * replacement can never redirect the transaction. Platforms without the
   * proc descriptor namespace fail closed instead of falling back to mutable
   * pathname operations. The caller owns the handle for the whole transaction
   * and must close it.
   */
  async #openRootAnchor(session) {
    if (PROC_FD_ROOT === undefined) {
      throw typedError('WORKSPACE_ANCHOR_UNSUPPORTED');
    }
    const rootIdentity = session.rootIdentity;
    if (rootIdentity === undefined || typeof rootIdentity.dev !== 'number' || typeof rootIdentity.ino !== 'number') {
      throw typedError('WORKSPACE_ANCHOR_UNSUPPORTED');
    }
    let handle;
    try {
      handle = await open(session.root, ROOT_ANCHOR_FLAGS);
    } catch (cause) {
      throw typedError('PATH_CHANGED', undefined, cause);
    }
    let anchorStat;
    try {
      anchorStat = await handle.stat();
    } catch (cause) {
      await handle.close().catch(() => undefined);
      throw typedError('PATH_CHANGED', undefined, cause);
    }
    if (!anchorStat.isDirectory() || anchorStat.isSymbolicLink() || !sameIdentity(anchorStat, rootIdentity)) {
      await handle.close().catch(() => undefined);
      throw typedError('PATH_CHANGED');
    }
    return Object.freeze({ handle, base: `${PROC_FD_ROOT}/${handle.fd}`, identity: rootIdentity });
  }

  /**
   * Confirms the logical root path still resolves to the anchored identity
   * before reporting success. A renamed or replaced root fails closed so the
   * caller never receives a destination whose pathname no longer points at the
   * anchored workspace inode.
   */
  async #verifyRootLogicalPath(session, anchor) {
    let current;
    try {
      current = await lstat(session.root);
    } catch (cause) {
      throw typedError('PATH_CHANGED', undefined, cause);
    }
    if (current.isSymbolicLink() || !current.isDirectory() || !sameIdentity(current, anchor.identity)) {
      throw typedError('PATH_CHANGED');
    }
  }

  async #writePlan(staging, snapshot, signal, hooks, logicalStaging) {
    const hookStaging = logicalStaging ?? staging.directory;
    for (const directory of snapshot.directories) {
      throwIfAborted(signal);
      await mkdir(path.join(staging.directory, directory), { recursive: true });
      await this.#hook(hooks?.onDirectory, { staging: hookStaging, directory });
    }
    for (const file of snapshot.files) {
      throwIfAborted(signal);
      const target = path.join(staging.directory, file.path);
      await mkdir(path.dirname(target), { recursive: true });
      const hookTarget = logicalStaging === undefined ? target : path.join(logicalStaging, file.path);
      await this.#hook(hooks?.beforeWrite, { staging: hookStaging, file, target: hookTarget });
      throwIfAborted(signal);
      await writeFile(target, file.content, { flag: 'wx' });
      if (file.mode !== undefined) {
        await chmod(target, file.mode);
      }
      await this.#hook(hooks?.afterWrite, { staging: hookStaging, file, target: hookTarget });
    }
  }

  async #rollback({ target, targetIdentity, backup, parent, hooks }) {
    try {
      await this.#hook(hooks?.beforeRollbackRestore, { target, backup: backup?.directory });
      if (backup !== undefined) {
        const currentTarget = await pathStatus(target);
        if (currentTarget !== undefined) {
          if (!currentTarget.isDirectory() || !sameIdentity(currentTarget, targetIdentity)) {
            throw typedError('TRANSACTION_ROLLBACK_FAILED');
          }
          await rm(target, { recursive: true, force: true });
        }
        const currentBackup = await pathStatus(backup.directory);
        const previous = await pathStatus(backup.previous);
        if (
          currentBackup === undefined ||
          !currentBackup.isDirectory() ||
          !sameIdentity(currentBackup, backup.identity) ||
          previous === undefined ||
          !previous.isDirectory() ||
          !sameIdentity(previous, backup.previousIdentity)
        ) {
          throw typedError('TRANSACTION_ROLLBACK_FAILED');
        }
        await rename(backup.previous, target);
        await removeOwnedDirectory(backup);
        return undefined;
      }
      const currentTarget = await pathStatus(target);
      if (currentTarget !== undefined) {
        if (!currentTarget.isDirectory() || !sameIdentity(currentTarget, targetIdentity)) {
          throw typedError('TRANSACTION_ROLLBACK_FAILED');
        }
        await rm(target, { recursive: true, force: true });
      }
      return undefined;
    } catch (cause) {
      if (cause?.code === 'TRANSACTION_ROLLBACK_FAILED') {
        throw cause;
      }
      throw typedError('TRANSACTION_ROLLBACK_FAILED', undefined, cause);
    }
  }

  async applyPlanAtomically(session, plan, destination, options = {}) {
    const snapshot = await validatePlan(plan);
    const destinationSegments = normalizeRelativePath(destination);
    const anchor = await this.#openRootAnchor(session);
    const anchoredBase = anchor.base;
    const target = path.join(anchoredBase, ...destinationSegments);
    const parent = destinationSegments.length === 1
      ? anchoredBase
      : path.join(anchoredBase, ...destinationSegments.slice(0, -1));
    const logicalTarget = path.join(session.root, ...destinationSegments);
    const logicalFromAnchored = anchoredPath => path.join(session.root, path.relative(anchoredBase, anchoredPath));

    let staging;
    let backup;
    let publishedIdentity;
    let failure;
    let preserveBackup = false;
    try {
      const capturedParent = await this.#captureParent(parent, anchoredBase);
      const initialTarget = await pathStatus(target);
      if (initialTarget !== undefined) {
        let targetCanonical;
        try {
          targetCanonical = await realpath(target);
        } catch (cause) {
          throw typedError('PATH_CHANGED', undefined, cause);
        }
        const rootCanonical = await realpath(anchoredBase);
        if (!this.isPathWithin(rootCanonical, targetCanonical)) {
          throw typedError('PATH_OUTSIDE_WORKSPACE');
        }
      }
      if (initialTarget !== undefined && options.replace !== true) {
        throw typedError('OUTPUT_EXISTS');
      }
      if (initialTarget !== undefined && options.replace === true && (!initialTarget.isDirectory() || initialTarget.isSymbolicLink())) {
        throw typedError('DESTINATION_INVALID');
      }
      throwIfAborted(options.signal);

      await this.#verifyParent(parent, capturedParent, anchoredBase);
      staging = await createOwnedDirectory(parent, 'stage');
      const logicalStaging = logicalFromAnchored(staging.directory);
      await this.#hook(options.hooks?.onStagingCreated, { staging: logicalStaging, destination: logicalTarget });
      await this.#writePlan(staging, snapshot, options.signal, options.hooks, logicalStaging);
      throwIfAborted(options.signal);
      await this.#hook(options.hooks?.beforePublish, { staging: logicalStaging, destination: logicalTarget });
      throwIfAborted(options.signal);
      await this.#verifyParent(parent, capturedParent, anchoredBase);

      if (initialTarget !== undefined) {
        backup = await createOwnedBackup(parent);
        await this.#hook(options.hooks?.beforeBackupRename, { destination: logicalTarget, backup: logicalFromAnchored(backup.directory) });
        await this.#verifyParent(parent, capturedParent, anchoredBase);
        const currentTarget = await pathStatus(target);
        if (
          currentTarget === undefined ||
          !currentTarget.isDirectory() ||
          currentTarget.isSymbolicLink() ||
          !sameIdentity(currentTarget, initialTarget)
        ) {
          throw typedError('PATH_CHANGED');
        }
        const backupTarget = path.join(backup.directory, 'previous');
        await rename(target, backupTarget);
        backup = Object.freeze({ ...backup, previous: backupTarget, previousIdentity: initialTarget });
      }

      await this.#verifyParent(parent, capturedParent, anchoredBase);
      await this.#hook(options.hooks?.beforePublishRename, { staging: logicalStaging, destination: logicalTarget, backup: backup === undefined ? undefined : logicalFromAnchored(backup.directory) });
      throwIfAborted(options.signal);
      await rename(staging.directory, target);
      publishedIdentity = await lstat(target);
      if (!sameIdentity(publishedIdentity, staging.identity)) {
        throw typedError('PATH_CHANGED');
      }
      await this.#verifyRootLogicalPath(session, anchor);
      await rm(path.join(target, MARKER), { force: false });
      staging = undefined;
      await this.#hook(options.hooks?.afterPublish, { destination: logicalTarget, backup: backup === undefined ? undefined : logicalFromAnchored(backup.directory) });
      throwIfAborted(options.signal);
      if (backup !== undefined) {
        await removeOwnedDirectory(backup).catch(cause => {
          throw typedError('TRANSACTION_CLEANUP_FAILED', undefined, cause);
        });
        backup = undefined;
      }
      return Object.freeze({ destination: logicalTarget });
    } catch (cause) {
      failure = cause;
      if (publishedIdentity !== undefined) {
        try {
          backup = await this.#rollback({ target, targetIdentity: publishedIdentity, backup, parent, hooks: options.hooks });
        } catch (rollbackCause) {
          preserveBackup = backup !== undefined;
          throw rollbackCause;
        }
      } else if (backup?.previous !== undefined) {
        try {
          const currentBackup = await pathStatus(backup.previous);
          if (currentBackup !== undefined) {
            await rename(backup.previous, target);
            await removeOwnedDirectory(backup);
            backup = undefined;
          }
        } catch (rollbackCause) {
          throw typedError('TRANSACTION_ROLLBACK_FAILED', undefined, rollbackCause);
        }
      }
      if (cause?.code === 'INTERRUPTED') {
        throw cause;
      }
      if (['OUTPUT_EXISTS', 'PATH_INVALID', 'PATH_OUTSIDE_WORKSPACE', 'PATH_CHANGED', 'DESTRUCTIVE_ROOT', 'DESTINATION_INVALID', 'DESTINATION_PARENT_MISSING', 'DESTINATION_PARENT_INVALID', 'PLAN_INVALID'].includes(cause?.code)) {
        throw cause;
      }
      throw typedError('TRANSACTION_FAILED', undefined, cause);
    } finally {
      try {
        const cleanupFailures = [];
        for (const owned of [staging, backup]) {
          if (owned === backup && preserveBackup) {
            continue;
          }
          try {
            await removeOwnedDirectory(owned);
          } catch (cause) {
            cleanupFailures.push(cause);
          }
        }
        if (cleanupFailures.length > 0) {
          throw typedError('TRANSACTION_CLEANUP_FAILED', undefined, cleanupFailures[0]);
        }
      } finally {
        await anchor.handle.close().catch(() => undefined);
      }
    }
  }
}
