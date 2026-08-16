import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import * as vite from 'vite';

import { AppToolchain } from '../../src/adapters/vite/app-toolchain.js';
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
  await write(root, 'app/tpls/index.tpl', '<!doctype html><html lang="##lang##"><body data-label="##label##"><script type="module" src="/scripts/app-bootstrap.js"></script></body></html>\n');
  await write(root, 'app/scripts/app-bootstrap.js', '(function () { window.AppConfig = {}; window.__runtimeEnvironment = window.AppConfig.environment; }());\n');
  await write(root, 'app/config/market/dev.js', 'export default { lang: "es", label: "DEV", environment: "de" };\n');
  await write(root, 'app/config/market/qa.js', 'export default { lang: "es", label: "QA", environment: "qa" };\n');
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
