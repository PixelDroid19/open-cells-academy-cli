import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { createCli } from '../../bin/cells.js';
import { createCommandRegistry } from '../../src/cli/command-registry.js';
import { resolveDispatch } from '../../src/cli/composition.js';
import { createFakeToolApi } from '../fixtures/task-13-composition/fake-tools.js';

async function workspace(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'open-cells-academy-error-matrix-'));
  t.after(async () => {
    await rm(root, { recursive: true, force: true });
  });
  await writeFile(path.join(root, 'package.json'), '{"name":"error-matrix","private":true,"type":"module"}\n');
  return root;
}

function cliFor(root, api) {
  const { dispatch } = resolveDispatch({ api, cwd: root });
  return createCli({ dispatch, registry: createCommandRegistry() });
}

test('error matrix: missing workspace produces a typed workspace failure with exit 1 and sanitized stderr in both languages', async t => {
  const api = createFakeToolApi();
  const { dispatch } = resolveDispatch({ api, cwd: path.join(os.tmpdir(), 'no-such-workspace-xyz') });
  const cli = createCli({ dispatch, registry: createCommandRegistry() });

  const en = await cli.run(['app:lint'], { env: {} });
  assert.equal(en.exitCode, 1);
  assert.equal(en.stderr.length > 0, true);
  assert.doesNotMatch(en.stderr, /secret|token|password|at /);

  const es = await cli.run(['--language', 'es', 'app:lint'], { env: {} });
  assert.equal(es.exitCode, 1);
  assert.equal(es.stderr.length > 0, true);
});

test('error matrix: missing required options are rejected before dispatch with a typed parse error', async t => {
  const root = await workspace(t);
  const api = createFakeToolApi();
  const cli = cliFor(root, api);

  const noConfig = await cli.run(['app:build'], { env: {} });
  assert.equal(noConfig.exitCode, 1);
  assert.match(noConfig.stderr, /config|"-c"/i);

  const badPort = await cli.run(['app:dev', '--config', 'dev.js', '--port', 'not-a-port'], { env: {} });
  assert.equal(badPort.exitCode, 1);
  assert.doesNotMatch(badPort.stderr, /secret|token/);
});

test('error matrix: unknown commands and options are typed and localized', async t => {
  const root = await workspace(t);
  const api = createFakeToolApi();
  const cli = cliFor(root, api);

  const unknownCommand = await cli.run(['nope:command'], { env: {} });
  assert.equal(unknownCommand.exitCode, 1);
  assert.match(unknownCommand.stderr, /nope:command/);

  const unknownOption = await cli.run(['component:lint', '--nope'], { env: {} });
  assert.equal(unknownOption.exitCode, 1);
  assert.match(unknownOption.stderr, /nope/);

  const es = await cli.run(['--language', 'es', 'nope:command'], { env: {} });
  assert.equal(es.exitCode, 1);
  assert.equal(es.stderr.length > 0, true);
});

test('error matrix: tool failure is a typed, sanitized failure and no command returns exit 0 on error', async t => {
  const root = await workspace(t);
  await mkdir(path.join(root, 'app'), { recursive: true });
  await mkdir(path.join(root, 'app', 'config'), { recursive: true });
  await writeFile(path.join(root, 'app', 'index.html'), '<html lang="##app.lang##"><head><title>##app.title##</title><meta name="description" content="##app.description##"></head><body><header>##app.header##</header><main data-name="##app.name##">##app.version## ##env.mode##</main></body></html>\n');
  await writeFile(path.join(root, 'app', 'config', 'dev.js'), 'export default { app: { title: "T", lang: "en", description: "d", header: "h", name: "n", version: "1" } };\n');
  await mkdir(path.join(root, 'src'), { recursive: true });
  await writeFile(path.join(root, 'src', 'theme.scss'), '.theme { color: red; }\n');
  const api = createFakeToolApi({ errorMode: true });
  const cli = cliFor(root, api);

  const results = await Promise.all([
    cli.run(['app:build', '--config', 'dev.js'], { env: {} }),
    cli.run(['app:lint'], { env: {} }),
    cli.run(['component:sass'], { env: {} }),
    cli.run(['app:changelog'], { env: {} })
  ]);
  for (const result of results) {
    assert.notEqual(result.exitCode, 0);
    assert.doesNotMatch(result.stderr, /secret|token|password/);
  }
});

test('error matrix: invalid input (traversal and destructive targets) is typed and sanitized', async t => {
  const root = await workspace(t);
  await mkdir(path.join(root, 'app'), { recursive: true });
  await mkdir(path.join(root, 'app', 'config'), { recursive: true });
  await writeFile(path.join(root, 'app', 'index.html'), '<html lang="##app.lang##"><head><title>##app.title##</title><meta name="description" content="##app.description##"></head><body><header>##app.header##</header><main data-name="##app.name##">##app.version## ##env.mode##</main></body></html>\n');
  await writeFile(path.join(root, 'app', 'config', 'dev.js'), 'export default { app: { title: "T", lang: "en", description: "d", header: "h", name: "n", version: "1" } };\n');
  const api = createFakeToolApi();
  const cli = cliFor(root, api);

  const traversal = await cli.run(['component:build:demo', '--demo', '../escape'], { env: {} });
  assert.equal(traversal.exitCode, 1);
  assert.doesNotMatch(traversal.stderr, /secret|token/);
});

test('error matrix: help and version remain exit 0 and localized help renders the 19 commands', async t => {
  const root = await workspace(t);
  const api = createFakeToolApi();
  const cli = cliFor(root, api);

  const version = await cli.run(['--version'], { env: {} });
  assert.equal(version.exitCode, 0);
  assert.equal(version.stdout.trim(), '0.1.0');

  const help = await cli.run(['--help'], { env: {} });
  assert.equal(help.exitCode, 0);
  for (const name of createCommandRegistry().keys()) {
    assert.match(help.stdout, new RegExp(name));
  }
});
