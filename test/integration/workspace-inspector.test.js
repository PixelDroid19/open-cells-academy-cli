import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { inspectWorkspace } from '../../src/application/tui/workspace-inspector.js';

test('integration: inspectWorkspace detects OpenCells App workspace', async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'open-cells-app-'));
  t.after(() => rm(root, { recursive: true, force: true }));

  await writeFile(path.join(root, 'package.json'), JSON.stringify({ name: 'my-cells-app', version: '1.0.0' }));
  await mkdir(path.join(root, 'app', 'config'), { recursive: true });
  await writeFile(path.join(root, 'app', 'config', 'dev.js'), 'export default {};');

  const inspected = await inspectWorkspace(root);
  assert.equal(inspected.type, 'app');
  assert.equal(inspected.name, 'my-cells-app');
  assert.equal(inspected.defaultAppConfig, 'dev.js');
});

test('integration: inspectWorkspace derives available app configurations and build default without inventing names', async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'open-cells-app-configs-'));
  t.after(() => rm(root, { recursive: true, force: true }));

  await writeFile(path.join(root, 'package.json'), JSON.stringify({ name: 'my-cells-app', version: '1.0.0' }));
  await mkdir(path.join(root, 'app', 'config'), { recursive: true });
  await writeFile(path.join(root, 'app', 'config', 'dev.js'), 'export default {};');
  await writeFile(path.join(root, 'app', 'config', 'prod.js'), 'export default {};');
  await writeFile(path.join(root, 'app', 'config', 'release.mjs'), 'export default {};');

  const inspected = await inspectWorkspace(root);
  assert.deepEqual(inspected.appConfigs, ['dev.js', 'prod.js', 'release.mjs']);
  assert.equal(inspected.defaultAppConfig, 'dev.js');
  assert.equal(inspected.defaultBuildConfig, 'prod.js');
});

test('integration: inspectWorkspace detects OpenCells Lit Component workspace', async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'open-cells-comp-'));
  t.after(() => rm(root, { recursive: true, force: true }));

  await writeFile(path.join(root, 'package.json'), JSON.stringify({ name: '@academy/my-button', version: '0.1.0' }));
  await mkdir(path.join(root, 'demo'), { recursive: true });
  await writeFile(path.join(root, 'demo', 'index.html'), '<html></html>');

  const inspected = await inspectWorkspace(root);
  assert.equal(inspected.type, 'component');
  assert.equal(inspected.name, '@academy/my-button');
  assert.equal(inspected.testRunner, 'vitest');
});

test('integration: inspectWorkspace detects WTR and Vitest from project test scripts', async t => {
  const wtrRoot = await mkdtemp(path.join(os.tmpdir(), 'open-cells-wtr-comp-'));
  const vitestRoot = await mkdtemp(path.join(os.tmpdir(), 'open-cells-vitest-comp-'));
  t.after(() => Promise.all([
    rm(wtrRoot, { recursive: true, force: true }),
    rm(vitestRoot, { recursive: true, force: true })
  ]));

  await writeFile(path.join(wtrRoot, 'package.json'), JSON.stringify({
    name: '@academy/legacy-button',
    scripts: {
      'test:wtr': 'cells lit-component:test --wtr',
      'test:wtr:watch': 'cells lit-component:test --wtr --watch'
    }
  }));
  await mkdir(path.join(wtrRoot, 'demo'));

  await writeFile(path.join(vitestRoot, 'package.json'), JSON.stringify({
    name: '@academy/modern-button',
    scripts: { test: 'vitest run' },
    devDependencies: { vitest: '3.2.4' }
  }));
  await mkdir(path.join(vitestRoot, 'demo'));

  assert.equal((await inspectWorkspace(wtrRoot)).testRunner, 'wtr');
  assert.equal((await inspectWorkspace(vitestRoot)).testRunner, 'vitest');
});

test('integration: inspectWorkspace handles empty or uninitialized directory non-destructively', async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'open-cells-empty-'));
  t.after(() => rm(root, { recursive: true, force: true }));

  const inspected = await inspectWorkspace(root);
  assert.equal(inspected.type, 'unknown');
  assert.equal(inspected.name, path.basename(root));
});
