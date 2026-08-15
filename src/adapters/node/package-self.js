import { createHash, randomUUID } from 'node:crypto';
import { cp, lstat, mkdir, mkdtemp, readFile, realpath, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { gunzipSync } from 'node:zlib';

import { PathPolicy, normalizeRelativePath } from '../../domain/path-policy.js';
import { typedError } from '../../domain/workspace-session.js';

const FINAL_NAME = 'open-cells-academy-cli';
const FINAL_VERSION = '0.1.0';
const FINAL_FILENAME = 'open-cells-academy-cli-0.1.0.tgz';
const OWNED_PREFIX = '.open-cells-academy-pack-';
const SOURCE_PATHS = Object.freeze(['bin', 'src', 'templates', 'README.md', 'LICENSE', 'THIRD_PARTY_NOTICES.md']);
const DISALLOWED_TEXT = Object.freeze([
  ['NPM', 'TOKEN'].join('_'),
  ['_auth', 'Token'].join(''),
  ['pass', 'word='].join(''),
  ['authorization', ':'].join('')
]);

function escapeExpression(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const TEXT_FORBIDDEN = new RegExp(DISALLOWED_TEXT.map(escapeExpression).join('|'), 'i');
const HTTP_URL = /https?:\/\/[^\s'"\x60<>\\]+/gi;

function containsDisallowedUrl(text) {
  for (const match of text.matchAll(HTTP_URL)) {
    if (/\$\{/.test(match[0])) {
      continue;
    }
    let candidate;
    try {
      candidate = new URL(match[0]);
    } catch {
      return true;
    }
    const publicRegistry = candidate.protocol === 'https:' && candidate.hostname === 'registry.npmjs.org' && (candidate.port === '' || candidate.port === '443');
    const localFixture = candidate.protocol === 'http:' && candidate.hostname === '127.0.0.1';
    const publicRepository = candidate.protocol === 'https:' && candidate.hostname === 'github.com' && candidate.pathname.startsWith('/PixelDroid19/open-cells-academy-cli');
    const apacheLicense = candidate.protocol === 'http:' && candidate.hostname === 'www.apache.org' && candidate.pathname.startsWith('/licenses/');
    if (candidate.username !== '' || candidate.password !== '' || (!publicRegistry && !localFixture && !publicRepository && !apacheLicense)) {
      return true;
    }
  }
  return false;
}

function throwIfAborted(signal) {
  if (signal?.aborted === true) {
    throw typedError('INTERRUPTED');
  }
}

function sameIdentity(left, right) {
  return left.dev === right.dev && left.ino === right.ino;
}

function isWithin(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}

function parseJson(contents, code) {
  try {
    return JSON.parse(contents);
  } catch (cause) {
    throw typedError(code, undefined, cause);
  }
}

function assertManifest(value) {
  const published = value?.package;
  if (
    value === null ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    value.schema !== 1 ||
    published === null ||
    typeof published !== 'object' ||
    Array.isArray(published) ||
    published.name !== FINAL_NAME ||
    published.version !== FINAL_VERSION ||
    published.description !== 'Educational OpenCells CLI for creating runnable applications and Lit components.' ||
    published.license !== 'Apache-2.0' ||
    published.repository?.url !== 'git+https://github.com/PixelDroid19/open-cells-academy-cli.git' ||
    published.homepage !== 'https://github.com/PixelDroid19/open-cells-academy-cli#readme' ||
    published.bugs?.url !== 'https://github.com/PixelDroid19/open-cells-academy-cli/issues' ||
    published.publishConfig?.access !== 'public' ||
    published.publishConfig?.registry !== 'https://registry.npmjs.org/' ||
    published.bin?.cells !== 'bin/cells.js' ||
    published.engines?.node !== '>=22.12' ||
    Object.keys(published.bin).length !== 1 ||
    Object.keys(published.engines).length !== 1
  ) {
    throw typedError('PACK_INVALID');
  }
  return Object.freeze({ ...published, bin: Object.freeze({ ...published.bin }), engines: Object.freeze({ ...published.engines }) });
}

function packageMetadata(manifest) {
  return Object.freeze({
    name: manifest.name,
    version: manifest.version,
    description: manifest.description,
    license: manifest.license,
    repository: Object.freeze({ ...manifest.repository }),
    homepage: manifest.homepage,
    bugs: Object.freeze({ ...manifest.bugs }),
    publishConfig: Object.freeze({ ...manifest.publishConfig }),
    type: 'module',
    bin: Object.freeze({ cells: manifest.bin.cells }),
    engines: Object.freeze({ node: manifest.engines.node }),
    files: Object.freeze([...SOURCE_PATHS])
  });
}

function systemPath() {
  if (typeof process.env.PATH === 'string' && process.env.PATH.length > 0) {
    return process.env.PATH;
  }
  return process.platform === 'win32' ? '' : '/usr/local/bin:/usr/bin:/bin';
}

function safeEnvironment(paths) {
  return Object.freeze({
    PATH: systemPath(),
    HOME: paths.home,
    USERPROFILE: paths.home,
    NPM_CONFIG_USERCONFIG: paths.userConfig,
    NPM_CONFIG_GLOBALCONFIG: paths.globalConfig,
    NPM_CONFIG_IGNORE_SCRIPTS: 'true',
    NPM_CONFIG_AUDIT: 'false',
    NPM_CONFIG_FUND: 'false',
    NPM_CONFIG_UPDATE_NOTIFIER: 'false'
  });
}

function parsePackOutput(stdout) {
  const parsed = parseJson(stdout, 'PACK_INVALID');
  const entry = Array.isArray(parsed) && parsed.length === 1 ? parsed[0] : undefined;
  if (
    entry === null ||
    typeof entry !== 'object' ||
    entry.name !== FINAL_NAME ||
    entry.version !== FINAL_VERSION ||
    entry.filename !== FINAL_FILENAME ||
    typeof entry.integrity !== 'string' ||
    !/^sha512-[A-Za-z0-9+/]+={0,2}$/.test(entry.integrity)
  ) {
    throw typedError('PACK_INVALID');
  }
  return Object.freeze({ filename: entry.filename });
}

function tarText(header, start, length) {
  return header.subarray(start, start + length).toString('utf8').replace(/\0.*$/, '');
}

function tarSize(header) {
  const raw = tarText(header, 124, 12).trim();
  if (raw.length === 0) {
    return 0;
  }
  if (!/^[0-7]+$/.test(raw)) {
    throw typedError('PACK_INVALID');
  }
  return Number.parseInt(raw, 8);
}

function assertArchive(bytes) {
  let archive;
  try {
    archive = gunzipSync(bytes);
  } catch (cause) {
    throw typedError('PACK_INVALID', undefined, cause);
  }
  let offset = 0;
  let sawMetadata = false;
  let sawBin = false;
  while (offset + 512 <= archive.length) {
    const header = archive.subarray(offset, offset + 512);
    if (header.every(byte => byte === 0)) {
      break;
    }
    const prefix = tarText(header, 345, 155);
    const entryName = tarText(header, 0, 100);
    const name = prefix.length > 0 ? `${prefix}/${entryName}` : entryName;
    const type = tarText(header, 156, 1) || '0';
    const size = tarSize(header);
    if (!name.startsWith('package/') || path.isAbsolute(name) || name.split('/').some(segment => segment === '' || segment === '.' || segment === '..')) {
      throw typedError('PACK_INVALID');
    }
    const relative = name.slice('package/'.length);
    if (relative.split('/').includes('node_modules') || !['0', '5'].includes(type)) {
      throw typedError('PACK_INVALID');
    }
    const contentStart = offset + 512;
    const contentEnd = contentStart + size;
    if (contentEnd > archive.length) {
      throw typedError('PACK_INVALID');
    }
    const content = archive.subarray(contentStart, contentEnd);
    const text = content.toString('utf8');
    if (type === '0' && (TEXT_FORBIDDEN.test(text) || containsDisallowedUrl(text))) {
      throw typedError('PACK_INVALID');
    }
    if (relative === 'package.json') {
      const metadata = parseJson(content.toString('utf8'), 'PACK_INVALID');
      if (metadata?.name !== FINAL_NAME || metadata?.version !== FINAL_VERSION || metadata?.bin?.cells !== 'bin/cells.js') {
        throw typedError('PACK_INVALID');
      }
      sawMetadata = true;
    }
    if (relative === 'bin/cells.js') {
      sawBin = true;
    }
    offset = contentStart + Math.ceil(size / 512) * 512;
  }
  if (!sawMetadata || !sawBin || offset > archive.length) {
    throw typedError('PACK_INVALID');
  }
}

async function statusOrAbsent(candidate) {
  try {
    return await lstat(candidate);
  } catch (cause) {
    if (cause?.code === 'ENOENT') {
      return undefined;
    }
    throw cause;
  }
}

async function assertRegularSource(candidate, root) {
  const status = await lstat(candidate);
  if (status.isSymbolicLink() || (!status.isFile() && !status.isDirectory())) {
    throw typedError('PACK_INVALID');
  }
  const canonical = await realpath(candidate);
  if (!isWithin(root, canonical)) {
    throw typedError('PACK_INVALID');
  }
}

async function copySource(candidateRoot, stagePackage) {
  for (const relative of SOURCE_PATHS) {
    const source = path.join(candidateRoot, relative);
    await assertRegularSource(source, candidateRoot);
    await cp(source, path.join(stagePackage, relative), { recursive: true, dereference: false, errorOnExist: true, force: false, verbatimSymlinks: true });
  }
}

async function removeOwnedStage(stage) {
  if (stage === undefined) {
    return;
  }
  const current = await statusOrAbsent(stage.path);
  if (current === undefined) {
    return;
  }
  if (!current.isDirectory() || current.isSymbolicLink() || !sameIdentity(current, stage.identity)) {
    throw typedError('PACK_CLEANUP_FAILED');
  }
  await rm(stage.path, { recursive: true, force: false, maxRetries: 2, retryDelay: 20 });
}

/**
 * Packages a clean final-identity CLI from a narrowly copied candidate source
 * tree. The development package identity is never reused as a release identity.
 */
export class NodePackageSelf {
  #candidateRoot;
  #filesystem;
  #processRunner;

  constructor({ candidateRoot, processRunner, filesystem } = {}) {
    if (typeof candidateRoot !== 'string' || !path.isAbsolute(candidateRoot) || processRunner === null || typeof processRunner !== 'object' || typeof processRunner.run !== 'function' || filesystem === null || typeof filesystem !== 'object') {
      throw typedError('INVALID_INPUT', { field: 'packageSelf' });
    }
    this.#candidateRoot = candidateRoot;
    this.#processRunner = processRunner;
    this.#filesystem = filesystem;
    Object.freeze(this);
  }

  async packSelf(destination, context = {}) {
    let stage;
    try {
      if (context === null || typeof context !== 'object' || context.session === null || typeof context.session !== 'object' || typeof context.session.root !== 'string') {
        throw typedError('INVALID_INPUT', { field: 'context' });
      }
      throwIfAborted(context.signal);
      const policy = new PathPolicy(context.session, this.#filesystem);
      const segments = normalizeRelativePath(destination);
      const target = await policy.resolveWrite(segments.join('/'));
      if (target === context.session.root) {
        throw typedError('PATH_INVALID');
      }
      const existing = await statusOrAbsent(target);
      if (existing !== undefined) {
        throw typedError('OUTPUT_EXISTS');
      }
      const parent = path.dirname(target);
      const parentStatus = await statusOrAbsent(parent);
      if (parentStatus === undefined) {
        throw typedError('DESTINATION_PARENT_MISSING');
      }
      if (!parentStatus.isDirectory() || parentStatus.isSymbolicLink()) {
        throw typedError('DESTINATION_PARENT_INVALID');
      }
      const canonicalParent = await realpath(parent);
      if (!this.#filesystem.isPathWithin(context.session.root, canonicalParent)) {
        throw typedError('PATH_OUTSIDE_WORKSPACE');
      }
      const candidateRoot = await realpath(this.#candidateRoot);
      const manifest = assertManifest(parseJson(await readFile(path.join(candidateRoot, 'package-self-manifest.json'), 'utf8'), 'PACK_INVALID'));
      stage = Object.freeze({ path: await mkdtemp(path.join(canonicalParent, `${OWNED_PREFIX}${randomUUID()}-`)) });
      stage = Object.freeze({ ...stage, identity: await lstat(stage.path) });
      const stagePackage = path.join(stage.path, 'package');
      const output = path.join(stage.path, 'output');
      const home = path.join(stage.path, 'home');
      const userConfig = path.join(stage.path, 'user-config');
      const globalConfig = path.join(stage.path, 'global-config');
      await mkdir(stagePackage, { mode: 0o700 });
      await mkdir(output, { mode: 0o700 });
      await mkdir(home, { mode: 0o700 });
      await writeFile(userConfig, '', { flag: 'wx', mode: 0o600 });
      await writeFile(globalConfig, '', { flag: 'wx', mode: 0o600 });
      await copySource(candidateRoot, stagePackage);
      await writeFile(path.join(stagePackage, 'package.json'), `${JSON.stringify(packageMetadata(manifest), null, 2)}\n`, { flag: 'wx', mode: 0o600 });
      const outputIdentity = await lstat(output);
      throwIfAborted(context.signal);
      const result = await this.#processRunner.run({
        file: 'npm',
        args: ['pack', '--ignore-scripts', '--json', `--pack-destination=${output}`],
        cwd: stagePackage,
        env: safeEnvironment({ home, userConfig, globalConfig }),
        signal: context.signal,
        timeoutMs: 120_000,
        stdio: 'pipe'
      });
      if (result.exitCode !== 0 || result.signal !== null) {
        throw typedError(result.signal === 'SIGTERM' || result.signal === 'SIGINT' ? 'INTERRUPTED' : 'PACK_FAILED', { result });
      }
      const report = parsePackOutput(result.stdout);
      const archive = path.join(output, report.filename);
      const archiveStatus = await statusOrAbsent(archive);
      if (archiveStatus === undefined || !archiveStatus.isFile() || archiveStatus.isSymbolicLink()) {
        throw typedError('PACK_INVALID');
      }
      const currentOutput = await lstat(output);
      if (!currentOutput.isDirectory() || currentOutput.isSymbolicLink() || !sameIdentity(currentOutput, outputIdentity)) {
        throw typedError('PACK_INVALID');
      }
      const bytes = await readFile(archive);
      const archiveAfterRead = await lstat(archive);
      if (!sameIdentity(archiveStatus, archiveAfterRead)) {
        throw typedError('PACK_INVALID');
      }
      assertArchive(bytes);
      throwIfAborted(context.signal);
      if ((await statusOrAbsent(target)) !== undefined) {
        throw typedError('OUTPUT_EXISTS');
      }
      await rename(output, target);
      const publishedArchive = path.join(target, report.filename);
      const publishedStatus = await lstat(publishedArchive);
      if (!publishedStatus.isFile() || publishedStatus.isSymbolicLink() || !sameIdentity(publishedStatus, archiveStatus)) {
        throw typedError('PACK_INVALID');
      }
      const publishedBytes = await readFile(publishedArchive);
      assertArchive(publishedBytes);
      return Object.freeze({
        tarballPath: publishedArchive,
        integrity: `sha512-${createHash('sha512').update(publishedBytes).digest('base64')}`
      });
    } catch (cause) {
      if (cause?.code !== undefined) {
        throw cause;
      }
      throw typedError('PACK_FAILED', undefined, cause);
    } finally {
      await removeOwnedStage(stage);
    }
  }
}
