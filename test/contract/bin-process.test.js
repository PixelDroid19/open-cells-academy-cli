import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, rm, symlink } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const bin = fileURLToPath(new URL('../../bin/cells.js', import.meta.url));

function run(args, env = {}, options = {}) {
  return spawnSync(process.execPath, [bin, ...args], {
    encoding: 'utf8',
    env: { ...process.env, ...env },
    ...(options.cwd === undefined ? {} : { cwd: options.cwd })
  });
}

test('break: root --version stops taking precedence and no longer prints the Academy version', () => {
  const result = run(['--version']);

  assert.equal(result.status, 0);
  assert.equal(result.stdout, '0.1.0\n');
  assert.equal(result.stderr, '');
});

test('break: an npm-style bin symlink stops skipping the version entrypoint', async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'open-cells-academy-bin-'));
  const link = path.join(root, 'cells');
  t.after(() => rm(root, { recursive: true, force: true }));
  await symlink(bin, link);

  const result = spawnSync(process.execPath, [link, '--version'], { encoding: 'utf8' });

  assert.equal(result.status, 0);
  assert.equal(result.stdout, '0.1.0\n');
  assert.equal(result.stderr, '');
});

test('break: importing the bin module stops invoking the CLI entrypoint', () => {
  const result = spawnSync(
    process.execPath,
    ['--input-type=module', '--eval', `await import(${JSON.stringify(new URL('../../bin/cells.js', import.meta.url).href)}); process.stdout.write('imported\\n');`],
    { encoding: 'utf8' }
  );

  assert.equal(result.status, 0);
  assert.equal(result.stdout, 'imported\n');
  assert.equal(result.stderr, '');
});

test('break: root --help stops rendering the full public command grammar', () => {
  const result = run(['--help']);

  assert.equal(result.status, 0);
  assert.match(result.stdout, /Usage: cells <command> \[options\]/);
  assert.match(result.stdout, /app:build/);
  assert.match(result.stdout, /component:test/);
  assert.equal(result.stderr, '');
});

test('break: --language es stops localizing executable help', () => {
  const result = run(['--language', 'es', '--help']);

  assert.equal(result.status, 0);
  assert.match(result.stdout, /Uso: cells <comando> \[opciones\]/);
  assert.match(result.stdout, /Comandos:/);
  assert.equal(result.stderr, '');
});

test('break: invoking the binary without a command stops returning a localized actionable failure', () => {
  const result = run([], { CELLS_ACADEMY_LANGUAGE: 'es' });

  assert.equal(result.status, 1);
  assert.equal(result.stdout, '');
  assert.match(result.stderr, /Se requiere un comando/);
  assert.match(result.stderr, /cells --help/);
});

test('break: invalid command process failures stop returning exit code 1 and a recovery hint', () => {
  const result = run(['unknown:command']);

  assert.equal(result.status, 1);
  assert.equal(result.stdout, '');
  assert.match(result.stderr, /Unknown command "unknown:command"/);
  assert.match(result.stderr, /cells --help/);
});

test('break: component:build:demo -v is routed to root version instead of command verbose dispatch', async t => {
  const cwd = await mkdtemp(path.join(os.tmpdir(), 'open-cells-academy-noworkspace-'));
  t.after(() => rm(cwd, { recursive: true, force: true }));
  const result = run(['component:build:demo', '-v'], {}, { cwd });

  assert.equal(result.status, 1);
  assert.equal(result.stdout, '');
  assert.match(result.stderr, /A Cells workspace is required to run this command/);
  assert.doesNotMatch(result.stdout, /^0\.0\.1$/m);
  assert.doesNotMatch(result.stderr, /Unknown option/);
});
