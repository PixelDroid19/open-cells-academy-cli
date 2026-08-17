import assert from 'node:assert/strict';
import { createServer as createNetServer } from 'node:net';
import { mkdir, mkdtemp, readFile, readdir, rename, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { chromium } from 'playwright';
import * as vite from 'vite';

import { FileWorkspaceLock } from '../../src/adapters/node/file-workspace-lock.js';
import { NodeFilesystem } from '../../src/adapters/node/node-filesystem.js';
import { NodeProcessRunner } from '../../src/adapters/node/process-runner.js';
import { discoverAppLocaleSources } from '../../src/adapters/vite/locale-discovery.js';
import { loadCellsConfig } from '../../src/adapters/vite/config-loader.js';
import { AppToolchain } from '../../src/adapters/vite/app-toolchain.js';
import { createApp } from '../../src/application/app/create-app.js';
import { devApp } from '../../src/application/app/dev-app.js';
import { generateAppLocales } from '../../src/application/app/generate-locales.js';
import { WorkspaceSession } from '../../src/domain/workspace-session.js';
import { composeRecipe } from '../../src/recipes/compose-recipe.js';

const PROFILES = Object.freeze(['blank', 'web-app', 'web-mobile-app', 'academy-app']);

function fileMap(plan) {
  return new Map(plan.files.map(file => [file.path, file.content]));
}

function bridge4Files(profile) {
  return fileMap(composeRecipe(profile, {
    kind: 'app',
    name: `${profile}-bridge4-learning-app`,
    cellsVersion: '5'
  }));
}

async function textFiles(root) {
  const output = [];
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const candidate = path.join(root, entry.name);
    if (entry.isDirectory()) {
      output.push(...await textFiles(candidate));
      continue;
    }
    if (entry.isFile()) output.push(await readFile(candidate, 'utf8'));
  }
  return output;
}

async function materializeBridge4Project(t, name = 'bridge4-cli-lifecycle', { e2e = false } = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'open-cells-bridge4-cli-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await writeFile(path.join(root, 'package.json'), '{"name":"bridge4-cli-owner","private":true}\n');
  const filesystem = new NodeFilesystem();
  const owner = await WorkspaceSession.open(root, filesystem);
  const publication = await filesystem.applyPlanAtomically(owner, composeRecipe('web-app', {
    kind: 'app',
    name,
    cellsVersion: '5',
    e2e
  }), name);
  return { filesystem, project: publication.destination };
}

async function addBridge4ConfigProbe(project) {
  await writeFile(path.join(project, 'app', 'scripts', 'config-probe.js'), `import appConfig from 'virtual:open-cells-app-config';

export const runtimeConfig = appConfig.app_properties.app.runtimeConfig;
`);
}

async function addNestedBridge4Config(project) {
  const production = await readFile(path.join(project, 'app', 'config', 'prod.js'), 'utf8');
  const nested = path.join(project, 'app', 'config', 'tracks', 'preview.js');
  await mkdir(path.dirname(nested), { recursive: true });
  await writeFile(nested, production.replace('open-cells-production', 'open-cells-preview'));
}

async function writeBridge4Config(project, name, source) {
  const target = path.join(project, 'app', 'config', ...name.split('/'));
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, source);
}

async function addBridge4SnapshotProbe(project) {
  await writeFile(path.join(project, 'app', 'scripts', 'snapshot-probe.js'), `import appConfig from 'virtual:open-cells-app-config';

const app = appConfig.app_properties?.app;
const cells = appConfig.cells_properties;

export const snapshotState = {
  ownKeys: Object.keys(appConfig).sort(),
  rootFrozen: Object.isFrozen(appConfig),
  cellsFrozen: cells !== undefined && Object.isFrozen(cells),
  appPropertiesFrozen: appConfig.app_properties !== undefined && Object.isFrozen(appConfig.app_properties),
  appFrozen: app !== undefined && Object.isFrozen(app),
  nestedFrozen: app?.nested !== undefined && Object.isFrozen(app.nested) && Object.isFrozen(app.nested.phase),
  listFrozen: Array.isArray(app?.labels) && Object.isFrozen(app.labels),
  hasServer: Object.hasOwn(appConfig, 'server'),
  hasBuild: Object.hasOwn(appConfig, 'build'),
  hasLocales: Object.hasOwn(appConfig, 'locales'),
  hasSourcePath: Object.hasOwn(appConfig, 'sourcePath'),
  hasSourceDependencies: Object.hasOwn(appConfig, 'sourceDependencies'),
  runtimeConfig: app?.runtimeConfig,
  initialTemplate: cells?.initialTemplate
};

export function mutationState() {
  let rootBlocked = false;
  let cellsBlocked = false;
  let appBlocked = false;
  let nestedBlocked = false;
  let listBlocked = false;
  try {
    appConfig.unexpected = true;
  } catch {
    rootBlocked = true;
  }
  try {
    cells.initialTemplate = 'changed';
  } catch {
    cellsBlocked = true;
  }
  try {
    app.runtimeConfig = 'changed';
  } catch {
    appBlocked = true;
  }
  try {
    app.nested.phase.name = 'changed';
  } catch {
    nestedBlocked = true;
  }
  try {
    app.labels.push('changed');
  } catch {
    listBlocked = true;
  }
  return {
    rootBlocked,
    cellsBlocked,
    appBlocked,
    nestedBlocked,
    listBlocked,
    runtimeConfig: app?.runtimeConfig,
    initialTemplate: cells?.initialTemplate,
    phase: app?.nested?.phase?.name
  };
}
`);
}

async function addStartAppConfigCapture(project) {
  const target = path.join(project, 'app', 'scripts', 'app.js');
  const source = await readFile(target, 'utf8');
  const captured = source.replace("import { startApp } from '@open-cells/core';", "import { getConfig, startApp } from '@open-cells/core';");
  if (captured === source) throw new Error('Expected generated Open Cells bootstrap import.');
  await writeFile(target, `${captured}\nwindow.__openCellsRuntimeConfig = getConfig();\n`);
}

function virtualConfigSpecifier(source) {
  const match = /from\s+["']([^"']*open-cells-app-config[^"']*)["']/u.exec(source);
  if (match === null) throw new Error('Expected transformed virtual config import.');
  return match[1];
}

async function virtualConfigSource(ready, transformedProbe) {
  const response = await fetch(new URL(virtualConfigSpecifier(transformedProbe), ready.url));
  const source = await response.text();
  assert.equal(response.status, 200, source);
  return source;
}

async function replaceBridge4ConfigWithExternalSymlink(t, project, name, externalSentinel) {
  const target = path.join(project, 'app', 'config', ...name.split('/'));
  const source = await readFile(target, 'utf8');
  const externalRoot = await mkdtemp(path.join(os.tmpdir(), 'open-cells-bridge4-external-config-'));
  t.after(() => rm(externalRoot, { recursive: true, force: true }));
  const external = path.join(externalRoot, 'selected-config.js');
  await writeFile(external, source.replace('open-cells-development', externalSentinel));
  await rename(target, `${target}.validated`);
  await symlink(external, target);
  return Object.freeze({ external, externalRoot, target });
}

function actualViteToolchain(captured) {
  return new AppToolchain(Object.freeze({
    async createServer(config) {
      const server = await vite.createServer({
        ...config,
        configFile: false,
        optimizeDeps: { noDiscovery: true }
      });
      captured.server = server;
      return server;
    },
    build: (...args) => vite.build(...args),
    preview: (...args) => vite.preview(...args)
  }));
}

async function runCells(project, args) {
  const cliRoot = path.resolve(import.meta.dirname, '../..');
  const runner = new NodeProcessRunner({ outputLimitBytes: 200_000 });
  return runner.run({
    file: process.execPath,
    args: [path.join(cliRoot, 'bin', 'cells.js'), ...args],
    cwd: project,
    env: {},
    timeoutMs: 60_000
  });
}

async function enableHermeticBridgeBuild(project) {
  const cliRoot = path.resolve(import.meta.dirname, '../..');
  await symlink(path.join(cliRoot, 'node_modules'), path.join(project, 'node_modules'), 'dir');
}

async function enableHermeticBridgeCli(project) {
  const cliRoot = path.resolve(import.meta.dirname, '../..');
  const sourceModules = path.join(cliRoot, 'node_modules');
  const targetModules = path.join(project, 'node_modules');
  await mkdir(targetModules);
  for (const entry of await readdir(sourceModules, { withFileTypes: true })) {
    if (entry.name === '.bin') continue;
    await symlink(path.join(sourceModules, entry.name), path.join(targetModules, entry.name), entry.isDirectory() ? 'dir' : 'file');
  }
  const sourceBins = path.join(sourceModules, '.bin');
  const targetBins = path.join(targetModules, '.bin');
  await mkdir(targetBins);
  for (const entry of await readdir(sourceBins, { withFileTypes: true })) {
    if (entry.name === 'cells') continue;
    await symlink(path.join(sourceBins, entry.name), path.join(targetBins, entry.name), entry.isDirectory() ? 'dir' : 'file');
  }
  await symlink(cliRoot, path.join(targetModules, 'open-cells-academy-cli'), 'dir');
  await symlink(path.join(cliRoot, 'bin', 'cells.js'), path.join(targetBins, 'cells'), 'file');
}

function localCommandEnvironment(overrides = {}) {
  const environment = { PATH: process.env.PATH ?? '' };
  for (const name of ['HOME', 'TMPDIR', 'XDG_CACHE_HOME']) {
    if (typeof process.env[name] === 'string') environment[name] = process.env[name];
  }
  return { ...environment, ...overrides };
}

async function availablePort() {
  const server = createNetServer();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  if (address === null || typeof address === 'string') throw new Error('Expected a TCP port.');
  await new Promise((resolve, reject) => server.close(error => error === undefined ? resolve() : reject(error)));
  return address.port;
}

async function portIsAvailable(port) {
  const server = createNetServer();
  try {
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(port, '127.0.0.1', resolve);
    });
    return true;
  } catch {
    return false;
  } finally {
    if (server.listening) await new Promise((resolve, reject) => server.close(error => error === undefined ? resolve() : reject(error)));
  }
}

async function runProjectScript(project, script, args = [], env = {}) {
  const runner = new NodeProcessRunner({ outputLimitBytes: 200_000 });
  return runner.run({
    file: 'npm',
    args: ['run', script, '--', ...args],
    cwd: project,
    env: localCommandEnvironment(env),
    timeoutMs: 90_000
  });
}

function startProjectScript(t, project, script, args = [], env = {}) {
  const controller = new AbortController();
  const runner = new NodeProcessRunner({ outputLimitBytes: 200_000, interruptGraceMs: 1_000, terminateGraceMs: 1_000 });
  let output = '';
  let settleReady;
  const ready = new Promise((resolve, reject) => {
    settleReady = { resolve, reject, settled: false };
  });
  const settle = (kind, value) => {
    if (settleReady.settled) return;
    settleReady.settled = true;
    clearTimeout(timeout);
    settleReady[kind](value);
  };
  const completion = runner.run({
    file: 'npm',
    args: ['run', script, '--', ...args],
    cwd: project,
    env: localCommandEnvironment(env),
    isServer: true,
    signal: controller.signal,
    timeoutMs: 90_000,
    onOutput(event) {
      output += event.text;
      const match = /(?:Server ready|Servidor listo):\s*(http:\/\/127\.0\.0\.1:\d+\/)/.exec(output);
      if (match !== null) settle('resolve', match[1]);
    }
  });
  const timeout = setTimeout(() => settle('reject', new Error(`Timed out waiting for generated ${script}: ${output}`)), 30_000);
  void completion.catch(error => settle('reject', error));
  const close = async () => {
    if (!controller.signal.aborted) controller.abort();
    try {
      await completion;
    } catch (error) {
      if (error?.code !== 'INTERRUPTED') throw error;
    }
  };
  t.after(close);
  return Object.freeze({ ready, close });
}

async function runGeneratedNativeRuntime(project) {
  const cliRoot = path.resolve(import.meta.dirname, '../..');
  const runner = new NodeProcessRunner({ outputLimitBytes: 200_000 });
  return runner.run({
    file: path.join(cliRoot, 'node_modules', '.bin', 'vitest'),
    args: ['run', 'test/unit/runtime.test.js'],
    cwd: project,
    env: {},
    timeoutMs: 60_000
  });
}

test('contract: every CLI 5 app profile emits the complete Bridge 4 learning tree', () => {
  const requiredFiles = [
    'app/config/dev.js',
    'app/config/prod.js',
    'app/tpls/index.tpl',
    'app/scripts/app.js',
    'app/scripts/app-module.js',
    'app/scripts/app-routes.js',
    'app/scripts/lit-initial-components.js',
    'app/scripts/lit-components.js',
    'app/pages/catalog-page/catalog-page.js',
    'app/pages/lesson-page/lesson-page.js',
    'app/data-managers/lesson-data-manager.js',
    'app/styles/main.scss',
    'app/locales-app/locales.json',
    'test/unit/routes.test.js',
    'test/unit/channels.test.js',
    'test/unit/data-manager.test.js',
    'test/unit/locales.test.js',
    'test/unit/runtime.test.js',
    'test/unit/dev/locales/locales.json',
    'test/unit/prod/locales/locales.json'
  ];

  for (const profile of PROFILES) {
    const files = bridge4Files(profile);
    for (const required of requiredFiles) {
      assert.equal(files.has(required), true, `${profile} is missing ${required}`);
    }
    const metadata = JSON.parse(files.get('package.json'));
    assert.equal(metadata.dependencies['@open-cells/core'], '1.2.1');
    assert.equal(metadata.dependencies['@open-cells/page-mixin'], '1.2.4');
    assert.match(metadata.dependencies.lit, /^\^?3\./);
    assert.equal(metadata.dependencies['@cells/cells-bridge'], undefined);
    assert.equal(metadata.dependencies['@cells/cells-page-mixin'], undefined);
    assert.equal([...files.values()].some(source => /@cells\/|startBridge|CellsPageMixin/.test(source)), false);
    assert.equal([...files.values()].some(source => /\bBridge\b/.test(source)), false);
    assert.equal([...files.keys()].some(path => path.startsWith('src/runtime/')), false);
  }
});

test('contract: default application creation normalizes into the Bridge 4 payload', async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'open-cells-bridge4-create-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await writeFile(path.join(root, 'package.json'), '{"name":"bridge4-create-owner","private":true}\n');
  const filesystem = new NodeFilesystem();
  const session = await WorkspaceSession.open(root, filesystem);
  const result = await createApp({
    scaffold: { name: 'bridge4-default', scaffold: 'blank' }
  }, {
    filesystem,
    packLocalCli: async () => Object.freeze({
      fileName: 'open-cells-academy-cli-0.1.0.tgz',
      content: new Uint8Array([1, 2, 3]),
      integrity: 'sha512-fixture'
    }),
    session,
    workspaceLock: new FileWorkspaceLock({ filesystem })
  });

  assert.equal(result.ok, true);
  const project = path.join(root, 'bridge4-default');
  const declaration = JSON.parse(await readFile(path.join(project, '.open-cells-academy-recipe.json'), 'utf8'));
  const metadata = JSON.parse(await readFile(path.join(project, 'package.json'), 'utf8'));
  const bootstrap = await readFile(path.join(project, 'app', 'scripts', 'app.js'), 'utf8');
  assert.equal(declaration.cellsVersion, '5');
  assert.equal(metadata.dependencies['@open-cells/core'], '1.2.1');
  assert.equal(metadata.dependencies['@open-cells/page-mixin'], '1.2.4');
  assert.match(bootstrap, /startApp/);
  assert.doesNotMatch(bootstrap, /@cells\/|startBridge/);
});

test('red: CLI 5 scripts and E2E server use the local Cells configuration workflow while CLI 4 scripts stay unchanged', () => {
  const modern = fileMap(composeRecipe('web-app', {
    kind: 'app',
    name: 'bridge4-local-scripts',
    cellsVersion: '5',
    e2e: true
  }));
  const legacy = fileMap(composeRecipe('web-app', {
    kind: 'app',
    name: 'legacy-vite-scripts',
    cellsVersion: '4'
  }));
  const modernMetadata = JSON.parse(modern.get('package.json'));
  const legacyMetadata = JSON.parse(legacy.get('package.json'));
  const playwrightConfig = modern.get('playwright.config.js');

  assert.equal(modernMetadata.scripts.dev, 'cells app:dev -c dev.js');
  assert.equal(modernMetadata.scripts.build, 'cells app:build -c prod.js');
  assert.equal(modernMetadata.scripts.preview, 'cells app:preview -c prod.js');
  assert.match(playwrightConfig, /cells app:dev -c dev\.js/);
  assert.doesNotMatch(playwrightConfig, /npm run dev/);
  assert.equal(legacyMetadata.scripts.dev, 'vite');
  assert.equal(legacyMetadata.scripts.build, 'vite build');
  assert.equal(legacyMetadata.scripts.preview, 'vite preview');
});

test('red: generated CLI 5 scripts serve, build, and execute the E2E overlay through the local Cells binary', { timeout: 120_000 }, async t => {
  const { project } = await materializeBridge4Project(t, 'bridge4-local-cli-scripts', { e2e: true });
  await enableHermeticBridgeCli(project);
  const devPort = await availablePort();
  const dev = startProjectScript(t, project, 'dev', [
    '--host', '127.0.0.1',
    '--port', String(devPort),
    '--strictPort',
    '--no-open'
  ]);
  try {
    const ready = await dev.ready;
    const response = await fetch(new URL('app/scripts/app.js', ready));
    const source = await response.text();
    assert.equal(response.status, 200, source);
    assert.match(source, /startApp/);
  } finally {
    await dev.close();
  }
  assert.equal(await portIsAvailable(devPort), true);

  const build = await runProjectScript(project, 'build');
  assert.equal(build.exitCode, 0, build.stderr || build.stdout);
  const previewPort = await availablePort();
  const preview = startProjectScript(t, project, 'preview', [
    '--host', '127.0.0.1',
    '--port', String(previewPort),
    '--strictPort',
    '--no-open'
  ]);
  try {
    const ready = await preview.ready;
    const response = await fetch(ready);
    const source = await response.text();
    assert.equal(response.status, 200, source);
    assert.match(source, /<script type="module"/);
  } finally {
    await preview.close();
  }
  assert.equal(await portIsAvailable(previewPort), true);
  const e2ePort = await availablePort();
  const e2e = await runProjectScript(project, 'e2e', ['--workers=1'], {
    OPEN_CELLS_E2E_PORT: String(e2ePort)
  });
  assert.equal(e2e.exitCode, 0, e2e.stderr || e2e.stdout);
  assert.match(e2e.stdout, /1 passed/);
  assert.equal(await portIsAvailable(e2ePort), true);
});

test('red: generated CLI 5 runtime tests execute public Core and Page Mixin behavior without shims', async t => {
  const { project } = await materializeBridge4Project(t, 'bridge4-public-runtime');
  await enableHermeticBridgeBuild(project);

  const result = await runGeneratedNativeRuntime(project);

  assert.equal(result.exitCode, 0, result.stderr || result.stdout);
});

test('red: omitting the Cells version emits Bridge 4 while explicit Cells 4 preserves the legacy payload', () => {
  const defaultFiles = fileMap(composeRecipe('blank', {
    kind: 'app',
    name: 'default-bridge4'
  }));
  const legacyFiles = fileMap(composeRecipe('blank', {
    kind: 'app',
    name: 'explicit-legacy',
    cellsVersion: '4'
  }));

  assert.equal(defaultFiles.has('app/scripts/app.js'), true);
  assert.equal(defaultFiles.has('src/runtime/academy-core-facade.js'), false);
  assert.equal(legacyFiles.has('src/runtime/academy-core-facade.js'), true);
  assert.equal(legacyFiles.has('app/scripts/app.js'), false);
});

test('red: Bridge 4 configs use supported locale discovery and a CLI-selected application config module', async t => {
  const files = bridge4Files('web-app');
  const devSource = files.get('app/config/dev.js');
  const prodSource = files.get('app/config/prod.js');
  const bootstrap = files.get('app/scripts/app.js');

  assert.doesNotMatch(devSource, /source:\s*'app\/locales-app\/locales\.json'/);
  assert.match(devSource, /enabledI18n/);
  assert.match(devSource, /languages/);
  assert.match(devSource, /forTesting/);
  assert.doesNotMatch(prodSource, /source:\s*'app\/locales-app\/locales\.json'/);
  assert.match(bootstrap, /virtual:open-cells-app-config/);
  assert.doesNotMatch(bootstrap, /app\.config\.js|dev\.js|prod\.js/);
  assert.equal(files.has('app/config/app.config.js'), false);

  const { filesystem, project } = await materializeBridge4Project(t, 'bridge4-locales-contract');
  const session = await WorkspaceSession.open(project, filesystem);
  const config = await loadCellsConfig(session, 'dev.js');
  const sources = await discoverAppLocaleSources(project, config.locales, config.appModules);
  const plan = await generateAppLocales(Object.freeze({
    session,
    filesystem,
    request: Object.freeze({
      config: config.locales,
      configName: 'dev.js',
      ...sources,
      replaceOutput: false,
      signal: undefined
    })
  }));
  assert.equal(plan.files.some(file => file.path === 'dist/locales/en.json'), true);
  assert.equal(plan.files.some(file => file.path === 'dist/locales/es.json'), true);
});

test('red: Bridge 4 CLI locales and builds honor dev and production configuration independently', async t => {
  const { project } = await materializeBridge4Project(t, 'bridge4-cli-config');
  await addNestedBridge4Config(project);
  const locales = await runCells(project, ['app:locales', '-c', 'dev.js']);
  assert.equal(locales.exitCode, 0, locales.stderr);
  assert.equal((await readFile(path.join(project, 'dist', 'locales', 'en.json'), 'utf8')).includes('Learning catalog'), true);

  await enableHermeticBridgeBuild(project);
  const dev = await runCells(project, ['app:build', '-c', 'dev.js']);
  assert.equal(dev.exitCode, 0, dev.stderr);
  const prod = await runCells(project, ['app:build', '-c', 'prod.js']);
  assert.equal(prod.exitCode, 0, prod.stderr);
  const preview = await runCells(project, ['app:build', '-c', 'tracks/preview.js']);
  assert.equal(preview.exitCode, 0, preview.stderr);
  const devOutput = (await textFiles(path.join(project, 'build', 'dev'))).join('\n');
  const prodOutput = (await textFiles(path.join(project, 'build', 'prod'))).join('\n');
  const previewOutput = (await textFiles(path.join(project, 'build', 'tracks', 'preview'))).join('\n');
  assert.match(devOutput, /open-cells-development/);
  assert.doesNotMatch(devOutput, /open-cells-production/);
  assert.match(prodOutput, /open-cells-production/);
  assert.doesNotMatch(prodOutput, /open-cells-development/);
  assert.match(previewOutput, /open-cells-preview/);
  assert.doesNotMatch(previewOutput, /open-cells-development|open-cells-production/);
});

test('red: actual Vite dev resolves only the validated Bridge 4 config module and evaluates it at runtime', async t => {
  const { filesystem, project } = await materializeBridge4Project(t, 'bridge4-vite-config');
  await addBridge4ConfigProbe(project);
  await addNestedBridge4Config(project);
  const session = await WorkspaceSession.open(project, filesystem);
  const configurations = [
    Object.freeze({ name: 'dev.js', runtimeConfig: 'open-cells-development' }),
    Object.freeze({ name: 'prod.js', runtimeConfig: 'open-cells-production' }),
    Object.freeze({ name: 'tracks/preview.js', runtimeConfig: 'open-cells-preview' })
  ];

  for (const selected of configurations) {
    const port = await availablePort();
    const captured = {};
    const handle = await devApp(Object.freeze({
      session,
      toolchain: actualViteToolchain(captured),
      configName: selected.name,
      options: Object.freeze({ host: '127.0.0.1', port, strictPort: true, open: false })
    }));
    try {
      const ready = await handle.ready;
      const response = await fetch(new URL('app/scripts/config-probe.js', ready.url));
      const source = await response.text();
      assert.equal(response.status, 200, source);
      assert.doesNotMatch(source, /app\/config\/|__OPEN_CELLS_APP_CONFIG__|app\.config\.js/);
      assert.equal((await captured.server.ssrLoadModule('/app/scripts/config-probe.js')).runtimeConfig, selected.runtimeConfig);
    } finally {
      await handle.close();
    }
  }
});

test('red: real Vite exposes only a deeply frozen effective browser config projection', async t => {
  const { filesystem, project } = await materializeBridge4Project(t, 'bridge4-effective-config-projection');
  const absoluteRawPath = path.join(project, 'raw-config-path-sentinel');
  await writeBridge4Config(project, 'dev.js', `export default ${JSON.stringify({
    initialTemplate: 'catalog',
    app: {
      name: 'effective-root-app',
      runtimeConfig: 'effective-root-runtime',
      labels: ['first', 'second'],
      nested: { phase: { name: 'ready' } }
    },
    server: { credential: 'fixture-server-secret' },
    build: { marker: 'fixture-build-secret' },
    locales: { marker: 'fixture-locales-secret' },
    sourcePath: absoluteRawPath,
    sourceDependencies: ['fixture-source-dependency-secret']
  }, null, 2)};\n`);
  await addBridge4ConfigProbe(project);
  await addBridge4SnapshotProbe(project);
  const session = await WorkspaceSession.open(project, filesystem);
  const captured = {};
  const port = await availablePort();
  const handle = await devApp(Object.freeze({
    session,
    toolchain: actualViteToolchain(captured),
    configName: 'dev.js',
    options: Object.freeze({ host: '127.0.0.1', port, strictPort: true, open: false })
  }));
  try {
    const ready = await handle.ready;
    const response = await fetch(new URL('app/scripts/config-probe.js', ready.url));
    const transformedProbe = await response.text();
    assert.equal(response.status, 200, transformedProbe);
    const virtualSource = await virtualConfigSource(ready, transformedProbe);
    assert.match(virtualSource, /JSON\.parse/);
    assert.doesNotMatch(virtualSource, /fixture-(?:server|build|locales|source-dependency)-secret|sourcePath/);
    assert.equal(virtualSource.includes(absoluteRawPath), false);
    assert.equal(transformedProbe.includes(project), false);

    const probe = await captured.server.ssrLoadModule('/app/scripts/snapshot-probe.js');
    assert.deepEqual(probe.snapshotState, {
      ownKeys: ['app_properties', 'cells_properties'],
      rootFrozen: true,
      cellsFrozen: true,
      appPropertiesFrozen: true,
      appFrozen: true,
      nestedFrozen: true,
      listFrozen: true,
      hasServer: false,
      hasBuild: false,
      hasLocales: false,
      hasSourcePath: false,
      hasSourceDependencies: false,
      runtimeConfig: 'effective-root-runtime',
      initialTemplate: 'catalog'
    });
    assert.deepEqual(probe.mutationState(), {
      rootBlocked: true,
      cellsBlocked: true,
      appBlocked: true,
      nestedBlocked: true,
      listBlocked: true,
      runtimeConfig: 'effective-root-runtime',
      initialTemplate: 'catalog',
      phase: 'ready'
    });
  } finally {
    await handle.close();
  }
});

test('red: real Open Cells startApp receives normalized academy-only and root-only app configuration', { timeout: 60_000 }, async t => {
  const cases = [
    Object.freeze({
      name: 'academy-only',
      source: Object.freeze({
        academy: Object.freeze({
          initialTemplate: 'catalog',
          app: Object.freeze({ name: 'academy-only-app', runtimeConfig: 'academy-only-runtime', nested: Object.freeze({ kind: 'academy' }) })
        }),
        server: Object.freeze({ credential: 'academy-server-secret' })
      }),
      expected: Object.freeze({ name: 'academy-only-app', runtimeConfig: 'academy-only-runtime', nested: Object.freeze({ kind: 'academy' }) })
    }),
    Object.freeze({
      name: 'root-only',
      source: Object.freeze({
        initialTemplate: 'catalog',
        app: Object.freeze({ name: 'root-only-app', runtimeConfig: 'root-only-runtime', nested: Object.freeze({ kind: 'root' }) }),
        server: Object.freeze({ credential: 'root-server-secret' })
      }),
      expected: Object.freeze({ name: 'root-only-app', runtimeConfig: 'root-only-runtime', nested: Object.freeze({ kind: 'root' }) })
    })
  ];
  let browser;
  try {
    browser = await chromium.launch({ channel: 'chrome', headless: true });
    for (const scenario of cases) {
      const { filesystem, project } = await materializeBridge4Project(t, `bridge4-${scenario.name}-runtime-config`);
      await writeBridge4Config(project, 'dev.js', `export default ${JSON.stringify(scenario.source, null, 2)};\n`);
      await addStartAppConfigCapture(project);
      await enableHermeticBridgeBuild(project);
      const session = await WorkspaceSession.open(project, filesystem);
      const captured = {};
      const port = await availablePort();
      const handle = await devApp(Object.freeze({
        session,
        toolchain: actualViteToolchain(captured),
        configName: 'dev.js',
        options: Object.freeze({ host: '127.0.0.1', port, strictPort: true, open: false })
      }));
      try {
        const page = await browser.newPage();
        const ready = await handle.ready;
        await page.goto(ready.url, { waitUntil: 'domcontentloaded' });
        await page.waitForFunction(() => window.__openCellsRuntimeConfig !== undefined, undefined, { timeout: 15_000 });
        const received = await page.evaluate(() => {
          const config = window.__openCellsRuntimeConfig;
          return {
            initialTemplate: config.initialTemplate,
            app: config.appConfig?.app,
            hasServer: Object.hasOwn(config, 'server'),
            hasBuild: Object.hasOwn(config, 'build'),
            hasLocales: Object.hasOwn(config, 'locales')
          };
        });
        assert.deepEqual(received, {
          initialTemplate: 'catalog',
          app: scenario.expected,
          hasServer: false,
          hasBuild: false,
          hasLocales: false
        });
        await page.getByRole('heading', { name: 'Learning catalog' }).waitFor({ timeout: 15_000 });
        await page.close();
      } finally {
        await handle.close();
        assert.equal(captured.server.httpServer.listening, false);
      }
    }
  } finally {
    await browser?.close();
  }
});

test('red: real Vite rejects descriptor-unsafe normalized app values without evaluating accessors or toJSON', async t => {
  const cases = [
    Object.freeze({
      name: 'own __proto__',
      create() {
        const app = { runtimeConfig: 'unsafe-own-proto' };
        Object.defineProperty(app, '__proto__', { value: 'unsafe', enumerable: true });
        return Object.freeze({ app });
      }
    }),
    Object.freeze({
      name: 'nested __proto__',
      create() {
        const nested = {};
        Object.defineProperty(nested, '__proto__', { value: 'unsafe', enumerable: true });
        return Object.freeze({ app: { runtimeConfig: 'unsafe-nested-proto', nested } });
      }
    }),
    Object.freeze({
      name: 'own prototype',
      create() {
        return Object.freeze({ app: { runtimeConfig: 'unsafe-prototype', prototype: 'unsafe' } });
      }
    }),
    Object.freeze({
      name: 'own constructor',
      create() {
        return Object.freeze({ app: { runtimeConfig: 'unsafe-constructor', constructor: 'unsafe' } });
      }
    }),
    Object.freeze({
      name: 'accessor',
      create() {
        let reads = 0;
        const app = { runtimeConfig: 'unsafe-accessor' };
        Object.defineProperty(app, 'title', { enumerable: true, get() { reads += 1; return 'unsafe'; } });
        return Object.freeze({ app, verify() { assert.equal(reads, 0); } });
      }
    }),
    Object.freeze({
      name: 'nested accessor',
      create() {
        let reads = 0;
        const nested = {};
        Object.defineProperty(nested, 'title', { enumerable: true, get() { reads += 1; return 'unsafe'; } });
        return Object.freeze({ app: { runtimeConfig: 'unsafe-nested-accessor', nested }, verify() { assert.equal(reads, 0); } });
      }
    }),
    Object.freeze({
      name: 'toJSON',
      create() {
        let calls = 0;
        const app = { runtimeConfig: 'unsafe-to-json', toJSON() { calls += 1; return { runtimeConfig: 'unsafe' }; } };
        return Object.freeze({ app, verify() { assert.equal(calls, 0); } });
      }
    }),
    Object.freeze({
      name: 'function',
      create() {
        return Object.freeze({ app: { runtimeConfig: 'unsafe-function', callback() {} } });
      }
    }),
    Object.freeze({
      name: 'symbol key',
      create() {
        const app = { runtimeConfig: 'unsafe-symbol-key' };
        app[Symbol('unsafe')] = 'unsafe';
        return Object.freeze({ app });
      }
    }),
    Object.freeze({
      name: 'symbol value',
      create() {
        return Object.freeze({ app: { runtimeConfig: 'unsafe-symbol-value', marker: Symbol('unsafe') } });
      }
    }),
    Object.freeze({
      name: 'undefined',
      create() {
        return Object.freeze({ app: { runtimeConfig: 'unsafe-undefined', marker: undefined } });
      }
    }),
    Object.freeze({
      name: 'cycle',
      create() {
        const app = { runtimeConfig: 'unsafe-cycle' };
        app.self = app;
        return Object.freeze({ app });
      }
    }),
    Object.freeze({
      name: 'bigint',
      create() {
        return Object.freeze({ app: { runtimeConfig: 'unsafe-bigint', marker: 1n } });
      }
    }),
    Object.freeze({
      name: 'NaN',
      create() {
        return Object.freeze({ app: { runtimeConfig: 'unsafe-nan', marker: Number.NaN } });
      }
    }),
    Object.freeze({
      name: 'Infinity',
      create() {
        return Object.freeze({ app: { runtimeConfig: 'unsafe-infinity', marker: Number.POSITIVE_INFINITY } });
      }
    }),
    Object.freeze({
      name: 'sparse array',
      create() {
        const labels = [];
        labels[1] = 'unsafe';
        return Object.freeze({ app: { runtimeConfig: 'unsafe-array', labels } });
      }
    })
  ];

  for (const scenario of cases) {
    const { filesystem, project } = await materializeBridge4Project(t, `bridge4-unsafe-${scenario.name.replaceAll(' ', '-')}`);
    const session = await WorkspaceSession.open(project, filesystem);
    const captured = {};
    const port = await availablePort();
    const values = scenario.create();
    let handle;
    let failure;
    try {
      handle = await actualViteToolchain(captured).startDev(Object.freeze({
        session,
        config: Object.freeze({
          app: values.app,
          runtime: Object.freeze({ initialTemplate: 'catalog' }),
          legacy: Object.freeze({})
        }),
        configName: 'dev.js',
        host: '127.0.0.1',
        port,
        strictPort: true,
        open: false
      }));
    } catch (cause) {
      failure = cause;
    } finally {
      await handle?.close();
    }
    assert.equal(failure?.code, 'VITE_DEV_FAILED', scenario.name);
    assert.equal(captured.server, undefined, scenario.name);
    values.verify?.();
  }
});

test('red: Bridge 4 dev keeps the validated config snapshot when its selected source becomes an external symlink', async t => {
  const { filesystem, project } = await materializeBridge4Project(t, 'bridge4-vite-config-snapshot-dev');
  await addBridge4ConfigProbe(project);
  const session = await WorkspaceSession.open(project, filesystem);
  const config = await loadCellsConfig(session, 'dev.js');
  const replacement = await replaceBridge4ConfigWithExternalSymlink(t, project, 'dev.js', 'open-cells-external-dev');
  const captured = {};
  const toolchain = actualViteToolchain(captured);
  const port = await availablePort();
  let handle;
  let failure;
  try {
    handle = await toolchain.startDev(Object.freeze({
      session,
      config,
      configName: 'dev.js',
      host: '127.0.0.1',
      port,
      strictPort: true,
      open: false,
      fsAllow: Object.freeze([project, replacement.externalRoot, path.join(project, 'node_modules')])
    }));
    const ready = await handle.ready;
    const source = await (await fetch(new URL('app/scripts/config-probe.js', ready.url))).text();
    assert.doesNotMatch(source, /open-cells-external-dev|app\/config\//);
    assert.equal((await captured.server.ssrLoadModule('/app/scripts/config-probe.js')).runtimeConfig, 'open-cells-development');
  } catch (cause) {
    failure = cause;
  } finally {
    await handle?.close();
  }
  assert.equal(failure, undefined, String(failure));
});

test('red: Bridge 4 build keeps the validated config snapshot after a source symlink swap without corrupting publication', async t => {
  const { filesystem, project } = await materializeBridge4Project(t, 'bridge4-vite-config-snapshot-build');
  await enableHermeticBridgeBuild(project);
  const session = await WorkspaceSession.open(project, filesystem);
  const config = await loadCellsConfig(session, 'dev.js');
  const priorOutput = path.join(project, 'build', 'dev', 'previous-publication.txt');
  await mkdir(path.dirname(priorOutput), { recursive: true });
  await writeFile(priorOutput, 'previous publication\n');
  await replaceBridge4ConfigWithExternalSymlink(t, project, 'dev.js', 'open-cells-external-build');
  const toolchain = actualViteToolchain({});
  let failure;
  try {
    await toolchain.buildApp(Object.freeze({
      session,
      filesystem,
      configName: 'dev.js',
      config,
      options: Object.freeze({})
    }));
  } catch (cause) {
    failure = cause;
  }

  const output = (await textFiles(path.join(project, 'build', 'dev'))).join('\n');
  assert.doesNotMatch(output, /open-cells-external-build/);
  if (failure === undefined) {
    assert.match(output, /open-cells-development/);
  } else {
    assert.equal(await readFile(priorOutput, 'utf8'), 'previous publication\n');
  }
});

test('red: Bridge 4 virtual config rejects non-serializable effective app values before Vite starts', async t => {
  const { filesystem, project } = await materializeBridge4Project(t, 'bridge4-vite-config-serialization');
  const configPath = path.join(project, 'app', 'config', 'dev.js');
  const source = await readFile(configPath, 'utf8');
  await writeFile(configPath, source.replace('"runtimeConfig": "open-cells-development"', '"unsupportedSnapshotValue": 1n,\n        "runtimeConfig": "open-cells-development"'));
  const session = await WorkspaceSession.open(project, filesystem);
  const captured = {};
  const port = await availablePort();
  let handle;
  let failure;
  try {
    handle = await devApp(Object.freeze({
      session,
      toolchain: actualViteToolchain(captured),
      configName: 'dev.js',
      options: Object.freeze({ host: '127.0.0.1', port, strictPort: true, open: false })
    }));
  } catch (cause) {
    failure = cause;
  } finally {
    await handle?.close();
  }
  assert.equal(failure?.code, 'CONFIG_INVALID');
  assert.equal(captured.server, undefined);
});

test('red: real Chrome starts the public Open Cells runtime and exercises lifecycle behavior without method replacement', async t => {
  const { filesystem, project } = await materializeBridge4Project(t, 'bridge4-public-browser-runtime');
  await enableHermeticBridgeBuild(project);
  const session = await WorkspaceSession.open(project, filesystem);
  const captured = {};
  const port = await availablePort();
  const handle = await devApp(Object.freeze({
    session,
    toolchain: actualViteToolchain(captured),
    configName: 'dev.js',
    options: Object.freeze({ host: '127.0.0.1', port, strictPort: true, open: false })
  }));
  let browser;
  try {
    const ready = await handle.ready;
    browser = await chromium.launch({ channel: 'chrome', headless: true });
    const page = await browser.newPage();
    const runtimeErrors = [];
    page.on('pageerror', error => runtimeErrors.push(error.message));

    await page.goto(ready.url, { waitUntil: 'domcontentloaded' });
    await page.getByRole('heading', { name: 'Learning catalog' }).waitFor({ timeout: 15_000 });
    const catalogRuntime = await page.locator('catalog-page').evaluate(element => ({
      templateState: element.shadowRoot.querySelector('[data-cells-type="template"]').getAttribute('state'),
      pageChannel: element.constructor.getPagePrivateChannel(element.localName),
      nativeMethods: ['publish', 'navigate', 'subscribe', 'unsubscribe'].every(name => typeof element[name] === 'function')
    }));
    assert.deepEqual(catalogRuntime, {
      templateState: 'active',
      pageChannel: '__oc_page_catalog',
      nativeMethods: true
    });

    await page.locator('catalog-page').evaluate(element => {
      element.publish('academy-progress', Object.freeze({ lessonId: 'retained-progress', status: 'opened' }));
      element.navigate('lesson', { lessonId: 'route-param' });
    });
    await page.waitForURL(url => url.hash === '#!/lesson/route-param', { timeout: 15_000 });
    await page.getByRole('heading', { name: 'Lesson: route-param' }).waitFor({ timeout: 15_000 });
    await page.getByText('Latest progress: retained-progress.').waitFor({ timeout: 15_000 });
    const lessonRuntime = await page.locator('lesson-page').evaluate(element => ({
      templateState: element.shadowRoot.querySelector('[data-cells-type="template"]').getAttribute('state'),
      pageChannel: element.constructor.getPagePrivateChannel(element.localName),
      params: element.params
    }));
    assert.deepEqual(lessonRuntime, {
      templateState: 'active',
      pageChannel: '__oc_page_lesson',
      params: { lessonId: 'route-param' }
    });

    const cancellation = await page.locator('lesson-page').evaluate(async element => {
      const manager = element.shadowRoot.querySelector('lesson-data-manager');
      const event = new Promise(resolve => manager.addEventListener('lesson-data-cancelled', value => resolve(value.detail.status), { once: true }));
      const pending = manager.load({ lessonId: 'route-param', mode: 'delayed' });
      element.navigate('catalog');
      return { result: await pending, event: await event };
    });
    assert.deepEqual(cancellation, {
      result: { status: 'cancelled', lessonId: 'route-param' },
      event: 'cancelled'
    });
    await page.waitForURL(url => url.hash === '#!/', { timeout: 15_000 });
    await page.getByRole('heading', { name: 'Learning catalog' }).waitFor({ timeout: 15_000 });

    const outputAfterLeave = await page.locator('lesson-page').evaluate(element => element.shadowRoot.querySelector('output').textContent);
    await page.locator('catalog-page').evaluate(element => element.publish('academy-progress', Object.freeze({ lessonId: 'after-leave', status: 'opened' })));
    await page.waitForTimeout(50);
    const outputAfterPublish = await page.locator('lesson-page').evaluate(element => element.shadowRoot.querySelector('output').textContent);
    assert.equal(outputAfterPublish, outputAfterLeave);

    await page.getByRole('button', { name: 'Spanish' }).click();
    await page.getByRole('heading', { name: 'Catálogo de aprendizaje' }).waitFor({ timeout: 15_000 });
    assert.equal(await page.locator('html').getAttribute('lang'), 'es');
    assert.equal(await page.title(), 'Catálogo de aprendizaje Open Cells');
    assert.deepEqual(runtimeErrors, []);
  } finally {
    await browser?.close();
    await handle.close();
    assert.equal(captured.server.httpServer.listening, false);
  }
});

test('red: Bridge 4 pages render a Cells template contract instead of a plain Lit wrapper', () => {
  const files = bridge4Files('academy-app');
  const catalogTemplate = files.get('app/tpls/catalog-page-template.js');
  const lessonTemplate = files.get('app/tpls/lesson-page-template.js');
  const catalogPage = files.get('app/pages/catalog-page/catalog-page.js');
  const lessonPage = files.get('app/pages/lesson-page/lesson-page.js');

  for (const template of [catalogTemplate, lessonTemplate]) {
    assert.match(template, /data-cells-type/);
    assert.match(template, /state/);
    assert.match(template, /'inactive'/);
    assert.match(template, /slot name="app-main-content"/);
  }
  assert.match(catalogPage, /<catalog-page-template[\s\S]*data-cells-type="template"/);
  assert.doesNotMatch(catalogPage, /state="active"/);
  assert.match(catalogPage, /slot="app-main-content"/);
  assert.match(lessonPage, /<lesson-page-template[\s\S]*data-cells-type="template"/);
  assert.doesNotMatch(lessonPage, /state="active"/);
  assert.match(lessonPage, /slot="app-main-content"/);
});

test('red: Bridge 4 generated tests use the public page contract and drive the English-Spanish UI flow', () => {
  const files = bridge4Files('web-mobile-app');
  const bootstrap = files.get('app/scripts/app.js');
  const documentShell = files.get('index.html');
  const channels = files.get('test/unit/channels.test.js');
  const locales = files.get('test/unit/locales.test.js');

  assert.match(bootstrap, /setLanguage\('en'\)/);
  assert.doesNotMatch(documentShell, /<title>[^<]+<\/title>/);
  const runtime = files.get('test/unit/runtime.test.js');

  assert.match(channels, /createProgress/);
  assert.match(channels, /immutable public progress value/);
  assert.doesNotMatch(channels, /\?raw|CellsPageMixin|startBridge|@cells\//);
  assert.match(runtime, /startApp/);
  assert.match(runtime, /getPagePrivateChannel/);
  assert.match(runtime, /pluginCellsCoreAPI/);
  assert.match(runtime, /retained-progress/);
  assert.match(runtime, /lesson-data-cancelled/);
  assert.doesNotMatch(runtime, /page\.(publish|navigate|subscribe|unsubscribe)\s*=/);
  assert.match(locales, /button\[data-language="es"\]/);
  assert.match(locales, /\.click\(\)/);
  assert.match(locales, /document\.documentElement\.lang/);
  assert.match(locales, /document\.title/);
});

test('contract: CLI 5 E2E material is an optional Bridge 4 overlay', () => {
  const plain = fileMap(composeRecipe('web-app', {
    kind: 'app',
    name: 'bridge4-plain',
    cellsVersion: '5',
    e2e: false
  }));
  const overlay = fileMap(composeRecipe('web-app', {
    kind: 'app',
    name: 'bridge4-e2e',
    cellsVersion: '5',
    e2e: true
  }));
  const plainMetadata = JSON.parse(plain.get('package.json'));
  const overlayMetadata = JSON.parse(overlay.get('package.json'));

  assert.equal(plain.has('playwright.config.js'), false);
  assert.equal(plain.has('e2e/bridge4-app.spec.js'), false);
  assert.equal(plainMetadata.devDependencies.playwright, undefined);
  assert.equal(overlay.has('playwright.config.js'), true);
  assert.equal(overlay.has('e2e/bridge4-app.spec.js'), true);
  assert.equal(overlayMetadata.devDependencies.playwright, '1.62.1');
  assert.match(overlay.get('e2e/bridge4-app.spec.js'), /toHaveURL/);
  assert.match(overlay.get('e2e/bridge4-app.spec.js'), /introduction/);
});

test('contract: CLI 5 app routes and pages declare public Open Cells navigation lifecycle boundaries', () => {
  const files = bridge4Files('web-app');
  const bootstrap = files.get('app/scripts/app.js');
  const channels = files.get('app/scripts/channels.js');
  const routes = files.get('app/scripts/app-routes.js');
  const catalog = files.get('app/pages/catalog-page/catalog-page.js');
  const lesson = files.get('app/pages/lesson-page/lesson-page.js');

  assert.match(bootstrap, /startApp\(\{[\s\S]*routes[\s\S]*mainNode[\s\S]*cells_properties[\s\S]*appConfig/);
  assert.match(routes, /Object\.freeze/);
  assert.match(routes, /path: '\/'/);
  assert.match(routes, /path: '\/lesson\/:lessonId'/);
  assert.match(routes, /name: 'lesson'/);
  assert.match(routes, /async action\(\)/);
  assert.match(routes, /import\('\.\.\/pages\/catalog-page\/catalog-page\.js'\)/);
  assert.match(routes, /import\('\.\.\/pages\/lesson-page\/lesson-page\.js'\)/);
  assert.match(catalog, /PageMixin\(LitElement\)/);
  assert.match(catalog, /navigate\('lesson', \{ lessonId \}\)/);
  assert.match(channels, /academy-progress/);
  assert.match(catalog, /this\.publish\(ACADEMY_PROGRESS_CHANNEL/);
  assert.match(catalog, /<catalog-page-template/);
  assert.match(lesson, /PageMixin\(LitElement\)/);
  assert.match(lesson, /onPageEnter\(\)/);
  assert.match(lesson, /onPageLeave\(\)/);
  assert.match(lesson, /unsubscribe/);
  assert.match(lesson, /<lesson-page-template/);
});

test('contract: CLI 5 generated tests cover retained progress, fixture states, and locale parity', () => {
  const files = bridge4Files('academy-app');
  const channels = files.get('test/unit/channels.test.js');
  const dataManager = files.get('test/unit/data-manager.test.js');
  const locales = files.get('test/unit/locales.test.js');
  const runtime = files.get('test/unit/runtime.test.js');
  const catalogs = JSON.parse(files.get('app/locales-app/locales.json'));

  assert.match(channels, /immutable/);
  assert.match(runtime, /retained-progress/);
  assert.match(runtime, /after-leave/);
  assert.match(runtime, /cancelled/);
  assert.match(dataManager, /loading/);
  assert.match(dataManager, /success/);
  assert.match(dataManager, /error/);
  assert.match(dataManager, /cancelled/);
  assert.match(locales, /English/);
  assert.match(locales, /Spanish/);
  assert.deepEqual(Object.keys(catalogs.en), Object.keys(catalogs.es));
  assert.ok(Object.values(catalogs.en).every(value => typeof value === 'string' && value.length > 0));
  assert.ok(Object.values(catalogs.es).every(value => typeof value === 'string' && value.length > 0));
});

test('contract: CLI 5 generated source and locale validators run against the Bridge 4 tree', async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'open-cells-bridge4-validator-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await writeFile(path.join(root, 'package.json'), '{"name":"bridge4-validator-owner","private":true}\n');
  const filesystem = new NodeFilesystem();
  const owner = await WorkspaceSession.open(root, filesystem);
  const plan = composeRecipe('web-app', {
    kind: 'app',
    name: 'bridge4-validator',
    cellsVersion: '5'
  });
  const publication = await filesystem.applyPlanAtomically(owner, plan, 'bridge4-validator');
  const runner = new NodeProcessRunner({ outputLimitBytes: 100_000 });

  for (const script of ['scripts/validate-source.js', 'scripts/validate-locales.js']) {
    const result = await runner.run({
      file: process.execPath,
      args: [script],
      cwd: publication.destination,
      env: {},
      timeoutMs: 30_000
    });
    assert.equal(result.exitCode, 0, result.stderr);
  }

  for (const file of plan.files.filter(candidate => candidate.path.endsWith('.js'))) {
    const result = await runner.run({
      file: process.execPath,
      args: ['--check', file.path],
      cwd: publication.destination,
      env: {},
      timeoutMs: 30_000
    });
    assert.equal(result.exitCode, 0, `${file.path}: ${result.stderr}`);
  }
});

test('contract: CLI 5 generated unit tests execute with the installed public runtime', async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'open-cells-bridge4-unit-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await writeFile(path.join(root, 'package.json'), '{"name":"bridge4-unit-owner","private":true}\n');
  const filesystem = new NodeFilesystem();
  const owner = await WorkspaceSession.open(root, filesystem);
  const plan = composeRecipe('academy-app', {
    kind: 'app',
    name: 'bridge4-unit',
    cellsVersion: '5'
  });
  const publication = await filesystem.applyPlanAtomically(owner, plan, 'bridge4-unit');
  const cliRoot = path.resolve(import.meta.dirname, '../..');
  await symlink(path.join(cliRoot, 'node_modules'), path.join(publication.destination, 'node_modules'), 'dir');
  const runner = new NodeProcessRunner({ outputLimitBytes: 200_000 });
  const result = await runner.run({
    file: path.join(cliRoot, 'node_modules', '.bin', 'vitest'),
    args: ['run'],
    cwd: publication.destination,
    env: {},
    timeoutMs: 60_000
  });

  assert.equal(result.exitCode, 0, result.stderr);
});
