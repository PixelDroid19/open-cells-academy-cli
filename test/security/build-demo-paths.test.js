import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { ComponentToolchain } from '../../src/adapters/vite/component-toolchain.js';
import { buildComponentDemo } from '../../src/application/component/build-demo.js';
import { NodeFilesystem } from '../../src/adapters/node/node-filesystem.js';
import { WorkspaceSession } from '../../src/domain/workspace-session.js';
import { createFakeComponentVite } from '../fixtures/task-9-component-toolchain/fake-toolchain.js';

const REDIRECT_HTML = '<!doctype html><html><head><meta http-equiv="refresh" content="0;url=demo/"></head></html>';
const DEMO_INDEX_HTML = '<!doctype html><html><head><title>demo</title></head><body>demo</body></html>';

async function workspace(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'open-cells-academy-demo-paths-'));
  t.after(async () => {
    await rm(root, { recursive: true, force: true });
  });
  await writeFile(path.join(root, 'package.json'), '{"name":"paths-fixture","private":true}\n');
  const filesystem = new NodeFilesystem();
  const session = await WorkspaceSession.open(root, filesystem);
  return { filesystem, root, session };
}

async function writeWorkspaceFile(root, relativePath, content) {
  const target = path.join(root, relativePath);
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, content);
}

async function writeStandardComponent(root) {
  await writeWorkspaceFile(root, 'index.html', REDIRECT_HTML);
  await writeWorkspaceFile(root, 'demo/index.html', DEMO_INDEX_HTML);
  await writeWorkspaceFile(root, 'demo/demo.js', "console.log('demo');\n");
  await writeWorkspaceFile(root, 'src/component.js', "export class C {}\n");
}

function assertCode(promise, code) {
  return assert.rejects(promise, error => {
    assert.equal(error?.code, code);
    return true;
  });
}

test('security: build demo rejects an absolute dist target and a dist that escapes the workspace', async t => {
  const { filesystem, root, session } = await workspace(t);
  await writeStandardComponent(root);
  const toolchain = new ComponentToolchain(createFakeComponentVite());

  await assertCode(
    buildComponentDemo(Object.freeze({ session, filesystem, toolchain, dist: '/tmp/escape' })),
    'PATH_INVALID'
  );
  await assertCode(
    buildComponentDemo(Object.freeze({ session, filesystem, toolchain, dist: 'a/../../b' })),
    'PATH_INVALID'
  );
});

test('security: build demo rejects a dist parent symlink that escapes the workspace', async t => {
  const { filesystem, root, session } = await workspace(t);
  await writeStandardComponent(root);
  const outside = await mkdtemp(path.join(os.tmpdir(), 'open-cells-academy-demo-paths-outside-'));
  t.after(() => rm(outside, { recursive: true, force: true }));
  await mkdir(path.join(root, 'out'), { recursive: false });
  await symlink(outside, path.join(root, 'out', 'demo'));
  const toolchain = new ComponentToolchain(createFakeComponentVite());

  await assert.rejects(
    buildComponentDemo(Object.freeze({ session, filesystem, toolchain, dist: 'out/demo/publish' })),
    error => {
      assert.ok(['COMPONENT_DEMO_DIST_INVALID', 'COMPONENT_DEMO_SOURCE_INVALID'].includes(error?.code));
      return true;
    }
  );
});

test('security: build demo rejects a symlink inside the component tree instead of publishing external bytes', async t => {
  const { filesystem, root, session } = await workspace(t);
  await writeStandardComponent(root);
  const outside = await mkdtemp(path.join(os.tmpdir(), 'open-cells-academy-demo-paths-outside-'));
  t.after(() => rm(outside, { recursive: true, force: true }));
  await writeFile(path.join(outside, 'secret.txt'), 'EXTERNAL_DEMO_SECRET\n');
  await symlink(path.join(outside, 'secret.txt'), path.join(root, 'locales.json'));
  const toolchain = new ComponentToolchain(createFakeComponentVite());

  await assert.rejects(
    buildComponentDemo(Object.freeze({ session, filesystem, toolchain })),
    error => {
      assert.ok(['COMPONENT_DEMO_SOURCE_INVALID', 'PATH_CHANGED'].includes(error?.code));
      return true;
    }
  );
  await assert.rejects(readFile(path.join(root, 'dist', 'locales.json'), 'utf8'), error => error?.code === 'ENOENT');
});

test('security: build demo rejects an absolute demo root', async t => {
  const { filesystem, root, session } = await workspace(t);
  await writeStandardComponent(root);
  const toolchain = new ComponentToolchain(createFakeComponentVite());

  await assertCode(buildComponentDemo(Object.freeze({ session, filesystem, toolchain, demo: '/etc' })), 'PATH_INVALID');
  await assertCode(buildComponentDemo(Object.freeze({ session, filesystem, toolchain, demo: 'demo/../../x' })), 'PATH_INVALID');
});

test('security: build demo leaves no owned stage or temporary residue after success and after failure', async t => {
  const { filesystem, root, session } = await workspace(t);
  await writeStandardComponent(root);
  const toolchain = new ComponentToolchain(createFakeComponentVite());

  await buildComponentDemo(Object.freeze({ session, filesystem, toolchain }));
  const entriesAfterSuccess = (await (await import('node:fs/promises')).readdir(root)).filter(name => name.includes('.open-cells-academy-demo-stage'));
  assert.deepEqual(entriesAfterSuccess, []);

  await writeWorkspaceFile(root, 'demo/broken.js', "import './missing.js';\n");
  await assertCode(buildComponentDemo(Object.freeze({ session, filesystem, toolchain })), 'COMPONENT_DEMO_BUILD_FAILED');
  const entriesAfterFailure = (await (await import('node:fs/promises')).readdir(root)).filter(name => name.includes('.open-cells-academy-demo-stage'));
  assert.deepEqual(entriesAfterFailure, []);
});
