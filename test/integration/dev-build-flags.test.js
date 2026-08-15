import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { AppToolchain } from '../../src/adapters/vite/app-toolchain.js';
import { ComponentToolchain } from '../../src/adapters/vite/component-toolchain.js';
import { sassLogLevelValue, sassPreprocessorOptions } from '../../src/adapters/vite/sass-log.js';
import { buildApp } from '../../src/application/app/build-app.js';
import { devApp } from '../../src/application/app/dev-app.js';
import { devComponent } from '../../src/application/component/dev-component.js';
import { NodeFilesystem } from '../../src/adapters/node/node-filesystem.js';
import { WorkspaceSession } from '../../src/domain/workspace-session.js';

const template = '<!doctype html><html lang="##app.lang##"><head><title>##app.title##</title><meta name="description" content="##app.description##"></head><body><header>##app.header##</header><main data-name="##app.name##">##app.version## ##env.mode##</main></body></html>';

async function appWorkspace(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'open-cells-academy-flags-'));
  t.after(async () => {
    await rm(root, { recursive: true, force: true });
  });
  await writeFile(path.join(root, 'package.json'), '{"name":"flags-fixture","private":true,"type":"module"}\n');
  await mkdir(path.join(root, 'app', 'config'), { recursive: true });
  await writeFile(path.join(root, 'app', 'index.html'), template);
  await writeFile(
    path.join(root, 'app', 'config', 'dev.js'),
    `export default ${JSON.stringify({ app: { lang: 'en', title: 'Flags', description: 'd', header: 'h', name: 'flags-fixture', version: '1.0.0' } })};`
  );
  const filesystem = new NodeFilesystem();
  const session = await WorkspaceSession.open(root, filesystem);
  return { filesystem, root, session };
}

async function componentWorkspace(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'open-cells-academy-flags-component-'));
  t.after(async () => {
    await rm(root, { recursive: true, force: true });
  });
  await writeFile(path.join(root, 'package.json'), '{"name":"flags-component-fixture","private":true,"type":"module"}\n');
  await mkdir(path.join(root, 'demo'), { recursive: true });
  await writeFile(path.join(root, 'demo', 'index.html'), '<!doctype html><html><body>demo</body></html>');
  await writeFile(path.join(root, 'demo', 'demo.js'), "console.log('demo');\n");
  const filesystem = new NodeFilesystem();
  const session = await WorkspaceSession.open(root, filesystem);
  return { filesystem, root, session };
}

function capturingVite(events) {
  return {
    async createServer(config) {
      events.push(Object.freeze({ kind: 'server', config }));
      return {
        httpServer: { address: () => ({ port: 41099 }) },
        async listen() {},
        async close() {}
      };
    },
    async build(config) {
      events.push(Object.freeze({ kind: 'build', config }));
      return {};
    },
    async preview(config) {
      events.push(Object.freeze({ kind: 'preview', config }));
      return { httpServer: { address: () => ({ port: 41098 }) }, async close() {} };
    }
  };
}

test('sassLogLevel maps to vite sass preprocessor options and rejects unknown levels', () => {
  assert.equal(sassLogLevelValue(undefined), 'warn');
  assert.equal(sassPreprocessorOptions(undefined), undefined);
  assert.equal(sassPreprocessorOptions('warn'), undefined);

  const errorLevel = sassPreprocessorOptions('error');
  assert.equal(typeof errorLevel.logger.error, 'function');
  errorLevel.logger.debug('hidden');
  errorLevel.logger.warn('hidden');

  const verboseLevel = sassPreprocessorOptions('verbose');
  assert.equal(typeof verboseLevel.logger.debug, 'function');
  assert.equal(typeof verboseLevel.logger.warn, 'function');
  assert.equal(typeof verboseLevel.logger.error, 'function');

  assert.throws(() => sassLogLevelValue('loud'), error => error.code === 'SASS_INPUT_INVALID');
});

test('app:dev propagates sassLogLevel into the vite dev server config', async t => {
  const { session } = await appWorkspace(t);
  const events = [];
  const handle = await devApp(Object.freeze({
    session,
    toolchain: new AppToolchain(capturingVite(events)),
    configName: 'dev.js',
    options: Object.freeze({ host: '127.0.0.1', port: 41099, strictPort: true, open: false, sassLogLevel: 'error' })
  }));
  await handle.close();
  const config = events.at(-1).config;
  assert.equal(typeof config.css.preprocessorOptions.scss.logger.error, 'function');

  const silentEvents = [];
  const silentHandle = await devApp(Object.freeze({
    session,
    toolchain: new AppToolchain(capturingVite(silentEvents)),
    configName: 'dev.js',
    options: Object.freeze({ host: '127.0.0.1', port: 41099, strictPort: true, open: false })
  }));
  await silentHandle.close();
  assert.equal(silentEvents.at(-1).config.css, undefined);
});

test('app:dev --debug enables vite debug logging for the server lifetime only', async t => {
  const { session } = await appWorkspace(t);
  const previous = process.env.DEBUG;
  delete process.env.DEBUG;
  t.after(() => {
    if (previous === undefined) delete process.env.DEBUG;
    else process.env.DEBUG = previous;
  });

  const events = [];
  const handle = await devApp(Object.freeze({
    session,
    toolchain: new AppToolchain(capturingVite(events)),
    configName: 'dev.js',
    options: Object.freeze({ host: '127.0.0.1', port: 41099, strictPort: true, open: false, debug: true })
  }));
  assert.equal(process.env.DEBUG, 'vite:*');
  await handle.close();
  assert.equal(process.env.DEBUG, undefined);

  process.env.DEBUG = 'app:*';
  const secondEvents = [];
  const secondHandle = await devApp(Object.freeze({
    session,
    toolchain: new AppToolchain(capturingVite(secondEvents)),
    configName: 'dev.js',
    options: Object.freeze({ host: '127.0.0.1', port: 41099, strictPort: true, open: false, debug: true })
  }));
  assert.equal(process.env.DEBUG, 'app:*,vite:*');
  await secondHandle.close();
  assert.equal(process.env.DEBUG, 'app:*');
});

test('app:build propagates sassLogLevel into the vite build config', async t => {
  const { filesystem, session } = await appWorkspace(t);
  const events = [];
  await buildApp(Object.freeze({
    session,
    filesystem,
    toolchain: new AppToolchain(capturingVite(events)),
    configName: 'dev.js',
    options: Object.freeze({ sourceMap: false, sassLogLevel: 'verbose' })
  }));
  const buildEvent = events.find(event => event.kind === 'build');
  assert.notEqual(buildEvent, undefined);
  assert.equal(typeof buildEvent.config.css.preprocessorOptions.scss.logger.debug, 'function');
});

test('component:dev propagates sassLogLevel into the vite dev server config', async t => {
  const { session } = await componentWorkspace(t);
  const events = [];
  const handle = await devComponent(Object.freeze({
    session,
    toolchain: new ComponentToolchain(capturingVite(events)),
    options: Object.freeze({ host: '127.0.0.1', port: 41099, strictPort: true, open: false, sassLogLevel: 'error' })
  }));
  await handle.close();
  const config = events.at(-1).config;
  assert.equal(typeof config.css.preprocessorOptions.scss.logger.error, 'function');
});
