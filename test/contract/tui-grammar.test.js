import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { createCommandRegistry } from '../../src/cli/command-registry.js';
import { parseArgv } from '../../src/cli/parse-argv.js';
import { renderOutcome } from '../../src/cli/render-outcome.js';
import { resolveDispatch } from '../../src/cli/composition.js';
import { createCli } from '../../bin/cells.js';
import { createFakeToolApi } from '../fixtures/task-13-composition/fake-tools.js';

test('contract: cells with no arguments in interactive TTY parses to action tui', () => {
  const registry = createCommandRegistry();
  const context = {
    isTTY: true,
    stdin: { isTTY: true },
    stdout: { isTTY: true },
    env: { TERM: 'xterm-256color' }
  };

  const parsed = parseArgv([], registry, context);
  assert.equal(parsed.ok, true);
  assert.equal(parsed.action, 'tui');
  assert.equal(parsed.options?.animation, true);
});

test('contract: cells tui explicitly parses to action tui', () => {
  const registry = createCommandRegistry();
  const parsed = parseArgv(['tui'], registry, { isTTY: true, env: { TERM: 'xterm-256color' } });
  assert.equal(parsed.ok, true);
  assert.equal(parsed.action, 'tui');
  assert.equal(parsed.options?.animation, true);
});

test('contract: explicit cells tui falls back to static help outside an eligible terminal', () => {
  const registry = createCommandRegistry();

  for (const context of [
    { isTTY: false, stdin: { isTTY: false }, stdout: { isTTY: false }, env: {} },
    { isTTY: true, stdin: { isTTY: true }, stdout: { isTTY: true }, env: { TERM: 'dumb' } },
    { isTTY: true, stdin: { isTTY: true }, stdout: { isTTY: true }, env: { CI: 'true' } }
  ]) {
    const parsed = parseArgv(['tui'], registry, context);
    assert.equal(parsed.ok, true);
    assert.equal(parsed.action, 'help');
  }
});

test('contract: TUI fallback help keeps an explicit language regardless of option order', () => {
  const registry = createCommandRegistry();
  const context = { isTTY: false, stdin: { isTTY: false }, stdout: { isTTY: false }, env: {} };

  for (const argv of [['tui', '--language', 'es'], ['--language', 'es', 'tui']]) {
    const parsed = parseArgv(argv, registry, context);
    assert.equal(parsed.ok, true);
    assert.equal(parsed.action, 'help');
    assert.equal(parsed.language, 'es');
  }
});

test('contract: cells tui --no-animation disables animation option', () => {
  const registry = createCommandRegistry();
  const parsed = parseArgv(['tui', '--no-animation'], registry, { isTTY: true, env: { TERM: 'xterm-256color' } });
  assert.equal(parsed.ok, true);
  assert.equal(parsed.action, 'tui');
  assert.equal(parsed.options?.animation, false);
});

test('contract: cells with no arguments in non-TTY pipe returns action fallback_help with clean exit', () => {
  const registry = createCommandRegistry();
  const context = {
    isTTY: false,
    stdin: { isTTY: false },
    stdout: { isTTY: false },
    env: {}
  };

  const parsed = parseArgv([], registry, context);
  assert.equal(parsed.ok, true);
  assert.equal(parsed.action, 'help');
});

test('contract: cells with TERM=dumb returns action help fallback even if isTTY is true', () => {
  const registry = createCommandRegistry();
  const context = {
    isTTY: true,
    stdin: { isTTY: true },
    stdout: { isTTY: true },
    env: { TERM: 'dumb' }
  };

  const parsed = parseArgv([], registry, context);
  assert.equal(parsed.ok, true);
  assert.equal(parsed.action, 'help');
});

test('contract: cells in CI environment returns action help fallback', () => {
  const registry = createCommandRegistry();
  const context = {
    isTTY: true,
    stdin: { isTTY: true },
    stdout: { isTTY: true },
    env: { CI: 'true' }
  };

  const parsed = parseArgv([], registry, context);
  assert.equal(parsed.ok, true);
  assert.equal(parsed.action, 'help');
});

test('contract: legacy lit-components:serve plural alias resolves to component:dev', () => {
  const registry = createCommandRegistry();
  const parsed = parseArgv(['lit-components:serve', '--port', '8080'], registry, {});
  assert.equal(parsed.ok, true);
  assert.equal(parsed.action, 'command');
  assert.equal(parsed.command.name, 'component:dev');
  assert.equal(parsed.options.port, 8080);
});

test('contract: component dev accepts the strict-port option emitted by the TUI process argv', () => {
  const registry = createCommandRegistry();
  const parsed = parseArgv(
    ['component:dev', '--host', '127.0.0.1', '--port', '8001', '--strictPort', '--no-open'],
    registry,
    { env: {} }
  );

  assert.equal(parsed.ok, true);
  assert.equal(parsed.command.name, 'component:dev');
  assert.equal(parsed.options.host, '127.0.0.1');
  assert.equal(parsed.options.port, 8001);
  assert.equal(parsed.options.strictPort, true);
  assert.equal(parsed.options.open, false);
});

test('contract: cli runner executes tui action when dispatch provides startTui handler', async () => {
  let tuiCalled = false;
  let receivedParsed = null;
  const dispatch = async request => {
    if (request.action === 'tui') {
      tuiCalled = true;
      receivedParsed = request;
      return { ok: true, data: { status: 'tui_closed' } };
    }
    return { ok: true, data: {} };
  };

  const cli = createCli({ dispatch });
  const result = await cli.run(['tui'], { isTTY: true, env: { TERM: 'xterm' } });
  assert.equal(tuiCalled, true);
  assert.equal(receivedParsed.action, 'tui');
  assert.equal(result.exitCode, 0);
});

test('contract: composition turns an owned dev handle readiness into a localized child output line', async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'open-cells-tui-ready-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await writeFile(path.join(root, 'package.json'), '{"name":"ready-fixture","private":true,"type":"module"}\n');
  await mkdir(path.join(root, 'demo'));
  await writeFile(path.join(root, 'demo', 'index.html'), '<main>ready</main>\n');
  const registry = createCommandRegistry();
  const parsed = parseArgv(['component:dev', '--host', '127.0.0.1', '--port', '8001', '--no-open'], registry, { env: {} });
  const { dispatch } = resolveDispatch({ api: createFakeToolApi({ vite: { present: true } }), cwd: root });

  const outcome = await dispatch(parsed);
  const english = renderOutcome(outcome, 'en');
  const spanish = renderOutcome(outcome, 'es');

  assert.equal(outcome.ok, true);
  assert.match(english.stdout, /^Server ready: http:\/\/127\.0\.0\.1:43001\/$/m);
  assert.match(spanish.stdout, /^Servidor listo: http:\/\/127\.0\.0\.1:43001\/$/m);
});
