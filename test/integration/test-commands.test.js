import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { testProject } from '../../src/application/shared/test-project.js';
import { testApp } from '../../src/application/app/test-app.js';
import { testComponent } from '../../src/application/component/test-component.js';
import { NodeFilesystem } from '../../src/adapters/node/node-filesystem.js';
import { WorkspaceSession } from '../../src/domain/workspace-session.js';
import { BrowserCapability } from '../../src/adapters/testing/browser-capability.js';
import { VitestBrowserRunner } from '../../src/adapters/testing/vitest-browser-runner.js';
import { WtrRunner } from '../../src/adapters/testing/wtr-runner.js';
import { createFakeTestToolchain } from '../fixtures/task-12-testing/fake-testing.js';

async function workspace(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'open-cells-academy-testing-'));
  t.after(async () => {
    await rm(root, { recursive: true, force: true });
  });
  await writeFile(path.join(root, 'package.json'), '{"name":"testing-fixture","private":true,"type":"module"}\n');
  const filesystem = new NodeFilesystem();
  const session = await WorkspaceSession.open(root, filesystem);
  return { filesystem, root, session };
}

async function writeWorkspaceFile(root, relativePath, content) {
  const target = path.join(root, relativePath);
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, content);
}

function testContext(session, runner, overrides = {}) {
  return Object.freeze({ session, runner, ...overrides });
}

function assertCode(promise, code) {
  return assert.rejects(promise, error => {
    assert.equal(error?.code, code);
    return true;
  });
}

test('red: test project runs Vitest green and reports pass with target-local artifacts', async t => {
  const { filesystem, root, session } = await workspace(t);
  await writeWorkspaceFile(root, 'test/a.test.js', 'import { expect, it } from "vitest"; it("passes", () => expect(1).toBe(1));\n');
  const fake = createFakeTestToolchain();
  const runner = new VitestBrowserRunner(fake);

  const outcome = await testProject(testContext(session, runner));
  assert.equal(outcome.ok, true);
  assert.equal(outcome.data.passed, 1);
  assert.equal(fake.vitestLast.cwd, root);
  assert.equal(fake.vitestLast.args.includes('run'), true);
  const junit = await readFile(path.join(root, 'test', 'coverage', 'junit-report.xml'), 'utf8');
  assert.match(junit, /testsuite/);
});

test('red: test project fails on assertion, import, unhandled-error, and no-test runs with real exit codes', async t => {
  const { root, session } = await workspace(t);
  const filesystem = new NodeFilesystem();

  await writeWorkspaceFile(root, 'test/fail.test.js', 'it("fails", () => { throw new Error("boom"); });\n');
  const assertFail = createFakeTestToolchain({ mode: 'assertion' });
  const failed = await testProject(testContext(session, new VitestBrowserRunner(assertFail)));
  assert.equal(failed.ok, false);
  assert.equal(failed.code, 'TEST_FAILED');
  assert.ok(failed.params.failures >= 1);

  await writeWorkspaceFile(root, 'test/import.test.js', 'import "./missing.js";\n');
  const importFail = createFakeTestToolchain({ mode: 'import' });
  const importOutcome = await testProject(testContext(session, new VitestBrowserRunner(importFail)));
  assert.equal(importOutcome.ok, false);
  assert.equal(importOutcome.code, 'TEST_FAILED');

  const noTests = createFakeTestToolchain({ mode: 'no-tests' });
  const noTestsOutcome = await testProject(testContext(session, new VitestBrowserRunner(noTests)));
  assert.equal(noTestsOutcome.ok, false);
  assert.equal(noTestsOutcome.code, 'TEST_NO_TESTS');
});

test('red: test project reports a missing Chromium as an actionable failure without auto-install', async t => {
  const { root, session } = await workspace(t);
  const filesystem = new NodeFilesystem();
  await writeWorkspaceFile(root, 'test/a.test.js', 'it("passes", () => {});\n');
  const capability = new BrowserCapability({ chromiumAvailable: async () => false });
  const fake = createFakeTestToolchain();
  const runner = new VitestBrowserRunner(fake);

  const outcome = await testProject(testContext(session, runner, { browser: capability }));
  assert.equal(outcome.ok, false);
  assert.equal(outcome.code, 'CHROMIUM_UNAVAILABLE');
  assert.equal(fake.vitestCalls, 0);
});

test('red: test project supports WTR as the compatibility runner and a custom cwd target', async t => {
  const { root, session } = await workspace(t);
  const filesystem = new NodeFilesystem();
  await writeWorkspaceFile(root, 'test/a.test.js', 'import { expect } from "@open-wc/testing"; it("passes", () => expect(1).to.equal(1));\n');
  const fake = createFakeTestToolchain();
  const launcherEntry = path.join(root, 'cli-launcher', 'index.mjs');
  const junitEntry = path.join(root, 'cli-junit', 'index.mjs');
  const runner = new WtrRunner(fake, 'web-test-runner', launcherEntry, junitEntry);

  const outcome = await testProject(testContext(session, runner, { wtr: true }));
  assert.equal(outcome.ok, true);
  assert.equal(fake.wtrLast.cwd, root);
  assert.equal(fake.wtrLast.args.includes('--config'), true);
  const config = await readFile(path.join(root, 'wtr.academy.config.mjs'), 'utf8');
  assert.match(config, /nodeResolve:\s*true/);
  assert.match(config, /ui:\s*'tdd'/);
  assert.match(config, new RegExp(`junitReporter\\(\\{ outputPath: 'test/coverage/junit-report.xml' \\}\\)`));
  assert.match(config, new RegExp(`from\\s+'file://${launcherEntry.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}'`));
  assert.match(config, new RegExp(`from\\s+'file://${junitEntry.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}'`));
});

test('red: test project prefers the project launcher and reports a missing launcher as a typed failure', async t => {
  const { root, session } = await workspace(t);
  await writeWorkspaceFile(root, 'test/a.test.js', 'it("passes", () => {});\n');
  await writeWorkspaceFile(root, path.join('node_modules', '@web', 'test-runner-playwright', 'package.json'), '{"name":"@web/test-runner-playwright","version":"0.0.0"}\n');
  const withProjectLauncher = new WtrRunner(createFakeTestToolchain(), 'web-test-runner');
  const projectOutcome = await testProject(testContext(session, withProjectLauncher, { wtr: true }));
  assert.equal(projectOutcome.ok, true);
  const config = await readFile(path.join(root, 'wtr.academy.config.mjs'), 'utf8');
  assert.match(config, /from\s+'@web\/test-runner-playwright'/);

  const withoutLauncher = new WtrRunner(createFakeTestToolchain(), 'web-test-runner');
  await rm(path.join(root, 'node_modules'), { recursive: true, force: true });
  const missing = await testProject(testContext(session, withoutLauncher, { wtr: true }));
  assert.equal(missing.ok, false);
  assert.equal(missing.code, 'TEST_LAUNCHER_MISSING');
});

test('red: test project propagates SIGINT/SIGTERM as INTERRUPTED without unhandled rejections and cleans up', async t => {
  const { root, session } = await workspace(t);
  const filesystem = new NodeFilesystem();
  await writeWorkspaceFile(root, 'test/a.test.js', 'it("passes", () => {});\n');
  const fake = createFakeTestToolchain({ interrupt: true });
  const signals = new EventEmitter();
  const unhandled = [];
  const onUnhandled = reason => unhandled.push(reason);
  process.on('unhandledRejection', onUnhandled);
  try {
    const runner = new VitestBrowserRunner(fake);
    const outcome = await testProject(testContext(session, runner, { signals }));
    assert.equal(outcome.ok, false);
    assert.equal(outcome.code, 'INTERRUPTED');
    assert.equal(unhandled.length, 0);
    assert.equal(signals.listenerCount('SIGINT'), 0);
    assert.equal(signals.listenerCount('SIGTERM'), 0);
  } finally {
    process.removeListener('unhandledRejection', onUnhandled);
  }
});

test('red: test project runs two concurrent projects without interference and writes project-local artifacts', async t => {
  const { root: rootA, session: sessionA } = await workspace(t);
  const { root: rootB, session: sessionB } = await workspace(t);
  await writeWorkspaceFile(rootA, 'test/a.test.js', 'it("a", () => {});\n');
  await writeWorkspaceFile(rootB, 'test/b.test.js', 'it("b", () => {});\n');
  const fake = createFakeTestToolchain();

  const [outcomeA, outcomeB] = await Promise.all([
    testProject(testContext(sessionA, new VitestBrowserRunner(fake))),
    testProject(testContext(sessionB, new VitestBrowserRunner(fake)))
  ]);
  assert.equal(outcomeA.ok, true);
  assert.equal(outcomeB.ok, true);
  const junitA = await readFile(path.join(rootA, 'test', 'coverage', 'junit-report.xml'), 'utf8');
  const junitB = await readFile(path.join(rootB, 'test', 'coverage', 'junit-report.xml'), 'utf8');
  assert.match(junitA, /testsuite/);
  assert.match(junitB, /testsuite/);
});

test('red: test command rejects invalid context and updateLocales requires a locales capability', async t => {
  const { session } = await workspace(t);
  const fake = createFakeTestToolchain();
  await assertCode(testProject(testContext(session, {})), 'TEST_RUNNER_INVALID');
  await assertCode(testProject(Object.freeze({ runner: new VitestBrowserRunner(fake) })), 'TEST_INVALID');
  const missingLocales = await testApp(testContext(session, new VitestBrowserRunner(fake), { options: Object.freeze({ updateLocales: true }) }));
  assert.equal(missingLocales.ok, false);
  assert.equal(missingLocales.code, 'TEST_UPDATE_LOCALES_MISSING');
});
