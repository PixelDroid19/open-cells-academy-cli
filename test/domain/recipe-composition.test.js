import assert from 'node:assert/strict';
import test from 'node:test';

import { composeRecipe, profileRegistry } from '../../src/recipes/compose-recipe.js';
import { ScaffoldPlan } from '../../src/domain/scaffold-plan.js';
import { profileDefinition as academyAppProfile } from '../../src/recipes/app/academy-app.js';
import { profileDefinition as blankProfile } from '../../src/recipes/app/blank.js';
import { profileDefinition as webAppProfile } from '../../src/recipes/app/web-app.js';
import { profileDefinition as webMobileAppProfile } from '../../src/recipes/app/web-mobile-app.js';
import { profileDefinition as componentProfile } from '../../src/recipes/component/component.js';

const APP_CAPABILITIES = [
  'lit-runtime',
  'cells-config',
  'routing',
  'cells-bridge-compat',
  'pubsub',
  'data-manager',
  'i18n',
  'scoped-elements',
  'sass-theme',
  'unit-browser-tests',
  'accessibility-tests',
  'service-worker',
  'local-api-fixtures'
];

const COMPONENT_CAPABILITIES = [
  'lit-runtime',
  'i18n',
  'scoped-elements',
  'sass-theme',
  'unit-browser-tests',
  'accessibility-tests',
  'local-api-fixtures',
  'component-demo',
  'component-cem-docs'
];

const APP_PROFILES = ['blank', 'web-app', 'web-mobile-app', 'academy-app'];
const PROFILE_DEFINITIONS = [blankProfile, webAppProfile, webMobileAppProfile, academyAppProfile, componentProfile];

function capabilityOrder(plan) {
  return JSON.parse(plan.files.find(file => file.path === '.open-cells-academy-recipe.json').content).capabilities;
}

function packageMetadata(plan) {
  return JSON.parse(plan.files.find(file => file.path === 'package.json').content);
}

test('break: each application profile stops composing the exact fixed base capability order', () => {
  for (const profile of APP_PROFILES) {
    const plan = composeRecipe(profile, { kind: 'app', name: 'teaching-app', e2e: false });

    assert.ok(plan instanceof ScaffoldPlan);
    assert.deepEqual(capabilityOrder(plan), APP_CAPABILITIES);
  }
});

test('break: recipe composition stops resolving every required immutable profile definition', () => {
  assert.equal(profileRegistry.size, PROFILE_DEFINITIONS.length);
  assert.ok(Object.isFrozen(profileRegistry));

  for (const definition of PROFILE_DEFINITIONS) {
    const options = definition.kind === 'app'
      ? { kind: 'app', name: 'teaching-app' }
      : { kind: 'component', name: 'academy-card', namespace: '@academy' };
    const plan = composeRecipe(definition.profile, options);

    assert.equal(profileRegistry.get(definition.profile), definition);
    assert.deepEqual(capabilityOrder(plan), definition.capabilities);
    assert.equal(JSON.parse(plan.files.find(file => file.path === '.open-cells-academy-recipe.json').content).kind, definition.kind);
    assert.ok(Object.isFrozen(definition));
    assert.ok(Object.isFrozen(definition.capabilities));
    assert.throws(() => {
      definition.capabilities.push('unexpected-capability');
    }, TypeError);
  }

  assert.throws(() => {
    profileRegistry.set('unexpected', blankProfile);
  }, TypeError);
});

test('break: component recipes stop composing their smaller fixed capability order', () => {
  const plan = composeRecipe('component', { kind: 'component', name: 'academy-card', namespace: '@academy' });

  assert.deepEqual(capabilityOrder(plan), COMPONENT_CAPABILITIES);
});

test('break: an e2e request stops contributing the only conditional capability at the end', () => {
  const application = composeRecipe('web-app', { kind: 'app', name: 'teaching-app', e2e: true });
  const component = composeRecipe('component', { kind: 'component', name: 'academy-card', namespace: '@academy', e2e: true });

  assert.deepEqual(capabilityOrder(application), [...APP_CAPABILITIES, 'e2e-playwright']);
  assert.deepEqual(capabilityOrder(component), [...COMPONENT_CAPABILITIES, 'e2e-playwright']);
});

test('break: equivalent declarations stop producing stable immutable recipe snapshots', () => {
  const first = composeRecipe('academy-app', { kind: 'app', name: 'teaching-app', e2e: true });
  const second = composeRecipe('academy-app', { kind: 'app', name: 'teaching-app', e2e: true });

  assert.notEqual(first, second);
  assert.deepEqual(ScaffoldPlan.snapshot(first), ScaffoldPlan.snapshot(second));
  assert.deepEqual(first.dependencies, second.dependencies);
  assert.ok(Object.isFrozen(first.files));
  assert.ok(Object.isFrozen(first.dependencies));
  assert.throws(() => {
    first.files[0].path = 'changed';
  }, TypeError);
});

test('break: recipe package metadata stops separating dependency kinds with sorted names', () => {
  const plan = composeRecipe('blank', { kind: 'app', name: 'teaching-app' });
  const metadata = packageMetadata(plan);

  for (const field of ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies']) {
    assert.deepEqual(Object.keys(metadata[field]), [...Object.keys(metadata[field])].sort());
  }
  assert.equal(metadata.dependencies.lit, '3.3.3');
  assert.equal(metadata.devDependencies['open-cells-academy-cli'], 'file:tools/open-cells-academy-cli-0.1.0.tgz');
});

test('break: hostile user values stop being JSON data instead of executable source', () => {
  const hostileName = 'teaching-\";globalThis.compromised=true;//';
  const plan = composeRecipe('blank', { kind: 'app', name: hostileName });
  const declaration = plan.files.find(file => file.path === '.open-cells-academy-recipe.json').content;
  const metadata = packageMetadata(plan);

  assert.equal(globalThis.compromised, undefined);
  assert.equal(JSON.parse(declaration).name, hostileName);
  assert.equal(metadata.name, hostileName);
  assert.match(declaration, /"name": "teaching-\\";globalThis\.compromised=true;\/\/"/);
});

test('break: conflicting capability declarations stop failing before an invalid plan can publish', () => {
  assert.throws(
    () => composeRecipe('blank', { kind: 'app', name: 'teaching-app', capabilityOverrides: { 'lit-runtime': { lit: '^4.0.0' } } }),
    error => error?.code === 'PLAN_CONFLICT'
  );
});

test('break: unknown profiles and malformed recipe options stop reaching a descriptor', () => {
  for (const [profile, options] of [
    ['unknown', { kind: 'app', name: 'teaching-app' }],
    ['blank', { kind: 'app', name: 'teaching-app', e2e: 'yes' }],
    ['component', { kind: 'app', name: 'teaching-app' }]
  ]) {
    assert.throws(() => composeRecipe(profile, options), error => error?.code === 'INVALID_INPUT');
  }
});
