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
    assert.match(files.get('demo/academy-demo-helper.js'), /customViewportWidth/u);
    const sourcePath = `src/${sourceName}.js`;
    assert.match(files.get(sourcePath), /-continue/u);
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
