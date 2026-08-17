import assert from 'node:assert/strict';
import test from 'node:test';

import { composeRecipe } from '../../src/recipes/compose-recipe.js';

function fileMap(plan) {
  return new Map(plan.files.map(file => [file.path, file.content]));
}

function applicationSources(files) {
  return [...files.entries()]
    .filter(([path]) => path.startsWith('app/') && (path.endsWith('.js') || path.endsWith('.tpl') || path.endsWith('.json') || path.endsWith('.scss')))
    .map(([, source]) => String(source))
    .join('\n');
}

function generatedText(files) {
  return [...files.values()].map(source => String(source)).join('\n');
}

test('contract: CLI 4 applications emit an isolated Bridge 3 teaching tree', () => {
  const files = fileMap(composeRecipe('web-app', {
    kind: 'app',
    name: 'bridge3-learning-app',
    cellsVersion: '4'
  }));
  const required = [
    'app/config/dev.js',
    'app/config/prod.js',
    'app/tpls/index.tpl',
    'app/tpls/initial-components-imports.tpl',
    'app/tpls/initial-components-imports-themed.tpl',
    'app/scripts/app-bootstrap.js',
    'app/scripts/channel-contract.js',
    'app/scripts/app-module.js',
    'app/scripts/app-routes.js',
    'app/scripts/lit-initial-components.js',
    'app/scripts/lit-components.js',
    'app/composerMocksTpl/catalog.js',
    'app/composerMocksTpl/lesson.js',
    'app/pages/catalog-page/catalog-page.js',
    'app/pages/lesson-page/lesson-page.js',
    'app/styles/main.scss',
    'app/locales-app/en.json',
    'app/locales-app/es.json',
    'app/resources/lessons.json',
    'app/vendor/academy-runtime.js',
    'test/unit/routes.test.js',
    'test/unit/locales.test.js'
  ];

  for (const path of required) assert.equal(files.has(path), true, `missing CLI 4 source ${path}`);

  const metadata = JSON.parse(files.get('package.json'));
  const output = generatedText(files);
  assert.equal(metadata.dependencies['@cells/cells-bridge'], '^3.22.0');
  assert.equal(metadata.dependencies['@cells/cells-page-mixin'], '^1.0.0');
  assert.equal(metadata.dependencies['cells-app-template'], '^6.0.0');
  assert.match(metadata.dependencies.lit, /^\^?3\./u);
  assert.equal(metadata.dependencies['@open-cells/core'], undefined);
  assert.equal(metadata.dependencies['@open-cells/page-mixin'], undefined);
  assert.equal(metadata.scripts.dev, 'vite');
  assert.equal(metadata.scripts.build, 'vite build');
  assert.equal(metadata.scripts.serve, 'cells app:serve -c dev.js');
  assert.equal(metadata.scripts['cells:build'], 'cells app:build -c prod.js');
  assert.equal(metadata.scripts.test, 'cells app:test');
  assert.equal(metadata.scripts.locales, 'cells app:locales -c dev.js');
  assert.match(files.get('app/scripts/app.js'), /window\.CellsPolymer\.start\(/u);
  assert.match(files.get('app/scripts/channel-contract.js'), /academy_learning_progress/u);
  assert.match(files.get('app/pages/catalog-page/catalog-page.js'), /from '\.\.\/\.\.\/scripts\/channel-contract\.js'/u);
  assert.match(files.get('app/pages/lesson-page/lesson-page.js'), /from '\.\.\/\.\.\/scripts\/channel-contract\.js'/u);
  assert.equal([...files.keys()].some(path => path.startsWith('src/')), false);
  assert.doesNotMatch(output, /startApp|@open-cells\/core|@open-cells\/page-mixin|startBridge/u);
});

test('contract: CLI 5 applications retain the inverse Bridge 4 runtime contract', () => {
  const files = fileMap(composeRecipe('web-app', {
    kind: 'app',
    name: 'bridge4-learning-app',
    cellsVersion: '5'
  }));
  const metadata = JSON.parse(files.get('package.json'));
  const sources = applicationSources(files);

  assert.equal(metadata.dependencies['@open-cells/core'], '1.2.1');
  assert.equal(metadata.dependencies['@open-cells/page-mixin'], '1.2.4');
  assert.equal(metadata.dependencies['@cells/cells-bridge'], undefined);
  assert.equal(metadata.dependencies['@cells/cells-page-mixin'], undefined);
  assert.match(files.get('app/scripts/app.js'), /startApp\(/u);
  assert.match(sources, /@open-cells\/core/u);
});

test('contract: CLI 4 E2E material is an optional legacy overlay', () => {
  const plain = fileMap(composeRecipe('web-app', {
    kind: 'app',
    name: 'bridge3-plain',
    cellsVersion: '4',
    e2e: false
  }));
  const overlay = fileMap(composeRecipe('web-app', {
    kind: 'app',
    name: 'bridge3-e2e',
    cellsVersion: '4',
    e2e: true
  }));
  const plainMetadata = JSON.parse(plain.get('package.json'));
  const overlayMetadata = JSON.parse(overlay.get('package.json'));
  const config = overlay.get('playwright.config.js');

  assert.equal(plain.has('playwright.config.js'), false);
  assert.equal(plain.has('e2e/bridge3-app.spec.js'), false);
  assert.equal(plainMetadata.devDependencies.playwright, undefined);
  assert.equal(overlay.has('playwright.config.js'), true);
  assert.equal(overlay.has('e2e/bridge3-app.spec.js'), true);
  assert.equal(overlayMetadata.devDependencies.playwright, '^1.50.0');
  assert.equal((config.match(/\bcommand:/gu) ?? []).length, 1);
  assert.match(config, /cells app:serve -c dev\.js/u);
});
