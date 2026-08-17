import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { FileWorkspaceLock } from '../../src/adapters/node/file-workspace-lock.js';
import { NodeFilesystem } from '../../src/adapters/node/node-filesystem.js';
import { NodeProcessRunner } from '../../src/adapters/node/process-runner.js';
import { createApp } from '../../src/application/app/create-app.js';
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
    'test/unit/dev/locales/locales.json',
    'test/unit/prod/locales/locales.json'
  ];

  for (const profile of PROFILES) {
    const files = bridge4Files(profile);
    for (const required of requiredFiles) {
      assert.equal(files.has(required), true, `${profile} is missing ${required}`);
    }
    const metadata = JSON.parse(files.get('package.json'));
    assert.equal(metadata.dependencies['@cells/cells-bridge'], '^4.0.0');
    assert.equal(metadata.dependencies['@cells/cells-page-mixin'], '^2.0.0');
    assert.match(metadata.dependencies.lit, /^\^?3\./);
    assert.equal(metadata.dependencies['@open-cells/core'], undefined);
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
  assert.equal(metadata.dependencies['@cells/cells-bridge'], '^4.0.0');
  assert.match(bootstrap, /startBridge/);
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
  assert.equal(plainMetadata.devDependencies['@playwright/test'], undefined);
  assert.equal(overlay.has('playwright.config.js'), true);
  assert.equal(overlay.has('e2e/bridge4-app.spec.js'), true);
  assert.equal(overlayMetadata.devDependencies['@playwright/test'], '^1.50.0');
  assert.match(overlay.get('e2e/bridge4-app.spec.js'), /toHaveURL/);
  assert.match(overlay.get('e2e/bridge4-app.spec.js'), /introduction/);
});

test('contract: CLI 5 app routes and pages use native Bridge 4 navigation lifecycle boundaries', () => {
  const files = bridge4Files('web-app');
  const bootstrap = files.get('app/scripts/app.js');
  const channels = files.get('app/scripts/channels.js');
  const routes = files.get('app/scripts/app-routes.js');
  const catalog = files.get('app/pages/catalog-page/catalog-page.js');
  const lesson = files.get('app/pages/lesson-page/lesson-page.js');

  assert.match(bootstrap, /startBridge\(\{[\s\S]*routes[\s\S]*mainNode[\s\S]*cells_properties[\s\S]*appConfig/);
  assert.match(routes, /Object\.freeze/);
  assert.match(routes, /path: '\/'/);
  assert.match(routes, /path: '\/lesson\/:lessonId'/);
  assert.match(routes, /name: 'lesson'/);
  assert.match(routes, /async action\(\)/);
  assert.match(routes, /import\('\.\.\/pages\/catalog-page\/catalog-page\.js'\)/);
  assert.match(routes, /import\('\.\.\/pages\/lesson-page\/lesson-page\.js'\)/);
  assert.match(catalog, /CellsPageMixin\(LitElement\)/);
  assert.match(catalog, /navigate\('lesson', \{ lessonId \}\)/);
  assert.match(channels, /academy-progress/);
  assert.match(catalog, /this\.publish\(ACADEMY_PROGRESS_CHANNEL/);
  assert.match(catalog, /<catalog-page-template/);
  assert.match(lesson, /CellsPageMixin\(LitElement\)/);
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
  const catalogs = JSON.parse(files.get('app/locales-app/locales.json'));

  assert.match(channels, /latest/);
  assert.match(channels, /onPageEnter/);
  assert.match(channels, /onPageLeave/);
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
});

test('contract: CLI 5 generated unit tests run with the declared Bridge page boundary', async t => {
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
  const nodeModules = path.join(publication.destination, 'node_modules');
  const cliRoot = path.resolve(import.meta.dirname, '../..');
  const pageMixin = path.join(nodeModules, '@cells', 'cells-page-mixin');
  await mkdir(pageMixin, { recursive: true });
  await writeFile(path.join(pageMixin, 'package.json'), '{"name":"@cells/cells-page-mixin","type":"module","exports":"./index.js"}\n');
  await writeFile(path.join(pageMixin, 'index.js'), `export const CellsPageMixin = Base => class extends Base {
  publish() {}
  subscribe() {}
  unsubscribe() {}
  navigate() {}
};
`);
  await symlink(path.join(cliRoot, 'node_modules', 'lit'), path.join(nodeModules, 'lit'), 'dir');
  await symlink(path.join(cliRoot, 'node_modules', 'vitest'), path.join(nodeModules, 'vitest'), 'dir');
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
