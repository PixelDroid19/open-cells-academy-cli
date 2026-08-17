import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { createServer as createNetServer } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import * as vite from 'vite';
import * as sass from 'sass';

import { AppToolchain } from '../../src/adapters/vite/app-toolchain.js';
import { buildApp } from '../../src/application/app/build-app.js';
import { devApp } from '../../src/application/app/dev-app.js';
import { NodeFilesystem } from '../../src/adapters/node/node-filesystem.js';
import { SassCompiler } from '../../src/adapters/sass/sass-compiler.js';
import { WorkspaceSession } from '../../src/domain/workspace-session.js';
import { composeRecipe } from '../../src/recipes/compose-recipe.js';

async function write(root, relative, content) {
  const target = path.join(root, relative);
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, content);
  return target;
}

async function within(milliseconds, label, operation) {
  let timer;
  try {
    return await Promise.race([
      operation,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(`Timed out: ${label}`)), milliseconds);
      })
    ]);
  } finally {
    clearTimeout(timer);
  }
}

async function fixture(t, { preparedDist = true } = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'open-cells-legacy-serve-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await write(root, 'package.json', '{"name":"legacy-serve-fixture","private":true,"type":"module"}\n');
  await write(root, 'app/index.html', '<main>stale</main>\n');
  await write(root, 'app/tpls/index.tpl', '<!doctype html><html lang="##lang##"><body data-label="##label##"><script src="/scripts/vendor/runtime.js"></script><script type="module" src="/scripts/app-bootstrap.js"></script></body></html>\n');
  await write(root, 'app/tpls/initial-components-imports.tpl', '<link rel="import" href="runtime-shell/runtime-shell.html">\n<!-- will be replaced with imports -->\n<!-- will be replaced with dependencies -->\n');
  await write(root, 'app/tpls/initial-components-imports-themed.tpl', '<link rel="import" href="runtime-shell/runtime-shell.html">\n<link rel="import" href="themed-shell/themed-shell.html">\n<!-- will be replaced with imports -->\n<!-- will be replaced with dependencies -->\n');
  await write(root, 'app/scripts/app-bootstrap.js', '(function () { window.AppConfig = {}; window.__runtimeEnvironment = window.AppConfig.environment; }());\n');
  await write(root, 'app/scripts/app-module.js', "import './app-bootstrap.js';\nimport './app-analytics.js';\n");
  await write(root, 'app/scripts/app-analytics.js', "import { runtimeValue } from 'fixture-runtime';\nwindow.__fixtureRuntime = runtimeValue;\n");
  await write(root, 'app/scripts/lit-initial-components.js', "import { runtimeValue } from 'fixture-runtime';\nwindow.__initialRuntime = runtimeValue;\n");
  await write(root, 'app/scripts/lit-components.js', 'window.__deferredRuntime = true;\n');
  await write(root, 'app/scripts/vendor/runtime.js', 'window.__legacyVendorLoaded = true;\nwindow.__sourceMapText = "//# sourceMappingURL=kept.js.map";\n//# sourceMappingURL=runtime.js.map\n');
  await write(root, 'app/styles/main.scss', '$foreground: #123456;\nbody { color: $foreground; }\n');
  await write(root, 'app/images/academy.svg', '<svg xmlns="http://www.w3.org/2000/svg"/>\n');
  await write(root, 'app/vendor/browser.js', 'window.__browserLoaded = true;\n');
  await write(root, 'app/manifest.json', '{"name":"legacy-serve-fixture"}\n');
  await write(root, 'app/locales-app/en.json', '{"legacy-title":"Legacy title"}\n');
  await write(root, 'app/locales-app/es.json', '{"legacy-title":"Titulo legacy"}\n');
  await write(root, 'app/elements/local-shell/local-shell.html', '<dom-module id="local-shell"></dom-module>\n');
  await write(root, 'components/runtime-shell/runtime-shell.html', '<dom-module id="runtime-shell"></dom-module>\n');
  await write(root, 'components/runtime-shell/index.mjs', 'export const legacyModule = true;\n');
  await write(root, 'components/themed-shell/themed-shell.html', '<dom-module id="themed-shell"></dom-module>\n');
  await write(root, 'components/polymer/polymer.html', '<script>window.Polymer = window.Polymer || {};</script>\n');
  await write(root, 'node_modules/@cells/cells-bridge/dist/cells-polymer-bridge.min.js', 'window.CellsPolymerBridge = class {};\n');
  await write(root, 'node_modules/fixture-runtime/package.json', '{"name":"fixture-runtime","version":"1.0.0","type":"module","exports":"./index.js"}\n');
  await write(root, 'node_modules/fixture-runtime/index.js', 'export const runtimeValue = "resolved";\n');
  await write(root, 'app/config/market/dev.js', 'export default { lang: "es", label: "DEV", environment: "de", componentsPath: "components/", isThemedMode: true };\n');
  await write(root, 'app/config/market/qa.js', 'export default { lang: "es", label: "QA", environment: "qa", componentsPath: "components/" };\n');
  if (preparedDist) {
    await write(root, 'dist/index.html', '<!doctype html><html><body><main data-runtime="dist">legacy-ready</main><script src="/cells-polymer-bridge.min.js"></script><script type="module" src="/app-module.js"></script></body></html>\n');
    await write(root, 'dist/app-module.js', 'window.AppConfig = {}; document.body.dataset.environment = window.AppConfig.environment;\n');
    await write(root, 'dist/cells-polymer-bridge.min.js', 'window.__bridgeLoaded = true;\nwindow.__sourceMapText = "//# sourceMappingURL=kept.js.map";\n//# sourceMappingURL=cells-polymer-bridge.min.js.map\n');
  }
  const session = await WorkspaceSession.open(root, new NodeFilesystem());
  return { root, session };
}

async function bridge3Fixture(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'open-cells-bridge3-serve-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await write(root, 'package.json', '{"name":"bridge3-serve-owner","private":true,"type":"module"}\n');
  const filesystem = new NodeFilesystem();
  const owner = await WorkspaceSession.open(root, filesystem);
  const publication = await filesystem.applyPlanAtomically(owner, composeRecipe('web-app', {
    kind: 'app',
    name: 'bridge3-serve-learning-app',
    cellsVersion: '4'
  }), 'bridge3-serve-learning-app');
  return Object.freeze({
    filesystem,
    project: publication.destination,
    session: await WorkspaceSession.open(publication.destination, filesystem)
  });
}

test('integration: legacy app:serve builds a fresh development dist before listening', async t => {
  const { root, session } = await fixture(t, { preparedDist: false });
  const toolchain = new AppToolchain(vite);
  let handle;
  t.after(async () => {
    if (handle === undefined) return;
    await within(5_000, 'legacy close', handle.close());
  });

  handle = await within(10_000, 'legacy dev start', devApp(Object.freeze({
    session,
    filesystem: new NodeFilesystem(),
    compiler: new SassCompiler(sass),
    toolchain,
    configName: 'market/dev.js',
    runtime: 'legacy-dist',
    options: Object.freeze({ host: '127.0.0.1', port: 0, strictPort: true, open: false })
  })));
  const ready = await within(5_000, 'legacy ready', handle.ready);

  const generatedIndex = await readFile(path.join(root, 'dist/index.html'), 'utf8');
  assert.match(generatedIndex, /<html lang="es">/);
  assert.ok(generatedIndex.indexOf('vendor/cells/cells-polymer-bridge.min.js') < generatedIndex.indexOf('scripts/app-bootstrap.js'));
  assert.equal(await readFile(path.join(root, 'dist/vendor/cells/cells-polymer-bridge.min.js'), 'utf8'), 'window.CellsPolymerBridge = class {};\n');
  assert.match(await readFile(path.join(root, 'dist/scripts/app-bootstrap.js'), 'utf8'), /"environment":"de"/);
  assert.match(await readFile(path.join(root, 'dist/styles/main.css'), 'utf8'), /color:\s*#123456/);
  assert.equal(await readFile(path.join(root, 'dist/images/academy.svg'), 'utf8'), '<svg xmlns="http://www.w3.org/2000/svg"/>\n');
  assert.equal(await readFile(path.join(root, 'dist/vendor/browser.js'), 'utf8'), 'window.__browserLoaded = true;\n');
  assert.deepEqual(JSON.parse(await readFile(path.join(root, 'dist/locales/en.json'), 'utf8')), { 'legacy-title': 'Legacy title' });
  assert.match(await readFile(path.join(root, 'dist/lit-initial-components.html'), 'utf8'), /lit-initial-components-loaded/);
  assert.match(await readFile(path.join(root, 'dist/lit-initial-components.html'), 'utf8'), /scripts\/lit-initial-components\.js/);
  assert.match(await readFile(path.join(root, 'dist/lit-components.html'), 'utf8'), /scripts\/lit-components\.js/);
  const initialComponents = await readFile(path.join(root, 'dist/bower_components/initial-components.html'), 'utf8');
  assert.match(initialComponents, /runtime-shell\/runtime-shell\.html/);
  assert.match(initialComponents, /themed-shell\/themed-shell\.html/);
  assert.ok(initialComponents.indexOf('polymer/polymer.html') < initialComponents.indexOf('runtime-shell/runtime-shell.html'));
  assert.doesNotMatch(initialComponents, /cells-polymer-bridge/);
  const componentResponse = await within(5_000, 'component asset', fetch(new URL('bower_components/runtime-shell/runtime-shell.html', ready.url)));
  assert.equal(componentResponse.status, 200);
  await within(5_000, 'component asset body', componentResponse.text());
  const elementResponse = await within(5_000, 'element asset', fetch(new URL('elements/local-shell/local-shell.html', ready.url)));
  assert.equal(elementResponse.status, 200);
  await within(5_000, 'element asset body', elementResponse.text());
  const viteClientResponse = await within(5_000, 'Vite client', fetch(new URL('@vite/client', ready.url)));
  assert.equal(viteClientResponse.status, 200);
  await within(5_000, 'Vite client body', viteClientResponse.text());
  const analyticsResponse = await within(5_000, 'analytics module', fetch(new URL('scripts/app-analytics.js', ready.url)));
  const analytics = await within(5_000, 'analytics module body', analyticsResponse.text());
  assert.doesNotMatch(analytics, /from 'fixture-runtime'/);
  assert.match(analytics, /node_modules/);
  const bootstrapResponse = await within(5_000, 'bootstrap module', fetch(new URL('scripts/app-bootstrap.js', ready.url)));
  assert.equal(bootstrapResponse.status, 200);
  await within(5_000, 'bootstrap module body', bootstrapResponse.text());
  const rootResponse = await within(5_000, 'legacy root', fetch(ready.url));
  assert.match(await within(5_000, 'legacy root body', rootResponse.text()), /data-label="DEV"/);
});

test('integration: failed legacy development generation preserves the previous dist', async t => {
  const { root, session } = await fixture(t);
  await write(root, 'dist/previous-output.txt', 'keep-me\n');
  await write(root, 'app/composerMocksTpl/welcome.js', 'export default 42;\n');
  await write(root, 'app/config/market/dev.js', 'export default { lang: "es", environment: "de", composerEndpoint: "composerMocks", routes: { welcome: {} }, initialBundle: ["welcome"] };\n');

  await assert.rejects(devApp(Object.freeze({
    session,
    filesystem: new NodeFilesystem(),
    compiler: new SassCompiler(sass),
    toolchain: new AppToolchain(vite),
    configName: 'market/dev.js',
    runtime: 'legacy-dist',
    options: Object.freeze({ host: '127.0.0.1', port: 0, strictPort: true, open: false })
  })), error => error.code === 'LEGACY_APP_BUILD_INVALID' && error.details?.step === 'composer');

  assert.equal(await readFile(path.join(root, 'dist/previous-output.txt'), 'utf8'), 'keep-me\n');
  assert.equal((await readdir(root)).some(name => name.startsWith('.open-cells-academy-stage-')), false);
});

test('integration: legacy serve keeps testing locale artifacts out of the public dist', async t => {
  const { root, session } = await fixture(t, { preparedDist: false });
  await write(root, 'app/config/market/dev.js', 'export default { lang: "en", environment: "de", locales: { enabledI18n: true, forTesting: true, languages: ["en"], intlInputFileNames: ["locales"] } };\n');
  let handle;
  t.after(async () => handle?.close());

  handle = await devApp(Object.freeze({
    session,
    filesystem: new NodeFilesystem(),
    compiler: new SassCompiler(sass),
    toolchain: new AppToolchain(vite),
    configName: 'market/dev.js',
    runtime: 'legacy-dist',
    options: Object.freeze({ host: '127.0.0.1', port: 0, strictPort: true, open: false })
  }));
  await handle.ready;

  assert.deepEqual(JSON.parse(await readFile(path.join(root, 'dist/locales/en.json'), 'utf8')), { 'legacy-title': 'Legacy title' });
  await assert.rejects(readFile(path.join(root, 'dist/test/unit/market/dev/locales/en.json')), error => error.code === 'ENOENT');
});

test('integration: legacy app:serve rebuilds generated development output after a source change', async t => {
  const { root, session } = await fixture(t, { preparedDist: false });
  let handle;
  t.after(async () => handle?.close());

  handle = await devApp(Object.freeze({
    session,
    filesystem: new NodeFilesystem(),
    compiler: new SassCompiler(sass),
    toolchain: new AppToolchain(vite),
    configName: 'market/dev.js',
    runtime: 'legacy-dist',
    options: Object.freeze({ host: '127.0.0.1', port: 0, strictPort: true, open: false })
  }));
  const ready = await handle.ready;
  await new Promise(resolve => setTimeout(resolve, 100));
  await write(root, 'app/styles/main.scss', '$foreground: #654321;\nbody { color: $foreground; }\n');

  await within(5_000, 'legacy source rebuild', (async () => {
    while (true) {
      try {
        const css = await readFile(path.join(root, 'dist/styles/main.css'), 'utf8');
        if (/#654321/u.test(css)) return;
      } catch (error) {
        if (error.code !== 'ENOENT') throw error;
      }
      await new Promise(resolve => setTimeout(resolve, 25));
    }
  })());
  assert.equal((await fetch(ready.url)).status, 200);
  assert.equal((await handle.ready).port, ready.port);
});

test('integration: a generated Bridge 3 application serves, rebuilds, and preserves its last dist on a Composer failure', async t => {
  const { filesystem, project, session } = await bridge3Fixture(t);
  let handle;
  t.after(async () => handle?.close());

  handle = await devApp(Object.freeze({
    session,
    filesystem,
    compiler: new SassCompiler(sass),
    toolchain: new AppToolchain(vite),
    configName: 'dev.js',
    runtime: 'legacy-dist',
    options: Object.freeze({ host: '127.0.0.1', port: 0, strictPort: true, open: false })
  }));
  const ready = await handle.ready;
  const index = await readFile(path.join(project, 'dist', 'index.html'), 'utf8');
  const bootstrap = await readFile(path.join(project, 'dist', 'scripts', 'app-bootstrap.js'), 'utf8');
  const initialImports = await readFile(path.join(project, 'dist', 'bower_components', 'initial-components.html'), 'utf8');
  const deferredImports = await readFile(path.join(project, 'dist', 'bower_components', 'app-components.html'), 'utf8');
  const composer = JSON.parse(await readFile(path.join(project, 'dist', 'composerMocks', 'catalog.json'), 'utf8'));
  const locales = JSON.parse(await readFile(path.join(project, 'dist', 'locales', 'en.json'), 'utf8'));
  const css = await readFile(path.join(project, 'dist', 'styles', 'main.css'), 'utf8');
  const response = await fetch(ready.url);

  assert.equal(response.status, 200);
  assert.match(await response.text(), /data-open-cells-route="catalog"/u);
  assert.match(index, /Open Cells learning catalog/u);
  assert.match(bootstrap, /"composerEndpoint":"composerMocks"/u);
  assert.equal(composer.template.tag, 'academy-learning-shell');
  assert.match(initialImports, /academy-learning-shell\/academy-learning-shell\.html/u);
  assert.match(deferredImports, /academy-lesson-page\/academy-lesson-page\.html/u);
  assert.equal(locales['catalog.title'], 'Open Cells learning catalog');
  assert.match(css, /color:\s*#1e293b/u);

  const lesson = path.join(project, 'app', 'pages', 'lesson-page', 'lesson-page.js');
  const originalLesson = await readFile(lesson, 'utf8');
  await new Promise(resolve => setTimeout(resolve, 100));
  await writeFile(lesson, originalLesson.replace('Latest progress:', 'Rebuilt progress:'));
  await within(5_000, 'Bridge 3 page rebuild', (async () => {
    while (true) {
      const rebuilt = await readFile(path.join(project, 'dist', 'pages', 'lesson-page', 'lesson-page.js'), 'utf8');
      if (rebuilt.includes('Rebuilt progress:')) return;
      await new Promise(resolve => setTimeout(resolve, 25));
    }
  })());

  const stableIndex = await readFile(path.join(project, 'dist', 'index.html'), 'utf8');
  await writeFile(path.join(project, 'app', 'composerMocksTpl', 'catalog.js'), 'module.exports = () => { throw new Error("Composer rebuild failure"); };\n');
  await new Promise(resolve => setTimeout(resolve, 350));
  assert.equal(await readFile(path.join(project, 'dist', 'index.html'), 'utf8'), stableIndex);

  await handle.close();
  handle = undefined;
  const probe = await new Promise((resolve, reject) => {
    const server = createNetServer();
    server.once('error', reject);
    server.listen(ready.port, '127.0.0.1', () => resolve(server));
  });
  await new Promise((resolve, reject) => probe.close(error => error === undefined ? resolve() : reject(error)));
});

test('integration: closing legacy serve cancels an active composer rebuild', async t => {
  const { root, session } = await fixture(t, { preparedDist: false });
  const marker = path.join(root, 'composer-started.txt');
  await write(root, 'app/composerMocksTpl/welcome.js', `const fs = require('node:fs'); module.exports = () => { fs.writeFileSync(${JSON.stringify(marker)}, 'started'); while (true) {} };\n`);
  let handle;
  t.after(async () => handle?.close());

  handle = await devApp(Object.freeze({
    session,
    filesystem: new NodeFilesystem(),
    compiler: new SassCompiler(sass),
    toolchain: new AppToolchain(vite),
    configName: 'market/dev.js',
    runtime: 'legacy-dist',
    options: Object.freeze({ host: '127.0.0.1', port: 0, strictPort: true, open: false })
  }));
  await handle.ready;
  await new Promise(resolve => setTimeout(resolve, 100));
  await write(root, 'app/config/market/dev.js', 'export default { lang: "es", environment: "de", composerEndpoint: "composerMocks", routes: { welcome: {} }, initialBundle: ["welcome"] };\n');
  await within(5_000, 'composer rebuild start', (async () => {
    while (true) {
      try {
        if (await readFile(marker, 'utf8') === 'started') return;
      } catch (error) {
        if (error.code !== 'ENOENT') throw error;
      }
      await new Promise(resolve => setTimeout(resolve, 20));
    }
  })());

  await within(2_000, 'cancel active composer rebuild', handle.close());
  handle = undefined;
});

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
    filesystem: new NodeFilesystem(),
    compiler: new SassCompiler(sass),
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
  const toolchain = new AppToolchain(vite);
  const sourcePaths = ['dist/index.html', 'dist/app-module.js'];
  const originals = await Promise.all(sourcePaths.map(relative => readFile(path.join(root, relative), 'utf8')));
  let handle;
  t.after(async () => handle?.close());

  handle = await devApp(Object.freeze({
    session,
    filesystem: new NodeFilesystem(),
    compiler: new SassCompiler(sass),
    toolchain,
    configName: 'market/dev.js',
    runtime: 'legacy-dist',
    options: Object.freeze({ host: '127.0.0.1', port: 0, strictPort: true, open: false, build: false })
  }));
  const ready = await handle.ready;
  const html = await (await fetch(ready.url)).text();
  const appModule = await (await fetch(new URL('app-module.js', ready.url))).text();
  const bridge = await (await fetch(new URL('cells-polymer-bridge.min.js', ready.url))).text();

  assert.match(html, /data-runtime="dist"/);
  assert.doesNotMatch(html, />stale</);
  assert.match(appModule, /"environment":"de"/);
  assert.match(appModule, /"componentsPath":"\.\/bower_components\/"/);
  assert.match(bridge, /window\.__bridgeLoaded = true/);
  assert.match(bridge, /sourceMappingURL=kept\.js\.map/);
  assert.doesNotMatch(bridge, /sourceMappingURL=cells-polymer-bridge\.min\.js\.map/);
  await new Promise(resolve => setTimeout(resolve, 100));
  await write(root, 'app/styles/main.scss', '$foreground: #abcdef;\nbody { color: $foreground; }\n');
  await new Promise(resolve => setTimeout(resolve, 250));
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
    async createServer(config) {
      return vite.createServer({
        ...config,
        plugins: [...config.plugins, {
          name: 'fixture-api',
          configureServer(server) {
            server.middlewares.use((request, response, next) => {
              if (request.method !== 'POST' || request.url !== '/api/ping') {
                next();
                return;
              }
              response.statusCode = 204;
              response.end();
            });
          }
        }]
      });
    }
  }));
  const handles = [];
  t.after(async () => Promise.all(handles.map(handle => handle.close())));
  const context = (port, strictPort) => Object.freeze({
    session,
    toolchain,
    configName: 'market/dev.js',
    runtime: 'legacy-dist',
    options: Object.freeze({ host: '127.0.0.1', port, strictPort, open: false, build: false })
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
  assert.equal((await fetch(new URL('api/ping', ready.url), { method: 'POST' })).status, 204);
  const sourceEscape = await fetch(new URL(`/@fs${path.join(root, 'app/config/market/dev.js')}`, ready.url));
  assert.notEqual(sourceEscape.status, 200);
  assert.doesNotMatch(await sourceEscape.text(), /environment:\s*["']de["']/u);
  const moduleResponse = await fetch(new URL('bower_components/runtime-shell/index.mjs', ready.url));
  assert.equal(moduleResponse.status, 200);
  assert.match(moduleResponse.headers.get('content-type') ?? '', /^text\/javascript/u);

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
