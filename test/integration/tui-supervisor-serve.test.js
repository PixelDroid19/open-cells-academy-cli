import assert from 'node:assert/strict';
import test from 'node:test';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';

import { TuiController } from '../../src/application/tui/tui-controller.js';
import { startTui } from '../../src/application/tui/start-tui.js';
import { TaskSupervisor } from '../../src/adapters/node/task-supervisor.js';
import { TitleAnimator } from '../../src/adapters/terminal/title-animator.js';
import { RingBuffer } from '../../src/domain/tui/ring-buffer.js';

class MockProcessRunner {
  constructor() {
    this.runs = [];
    this.nextPid = 2000;
  }

  async run(request) {
    const pid = ++this.nextPid;
    this.runs.push({ request, pid });

    return new Promise((resolve) => {
      request.onStart?.({ pid });
      if (request.isServer) {
        request.onOutput?.({ stream: 'stdout', text: 'Server ready: http://127.0.0.1:8001/\n' });
      }

      if (request.signal) {
        request.signal.addEventListener('abort', () => {
          resolve({ exitCode: 0, signal: 'SIGINT', stdout: '', stderr: '', durationMs: 20 });
        });
      }

      if (!request.isServer) {
        setTimeout(() => {
          resolve({
            exitCode: 0,
            signal: null,
            stdout: '10 passed\nCoverage: 98.5%\n',
            stderr: '',
            durationMs: 30
          });
        }, 10);
      }
    });
  }
}

function createMockTerminal() {
  const stdin = new PassThrough();
  stdin.setRawMode = () => {};
  const stdout = new PassThrough();
  stdout.columns = 120;
  stdout.rows = 30;
  return { stdin, stdout };
}

test('integration: TuiController handles serve, test, coverage shortcuts without interrupting serve PID', async () => {
  const { stdin, stdout } = createMockTerminal();
  const runner = new MockProcessRunner();
  const ringBuffer = new RingBuffer({ capacity: 100 });
  const titleAnimator = new TitleAnimator({ enabled: false });

  let supervisor;
  let controller;

  supervisor = new TaskSupervisor({
    processRunner: runner,
    onTaskUpdate: (task) => controller?.handleTaskUpdate(task),
    onLog: (log) => ringBuffer.append(log)
  });

  controller = new TuiController({
    workspace: { name: 'my-button', type: 'component', root: '/tmp/comp' },
    stdin,
    stdout,
    supervisor,
    ringBuffer,
    titleAnimator,
    animationIntervalMs: 50
  });

  await controller.start();

  // 1. Press 's' to start dev server
  stdin.write('s');
  await new Promise(r => setTimeout(r, 20));

  const state1 = controller.state;
  assert.equal(state1.serverStatus?.status, 'running');
  assert.equal(state1.serverStatus?.url, 'http://127.0.0.1:8001/');
  const servePid = state1.serverStatus?.pid;
  assert.ok(servePid > 0);

  // 2. Press 'u' to run unit tests while server is active
  stdin.write('u');
  await new Promise(r => setTimeout(r, 40));

  const state2 = controller.state;
  assert.equal(state2.serverStatus?.status, 'running');
  assert.equal(state2.serverStatus?.pid, servePid); // PID preserved!

  // 3. Press 'c' to run coverage while server is active
  stdin.write('c');
  await new Promise(r => setTimeout(r, 40));

  const state3 = controller.state;
  assert.equal(state3.serverStatus?.status, 'running');
  assert.equal(state3.serverStatus?.pid, servePid); // PID still preserved!

  // 4. Press 'l' to toggle log filter
  stdin.write('l');
  assert.equal(controller.state.logFilter, 'serve');

  // 5. Press 'q' then 'y' to confirm exit
  stdin.write('q');
  assert.equal(controller.state.modal, 'confirm_quit');
  stdin.write('y');
  await new Promise(r => setTimeout(r, 20));

  assert.equal(controller.isClosed, true);
});

test('integration: TuiController invokes an injected absolute CLI entrypoint from the supervised workspace', async t => {
  const { stdin, stdout } = createMockTerminal();
  const runner = new MockProcessRunner();
  const ringBuffer = new RingBuffer({ capacity: 100 });
  const titleAnimator = new TitleAnimator({ enabled: false });
  const entrypoint = '/opt/open-cells-academy-cli/bin/cells.js';
  let controller;
  t.after(async () => controller?.close());
  const supervisor = new TaskSupervisor({
    processRunner: runner,
    onTaskUpdate: task => controller?.handleTaskUpdate(task),
    onLog: entry => ringBuffer.append(entry)
  });
  controller = new TuiController({
    workspace: { name: 'my-button', type: 'component', root: '/tmp/generated-component' },
    stdin,
    stdout,
    supervisor,
    ringBuffer,
    titleAnimator,
    cliEntrypoint: entrypoint
  });

  await controller.start();
  stdin.write('s');
  await new Promise(resolve => setTimeout(resolve, 20));

  assert.deepEqual(runner.runs[0].request.args, [entrypoint, 'component:dev', '--host', '127.0.0.1', '--port', '8001', '--strictPort', '--no-open']);
  await controller.close();
});

test('integration: TuiController selects WTR flags for legacy unit and coverage tasks', async t => {
  const { stdin, stdout } = createMockTerminal();
  const requests = [];
  const controller = new TuiController({
    workspace: {
      name: '@academy/legacy-button',
      type: 'component',
      root: '/tmp/legacy-component',
      testRunner: 'wtr'
    },
    stdin,
    stdout,
    supervisor: {
      async startTask(request) {
        requests.push(request);
        return { id: `task-${requests.length}` };
      },
      async stopAll() {}
    },
    ringBuffer: new RingBuffer({ capacity: 10 }),
    titleAnimator: new TitleAnimator({ enabled: false }),
    cliEntrypoint: '/opt/cells/bin/cells.js'
  });
  t.after(async () => controller.close());

  await controller.start();
  stdin.write('u');
  await new Promise(resolve => setTimeout(resolve, 10));
  stdin.write('c');
  await new Promise(resolve => setTimeout(resolve, 10));

  assert.deepEqual(requests[0].args, ['/opt/cells/bin/cells.js', 'component:test', '--wtr']);
  assert.deepEqual(requests[1].args, ['/opt/cells/bin/cells.js', 'component:test', '--wtr', '--coverage']);
});

test('integration: TuiController keeps Vitest unit and coverage arguments for modern projects', async t => {
  const { stdin, stdout } = createMockTerminal();
  const requests = [];
  const controller = new TuiController({
    workspace: {
      name: '@academy/modern-button',
      type: 'component',
      root: '/tmp/modern-component',
      testRunner: 'vitest'
    },
    stdin,
    stdout,
    supervisor: {
      async startTask(request) {
        requests.push(request);
        return { id: `task-${requests.length}` };
      },
      async stopAll() {}
    },
    ringBuffer: new RingBuffer({ capacity: 10 }),
    titleAnimator: new TitleAnimator({ enabled: false }),
    cliEntrypoint: '/opt/cells/bin/cells.js'
  });
  t.after(async () => controller.close());

  await controller.start();
  stdin.write('u');
  await new Promise(resolve => setTimeout(resolve, 10));
  stdin.write('c');
  await new Promise(resolve => setTimeout(resolve, 10));

  assert.deepEqual(requests[0].args, ['/opt/cells/bin/cells.js', 'component:test']);
  assert.deepEqual(requests[1].args, ['/opt/cells/bin/cells.js', 'component:test', '--coverage']);
});

test('integration: TuiController handles SIGTERM by stopping tasks and restoring terminal resources', async t => {
  const { stdin, stdout } = createMockTerminal();
  const rawModeCalls = [];
  stdin.setRawMode = enabled => rawModeCalls.push(enabled);
  const signalSource = new EventEmitter();
  const runner = new MockProcessRunner();
  const ringBuffer = new RingBuffer({ capacity: 100 });
  const titleAnimator = new TitleAnimator({ enabled: false });
  let controller;
  t.after(async () => controller?.close());
  const supervisor = new TaskSupervisor({
    processRunner: runner,
    onTaskUpdate: task => controller?.handleTaskUpdate(task),
    onLog: entry => ringBuffer.append(entry)
  });
  controller = new TuiController({
    workspace: { name: 'my-button', type: 'component', root: '/tmp/component' },
    stdin,
    stdout,
    supervisor,
    ringBuffer,
    titleAnimator,
    signalSource
  });

  await controller.start();
  stdin.write('s');
  await new Promise(resolve => setTimeout(resolve, 20));
  signalSource.emit('SIGTERM');
  await new Promise(resolve => setTimeout(resolve, 20));

  assert.equal(controller.isClosed, true);
  assert.deepEqual(rawModeCalls, [true, false]);
  assert.equal(stdin.listenerCount('data'), 0);
  assert.equal(stdout.listenerCount('resize'), 0);
  assert.equal(signalSource.listenerCount('SIGINT'), 0);
  assert.equal(signalSource.listenerCount('SIGTERM'), 0);
  assert.equal(stdin.isPaused(), true);
});

test('integration: TuiController rolls terminal resources back when raw mode setup throws', async () => {
  const { stdin, stdout } = createMockTerminal();
  const output = [];
  const rawModeCalls = [];
  const signalSource = new EventEmitter();
  let stopAllCalls = 0;
  stdin.setRawMode = enabled => {
    rawModeCalls.push(enabled);
    if (enabled) {
      throw new Error('raw mode unavailable');
    }
  };
  stdout.on('data', chunk => output.push(String(chunk)));
  const controller = new TuiController({
    stdin,
    stdout,
    signalSource,
    supervisor: { async stopAll() { stopAllCalls += 1; } },
    ringBuffer: new RingBuffer({ capacity: 10 }),
    titleAnimator: new TitleAnimator({ enabled: true, env: {} }),
    animationIntervalMs: 5
  });

  await assert.rejects(controller.start(), /raw mode unavailable/);
  const restored = output.join('');
  assert.match(restored, /\x1b\[\?1049h\x1b\[\?25l/);
  assert.match(restored, /\x1b\[\?25h\x1b\[\?1049l/);
  assert.deepEqual(rawModeCalls, [true, false]);
  assert.equal(stopAllCalls, 1);
  assert.equal(controller.isClosed, true);
  assert.deepEqual(await controller.closed, { exitCode: 1 });
  assert.equal(stdin.listenerCount('data'), 0);
  assert.equal(stdout.listenerCount('resize'), 0);
  assert.equal(signalSource.listenerCount('SIGINT'), 0);
  assert.equal(signalSource.listenerCount('SIGTERM'), 0);
  assert.equal(stdin.isPaused(), true);
});

for (const modal of ['help', 'create', 'confirm_quit']) {
  test(`integration: raw Ctrl-C closes the TUI from the ${modal} modal`, async () => {
    const { stdin, stdout } = createMockTerminal();
    const rawModeCalls = [];
    stdin.setRawMode = enabled => rawModeCalls.push(enabled);
    let stopAllCalls = 0;
    const controller = new TuiController({
      stdin,
      stdout,
      supervisor: {
        async stopAll() {
          stopAllCalls += 1;
        }
      },
      ringBuffer: new RingBuffer({ capacity: 10 }),
      titleAnimator: new TitleAnimator({ enabled: false })
    });

    try {
      await controller.start();
      controller.dispatch({ type: 'OPEN_MODAL', modal });
      stdin.write('\x03');

      const result = await Promise.race([
        controller.closed,
        new Promise(resolve => setTimeout(() => resolve(undefined), 50))
      ]);
      assert.deepEqual(result, { exitCode: 130 });
      assert.equal(controller.isClosed, true);
      assert.equal(stopAllCalls, 1);
      assert.deepEqual(rawModeCalls, [true, false]);
      assert.equal(stdin.listenerCount('data'), 0);
      assert.equal(stdout.listenerCount('resize'), 0);
      assert.equal(stdin.isPaused(), true);
    } finally {
      await controller.close();
    }
  });
}

test('integration: disabled title animation does not schedule repeated full-screen redraws', async t => {
  const { stdin, stdout } = createMockTerminal();
  let writes = 0;
  const originalWrite = stdout.write.bind(stdout);
  stdout.write = chunk => {
    writes += 1;
    return originalWrite(chunk);
  };
  const ringBuffer = new RingBuffer({ capacity: 100 });
  const titleAnimator = new TitleAnimator({ enabled: false });
  const controller = new TuiController({
    stdin,
    stdout,
    supervisor: { async stopAll() {} },
    ringBuffer,
    titleAnimator,
    animationIntervalMs: 10
  });
  t.after(async () => controller.close());

  await controller.start();
  const writesAfterInitialRender = writes;
  await new Promise(resolve => setTimeout(resolve, 45));

  assert.equal(writes, writesAfterInitialRender);
});

test('integration: streamed logs redraw while title animation is disabled', async t => {
  const { stdin, stdout } = createMockTerminal();
  const frames = [];
  stdout.on('data', chunk => frames.push(String(chunk)));
  const ringBuffer = new RingBuffer({ capacity: 100 });
  let controller;
  const supervisor = new TaskSupervisor({
    processRunner: {
      async run(request) {
        request.onStart?.({ pid: 3002 });
        request.onOutput?.({ stream: 'stdout', text: 'live-log-visible-without-animation\n' });
        return { exitCode: 0, signal: null, stdout: '', stderr: '', durationMs: 5 };
      }
    },
    onTaskUpdate: task => controller?.handleTaskUpdate(task),
    onLog: entry => controller?.handleLog(entry)
  });
  controller = new TuiController({
    workspace: { name: 'my-component', type: 'component', root: '/tmp/component' },
    stdin,
    stdout,
    supervisor,
    ringBuffer,
    titleAnimator: new TitleAnimator({ enabled: false })
  });
  t.after(async () => controller.close());

  await controller.start();
  stdin.write('u');
  await new Promise(resolve => setTimeout(resolve, 20));

  assert.match(frames.join(''), /live-log-visible-without-animation/);
});

test('integration: TuiController coalesces a burst of streamed log redraws', async t => {
  const { stdin, stdout } = createMockTerminal();
  let writes = 0;
  const frames = [];
  const originalWrite = stdout.write.bind(stdout);
  stdout.write = chunk => {
    writes += 1;
    frames.push(String(chunk));
    return originalWrite(chunk);
  };
  const controller = new TuiController({
    stdin,
    stdout,
    supervisor: { async stopAll() {} },
    ringBuffer: new RingBuffer({ capacity: 20 }),
    titleAnimator: new TitleAnimator({ enabled: false }),
    logRedrawDelayMs: 20
  });
  t.after(async () => controller.close());

  await controller.start();
  const writesBeforeLogs = writes;
  controller.handleLog({ taskId: 'serve', type: 'serve', message: 'first-log', timestamp: 1 });
  controller.handleLog({ taskId: 'serve', type: 'serve', message: 'second-log', timestamp: 2 });
  controller.handleLog({ taskId: 'serve', type: 'serve', message: 'third-log', timestamp: 3 });

  assert.equal(writes, writesBeforeLogs);
  await new Promise(resolve => setTimeout(resolve, 35));
  assert.equal(writes, writesBeforeLogs + 1);
  assert.match(frames.join(''), /third-log/);
});

test('integration: streamed log activity wakes an idle title animator', async t => {
  const { stdin, stdout } = createMockTerminal();
  const titleAnimator = new TitleAnimator({ enabled: true, env: {}, idleTimeoutMs: 5 });
  const controller = new TuiController({
    stdin,
    stdout,
    supervisor: { async stopAll() {} },
    ringBuffer: new RingBuffer({ capacity: 20 }),
    titleAnimator,
    animationIntervalMs: 5,
    logRedrawDelayMs: 20
  });
  t.after(async () => controller.close());

  await controller.start();
  await new Promise(resolve => setTimeout(resolve, 30));
  assert.equal(titleAnimator.isSuspended, true);

  controller.handleLog({ taskId: 'serve', type: 'serve', message: 'wakes-title', timestamp: 1 });
  assert.equal(titleAnimator.isSuspended, false);
});

test('integration: TuiController removes renderer colors when color output is disabled', async t => {
  const { stdin, stdout } = createMockTerminal();
  const output = [];
  stdout.on('data', chunk => output.push(String(chunk)));
  const controller = new TuiController({
    stdin,
    stdout,
    supervisor: { async stopAll() {} },
    ringBuffer: new RingBuffer({ capacity: 10 }),
    titleAnimator: new TitleAnimator({ enabled: true, env: {} }),
    colorEnabled: false
  });
  t.after(async () => controller.close());

  await controller.start();

  assert.doesNotMatch(output.join(''), /\x1b\[[0-9;]*m/);
});

test('integration: startTui honors NO_COLOR for its complete terminal frame', async () => {
  const { stdin, stdout } = createMockTerminal();
  const output = [];
  const started = new Promise(resolve => stdout.once('data', resolve));
  stdout.on('data', chunk => output.push(String(chunk)));
  const result = startTui({
    cwd: '/tmp',
    env: { NO_COLOR: '1' },
    stdin,
    stdout,
    animation: true
  });

  await started;
  stdin.write('q');
  assert.deepEqual(await result, { ok: true, data: { status: 'tui_closed', exitCode: 0 } });
  assert.doesNotMatch(output.join(''), /\x1b\[[0-9;]*m/);
});

test('integration: TuiController coalesces resize redraws and cancels the debounce on close', async () => {
  const { stdin, stdout } = createMockTerminal();
  let writes = 0;
  const originalWrite = stdout.write.bind(stdout);
  stdout.write = chunk => {
    writes += 1;
    return originalWrite(chunk);
  };
  const controller = new TuiController({
    stdin,
    stdout,
    supervisor: { async stopAll() {} },
    ringBuffer: new RingBuffer({ capacity: 10 }),
    titleAnimator: new TitleAnimator({ enabled: false }),
    resizeDebounceMs: 30
  });

  await controller.start();
  const initialWrites = writes;
  stdout.emit('resize');
  stdout.emit('resize');
  stdout.emit('resize');
  await new Promise(resolve => setTimeout(resolve, 10));
  assert.equal(writes, initialWrites);
  await new Promise(resolve => setTimeout(resolve, 45));
  assert.equal(writes, initialWrites + 1);

  await controller.close();
  const writesAfterClose = writes;
  stdout.emit('resize');
  await new Promise(resolve => setTimeout(resolve, 45));
  assert.equal(writes, writesAfterClose);
});

test('integration: idle title animation stops full-screen redraws', async t => {
  const { stdin, stdout } = createMockTerminal();
  let writes = 0;
  const originalWrite = stdout.write.bind(stdout);
  stdout.write = chunk => {
    writes += 1;
    return originalWrite(chunk);
  };
  const titleAnimator = new TitleAnimator({ enabled: true, env: {}, idleTimeoutMs: 5 });
  const controller = new TuiController({
    stdin,
    stdout,
    supervisor: { async stopAll() {} },
    ringBuffer: new RingBuffer({ capacity: 10 }),
    titleAnimator,
    animationIntervalMs: 5
  });
  t.after(async () => controller.close());

  await controller.start();
  await new Promise(resolve => setTimeout(resolve, 45));
  assert.equal(titleAnimator.isSuspended, true);
  const writesAfterIdle = writes;
  await new Promise(resolve => setTimeout(resolve, 35));
  assert.equal(writes, writesAfterIdle);
});

test('integration: active title ticks patch only the header instead of redrawing panes', async t => {
  const { stdin, stdout } = createMockTerminal();
  const output = [];
  stdout.on('data', chunk => output.push(String(chunk)));
  const controller = new TuiController({
    stdin,
    stdout,
    supervisor: { async stopAll() {} },
    ringBuffer: new RingBuffer({ capacity: 10 }),
    titleAnimator: new TitleAnimator({ enabled: true, env: {}, idleTimeoutMs: 10_000 }),
    animationIntervalMs: 5
  });
  t.after(async () => controller.close());

  await controller.start();
  output.length = 0;
  await new Promise(resolve => setTimeout(resolve, 30));

  assert.ok(output.length > 0);
  for (const tick of output) {
    const plainTick = tick.replace(/\x1b\[[0-9;]*m/g, '');
    assert.match(plainTick, /ACADEMY CELLS/);
    assert.doesNotMatch(tick, /\x1b\[2J\x1b\[H/);
    assert.doesNotMatch(tick, /COMMANDS|ACTIVE TASKS|LOGS/);
  }
});

test('integration: TuiController suspends title animation after an injected terminal blur event', async t => {
  const { stdin, stdout } = createMockTerminal();
  const terminalEvents = new EventEmitter();
  let writes = 0;
  const originalWrite = stdout.write.bind(stdout);
  stdout.write = chunk => {
    writes += 1;
    return originalWrite(chunk);
  };
  const titleAnimator = new TitleAnimator({ enabled: true, env: {}, idleTimeoutMs: 10_000 });
  const controller = new TuiController({
    stdin,
    stdout,
    terminalEvents,
    supervisor: { async stopAll() {} },
    ringBuffer: new RingBuffer({ capacity: 10 }),
    titleAnimator,
    animationIntervalMs: 5
  });
  t.after(async () => controller.close());

  await controller.start();
  await new Promise(resolve => setTimeout(resolve, 15));
  terminalEvents.emit('blur');
  assert.equal(titleAnimator.isSuspended, true);
  const writesAfterBlur = writes;
  await new Promise(resolve => setTimeout(resolve, 25));
  assert.equal(writes, writesAfterBlur);

  await controller.close();
  assert.equal(terminalEvents.listenerCount('blur'), 0);
});

test('integration: TuiController shows HMR files relative to the workspace or as a safe basename', async t => {
  const { stdin, stdout } = createMockTerminal();
  const controller = new TuiController({
    workspace: { name: 'academy', type: 'component', root: '/tmp/academy-workspace' },
    stdin,
    stdout,
    supervisor: { async stopAll() {} },
    ringBuffer: new RingBuffer({ capacity: 10 }),
    titleAnimator: new TitleAnimator({ enabled: false })
  });
  t.after(async () => controller.close());

  await controller.start();
  controller.handleHmrUpdate('/tmp/academy-workspace/src/mañana-card.js');
  assert.equal(controller.state.lastHmr.file, 'src/mañana-card.js');

  controller.handleHmrUpdate('/home/private-user/credentials/secret-card.js');
  assert.equal(controller.state.lastHmr.file, 'secret-card.js');

  controller.handleHmrUpdate('/src/academy-card.js');
  assert.equal(controller.state.lastHmr.file, 'src/academy-card.js');
});

test('integration: TuiController edits a search query and pages logs from real key sequences', async t => {
  const { stdin, stdout } = createMockTerminal();
  const ringBuffer = new RingBuffer({ capacity: 100 });
  for (let index = 0; index < 30; index += 1) {
    ringBuffer.append({ taskId: 'serve', type: 'serve', message: `line ${index}`, timestamp: index + 1 });
  }
  const controller = new TuiController({
    stdin,
    stdout,
    supervisor: {
      async stopAll() {},
      getActiveServer() { return null; },
      async startTask() {}
    },
    ringBuffer,
    titleAnimator: new TitleAnimator({ enabled: false })
  });
  t.after(async () => controller.close());

  await controller.start();
  stdin.write('/');
  stdin.write('t');
  stdin.write('e');
  stdin.write('s');
  stdin.write('t');
  await new Promise(resolve => setTimeout(resolve, 10));
  assert.equal(controller.state.searchActive, true);
  assert.equal(controller.state.searchQuery, 'test');

  stdin.write('\x7f');
  stdin.write('\x1b');
  await new Promise(resolve => setTimeout(resolve, 10));
  assert.equal(controller.state.searchActive, false);
  assert.equal(controller.state.searchQuery, '');

  stdin.write('/');
  stdin.write('locales');
  await new Promise(resolve => setTimeout(resolve, 10));
  assert.equal(controller.state.searchQuery, 'locales');
  stdin.write('\x1b');
  await new Promise(resolve => setTimeout(resolve, 10));
  assert.equal(controller.state.searchQuery, '');

  stdin.write('\t');
  stdin.write('\t');
  stdin.write('\x1b[5~');
  await new Promise(resolve => setTimeout(resolve, 10));
  assert.equal(controller.state.focusedPanel, 'logs');
  assert.equal(controller.state.autoScroll, false);
  assert.equal(controller.state.logOffset, 10);

  stdin.write('\x1b[6~');
  stdin.write('\x1b[F');
  await new Promise(resolve => setTimeout(resolve, 10));
  assert.equal(controller.state.autoScroll, true);
  assert.equal(controller.state.logOffset, 0);
});

test('integration: TuiController counts unseen logs while scrolled and clears the indicator on live return', async t => {
  const { stdin, stdout } = createMockTerminal();
  const frames = [];
  stdout.on('data', chunk => frames.push(String(chunk)));
  const ringBuffer = new RingBuffer({ capacity: 100 });
  for (let index = 0; index < 30; index += 1) {
    ringBuffer.append({ taskId: 'serve', type: 'serve', message: `existing ${index}`, timestamp: index + 1 });
  }
  const controller = new TuiController({
    stdin,
    stdout,
    supervisor: { async stopAll() {} },
    ringBuffer,
    titleAnimator: new TitleAnimator({ enabled: false }),
    logRedrawDelayMs: 5
  });
  t.after(async () => controller.close());

  await controller.start();
  stdin.write('\t\t');
  stdin.write('\x1b[5~');
  await new Promise(resolve => setTimeout(resolve, 10));
  assert.equal(controller.state.focusedPanel, 'logs');
  assert.equal(controller.state.autoScroll, false);

  frames.length = 0;
  controller.handleLog({ taskId: 'serve', type: 'serve', message: 'first unseen log', timestamp: 100 });
  controller.handleLog({ taskId: 'serve', type: 'serve', message: 'second unseen log', timestamp: 101 });
  controller.handleLog({ taskId: 'serve', type: 'serve', message: 'third unseen log', timestamp: 102 });
  await new Promise(resolve => setTimeout(resolve, 20));

  assert.equal(controller.state.unseenLogCount, 3);
  assert.match(frames.join(''), /\[NEW LOGS AVAILABLE \(3\)\]/);

  frames.length = 0;
  stdin.write('\x1b[F');
  await new Promise(resolve => setTimeout(resolve, 10));
  assert.equal(controller.state.autoScroll, true);
  assert.equal(controller.state.unseenLogCount, 0);
  assert.doesNotMatch(frames.join(''), /NEW LOGS AVAILABLE/);
});

test('integration: TuiController derives app task options, runs E2E, and opens only a ready local URL', async t => {
  const { stdin, stdout } = createMockTerminal();
  const requests = [];
  const openedUrls = [];
  let activeServer = null;
  const supervisor = {
    getActiveServer() { return activeServer; },
    async startTask(request) {
      requests.push(request);
      if (request.type === 'serve') {
        activeServer = { id: 'server-1', status: 'running' };
      }
      return { id: `task-${requests.length}` };
    },
    async stopAll() {}
  };
  const controller = new TuiController({
    workspace: {
      name: 'my-app',
      type: 'app',
      root: '/tmp/app',
      appConfigs: ['dev.mjs', 'release.mjs'],
      defaultAppConfig: 'dev.mjs',
      defaultBuildConfig: 'release.mjs'
    },
    stdin,
    stdout,
    supervisor,
    ringBuffer: new RingBuffer({ capacity: 100 }),
    titleAnimator: new TitleAnimator({ enabled: false }),
    cliEntrypoint: '/opt/cells/bin/cells.js',
    urlOpener: async url => openedUrls.push(url)
  });
  t.after(async () => controller.close());

  await controller.start();
  stdin.write('s');
  await new Promise(resolve => setTimeout(resolve, 10));
  stdin.write('b');
  await new Promise(resolve => setTimeout(resolve, 10));
  stdin.write('e');
  await new Promise(resolve => setTimeout(resolve, 20));

  assert.deepEqual(requests[0], {
    type: 'serve',
    logicalCommand: 'app:dev',
    file: process.execPath,
    args: ['/opt/cells/bin/cells.js', 'app:dev', '-c', 'dev.mjs', '--host', '127.0.0.1', '--port', '8001', '--strictPort', '--no-open'],
    cwd: '/tmp/app',
    isServer: true,
    port: 8001
  });
  assert.deepEqual(requests[1].args, ['/opt/cells/bin/cells.js', 'app:build', '-c', 'release.mjs']);
  assert.equal(requests[1].type, 'build');
  assert.deepEqual(requests[2].args, ['/opt/cells/bin/cells.js', 'app:test', '--wtr']);
  assert.equal(requests[2].type, 'e2e');

  stdin.write('o');
  await new Promise(resolve => setTimeout(resolve, 10));
  assert.deepEqual(openedUrls, []);

  controller.handleTaskUpdate({
    id: 'server-1',
    type: 'serve',
    status: 'running',
    pid: 1234,
    url: 'http://127.0.0.1:8001/',
    port: 8001,
    startedAt: 1
  });
  stdin.write('o');
  await new Promise(resolve => setTimeout(resolve, 10));
  assert.deepEqual(openedUrls, ['http://127.0.0.1:8001/']);

  stdin.write('/');
  for (const char of 'locales') {
    stdin.write(char);
  }
  stdin.write('\r');
  stdin.write('\r');
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.deepEqual(requests[3].args, ['/opt/cells/bin/cells.js', 'app:locales', '-c', 'dev.mjs']);
  assert.equal(requests[3].type, 'locales');
});

test('integration: advertised preview, locales, documentation, and create shortcuts dispatch real actions without colliding with log filtering', async t => {
  const appTerminal = createMockTerminal();
  const appRequests = [];
  const appController = new TuiController({
    workspace: {
      name: 'my-app',
      type: 'app',
      root: '/tmp/app',
      appConfigs: ['dev.mjs', 'release.mjs'],
      defaultAppConfig: 'dev.mjs',
      defaultBuildConfig: 'release.mjs'
    },
    ...appTerminal,
    supervisor: {
      getActiveServer() { return null; },
      async startTask(request) { appRequests.push(request); return { id: `app-${appRequests.length}` }; },
      async stopAll() {}
    },
    ringBuffer: new RingBuffer({ capacity: 20 }),
    titleAnimator: new TitleAnimator({ enabled: false }),
    cliEntrypoint: '/opt/cells/bin/cells.js'
  });
  t.after(async () => appController.close());

  await appController.start();
  appTerminal.stdin.write('p');
  appTerminal.stdin.write('i');
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.deepEqual(appRequests.map(request => [request.type, request.args]), [
    ['serve', ['/opt/cells/bin/cells.js', 'app:preview', '-c', 'release.mjs', '--host', '127.0.0.1', '--port', '8001', '--strictPort', '--no-open']],
    ['locales', ['/opt/cells/bin/cells.js', 'app:locales', '-c', 'dev.mjs']]
  ]);

  appTerminal.stdin.write('+');
  await new Promise(resolve => setTimeout(resolve, 10));
  assert.equal(appController.state.modal, 'create');
  appTerminal.stdin.write('\x1b');
  appTerminal.stdin.write('l');
  await new Promise(resolve => setTimeout(resolve, 10));
  assert.equal(appController.state.logFilter, 'serve');
  assert.equal(appRequests.length, 2);

  const componentTerminal = createMockTerminal();
  const componentRequests = [];
  const componentController = new TuiController({
    workspace: { name: 'my-component', type: 'component', root: '/tmp/component' },
    ...componentTerminal,
    supervisor: {
      getActiveServer() { return null; },
      async startTask(request) { componentRequests.push(request); return { id: `component-${componentRequests.length}` }; },
      async stopAll() {}
    },
    ringBuffer: new RingBuffer({ capacity: 20 }),
    titleAnimator: new TitleAnimator({ enabled: false }),
    cliEntrypoint: '/opt/cells/bin/cells.js'
  });
  t.after(async () => componentController.close());

  await componentController.start();
  componentTerminal.stdin.write('i');
  componentTerminal.stdin.write('d');
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.deepEqual(componentRequests.map(request => [request.type, request.args]), [
    ['locales', ['/opt/cells/bin/cells.js', 'component:locales']],
    ['documentation', ['/opt/cells/bin/cells.js', 'component:documentation']]
  ]);
  componentTerminal.stdin.write('+');
  await new Promise(resolve => setTimeout(resolve, 10));
  assert.equal(componentController.state.modal, 'create');
});

test('integration: TuiController does not invent required app config names', async t => {
  const { stdin, stdout } = createMockTerminal();
  const requests = [];
  const controller = new TuiController({
    workspace: { name: 'unconfigured-app', type: 'app', root: '/tmp/app', appConfigs: [] },
    stdin,
    stdout,
    supervisor: {
      getActiveServer() { return null; },
      async startTask(request) { requests.push(request); },
      async stopAll() {}
    },
    ringBuffer: new RingBuffer({ capacity: 100 }),
    titleAnimator: new TitleAnimator({ enabled: false })
  });
  t.after(async () => controller.close());

  await controller.start();
  stdin.write('s');
  stdin.write('b');
  await new Promise(resolve => setTimeout(resolve, 20));

  assert.deepEqual(requests, []);
});

test('integration: selected component:create collects a scaffold before starting a supervised task', async t => {
  const { stdin, stdout } = createMockTerminal();
  const requests = [];
  const controller = new TuiController({
    workspace: { name: 'workspace', type: 'unknown', root: '/tmp/create-root' },
    stdin,
    stdout,
    supervisor: {
      getActiveServer() { return null; },
      async startTask(request) { requests.push(request); return { id: 'create-component' }; },
      async stopAll() {}
    },
    ringBuffer: new RingBuffer({ capacity: 20 }),
    titleAnimator: new TitleAnimator({ enabled: false }),
    cliEntrypoint: '/opt/cells/bin/cells.js'
  });
  t.after(async () => controller.close());

  await controller.start();
  stdin.write('/');
  stdin.write('component:create');
  await new Promise(resolve => setTimeout(resolve, 20));
  stdin.write('\r');
  await new Promise(resolve => setTimeout(resolve, 10));
  stdin.write('\r');
  await new Promise(resolve => setTimeout(resolve, 20));

  assert.equal(controller.state.modal, 'create');
  assert.deepEqual(requests, []);

  stdin.write('academy-card');
  await new Promise(resolve => setTimeout(resolve, 20));
  stdin.write('\r');
  await new Promise(resolve => setTimeout(resolve, 20));

  assert.equal(controller.state.modal, null);
  assert.equal(requests.length, 1);
  assert.deepEqual(requests[0], {
    type: 'create',
    logicalCommand: 'component:create',
    file: process.execPath,
    args: ['/opt/cells/bin/cells.js', 'component:create', '--scaffold', JSON.stringify({ name: 'academy-card', namespace: '@academy' })],
    cwd: '/tmp/create-root'
  });
});

test('integration: selected app:create collects an app scaffold before starting a supervised task', async t => {
  const { stdin, stdout } = createMockTerminal();
  const requests = [];
  const controller = new TuiController({
    workspace: { name: 'workspace', type: 'unknown', root: '/tmp/create-root' },
    stdin,
    stdout,
    supervisor: {
      getActiveServer() { return null; },
      async startTask(request) { requests.push(request); return { id: 'create-app' }; },
      async stopAll() {}
    },
    ringBuffer: new RingBuffer({ capacity: 20 }),
    titleAnimator: new TitleAnimator({ enabled: false }),
    cliEntrypoint: '/opt/cells/bin/cells.js'
  });
  t.after(async () => controller.close());

  await controller.start();
  stdin.write('/');
  stdin.write('app:create');
  await new Promise(resolve => setTimeout(resolve, 20));
  stdin.write('\r');
  await new Promise(resolve => setTimeout(resolve, 10));
  stdin.write('\r');
  await new Promise(resolve => setTimeout(resolve, 20));

  assert.equal(controller.state.modal, 'create');
  assert.deepEqual(requests, []);

  stdin.write('academy-app');
  await new Promise(resolve => setTimeout(resolve, 20));
  stdin.write('\r');
  await new Promise(resolve => setTimeout(resolve, 20));

  assert.equal(controller.state.modal, null);
  assert.equal(requests.length, 1);
  assert.deepEqual(requests[0], {
    type: 'create',
    logicalCommand: 'app:create',
    file: process.execPath,
    args: ['/opt/cells/bin/cells.js', 'app:create', '--scaffold', JSON.stringify({ name: 'academy-app', scaffold: 'academy-app', e2e: false, installDeps: false })],
    cwd: '/tmp/create-root'
  });
});

test('integration: TuiController translates user-visible task errors and never buffers an untrusted failure cause', async t => {
  const { stdin, stdout } = createMockTerminal();
  const ringBuffer = new RingBuffer({ capacity: 100 });
  const controller = new TuiController({
    workspace: { name: 'mi-componente', type: 'component', root: '/tmp/component' },
    language: 'es',
    stdin,
    stdout,
    supervisor: {
      getActiveServer() { return null; },
      async startTask() { throw new Error('Bearer super-secret-token-value'); },
      async stopAll() {}
    },
    ringBuffer,
    titleAnimator: new TitleAnimator({ enabled: false })
  });
  t.after(async () => controller.close());

  await controller.start();
  stdin.write('u');
  await new Promise(resolve => setTimeout(resolve, 10));

  const message = ringBuffer.toArray().at(-1)?.message;
  assert.equal(message, 'No se pudo iniciar UNITARIAS.');
  assert.doesNotMatch(message, /super-secret-token-value|Bearer|Failed to start/i);
});
