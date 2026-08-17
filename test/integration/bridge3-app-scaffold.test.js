import assert from 'node:assert/strict';
import test from 'node:test';

import { composeRecipe } from '../../src/recipes/compose-recipe.js';

const PROFILE_EXPECTATIONS = Object.freeze({
  blank: Object.freeze({ feature: 'blank-base', featureKey: 'profile.blank', title: 'Open Cells learning starter', localLessons: false }),
  'web-app': Object.freeze({ feature: 'web-local-fixture', featureKey: 'profile.web', title: 'Open Cells learning catalog', localLessons: true }),
  'web-mobile-app': Object.freeze({ feature: 'mobile-navigation', featureKey: 'profile.mobile', title: 'Open Cells mobile learning', localLessons: true }),
  'academy-app': Object.freeze({ feature: 'guided-learning', featureKey: 'profile.academy', title: 'Open Cells learning studio', localLessons: true })
});

function fileMap(plan) {
  return new Map(plan.files.map(file => [file.path, file.content]));
}

function generatedText(files) {
  return [...files.values()].map(source => String(source)).join('\n');
}

function bridge3Files(profile = 'web-app', options = {}) {
  return fileMap(composeRecipe(profile, {
    kind: 'app',
    name: `${profile}-bridge3-learning-app`,
    cellsVersion: '4',
    ...options
  }));
}

test('contract: CLI 4 emits an Academy-owned compatibility runtime with only public dependencies and working commands', () => {
  const files = bridge3Files();
  const required = [
    'app/config/dev.js',
    'app/config/prod.js',
    'app/tpls/index.tpl',
    'app/tpls/initial-components-imports.tpl',
    'app/tpls/initial-components-imports-themed.tpl',
    'app/scripts/app-bootstrap.js',
    'app/scripts/app-module.js',
    'app/scripts/app-profile.js',
    'app/scripts/app-routes.js',
    'app/scripts/channel-contract.js',
    'app/scripts/lit-initial-components.js',
    'app/scripts/lit-components.js',
    'app/vendor/runtime/academy-bridge3-compat.js',
    'app/data-managers/local-lesson-data.js',
    'app/composerMocksTpl/catalog.js',
    'app/composerMocksTpl/lesson.js',
    'app/pages/catalog-page/catalog-page.js',
    'app/pages/lesson-page/lesson-page.js',
    'app/styles/main.scss',
    'app/locales-app/en.json',
    'app/locales-app/es.json',
    'app/resources/lessons.json',
    'test/unit/runtime.test.js',
    'vitest.config.js'
  ];

  for (const relativePath of required) assert.equal(files.has(relativePath), true, `missing CLI 4 source ${relativePath}`);

  const metadata = JSON.parse(files.get('package.json'));
  const output = generatedText(files);
  assert.deepEqual(Object.keys(metadata.scripts).sort(), ['academy:version', 'locales', 'serve', 'test']);
  assert.equal(metadata.scripts.serve, 'cells app:serve -c dev.js');
  assert.equal(metadata.scripts.test, 'cells app:test');
  assert.equal(metadata.scripts.locales, 'cells app:locales -c dev.js');
  assert.equal(metadata.scripts.dev, undefined);
  assert.equal(metadata.scripts.build, undefined);
  assert.equal(metadata.scripts.lint, undefined);
  assert.equal(metadata.scripts['cells:build'], undefined);
  for (const dependency of ['@cells/cells-bridge', '@cells/cells-page-mixin', 'cells-app-template', 'lit', '@open-cells/core', '@open-cells/page-mixin']) {
    assert.equal(metadata.dependencies[dependency], undefined, `${dependency} must not be a generated runtime dependency`);
    assert.equal(metadata.devDependencies[dependency], undefined, `${dependency} must not be a generated development dependency`);
  }
  assert.equal(metadata.devDependencies.vitest, '^3.2.4');
  assert.equal(metadata.devDependencies['happy-dom'], '^20.11.2');
  assert.match(files.get('app/scripts/app.js'), /installAcademyBridge3Compatibility/u);
  assert.match(files.get('app/scripts/app.js'), /mainNode/u);
  assert.match(files.get('app/pages/catalog-page/catalog-page.js'), /AcademyBridge3PageMixin/u);
  assert.match(files.get('app/pages/lesson-page/lesson-page.js'), /AcademyBridge3PageMixin/u);
  assert.match(files.get('README.md'), /Academy-owned Bridge 3 compatibility runtime/u);
  assert.doesNotMatch(output, /@cells\/|@open-cells\/|startApp|startBridge/u);
});

test('contract: CLI 4 profile matrix emits distinct owned feature behavior and only emitted capabilities', () => {
  const fingerprints = new Set();

  for (const [profile, expected] of Object.entries(PROFILE_EXPECTATIONS)) {
    const files = bridge3Files(profile);
    const declaration = JSON.parse(files.get('.open-cells-academy-recipe.json'));
    const config = files.get('app/config/dev.js');
    const feature = files.get(`app/features/${expected.feature}.js`);
    const profileSource = files.get('app/scripts/app-profile.js');
    const locales = JSON.parse(files.get('app/locales-app/en.json'));

    assert.equal(declaration.profile, profile);
    assert.equal(declaration.cellsVersion, '4');
    assert.equal(declaration.capabilities.includes('lit-runtime'), false);
    assert.equal(declaration.capabilities.includes('accessibility-tests'), false);
    assert.equal(declaration.capabilities.includes('service-worker'), false);
    assert.equal(files.has(`app/features/${expected.feature}.js`), true);
    assert.match(feature, new RegExp(expected.featureKey.replace('.', '\\.')));
    assert.match(profileSource, new RegExp(expected.feature.replace('-', '\\-')));
    assert.match(config, new RegExp(`"profile": "${profile}"`));
    assert.equal(locales['app.title'], expected.title);
    assert.equal(files.has('app/data-managers/local-lesson-data.js'), expected.localLessons);
    assert.equal(feature.includes('"useLocalLessons": true'), expected.localLessons);
    assert.equal(feature.includes('"responsiveNavigation": true'), profile === 'web-mobile-app');
    assert.equal(feature.includes('"guidedLearning": true'), profile === 'academy-app');
    fingerprints.add(feature);
  }

  assert.equal(fingerprints.size, Object.keys(PROFILE_EXPECTATIONS).length);
});

test('contract: CLI 5 applications retain the inverse Bridge 4 runtime contract', () => {
  const files = fileMap(composeRecipe('web-app', {
    kind: 'app',
    name: 'bridge4-learning-app',
    cellsVersion: '5'
  }));
  const metadata = JSON.parse(files.get('package.json'));
  const sources = generatedText(files);

  assert.equal(metadata.dependencies['@open-cells/core'], '1.2.1');
  assert.equal(metadata.dependencies['@open-cells/page-mixin'], '1.2.4');
  assert.equal(metadata.dependencies['@cells/cells-bridge'], undefined);
  assert.equal(metadata.dependencies['@cells/cells-page-mixin'], undefined);
  assert.match(files.get('app/scripts/app.js'), /startApp\(/u);
  assert.match(sources, /@open-cells\/core/u);
});

test('contract: CLI 4 E2E material is a public, executable overlay', () => {
  const plain = bridge3Files('web-app', { e2e: false });
  const overlay = bridge3Files('web-app', { e2e: true });
  const plainMetadata = JSON.parse(plain.get('package.json'));
  const overlayMetadata = JSON.parse(overlay.get('package.json'));
  const config = overlay.get('playwright.config.js');

  assert.equal(plain.has('playwright.config.js'), false);
  assert.equal(plain.has('e2e/bridge3-app.spec.js'), false);
  assert.equal(plainMetadata.devDependencies['@playwright/test'], undefined);
  assert.equal(overlay.has('playwright.config.js'), true);
  assert.equal(overlay.has('e2e/bridge3-app.spec.js'), true);
  assert.equal(overlayMetadata.devDependencies['@playwright/test'], '^1.50.0');
  assert.equal(overlayMetadata.scripts.e2e, 'playwright test');
  assert.equal((config.match(/\bcommand:/gu) ?? []).length, 1);
  assert.match(config, /cells app:serve -c dev\.js/u);
  assert.match(config, /channel: 'chrome'/u);
  assert.match(overlay.get('README.md'), /npx playwright install chrome/u);
  assert.match(overlay.get('README.md'), /npm run e2e/u);
  assert.match(overlay.get('README.md'), /does not download a browser/u);
});
