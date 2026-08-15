import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { FileWorkspaceLock } from '../../src/adapters/node/file-workspace-lock.js';
import { NodeFilesystem } from '../../src/adapters/node/node-filesystem.js';
import { WorkspaceSession } from '../../src/domain/workspace-session.js';

const worker = fileURLToPath(new URL('../fixtures/lock-worker.js', import.meta.url));

async function fixture(t, prefix = 'open-cells-academy-lock-') {
  const root = await mkdtemp(path.join(os.tmpdir(), prefix));
  t.after(async () => {
    await rm(root, { recursive: true, force: true });
  });
  await writeFile(path.join(root, 'package.json'), JSON.stringify({ name: 'lock-fixture' }));
  const filesystem = new NodeFilesystem();
  const session = await WorkspaceSession.open(root, filesystem);
  return { filesystem, root, session };
}

async function assertCode(promise, code, predicate = undefined) {
  await assert.rejects(promise, error => {
    assert.equal(error.code, code);
    predicate?.(error);
    return true;
  });
}

async function waitForFile(candidate, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      return JSON.parse(await readFile(candidate, 'utf8'));
    } catch (error) {
      if (error.code !== 'ENOENT') {
        throw error;
      }
      await new Promise(resolve => setTimeout(resolve, 20));
    }
  }
  throw new Error(`timed out waiting for ${candidate}`);
}

function deferred() {
  let resolve;
  const promise = new Promise(nextResolve => {
    resolve = nextResolve;
  });
  return { promise, resolve };
}

function lockDirectory(lock, session, operation) {
  return lock.pathFor(session, operation);
}

async function writeTrustedOwner(lockPath, session, operation, token, { pid = 999999, startIdentity = 'dead' } = {}) {
  await mkdir(lockPath, { recursive: true });
  await writeFile(
    path.join(lockPath, 'owner.json'),
    JSON.stringify({ schema: 1, token, pid, startIdentity, operation, workspace: session.root, createdAt: new Date().toISOString() })
  );
}

async function ownerToken(lockPath) {
  return JSON.parse(await readFile(path.join(lockPath, 'owner.json'), 'utf8')).token;
}

async function assertNoClaimResidue(lockPath) {
  const entries = await readdir(lockPath);
  assert.equal(entries.includes('.claim'), false);
}

async function currentStartIdentity() {
  const processStat = await readFile(`/proc/${process.pid}/stat`, 'utf8');
  const closeParenthesis = processStat.lastIndexOf(')');
  return processStat.slice(closeParenthesis + 2).trim().split(/\s+/)[19];
}

function startWorker(t, workspace, operation, readyPath) {
  const child = spawn(process.execPath, [worker, workspace, operation, readyPath], {
    stdio: ['ignore', 'ignore', 'pipe']
  });
  let stderr = '';
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', chunk => {
    stderr += chunk;
  });
  t.after(async () => {
    if (child.exitCode === null && child.signalCode === null) {
      child.kill('SIGINT');
      await new Promise(resolve => child.once('exit', resolve));
    }
  });
  return { child, get stderr() { return stderr; } };
}

test('break: same-workspace same-operation real child contention stops producing one live typed lock owner', async t => {
  const { filesystem, root, session } = await fixture(t);
  const readyPath = path.join(root, 'worker-ready.json');
  const running = startWorker(t, root, 'app:create', readyPath);
  const ready = await waitForFile(readyPath);
  const lock = new FileWorkspaceLock({ filesystem });

  await assertCode(lock.acquire(session, 'app:create'), 'WORKSPACE_LOCKED', error => {
    assert.equal(error.details.owner.pid, ready.pid);
    assert.equal(error.details.owner.operation, 'app:create');
    assert.equal(error.details.owner.workspace, session.root);
  });
  assert.equal(running.child.exitCode, null);
});

test('break: distinct workspaces and operations stop acquiring independent locks concurrently', async t => {
  const first = await fixture(t, 'open-cells-academy-lock-one-');
  const second = await fixture(t, 'open-cells-academy-lock-two-');
  const lock = new FileWorkspaceLock({ filesystem: first.filesystem });
  const [one, two, three] = await Promise.all([
    lock.acquire(first.session, 'app:create'),
    lock.acquire(first.session, 'component:create'),
    lock.acquire(second.session, 'app:create')
  ]);

  assert.notEqual(one.path, two.path);
  assert.notEqual(one.path, three.path);
  await Promise.all([one.release(), two.release(), three.release()]);
});

test('break: dead owner records stop being reclaimed before a new mutation starts', async t => {
  const { filesystem, session } = await fixture(t);
  const lock = new FileWorkspaceLock({ filesystem, processIdentity: { pid: 424242, startIdentity: 'new-owner' } });
  const lockPath = lock.pathFor(session, 'app:create');
  await writeTrustedOwner(lockPath, session, 'app:create', '11111111-1111-4111-8111-111111111111');

  const handle = await lock.acquire(session, 'app:create');

  assert.equal(handle.record.pid, 424242);
  assert.equal(await ownerToken(lockPath), handle.record.token);
  await handle.release();
});

test('break: a delayed stale contender starts replacing a newer owner instead of yielding one reclaim winner', async t => {
  const { filesystem, session } = await fixture(t);
  const normal = new FileWorkspaceLock({ filesystem });
  const lockPath = normal.pathFor(session, 'app:create');
  await writeTrustedOwner(lockPath, session, 'app:create', '33333333-3333-4333-8333-333333333333');

  const staleRead = deferred();
  const continueDelayedReclaim = deferred();
  let delayedOnce = false;
  const delayedFilesystem = {
    joinPath: filesystem.joinPath.bind(filesystem),
    async readFile(candidate, encoding) {
      const contents = await filesystem.readFile(candidate, encoding);
      if (candidate === path.join(lockPath, 'owner.json') && !delayedOnce) {
        delayedOnce = true;
        staleRead.resolve();
        await continueDelayedReclaim.promise;
      }
      return contents;
    }
  };
  const delayed = new FileWorkspaceLock({
    filesystem: delayedFilesystem,
    processIdentity: { pid: 424243, startIdentity: 'delayed-owner' }
  });

  const delayedAcquisition = delayed.acquire(session, 'app:create');
  await staleRead.promise;
  const winner = await normal.acquire(session, 'app:create');
  continueDelayedReclaim.resolve();

  await assertCode(delayedAcquisition, 'WORKSPACE_LOCKED');
  assert.equal(await ownerToken(lockPath), winner.record.token);
  await winner.release();
});

test('break: a live pid with mismatched start identity stops being reclaimed without signalling that process', async t => {
  const { filesystem, root, session } = await fixture(t);
  const readyPath = path.join(root, 'worker-ready.json');
  const unrelated = startWorker(t, root, 'unrelated-operation', readyPath);
  const ready = await waitForFile(readyPath);
  const lock = new FileWorkspaceLock({ filesystem, processIdentity: { pid: process.pid, startIdentity: 'replacement-owner' } });
  const lockPath = lock.pathFor(session, 'app:create');
  await writeTrustedOwner(lockPath, session, 'app:create', '22222222-2222-4222-8222-222222222222', { pid: ready.pid, startIdentity: 'wrong-start' });

  const handle = await lock.acquire(session, 'app:create');

  assert.equal(unrelated.child.exitCode, null);
  assert.equal(handle.record.pid, process.pid);
  await handle.release();
});

test('break: malformed untrusted lock records stop failing closed without targeting any unrelated process', async t => {
  const { filesystem, root, session } = await fixture(t);
  const readyPath = path.join(root, 'worker-ready.json');
  const unrelated = startWorker(t, root, 'unrelated-operation', readyPath);
  await waitForFile(readyPath);
  const lock = new FileWorkspaceLock({ filesystem });
  const lockPath = lock.pathFor(session, 'app:create');
  await mkdir(lockPath);
  await writeFile(path.join(lockPath, 'owner.json'), '{ malformed');

  await assertCode(lock.acquire(session, 'app:create'), 'WORKSPACE_LOCK_INVALID');

  assert.equal(unrelated.child.exitCode, null);
  assert.equal(await readFile(path.join(lockPath, 'owner.json'), 'utf8'), '{ malformed');
});

test('break: release stops being idempotent and ownership-safe when a newer owner replaces a record', async t => {
  const { filesystem, session } = await fixture(t);
  const lock = new FileWorkspaceLock({ filesystem });
  const handle = await lock.acquire(session, 'app:create');
  await rm(handle.path, { recursive: true, force: true });
  await writeTrustedOwner(handle.path, session, 'app:create', '99999999-9999-4999-8999-999999999999', { pid: process.pid, startIdentity: 'new-owner' });

  await handle.release();
  await handle.release();

  assert.equal(await ownerToken(handle.path), '99999999-9999-4999-8999-999999999999');
});

test('break: an aborted acquire stops leaving its owned record while a sibling process remains alive', async t => {
  const { filesystem, root, session } = await fixture(t);
  const readyPath = path.join(root, 'worker-ready.json');
  const unrelated = startWorker(t, root, 'unrelated-operation', readyPath);
  await waitForFile(readyPath);
  const controller = new AbortController();
  controller.abort();
  const lock = new FileWorkspaceLock({ filesystem });

  await assertCode(lock.acquire(session, 'app:create', controller.signal), 'INTERRUPTED');

  assert.equal(unrelated.child.exitCode, null);
  await assert.rejects(readFile(path.join(lock.pathFor(session, 'app:create'), 'owner.json'), 'utf8'), { code: 'ENOENT' });
});

test('break: exact child SIGINT cleanup stops removing only the child-owned lock and never kills another process', async t => {
  const { filesystem, root, session } = await fixture(t);
  const firstReady = path.join(root, 'first-ready.json');
  const secondReady = path.join(root, 'second-ready.json');
  const owned = startWorker(t, root, 'app:create', firstReady);
  const unrelated = startWorker(t, root, 'other-operation', secondReady);
  const [first, second] = await Promise.all([waitForFile(firstReady), waitForFile(secondReady)]);
  const lock = new FileWorkspaceLock({ filesystem });

  assert.equal(first.record.operation, 'app:create');
  assert.equal(second.record.operation, 'other-operation');
  owned.child.kill('SIGINT');
  const [exitCode, signal] = await new Promise(resolve => owned.child.once('exit', (...args) => resolve(args)));
  assert.equal(exitCode, 130);
  assert.equal(signal, null);
  await assert.rejects(readFile(path.join(lock.pathFor(session, 'app:create'), 'owner.json'), 'utf8'), { code: 'ENOENT' });
  assert.equal(unrelated.child.exitCode, null);
  assert.equal(JSON.parse(await readFile(path.join(lock.pathFor(session, 'other-operation'), 'owner.json'), 'utf8')).pid, unrelated.child.pid);
});

test('break: delayed stale observer C stops moving live B while a third contender remains locked', async t => {
  const { filesystem, session } = await fixture(t);
  const lock = new FileWorkspaceLock({ filesystem });
  const lockPath = lockDirectory(lock, session, 'app:create');
  await writeTrustedOwner(lockPath, session, 'app:create', '44444444-4444-4444-8444-444444444444');
  const delayedRead = deferred();
  const resumeC = deferred();
  let paused = false;
  const delayedFilesystem = {
    joinPath: filesystem.joinPath.bind(filesystem),
    async readFile(candidate, encoding) {
      const result = await filesystem.readFile(candidate, encoding);
      if (candidate === path.join(lockPath, 'owner.json') && !paused) {
        paused = true;
        delayedRead.resolve();
        await resumeC.promise;
      }
      return result;
    }
  };
  const c = new FileWorkspaceLock({ filesystem: delayedFilesystem, processIdentity: { pid: process.pid, startIdentity: 'c' } });
  const cAcquisition = c.acquire(session, 'app:create');
  await delayedRead.promise;
  const d = await lock.acquire(session, 'app:create');
  const bToken = d.record.token;
  resumeC.resolve();

  await assertCode(cAcquisition, 'WORKSPACE_LOCKED');
  await assertCode(lock.acquire(session, 'app:create'), 'WORKSPACE_LOCKED');
  assert.equal(await ownerToken(lockPath), bToken);
  await assertNoClaimResidue(lockPath);
  await d.release();
});

test('break: three stale contenders stop yielding more than one live winner after a claim barrier', async t => {
  const { filesystem, session } = await fixture(t);
  const probe = new FileWorkspaceLock({ filesystem });
  const lockPath = lockDirectory(probe, session, 'app:create');
  await writeTrustedOwner(lockPath, session, 'app:create', '55555555-5555-4555-8555-555555555555');
  const observed = deferred();
  const releaseBarrier = deferred();
  const liveStartIdentity = await currentStartIdentity();
  let reads = 0;
  const barrierFilesystem = {
    joinPath: filesystem.joinPath.bind(filesystem),
    async readFile(candidate, encoding) {
      const result = await filesystem.readFile(candidate, encoding);
      if (candidate === path.join(lockPath, 'owner.json') && reads < 3) {
        reads += 1;
        if (reads === 3) observed.resolve();
        await releaseBarrier.promise;
      }
      return result;
    }
  };
  const contenders = [0, 1, 2].map(() => new FileWorkspaceLock({ filesystem: barrierFilesystem, processIdentity: { pid: process.pid, startIdentity: liveStartIdentity } }));
  const acquisitions = contenders.map(contender => contender.acquire(session, 'app:create').then(handle => ({ handle }), error => ({ error })));
  await observed.promise;
  releaseBarrier.resolve();
  const results = await Promise.all(acquisitions);
  const winners = results.filter(result => result.handle);

  assert.equal(winners.length, 1);
  assert.equal(await ownerToken(lockPath), winners[0].handle.record.token);
  for (const result of results.filter(result => result.error)) {
    assert.equal(result.error.code, 'WORKSPACE_LOCKED');
  }
  await winners[0].handle.release();
});

test('break: a release paused after owner validation stops retiring replacement B', async t => {
  const { filesystem, session } = await fixture(t);
  const lock = new FileWorkspaceLock({ filesystem });
  const a = await lock.acquire(session, 'app:create');
  const lockPath = lockDirectory(lock, session, 'app:create');
  const replacementToken = '66666666-6666-4666-8666-666666666666';
  await rm(lockPath, { recursive: true, force: true });
  await writeTrustedOwner(lockPath, session, 'app:create', replacementToken, { pid: process.pid, startIdentity: 'replacement' });

  await Promise.all([a.release(), a.release()]);

  assert.equal(await ownerToken(lockPath), replacementToken);
});

test('break: abort after acquisition stops leaving an owned lock while an unrelated exact-PID child stays alive', async t => {
  const { filesystem, root, session } = await fixture(t);
  const readyPath = path.join(root, 'unrelated-ready.json');
  const unrelated = startWorker(t, root, 'other-operation', readyPath);
  await waitForFile(readyPath);
  const controller = new AbortController();
  const lock = new FileWorkspaceLock({ filesystem });
  const handle = await lock.acquire(session, 'app:create', controller.signal);
  const lockPath = lockDirectory(lock, session, 'app:create');

  controller.abort();
  await new Promise(resolve => setTimeout(resolve, 25));

  await assert.rejects(readFile(path.join(lockPath, 'owner.json'), 'utf8'), { code: 'ENOENT' });
  assert.equal(unrelated.child.exitCode, null);
  await handle.release();
});

test('break: valid and incomplete pre-existing claims stop failing closed while preserving the owner', async t => {
  const { filesystem, session } = await fixture(t);
  const lock = new FileWorkspaceLock({ filesystem });
  const lockPath = lockDirectory(lock, session, 'app:create');
  const staleToken = '77777777-7777-4777-8777-777777777777';
  await writeTrustedOwner(lockPath, session, 'app:create', staleToken);
  await mkdir(path.join(lockPath, '.claim'));
  await writeFile(path.join(lockPath, '.claim', 'claim.json'), JSON.stringify({ schema: 1, token: '88888888-8888-4888-8888-888888888888', expectedOwnerToken: staleToken, pid: process.pid, startIdentity: 'claimer', operation: 'app:create', workspace: session.root, createdAt: new Date().toISOString() }));

  await assertCode(lock.acquire(session, 'app:create'), 'WORKSPACE_LOCK_CLAIMED');
  assert.equal(await ownerToken(lockPath), staleToken);
  await rm(path.join(lockPath, '.claim'), { recursive: true, force: true });
  await mkdir(path.join(lockPath, '.claim'));

  await assertCode(lock.acquire(session, 'app:create'), 'WORKSPACE_LOCK_CLAIM_INCOMPLETE');
  assert.equal(await ownerToken(lockPath), staleToken);
});
