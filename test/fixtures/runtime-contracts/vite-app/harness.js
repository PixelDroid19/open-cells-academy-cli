import { createServer } from 'node:net';
import { cp, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { NodeFilesystem } from '../../../../src/adapters/node/node-filesystem.js';
import { NodeProcessRunner } from '../../../../src/adapters/node/process-runner.js';
import { PublicPackageManager } from '../../../../src/adapters/node/public-package-manager.js';
import { WorkspaceSession } from '../../../../src/domain/workspace-session.js';
import { composeRecipe } from '../../../../src/recipes/compose-recipe.js';
import { startStaticServer } from './static-server.js';

const TEMP_PARENT = path.join(os.tmpdir(), 'open-cells-academy');
const FIXTURE_ROOT = import.meta.dirname;

function resolvedArtifacts(value, output = []) {
  if (value === null || typeof value !== 'object') return output;
  for (const [key, child] of Object.entries(value)) {
    if (key === 'resolved' && typeof child === 'string') output.push(child);
    else resolvedArtifacts(child, output);
  }
  return output;
}

function publicLockOnly(value) {
  const artifacts = resolvedArtifacts(value);
  return artifacts.length > 0 && artifacts.every(candidate => {
    try {
      const url = new URL(candidate);
      return url.protocol === 'https:' && url.hostname === 'registry.npmjs.org' && url.username === '' && url.password === '';
    } catch {
      return false;
    }
  });
}

async function filesBelow(root) {
  const output = [];
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const candidate = path.join(root, entry.name);
    if (entry.isDirectory()) output.push(...await filesBelow(candidate));
    else if (entry.isFile()) output.push(candidate);
  }
  return output;
}

function listen(server, port) {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', resolve);
  });
}

function close(server) {
  return new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
}

async function portReleased(origin) {
  const probe = createServer();
  try {
    await listen(probe, Number(new URL(origin).port));
    return true;
  } finally {
    if (probe.listening) await close(probe);
  }
}

function packageForTaskFive(metadata) {
  return {
    ...metadata,
    devDependencies: { vite: metadata.devDependencies.vite },
    optionalDependencies: {},
    peerDependencies: {}
  };
}

export async function buildTaskFiveViteFixture(t) {
  await mkdir(TEMP_PARENT, { recursive: true, mode: 0o700 });
  const ownedRoot = await mkdtemp(path.join(TEMP_PARENT, 'open-cells-academy-task-5-vite-'));
  t.after(async () => {
    await rm(ownedRoot, { recursive: true, force: true });
  });
  const filesystem = new NodeFilesystem();
  await writeFile(path.join(ownedRoot, 'package.json'), '{"name":"task-five-vite-owner","private":true}\n');
  const owner = await WorkspaceSession.open(ownedRoot, filesystem);
  const plan = composeRecipe('blank', { kind: 'app', name: 'runtime-vite-app', cellsVersion: '4' });
  const published = await filesystem.applyPlanAtomically(owner, plan, 'runtime-vite-app');
  const fixture = published.destination;
  const metadataPath = path.join(fixture, 'package.json');
  const metadata = packageForTaskFive(JSON.parse(await readFile(metadataPath, 'utf8')));
  delete metadata.devDependencies['open-cells-academy-cli'];
  await writeFile(metadataPath, `${JSON.stringify(metadata, null, 2)}\n`, { mode: 0o600 });
  await cp(path.join(FIXTURE_ROOT, 'index.html'), path.join(fixture, 'index.html'));
  await cp(path.join(FIXTURE_ROOT, 'browser-entry.js'), path.join(fixture, 'browser-entry.js'));

  const session = await WorkspaceSession.open(fixture, filesystem);
  const processRunner = new NodeProcessRunner({ outputLimitBytes: 2_000_000, terminateGraceMs: 250 });
  const packageManager = new PublicPackageManager({
    processRunner,
    tempRoot: path.join(ownedRoot, 'package-runtime'),
    cacheRoot: path.join(ownedRoot, 'package-cache'),
    timeoutMs: 180_000
  });
  await packageManager.install({ mode: 'install', allowScripts: false, offline: false }, session);
  const lock = JSON.parse(await readFile(path.join(fixture, 'package-lock.json'), 'utf8'));

  const clientBuild = await processRunner.run({
    file: path.join(fixture, 'node_modules', '.bin', 'vite'),
    args: ['build', '--outDir', 'dist', '--emptyOutDir'],
    cwd: fixture,
    env: {},
    timeoutMs: 120_000
  });
  if (clientBuild.exitCode !== 0) throw new Error(`Vite client build failed: ${clientBuild.stderr}`);
  const dist = path.join(fixture, 'dist');
  const server = await startStaticServer(dist);
  let indexStatus;
  let assetStatus;
  let released;
  try {
    const indexResponse = await fetch(`${server.origin}/`);
    indexStatus = indexResponse.status;
    const html = await indexResponse.text();
    const assetPath = html.match(/<script[^>]+src="([^"]+)"/)?.[1];
    if (assetPath === undefined) throw new Error('Built index has no module asset');
    assetStatus = (await fetch(new URL(assetPath, server.origin))).status;
  } finally {
    const firstClose = server.close();
    if (server.close() !== firstClose) throw new Error('Static server close is not idempotent');
    await firstClose;
    released = await portReleased(server.origin);
  }

  let ssrError;
  try {
    await import(`${pathToFileURL(path.join(fixture, 'src', 'main.js')).href}?ssr=${Date.now()}`);
  } catch (error) {
    ssrError = error;
  }
  if (ssrError === undefined) throw new Error('SSR import unexpectedly succeeded');
  const builtFiles = await filesBelow(dist);
  let serviceWorkerRegistrationFound = false;
  for (const file of builtFiles) {
    if (/navigator\.serviceWorker\s*\.\s*register/.test(await readFile(file, 'utf8'))) {
      serviceWorkerRegistrationFound = true;
    }
  }

  return Object.freeze({
    assetStatus,
    clientBuild,
    indexStatus,
    portReleased: released,
    publicLockOnly: publicLockOnly(lock),
    serviceWorkerRegistrationFound,
    ssrError: Object.freeze({ code: ssrError.code, message: ssrError.message })
  });
}
