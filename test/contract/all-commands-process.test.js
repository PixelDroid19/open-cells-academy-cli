import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { createCli } from '../../bin/cells.js';
import { createCommandRegistry } from '../../src/cli/command-registry.js';
import { resolveDispatch } from '../../src/cli/composition.js';
import { bridge3HappyDomVitestConfigSource } from '../../templates/apps/bridge3/bridge3-sources.js';
import { createFakeToolApi } from '../fixtures/task-13-composition/fake-tools.js';

const require = createRequire(import.meta.url);

async function workspace(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'open-cells-academy-composition-'));
  t.after(async () => {
    await rm(root, { recursive: true, force: true });
  });
  await writeFile(path.join(root, 'package.json'), '{"name":"composition-fixture","private":true,"type":"module"}\n');
  await mkdir(path.join(root, 'app', 'config'), { recursive: true });
  return root;
}

async function emptyDirectory(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'open-cells-academy-empty-'));
  t.after(async () => {
    await rm(root, { recursive: true, force: true });
  });
  return root;
}

function registryFor(dispatch) {
  return createCli({ dispatch, registry: createCommandRegistry() });
}

test('contract: every one of the 26 commands has exactly one real dispatch target with no NOT_IMPLEMENTED and no fallback', async () => {
  const registry = createCommandRegistry();
  const names = [...registry.keys()];
  assert.equal(names.length, 26);
  const api = createFakeToolApi();
  const { dispatch } = resolveDispatch({ api, cwd: os.tmpdir() });
  for (const name of names) {
    const definition = registry.get(name);
    assert.equal(definition.name, name);
    let outcome;
    try {
      outcome = await dispatch({ ok: true, action: 'command', command: definition, options: {}, language: 'en' });
    } catch (cause) {
      outcome = { ok: false, code: cause?.code ?? 'THROWN', messageKey: 'thrown' };
    }
    assert.ok(outcome !== null && typeof outcome === 'object', `${name} must dispatch to a use case`);
    assert.equal(outcome.code === 'NOT_IMPLEMENTED', false, `${name} must not be NOT_IMPLEMENTED`);
    assert.equal(outcome.messageKey === 'not_implemented', false, `${name} must not use the not-implemented message`);
  }
});

test('contract: app:create and component:create dispatch to real use cases and build a scaffold', async t => {
  const root = await workspace(t);
  const api = createFakeToolApi();
  const installCalls = [];
  api.packageManager = {
    async install(request, session) {
      installCalls.push(Object.freeze({ request, root: session.root }));
      return Object.freeze({ tool: 'npm', mode: request.mode, result: Object.freeze({ exitCode: 0 }) });
    }
  };
  const wrappedDispatch = await (async () => {
    const { dispatch } = resolveDispatch({ api, cwd: root });
    return async parsed => {
      try {
        return await dispatch(parsed);
      } catch (cause) {
        return { ok: false, code: cause?.code ?? 'THREW', messageKey: 'threw', cause };
      }
    };
  })();
  const cli = registryFor(wrappedDispatch);

  const appResult = await cli.run(['app:create', '--scaffold', '{"name":"my-app","scaffold":"blank"}'], { env: {} });
  assert.equal(appResult.exitCode, 0, `create failed: ${appResult.stderr}`);
  const appManifest = await readFile(path.join(root, 'my-app', 'package.json'), 'utf8');
  assert.match(appManifest, /my-app/);

  const installedApp = await cli.run(['app:create', '--installDeps', '--scaffold', '{"name":"my-installed-app","scaffold":"web-app","cellsVersion":"4"}'], { env: {} });
  assert.equal(installedApp.exitCode, 0, `app installDeps failed: ${installedApp.stderr}`);
  assert.equal(installCalls.length, 1);
  assert.equal(installCalls[0].request.mode, 'install');
  assert.equal(installCalls[0].root, path.join(root, 'my-installed-app'));

  const componentResult = await cli.run(['component:create', '--e2e', '--scaffold', '{"name":"my-button","namespace":"@academy"}'], { env: {} });
  assert.equal(componentResult.exitCode, 0);
  const componentRoot = path.join(root, 'my-button');
  const componentManifest = JSON.parse(await readFile(path.join(componentRoot, 'package.json'), 'utf8'));
  assert.equal(componentManifest.name, '@academy/my-button');
  assert.equal(componentManifest.scripts.e2e, 'playwright test');
  assert.equal(componentManifest.devDependencies['@playwright/test'], '^1.50.0');
  assert.equal(componentManifest.devDependencies['@axe-core/playwright'], '^4.10.0');
  for (const required of [
    'index.html',
    'my-button.js',
    'custom-elements.json',
    'src/MyButton.js',
    'src/my-button.scss',
    'src/my-button.css.js',
    'demo/basic.html',
    'demo/demo-build.js',
    'demo/index.html',
    'demo/demo.js',
    'test/unit/my-button.test.js',
    'test/unit/my-button-accessibility.test.js',
    'test/unit/locales/locales.json',
    'demo/locales/locales.json',
    'playwright.config.js',
    'e2e/my-button.spec.js'
  ]) {
    assert.equal(await readFile(path.join(componentRoot, required), 'utf8').then(() => true), true, `${required} was not generated`);
  }
  const e2eSpec = await readFile(path.join(componentRoot, 'e2e', 'my-button.spec.js'), 'utf8');
  assert.match(e2eSpec, /my-button/);
  assert.match(e2eSpec, /my-button-continue/);

  const installed = await cli.run(['component:create', '--install-deps', '--scaffold', '{"name":"my-panel","namespace":"@academy"}'], { env: {} });
  assert.equal(installed.exitCode, 0, `component install-deps failed: ${installed.stderr}`);
  assert.equal(installCalls.length, 2);
  assert.equal(installCalls[1].request.mode, 'install');
  assert.equal(installCalls[1].root, path.join(root, 'my-panel'));

  const defaultResult = await cli.run(['component:create', '--scaffold', '{"name":"my-banner","namespace":"@academy"}'], { env: {} });
  assert.equal(defaultResult.exitCode, 0, `component default create failed: ${defaultResult.stderr}`);
  assert.equal(installCalls.length, 2);
  const defaultManifest = JSON.parse(await readFile(path.join(root, 'my-banner', 'package.json'), 'utf8'));
  assert.equal(defaultManifest.scripts.e2e, undefined);

  const noInstallResult = await cli.run(['component:create', '--no-install-deps', '--scaffold', '{"name":"my-chip","namespace":"@academy"}'], { env: {} });
  assert.equal(noInstallResult.exitCode, 0, `component no-install-deps failed: ${noInstallResult.stderr}`);
  assert.equal(installCalls.length, 2);

  const conflict = await cli.run(['component:create', '--e2e', '--scaffold', '{"name":"my-conflict","namespace":"@academy","e2e":false}'], { env: {} });
  assert.notEqual(conflict.exitCode, 0);

  const negatedConflict = await cli.run(['component:create', '--no-e2e', '--scaffold', '{"name":"my-negated-conflict","namespace":"@academy","e2e":true}'], { env: {} });
  assert.notEqual(negatedConflict.exitCode, 0);
});

test('contract: only the generated CLI 4 Happy DOM Vitest shape skips Chromium while WTR and CLI 5 tests retain it', async t => {
  const root = await workspace(t);
  const api = createFakeToolApi();
  let browserChecks = 0;
  api.browser = {
    async chromiumAvailable() {
      browserChecks += 1;
      return false;
    }
  };
  await writeFile(path.join(root, '.open-cells-academy-recipe.json'), JSON.stringify({
    schema: 1,
    kind: 'app',
    profile: 'web-app',
    name: 'bridge3-happy-dom',
    cellsVersion: '4',
    capabilities: ['cells-config', 'routing', 'unit-browser-tests']
  }, null, 2));
  await writeFile(path.join(root, 'package.json'), JSON.stringify({
    name: 'bridge3-happy-dom',
    private: true,
    type: 'module',
    scripts: { test: 'cells app:test' },
    devDependencies: { vitest: '^3.2.4', 'happy-dom': '^20.11.2' }
  }, null, 2));
  await writeFile(path.join(root, 'vitest.config.js'), bridge3HappyDomVitestConfigSource);
  await mkdir(path.join(root, 'test', 'unit'), { recursive: true });
  await writeFile(path.join(root, 'test', 'unit', 'runtime.test.js'), 'test("runs", () => {});\n');

  const { dispatch } = resolveDispatch({ api, cwd: root });
  const cli = registryFor(dispatch);
  const happyDom = await cli.run(['app:test'], { env: {} });
  assert.equal(happyDom.exitCode, 0, happyDom.stderr);
  assert.equal(browserChecks, 0);
  assert.equal(api.testingRuns, 1);

  await writeFile(path.join(root, 'vitest.config.js'), `import { defineConfig } from '@playwright/test';

// environment: 'happy-dom'
// include: ['test/unit/**/*.test.js']
export default defineConfig({
  use: { channel: 'chromium' }
});
`);
  const playwrightSpoof = await cli.run(['app:test'], { env: {} });
  assert.equal(playwrightSpoof.exitCode, 1);
  assert.match(playwrightSpoof.stderr, /Chromium is not available/u);
  assert.equal(browserChecks, 1);
  assert.equal(api.testingRuns, 1);

  await writeFile(path.join(root, '.open-cells-academy-recipe.json'), JSON.stringify({
    schema: 1,
    kind: 'app',
    profile: 'unrecognized-compatibility-shape',
    name: 'bridge3-happy-dom',
    cellsVersion: '4',
    capabilities: ['cells-config', 'routing', 'unit-browser-tests']
  }, null, 2));
  const malformedBridge3 = await cli.run(['app:test'], { env: {} });
  assert.equal(malformedBridge3.exitCode, 1);
  assert.match(malformedBridge3.stderr, /Chromium is not available/u);
  assert.equal(browserChecks, 2);
  assert.equal(api.testingRuns, 1);

  const wtr = await cli.run(['app:test', '--wtr'], { env: {} });
  assert.equal(wtr.exitCode, 1);
  assert.match(wtr.stderr, /Chromium is not available/u);
  assert.equal(browserChecks, 3);
  assert.equal(api.testingRuns, 1);

  await writeFile(path.join(root, '.open-cells-academy-recipe.json'), JSON.stringify({
    schema: 1,
    kind: 'app',
    profile: 'web-app',
    name: 'bridge4-browser',
    cellsVersion: '5',
    capabilities: ['cells-config', 'routing', 'unit-browser-tests']
  }, null, 2));
  const bridge4 = await cli.run(['app:test'], { env: {} });
  assert.equal(bridge4.exitCode, 1);
  assert.match(bridge4.stderr, /Chromium is not available/u);
  assert.equal(browserChecks, 4);
  assert.equal(api.testingRuns, 1);
});

test('contract: lit-component:create selects the CLI 4 request contract without bypassing creation safety', async t => {
  const root = await workspace(t);
  const api = createFakeToolApi();
  const { dispatch } = resolveDispatch({ api, cwd: root });
  const cli = registryFor(dispatch);

  const selected = await cli.run(
    ['lit-component:create', '--e2e', '--scaffold', '{"name":"legacy-card","namespace":"@academy","componentBase":"lit1"}'],
    { env: {} }
  );
  assert.equal(selected.exitCode, 0, selected.stderr);
  const declaration = JSON.parse(await readFile(path.join(root, 'legacy-card', '.open-cells-academy-recipe.json'), 'utf8'));
  assert.equal(declaration.cellsVersion, '4');
  assert.equal(declaration.componentBase, 'lit1');
  assert.equal(declaration.capabilities.at(-1), 'e2e-playwright');

  const defaultBase = await cli.run(
    ['lit-component:create', '--scaffold', '{"name":"legacy-panel","namespace":"@academy"}'],
    { env: {} }
  );
  assert.equal(defaultBase.exitCode, 0, defaultBase.stderr);
  const defaultDeclaration = JSON.parse(await readFile(path.join(root, 'legacy-panel', '.open-cells-academy-recipe.json'), 'utf8'));
  assert.equal(defaultDeclaration.cellsVersion, '4');
  assert.equal(defaultDeclaration.componentBase, 'lit3');

  const explicitVersion = await cli.run(
    ['lit-component:create', '--scaffold', '{"name":"legacy-explicit","namespace":"@academy","cellsVersion":"4","componentBase":"lit1"}'],
    { env: {} }
  );
  assert.equal(explicitVersion.exitCode, 0, explicitVersion.stderr);
  const explicitDeclaration = JSON.parse(await readFile(path.join(root, 'legacy-explicit', '.open-cells-academy-recipe.json'), 'utf8'));
  assert.equal(explicitDeclaration.cellsVersion, '4');
  assert.equal(explicitDeclaration.componentBase, 'lit1');

  const duplicate = await cli.run(
    ['lit-component:create', '--scaffold', '{"name":"legacy-card","namespace":"@academy"}'],
    { env: {} }
  );
  assert.notEqual(duplicate.exitCode, 0);
});

test('contract: component:create selects an explicit CLI 4 Polymer profile without mixing the modern payload', async t => {
  const root = await workspace(t);
  const api = createFakeToolApi();
  const { dispatch } = resolveDispatch({ api, cwd: root });
  const cli = registryFor(dispatch);
  const result = await cli.run([
    'component:create',
    '--scaffold',
    '{"name":"legacy-behavior","namespace":"@academy","cellsVersion":"4","componentProfile":"behavior"}'
  ], { env: {} });
  assert.equal(result.exitCode, 0, result.stderr);
  const project = path.join(root, 'legacy-behavior');
  const declaration = JSON.parse(await readFile(path.join(project, '.open-cells-academy-recipe.json'), 'utf8'));
  const manifest = JSON.parse(await readFile(path.join(project, 'package.json'), 'utf8'));
  assert.equal(declaration.cellsVersion, '4');
  assert.equal(declaration.componentProfile, 'behavior');
  assert.equal(manifest.dependencies['@polymer/polymer'], '^3.5.0');
  assert.equal(manifest.dependencies.lit, undefined);
  assert.equal(manifest.scripts.serve, undefined);
  assert.equal(manifest.scripts.dev, 'cells component:serve');
  assert.match(await readFile(path.join(project, 'src', 'legacy-behavior.js'), 'utf8'), /Behavior/u);
});

test('contract: lit-component:create rejects every explicit non-CLI4 version before publishing inline or file scaffolds', async t => {
  const root = await workspace(t);
  const api = createFakeToolApi();
  const { dispatch } = resolveDispatch({ api, cwd: root });
  const cli = registryFor(dispatch);
  const invalidVersions = [4, 5, null, '3', '4.9', '5', '5.1', ''];

  for (const [index, cellsVersion] of invalidVersions.entries()) {
    const inlineName = `invalid-inline-${index}`;
    const inline = await cli.run(
      ['lit-component:create', '--scaffold', JSON.stringify({ name: inlineName, namespace: '@academy', cellsVersion })],
      { env: {} }
    );
    assert.notEqual(inline.exitCode, 0, `inline cellsVersion ${String(cellsVersion)} must fail`);
    await assert.rejects(
      readFile(path.join(root, inlineName, '.open-cells-academy-recipe.json'), 'utf8'),
      { code: 'ENOENT' }
    );

    const fileName = `invalid-file-${index}`;
    const scaffoldName = `invalid-file-scaffold-${index}.json`;
    await writeFile(
      path.join(root, scaffoldName),
      `${JSON.stringify({ name: fileName, namespace: '@academy', cellsVersion })}\n`
    );
    const fromFile = await cli.run(['lit-component:create', '--scaffold', scaffoldName], { env: {} });
    assert.notEqual(fromFile.exitCode, 0, `file cellsVersion ${String(cellsVersion)} must fail`);
    await assert.rejects(
      readFile(path.join(root, fileName, '.open-cells-academy-recipe.json'), 'utf8'),
      { code: 'ENOENT' }
    );
  }
});

test('contract: app:create follows the README relative scaffold path from an empty directory', async t => {
  const root = await emptyDirectory(t);
  const api = createFakeToolApi();
  const { dispatch } = resolveDispatch({ api, cwd: root });
  const cli = registryFor(dispatch);
  await writeFile(path.join(root, 'app.json'), '{"name":"readme-app","scaffold":"blank"}\n');

  const fileResult = await cli.run(['app:create', '--scaffold', 'app.json'], { env: {} });
  assert.equal(fileResult.exitCode, 0, `relative app scaffold failed: ${fileResult.stderr}`);
  assert.equal(JSON.parse(await readFile(path.join(root, 'readme-app', 'package.json'), 'utf8')).name, 'readme-app');

  const inlineResult = await cli.run(['app:create', '--scaffold', '{"name":"inline-app","scaffold":"blank"}'], { env: {} });
  assert.equal(inlineResult.exitCode, 0, `inline app scaffold failed: ${inlineResult.stderr}`);
  assert.equal(JSON.parse(await readFile(path.join(root, 'inline-app', 'package.json'), 'utf8')).name, 'inline-app');

  const duplicate = await cli.run(['app:create', '--scaffold', 'app.json'], { env: {} });
  assert.notEqual(duplicate.exitCode, 0);
  assert.equal(JSON.parse(await readFile(path.join(root, 'readme-app', 'package.json'), 'utf8')).name, 'readme-app');
});

test('contract: component:create follows the README relative scaffold path from an empty directory', async t => {
  const root = await emptyDirectory(t);
  const api = createFakeToolApi();
  const { dispatch } = resolveDispatch({ api, cwd: root });
  const cli = registryFor(dispatch);
  await writeFile(path.join(root, 'component.json'), '{"name":"readme-component","namespace":"@academy"}\n');

  const fileResult = await cli.run(['component:create', '--scaffold', 'component.json'], { env: {} });
  assert.equal(fileResult.exitCode, 0, `relative component scaffold failed: ${fileResult.stderr}`);
  assert.equal(JSON.parse(await readFile(path.join(root, 'readme-component', 'package.json'), 'utf8')).name, '@academy/readme-component');

  const inlineResult = await cli.run(['component:create', '--scaffold', '{"name":"inline-component","namespace":"@academy"}'], { env: {} });
  assert.equal(inlineResult.exitCode, 0, `inline component scaffold failed: ${inlineResult.stderr}`);
  assert.equal(JSON.parse(await readFile(path.join(root, 'inline-component', 'package.json'), 'utf8')).name, '@academy/inline-component');
});

test('contract: default project creation preserves a caller-owned tools directory while packing in an owned temporary session', async t => {
  const root = await emptyDirectory(t);
  const packageTempRoot = await mkdtemp(path.join(os.tmpdir(), 'open-cells-academy-pack-parent-'));
  t.after(async () => {
    await rm(packageTempRoot, { recursive: true, force: true });
  });
  const tools = path.join(root, 'tools');
  await mkdir(tools);
  await writeFile(path.join(tools, 'sentinel.txt'), 'caller-owned\n');

  const { packLocalCli: ignored, ...api } = createFakeToolApi();
  api.packageTempRoot = packageTempRoot;
  const calls = [];
  api.packageSelf = {
    async packSelf(destination, request) {
      calls.push(Object.freeze({ destination, sessionRoot: request.session.root }));
      const output = path.join(request.session.root, destination);
      await mkdir(output);
      const tarballPath = path.join(output, 'open-cells-academy-cli-0.1.0.tgz');
      await writeFile(tarballPath, 'owned-cli');
      return Object.freeze({ tarballPath, integrity: 'sha512-Zml4dHVyZQ==' });
    }
  };

  const { dispatch } = resolveDispatch({ api, cwd: root });
  const cli = registryFor(dispatch);
  const result = await cli.run(['app:create', '--scaffold', '{"name":"preserved-tools-app","scaffold":"blank"}'], { env: {} });

  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(await readFile(path.join(tools, 'sentinel.txt'), 'utf8'), 'caller-owned\n');
  assert.equal(calls.length, 1);
  assert.notEqual(calls[0].sessionRoot, root);
  assert.equal(calls[0].destination, 'archive');
  assert.deepEqual(await readdir(packageTempRoot), []);
});

test('contract: only creation commands accept an empty directory without package metadata', async t => {
  const root = await emptyDirectory(t);
  const api = createFakeToolApi();
  const { dispatch } = resolveDispatch({ api, cwd: root });
  const registry = createCommandRegistry();

  for (const command of registry.values()) {
    if (command.requiresWorkspace !== true) {
      continue;
    }
    const outcome = await dispatch({ ok: true, action: 'command', command, options: {}, language: 'en' });
    assert.equal(outcome.ok, false, `${command.name} must require package metadata`);
    assert.equal(outcome.code, 'WORKSPACE_PACKAGE_MISSING', `${command.name} must retain package metadata validation`);
  }
});

test('contract: app:install and component:install dispatch to the package manager with public registry isolation', async t => {
  const root = await workspace(t);
  await writeFile(path.join(root, 'package.json'), '{"name":"x","private":true,"dependencies":{"academy-dep":"1.0.0"}}\n');
  const api = createFakeToolApi();
  const wrappedDispatch = await (async () => {
    const { dispatch } = resolveDispatch({ api, cwd: root });
    return async parsed => {
      try {
        return await dispatch(parsed);
      } catch (cause) {
        return { ok: false, code: cause?.code ?? 'THREW', messageKey: 'threw', cause };
      }
    };
  })();
  const cli = registryFor(wrappedDispatch);

  const appInstall = await cli.run(['app:install'], { env: {} });
  assert.equal(appInstall.exitCode, 0, `app install stderr: ${appInstall.stderr}`);
  assert.equal(api.installCalls.length, 1);
  assert.equal(api.installCalls[0].mode, 'install');

  const componentInstall = await cli.run(['component:install'], { env: {} });
  assert.equal(componentInstall.exitCode, 0);
  assert.equal(api.installCalls.length, 2);
});

test('contract: app:locales and component:locales dispatch to the locale generators', async t => {
  const root = await workspace(t);
  await mkdir(path.join(root, 'app'), { recursive: true });
  await writeFile(path.join(root, 'app', 'index.html'), '<html lang="en"><head><title>##app.title##</title></head></html>\n');
  await writeFile(path.join(root, 'app', 'config', 'prod.js'), 'export default { app: { title: "T" }, locales: { enabledI18n: false } };\n');
  const api = createFakeToolApi();
  const { dispatch } = resolveDispatch({ api, cwd: root });
  const cli = registryFor(dispatch);

  const appLocales = await cli.run(['app:locales', '--config', 'prod.js'], { env: {} });
  assert.equal(appLocales.exitCode, 0, `locales stderr: ${appLocales.stderr}`);

  const componentLocales = await cli.run(['component:locales'], { env: {} });
  assert.equal(componentLocales.exitCode, 0);
});

test('contract: app:changelog and component:changelog dispatch to the changelog generator', async t => {
  const root = await workspace(t);
  const api = createFakeToolApi({ changelog: { preset: 'angular', name: 'CHANGELOG.md' } });
  const { dispatch } = resolveDispatch({ api, cwd: root });
  const cli = registryFor(dispatch);

  const appChangelog = await cli.run(['app:changelog'], { env: {} });
  assert.equal(appChangelog.exitCode, 0);
  const appFile = await readFile(path.join(root, 'CHANGELOG.md'), 'utf8');
  assert.match(appFile, /Changelog|Features|commits/i);
});

test('contract: app:lint and component:lint dispatch to the lint use cases', async t => {
  const root = await workspace(t);
  await mkdir(path.join(root, 'src'), { recursive: true });
  await writeFile(path.join(root, 'src', 'a.js'), 'const x = 1;\n');
  const api = createFakeToolApi({ eslint: { clean: true } });
  const { dispatch } = resolveDispatch({ api, cwd: root });
  const cli = registryFor(dispatch);

  const componentLint = await cli.run(['component:lint'], { env: {} });
  assert.equal(componentLint.exitCode, 0);
  assert.equal(api.eslintRuns, 1);
});

test('contract: component:documentation dispatches to the docs use case and writes a manifest', async t => {
  const root = await workspace(t);
  await mkdir(path.join(root, 'src'), { recursive: true });
  await writeFile(path.join(root, 'src', 'a.js'), 'export class A {}\n');
  const api = createFakeToolApi({ cem: { manifest: { schemaVersion: '1.0.0', modules: [] } } });
  const { dispatch } = resolveDispatch({ api, cwd: root });
  const cli = registryFor(dispatch);

  const docs = await cli.run(['component:documentation', '--noMd'], { env: {} });
  assert.equal(docs.exitCode, 0);
  const manifest = JSON.parse(await readFile(path.join(root, 'custom-elements.json'), 'utf8'));
  assert.equal(manifest.schemaVersion, '1.0.0');
});

test('contract: component:sass dispatches to the sass compiler', async t => {
  const root = await workspace(t);
  await mkdir(path.join(root, 'src'), { recursive: true });
  await writeFile(path.join(root, 'src', 'theme.scss'), '.theme { color: red; }\n');
  const api = createFakeToolApi({ sass: { css: '.compiled-theme{}' } });
  const { dispatch } = resolveDispatch({ api, cwd: root });
  const cli = registryFor(dispatch);

  const sass = await cli.run(['component:sass'], { env: {} });
  assert.equal(sass.exitCode, 0);
  const output = await readFile(path.join(root, 'src', 'theme.css.js'), 'utf8');
  assert.match(output, /css`/);
});

test('contract: app:test and component:test dispatch to the testing use case', async t => {
  const root = await workspace(t);
  await mkdir(path.join(root, 'test'), { recursive: true });
  await writeFile(path.join(root, 'test', 'a.test.js'), 'it("passes", () => {});\n');
  const api = createFakeToolApi({ testing: { exitCode: 0 } });
  const { dispatch } = resolveDispatch({ api, cwd: root });
  const cli = registryFor(dispatch);

  const appTest = await cli.run(['app:test'], { env: {} });
  assert.equal(appTest.exitCode, 0);
  const componentTest = await cli.run(['component:test'], { env: {} });
  assert.equal(componentTest.exitCode, 0);
  assert.equal(api.testingRuns, 2);
});

test('contract: app:test and component:test forward --coverage to the Vitest runner', async t => {
  const root = await workspace(t);
  await mkdir(path.join(root, 'test'), { recursive: true });
  await writeFile(path.join(root, 'test', 'a.test.js'), 'it("passes", () => {});\n');
  const api = createFakeToolApi({ testing: { exitCode: 0 } });
  const requests = [];
  const runProcess = api.testing.runProcess.bind(api.testing);
  api.testing.runProcess = async request => {
    requests.push(request);
    return runProcess(request);
  };
  const { dispatch } = resolveDispatch({ api, cwd: root });
  const cli = registryFor(dispatch);

  for (const command of ['app:test', 'component:test']) {
    const result = await cli.run([command, '--coverage'], { env: {} });
    assert.equal(result.exitCode, 0, result.stderr);
  }

  assert.deepEqual(requests.map(request => request.args), [
    ['run', 'test/a.test.js', '--coverage'],
    ['run', 'test/a.test.js', '--coverage']
  ]);
});

test('contract: app:test detects a declared WTR project while explicit --no-wtr keeps Vitest', async t => {
  const root = await workspace(t);
  await writeFile(path.join(root, 'package.json'), JSON.stringify({
    name: 'composition-fixture',
    private: true,
    type: 'module',
    scripts: { test: 'cells app:test --wtr' }
  }));
  await mkdir(path.join(root, 'test', 'unit'), { recursive: true });
  await writeFile(path.join(root, 'test', 'unit', 'a.test.js'), 'it("passes", () => {});\n');
  await mkdir(path.join(root, 'node_modules', '@web', 'test-runner-playwright'), { recursive: true });
  await writeFile(path.join(root, 'node_modules', '@web', 'test-runner-playwright', 'package.json'), '{"name":"@web/test-runner-playwright","version":"0.0.0","type":"module","main":"index.mjs"}\n');
  await writeFile(path.join(root, 'node_modules', '@web', 'test-runner-playwright', 'index.mjs'), 'export function playwrightLauncher() {}\n');
  const api = createFakeToolApi({ testing: { exitCode: 0 } });
  const requests = [];
  const runProcess = api.testing.runProcess.bind(api.testing);
  api.testing.runProcess = async request => {
    requests.push(request);
    return runProcess(request);
  };
  const { dispatch } = resolveDispatch({ api, cwd: root });
  const cli = registryFor(dispatch);

  assert.equal((await cli.run(['app:test'], { env: {} })).exitCode, 0);
  assert.equal((await cli.run(['app:test', '--no-wtr'], { env: {} })).exitCode, 0);

  assert.equal(requests[0].args.includes('--config'), true);
  assert.equal(requests[1].args[0], 'run');
});

test('contract: component:test --wtr dispatches through the component compatibility runner', async t => {
  const root = await workspace(t);
  await mkdir(path.join(root, 'test', 'unit'), { recursive: true });
  await writeFile(path.join(root, 'test', 'unit', 'a.test.js'), 'it("passes", () => {});\n');
  await mkdir(path.join(root, 'node_modules', '@web', 'test-runner-playwright'), { recursive: true });
  await writeFile(path.join(root, 'node_modules', '@web', 'test-runner-playwright', 'package.json'), '{"name":"@web/test-runner-playwright","version":"0.0.0","type":"module","main":"index.mjs"}\n');
  await writeFile(path.join(root, 'node_modules', '@web', 'test-runner-playwright', 'index.mjs'), 'export function playwrightLauncher() {}\n');
  const api = createFakeToolApi({ testing: { exitCode: 0 } });
  const requests = [];
  const runProcess = api.testing.runProcess.bind(api.testing);
  api.testing.runProcess = async request => {
    requests.push(request);
    return runProcess(request);
  };
  const { dispatch } = resolveDispatch({ api, cwd: root });
  const cli = registryFor(dispatch);

  const result = await cli.run(['component:test', '--wtr'], { env: {} });

  assert.equal(result.exitCode, 0, result.stderr);
  assert.equal(api.testingRuns, 1);
  assert.equal(requests[0].args.includes('--config'), true);
});

test('contract: component:test --updateLocales regenerates locale artifacts before testing', async t => {
  const root = await workspace(t);
  await mkdir(path.join(root, 'test'), { recursive: true });
  await writeFile(path.join(root, 'test', 'a.test.js'), 'it("passes", () => {});\n');
  await mkdir(path.join(root, 'locales'), { recursive: true });
  await writeFile(path.join(root, 'locales', 'locales.json'), JSON.stringify({ en: { hello: 'Hello' } }));
  const api = createFakeToolApi({ testing: { exitCode: 0 } });
  const { dispatch } = resolveDispatch({ api, cwd: root });
  const cli = registryFor(dispatch);

  const componentTest = await cli.run(['component:test', '--updateLocales'], { env: {} });
  assert.equal(componentTest.exitCode, 0, `stderr: ${componentTest.stderr}`);
  const demoLocales = JSON.parse(await readFile(path.join(root, 'demo', 'locales', 'locales.json'), 'utf8'));
  const testLocales = JSON.parse(await readFile(path.join(root, 'test', 'unit', 'locales', 'locales.json'), 'utf8'));
  assert.deepEqual(demoLocales, testLocales);
  assert.equal(JSON.stringify(demoLocales).includes('Hello'), true);
});

test('contract: app:locales --config honors the Cells locales configuration', async t => {
  const root = await workspace(t);
  await mkdir(path.join(root, 'app'), { recursive: true });
  await writeFile(path.join(root, 'app', 'index.html'), '<html lang="en"><head><title>##app.title##</title></head></html>\n');
  await writeFile(
    path.join(root, 'app', 'config', 'dev.js'),
    'export default { app: { title: "T" }, locales: { enabledI18n: true, languages: ["en"] } };\n'
  );
  await mkdir(path.join(root, 'app', 'locales'), { recursive: true });
  await writeFile(path.join(root, 'app', 'locales', 'locales.json'), JSON.stringify({ en: { hello: 'Hello' } }));
  const api = createFakeToolApi();
  const { dispatch } = resolveDispatch({ api, cwd: root });
  const cli = registryFor(dispatch);

  const appLocales = await cli.run(['app:locales', '--config', 'dev.js'], { env: {} });
  assert.equal(appLocales.exitCode, 0, `stderr: ${appLocales.stderr}`);
  const generated = JSON.parse(await readFile(path.join(root, 'dist', 'locales', 'en.json'), 'utf8'));
  assert.equal(JSON.stringify(generated).includes('Hello'), true);
});

test('contract: app:locales supports established locales-app sources and intlInputFileNames', async t => {
  const root = await workspace(t);
  await mkdir(path.join(root, 'app'), { recursive: true });
  await writeFile(path.join(root, 'app', 'index.html'), '<main></main>\n');
  await writeFile(
    path.join(root, 'app', 'config', 'market.js'),
    'export default { locales: { enabledI18n: true, forTesting: true, languages: ["en", "en-US", "es"], intlInputFileNames: ["locales"], intlFileName: "locales" } };\n'
  );
  await mkdir(path.join(root, 'app', 'locales-app'), { recursive: true });
  await writeFile(path.join(root, 'app', 'locales-app', 'en.json'), '{"hello":"Hello","shared":"application"}\n');
  await writeFile(path.join(root, 'app', 'locales-app', 'es.json'), '{"hello":"Hola"}\n');
  await mkdir(path.join(root, 'components', 'card', 'locales'), { recursive: true });
  await writeFile(path.join(root, 'components', 'card', 'locales', 'en.json'), '{"componentOnly":"Card","shared":"component"}\n');
  await mkdir(path.join(root, 'dist', 'locales'), { recursive: true });
  await writeFile(path.join(root, 'dist', 'locales', 'stale.json'), '{"stale":true}\n');
  const api = createFakeToolApi();
  const { dispatch } = resolveDispatch({ api, cwd: root });
  const cli = registryFor(dispatch);

  const result = await cli.run(['app:locales', '--config', 'market.js'], { env: {} });

  assert.equal(result.exitCode, 0, result.stderr);
  await assert.rejects(readFile(path.join(root, 'dist', 'locales', 'stale.json')), error => error?.code === 'ENOENT');
  assert.deepEqual(JSON.parse(await readFile(path.join(root, 'dist', 'locales', 'en-US.json'), 'utf8')), {
    componentOnly: 'Card',
    hello: 'Hello',
    shared: 'application'
  });
  assert.deepEqual(JSON.parse(await readFile(path.join(root, 'dist', 'locales', 'locales.json'), 'utf8')), {
    en: { componentOnly: 'Card', hello: 'Hello', shared: 'application' },
    'en-US': { componentOnly: 'Card', hello: 'Hello', shared: 'application' },
    es: { hello: 'Hola' }
  });
  assert.deepEqual(
    JSON.parse(await readFile(path.join(root, 'test', 'unit', 'market', 'locales', 'en.json'), 'utf8')),
    { componentOnly: 'Card', hello: 'Hello', shared: 'application' }
  );

  await writeFile(
    path.join(root, 'app', 'config', 'market.js'),
    'export default { locales: { enabledI18n: true, forTesting: false, languages: ["en"], intlInputFileNames: ["locales"] } };\n'
  );
  const withoutTesting = await cli.run(['app:locales', '--config', 'market.js'], { env: {} });
  assert.equal(withoutTesting.exitCode, 0, withoutTesting.stderr);
  assert.deepEqual(await readdir(path.join(root, 'test', 'unit', 'market', 'locales')), []);
});

test('contract: app:locales atomically removes stale catalogs when the selected profile disables i18n', async t => {
  const root = await workspace(t);
  await mkdir(path.join(root, 'app'), { recursive: true });
  await writeFile(path.join(root, 'app', 'index.html'), '<main></main>\n');
  await writeFile(path.join(root, 'app', 'config', 'disabled.js'), 'export default { locales: { enabledI18n: false } };\n');
  await mkdir(path.join(root, 'dist', 'locales'), { recursive: true });
  await writeFile(path.join(root, 'dist', 'locales', 'stale.json'), '{"stale":true}\n');
  const api = createFakeToolApi();
  const { dispatch } = resolveDispatch({ api, cwd: root });
  const cli = registryFor(dispatch);

  const result = await cli.run(['app:locales', '--config', 'disabled.js'], { env: {} });

  assert.equal(result.exitCode, 0, result.stderr);
  assert.deepEqual(await readdir(path.join(root, 'dist', 'locales')), []);
});

test('contract: app:locales publishes configured page bundles through the CLI', async t => {
  const root = await workspace(t);
  await mkdir(path.join(root, 'app'), { recursive: true });
  await writeFile(path.join(root, 'app', 'index.html'), '<main></main>\n');
  await writeFile(
    path.join(root, 'app', 'config', 'bundle.js'),
    `export default { locales: {
      enabledI18n: true,
      useBundles: true,
      languages: ['en'],
      intlFileName: 'locales',
      initialBundle: ['home'],
      pageEntries: { home: 'home-page', about: 'about-page' },
      pageModules: {
        'home-page': { imports: [], localeFiles: ['app/pages/home-page/locales/locales.json'] },
        'about-page': { imports: [], localeFiles: ['app/pages/about-page/locales/locales.json'] }
      }
    } };\n`
  );
  await mkdir(path.join(root, 'app', 'locales-app'), { recursive: true });
  await writeFile(path.join(root, 'app', 'locales-app', 'locales.json'), '{"en":{"application":"root"}}\n');
  await mkdir(path.join(root, 'app', 'pages', 'home-page', 'locales'), { recursive: true });
  await writeFile(path.join(root, 'app', 'pages', 'home-page', 'locales', 'locales.json'), '{"en":{"home":"Home"}}\n');
  await mkdir(path.join(root, 'app', 'pages', 'about-page', 'locales'), { recursive: true });
  await writeFile(path.join(root, 'app', 'pages', 'about-page', 'locales', 'locales.json'), '{"en":{"about":"About"}}\n');
  const api = createFakeToolApi();
  const { dispatch } = resolveDispatch({ api, cwd: root });

  const result = await registryFor(dispatch).run(['app:locales', '--config', 'bundle.js'], { env: {} });

  assert.equal(result.exitCode, 0, result.stderr);
  assert.deepEqual(JSON.parse(await readFile(path.join(root, 'dist', 'locales', 'locales.json'), 'utf8')), {
    en: { application: 'root', home: 'Home' }
  });
  assert.deepEqual(JSON.parse(await readFile(path.join(root, 'dist', 'pages', 'about-page', 'locales', 'locales.json'), 'utf8')), {
    en: { about: 'About' }
  });

  await writeFile(
    path.join(root, 'app', 'config', 'bundle.js'),
    `export default { locales: {
      enabledI18n: true,
      useBundles: true,
      languages: ['en'],
      intlFileName: 'locales',
      initialBundle: ['home'],
      pageEntries: { home: 'home-page' },
      pageModules: {
        'home-page': { imports: [], localeFiles: ['app/pages/home-page/locales/locales.json'] }
      }
    } };\n`
  );
  const updated = await registryFor(dispatch).run(['app:locales', '--config', 'bundle.js'], { env: {} });

  assert.equal(updated.exitCode, 0, updated.stderr);
  assert.deepEqual(await readdir(path.join(root, 'dist', 'pages', 'about-page', 'locales')), []);
});

test('contract: dev/build/preview/component:dev/component:build:demo dispatch to the toolchains (tools present)', async t => {
  const root = await workspace(t);
  await mkdir(path.join(root, 'app'), { recursive: true });
  await writeFile(path.join(root, 'app', 'index.html'), '<html lang="##app.lang##"><head><title>##app.title##</title><meta name="description" content="##app.description##"></head><body><header>##app.header##</header><main data-name="##app.name##">##app.version## ##env.mode##</main></body></html>\n');
  await writeFile(path.join(root, 'app', 'config', 'dev.js'), 'export default { app: { title: "T", lang: "en", description: "d", header: "h", name: "n", version: "1" } };\n');
  await mkdir(path.join(root, 'demo'), { recursive: true });
  await writeFile(path.join(root, 'demo', 'index.html'), '<html><body>demo</body></html>\n');
  await writeFile(path.join(root, 'demo', 'demo.js'), "console.log('demo');\n");
  const api = createFakeToolApi({ vite: { present: true }, workbox: { present: true } });
  const { dispatch } = resolveDispatch({ api, cwd: root });
  const cli = registryFor(dispatch);

  const appBuild = await cli.run(['app:build', '--config', 'dev.js'], { env: {} });
  assert.equal(appBuild.exitCode, 0);
  assert.equal(api.viteBuildCalls, 1);

  const demo = await cli.run(['component:build:demo'], { env: {} });
  assert.equal(demo.exitCode, 0);
  assert.equal(api.viteBuildCalls, 2);
});

test('contract: component:serve and lit-component:serve dispatch to the component dev adapter', async t => {
  const root = await workspace(t);
  await mkdir(path.join(root, 'demo'), { recursive: true });
  await writeFile(path.join(root, 'demo', 'index.html'), '<html><body>legacy demo</body></html>\n');
  const api = createFakeToolApi({ vite: { present: true } });
  const { dispatch } = resolveDispatch({ api, cwd: root });
  const cli = registryFor(dispatch);

  const componentServe = await cli.run(['component:serve', '--host', '127.0.0.1', '--port', '41098', '--no-open'], { env: {} });
  const litServe = await cli.run(['lit-component:serve', '--host', '127.0.0.1', '--port', '41099', '--no-open'], { env: {} });

  assert.equal(componentServe.exitCode, 0, `stderr: ${componentServe.stderr}`);
  assert.equal(litServe.exitCode, 0, `stderr: ${litServe.stderr}`);
  assert.equal(api.viteDevCalls, 2);
});

test('contract: lit-component test, lint, locales, and documentation commands reuse their component handlers', async t => {
  const root = await workspace(t);
  await mkdir(path.join(root, 'src'), { recursive: true });
  await mkdir(path.join(root, 'test'), { recursive: true });
  await mkdir(path.join(root, 'locales'), { recursive: true });
  await writeFile(path.join(root, 'src', 'academy-card.js'), 'export class AcademyCard {}\n');
  await writeFile(path.join(root, 'test', 'academy-card.test.js'), 'it("passes", () => {});\n');
  await writeFile(path.join(root, 'locales', 'locales.json'), '{"en":{"title":"Card"}}\n');
  const api = createFakeToolApi({ testing: { exitCode: 0 } });
  const { dispatch } = resolveDispatch({ api, cwd: root });
  const cli = registryFor(dispatch);

  const testing = await cli.run(['lit-component:test'], { env: {} });
  const lint = await cli.run(['lit-component:lint'], { env: {} });
  const locales = await cli.run(['lit-component:locales'], { env: {} });
  const documentation = await cli.run(['lit-component:documentation', '--noMd'], { env: {} });

  for (const result of [testing, lint, locales, documentation]) {
    assert.equal(result.exitCode, 0, result.stderr);
  }
  assert.equal(api.testingRuns, 1);
  assert.equal(api.eslintRuns, 1);
  assert.deepEqual(
    JSON.parse(await readFile(path.join(root, 'demo', 'locales', 'locales.json'), 'utf8')),
    { en: { title: 'Card' } }
  );
  assert.equal(JSON.parse(await readFile(path.join(root, 'custom-elements.json'), 'utf8')).schemaVersion, '1.0.0');
});

test('contract: every command reports a typed, sanitized error in both languages and never returns exit 0 on failure', async () => {
  const api = createFakeToolApi({ errorMode: true });
  const { dispatch } = resolveDispatch({ api, cwd: os.tmpdir() });
  const cli = registryFor(dispatch);
  const registry = createCommandRegistry();

  for (const name of registry.keys()) {
    const result = await cli.run([name], { env: {} });
    assert.notEqual(result.exitCode, 0, `${name} must not exit 0 on error`);
    assert.equal(result.stderr.length > 0, true, `${name} must emit an error to stderr`);
    assert.doesNotMatch(result.stderr, /secret|token|password/i);
  }
});
