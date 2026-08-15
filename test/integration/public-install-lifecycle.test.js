import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

const execFileAsync = promisify(execFile);
const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const PACKAGE_NAME = 'open-cells-academy-cli';

function publicEnvironment(root) {
  return {
    PATH: process.env.PATH ?? '/usr/local/bin:/usr/bin:/bin',
    HOME: path.join(root, 'home'),
    USERPROFILE: path.join(root, 'home'),
    NPM_CONFIG_USERCONFIG: '/dev/null',
    NPM_CONFIG_REGISTRY: 'https://registry.npmjs.org/',
    NPM_CONFIG_CACHE: path.join(root, 'cache'),
    NPM_CONFIG_IGNORE_SCRIPTS: 'true',
    NPM_CONFIG_AUDIT: 'false',
    NPM_CONFIG_FUND: 'false',
    NPM_CONFIG_UPDATE_NOTIFIER: 'false'
  };
}

async function npm(args, options) {
  return execFileAsync('npm', args, {
    cwd: options.cwd,
    env: options.env,
    timeout: 300_000,
    maxBuffer: 10 * 1024 * 1024
  });
}

async function packageTarball(root, env) {
  const { stdout } = await npm(
    ['pack', '--ignore-scripts', '--json', `--pack-destination=${root}`],
    { cwd: ROOT, env }
  );
  const report = JSON.parse(stdout);
  assert.equal(report.length, 1);
  assert.equal(report[0].name, PACKAGE_NAME);
  assert.equal(report[0].version, '0.1.0');
  return path.join(root, report[0].filename);
}

async function runEphemeral(tarball, cwd, env, args) {
  return npm(['exec', '--yes', `--package=${tarball}`, '--', 'cells', ...args], { cwd, env });
}

test('public tarball runs through npm exec and creates app and component projects from an empty directory', { timeout: 300_000 }, async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'open-cells-public-install-'));
  t.after(async () => {
    await rm(root, { recursive: true, force: true });
  });
  const env = publicEnvironment(root);
  const tarball = await packageTarball(root, env);
  const workspace = path.join(root, 'workspace');
  await access(tarball);
  await mkdir(workspace, { recursive: true });

  const version = await runEphemeral(tarball, workspace, env, ['--version']);
  assert.doesNotMatch(version.stderr, /npm error|ERR!/i);
  assert.equal(version.stdout, '0.1.0\n');

  await writeFile(path.join(workspace, 'app.json'), `${JSON.stringify({ name: 'npx-academy-app', scaffold: 'blank' }, null, 2)}\n`);
  await writeFile(path.join(workspace, 'component.json'), `${JSON.stringify({ name: 'academy-learning-card', namespace: 'academy' }, null, 2)}\n`);

  const app = await runEphemeral(tarball, workspace, env, ['app:create', '--scaffold', 'app.json']);
  const component = await runEphemeral(tarball, workspace, env, ['component:create', '--scaffold', 'component.json']);
  assert.doesNotMatch(app.stderr, /npm error|ERR!/i);
  assert.doesNotMatch(component.stderr, /npm error|ERR!/i);

  for (const project of ['npx-academy-app', 'academy-learning-card']) {
    const manifest = JSON.parse(await readFile(path.join(workspace, project, 'package.json'), 'utf8'));
    assert.match(manifest.devDependencies[PACKAGE_NAME], /^file:tools\/open-cells-academy-cli-0\.1\.0\.tgz$/);
    await access(path.join(workspace, project, 'tools', 'open-cells-academy-cli-0.1.0.tgz'));
  }

  await access(path.join(workspace, 'npx-academy-app', 'src', 'main.js'));
  await access(path.join(workspace, 'academy-learning-card', 'src', 'AcademyLearningCard.js'));
});
