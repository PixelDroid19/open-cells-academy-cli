import { fail, ok } from '../../domain/outcome.js';
import { PathPolicy, validateProjectName } from '../../domain/path-policy.js';
import { WorkspaceSession, typedError } from '../../domain/workspace-session.js';
import { composeRecipe } from '../../recipes/compose-recipe.js';

const APP_PROFILES = new Set(['blank', 'web-app', 'web-mobile-app', 'academy-app']);
const CELLS_VERSIONS = new Set(['4', '5']);
const COMPONENT_BASES = new Set(['lit1', 'lit3']);
const SIMPLE_TARBALL = /^[A-Za-z0-9][A-Za-z0-9._-]*\.tgz$/;

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value) && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
}

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function assertContext(context) {
  if (
    !isRecord(context) ||
    !isObject(context.session) ||
    typeof context.session.root !== 'string' ||
    !isObject(context.filesystem) ||
    typeof context.filesystem.applyPlanAtomically !== 'function' ||
    typeof context.filesystem.lstat !== 'function' ||
    typeof context.filesystem.readFile !== 'function' ||
    typeof context.filesystem.joinPath !== 'function' ||
    typeof context.filesystem.realpath !== 'function' ||
    typeof context.filesystem.isPathWithin !== 'function' ||
    !isObject(context.workspaceLock) ||
    typeof context.workspaceLock.acquire !== 'function' ||
    typeof context.packLocalCli !== 'function'
  ) {
    throw typedError('INVALID_INPUT', { field: 'context' });
  }
}

function assertRequest(request) {
  if (!isRecord(request) || (request.signal !== undefined && (request.signal === null || typeof request.signal !== 'object'))) {
    throw typedError('INVALID_INPUT', { field: 'request' });
  }
}

function assertBoolean(value, field) {
  if (typeof value !== 'boolean') {
    throw typedError('INVALID_INPUT', { field });
  }
  return value;
}

function assertKnownFields(input, fields) {
  if (!isRecord(input) || Object.keys(input).some(field => !fields.has(field))) {
    throw typedError('INVALID_INPUT', { field: 'scaffold' });
  }
}

function normalizeCellsVersion(cellsVersion) {
  if (cellsVersion === undefined) {
    return '5';
  }
  if (typeof cellsVersion !== 'string' || !CELLS_VERSIONS.has(cellsVersion)) {
    throw typedError('INVALID_INPUT', { field: 'cellsVersion' });
  }
  return cellsVersion;
}

function normalizeComponentBase(componentBase, cellsVersion) {
  if (componentBase === undefined) {
    return cellsVersion === '4' ? 'lit3' : undefined;
  }
  if (cellsVersion !== '4' || typeof componentBase !== 'string' || !COMPONENT_BASES.has(componentBase)) {
    throw typedError('INVALID_INPUT', { field: 'componentBase' });
  }
  return componentBase;
}

function applyCreationSchemaDefaults(input, context) {
  if (context.creationSchemaDefaults === undefined) {
    return input;
  }
  if (!isRecord(context.creationSchemaDefaults)) {
    throw typedError('INVALID_INPUT', { field: 'scaffold' });
  }
  return { ...input, ...context.creationSchemaDefaults };
}

function normalizeNamespace(namespace) {
  if (typeof namespace !== 'string' || namespace.length === 0 || namespace.trim() !== namespace || /[\u0000-\u001f\u007f/]/.test(namespace)) {
    throw typedError('INVALID_INPUT', { field: 'namespace' });
  }
  const normalized = namespace.startsWith('@') ? namespace : `@${namespace}`;
  if (!/^@[a-z0-9]+(?:[-_.][a-z0-9]+)*$/.test(normalized)) {
    throw typedError('INVALID_INPUT', { field: 'namespace' });
  }
  return normalized;
}

function normalizeComponentName(name) {
  if (typeof name !== 'string' || !/^[a-z0-9]+(?:-[a-z0-9]+)+$/.test(name)) {
    throw typedError('INVALID_INPUT', { field: 'name' });
  }
  return name;
}

async function readScaffoldFile(relativePath, context) {
  const policy = new PathPolicy(context.session, context.filesystem);
  const target = await policy.resolveRead(relativePath);
  const status = await context.filesystem.lstat(target);
  if (!status.isFile() || status.isSymbolicLink()) {
    throw typedError('PATH_INVALID', { field: 'scaffold' });
  }
  let parsed;
  try {
    parsed = JSON.parse(await context.filesystem.readFile(target, 'utf8'));
  } catch (cause) {
    throw typedError('INVALID_INPUT', { field: 'scaffold' }, cause);
  }
  if (!isRecord(parsed)) {
    throw typedError('INVALID_INPUT', { field: 'scaffold' });
  }
  return parsed;
}

async function suppliedSchema(request, context, kind) {
  if (Object.hasOwn(request, 'name')) {
    const direct = { ...request };
    delete direct.signal;
    delete direct.flags;
    return direct;
  }
  if (request.scaffold === undefined) {
    if (typeof context.prompt !== 'function') {
      throw typedError('INVALID_INPUT', { field: 'scaffold' });
    }
    const interactive = await context.prompt(Object.freeze({ kind }));
    if (!isRecord(interactive)) {
      throw typedError('INVALID_INPUT', { field: 'scaffold' });
    }
    return interactive;
  }
  if (isRecord(request.scaffold)) {
    return request.scaffold;
  }
  if (typeof request.scaffold === 'string') {
    return readScaffoldFile(request.scaffold, context);
  }
  throw typedError('INVALID_INPUT', { field: 'scaffold' });
}

function normalizeAppSchema(input) {
  assertKnownFields(input, new Set(['name', 'scaffold', 'cellsVersion', 'e2e', 'installDeps']));
  const name = validateProjectName(input.name);
  if (typeof input.scaffold !== 'string' || !APP_PROFILES.has(input.scaffold)) {
    throw typedError('INVALID_INPUT', { field: 'scaffold' });
  }
  return Object.freeze({
    kind: 'app',
    name,
    profile: input.scaffold,
    cellsVersion: normalizeCellsVersion(input.cellsVersion),
    e2e: input.e2e === undefined ? false : assertBoolean(input.e2e, 'e2e'),
    installDeps: input.installDeps === undefined ? false : assertBoolean(input.installDeps, 'installDeps')
  });
}

function normalizeFlags(flags) {
  if (flags === undefined) {
    return Object.freeze({});
  }
  if (!isRecord(flags) || Object.keys(flags).some(field => field !== 'e2e' && field !== 'installDeps')) {
    throw typedError('INVALID_INPUT', { field: 'flags' });
  }
  const normalized = {};
  for (const [name, value] of Object.entries(flags)) {
    normalized[name] = assertBoolean(value, name);
  }
  return Object.freeze(normalized);
}

function resolvedBoolean(input, flags, name) {
  if (input[name] !== undefined && flags[name] !== undefined && input[name] !== flags[name]) {
    throw typedError('INVALID_INPUT', { field: name });
  }
  return flags[name] ?? input[name] ?? false;
}

function normalizeComponentSchema(input, flags) {
  assertKnownFields(input, new Set(['name', 'namespace', 'cellsVersion', 'componentBase', 'e2e', 'installDeps']));
  const name = normalizeComponentName(input.name);
  const namespace = normalizeNamespace(input.namespace);
  const cellsVersion = normalizeCellsVersion(input.cellsVersion);
  const componentBase = normalizeComponentBase(input.componentBase, cellsVersion);
  const normalized = {
    kind: 'component',
    name,
    namespace,
    packageName: `${namespace}/${name}`,
    profile: 'component',
    cellsVersion,
    e2e: resolvedBoolean(input, flags, 'e2e'),
    installDeps: resolvedBoolean(input, flags, 'installDeps')
  };
  if (componentBase !== undefined) {
    normalized.componentBase = componentBase;
  }
  return Object.freeze(normalized);
}

function assertArtifact(value) {
  if (
    !isRecord(value) ||
    typeof value.fileName !== 'string' ||
    !SIMPLE_TARBALL.test(value.fileName) ||
    !(value.content instanceof Uint8Array) ||
    value.content.length === 0 ||
    typeof value.integrity !== 'string' ||
    !/^sha512-[A-Za-z0-9+/]+={0,2}$/.test(value.integrity)
  ) {
    throw typedError('PACK_INVALID');
  }
  return Object.freeze({ fileName: value.fileName, content: new Uint8Array(value.content), integrity: value.integrity });
}

function failure(cause, details = {}) {
  return fail(cause?.code ?? 'TOOL_FAILED', cause?.code === 'TOOL_FAILED' ? 'installFailed' : 'createFailed', details, undefined, cause);
}

async function create(kind, request, context) {
  try {
    assertContext(context);
    assertRequest(request);
    const input = await suppliedSchema(request, context, kind);
    const schema = applyCreationSchemaDefaults(input, context);
    const normalized = kind === 'app' ? normalizeAppSchema(schema) : normalizeComponentSchema(schema, normalizeFlags(request.flags));
    composeRecipe(normalized.profile, normalized);
    const signal = request.signal;
    const handle = await context.workspaceLock.acquire(context.session, `${kind}:create`, signal);
    try {
      if (signal?.aborted === true) {
        throw typedError('INTERRUPTED');
      }
      const artifact = assertArtifact(await context.packLocalCli(Object.freeze({ session: context.session, signal, kind, name: normalized.name })));
      const plan = composeRecipe(normalized.profile, { ...normalized, localCli: artifact });
      const published = await context.filesystem.applyPlanAtomically(context.session, plan, normalized.name, { signal });
      if (normalized.installDeps) {
        if (!isObject(context.packageManager) || typeof context.packageManager.install !== 'function') {
          throw typedError('INVALID_INPUT', { field: 'packageManager' });
        }
        const targetSession = await WorkspaceSession.open(published.destination, context.filesystem);
        try {
          await context.packageManager.install(
            Object.freeze({ mode: 'install', allowScripts: false, offline: false, signal }),
            targetSession
          );
        } catch (cause) {
          return failure(cause, { published: true, destination: published.destination });
        }
      }
      return ok({ destination: published.destination, profile: normalized.profile, integrity: artifact.integrity, tarball: artifact.fileName });
    } finally {
      await handle.release();
    }
  } catch (cause) {
    return failure(cause);
  }
}

export async function createApplication(request, context) {
  return create('app', request, context);
}

export async function createComponentProject(request, context) {
  return create('component', request, context);
}
