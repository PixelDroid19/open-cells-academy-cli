import assert from 'node:assert/strict';
import { access, mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { NodeProcessRunner } from '../../src/adapters/node/process-runner.js';

const packageRoot = path.resolve(import.meta.dirname, '../..');
const fixture = path.join(packageRoot, 'test/fixtures/process-child.js');
const tempParent = path.join(os.tmpdir(), 'open-cells-academy');

async function makeRoot() {
  await mkdir(tempParent, { recursive: true, mode: 0o700 });
  return mkdtemp(path.join(tempParent, 'open-cells-academy-task-3-process-'));
}

async function waitForMissingProcess(pid, attempts = 20) {
  for (let index = 0; index < attempts; index += 1) {
    try {
      process.kill(pid, 0);
    } catch (error) {
      if (error.code === 'ESRCH') {
        return;
      }
      throw error;
    }
    await new Promise(resolve => setTimeout(resolve, 25));
  }
  assert.fail(`fixture child ${pid} remained alive`);
}

test('captures literal shell metacharacters, stderr, stdin, and a nonzero exit as one immutable result', async () => {
  const runner = new NodeProcessRunner({ outputLimitBytes: 32_768 });
  const root = await makeRoot();

  try {
    const literal = '$(do-not-expand);$HOME|&';
    const result = await runner.run({
      file: process.execPath,
      args: [fixture, 'echo', literal, 'diagnostic', '23'],
      cwd: root,
      stdin: 'unused'
    });

    assert.equal(result.exitCode, 23);
    assert.equal(result.signal, null);
    assert.equal(result.stdout, literal);
    assert.equal(result.stderr, 'diagnostic');
    assert.equal(Object.isFrozen(result), true);

    const stdinResult = await runner.run({
      file: process.execPath,
      args: [fixture, 'stdin'],
      cwd: root,
      stdin: 'round-trip'
    });
    assert.equal(stdinResult.stdout, 'round-trip');
    assert.equal(stdinResult.stderr, '');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('classifies absent executables before a process result can be mistaken for success', async () => {
  const runner = new NodeProcessRunner();
  const root = await makeRoot();

  try {
    await assert.rejects(
      runner.run({ file: 'open-cells-academy-definitely-missing-tool', cwd: root }),
      error => error?.code === 'TOOL_MISSING'
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('rejects invalid spawn input without accepting a NUL or ambient-like environment value', async () => {
  const runner = new NodeProcessRunner();
  const root = await makeRoot();

  try {
    await assert.rejects(
      runner.run({ file: process.execPath, args: [`bad\u0000arg`], cwd: root }),
      error => error?.code === 'INVALID_INPUT'
    );
    await assert.rejects(
      runner.run({ file: process.execPath, cwd: root, env: { 'bad-key': 'value' } }),
      error => error?.code === 'INVALID_INPUT'
    );
    await assert.rejects(
      runner.run({ file: process.execPath, cwd: root, stdio: 'inherit' }),
      error => error?.code === 'INVALID_INPUT'
    );
    await assert.rejects(
      runner.run({ file: process.execPath, cwd: root, timeoutMs: -1 }),
      error => error?.code === 'INVALID_INPUT'
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('timeout interrupts and reaps only the owned lingering child without adding global signal listeners', async () => {
  const runner = new NodeProcessRunner({ terminateGraceMs: 20 });
  const root = await makeRoot();
  const pidPath = path.join(root, 'child.pid');
  const beforeSigint = process.listenerCount('SIGINT');
  const beforeSigterm = process.listenerCount('SIGTERM');

  try {
    await assert.rejects(
      runner.run({
        file: process.execPath,
        args: [fixture, 'linger', pidPath],
        cwd: root,
        timeoutMs: 100,
        terminateGraceMs: 20
      }),
      error => error?.code === 'INTERRUPTED' && error.details?.result?.stdout.includes('ready')
    );
    const pid = Number.parseInt(await readFile(pidPath, 'utf8'), 10);
    await waitForMissingProcess(pid);
    assert.equal(process.listenerCount('SIGINT'), beforeSigint);
    assert.equal(process.listenerCount('SIGTERM'), beforeSigterm);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('output limit interrupts only the child that exceeded its owned bounded capture', async () => {
  const runner = new NodeProcessRunner({ outputLimitBytes: 1_024, terminateGraceMs: 20 });
  const root = await makeRoot();

  try {
    await assert.rejects(
      runner.run({
        file: process.execPath,
        args: [fixture, 'spam'],
        cwd: root
      }),
      error => error?.code === 'TOOL_FAILED' && error.details?.reason === 'OUTPUT_LIMIT'
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('POSIX timeout keeps the exact owned process group alive through grace until an SIGTERM-ignoring descendant is reaped', { skip: process.platform === 'win32' }, async () => {
  const runner = new NodeProcessRunner({ terminateGraceMs: 25 });
  const root = await makeRoot();
  const descendantPath = path.join(root, 'timeout-descendant.pid');

  try {
    await assert.rejects(
      runner.run({
        file: process.execPath,
        args: [fixture, 'group-descendant', descendantPath],
        cwd: root,
        timeoutMs: 80,
        terminateGraceMs: 25
      }),
      error => error?.code === 'INTERRUPTED' && error.details?.reason === 'TIMEOUT'
    );
    await waitForMissingProcess(Number.parseInt(await readFile(descendantPath, 'utf8'), 10));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('POSIX AbortSignal reaps an owned direct-child-exit process group without leaving its exact descendant', { skip: process.platform === 'win32' }, async () => {
  const runner = new NodeProcessRunner({ terminateGraceMs: 25 });
  const root = await makeRoot();
  const descendantPath = path.join(root, 'abort-descendant.pid');
  const controller = new AbortController();

  try {
    const pending = runner.run({
      file: process.execPath,
      args: [fixture, 'group-descendant', descendantPath],
      cwd: root,
      signal: controller.signal,
      terminateGraceMs: 25
    });
    while (!(await access(descendantPath).then(() => true, () => false))) {
      await new Promise(resolve => setTimeout(resolve, 2));
    }
    controller.abort();
    await assert.rejects(pending, error => error?.code === 'INTERRUPTED' && error.details?.reason === 'ABORTED');
    await waitForMissingProcess(Number.parseInt(await readFile(descendantPath, 'utf8'), 10));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('POSIX output overflow reaps an owned process group after the direct child exits on SIGTERM', { skip: process.platform === 'win32' }, async () => {
  const runner = new NodeProcessRunner({ outputLimitBytes: 1_024, terminateGraceMs: 25 });
  const root = await makeRoot();
  const descendantPath = path.join(root, 'overflow-descendant.pid');

  try {
    await assert.rejects(
      runner.run({
        file: process.execPath,
        args: [fixture, 'group-descendant', descendantPath, 'spam'],
        cwd: root,
        terminateGraceMs: 25
      }),
      error => error?.code === 'TOOL_FAILED' && error.details?.reason === 'OUTPUT_LIMIT'
    );
    await waitForMissingProcess(Number.parseInt(await readFile(descendantPath, 'utf8'), 10));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

function cleanupFailureGroupOperations(signals) {
  return Object.freeze({
    exists() {
      return true;
    },
    signal(pgid, signal) {
      signals.push(Object.freeze({ pgid, signal }));
      if (signal === 'SIGTERM') {
        process.kill(pgid < 0 ? pgid : -pgid, signal);
      }
    }
  });
}

test('validates the owned process-group seam without accepting caller-selected targets', { skip: process.platform === 'win32' }, () => {
  assert.throws(
    () => new NodeProcessRunner({ ownedGroupOperations: { exists() {} } }),
    error => error?.code === 'INVALID_INPUT' && error.details?.field === 'ownedGroupOperations'
  );
});

test('POSIX timeout remains INTERRUPTED when owned-group cleanup verification fails', { skip: process.platform === 'win32' }, async () => {
  const signals = [];
  const runner = new NodeProcessRunner({
    terminateGraceMs: 5,
    ownedGroupOperations: cleanupFailureGroupOperations(signals)
  });
  const root = await makeRoot();
  const pidPath = path.join(root, 'timeout-cleanup-failure.pid');

  try {
    const error = await runner.run({
      file: process.execPath,
      args: [fixture, 'linger', pidPath],
      cwd: root,
      timeoutMs: 50,
      terminateGraceMs: 5
    }).then(
      () => undefined,
      failure => failure
    );
    await waitForMissingProcess(Number.parseInt(await readFile(pidPath, 'utf8'), 10));
    assert.equal(error?.code, 'INTERRUPTED');
    assert.equal(error?.details?.reason, 'TIMEOUT');
    assert.equal(error?.details?.cleanupReason, 'OWNED_GROUP_CLEANUP_FAILED');
    assert.ok(error?.details?.result);
    assert.ok(error?.cause);
    assert.ok(signals.some(entry => entry.signal === 'SIGTERM'));
    assert.ok(signals.every(entry => entry.pgid < 0));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('POSIX AbortSignal remains INTERRUPTED when owned-group cleanup verification fails', { skip: process.platform === 'win32' }, async () => {
  const signals = [];
  const runner = new NodeProcessRunner({
    terminateGraceMs: 5,
    ownedGroupOperations: cleanupFailureGroupOperations(signals)
  });
  const root = await makeRoot();
  const pidPath = path.join(root, 'abort-cleanup-failure.pid');
  const controller = new AbortController();

  try {
    const pending = runner.run({
      file: process.execPath,
      args: [fixture, 'linger', pidPath],
      cwd: root,
      signal: controller.signal,
      terminateGraceMs: 5
    });
    while (!(await access(pidPath).then(() => true, () => false))) {
      await new Promise(resolve => setTimeout(resolve, 2));
    }
    controller.abort();
    const error = await pending.then(
      () => undefined,
      failure => failure
    );
    await waitForMissingProcess(Number.parseInt(await readFile(pidPath, 'utf8'), 10));
    assert.equal(error?.code, 'INTERRUPTED');
    assert.equal(error?.details?.reason, 'ABORTED');
    assert.equal(error?.details?.cleanupReason, 'OWNED_GROUP_CLEANUP_FAILED');
    assert.ok(error?.details?.result);
    assert.ok(error?.cause);
    assert.ok(signals.some(entry => entry.signal === 'SIGTERM'));
    assert.ok(signals.every(entry => entry.pgid < 0));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('POSIX output overflow remains TOOL_FAILED when owned-group cleanup verification fails', { skip: process.platform === 'win32' }, async () => {
  const signals = [];
  const runner = new NodeProcessRunner({
    outputLimitBytes: 1_024,
    terminateGraceMs: 5,
    ownedGroupOperations: cleanupFailureGroupOperations(signals)
  });
  const root = await makeRoot();

  try {
    const error = await runner.run({
      file: process.execPath,
      args: [fixture, 'spam'],
      cwd: root,
      terminateGraceMs: 5
    }).then(
      () => undefined,
      failure => failure
    );
    assert.equal(error?.code, 'TOOL_FAILED');
    assert.equal(error?.details?.reason, 'OUTPUT_LIMIT');
    assert.equal(error?.details?.cleanupReason, 'OWNED_GROUP_CLEANUP_FAILED');
    assert.ok(error?.details?.result);
    assert.ok(error?.cause);
    assert.ok(signals.some(entry => entry.signal === 'SIGTERM'));
    assert.ok(signals.every(entry => entry.pgid < 0));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('POSIX skips SIGKILL when the final owned-group liveness check reports absent', { skip: process.platform === 'win32' }, async () => {
  const signals = [];
  const runner = new NodeProcessRunner({
    terminateGraceMs: 5,
    ownedGroupOperations: Object.freeze({
      exists() {
        return false;
      },
      signal(pgid, signal) {
        signals.push(Object.freeze({ pgid, signal }));
        if (signal === 'SIGTERM') {
          process.kill(pgid < 0 ? pgid : -pgid, signal);
        }
      }
    })
  });
  const root = await makeRoot();
  const pidPath = path.join(root, 'liveness-before-kill.pid');

  try {
    const error = await runner.run({
      file: process.execPath,
      args: [fixture, 'linger', pidPath],
      cwd: root,
      timeoutMs: 50,
      terminateGraceMs: 5
    }).then(
      () => undefined,
      failure => failure
    );
    await waitForMissingProcess(Number.parseInt(await readFile(pidPath, 'utf8'), 10));
    assert.equal(error?.code, 'INTERRUPTED');
    assert.equal(error?.details?.reason, 'TIMEOUT');
    assert.deepEqual(signals.map(entry => entry.signal), ['SIGTERM']);
    assert.ok(signals.every(entry => entry.pgid < 0));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
