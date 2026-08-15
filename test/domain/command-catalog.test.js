import assert from 'node:assert/strict';
import test from 'node:test';

import { getCommandCatalog, findCommand, filterCommands } from '../../src/domain/tui/command-catalog.js';

test('domain: getCommandCatalog returns all 19 canonical commands with metadata and aliases', () => {
  const catalog = getCommandCatalog();
  assert.equal(catalog.length, 19);
  assert.ok(Object.isFrozen(catalog));

  const compDev = catalog.find(item => item.name === 'component:dev');
  assert.ok(compDev);
  assert.deepEqual(compDev.aliases, ['lit-component:serve', 'lit-components:serve']);
  assert.equal(compDev.category, 'component');
  assert.equal(compDev.shortcut, 's');

  const compTest = catalog.find(item => item.name === 'component:test');
  assert.ok(compTest);
  assert.deepEqual(compTest.aliases, ['lit-component:test']);
  assert.equal(compTest.shortcut, 'u');

  const appDev = catalog.find(item => item.name === 'app:dev');
  assert.ok(appDev);
  assert.equal(appDev.category, 'app');
  assert.equal(appDev.shortcut, 's');
});

test('domain: findCommand resolves both canonical names and legacy aliases', () => {
  assert.equal(findCommand('component:dev')?.name, 'component:dev');
  assert.equal(findCommand('lit-component:serve')?.name, 'component:dev');
  assert.equal(findCommand('lit-components:serve')?.name, 'component:dev');
  assert.equal(findCommand('lit-component:test')?.name, 'component:test');
  assert.equal(findCommand('lit-component:build:demo')?.name, 'component:build:demo');
  assert.equal(findCommand('lit-component:lint')?.name, 'component:lint');
  assert.equal(findCommand('lit-component:locales')?.name, 'component:locales');
  assert.equal(findCommand('lit-component:documentation')?.name, 'component:documentation');
  assert.equal(findCommand('unknown:command'), undefined);
});

test('domain: filterCommands filters by search query and workspace type', () => {
  const catalog = getCommandCatalog();

  const appOnly = filterCommands(catalog, '', 'app');
  assert.ok(appOnly.every(cmd => cmd.category === 'app' || cmd.category === 'shared'));
  assert.ok(appOnly.some(cmd => cmd.name === 'app:dev'));
  assert.ok(!appOnly.some(cmd => cmd.name === 'component:dev'));

  const compOnly = filterCommands(catalog, '', 'component');
  assert.ok(compOnly.every(cmd => cmd.category === 'component' || cmd.category === 'shared'));
  assert.ok(compOnly.some(cmd => cmd.name === 'component:dev'));
  assert.ok(!compOnly.some(cmd => cmd.name === 'app:dev'));

  const searchResults = filterCommands(catalog, 'test', 'all');
  assert.ok(searchResults.some(cmd => cmd.name === 'app:test'));
  assert.ok(searchResults.some(cmd => cmd.name === 'component:test'));
  assert.ok(!searchResults.some(cmd => cmd.name === 'app:dev'));
});

test('domain: catalog advertises only the controller shortcut set without lint, install, or changelog collisions', () => {
  const advertised = new Set(getCommandCatalog().map(command => command.shortcut).filter(Boolean));

  assert.deepEqual(advertised, new Set(['s', 'u', 'b', 'i', 'd', 'p', '+']));
  assert.equal(findCommand('app:lint')?.shortcut, null);
  assert.equal(findCommand('component:lint')?.shortcut, null);
  assert.equal(findCommand('app:install')?.shortcut, null);
  assert.equal(findCommand('component:install')?.shortcut, null);
  assert.equal(findCommand('app:changelog')?.shortcut, null);
  assert.equal(findCommand('component:changelog')?.shortcut, null);
});
