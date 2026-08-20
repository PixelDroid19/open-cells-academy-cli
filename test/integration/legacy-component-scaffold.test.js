import assert from 'node:assert/strict';
import test from 'node:test';

import { composeRecipe } from '../../src/recipes/compose-recipe.js';

function filesFor(input) {
  const plan = composeRecipe('component', { kind: 'component', e2e: false, ...input });
  return new Map(plan.files.map(file => [file.path, file.content]));
}

function manifest(files) {
  return JSON.parse(files.get('package.json'));
}

test('CLI 4 Lit 1 and Lit 3 select separate executable trees and lit-component commands', () => {
  const lit1 = filesFor({ name: 'legacy-card', namespace: '@academy', cellsVersion: '4', componentBase: 'lit1' });
  const lit3 = filesFor({ name: 'modern-card', namespace: '@academy', cellsVersion: '4', componentBase: 'lit3' });

  assert.equal(manifest(lit1).dependencies.lit, undefined);
  assert.equal(manifest(lit1).dependencies['lit-element'], '^2.5.1');
  assert.equal(manifest(lit3).dependencies.lit, '^3.3.3');
  assert.match(lit1.get('src/legacy-card.js'), /from 'lit-element'/u);
  assert.match(lit3.get('src/modern-card.js'), /from 'lit'/u);
  for (const [files, sourceName] of [[lit1, 'legacy-card'], [lit3, 'modern-card']]) {
    assert.equal(files.has('demo/basic.html'), true);
    assert.equal(files.has('demo/demo-build.js'), true);
    assert.equal(files.has('demo/academy-demo-helper.js'), true);
    assert.equal(files.has('demo/locales/locales.json'), true);
    assert.match(files.get('demo/index.html'), /academy-demo-case/u);
    assert.match(files.get('demo/index.html'), new RegExp(`component-tag="${sourceName}"`, 'u'));
    const helper = files.get('demo/academy-demo-helper.js');
    assert.match(helper, /data-view="visual"/u);
    assert.match(helper, /data-view="code"/u);
    assert.match(helper, /data-view="documentation"/u);
    assert.match(helper, /data-language="en"/u);
    assert.match(helper, /data-preset="fluid"/u);
    assert.match(helper, /data-hide-ui/u);
    assert.match(helper, /data-open/u);
    assert.match(helper, /data-event-latest/u);
    assert.match(helper, /data-label="apiColumn"/u);
    assert.match(helper, /data-label="contractColumn"/u);
    assert.match(helper, /data-label="evidenceColumn"/u);
    assert.match(helper, /return this\.getAttribute\('component-tag'\) \|\| 'academy-component'/u);
    const demo = files.get('demo/demo.js');
    assert.match(demo, /source !== 'academy-demo-host'/u);
    assert.match(demo, /message\.kind !== 'language'/u);
    assert.doesNotMatch(demo, /document\.createElement\('button'\)/u);
    assert.match(files.get('demo/basic.html'), /place-items: center/u);
    const sourcePath = `src/${sourceName}.js`;
    assert.match(files.get(sourcePath), /-continue/u);
    assert.equal(manifest(files).devDependencies['@web/test-runner'], '0.19.0');
    assert.equal(manifest(files).devDependencies['@web/test-runner-playwright'], '0.11.0');
    assert.equal(manifest(files).devDependencies['@web/test-runner-junit-reporter'], '0.8.0');
    assert.equal(manifest(files).devDependencies['@vitest/coverage-v8'], '3.2.4');
  }
  assert.match(lit1.get('README.md'), /lit-component:serve/u);
  assert.match(lit3.get('README.md'), /lit-component:test/u);
  assert.equal(manifest(lit1).scripts.sass, 'cells component:sass');
  assert.equal(manifest(lit3).scripts.sass, 'cells component:sass');
  assert.doesNotMatch(lit1.get('src/legacy-card.js'), /Polymer/u);
  assert.doesNotMatch(lit3.get('src/modern-card.js'), /Polymer/u);
});

test('Polymer component profiles publish distinct minimal teaching trees and component commands', () => {
  const profiles = ['component', 'behavior', 'data-manager', 'theme'];
  for (const componentProfile of profiles) {
    const files = filesFor({ name: `legacy-${componentProfile}`, namespace: '@academy', cellsVersion: '4', componentProfile });
    const sourcePaths = [...files.keys()].filter(file => file.startsWith('src/'));
    assert.equal(manifest(files).dependencies['@polymer/polymer'], '^3.5.0');
    assert.match(files.get('README.md'), /component:serve/u);
    assert.match(files.get('README.md'), /cellsVersion.*4/u);
    assert.ok(sourcePaths.length > 0);
    assert.ok(sourcePaths.some(file => file.endsWith('.js')));
    assert.ok(sourcePaths.every(file => !files.get(file).includes("from 'lit'")));
    assert.ok(sourcePaths.every(file => !files.get(file).includes('from "lit"')));
    assert.match(files.get('.open-cells-academy-recipe.json'), new RegExp(`"componentProfile": "${componentProfile}"`, 'u'));
  }
});

test('CLI 5 rejects CLI 4 component bases and Polymer profiles', () => {
  for (const input of [
    { name: 'wrong-lit', namespace: '@academy', cellsVersion: '5', componentBase: 'lit3' },
    { name: 'wrong-polymer', namespace: '@academy', cellsVersion: '5', componentProfile: 'component' },
    { name: 'wrong-profile', namespace: '@academy', cellsVersion: '4', componentProfile: 'unknown' }
  ]) {
    assert.throws(() => composeRecipe('component', { kind: 'component', e2e: false, ...input }), { code: 'INVALID_INPUT' });
  }
});

test('CLI 4 optional E2E overlays start the matching Cells serve command in installed Chrome', () => {
  const lit = filesFor({ name: 'legacy-lit-e2e', namespace: '@academy', cellsVersion: '4', componentBase: 'lit3', e2e: true });
  const polymer = filesFor({ name: 'legacy-polymer-e2e', namespace: '@academy', cellsVersion: '4', componentProfile: 'component', e2e: true });

  assert.match(lit.get('playwright.config.js'), /cells lit-component:serve/u);
  assert.match(polymer.get('playwright.config.js'), /cells component:serve/u);
  for (const files of [lit, polymer]) {
    assert.match(files.get('playwright.config.js'), /OPEN_CELLS_PLAYWRIGHT_CHANNEL \?\? 'chrome'/u);
    assert.match(files.get('e2e/smoke.spec.js'), /AxeBuilder/u);
    assert.equal(manifest(files).scripts.e2e, 'playwright test');
    assert.equal(manifest(files).devDependencies['@axe-core/playwright'], '^4.10.0');
    assert.equal(manifest(files).devDependencies['@playwright/test'], '^1.50.0');
    assert.match(files.get('README.md'), /npm run e2e/u);
    assert.match(files.get('README.md'), /OPEN_CELLS_PLAYWRIGHT_CHANNEL/u);
  }
  assert.match(lit.get('e2e/smoke.spec.js'), /academy-demo-helper/u);
  assert.match(lit.get('e2e/smoke.spec.js'), /legacy-lit-e2e-continue/u);
});
