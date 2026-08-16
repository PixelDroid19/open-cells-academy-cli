import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import * as vite from 'vite';

import { AppToolchain } from '../../src/adapters/vite/app-toolchain.js';
import { buildApp } from '../../src/application/app/build-app.js';
import { devApp } from '../../src/application/app/dev-app.js';
import { NodeFilesystem } from '../../src/adapters/node/node-filesystem.js';
import { WorkspaceSession } from '../../src/domain/workspace-session.js';

async function write(root, relative, content) {
  const target = path.join(root, relative);
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, content);
  return target;
}

async function fixture(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'open-cells-legacy-serve-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await write(root, 'package.json', '{"name":"legacy-serve-fixture","private":true,"type":"module"}\n');
  await write(root, 'app/index.html', '<main>stale</main>\n');
  await write(root, 'app/tpls/index.tpl', '<!doctype html><html lang="##lang##"><body data-label="##label##"><script src="/scripts/vendor/runtime.js"></script><script type="module" src="/scripts/app-bootstrap.js"></script></body></html>\n');
  await write(root, 'app/scripts/app-bootstrap.js', '(function () { window.AppConfig = {}; window.__runtimeEnvironment = window.AppConfig.environment; }());\n');
  await write(root, 'app/scripts/vendor/runtime.js', 'window.__legacyVendorLoaded = true;\nwindow.__sourceMapText = "//# sourceMappingURL=kept.js.map";\n//# sourceMappingURL=runtime.js.map\n');
  await write(root, 'app/config/market/dev.js', 'export default { lang: "es", label: "DEV", environment: "de", componentsPath: "components/" };\n');
  await write(root, 'app/config/market/qa.js', 'export default { lang: "es", label: "QA", environment: "qa", componentsPath: "components/" };\n');
  await write(root, 'dist/index.html', '<!doctype html><html><body><main data-runtime="dist">legacy-ready</main><script src="/cells-polymer-bridge.min.js"></script><script type="module" src="/app-module.js"></script></body></html>\n');
  await write(root, 'dist/app-module.js', 'window.AppConfig = {}; document.body.dataset.environment = window.AppConfig.environment;\n');
  await write(root, 'dist/cells-polymer-bridge.min.js', 'window.__bridgeLoaded = true;\nwindow.__sourceMapText = "//# sourceMappingURL=kept.js.map";\n//# sourceMappingURL=cells-polymer-bridge.min.js.map\n');
  const session = await WorkspaceSession.open(root, new NodeFilesystem());
  return { root, session };
}

async function runtimeConfig(url) {
  const response = await fetch(new URL('scripts/app-bootstrap.js', url));
  assert.equal(response.status, 200);
  const source = await response.text();
  const match = source.match(/window\.AppConfig\s*=\s*(\{.*\});/);
  assert.ok(match);
  return JSON.parse(match[1]);
}

async function waitForEnvironment(url, expected) {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    const config = await runtimeConfig(`${url}?t=${Date.now()}`);
    if (config.environment === expected) return config;
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  assert.fail(`Timed out waiting for ${expected}`);
}

test('integration: real Vite serves distinct legacy DEV and QA profiles without rewriting app sources', async t => {
  const { root, session } = await fixture(t);
  const toolchain = new AppToolchain(vite);
  const sourcePaths = ['app/index.html', 'app/tpls/index.tpl', 'app/scripts/app-bootstrap.js'];
  const originals = await Promise.all(sourcePaths.map(relative => readFile(path.join(root, relative), 'utf8')));
  let handle;
  t.after(async () => handle?.close());

  handle = await devApp(Object.freeze({
    session,
    toolchain,
    configName: 'market/dev.js',
    options: Object.freeze({ host: '127.0.0.1', port: 0, strictPort: true, open: false })
  }));
  const dev = await handle.ready;
  assert.equal((await fetch(dev.url)).status, 200);
  assert.equal((await fetch(new URL('@vite/client', dev.url))).status, 200);
  assert.match(await (await fetch(dev.url)).text(), /data-label="DEV"/);
  const runtimeSource = await (await fetch(new URL('scripts/vendor/runtime.js', dev.url))).text();
  assert.match(runtimeSource, /window\.__legacyVendorLoaded = true/);
  assert.match(runtimeSource, /sourceMappingURL=kept\.js\.map/);
  assert.doesNotMatch(runtimeSource, /sourceMappingURL=runtime\.js\.map/);
  assert.equal((await runtimeConfig(dev.url)).environment, 'de');

  await write(root, 'app/config/market/dev.js', 'export default { lang: "es", label: "DEV", environment: "de-live" };\n');
  assert.equal((await waitForEnvironment(dev.url, 'de-live')).environment, 'de-live');
  await handle.close();
  handle = undefined;

  handle = await devApp(Object.freeze({
    session,
    toolchain,
    configName: 'market/qa.js',
    options: Object.freeze({ host: '127.0.0.1', port: 0, strictPort: true, open: false })
  }));
  const qa = await handle.ready;
  assert.match(await (await fetch(qa.url)).text(), /data-label="QA"/);
  assert.equal((await runtimeConfig(qa.url)).environment, 'qa');
  await handle.close();
  handle = undefined;

  assert.deepEqual(await Promise.all(sourcePaths.map(relative => readFile(path.join(root, relative), 'utf8'))), originals);
});

test('integration: legacy app:serve runs the prepared dist tree with the selected nested config', async t => {
  const { root, session } = await fixture(t);
  const toolchain = new AppToolchain(Object.freeze({
    ...vite,
    async createServer() {
      throw new Error('legacy dist must not pass through the Vite transform server');
    }
  }));
  const sourcePaths = ['dist/index.html', 'dist/app-module.js'];
  const originals = await Promise.all(sourcePaths.map(relative => readFile(path.join(root, relative), 'utf8')));
  let handle;
  t.after(async () => handle?.close());

  handle = await devApp(Object.freeze({
    session,
    toolchain,
    configName: 'market/dev.js',
    runtime: 'legacy-dist',
    options: Object.freeze({ host: '127.0.0.1', port: 0, strictPort: true, open: false })
  }));
  const ready = await handle.ready;
  const html = await (await fetch(ready.url)).text();
  const appModule = await (await fetch(new URL('app-module.js', ready.url))).text();
  const bridge = await (await fetch(new URL('cells-polymer-bridge.min.js', ready.url))).text();

  assert.match(html, /data-runtime="dist"/);
  assert.doesNotMatch(html, />stale</);
  assert.match(appModule, /"environment":"de"/);
  assert.match(appModule, /"componentsPath":"\.\/bower_components\/"/);
  assert.equal(bridge, 'window.__bridgeLoaded = true;\nwindow.__sourceMapText = "//# sourceMappingURL=kept.js.map";\n//# sourceMappingURL=cells-polymer-bridge.min.js.map\n');
  await handle.close();
  handle = undefined;
  assert.deepEqual(await Promise.all(sourcePaths.map(relative => readFile(path.join(root, relative), 'utf8'))), originals);
});

test('integration: legacy app:serve keeps static reads contained and owns strict-port lifecycle', async t => {
  const { root, session } = await fixture(t);
  const outside = await mkdtemp(path.join(os.tmpdir(), 'open-cells-legacy-outside-'));
  t.after(() => rm(outside, { recursive: true, force: true }));
  await write(outside, 'secret.js', 'external-secret\n');
  await symlink(path.join(outside, 'secret.js'), path.join(root, 'dist', 'escape.js'));
  const toolchain = new AppToolchain(Object.freeze({
    ...vite,
    async createServer() {
      throw new Error('legacy dist must not pass through Vite');
    }
  }));
  const handles = [];
  t.after(async () => Promise.all(handles.map(handle => handle.close())));
  const context = (port, strictPort) => Object.freeze({
    session,
    toolchain,
    configName: 'market/dev.js',
    runtime: 'legacy-dist',
    options: Object.freeze({ host: '127.0.0.1', port, strictPort, open: false })
  });

  const first = await devApp(context(0, true));
  handles.push(first);
  const ready = await first.ready;
  assert.equal((await fetch(new URL('missing.js', ready.url))).status, 404);
  assert.equal((await fetch(new URL('escape.js', ready.url))).status, 404);
  const head = await fetch(new URL('app-module.js', ready.url), { method: 'HEAD' });
  assert.equal(head.status, 200);
  assert.equal(await head.text(), '');
  assert.equal((await fetch(ready.url, { method: 'POST' })).status, 405);

  await assert.rejects(devApp(context(ready.port, true)), error => error.code === 'VITE_DEV_FAILED');
  const fallback = await devApp(context(ready.port, false));
  handles.push(fallback);
  assert.notEqual((await fallback.ready).port, ready.port);
});

test('integration: real Vite build consumes the rendered legacy HTML before emitting asset references', async t => {
  const { root, session } = await fixture(t);
  const filesystem = new NodeFilesystem();

  const result = await buildApp(Object.freeze({
    session,
    filesystem,
    toolchain: new AppToolchain(vite),
    configName: 'market/qa.js'
  }));

  const html = await readFile(path.join(result.destination, 'index.html'), 'utf8');
  assert.match(html, /(?:src|href)="\.\/assets\//);
  assert.match(html, /scripts\/vendor\/runtime\.js/);
  assert.equal(await readFile(path.join(result.destination, 'scripts/vendor/runtime.js'), 'utf8'), 'window.__legacyVendorLoaded = true;\nwindow.__sourceMapText = "//# sourceMappingURL=kept.js.map";\n//# sourceMappingURL=runtime.js.map\n');
  assert.doesNotMatch(html, /scripts\/app-bootstrap\.js/);
  assert.doesNotMatch(html, /##[A-Za-z0-9_.-]+##/);
});
