import assert from 'node:assert/strict';
import test from 'node:test';
import { EventEmitter } from 'node:events';
import { createServer } from 'node:http';

import { TaskSupervisor } from '../../src/adapters/node/task-supervisor.js';
import { NodeProcessRunner } from '../../src/adapters/node/process-runner.js';
import { RingBuffer } from '../../src/domain/tui/ring-buffer.js';

async function waitFor(check, { timeoutMs = 1000, intervalMs = 10 } = {}) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (check()) {
      return;
    }
    await new Promise(resolve => setTimeout(resolve, intervalMs));
  }
  assert.fail('Timed out waiting for the expected task state.');
}

async function freeLocalPort() {
  const server = createServer();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const port = server.address().port;
  await new Promise((resolve, reject) => server.close(error => (error ? reject(error) : resolve())));
  return port;
}

class MockProcessRunner {
  constructor() {
    this.runs = [];
    this.activeRuns = new Map();
    this.nextPid = 1000;
  }

  async run(request) {
    const pid = ++this.nextPid;
    const runInfo = {
      request,
      pid,
      aborted: false
    };
    this.runs.push(runInfo);

    return new Promise((resolve, reject) => {
      const finish = (exitCode, signal) => {
        this.activeRuns.delete(pid);
        resolve({
          exitCode: exitCode ?? 0,
          signal: signal ?? null,
          stdout: runInfo.stdout ?? '',
          stderr: runInfo.stderr ?? '',
          durationMs: 50
        });
      };

      runInfo.finish = finish;
      this.activeRuns.set(pid, runInfo);

      if (request.signal) {
        request.signal.addEventListener('abort', () => {
          runInfo.aborted = true;
          finish(null, 'SIGINT');
        });
      }

      request.onStart?.({ pid });
      if (request.isServer) {
        request.onOutput?.({ stream: 'stdout', text: `Server ready: http://127.0.0.1:${request.port ?? 8001}/\n` });
      } else {
        setTimeout(() => {
          if (!runInfo.aborted) {
            finish(request.simulatedExitCode ?? 0, null);
          }
        }, request.delayMs ?? 10);
      }
    });
  }
}

test('contract: TaskSupervisor runs dev server and tests concurrently while preserving server PID', async () => {
  const runner = new MockProcessRunner();
  const supervisor = new TaskSupervisor({ processRunner: runner });

  // 1. Start Serve
  const serveTask = await supervisor.startTask({
    type: 'serve',
    logicalCommand: 'component:dev',
    file: process.execPath,
    args: ['bin/cells.js', 'component:dev'],
    cwd: '/tmp/test-workspace',
    isServer: true,
    port: 8001
  });

  assert.equal(serveTask.type, 'serve');
  assert.equal(serveTask.status, 'running');
  assert.ok(serveTask.pid > 0);
  const originalServePid = serveTask.pid;
  assert.equal(serveTask.url, 'http://127.0.0.1:8001/');

  // 2. Start Unit Tests while Serve is running
  const unitTask = await supervisor.startTask({
    type: 'unit',
    logicalCommand: 'component:test',
    file: process.execPath,
    args: ['bin/cells.js', 'component:test'],
    cwd: '/tmp/test-workspace'
  });

  assert.equal(unitTask.type, 'unit');
  assert.notEqual(unitTask.pid, originalServePid);

  // Verify server is STILL running with original PID
  const currentServe = supervisor.getTask(serveTask.id);
  assert.equal(currentServe.status, 'running');
  assert.equal(currentServe.pid, originalServePid);

  await waitFor(() => supervisor.getTask(unitTask.id)?.status === 'passed');

  // 3. Start Coverage after the prior test-output writer completes
  const covTask = await supervisor.startTask({
    type: 'coverage',
    logicalCommand: 'component:test --coverage',
    file: process.execPath,
    args: ['bin/cells.js', 'component:test', '--coverage'],
    cwd: '/tmp/test-workspace',
    delayMs: 1000
  });
  assert.equal(covTask.type, 'coverage');

  // Verify server is STILL running with original PID
  assert.equal(supervisor.getTask(serveTask.id).pid, originalServePid);

  // 4. Cancel Coverage task independently
  await supervisor.cancelTask(covTask.id);
  assert.equal(supervisor.getTask(covTask.id).status, 'stopped');

  // Verify server is STILL running with original PID
  assert.equal(supervisor.getTask(serveTask.id).status, 'running');
  assert.equal(supervisor.getTask(serveTask.id).pid, originalServePid);

  // 5. Cleanup all
  await supervisor.stopAll();
  assert.equal(supervisor.getTask(serveTask.id).status, 'stopped');
});

test('contract: TaskSupervisor rejects duplicate server startup and explains port conflict', async () => {
  const runner = new MockProcessRunner();
  const supervisor = new TaskSupervisor({ processRunner: runner });

  await supervisor.startTask({
    type: 'serve',
    logicalCommand: 'app:dev',
    file: process.execPath,
    args: ['bin/cells.js', 'app:dev', '-c', 'dev.js'],
    cwd: '/tmp/app',
    isServer: true,
    port: 8001
  });

  await assert.rejects(
    async () => {
      await supervisor.startTask({
        type: 'serve',
        logicalCommand: 'app:dev',
        file: process.execPath,
        args: ['bin/cells.js', 'app:dev', '-c', 'dev.js'],
        cwd: '/tmp/app',
        isServer: true,
        port: 8001
      });
    },
    { code: 'SERVER_ALREADY_RUNNING' }
  );

  await supervisor.stopAll();
});

test('contract: TaskSupervisor rejects concurrent test-output writers and duplicate builds', async () => {
  const runner = new MockProcessRunner();
  const supervisor = new TaskSupervisor({ processRunner: runner });
  const request = {
    file: process.execPath,
    args: ['--input-type=module', '--eval', 'setTimeout(() => {}, 1000)'],
    cwd: '/tmp/component',
    logicalCommand: 'component:test'
  };

  await supervisor.startTask({ ...request, type: 'unit' });
  await assert.rejects(
    () => supervisor.startTask({ ...request, type: 'coverage', logicalCommand: 'component:test --coverage' }),
    { code: 'TASK_CONFLICT' }
  );

  await supervisor.stopAll();
  await supervisor.startTask({ ...request, type: 'build', logicalCommand: 'component:build:demo' });
  await assert.rejects(
    () => supervisor.startTask({ ...request, type: 'build', logicalCommand: 'component:build:demo' }),
    { code: 'TASK_CONFLICT' }
  );
  await supervisor.stopAll();
});

test('contract: TaskSupervisor restarting server cycles PID and releases old process', async () => {
  const runner = new MockProcessRunner();
  const supervisor = new TaskSupervisor({ processRunner: runner });

  const initial = await supervisor.startTask({
    type: 'serve',
    logicalCommand: 'component:dev',
    file: process.execPath,
    args: ['bin/cells.js', 'component:dev'],
    cwd: '/tmp/test',
    isServer: true,
    port: 8001
  });
  const firstPid = initial.pid;

  const restarted = await supervisor.restartTask(initial.id);
  assert.equal(restarted.status, 'running');
  assert.notEqual(restarted.pid, firstPid);

  await supervisor.stopAll();
});

test('contract: real Node process publishes PID, readiness, HMR, and test metrics before it exits', async () => {
  const logs = [];
  const hmrUpdates = [];
  const metrics = [];
  const supervisor = new TaskSupervisor({
    processRunner: new NodeProcessRunner(),
    onLog: entry => logs.push(entry),
    onHmrUpdate: file => hmrUpdates.push(file),
    onTestMetrics: value => metrics.push(value)
  });
  const port = await freeLocalPort();
  const childSource = [
    "import { createServer } from 'node:http';",
    `const server = createServer((_request, response) => response.end('ready')).listen(${port}, '127.0.0.1', () => {`,
    `console.log('Server ready: http://127.0.0.1:${port}/');`,
    "console.log('hmr update /src/academy-card.js');",
    "console.log('[vite] (client) page reload /src/academy-card-reloaded.js');",
    "console.log('7 passed');",
    'setTimeout(() => server.close(() => process.exit(0)), 180);',
    '});'
  ].join(' ');

  const task = await supervisor.startTask({
    type: 'serve',
    logicalCommand: 'component:dev',
    file: process.execPath,
    args: ['--input-type=module', '--eval', childSource],
    cwd: process.cwd(),
    isServer: true,
    port
  });

  await waitFor(() => supervisor.getTask(task.id)?.status === 'running');
  const readyTask = supervisor.getTask(task.id);
  assert.ok(readyTask.pid > 0);
  assert.equal(readyTask.url, `http://127.0.0.1:${port}/`);
  await waitFor(() => hmrUpdates.length === 2 && metrics.length === 1);
  assert.deepEqual(hmrUpdates, ['/src/academy-card.js', '/src/academy-card-reloaded.js']);
  assert.deepEqual(metrics, [{ passed: 7, failures: undefined, coveragePct: undefined }]);
  assert.ok(logs.some(entry => entry.message.includes('hmr update /src/academy-card.js')));
  assert.ok(logs.some(entry => entry.message.includes('page reload /src/academy-card-reloaded.js')));

  await waitFor(() => supervisor.getTask(task.id)?.status === 'passed');
  assert.equal(supervisor.getTask(task.id).url, undefined);
});

test('contract: TaskSupervisor withholds a PEM body split across live output chunks before it reaches the log buffer', async () => {
  const ringBuffer = new RingBuffer({ capacity: 20 });
  const supervisor = new TaskSupervisor({
    processRunner: {
      async run(request) {
        request.onStart?.({ pid: 3001 });
        request.onOutput?.({ stream: 'stdout', text: 'ordinary log\n-----BEGIN PRIVATE' });
        request.onOutput?.({ stream: 'stdout', text: ' KEY-----\nprivate-material-not-visible\n' });
        request.onOutput?.({ stream: 'stdout', text: '-----END PRIVATE KEY-----\nafter redaction\n' });
        return { exitCode: 0, signal: null, stdout: '', stderr: '', durationMs: 5 };
      }
    },
    onLog: entry => ringBuffer.append(entry)
  });

  const task = await supervisor.startTask({
    type: 'unit',
    logicalCommand: 'component:test',
    file: process.execPath,
    args: ['--version'],
    cwd: process.cwd()
  });

  await waitFor(() => supervisor.getTask(task.id)?.status === 'passed');
  const messages = ringBuffer.toArray().map(entry => entry.message);
  assert.deepEqual(messages, ['ordinary log', '[REDACTED_PEM]', 'after redaction']);
  assert.doesNotMatch(messages.join('\n'), /BEGIN PRIVATE|private-material-not-visible|END PRIVATE/);
});

test('contract: TaskSupervisor bounds newline-free live output while keeping a server alive and withholding a fragmented PEM', async () => {
  const ringBuffer = new RingBuffer({ capacity: 100, byteCapacity: 2_000_000 });
  let aborted = false;
  const supervisor = new TaskSupervisor({
    processRunner: {
      async run(request) {
        request.onStart?.({ pid: 3002 });
        for (let index = 0; index < 96; index += 1) {
          request.onOutput?.({ stream: 'stdout', text: 'x'.repeat(1024) });
        }
        request.onOutput?.({ stream: 'stderr', text: '-----BEGIN PRIVATE' });
        for (let index = 0; index < 32; index += 1) {
          request.onOutput?.({ stream: 'stderr', text: ` KEY-----private-fragment-${index}-${'z'.repeat(512)}` });
        }
        return new Promise(resolve => {
          request.signal?.addEventListener('abort', () => {
            aborted = true;
            resolve({ exitCode: 0, signal: 'SIGINT', stdout: '', stderr: '', durationMs: 5 });
          });
        });
      }
    },
    onLog: entry => ringBuffer.append(entry)
  });

  const task = await supervisor.startTask({
    type: 'serve',
    logicalCommand: 'component:dev',
    file: process.execPath,
    args: ['--version'],
    cwd: process.cwd(),
    isServer: true,
    port: 8001
  });

  const entries = ringBuffer.toArray();
  assert.equal(supervisor.getTask(task.id)?.status, 'starting');
  assert.equal(aborted, false);
  assert.ok(entries.length >= 6);
  assert.ok(entries.every(entry => Buffer.byteLength(entry.message, 'utf8') <= 16_384 + 32));
  assert.ok(entries.some(entry => entry.message.includes('[OUTPUT_TRUNCATED]')));
  assert.doesNotMatch(entries.map(entry => entry.message).join('\n'), /private-fragment|BEGIN PRIVATE/);
  assert.ok(entries.some(entry => entry.message === '[REDACTED_PEM]'));

  await supervisor.cancelTask(task.id);
  assert.equal(aborted, true);
  assert.equal(supervisor.getTask(task.id)?.status, 'stopped');
});

test('contract: TaskSupervisor carries PEM, env-secret, and authorization redaction across an exact partial-line boundary', async () => {
  const ringBuffer = new RingBuffer({ capacity: 100, byteCapacity: 2_000_000 });
  const supervisor = new TaskSupervisor({
    processRunner: {
      async run(request) {
        request.onStart?.({ pid: 3003 });
        request.onOutput?.({ stream: 'stdout', text: `${'p'.repeat(16_384 - '-----BE'.length)}-----BE` });
        request.onOutput?.({ stream: 'stdout', text: 'GIN PRIVATE KEY-----private-boundary-secret-----END PRIVATE KEY-----\n' });
        request.onOutput?.({ stream: 'stdout', text: `${'k'.repeat(16_384 - 'OPENAI_API_'.length)}OPENAI_API_` });
        request.onOutput?.({ stream: 'stdout', text: 'KEY=token-boundary-secret\n' });
        request.onOutput?.({ stream: 'stdout', text: `${'a'.repeat(16_384 - 'Authoriz'.length)}Authoriz` });
        request.onOutput?.({ stream: 'stdout', text: 'ation: Bearer auth-boundary-secret\n' });
        return new Promise(resolve => {
          request.signal?.addEventListener('abort', () => resolve({ exitCode: 0, signal: 'SIGINT', stdout: '', stderr: '', durationMs: 5 }));
        });
      }
    },
    onLog: entry => ringBuffer.append(entry)
  });

  const task = await supervisor.startTask({
    type: 'serve',
    logicalCommand: 'component:dev',
    file: process.execPath,
    args: ['--version'],
    cwd: process.cwd(),
    isServer: true,
    port: 8001
  });
  const visible = ringBuffer.toArray().map(entry => entry.message).join('\n');

  assert.doesNotMatch(visible, /BEGIN PRIVATE|private-boundary-secret|token-boundary-secret|auth-boundary-secret/);
  assert.match(visible, /\[REDACTED_PEM\]/);
  assert.match(visible, /= \[REDACTED_TOKEN\]/);
  assert.match(visible, /Authorization: \[REDACTED_AUTH\]/);

  await supervisor.cancelTask(task.id);
});

test('contract: TaskSupervisor withholds a URL Basic Auth value larger than a partial-line buffer', async () => {
  const ringBuffer = new RingBuffer({ capacity: 100, byteCapacity: 65_536 });
  const credential = 'url-basic-auth-secret-'.repeat(2_600);
  const urlPrefix = 'https://user:';
  const supervisor = new TaskSupervisor({
    processRunner: {
      async run(request) {
        request.onStart?.({ pid: 3004 });
        request.onOutput?.({
          stream: 'stdout',
          text: `${'x'.repeat(16_384 - urlPrefix.length)}${urlPrefix}`
        });
        for (let offset = 0; offset < credential.length; offset += 2_048) {
          request.onOutput?.({ stream: 'stdout', text: credential.slice(offset, offset + 2_048) });
        }
        request.onOutput?.({ stream: 'stdout', text: '@private.example.test/asset\n' });
        return { exitCode: 0, signal: null, stdout: '', stderr: '', durationMs: 5 };
      }
    },
    onLog: entry => ringBuffer.append(entry)
  });

  const task = await supervisor.startTask({
    type: 'unit',
    logicalCommand: 'component:test',
    file: process.execPath,
    args: ['--version'],
    cwd: process.cwd()
  });

  await waitFor(() => supervisor.getTask(task.id)?.status === 'passed');
  const messages = ringBuffer.toArray().map(entry => entry.message);
  const visible = messages.join('\n');
  assert.ok(credential.length > 57_000);
  assert.doesNotMatch(visible, /url-basic-auth-secret/);
  assert.doesNotMatch(visible, /https:\/\/user:/);
  assert.ok(messages.some(message => message.includes('https://[REDACTED_AUTH]')));
  assert.ok(messages.some(message => message.includes('@private.example.test/asset')));
  assert.ok(ringBuffer.byteLength <= ringBuffer.byteCapacity);
  assert.ok(messages.every(message => Buffer.byteLength(message, 'utf8') <= 16_384 + 32));
});

test('contract: TaskSupervisor withholds a localhost URL Basic Auth value larger than a partial-line buffer', async () => {
  const ringBuffer = new RingBuffer({ capacity: 100, byteCapacity: 65_536 });
  const credential = 'localhost-url-basic-auth-secret-'.repeat(2_100);
  const urlPrefix = 'https://localhost:';
  const supervisor = new TaskSupervisor({
    processRunner: {
      async run(request) {
        request.onStart?.({ pid: 3005 });
        request.onOutput?.({
          stream: 'stdout',
          text: `${'x'.repeat(16_384 - urlPrefix.length)}${urlPrefix}`
        });
        for (let offset = 0; offset < credential.length; offset += 2_048) {
          request.onOutput?.({ stream: 'stdout', text: credential.slice(offset, offset + 2_048) });
        }
        request.onOutput?.({ stream: 'stdout', text: '@private.example.test/asset\n' });
        return { exitCode: 0, signal: null, stdout: '', stderr: '', durationMs: 5 };
      }
    },
    onLog: entry => ringBuffer.append(entry)
  });

  const task = await supervisor.startTask({
    type: 'unit',
    logicalCommand: 'component:test',
    file: process.execPath,
    args: ['--version'],
    cwd: process.cwd()
  });

  await waitFor(() => supervisor.getTask(task.id)?.status === 'passed');
  const messages = ringBuffer.toArray().map(entry => entry.message);
  const visible = messages.join('\n');
  assert.ok(credential.length > 57_000);
  assert.doesNotMatch(visible, /localhost-url-basic-auth-secret/);
  assert.ok(messages.some(message => message.includes('https://[REDACTED_AUTH]')));
  assert.ok(messages.some(message => message.includes('@private.example.test/asset')));
  assert.ok(ringBuffer.byteLength <= ringBuffer.byteCapacity);
  assert.ok(messages.every(message => Buffer.byteLength(message, 'utf8') <= 16_384 + 32));
});

test('contract: TaskSupervisor does not trust an unrelated HTTP listener when the owned child stays silent', async () => {
  const port = await freeLocalPort();
  const unrelatedServer = createServer((_request, response) => response.end('not the owned child'));
  await new Promise((resolve, reject) => {
    unrelatedServer.once('error', reject);
    unrelatedServer.listen(port, '127.0.0.1', resolve);
  });
  const supervisor = new TaskSupervisor({ processRunner: new NodeProcessRunner() });
  try {
    const task = await supervisor.startTask({
      type: 'serve',
      logicalCommand: 'component:dev',
      file: process.execPath,
      args: ['--input-type=module', '--eval', 'setTimeout(() => {}, 1000);'],
      cwd: process.cwd(),
      isServer: true,
      port
    });

    await waitFor(() => supervisor.getTask(task.id)?.pid > 0);
    await new Promise(resolve => setTimeout(resolve, 150));
    assert.equal(supervisor.getTask(task.id)?.status, 'starting');
    assert.equal(supervisor.getTask(task.id)?.url, undefined);
    await supervisor.stopAll();
    assert.equal(supervisor.getTask(task.id)?.status, 'stopped');
  } finally {
    await supervisor.stopAll();
    await new Promise((resolve, reject) => unrelatedServer.close(error => (error ? reject(error) : resolve())));
  }
});

test('contract: TaskSupervisor keeps a local host-and-port ready line visible while awaiting its owned child', async () => {
  const port = await freeLocalPort();
  const supervisor = new TaskSupervisor({ processRunner: new NodeProcessRunner() });
  const source = `console.log('Server ready: http://localhost:${port}/'); setTimeout(() => {}, 1000);`;
  try {
    const task = await supervisor.startTask({
      type: 'serve',
      logicalCommand: 'component:dev',
      file: process.execPath,
      args: ['--input-type=module', '--eval', source],
      cwd: process.cwd(),
      isServer: true,
      port
    });

    await waitFor(() => supervisor.getTask(task.id)?.status === 'running');
    assert.equal(supervisor.getTask(task.id)?.url, `http://localhost:${port}/`);
  } finally {
    await supervisor.stopAll();
  }
});
