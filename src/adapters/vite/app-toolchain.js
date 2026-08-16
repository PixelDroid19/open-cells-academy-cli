import { cp, lstat, mkdir, readFile, readdir, realpath, rmdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

import { ScaffoldPlan } from '../../domain/scaffold-plan.js';
import { normalizeRelativePath } from '../../domain/path-policy.js';
import { typedError } from '../../domain/workspace-session.js';
import { DevServer } from '../../ports/dev-server.js';
import { generateAppHtml } from './html-generator.js';
import { sassPreprocessorOptions } from './sass-log.js';
import { createLegacyAppPlugins } from './legacy-app-runtime.js';
import {
  captureStageDirectory,
  createOwnedStage,
  directoryIdentity,
  identity,
  isWithin,
  planForStage,
  readStageFile,
  removeOwnedStage,
  regularIdentity,
  sameIdentity,
  status,
  verifyOwnedStage
} from './stage-capture.js';

const VITE_STAGE_KIND = Object.freeze({ markerName: '.open-cells-academy-vite-stage.json', kind: 'vite-build-stage', directoryPrefix: '.open-cells-academy-vite-stage-' });
const ACADEMY_APP_RECIPE = '.open-cells-academy-recipe.json';
const APP_STAGE_OPTIONS = Object.freeze({
  invalidCode: 'APP_BUILD_SOURCE_INVALID',
  cleanupCode: 'TRANSACTION_CLEANUP_FAILED',
  failure(cause = undefined) {
    if (cause?.code === 'APP_BUILD_SOURCE_INVALID' || cause?.code === 'PATH_CHANGED') return cause;
    return typedError('APP_BUILD_SOURCE_INVALID', undefined, cause);
  }
});

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
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

function assertApi(api) {
  if (!isRecord(api) || typeof api.createServer !== 'function' || typeof api.build !== 'function' || typeof api.preview !== 'function') {
    throw typedError('VITE_API_INVALID');
  }
}

function assertSession(session) {
  if (!isRecord(session) || typeof session.root !== 'string' || !path.isAbsolute(session.root)) throw typedError('WORKSPACE_INVALID');
}

function assertServerOptions(options) {
  if (!isRecord(options) || typeof options.host !== 'string' || !Number.isInteger(options.port) || options.port < 0 || options.port > 65535 || typeof options.strictPort !== 'boolean') {
    throw typedError('VITE_OPTIONS_INVALID');
  }
}

function outputName(configName) {
  let segments;
  try {
    segments = normalizeRelativePath(configName);
  } catch {
    throw typedError('VITE_OPTIONS_INVALID');
  }
  const fileName = segments.at(-1);
  if (
    typeof configName !== 'string' ||
    !/^[A-Za-z0-9][A-Za-z0-9._-]*\.(?:js|mjs)$/.test(fileName) ||
    segments.slice(0, -1).some(segment => !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(segment))
  ) throw typedError('VITE_OPTIONS_INVALID');
  return [...segments.slice(0, -1), fileName.replace(/\.m?js$/, '')].join('/');
}

function readyUrl(host, port) {
  const endpointHost = host === '0.0.0.0' ? '127.0.0.1' : host === '::' ? '::1' : host;
  if (endpointHost.includes('[') || endpointHost.includes(']')) throw typedError('VITE_SERVER_INVALID');
  const authority = endpointHost.includes(':') ? `[${endpointHost}]` : endpointHost;
  try {
    return new URL(`http://${authority}:${port}/`).href;
  } catch {
    throw typedError('VITE_SERVER_INVALID');
  }
}

function urlFor(server, host) {
  const address = server?.httpServer?.address?.();
  if (address !== null && typeof address === 'object' && Number.isInteger(address?.port)) {
    return Object.freeze({ url: readyUrl(host, address.port), host, port: address.port });
  }
  const url = server?.resolvedUrls?.local?.[0];
  if (typeof url !== 'string') throw typedError('VITE_SERVER_INVALID');
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    throw typedError('VITE_SERVER_INVALID');
  }
  const port = Number(parsed.port);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw typedError('VITE_SERVER_INVALID');
  return Object.freeze({ url: parsed.href, host, port });
}

function lifecycle(server, host, onDispose) {
  if (!isRecord(server) || typeof server.close !== 'function') throw typedError('VITE_SERVER_INVALID');
  let closePromise;
  return new DevServer({
    ready: Promise.resolve(urlFor(server, host)),
    close() {
      closePromise ??= Promise.resolve(server.close()).finally(() => {
        if (onDispose !== undefined) onDispose();
      });
      return closePromise;
    }
  });
}

function enableViteDebugLogging() {
  const previous = process.env.DEBUG;
  process.env.DEBUG = previous === undefined || previous === '' ? 'vite:*' : `${previous},vite:*`;
  return () => {
    if (previous === undefined) delete process.env.DEBUG;
    else process.env.DEBUG = previous;
  };
}

function cssOverride(options) {
  const scss = sassPreprocessorOptions(options.sassLogLevel);
  if (scss === undefined) return {};
  return { css: { preprocessorOptions: { scss } } };
}

function devConfig(session, options, appRoot) {
  return {
    root: appRoot,
    clearScreen: options.clearScreen ?? false,
    ...cssOverride(options),
    server: { host: options.host, port: options.port, strictPort: options.strictPort, open: options.open ?? false },
    plugins: mutableClone(options.plugins ?? [])
  };
}

function previewConfig(session, configName, options, appRoot) {
  return {
    root: appRoot,
    build: { outDir: path.join(session.root, 'build', outputName(configName)) },
    preview: { host: options.host, port: options.port, strictPort: options.strictPort, open: options.open ?? false },
    plugins: mutableClone(options.plugins ?? [])
  };
}

function appValues(config) {
  const app = config.app ?? {};
  return Object.freeze({
    app: Object.freeze({
      lang: app.lang ?? 'en',
      title: app.title ?? '',
      description: app.description ?? '',
      header: app.header ?? '',
      name: app.name ?? '',
      version: app.version ?? ''
    }),
    env: Object.freeze({ mode: 'production' })
  });
}

function htmlPlugin(html) {
  return Object.freeze({
    name: 'academy-html',
    transformIndexHtml: Object.freeze({
      order: 'pre',
      handler(source) {
        return source.includes('##app.lang##') ? html : source;
      }
    })
  });
}

function sourceMapValue(build, options) {
  if (options.sourceMap !== undefined) return options.sourceMap === true;
  return build.sourcemap === true || build.sourceMap === true;
}

function buildConfig(options) {
  const configured = isRecord(options.build) ? options.build : {};
  return {
    ...mutableClone(configured),
    outDir: options.outDir,
    emptyOutDir: true,
    sourcemap: sourceMapValue(configured, options)
  };
}

function sourceFailure(cause = undefined) {
  if (cause?.code === 'APP_BUILD_SOURCE_INVALID' || cause?.code === 'PATH_CHANGED') return cause;
  return typedError('APP_BUILD_SOURCE_INVALID', undefined, cause);
}

function changedSourceFailure(cause = undefined) {
  if (cause?.code === 'PATH_CHANGED') return cause;
  return typedError('PATH_CHANGED', undefined, cause);
}

function isAcademyAppRecipe(contents) {
  try {
    const recipe = JSON.parse(contents);
    return isRecord(recipe) && recipe.schema === 1 && recipe.kind === 'app';
  } catch {
    return false;
  }
}

async function captureTemplateSource(session, appRoot, markerPath = undefined) {
  const rootPath = session.root;
  const templatePath = path.join(appRoot, 'index.html');
  try {
    const [root, app, template] = await Promise.all([lstat(rootPath), lstat(appRoot), lstat(templatePath)]);
    if (
      !root.isDirectory() ||
      root.isSymbolicLink() ||
      !app.isDirectory() ||
      app.isSymbolicLink() ||
      !template.isFile() ||
      template.isSymbolicLink()
    ) {
      throw typedError('APP_BUILD_SOURCE_INVALID');
    }
    const [canonicalRoot, canonicalApp, canonicalTemplate] = await Promise.all([realpath(rootPath), realpath(appRoot), realpath(templatePath)]);
    if (!isWithin(canonicalRoot, canonicalApp) || !isWithin(canonicalApp, canonicalTemplate)) {
      throw typedError('APP_BUILD_SOURCE_INVALID');
    }
    let marker;
    let canonicalMarker;
    let markerContent;
    if (markerPath !== undefined) {
      marker = await lstat(markerPath);
      if (!marker.isFile() || marker.isSymbolicLink()) throw typedError('APP_BUILD_SOURCE_INVALID');
      canonicalMarker = await realpath(markerPath);
      if (!isWithin(canonicalRoot, canonicalMarker)) throw typedError('APP_BUILD_SOURCE_INVALID');
      markerContent = (await readStageFile(markerPath, identity(marker), APP_STAGE_OPTIONS)).toString('utf8');
      if (!isAcademyAppRecipe(markerContent)) throw typedError('APP_BUILD_SOURCE_INVALID');
    }
    const templateContent = (await readStageFile(templatePath, identity(template), APP_STAGE_OPTIONS)).toString('utf8');
    const source = Object.freeze({
      rootPath,
      rootIdentity: identity(root),
      canonicalRoot,
      appRoot,
      appIdentity: identity(app),
      canonicalApp,
      templatePath,
      templateIdentity: identity(template),
      canonicalTemplate,
      templateContent,
      markerPath,
      markerIdentity: marker === undefined ? undefined : identity(marker),
      canonicalMarker,
      markerContent
    });
    await verifyAppTemplate(source);
    return source;
  } catch (cause) {
    throw sourceFailure(cause);
  }
}

async function captureLegacyAppTemplate(session) {
  const appRoot = path.join(session.root, 'app');
  const app = await status(appRoot);
  if (app === undefined) return undefined;
  if (!app.isDirectory() || app.isSymbolicLink()) throw typedError('APP_BUILD_SOURCE_INVALID');
  const template = await status(path.join(appRoot, 'index.html'));
  if (template === undefined) return undefined;
  if (!template.isFile() || template.isSymbolicLink()) throw typedError('APP_BUILD_SOURCE_INVALID');
  return captureTemplateSource(session, appRoot);
}

async function captureAcademyRootTemplate(session) {
  return captureTemplateSource(session, session.root, path.join(session.root, ACADEMY_APP_RECIPE));
}

async function captureAppTemplate(session) {
  try {
    const legacy = await captureLegacyAppTemplate(session);
    return legacy ?? await captureAcademyRootTemplate(session);
  } catch (cause) {
    throw sourceFailure(cause);
  }
}

async function verifyAppTemplate(source) {
  try {
    const [root, app, template] = await Promise.all([lstat(source.rootPath), lstat(source.appRoot), lstat(source.templatePath)]);
    if (
      !root.isDirectory() ||
      root.isSymbolicLink() ||
      !app.isDirectory() ||
      app.isSymbolicLink() ||
      !template.isFile() ||
      template.isSymbolicLink() ||
      !sameIdentity(identity(root), source.rootIdentity) ||
      !sameIdentity(identity(app), source.appIdentity) ||
      !sameIdentity(identity(template), source.templateIdentity)
    ) {
      throw typedError('PATH_CHANGED');
    }
    const [canonicalRoot, canonicalApp, canonicalTemplate] = await Promise.all([realpath(source.rootPath), realpath(source.appRoot), realpath(source.templatePath)]);
    if (
      canonicalRoot !== source.canonicalRoot ||
      canonicalApp !== source.canonicalApp ||
      canonicalTemplate !== source.canonicalTemplate ||
      !isWithin(canonicalRoot, canonicalApp) ||
      !isWithin(canonicalApp, canonicalTemplate)
    ) throw typedError('PATH_CHANGED');
    const templateContent = (await readStageFile(source.templatePath, source.templateIdentity, {
      invalidCode: 'PATH_CHANGED',
      failure: changedSourceFailure
    })).toString('utf8');
    if (templateContent !== source.templateContent) throw typedError('PATH_CHANGED');
    if (source.markerPath !== undefined) {
      const marker = await lstat(source.markerPath);
      if (
        !marker.isFile() ||
        marker.isSymbolicLink() ||
        !sameIdentity(identity(marker), source.markerIdentity)
      ) throw typedError('PATH_CHANGED');
      const canonicalMarker = await realpath(source.markerPath);
      if (canonicalMarker !== source.canonicalMarker || !isWithin(canonicalRoot, canonicalMarker)) throw typedError('PATH_CHANGED');
      const markerContent = (await readStageFile(source.markerPath, source.markerIdentity, {
        invalidCode: 'PATH_CHANGED',
        failure: changedSourceFailure
      })).toString('utf8');
      if (markerContent !== source.markerContent || !isAcademyAppRecipe(markerContent)) throw typedError('PATH_CHANGED');
    }
  } catch (cause) {
    if (cause?.code === 'PATH_CHANGED') throw cause;
    throw typedError('PATH_CHANGED', undefined, cause);
  }
}

async function readCapturedAppTemplate(source) {
  await verifyAppTemplate(source);
  return source.templateContent;
}

async function copyIfPresent(source, target) {
  const sourceStatus = await status(source);
  if (sourceStatus === undefined) return;
  if (sourceStatus.isSymbolicLink()) throw typedError('APP_BUILD_SOURCE_INVALID');
  if (sourceStatus.isDirectory()) {
    await cp(source, target, { recursive: true, dereference: false, errorOnExist: false });
    return;
  }
  if (sourceStatus.isFile()) {
    await mkdir(path.dirname(target), { recursive: true });
    await cp(source, target, { dereference: false, errorOnExist: false });
    return;
  }
  throw typedError('APP_BUILD_SOURCE_INVALID');
}

async function writeLocalePlan(stage, plan) {
  for (const file of ScaffoldPlan.snapshot(plan).files) {
    const relative = file.path.replace(/^dist\//, '');
    const target = path.join(stage, ...normalizeRelativePath(relative));
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, file.content);
  }
}

function workspacePath(root, relative) {
  return path.join(root, ...normalizeRelativePath(relative));
}

async function serviceWorker(stage, request) {
  if (request === undefined) return false;
  if (!isRecord(request) || request.adapter === null || typeof request.adapter?.build !== 'function' || (request.mode !== 'generateSW' && request.mode !== 'injectManifest')) {
    throw typedError('SERVICE_WORKER_INVALID');
  }
  const options = request.options ?? {};
  if (!isRecord(options)) throw typedError('SERVICE_WORKER_INVALID');
  const canonical = {
    ...options,
    mode: request.mode,
    swDest: path.join(stage, 'sw.js'),
    globDirectory: stage
  };
  let swSrcGuard;
  if (request.mode === 'injectManifest') {
    if (typeof options.swSrc !== 'string') throw typedError('SERVICE_WORKER_INVALID');
    const swSrc = workspacePath(stage, options.swSrc);
    const swStatus = await status(swSrc);
    if (swStatus === undefined || !swStatus.isFile() || swStatus.isSymbolicLink()) throw typedError('SERVICE_WORKER_INVALID');
    const swIdentity = regularIdentity(swStatus);
    const swContent = await readStageFile(swSrc, swIdentity, APP_STAGE_OPTIONS);
    swSrcGuard = Object.freeze({ content: swContent, identity: swIdentity, path: swSrc });
    canonical.swSrc = swSrc;
  }
  try {
    await request.adapter.build(Object.freeze(canonical));
  } catch (cause) {
    if (cause?.code === 'SERVICE_WORKER_FAILED') throw cause;
    throw typedError('SERVICE_WORKER_FAILED');
  }
  if (swSrcGuard !== undefined) {
    const afterStatus = await status(canonical.swSrc);
    if (afterStatus === undefined || !afterStatus.isFile() || afterStatus.isSymbolicLink()) throw typedError('SERVICE_WORKER_FAILED');
    const afterIdentity = regularIdentity(afterStatus);
    const afterContent = await readStageFile(canonical.swSrc, afterIdentity, APP_STAGE_OPTIONS);
    if (!sameIdentity(afterIdentity, swSrcGuard.identity) || !afterContent.equals(swSrcGuard.content)) {
      throw typedError('SERVICE_WORKER_FAILED');
    }
  }
  return true;
}

async function appendRegistration(stage) {
  const target = path.join(stage, 'index.html');
  const html = await readFile(target, 'utf8');
  const registration = '<script>navigator.serviceWorker.register(\'./sw.js\')</script>';
  await writeFile(target, html.includes('</body>') ? html.replace('</body>', `${registration}</body>`) : `${html}${registration}`);
}

async function createBuildParent(session) {
  const parent = path.join(session.root, 'build');
  const current = await status(parent);
  if (current !== undefined) {
    if (!current.isDirectory() || current.isSymbolicLink()) throw typedError('DESTINATION_PARENT_INVALID');
    return Object.freeze({ parent, created: false });
  }
  await mkdir(parent, { recursive: false });
  return Object.freeze({ parent, created: true });
}

async function ensureBuildParents(request, name) {
  const root = await createBuildParent(request.session);
  const directories = name.split('/').slice(0, -1);
  let relative = 'build';
  for (const directory of directories) {
    relative = `${relative}/${directory}`;
    const target = path.join(request.session.root, ...relative.split('/'));
    const current = await status(target);
    if (current === undefined) {
      await request.filesystem.applyPlanAtomically(request.session, ScaffoldPlan.empty(), relative);
    } else if (!current.isDirectory() || current.isSymbolicLink()) {
      throw typedError('DESTINATION_PARENT_INVALID');
    }
  }
  return root;
}

async function removeNewEmptyParent(parent) {
  try {
    if ((await readdir(parent)).length === 0) await rmdir(parent);
  } catch {}
}

function assertBuildRequest(request) {
  if (!isRecord(request) || !Object.isFrozen(request) || request.session === undefined || request.filesystem === null || typeof request.filesystem?.applyPlanAtomically !== 'function' || typeof request.configName !== 'string' || !isRecord(request.config)) {
    throw typedError('APP_BUILD_INVALID');
  }
  if (request.options !== undefined && !isRecord(request.options)) throw typedError('APP_BUILD_INVALID');
  if (request.localePlan !== undefined && !(request.localePlan instanceof ScaffoldPlan)) throw typedError('APP_BUILD_INVALID');
}

/**
 * Adapter for an injected public Vite API. Dependency resolution belongs to a
 * composition root, so importing this module never requires Vite to exist.
 */
export class AppToolchain {
  #api;

  constructor(api) {
    assertApi(api);
    this.#api = api;
    Object.freeze(this);
  }

  async startDev(options) {
    if (!isRecord(options)) throw typedError('VITE_OPTIONS_INVALID');
    assertSession(options.session);
    assertServerOptions(options);
    const restoreDebug = options.debug === true ? enableViteDebugLogging() : undefined;
    let server;
    try {
      const appSource = await captureAppTemplate(options.session);
      await verifyAppTemplate(appSource);
      const legacyPlugins = appSource.markerPath === undefined && options.config !== undefined
        ? await createLegacyAppPlugins(Object.freeze({ session: options.session, configName: options.configName, config: options.config }))
        : Object.freeze([]);
      const preparedOptions = { ...options, plugins: [...legacyPlugins, ...(options.plugins ?? [])] };
      server = await this.#api.createServer(devConfig(options.session, preparedOptions, appSource.appRoot));
      if (!isRecord(server) || typeof server.listen !== 'function') throw typedError('VITE_SERVER_INVALID');
      await server.listen();
      await verifyAppTemplate(appSource);
      return lifecycle(server, options.host, restoreDebug);
    } catch (cause) {
      if (restoreDebug !== undefined) restoreDebug();
      if (cause?.code === 'VITE_SERVER_INVALID' || cause?.code === 'APP_BUILD_SOURCE_INVALID' || cause?.code === 'PATH_CHANGED') throw cause;
      try {
        await server?.close?.();
      } catch {}
      throw typedError('VITE_DEV_FAILED');
    }
  }

  async build(options) {
    if (!isRecord(options) || typeof options.root !== 'string' || typeof options.outDir !== 'string') throw typedError('VITE_OPTIONS_INVALID');
    try {
      return await this.#api.build({
        root: options.root,
        base: './',
        ...cssOverride(options),
        plugins: mutableClone(options.plugins ?? []),
        build: buildConfig(options)
      });
    } catch {
      throw typedError('VITE_BUILD_FAILED');
    }
  }

  async buildApp(request) {
    assertBuildRequest(request);
    assertSession(request.session);
    const appSource = await captureAppTemplate(request.session);
    const template = await readCapturedAppTemplate(appSource);
    const ownedStage = await createOwnedStage(request.session.root, VITE_STAGE_KIND);
    const stage = ownedStage.stage;
    let buildParent;
    let operationFailure;
    let result;
    try {
      const legacyPlugins = appSource.markerPath === undefined
        ? await createLegacyAppPlugins(Object.freeze({ session: request.session, configName: request.configName, config: request.config }))
        : Object.freeze([]);
      const academyHtml = appSource.markerPath === undefined && template.includes('##app.lang##')
        ? generateAppHtml({ template, values: appValues(request.config) })
        : undefined;
      await verifyAppTemplate(appSource);
      await this.build(Object.freeze({
        root: appSource.appRoot,
        outDir: stage,
        build: request.config.build,
        sourceMap: request.options?.sourceMap,
        sassLogLevel: request.options?.sassLogLevel,
        plugins: Object.freeze([...legacyPlugins, ...(academyHtml === undefined ? [] : [htmlPlugin(academyHtml)])])
      }));
      await verifyAppTemplate(appSource);
      await verifyOwnedStage(ownedStage);
      for (const name of ['resources', 'vendor', 'manifest.json']) {
        await verifyAppTemplate(appSource);
        await copyIfPresent(path.join(appSource.appRoot, name), path.join(stage, name));
      }
      if (request.serviceWorker?.mode === 'injectManifest' && typeof request.serviceWorker.options?.swSrc === 'string') {
        const source = workspacePath(request.session.root, request.serviceWorker.options.swSrc);
        await copyIfPresent(source, workspacePath(stage, request.serviceWorker.options.swSrc));
      }
      if (request.localePlan !== undefined) await writeLocalePlan(stage, request.localePlan);
      if (await serviceWorker(stage, request.serviceWorker)) await appendRegistration(stage);
      await verifyOwnedStage(ownedStage);
      const plan = await planForStage(stage, APP_STAGE_OPTIONS);
      await verifyOwnedStage(ownedStage);
      const name = outputName(request.configName);
      buildParent = await ensureBuildParents(request, name);
      result = await request.filesystem.applyPlanAtomically(request.session, plan, `build/${name}`, { replace: true });
    } catch (cause) {
      operationFailure = cause;
    }

    const cleanupFailures = [];
    try {
      await removeOwnedStage(ownedStage);
    } catch (cause) {
      cleanupFailures.push(cause);
    }
    if (buildParent?.created === true) {
      await removeNewEmptyParent(buildParent.parent);
    }
    if (cleanupFailures.length > 0) {
      const causes = operationFailure === undefined ? cleanupFailures : [operationFailure, ...cleanupFailures];
      const details = operationFailure?.code === undefined ? undefined : { operationCode: operationFailure.code };
      throw typedError('TRANSACTION_CLEANUP_FAILED', details, new AggregateError(causes, 'Vite build stage cleanup failed'));
    }
    if (operationFailure !== undefined) {
      throw operationFailure;
    }
    return result;
  }

  async startPreview(options) {
    if (!isRecord(options)) throw typedError('VITE_OPTIONS_INVALID');
    assertSession(options.session);
    assertServerOptions(options);
    const appSource = await captureAppTemplate(options.session);
    await verifyAppTemplate(appSource);
    const config = previewConfig(options.session, options.configName, options, appSource.appRoot);
    try {
      const output = await lstat(config.build.outDir);
      if (!output.isDirectory() || output.isSymbolicLink()) throw new Error('Build missing');
    } catch {
      throw typedError('BUILD_NOT_FOUND');
    }
    let server;
    try {
      server = await this.#api.preview(config);
      await verifyAppTemplate(appSource);
      return lifecycle(server, options.host);
    } catch (cause) {
      if (cause?.code === 'VITE_SERVER_INVALID' || cause?.code === 'APP_BUILD_SOURCE_INVALID' || cause?.code === 'PATH_CHANGED') throw cause;
      try {
        await server?.close?.();
      } catch {}
      throw typedError('VITE_PREVIEW_FAILED');
    }
  }
}
