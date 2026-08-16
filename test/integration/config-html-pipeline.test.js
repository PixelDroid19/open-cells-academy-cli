import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, symlink, utimes, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { loadCellsConfig } from '../../src/adapters/vite/config-loader.js';
import { generateAppHtml } from '../../src/adapters/vite/html-generator.js';
import { NodeFilesystem } from '../../src/adapters/node/node-filesystem.js';
import { WorkspaceSession } from '../../src/domain/workspace-session.js';

const template = '<!doctype html><html lang="##app.lang##"><head><title>##app.title##</title><meta name="description" content="##app.description##"></head><body><header>##app.header##</header><main data-name="##app.name##">##app.version## ##env.mode##</main></body></html>';

function values(overrides = {}) {
  return {
    app: {
      lang: 'en',
      title: 'Academy',
      description: 'Learn safely',
      header: 'Cells Academy',
      name: 'academy-app',
      version: '1.0.0',
      ...overrides.app
    },
    env: {
      mode: 'development',
      ...overrides.env
    }
  };
}

async function fixture(t, { moduleType = true } = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'open-cells-academy-config-html-'));
  t.after(async () => {
    await rm(root, { recursive: true, force: true });
  });
  await mkdir(path.join(root, 'app', 'config'), { recursive: true });
  await writeFile(path.join(root, 'package.json'), JSON.stringify({
    name: 'config-html-fixture',
    ...(moduleType ? { type: 'module' } : {})
  }));
  const filesystem = new NodeFilesystem();
  const session = await WorkspaceSession.open(root, filesystem);
  return { root, session };
}

async function writeConfig(root, name, source) {
  await writeFile(path.join(root, 'app', 'config', name), source);
}

async function assertConfigCode(promise, sourcePath) {
  await assert.rejects(promise, error => {
    assert.equal(error?.code, 'CONFIG_INVALID');
    assert.equal(error?.details?.path, sourcePath);
    assert.equal(error?.details?.trustedProjectConfig, true);
    return true;
  });
}

function assertHtmlCode(operation, code, field = undefined) {
  assert.throws(operation, error => {
    assert.equal(error?.code, code);
    if (field !== undefined) {
      assert.equal(error?.details?.field, field);
    }
    return true;
  });
}

test('break: config selects nested legacy server, locales, and app_properties.app before root values', async t => {
  const { root, session } = await fixture(t);
  await writeConfig(
    root,
    'legacy.js',
    "export default { cells_properties: { server: { port: 9090, nested: { enabled: true } }, locales: { source: 'legacy' }, appModules: ['@cells-demo'] }, app_properties: { app: { name: 'legacy-app', title: 'Legacy' } }, server: { port: 1111 }, app: { name: 'root-app' }, locales: { source: 'root' } };"
  );

  const config = await loadCellsConfig(session, 'legacy.js');

  assert.equal(config.sourcePath, 'app/config/legacy.js');
  assert.deepEqual(config.server, { port: 9090, nested: { enabled: true } });
  assert.deepEqual(config.app, { name: 'legacy-app', title: 'Legacy' });
  assert.deepEqual(config.locales, { source: 'legacy' });
  assert.deepEqual(config.appModules, ['@cells-demo']);
});

test('integration: config loads a nested CommonJS market file and preserves its frozen legacy payload', async t => {
  const { root, session } = await fixture(t, { moduleType: false });
  await mkdir(path.join(root, 'app', 'config', 'co'), { recursive: true });
  await writeFile(
    path.join(root, 'app', 'config', 'co', 'web-dev.js'),
    "module.exports = { cells_properties: { server: { port: 8121 }, locales: { languages: ['es-CO'] } }, app_properties: { app: { name: 'legacy-market' } }, market: { code: 'co' } };"
  );

  const config = await loadCellsConfig(session, 'co/web-dev.js');

  assert.equal(config.sourcePath, 'app/config/co/web-dev.js');
  assert.deepEqual(config.server, { port: 8121 });
  assert.deepEqual(config.app, { name: 'legacy-market' });
  assert.deepEqual(config.locales, { languages: ['es-CO'] });
  assert.deepEqual(config.legacy.market, { code: 'co' });
  assert.equal(Object.isFrozen(config.legacy), true);
  assert.equal(Object.isFrozen(config.legacy.market), true);
});

test('integration: CommonJS config reload invalidates contained dependencies and exposes their watch paths', async t => {
  const { root, session } = await fixture(t, { moduleType: false });
  await mkdir(path.join(root, 'app', 'config', 'co', 'base'), { recursive: true });
  await writeFile(path.join(root, 'app', 'config', 'co', 'base', 'environment.js'), 'module.exports = { environment: "de" };\n');
  await writeFile(path.join(root, 'app', 'config', 'co', 'web-dev.js'), 'module.exports = { ...require("./base/environment.js"), lang: "es-CO" };\n');

  const first = await loadCellsConfig(session, 'co/web-dev.js');
  await writeFile(path.join(root, 'app', 'config', 'co', 'base', 'environment.js'), 'module.exports = { environment: "qa" };\n');
  const second = await loadCellsConfig(session, 'co/web-dev.js');

  assert.equal(first.legacy.environment, 'de');
  assert.equal(second.legacy.environment, 'qa');
  assert.deepEqual(second.sourceDependencies, [
    'app/config/co/base/environment.js',
    'app/config/co/web-dev.js'
  ]);
  assert.equal(Object.isFrozen(second.sourceDependencies), true);
});

test('integration: ESM config reload evaluates a fresh contained dependency graph', async t => {
  const { root, session } = await fixture(t);
  await mkdir(path.join(root, 'app', 'config', 'market'), { recursive: true });
  await writeFile(path.join(root, 'app', 'config', 'market', 'dev.js'), 'export default { environment: "de" };\n');
  await writeFile(path.join(root, 'app', 'config', 'market', 'lazy.js'), 'export default { lazy: true };\n');
  await writeFile(
    path.join(root, 'app', 'config', 'market', 'vbank.js'),
    '// import "./removed-comment.js";\nconst example = "import \'./removed-string.js\'";\nif (false) import(`./lazy.js`);\nimport dev from "./dev.js"; export default { ...dev, profile: "vbank", example };\n'
  );

  const first = await loadCellsConfig(session, 'market/vbank.js');
  await writeFile(path.join(root, 'app', 'config', 'market', 'dev.js'), 'export default { environment: "qa" };\n');
  const second = await loadCellsConfig(session, 'market/vbank.js');

  assert.equal(first.legacy.environment, 'de');
  assert.equal(second.legacy.environment, 'qa');
  assert.deepEqual(second.sourceDependencies, [
    'app/config/market/dev.js',
    'app/config/market/lazy.js',
    'app/config/market/vbank.js'
  ]);
});

test('break: nested config directory symlinks and traversal remain outside the trusted boundary', async t => {
  const { root, session } = await fixture(t);
  await mkdir(path.join(root, 'app', 'config', 'real-market'));
  await writeFile(path.join(root, 'app', 'config', 'real-market', 'web-dev.js'), 'export default { server: { port: 8121 } };');
  await symlink('real-market', path.join(root, 'app', 'config', 'co'), 'dir');

  await assertConfigCode(loadCellsConfig(session, 'co/web-dev.js'), 'app/config/co/web-dev.js');
  await assertConfigCode(loadCellsConfig(session, 'co/../real-market/web-dev.js'), 'app/config');
});

test('break: config treats legacy app_properties itself as app data when it has no app wrapper', async t => {
  const { root, session } = await fixture(t);
  await writeConfig(
    root,
    'legacy-app-data.js',
    "export default { app_properties: { name: 'legacy-direct-app', title: 'Legacy direct' }, app: { name: 'root-app' } };"
  );

  const config = await loadCellsConfig(session, 'legacy-app-data.js');

  assert.deepEqual(config.app, { name: 'legacy-direct-app', title: 'Legacy direct' });
});

test('integration: config treats a legacy string app identifier as part of root application data', async t => {
  const { root, session } = await fixture(t);
  await writeConfig(
    root,
    'legacy-root-app.js',
    "export default { app: 'co', lang: 'es-CO', appVersion: '99.99.99', mainNode: 'app__content' };"
  );

  const config = await loadCellsConfig(session, 'legacy-root-app.js');

  assert.deepEqual(config.app, {
    app: 'co',
    lang: 'es-CO',
    appVersion: '99.99.99',
    mainNode: 'app__content'
  });
});

test('break: config falls back to documented root server, app, and locales fields', async t => {
  const { root, session } = await fixture(t);
  await writeConfig(
    root,
    'root.mjs',
    "export default { server: { host: '127.0.0.1' }, app: { name: 'root-app' }, locales: { input: ['locales'] } };"
  );

  const config = await loadCellsConfig(session, 'root.mjs');

  assert.deepEqual(config.server, { host: '127.0.0.1' });
  assert.deepEqual(config.app, { name: 'root-app' });
  assert.deepEqual(config.locales, { input: ['locales'] });
});

test('break: Academy config fields take precedence over legacy and root fields', async t => {
  const { root, session } = await fixture(t);
  await writeConfig(
    root,
    'academy.js',
    "export default { academy: { server: { port: 3333 }, app: { name: 'academy-app' }, locales: { source: 'academy' } }, cells_properties: { server: { port: 2222 }, locales: { source: 'legacy' } }, app_properties: { app: { name: 'legacy-app' } }, server: { port: 1111 }, app: { name: 'root-app' }, locales: { source: 'root' } };"
  );

  const config = await loadCellsConfig(session, 'academy.js');

  assert.deepEqual(config.server, { port: 3333 });
  assert.deepEqual(config.app, { name: 'academy-app' });
  assert.deepEqual(config.locales, { source: 'academy' });
});

test('break: config preserves the highest-priority build object as an independent deep-frozen value', async t => {
  const { root, session } = await fixture(t);
  await writeConfig(
    root,
    'build-precedence.js',
    "const shared = { enabled: true }; export default { academy: { server: { shared }, build: { target: 'academy', nested: shared } }, cells_properties: { build: { target: 'legacy' } }, build: { target: 'root' } };"
  );

  const config = await loadCellsConfig(session, 'build-precedence.js');

  assert.deepEqual(config.build, { target: 'academy', nested: { enabled: true } });
  assert.notStrictEqual(config.build.nested, config.server.shared);
  assert.equal(Object.isFrozen(config.build), true);
  assert.equal(Object.isFrozen(config.build.nested), true);
  assert.throws(() => {
    config.build.nested.enabled = false;
  }, TypeError);
  assert.equal(config.server.shared.enabled, true);
});

test('break: a non-plain selected build value stops crossing the config boundary', async t => {
  const { root, session } = await fixture(t);
  await writeConfig(root, 'invalid-build.js', 'export default { build: [] };');

  await assertConfigCode(loadCellsConfig(session, 'invalid-build.js'), 'app/config/invalid-build.js');
});

test('break: config falls back from legacy build to documented root build', async t => {
  const { root, session } = await fixture(t);
  await writeConfig(root, 'legacy-build.js', "export default { cells_properties: { build: { target: 'legacy' } }, build: { target: 'root' } };");
  await writeConfig(root, 'root-build.js', "export default { build: { target: 'root' } };");

  assert.deepEqual((await loadCellsConfig(session, 'legacy-build.js')).build, { target: 'legacy' });
  assert.deepEqual((await loadCellsConfig(session, 'root-build.js')).build, { target: 'root' });
});

test('break: config server and preview stop sharing mutable nested data', async t => {
  const { root, session } = await fixture(t);
  await writeConfig(root, 'frozen.js', "export default { server: { host: '127.0.0.1', proxy: { '/api': { target: 'http://localhost' } } } };");

  const config = await loadCellsConfig(session, 'frozen.js');

  assert.deepEqual(config.server, config.preview);
  assert.notStrictEqual(config.server, config.preview);
  assert.notStrictEqual(config.server.proxy, config.preview.proxy);
  assert.equal(Object.isFrozen(config), true);
  assert.equal(Object.isFrozen(config.server), true);
  assert.equal(Object.isFrozen(config.server.proxy), true);
  assert.equal(Object.isFrozen(config.preview), true);
  assert.equal(Object.isFrozen(config.preview.proxy), true);
  assert.throws(() => {
    config.server.proxy['/api'].target = 'http://changed';
  }, TypeError);
  assert.equal(config.preview.proxy['/api'].target, 'http://localhost');
});

test('break: config reload stops returning a stale evaluated module after the same file changes', async t => {
  const { root, session } = await fixture(t);
  await writeConfig(root, 'reload.js', "export default { server: { port: 4100 } };");

  const first = await loadCellsConfig(session, 'reload.js');
  await writeConfig(root, 'reload.js', "export default { server: { port: 4200 } };");
  const second = await loadCellsConfig(session, 'reload.js');

  assert.equal(first.server.port, 4100);
  assert.equal(second.server.port, 4200);
});

test('break: config reload stops reusing a timestamp-identical import cache key', async t => {
  const { root, session } = await fixture(t);
  const configPath = path.join(root, 'app', 'config', 'same-metadata.js');
  const fixedTime = new Date('2024-01-01T00:00:00.000Z');
  await writeConfig(root, 'same-metadata.js', "export default { server: { port: 5100 } };");
  await utimes(configPath, fixedTime, fixedTime);

  const first = await loadCellsConfig(session, 'same-metadata.js');
  await writeConfig(root, 'same-metadata.js', "export default { server: { port: 5200 } };");
  await utimes(configPath, fixedTime, fixedTime);
  const second = await loadCellsConfig(session, 'same-metadata.js');

  assert.equal(first.server.port, 5100);
  assert.equal(second.server.port, 5200);
});

test('break: loading a config stops mutating process working directory', async t => {
  const { root, session } = await fixture(t);
  const before = process.cwd();
  await writeConfig(root, 'cwd.js', "export default { server: { cwd: process.cwd() } };");

  const config = await loadCellsConfig(session, 'cwd.js');

  assert.equal(process.cwd(), before);
  assert.equal(config.server.cwd, before);
});

test('break: missing, non-file, symlink, invalid export, and throwing configs stop exposing trusted source details', async t => {
  const { root, session } = await fixture(t);
  await mkdir(path.join(root, 'app', 'config', 'not-file.js'));
  await writeFile(path.join(root, 'app', 'config', 'linked-target.js'), "export default { server: { port: 1234 } };");
  await symlink('linked-target.js', path.join(root, 'app', 'config', 'linked.js'));
  await writeConfig(root, 'invalid.js', 'export default 42;');
  await writeConfig(root, 'throws.js', "const sourceSecret = 'fixture-config-secret'; throw new Error(sourceSecret);");

  await assertConfigCode(loadCellsConfig(session, 'missing.js'), 'app/config/missing.js');
  await assertConfigCode(loadCellsConfig(session, 'not-file.js'), 'app/config/not-file.js');
  await assertConfigCode(loadCellsConfig(session, 'linked.js'), 'app/config/linked.js');
  await assertConfigCode(loadCellsConfig(session, 'invalid.js'), 'app/config/invalid.js');
  await assert.rejects(loadCellsConfig(session, 'throws.js'), error => {
    assert.equal(error?.code, 'CONFIG_INVALID');
    assert.equal(error?.details?.path, 'app/config/throws.js');
    assert.equal(error?.details?.trustedProjectConfig, true);
    assert.doesNotMatch(`${error.message} ${JSON.stringify(error.details)}`, /fixture-config-secret/);
    assert.equal(error.cause, undefined);
    return true;
  });
});

test('break: a throwing trusted config accessor stops leaking raw evaluation data during normalization', async t => {
  const { root, session } = await fixture(t);
  await writeConfig(root, 'getter-throws.js', "export default { get academy() { throw new Error('fixture-getter-secret'); } };");

  await assert.rejects(loadCellsConfig(session, 'getter-throws.js'), error => {
    assert.equal(error?.code, 'CONFIG_INVALID');
    assert.equal(error?.details?.path, 'app/config/getter-throws.js');
    assert.equal(error?.details?.trustedProjectConfig, true);
    assert.doesNotMatch(`${error.message} ${JSON.stringify(error.details)} ${error.cause ?? ''}`, /fixture-getter-secret/);
    assert.equal(error.cause, undefined);
    return true;
  });
});

test('break: a proxy export that throws during type inspection stops leaking raw configuration data', async t => {
  const { root, session } = await fixture(t);
  await writeConfig(root, 'proxy-throws.js', "export default new Proxy({}, { getPrototypeOf() { throw new Error('fixture-proxy-secret'); } });");

  await assert.rejects(loadCellsConfig(session, 'proxy-throws.js'), error => {
    assert.equal(error?.code, 'CONFIG_INVALID');
    assert.equal(error?.details?.path, 'app/config/proxy-throws.js');
    assert.equal(error?.details?.trustedProjectConfig, true);
    assert.doesNotMatch(`${error.message} ${JSON.stringify(error.details)} ${error.cause ?? ''}`, /fixture-proxy-secret/);
    assert.equal(error.cause, undefined);
    return true;
  });
});

test('break: a config-directory symlink stops loading a regular file through a linked parent', async t => {
  const { root, session } = await fixture(t);
  const configDirectory = path.join(root, 'app', 'config');
  const linkedDirectory = path.join(root, 'app', 'linked-config');
  await mkdir(linkedDirectory);
  await writeFile(path.join(linkedDirectory, 'parent-linked.js'), "export default { server: { port: 1234 } };");
  await rm(configDirectory, { recursive: true, force: true });
  await symlink('linked-config', configDirectory, 'dir');

  await assertConfigCode(loadCellsConfig(session, 'parent-linked.js'), 'app/config/parent-linked.js');
});

test('break: an application-directory symlink stops loading config through a linked ancestor', async t => {
  const { root, session } = await fixture(t);
  const appDirectory = path.join(root, 'app');
  const linkedDirectory = path.join(root, 'linked-app');
  await mkdir(path.join(linkedDirectory, 'config'), { recursive: true });
  await writeFile(path.join(linkedDirectory, 'config', 'app-linked.js'), "export default { server: { port: 1234 } };");
  await rm(appDirectory, { recursive: true, force: true });
  await symlink('linked-app', appDirectory, 'dir');

  await assertConfigCode(loadCellsConfig(session, 'app-linked.js'), 'app/config/app-linked.js');
});

test('break: an invalid workspace session stops being reported as a trusted config failure', async () => {
  await assert.rejects(loadCellsConfig({}, 'valid.js'), error => error?.code === 'WORKSPACE_INVALID');
});

test('break: unsafe names and non-plain selected config values stop bypassing the config boundary', async t => {
  const { root, session } = await fixture(t);
  await writeConfig(root, 'array.js', 'export default { server: [] };');

  for (const configName of ['../outside.js', '/tmp/outside.js', 'nested/../config.js', 'config.txt', 'broken\u0000.js']) {
    await assertConfigCode(loadCellsConfig(session, configName), 'app/config');
  }
  await assertConfigCode(loadCellsConfig(session, 'array.js'), 'app/config/array.js');
});

test('break: non-plain nested config values stop crossing into frozen adapter data', async t => {
  const { root, session } = await fixture(t);
  await writeConfig(root, 'nested-date.js', "export default { server: { changedAt: new Date(0) } };");

  await assertConfigCode(loadCellsConfig(session, 'nested-date.js'), 'app/config/nested-date.js');
});

test('break: selected config own __proto__ data stops changing the normalized object prototype', async t => {
  const { root, session } = await fixture(t);
  await writeConfig(
    root,
    'proto.js',
    "const server = Object.create(null); Object.defineProperty(server, '__proto__', { value: { polluted: true }, enumerable: true }); server.port = 3030; export default { server };"
  );

  const config = await loadCellsConfig(session, 'proto.js');

  assert.equal(Object.getPrototypeOf(config.server), Object.prototype);
  assert.equal(Object.hasOwn(config.server, '__proto__'), true);
  assert.deepEqual(config.server.__proto__, { polluted: true });
  assert.equal(Object.prototype.polluted, undefined);
});

test('break: HTML replaces every required token once and escapes text and attribute values', () => {
  const escaped = '&amp;&lt;&gt;&quot;&#39;';
  const result = generateAppHtml({
    template,
    values: values({
      app: {
        lang: '&<>"\'',
        title: '&<>"\'',
        description: '&<>"\'',
        header: '&<>"\'',
        name: '&<>"\'',
        version: '&<>"\''
      },
      env: { mode: '&<>"\'' }
    })
  });

  assert.equal(
    result,
    `<!doctype html><html lang="${escaped}"><head><title>${escaped}</title><meta name="description" content="${escaped}"></head><body><header>${escaped}</header><main data-name="${escaped}">${escaped} ${escaped}</main></body></html>`
  );
  assert.doesNotMatch(result, /##[\s\S]*?##/);
});

test('break: HTML rejects missing values and non-string values before producing a document', () => {
  const missing = values();
  delete missing.app.version;

  assertHtmlCode(() => generateAppHtml({ template, values: missing }), 'HTML_VALUE_MISSING', 'app.version');
  assertHtmlCode(() => generateAppHtml({ template, values: values({ env: { mode: 1 } }) }), 'HTML_VALUE_MISSING', 'env.mode');
});

test('break: HTML rejects templates with a missing, duplicate, or unknown literal token', () => {
  const missing = template.replace('##app.version## ', '');
  const duplicate = template.replace('##app.version##', '##app.version## ##app.version##');
  const unknown = template.replace('##env.mode##', '##env.unknown##');

  assertHtmlCode(() => generateAppHtml({ template: missing, values: values() }), 'HTML_TEMPLATE_INVALID');
  assertHtmlCode(() => generateAppHtml({ template: duplicate, values: values() }), 'HTML_TEMPLATE_INVALID');
  assertHtmlCode(() => generateAppHtml({ template: unknown, values: values() }), 'HTML_TEMPLATE_INVALID');
});

test('break: HTML rejects invalid request, template, and values container shapes', () => {
  assertHtmlCode(() => generateAppHtml(), 'HTML_TEMPLATE_INVALID', 'request');
  assertHtmlCode(() => generateAppHtml({ template: null, values: values() }), 'HTML_TEMPLATE_INVALID', 'template');
  assertHtmlCode(() => generateAppHtml({ template, values: [] }), 'HTML_VALUE_MISSING', 'values');
});

test('break: hostile HTML request and values access stop leaking raw input errors', () => {
  const request = new Proxy({}, { getPrototypeOf() { throw new Error('fixture-html-request-secret'); } });
  const valuesRequest = {
    template,
    get values() {
      throw new Error('fixture-html-request-values-secret');
    }
  };
  const input = values();
  Object.defineProperty(input, 'app', {
    get() {
      throw new Error('fixture-html-values-secret');
    }
  });

  assert.throws(() => generateAppHtml(request), error => {
    assert.equal(error?.code, 'HTML_TEMPLATE_INVALID');
    assert.equal(error?.details?.field, 'request');
    assert.doesNotMatch(`${error.message} ${JSON.stringify(error.details)} ${error.cause ?? ''}`, /fixture-html-request-secret/);
    return true;
  });
  assert.throws(() => generateAppHtml(valuesRequest), error => {
    assert.equal(error?.code, 'HTML_VALUE_MISSING');
    assert.equal(error?.details?.field, 'values');
    assert.doesNotMatch(`${error.message} ${JSON.stringify(error.details)} ${error.cause ?? ''}`, /fixture-html-request-values-secret/);
    return true;
  });
  assert.throws(() => generateAppHtml({ template, values: input }), error => {
    assert.equal(error?.code, 'HTML_VALUE_MISSING');
    assert.equal(error?.details?.field, 'app.lang');
    assert.doesNotMatch(`${error.message} ${JSON.stringify(error.details)} ${error.cause ?? ''}`, /fixture-html-values-secret/);
    return true;
  });
});

test('break: repeated HTML generation stops changing output or mutating caller values', () => {
  const input = values({ app: { title: 'Stable title', version: '2.0.0' }, env: { mode: 'production' } });
  const before = structuredClone(input);

  const first = generateAppHtml({ template, values: input });
  const second = generateAppHtml({ template, values: input });

  assert.equal(first, second);
  assert.deepEqual(input, before);
});
