import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { EslintAdapter } from '../../src/adapters/eslint/eslint-adapter.js';
import { lintApp } from '../../src/application/app/lint-app.js';
import { lintComponent } from '../../src/application/component/lint-component.js';
import { NodeFilesystem } from '../../src/adapters/node/node-filesystem.js';
import { WorkspaceSession } from '../../src/domain/workspace-session.js';
import { createFakeEslint } from '../fixtures/task-11-lint/fake-eslint.js';

async function workspace(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'open-cells-academy-lint-'));
  t.after(async () => {
    await rm(root, { recursive: true, force: true });
  });
  await writeFile(path.join(root, 'package.json'), '{"name":"lint-fixture","private":true,"type":"module"}\n');
  const filesystem = new NodeFilesystem();
  const session = await WorkspaceSession.open(root, filesystem);
  return { filesystem, root, session };
}

async function writeWorkspaceFile(root, relativePath, content) {
  const target = path.join(root, relativePath);
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, content);
}

function lintContext(session, eslint, overrides = {}) {
  return Object.freeze({ session, eslint, ...overrides });
}

function assertCode(promise, code) {
  return assert.rejects(promise, error => {
    assert.equal(error?.code, code);
    return true;
  });
}

test('red: app lint reports clean and failing projects with abortOnFailure and non-abort reporting', async t => {
  const { root, session } = await workspace(t);
  await writeWorkspaceFile(root, 'app/src/main.js', 'const clean = 1;\n');
  await writeWorkspaceFile(root, 'app/index.html', '<html><body></body></html>\n');
  const fake = createFakeEslint();

  const clean = await lintApp(lintContext(session, new EslintAdapter(fake)));
  assert.equal(clean.ok, true);

  await writeWorkspaceFile(root, 'app/src/broken.js', 'const x = ;\n');
  await assertCode(lintApp(lintContext(session, new EslintAdapter(fake))), 'LINT_ABORTED');

  await writeWorkspaceFile(root, 'app/src/broken.js', 'const x = ;\n');
  const reported = await lintApp(lintContext(session, new EslintAdapter(fake), {
    options: Object.freeze({ abortOnFailure: false })
  }));
  assert.equal(reported.ok, false);
  assert.equal(reported.code, 'LINT_FAILED');
  assert.equal(reported.params.errorCount > 0, true);
  assert.ok(Array.isArray(reported.cause.messages));
  assert.ok(reported.cause.messages.length > 0);
});

test('red: component lint supports fix and reports remaining unfixable issues', async t => {
  const { root, session } = await workspace(t);
  await writeWorkspaceFile(root, 'src/component.js', 'const x = ;\n');
  await writeWorkspaceFile(root, 'test/component.test.js', 'import { expect } from "vitest";\n');
  const fake = createFakeEslint({ fixable: true });

  const result = await lintComponent(lintContext(session, new EslintAdapter(fake), {
    options: Object.freeze({ fix: true, abortOnFailure: false })
  }));
  assert.equal(result.ok, false);
  assert.equal(result.code, 'LINT_FAILED');
  assert.equal(fake.lastInstance.options.fix, true);
  assert.equal(fake.lastInstance.lintPatterns[0].includes('src'), true);
  assert.equal(fake.lastInstance.lintPatterns.some(pattern => pattern.includes('test')), true);
});

test('red: lint config failure and ESLint tool failure are typed and do not leak tool messages', async t => {
  const { root, session } = await workspace(t);
  await writeWorkspaceFile(root, 'src/a.js', 'let a;\n');
  const fake = createFakeEslint({ configFailure: true });

  await assertCode(lintComponent(lintContext(session, new EslintAdapter(fake))), 'LINT_CONFIG_FAILED');
  assert.doesNotMatch(JSON.stringify(fake.failureLog ?? ''), /eslint-config-secret|private/);

  const failing = createFakeEslint({ lintFailure: true });
  await assertCode(lintComponent(lintContext(session, new EslintAdapter(failing))), 'LINT_TOOL_FAILED');
});

test('red: lint is idempotent and rejects a missing session or invalid ESLint before any side effect', async t => {
  const { root, session } = await workspace(t);
  await writeWorkspaceFile(root, 'src/a.js', 'let a;\n');
  const fake = createFakeEslint();
  const adapter = new EslintAdapter(fake);

  await lintComponent(lintContext(session, adapter));
  await lintComponent(lintContext(session, adapter));
  assert.equal(fake.instanceCount, 2);

  await assertCode(lintComponent(lintContext(session, {})), 'LINT_INVALID');
  await assertCode(lintComponent(Object.freeze({ eslint: adapter })), 'LINT_INVALID');
});

test('red: lint uses a modern flat config with public Lit/WebComponent rules and no historical globals', async t => {
  const { root, session } = await workspace(t);
  await writeWorkspaceFile(root, 'src/a.js', 'let a;\n');
  const fake = createFakeEslint();
  const adapter = new EslintAdapter(fake);
  await lintComponent(lintContext(session, adapter, {
    plugins: Object.freeze({ lit: Object.freeze({ rules: {} }), wc: Object.freeze({ rules: {} }) })
  }));
  const flatConfig = fake.lastInstance.options.overrideConfig;
  assert.equal(Array.isArray(flatConfig), true);
  const litConfig = flatConfig.find(config => config.plugins?.lit !== undefined);
  assert.ok(litConfig, 'expected a Lit plugin config block');
  const wcConfig = flatConfig.find(config => config.plugins?.wc !== undefined);
  assert.ok(wcConfig, 'expected a Web Components plugin config block');
  const all = JSON.stringify(flatConfig);
  assert.doesNotMatch(all, /env|globals/);
  assert.ok(flatConfig.some(config => config.languageOptions?.sourceType === 'module'));
});
