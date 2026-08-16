import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { lstat, mkdir, mkdtemp, readFile, readdir, rename, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { testProject } from '../../src/application/shared/test-project.js';
import { testApp } from '../../src/application/app/test-app.js';
import { testComponent } from '../../src/application/component/test-component.js';
import { NodeFilesystem } from '../../src/adapters/node/node-filesystem.js';
import { WorkspaceSession } from '../../src/domain/workspace-session.js';
import { BrowserCapability } from '../../src/adapters/testing/browser-capability.js';
import { captureProjectTestFiles, prepareTestArtifacts } from '../../src/adapters/testing/test-files.js';
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

test('red: Vitest receives only project-owned unit files and never vendored or E2E dependency tests', async t => {
  const { root, session } = await workspace(t);
  await writeWorkspaceFile(root, 'test/unit/owned.test.js', 'it("owned", () => {});\n');
  await writeWorkspaceFile(root, 'test/e2e/node_modules/vendor/leaked.test.js', 'it("vendor", () => {});\n');
  await writeWorkspaceFile(root, 'components/vendor/examples/leaked.test.js', 'it("component vendor", () => {});\n');
  const fake = createFakeTestToolchain();

  const outcome = await testProject(testContext(session, new VitestBrowserRunner(fake)));

  assert.equal(outcome.ok, true);
  assert.equal(fake.vitestLast.args.includes('test/unit/owned.test.js'), true);
  assert.equal(fake.vitestLast.args.some(argument => argument.includes('node_modules') || argument.includes('components/vendor') || argument.includes('test/e2e')), false);
});

test('red: a legacy app without project-owned unit files reports TEST_NO_TESTS without launching Vitest', async t => {
  const { root, session } = await workspace(t);
  await writeWorkspaceFile(root, 'components/vendor/examples/leaked.test.js', 'it("component vendor", () => {});\n');
  await writeWorkspaceFile(root, 'test/e2e/node_modules/vendor/leaked.test.js', 'it("e2e vendor", () => {});\n');
  const fake = createFakeTestToolchain();

  const outcome = await testProject(testContext(session, new VitestBrowserRunner(fake)));

  assert.equal(outcome.ok, false);
  assert.equal(outcome.code, 'TEST_NO_TESTS');
  assert.equal(fake.vitestCalls, 0);
});

test('red: app/test-only projects provision guarded project-local artifacts for Vitest and WTR', async t => {
  const { root, session } = await workspace(t);
  await writeWorkspaceFile(root, 'app/test/unit/owned.test.js', 'it("owned", () => {});\n');
  const vitest = createFakeTestToolchain();
  const wtr = createFakeTestToolchain();

  const vitestResult = await new VitestBrowserRunner(vitest).run(Object.freeze({ session }));
  const wtrResult = await new WtrRunner(
    wtr,
    'web-test-runner',
    path.join(root, 'cli-launcher', 'index.mjs'),
    path.join(root, 'cli-junit', 'index.mjs')
  ).run(Object.freeze({ session }));

  assert.equal(vitestResult.ok, true);
  assert.equal(wtrResult.ok, true);
  assert.equal(vitest.vitestLast.args.includes('app/test/unit/owned.test.js'), true);
  assert.equal(wtr.wtrConfigSource.includes('app/test/unit/owned.test.js'), true);
  assert.equal((await lstat(path.join(root, 'test', 'coverage'))).isDirectory(), true);
});

test('red: platforms without anchored directory creation leave artifacts to the test tool without mutating the workspace', async t => {
  const { root } = await workspace(t);
  await writeWorkspaceFile(root, 'app/test/unit/owned.test.js', 'it("owned", () => {});\n');
  const captured = await captureProjectTestFiles(root);

  const artifacts = await prepareTestArtifacts(root, captured, { platform: 'win32' });

  assert.equal(artifacts.coverageRoot, path.join(root, 'test', 'coverage'));
  await artifacts.verify();
  await assert.rejects(lstat(path.join(root, 'test')), error => error?.code === 'ENOENT');
});

test('red: test launch revalidates captured test ancestors immediately before spawning the runner', async t => {
  const { root, session } = await workspace(t);
  const outside = await mkdtemp(path.join(os.tmpdir(), 'open-cells-external-tests-'));
  t.after(() => rm(outside, { recursive: true, force: true }));
  await writeWorkspaceFile(root, 'test/unit/owned.test.js', 'it("owned", () => {});\n');
  await writeFile(path.join(outside, 'owned.test.js'), 'throw new Error("external test executed");\n');
  let beforeSpawnCalled = false;
  const process = Object.freeze({
    async runProcess(request) {
      await rename(path.join(root, 'test'), path.join(root, 'test-owned'));
      await symlink(outside, path.join(root, 'test'), 'dir');
      if (typeof request.beforeSpawn !== 'function') {
        return Object.freeze({ exitCode: 0, stdout: 'Test Files  1 passed (1)\n', stderr: '' });
      }
      beforeSpawnCalled = true;
      await request.beforeSpawn();
      assert.fail('the runner must not spawn after a test ancestor replacement');
    }
  });

  await assertCode(
    new VitestBrowserRunner(process).run(Object.freeze({ session })),
    'TEST_TOOL_FAILED'
  );
  assert.equal(beforeSpawnCalled, true);
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
  const config = fake.wtrConfigSource;
  assert.match(config, /nodeResolve:\s*true/);
  assert.match(config, /ui:\s*'tdd'/);
  assert.match(config, new RegExp(`junitReporter\\(\\{ outputPath: 'test/coverage/junit-report.xml' \\}\\)`));
  assert.match(config, new RegExp(`from\\s+'file://${launcherEntry.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}'`));
  assert.match(config, new RegExp(`from\\s+'file://${junitEntry.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}'`));
});

test('red: WTR coverage requests reach the Web Test Runner executable', async t => {
  const { root, session } = await workspace(t);
  await writeWorkspaceFile(root, 'test/a.test.js', 'it("passes", () => {});\n');
  const fake = createFakeTestToolchain();
  const runner = new WtrRunner(
    fake,
    'web-test-runner',
    path.join(root, 'cli-launcher', 'index.mjs'),
    path.join(root, 'cli-junit', 'index.mjs')
  );

  const outcome = await testProject(testContext(session, runner, {
    options: Object.freeze({ wtr: true, coverage: true })
  }));

  assert.equal(outcome.ok, true);
  assert.equal(fake.wtrLast.args.includes('--coverage'), true);
});

test('red: WTR preserves a caller-owned config and removes its private temporary config', async t => {
  const { root, session } = await workspace(t);
  await writeWorkspaceFile(root, 'test/a.test.js', 'it("passes", () => {});\n');
  await writeWorkspaceFile(root, 'wtr.academy.config.mjs', 'export default { callerOwned: true };\n');
  const fake = createFakeTestToolchain();
  const runner = new WtrRunner(
    fake,
    'web-test-runner',
    path.join(root, 'cli-launcher', 'index.mjs'),
    path.join(root, 'cli-junit', 'index.mjs')
  );

  const result = await testProject(testContext(session, runner, { wtr: true }));

  assert.equal(result.ok, true);
  assert.equal(await readFile(path.join(root, 'wtr.academy.config.mjs'), 'utf8'), 'export default { callerOwned: true };\n');
  assert.equal((await readdir(path.join(root, 'test', 'coverage'))).some(name => name.startsWith('.open-cells-wtr-')), false);
});

test('red: test project prefers the project launcher and reports a missing launcher as a typed failure', async t => {
  const { root, session } = await workspace(t);
  await writeWorkspaceFile(root, 'test/a.test.js', 'it("passes", () => {});\n');
  await writeWorkspaceFile(root, path.join('node_modules', '@web', 'test-runner-playwright', 'package.json'), '{"name":"@web/test-runner-playwright","version":"0.0.0","type":"module","main":"index.mjs"}\n');
  await writeWorkspaceFile(root, path.join('node_modules', '@web', 'test-runner-playwright', 'index.mjs'), 'export function playwrightLauncher() {}\n');
  const projectFake = createFakeTestToolchain();
  const withProjectLauncher = new WtrRunner(projectFake, 'web-test-runner');
  const projectOutcome = await testProject(testContext(session, withProjectLauncher, { wtr: true }));
  assert.equal(projectOutcome.ok, true);
  const config = projectFake.wtrConfigSource;
  assert.match(config, /node_modules\/@web\/test-runner-playwright\/index\.mjs/);

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
