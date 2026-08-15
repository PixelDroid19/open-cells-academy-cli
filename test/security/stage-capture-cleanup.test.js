import assert from 'node:assert/strict';
import { lstat, mkdir, mkdtemp, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { createRequire, syncBuiltinESMExports } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { createOwnedStage, removeOwnedStage } from '../../src/adapters/vite/stage-capture.js';

const requireBuiltin = createRequire(import.meta.url);
const STAGE_KIND = Object.freeze({
  markerName: '.open-cells-academy-stage-cleanup-test.json',
  kind: 'stage-capture-cleanup-test',
  directoryPrefix: '.open-cells-academy-stage-cleanup-test-'
});

async function workspace(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'open-cells-academy-stage-capture-'));
  t.after(async () => {
    await rm(root, { recursive: true, force: true });
  });
  return root;
}

test('cleanup never deletes a foreign replacement installed after the claim is pinned', async t => {
  const root = await workspace(t);
  const owned = await createOwnedStage(root, STAGE_KIND);
  await writeFile(path.join(owned.stage, 'artifact.txt'), 'owned\n');
  const builtinFs = requireBuiltin('node:fs/promises');
  const originalRmdir = builtinFs.rmdir;
  let interposedClaim;
  let foreignDir;
  builtinFs.rmdir = async (candidate, options) => {
    if (interposedClaim === undefined && typeof candidate === 'string' && candidate.includes('claimed-stage-')) {
      const claimBase = path.basename(candidate);
      const quarantineName = (await readdir(root)).find(entry => entry.startsWith('.open-cells-academy-stage-cleanup-'));
      const quarantinePath = path.join(root, quarantineName);
      interposedClaim = path.join(quarantinePath, claimBase);
      await rename(interposedClaim, `${interposedClaim}-parked`);
      await mkdir(interposedClaim);
      foreignDir = interposedClaim;
      await writeFile(path.join(interposedClaim, 'unrelated-sentinel.txt'), 'must survive\n');
    }
    return originalRmdir(candidate, options);
  };
  syncBuiltinESMExports();
  try {
    await assert.rejects(removeOwnedStage(owned), error => {
      assert.equal(error?.code, 'TRANSACTION_CLEANUP_FAILED');
      return true;
    });
  } finally {
    builtinFs.rmdir = originalRmdir;
    syncBuiltinESMExports();
  }

  assert.notEqual(interposedClaim, undefined);
  assert.equal(await readFile(path.join(foreignDir, 'unrelated-sentinel.txt'), 'utf8'), 'must survive\n');
  assert.deepEqual(await readdir(foreignDir), ['unrelated-sentinel.txt']);
});

test('cleanup fails closed when the output directory is swapped before its recursive open', async t => {
  const root = await workspace(t);
  const owned = await createOwnedStage(root, STAGE_KIND);
  await writeFile(path.join(owned.stage, 'artifact.txt'), 'owned\n');
  const builtinFs = requireBuiltin('node:fs/promises');
  const originalOpen = builtinFs.open;
  let swapped;
  builtinFs.open = async (candidate, flags, mode) => {
    if (swapped === undefined && typeof candidate === 'string' && candidate.includes('/fd/') && candidate.endsWith('/output')) {
      const quarantineName = (await readdir(root)).find(entry => entry.startsWith('.open-cells-academy-stage-cleanup-'));
      const quarantinePath = path.join(root, quarantineName);
      const claimName = (await readdir(quarantinePath)).find(entry => entry.startsWith('claimed-stage-'));
      const claimPath = path.join(quarantinePath, claimName);
      swapped = claimPath;
      await rename(path.join(claimPath, 'output'), path.join(claimPath, 'output-parked'));
      await mkdir(path.join(claimPath, 'output'));
      await writeFile(path.join(claimPath, 'output', 'foreign-sentinel.txt'), 'must survive\n');
    }
    return originalOpen(candidate, flags, mode);
  };
  syncBuiltinESMExports();
  try {
    await assert.rejects(removeOwnedStage(owned), error => {
      assert.equal(error?.code, 'TRANSACTION_CLEANUP_FAILED');
      return true;
    });
  } finally {
    builtinFs.open = originalOpen;
    syncBuiltinESMExports();
  }

  assert.notEqual(swapped, undefined);
  assert.equal(await readFile(path.join(swapped, 'output', 'foreign-sentinel.txt'), 'utf8'), 'must survive\n');
  assert.equal(await readFile(path.join(swapped, 'output-parked', 'artifact.txt'), 'utf8'), 'owned\n');
});

test('cleanup restores a foreign directory that wins the atomic claim race and fails closed', async t => {
  const root = await workspace(t);
  const owned = await createOwnedStage(root, STAGE_KIND);
  const builtinFs = requireBuiltin('node:fs/promises');
  const originalRename = builtinFs.rename;
  const parked = `${owned.parent}-parked`;
  const sentinelName = 'unrelated-sentinel.txt';
  let claimed;
  builtinFs.rename = async (source, destination) => {
    if (claimed === undefined && source === owned.parent) {
      await originalRename(source, parked);
      await mkdir(source);
      await writeFile(path.join(source, sentinelName), 'must survive\n');
      claimed = destination;
    }
    return originalRename(source, destination);
  };
  syncBuiltinESMExports();
  try {
    await assert.rejects(removeOwnedStage(owned), error => {
      assert.equal(error?.code, 'TRANSACTION_CLEANUP_FAILED');
      return true;
    });
  } finally {
    builtinFs.rename = originalRename;
    syncBuiltinESMExports();
  }

  assert.notEqual(claimed, undefined);
  assert.equal(await readFile(path.join(owned.parent, sentinelName), 'utf8'), 'must survive\n');
  assert.equal((await lstat(parked)).isDirectory(), true);
  let claimedStillPresent = true;
  try {
    await lstat(claimed);
  } catch {
    claimedStillPresent = false;
  }
  assert.equal(claimedStillPresent, false);
});

test('cleanup leaves a colliding nonempty quarantine destination untouched', async t => {
  const root = await workspace(t);
  const owned = await createOwnedStage(root, STAGE_KIND);
  const builtinFs = requireBuiltin('node:fs/promises');
  const originalRename = builtinFs.rename;
  let collision;
  builtinFs.rename = async (source, destination) => {
    if (collision === undefined && source === owned.parent) {
      await mkdir(destination);
      await writeFile(path.join(destination, 'unrelated-sentinel.txt'), 'must survive\n');
      collision = destination;
    }
    return originalRename(source, destination);
  };
  syncBuiltinESMExports();
  try {
    await assert.rejects(removeOwnedStage(owned), error => {
      assert.equal(error?.code, 'TRANSACTION_CLEANUP_FAILED');
      return true;
    });
  } finally {
    builtinFs.rename = originalRename;
    syncBuiltinESMExports();
  }

  assert.notEqual(collision, undefined);
  assert.equal(await readFile(path.join(collision, 'unrelated-sentinel.txt'), 'utf8'), 'must survive\n');
  assert.equal((await lstat(owned.parent)).isDirectory(), true);
});

test('cleanup fails closed when the final quarantine sink is swapped before its rmdir', async t => {
  const root = await workspace(t);
  const owned = await createOwnedStage(root, STAGE_KIND);
  await writeFile(path.join(owned.stage, 'artifact.txt'), 'owned\n');
  const builtinFs = requireBuiltin('node:fs/promises');
  const originalRmdir = builtinFs.rmdir;
  let stolenPath;
  builtinFs.rmdir = async (candidate, options) => {
    if (typeof candidate === 'string' && candidate.includes('sink-')) {
      const quarantineName = path.basename(candidate);
      stolenPath = path.join(root, `${quarantineName}-stolen`);
      await rename(candidate, stolenPath);
      await mkdir(candidate);
    }
    return originalRmdir(candidate, options);
  };
  syncBuiltinESMExports();
  try {
    await assert.rejects(removeOwnedStage(owned), error => {
      assert.equal(error?.code, 'TRANSACTION_CLEANUP_FAILED');
      return true;
    });
  } finally {
    builtinFs.rmdir = originalRmdir;
    syncBuiltinESMExports();
  }

  assert.notEqual(stolenPath, undefined);
  assert.equal((await lstat(stolenPath)).isDirectory(), true);
  assert.deepEqual(await readdir(stolenPath), []);
});

test('cleanup removes the successfully claimed owned stage without residue', async t => {
  const root = await workspace(t);
  const owned = await createOwnedStage(root, STAGE_KIND);
  await writeFile(path.join(owned.stage, 'artifact.txt'), 'owned\n');

  await removeOwnedStage(owned);

  assert.deepEqual(await readdir(root), []);
});
