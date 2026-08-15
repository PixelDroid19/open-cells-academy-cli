import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { lstat, mkdir, mkdtemp, readFile, rename, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { ComponentToolchain } from '../../src/adapters/vite/component-toolchain.js';
import { devComponent } from '../../src/application/component/dev-component.js';
import { buildComponentDemo } from '../../src/application/component/build-demo.js';
import { NodeFilesystem } from '../../src/adapters/node/node-filesystem.js';
import { WorkspaceSession } from '../../src/domain/workspace-session.js';
import { createFakeComponentVite, occupyPort, portIsReleased } from '../fixtures/task-9-component-toolchain/fake-toolchain.js';

const REDIRECT_HTML = '<!doctype html><html><head><meta http-equiv="refresh" content="0;url=demo/"></head><body>redirect</body></html>';
const DEMO_INDEX_HTML = '<!doctype html><html><head><title>demo</title></head><body><academy-button-demo></academy-button-demo></body></html>';
const DEMO_JS = "import './demo-helper.js';\nimport '../academy-button-default.js';\nconsole.log('demo');\n";
const DEMO_HELPER_JS = "import { html } from 'lit';\nexport const demoHelper = html`<span>helper</span>`;\n";
const COMPONENT_JS = "import { LitElement, html } from 'lit';\nexport class AcademyButton extends LitElement {\n  render() { return html`<button>click</button>`; }\n}\n";
const LOCALES_ES = '{"button":"Botón"}\n';

async function workspace(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'open-cells-academy-component-'));
  t.after(async () => {
    await rm(root, { recursive: true, force: true });
  });
  await writeFile(path.join(root, 'package.json'), '{"name":"component-fixture","private":true,"type":"module"}\n');
  const filesystem = new NodeFilesystem();
  const session = await WorkspaceSession.open(root, filesystem);
  return { filesystem, root, session };
}

async function writeWorkspaceFile(root, relativePath, content) {
  const target = path.join(root, relativePath);
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, content);
}

async function writeStandardComponent(root) {
  await writeWorkspaceFile(root, 'index.html', REDIRECT_HTML);
  await writeWorkspaceFile(root, 'demo/index.html', DEMO_INDEX_HTML);
  await writeWorkspaceFile(root, 'demo/demo.js', DEMO_JS);
  await writeWorkspaceFile(root, 'demo/demo-helper.js', DEMO_HELPER_JS);
  await writeWorkspaceFile(root, 'academy-button-default.js', COMPONENT_JS);
  await writeWorkspaceFile(root, 'src/button.js', COMPONENT_JS);
  await writeWorkspaceFile(root, 'locales/es.json', LOCALES_ES);
  await writeWorkspaceFile(root, 'demo/css/demo.css', '.demo { color: red; }\n');
}

function devContext(session, toolchain, overrides = {}) {
  return Object.freeze({ session, toolchain, ...overrides });
}

function buildContext(session, filesystem, toolchain, overrides = {}) {
  return Object.freeze({ session, filesystem, toolchain, ...overrides });
}

function assertCode(promise, code) {
  return assert.rejects(promise, error => {
    assert.equal(error?.code, code);
    return true;
  });
}

test('red: component dev serves the demo root with redirect and index, public imports, controlled CORS raw paths, locales, and HMR over real HTTP with exact close', async t => {
  const { root, session } = await workspace(t);
  await writeStandardComponent(root);
  const vite = createFakeComponentVite();
  const signals = new EventEmitter();
  const handle = await devComponent(devContext(session, new ComponentToolchain(vite), { signals }));
  const ready = await handle.ready;
  t.after(async () => {
    await handle.close();
  });

  assert.equal(ready.host, '127.0.0.1');
  assert.equal(ready.port > 0, true);
  const redirect = await (await fetch(ready.url)).text();
  assert.match(redirect, /refresh.*url=demo/);
  const index = await (await fetch(new URL('demo/', ready.url))).text();
  assert.match(index, /demo/);
  assert.match(index, /academy-button-demo/);
  const demoJs = await (await fetch(new URL('demo/demo.js', ready.url))).text();
  assert.match(demoJs, /demo-helper/);
  const componentJs = await (await fetch(new URL('academy-button-default.js', ready.url))).text();
  assert.match(componentJs, /class AcademyButton/);
  const locales = await (await fetch(new URL('locales/es.json', ready.url))).text();
  assert.equal(locales, LOCALES_ES);
  const rawCss = await (await fetch(new URL('demo/css/demo.css', ready.url))).text();
  assert.match(rawCss, /\.demo/);
  const hmrClient = await (await fetch(new URL('@vite/client', ready.url))).text();
  assert.match(hmrClient, /createHotContext/);

  assert.equal(signals.listenerCount('SIGINT'), 1);
  assert.equal(signals.listenerCount('SIGTERM'), 1);
  const firstClose = handle.close();
  assert.strictEqual(handle.close(), firstClose);
  await firstClose;
  assert.equal(signals.listenerCount('SIGINT'), 0);
  assert.equal(signals.listenerCount('SIGTERM'), 0);
  assert.equal(await portIsReleased(ready.port), true);
});

test('red: component dev allows an explicit LAN bind, falls back from a non-strict occupied port, and rejects a strict one without leaking listeners', async t => {
  const { root, session } = await workspace(t);
  await writeStandardComponent(root);
  const occupied = await occupyPort();
  t.after(() => occupied.close());
  const vite = createFakeComponentVite();
  const signals = new EventEmitter();
  const toolchain = new ComponentToolchain(vite);

  const fallback = await devComponent(devContext(session, toolchain, {
    signals,
    options: Object.freeze({ host: '0.0.0.0', port: occupied.port, strictPort: false })
  }));
  const fallbackReady = await fallback.ready;
  assert.equal(fallbackReady.host, '0.0.0.0');
  assert.notEqual(fallbackReady.port, occupied.port);
  await fallback.close();
  await assertCode(
    devComponent(devContext(session, toolchain, {
      signals,
      options: Object.freeze({ host: '127.0.0.1', port: occupied.port, strictPort: true })
    })),
    'COMPONENT_DEV_FAILED'
  );
  assert.equal(signals.listenerCount('SIGINT'), 0);
  assert.equal(signals.listenerCount('SIGTERM'), 0);
});

test('red: component dev rejects a missing or unsafe demo root before creating a server or registering shutdown listeners', async t => {
  const { root, session } = await workspace(t);
  const outside = await mkdtemp(path.join(os.tmpdir(), 'open-cells-academy-component-outside-'));
  t.after(() => rm(outside, { recursive: true, force: true }));
  await writeStandardComponent(root);
  await rm(path.join(root, 'demo'), { recursive: true });
  const vite = createFakeComponentVite();
  const signals = new EventEmitter();

  await assertCode(devComponent(devContext(session, new ComponentToolchain(vite), { signals })), 'COMPONENT_DEMO_ROOT_INVALID');
  assert.equal(vite.calls.length, 0);
  assert.equal(signals.listenerCount('SIGINT'), 0);
  assert.equal(signals.listenerCount('SIGTERM'), 0);
});

test('red: component dev reports signal close rejection once without unhandled rejections and removes listeners', async t => {
  const { root, session } = await workspace(t);
  await writeStandardComponent(root);
  const signals = new EventEmitter();
  const reports = [];
  const unhandled = [];
  const onUnhandled = reason => unhandled.push(reason);
  process.on('unhandledRejection', onUnhandled);
  try {
    const failing = {
      async startDev() {
        return Object.freeze({
          ready: Promise.resolve(Object.freeze({ url: 'http://127.0.0.1:45001/', host: '127.0.0.1', port: 45001 })),
          close() {
            return Promise.reject(new Error('component-close-secret'));
          }
        });
      }
    };
    const handle = await devComponent(devContext(session, failing, { signals, onCloseError: error => reports.push(error) }));
    signals.emit('SIGINT');
    signals.emit('SIGTERM');
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(signals.listenerCount('SIGINT'), 0);
    assert.equal(signals.listenerCount('SIGTERM'), 0);
    assert.equal(unhandled.length, 0);
    assert.equal(reports.length, 1);
    assert.equal(reports[0]?.code, 'COMPONENT_DEV_CLOSE_FAILED');
    assert.doesNotMatch(`${reports[0]?.message} ${JSON.stringify(reports[0]?.details)} ${reports[0]?.cause ?? ''}`, /component-close-secret/);
    assert.strictEqual(handle.close(), handle.close());
  } finally {
    process.removeListener('unhandledRejection', onUnhandled);
  }
});

test('red: build demo bundles nested demo entries and source maps, copies demo assets, and publishes atomically over a repeated run', async t => {
  const { filesystem, root, session } = await workspace(t);
  await writeStandardComponent(root);
  await writeWorkspaceFile(root, 'demo/sub/nested.js', "import '../demo-helper.js';\nconsole.log('nested');\n");
  const toolchain = new ComponentToolchain(createFakeComponentVite({ failBuild: false }));

  const first = await buildComponentDemo(buildContext(session, filesystem, toolchain, {
    options: Object.freeze({ sourceMap: true })
  }));
  assert.equal(first.destination, path.join(root, 'dist'));
  const bundle = await readFile(path.join(root, 'dist', 'demo', 'demo.js'), 'utf8');
  assert.match(bundle, /academy-demo-bundle/);
  const nested = await readFile(path.join(root, 'dist', 'demo', 'sub', 'nested.js'), 'utf8');
  assert.match(nested, /nested/);
  const map = await readFile(path.join(root, 'dist', 'demo', 'demo.js.map'), 'utf8');
  assert.equal(map, '{"version":3}\n');
  assert.equal(await readFile(path.join(root, 'dist', 'locales', 'es.json'), 'utf8'), LOCALES_ES);
  assert.match(await readFile(path.join(root, 'dist', 'demo', 'index.html'), 'utf8'), /academy-button-demo/);
  assert.match(await readFile(path.join(root, 'dist', 'index.html'), 'utf8'), /redirect/);
  assert.equal(await readFile(path.join(root, 'dist', 'academy-button-default.js'), 'utf8'), COMPONENT_JS);
  assert.equal(await readFile(path.join(root, 'dist', 'demo', 'css', 'demo.css'), 'utf8'), '.demo { color: red; }\n');

  const second = await buildComponentDemo(buildContext(session, filesystem, toolchain, {}));
  assert.equal(second.destination, path.join(root, 'dist'));
  assert.equal(
    await readFile(path.join(root, 'dist', 'demo', 'demo.js'), 'utf8'),
    await readFile(path.join(root, 'dist', 'demo', 'demo.js'), 'utf8')
  );
});

test('red: build demo supports custom demo/dist directories and a demo root without JS entries', async t => {
  const { filesystem, root, session } = await workspace(t);
  await writeWorkspaceFile(root, 'index.html', REDIRECT_HTML);
  await writeWorkspaceFile(root, 'demos/index.html', DEMO_INDEX_HTML);
  await writeWorkspaceFile(root, 'demos/no-js.txt', 'assets only\n');
  await writeWorkspaceFile(root, 'locales/es.json', LOCALES_ES);
  const toolchain = new ComponentToolchain(createFakeComponentVite());

  const result = await buildComponentDemo(buildContext(session, filesystem, toolchain, {
    demo: 'demos',
    dist: 'public/demo'
  }));
  assert.equal(result.destination, path.join(root, 'public', 'demo'));
  assert.equal(await readFile(path.join(root, 'public', 'demo', 'demos', 'index.html'), 'utf8'), DEMO_INDEX_HTML);
  assert.equal(await readFile(path.join(root, 'public', 'demo', 'demos', 'no-js.txt'), 'utf8'), 'assets only\n');
  assert.equal(await readFile(path.join(root, 'public', 'demo', 'locales', 'es.json'), 'utf8'), LOCALES_ES);
});

test('red: build demo fails closed on a broken import and preserves the previous publication', async t => {
  const { filesystem, root, session } = await workspace(t);
  await writeStandardComponent(root);
  await writeWorkspaceFile(root, 'demo/broken.js', "import './missing-helper.js';\nconsole.log('broken');\n");
  await writeWorkspaceFile(root, 'dist/sentinel.txt', 'unchanged\n');
  const toolchain = new ComponentToolchain(createFakeComponentVite({ failBuild: false }));

  await assertCode(
    buildComponentDemo(buildContext(session, filesystem, toolchain, {})),
    'COMPONENT_DEMO_BUILD_FAILED'
  );
  assert.equal(await readFile(path.join(root, 'dist', 'sentinel.txt'), 'utf8'), 'unchanged\n');
});

test('red: build demo fails closed on a Vite failure and cleans the stage without touching the previous output', async t => {
  const { filesystem, root, session } = await workspace(t);
  await writeStandardComponent(root);
  await writeWorkspaceFile(root, 'dist/sentinel.txt', 'unchanged\n');
  const toolchain = new ComponentToolchain(createFakeComponentVite({ failBuild: true }));

  await assertCode(
    buildComponentDemo(buildContext(session, filesystem, toolchain, {})),
    'COMPONENT_DEMO_BUILD_FAILED'
  );
  assert.equal(await readFile(path.join(root, 'dist', 'sentinel.txt'), 'utf8'), 'unchanged\n');
});

test('red: build demo supports verbose and non-verbose logging through the injected logger', async t => {
  const { filesystem, root, session } = await workspace(t);
  await writeStandardComponent(root);
  const toolchain = new ComponentToolchain(createFakeComponentVite());
  const info = [];
  const logger = { info(message) { info.push(message); } };

  await buildComponentDemo(buildContext(session, filesystem, toolchain, {
    options: Object.freeze({ verbose: true }),
    logger
  }));
  assert.ok(info.some(message => /demo\.js/.test(message)));
  info.length = 0;
  await buildComponentDemo(buildContext(session, filesystem, toolchain, {
    options: Object.freeze({ verbose: false }),
    logger
  }));
  assert.equal(info.length, 0);
});

test('red: build demo fails closed when the demo root is swapped for an external symlink during the Vite build', async t => {
  const { filesystem, root, session } = await workspace(t);
  await writeStandardComponent(root);
  const outside = await mkdtemp(path.join(os.tmpdir(), 'open-cells-academy-toolchain-outside-'));
  t.after(() => rm(outside, { recursive: true, force: true }));
  await writeFile(path.join(outside, 'demo.js'), 'console.log("EXTERNAL_DEMO_SECRET");\n');
  const state = {};
  const swappingVite = {
    async createServer() {
      throw new Error('not used');
    },
    async build(config) {
      await rm(path.join(root, 'demo'), { recursive: true, force: true });
      await symlink(outside, path.join(root, 'demo'));
      state.swapped = true;
      await mkdir(config.build.outDir, { recursive: true });
      await writeFile(path.join(config.build.outDir, 'demo.js'), 'console.log("EXTERNAL_DEMO_SECRET");\n');
      return Object.freeze({ outDir: config.build.outDir });
    },
    async preview() {
      throw new Error('not used');
    }
  };

  await assert.rejects(
    buildComponentDemo(buildContext(session, filesystem, new ComponentToolchain(swappingVite), {})),
    error => {
      assert.ok(['COMPONENT_DEMO_SOURCE_INVALID', 'PATH_CHANGED'].includes(error?.code));
      return true;
    }
  );
  assert.equal(state.swapped, true);
  await assert.rejects(readFile(path.join(root, 'dist', 'demo', 'demo.js'), 'utf8'), error => error?.code === 'ENOENT');
});

test('red: build demo rejects a same-name demo stage replacement without deleting the unrelated directory', async t => {
  const { filesystem, root, session } = await workspace(t);
  await writeStandardComponent(root);
  const state = {};
  const replacingVite = {
    async createServer() {
      throw new Error('not used');
    },
    async build(config) {
      const stage = config.build.outDir;
      const parent = path.dirname(stage);
      const parked = `${parent}-parked`;
      await rename(parent, parked);
      await mkdir(parent);
      await writeFile(path.join(parent, 'unrelated-sentinel.txt'), 'must survive\n');
      Object.assign(state, { parent, parked });
      throw new Error('forced-stage-replacement');
    },
    async preview() {
      throw new Error('not used');
    }
  };

  await assert.rejects(
    buildComponentDemo(buildContext(session, filesystem, new ComponentToolchain(replacingVite), {})),
    error => {
      assert.equal(error?.code, 'TRANSACTION_CLEANUP_FAILED');
      assert.ok(error?.cause instanceof AggregateError);
      assert.ok(error.cause.errors.some(cause => cause?.code === 'COMPONENT_DEMO_BUILD_FAILED'));
      return true;
    }
  );
  assert.equal(await readFile(path.join(state.parent, 'unrelated-sentinel.txt'), 'utf8'), 'must survive\n');
  assert.equal((await lstat(state.parked)).isDirectory(), true);
});

test('red: build demo rejects traversal and absolute demo/dist targets before any build or publication', async t => {
  const { filesystem, root, session } = await workspace(t);
  await writeStandardComponent(root);
  const toolchain = new ComponentToolchain(createFakeComponentVite());

  await assertCode(
    buildComponentDemo(buildContext(session, filesystem, toolchain, { demo: '../escape' })),
    'PATH_INVALID'
  );
  await assertCode(
    buildComponentDemo(buildContext(session, filesystem, toolchain, { demo: '/abs' })),
    'PATH_INVALID'
  );
  await assertCode(
    buildComponentDemo(buildContext(session, filesystem, toolchain, { dist: '../escape' })),
    'PATH_INVALID'
  );
});

test('red: build demo rejects a symlinked demo root or dist parent that would escape the workspace', async t => {
  const { filesystem, root, session } = await workspace(t);
  await writeStandardComponent(root);
  const outside = await mkdtemp(path.join(os.tmpdir(), 'open-cells-academy-component-outside-'));
  t.after(() => rm(outside, { recursive: true, force: true }));
  await rm(path.join(root, 'demo'), { recursive: true, force: true });
  await symlink(outside, path.join(root, 'demo'));
  const toolchain = new ComponentToolchain(createFakeComponentVite());

  await assertCode(
    buildComponentDemo(buildContext(session, filesystem, toolchain, {})),
    'COMPONENT_DEMO_ROOT_INVALID'
  );
});
