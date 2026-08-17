import assert from 'node:assert/strict';
import { lstat, mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { pathToFileURL } from 'node:url';

import { composeRecipe } from '../../src/recipes/compose-recipe.js';
import { NodeFilesystem } from '../../src/adapters/node/node-filesystem.js';
import { loadCellsConfig } from '../../src/adapters/vite/config-loader.js';
import { WorkspaceSession } from '../../src/domain/workspace-session.js';
import { runApplicationProfileLifecycle } from '../fixtures/app-scaffold-lifecycle.js';

const PROFILES = Object.freeze({
  blank: Object.freeze({ routes: ['home', 'details'], marker: 'academy-blank-app' }),
  'web-app': Object.freeze({ routes: ['home', 'catalog', 'details'], marker: 'academy-web-app' }),
  'web-mobile-app': Object.freeze({ routes: ['login', 'dashboard', 'movements', 'settings', 'help'], marker: 'academy-mobile-app' }),
  'academy-app': Object.freeze({ routes: ['welcome', 'routing', 'pubsub', 'data', 'local-api', 'i18n', 'scoped'], marker: 'academy-learning-app' })
});
const LEGACY_CELLS_VERSION = '4';

function fileMap(plan) {
  return new Map(plan.files.map(file => [file.path, file.content]));
}

async function importViteConfigFromLiteralSpacePath(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'academy vite config space-'));
  t.after(async () => {
    await rm(root, { recursive: true, force: true });
  });
  const project = path.join(root, 'generated app');
  const files = fileMap(composeRecipe('blank', { kind: 'app', name: 'space-app', cellsVersion: LEGACY_CELLS_VERSION }));
  await mkdir(path.join(project, 'test'), { recursive: true });
  await Promise.all([
    writeFile(path.join(project, 'vite.config.js'), files.get('vite.config.js')),
    writeFile(path.join(project, 'test', 'open-cells-core.js'), files.get('test/open-cells-core.js')),
    writeFile(path.join(project, 'test', 'scoped-registry-polyfill.js'), files.get('test/scoped-registry-polyfill.js')),
    symlink(path.resolve(import.meta.dirname, '..', '..', 'node_modules'), path.join(project, 'node_modules'), 'dir')
  ]);
  return import(pathToFileURL(path.join(project, 'vite.config.js')).href);
}

test('red: every application profile composes a complete runnable and distinct Academy payload', () => {
  const fingerprints = new Set();

  for (const [profile, expected] of Object.entries(PROFILES)) {
    const plan = composeRecipe(profile, { kind: 'app', name: `${profile}-fixture`, cellsVersion: LEGACY_CELLS_VERSION });
    const files = fileMap(plan);
    for (const required of [
      'index.html',
      'src/app.js',
      'src/routes.js',
      'src/styles.js',
      'test/app.test.js',
      'app/config/dev.js',
      'app/config/prod.js',
      'vite.config.js'
    ]) {
      assert.equal(files.has(required), true, `${profile} is missing ${required}`);
    }
    const routes = JSON.parse(files.get('src/routes.json'));
    assert.deepEqual(routes.map(route => route.name), expected.routes);
    assert.match(files.get('src/app.js'), new RegExp(expected.marker));
    const metadata = JSON.parse(files.get('package.json'));
    assert.equal(typeof metadata.scripts.dev, 'string');
    assert.equal(typeof metadata.scripts.build, 'string');
    assert.equal(typeof metadata.scripts.test, 'string');
    assert.equal(typeof metadata.scripts.preview, 'string');
    assert.equal(typeof metadata.scripts.lint, 'string');
    assert.equal(typeof metadata.scripts.locales, 'string');
    assert.equal(typeof metadata.scripts['test:a11y'], 'string');
    assert.equal(typeof metadata.scripts['academy:version'], 'string');
    for (const configName of ['dev.js', 'prod.js']) {
      const config = files.get(`app/config/${configName}`);
      assert.match(config, /export default/);
      assert.match(config, /"app":/);
      assert.match(config, /"server":/);
      assert.match(config, /"build":/);
      assert.match(config, /"locales":/);
    }
    const readme = files.get('README.md');
    assert.match(readme, /cells app:dev -c dev\.js/);
    assert.match(readme, /cells app:build -c prod\.js/);
    assert.match(readme, /cells app:preview -c prod\.js/);
    assert.equal(files.has('scripts/validate-source.js'), true);
    assert.equal(files.has('scripts/validate-locales.js'), true);
    assert.equal(files.has('test/app-ui.test.js'), true);
    assert.equal(files.has('test/app-accessibility.test.js'), true);
    assert.equal(files.has('test/open-cells-core.js'), true);
    assert.match(files.get('vite.config.js'), /environment: 'happy-dom'/);
    assert.match(files.get('vite.config.js'), /test\/open-cells-core\.js/);
    assert.match(files.get('test/app-harness.js'), /shadowRoot/);
    assert.match(files.get('test/app-ui.test.js'), /routes\.slice\(1\)\.entries\(\)/);
    assert.match(files.get('test/app-accessibility.test.js'), /axe\.run/);
    assert.match(files.get('test/app-accessibility.test.js'), /for \(const route of routes\)/);
    assert.equal(metadata.devDependencies['happy-dom'], '20.11.2');
    assert.equal(metadata.devDependencies['axe-core'], '4.13.0');
    assert.equal(metadata.devDependencies['@axe-core/playwright'], undefined);
    assert.equal(metadata.scripts['test:a11y'], 'vitest run test/app-accessibility.test.js');
    fingerprints.add(files.get('src/app.js'));
  }
  assert.equal(fingerprints.size, 4);
});

test('red: generated application dev and production configs load through the trusted Cells config boundary', async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'academy-app-config-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await writeFile(path.join(root, 'package.json'), '{"name":"config-owner","private":true,"type":"module"}\n');
  const filesystem = new NodeFilesystem();
  const owner = await WorkspaceSession.open(root, filesystem);

  for (const profile of Object.keys(PROFILES)) {
    const publication = await filesystem.applyPlanAtomically(owner, composeRecipe(profile, { kind: 'app', name: `${profile}-config`, cellsVersion: LEGACY_CELLS_VERSION }), profile);
    const session = await WorkspaceSession.open(publication.destination, filesystem);
    const [dev, prod] = await Promise.all([loadCellsConfig(session, 'dev.js'), loadCellsConfig(session, 'prod.js')]);

    for (const config of [dev, prod]) {
      assert.equal(typeof config.app.lang, 'string');
      assert.equal(typeof config.app.title, 'string');
      assert.equal(typeof config.app.description, 'string');
      assert.equal(typeof config.app.header, 'string');
      assert.equal(config.app.name, `${profile}-config`);
      assert.deepEqual(config.server, { host: '127.0.0.1', port: 8001, strictPort: false, open: false });
      assert.deepEqual(config.locales, { enabledI18n: false });
    }
    assert.deepEqual(dev.build, { target: 'es2022', sourcemap: true });
    assert.deepEqual(prod.build, { target: 'es2022', sourcemap: false });
  }
});

test('red: every application profile keeps real scoped-registry production imports behind a Happy DOM-only test shim', () => {
  for (const profile of Object.keys(PROFILES)) {
    const files = fileMap(composeRecipe(profile, { kind: 'app', name: profile + '-scoped-fixture', cellsVersion: LEGACY_CELLS_VERSION }));
    const app = files.get('src/app.js');
    const config = files.get('vite.config.js');

    assert.match(app, /^import '@webcomponents\/scoped-custom-element-registry';/);
    assert.equal(files.has('test/scoped-registry-polyfill.js'), true);
    assert.equal(files.has('test/setup.js'), true);
    assert.match(files.get('test/scoped-registry-polyfill.js'), /Happy DOM/);
    assert.match(files.get('test/setup.js'), /globalThis\.CustomElementRegistry/);
    assert.match(files.get('test/setup.js'), /academy-test-scoped-/);
    assert.match(files.get('test/setup.js'), /root\.createElement = function\(tagName\)/);
    assert.match(config, /import \{ fileURLToPath \} from 'node:url';/);
    assert.match(config, /setupFiles: \['test\/setup\.js'\]/);
    assert.match(config, /'@open-cells\/core': fileURLToPath\(new URL\('\.\/test\/open-cells-core\.js', import\.meta\.url\)\)/);
    assert.match(config, /'@webcomponents\/scoped-custom-element-registry': fileURLToPath\(new URL\('\.\/test\/scoped-registry-polyfill\.js', import\.meta\.url\)\)/);
    assert.doesNotMatch(config, /open-cells-core\.js', import\.meta\.url\)\.pathname/);
    assert.doesNotMatch(config, /scoped-registry-polyfill\.js', import\.meta\.url\)\.pathname/);
  }
});

test('red: generated Vite aliases import and access local files from a literal-space path', async t => {
  const { default: config } = await importViteConfigFromLiteralSpacePath(t);
  const coreAlias = config.test.alias['@open-cells/core'];
  const scopedAlias = config.test.alias['@webcomponents/scoped-custom-element-registry'];

  assert.equal(coreAlias.includes('%20'), false);
  assert.equal(scopedAlias.includes('%20'), false);
  assert.equal((await lstat(coreAlias)).isFile(), true);
  assert.equal((await lstat(scopedAlias)).isFile(), true);
});

test('red: E2E files and Playwright dependency appear only when explicitly requested', () => {
  for (const profile of Object.keys(PROFILES)) {
    const withoutE2e = composeRecipe(profile, { kind: 'app', name: `${profile}-plain`, cellsVersion: LEGACY_CELLS_VERSION, e2e: false });
    const withE2e = composeRecipe(profile, { kind: 'app', name: `${profile}-e2e`, cellsVersion: LEGACY_CELLS_VERSION, e2e: true });
    const plainFiles = fileMap(withoutE2e);
    const e2eFiles = fileMap(withE2e);
    const plainMetadata = JSON.parse(plainFiles.get('package.json'));
    const e2eMetadata = JSON.parse(e2eFiles.get('package.json'));

    assert.equal(plainFiles.has('playwright.config.js'), false);
    assert.equal(plainFiles.has('e2e/app.spec.js'), false);
    assert.equal(plainMetadata.devDependencies['@playwright/test'], undefined);
    assert.equal(e2eFiles.has('playwright.config.js'), true);
    assert.equal(e2eFiles.has('e2e/app.spec.js'), true);
    assert.match(e2eFiles.get('playwright.config.js'), /ACADEMY_PLAYWRIGHT_EXECUTABLE_PATH/);
    assert.doesNotMatch(e2eFiles.get('playwright.config.js'), /\/home\/|\/opt\/google/);
    assert.equal(e2eMetadata.devDependencies['@playwright/test'], '^1.50.0');
    assert.equal(e2eMetadata.scripts.e2e, 'playwright test');
  }
});

function lifecycleLogs(result) {
  return result.commands.map(command => [
    command.label,
    command.file + ' ' + command.args.join(' '),
    'exit=' + command.result.exitCode + ' signal=' + command.result.signal + ' durationMs=' + command.result.durationMs,
    'stdout:\n' + command.result.stdout,
    'stderr:\n' + command.result.stderr
  ].join('\n')).join('\n\n');
}

function assertProfileLifecycle(result, profile) {
  const logs = lifecycleLogs(result);
  assert.equal(result.profile, profile, logs);
  assert.deepEqual(result.commands.map(command => command.label), [
    'install',
    'cells app:test',
    'cells app:build',
    'vite build',
    'test:a11y',
    'lint',
    'locales',
    'academy:version'
  ], logs);
  assert.equal(result.commands[0].args.includes('--ignore-scripts'), true, logs);
  for (const command of result.commands) {
    assert.equal(command.result.exitCode, 0, logs);
    assert.equal(command.result.signal, null, logs);
  }
  assert.equal(result.publicLockOnly, true, logs);
  assert.equal(result.distIndex, true, logs);
  assert.equal(result.cellsBuildIndex, true, logs);
  assert.equal(result.localTarball, true, logs);
}

for (const profile of Object.keys(PROFILES)) {
  test(`red: ${profile} lifecycle uses bounded local Cells commands with exact logs`, { concurrency: false, timeout: 180_000 }, async t => {
    const result = await runApplicationProfileLifecycle(t, profile);
    assertProfileLifecycle(result, profile);
  });
}
