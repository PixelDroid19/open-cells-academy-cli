import { createServer } from 'node:net';
import { lstat, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { NodeFilesystem } from '../../src/adapters/node/node-filesystem.js';
import { NodeProcessRunner } from '../../src/adapters/node/process-runner.js';
import { PublicPackageManager } from '../../src/adapters/node/public-package-manager.js';
import { WorkspaceSession } from '../../src/domain/workspace-session.js';
import { composeRecipe } from '../../src/recipes/compose-recipe.js';

const TEMP_PARENT = path.join(os.tmpdir(), 'open-cells-academy');

function listen(server, port) {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', resolve);
  });
}

function close(server) {
  return new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
}

async function portReleased(port) {
  const probe = createServer();
  try {
    await listen(probe, port);
    return true;
  } finally {
    if (probe.listening) await close(probe);
  }
}

function withoutLocalCli(metadata) {
  const devDependencies = { ...metadata.devDependencies };
  delete devDependencies['open-cells-academy-cli'];
  return { ...metadata, devDependencies };
}

async function materialize(root, profile, filesystem) {
  const owner = await WorkspaceSession.open(root, filesystem);
  const name = `${profile}-e2e`;
  const plan = composeRecipe(profile, { kind: 'app', name, cellsVersion: '4', e2e: true });
  const publication = await filesystem.applyPlanAtomically(owner, plan, name);
  const metadataPath = path.join(publication.destination, 'package.json');
  const metadata = withoutLocalCli(JSON.parse(await readFile(metadataPath, 'utf8')));
  await writeFile(metadataPath, `${JSON.stringify(metadata, null, 2)}\n`, { mode: 0o600 });
  return publication.destination;
}

async function runOne(root, profile, filesystem, runner, packageManager, port) {
  const project = await materialize(root, profile, filesystem);
  const session = await WorkspaceSession.open(project, filesystem);
  await packageManager.install({ mode: 'install', allowScripts: false, offline: false }, session);
  const configPath = path.join(project, 'playwright.config.js');
  const config = await readFile(configPath, 'utf8');
  await writeFile(configPath, config.replaceAll('4173', String(port)));
  const result = await runner.run({
    file: path.join(project, 'node_modules', '.bin', 'playwright'),
    args: ['test', '--reporter=line', '--workers=1'],
    cwd: project,
    env: {
      ACADEMY_PLAYWRIGHT_EXECUTABLE_PATH: '/opt/google/chrome/chrome',
      PATH: `${path.join(project, 'node_modules', '.bin')}${path.delimiter}${process.env.PATH ?? '/usr/local/bin:/usr/bin:/bin'}`,
      PLAYWRIGHT_BROWSERS_PATH: process.env.PLAYWRIGHT_BROWSERS_PATH ?? '0'
    },
    timeoutMs: 180_000,
    outputLimitBytes: 2_000_000
  });
  return Object.freeze({
    exitCode: result.exitCode,
    portReleased: await portReleased(port),
    profile,
    stderr: result.stderr,
    stdout: result.stdout
  });
}

export async function runGeneratedApplicationE2e(t, profiles) {
  await mkdir(TEMP_PARENT, { recursive: true, mode: 0o700 });
  const root = await mkdtemp(path.join(TEMP_PARENT, 'open-cells-academy-task-6-e2e-'));
  t.after(async () => {
    await rm(root, { recursive: true, force: true });
  });
  await writeFile(path.join(root, 'package.json'), '{"name":"task-six-e2e-owner","private":true}\n');
  const filesystem = new NodeFilesystem();
  const runner = new NodeProcessRunner({ outputLimitBytes: 2_000_000, terminateGraceMs: 500 });
  const packageManager = new PublicPackageManager({
    processRunner: runner,
    tempRoot: path.join(root, 'package-runtime'),
    cacheRoot: path.join(root, 'package-cache'),
    timeoutMs: 180_000
  });
  const results = [];
  for (let index = 0; index < profiles.length; index += 1) {
    results.push(await runOne(root, profiles[index], filesystem, runner, packageManager, 18431 + index));
  }
  return Object.freeze(results);
}
