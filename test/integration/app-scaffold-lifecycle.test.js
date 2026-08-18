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
  blank: Object.freeze({ title: 'Open Cells learning starter' }),
  'web-app': Object.freeze({ title: 'Open Cells learning catalog' }),
  'web-mobile-app': Object.freeze({ title: 'Open Cells mobile learning' }),
  'academy-app': Object.freeze({ title: 'Open Cells learning studio' })
});
const MODERN_CELLS_VERSION = '5';

function fileMap(plan) {
  return new Map(plan.files.map(file => [file.path, file.content]));
}

async function importViteConfigFromLiteralSpacePath(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'academy vite config space-'));
  t.after(async () => {
    await rm(root, { recursive: true, force: true });
  });
  const project = path.join(root, 'generated app');
  const files = fileMap(composeRecipe('blank', { kind: 'app', name: 'space-app', cellsVersion: MODERN_CELLS_VERSION }));
  await mkdir(path.join(project, 'test'), { recursive: true });
  await mkdir(path.join(project, 'app', 'config'), { recursive: true });
  await Promise.all([
    writeFile(path.join(project, 'vite.config.js'), files.get('vite.config.js')),
    writeFile(path.join(project, 'app', 'config', 'dev.js'), files.get('app/config/dev.js')),
    symlink(path.resolve(import.meta.dirname, '..', '..', 'node_modules'), path.join(project, 'node_modules'), 'dir')
  ]);
  return import(pathToFileURL(path.join(project, 'vite.config.js')).href);
}

test('red: every application profile composes a complete runnable and distinct Academy payload', () => {
  const fingerprints = new Set();

  for (const [profile, expected] of Object.entries(PROFILES)) {
    const plan = composeRecipe(profile, { kind: 'app', name: `${profile}-fixture`, cellsVersion: MODERN_CELLS_VERSION });
    const files = fileMap(plan);
    for (const required of [
      'index.html',
      'app/scripts/app.js',
      'app/scripts/app-routes.js',
      'app/scripts/app-module.js',
      'app/scripts/channels.js',
      'app/scripts/localization.js',
      'app/tpls/index.tpl',
      'app/styles/main.scss',
      'app/pages/catalog-page/catalog-page.js',
      'app/pages/lesson-page/lesson-page.js',
      'app/locales-app/locales.json',
      'test/unit/routes.test.js',
      'test/unit/channels.test.js',
      'test/unit/data-manager.test.js',
      'test/unit/locales.test.js',
      'test/unit/runtime.test.js',
      'test/unit/dev/locales/locales.json',
      'test/unit/prod/locales/locales.json',
      'app/config/dev.js',
      'app/config/prod.js',
      'vite.config.js'
    ]) {
      assert.equal(files.has(required), true, `${profile} is missing ${required}`);
    }
    assert.match(files.get('app/scripts/app-routes.js'), /name: 'catalog'/);
    assert.match(files.get('app/scripts/app-routes.js'), /name: 'lesson'/);
    assert.match(files.get('app/scripts/app-routes.js'), /\/lesson\/:lessonId/);
    assert.match(files.get('app/locales-app/locales.json'), new RegExp(expected.title));
    const metadata = JSON.parse(files.get('package.json'));
    assert.equal(typeof metadata.scripts.dev, 'string');
    assert.equal(typeof metadata.scripts.build, 'string');
    assert.equal(typeof metadata.scripts.test, 'string');
    assert.equal(typeof metadata.scripts.preview, 'string');
    assert.equal(metadata.scripts.lint, 'cells app:lint');
    assert.equal(metadata.scripts.locales, 'cells app:locales -c dev.js');
    assert.equal(metadata.scripts['test:a11y'], 'vitest run test/unit');
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
    assert.equal(files.has('test/unit/runtime.test.js'), true);
    assert.match(files.get('vite.config.js'), /environment: 'happy-dom'/);
    assert.match(files.get('app/scripts/app.js'), /startApp/);
    assert.match(files.get('app/scripts/app.js'), /virtual:open-cells-app-config/);
    assert.equal(metadata.devDependencies['happy-dom'], '20.11.2');
    assert.equal(metadata.devDependencies['@vitest/coverage-v8'], '3.2.4');
    assert.equal(metadata.devDependencies['axe-core'], '4.13.0');
    fingerprints.add(files.get('app/locales-app/locales.json'));
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
    const publication = await filesystem.applyPlanAtomically(owner, composeRecipe(profile, { kind: 'app', name: `${profile}-config`, cellsVersion: MODERN_CELLS_VERSION }), profile);
    const session = await WorkspaceSession.open(publication.destination, filesystem);
    const [dev, prod] = await Promise.all([loadCellsConfig(session, 'dev.js'), loadCellsConfig(session, 'prod.js')]);

    for (const config of [dev, prod]) {
      assert.equal(typeof config.app.name, 'string');
      assert.equal(typeof config.app.title, 'string');
      assert.equal(typeof config.app.description, 'string');
      assert.equal(config.app.name, `${profile}-config`);
      assert.deepEqual(config.server, { host: '127.0.0.1', port: 8001, strictPort: false, open: false });
      assert.equal(config.locales.enabledI18n, true);
      assert.deepEqual(config.locales.languages, ['en', 'es']);
      assert.equal(config.locales.forTesting, true);
      assert.equal(config.runtime.initialTemplate, 'catalog');
    }
    assert.deepEqual(dev.build, { target: 'es2022', sourcemap: true });
    assert.deepEqual(prod.build, { target: 'es2022', sourcemap: false });
  }
});

test('red: every application profile keeps the browser bootstrap and test runtime separate', () => {
  for (const profile of Object.keys(PROFILES)) {
    const files = fileMap(composeRecipe(profile, { kind: 'app', name: profile + '-scoped-fixture', cellsVersion: MODERN_CELLS_VERSION }));
    const app = files.get('app/scripts/app.js');
    const config = files.get('vite.config.js');

    assert.equal(files.has('app/scripts/lit-initial-components.js'), true);
    assert.match(files.get('app/scripts/lit-initial-components.js'), /lit-components/);
    assert.match(app, /import '\.\/lit-initial-components\.js'/);
    assert.match(app, /@open-cells\/core/);
    assert.match(app, /virtual:open-cells-app-config/);
    assert.match(config, /import \{ fileURLToPath \} from 'node:url';/);
    assert.match(config, /include: \['test\/unit\/\*\*\/\*\.test\.js'\]/);
    assert.match(config, /virtual:open-cells-app-config/);
    assert.doesNotMatch(config, /\.pathname/);
  }
});

test('red: generated Vite aliases import and access local files from a literal-space path', async t => {
  const { default: config } = await importViteConfigFromLiteralSpacePath(t);
  const configAlias = config.test.alias['virtual:open-cells-app-config'];

  assert.equal(configAlias.includes('%20'), false);
  assert.equal((await lstat(configAlias)).isFile(), true);
});

test('red: E2E files and Playwright dependency appear only when explicitly requested', () => {
  for (const profile of Object.keys(PROFILES)) {
    const withoutE2e = composeRecipe(profile, { kind: 'app', name: `${profile}-plain`, cellsVersion: MODERN_CELLS_VERSION, e2e: false });
    const withE2e = composeRecipe(profile, { kind: 'app', name: `${profile}-e2e`, cellsVersion: MODERN_CELLS_VERSION, e2e: true });
    const plainFiles = fileMap(withoutE2e);
    const e2eFiles = fileMap(withE2e);
    const plainMetadata = JSON.parse(plainFiles.get('package.json'));
    const e2eMetadata = JSON.parse(e2eFiles.get('package.json'));

    assert.equal(plainFiles.has('playwright.config.js'), false);
    assert.equal(plainFiles.has('e2e/bridge4-app.spec.js'), false);
    assert.equal(plainMetadata.devDependencies['@playwright/test'], undefined);
    assert.equal(e2eFiles.has('playwright.config.js'), true);
    assert.equal(e2eFiles.has('e2e/bridge4-app.spec.js'), true);
    assert.match(e2eFiles.get('playwright.config.js'), /OPEN_CELLS_PLAYWRIGHT_CHANNEL/);
    assert.doesNotMatch(e2eFiles.get('playwright.config.js'), /\/home\/|\/opt\/google/);
    assert.equal(e2eMetadata.devDependencies.playwright, '1.62.1');
    assert.equal(e2eMetadata.devDependencies['@axe-core/playwright'], '^4.10.0');
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
  assert.ok(result.cellsBuildIndex, logs);
  assert.equal(result.localTarball, true, logs);
}

for (const profile of Object.keys(PROFILES)) {
  test(`red: ${profile} lifecycle uses bounded local Cells commands with exact logs`, { concurrency: false, timeout: 180_000 }, async t => {
    const result = await runApplicationProfileLifecycle(t, profile);
    assertProfileLifecycle(result, profile);
  });
}
