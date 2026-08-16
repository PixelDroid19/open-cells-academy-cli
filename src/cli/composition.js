import { existsSync, readFileSync } from 'node:fs';
import { lstat, mkdir, mkdtemp, readFile, readdir, rmdir, unlink } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createRequire as createRequireDefault } from 'node:module';

import { fail, ok } from '../domain/outcome.js';
import { ScaffoldPlan } from '../domain/scaffold-plan.js';
import { normalizeRelativePath } from '../domain/path-policy.js';
import { testRunnerForManifest } from '../domain/test-runner-policy.js';
import { WorkspaceSession, typedError } from '../domain/workspace-session.js';
import { NodeFilesystem } from '../adapters/node/node-filesystem.js';
import { isWithin, sameIdentity } from '../adapters/vite/stage-capture.js';
import { NodeProcessRunner } from '../adapters/node/process-runner.js';
import { FileWorkspaceLock } from '../adapters/node/file-workspace-lock.js';
import { NodePackageSelf } from '../adapters/node/package-self.js';
import { PublicPackageManager } from '../adapters/node/public-package-manager.js';
import { GitAdapter } from '../adapters/node/git-adapter.js';
import { AtomicTextDocuments } from '../adapters/node/atomic-text-documents.js';
import { AppToolchain } from '../adapters/vite/app-toolchain.js';
import { discoverAppLocaleSources } from '../adapters/vite/locale-discovery.js';
import { ComponentToolchain } from '../adapters/vite/component-toolchain.js';
import { ServiceWorker } from '../adapters/workbox/service-worker.js';
import { SassCompiler } from '../adapters/sass/sass-compiler.js';
import { EslintAdapter } from '../adapters/eslint/eslint-adapter.js';
import { CemAnalyzer } from '../adapters/cem/cem-analyzer.js';
import { DocsWriter } from '../adapters/cem/docs-writer.js';
import { BrowserCapability } from '../adapters/testing/browser-capability.js';
import { ChromiumProbe } from '../adapters/testing/chromium-probe.js';
import { VitestBrowserRunner } from '../adapters/testing/vitest-browser-runner.js';
import { WtrRunner } from '../adapters/testing/wtr-runner.js';

import { createApp } from '../application/app/create-app.js';
import { buildApp } from '../application/app/build-app.js';
import { devApp } from '../application/app/dev-app.js';
import { previewApp } from '../application/app/preview-app.js';
import { lintApp } from '../application/app/lint-app.js';
import { testApp } from '../application/app/test-app.js';
import { createComponent } from '../application/component/create-component.js';
import { devComponent } from '../application/component/dev-component.js';
import { buildComponentDemo } from '../application/component/build-demo.js';
import { lintComponent } from '../application/component/lint-component.js';
import { testComponent } from '../application/component/test-component.js';
import { documentComponent } from '../application/component/document-component.js';
import { compileSass } from '../application/component/compile-sass.js';
import { generateAppLocales } from '../application/app/generate-locales.js';
import { generateComponentLocales } from '../application/component/generate-locales.js';
import { installProject } from '../application/shared/install-project.js';
import { generateChangelog } from '../application/shared/generate-changelog.js';

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

const PUBLIC_TOOL_SPECS = Object.freeze({
  vite: Object.freeze({ specifier: 'vite', condition: 'vite' }),
  workbox: Object.freeze({ specifier: 'workbox-build', condition: 'workbox-build' }),
  sass: Object.freeze({ specifier: 'sass', condition: 'sass' }),
  eslint: Object.freeze({ specifier: 'eslint', condition: 'eslint' }),
  cem: Object.freeze({ specifier: '@custom-elements-manifest/analyzer', condition: 'cem' }),
  vitest: Object.freeze({ specifier: 'vitest', condition: 'vitest' }),
  wtr: Object.freeze({ specifier: '@web/test-runner', condition: 'wtr' })
});

async function removePortablePackRoot(root, rootIdentity) {
  const currentRoot = await lstat(root);
  if (!currentRoot.isDirectory() || currentRoot.isSymbolicLink() || !sameIdentity(currentRoot, rootIdentity)) {
    throw typedError('PACK_CLEANUP_FAILED');
  }
  const rootEntries = await readdir(root);
  if (rootEntries.length === 0) {
    await rmdir(root);
    return;
  }
  if (rootEntries.length !== 1 || rootEntries[0] !== 'archive') {
    throw typedError('PACK_CLEANUP_FAILED');
  }
  const archive = path.join(root, 'archive');
  const archiveIdentity = await lstat(archive);
  if (!archiveIdentity.isDirectory() || archiveIdentity.isSymbolicLink()) {
    throw typedError('PACK_CLEANUP_FAILED');
  }
  const archiveEntries = await readdir(archive);
  if (archiveEntries.length > 1) {
    throw typedError('PACK_CLEANUP_FAILED');
  }
  if (archiveEntries.length === 1) {
    const tarball = path.join(archive, archiveEntries[0]);
    const tarballIdentity = await lstat(tarball);
    if (!tarballIdentity.isFile() || tarballIdentity.isSymbolicLink() || !/^open-cells-academy-cli-\d+\.\d+\.\d+\.tgz$/.test(archiveEntries[0])) {
      throw typedError('PACK_CLEANUP_FAILED');
    }
    await unlink(tarball);
  }
  const archiveAfter = await lstat(archive);
  if (!sameIdentity(archiveAfter, archiveIdentity) || (await readdir(archive)).length !== 0) {
    throw typedError('PACK_CLEANUP_FAILED');
  }
  await rmdir(archive);
  const rootAfter = await lstat(root);
  if (!sameIdentity(rootAfter, rootIdentity) || (await readdir(root)).length !== 0) {
    throw typedError('PACK_CLEANUP_FAILED');
  }
  await rmdir(root);
}

async function resolvePublicTool(name, candidateRoot, createRequireFrom) {
  const spec = PUBLIC_TOOL_SPECS[name];
  if (spec === undefined) return undefined;
  if (typeof candidateRoot !== 'string' || candidateRoot.length === 0) return undefined;
  try {
    const require = createRequireFrom(path.join(candidateRoot, 'package.json'));
    const resolved = require.resolve(spec.specifier);
    if (typeof resolved !== 'string' || resolved.length === 0) return undefined;
    const module = await import(resolved);
    if (module !== null && typeof module === 'object' && module.default !== null && typeof module.default === 'object' && !Array.isArray(module.default)) {
      return module.default;
    }
    return module;
  } catch (cause) {
    if (process.env.ACADEMY_DEBUG_TOOLS === '1') {
      process.stderr.write(`[academy] resolvePublicTool(${name}) failed: ${cause?.code ?? cause?.message}\n`);
    }
    return undefined;
  }
}

function optionOf(parsed, name) {
  return parsed.options?.[name];
}

function boolOption(parsed, name) {
  return optionOf(parsed, name) === true;
}

function suppliedCreateFlags(parsed, component) {
  if (!component) {
    return Object.freeze({});
  }
  const supplied = parsed.providedOptions;
  if (!isRecord(supplied)) {
    return Object.freeze({});
  }
  const flags = {};
  for (const name of ['e2e', 'installDeps']) {
    if (Object.hasOwn(supplied, name)) {
      flags[name] = supplied[name];
    }
  }
  return Object.freeze(flags);
}

async function resolveSession(cwd, filesystem, openSession = WorkspaceSession.open) {
  try {
    return { ok: true, session: await openSession(cwd, filesystem) };
  } catch (cause) {
    return { ok: false, outcome: fail(cause?.code ?? 'WORKSPACE_INVALID', 'workspaceRequired', {}, undefined, cause) };
  }
}

const TEST_TOOL_SPECS = Object.freeze({
  vitest: Object.freeze({ package: 'vitest', bin: 'vitest' }),
  wtr: Object.freeze({ package: '@web/test-runner', bin: 'web-test-runner' })
});

function binEntryFrom(manifest, binName) {
  if (typeof manifest.bin === 'string') return manifest.bin;
  if (manifest.bin !== null && typeof manifest.bin === 'object') {
    const entry = manifest.bin[binName];
    if (typeof entry === 'string' && entry.length > 0) return entry;
  }
  return undefined;
}

function packageRootFromEntry(entryPath) {
  let dir = path.dirname(entryPath);
  for (;;) {
    const manifestPath = path.join(dir, 'package.json');
    if (existsSync(manifestPath)) {
      try {
        return Object.freeze({ root: dir, manifest: JSON.parse(readFileSync(manifestPath, 'utf8')) });
      } catch {
        return undefined;
      }
    }
    const parent = path.dirname(dir);
    if (parent === dir) return undefined;
    dir = parent;
  }
}

function resolveToolBin(name, candidateRoot, createRequireFrom) {
  const spec = TEST_TOOL_SPECS[name];
  if (spec === undefined || typeof candidateRoot !== 'string' || candidateRoot.length === 0) return undefined;
  try {
    const require = createRequireFrom(path.join(candidateRoot, 'package.json'));
    const located = packageRootFromEntry(require.resolve(spec.package));
    if (located === undefined) return undefined;
    const entry = binEntryFrom(located.manifest, spec.bin);
    if (entry === undefined) return undefined;
    return path.join(located.root, entry);
  } catch (cause) {
    if (process.env.ACADEMY_DEBUG_TOOLS === '1') {
      process.stderr.write(`[academy] resolveToolBin(${name}) failed: ${cause?.code ?? cause?.message}\n`);
    }
    return undefined;
  }
}

function resolvePackageEntry(candidateRoot, createRequireFrom, packageName) {
  if (typeof candidateRoot !== 'string' || candidateRoot.length === 0) return undefined;
  try {
    const require = createRequireFrom(path.join(candidateRoot, 'package.json'));
    const located = packageRootFromEntry(require.resolve(packageName));
    if (located === undefined) return undefined;
    const entry = located.manifest?.exports?.['.']?.import ?? located.manifest?.main;
    if (typeof entry !== 'string' || entry.length === 0) return undefined;
    return path.join(located.root, entry);
  } catch {
    return undefined;
  }
}

async function projectTestExecutable(sessionRoot, name) {
  const spec = TEST_TOOL_SPECS[name];
  if (spec === undefined || typeof sessionRoot !== 'string' || sessionRoot.length === 0) return undefined;
  const manifestPath = path.join(sessionRoot, 'node_modules', ...spec.package.split('/'), 'package.json');
  try {
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
    const entry = binEntryFrom(manifest, spec.bin);
    if (entry === undefined) return undefined;
    const executable = path.join(sessionRoot, 'node_modules', ...spec.package.split('/'), entry);
    const stats = await lstat(executable);
    return stats.isFile() ? executable : undefined;
  } catch {
    return undefined;
  }
}

async function projectTestRunner(sessionRoot) {
  try {
    return testRunnerForManifest(JSON.parse(await readFile(path.join(sessionRoot, 'package.json'), 'utf8')));
  } catch {
    return 'vitest';
  }
}

function asOutcome(value) {
  if (value !== null && typeof value === 'object' && typeof value.ok === 'boolean') {
    return value;
  }
  return ok(value);
}

function toolMissing(name) {
  return fail('TOOL_MISSING', 'toolMissing', { tool: name });
}

function typedOutcome(cause, success) {
  if (cause !== undefined) {
    return fail(cause?.code ?? 'TOOL_FAILED', 'commandFailed', {}, undefined, cause);
  }
  return success;
}

/**
 * Builds the dispatch function that wires every registered command to exactly
 * one real use case. Tool APIs are injected by the composition boundary; a
 * missing tool produces a typed `TOOL_MISSING` outcome rather than a
 * NOT_IMPLEMENTED placeholder.
 */
export function resolveDispatch({ api, cwd, env = {}, candidateRoot, cliEntrypoint, createRequireFrom = createRequireDefault } = {}) {
  const filesystem = new NodeFilesystem();
  const processRunner = api?.processRunner ?? new NodeProcessRunner();
  const workspaceLock = api?.workspaceLock ?? new FileWorkspaceLock({ filesystem, processRunner });
  const packageManager = api?.packageManager ?? new PublicPackageManager({ processRunner });
  const git = api?.git ?? new GitAdapter({ processRunner });
  const documents = api?.documents ?? new AtomicTextDocuments({ filesystem });
  const resolvedCandidateRoot = api?.candidateRoot ?? candidateRoot;
  const packageSelf =
    api?.packageSelf ??
    (candidateRoot === undefined
      ? undefined
      : new NodePackageSelf({ candidateRoot: resolvedCandidateRoot, processRunner, filesystem }));
  const packLocalCli =
    api?.packLocalCli ??
    (packageSelf === undefined
      ? undefined
      : async request => {
          let temporaryRoot;
          let temporaryIdentity;
          try {
            temporaryRoot = await mkdtemp(path.join(api?.packageTempRoot ?? os.tmpdir(), 'open-cells-academy-cli-pack-'));
            temporaryIdentity = await lstat(temporaryRoot);
            const packSession = await WorkspaceSession.openDirectory(temporaryRoot, filesystem);
            const packed = await packageSelf.packSelf('archive', Object.freeze({ ...request, session: packSession }));
            const fileName = path.basename(packed.tarballPath);
            const content = await readFile(packed.tarballPath);
            return Object.freeze({ fileName, content: new Uint8Array(content), integrity: packed.integrity });
          } finally {
            if (temporaryRoot !== undefined) {
              await removePortablePackRoot(temporaryRoot, temporaryIdentity);
            }
          }
        });
  const clock = api?.clock ?? (() => new Date());
  const prompt = api?.prompt;
  const tools = Object.freeze({
    app: api?.vite !== undefined ? new AppToolchain(api.vite) : undefined,
    component: api?.vite !== undefined ? new ComponentToolchain(api.vite) : undefined,
    workbox: api?.workbox !== undefined ? new ServiceWorker(api.workbox) : undefined,
    sass: api?.sass !== undefined ? new SassCompiler(api.sass) : undefined,
    eslint: api?.eslintApi !== undefined ? new EslintAdapter(api.eslintApi) : undefined,
    cem: api?.cem !== undefined ? new CemAnalyzer(api.cem) : undefined,
    browser: api?.browser !== undefined ? new BrowserCapability(api.browser) : undefined,
    vitest: api?.testing !== undefined ? new VitestBrowserRunner(api.testing) : undefined,
    wtr: api?.testing !== undefined ? new WtrRunner(api.testing) : undefined
  });
  const toolSpecs = Object.freeze([
    Object.freeze({ name: 'vite', key: 'app', build: api => new AppToolchain(api) }),
    Object.freeze({ name: 'vite', key: 'component', build: api => new ComponentToolchain(api) }),
    Object.freeze({ name: 'workbox', key: 'workbox', build: api => new ServiceWorker(api) }),
    Object.freeze({ name: 'sass', key: 'sass', build: api => new SassCompiler(api) }),
    Object.freeze({ name: 'eslint', key: 'eslint', build: api => new EslintAdapter(api) }),
    Object.freeze({ name: 'cem', key: 'cem', build: api => new CemAnalyzer(api) }),
    Object.freeze({ name: 'vite', key: 'browser', build: () => undefined })
  ]);
  let resolvedTools = null;
  async function ensureTools() {
    if (resolvedTools !== null) return resolvedTools;
    const next = { ...tools };
    if (process.env.ACADEMY_DEBUG_TOOLS === '1') {
      process.stderr.write(`[academy] ensureTools resolvedCandidateRoot=${JSON.stringify(resolvedCandidateRoot)} api=${api === undefined ? 'undefined' : 'object'}\n`);
    }
    if (api?.vite === undefined && resolvedCandidateRoot !== undefined) {
      const vite = await resolvePublicTool('vite', resolvedCandidateRoot, createRequireFrom);
      if (vite !== undefined) {
        next.app = new AppToolchain(vite);
        next.component = new ComponentToolchain(vite);
      }
    }
    if (api?.workbox === undefined && resolvedCandidateRoot !== undefined) {
      const workbox = await resolvePublicTool('workbox', resolvedCandidateRoot, createRequireFrom);
      if (workbox !== undefined) next.workbox = new ServiceWorker(workbox);
    }
    if (api?.sass === undefined && resolvedCandidateRoot !== undefined) {
      const sass = await resolvePublicTool('sass', resolvedCandidateRoot, createRequireFrom);
      if (sass !== undefined) next.sass = new SassCompiler(sass);
    }
    if (api?.eslintApi === undefined && resolvedCandidateRoot !== undefined) {
      const eslint = await resolvePublicTool('eslint', resolvedCandidateRoot, createRequireFrom);
      if (eslint !== undefined) next.eslint = new EslintAdapter(eslint);
    }
    if (api?.cem === undefined && resolvedCandidateRoot !== undefined) {
      const cem = await resolvePublicTool('cem', resolvedCandidateRoot, createRequireFrom);
      if (cem !== undefined) next.cem = new CemAnalyzer(cem);
    }
    if (api?.testing === undefined && resolvedCandidateRoot !== undefined) {
      const runner = Object.freeze({ runProcess: processRunner.run.bind(processRunner) });
      const vitestBin = resolveToolBin('vitest', resolvedCandidateRoot, createRequireFrom);
      const wtrBin = resolveToolBin('wtr', resolvedCandidateRoot, createRequireFrom);
      next.wtrLauncherEntry = resolvePackageEntry(resolvedCandidateRoot, createRequireFrom, '@web/test-runner-playwright');
      next.wtrJunitEntry = resolvePackageEntry(resolvedCandidateRoot, createRequireFrom, '@web/test-runner-junit-reporter');
      if (vitestBin !== undefined) next.vitest = new VitestBrowserRunner(runner, vitestBin);
      if (wtrBin !== undefined) next.wtr = new WtrRunner(runner, wtrBin, next.wtrLauncherEntry, next.wtrJunitEntry);
      if (vitestBin !== undefined || wtrBin !== undefined) {
        next.browser = new BrowserCapability(new ChromiumProbe({ candidateRoot: resolvedCandidateRoot, createRequireFrom, env }));
      }
    }
    resolvedTools = Object.freeze(next);
    return resolvedTools;
  }

  const sharedContext = Object.freeze({
    filesystem,
    processRunner,
    workspaceLock,
    packageManager,
    git,
    documents,
    packageSelf,
    clock,
    prompt,
    cwd,
    env: Object.freeze({ ...env })
  });

  const localePublisher = Object.freeze({
    async publish(activeSession, plan, publishOptions) {
      for (const file of ScaffoldPlan.snapshot(plan).files) {
        const segments = normalizeRelativePath(file.path);
        const target = path.join(activeSession.root, ...segments);
        if (!isWithin(activeSession.root, target)) throw typedError('PATH_INVALID', { path: file.path });
        await mkdir(path.dirname(target), { recursive: true });
        const content = typeof file.content === 'string' ? file.content : Buffer.from(file.content).toString('utf8');
        await documents.writeAtomically(activeSession, segments.join('/'), content, { replace: true, signal: publishOptions?.signal });
      }
    }
  });

  const appLocalePublisher = Object.freeze({
    async publish(activeSession, plan, publishOptions) {
      let localePlan = ScaffoldPlan.empty();
      const testingPlans = new Map();
      for (const file of ScaffoldPlan.snapshot(plan).files) {
        if (file.path.startsWith('dist/')) {
          const match = file.path.match(/^(dist(?:\/.+)?\/locales)\/(.+)$/);
          if (match === null) throw typedError('LOCALES_REQUEST_INVALID');
          const current = match[1] === 'dist/locales' ? localePlan : testingPlans.get(match[1]) ?? ScaffoldPlan.empty();
          const next = current.addFile(match[2], file.content, file.mode === undefined ? undefined : { mode: file.mode });
          if (match[1] === 'dist/locales') localePlan = next;
          else testingPlans.set(match[1], next);
          continue;
        }
        const match = file.path.match(/^(test\/unit\/.+\/locales)\/(.+)$/);
        if (match === null) throw typedError('LOCALES_REQUEST_INVALID');
        const current = testingPlans.get(match[1]) ?? ScaffoldPlan.empty();
        testingPlans.set(match[1], current.addFile(match[2], file.content, file.mode === undefined ? undefined : { mode: file.mode }));
      }
      async function ensureParents(destination) {
        const segments = normalizeRelativePath(destination).slice(0, -1);
        let relative = '';
        for (const segment of segments) {
          relative = relative === '' ? segment : `${relative}/${segment}`;
          const target = path.join(activeSession.root, ...relative.split('/'));
          try {
            const current = await lstat(target);
            if (!current.isDirectory() || current.isSymbolicLink()) throw typedError('DESTINATION_PARENT_INVALID');
          } catch (cause) {
            if (cause?.code !== 'ENOENT') throw cause;
            await filesystem.applyPlanAtomically(activeSession, ScaffoldPlan.empty(), relative, { signal: publishOptions?.signal });
          }
        }
      }
      await ensureParents('dist/locales');
      const results = [await filesystem.applyPlanAtomically(activeSession, localePlan, 'dist/locales', { replace: true, signal: publishOptions?.signal })];
      for (const [destination, testingPlan] of [...testingPlans.entries()].sort(([left], [right]) => left.localeCompare(right))) {
        await ensureParents(destination);
        results.push(await filesystem.applyPlanAtomically(activeSession, testingPlan, destination, { replace: true, signal: publishOptions?.signal }));
      }
      if (typeof publishOptions?.configName === 'string') {
        const segments = [...normalizeRelativePath(publishOptions.configName)];
        const fileName = segments.at(-1);
        if (!/^[A-Za-z0-9][A-Za-z0-9._-]*\.(?:js|mjs)$/.test(fileName)) throw typedError('LOCALES_REQUEST_INVALID');
        segments[segments.length - 1] = fileName.replace(/\.(?:js|mjs)$/, '');
        const destination = `test/unit/${segments.join('/')}/locales`;
        if (!testingPlans.has(destination)) {
          try {
            const current = await lstat(path.join(activeSession.root, ...destination.split('/')));
            if (!current.isDirectory() || current.isSymbolicLink()) throw typedError('DESTINATION_PARENT_INVALID');
            results.push(await filesystem.applyPlanAtomically(activeSession, ScaffoldPlan.empty(), destination, { replace: true, signal: publishOptions?.signal }));
          } catch (cause) {
            if (cause?.code !== 'ENOENT') throw cause;
          }
        }
      }
      return Object.freeze(results);
    }
  });

  async function sessionFor(parsed) {
    if (parsed.command.name === 'app:create' || parsed.command.name === 'component:create') {
      return resolveSession(cwd, filesystem, WorkspaceSession.openDirectory);
    }
    if (parsed.command.requiresWorkspace !== true) {
      return { ok: true, session: undefined };
    }
    return resolveSession(cwd, filesystem);
  }

  function baseContext(session) {
    return Object.freeze({
      session,
      filesystem,
      workspaceLock,
      packageManager,
      packageSelf,
      packLocalCli,
      prompt
    });
  }

  async function handleInstall(parsed, session, component) {
    const context = baseContext(session);
    return installProject(
      Object.freeze({ mode: boolOption(parsed, 'ci') ? 'ci' : 'install', allowScripts: false, offline: false }),
      context
    );
  }

  async function handleChangelog(parsed, session) {
    const context = Object.freeze({ session, git, documents, clock });
    return generateChangelog(
      Object.freeze({
        preset: optionOf(parsed, 'preset') ?? 'angular',
        full: boolOption(parsed, 'full'),
        name: optionOf(parsed, 'name') ?? 'CHANGELOG.md'
      }),
      context
    );
  }

  async function handleLint(tools, parsed, session, component) {
    if (tools.eslint === undefined) return toolMissing('eslint');
    const context = baseContext(session);
    const useCase = component ? lintComponent : lintApp;
    return useCase(Object.freeze({
      ...context,
      eslint: tools.eslint,
      options: Object.freeze({ fix: boolOption(parsed, 'fix'), abortOnFailure: boolOption(parsed, 'abortOnFailure') })
    }));
  }

  async function handleTest(tools, parsed, session, component) {
    const wtrProvided = isRecord(parsed.providedOptions) && Object.hasOwn(parsed.providedOptions, 'wtr');
    const runnerName = wtrProvided
      ? (parsed.providedOptions.wtr === true ? 'wtr' : 'vitest')
      : await projectTestRunner(session.root);
    const wtrRequested = runnerName === 'wtr';
    let runner = wtrRequested ? tools.wtr : tools.vitest;
    if (runner === undefined) return toolMissing('testing');
    const projectExecutable = await projectTestExecutable(session.root, wtrRequested ? 'wtr' : 'vitest');
    if (projectExecutable !== undefined) {
      const runnerProcess = Object.freeze({ runProcess: processRunner.run.bind(processRunner) });
      runner = wtrRequested ? new WtrRunner(runnerProcess, projectExecutable, tools.wtrLauncherEntry, tools.wtrJunitEntry) : new VitestBrowserRunner(runnerProcess, projectExecutable);
    }
    const updateLocales = component
      ? () => generateComponentLocales(Object.freeze({
        session,
        filesystem,
        request: Object.freeze({ signal: undefined }),
        dependencyTree: Object.freeze([]),
        publisher: localePublisher
      }))
      : async () => {
        const { loadCellsConfig } = await import('../adapters/vite/config-loader.js');
        const config = await loadCellsConfig(session, optionOf(parsed, 'config'));
        const localeSources = await discoverAppLocaleSources(session.root, config.locales, config.appModules);
        return generateAppLocales(Object.freeze({
          session,
          filesystem,
          request: Object.freeze({ config: config.locales, configName: optionOf(parsed, 'config'), ...localeSources, replaceOutput: true, signal: undefined }),
          publisher: appLocalePublisher
        }));
      };
    const useCase = component ? testComponent : testApp;
    return useCase(Object.freeze({
      session,
      runner,
      browser: tools.browser,
      signals: process,
      env: Object.freeze(Object.fromEntries(Object.entries(process.env).filter(([, value]) => typeof value === 'string'))),
      updateLocales,
      options: Object.freeze({
        wtr: wtrRequested,
        watch: boolOption(parsed, 'watch'),
        updateSnapshots: boolOption(parsed, 'updateSnapshots'),
        updateLocales: boolOption(parsed, 'updateLocales'),
        coverage: boolOption(parsed, 'coverage'),
        wtrTestsFinishTimeout: optionOf(parsed, 'wtrTestsFinishTimeout') ?? 120000
      })
    }));
  }

  async function handleLocales(parsed, session, component) {
    let result;
    if (component) {
      result = await generateComponentLocales(Object.freeze({
        session,
        filesystem,
        request: Object.freeze({ signal: undefined }),
        dependencyTree: Object.freeze([]),
        publisher: localePublisher
      }));
    } else {
      const { loadCellsConfig } = await import('../adapters/vite/config-loader.js');
      const config = await loadCellsConfig(session, optionOf(parsed, 'config'));
      const localeSources = await discoverAppLocaleSources(session.root, config.locales, config.appModules);
      result = await generateAppLocales(Object.freeze({
        session,
        filesystem,
        request: Object.freeze({ config: config.locales, configName: optionOf(parsed, 'config'), ...localeSources, replaceOutput: true, signal: undefined }),
        publisher: appLocalePublisher
      }));
    }
    return asOutcome(result);
  }

  async function handleDev(tools, parsed, session, component) {
    if (tools.app === undefined && tools.component === undefined) return toolMissing('vite');
    const context = baseContext(session);
    const options = Object.freeze({
      host: optionOf(parsed, 'host') ?? '127.0.0.1',
      port: optionOf(parsed, 'port') ?? 8001,
      open: optionOf(parsed, 'open') ?? true,
      clearScreen: boolOption(parsed, 'clearScreen'),
      strictPort: boolOption(parsed, 'strictPort'),
      debug: boolOption(parsed, 'debug'),
      sassLogLevel: optionOf(parsed, 'sassLogLevel')
    });
    let handle;
    if (component) {
      if (tools.component === undefined) return toolMissing('vite');
      handle = await devComponent(Object.freeze({ ...context, toolchain: tools.component, options }));
    } else {
      handle = await devApp(Object.freeze({
        session,
        toolchain: tools.app,
        configName: optionOf(parsed, 'config'),
        options
      }));
    }
    const url = await handle?.ready?.then(ready => ready.url).catch(() => undefined);
    return ok({ url }, url === undefined ? [] : [{ key: 'server_ready', params: { url } }]);
  }

  async function handlePreview(tools, parsed, session) {
    if (tools.app === undefined) return toolMissing('vite');
    const handle = await previewApp(Object.freeze({
      session,
      toolchain: tools.app,
      configName: optionOf(parsed, 'config'),
      options: Object.freeze({
        host: optionOf(parsed, 'host') ?? '127.0.0.1',
        port: optionOf(parsed, 'port') ?? 8001,
        open: optionOf(parsed, 'open') ?? true,
        strictPort: boolOption(parsed, 'strictPort')
      })
    }));
    const url = await handle?.ready?.then(ready => ready.url).catch(() => undefined);
    return ok({ url }, url === undefined ? [] : [{ key: 'server_ready', params: { url } }]);
  }

  async function handleBuildApp(tools, parsed, session) {
    if (tools.app === undefined) return toolMissing('vite');
    const context = baseContext(session);
    const { loadCellsConfig } = await import('../adapters/vite/config-loader.js');
    const config = await loadCellsConfig(session, optionOf(parsed, 'config'));
    const localeSources = await discoverAppLocaleSources(session.root, config.locales, config.appModules);
    const sw = config.serviceWorker ?? config.enable_sw;
    const swConfig = (() => {
      if (sw === undefined || sw === false || sw === null) return undefined;
      if (sw === true || typeof sw === 'object') {
        if (tools.workbox === undefined) return undefined;
        const mode = sw === true ? 'generateSW' : sw.mode ?? 'generateSW';
        if (mode !== 'generateSW' && mode !== 'injectManifest') return undefined;
        return Object.freeze({ mode, adapter: tools.workbox, options: Object.freeze({ ...((sw === true ? {} : sw.options) ?? {}) }) });
      }
      return undefined;
    })();
    const result = await buildApp(Object.freeze({
      ...context,
      toolchain: tools.app,
      configName: optionOf(parsed, 'config'),
      options: Object.freeze({ sourceMap: boolOption(parsed, 'sourceMap'), sassLogLevel: optionOf(parsed, 'sassLogLevel') }),
      localeRequest: Object.freeze({ ...localeSources, configName: optionOf(parsed, 'config') }),
      serviceWorker: swConfig
    }));
    return asOutcome(result);
  }

  async function handleBuildDemo(tools, parsed, session) {
    if (tools.component === undefined) return toolMissing('vite');
    const context = baseContext(session);
    const result = await buildComponentDemo(Object.freeze({
      ...context,
      toolchain: tools.component,
      demo: optionOf(parsed, 'demo'),
      dist: optionOf(parsed, 'dist'),
      options: Object.freeze({ verbose: optionOf(parsed, 'verbose') !== false })
    }));
    return asOutcome(result);
  }

  async function handleDocumentation(tools, parsed, session) {
    if (tools.cem === undefined) return toolMissing('custom-elements-manifest');
    const context = baseContext(session);
    const result = await documentComponent(Object.freeze({
      ...context,
      analyzer: tools.cem,
      options: Object.freeze({
        mdFile: optionOf(parsed, 'mdFile') ?? 'README.md',
        noMd: boolOption(parsed, 'noMd')
      })
    }));
    return asOutcome(result);
  }

  async function handleSass(tools, parsed, session) {
    if (tools.sass === undefined) return toolMissing('sass');
    const context = baseContext(session);
    const result = await compileSass(Object.freeze({
      ...context,
      compiler: tools.sass,
      logLevel: optionOf(parsed, 'sassLogLevel') ?? 'warn',
      publisher: Object.freeze({
        async publish(activeSession, plan) {
          const writer = new DocsWriter(activeSession, filesystem);
          for (const file of plan.files) {
            const content = file.content;
            const exists = await writer.exists(file.path);
            await writer.write(file.path, content, { replace: exists || true });
          }
          return Object.freeze({ fileCount: plan.files.length });
        }
      })
    }));
    return asOutcome(result);
  }

  async function handleCreate(parsed, component, session) {
    if (packLocalCli === undefined) return toolMissing('pack-local-cli');
    const context = Object.freeze({
      session,
      filesystem,
      workspaceLock,
      packageManager,
      packageSelf,
      packLocalCli,
      prompt,
      cwd
    });
    const useCase = component ? createComponent : createApp;
    const scaffold = optionOf(parsed, 'scaffold');
    const request = Object.freeze({ scaffold, flags: suppliedCreateFlags(parsed, component) });
    const outcome = await useCase(request, context);
    if (!outcome.ok) {
      return outcome;
    }
    return ok(outcome.data);
  }

  async function dispatch(parsed) {
    if (isRecord(parsed) && parsed.action === 'tui') {
      const { startTui } = await import('../application/tui/start-tui.js');
      return startTui({
        cwd,
        env,
        stdin: api?.stdin ?? process.stdin,
        stdout: api?.stdout ?? process.stdout,
        language: parsed.language,
        animation: parsed.options?.animation !== false,
        processRunner,
        cliEntrypoint,
        urlOpener: api?.urlOpener
      });
    }

    if (!isRecord(parsed) || parsed.action !== 'command' || !isRecord(parsed.command)) {
      return fail('INVALID_INPUT', 'invalidInput');
    }
    let resolved;
    try {
      resolved = await sessionFor(parsed);
    } catch (cause) {
      return fail(cause?.code ?? 'WORKSPACE_INVALID', 'workspaceRequired', {}, undefined, cause);
    }
    if (!resolved.ok) {
      return resolved.outcome;
    }
    const activeSession = resolved.session;
    const tools = await ensureTools();

    try {
      switch (parsed.command.name) {
        case 'app:create':
          return await handleCreate(parsed, false, activeSession);
        case 'component:create':
          return await handleCreate(parsed, true, activeSession);
        case 'app:install':
          return await handleInstall(parsed, activeSession, false);
        case 'component:install':
          return await handleInstall(parsed, activeSession, true);
        case 'app:changelog':
          return await handleChangelog(parsed, activeSession);
        case 'component:changelog':
          return await handleChangelog(parsed, activeSession);
        case 'app:lint':
          return await handleLint(tools, parsed, activeSession, false);
        case 'component:lint':
          return await handleLint(tools, parsed, activeSession, true);
        case 'app:test':
          return await handleTest(tools, parsed, activeSession, false);
        case 'component:test':
          return await handleTest(tools, parsed, activeSession, true);
        case 'app:locales':
          return await handleLocales(parsed, activeSession, false);
        case 'component:locales':
          return await handleLocales(parsed, activeSession, true);
        case 'app:dev':
          return await handleDev(tools, parsed, activeSession, false);
        case 'component:dev':
          return await handleDev(tools, parsed, activeSession, true);
        case 'app:preview':
          return await handlePreview(tools, parsed, activeSession);
        case 'app:build':
          return await handleBuildApp(tools, parsed, activeSession);
        case 'component:build:demo':
          return await handleBuildDemo(tools, parsed, activeSession);
        case 'component:documentation':
          return await handleDocumentation(tools, parsed, activeSession);
        case 'component:sass':
          return await handleSass(tools, parsed, activeSession);
        default:
          return fail('INVALID_INPUT', 'invalidInput', { command: parsed.command.name });
      }
    } catch (cause) {
      return fail(cause?.code ?? 'TOOL_FAILED', 'commandFailed', {}, undefined, cause);
    }
  }

  return Object.freeze({ dispatch, sharedContext });
}
