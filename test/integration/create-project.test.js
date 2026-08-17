import assert from 'node:assert/strict';
import { lstat, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { FileWorkspaceLock } from '../../src/adapters/node/file-workspace-lock.js';
import { NodeFilesystem } from '../../src/adapters/node/node-filesystem.js';
import { createApp } from '../../src/application/app/create-app.js';
import { createComponent } from '../../src/application/component/create-component.js';
import { WorkspaceSession, typedError } from '../../src/domain/workspace-session.js';

async function fixture(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'open-cells-academy-create-'));
  t.after(async () => {
    await rm(root, { recursive: true, force: true });
  });
  await writeFile(path.join(root, 'package.json'), JSON.stringify({ name: 'create-fixture' }));
  const filesystem = new NodeFilesystem();
  const session = await WorkspaceSession.open(root, filesystem);
  return { filesystem, root, session };
}

function artifact(name = 'open-cells-academy-cli-0.1.0.tgz') {
  const calls = [];
  return {
    calls,
    async packLocalCli(details) {
      calls.push(details);
      return Object.freeze({ fileName: name, content: new Uint8Array([1, 2, 3]), integrity: 'sha512-fixture' });
    }
  };
}

function context({ filesystem, session, lock = undefined, packageManager = undefined, localCli = artifact(), prompt = undefined } = {}) {
  return {
    filesystem,
    session,
    workspaceLock: lock ?? new FileWorkspaceLock({ filesystem }),
    packageManager,
    packLocalCli: localCli.packLocalCli,
    prompt
  };
}

function scaffoldFile(profile, name, extra = {}) {
  return JSON.stringify({ name, scaffold: profile, ...extra });
}

async function generated(root, name) {
  return {
    declaration: JSON.parse(await readFile(path.join(root, name, '.open-cells-academy-recipe.json'), 'utf8')),
    metadata: JSON.parse(await readFile(path.join(root, name, 'package.json'), 'utf8'))
  };
}

test('break: inline, safe file, and interactive app input stop reaching one identical schema normalizer', async t => {
  const first = await fixture(t);
  const second = await fixture(t);
  const third = await fixture(t);
  await mkdir(path.join(second.root, 'inputs'));
  await writeFile(path.join(second.root, 'inputs', 'app.json'), scaffoldFile('academy-app', 'file-app', { e2e: true }));

  const inline = await createApp(
    { scaffold: { name: 'inline-app', scaffold: 'academy-app', e2e: true } },
    context({ ...first })
  );
  const fromFile = await createApp({ scaffold: 'inputs/app.json' }, context({ ...second }));
  const interactive = await createApp(
    {},
    context({ ...third, prompt: async () => ({ name: 'interactive-app', scaffold: 'academy-app', e2e: true }) })
  );

  assert.equal(inline.ok, true);
  assert.equal(fromFile.ok, true);
  assert.equal(interactive.ok, true);
  for (const [root, name] of [[first.root, 'inline-app'], [second.root, 'file-app'], [third.root, 'interactive-app']]) {
    const output = await generated(root, name);
    assert.deepEqual(output.declaration.capabilities.at(-1), 'e2e-playwright');
    assert.equal(output.metadata.devDependencies['open-cells-academy-cli'], 'file:tools/open-cells-academy-cli-0.1.0.tgz');
    assert.deepEqual([...await readFile(path.join(root, name, 'tools', 'open-cells-academy-cli-0.1.0.tgz'))], [1, 2, 3]);
  }
});

test('contract: creation records an explicit Open Cells version and rejects every other version value', async t => {
  const { filesystem, root, session } = await fixture(t);
  const createContext = context({ filesystem, session });

  const modern = await createApp(
    { scaffold: { name: 'modern-app', scaffold: 'blank' } },
    createContext
  );
  const legacy = await createApp(
    { scaffold: { name: 'legacy-app', scaffold: 'web-app', cellsVersion: '4' } },
    createContext
  );
  const legacyComponent = await createComponent(
    { scaffold: { name: 'legacy-card', namespace: '@academy', cellsVersion: '4' } },
    createContext
  );

  assert.equal(modern.ok, true);
  assert.equal(legacy.ok, true);
  assert.equal(legacyComponent.ok, true);
  assert.equal((await generated(root, 'modern-app')).declaration.cellsVersion, '5');
  assert.equal((await generated(root, 'legacy-app')).declaration.cellsVersion, '4');
  assert.equal((await generated(root, 'legacy-card')).declaration.cellsVersion, '4');

  for (const [index, cellsVersion] of [4, 5, '3', '4.9', '5.1', ''].entries()) {
    const result = await createApp(
      { scaffold: { name: `invalid-version-${index}`, scaffold: 'blank', cellsVersion } },
      createContext
    );
    assert.equal(result.ok, false);
    assert.equal(result.code, 'INVALID_INPUT');
  }
});

test('break: invalid app schemas, unknown profiles, malformed JSON, and unknown fields stop publishing a target', async t => {
  const { filesystem, root, session } = await fixture(t);
  await mkdir(path.join(root, 'inputs'));
  await writeFile(path.join(root, 'inputs', 'invalid.json'), '{ malformed');
  const cases = [
    { scaffold: { name: 'missing-profile' } },
    { scaffold: { name: 'unknown-profile', scaffold: 'unknown' } },
    { scaffold: { name: 'unknown-field', scaffold: 'blank', unexpected: true } },
    { scaffold: 'inputs/invalid.json' }
  ];

  for (const request of cases) {
    const result = await createApp(request, context({ filesystem, session }));
    assert.equal(result.ok, false);
    assert.equal(result.code, 'INVALID_INPUT');
  }
  for (const name of ['missing-profile', 'unknown-profile', 'unknown-field']) {
    await assert.rejects(lstat(path.join(root, name)), { code: 'ENOENT' });
  }
});

test('break: traversal and an escaping scaffold symlink stop reading data outside the workspace', async t => {
  const { filesystem, root, session } = await fixture(t);
  const outside = await mkdtemp(path.join(os.tmpdir(), 'open-cells-academy-create-outside-'));
  t.after(async () => {
    await rm(outside, { recursive: true, force: true });
  });
  await writeFile(path.join(outside, 'app.json'), scaffoldFile('blank', 'outside-app'));
  await symlink(path.join(outside, 'app.json'), path.join(root, 'escaped.json'));

  const traversal = await createApp({ scaffold: '../outside.json' }, context({ filesystem, session }));
  const escaped = await createApp({ scaffold: 'escaped.json' }, context({ filesystem, session }));

  assert.equal(traversal.ok, false);
  assert.equal(traversal.code, 'PATH_INVALID');
  assert.equal(escaped.ok, false);
  assert.equal(escaped.code, 'PATH_OUTSIDE_WORKSPACE');
});

test('break: duplicate app destinations stop replacing an existing project by default', async t => {
  const { filesystem, root, session } = await fixture(t);
  const first = await createApp({ scaffold: { name: 'same-app', scaffold: 'blank' } }, context({ filesystem, session }));
  const second = await createApp({ scaffold: { name: 'same-app', scaffold: 'blank' } }, context({ filesystem, session }));

  assert.equal(first.ok, true);
  assert.equal(second.ok, false);
  assert.equal(second.code, 'OUTPUT_EXISTS');
  assert.equal((await generated(root, 'same-app')).declaration.profile, 'blank');
});

test('break: same-operation lock contention stops running a second app create before publication', async t => {
  const { filesystem, root, session } = await fixture(t);
  const lock = new FileWorkspaceLock({ filesystem });
  const held = await lock.acquire(session, 'app:create');
  t.after(async () => {
    await held.release();
  });

  const result = await createApp({ scaffold: { name: 'locked-app', scaffold: 'blank' } }, context({ filesystem, session, lock }));

  assert.equal(result.ok, false);
  assert.equal(result.code, 'WORKSPACE_LOCKED');
  await assert.rejects(lstat(path.join(root, 'locked-app')), { code: 'ENOENT' });
});

test('break: interrupted publication stops leaving a target and releases the held app lock', async t => {
  const { filesystem, root, session } = await fixture(t);
  const controller = new AbortController();
  controller.abort();
  const lock = new FileWorkspaceLock({ filesystem });

  const result = await createApp(
    { scaffold: { name: 'interrupted-app', scaffold: 'blank' }, signal: controller.signal },
    context({ filesystem, session, lock })
  );

  assert.equal(result.ok, false);
  assert.equal(result.code, 'INTERRUPTED');
  await assert.rejects(lstat(path.join(root, 'interrupted-app')), { code: 'ENOENT' });
  const next = await lock.acquire(session, 'app:create');
  await next.release();
});

test('break: dependency installation stops releasing the lock early or masquerading a retained published app as full success', async t => {
  const { filesystem, root, session } = await fixture(t);
  let lockReleased = false;
  const lock = {
    async acquire() {
      return {
        async release() {
          lockReleased = true;
        }
      };
    }
  };
  const packageManager = {
    async install() {
      assert.equal(lockReleased, false);
      throw typedError('TOOL_FAILED');
    }
  };

  const result = await createApp(
    { scaffold: { name: 'install-failure-app', scaffold: 'blank', installDeps: true } },
    context({ filesystem, session, lock, packageManager })
  );

  assert.equal(result.ok, false);
  assert.equal(result.code, 'TOOL_FAILED');
  assert.equal(result.params.published, true);
  assert.equal(lockReleased, true);
  assert.equal((await generated(root, 'install-failure-app')).declaration.profile, 'blank');
});

test('break: successful optional app dependency installation stops receiving the created workspace session', async t => {
  const { filesystem, session } = await fixture(t);
  const calls = [];
  const packageManager = {
    async install(request, suppliedSession) {
      calls.push({ request, suppliedSession });
      return Object.freeze({ tool: 'npm', mode: 'install', result: { exitCode: 0 } });
    }
  };

  const result = await createApp(
    { scaffold: { name: 'installed-app', scaffold: 'web-app', installDeps: true } },
    context({ filesystem, session, packageManager })
  );

  assert.equal(result.ok, true);
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].request, { mode: 'install', allowScripts: false, offline: false, signal: undefined });
  assert.equal(calls[0].suppliedSession.root.endsWith('installed-app'), true);
});

test('break: component normalization stops enforcing its kebab name, scoped namespace, and e2e flag agreement', async t => {
  const { filesystem, root, session } = await fixture(t);
  const successful = await createComponent(
    { scaffold: { name: 'academy-card', namespace: 'academy.widgets', e2e: true } },
    context({ filesystem, session })
  );
  const contradictory = await createComponent(
    { scaffold: { name: 'academy-panel', namespace: '@academy', e2e: true }, flags: { e2e: false } },
    context({ filesystem, session })
  );
  const invalid = await createComponent(
    { scaffold: { name: 'AcademyCard', namespace: '@academy/' } },
    context({ filesystem, session })
  );

  assert.equal(successful.ok, true);
  assert.equal(contradictory.ok, false);
  assert.equal(contradictory.code, 'INVALID_INPUT');
  assert.equal(invalid.ok, false);
  assert.equal(invalid.code, 'INVALID_INPUT');
  const output = await generated(root, 'academy-card');
  assert.equal(output.declaration.namespace, '@academy.widgets');
  assert.equal(output.metadata.name, '@academy.widgets/academy-card');
  assert.equal(output.declaration.capabilities.at(-1), 'e2e-playwright');
});

test('break: component CLI flags stop supplying absent schema booleans and rejecting contradictory duplicates', async t => {
  const { filesystem, root, session } = await fixture(t);
  const success = await createComponent(
    { scaffold: { name: 'academy-banner', namespace: '@academy' }, flags: { e2e: true, installDeps: false } },
    context({ filesystem, session })
  );
  const conflict = await createComponent(
    { scaffold: { name: 'academy-dialog', namespace: '@academy', installDeps: true }, flags: { installDeps: false } },
    context({ filesystem, session })
  );

  assert.equal(success.ok, true);
  assert.equal(conflict.ok, false);
  assert.equal(conflict.code, 'INVALID_INPUT');
  assert.equal((await generated(root, 'academy-banner')).declaration.capabilities.at(-1), 'e2e-playwright');
});
