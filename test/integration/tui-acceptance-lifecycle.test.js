import assert from 'node:assert/strict';
import test from 'node:test';
import { createServer } from 'node:net';
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { PassThrough } from 'node:stream';

import { composeRecipe } from '../../src/recipes/compose-recipe.js';
import { inspectWorkspace } from '../../src/application/tui/workspace-inspector.js';
import { TaskSupervisor } from '../../src/adapters/node/task-supervisor.js';
import { NodeProcessRunner } from '../../src/adapters/node/process-runner.js';
import { RingBuffer } from '../../src/domain/tui/ring-buffer.js';
import { TitleAnimator } from '../../src/adapters/terminal/title-animator.js';
import { TuiController } from '../../src/application/tui/tui-controller.js';

const CLI_ROOT = path.resolve(import.meta.dirname, '../..');
const CLI_ENTRYPOINT = path.join(CLI_ROOT, 'bin', 'cells.js');
const LOCAL_NODE_MODULES = path.join(CLI_ROOT, 'node_modules');

async function waitFor(predicate, { timeoutMs = 20_000, intervalMs = 25 } = {}) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) {
      return;
    }
    await new Promise(resolve => setTimeout(resolve, intervalMs));
  }
  throw new Error(`Timed out after ${timeoutMs}ms`);
}

async function linkLocalDependencies(root) {
  await symlink(LOCAL_NODE_MODULES, path.join(root, 'node_modules'), process.platform === 'win32' ? 'junction' : 'dir');
}

async function directVitestDiagnostics(root, args = []) {
  try {
    return await new NodeProcessRunner().run({
      file: path.join(root, 'node_modules', '.bin', 'vitest'),
      args: ['run', 'test/unit', ...args],
      cwd: root,
      env: process.env
    });
  } catch (cause) {
    return cause?.details?.result ?? { stdout: '', stderr: String(cause?.cause ?? cause) };
  }
}

async function openViteHmrSocket(serverUrl, token) {
  const endpoint = new URL(serverUrl);
  endpoint.protocol = endpoint.protocol === 'https:' ? 'wss:' : 'ws:';
  endpoint.searchParams.set('token', token);
  const socket = new WebSocket(endpoint, 'vite-hmr');
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error('Timed out opening the Vite HMR socket.'));
    }, 5_000);
    socket.addEventListener('open', () => {
      clearTimeout(timeout);
      resolve();
    }, { once: true });
    socket.addEventListener('error', () => {
      clearTimeout(timeout);
      reject(new Error('Vite HMR socket failed to open.'));
    }, { once: true });
  });
  return socket;
}

function isPortFree(port) {
  return new Promise((resolve) => {
    const probe = createServer();
    probe.once('error', () => resolve(false));
    probe.listen(port, '127.0.0.1', () => {
      probe.close(() => resolve(true));
    });
  });
}

async function writeProjectFiles(root, files) {
  for (const [relativePath, content] of files) {
    const target = path.join(root, ...relativePath.split('/'));
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, content);
  }
}

async function scaffoldComponentFixture(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'open-cells-tui-comp-'));
  t.after(() => rm(root, { recursive: true, force: true }));

  const plan = composeRecipe('component', {
    kind: 'component',
    name: 'academy-card',
    namespace: '@academy'
  });

  const fileMap = new Map(plan.files.map(f => [f.path, f.content]));
  await writeProjectFiles(root, fileMap);
  return root;
}

async function scaffoldAppFixture(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'open-cells-tui-app-'));
  t.after(() => rm(root, { recursive: true, force: true }));

  const plan = composeRecipe('academy-app', {
    kind: 'app',
    name: 'academy-banking-app',
    cellsVersion: '4'
  });

  const fileMap = new Map(plan.files.map(f => [f.path, f.content]));
  await writeProjectFiles(root, fileMap);
  return root;
}

test('integration: controller lifecycle with mocked child processes preserves a component server PID', async t => {
  const compRoot = await scaffoldComponentFixture(t);
  const inspected = await inspectWorkspace(compRoot);
  assert.equal(inspected.type, 'component');

  let activeServerPid = null;
  let activeServerUrl = null;
  const spawnedPids = [];
  let nextPid = 45000;

  const mockRunner = {
    async run(request) {
      const pid = ++nextPid;
      spawnedPids.push(pid);
      request.onStart?.({ pid });

      if (request.isServer) {
        activeServerPid = pid;
        activeServerUrl = `http://127.0.0.1:${request.port ?? 8001}/`;
        request.onOutput?.({ stream: 'stdout', text: `Server ready: ${activeServerUrl}\n` });

        return new Promise((resolve) => {
          if (request.signal) {
            request.signal.addEventListener('abort', () => {
              activeServerPid = null;
              activeServerUrl = null;
              resolve({ exitCode: 0, signal: 'SIGINT', stdout: '', stderr: '', durationMs: 50 });
            });
          }
        });
      }

      return new Promise((resolve) => {
        if (request.signal) {
          request.signal.addEventListener('abort', () => {
            resolve({ exitCode: 0, signal: 'SIGINT', stdout: '', stderr: '', durationMs: 20 });
          });
        }
        setTimeout(() => {
          resolve({
            exitCode: 0,
            signal: null,
            stdout: '✓ test/unit/academy-card.test.js (3 passed)\nCoverage: 96.8% lines\n',
            stderr: '',
            durationMs: 40
          });
        }, 15);
      });
    }
  };

  const stdin = new PassThrough();
  stdin.setRawMode = () => {};
  const stdout = new PassThrough();
  stdout.columns = 120;
  stdout.rows = 30;

  const ringBuffer = new RingBuffer({ capacity: 500 });
  const titleAnimator = new TitleAnimator({ enabled: false });

  let controller;
  const supervisor = new TaskSupervisor({
    processRunner: mockRunner,
    onTaskUpdate: (task) => controller?.handleTaskUpdate(task),
    onLog: (log) => ringBuffer.append(log),
    onHmrUpdate: (file) => controller?.handleHmrUpdate(file),
    onTestMetrics: (metrics) => controller?.handleTestMetrics(metrics)
  });

  controller = new TuiController({
    workspace: inspected,
    stdin,
    stdout,
    supervisor,
    ringBuffer,
    titleAnimator,
    animationIntervalMs: 50
  });

  await controller.start();

  // 1. Launch Dev Server via 's'
  stdin.write('s');
  await new Promise(r => setTimeout(r, 25));

  assert.equal(controller.state.serverStatus?.status, 'running');
  assert.equal(controller.state.serverStatus?.url, 'http://127.0.0.1:8001/');
  const initialPid = controller.state.serverStatus?.pid;
  assert.ok(initialPid > 0);

  // 2. Launch Unit Tests via 'u' while Server is running
  stdin.write('u');
  await new Promise(r => setTimeout(r, 45));

  // Assert server is STILL running with exact same PID!
  assert.equal(controller.state.serverStatus?.status, 'running');
  assert.equal(controller.state.serverStatus?.pid, initialPid);
  assert.equal(activeServerPid, initialPid);

  // 3. Launch Coverage via 'c' while Server is running
  stdin.write('c');
  await new Promise(r => setTimeout(r, 45));

  // Assert server is STILL running with exact same PID!
  assert.equal(controller.state.serverStatus?.status, 'running');
  assert.equal(controller.state.serverStatus?.pid, initialPid);
  assert.equal(activeServerPid, initialPid);

  // 4. Simulate HMR event on source change
  controller.handleHmrUpdate('/src/AcademyCard.js');
  assert.equal(controller.state.lastHmr?.file, 'src/AcademyCard.js');

  // 5. Close TUI cleanly
  stdin.write('q');
  assert.equal(controller.state.modal, 'confirm_quit');
  stdin.write('y');
  await new Promise(r => setTimeout(r, 30));

  assert.equal(controller.isClosed, true);
  assert.equal(activeServerPid, null);

  const portFree = await isPortFree(8001);
  assert.equal(portFree, true);
});

test('integration: controller lifecycle with mocked child processes handles an app server and tests', async t => {
  const appRoot = await scaffoldAppFixture(t);
  const inspected = await inspectWorkspace(appRoot);
  assert.equal(inspected.type, 'app');

  let activeServerPid = null;
  let activeServerUrl = null;
  let nextPid = 50000;

  const mockRunner = {
    async run(request) {
      const pid = ++nextPid;
      request.onStart?.({ pid });

      if (request.isServer) {
        activeServerPid = pid;
        activeServerUrl = `http://127.0.0.1:${request.port ?? 8001}/`;
        request.onOutput?.({ stream: 'stdout', text: `Server ready: ${activeServerUrl}\n` });

        return new Promise((resolve) => {
          if (request.signal) {
            request.signal.addEventListener('abort', () => {
              activeServerPid = null;
              activeServerUrl = null;
              resolve({ exitCode: 0, signal: 'SIGINT', stdout: '', stderr: '', durationMs: 50 });
            });
          }
        });
      }

      return new Promise((resolve) => {
        setTimeout(() => {
          resolve({
            exitCode: 0,
            signal: null,
            stdout: '12 passed\nCoverage: 99.1% lines\n',
            stderr: '',
            durationMs: 35
          });
        }, 15);
      });
    }
  };

  const stdin = new PassThrough();
  stdin.setRawMode = () => {};
  const stdout = new PassThrough();
  stdout.columns = 120;
  stdout.rows = 30;

  const ringBuffer = new RingBuffer({ capacity: 500 });
  const titleAnimator = new TitleAnimator({ enabled: false });

  let controller;
  const supervisor = new TaskSupervisor({
    processRunner: mockRunner,
    onTaskUpdate: (task) => controller?.handleTaskUpdate(task),
    onLog: (log) => ringBuffer.append(log)
  });

  controller = new TuiController({
    workspace: inspected,
    stdin,
    stdout,
    supervisor,
    ringBuffer,
    titleAnimator,
    animationIntervalMs: 50
  });

  await controller.start();

  // 1. Start App server via 's'
  stdin.write('s');
  await new Promise(r => setTimeout(r, 25));
  assert.equal(controller.state.serverStatus?.status, 'running');
  const appServePid = controller.state.serverStatus?.pid;
  assert.ok(appServePid > 0);

  // 2. Run App unit tests via 'u'
  stdin.write('u');
  await new Promise(r => setTimeout(r, 45));
  assert.equal(controller.state.serverStatus?.pid, appServePid); // PID preserved!

  // 3. Exit TUI
  stdin.write('q');
  stdin.write('y');
  await new Promise(r => setTimeout(r, 30));

  assert.equal(controller.isClosed, true);
  assert.equal(activeServerPid, null);
});

test('acceptance: real controller, supervisor, and runner serve a generated component while tests run', async t => {
  const root = await scaffoldComponentFixture(t);
  await linkLocalDependencies(root);
  assert.equal(await isPortFree(8001), true, 'the real TUI fixture requires its owned localhost port');

  const inspected = await inspectWorkspace(root);
  assert.equal(inspected.type, 'component');

  const stdin = new PassThrough();
  stdin.setRawMode = () => {};
  const stdout = new PassThrough();
  stdout.columns = 120;
  stdout.rows = 30;
  const ringBuffer = new RingBuffer({ capacity: 500 });
  let controller;
  let hmrSocket;
  const supervisor = new TaskSupervisor({
    processRunner: new NodeProcessRunner(),
    onTaskUpdate: task => controller?.handleTaskUpdate(task),
    onLog: entry => controller?.handleLog(entry),
    onHmrUpdate: file => controller?.handleHmrUpdate(file),
    onTestMetrics: metrics => controller?.handleTestMetrics(metrics)
  });
  controller = new TuiController({
    workspace: inspected,
    stdin,
    stdout,
    supervisor,
    ringBuffer,
    titleAnimator: new TitleAnimator({ enabled: false }),
    cliEntrypoint: CLI_ENTRYPOINT
  });

  try {
    await controller.start();
    stdin.write('s');
    await waitFor(() => controller.state.serverStatus?.status === 'running');

    const server = supervisor.getActiveServer();
    assert.ok(server?.pid > 0);
    assert.deepEqual(server.args.slice(0, 2), [CLI_ENTRYPOINT, 'component:dev']);
    assert.equal(server.url, 'http://127.0.0.1:8001/');
    const serverPid = server.pid;

    await waitFor(async () => {
      try {
        return (await fetch(server.url)).status === 200;
      } catch {
        return false;
      }
    });
    const viteClient = await fetch(`${server.url}@vite/client`);
    assert.equal(viteClient.status, 200);
    const viteClientSource = await viteClient.text();
    assert.match(viteClientSource, /createHotContext/);
    const token = viteClientSource.match(/const wsToken = "([^"]+)"/)?.[1];
    assert.ok(token);
    hmrSocket = await openViteHmrSocket(server.url, token);

    const sourcePath = path.join(root, 'index.html');
    await writeFile(sourcePath, `${await readFile(sourcePath, 'utf8')}\n<!-- TUI acceptance HMR mutation -->\n`);
    try {
      await waitFor(() => controller.state.lastHmr?.file === 'index.html', { timeoutMs: 10_000 });
    } catch {
      assert.fail(`Vite did not publish an observable HMR path: ${ringBuffer.toArray().map(entry => entry.message).join('\n')}`);
    }

    stdin.write('u');
    await waitFor(() => {
      const unit = supervisor.getAllTasks().find(task => task.type === 'unit');
      if (unit?.status === 'failed') {
        return directVitestDiagnostics(root).then(result => {
          assert.fail(`${result.stdout}\n${result.stderr}`);
        });
      }
      assert.notEqual(unit?.status, 'failed', ringBuffer.toArray().map(entry => entry.message).join('\n'));
      return unit?.status === 'passed';
    });
    assert.equal(supervisor.getActiveServer()?.pid, serverPid);

    stdin.write('c');
    await waitFor(() => {
      const coverage = supervisor.getAllTasks().find(task => task.type === 'coverage');
      if (coverage?.status === 'failed') {
        return directVitestDiagnostics(root, ['--coverage']).then(result => {
          assert.fail(`${result.stdout}\n${result.stderr}`);
        });
      }
      assert.notEqual(coverage?.status, 'failed', ringBuffer.toArray().map(entry => entry.message).join('\n'));
      return coverage?.status === 'passed';
    });
    assert.equal(supervisor.getActiveServer()?.pid, serverPid);
    assert.match(await readFile(path.join(root, 'test', 'coverage', 'lcov.info'), 'utf8'), /SF:/);

    await controller.close();
    assert.equal(controller.isClosed, true);
    await waitFor(() => isPortFree(8001), { timeoutMs: 5_000 });
    assert.throws(() => process.kill(serverPid, 0), error => error?.code === 'ESRCH');
  } finally {
    hmrSocket?.close();
    await controller?.close();
  }
});
