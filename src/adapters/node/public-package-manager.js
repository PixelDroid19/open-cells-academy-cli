import { lstat, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { typedError } from '../../domain/workspace-session.js';
import { PackageManagerPort } from '../../ports/package-manager.js';

const PUBLIC_REGISTRY = 'https://registry.npmjs.org/';
const OWNED_PREFIX = 'open-cells-academy-task-3-package-';
const PACKAGE_MANAGER = /^(npm|pnpm)@(\d+)\.(\d+)\.(\d+)(?:[-+][A-Za-z0-9.-]+)?$/;
const SAFE_MODES = new Set(['install', 'ci']);
const REMOTE_ARTIFACT = /^(?:https?:\/\/|\/\/|git\+(?:https?|ssh):\/\/|(?:git|ssh):\/\/|git@|github:)/i;
const URL_SCHEME = /^(?:https?|git(?:\+https?|\+ssh)?|ssh):/i;

function assertRequest(request) {
  if (request === null || typeof request !== 'object' || Array.isArray(request)) {
    throw typedError('INVALID_INPUT', { field: 'request' });
  }
  if (!SAFE_MODES.has(request.mode)) {
    throw typedError('INVALID_INPUT', { field: 'mode' });
  }
  if (typeof request.allowScripts !== 'boolean') {
    throw typedError('INVALID_INPUT', { field: 'allowScripts' });
  }
  if (typeof request.offline !== 'boolean') {
    throw typedError('INVALID_INPUT', { field: 'offline' });
  }
  return Object.freeze({
    mode: request.mode,
    allowScripts: request.allowScripts,
    offline: request.offline,
    signal: request.signal
  });
}

function assertSession(session) {
  if (
    session === null ||
    typeof session !== 'object' ||
    typeof session.root !== 'string' ||
    !path.isAbsolute(session.root) ||
    session.packageMetadata === null ||
    typeof session.packageMetadata !== 'object' ||
    Array.isArray(session.packageMetadata)
  ) {
    throw typedError('WORKSPACE_INVALID');
  }
}

async function fileExists(candidate) {
  try {
    const status = await lstat(candidate);
    if (!status.isFile() || status.isSymbolicLink()) {
      throw typedError('CONFIG_INVALID', { path: path.basename(candidate) });
    }
    return true;
  } catch (cause) {
    if (cause?.code === 'ENOENT') {
      return false;
    }
    throw cause;
  }
}

async function packageLocks(root) {
  const [pnpm, packageLock, shrinkwrap] = await Promise.all([
    fileExists(path.join(root, 'pnpm-lock.yaml')),
    fileExists(path.join(root, 'package-lock.json')),
    fileExists(path.join(root, 'npm-shrinkwrap.json'))
  ]);
  if (pnpm && (packageLock || shrinkwrap)) {
    throw typedError('LOCK_CONFLICT');
  }
  return Object.freeze({ pnpm, npm: packageLock || shrinkwrap });
}

function metadataTool(metadata) {
  const configured = metadata.packageManager;
  if (configured === undefined) {
    return undefined;
  }
  if (typeof configured !== 'string') {
    throw typedError('CONFIG_INVALID', { field: 'packageManager' });
  }
  const match = PACKAGE_MANAGER.exec(configured);
  if (match === null) {
    throw typedError('CONFIG_INVALID', { field: 'packageManager' });
  }
  return match[1];
}

function forbiddenRemoteArtifact() {
  return typedError('PRIVATE_REGISTRY_FORBIDDEN', { source: 'package-source' });
}

function invalidArtifact() {
  return typedError('CONFIG_INVALID', { source: 'package-source' });
}

function validateRemoteArtifact(value) {
  if (typeof value !== 'string') {
    return;
  }
  const candidate = value.trim();
  if (!REMOTE_ARTIFACT.test(candidate)) {
    if (URL_SCHEME.test(candidate)) {
      throw invalidArtifact();
    }
    return;
  }
  if (!candidate.startsWith('https://')) {
    throw forbiddenRemoteArtifact();
  }
  let parsed;
  try {
    parsed = new URL(candidate);
  } catch (cause) {
    throw typedError('CONFIG_INVALID', { source: 'package-source' }, cause);
  }
  if (
    parsed.protocol !== 'https:' ||
    parsed.username.length > 0 ||
    parsed.password.length > 0 ||
    parsed.hostname !== 'registry.npmjs.org' ||
    (parsed.port !== '' && parsed.port !== '443')
  ) {
    throw forbiddenRemoteArtifact();
  }
}

function scanNpmLockValue(value) {
  if (value === null || typeof value !== 'object') {
    validateRemoteArtifact(value);
    return;
  }
  for (const item of Array.isArray(value) ? value : Object.values(value)) {
    scanNpmLockValue(item);
  }
}

const PNPM_SOURCE_KEYS = new Set(['tarball', 'resolved', 'resolution']);
const YAML_DOUBLE_ESCAPES = new Map([
  ['0', '\u0000'],
  ['a', '\u0007'],
  ['b', '\b'],
  ['t', '\t'],
  ['n', '\n'],
  ['v', '\v'],
  ['f', '\f'],
  ['r', '\r'],
  ['e', '\u001b'],
  [' ', ' '],
  ['"', '"'],
  ['/', '/'],
  ['\\', '\\'],
  ['N', '\u0085'],
  ['_', '\u00a0'],
  ['L', '\u2028'],
  ['P', '\u2029']
]);

function isYamlSpace(character) {
  return character === ' ' || character === '\t';
}

function skipYamlSpace(contents, index) {
  let next = index;
  while (next < contents.length && isYamlSpace(contents[next])) {
    next += 1;
  }
  return next;
}

function decodeYamlDoubleQuoted(raw) {
  let decoded = '';
  for (let index = 0; index < raw.length; index += 1) {
    const character = raw[index];
    if (character === '\r' || character === '\n') {
      throw invalidArtifact();
    }
    if (character !== '\\') {
      decoded += character;
      continue;
    }
    const escape = raw[index + 1];
    if (escape === undefined || escape === '\r' || escape === '\n') {
      throw invalidArtifact();
    }
    const simple = YAML_DOUBLE_ESCAPES.get(escape);
    if (simple !== undefined) {
      decoded += simple;
      index += 1;
      continue;
    }
    const digits = escape === 'x' ? 2 : escape === 'u' ? 4 : escape === 'U' ? 8 : undefined;
    if (digits === undefined) {
      throw invalidArtifact();
    }
    const hexadecimal = raw.slice(index + 2, index + 2 + digits);
    if (hexadecimal.length !== digits || !/^[0-9a-f]+$/i.test(hexadecimal)) {
      throw invalidArtifact();
    }
    const codePoint = Number.parseInt(hexadecimal, 16);
    if (codePoint > 0x10ffff || (codePoint >= 0xd800 && codePoint <= 0xdfff)) {
      throw invalidArtifact();
    }
    decoded += String.fromCodePoint(codePoint);
    index += digits + 1;
  }
  return decoded;
}

function readYamlQuoted(contents, start, quote) {
  let raw = '';
  for (let index = start + 1; index < contents.length; index += 1) {
    const character = contents[index];
    if (quote === '"' && character === '\\') {
      if (index + 1 >= contents.length) {
        return undefined;
      }
      raw += character + contents[index + 1];
      index += 1;
      continue;
    }
    if (character !== quote) {
      raw += character;
      continue;
    }
    if (quote === "'" && contents[index + 1] === "'") {
      raw += "''";
      index += 1;
      continue;
    }
    return Object.freeze({ raw, end: index + 1, quoted: quote });
  }
  return undefined;
}

function decodeYamlKey(token) {
  if (token.quoted === '"') {
    return decodeYamlDoubleQuoted(token.raw);
  }
  if (token.quoted === "'") {
    return token.raw.replaceAll("''", "'");
  }
  return token.raw;
}

function readYamlKey(contents, start) {
  let index = skipYamlSpace(contents, start);
  if (contents[index] === '-' && isYamlSpace(contents[index + 1])) {
    index = skipYamlSpace(contents, index + 1);
  }
  // Tags, anchors, aliases, and explicit or flow-collection complex keys can
  // alter the YAML identity or shape of a mapping. This bounded source
  // preflight does not implement those forms, so rejects them only at
  // mapping-key positions.
  if (['!', '&', '*', '?', '[', '{'].includes(contents[index])) {
    throw invalidArtifact();
  }
  let token;
  if (contents[index] === '"' || contents[index] === "'") {
    token = readYamlQuoted(contents, index, contents[index]);
    if (token === undefined) {
      throw invalidArtifact();
    }
  } else {
    const keyStart = index;
    while (
      index < contents.length &&
      !isYamlSpace(contents[index]) &&
      contents[index] !== ':' &&
      contents[index] !== ',' &&
      contents[index] !== '{' &&
      contents[index] !== '}' &&
      contents[index] !== '\n' &&
      contents[index] !== '\r'
    ) {
      index += 1;
    }
    if (keyStart === index) {
      return undefined;
    }
    token = Object.freeze({ raw: contents.slice(keyStart, index), end: index, quoted: undefined });
  }
  const afterKey = skipYamlSpace(contents, token.end);
  if (contents[afterKey] !== ':') {
    return undefined;
  }
  return Object.freeze({
    key: decodeYamlKey(token),
    valueStart: skipYamlSpace(contents, afterKey + 1)
  });
}

function readYamlValue(contents, start) {
  if (start >= contents.length || contents[start] === '\n' || contents[start] === '\r') {
    return Object.freeze({ kind: 'plain', raw: '' });
  }
  if (contents[start] === '"' || contents[start] === "'") {
    const token = readYamlQuoted(contents, start, contents[start]);
    if (token === undefined) {
      throw invalidArtifact();
    }
    return Object.freeze({ kind: token.quoted === '"' ? 'double' : 'single', raw: token.raw });
  }
  let end = start;
  while (end < contents.length && !['\n', '\r', ',', '}'].includes(contents[end])) {
    end += 1;
  }
  return Object.freeze({ kind: 'plain', raw: contents.slice(start, end).trim() });
}

function isYamlMappingValueSeparator(contents, index) {
  const following = contents[index + 1];
  return (
    following === undefined ||
    isYamlSpace(following) ||
    following === '\n' ||
    following === '\r' ||
    following === '{' ||
    following === '[' ||
    following === '}' ||
    following === ']' ||
    following === ','
  );
}

function yamlMappingOffsets(contents) {
  const offsets = [];
  let lineStart = true;
  let comment = false;
  let quote;
  let quotedTokenStart = true;
  let previousWasSpace = true;
  const flow = [];
  for (let index = 0; index < contents.length; index += 1) {
    const character = contents[index];
    if (comment) {
      if (character === '\n' || character === '\r') {
        comment = false;
        lineStart = true;
        quotedTokenStart = true;
        previousWasSpace = true;
      }
      continue;
    }
    if (quote === '"') {
      if (character === '\n' || character === '\r') {
        throw invalidArtifact();
      }
      if (character === '\\') {
        if (index + 1 >= contents.length) {
          throw invalidArtifact();
        }
        index += 1;
      } else if (character === '"') {
        quote = undefined;
      }
      continue;
    }
    if (quote === "'") {
      if (character === '\n' || character === '\r') {
        throw invalidArtifact();
      }
      if (character === "'" && contents[index + 1] === "'") {
        index += 1;
      } else if (character === "'") {
        quote = undefined;
      }
      continue;
    }
    if (character === '\n' || character === '\r') {
      lineStart = true;
      quotedTokenStart = true;
      previousWasSpace = true;
      continue;
    }
    if (character === '#' && (lineStart || previousWasSpace)) {
      comment = true;
      continue;
    }
    const startedLine = lineStart;
    if (character === '\n') {
      lineStart = true;
      continue;
    }
    if (lineStart) {
      if (isYamlSpace(character)) {
        continue;
      }
      offsets.push(index);
      lineStart = false;
    }
    if (character === '"' || character === "'") {
      if (!quotedTokenStart) {
        throw invalidArtifact();
      }
      quote = character;
      quotedTokenStart = false;
      previousWasSpace = false;
      continue;
    }
    if (character === '{' && quotedTokenStart) {
      flow.push('{');
      offsets.push(index + 1);
      quotedTokenStart = true;
      previousWasSpace = false;
      continue;
    }
    if (character === '[' && quotedTokenStart) {
      flow.push('[');
      quotedTokenStart = true;
      previousWasSpace = false;
      continue;
    }
    if (character === '}' && flow.at(-1) === '{') {
      flow.pop();
      quotedTokenStart = false;
      previousWasSpace = false;
      continue;
    }
    if (character === ']' && flow.at(-1) === '[') {
      flow.pop();
      quotedTokenStart = false;
      previousWasSpace = false;
      continue;
    }
    if (character === ',' && flow.length > 0) {
      offsets.push(index + 1);
      quotedTokenStart = true;
      previousWasSpace = false;
      continue;
    }
    if (character === ':' && isYamlMappingValueSeparator(contents, index)) {
      quotedTokenStart = true;
      previousWasSpace = false;
      continue;
    }
    if (isYamlSpace(character)) {
      previousWasSpace = true;
      continue;
    }
    if (character === '-' && quotedTokenStart && (startedLine || flow.length > 0) && isYamlSpace(contents[index + 1])) {
      previousWasSpace = false;
      continue;
    }
    quotedTokenStart = false;
    previousWasSpace = false;
  }
  if (quote !== undefined) {
    throw invalidArtifact();
  }
  return offsets;
}

function canonicalSourceValue(key, value) {
  const raw = value.raw;
  if (value.kind === 'double') {
    const canonical = decodeYamlDoubleQuoted(raw);
    if (raw.includes('\\')) {
      // The canonical view is deliberately constructed above, but prior source
      // policy rejects escaped source scalars rather than guessing at YAML
      // continuation/manager interpretation.
      throw invalidArtifact();
    }
    return canonical.trim();
  }
  if (value.kind === 'single') {
    if (raw.includes('\\')) {
      throw invalidArtifact();
    }
    return raw.replaceAll("''", "'").trim();
  }
  if (raw.includes('\\') || /^[!&*|>]/.test(raw)) {
    throw invalidArtifact();
  }
  if (key !== 'resolution' && (raw.length === 0 || raw.startsWith('{') || raw.startsWith('['))) {
    throw invalidArtifact();
  }
  if (key === 'resolution' && (raw.length === 0 || raw.startsWith('{'))) {
    return undefined;
  }
  if (key === 'resolution' && raw.startsWith('[')) {
    throw invalidArtifact();
  }
  return raw;
}

function pnpmArtifactValues(contents) {
  const values = [];
  for (const offset of yamlMappingOffsets(contents)) {
    const mapping = readYamlKey(contents, offset);
    if (mapping === undefined || !PNPM_SOURCE_KEYS.has(mapping.key)) {
      continue;
    }
    const canonical = canonicalSourceValue(mapping.key, readYamlValue(contents, mapping.valueStart));
    if (canonical !== undefined) {
      values.push(canonical);
    }
  }
  const remote = /(?:git\+(?:https?|ssh):\/\/|(?:https?|git|ssh):\/\/|\/\/|git@|github:)[^\s,'"}\]]*/gi;
  for (const match of contents.matchAll(remote)) {
    values.push(match[0]);
  }
  return values;
}

function validateDependencySpec(specification) {
  if (typeof specification !== 'string') {
    return;
  }
  const value = specification.trim();
  if (value.startsWith('file:')) {
    const relative = value.slice('file:'.length);
    if (
      relative.length === 0 ||
      relative.startsWith('/') ||
      path.isAbsolute(relative) ||
      relative.includes('\\') ||
      relative.split('/').some(segment => segment.length === 0 || segment === '.' || segment === '..')
    ) {
      throw typedError('CONFIG_INVALID', { source: 'package-source' });
    }
    return;
  }
  if (value.startsWith('npm:')) {
    const target = value.slice('npm:'.length);
    if (REMOTE_ARTIFACT.test(target) || URL_SCHEME.test(target)) {
      throw forbiddenRemoteArtifact();
    }
    return;
  }
  if (REMOTE_ARTIFACT.test(value) || URL_SCHEME.test(value)) {
    throw forbiddenRemoteArtifact();
  }
}

function validateDependencyMap(dependencies) {
  if (dependencies === undefined) {
    return;
  }
  if (dependencies === null || typeof dependencies !== 'object' || Array.isArray(dependencies)) {
    throw typedError('CONFIG_INVALID', { source: 'package-source' });
  }
  for (const specification of Object.values(dependencies)) {
    validateDependencySpec(specification);
  }
}

function validatePackageSources(metadata) {
  for (const field of ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies']) {
    validateDependencyMap(metadata[field]);
  }
  const scanOverrides = overrides => {
    if (typeof overrides === 'string') {
      validateDependencySpec(overrides);
      return;
    }
    if (overrides !== null && typeof overrides === 'object') {
      for (const value of Object.values(overrides)) {
        scanOverrides(value);
      }
    }
  };
  scanOverrides(metadata.overrides);
}

async function validateLockSyntax(root, locks) {
  if (locks.npm) {
    const name = (await fileExists(path.join(root, 'npm-shrinkwrap.json'))) ? 'npm-shrinkwrap.json' : 'package-lock.json';
    let parsed;
    try {
      const contents = await readFile(path.join(root, name), 'utf8');
      parsed = JSON.parse(contents);
      if (parsed === null || Array.isArray(parsed) || typeof parsed !== 'object') {
        throw new TypeError('lock object required');
      }
    } catch (cause) {
      throw typedError('CONFIG_INVALID', { path: name }, cause);
    }
    scanNpmLockValue(parsed);
  }
  if (locks.pnpm) {
    let contents;
    try {
      contents = await readFile(path.join(root, 'pnpm-lock.yaml'), 'utf8');
    } catch (cause) {
      throw typedError('CONFIG_INVALID', { path: 'pnpm-lock.yaml' }, cause);
    }
    if (!/^lockfileVersion\s*:/m.test(contents)) {
      throw typedError('CONFIG_INVALID', { path: 'pnpm-lock.yaml' });
    }
    for (const value of pnpmArtifactValues(contents)) {
      validateRemoteArtifact(value);
    }
  }
}

async function selectTool(session, mode) {
  const locks = await packageLocks(session.root);
  await validateLockSyntax(session.root, locks);
  validatePackageSources(session.packageMetadata);
  const configured = metadataTool(session.packageMetadata);
  const lockedTool = locks.pnpm ? 'pnpm' : locks.npm ? 'npm' : undefined;
  if (configured !== undefined && lockedTool !== undefined && configured !== lockedTool) {
    throw typedError('LOCK_MISMATCH', { configured, lockedTool });
  }
  if (mode === 'ci' && lockedTool === undefined) {
    throw typedError('LOCK_MISMATCH', { reason: 'CI_LOCK_REQUIRED' });
  }
  return Object.freeze({ tool: lockedTool ?? configured ?? 'npm', locks });
}

async function makeOwnedDirectory(parent, prefix) {
  await mkdir(parent, { recursive: true, mode: 0o700 });
  const directory = await mkdtemp(path.join(parent, prefix));
  const identity = await lstat(directory);
  return Object.freeze({ directory, identity, directoryType: true });
}

async function makeOwnedChildDirectory(parent, name) {
  const directory = path.join(parent.directory, name);
  await mkdir(directory, { recursive: false, mode: 0o700 });
  return Object.freeze({ directory, identity: await lstat(directory), directoryType: true });
}

async function makeOwnedFile(parent, name) {
  const file = path.join(parent.directory, name);
  await writeFile(file, '', { flag: 'wx', mode: 0o600 });
  return Object.freeze({ directory: file, identity: await lstat(file), directoryType: false });
}

function sameIdentity(left, right) {
  return left.dev === right.dev && left.ino === right.ino;
}

async function removeOwnedDirectory(owned) {
  if (owned === undefined) {
    return;
  }
  let current;
  try {
    current = await lstat(owned.directory);
  } catch (cause) {
    if (cause?.code === 'ENOENT') {
      return;
    }
    throw typedError('TOOL_FAILED', { reason: 'TEMP_CLEANUP_FAILED' }, cause);
  }
  if ((owned.directoryType === true && !current.isDirectory()) || (owned.directoryType === false && !current.isFile()) || current.isSymbolicLink() || !sameIdentity(current, owned.identity)) {
    throw typedError('TOOL_FAILED', { reason: 'TEMP_CLEANUP_FAILED' });
  }
  try {
    await rm(owned.directory, { recursive: owned.directoryType === true, force: false, maxRetries: 2, retryDelay: 20 });
  } catch (cause) {
    throw typedError('TOOL_FAILED', { reason: 'TEMP_CLEANUP_FAILED' }, cause);
  }
}

async function cleanOwnedOperation(resources) {
  const failures = [];
  let runtimeChildrenClean = true;
  let cacheChildrenClean = true;
  for (const resource of [resources.home, resources.config, resources.globalConfig]) {
    try {
      await removeOwnedDirectory(resource);
    } catch (cause) {
      failures.push(cause);
      runtimeChildrenClean = false;
    }
  }
  for (const resource of [resources.cache, resources.store]) {
    try {
      await removeOwnedDirectory(resource);
    } catch (cause) {
      failures.push(cause);
      cacheChildrenClean = false;
    }
  }
  if (runtimeChildrenClean) {
    try {
      await removeOwnedDirectory(resources.runtime);
    } catch (cause) {
      failures.push(cause);
    }
  }
  if (cacheChildrenClean) {
    try {
      await removeOwnedDirectory(resources.cacheOperation);
    } catch (cause) {
      failures.push(cause);
    }
  }
  return failures;
}

function systemPath() {
  if (typeof process.env.PATH === 'string' && process.env.PATH.length > 0) {
    return process.env.PATH;
  }
  return process.platform === 'win32' ? '' : '/usr/local/bin:/usr/bin:/bin';
}

function safeEnvironment({ configPath, globalConfigPath, home, cache, store }) {
  const environment = {
    PATH: systemPath(),
    HOME: home,
    USERPROFILE: home,
    NPM_CONFIG_USERCONFIG: configPath,
    NPM_CONFIG_GLOBALCONFIG: globalConfigPath,
    NPM_CONFIG_REGISTRY: PUBLIC_REGISTRY,
    NPM_CONFIG_CACHE: cache,
    NPM_CONFIG_AUDIT: 'false',
    NPM_CONFIG_FUND: 'false',
    NPM_CONFIG_UPDATE_NOTIFIER: 'false',
    PNPM_HOME: home,
    PNPM_STORE_DIR: store
  };
  for (const key of ['SystemRoot', 'SYSTEMROOT', 'ComSpec', 'COMSPEC', 'PATHEXT']) {
    if (typeof process.env[key] === 'string' && process.env[key].length > 0) {
      environment[key] = process.env[key];
    }
  }
  return Object.freeze(environment);
}

function argumentsFor(tool, request, paths) {
  const args = tool === 'npm' ? [request.mode] : ['install'];
  if (tool === 'pnpm' && request.mode === 'ci') {
    args.push('--frozen-lockfile');
  }
  if (!request.allowScripts) {
    args.push('--ignore-scripts');
  }
  if (request.offline) {
    args.push('--offline');
  }
  args.push(`--registry=${PUBLIC_REGISTRY}`);
  if (tool === 'npm') {
    args.push(`--userconfig=${paths.configPath}`, `--globalconfig=${paths.globalConfigPath}`, `--cache=${paths.cache}`);
  } else {
    args.push(
      `--config.userconfig=${paths.configPath}`,
      `--store-dir=${paths.store}`,
      `--cache-dir=${paths.cache}`
    );
  }
  return Object.freeze(args);
}

/**
 * Runs npm or pnpm with an empty, owned configuration and an explicit public
 * registry. Ambient npm configuration and credential environment variables
 * are deliberately never forwarded.
 */
export class PublicPackageManager extends PackageManagerPort {
  #processRunner;
  #tempRoot;
  #cacheRoot;
  #timeoutMs;
  #tools;

  constructor({ processRunner, tempRoot = path.join(os.tmpdir(), 'open-cells-academy-task-3-package-runtime'), cacheRoot = path.join(os.tmpdir(), 'open-cells-academy-task-3-package-cache'), timeoutMs = 120_000, tools = {} } = {}) {
    super();
    if (processRunner === null || typeof processRunner !== 'object' || typeof processRunner.run !== 'function') {
      throw typedError('INVALID_INPUT', { field: 'processRunner' });
    }
    if (typeof tempRoot !== 'string' || !path.isAbsolute(tempRoot) || typeof cacheRoot !== 'string' || !path.isAbsolute(cacheRoot)) {
      throw typedError('INVALID_INPUT', { field: 'tempRoot' });
    }
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0) {
      throw typedError('INVALID_INPUT', { field: 'timeoutMs' });
    }
    if (tools === null || typeof tools !== 'object' || Array.isArray(tools)) {
      throw typedError('INVALID_INPUT', { field: 'tools' });
    }
    this.#processRunner = processRunner;
    this.#tempRoot = tempRoot;
    this.#cacheRoot = cacheRoot;
    this.#timeoutMs = timeoutMs;
    this.#tools = Object.freeze({ npm: tools.npm ?? 'npm', pnpm: tools.pnpm ?? 'pnpm' });
    Object.freeze(this);
  }

  async install(request, session) {
    const validated = assertRequest(request);
    assertSession(session);
    const selected = await selectTool(session, validated.mode);
    const runtime = await makeOwnedDirectory(this.#tempRoot, OWNED_PREFIX);
    const cacheOperation = await makeOwnedDirectory(this.#cacheRoot, OWNED_PREFIX);
    const home = await makeOwnedChildDirectory(runtime, 'home');
    const config = await makeOwnedFile(runtime, 'user-config');
    const globalConfig = await makeOwnedFile(runtime, 'global-config');
    const cache = await makeOwnedChildDirectory(cacheOperation, 'cache');
    const store = await makeOwnedChildDirectory(cacheOperation, 'store');
    const resources = Object.freeze({ home, config, globalConfig, cache, store, runtime, cacheOperation });
    let operationFailure;
    let installed;
    try {
      const paths = Object.freeze({
        configPath: config.directory,
        globalConfigPath: globalConfig.directory,
        cache: cache.directory,
        store: store.directory
      });
      const result = await this.#processRunner.run({
        file: this.#tools[selected.tool],
        args: argumentsFor(selected.tool, validated, paths),
        cwd: session.root,
        env: safeEnvironment({ ...paths, home: home.directory }),
        signal: validated.signal,
        timeoutMs: this.#timeoutMs,
        stdio: 'pipe'
      });
      if (result.exitCode !== 0 || result.signal !== null) {
        throw typedError('TOOL_FAILED', { tool: selected.tool, result });
      }
      installed = Object.freeze({ tool: selected.tool, mode: validated.mode, result });
    } catch (cause) {
      operationFailure = cause;
    }
    const cleanupFailures = await cleanOwnedOperation(resources);
    if (cleanupFailures.length > 0) {
      const causes = operationFailure === undefined ? cleanupFailures : [operationFailure, ...cleanupFailures];
      throw typedError('TOOL_FAILED', { reason: 'TEMP_CLEANUP_FAILED' }, new AggregateError(causes, 'Owned package operation cleanup failed'));
    }
    if (operationFailure !== undefined) {
      throw operationFailure;
    }
    return installed;
  }
}
