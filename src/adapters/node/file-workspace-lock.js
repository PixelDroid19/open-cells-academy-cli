import { lstat, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

import { hasSystemCode, typedError } from '../../domain/workspace-session.js';
import { WorkspaceLockPort } from '../../ports/workspace-lock.js';

const OWNER_SCHEMA = 1;
const CLAIM_SCHEMA = 1;
const MAX_RECLAIM_ATTEMPTS = 6;
const MAX_CLAIM_WAIT_ATTEMPTS = 4;
const OWNER_FILE = 'owner.json';
const CLAIM_DIRECTORY = '.claim';
const CLAIM_FILE = 'claim.json';

function throwIfAborted(signal) {
  if (signal?.aborted === true) {
    throw typedError('INTERRUPTED');
  }
}

function pause(milliseconds) {
  return new Promise(resolve => setTimeout(resolve, milliseconds));
}

function sameIdentity(left, right) {
  return left.dev === right.dev && left.ino === right.ino;
}

function collisionCode(error) {
  return error?.code === 'EEXIST' || error?.code === 'ENOTEMPTY' || error?.code === 'EPERM';
}

function assertOperation(operation) {
  if (
    typeof operation !== 'string' ||
    operation.length === 0 ||
    operation.trim() !== operation ||
    /[\u0000-\u001f\u007f/\\]/.test(operation) ||
    operation === '.' ||
    operation === '..'
  ) {
    throw typedError('LOCK_OPERATION_INVALID');
  }
}

function isUuid(value) {
  return typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function ownerIsTrusted(record, session, operation) {
  return (
    record !== null &&
    typeof record === 'object' &&
    !Array.isArray(record) &&
    record.schema === OWNER_SCHEMA &&
    isUuid(record.token) &&
    Number.isInteger(record.pid) &&
    record.pid > 0 &&
    typeof record.startIdentity === 'string' &&
    record.startIdentity.length > 0 &&
    record.operation === operation &&
    record.workspace === session.root &&
    typeof record.createdAt === 'string' &&
    Number.isFinite(Date.parse(record.createdAt))
  );
}

function claimIsTrusted(record, session, operation) {
  return (
    record !== null &&
    typeof record === 'object' &&
    !Array.isArray(record) &&
    record.schema === CLAIM_SCHEMA &&
    isUuid(record.token) &&
    isUuid(record.expectedOwnerToken) &&
    Number.isInteger(record.pid) &&
    record.pid > 0 &&
    typeof record.startIdentity === 'string' &&
    record.startIdentity.length > 0 &&
    typeof record.createdAt === 'string' &&
    Number.isFinite(Date.parse(record.createdAt))
  );
}

function lockDirectoryName(operation) {
  return `.open-cells-academy-lock-${encodeURIComponent(operation)}`;
}

function stageDirectoryName() {
  return `.open-cells-academy-lock-stage-${randomUUID()}`;
}

function retiredDirectoryName(operation, token) {
  return `.open-cells-academy-lock-retired-${encodeURIComponent(operation)}-${token}-${randomUUID()}`;
}

async function optionalStat(candidate) {
  try {
    return await lstat(candidate);
  } catch (cause) {
    if (hasSystemCode(cause, 'ENOENT')) {
      return undefined;
    }
    throw cause;
  }
}

async function processStartIdentity(pid) {
  try {
    const processStat = await readFile(`/proc/${pid}/stat`, 'utf8');
    const closeParenthesis = processStat.lastIndexOf(')');
    const fields = processStat.slice(closeParenthesis + 2).trim().split(/\s+/);
    const startIdentity = fields[19];
    return typeof startIdentity === 'string' && /^\d+$/.test(startIdentity) ? startIdentity : undefined;
  } catch (cause) {
    if (hasSystemCode(cause, 'ENOENT')) {
      return undefined;
    }
    throw cause;
  }
}

function processIsAbsent(pid) {
  try {
    process.kill(pid, 0);
    return false;
  } catch (cause) {
    if (cause?.code === 'ESRCH') {
      return true;
    }
    if (cause?.code === 'EPERM') {
      return false;
    }
    throw cause;
  }
}

async function defaultIdentity() {
  return Object.freeze({ pid: process.pid, startIdentity: (await processStartIdentity(process.pid)) ?? `unknown-${process.pid}` });
}

class FileLockHandle {
  #abortListener;
  #adapter;
  #identity;
  #lockIdentity;
  #path;
  #record;
  #released = false;
  #releasePromise;
  #signal;

  constructor({ adapter, identity, lockIdentity, path: lockPath, record, signal }) {
    this.#adapter = adapter;
    this.#identity = identity;
    this.#lockIdentity = lockIdentity;
    this.#path = lockPath;
    this.#record = Object.freeze({ ...record });
    this.#signal = signal;
    this.#abortListener = () => {
      void this.release().catch(() => undefined);
    };
    signal?.addEventListener('abort', this.#abortListener, { once: true });
    Object.freeze(this);
  }

  get path() {
    return this.#path;
  }

  get record() {
    return this.#record;
  }

  async release() {
    if (this.#released) {
      return;
    }
    if (this.#releasePromise !== undefined) {
      return this.#releasePromise;
    }
    this.#releasePromise = (async () => {
      try {
        await this.#adapter.releaseOwned({
          identity: this.#identity,
          lockIdentity: this.#lockIdentity,
          lockPath: this.#path,
          record: this.#record
        });
        this.#released = true;
      } finally {
        if (this.#released || this.#signal?.aborted) {
          this.#signal?.removeEventListener('abort', this.#abortListener);
        }
        this.#releasePromise = undefined;
      }
    })();
    return this.#releasePromise;
  }
}

/**
 * Filesystem lock keyed by canonical workspace and operation. A fixed,
 * nonempty directory is the lock. Owners and claims are immutable files; no
 * path is unlinked based on a read-then-delete decision.
 */
export class FileWorkspaceLock extends WorkspaceLockPort {
  #configuredIdentity;
  #filesystem;

  constructor({ filesystem, processIdentity = undefined } = {}) {
    super();
    if (filesystem === null || typeof filesystem !== 'object' || typeof filesystem.joinPath !== 'function' || typeof filesystem.readFile !== 'function') {
      throw typedError('LOCK_FILESYSTEM_INVALID');
    }
    if (
      processIdentity !== undefined &&
      (processIdentity === null || !Number.isInteger(processIdentity.pid) || processIdentity.pid <= 0 || typeof processIdentity.startIdentity !== 'string' || processIdentity.startIdentity.length === 0)
    ) {
      throw typedError('LOCK_PROCESS_IDENTITY_INVALID');
    }
    this.#filesystem = filesystem;
    this.#configuredIdentity = processIdentity === undefined ? undefined : Object.freeze({ ...processIdentity });
    Object.freeze(this);
  }

  pathFor(session, operation) {
    assertOperation(operation);
    if (session === null || typeof session !== 'object' || typeof session.root !== 'string' || session.root.length === 0) {
      throw typedError('WORKSPACE_INVALID');
    }
    return this.#filesystem.joinPath(session.root, lockDirectoryName(operation));
  }

  async #identity() {
    return this.#configuredIdentity ?? defaultIdentity();
  }

  async #readJson(candidate, invalidCode) {
    let entry;
    try {
      entry = await lstat(candidate);
    } catch (cause) {
      if (hasSystemCode(cause, 'ENOENT')) {
        return undefined;
      }
      throw typedError(invalidCode, undefined, cause);
    }
    if (!entry.isFile() || entry.isSymbolicLink()) {
      throw typedError(invalidCode);
    }
    let contents;
    try {
      contents = await this.#filesystem.readFile(candidate, 'utf8');
    } catch (cause) {
      if (hasSystemCode(cause, 'ENOENT')) {
        return undefined;
      }
      throw typedError(invalidCode, undefined, cause);
    }
    try {
      return JSON.parse(contents);
    } catch {
      throw typedError(invalidCode);
    }
  }

  async #readOwner(lockPath, session, operation) {
    const owner = await this.#readJson(path.join(lockPath, OWNER_FILE), 'WORKSPACE_LOCK_INVALID');
    if (owner === undefined || !ownerIsTrusted(owner, session, operation)) {
      throw typedError('WORKSPACE_LOCK_INVALID');
    }
    return Object.freeze(owner);
  }

  async #readClaim(lockPath, session, operation) {
    const claimPath = path.join(lockPath, CLAIM_DIRECTORY);
    const identity = await optionalStat(claimPath);
    if (identity === undefined) {
      return undefined;
    }
    if (!identity.isDirectory() || identity.isSymbolicLink()) {
      throw typedError('WORKSPACE_LOCK_CLAIM_INCOMPLETE');
    }
    const claim = await this.#readJson(path.join(claimPath, CLAIM_FILE), 'WORKSPACE_LOCK_CLAIM_INCOMPLETE');
    if (claim === undefined || !claimIsTrusted(claim, session, operation)) {
      throw typedError('WORKSPACE_LOCK_CLAIM_INCOMPLETE');
    }
    return Object.freeze({ path: claimPath, identity, record: Object.freeze(claim) });
  }

  async #observe(lockPath, session, operation) {
    const identity = await optionalStat(lockPath);
    if (identity === undefined) {
      return Object.freeze({ state: 'absent' });
    }
    if (!identity.isDirectory() || identity.isSymbolicLink()) {
      throw typedError('WORKSPACE_LOCK_INVALID');
    }
    const claim = await this.#readClaim(lockPath, session, operation);
    if (claim !== undefined) {
      return Object.freeze({ state: 'claimed', claim, identity });
    }
    const owner = await this.#readOwner(lockPath, session, operation);
    return Object.freeze({ state: 'owner', identity, owner });
  }

  async #ownerState(owner) {
    let observedStart;
    try {
      observedStart = await processStartIdentity(owner.pid);
    } catch (cause) {
      throw typedError('WORKSPACE_LOCK_INVALID', undefined, cause);
    }
    if (observedStart !== undefined && observedStart !== owner.startIdentity) {
      return 'stale';
    }
    if (observedStart === undefined && processIsAbsent(owner.pid)) {
      return 'stale';
    }
    return 'live';
  }

  async #createStaging(parent, record) {
    for (let attempt = 0; attempt < MAX_RECLAIM_ATTEMPTS; attempt += 1) {
      const directory = path.join(parent, stageDirectoryName());
      try {
        await mkdir(directory, { mode: 0o700 });
      } catch (cause) {
        if (collisionCode(cause)) {
          continue;
        }
        throw typedError('WORKSPACE_LOCK_ACQUIRE_FAILED', undefined, cause);
      }
      try {
        await writeFile(path.join(directory, OWNER_FILE), JSON.stringify(record), { flag: 'wx', mode: 0o400 });
        return Object.freeze({ path: directory, identity: await lstat(directory), record });
      } catch (cause) {
        await rm(directory, { recursive: true, force: true }).catch(() => undefined);
        throw typedError('WORKSPACE_LOCK_ACQUIRE_FAILED', undefined, cause);
      }
    }
    throw typedError('WORKSPACE_LOCK_ACQUIRE_FAILED');
  }

  async #removeOwnedDirectory(directory, identity, expectedOwner) {
    const current = await optionalStat(directory);
    if (current === undefined) {
      return;
    }
    if (!current.isDirectory() || current.isSymbolicLink() || !sameIdentity(current, identity)) {
      throw typedError('WORKSPACE_LOCK_CLEANUP_FAILED');
    }
    const owner = await this.#readJson(path.join(directory, OWNER_FILE), 'WORKSPACE_LOCK_CLEANUP_FAILED');
    if (owner?.token !== expectedOwner.token) {
      throw typedError('WORKSPACE_LOCK_CLEANUP_FAILED');
    }
    await rm(directory, { recursive: true, force: false, maxRetries: 2, retryDelay: 20 });
  }

  async #removeRetiredDirectory(retiredPath, retiredIdentity, expectedOwner, expectedClaim) {
    const current = await optionalStat(retiredPath);
    if (current === undefined || !current.isDirectory() || current.isSymbolicLink() || !sameIdentity(current, retiredIdentity)) {
      throw typedError('WORKSPACE_LOCK_CLEANUP_FAILED');
    }
    const owner = await this.#readJson(path.join(retiredPath, OWNER_FILE), 'WORKSPACE_LOCK_CLEANUP_FAILED');
    if (owner?.token !== expectedOwner.token) {
      throw typedError('WORKSPACE_LOCK_CLEANUP_FAILED');
    }
    const claimPath = path.join(retiredPath, CLAIM_DIRECTORY);
    const claimIdentity = await optionalStat(claimPath);
    if (claimIdentity === undefined || !claimIdentity.isDirectory() || !sameIdentity(claimIdentity, expectedClaim.identity)) {
      throw typedError('WORKSPACE_LOCK_CLEANUP_FAILED');
    }
    const claim = await this.#readJson(path.join(claimPath, CLAIM_FILE), 'WORKSPACE_LOCK_CLEANUP_FAILED');
    if (claim?.token !== expectedClaim.record.token || claim.expectedOwnerToken !== expectedOwner.token) {
      throw typedError('WORKSPACE_LOCK_CLEANUP_FAILED');
    }
    await rm(retiredPath, { recursive: true, force: false, maxRetries: 2, retryDelay: 20 });
  }

  async #removeOwnClaim(lockPath, lockIdentity, claim, session, operation) {
    const currentLock = await optionalStat(lockPath);
    if (currentLock === undefined) {
      return;
    }
    if (!currentLock.isDirectory() || !sameIdentity(currentLock, lockIdentity)) {
      throw typedError('WORKSPACE_LOCK_CLEANUP_FAILED');
    }
    const currentClaim = await this.#readClaim(lockPath, session, operation);
    if (currentClaim === undefined) {
      return;
    }
    if (!sameIdentity(currentClaim.identity, claim.identity) || currentClaim.record.token !== claim.record.token) {
      throw typedError('WORKSPACE_LOCK_CLEANUP_FAILED');
    }
    await rm(claim.path, { recursive: true, force: false, maxRetries: 2, retryDelay: 20 });
  }

  async #waitForClaim(lockPath, session, operation, signal) {
    for (let attempt = 0; attempt < MAX_CLAIM_WAIT_ATTEMPTS; attempt += 1) {
      throwIfAborted(signal);
      const observed = await this.#observe(lockPath, session, operation);
      if (observed.state !== 'claimed') {
        return observed;
      }
      await pause(5);
    }
    throw typedError('WORKSPACE_LOCK_CLAIMED');
  }

  async #claimAndRetire({ identity, lockIdentity, lockPath, operation, record: expectedOwner, session, signal }) {
    throwIfAborted(signal);
    const currentLock = await optionalStat(lockPath);
    if (currentLock === undefined) {
      return Object.freeze({ state: 'absent' });
    }
    if (!currentLock.isDirectory() || !sameIdentity(currentLock, lockIdentity)) {
      return Object.freeze({ state: 'changed' });
    }
    const claimPath = path.join(lockPath, CLAIM_DIRECTORY);
    try {
      await mkdir(claimPath, { mode: 0o700 });
    } catch (cause) {
      if (collisionCode(cause)) {
        return Object.freeze({ state: 'claimed' });
      }
      throw typedError('WORKSPACE_LOCK_RECLAIM_FAILED', undefined, cause);
    }
    const claimRecord = Object.freeze({
      schema: CLAIM_SCHEMA,
      token: randomUUID(),
      expectedOwnerToken: expectedOwner.token,
      pid: identity.pid,
      startIdentity: identity.startIdentity,
      operation,
      workspace: session.root,
      createdAt: new Date().toISOString()
    });
    let claim;
    try {
      await writeFile(path.join(claimPath, CLAIM_FILE), JSON.stringify(claimRecord), { flag: 'wx', mode: 0o400 });
      claim = Object.freeze({ path: claimPath, identity: await lstat(claimPath), record: claimRecord });
      const observedOwner = await this.#readOwner(lockPath, session, operation);
      const observedLock = await optionalStat(lockPath);
      if (observedOwner.token !== expectedOwner.token || observedLock === undefined || !sameIdentity(observedLock, lockIdentity)) {
        await this.#removeOwnClaim(lockPath, lockIdentity, claim, session, operation);
        return Object.freeze({ state: 'changed' });
      }
      throwIfAborted(signal);
      const retiredPath = path.join(path.dirname(lockPath), retiredDirectoryName(operation, claimRecord.token));
      await rename(lockPath, retiredPath);
      const retiredIdentity = await lstat(retiredPath);
      if (!sameIdentity(retiredIdentity, lockIdentity)) {
        throw typedError('WORKSPACE_LOCK_RECLAIM_FAILED');
      }
      await this.#removeRetiredDirectory(retiredPath, retiredIdentity, expectedOwner, claim);
      return Object.freeze({ state: 'retired' });
    } catch (cause) {
      if (claim !== undefined) {
        try {
          await this.#removeOwnClaim(lockPath, lockIdentity, claim, session, operation);
        } catch (cleanupCause) {
          throw cleanupCause;
        }
      }
      if (cause?.code === 'INTERRUPTED' || cause?.code?.startsWith('WORKSPACE_LOCK_')) {
        throw cause;
      }
      throw typedError('WORKSPACE_LOCK_RECLAIM_FAILED', undefined, cause);
    }
  }

  async #releaseOwned({ identity, lockIdentity, lockPath, record }) {
    const session = Object.freeze({ root: record.workspace });
    for (let attempt = 0; attempt < MAX_RECLAIM_ATTEMPTS; attempt += 1) {
      const observed = await this.#observe(lockPath, session, record.operation);
      if (observed.state === 'absent') {
        return;
      }
      if (observed.state === 'claimed') {
        await this.#waitForClaim(lockPath, session, record.operation);
        continue;
      }
      if (observed.owner.token !== record.token) {
        return;
      }
      if (!sameIdentity(observed.identity, lockIdentity)) {
        throw typedError('WORKSPACE_LOCK_RELEASE_FAILED');
      }
      const result = await this.#claimAndRetire({
        identity,
        lockIdentity,
        lockPath,
        operation: record.operation,
        record,
        session
      });
      if (result.state === 'retired' || result.state === 'absent' || result.state === 'changed') {
        return;
      }
      if (result.state === 'claimed') {
        await this.#waitForClaim(lockPath, session, record.operation);
      }
    }
    throw typedError('WORKSPACE_LOCK_RELEASE_FAILED');
  }

  async releaseOwned(details) {
    return this.#releaseOwned(details);
  }

  async acquire(session, operation, signal = undefined) {
    assertOperation(operation);
    throwIfAborted(signal);
    const lockPath = this.pathFor(session, operation);
    const identity = await this.#identity();
    const record = Object.freeze({
      schema: OWNER_SCHEMA,
      token: randomUUID(),
      pid: identity.pid,
      startIdentity: identity.startIdentity,
      operation,
      workspace: session.root,
      createdAt: new Date().toISOString()
    });
    const parent = path.dirname(lockPath);

    for (let attempt = 0; attempt < MAX_RECLAIM_ATTEMPTS; attempt += 1) {
      throwIfAborted(signal);
      const staging = await this.#createStaging(parent, record);
      try {
        const beforePublish = await optionalStat(lockPath);
        if (beforePublish !== undefined) {
          throw Object.assign(new Error('lock exists'), { code: 'EEXIST' });
        }
        await rename(staging.path, lockPath);
        const lockIdentity = await lstat(lockPath);
        if (!sameIdentity(lockIdentity, staging.identity)) {
          throw typedError('WORKSPACE_LOCK_ACQUIRE_FAILED');
        }
        const handle = new FileLockHandle({ adapter: this, identity, lockIdentity, path: lockPath, record, signal });
        if (signal?.aborted) {
          await handle.release();
          throw typedError('INTERRUPTED');
        }
        return handle;
      } catch (cause) {
        try {
          await this.#removeOwnedDirectory(staging.path, staging.identity, Object.freeze({ ...record, session, operation }));
        } catch (cleanupCause) {
          throw cleanupCause;
        }
        if (!collisionCode(cause)) {
          if (cause?.code?.startsWith('WORKSPACE_LOCK_') || cause?.code === 'INTERRUPTED') {
            throw cause;
          }
          throw typedError('WORKSPACE_LOCK_ACQUIRE_FAILED', undefined, cause);
        }
      }

      let observed = await this.#observe(lockPath, session, operation);
      if (observed.state === 'claimed') {
        observed = await this.#waitForClaim(lockPath, session, operation, signal);
      }
      if (observed.state === 'absent') {
        continue;
      }
      if (observed.state !== 'owner') {
        continue;
      }
      if ((await this.#ownerState(observed.owner)) === 'live') {
        throw typedError('WORKSPACE_LOCKED', { owner: observed.owner });
      }
      const result = await this.#claimAndRetire({
        identity,
        lockIdentity: observed.identity,
        lockPath,
        operation,
        record: observed.owner,
        session,
        signal
      });
      if (result.state === 'claimed') {
        await this.#waitForClaim(lockPath, session, operation, signal);
      }
    }
    throw typedError('WORKSPACE_LOCKED');
  }
}
