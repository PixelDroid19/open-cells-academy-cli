import { lstat, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { NodeFilesystem } from '../../src/adapters/node/node-filesystem.js';
import { NodePackageSelf } from '../../src/adapters/node/package-self.js';
import { NodeProcessRunner } from '../../src/adapters/node/process-runner.js';
import { PublicPackageManager } from '../../src/adapters/node/public-package-manager.js';
import { WorkspaceSession } from '../../src/domain/workspace-session.js';
import { composeRecipe } from '../../src/recipes/compose-recipe.js';

const TEMP_PARENT = path.join(os.tmpdir(), 'open-cells-academy');
const CANDIDATE_ROOT = path.resolve(import.meta.dirname, '../..');

function resolvedArtifacts(value, output = []) {
  if (value === null || typeof value !== 'object') return output;
  for (const [key, child] of Object.entries(value)) {
    if (key === 'resolved' && typeof child === 'string') output.push(child);
    else resolvedArtifacts(child, output);
  }
  return output;
}

function publicLockOnly(lock) {
  const artifacts = resolvedArtifacts(lock);
  return artifacts.length > 0 && artifacts.every(candidate => {
    if (/^file:tools\/[A-Za-z0-9][A-Za-z0-9._-]*\.tgz$/.test(candidate)) return true;
    try {
      const url = new URL(candidate);
      return url.protocol === 'https:' && url.hostname === 'registry.npmjs.org' && url.username === '' && url.password === '';
    } catch {
      return false;
    }
  });
}

async function isFile(candidate) {
  try {
    return (await lstat(candidate)).isFile();
  } catch (error) {
    if (error?.code === 'ENOENT') return false;
    throw error;
  }
}

async function firstFile(root, candidates) {
  for (const relative of candidates) {
    if (await isFile(path.join(root, relative))) return relative;
  }
  return undefined;
}

function commandRecord(label, request, result) {
  return Object.freeze({
    args: Object.freeze([...(request.args ?? [])]),
    file: request.file,
    label,
    result
  });
}

function recordingProcessRunner(processRunner, records) {
  return Object.freeze({
    async run(request) {
      try {
        const result = await processRunner.run(request);
        records.push(Object.freeze({ request, result }));
        return result;
      } catch (error) {
        if (error?.details?.result !== undefined) {
          records.push(Object.freeze({ request, result: error.details.result }));
        }
        throw error;
      }
    }
  });
}

async function executeCommand(commands, processRunner, label, request) {
  const result = await processRunner.run(request);
  commands.push(commandRecord(label, request, result));
  return result;
}

async function runProfile(root, profile, filesystem, processRunner, localCli, cleanBin) {
  const owner = await WorkspaceSession.open(root, filesystem);
  const projectName = `${profile}-lifecycle`;
  const plan = composeRecipe(profile, { kind: 'app', name: projectName, cellsVersion: '5', localCli });
  const publication = await filesystem.applyPlanAtomically(owner, plan, projectName);
  const project = publication.destination;
  const session = await WorkspaceSession.open(project, filesystem);
  const installOperations = [];
  const packageManager = new PublicPackageManager({
    processRunner: recordingProcessRunner(processRunner, installOperations),
    tempRoot: path.join(root, 'package-runtime'),
    cacheRoot: path.join(root, 'package-cache'),
    timeoutMs: 120_000
  });
  await packageManager.install({ mode: 'install', allowScripts: false, offline: false }, session);
  const install = installOperations.at(-1);
  if (install === undefined) {
    throw new Error('Lifecycle install did not execute a package command');
  }
  const commandEnvironment = {
    PATH: `${path.join(project, 'node_modules', '.bin')}${path.delimiter}${cleanBin}${path.delimiter}/usr/bin${path.delimiter}/bin`
  };
  const commands = [commandRecord('install', install.request, install.result)];
  const cellsExecutable = path.join(project, 'node_modules', '.bin', 'cells');
  const vitestExecutable = path.join(project, 'node_modules', '.bin', 'vitest');
  const cellsTest = await executeCommand(commands, processRunner, 'cells app:test', {
    file: cellsExecutable,
    args: ['app:test'],
    cwd: project,
    env: commandEnvironment,
    timeoutMs: 90_000
  });
  const cellsBuild = await executeCommand(commands, processRunner, 'cells app:build', {
    file: cellsExecutable,
    args: ['app:build', '-c', 'prod.js'],
    cwd: project,
    env: commandEnvironment,
    timeoutMs: 90_000
  });
  const a11y = await executeCommand(commands, processRunner, 'test:a11y', {
    file: vitestExecutable,
    args: ['run', 'test/unit'],
    cwd: project,
    env: commandEnvironment,
    timeoutMs: 90_000
  });
  const lint = await executeCommand(commands, processRunner, 'lint', {
    file: cellsExecutable,
    args: ['app:lint'],
    cwd: project,
    env: commandEnvironment,
    timeoutMs: 30_000
  });
  const locales = await executeCommand(commands, processRunner, 'locales', {
    file: cellsExecutable,
    args: ['app:locales', '-c', 'dev.js'],
    cwd: project,
    env: commandEnvironment,
    timeoutMs: 30_000
  });
  const academyVersion = await executeCommand(commands, processRunner, 'academy:version', {
    file: cellsExecutable,
    args: ['--version'],
    cwd: project,
    env: commandEnvironment,
    timeoutMs: 30_000
  });
  const lock = JSON.parse(await readFile(path.join(project, 'package-lock.json'), 'utf8'));

  return Object.freeze({
    academyVersion,
    a11y,
    cellsBuild,
    cellsBuildIndex: await firstFile(project, ['build/prod/index.html', 'build/prod/dist/index.html', 'dist/index.html']),
    cellsTest,
    commands: Object.freeze(commands),
    lint,
    locales,
    profile,
    publicLockOnly: publicLockOnly(lock),
    localTarball: await isFile(path.join(project, 'tools', localCli.fileName))
  });
}

export async function runApplicationProfileLifecycle(t, profile) {
  if (typeof profile !== 'string' || profile.length === 0) {
    throw new TypeError('Lifecycle profile must be a non-empty string');
  }
  await mkdir(TEMP_PARENT, { recursive: true, mode: 0o700 });
  const ownedRoot = await mkdtemp(path.join(TEMP_PARENT, `open-cells-academy-task-6-${profile}-`));
  t.after(async () => {
    await rm(ownedRoot, { recursive: true, force: true });
  });
  await writeFile(path.join(ownedRoot, 'package.json'), '{"name":"task-six-owner","private":true}\n');
  const filesystem = new NodeFilesystem();
  const processRunner = new NodeProcessRunner({ outputLimitBytes: 2_000_000, terminateGraceMs: 250 });
  const ownerSession = await WorkspaceSession.open(ownedRoot, filesystem);
  const packed = await new NodePackageSelf({ candidateRoot: CANDIDATE_ROOT, processRunner, filesystem }).packSelf('packed-cli', { session: ownerSession });
  const localCli = Object.freeze({
    fileName: path.basename(packed.tarballPath),
    content: new Uint8Array(await readFile(packed.tarballPath)),
    integrity: packed.integrity
  });
  const cleanBin = path.join(ownedRoot, 'clean-bin');
  await mkdir(cleanBin);
  await symlink(process.execPath, path.join(cleanBin, 'node'));
  return runProfile(ownedRoot, profile, filesystem, processRunner, localCli, cleanBin);
}
