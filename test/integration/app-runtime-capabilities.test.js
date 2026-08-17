import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { pathToFileURL } from 'node:url';

import { NodeFilesystem } from '../../src/adapters/node/node-filesystem.js';
import { WorkspaceSession } from '../../src/domain/workspace-session.js';
import { composeRecipe } from '../../src/recipes/compose-recipe.js';

const runtimeFiles = Object.freeze({
  facade: ['src', 'runtime', 'academy-core-facade.js'],
  client: ['src', 'runtime', 'open-cells-client.js'],
  dataManager: ['src', 'runtime', 'data-manager.js'],
  main: ['src', 'main.js']
});

const i18nFile = ['src', 'capabilities', 'i18n', 'messages.js'];
const appMessagesFile = ['src', 'app-messages.js'];
const scopedHostsFile = ['src', 'capabilities', 'scoped-elements', 'scoped-hosts.js'];
const academyWidgetFiles = Object.freeze({
  intlMsg: ['src', 'runtime', 'academy-intl-msg.js'],
  widgetMixin: ['src', 'mixins', 'WidgetMixin.js'],
  typeText: ['src', 'components', 'AcademyTypeText.js'],
  buttonDefault: ['src', 'components', 'AcademyButtonDefault.js']
});

async function materializeRuntime(t, { browserTouchingScopedPackage = false, profile = 'blank', kind = 'app', name = 'runtime-app' } = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'open-cells-academy-runtime-red-'));
  t.after(async () => {
    await rm(root, { recursive: true, force: true });
  });
  await writeFile(path.join(root, 'package.json'), '{"name":"runtime-red","private":true}\n');
  const scopedPackage = path.join(root, 'node_modules', '@open-wc', 'scoped-elements');
  await mkdir(scopedPackage, { recursive: true });
  await writeFile(path.join(scopedPackage, 'package.json'), '{"name":"@open-wc/scoped-elements","type":"module"}\n');
  await writeFile(
    path.join(scopedPackage, 'html-element.js'),
    browserTouchingScopedPackage
      ? 'globalThis.__academyScopedStubEvaluations = (globalThis.__academyScopedStubEvaluations ?? 0) + 1;\nconst browserWindow = window;\nexport const ScopedElementsMixin = Base => class extends Base { static publicScopedMixin = Boolean(browserWindow); };\n'
      : `export const ScopedElementsMixin = Base => class extends Base {
          static publicScopedMixin = true;
          attachShadow(options) {
            const root = super.attachShadow(options);
            root.scopedElements = this.constructor.scopedElements;
            return root;
          }
        };\n`
  );
  const scopedRegistryPackage = path.join(root, 'node_modules', '@webcomponents', 'scoped-custom-element-registry');
  await mkdir(scopedRegistryPackage, { recursive: true });
  await writeFile(path.join(scopedRegistryPackage, 'package.json'), '{"name":"@webcomponents/scoped-custom-element-registry","type":"module","exports":"./index.js"}\n');
  await writeFile(path.join(scopedRegistryPackage, 'index.js'), 'export {};\n');
  const localizePackage = path.join(root, 'node_modules', '@lit', 'localize');
  await mkdir(localizePackage, { recursive: true });
  await mkdir(path.join(localizePackage, 'init'), { recursive: true });
  await writeFile(path.join(localizePackage, 'package.json'), '{"name":"@lit/localize","type":"module","exports":{".":"./index.js","./init/reentrant.js":"./init/reentrant.js"}}\n');
  await writeFile(
    path.join(localizePackage, 'index.js'),
    `export function msg(source, { id } = {}) {
  const configuration = globalThis.__academyLitLocalizeConfiguration;
  const locale = configuration.getLocale();
  return locale === configuration.sourceLocale
    ? source
    : configuration.loadLocaleSync(locale)?.templates?.[id] ?? source;
}
`
  );
  await writeFile(
    path.join(localizePackage, 'init', 'reentrant.js'),
    `export function configureReentrantLocalization(next) {
  globalThis.__academyLitLocalizeConfigurations = (globalThis.__academyLitLocalizeConfigurations ?? 0) + 1;
  globalThis.__academyLitLocalizeConfiguration = next;
}
`
  );
  const litPackage = path.join(root, 'node_modules', 'lit');
  await mkdir(litPackage, { recursive: true });
  await writeFile(path.join(litPackage, 'package.json'), '{"name":"lit","type":"module","exports":"./index.js"}\n');
  await writeFile(
    path.join(litPackage, 'index.js'),
    `export class LitElement extends EventTarget {
  constructor() {
    super();
    this.updateRequests = 0;
  }
  requestUpdate() {
    this.updateRequests += 1;
  }
}
export function html(strings, ...values) {
  return Object.freeze({ strings: [...strings], values });
}
export function css(strings, ...values) {
  return Object.freeze({ strings: [...strings], values });
}
`
  );
  const corePackage = path.join(root, 'node_modules', '@open-cells', 'core');
  await mkdir(corePackage, { recursive: true });
  await writeFile(path.join(corePackage, 'package.json'), '{"name":"@open-cells/core","type":"module","exports":"./index.js"}\n');
  await writeFile(
    path.join(corePackage, 'index.js'),
    `export function getConfig() {}
export function navigate() {}
export function publish() {}
export function startApp() {}
export function subscribe() {}
export function unsubscribe() {}
`
  );

  const filesystem = new NodeFilesystem();
  const session = await WorkspaceSession.open(root, filesystem);
  const plan = composeRecipe(profile, {
    kind,
    name,
    ...(kind === 'app' ? { cellsVersion: '4' } : {})
  });
  const publication = await filesystem.applyPlanAtomically(session, plan, name);
  const runtimeRoot = publication.destination;
  const facade = kind === 'app'
    ? await import(pathToFileURL(path.join(runtimeRoot, ...runtimeFiles.facade)).href)
    : undefined;

  return { facade, runtimeRoot };
}

async function materializeDataManager(t) {
  const { runtimeRoot } = await materializeRuntime(t);
  return import(pathToFileURL(path.join(runtimeRoot, ...runtimeFiles.dataManager)).href);
}

async function materializeMain(t) {
  const { runtimeRoot } = await materializeRuntime(t);
  const browser = createBrowser();
  const hadWindow = Object.hasOwn(globalThis, 'window');
  const originalWindow = globalThis.window;
  globalThis.window = browser;
  t.after(() => {
    if (hadWindow) {
      globalThis.window = originalWindow;
      return;
    }
    Reflect.deleteProperty(globalThis, 'window');
  });
  const main = await import(pathToFileURL(path.join(runtimeRoot, ...runtimeFiles.main)).href);
  return { main, runtimeRoot };
}

async function materializeDeferredAppMessages(t) {
  const { runtimeRoot } = await materializeRuntime(t);
  await writeFile(path.join(runtimeRoot, ...runtimeFiles.main), `export async function loadMessages(language) {
  const gate = globalThis.__academyDeferredLanguageGates.get(language);
  globalThis.__academyDeferredLanguageRequests.push(language);
  await gate.promise;
  return globalThis.IntlMsg.setLanguage(language);
}
`);
  return import(pathToFileURL(path.join(runtimeRoot, ...appMessagesFile)).href);
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((nextResolve, nextReject) => {
    resolve = nextResolve;
    reject = nextReject;
  });

  return { promise, resolve, reject };
}

function trackSettlement(promise) {
  const settlement = { settled: false };
  promise.then(
    value => {
      settlement.settled = true;
      settlement.value = value;
    },
    error => {
      settlement.settled = true;
      settlement.error = error;
    }
  );
  return settlement;
}

async function flushPromiseJobs() {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

function replaceGlobal(t, name, value) {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, name);
  Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
  t.after(() => {
    if (descriptor === undefined) {
      Reflect.deleteProperty(globalThis, name);
      return;
    }
    Object.defineProperty(globalThis, name, descriptor);
  });
}

async function assertNoUnhandledRejection(action) {
  const rejections = [];
  const onUnhandledRejection = reason => rejections.push(reason);
  process.on('unhandledRejection', onUnhandledRejection);
  try {
    await action();
    await new Promise(resolve => setImmediate(resolve));
  } finally {
    process.off('unhandledRejection', onUnhandledRejection);
  }
  assert.deepEqual(rejections, []);
}

async function materializeDomRuntime(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'open-cells-academy-dom-'));
  t.after(async () => {
    await rm(root, { recursive: true, force: true });
  });
  await writeFile(path.join(root, 'package.json'), '{"name":"academy-dom-runtime","private":true,"type":"module"}\n');
  await symlink(path.resolve(import.meta.dirname, '..', '..', 'node_modules'), path.join(root, 'node_modules'), 'dir');
  const filesystem = new NodeFilesystem();
  const session = await WorkspaceSession.open(root, filesystem);
  const plan = composeRecipe('blank', { kind: 'app', name: 'academy-dom-runtime', cellsVersion: '4' });
  const publication = await filesystem.applyPlanAtomically(session, plan, 'academy-dom-runtime');
  return { root, runtimeRoot: publication.destination };
}

function installHappyDomGlobals(t, window, { linkedNames = [] } = {}) {
  const values = [
    ['window', window],
    ['document', window.document],
    ['customElements', window.customElements],
    ['HTMLElement', window.HTMLElement],
    ['Element', window.Element],
    ['Node', window.Node],
    ['Document', window.Document],
    ['ShadowRoot', window.ShadowRoot],
    ['DocumentFragment', window.DocumentFragment],
    ['CSSStyleSheet', window.CSSStyleSheet],
    ['Event', window.Event],
    ['CustomEvent', window.CustomEvent],
    ['EventTarget', window.EventTarget],
    ['MutationObserver', window.MutationObserver],
    ['addEventListener', window.addEventListener.bind(window)],
    ['removeEventListener', window.removeEventListener.bind(window)],
    ['dispatchEvent', window.dispatchEvent.bind(window)]
  ];
  const descriptors = new Map();
  for (const [name, value] of values) {
    descriptors.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
    Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
  }
  for (const name of linkedNames) {
    if (!descriptors.has(name)) {
      descriptors.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
    }
    Object.defineProperty(globalThis, name, {
      configurable: true,
      get() {
        return window[name];
      },
      set(value) {
        window[name] = value;
      }
    });
  }
  t.after(() => {
    for (const [name, descriptor] of descriptors) {
      if (descriptor === undefined) {
        Reflect.deleteProperty(globalThis, name);
      } else {
        Object.defineProperty(globalThis, name, descriptor);
      }
    }
  });
}

async function installHappyDomScopedRegistry(t, { root, window }) {
  const nativeRegistry = window.customElements;
  class BootstrapRegistry {}
  window.CustomElementRegistry = BootstrapRegistry;
  installHappyDomGlobals(t, window, {
    linkedNames: ['customElements', 'CustomElementRegistry', 'HTMLElement']
  });
  await import(pathToFileURL(path.join(
    root,
    'node_modules',
    '@webcomponents',
    'scoped-custom-element-registry',
    'scoped-custom-element-registry.min.js'
  )).href);
  const PropertySymbol = await import(pathToFileURL(path.join(root, 'node_modules', 'happy-dom', 'lib', 'PropertySymbol.js')).href);
  let documentPrototype = Object.getPrototypeOf(window.document);
  while (documentPrototype !== null && !Object.hasOwn(documentPrototype, 'createElementNS')) {
    documentPrototype = Object.getPrototypeOf(documentPrototype);
  }
  assert.notEqual(documentPrototype, null);
  const descriptor = Object.getOwnPropertyDescriptor(documentPrototype, 'createElementNS');
  Object.defineProperty(documentPrototype, 'createElementNS', {
    ...descriptor,
    value(namespaceURI, qualifiedName, options) {
      const definition = nativeRegistry.get(String(qualifiedName));
      if (namespaceURI === 'http://www.w3.org/1999/xhtml' && definition !== undefined) {
        const element = new definition();
        element[PropertySymbol.tagName] = String(qualifiedName).toUpperCase();
        element[PropertySymbol.localName] = String(qualifiedName);
        element[PropertySymbol.prefix] = null;
        element[PropertySymbol.namespaceURI] = namespaceURI;
        element[PropertySymbol.isValue] = options?.is === undefined ? null : String(options.is);
        return element;
      }
      return descriptor.value.call(this, namespaceURI, qualifiedName, options);
    }
  });
  t.after(() => {
    Object.defineProperty(documentPrototype, 'createElementNS', descriptor);
  });
}

function createBrowser({ mainNode = true, mainNodeIds = mainNode ? ['app'] : [], reportError, routeHosts = ['academy-home', 'academy-details'] } = {}) {
  const nodes = new Map(mainNodeIds.map(id => [id, {}]));
  const routeDefinitions = new Map(routeHosts.map(tag => [tag, class RouteHost {}]));
  const history = {
    calls: 0,
    back() {
      this.calls += 1;
    }
  };

  const browser = {
    document: {
      createElement(tagName) {
        return { tagName: tagName.toUpperCase() };
      },
      getElementById(id) {
        return nodes.get(id) ?? null;
      }
    },
    customElements: {
      get(tag) {
        return routeDefinitions.get(tag);
      }
    },
    history
  };
  if (reportError !== undefined) browser.reportError = reportError;
  return browser;
}

function createCore({ retained = undefined } = {}) {
  const calls = {
    startApp: [],
    navigate: [],
    publish: [],
    subscribe: [],
    unsubscribe: []
  };
  const core = {
    startApp(config) {
      calls.startApp.push(config);
      return { rawBridge: true };
    },
    navigate(routeName, params) {
      calls.navigate.push({ routeName, params });
    },
    publish(channel, payload, options) {
      calls.publish.push({ channel, payload, options });
    },
    subscribe(channel, owner, callback) {
      calls.subscribe.push({ channel, owner, callback });
      if (retained !== undefined) {
        callback(retained);
      }
    },
    unsubscribe(channel, owner) {
      calls.unsubscribe.push({ channel, owner });
    }
  };

  return { calls, core };
}

function applicationConfig(overrides = {}) {
  return {
    mainNode: 'app',
    routes: [
      { name: 'home', path: '/', action() {}, component: 'academy-home' },
      { name: 'details', path: '/details', action() {}, component: 'academy-details' }
  ],
    initialTemplate: 'home',
    debug: false,
    ...overrides
  };
}

function assertCode(operation, code) {
  assert.throws(operation, error => error?.code === code);
}

test('red: application capability composition publishes the Academy client runtime entrypoint', async t => {
  const { runtimeRoot } = await materializeRuntime(t);
  const entrypoint = await readFile(path.join(runtimeRoot, ...runtimeFiles.main), 'utf8');

  assert.match(entrypoint, /startAcademyApp/);
});

test('red: generated application README documents the Task 5 Core boundary', async t => {
  const { runtimeRoot } = await materializeRuntime(t);
  const readme = await readFile(path.join(runtimeRoot, 'README.md'), 'utf8');

  assert.match(readme, /@open-cells\/core@1\.2\.1/);
  assert.match(readme, /named routes/i);
  assert.match(readme, /academy:<appId>:<feature>:<event>/);
  assert.match(readme, /only supported publish option.*sessionStorage/i);
  assert.match(readme, /retains the last published value/i);
  assert.match(readme, /idempotent cleanup/i);
  assert.match(readme, /browser-only/i);
  assert.match(readme, /SSR|prerender/i);
  assert.match(readme, /does not register a service worker/i);
});

test('red: facade rejects invalid bootstrap configurations before calling Core', async t => {
  const { facade } = await materializeRuntime(t);
  const { core, calls } = createCore();
  const browser = createBrowser();
  const runtime = facade.createAcademyCoreFacade(core, browser);
  const duplicateRoutes = applicationConfig({
    routes: [
      { name: 'home', path: '/', action() {}, component: 'academy-home' },
      { name: 'home', path: '/second', action() {}, component: 'academy-details' }
    ]
  });

  for (const invalid of [
    undefined,
    applicationConfig({ mainNode: 'missing' }),
    applicationConfig({ routes: [{ name: 'home', path: '/', action() {}, component: 'academy-missing' }] }),
    duplicateRoutes,
    applicationConfig({ initialTemplate: 'missing' })
  ]) {
    assertCode(() => runtime.startAcademyApp(invalid), 'ACADEMY_CORE_INVALID_CONFIG');
  }
  assert.equal(calls.startApp.length, 0);
});

test('red: facade rejects every non-false debug value before Core startup', async t => {
  const { facade } = await materializeRuntime(t);

  for (const debug of [undefined, true, null, 0, 'false']) {
    const { core, calls } = createCore();
    const runtime = facade.createAcademyCoreFacade(core, createBrowser());

    assertCode(() => runtime.startAcademyApp(applicationConfig({ debug })), 'ACADEMY_CORE_INVALID_CONFIG');
    assert.equal(calls.startApp.length, 0);
  }
});

test('break: facade rejects selector-unsafe main-node identifiers before Core startup', async t => {
  const { facade } = await materializeRuntime(t);

  for (const mainNode of ['app#shadow', 'app[role=main]', 'app > section', 'app,other']) {
    const { core, calls } = createCore();
    const runtime = facade.createAcademyCoreFacade(core, createBrowser({ mainNodeIds: ['app', mainNode] }));

    assertCode(() => runtime.startAcademyApp(applicationConfig({ mainNode })), 'ACADEMY_CORE_INVALID_CONFIG');
    assert.equal(calls.startApp.length, 0);
  }
});

test('break: facade rejects URL-style route names before Core startup', async t => {
  const { facade } = await materializeRuntime(t);

  for (const name of ['/details', '#details', 'details?tab=overview', 'https://academy.test/details']) {
    const { core, calls } = createCore();
    const runtime = facade.createAcademyCoreFacade(core, createBrowser());
    const routes = [
      { name: 'home', path: '/', action() {}, component: 'academy-home' },
      { name, path: '/details', action() {}, component: 'academy-details' }
    ];

    assertCode(() => runtime.startAcademyApp(applicationConfig({ routes })), 'ACADEMY_CORE_INVALID_CONFIG');
    assert.equal(calls.startApp.length, 0);
  }
});

test('break: Core adapter does not expose a public history-back control', async t => {
  const { facade } = await materializeRuntime(t);

  assert.deepEqual(Object.keys(facade), ['createAcademyCoreFacade']);
});

test('red: facade validates and starts the Core runtime once without exposing its raw bridge', async t => {
  const { facade } = await materializeRuntime(t);
  const { core, calls } = createCore();
  const runtime = facade.createAcademyCoreFacade(core, createBrowser());
  const config = applicationConfig();

  const result = runtime.startAcademyApp(config);

  assert.equal(result, undefined);
  assert.equal(calls.startApp.length, 1);
  assert.equal(calls.startApp[0], config);
});

test('red: conflicting second bootstrap fails explicitly without another Core start', async t => {
  const { facade } = await materializeRuntime(t);
  const { core, calls } = createCore();
  const runtime = facade.createAcademyCoreFacade(core, createBrowser());

  runtime.startAcademyApp(applicationConfig());
  assertCode(
    () => runtime.startAcademyApp(applicationConfig({ initialTemplate: 'details' })),
    'ACADEMY_CORE_ALREADY_STARTED'
  );
  assert.equal(calls.startApp.length, 1);
});

test('red: facade rejects a Core runtime that was started outside Academy before calling Core', async t => {
  const { facade } = await materializeRuntime(t);
  const { core, calls } = createCore();
  const existingConfig = applicationConfig();
  core.getConfig = () => existingConfig;
  const runtime = facade.createAcademyCoreFacade(core, createBrowser());

  assertCode(() => runtime.startAcademyApp(applicationConfig()), 'ACADEMY_CORE_ALREADY_STARTED');
  assert.equal(calls.startApp.length, 0);
});

test('red: facade delegates one known named route with object params', async t => {
  const { facade } = await materializeRuntime(t);
  const { core, calls } = createCore();
  const runtime = facade.createAcademyCoreFacade(core, createBrowser());
  const params = { itemId: 42 };

  runtime.startAcademyApp(applicationConfig());
  runtime.navigate('details', params);

  assert.deepEqual(calls.navigate, [{ routeName: 'details', params }]);
});

test('red: facade rejects unknown routes and non-object params before Core navigation', async t => {
  const { facade } = await materializeRuntime(t);
  const { core, calls } = createCore();
  const runtime = facade.createAcademyCoreFacade(core, createBrowser());

  runtime.startAcademyApp(applicationConfig());
  assertCode(() => runtime.navigate('back', {}), 'ACADEMY_CORE_UNKNOWN_ROUTE');
  assertCode(() => runtime.navigate('missing', {}), 'ACADEMY_CORE_UNKNOWN_ROUTE');
  assertCode(() => runtime.navigate('details', 'not-an-object'), 'ACADEMY_CORE_INVALID_ROUTE_PARAMS');
  assert.equal(calls.navigate.length, 0);
});

test('red: facade namespaces channels and rejects unsupported publish options before Core', async t => {
  const { facade } = await materializeRuntime(t);
  const { core, calls } = createCore();
  const runtime = facade.createAcademyCoreFacade(core, createBrowser());
  const channel = 'academy:academy-app:selection:changed';
  const payload = { selected: 'course-42' };

  runtime.startAcademyApp(applicationConfig());
  runtime.publish(channel, payload, { sessionStorage: true });

  assert.equal(calls.publish.length, 1);
  assert.equal(calls.publish[0].channel, channel);
  assert.equal(calls.publish[0].payload, payload);
  assert.deepEqual(calls.publish[0].options, { sessionStorage: true });
  for (const invalid of [
    'academy::selection:changed',
    'academy:academy-app:selection:__oc_private',
    'academy:academy-app:selection:changed:extra'
  ]) {
    assertCode(() => runtime.publish(invalid, payload), 'ACADEMY_CORE_INVALID_CHANNEL');
  }
  for (const options of [{ keep: true }, { forwardToNative: true }, { sessionStorage: 'true' }, { unknown: true }]) {
    assertCode(() => runtime.publish(channel, payload, options), 'ACADEMY_CORE_INVALID_PUBLISH_OPTIONS');
  }
  assert.equal(calls.publish.length, 1);
});

test('red: subscription projects retained detail and cleanup is idempotent', async t => {
  const { facade } = await materializeRuntime(t);
  const retained = { selected: 'course-42' };
  const { core, calls } = createCore({ retained });
  const runtime = facade.createAcademyCoreFacade(core, createBrowser());
  const channel = 'academy:academy-app:selection:changed';
  const received = [];

  runtime.startAcademyApp(applicationConfig());
  const cleanup = runtime.subscribe(channel, detail => {
    received.push(detail);
  });

  assert.deepEqual(received, [retained]);
  assert.equal(calls.subscribe.length, 1);
  assert.equal(calls.subscribe[0].channel, channel);
  assert.equal(calls.subscribe[0].owner.tagName, 'SPAN');
  cleanup();
  cleanup();
  calls.subscribe[0].callback({ selected: 'after-cleanup' });
  assert.equal(calls.unsubscribe.length, 1);
  assert.equal(calls.unsubscribe[0].channel, channel);
  assert.equal(calls.unsubscribe[0].owner, calls.subscribe[0].owner);
  assert.deepEqual(received, [retained]);
});

test('red: facade replays a synchronous Core retained payload once to late and reentrant Academy callbacks', async t => {
  const { facade } = await materializeRuntime(t);
  const retained = { selected: 'course-42' };
  const { core, calls } = createCore();
  core.subscribe = (channel, owner, callback) => {
    calls.subscribe.push({ channel, owner, callback });
    callback(retained);
  };
  const runtime = facade.createAcademyCoreFacade(core, createBrowser());
  const channel = 'academy:academy-app:selection:changed';
  const firstReceived = [];
  const reentrantReceived = [];
  const lateReceived = [];
  let cleanupReentrant;

  runtime.startAcademyApp(applicationConfig());
  const cleanupFirst = runtime.subscribe(channel, detail => {
    firstReceived.push(detail);
    if (cleanupReentrant === undefined) {
      cleanupReentrant = runtime.subscribe(channel, nextDetail => reentrantReceived.push(nextDetail));
    }
  });
  const owner = calls.subscribe[0].owner;

  assert.deepEqual(firstReceived, [retained]);
  assert.deepEqual(reentrantReceived, [retained]);
  assert.equal(calls.subscribe.length, 1);

  const cleanupLate = runtime.subscribe(channel, detail => lateReceived.push(detail));

  assert.deepEqual(lateReceived, [retained]);
  assert.equal(calls.subscribe.length, 1);
  assert.equal(calls.subscribe[0].owner, owner);

  calls.subscribe[0].callback({ selected: 'next-value' });
  assert.deepEqual(firstReceived, [retained, { selected: 'next-value' }]);
  assert.deepEqual(reentrantReceived, [retained, { selected: 'next-value' }]);
  assert.deepEqual(lateReceived, [retained, { selected: 'next-value' }]);

  cleanupFirst();
  cleanupFirst();
  cleanupReentrant();
  cleanupLate();
  calls.subscribe[0].callback({ selected: 'after-cleanup' });
  assert.deepEqual(calls.unsubscribe, [{ channel, owner }]);
  assert.deepEqual(firstReceived, [retained, { selected: 'next-value' }]);
  assert.deepEqual(reentrantReceived, [retained, { selected: 'next-value' }]);
  assert.deepEqual(lateReceived, [retained, { selected: 'next-value' }]);
});

test('red: facade replays retained detail after the last cleanup without a new Core event', async t => {
  const { facade } = await materializeRuntime(t);
  const { core, calls } = createCore();
  const runtime = facade.createAcademyCoreFacade(core, createBrowser());
  const channel = 'academy:academy-app:selection:changed';
  const retained = { selected: 'course-42' };
  const firstReceived = [];
  const secondReceived = [];

  runtime.startAcademyApp(applicationConfig());
  const cleanupFirst = runtime.subscribe(channel, detail => firstReceived.push(detail));
  const owner = calls.subscribe[0].owner;
  calls.subscribe[0].callback(retained);
  assert.deepEqual(firstReceived, [retained]);

  cleanupFirst();
  cleanupFirst();
  assert.deepEqual(calls.unsubscribe, [{ channel, owner }]);

  const cleanupSecond = runtime.subscribe(channel, detail => secondReceived.push(detail));
  assert.deepEqual(secondReceived, [retained]);
  assert.equal(calls.subscribe.length, 2);
  assert.equal(calls.subscribe[1].channel, channel);
  assert.equal(calls.subscribe[1].owner, owner);
  assert.equal(calls.unsubscribe.length, 1);

  cleanupSecond();
  cleanupSecond();
  assert.deepEqual(calls.unsubscribe, [
    { channel, owner },
    { channel, owner }
  ]);
});

test('red: facade isolates a throwing callback and reports its error after delivering to later callbacks', async t => {
  const { facade } = await materializeRuntime(t);
  const { core, calls } = createCore();
  const reports = [];
  const runtime = facade.createAcademyCoreFacade(core, createBrowser({ reportError: error => reports.push(error) }));
  const channel = 'academy:academy-app:selection:changed';
  const received = [];

  runtime.startAcademyApp(applicationConfig());
  const cleanupThrowing = runtime.subscribe(channel, () => {
    const error = new Error('subscriber secret: do-not-leak');
    error.code = 'ACADEMY_CORE_SUBSCRIPTION_CALLBACK_ERROR';
    throw error;
  });
  const cleanupLater = runtime.subscribe(channel, detail => received.push(detail));

  assert.doesNotThrow(() => calls.subscribe[0].callback({ selected: 'course-42' }));
  assert.deepEqual(received, [{ selected: 'course-42' }]);
  await new Promise(resolve => queueMicrotask(resolve));
  assert.equal(reports.length, 1);
  assert.equal(reports[0].code, 'ACADEMY_CORE_SUBSCRIPTION_CALLBACK_ERROR');
  assert.equal(reports[0].message, 'ACADEMY_CORE_SUBSCRIPTION_CALLBACK_ERROR');
  assert.doesNotMatch(`${reports[0].code}:${reports[0].message}`, /secret|do-not-leak/i);

  cleanupThrowing();
  cleanupLater();
});

test('red: facade multiplexes all Academy callbacks with one stable Core subscription owner', async t => {
  const { facade } = await materializeRuntime(t);
  const { core, calls } = createCore();
  const runtime = facade.createAcademyCoreFacade(core, createBrowser());
  const selectionChannel = 'academy:academy-app:selection:changed';
  const progressChannel = 'academy:academy-app:progress:changed';
  const firstSelection = [];
  const secondSelection = [];
  const rejoinedSelection = [];
  const progress = [];

  runtime.startAcademyApp(applicationConfig());
  const cleanupFirstSelection = runtime.subscribe(selectionChannel, detail => firstSelection.push(detail));
  const owner = calls.subscribe[0].owner;
  const cleanupSecondSelection = runtime.subscribe(selectionChannel, detail => secondSelection.push(detail));

  assert.equal(calls.subscribe.length, 1);
  assert.equal(owner.tagName, 'SPAN');
  calls.subscribe[0].callback({ selected: 'retained-selection' });
  assert.deepEqual(firstSelection, [{ selected: 'retained-selection' }]);
  assert.deepEqual(secondSelection, [{ selected: 'retained-selection' }]);

  cleanupFirstSelection();
  cleanupFirstSelection();
  calls.subscribe[0].callback({ selected: 'after-first-cleanup' });
  assert.equal(calls.unsubscribe.length, 0);
  assert.deepEqual(firstSelection, [{ selected: 'retained-selection' }]);
  assert.deepEqual(secondSelection, [{ selected: 'retained-selection' }, { selected: 'after-first-cleanup' }]);

  cleanupSecondSelection();
  cleanupSecondSelection();
  calls.subscribe[0].callback({ selected: 'after-last-cleanup' });
  assert.deepEqual(calls.unsubscribe, [{ channel: selectionChannel, owner }]);
  assert.deepEqual(secondSelection, [{ selected: 'retained-selection' }, { selected: 'after-first-cleanup' }]);

  const cleanupRejoinedSelection = runtime.subscribe(selectionChannel, detail => rejoinedSelection.push(detail));
  const cleanupProgress = runtime.subscribe(progressChannel, detail => progress.push(detail));

  assert.equal(calls.subscribe.length, 3);
  assert.equal(calls.subscribe[1].owner, owner);
  assert.equal(calls.subscribe[2].owner, owner);
  calls.subscribe[1].callback({ selected: 'rejoined-selection' });
  calls.subscribe[2].callback({ completed: 2 });
  assert.deepEqual(rejoinedSelection, [{ selected: 'after-first-cleanup' }, { selected: 'rejoined-selection' }]);
  assert.deepEqual(progress, [{ completed: 2 }]);

  cleanupRejoinedSelection();
  calls.subscribe[1].callback({ selected: 'after-rejoined-cleanup' });
  calls.subscribe[2].callback({ completed: 3 });
  assert.deepEqual(calls.unsubscribe, [
    { channel: selectionChannel, owner },
    { channel: selectionChannel, owner }
  ]);
  assert.deepEqual(rejoinedSelection, [{ selected: 'after-first-cleanup' }, { selected: 'rejoined-selection' }]);
  assert.deepEqual(progress, [{ completed: 2 }, { completed: 3 }]);

  cleanupProgress();
  cleanupProgress();
  calls.subscribe[2].callback({ completed: 4 });
  assert.deepEqual(calls.unsubscribe, [
    { channel: selectionChannel, owner },
    { channel: selectionChannel, owner },
    { channel: progressChannel, owner }
  ]);
  assert.deepEqual(progress, [{ completed: 2 }, { completed: 3 }]);
});

test('red: facade rejects valid pre-start pubsub without queuing Core operations', async t => {
  const { facade } = await materializeRuntime(t);
  const { core, calls } = createCore({ retained: { selected: 'queued-value' } });
  const runtime = facade.createAcademyCoreFacade(core, createBrowser());
  const channel = 'academy:academy-app:selection:changed';
  const payload = { selected: 'course-42' };
  const received = [];
  let cleanup;

  assertCode(() => runtime.publish('invalid-channel', payload), 'ACADEMY_CORE_INVALID_CHANNEL');
  assertCode(() => runtime.publish(channel, payload, { keep: true }), 'ACADEMY_CORE_INVALID_PUBLISH_OPTIONS');
  assertCode(() => runtime.subscribe('invalid-channel', () => {}), 'ACADEMY_CORE_INVALID_CHANNEL');
  assertCode(() => runtime.subscribe(channel, 'not-a-callback'), 'ACADEMY_CORE_INVALID_SUBSCRIPTION');
  assertCode(() => runtime.publish(channel, payload, { sessionStorage: true }), 'ACADEMY_CORE_NOT_STARTED');
  assertCode(() => {
    cleanup = runtime.subscribe(channel, detail => {
      received.push(detail);
    });
  }, 'ACADEMY_CORE_NOT_STARTED');

  assert.equal(cleanup, undefined);
  assert.deepEqual(calls.publish, []);
  assert.deepEqual(calls.subscribe, []);
  assert.deepEqual(calls.unsubscribe, []);
  assert.deepEqual(received, []);
});

test('red: generated runtime keeps Core client imports, exact pins, and browser binding isolated', async t => {
  const { runtimeRoot } = await materializeRuntime(t);
  const [facade, client, main, packageContents] = await Promise.all([
    readFile(path.join(runtimeRoot, ...runtimeFiles.facade), 'utf8'),
    readFile(path.join(runtimeRoot, ...runtimeFiles.client), 'utf8'),
    readFile(path.join(runtimeRoot, ...runtimeFiles.main), 'utf8'),
    readFile(path.join(runtimeRoot, 'package.json'), 'utf8')
  ]);
  const metadata = JSON.parse(packageContents);

  assert.doesNotMatch(facade, /@open-cells\/core/);
  assert.match(client, /from '@open-cells\/core'/);
  assert.doesNotMatch(main, /@open-cells\/core/);
  assert.match(main, /open-cells-client/);
  assert.doesNotMatch(main, /academy-core-facade/);
  assert.equal(metadata.dependencies['@open-cells/core'], '1.2.1');
  assert.equal(metadata.dependencies.lit, '3.3.3');
  assert.equal(metadata.dependencies['@lit-labs/router'], undefined);
});

test('red: data manager transitions loading to success with an immutable data snapshot', async t => {
  const { createDataManager } = await materializeDataManager(t);
  const published = [];
  const manager = createDataManager({
    request: async () => ({ course: { id: 42 } }),
    publish: state => published.push(state)
  });

  const result = await manager.load({ id: 42 });

  assert.equal(result.status, 'success');
  assert.deepEqual(manager.state, { status: 'success', data: { course: { id: 42 } } });
  assert.equal(Object.isFrozen(manager), true);
  assert.equal(Object.isFrozen(manager.state), true);
  assert.equal(Object.isFrozen(manager.state.data), true);
  assert.equal(Object.isFrozen(manager.state.data.course), true);
  assert.throws(() => {
    manager.state.data.course.id = 7;
  }, TypeError);
  assert.deepEqual(published.map(state => state.status), ['loading', 'success']);
});

test('red: data manager exposes only a safe frozen error value', async t => {
  const { createDataManager } = await materializeDataManager(t);
  const secret = { authorization: 'Bearer secret' };
  const manager = createDataManager({
    request: async () => {
      const error = new Error('request failed');
      error.headers = secret;
      throw error;
    }
  });

  const result = await manager.load({});

  assert.deepEqual(result, { status: 'error', error: { name: 'AcademyDataRequestError', message: 'Request failed' } });
  assert.deepEqual(manager.state, result);
  assert.deepEqual(Object.keys(manager.state.error), ['name', 'message']);
  assert.equal(Object.isFrozen(manager.state.error), true);
  assert.equal(JSON.stringify(manager.state), '{"status":"error","error":{"name":"AcademyDataRequestError","message":"Request failed"}}');
});

test('red: data manager never forwards secrets from an uncontrolled request error message', async t => {
  const { createDataManager } = await materializeDataManager(t);
  const published = [];
  const manager = createDataManager({
    request: async () => {
      throw new Error('Authorization: Bearer secret-token; body={password: secret}');
    },
    publish: state => published.push(state)
  });

  const result = await manager.load({});
  const exposed = JSON.stringify({ result, state: manager.state, published });

  assert.deepEqual(result, { status: 'error', error: { name: 'AcademyDataRequestError', message: 'Request failed' } });
  assert.doesNotMatch(exposed, /Authorization|Bearer|secret-token|password/);
});

test('red: data manager never forwards secrets from an uncontrolled request error name', async t => {
  const { createDataManager } = await materializeDataManager(t);
  const published = [];
  const manager = createDataManager({
    request: async () => {
      const error = new Error('Authorization: Bearer secret-token; body={password: secret}');
      error.name = 'Authorization: Bearer secret-token';
      throw error;
    },
    publish: state => published.push(state)
  });

  const result = await manager.load({});
  const exposed = JSON.stringify({ result, state: manager.state, published });

  assert.deepEqual(result, { status: 'error', error: { name: 'AcademyDataRequestError', message: 'Request failed' } });
  assert.doesNotMatch(exposed, /Authorization|Bearer|secret-token|password/);
});

test('red: data manager maps a non-OK response-like result to a safe error without exposing internals', async t => {
  const { createDataManager } = await materializeDataManager(t);
  const manager = createDataManager({
    request: async () => ({
      ok: false,
      status: 500,
      headers: { authorization: 'Bearer secret' },
      body: { secret: 'do-not-expose' }
    })
  });

  const result = await manager.load({});

  assert.deepEqual(result, { status: 'error', error: { name: 'AcademyDataRequestError', message: 'Request failed' } });
  assert.deepEqual(manager.state, result);
  assert.deepEqual(Object.keys(result.error), ['name', 'message']);
});

test('red: data manager rejects malformed abort signals before mutating state', async t => {
  const { createDataManager } = await materializeDataManager(t);
  const published = [];
  let requests = 0;
  const manager = createDataManager({
    request: async () => {
      requests += 1;
      return { unexpected: true };
    },
    publish: state => published.push(state)
  });

  assert.throws(() => manager.load({}, { signal: { aborted: false } }), TypeError);
  assert.deepEqual(manager.state, { status: 'idle' });
  assert.deepEqual(published, []);
  assert.equal(requests, 0);
});

test('red: an already-aborted external signal does not invoke request and settles as aborted once', async t => {
  const { createDataManager } = await materializeDataManager(t);
  const controller = new AbortController();
  const published = [];
  let calls = 0;
  controller.abort('already stopped');
  const manager = createDataManager({
    request: async () => {
      calls += 1;
      return { unexpected: true };
    },
    publish: state => published.push(state.status)
  });

  const result = await manager.load({}, { signal: controller.signal });

  assert.equal(calls, 0);
  assert.deepEqual(result, { status: 'aborted' });
  assert.deepEqual(manager.state, { status: 'aborted' });
  assert.deepEqual(published, ['loading', 'aborted']);
});

test('red: data manager cancellation and external abort prevent late terminal updates', async t => {
  const { createDataManager } = await materializeDataManager(t);
  const deferred = [];
  const manager = createDataManager({
    request: (_input, { signal }) => new Promise(resolve => {
      deferred.push(() => resolve(signal.aborted ? Promise.reject(new DOMException('Aborted', 'AbortError')) : { stale: true }));
    })
  });
  const external = new AbortController();

  const cancelled = manager.load({ id: 'cancelled' });
  await Promise.resolve();
  manager.cancel('stop');
  deferred.shift()();
  assert.deepEqual(await cancelled, { status: 'aborted' });
  assert.deepEqual(manager.state, { status: 'aborted' });

  const pending = manager.load({ id: 'external' }, { signal: external.signal });
  await Promise.resolve();
  external.abort('stop');
  deferred.shift()();
  const result = await pending;

  assert.deepEqual(result, { status: 'aborted' });
  assert.deepEqual(manager.state, { status: 'aborted' });
  manager.cancel();
  assert.deepEqual(manager.state, { status: 'aborted' });
});

test('red: manual cancellation publishes one aborted terminal transition when request rejects AbortError', async t => {
  const { createDataManager } = await materializeDataManager(t);
  const published = [];
  const manager = createDataManager({
    request: (_input, { signal }) => new Promise((_resolve, reject) => {
      signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true });
    }),
    publish: state => published.push(state.status)
  });

  const pending = manager.load({});
  await Promise.resolve();
  manager.cancel('stop');

  assert.deepEqual(await pending, { status: 'aborted' });
  assert.deepEqual(manager.state, { status: 'aborted' });
  assert.deepEqual(published, ['loading', 'aborted']);
});

test('red: external abort publishes one aborted terminal transition when request rejects AbortError', async t => {
  const { createDataManager } = await materializeDataManager(t);
  const external = new AbortController();
  const published = [];
  const manager = createDataManager({
    request: (_input, { signal }) => new Promise((_resolve, reject) => {
      signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true });
    }),
    publish: state => published.push(state.status)
  });

  const pending = manager.load({}, { signal: external.signal });
  await Promise.resolve();
  external.abort('stop');

  assert.deepEqual(await pending, { status: 'aborted' });
  assert.deepEqual(manager.state, { status: 'aborted' });
  assert.deepEqual(published, ['loading', 'aborted']);
});

test('red: data manager makes the newest load win and disposal is final and idempotent', async t => {
  const { createDataManager } = await materializeDataManager(t);
  let resolveA;
  const manager = createDataManager({
    request: input => new Promise(resolve => {
      if (input.id === 'A') {
        resolveA = () => resolve({ id: 'A' });
      } else {
        resolve({ id: 'B' });
      }
    })
  });

  const first = manager.load({ id: 'A' });
  const newest = await manager.load({ id: 'B' });
  resolveA();
  const stale = await first;

  assert.deepEqual(newest, { status: 'success', data: { id: 'B' } });
  assert.deepEqual(stale, { status: 'aborted' });
  assert.deepEqual(manager.state, newest);
  manager.dispose();
  manager.dispose();
  assert.deepEqual(manager.state, { status: 'aborted' });
  assertCode(() => manager.load({ id: 'C' }), 'ACADEMY_DATA_MANAGER_DISPOSED');
});

test('break: disposing one active load publishes one aborted transition', async t => {
  const { createDataManager } = await materializeDataManager(t);
  const published = [];
  const manager = createDataManager({
    request: (_input, { signal }) => new Promise((_resolve, reject) => {
      signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true });
    }),
    publish: state => published.push(state.status)
  });

  const pending = manager.load({ id: 'active' });
  await Promise.resolve();
  manager.dispose();
  assert.deepEqual(await pending, { status: 'aborted' });
  assert.deepEqual(published, ['loading', 'aborted']);
});

test('red: manual cancellation settles an ignored request as aborted without a late rejection', async t => {
  const { createDataManager } = await materializeDataManager(t);
  const ignoredRequest = deferred();
  const published = [];
  const manager = createDataManager({
    request: () => ignoredRequest.promise,
    publish: state => published.push(state.status)
  });
  t.after(() => ignoredRequest.resolve({ cleanup: true }));

  const pending = manager.load({ id: 'manual-cancel' });
  const settlement = trackSettlement(pending);
  await flushPromiseJobs();
  manager.cancel('stop');
  await flushPromiseJobs();

  assert.equal(settlement.settled, true);
  assert.deepEqual(settlement.value, { status: 'aborted' });
  assert.deepEqual(manager.state, { status: 'aborted' });
  assert.deepEqual(published, ['loading', 'aborted']);
  await assertNoUnhandledRejection(async () => {
    ignoredRequest.reject(new Error('late ignored request rejection'));
    await flushPromiseJobs();
  });
  assert.deepEqual(await pending, { status: 'aborted' });
  assert.deepEqual(published, ['loading', 'aborted']);
});

test('red: external abort settles an ignored request as aborted without a late terminal update', async t => {
  const { createDataManager } = await materializeDataManager(t);
  const external = new AbortController();
  const ignoredRequest = deferred();
  const published = [];
  const manager = createDataManager({
    request: () => ignoredRequest.promise,
    publish: state => published.push(state.status)
  });
  t.after(() => ignoredRequest.resolve({ cleanup: true }));

  const pending = manager.load({ id: 'external-abort' }, { signal: external.signal });
  const settlement = trackSettlement(pending);
  await flushPromiseJobs();
  external.abort('stop');
  await flushPromiseJobs();

  assert.equal(settlement.settled, true);
  assert.deepEqual(settlement.value, { status: 'aborted' });
  assert.deepEqual(manager.state, { status: 'aborted' });
  assert.deepEqual(published, ['loading', 'aborted']);
  ignoredRequest.resolve({ stale: true });
  await flushPromiseJobs();
  assert.deepEqual(await pending, { status: 'aborted' });
  assert.deepEqual(manager.state, { status: 'aborted' });
  assert.deepEqual(published, ['loading', 'aborted']);
});

test('red: disposal settles an ignored request as aborted without a late rejection', async t => {
  const { createDataManager } = await materializeDataManager(t);
  const ignoredRequest = deferred();
  const published = [];
  const manager = createDataManager({
    request: () => ignoredRequest.promise,
    publish: state => published.push(state.status)
  });
  t.after(() => ignoredRequest.resolve({ cleanup: true }));

  const pending = manager.load({ id: 'dispose' });
  const settlement = trackSettlement(pending);
  await flushPromiseJobs();
  manager.dispose();
  await flushPromiseJobs();

  assert.equal(settlement.settled, true);
  assert.deepEqual(settlement.value, { status: 'aborted' });
  assert.deepEqual(manager.state, { status: 'aborted' });
  assert.deepEqual(published, ['loading', 'aborted']);
  await assertNoUnhandledRejection(async () => {
    ignoredRequest.reject(new Error('late ignored request rejection'));
    await flushPromiseJobs();
  });
  assert.deepEqual(await pending, { status: 'aborted' });
  assert.deepEqual(published, ['loading', 'aborted']);
});

test('red: superseding an ignored request settles only the stale caller and lets the newest load publish', async t => {
  const { createDataManager } = await materializeDataManager(t);
  const firstRequest = deferred();
  const secondRequest = deferred();
  const published = [];
  const manager = createDataManager({
    request: input => input.id === 'first' ? firstRequest.promise : secondRequest.promise,
    publish: state => published.push(state.status)
  });
  t.after(() => {
    firstRequest.resolve({ cleanup: 'first' });
    secondRequest.resolve({ cleanup: 'second' });
  });

  const first = manager.load({ id: 'first' });
  const firstSettlement = trackSettlement(first);
  await flushPromiseJobs();
  const second = manager.load({ id: 'second' });
  await flushPromiseJobs();

  assert.equal(firstSettlement.settled, true);
  assert.deepEqual(firstSettlement.value, { status: 'aborted' });
  assert.deepEqual(published, ['loading', 'loading']);
  secondRequest.resolve({ id: 'second' });
  assert.deepEqual(await second, { status: 'success', data: { id: 'second' } });
  assert.deepEqual(manager.state, { status: 'success', data: { id: 'second' } });
  assert.deepEqual(published, ['loading', 'loading', 'success']);
  await assertNoUnhandledRejection(async () => {
    firstRequest.reject(new Error('late ignored request rejection'));
    await flushPromiseJobs();
  });
  assert.deepEqual(await first, { status: 'aborted' });
  assert.deepEqual(manager.state, { status: 'success', data: { id: 'second' } });
  assert.deepEqual(published, ['loading', 'loading', 'success']);
});

test('red: generated i18n adapter requires installed IntlMsg and delegates translations through it', async t => {
  replaceGlobal(t, 'IntlMsg', undefined);
  const { runtimeRoot } = await materializeRuntime(t);
  const [messages, academyIntlMsg] = await Promise.all([
    import(pathToFileURL(path.join(runtimeRoot, ...i18nFile)).href),
    import(pathToFileURL(path.join(runtimeRoot, ...academyWidgetFiles.intlMsg)).href)
  ]);

  assert.deepEqual(Object.keys(messages.catalogs.en), Object.keys(messages.catalogs.es));
  await assert.rejects(messages.loadMessages('en'), error => error?.code === 'ACADEMY_I18N_NOT_INSTALLED');
  assert.throws(() => messages.translate('welcome'), error => error?.code === 'ACADEMY_I18N_NOT_INSTALLED');
  academyIntlMsg.installIntlMsg({ catalogs: messages.catalogs, language: 'en', forTesting: true });
  await messages.loadMessages('en');
  assert.equal(messages.translate('welcome', { name: 'Ada' }), 'Welcome, Ada!');
  await messages.loadMessages('es');
  assert.equal(messages.translate('welcome', { name: 'Ada' }), '¡Bienvenida, Ada!');
  await assert.rejects(messages.loadMessages('fr'), error => error?.code === 'ACADEMY_I18N_UNSUPPORTED_LANGUAGE');
  assert.throws(() => messages.translate('missing'), error => error?.code === 'ACADEMY_I18N_MISSING_KEY');
  for (const catalog of Object.values(messages.catalogs)) {
    for (const value of Object.values(catalog)) assert.notEqual(value, '');
  }
});

test('red: app language switching ignores a stale deferred ES request after EN becomes latest', async t => {
  const spanish = deferred();
  const english = deferred();
  const targetWindow = new EventTarget();
  const targetDocument = { documentElement: { lang: 'es' }, title: '' };
  const gates = new Map([
    ['es', spanish],
    ['en', english]
  ]);
  const requests = [];
  replaceGlobal(t, 'window', targetWindow);
  replaceGlobal(t, 'document', targetDocument);
  replaceGlobal(t, 'IntlMsg', undefined);
  replaceGlobal(t, '__academyDeferredLanguageGates', gates);
  replaceGlobal(t, '__academyDeferredLanguageRequests', requests);
  const appMessages = await materializeDeferredAppMessages(t);
  await appMessages.appIntlMsg.setLanguage('es');
  targetDocument.title = appMessages.appIntlMsg.t('app.title');
  const events = [];
  targetWindow.addEventListener('academy-language-changed', event => events.push(event.detail));

  const staleSpanish = appMessages.switchAppLanguage('es');
  const latestEnglish = appMessages.switchAppLanguage('en');
  assert.deepEqual(requests, ['es', 'en']);
  spanish.resolve();

  assert.equal(await staleSpanish, undefined);
  assert.deepEqual(events, []);
  assert.equal(appMessages.appIntlMsg.lang, 'es');
  assert.equal(targetDocument.documentElement.lang, 'es');
  assert.equal(targetDocument.title, appMessages.appIntlMsg.t('app.title'));
  english.resolve();

  assert.equal(await latestEnglish, 'en');
  assert.deepEqual(events, ['en']);
  assert.equal(appMessages.appIntlMsg.lang, 'en');
  assert.equal(targetDocument.documentElement.lang, 'en');
  assert.equal(targetDocument.title, appMessages.appIntlMsg.t('app.title'));
});

test('red: app language switching returns non-committing after synchronous ES listener reentry to EN', async t => {
  const spanish = deferred();
  const english = deferred();
  const targetWindow = new EventTarget();
  const targetDocument = { documentElement: { lang: 'en' }, title: '' };
  const gates = new Map([
    ['es', spanish],
    ['en', english]
  ]);
  const requests = [];
  replaceGlobal(t, 'window', targetWindow);
  replaceGlobal(t, 'document', targetDocument);
  replaceGlobal(t, 'IntlMsg', undefined);
  replaceGlobal(t, '__academyDeferredLanguageGates', gates);
  replaceGlobal(t, '__academyDeferredLanguageRequests', requests);
  const appMessages = await materializeDeferredAppMessages(t);
  targetDocument.title = appMessages.appIntlMsg.t('app.title');
  const events = [];
  let reentrantEnglish;
  targetWindow.addEventListener('academy-language-changed', event => {
    events.push(event.detail);
    if (event.detail === 'es') reentrantEnglish = appMessages.switchAppLanguage('en');
  });

  const originatingSpanish = appMessages.switchAppLanguage('es');
  spanish.resolve();

  assert.equal(await originatingSpanish, undefined);
  assert.deepEqual(requests, ['es', 'en']);
  assert.deepEqual(events, ['es']);
  english.resolve();

  assert.equal(await reentrantEnglish, 'en');
  assert.deepEqual(events, ['es', 'en']);
  assert.equal(appMessages.appIntlMsg.lang, 'en');
  assert.equal(targetDocument.documentElement.lang, 'en');
  assert.equal(targetDocument.title, appMessages.appIntlMsg.t('app.title'));
});

test('red: Academy Widget capability materializes independent IntlMsg, mixin, and scoped UI runtime for app and component profiles', async t => {
  const languageTarget = new EventTarget();
  const addLanguageListener = languageTarget.addEventListener.bind(languageTarget);
  const removeLanguageListener = languageTarget.removeEventListener.bind(languageTarget);
  const dispatchLanguageEvent = languageTarget.dispatchEvent.bind(languageTarget);
  const registrations = new Map();
  replaceGlobal(t, 'addEventListener', addLanguageListener);
  replaceGlobal(t, 'removeEventListener', removeLanguageListener);
  replaceGlobal(t, 'dispatchEvent', dispatchLanguageEvent);
  replaceGlobal(t, 'customElements', {
    define(tag, constructor) { registrations.set(tag, constructor); },
    get(tag) { return registrations.get(tag); }
  });
  replaceGlobal(t, 'IntlMsg', undefined);

  const app = await materializeRuntime(t);
  const component = await materializeRuntime(t, {
    profile: 'component',
    kind: 'component',
    name: 'academy-widget-component'
  });
  const [appIntlMsg, appWidgetMixin, appTypeText, appButtonDefault, componentIntlMsg, componentWidgetMixin, componentTypeText, componentButtonDefault] = await Promise.all([
    import(pathToFileURL(path.join(app.runtimeRoot, ...academyWidgetFiles.intlMsg)).href),
    import(pathToFileURL(path.join(app.runtimeRoot, ...academyWidgetFiles.widgetMixin)).href),
    import(pathToFileURL(path.join(app.runtimeRoot, ...academyWidgetFiles.typeText)).href),
    import(pathToFileURL(path.join(app.runtimeRoot, ...academyWidgetFiles.buttonDefault)).href),
    import(pathToFileURL(path.join(component.runtimeRoot, ...academyWidgetFiles.intlMsg)).href),
    import(pathToFileURL(path.join(component.runtimeRoot, ...academyWidgetFiles.widgetMixin)).href),
    import(pathToFileURL(path.join(component.runtimeRoot, ...academyWidgetFiles.typeText)).href),
    import(pathToFileURL(path.join(component.runtimeRoot, ...academyWidgetFiles.buttonDefault)).href)
  ]);

  assert.equal(typeof appIntlMsg.installIntlMsg, 'function');
  assert.equal(typeof componentIntlMsg.installIntlMsg, 'function');
  assert.equal(typeof appWidgetMixin.WidgetMixin, 'function');
  assert.equal(typeof componentWidgetMixin.WidgetMixin, 'function');
  assert.equal(typeof appTypeText.AcademyTypeText, 'function');
  assert.equal(typeof componentTypeText.AcademyTypeText, 'function');
  assert.equal(typeof appButtonDefault.AcademyButtonDefault, 'function');
  assert.equal(typeof componentButtonDefault.AcademyButtonDefault, 'function');
  assert.equal(registrations.size, 0);

  const catalogs = {
    en: { action: 'Continue', welcome: 'Welcome, {name}!' },
    es: { action: 'Continuar', welcome: '¡Bienvenida, {name}!' }
  };
  const languageChanges = [];
  globalThis.addEventListener('language-update', event => languageChanges.push(event.detail.language));
  const intl = appIntlMsg.installIntlMsg({ catalogs, language: 'en', localesHost: '/academy-locales', forTesting: true });
  catalogs.en.welcome = 'Changed outside the runtime';

  assert.equal(globalThis.IntlMsg, intl);
  assert.equal(intl.lang, 'en');
  assert.equal(intl.localesHost, '/academy-locales');
  assert.equal(intl.forTesting, true);
  assert.equal(typeof intl.loadUrlResources, 'function');
  assert.equal(typeof intl.setLanguage, 'function');
  assert.equal(intl.t('welcome', { name: '<strong>Ada</strong>' }), 'Welcome, <strong>Ada</strong>!');
  assert.equal(intl.t('missing-key'), 'missing-key');
  await intl.setLanguage('es');
  assert.equal(intl.t('welcome', { name: 'Ada' }), '¡Bienvenida, Ada!');
  assert.deepEqual(languageChanges, ['es']);
  intl.lang = 'en';
  await intl.loadUrlResourcesComplete;
  assert.equal(intl.t('action'), 'Continue');
  await assert.rejects(intl.setLanguage('fr'), error => error?.code === 'ACADEMY_I18N_UNSUPPORTED_LANGUAGE');
  assert.throws(
    () => appIntlMsg.installIntlMsg({ catalogs: { en: { action: 'Continue' }, es: { welcome: 'Continuar' } } }),
    error => error?.code === 'ACADEMY_I18N_INVALID_CATALOGS'
  );

  class Host extends EventTarget {
    constructor() {
      super();
      this.localName = 'academy-widget-host';
      this.updateRequests = 0;
    }

    connectedCallback() {
      this.connected = true;
    }

    requestUpdate() {
      this.updateRequests += 1;
    }
  }

  class WidgetHost extends appWidgetMixin.WidgetMixin(Host) {}
  const host = new WidgetHost();
  host.connectedCallback();
  assert.equal(host.connected, true);
  assert.equal(host.t('welcome', { name: 'Ada' }), 'Welcome, Ada!');
  const continued = new Promise(resolve => host.addEventListener('academy-widget-host-continue', resolve, { once: true }));
  assert.equal(host.emitEvent('continue', { lesson: 'runtime' }), true);
  const emitted = await continued;
  assert.deepEqual(emitted.detail, { lesson: 'runtime' });
  assert.equal(emitted.bubbles, true);
  assert.equal(emitted.composed, true);
  assert.equal(emitted.cancelable, true);
  assert.throws(() => host.emitEvent('   '), error => error?.code === 'ACADEMY_WIDGET_EVENT_NAME_REQUIRED');
  await intl.setLanguage('es');
  assert.equal(host.updateRequests, 1);
  host.disconnectedCallback();
  await intl.setLanguage('en');
  assert.equal(host.updateRequests, 1);

  const typeText = new appTypeText.AcademyTypeText();
  typeText.text = intl.t('welcome', { name: 'Ada' });
  const typeTextView = typeText.render();
  assert.ok(typeTextView.values.includes('Welcome, Ada!'));
  const buttonDefault = new appButtonDefault.AcademyButtonDefault();
  buttonDefault.text = intl.t('action');
  const buttonView = buttonDefault.render();
  assert.match(buttonView.strings.join(''), /<button/);
  assert.ok(buttonView.values.includes('Continue'));

  const response = deferred();
  const requestedUrls = [];
  const remoteIntl = appIntlMsg.installIntlMsg({
    language: 'en',
    localesHost: 'https://academy.test/locales.json',
    fetchImpl: async url => {
      requestedUrls.push(url);
      return response.promise;
    },
    forTesting: true
  });
  const remoteLoad = remoteIntl.loadUrlResourcesComplete;
  const remoteSettlement = trackSettlement(remoteLoad);
  await flushPromiseJobs();
  assert.equal(requestedUrls.length, 1);
  assert.equal(requestedUrls[0], 'https://academy.test/locales.json');
  assert.equal(remoteSettlement.settled, false);
  assert.equal(remoteIntl.t('welcome'), 'welcome');
  response.resolve({
    ok: true,
    json: async () => ({
      en: { action: 'Continue', welcome: 'Welcome, {name}!' },
      es: { action: 'Continuar', welcome: '¡Bienvenida, {name}!' }
    })
  });
  await remoteLoad;
  assert.equal(remoteIntl.t('welcome', { name: 'Ada' }), 'Welcome, Ada!');
  await remoteIntl.setLanguage('es');
  assert.equal(remoteIntl.t('action'), 'Continuar');
});

test('red: IntlMsg starts the current localesHost load once and updates connected widgets only for its winning catalog', async t => {
  const languageTarget = new EventTarget();
  const deferredResponses = new Map();
  const requestedUrls = [];
  replaceGlobal(t, 'addEventListener', languageTarget.addEventListener.bind(languageTarget));
  replaceGlobal(t, 'removeEventListener', languageTarget.removeEventListener.bind(languageTarget));
  replaceGlobal(t, 'dispatchEvent', languageTarget.dispatchEvent.bind(languageTarget));
  replaceGlobal(t, 'IntlMsg', undefined);
  const { runtimeRoot } = await materializeRuntime(t);
  const [{ installIntlMsg }, { WidgetMixin }] = await Promise.all([
    import(pathToFileURL(path.join(runtimeRoot, ...academyWidgetFiles.intlMsg)).href),
    import(pathToFileURL(path.join(runtimeRoot, ...academyWidgetFiles.widgetMixin)).href)
  ]);

  class Host extends EventTarget {
    constructor() {
      super();
      this.localName = 'academy-runtime-host';
      this.updateRequests = 0;
    }

    requestUpdate() {
      this.updateRequests += 1;
    }
  }

  class WidgetHost extends WidgetMixin(Host) {}
  const host = new WidgetHost();
  host.connectedCallback();
  const intl = installIntlMsg({
    fetchImpl: async url => {
      requestedUrls.push(url);
      const response = deferred();
      deferredResponses.set(url, response);
      return response.promise;
    }
  });

  intl.localesHost = 'https://academy.test/a.json';
  const staleLoad = intl.loadUrlResourcesComplete;
  intl.localesHost = 'https://academy.test/b.json';
  const currentLoad = intl.loadUrlResourcesComplete;
  await flushPromiseJobs();
  assert.deepEqual(requestedUrls, ['https://academy.test/a.json', 'https://academy.test/b.json']);
  deferredResponses.get('https://academy.test/b.json').resolve({
    ok: true,
    json: async () => ({
      en: { lesson: 'Current lesson' },
      es: { lesson: 'Lección actual' }
    })
  });
  await currentLoad;
  assert.equal(intl.t('lesson'), 'Current lesson');
  assert.equal(host.updateRequests, 1);
  deferredResponses.get('https://academy.test/a.json').resolve({
    ok: true,
    json: async () => ({
      en: { lesson: 'Stale lesson' },
      es: { lesson: 'Lección obsoleta' }
    })
  });
  await staleLoad;
  assert.equal(intl.t('lesson'), 'Current lesson');
  assert.equal(host.updateRequests, 1);
  host.disconnectedCallback();
});

test('red: IntlMsg commits a language requested before localesHost assigns its first catalog', async t => {
  const languageTarget = new EventTarget();
  const response = deferred();
  const updates = [];
  replaceGlobal(t, 'addEventListener', languageTarget.addEventListener.bind(languageTarget));
  replaceGlobal(t, 'removeEventListener', languageTarget.removeEventListener.bind(languageTarget));
  replaceGlobal(t, 'dispatchEvent', languageTarget.dispatchEvent.bind(languageTarget));
  globalThis.addEventListener('language-update', event => updates.push(event.detail.language));
  const { runtimeRoot } = await materializeRuntime(t);
  const { installIntlMsg } = await import(pathToFileURL(path.join(runtimeRoot, ...academyWidgetFiles.intlMsg)).href);
  const intl = installIntlMsg({
    fetchImpl: async url => {
      assert.equal(url, 'https://academy.test/locales.json');
      return response.promise;
    }
  });

  intl.lang = 'es';
  assert.equal(intl.lang, 'es');
  intl.localesHost = 'https://academy.test/locales.json';
  const load = intl.loadUrlResourcesComplete;
  response.resolve({
    ok: true,
    json: async () => ({
      en: { action: 'Continue' },
      es: { action: 'Continuar' }
    })
  });

  await load;
  assert.equal(intl.lang, 'es');
  assert.equal(intl.t('action'), 'Continuar');
  assert.deepEqual(updates, ['es']);
});

test('red: IntlMsg commits the latest language assigned during its current URL load', async t => {
  const languageTarget = new EventTarget();
  const response = deferred();
  const updates = [];
  replaceGlobal(t, 'addEventListener', languageTarget.addEventListener.bind(languageTarget));
  replaceGlobal(t, 'removeEventListener', languageTarget.removeEventListener.bind(languageTarget));
  replaceGlobal(t, 'dispatchEvent', languageTarget.dispatchEvent.bind(languageTarget));
  globalThis.addEventListener('language-update', event => updates.push(event.detail.language));
  const { runtimeRoot } = await materializeRuntime(t);
  const { installIntlMsg } = await import(pathToFileURL(path.join(runtimeRoot, ...academyWidgetFiles.intlMsg)).href);
  const intl = installIntlMsg({
    language: 'en',
    catalogs: {
      en: { title: 'Previous academy' },
      es: { title: 'Academia anterior' }
    },
    localesHost: 'https://academy.test/a.json',
    fetchImpl: async url => {
      assert.equal(url, 'https://academy.test/a.json');
      return response.promise;
    }
  });

  intl.loadUrlResources();
  await flushPromiseJobs();
  intl.lang = 'es';
  response.resolve({
    ok: true,
    json: async () => ({
      en: { title: 'Academy' },
      es: { title: 'Academia' }
    })
  });

  await intl.loadUrlResourcesComplete;
  assert.equal(intl.lang, 'es');
  assert.equal(intl.t('title'), 'Academia');
  assert.deepEqual(updates, ['es']);
});

test('red: IntlMsg rejects a later unsupported requested language without replacing the last valid catalog', async t => {
  const responses = new Map();
  const { runtimeRoot } = await materializeRuntime(t);
  const { installIntlMsg } = await import(pathToFileURL(path.join(runtimeRoot, ...academyWidgetFiles.intlMsg)).href);
  const intl = installIntlMsg({
    localesHost: 'https://academy.test/valid.json',
    fetchImpl: async url => {
      const response = deferred();
      responses.set(url, response);
      return response.promise;
    }
  });
  const initialLoad = intl.loadUrlResourcesComplete;
  await flushPromiseJobs();
  responses.get('https://academy.test/valid.json').resolve({
    ok: true,
    json: async () => ({
      en: { action: 'Continue' },
      es: { action: 'Continuar' }
    })
  });
  await initialLoad;
  assert.equal(intl.lang, 'en');
  assert.equal(intl.t('action'), 'Continue');

  intl.localesHost = 'https://academy.test/replacement.json';
  const replacementLoad = intl.loadUrlResourcesComplete;
  await flushPromiseJobs();
  intl.lang = 'fr';
  assert.equal(intl.lang, 'fr');
  responses.get('https://academy.test/replacement.json').resolve({
    ok: true,
    json: async () => ({
      en: { action: 'Next' },
      es: { action: 'Siguiente' }
    })
  });

  await assert.rejects(replacementLoad, error => error?.code === 'ACADEMY_I18N_UNSUPPORTED_LANGUAGE');
  assert.equal(intl.lang, 'en');
  assert.equal(intl.t('action'), 'Continue');
});

test('red: IntlMsg observes a stale URL rejection while its current catalog remains usable', async t => {
  const responses = new Map();
  const { runtimeRoot } = await materializeRuntime(t);
  const { installIntlMsg } = await import(pathToFileURL(path.join(runtimeRoot, ...academyWidgetFiles.intlMsg)).href);
  const intl = installIntlMsg({
    localesHost: 'https://academy.test/a.json',
    fetchImpl: async url => {
      const response = deferred();
      responses.set(url, response);
      return response.promise;
    }
  });
  const staleLoad = intl.loadUrlResourcesComplete;
  const currentLoad = intl.loadUrlResources('https://academy.test/b.json');
  await flushPromiseJobs();
  responses.get('https://academy.test/b.json').resolve({
    ok: true,
    json: async () => ({
      en: { lesson: 'Current lesson' },
      es: { lesson: 'Lección actual' }
    })
  });
  await currentLoad;
  assert.equal(intl.t('lesson'), 'Current lesson');
  await assertNoUnhandledRejection(async () => {
    responses.get('https://academy.test/a.json').reject(new Error('stale network failure'));
    await flushPromiseJobs();
  });
  await assert.rejects(staleLoad, error => error?.code === 'ACADEMY_I18N_LOAD_FAILED');
  assert.equal(intl.t('lesson'), 'Current lesson');
});

test('red: stale IntlMsg catalogs reject against their request language without disturbing the current load', async t => {
  const languageTarget = new EventTarget();
  const responses = new Map();
  const updates = [];
  replaceGlobal(t, 'addEventListener', languageTarget.addEventListener.bind(languageTarget));
  replaceGlobal(t, 'removeEventListener', languageTarget.removeEventListener.bind(languageTarget));
  replaceGlobal(t, 'dispatchEvent', languageTarget.dispatchEvent.bind(languageTarget));
  globalThis.addEventListener('language-update', event => updates.push(event.detail.language));
  const { runtimeRoot } = await materializeRuntime(t);
  const { installIntlMsg } = await import(pathToFileURL(path.join(runtimeRoot, ...academyWidgetFiles.intlMsg)).href);
  const intl = installIntlMsg({
    language: 'es',
    localesHost: 'https://academy.test/a.json',
    fetchImpl: async url => {
      const response = deferred();
      responses.set(url, response);
      return response.promise;
    }
  });
  const staleLoad = intl.loadUrlResourcesComplete;
  intl.lang = 'en';
  const currentLoad = intl.loadUrlResources('https://academy.test/b.json');
  const currentSettlement = trackSettlement(currentLoad);
  await flushPromiseJobs();

  await assertNoUnhandledRejection(async () => {
    responses.get('https://academy.test/a.json').resolve({
      ok: true,
      json: async () => ({ en: { lesson: 'A lesson' } })
    });
    await flushPromiseJobs();
  });
  await assert.rejects(staleLoad, error => error?.code === 'ACADEMY_I18N_UNSUPPORTED_LANGUAGE');
  assert.equal(currentSettlement.settled, false);
  assert.equal(intl.loadUrlResourcesComplete, currentLoad);
  assert.equal(intl.lang, 'en');
  assert.equal(intl.t('lesson'), 'lesson');
  assert.deepEqual(updates, []);

  responses.get('https://academy.test/b.json').resolve({
    ok: true,
    json: async () => ({ en: { lesson: 'B lesson' } })
  });
  await currentLoad;
  assert.equal(intl.t('lesson'), 'B lesson');
  assert.deepEqual(updates, ['en']);
});

test('break: IntlMsg keeps an invalid explicit URL rejection observable without an unhandled rejection', async t => {
  const { runtimeRoot } = await materializeRuntime(t);
  const { installIntlMsg } = await import(pathToFileURL(path.join(runtimeRoot, ...academyWidgetFiles.intlMsg)).href);
  const intl = installIntlMsg({
    catalogs: {
      en: { lesson: 'Lesson' },
      es: { lesson: 'Lección' }
    }
  });
  const invalidLoad = intl.loadUrlResources('');
  await assertNoUnhandledRejection(async () => {
    await flushPromiseJobs();
  });
  await assert.rejects(invalidLoad, error => error?.code === 'ACADEMY_I18N_INVALID_INPUT');
});

test('red: IntlMsg rejects empty catalog keysets and empty messages from embedded and URL sources', async t => {
  const { runtimeRoot } = await materializeRuntime(t);
  const { installIntlMsg } = await import(pathToFileURL(path.join(runtimeRoot, ...academyWidgetFiles.intlMsg)).href);

  assert.throws(
    () => installIntlMsg({ catalogs: { en: {}, es: {} } }),
    error => error?.code === 'ACADEMY_I18N_INVALID_CATALOGS'
  );
  assert.throws(
    () => installIntlMsg({ catalogs: { en: { lesson: '' }, es: { lesson: 'Lección' } } }),
    error => error?.code === 'ACADEMY_I18N_INVALID_CATALOGS'
  );
  const response = deferred();
  const intl = installIntlMsg({
    localesHost: 'https://academy.test/empty.json',
    fetchImpl: async () => response.promise
  });
  const load = intl.loadUrlResourcesComplete;
  response.resolve({ ok: true, json: async () => ({ en: {}, es: {} }) });
  await assert.rejects(load, error => error?.code === 'ACADEMY_I18N_INVALID_CATALOGS');
});

test('red: generated Academy controls resolve in an actual scoped Lit host without public-tag registration', { timeout: 60_000 }, async t => {
  const { root, runtimeRoot } = await materializeDomRuntime(t);
  const { Window } = await import(pathToFileURL(path.join(root, 'node_modules', 'happy-dom', 'lib', 'index.js')).href);
  const window = new Window({ url: 'https://academy.test/' });
  await installHappyDomScopedRegistry(t, { root, window });
  replaceGlobal(t, 'IntlMsg', undefined);
  const [{ LitElement, html }, { ScopedElementsMixin }, { installIntlMsg }, { WidgetMixin }, { AcademyTypeText }, { AcademyButtonDefault }] = await Promise.all([
    import(pathToFileURL(path.join(root, 'node_modules', 'lit', 'index.js')).href),
    import(pathToFileURL(path.join(root, 'node_modules', '@open-wc', 'scoped-elements', 'lit-element.js')).href),
    import(pathToFileURL(path.join(runtimeRoot, ...academyWidgetFiles.intlMsg)).href),
    import(pathToFileURL(path.join(runtimeRoot, ...academyWidgetFiles.widgetMixin)).href),
    import(pathToFileURL(path.join(runtimeRoot, ...academyWidgetFiles.typeText)).href),
    import(pathToFileURL(path.join(runtimeRoot, ...academyWidgetFiles.buttonDefault)).href)
  ]);

  class AcademyDomEventChild extends WidgetMixin(LitElement) {
    render() {
      return html`<span>event child</span>`;
    }
  }

  class AcademyDomHost extends WidgetMixin(ScopedElementsMixin(LitElement)) {
    static scopedElements = {
      'academy-type-text': AcademyTypeText,
      'academy-button-default': AcademyButtonDefault,
      'academy-dom-event-child': AcademyDomEventChild
    };

    constructor() {
      super();
      this.languageUpdateRequests = 0;
    }

    requestUpdate(...args) {
      this.languageUpdateRequests = (this.languageUpdateRequests ?? 0) + 1;
      return super.requestUpdate(...args);
    }

    render() {
      return html`<slot></slot>`;
    }
  }

  assert.equal(window.customElements.get('academy-type-text'), undefined);
  assert.equal(window.customElements.get('academy-button-default'), undefined);
  assert.equal(AcademyDomHost.scopedElements['academy-type-text'], AcademyTypeText);
  assert.equal(AcademyDomHost.scopedElements['academy-button-default'], AcademyButtonDefault);
  window.customElements.define('academy-dom-host', AcademyDomHost);

  const response = deferred();
  const intl = installIntlMsg({ fetchImpl: async () => response.promise });
  const host = window.document.createElement('academy-dom-host');
  window.document.body.append(host);
  host.connectedCallback();
  host.connectedCallback();
  await host.updateComplete;
  assert.equal(window.customElements.get('academy-type-text'), undefined);
  assert.equal(window.customElements.get('academy-button-default'), undefined);

  const typeText = host.shadowRoot.createElement('academy-type-text');
  typeText.text = 'Localized text';
  host.shadowRoot.append(typeText);
  typeText.connectedCallback();
  await typeText.updateComplete;
  assert.ok(typeText instanceof AcademyTypeText);
  assert.equal(typeText.localName, 'academy-type-text');
  assert.equal(typeText.shadowRoot.querySelector('[part="text"]').textContent, 'Localized text');

  const buttonDefault = host.shadowRoot.createElement('academy-button-default');
  buttonDefault.text = 'Continue';
  buttonDefault.disabled = true;
  host.shadowRoot.append(buttonDefault);
  buttonDefault.connectedCallback();
  await buttonDefault.updateComplete;
  assert.ok(buttonDefault instanceof AcademyButtonDefault);
  assert.equal(buttonDefault.localName, 'academy-button-default');
  const nativeButton = buttonDefault.shadowRoot.querySelector('button');
  assert.equal(nativeButton.textContent, 'Continue');
  assert.equal(nativeButton.disabled, true);

  const child = host.shadowRoot.createElement('academy-dom-event-child');
  host.shadowRoot.append(child);
  child.connectedCallback();
  await child.updateComplete;
  assert.ok(child instanceof AcademyDomEventChild);
  host.languageUpdateRequests = 0;
  intl.localesHost = 'https://academy.test/locales.json';
  const load = intl.loadUrlResourcesComplete;
  response.resolve({
    ok: true,
    json: async () => ({
      en: { action: 'Continue' },
      es: { action: 'Continuar' }
    })
  });
  await load;
  await host.updateComplete;
  assert.equal(host.languageUpdateRequests, 1);
  const events = [];
  window.document.body.addEventListener('academy-dom-event-child-continue', event => {
    events.push(event);
    event.preventDefault();
  }, { once: true });
  assert.equal(child.emitEvent('continue', { source: 'shadow-child' }), false);
  assert.equal(events.length, 1);
  assert.equal(events[0].bubbles, true);
  assert.equal(events[0].composed, true);
  assert.equal(events[0].cancelable, true);
  host.disconnectedCallback();
  host.disconnectedCallback();
  host.languageUpdateRequests = 0;
  await intl.setLanguage('es');
  await host.updateComplete;
  assert.equal(host.languageUpdateRequests, 0);
});

test('red: generated scoped route hosts isolate equal child tags without global child registration', async t => {
  const { runtimeRoot } = await materializeRuntime(t);
  const { createScopedRouteHosts, defineScopedRouteHosts } = await import(pathToFileURL(path.join(runtimeRoot, ...scopedHostsFile)).href);
  class Registry {
    constructor() { this.definitions = new Map(); }
    define(tag, constructor) { this.definitions.set(tag, constructor); }
    get(tag) { return this.definitions.get(tag); }
  }
  class FirstChild {}
  class SecondChild {}
  class HostBase {
    constructor() {
      this.ownerDocument = { createElement: tag => ({ tag }) };
      this.attachments = 0;
    }
    attachShadow(options) {
      this.attachments += 1;
      this.shadowRoot = { options, children: [], createElement: tag => ({ tag }), append(node) { this.children.push(node); } };
      return this.shadowRoot;
    }
  }
  const first = createScopedRouteHosts({ childConstructor: FirstChild, routeTag: 'academy-first-route', hostBase: HostBase });
  const second = createScopedRouteHosts({ childConstructor: SecondChild, routeTag: 'academy-second-route', hostBase: HostBase });
  assert.equal(first.Host.publicScopedMixin, true);
  assert.equal(second.Host.publicScopedMixin, true);
  assert.equal(first.Host.scopedElements[first.childTag], FirstChild);
  assert.equal(second.Host.scopedElements[second.childTag], SecondChild);
  assert.notEqual(first.Host, second.Host);
  const firstHost = new first.Host();
  const secondHost = new second.Host();
  firstHost.connectedCallback();
  firstHost.connectedCallback();
  secondHost.connectedCallback();
  assert.equal(firstHost.attachments, 1);
  assert.equal(secondHost.attachments, 1);
  assert.deepEqual(firstHost.shadowRoot.options, { mode: 'open' });
  assert.equal(firstHost.shadowRoot.scopedElements[first.childTag], FirstChild);
  assert.equal(secondHost.shadowRoot.scopedElements[second.childTag], SecondChild);
  assert.deepEqual(firstHost.shadowRoot.children, [{ tag: first.childTag }]);
  assert.deepEqual(secondHost.shadowRoot.children, [{ tag: second.childTag }]);
  const globalRegistry = new Registry();
  defineScopedRouteHosts({ globalRegistry, hosts: [first, second] });
  assert.equal(globalRegistry.get('academy-first-route'), first.Host);
  assert.equal(globalRegistry.get('academy-second-route'), second.Host);
  assert.equal(globalRegistry.get(first.childTag), undefined);
});

test('red: scoped route hosts load the required registry polyfill first and create children in their shadow scope', async t => {
  const { runtimeRoot } = await materializeRuntime(t);
  const [source, packageContents] = await Promise.all([
    readFile(path.join(runtimeRoot, ...scopedHostsFile), 'utf8'),
    readFile(path.join(runtimeRoot, 'package.json'), 'utf8')
  ]);
  const metadata = JSON.parse(packageContents);

  assert.match(source, /^import '@webcomponents\/scoped-custom-element-registry';/);
  assert.match(source, /shadowRoot\.createElement\(scopedChildTag\)/);
  assert.doesNotMatch(source, /ownerDocument\.createElement\(scopedChildTag\)/);
  assert.equal(metadata.dependencies['@webcomponents/scoped-custom-element-registry'], '0.0.10');
});

test('break: generated main exposes only the supported Academy facade and localized loader', async t => {
  const { main, runtimeRoot } = await materializeMain(t);
  const packageContents = await readFile(path.join(runtimeRoot, 'package.json'), 'utf8');
  const metadata = JSON.parse(packageContents);

  assert.deepEqual(Object.keys(main).sort(), [
    'createDataManager',
    'loadMessages',
    'navigate',
    'publish',
    'startAcademyApp',
    'subscribe'
  ]);
  assert.equal(metadata.dependencies['@lit/localize'], undefined);
  assert.equal(metadata.dependencies['@open-wc/scoped-elements'], '3.0.10');
});

test('red: direct server-side runtime import fails with an actionable browser-only error', async t => {
  const { runtimeRoot } = await materializeRuntime(t, { browserTouchingScopedPackage: true });
  const entrypoint = pathToFileURL(path.join(runtimeRoot, ...runtimeFiles.main)).href;
  const evaluationsBeforeImport = globalThis.__academyScopedStubEvaluations ?? 0;

  await assert.rejects(import(entrypoint), error => {
    assert.equal(error?.code, 'ACADEMY_CORE_BROWSER_ONLY');
    assert.match(error?.message, /browser-only/i);
    return true;
  });
  assert.equal(globalThis.__academyScopedStubEvaluations ?? 0, evaluationsBeforeImport);
});

test('red: generated Task 5 app pins Vite and omits every service-worker dependency', async t => {
  const { runtimeRoot } = await materializeRuntime(t);
  const metadata = JSON.parse(await readFile(path.join(runtimeRoot, 'package.json'), 'utf8'));

  assert.equal(metadata.devDependencies.vite, '7.3.6');
  assert.equal(metadata.devDependencies['workbox-build'], undefined);
  assert.equal(metadata.dependencies['workbox-build'], undefined);
  assert.equal(metadata.optionalDependencies['workbox-build'], undefined);
});
