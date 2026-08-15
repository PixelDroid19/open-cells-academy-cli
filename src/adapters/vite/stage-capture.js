import { randomUUID } from 'node:crypto';
import { constants as fsConstants } from 'node:fs';
import { lstat, mkdir, mkdtemp, open, readdir, rename, rmdir, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

import { ScaffoldPlan } from '../../domain/scaffold-plan.js';
import { hasSystemCode, typedError } from '../../domain/workspace-session.js';

const STAGE_READ_FLAGS = fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW;
const STAGE_DIRECTORY_FLAGS = fsConstants.O_RDONLY | fsConstants.O_DIRECTORY | fsConstants.O_NOFOLLOW;
const PROC_FD_ROOT = process.platform === 'linux' ? `/proc/${process.pid}/fd` : undefined;
const STAGE_SCHEMA = 1;
const STAGE_CLEANUP_PREFIX = '.open-cells-academy-stage-cleanup-';
const STAGE_CLAIM_NAME = 'claimed-stage';

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export function sameIdentity(left, right) {
  return left.dev === right.dev && left.ino === right.ino;
}

export function isWithin(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}

export async function status(candidate) {
  try {
    return await lstat(candidate);
  } catch (cause) {
    if (cause?.code === 'ENOENT') return undefined;
    throw cause;
  }
}

export function identity(candidate) {
  return Object.freeze({ dev: candidate.dev, ino: candidate.ino });
}

export function directoryIdentity(candidate, cleanupCode = 'TRANSACTION_CLEANUP_FAILED') {
  if (!candidate.isDirectory() || candidate.isSymbolicLink()) throw typedError(cleanupCode);
  return identity(candidate);
}

export function cleanupFailure(cause = undefined, cleanupCode = 'TRANSACTION_CLEANUP_FAILED') {
  if (cause?.code === cleanupCode) return cause;
  return typedError(cleanupCode, undefined, cause);
}

export function regularIdentity(candidate, invalidCode = 'STAGE_SOURCE_INVALID') {
  if (!candidate.isFile() || candidate.isSymbolicLink()) throw typedError(invalidCode);
  return identity(candidate);
}

export function captureFailure(cause = undefined, { invalidCode = 'STAGE_SOURCE_INVALID', changedCode = 'PATH_CHANGED' } = {}) {
  if (cause?.code === invalidCode || cause?.code === changedCode) return cause;
  return typedError(invalidCode, undefined, cause);
}

/**
 * Reads a stage file through an `O_RDONLY | O_NOFOLLOW` descriptor, verifying
 * descriptor identity before and after the read. The descriptor is closed even
 * when reading fails, and any path substitution (symlink or inode change)
 * fails closed so external content cannot reach a published plan.
 */
export async function readStageFile(candidate, captured, options = undefined) {
  const failure = options?.failure ?? captureFailure;
  let handle;
  try {
    handle = await open(candidate, STAGE_READ_FLAGS);
    const opened = regularIdentity(await handle.stat(), options?.invalidCode);
    if (!sameIdentity(opened, captured)) throw typedError('PATH_CHANGED');
    const content = await handle.readFile();
    const finished = regularIdentity(await handle.stat(), options?.invalidCode);
    if (!sameIdentity(finished, captured)) throw typedError('PATH_CHANGED');
    return content;
  } catch (cause) {
    throw failure(cause);
  } finally {
    await handle?.close().catch(() => undefined);
  }
}

/**
 * Recursively captures a stage directory into an immutable list of
 * `{ content, relative }` entries. Each directory's identity is captured before
 * `readdir`, re-checked immediately after enumeration and after every child, so
 * a directory swap during recursion fails closed. Symlinks are always rejected.
 */
export async function captureStageDirectory(root, base = root, output = [], options = undefined) {
  const failure = options?.failure ?? captureFailure;
  let captured;
  try {
    captured = directoryIdentity(await lstat(root), options?.cleanupCode);
    const entries = await readdir(root, { withFileTypes: true });
    const afterEnumeration = directoryIdentity(await lstat(root), options?.cleanupCode);
    if (!sameIdentity(afterEnumeration, captured)) throw typedError('PATH_CHANGED');
    for (const entry of entries) {
      const candidate = path.join(root, entry.name);
      if (entry.isSymbolicLink()) throw typedError(options?.invalidCode ?? 'STAGE_SOURCE_INVALID');
      if (entry.isDirectory()) {
        await captureStageDirectory(candidate, base, output, options);
      } else if (entry.isFile()) {
        const capturedFile = regularIdentity(await lstat(candidate), options?.invalidCode);
        output.push(Object.freeze({
          content: await readStageFile(candidate, capturedFile, options),
          relative: path.relative(base, candidate).split(path.sep).join('/')
        }));
      } else {
        throw typedError(options?.invalidCode ?? 'STAGE_SOURCE_INVALID');
      }
      const current = directoryIdentity(await lstat(root), options?.cleanupCode);
      if (!sameIdentity(current, captured)) throw typedError('PATH_CHANGED');
    }
    return output;
  } catch (cause) {
    throw failure(cause);
  }
}

/**
 * Produces an immutable ScaffoldPlan from a captured stage directory, applying
 * the same fail-closed identity rules used during capture.
 */
export async function planForStage(stage, options = undefined) {
  let plan = ScaffoldPlan.empty();
  for (const file of await captureStageDirectory(stage, stage, [], options)) {
    plan = plan.addFile(file.relative, file.content);
  }
  return plan;
}

async function readMarker(candidate, expected) {
  const markerPath = path.join(candidate, expected.markerName);
  let markerStatus;
  try {
    markerStatus = await lstat(markerPath);
  } catch (cause) {
    if (cause?.code === 'ENOENT') return false;
    throw cleanupFailure(cause);
  }
  if (!markerStatus.isFile() || markerStatus.isSymbolicLink()) return false;
  let contents;
  try {
    const markerIdentity = regularIdentity(markerStatus, 'TRANSACTION_CLEANUP_FAILED');
    contents = (await readStageFile(markerPath, markerIdentity, {
      invalidCode: 'TRANSACTION_CLEANUP_FAILED',
      failure: cleanupFailure
    })).toString('utf8');
  } catch (cause) {
    if (cause?.code === 'ENOENT') return false;
    throw cleanupFailure(cause);
  }
  try {
    const marker = JSON.parse(contents);
    return marker?.schema === STAGE_SCHEMA && marker?.kind === expected.kind && marker?.token === expected.token;
  } catch {
    return false;
  }
}

function ownedConfig(owned) {
  return Object.freeze({ markerName: owned.markerName, kind: owned.kind, token: owned.token });
}

async function verifyStageContainer(owned) {
  let container;
  try {
    container = directoryIdentity(await lstat(owned.parentContainer));
  } catch (cause) {
    throw cleanupFailure(cause);
  }
  if (!sameIdentity(container, owned.parentContainerIdentity)) {
    throw typedError('TRANSACTION_CLEANUP_FAILED');
  }
  return container;
}

/**
 * Removes an empty directory pinned by an open descriptor without ever
 * deleting a foreign directory at its name. The directory is first renamed to
 * an unpredictable sink name (atomic), re-identified through the sink, and a
 * substituted directory is renamed back before failing closed. Only then is
 * the sink `rmdir`'d, and the descriptor's link count after the `rmdir`
 * proves which inode was removed: when a substitution wins the final window
 * the pinned inode is still linked and the call fails closed. `rmdir` only
 * removes empty directories, so no content can be lost in that residual
 * window; name-based deletion inside a shared parent cannot be made atomic
 * beyond this point on POSIX. Filesystems that drop unlinked inodes (such as
 * FUSE/ntfs-3g) report `ENOENT` on the post-removal descriptor stat, which is
 * accepted as proof of removal; a stat that still succeeds must show a fully
 * unlinked inode or the call fails closed.
 */
async function removeVerifiedEmptyDirectory(handle, dirPath, containerPath) {
  const expected = directoryIdentity(await handle.stat());
  let remaining;
  try {
    remaining = await readdir(`${PROC_FD_ROOT}/${handle.fd}`);
  } catch (cause) {
    throw cleanupFailure(cause);
  }
  if (remaining.length > 0) throw typedError('TRANSACTION_CLEANUP_FAILED');
  const sinkPath = path.join(containerPath, `${STAGE_CLEANUP_PREFIX}sink-${randomUUID()}`);
  try {
    await rename(dirPath, sinkPath);
  } catch (cause) {
    throw cleanupFailure(cause);
  }
  const atSink = await status(sinkPath);
  if (atSink === undefined || !sameIdentity(directoryIdentity(atSink), expected)) {
    try {
      await rename(sinkPath, dirPath);
    } catch {}
    throw typedError('TRANSACTION_CLEANUP_FAILED');
  }
  try {
    await rmdir(sinkPath);
  } catch (cause) {
    throw cleanupFailure(cause);
  }
  let removed;
  try {
    removed = await handle.stat();
  } catch (cause) {
    if (hasSystemCode(cause, 'ENOENT')) return;
    throw cleanupFailure(cause);
  }
  if (removed.nlink !== 0) {
    throw typedError('TRANSACTION_CLEANUP_FAILED');
  }
}

async function openPinnedDirectory(candidate, expected = undefined) {
  let handle;
  try {
    handle = await open(candidate, STAGE_DIRECTORY_FLAGS);
    const current = directoryIdentity(await handle.stat());
    if (expected !== undefined && !sameIdentity(current, expected)) {
      throw typedError('TRANSACTION_CLEANUP_FAILED');
    }
    return handle;
  } catch (cause) {
    await handle?.close().catch(() => undefined);
    throw cleanupFailure(cause);
  }
}

/**
 * Recursively deletes the contents of a directory pinned by an open descriptor.
 * Every lookup traverses `/proc/<pid>/fd/<fd>`, so the kernel resolves children
 * inside the pinned inode and a same-name replacement of the original path can
 * never redirect the deletion into a foreign tree. Each child directory is
 * identity-captured through the pinned parent and re-verified by the descriptor
 * opened for recursion, so a replacement installed between enumeration and open
 * fails closed instead of being deleted; its dirent is identity-checked again
 * before `rmdir`. Regular files are opened with `O_NOFOLLOW` and their
 * descriptor identity is compared against the pinned-parent `lstat` before
 * `unlink`. Symlinks are unlinked directly and never followed.
 */
async function removePinnedTree(dirHandle) {
  const base = `${PROC_FD_ROOT}/${dirHandle.fd}`;
  const entries = await readdir(base, { withFileTypes: true });
  for (const entry of entries) {
    const childPath = `${base}/${entry.name}`;
    if (entry.isSymbolicLink()) {
      await unlink(childPath);
      continue;
    }
    if (entry.isDirectory()) {
      const captured = directoryIdentity(await lstat(childPath), 'TRANSACTION_CLEANUP_FAILED');
      const childHandle = await openPinnedDirectory(childPath, captured);
      try {
        await removePinnedTree(childHandle);
      } finally {
        await childHandle.close().catch(() => undefined);
      }
      const current = await status(childPath);
      if (current === undefined || !sameIdentity(directoryIdentity(current), captured)) {
        throw typedError('TRANSACTION_CLEANUP_FAILED');
      }
      await rmdir(childPath);
      continue;
    }
    const childStatus = await status(childPath);
    if (childStatus === undefined) throw typedError('TRANSACTION_CLEANUP_FAILED');
    if (childStatus.isFile() && !childStatus.isSymbolicLink()) {
      const captured = regularIdentity(childStatus, 'TRANSACTION_CLEANUP_FAILED');
      let fileHandle;
      try {
        fileHandle = await open(childPath, STAGE_READ_FLAGS);
        const opened = regularIdentity(await fileHandle.stat(), 'TRANSACTION_CLEANUP_FAILED');
        if (!sameIdentity(opened, captured)) throw typedError('TRANSACTION_CLEANUP_FAILED');
      } catch (cause) {
        await fileHandle?.close().catch(() => undefined);
        throw cleanupFailure(cause);
      }
      await fileHandle.close().catch(() => undefined);
    }
    await unlink(childPath);
  }
}

function stageConfig(kind) {
  if (!isRecord(kind) || typeof kind.markerName !== 'string' || typeof kind.kind !== 'string' || typeof kind.directoryPrefix !== 'string') {
    throw typedError('STAGE_CONFIG_INVALID');
  }
  return Object.freeze({ markerName: kind.markerName, kind: kind.kind, directoryPrefix: kind.directoryPrefix });
}

/**
 * Creates a token- and identity-protected staging tree inside `root`. A random
 * marker plus captured parent and stage `dev`/`ino` identities later guard
 * verification before planning, publication, and recursive cleanup, so a
 * same-name replacement is never deleted and nested output replacement is
 * rejected before publication.
 */
export async function createOwnedStage(root, kind) {
  const config = stageConfig(kind);
  const token = randomUUID();
  const parentContainer = directoryIdentity(await lstat(root));
  const parent = await mkdtemp(path.join(root, config.directoryPrefix));
  const initialParent = directoryIdentity(await lstat(parent));
  try {
    if (!sameIdentity(directoryIdentity(await lstat(root)), parentContainer)) {
      throw typedError('TRANSACTION_CLEANUP_FAILED');
    }
    await writeFile(
      path.join(parent, config.markerName),
      JSON.stringify({ schema: STAGE_SCHEMA, kind: config.kind, token }),
      { flag: 'wx', mode: 0o600 }
    );
    const currentParent = directoryIdentity(await lstat(parent));
    if (!sameIdentity(currentParent, initialParent) || !(await readMarker(parent, { ...config, token }))) {
      throw typedError('TRANSACTION_CLEANUP_FAILED');
    }
    const stage = path.join(parent, 'output');
    await mkdir(stage, { recursive: false, mode: 0o700 });
    if (!sameIdentity(directoryIdentity(await lstat(root)), parentContainer)) {
      throw typedError('TRANSACTION_CLEANUP_FAILED');
    }
    return Object.freeze({
      parent,
      parentIdentity: currentParent,
      parentContainer: root,
      parentContainerIdentity: parentContainer,
      stage,
      stageIdentity: directoryIdentity(await lstat(stage)),
      token,
      markerName: config.markerName,
      kind: config.kind
    });
  } catch (cause) {
    throw cleanupFailure(cause);
  }
}

export async function verifyOwnedStage(owned) {
  const config = ownedConfig(owned);
  await verifyStageContainer(owned);
  let parent;
  try {
    parent = directoryIdentity(await lstat(owned.parent));
  } catch (cause) {
    throw cleanupFailure(cause);
  }
  if (!sameIdentity(parent, owned.parentIdentity) || !(await readMarker(owned.parent, config))) {
    throw typedError('TRANSACTION_CLEANUP_FAILED');
  }
  let stage;
  try {
    stage = directoryIdentity(await lstat(owned.stage));
  } catch (cause) {
    throw cleanupFailure(cause);
  }
  if (!sameIdentity(stage, owned.stageIdentity)) throw typedError('TRANSACTION_CLEANUP_FAILED');
}

/**
 * Descriptor-pinned cleanup used on Linux. The claimed stage is opened through
 * the quarantine descriptor and deleted exclusively through
 * `/proc/<pid>/fd/<fd>` lookups, so the recursive deletion is anchored to the
 * verified inode: a replacement installed at any stage path after verification
 * cannot be deleted. Every child directory is identity-captured through the
 * pinned parent and re-verified by the descriptor used for recursion, and its
 * dirent is identity-checked again before `rmdir`, so a replacement installed
 * between enumeration and open fails closed without touching the foreign tree.
 * A foreign directory that wins the claim rename is renamed back to its
 * original location before failing. The final quarantine removal renames the
 * verified empty directory to an unpredictable sink, re-identifies it through
 * the sink, and proves via the held descriptor's link count that the removed
 * inode was the pinned one, failing closed otherwise.
 */
async function removeOwnedStagePinned(owned) {
  await verifyOwnedStage(owned);
  let quarantineHandle;
  let quarantinePath;
  let quarantineDiscarded = false;
  const discardQuarantine = async () => {
    if (quarantineHandle === undefined || quarantinePath === undefined || quarantineDiscarded) return;
    try {
      await removeVerifiedEmptyDirectory(quarantineHandle, quarantinePath, owned.parentContainer);
      quarantineDiscarded = true;
    } catch {}
  };
  try {
    quarantinePath = await mkdtemp(path.join(owned.parentContainer, STAGE_CLEANUP_PREFIX));
    quarantineHandle = await openPinnedDirectory(quarantinePath);
    quarantineHandle.path = quarantinePath;
    const quarantineIdentity = directoryIdentity(await quarantineHandle.stat());
    const baseName = `${STAGE_CLAIM_NAME}-${randomUUID()}`;
    const claimPath = path.join(quarantinePath, baseName);
    try {
      await rename(owned.parent, claimPath);
    } catch (cause) {
      throw cleanupFailure(cause);
    }
    const pinnedClaimPath = `${PROC_FD_ROOT}/${quarantineHandle.fd}/${baseName}`;
    let claimedHandle;
    let claimedIdentity;
    try {
      claimedHandle = await openPinnedDirectory(pinnedClaimPath);
      claimedIdentity = directoryIdentity(await claimedHandle.stat());
      if (!sameIdentity(claimedIdentity, owned.parentIdentity)) {
        await claimedHandle.close().catch(() => undefined);
        claimedHandle = undefined;
        try {
          await rename(claimPath, owned.parent);
        } catch {}
        throw typedError('TRANSACTION_CLEANUP_FAILED');
      }
      if (!(await readMarker(pinnedClaimPath, ownedConfig(owned)))) {
        throw typedError('TRANSACTION_CLEANUP_FAILED');
      }
      let outputStatus;
      try {
        outputStatus = await lstat(`${pinnedClaimPath}/output`);
      } catch (cause) {
        throw cleanupFailure(cause);
      }
      if (outputStatus === undefined || !sameIdentity(directoryIdentity(outputStatus), owned.stageIdentity)) {
        throw typedError('TRANSACTION_CLEANUP_FAILED');
      }
      await removePinnedTree(claimedHandle);
    } catch (cause) {
      await claimedHandle?.close().catch(() => undefined);
      throw cleanupFailure(cause);
    }
    await claimedHandle.close().catch(() => undefined);
    claimedHandle = undefined;
    const claimAtDent = await status(pinnedClaimPath);
    if (claimAtDent === undefined || !sameIdentity(directoryIdentity(claimAtDent), claimedIdentity)) {
      throw typedError('TRANSACTION_CLEANUP_FAILED');
    }
    try {
      await rmdir(pinnedClaimPath);
    } catch (cause) {
      throw cleanupFailure(cause);
    }
    const still = directoryIdentity(await quarantineHandle.stat());
    if (!sameIdentity(still, quarantineIdentity)) throw typedError('TRANSACTION_CLEANUP_FAILED');
    await removeVerifiedEmptyDirectory(quarantineHandle, quarantinePath, owned.parentContainer);
    quarantineDiscarded = true;
  } catch (cause) {
    await discardQuarantine();
    throw cleanupFailure(cause);
  } finally {
    await quarantineHandle?.close().catch(() => undefined);
  }
}

/**
 * Removes an owned stage without ever deleting foreign content. Requires the
 * Linux `/proc/<pid>/fd` descriptor namespace; on platforms without it the
 * cleanup refuses to run instead of falling back to a racy path-based
 * deletion, leaving the owned stage behind as residue.
 */
export async function removeOwnedStage(owned) {
  if (owned === undefined) return;
  if (PROC_FD_ROOT === undefined) {
    throw typedError('TRANSACTION_CLEANUP_UNSUPPORTED');
  }
  return removeOwnedStagePinned(owned);
}
