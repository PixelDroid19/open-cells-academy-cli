import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { lstat, mkdir, mkdtemp, readFile, rename, rm, symlink, writeFile } from 'node:fs/promises';
import { createRequire, syncBuiltinESMExports } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { AppToolchain } from '../../src/adapters/vite/app-toolchain.js';
import { ServiceWorker } from '../../src/adapters/workbox/service-worker.js';
import { buildApp } from '../../src/application/app/build-app.js';
import { devApp } from '../../src/application/app/dev-app.js';
import { previewApp } from '../../src/application/app/preview-app.js';
import { NodeFilesystem } from '../../src/adapters/node/node-filesystem.js';
import { loadCellsConfig } from '../../src/adapters/vite/config-loader.js';
import { WorkspaceSession } from '../../src/domain/workspace-session.js';
import { createFakeVite, createFakeWorkbox, occupyPort, portIsReleased } from '../fixtures/task-8-app-toolchain/fake-toolchain.js';

const template = '<!doctype html><html lang="##app.lang##"><head><title>##app.title##</title><meta name="description" content="##app.description##"></head><body><header>##app.header##</header><main data-name="##app.name##">##app.version## ##env.mode##</main></body></html>';
const academyRootTemplate = '<!doctype html><html lang="en"><head><title></title></head><body><main id="app"></main><script type="module" src="/src/app.js"></script></body></html>';
const requireBuiltin = createRequire(import.meta.url);

async function workspace(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'open-cells-academy-toolchain-'));
  t.after(async () => {
    await rm(root, { recursive: true, force: true });
  });
  await writeFile(path.join(root, 'package.json'), '{"name":"toolchain-fixture","private":true,"type":"module"}\n');
  await mkdir(path.join(root, 'app', 'config'), { recursive: true });
  const filesystem = new NodeFilesystem();
  const session = await WorkspaceSession.open(root, filesystem);
  return { filesystem, root, session };
}

async function writeWorkspaceFile(root, relativePath, content) {
  const target = path.join(root, relativePath);
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, content);
}

async function writeConfig(root, name, source) {
  await writeWorkspaceFile(root, `app/config/${name}`, source);
}

async function writeAcademyAppMarker(root, declaration = { schema: 1, kind: 'app' }) {
  await writeWorkspaceFile(root, '.open-cells-academy-recipe.json', JSON.stringify(declaration));
}

function appConfig({ server = {}, build = {}, locales = undefined } = {}) {
  return `export default ${JSON.stringify({
    server,
    build,
    locales,
    app: {
      lang: 'en',
      title: 'Academy',
      description: 'Toolchain fixture',
      header: 'Cells Academy',
      name: 'toolchain-fixture',
      version: '1.0.0'
    }
  })};`;
}

function devContext(session, toolchain, configName, overrides = {}) {
  return Object.freeze({ session, toolchain, configName, ...overrides });
}

function buildContext(session, filesystem, toolchain, configName, overrides = {}) {
  return Object.freeze({ session, filesystem, toolchain, configName, ...overrides });
}

function assertCode(promise, code) {
  return assert.rejects(promise, error => {
    assert.equal(error?.code, code);
    return true;
  });
}

function mutateViteConfig(config, nested, events) {
  config.environments = { mutated: nested };
  config[nested].mutatedByVite = nested;
  config.plugins.push({ name: `vite-${nested}` });
  if (config.plugins[0] !== undefined) config.plugins[0].mutatedByVite = nested;
  events.push(Object.freeze({ config, nested }));
}

function createMutatingVite(events) {
  return {
    async createServer(config) {
      mutateViteConfig(config, 'server', events);
      return {
        httpServer: { address: () => ({ port: 41001 }) },
        async listen() {},
        async close() {}
      };
    },
    async build(config) {
      mutateViteConfig(config, 'build', events);
      return {};
    },
    async preview(config) {
      mutateViteConfig(config, 'preview', events);
      return {
        httpServer: { address: () => ({ port: 41002 }) },
        async close() {}
      };
    }
  };
}

function assertMutableViteConfig(event, nested) {
  assert.equal(event.nested, nested);
  assert.equal(Object.isFrozen(event.config), false);
  assert.equal(Object.isFrozen(event.config[nested]), false);
  assert.equal(Object.isFrozen(event.config.plugins), false);
  assert.equal(event.config.environments.mutated, nested);
  assert.equal(event.config[nested].mutatedByVite, nested);
  assert.equal(event.config.plugins.at(-1).name, `vite-${nested}`);
}

function endpointVite({ devPort = 42001, previewPort = 42002 } = {}) {
  return {
    async createServer() {
      return {
        httpServer: { address: () => ({ port: devPort }) },
        async listen() {},
        async close() {}
      };
    },
    async build() {},
    async preview() {
      return {
        httpServer: { address: () => ({ port: previewPort }) },
        async close() {}
      };
    }
  };
}

function createStageReplacementVite() {
  const state = {};
  return {
    state,
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
}

function createNestedStageReplacementVite() {
  const state = {};
  return {
    state,
    async createServer() {
      throw new Error('not used');
    },
    async build(config) {
      const stage = config.build.outDir;
      await rm(stage, { recursive: true, force: true });
      await mkdir(stage);
      await writeFile(path.join(stage, 'index.html'), '<main>replacement</main>');
      Object.assign(state, { stage });
      return {};
    },
    async preview() {
      throw new Error('not used');
    }
  };
}

function createStageFileRaceVite() {
  const state = {};
  return {
    state,
    async createServer() {
      throw new Error('not used');
    },
    async build(config) {
      const assets = path.join(config.build.outDir, 'assets');
      await mkdir(assets, { recursive: true });
      await writeFile(path.join(config.build.outDir, 'index.html'), '<main>safe build</main>');
      for (const name of ['00-safe.txt', '10-safe.txt', '20-safe.txt', 'zz-target.txt']) {
        await writeFile(path.join(assets, name), `safe:${name}\n`);
      }
      Object.assign(state, { assets, target: path.join(assets, 'zz-target.txt') });
      return {};
    },
    async preview() {
      throw new Error('not used');
    }
  };
}

function failingServer() {
  return Object.freeze({
    ready: Promise.resolve(Object.freeze({ url: 'http://127.0.0.1:43000/', host: '127.0.0.1', port: 43000 })),
    close() {
      return Promise.reject(new Error('fixture-close-secret'));
    }
  });
}

function nextTurn() {
  return new Promise(resolve => setImmediate(resolve));
}

async function assertSignalCloseFailure({ createHandle, errorCode }) {
  const signals = new EventEmitter();
  const reports = [];
  const unhandled = [];
  const onUnhandled = reason => unhandled.push(reason);
  process.on('unhandledRejection', onUnhandled);
  try {
    const handle = await createHandle(signals, error => reports.push(error));
    signals.emit('SIGINT');
    signals.emit('SIGTERM');
    await nextTurn();
    assert.equal(signals.listenerCount('SIGINT'), 0);
    assert.equal(signals.listenerCount('SIGTERM'), 0);
    assert.equal(unhandled.length, 0);
    assert.equal(reports.length, 1);
    assert.equal(reports[0]?.code, errorCode);
    assert.equal(reports[0]?.message, errorCode);
    assert.equal(reports[0]?.cause, undefined);
    assert.doesNotMatch(`${reports[0]?.message} ${JSON.stringify(reports[0]?.details)} ${reports[0]?.cause ?? ''}`, /fixture-close-secret/);
    assert.strictEqual(handle.close(), handle.close());
  } finally {
    process.removeListener('unhandledRejection', onUnhandled);
  }
}

test('red: dev uses loopback by default, renders HTTP and HMR, and cleans exact signal listeners with an idempotent close', async t => {
  const { root, session } = await workspace(t);
  await writeConfig(root, 'development.js', appConfig());
  await writeWorkspaceFile(root, 'app/index.html', template);
  const vite = createFakeVite();
  const signals = new EventEmitter();
  const handle = await devApp(devContext(session, new AppToolchain(vite), 'development.js', { signals }));
  const ready = await handle.ready;

  assert.equal(ready.host, '127.0.0.1');
  assert.equal(ready.port > 0, true);
  assert.equal((await fetch(ready.url)).status, 200);
  assert.match(await (await fetch(ready.url)).text(), /development/);
  assert.match(await (await fetch(`${ready.url}@vite\/client`)).text(), /createHotContext/);
  vite.latestServer.setBody('<main data-toolchain="dev">updated</main>');
  assert.match(await (await fetch(ready.url)).text(), /updated/);
  assert.equal(signals.listenerCount('SIGINT'), 1);
  assert.equal(signals.listenerCount('SIGTERM'), 1);
  const firstClose = handle.close();
  assert.strictEqual(handle.close(), firstClose);
  await firstClose;
  assert.equal(signals.listenerCount('SIGINT'), 0);
  assert.equal(signals.listenerCount('SIGTERM'), 0);
  assert.equal(await portIsReleased(ready.port), true);
});

test('red: dev allows an explicit LAN bind, falls back from a non-strict occupied port, and rejects a strict one without leaking listeners', async t => {
  const { root, session } = await workspace(t);
  await writeConfig(root, 'ports.js', appConfig());
  await writeWorkspaceFile(root, 'app/index.html', template);
  const occupied = await occupyPort();
  t.after(() => occupied.close());
  const vite = createFakeVite();
  const signals = new EventEmitter();
  const toolchain = new AppToolchain(vite);

  const fallback = await devApp(devContext(session, toolchain, 'ports.js', {
    signals,
    options: Object.freeze({ host: '0.0.0.0', port: occupied.port, strictPort: false })
  }));
  const fallbackReady = await fallback.ready;
  assert.equal(fallbackReady.host, '0.0.0.0');
  assert.notEqual(fallbackReady.port, occupied.port);
  await fallback.close();
  await assertCode(
    devApp(devContext(session, toolchain, 'ports.js', {
      signals,
      options: Object.freeze({ host: '127.0.0.1', port: occupied.port, strictPort: true })
    })),
    'VITE_DEV_FAILED'
  );
  assert.equal(signals.listenerCount('SIGINT'), 0);
  assert.equal(signals.listenerCount('SIGTERM'), 0);
});

test('red: a marked Academy root app uses its root for dev, build resources, and preview', async t => {
  const { filesystem, root, session } = await workspace(t);
  await writeConfig(root, 'root-layout.js', appConfig());
  await writeAcademyAppMarker(root);
  await writeWorkspaceFile(root, 'index.html', academyRootTemplate);
  await writeWorkspaceFile(root, 'resources/logo.txt', 'resource\n');
  await writeWorkspaceFile(root, 'vendor/library.js', 'vendor\n');
  await writeWorkspaceFile(root, 'manifest.json', '{"name":"root-layout"}\n');
  const vite = createFakeVite();
  const toolchain = new AppToolchain(vite);
  let dev;
  let preview;
  t.after(async () => {
    await preview?.close();
    await dev?.close();
  });

  dev = await devApp(devContext(session, toolchain, 'root-layout.js', {
    options: Object.freeze({ host: '127.0.0.1', port: 0, strictPort: true })
  }));
  const devReady = await dev.ready;
  assert.equal(vite.calls[0].config.root, root);
  assert.match(await (await fetch(devReady.url)).text(), /development/);
  await dev.close();
  dev = undefined;

  const build = await buildApp(buildContext(session, filesystem, toolchain, 'root-layout.js'));
  assert.equal(build.destination, path.join(root, 'build', 'root-layout'));
  assert.equal(vite.calls.find(call => call.method === 'build').config.root, root);
  assert.equal(await readFile(path.join(build.destination, 'resources', 'logo.txt'), 'utf8'), 'resource\n');
  assert.equal(await readFile(path.join(build.destination, 'vendor', 'library.js'), 'utf8'), 'vendor\n');
  assert.equal(await readFile(path.join(build.destination, 'manifest.json'), 'utf8'), '{"name":"root-layout"}\n');

  preview = await previewApp(devContext(session, toolchain, 'root-layout.js', {
    options: Object.freeze({ host: '127.0.0.1', port: 0, strictPort: true })
  }));
  const previewReady = await preview.ready;
  assert.equal(vite.calls.find(call => call.method === 'preview').config.root, root);
  assert.match(await (await fetch(previewReady.url)).text(), /id="app"/);
  await preview.close();
  preview = undefined;
});

test('red: a regular legacy app index keeps precedence over an Academy root marker', async t => {
  const { filesystem, root, session } = await workspace(t);
  await writeConfig(root, 'legacy-precedence.js', appConfig());
  await writeWorkspaceFile(root, 'app/index.html', template);
  await writeAcademyAppMarker(root);
  await writeWorkspaceFile(root, 'index.html', academyRootTemplate);
  const vite = createFakeVite();
  const toolchain = new AppToolchain(vite);
  const dev = await devApp(devContext(session, toolchain, 'legacy-precedence.js', {
    options: Object.freeze({ host: '127.0.0.1', port: 0, strictPort: true })
  }));
  await dev.ready;
  assert.equal(vite.calls[0].config.root, path.join(root, 'app'));
  await dev.close();

  const build = await buildApp(buildContext(session, filesystem, toolchain, 'legacy-precedence.js'));
  assert.equal(vite.calls.find(call => call.method === 'build').config.root, path.join(root, 'app'));
  assert.match(await readFile(path.join(build.destination, 'index.html'), 'utf8'), /data-name="toolchain-fixture"/);
});

test('red: an Academy root layout rejects an unmarked, malformed, wrong-kind, or symlinked source without replacing a build', async t => {
  const { filesystem, root, session } = await workspace(t);
  const outside = await mkdtemp(path.join(os.tmpdir(), 'open-cells-academy-root-layout-outside-'));
  t.after(() => rm(outside, { recursive: true, force: true }));
  await writeConfig(root, 'root-rejection.js', appConfig());
  await writeWorkspaceFile(root, 'index.html', template);
  await writeFile(path.join(outside, 'marker.json'), JSON.stringify({ schema: 1, kind: 'app' }));
  await writeFile(path.join(outside, 'index.html'), '<main>outside root</main>');

  for (const name of ['unmarked', 'malformed', 'wrong-kind', 'marker-symlink', 'index-symlink']) {
    await writeWorkspaceFile(root, `build/root-rejection-${name}/sentinel.txt`, 'unchanged\n');
  }

  await assertCode(
    buildApp(buildContext(session, filesystem, new AppToolchain(createFakeVite()), 'root-rejection.js')),
    'APP_BUILD_SOURCE_INVALID'
  );
  assert.equal(await readFile(path.join(root, 'build', 'root-rejection-unmarked', 'sentinel.txt'), 'utf8'), 'unchanged\n');

  await writeWorkspaceFile(root, '.open-cells-academy-recipe.json', '{');
  await assertCode(
    buildApp(buildContext(session, filesystem, new AppToolchain(createFakeVite()), 'root-rejection.js')),
    'APP_BUILD_SOURCE_INVALID'
  );
  assert.equal(await readFile(path.join(root, 'build', 'root-rejection-malformed', 'sentinel.txt'), 'utf8'), 'unchanged\n');

  await writeAcademyAppMarker(root, { schema: 1, kind: 'component' });
  await assertCode(
    buildApp(buildContext(session, filesystem, new AppToolchain(createFakeVite()), 'root-rejection.js')),
    'APP_BUILD_SOURCE_INVALID'
  );
  assert.equal(await readFile(path.join(root, 'build', 'root-rejection-wrong-kind', 'sentinel.txt'), 'utf8'), 'unchanged\n');

  await rm(path.join(root, '.open-cells-academy-recipe.json'));
  await symlink(path.join(outside, 'marker.json'), path.join(root, '.open-cells-academy-recipe.json'));
  await assertCode(
    buildApp(buildContext(session, filesystem, new AppToolchain(createFakeVite()), 'root-rejection.js')),
    'APP_BUILD_SOURCE_INVALID'
  );
  assert.equal(await readFile(path.join(root, 'build', 'root-rejection-marker-symlink', 'sentinel.txt'), 'utf8'), 'unchanged\n');

  await rm(path.join(root, '.open-cells-academy-recipe.json'));
  await writeAcademyAppMarker(root);
  await rm(path.join(root, 'index.html'));
  await symlink(path.join(outside, 'index.html'), path.join(root, 'index.html'));
  await assertCode(
    buildApp(buildContext(session, filesystem, new AppToolchain(createFakeVite()), 'root-rejection.js')),
    'APP_BUILD_SOURCE_INVALID'
  );
  assert.equal(await readFile(path.join(root, 'build', 'root-rejection-index-symlink', 'sentinel.txt'), 'utf8'), 'unchanged\n');
  assert.equal(await readFile(path.join(outside, 'marker.json'), 'utf8'), JSON.stringify({ schema: 1, kind: 'app' }));
  assert.equal(await readFile(path.join(outside, 'index.html'), 'utf8'), '<main>outside root</main>');
});

test('red: an Academy root layout fails closed when its marker or index is replaced during Vite build', async t => {
  const { filesystem, root, session } = await workspace(t);
  await writeConfig(root, 'root-race.js', appConfig());

  for (const target of ['.open-cells-academy-recipe.json', 'index.html']) {
    await writeAcademyAppMarker(root);
    await writeWorkspaceFile(root, 'index.html', template);
    await writeWorkspaceFile(root, 'build/root-race/sentinel.txt', 'unchanged\n');
    const vite = createFakeVite();
    const racingVite = {
      createServer: vite.createServer,
      async build(config) {
        await vite.build(config);
        await rm(path.join(root, target));
        await writeFile(path.join(root, target), target === 'index.html' ? template : JSON.stringify({ schema: 1, kind: 'app' }));
      },
      preview: vite.preview
    };

    await assertCode(
      buildApp(buildContext(session, filesystem, new AppToolchain(racingVite), 'root-race.js')),
      'PATH_CHANGED'
    );
    assert.equal(await readFile(path.join(root, 'build', 'root-race', 'sentinel.txt'), 'utf8'), 'unchanged\n');
  }
});

test('red: dev reports trusted config failures before creating a server or registering shutdown listeners', async t => {
  const { session } = await workspace(t);
  const vite = createFakeVite();
  const signals = new EventEmitter();

  await assertCode(devApp(devContext(session, new AppToolchain(vite), 'missing.js', { signals })), 'CONFIG_INVALID');
  assert.equal(vite.calls.length, 0);
  assert.equal(signals.listenerCount('SIGINT'), 0);
  assert.equal(signals.listenerCount('SIGTERM'), 0);
});

test('red: dev gives Vite a mutable copy without changing frozen config or caller options', async t => {
  const { root, session } = await workspace(t);
  await writeConfig(root, 'mutable-dev.js', appConfig({ server: { host: '127.0.0.1', port: 0, strictPort: true } }));
  await writeWorkspaceFile(root, 'app/index.html', template);
  const config = await loadCellsConfig(session, 'mutable-dev.js');
  const options = Object.freeze({ port: 0, strictPort: true });
  const events = [];

  const handle = await devApp(devContext(session, new AppToolchain(createMutatingVite(events)), 'mutable-dev.js', { options }));
  await handle.close();

  assertMutableViteConfig(events[0], 'server');
  assert.equal(Object.isFrozen(config.server), true);
  assert.deepEqual(config.server, { host: '127.0.0.1', port: 0, strictPort: true });
  assert.equal(Object.isFrozen(options), true);
  assert.deepEqual(options, { port: 0, strictPort: true });
});

test('red: wildcard Vite binds keep the requested host while ready gives a canonical local URL', async t => {
  const { root, session } = await workspace(t);
  await writeWorkspaceFile(root, 'app/index.html', template);
  await writeWorkspaceFile(root, 'build/wildcard/index.html', '<main>wildcard</main>');
  const toolchain = new AppToolchain(endpointVite());

  const ipv4 = await toolchain.startDev(Object.freeze({ session, host: '0.0.0.0', port: 0, strictPort: true }));
  const ipv6 = await toolchain.startPreview(Object.freeze({ session, configName: 'wildcard.js', host: '::', port: 0, strictPort: true }));
  const normal = await toolchain.startDev(Object.freeze({ session, host: 'localhost', port: 0, strictPort: true }));

  assert.deepEqual(await ipv4.ready, { host: '0.0.0.0', port: 42001, url: 'http://127.0.0.1:42001/' });
  assert.deepEqual(await ipv6.ready, { host: '::', port: 42002, url: 'http://[::1]:42002/' });
  assert.deepEqual(await normal.ready, { host: 'localhost', port: 42001, url: 'http://localhost:42001/' });
  await Promise.all([ipv4.close(), ipv6.close(), normal.close()]);
});

test('red: an IPv6 literal Vite bind exposes a usable bracketed ready URL without changing ready.host', async t => {
  const { root, session } = await workspace(t);
  await writeConfig(root, 'ipv6-ready.js', appConfig());
  await writeWorkspaceFile(root, 'app/index.html', template);
  let handle;
  t.after(async () => {
    await handle?.close();
  });

  handle = await devApp(devContext(session, new AppToolchain(createFakeVite()), 'ipv6-ready.js', {
    options: Object.freeze({ host: '::1', port: 0, strictPort: true })
  }));
  const ready = await handle.ready;

  assert.equal(ready.host, '::1');
  assert.equal(ready.url, `http://[::1]:${ready.port}/`);
  assert.equal(new URL(ready.url).hostname, '[::1]');
  assert.equal((await fetch(ready.url)).status, 200);
});

test('red: malformed bracketed Vite hosts are rejected before an invalid ready URL can escape', async t => {
  const { root, session } = await workspace(t);
  await writeWorkspaceFile(root, 'app/index.html', template);

  await assertCode(
    new AppToolchain(endpointVite()).startDev(Object.freeze({ session, host: '[::1', port: 0, strictPort: true })),
    'VITE_SERVER_INVALID'
  );
});

test('red: signal close rejection is reported once without unhandled rejections for dev and preview', async t => {
  const { root, session } = await workspace(t);
  await writeConfig(root, 'signal-dev.js', appConfig());
  await writeConfig(root, 'signal-preview.js', appConfig());
  await writeWorkspaceFile(root, 'build/signal-preview/index.html', '<main>preview</main>');

  await assertSignalCloseFailure({
    errorCode: 'APP_DEV_CLOSE_FAILED',
    createHandle: (signals, onCloseError) => devApp(devContext(session, { async startDev() { return failingServer(); } }, 'signal-dev.js', { signals, onCloseError }))
  });
  await assertSignalCloseFailure({
    errorCode: 'APP_PREVIEW_CLOSE_FAILED',
    createHandle: (signals, onCloseError) => previewApp(devContext(session, { async startPreview() { return failingServer(); } }, 'signal-preview.js', { signals, onCloseError }))
  });
});

test('red: dev and preview reject non-function close-error reporters before server startup', async t => {
  const { session } = await workspace(t);
  let devStarted = false;
  let previewStarted = false;

  await assertCode(devApp(devContext(session, { async startDev() { devStarted = true; return failingServer(); } }, 'missing.js', { onCloseError: 'invalid' })), 'APP_DEV_INVALID');
  await assertCode(previewApp(devContext(session, { async startPreview() { previewStarted = true; return failingServer(); } }, 'missing.js', { onCloseError: 'invalid' })), 'APP_PREVIEW_INVALID');
  assert.equal(devStarted, false);
  assert.equal(previewStarted, false);
});

test('red: build gives Vite mutable deep copies without changing frozen build or plugin inputs', async t => {
  const { root } = await workspace(t);
  const build = Object.freeze({ target: 'es2020', nested: Object.freeze({ protected: true }) });
  const plugin = Object.freeze({ name: 'caller-plugin' });
  const plugins = Object.freeze([plugin]);
  const request = Object.freeze({ root, outDir: path.join(root, 'out'), build, sourceMap: true, plugins });
  const events = [];

  await new AppToolchain(createMutatingVite(events)).build(request);

  assertMutableViteConfig(events[0], 'build');
  assert.equal(Object.isFrozen(events[0].config.plugins[0]), false);
  assert.equal(events[0].config.plugins[0].mutatedByVite, 'build');
  assert.equal(Object.isFrozen(build), true);
  assert.deepEqual(build, { target: 'es2020', nested: { protected: true } });
  assert.equal(Object.isFrozen(plugins), true);
  assert.deepEqual(plugins, [{ name: 'caller-plugin' }]);
  assert.equal(plugin.mutatedByVite, undefined);
});

test('red: preview gives Vite a mutable copy without changing frozen config or caller options', async t => {
  const { root, session } = await workspace(t);
  await writeConfig(root, 'mutable-preview.js', appConfig({ server: { host: '127.0.0.1', port: 0, strictPort: true } }));
  await writeWorkspaceFile(root, 'app/index.html', template);
  await writeWorkspaceFile(root, 'build/mutable-preview/index.html', '<main>preview</main>');
  const config = await loadCellsConfig(session, 'mutable-preview.js');
  const options = Object.freeze({ port: 0, strictPort: true });
  const events = [];

  const handle = await previewApp(devContext(session, new AppToolchain(createMutatingVite(events)), 'mutable-preview.js', { options }));
  await handle.close();

  assertMutableViteConfig(events[0], 'preview');
  assert.equal(Object.isFrozen(config.preview), true);
  assert.deepEqual(config.preview, { host: '127.0.0.1', port: 0, strictPort: true });
  assert.equal(Object.isFrozen(options), true);
  assert.deepEqual(options, { port: 0, strictPort: true });
});

test('red: build atomically publishes rendered source maps, resources, vendor, manifest, locales, and generated service-worker registration', async t => {
  const { filesystem, root, session } = await workspace(t);
  await writeConfig(root, 'release.js', appConfig({ locales: { enabledI18n: true, languages: ['en'] } }));
  await writeWorkspaceFile(root, 'app/index.html', template);
  await writeWorkspaceFile(root, 'app/src/main.js', 'console.log("fixture");\n');
  await writeWorkspaceFile(root, 'app/resources/logo.txt', 'resource\n');
  await writeWorkspaceFile(root, 'app/vendor/library.js', 'vendor\n');
  await writeWorkspaceFile(root, 'app/manifest.json', '{"name":"fixture"}\n');
  await writeWorkspaceFile(root, 'components/button/locales/en.json', '{"button":"Button"}\n');
  const vite = createFakeVite();
  const workboxApi = createFakeWorkbox();
  const result = await buildApp(buildContext(session, filesystem, new AppToolchain(vite), 'release.js', {
    options: Object.freeze({ sourceMap: true }),
    localeRequest: Object.freeze({ componentLocaleFiles: Object.freeze(['components/button/locales/en.json']) }),
    serviceWorker: Object.freeze({ mode: 'generateSW', adapter: new ServiceWorker(workboxApi) })
  }));

  assert.equal(result.destination, path.join(root, 'build', 'release'));
  assert.equal(await readFile(path.join(result.destination, 'resources', 'logo.txt'), 'utf8'), 'resource\n');
  assert.equal(await readFile(path.join(result.destination, 'vendor', 'library.js'), 'utf8'), 'vendor\n');
  assert.equal(await readFile(path.join(result.destination, 'manifest.json'), 'utf8'), '{"name":"fixture"}\n');
  assert.equal(await readFile(path.join(result.destination, 'locales', 'en.json'), 'utf8'), '{\n  "button": "Button"\n}\n');
  assert.match(await readFile(path.join(result.destination, 'assets', 'main.js'), 'utf8'), /sourceMappingURL/);
  assert.equal(await readFile(path.join(result.destination, 'assets', 'main.js.map'), 'utf8'), '{"version":3}\n');
  assert.match(await readFile(path.join(result.destination, 'index.html'), 'utf8'), /Academy/);
  assert.match(await readFile(path.join(result.destination, 'index.html'), 'utf8'), /serviceWorker\.register/);
  assert.match(await readFile(path.join(result.destination, 'sw.js'), 'utf8'), /skipWaiting/);
  assert.deepEqual(workboxApi.calls.map(call => call.method), ['generateSW']);
});

test('red: build supports injectManifest and disabled service-worker modes without writing an undeclared worker', async t => {
  const { filesystem, root, session } = await workspace(t);
  await writeConfig(root, 'inject.js', appConfig());
  await writeConfig(root, 'without-sw.js', appConfig());
  await writeWorkspaceFile(root, 'app/index.html', template);
  await writeWorkspaceFile(root, 'app/sw-source.js', 'self.addEventListener("fetch", () => {});\n');
  const workboxApi = createFakeWorkbox();
  const toolchain = new AppToolchain(createFakeVite());

  const injected = await buildApp(buildContext(session, filesystem, toolchain, 'inject.js', {
    serviceWorker: Object.freeze({
      mode: 'injectManifest',
      adapter: new ServiceWorker(workboxApi),
      options: Object.freeze({ swSrc: 'app/sw-source.js' })
    })
  }));
  const disabled = await buildApp(buildContext(session, filesystem, toolchain, 'without-sw.js'));

  assert.match(await readFile(path.join(injected.destination, 'sw.js'), 'utf8'), /__WB_MANIFEST/);
  assert.equal((await readFile(path.join(injected.destination, 'index.html'), 'utf8')).includes('serviceWorker.register'), true);
  await assert.rejects(lstat(path.join(disabled.destination, 'sw.js')), error => error?.code === 'ENOENT');
  assert.equal((await readFile(path.join(disabled.destination, 'index.html'), 'utf8')).includes('serviceWorker.register'), false);
  assert.deepEqual(workboxApi.calls.map(call => call.method), ['injectManifest']);
});

test('red: build leaves an existing publication unchanged when Vite, Workbox, or trusted config loading fails', async t => {
  const { filesystem, root, session } = await workspace(t);
  await writeConfig(root, 'broken-build.js', appConfig());
  await writeConfig(root, 'broken-workbox.js', appConfig());
  await writeConfig(root, 'throws.js', 'throw new Error("trusted-config-secret");');
  await writeWorkspaceFile(root, 'app/index.html', template);
  for (const name of ['broken-build', 'broken-workbox', 'throws']) {
    await writeWorkspaceFile(root, `build/${name}/sentinel.txt`, 'unchanged\n');
  }

  await assertCode(buildApp(buildContext(session, filesystem, new AppToolchain(createFakeVite({ failBuild: true })), 'broken-build.js')), 'VITE_BUILD_FAILED');
  await assertCode(
    buildApp(buildContext(session, filesystem, new AppToolchain(createFakeVite()), 'broken-workbox.js', {
      serviceWorker: Object.freeze({ mode: 'generateSW', adapter: new ServiceWorker(createFakeWorkbox({ fail: true })) })
    })),
    'SERVICE_WORKER_FAILED'
  );
  await assertCode(buildApp(buildContext(session, filesystem, new AppToolchain(createFakeVite()), 'throws.js')), 'CONFIG_INVALID');
  for (const name of ['broken-build', 'broken-workbox', 'throws']) {
    assert.equal(await readFile(path.join(root, 'build', name, 'sentinel.txt'), 'utf8'), 'unchanged\n');
  }
});

test('red: build refuses an app HTML symlink that would read outside the workspace', async t => {
  const { filesystem, root, session } = await workspace(t);
  const outside = await mkdtemp(path.join(os.tmpdir(), 'open-cells-academy-toolchain-outside-'));
  t.after(() => rm(outside, { recursive: true, force: true }));
  await writeConfig(root, 'outside-html.js', appConfig());
  await writeFile(path.join(outside, 'index.html'), '<main>outside workspace</main>');
  await symlink(path.join(outside, 'index.html'), path.join(root, 'app', 'index.html'));
  await writeWorkspaceFile(root, 'build/outside-html/sentinel.txt', 'unchanged\n');

  await assertCode(
    buildApp(buildContext(session, filesystem, new AppToolchain(createFakeVite()), 'outside-html.js')),
    'APP_BUILD_SOURCE_INVALID'
  );
  assert.equal(await readFile(path.join(root, 'build', 'outside-html', 'sentinel.txt'), 'utf8'), 'unchanged\n');
});

test('red: build fails closed when a staged file becomes a symlink after its directory is enumerated', async t => {
  const { filesystem, root, session } = await workspace(t);
  const outside = await mkdtemp(path.join(os.tmpdir(), 'open-cells-academy-toolchain-outside-'));
  t.after(() => rm(outside, { recursive: true, force: true }));
  await writeConfig(root, 'stage-file-race.js', appConfig());
  await writeWorkspaceFile(root, 'app/index.html', template);
  await writeWorkspaceFile(root, 'build/stage-file-race/sentinel.txt', 'unchanged\n');
  const external = path.join(outside, 'external.txt');
  await writeFile(external, 'EXTERNAL_RACE_SECRET\n');
  const vite = createStageFileRaceVite();
  const builtinFs = requireBuiltin('node:fs/promises');
  const originalReaddir = builtinFs.readdir;
  let replaced = false;
  builtinFs.readdir = async (...args) => {
    const entries = await originalReaddir(...args);
    if (!replaced && args[0] === vite.state.assets) {
      replaced = true;
      await rm(vite.state.target);
      await symlink(external, vite.state.target);
    }
    return entries;
  };
  syncBuiltinESMExports();
  t.after(() => {
    builtinFs.readdir = originalReaddir;
    syncBuiltinESMExports();
  });

  await assert.rejects(
    buildApp(buildContext(session, filesystem, new AppToolchain(vite), 'stage-file-race.js')),
    error => {
      assert.ok(['APP_BUILD_SOURCE_INVALID', 'PATH_CHANGED'].includes(error?.code));
      return true;
    }
  );
  assert.equal(replaced, true);
  assert.equal(await readFile(path.join(root, 'build', 'stage-file-race', 'sentinel.txt'), 'utf8'), 'unchanged\n');
  await assert.rejects(lstat(path.join(root, 'build', 'stage-file-race', 'assets', 'zz-target.txt')), error => error?.code === 'ENOENT');
});

test('red: build refuses a same-name Vite stage replacement without deleting the unrelated directory', async t => {
  const { filesystem, root, session } = await workspace(t);
  await writeConfig(root, 'stage-replacement.js', appConfig());
  await writeWorkspaceFile(root, 'app/index.html', template);
  const vite = createStageReplacementVite();

  await assert.rejects(
    buildApp(buildContext(session, filesystem, new AppToolchain(vite), 'stage-replacement.js')),
    error => {
      assert.equal(error?.code, 'TRANSACTION_CLEANUP_FAILED');
      assert.equal(error?.details?.operationCode, 'VITE_BUILD_FAILED');
      assert.ok(error?.cause instanceof AggregateError);
      assert.ok(error.cause.errors.some(cause => cause?.code === 'VITE_BUILD_FAILED'));
      return true;
    }
  );

  assert.equal(await readFile(path.join(vite.state.parent, 'unrelated-sentinel.txt'), 'utf8'), 'must survive\n');
  assert.equal((await lstat(vite.state.parked)).isDirectory(), true);
});

test('red: build rejects a replaced nested Vite stage before publishing its contents', async t => {
  const { filesystem, root, session } = await workspace(t);
  await writeConfig(root, 'nested-stage-replacement.js', appConfig());
  await writeWorkspaceFile(root, 'app/index.html', template);
  await writeWorkspaceFile(root, 'build/nested-stage-replacement/sentinel.txt', 'unchanged\n');
  const vite = createNestedStageReplacementVite();

  await assertCode(
    buildApp(buildContext(session, filesystem, new AppToolchain(vite), 'nested-stage-replacement.js')),
    'TRANSACTION_CLEANUP_FAILED'
  );

  assert.equal(await readFile(path.join(root, 'build', 'nested-stage-replacement', 'sentinel.txt'), 'utf8'), 'unchanged\n');
  assert.equal((await lstat(vite.state.stage)).isDirectory(), true);
});

test('red: build fails closed when an injectManifest swSrc is swapped for an external symlink during the Workbox read', async t => {
  const { filesystem, root, session } = await workspace(t);
  const outside = await mkdtemp(path.join(os.tmpdir(), 'open-cells-academy-toolchain-outside-'));
  t.after(() => rm(outside, { recursive: true, force: true }));
  await writeConfig(root, 'swsrc-swap.js', appConfig());
  await writeWorkspaceFile(root, 'app/index.html', template);
  await writeWorkspaceFile(root, 'app/sw-source.js', 'self.addEventListener("fetch", () => {});\n');
  await writeWorkspaceFile(root, 'build/swsrc-swap/sentinel.txt', 'unchanged\n');
  const external = path.join(outside, 'external-sw.js');
  await writeFile(external, 'const EXTERNAL_SW_SECRET = true;\n');
  const state = {};
  const racingWorkbox = {
    async generateSW() {
      throw new Error('not used');
    },
    async injectManifest(options) {
      state.swSrc = options.swSrc;
      state.swDest = options.swDest;
      await rm(options.swSrc);
      await symlink(external, options.swSrc);
      const leaked = await readFile(options.swSrc, 'utf8');
      await writeFile(options.swDest, `${leaked}\nself.__WB_MANIFEST;\n`);
      await rm(options.swSrc);
      await writeFile(options.swSrc, 'self.addEventListener("fetch", () => {});\n');
    }
  };

  await assert.rejects(
    buildApp(buildContext(session, filesystem, new AppToolchain(createFakeVite()), 'swsrc-swap.js', {
      serviceWorker: Object.freeze({ mode: 'injectManifest', adapter: new ServiceWorker(racingWorkbox), options: Object.freeze({ swSrc: 'app/sw-source.js' }) })
    })),
    error => {
      assert.equal(error?.code, 'SERVICE_WORKER_FAILED');
      return true;
    }
  );
  assert.equal(await readFile(path.join(root, 'build', 'swsrc-swap', 'sentinel.txt'), 'utf8'), 'unchanged\n');
  await assert.rejects(lstat(path.join(root, 'build', 'swsrc-swap', 'sw.js')), error => error?.code === 'ENOENT');
});

test('red: app use cases keep all Node filesystem ownership inside the Vite adapter', async () => {
  const applicationRoot = path.join(import.meta.dirname, '../../src/application/app');
  const sources = await Promise.all(['dev-app.js', 'build-app.js', 'preview-app.js'].map(file => readFile(path.join(applicationRoot, file), 'utf8')));
  const adapter = await readFile(path.join(import.meta.dirname, '../../src/adapters/vite/app-toolchain.js'), 'utf8');

  for (const source of sources) assert.doesNotMatch(source, /from 'node:(?:fs|os|path|process)/);
  assert.match(adapter, /from 'node:fs\/promises'/);
});

test('red: build forwards frozen config.build and permits only explicit sourceMap CLI override', async t => {
  const { filesystem, root, session } = await workspace(t);
  await writeConfig(root, 'configured.js', appConfig({ build: { target: 'es2019', sourcemap: true } }));
  await writeConfig(root, 'overridden.js', appConfig({ build: { target: 'es2020', sourcemap: true } }));
  await writeWorkspaceFile(root, 'app/index.html', template);
  const vite = createFakeVite();
  const toolchain = new AppToolchain(vite);

  await buildApp(buildContext(session, filesystem, toolchain, 'configured.js'));
  await buildApp(buildContext(session, filesystem, toolchain, 'overridden.js', { options: Object.freeze({ sourceMap: false }) }));
  const calls = vite.calls.filter(call => call.method === 'build');

  assert.equal(calls[0].config.build.target, 'es2019');
  assert.equal(calls[0].config.build.sourcemap, true);
  assert.equal(calls[1].config.build.target, 'es2020');
  assert.equal(calls[1].config.build.sourcemap, false);
});

test('red: Workbox dispatch ignores user mode overrides and receives only public canonical options', async t => {
  const { filesystem, root, session } = await workspace(t);
  await writeConfig(root, 'workbox-options.js', appConfig());
  await writeWorkspaceFile(root, 'app/index.html', template);
  const workboxApi = createFakeWorkbox();

  await buildApp(buildContext(session, filesystem, new AppToolchain(createFakeVite()), 'workbox-options.js', {
    serviceWorker: Object.freeze({
      mode: 'generateSW',
      adapter: new ServiceWorker(workboxApi),
      options: Object.freeze({ mode: 'injectManifest', clientsClaim: true })
    })
  }));

  assert.deepEqual(workboxApi.calls.map(call => call.method), ['generateSW']);
  assert.equal(Object.hasOwn(workboxApi.calls[0].options, 'mode'), false);
  assert.equal(workboxApi.calls[0].options.clientsClaim, true);
  assert.equal(typeof workboxApi.calls[0].options.swDest, 'string');
});

test('red: failed atomic publication does not leave a new build parent behind', async t => {
  const { filesystem, root, session } = await workspace(t);
  await writeConfig(root, 'publish-failure.js', appConfig());
  await writeWorkspaceFile(root, 'app/index.html', template);
  const failingFilesystem = Object.create(filesystem);
  failingFilesystem.applyPlanAtomically = async () => {
    const error = new Error('publication-failure');
    error.code = 'PUBLISH_FAILED';
    throw error;
  };

  await assertCode(buildApp(buildContext(session, failingFilesystem, new AppToolchain(createFakeVite()), 'publish-failure.js')), 'PUBLISH_FAILED');
  await assert.rejects(lstat(path.join(root, 'build')), error => error?.code === 'ENOENT');
});

test('red: build locale planning keeps trusted config over a caller-supplied locale configuration', async t => {
  const { filesystem, root, session } = await workspace(t);
  await writeConfig(root, 'locale-config.js', appConfig({ locales: { enabledI18n: false } }));
  await writeWorkspaceFile(root, 'app/index.html', template);
  await writeWorkspaceFile(root, 'components/button/locales/en.json', '{"button":"Button"}\n');

  const result = await buildApp(buildContext(session, filesystem, new AppToolchain(createFakeVite()), 'locale-config.js', {
    localeRequest: Object.freeze({
      config: Object.freeze({ enabledI18n: true, languages: Object.freeze(['en']) }),
      componentLocaleFiles: Object.freeze(['components/button/locales/en.json'])
    })
  }));

  await assert.rejects(lstat(path.join(result.destination, 'locales', 'en.json')), error => error?.code === 'ENOENT');
});

test('red: preview requires a published build, serves it over HTTP, and provides idempotent strict-port lifecycle cleanup', async t => {
  const { filesystem, root, session } = await workspace(t);
  await writeConfig(root, 'preview.js', appConfig());
  await writeConfig(root, 'missing-preview.js', appConfig());
  await writeWorkspaceFile(root, 'app/index.html', template);
  const vite = createFakeVite();
  const toolchain = new AppToolchain(vite);
  const signals = new EventEmitter();

  await assertCode(previewApp(devContext(session, toolchain, 'missing-preview.js', { signals })), 'BUILD_NOT_FOUND');
  const build = await buildApp(buildContext(session, filesystem, toolchain, 'preview.js'));
  const handle = await previewApp(devContext(session, toolchain, 'preview.js', { signals, options: Object.freeze({ port: 0 }) }));
  const ready = await handle.ready;
  assert.match(await (await fetch(ready.url)).text(), /Academy/);
  assert.equal(signals.listenerCount('SIGINT'), 1);
  const close = handle.close();
  assert.strictEqual(handle.close(), close);
  await close;
  assert.equal(signals.listenerCount('SIGINT'), 0);
  assert.equal(await portIsReleased(ready.port), true);
  assert.equal(build.destination, path.join(root, 'build', 'preview'));
});

test('red: preview falls back from a non-strict occupied port and rejects a strict occupied port without signal residue', async t => {
  const { filesystem, root, session } = await workspace(t);
  await writeConfig(root, 'preview-ports.js', appConfig());
  await writeWorkspaceFile(root, 'app/index.html', template);
  const toolchain = new AppToolchain(createFakeVite());
  await buildApp(buildContext(session, filesystem, toolchain, 'preview-ports.js'));
  const occupied = await occupyPort();
  t.after(() => occupied.close());
  const signals = new EventEmitter();

  const fallback = await previewApp(devContext(session, toolchain, 'preview-ports.js', {
    signals,
    options: Object.freeze({ port: occupied.port, strictPort: false })
  }));
  const ready = await fallback.ready;
  assert.notEqual(ready.port, occupied.port);
  await fallback.close();
  await assertCode(
    previewApp(devContext(session, toolchain, 'preview-ports.js', {
      signals,
      options: Object.freeze({ port: occupied.port, strictPort: true })
    })),
    'VITE_PREVIEW_FAILED'
  );
  assert.equal(signals.listenerCount('SIGINT'), 0);
  assert.equal(signals.listenerCount('SIGTERM'), 0);
});
