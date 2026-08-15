import { lstat, mkdir, readFile, readdir, realpath, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { normalizeRelativePath } from '../../domain/path-policy.js';
import { typedError } from '../../domain/workspace-session.js';
import { DevServer } from '../../ports/dev-server.js';
import { sassPreprocessorOptions } from './sass-log.js';
import {
  createOwnedStage,
  identity,
  isWithin,
  planForStage,
  readStageFile,
  regularIdentity,
  removeOwnedStage,
  sameIdentity,
  verifyOwnedStage
} from './stage-capture.js';

const DEMO_STAGE_KIND = Object.freeze({ markerName: '.open-cells-academy-demo-stage.json', kind: 'demo-build-stage', directoryPrefix: '.open-cells-academy-demo-stage-' });
const COMPONENT_STAGE_OPTIONS = Object.freeze({
  invalidCode: 'COMPONENT_DEMO_SOURCE_INVALID',
  cleanupCode: 'TRANSACTION_CLEANUP_FAILED',
  failure(cause = undefined) {
    if (cause?.code === 'COMPONENT_DEMO_SOURCE_INVALID' || cause?.code === 'PATH_CHANGED') return cause;
    return typedError('COMPONENT_DEMO_SOURCE_INVALID', undefined, cause);
  }
});

const COPY_EXCLUDE_DIR_PREFIX = Object.freeze(['test/', 'node_modules/', 'coverage/', 'dist/', 'tools/']);
const COPY_EXCLUDE_NAMES = new Set(['.git', '.DS_Store', '__snapshots__', '.open-cells-academy-recipe.json', 'wtr.academy.config.mjs']);
const COPY_EXCLUDE_NAME_PREFIX = '.open-cells-academy-';
const COPY_EXCLUDE_FILE_SUFFIX = Object.freeze(['.test.js', '.spec.js', '.test.ts', '.spec.ts']);
const RAW_APPROVED_PREFIXES = Object.freeze(['demo/', 'locales/']);
const RAW_EXTENSIONS = new Set(['.css', '.json']);
const CORS_ALLOWED_HOSTS = new Set(['127.0.0.1', 'localhost', '::1']);

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function assertApi(api) {
  if (!isRecord(api) || typeof api.createServer !== 'function' || typeof api.build !== 'function') {
    throw typedError('VITE_API_INVALID');
  }
}

function assertSession(session) {
  if (!isRecord(session) || typeof session.root !== 'string' || !path.isAbsolute(session.root)) throw typedError('WORKSPACE_INVALID');
}

function assertServerOptions(options) {
  if (!isRecord(options) || typeof options.host !== 'string' || !Number.isInteger(options.port) || options.port < 0 || options.port > 65535 || typeof options.strictPort !== 'boolean') {
    throw typedError('COMPONENT_DEV_INVALID');
  }
}

function normalizeName(value, code) {
  if (typeof value !== 'string' || value.length === 0) throw typedError(code);
  return normalizeRelativePath(value).join('/');
}

function mutableClone(value, seen = new WeakMap()) {
  if (value === null || typeof value !== 'object') return value;
  if (seen.has(value)) return seen.get(value);
  if (Array.isArray(value)) {
    const copy = [];
    seen.set(value, copy);
    for (const item of value) copy.push(mutableClone(item, seen));
    return copy;
  }
  const copy = {};
  seen.set(value, copy);
  for (const [key, item] of Object.entries(value)) copy[key] = mutableClone(item, seen);
  return copy;
}

function readyUrl(host, port) {
  const endpointHost = host === '0.0.0.0' ? '127.0.0.1' : host === '::' ? '::1' : host;
  if (endpointHost.includes('[') || endpointHost.includes(']')) throw typedError('COMPONENT_DEV_INVALID');
  const authority = endpointHost.includes(':') ? `[${endpointHost}]` : endpointHost;
  try {
    return new URL(`http://${authority}:${port}/`).href;
  } catch {
    throw typedError('COMPONENT_DEV_INVALID');
  }
}

function urlFor(server, host) {
  const address = server?.httpServer?.address?.();
  if (address !== null && typeof address === 'object' && Number.isInteger(address?.port)) {
    return Object.freeze({ url: readyUrl(host, address.port), host, port: address.port });
  }
  const url = server?.resolvedUrls?.local?.[0];
  if (typeof url !== 'string') throw typedError('COMPONENT_DEV_INVALID');
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    throw typedError('COMPONENT_DEV_INVALID');
  }
  const port = Number(parsed.port);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw typedError('COMPONENT_DEV_INVALID');
  return Object.freeze({ url: parsed.href, host, port });
}

function lifecycle(server, host) {
  if (!isRecord(server) || typeof server.close !== 'function') throw typedError('COMPONENT_DEV_INVALID');
  let closePromise;
  return new DevServer({
    ready: Promise.resolve(urlFor(server, host)),
    close() {
      closePromise ??= Promise.resolve(server.close());
      return closePromise;
    }
  });
}

async function verifyDemoRoot(session, demo) {
  const demoRoot = path.join(session.root, ...normalizeRelativePath(demo));
  let demoStatus;
  try {
    demoStatus = await lstat(demoRoot);
  } catch (cause) {
    if (cause?.code === 'ENOENT') throw typedError('COMPONENT_DEMO_ROOT_INVALID');
    throw typedError('COMPONENT_DEMO_ROOT_INVALID', undefined, cause);
  }
  if (!demoStatus.isDirectory() || demoStatus.isSymbolicLink()) throw typedError('COMPONENT_DEMO_ROOT_INVALID');
  let canonical;
  try {
    canonical = await realpath(demoRoot);
  } catch (cause) {
    throw typedError('COMPONENT_DEMO_ROOT_INVALID', undefined, cause);
  }
  if (!isWithin(session.root, canonical)) throw typedError('COMPONENT_DEMO_ROOT_INVALID');
  return Object.freeze({ demoRoot, demoIdentity: identity(demoStatus), canonical });
}

async function reverifyDemoRoot(session, demo, captured) {
  let demoStatus;
  try {
    demoStatus = await lstat(captured.demoRoot);
  } catch (cause) {
    throw typedError('PATH_CHANGED', undefined, cause);
  }
  if (!demoStatus.isDirectory() || demoStatus.isSymbolicLink() || !sameIdentity(identity(demoStatus), captured.demoIdentity)) {
    throw typedError('PATH_CHANGED');
  }
  let canonical;
  try {
    canonical = await realpath(captured.demoRoot);
  } catch (cause) {
    throw typedError('PATH_CHANGED', undefined, cause);
  }
  if (canonical !== captured.canonical || !isWithin(session.root, canonical)) throw typedError('PATH_CHANGED');
}

function componentDevConfig(session, demo, options) {
  const scss = sassPreprocessorOptions(options.sassLogLevel);
  return {
    root: session.root,
    clearScreen: options.clearScreen ?? false,
    ...(scss === undefined ? {} : { css: { preprocessorOptions: { scss } } }),
    server: { host: options.host, port: options.port, strictPort: options.strictPort, open: options.open ?? false },
    plugins: mutableClone([academyComponentDevPlugin(session, demo), ...(options.plugins ?? [])])
  };
}

function controlledCors(origin) {
  if (typeof origin !== 'string') return undefined;
  let parsed;
  try {
    parsed = new URL(origin);
  } catch {
    return undefined;
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return undefined;
  if (!CORS_ALLOWED_HOSTS.has(parsed.hostname)) return undefined;
  return origin;
}

function rawTarget(session, pathname) {
  const relative = decodeURIComponent(pathname).replace(/^\/+/, '');
  let segments;
  try {
    segments = normalizeRelativePath(relative);
  } catch {
    return undefined;
  }
  const joined = segments.join('/');
  if (!RAW_APPROVED_PREFIXES.some(prefix => joined === prefix.slice(0, -1) || joined.startsWith(prefix))) return undefined;
  if (!RAW_EXTENSIONS.has(path.extname(joined))) return undefined;
  return path.join(session.root, ...segments);
}

function academyComponentDevPlugin(session, demo) {
  return Object.freeze({
    name: 'academy-component-demo-dev',
    configureServer(server) {
      server.middlewares.use(async (request, response, next) => {
        const rawPath = rawTarget(session, request.url ?? '/');
        if (rawPath === undefined) {
          next();
          return;
        }
        try {
          const current = await lstat(rawPath);
          if (!current.isFile() || current.isSymbolicLink() || !isWithin(session.root, (await realpath(rawPath)))) {
            response.writeHead(403);
            response.end('Forbidden');
            return;
          }
          const content = await readFile(rawPath);
          const origin = controlledCors(request.headers?.origin);
          const headers = { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-cache' };
          if (rawPath.endsWith('.css')) headers['content-type'] = 'text/css; charset=utf-8';
          if (origin !== undefined) headers['access-control-allow-origin'] = origin;
          response.writeHead(200, headers);
          response.end(content);
        } catch {
          response.writeHead(403);
          response.end('Forbidden');
        }
      });
      if (typeof server.watcher?.on === 'function') {
        server.watcher.on('change', () => {
          if (typeof server.ws?.send === 'function') {
            server.ws.send({ type: 'full-reload' });
          }
        });
      }
    }
  });
}

function copyExcluded(relative) {
  if (relative.length === 0) return false;
  if (COPY_EXCLUDE_DIR_PREFIX.some(prefix => relative.startsWith(prefix))) return true;
  if (COPY_EXCLUDE_NAMES.has(path.basename(relative))) return true;
  if (path.basename(relative).startsWith(COPY_EXCLUDE_NAME_PREFIX)) return true;
  if (relative.split('/')[0].startsWith(COPY_EXCLUDE_NAME_PREFIX)) return true;
  return COPY_EXCLUDE_FILE_SUFFIX.some(suffix => relative.endsWith(suffix));
}

async function copyComponentFiles(session, stage) {
  const root = session.root;
  async function visit(directory, relative) {
    const entries = await readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
      const candidate = path.join(directory, entry.name);
      const childRelative = relative === '' ? entry.name : `${relative}/${entry.name}`;
      if (entry.isSymbolicLink()) throw typedError('COMPONENT_DEMO_SOURCE_INVALID', { path: childRelative });
      if (copyExcluded(childRelative)) continue;
      if (entry.isDirectory()) {
        await visit(candidate, childRelative);
        continue;
      }
      if (!entry.isFile()) throw typedError('COMPONENT_DEMO_SOURCE_INVALID', { path: childRelative });
      const captured = regularIdentity(await lstat(candidate), 'COMPONENT_DEMO_SOURCE_INVALID');
      const content = await readStageFile(candidate, captured, COMPONENT_STAGE_OPTIONS);
      const target = path.join(stage, ...normalizeRelativePath(childRelative));
      await mkdir(path.dirname(target), { recursive: true });
      await writeFile(target, content);
    }
  }
  await visit(root, '');
}

async function discoverDemoEntries(session, demoRoot) {
  const entries = [];
  async function visit(directory) {
    const children = await readdir(directory, { withFileTypes: true });
    for (const child of children) {
      const candidate = path.join(directory, child.name);
      if (child.isSymbolicLink()) throw typedError('COMPONENT_DEMO_SOURCE_INVALID');
      if (child.isDirectory()) {
        await visit(candidate);
        continue;
      }
      if (!child.isFile() || !child.name.endsWith('.js')) continue;
      const captured = regularIdentity(await lstat(candidate), 'COMPONENT_DEMO_SOURCE_INVALID');
      await readStageFile(candidate, captured, COMPONENT_STAGE_OPTIONS);
      const relative = path.relative(session.root, candidate).split(path.sep).join('/');
      entries.push(Object.freeze({ absolute: candidate, relative, identity: captured }));
    }
  }
  await visit(demoRoot);
  return Object.freeze(entries.sort((left, right) => left.relative.localeCompare(right.relative)));
}

async function verifyEntryUnchanged(entry) {
  let current;
  try {
    current = await lstat(entry.absolute);
  } catch (cause) {
    throw typedError('PATH_CHANGED', undefined, cause);
  }
  if (!current.isFile() || current.isSymbolicLink() || !sameIdentity(identity(current), entry.identity)) {
    throw typedError('PATH_CHANGED');
  }
  await readStageFile(entry.absolute, identity(current), COMPONENT_STAGE_OPTIONS);
}

async function createDistParent(session, dist) {
  const parentName = path.dirname(dist);
  const parent = parentName === '.' || parentName === '' ? session.root : path.join(session.root, ...normalizeRelativePath(parentName));
  let current;
  try {
    current = await lstat(parent);
  } catch (cause) {
    if (cause?.code === 'ENOENT') {
      await mkdir(parent, { recursive: false });
      return Object.freeze({ parent, created: true });
    }
    throw typedError('COMPONENT_DEMO_DIST_INVALID', undefined, cause);
  }
  if (!current.isDirectory() || current.isSymbolicLink()) throw typedError('COMPONENT_DEMO_DIST_INVALID');
  return Object.freeze({ parent, created: false });
}

async function removeNewEmptyParent(parent) {
  try {
    if ((await readdir(parent)).length === 0) await rm(parent, { recursive: false });
  } catch {}
}

function assertBuildRequest(request) {
  if (!isRecord(request) || !Object.isFrozen(request) || request.session === undefined || request.filesystem === null || typeof request.filesystem?.applyPlanAtomically !== 'function') {
    throw typedError('COMPONENT_DEMO_INVALID');
  }
  if (request.options !== undefined && !isRecord(request.options)) throw typedError('COMPONENT_DEMO_INVALID');
  if (request.logger !== undefined && (request.logger === null || typeof request.logger.info !== 'function')) throw typedError('COMPONENT_DEMO_INVALID');
  return Object.freeze({
    session: request.session,
    filesystem: request.filesystem,
    demo: request.demo === undefined ? 'demo' : normalizeName(request.demo, 'COMPONENT_DEMO_INVALID'),
    dist: request.dist === undefined ? 'dist' : normalizeName(request.dist, 'COMPONENT_DEMO_INVALID'),
    options: Object.freeze({ ...(request.options ?? {}) }),
    logger: request.logger
  });
}

/**
 * Adapter for an injected public Vite API used by the component demo dev
 * server and the component demo distribution build. Dependency resolution
 * belongs to a composition root, so importing this module never requires Vite
 * to exist.
 */
export class ComponentToolchain {
  #api;

  constructor(api) {
    assertApi(api);
    this.#api = api;
    Object.freeze(this);
  }

  async startDev(options) {
    if (!isRecord(options)) throw typedError('COMPONENT_DEV_INVALID');
    assertSession(options.session);
    assertServerOptions(options);
    await verifyDemoRoot(options.session, normalizeName(options.demo ?? 'demo', 'COMPONENT_DEV_INVALID'));
    let server;
    try {
      server = await this.#api.createServer(componentDevConfig(options.session, options.demo ?? 'demo', options));
      if (!isRecord(server) || typeof server.listen !== 'function') throw typedError('COMPONENT_DEV_INVALID');
      await server.listen();
      return lifecycle(server, options.host);
    } catch (cause) {
      if (cause?.code === 'COMPONENT_DEV_INVALID') throw cause;
      try {
        await server?.close?.();
      } catch {}
      throw typedError('COMPONENT_DEV_FAILED', undefined, cause);
    }
  }

  async buildDemo(request) {
    const normalized = assertBuildRequest(request);
    const ownedStage = await createOwnedStage(normalized.session.root, DEMO_STAGE_KIND);
    const stage = ownedStage.stage;
    let operationFailure;
    let result;
    let distParent;
    try {
      const demoRoot = await verifyDemoRoot(normalized.session, normalized.demo);
      await copyComponentFiles(normalized.session, stage);
      await reverifyDemoRoot(normalized.session, normalized.demo, demoRoot);
      const entries = await discoverDemoEntries(normalized.session, demoRoot.demoRoot);
      await reverifyDemoRoot(normalized.session, normalized.demo, demoRoot);
      for (const entry of entries) {
        try {
          await verifyEntryUnchanged(entry);
          await this.#api.build(mutableClone(Object.freeze({
            root: normalized.session.root,
            build: Object.freeze({
              outDir: stage,
              emptyOutDir: false,
              sourcemap: normalized.options?.sourceMap === true,
              rollupOptions: Object.freeze({
                input: entry.absolute,
                output: Object.freeze({ dir: stage, format: 'es', entryFileNames: entry.relative })
              })
            })
          })));
          await verifyEntryUnchanged(entry);
        } catch (cause) {
          if (cause?.code === 'PATH_CHANGED') throw cause;
          throw typedError('COMPONENT_DEMO_BUILD_FAILED', { entry: entry.relative }, cause);
        }
        if (normalized.options?.verbose !== false) {
          normalized.logger?.info(`Built demo entry ${entry.relative}`);
        }
      }
      await reverifyDemoRoot(normalized.session, normalized.demo, demoRoot);
      await verifyOwnedStage(ownedStage);
      const captured = await planForStage(stage, COMPONENT_STAGE_OPTIONS);
      await verifyOwnedStage(ownedStage);
      distParent = await createDistParent(normalized.session, normalized.dist);
      result = await normalized.filesystem.applyPlanAtomically(normalized.session, captured, normalized.dist, { replace: true });
    } catch (cause) {
      operationFailure = cause;
    }

    const cleanupFailures = [];
    try {
      await removeOwnedStage(ownedStage);
    } catch (cause) {
      cleanupFailures.push(cause);
    }
    if (distParent?.created === true) {
      await removeNewEmptyParent(distParent.parent);
    }
    if (cleanupFailures.length > 0) {
      const causes = operationFailure === undefined ? cleanupFailures : [operationFailure, ...cleanupFailures];
      throw typedError('TRANSACTION_CLEANUP_FAILED', undefined, new AggregateError(causes, 'Component demo stage cleanup failed'));
    }
    if (operationFailure !== undefined) {
      throw operationFailure;
    }
    return result;
  }
}
