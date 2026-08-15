import assert from 'node:assert/strict';
import { lstat, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { NodeFilesystem } from '../../src/adapters/node/node-filesystem.js';
import { generateAppLocales } from '../../src/application/app/generate-locales.js';
import { generateComponentLocales } from '../../src/application/component/generate-locales.js';
import { ScaffoldPlan } from '../../src/domain/scaffold-plan.js';
import { WorkspaceSession, typedError } from '../../src/domain/workspace-session.js';

const fixtureDirectory = path.join(import.meta.dirname, '../fixtures/task-7-locales');

class AtomicPublisher {
  calls = 0;
  files;
  #failAfter;

  constructor({ files = {}, failAfter = undefined } = {}) {
    this.files = new Map(Object.entries(files));
    this.#failAfter = failAfter;
  }

  async publish(session, plan) {
    this.calls += 1;
    const staged = new Map(this.files);
    const snapshot = ScaffoldPlan.snapshot(plan);
    for (const [index, file] of snapshot.files.entries()) {
      if (index === this.#failAfter) {
        throw typedError('PUBLISH_FAILED');
      }
      staged.set(file.path, typeof file.content === 'string' ? file.content : Buffer.from(file.content).toString('utf8'));
    }
    this.files = staged;
    return Object.freeze({ session: session.root, fileCount: snapshot.files.length });
  }
}

class TransactionalPlanPublisher {
  #filesystem;
  #destination;

  constructor(filesystem, destination) {
    this.#filesystem = filesystem;
    this.#destination = destination;
  }

  async publish(session, plan) {
    let staged = ScaffoldPlan.empty().addDirectory('workspace');
    for (const file of ScaffoldPlan.snapshot(plan).files) {
      staged = staged.addFile(`workspace/${file.path}`, file.content, file.mode === undefined ? undefined : { mode: file.mode });
    }
    return this.#filesystem.applyPlanAtomically(session, staged, this.#destination, { replace: true });
  }
}

async function workspace(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'open-cells-academy-locales-'));
  t.after(async () => {
    await rm(root, { recursive: true, force: true });
  });
  await writeFile(path.join(root, 'package.json'), '{"name":"locale-fixture","private":true}\n');
  const filesystem = new NodeFilesystem();
  const session = await WorkspaceSession.open(root, filesystem);
  return { filesystem, root, session };
}

async function writeWorkspaceFile(root, relativePath, content) {
  const target = path.join(root, relativePath);
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, content);
}

async function writeFixture(root, relativePath, name) {
  await writeWorkspaceFile(root, relativePath, await readFile(path.join(fixtureDirectory, name), 'utf8'));
}

function filesIn(plan) {
  return Object.fromEntries(ScaffoldPlan.snapshot(plan).files.map(file => [file.path, typeof file.content === 'string' ? file.content : Buffer.from(file.content).toString('utf8')]));
}

function parsedFile(plan, relativePath) {
  const files = filesIn(plan);
  assert.equal(typeof files[relativePath], 'string', `missing ${relativePath}`);
  return JSON.parse(files[relativePath]);
}

function frozenNode(name, root, dependencies = []) {
  return Object.freeze({ name, root, dependencies: Object.freeze(dependencies) });
}

function appContext(session, filesystem, request, publisher = undefined) {
  return Object.freeze({ session, filesystem, request: Object.freeze(request), publisher });
}

function componentContext(session, filesystem, request, dependencyTree = undefined, publisher = undefined) {
  return Object.freeze({ session, filesystem, request: Object.freeze(request), dependencyTree, publisher });
}

async function assertCode(promise, code) {
  await assert.rejects(promise, error => {
    assert.equal(error?.code, code);
    return true;
  });
}

test('break: app locales with no configuration or disabled i18n return an empty immutable plan without publishing, even with an aggregate name', async t => {
  const { filesystem, root, session } = await workspace(t);
  await writeFixture(root, 'components/button/locales/en.json', 'component-en.json');
  const publisher = new AtomicPublisher();

  const none = await generateAppLocales(
    appContext(session, filesystem, { componentLocaleFiles: ['components/button/locales/en.json'] }, publisher)
  );
  const disabled = await generateAppLocales(
    appContext(
      session,
      filesystem,
      { config: { enabledI18n: false, intlFileName: 'configured-aggregate' }, componentLocaleFiles: ['components/button/locales/en.json'] },
      publisher
    )
  );

  assert.deepEqual(filesIn(none), {});
  assert.deepEqual(filesIn(disabled), {});
  assert.equal(Object.isFrozen(none), true);
  assert.equal(Object.isFrozen(disabled), true);
  assert.equal(publisher.calls, 0);
  await assert.rejects(lstat(path.join(root, 'dist')), error => error?.code === 'ENOENT');
});

test('break: locale use cases reject a mutable context before they read sources or publish a plan', async t => {
  const { filesystem, root, session } = await workspace(t);
  await writeFixture(root, 'components/button/locales/en.json', 'component-en.json');
  const publisher = new AtomicPublisher();
  const mutableContext = {
    session,
    filesystem,
    publisher,
    request: Object.freeze({ config: { enabledI18n: true }, componentLocaleFiles: ['components/button/locales/en.json'] })
  };

  await assertCode(generateAppLocales(mutableContext), 'LOCALES_CONTEXT_INVALID');
  assert.equal(publisher.calls, 0);
});

test('break: app locales write deterministic own component language catalogs without implicit filesystem publication', async t => {
  const { filesystem, root, session } = await workspace(t);
  await writeFixture(root, 'components/button/locales/en.json', 'component-en.json');
  const context = appContext(session, filesystem, {
    config: { enabledI18n: true, languages: ['en'] },
    componentLocaleFiles: ['components/button/locales/en.json']
  });

  const first = await generateAppLocales(context);
  const second = await generateAppLocales(context);

  assert.deepEqual(filesIn(first), {
    'dist/locales/en.json': '{\n  "button": "component",\n  "shared": "component"\n}\n'
  });
  assert.deepEqual(filesIn(second), filesIn(first));
  assert.equal(Object.isFrozen(first), true);
  await assert.rejects(lstat(path.join(root, 'dist')), error => error?.code === 'ENOENT');
});

test('break: a per-language locale configuration does not add an implicit combined catalog', async t => {
  const { filesystem, root, session } = await workspace(t);
  await writeFixture(root, 'components/button/locales/en.json', 'component-en.json');

  const plan = await generateAppLocales(
    appContext(session, filesystem, {
      config: { enabledI18n: true, languages: ['en'] },
      componentLocaleFiles: ['components/button/locales/en.json']
    })
  );

  assert.deepEqual(Object.keys(filesIn(plan)), ['dist/locales/en.json']);
});

test('break: app locale variants overlay bases and app roots override component conflicts in stable combined output', async t => {
  const { filesystem, root, session } = await workspace(t);
  await writeFixture(root, 'components/button/locales/en.json', 'component-en.json');
  await writeFixture(root, 'components/button/locales/en-US.json', 'component-en-US.json');
  await writeFixture(root, 'app/locales-app/en.json', 'app-en.json');

  const plan = await generateAppLocales(
    appContext(session, filesystem, {
      config: { enabledI18n: true, intlFileName: 'locales', languages: ['en-US', 'en'] },
      componentLocaleFiles: ['components/button/locales/en-US.json', 'components/button/locales/en.json'],
      appLocaleFiles: ['app/locales-app/en.json']
    })
  );

  assert.deepEqual(parsedFile(plan, 'dist/locales/en.json'), { button: 'app', root: 'application', shared: 'component' });
  assert.deepEqual(parsedFile(plan, 'dist/locales/en-US.json'), {
    button: 'regional',
    regional: 'component-us',
    root: 'application',
    shared: 'component'
  });
  assert.deepEqual(parsedFile(plan, 'dist/locales/locales.json'), {
    en: { button: 'app', root: 'application', shared: 'component' },
    'en-US': { button: 'regional', regional: 'component-us', root: 'application', shared: 'component' }
  });
});

test('break: underscore regional locale names overlay their base language deterministically', async t => {
  const { filesystem, root, session } = await workspace(t);
  await writeWorkspaceFile(root, 'components/button/locales/en.json', JSON.stringify({ button: 'base', shared: 'base' }));
  await writeWorkspaceFile(root, 'components/button/locales/en_US.json', JSON.stringify({ button: 'regional', regional: 'us' }));

  const plan = await generateAppLocales(
    appContext(session, filesystem, {
      config: { enabledI18n: true, languages: ['en_US'] },
      componentLocaleFiles: ['components/button/locales/en.json', 'components/button/locales/en_US.json']
    })
  );

  assert.deepEqual(parsedFile(plan, 'dist/locales/en_US.json'), { button: 'regional', regional: 'us', shared: 'base' });
});

test('break: version two app catalogs use a deterministic reduced payload', async t => {
  const { filesystem, root, session } = await workspace(t);
  await writeWorkspaceFile(root, 'components/catalog/locales/en.json', JSON.stringify({ hello: 'Hello', 'common.welcome': 'Welcome', shared: 'Shared' }));
  await writeWorkspaceFile(root, 'components/catalog/locales/es.json', JSON.stringify({ hello: 'Hola', 'common.welcome': 'Bienvenido', shared: 'Compartido' }));

  const plan = await generateAppLocales(
    appContext(session, filesystem, {
      config: { intlFileName: 'catalog', intlFileVersion: 2, languages: ['es', 'en'] },
      componentLocaleFiles: ['components/catalog/locales/es.json', 'components/catalog/locales/en.json']
    })
  );

  assert.deepEqual(parsedFile(plan, 'dist/locales/catalog.json'), {
    'common.': { welcome: [0, 3] },
    hello: [1, 4],
    langs: ['en', 'es'],
    shared: [2, 5],
    texts: ['Welcome', 'Hello', 'Shared', 'Bienvenido', 'Hola', 'Compartido'],
    version: 2
  });
});

test('break: bundle mode follows declared page imports, puts shared inputs in initial, and leaves page-unique paths exact', async t => {
  const { filesystem, root, session } = await workspace(t);
  await writeWorkspaceFile(root, 'components/shared/locales/locales.json', JSON.stringify({ en: { common: 'component', shared: 'component' } }));
  await writeWorkspaceFile(root, 'components/about-only/locales/locales.json', JSON.stringify({ en: { common: 'about-component', unique: 'about-only' } }));
  await writeWorkspaceFile(root, 'app/locales-app/locales.json', JSON.stringify({ en: { common: 'app', application: 'root' } }));
  await writeWorkspaceFile(root, 'app/pages/home-page/locales/locales.json', JSON.stringify({ en: { common: 'home', home: 'page' } }));
  await writeWorkspaceFile(root, 'app/pages/about-page/locales/locales.json', JSON.stringify({ en: { common: 'about-page', about: 'page' } }));

  const plan = await generateAppLocales(
    appContext(session, filesystem, {
      config: { useBundles: true, intlFileName: 'locales', languages: ['en'], initialBundle: ['home'], pagesPath: 'pages' },
      appLocaleFiles: ['app/locales-app/locales.json'],
      pageEntries: { home: 'home-page', about: 'about-page' },
      pageModules: {
        'about-page': { imports: ['shared', 'about-only'], localeFiles: ['app/pages/about-page/locales/locales.json'] },
        'about-only': { imports: [], localeFiles: ['components/about-only/locales/locales.json'] },
        'home-page': { imports: ['shared'], localeFiles: ['app/pages/home-page/locales/locales.json'] },
        shared: { imports: [], localeFiles: ['components/shared/locales/locales.json'] }
      }
    })
  );

  assert.deepEqual(Object.keys(filesIn(plan)), ['dist/locales/locales.json', 'dist/pages/about-page/locales/locales.json']);
  assert.deepEqual(parsedFile(plan, 'dist/locales/locales.json'), {
    en: { application: 'root', common: 'home', home: 'page', shared: 'component' }
  });
  assert.deepEqual(parsedFile(plan, 'dist/pages/about-page/locales/locales.json'), {
    en: { about: 'page', common: 'about-page', unique: 'about-only' }
  });
});

test('break: malformed JSON, invalid config, invalid paths, and filesystem failures publish nothing', async t => {
  const { filesystem, root, session } = await workspace(t);
  await writeFixture(root, 'components/bad/locales/en.json', 'malformed.json');
  await writeFixture(root, 'components/button/locales/en.json', 'component-en.json');
  const publisher = new AtomicPublisher({ files: { sentinel: 'unchanged' } });

  await assertCode(
    generateAppLocales(
      appContext(session, filesystem, { config: { enabledI18n: true }, componentLocaleFiles: ['components/bad/locales/en.json'] }, publisher)
    ),
    'LOCALES_JSON_INVALID'
  );
  await assertCode(
    generateAppLocales(appContext(session, filesystem, { config: { useBundles: true, intlFileName: 'locales' } }, publisher)),
    'LOCALES_CONFIG_INVALID'
  );
  await assertCode(
    generateAppLocales(
      appContext(session, filesystem, { config: { enabledI18n: true }, componentLocaleFiles: ['../outside.json'] }, publisher)
    ),
    'PATH_INVALID'
  );
  const failedFilesystem = Object.create(filesystem);
  failedFilesystem.readFile = async () => {
    throw new Error('injected read failure');
  };
  await assertCode(
    generateAppLocales(
      appContext(session, failedFilesystem, { config: { enabledI18n: true }, componentLocaleFiles: ['components/button/locales/en.json'] }, publisher)
    ),
    'LOCALES_SOURCE_INVALID'
  );

  assert.equal(publisher.calls, 0);
  assert.deepEqual(Object.fromEntries(publisher.files), { sentinel: 'unchanged' });
});

test('break: app source symlinks are refused before an injected publisher can observe a plan', async t => {
  const { filesystem, root, session } = await workspace(t);
  const outside = await mkdtemp(path.join(os.tmpdir(), 'open-cells-academy-locales-outside-'));
  t.after(() => rm(outside, { recursive: true, force: true }));
  await writeFile(path.join(outside, 'en.json'), '{"outside":"no"}\n');
  await mkdir(path.join(root, 'components/linked/locales'), { recursive: true });
  await symlink(path.join(outside, 'en.json'), path.join(root, 'components/linked/locales/en.json'));
  const publisher = new AtomicPublisher();

  await assertCode(
    generateAppLocales(
      appContext(session, filesystem, { config: { enabledI18n: true }, componentLocaleFiles: ['components/linked/locales/en.json'] }, publisher)
    ),
    'LOCALES_SOURCE_INVALID'
  );
  assert.equal(publisher.calls, 0);
});

test('break: component locales recursively merge frozen dependency records, preserve own overrides, and create exact demo and unit plans', async t => {
  const { filesystem, root, session } = await workspace(t);
  await writeWorkspaceFile(root, 'packages/leaf/locales/locales.json', JSON.stringify({ en: { leaf: 'yes', shared: 'leaf' } }));
  await writeWorkspaceFile(root, 'packages/parent/locales/locales.json', JSON.stringify({ en: { parent: 'yes', shared: 'parent' } }));
  await writeWorkspaceFile(root, 'locales/locales.json', JSON.stringify({ en: { own: 'yes', shared: 'own' } }));
  const tree = Object.freeze([frozenNode('parent', 'packages/parent', [frozenNode('leaf', 'packages/leaf')])]);

  const plan = await generateComponentLocales(componentContext(session, filesystem, { ownLocaleFile: 'locales/locales.json' }, tree));

  const expected = { en: { leaf: 'yes', own: 'yes', parent: 'yes', shared: 'own' } };
  assert.deepEqual(parsedFile(plan, 'demo/locales/locales.json'), expected);
  assert.deepEqual(parsedFile(plan, 'test/unit/locales/locales.json'), expected);
  assert.deepEqual(Object.keys(filesIn(plan)), ['demo/locales/locales.json', 'test/unit/locales/locales.json']);
  assert.equal(Object.values(filesIn(plan)).some(value => value.includes('__deps__.json')), false);
  await assert.rejects(lstat(path.join(root, '__deps__.json')), error => error?.code === 'ENOENT');
});

test('break: component locale dependency cycles are finite and empty merges neither plan nor publish output', async t => {
  const { filesystem, root, session } = await workspace(t);
  await writeWorkspaceFile(root, 'packages/a/locales/locales.json', JSON.stringify({ en: { a: 'a' } }));
  await writeWorkspaceFile(root, 'packages/b/locales/locales.json', JSON.stringify({ en: { b: 'b' } }));
  const a = { name: 'a', root: 'packages/a', dependencies: [] };
  const b = { name: 'b', root: 'packages/b', dependencies: [a] };
  a.dependencies.push(b);
  Object.freeze(a.dependencies);
  Object.freeze(b.dependencies);
  Object.freeze(a);
  Object.freeze(b);
  const cyclePlan = await generateComponentLocales(componentContext(session, filesystem, {}, Object.freeze([a])));
  const publisher = new AtomicPublisher();
  const emptyPlan = await generateComponentLocales(componentContext(session, filesystem, {}, Object.freeze([]), publisher));

  assert.deepEqual(parsedFile(cyclePlan, 'demo/locales/locales.json'), { en: { a: 'a', b: 'b' } });
  assert.deepEqual(filesIn(emptyPlan), {});
  assert.equal(publisher.calls, 0);
});

test('break: malformed dependency trees and component JSON leave a transactional publisher unchanged', async t => {
  const { filesystem, root, session } = await workspace(t);
  await writeFixture(root, 'packages/bad/locales/locales.json', 'malformed.json');
  const publisher = new AtomicPublisher({ files: { sentinel: 'unchanged' } });
  const mutableTree = [{ name: 'bad', root: 'packages/bad', dependencies: [] }];

  await assertCode(generateComponentLocales(componentContext(session, filesystem, {}, mutableTree, publisher)), 'LOCALES_TREE_INVALID');
  const malformedTree = Object.freeze([frozenNode('bad', 'packages/bad')]);
  await assertCode(generateComponentLocales(componentContext(session, filesystem, {}, malformedTree, publisher)), 'LOCALES_JSON_INVALID');

  assert.equal(publisher.calls, 0);
  assert.deepEqual(Object.fromEntries(publisher.files), { sentinel: 'unchanged' });
});

test('break: a publisher failure rolls back its staged locale update and application returns the same deterministic plan after retry', async t => {
  const { filesystem, root, session } = await workspace(t);
  await writeFixture(root, 'components/button/locales/en.json', 'component-en.json');
  const request = {
    config: { enabledI18n: true, intlFileName: 'locales', languages: ['en'] },
    componentLocaleFiles: ['components/button/locales/en.json']
  };
  const failing = new AtomicPublisher({ files: { sentinel: 'unchanged' }, failAfter: 1 });

  await assertCode(generateAppLocales(appContext(session, filesystem, request, failing)), 'PUBLISH_FAILED');
  const retry = await generateAppLocales(appContext(session, filesystem, request));
  const repeated = await generateAppLocales(appContext(session, filesystem, request));

  assert.deepEqual(Object.fromEntries(failing.files), { sentinel: 'unchanged' });
  assert.deepEqual(filesIn(retry), filesIn(repeated));
});

test('break: a real NodeFilesystem-backed injected publisher atomically replaces a complete locale tree and refuses a symlink escape', async t => {
  const { filesystem, root, session } = await workspace(t);
  await writeFixture(root, 'components/button/locales/en.json', 'component-en.json');
  await mkdir(path.join(root, 'published'), { recursive: true });
  await writeWorkspaceFile(root, 'published/workspace/stale.txt', 'stale');
  const publisher = new TransactionalPlanPublisher(filesystem, 'published');

  const plan = await generateAppLocales(
    appContext(
      session,
      filesystem,
      { config: { enabledI18n: true, intlFileName: 'locales', languages: ['en'] }, componentLocaleFiles: ['components/button/locales/en.json'] },
      publisher
    )
  );

  assert.deepEqual(parsedFile(plan, 'dist/locales/locales.json'), { en: { button: 'component', shared: 'component' } });
  assert.equal(await readFile(path.join(root, 'published/workspace/dist/locales/en.json'), 'utf8'), '{\n  "button": "component",\n  "shared": "component"\n}\n');
  await assert.rejects(lstat(path.join(root, 'published/workspace/stale.txt')), error => error?.code === 'ENOENT');

  const outside = await mkdtemp(path.join(os.tmpdir(), 'open-cells-academy-locales-output-'));
  t.after(() => rm(outside, { recursive: true, force: true }));
  await symlink(outside, path.join(root, 'linked-output'), 'dir');
  const unsafePublisher = new TransactionalPlanPublisher(filesystem, 'linked-output');
  await assertCode(
    generateAppLocales(
      appContext(
        session,
        filesystem,
        { config: { enabledI18n: true, languages: ['en'] }, componentLocaleFiles: ['components/button/locales/en.json'] },
        unsafePublisher
      )
    ),
    'PATH_OUTSIDE_WORKSPACE'
  );
});
