import assert from 'node:assert/strict';
import { lstat, mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { NodeFilesystem } from '../../src/adapters/node/node-filesystem.js';
import { PathPolicy, validateProjectName } from '../../src/domain/path-policy.js';
import { WorkspaceSession } from '../../src/domain/workspace-session.js';

async function workspaceFixture(t, name = 'open-cells-academy-workspace-') {
  const root = await mkdtemp(path.join(os.tmpdir(), name));
  t.after(async () => {
    await rm(root, { recursive: true, force: true });
  });
  await writeFile(path.join(root, 'package.json'), JSON.stringify({ name: 'fixture-workspace', private: true }));
  return root;
}

async function directoryFixture(t, name = 'open-cells-academy-directory-') {
  const root = await mkdtemp(path.join(os.tmpdir(), name));
  t.after(async () => {
    await rm(root, { recursive: true, force: true });
  });
  return root;
}

async function openFixture(t) {
  const root = await workspaceFixture(t);
  const filesystem = new NodeFilesystem();
  const session = await WorkspaceSession.open(root, filesystem);
  return { filesystem, root, session };
}

async function assertRejectsCode(promise, code) {
  await assert.rejects(promise, error => {
    assert.equal(error.code, code);
    return true;
  });
}

test('break: supplied workspace roots stop resolving to canonical immutable package sessions', async t => {
  const { filesystem, root, session } = await openFixture(t);

  assert.equal(session.root, await filesystem.realpath(root));
  assert.deepEqual(session.packageMetadata, { name: 'fixture-workspace', private: true });
  assert.equal(Object.isFrozen(session), true);
  assert.equal(Object.isFrozen(session.packageMetadata), true);
  assert.throws(() => {
    session.packageMetadata.name = 'mutated';
  }, TypeError);
});

test('break: creation directories stop resolving to canonical immutable sessions without package metadata', async t => {
  const root = await directoryFixture(t);
  const filesystem = new NodeFilesystem();
  const session = await WorkspaceSession.openDirectory(root, filesystem);

  assert.equal(session.root, await filesystem.realpath(root));
  assert.deepEqual(session.packageMetadata, {});
  assert.equal(Object.isFrozen(session), true);
  assert.equal(Object.isFrozen(session.packageMetadata), true);
  assert.throws(() => {
    session.packageMetadata.name = 'mutated';
  }, TypeError);
});

test('break: creation directories stop preserving typed failures for missing non-directory and symlink roots', async t => {
  const root = await directoryFixture(t);
  const filesystem = new NodeFilesystem();
  const missing = path.join(root, 'missing');
  const file = path.join(root, 'not-a-directory');
  const linkedDirectory = path.join(root, 'linked-directory');

  await writeFile(file, 'plain file');
  await symlink(root, linkedDirectory, 'dir');

  await assertRejectsCode(WorkspaceSession.openDirectory(missing, filesystem), 'WORKSPACE_NOT_FOUND');
  await assertRejectsCode(WorkspaceSession.openDirectory(file, filesystem), 'WORKSPACE_NOT_DIRECTORY');
  await assertRejectsCode(WorkspaceSession.openDirectory(linkedDirectory, filesystem), 'WORKSPACE_SYMLINK');
});

test('break: creation directories stop accepting a swapped outside canonical root', async t => {
  const root = await directoryFixture(t, 'open-cells-academy-creation-root-');
  const outside = await directoryFixture(t, 'open-cells-academy-creation-outside-');
  const nodeFilesystem = new NodeFilesystem();
  let pathChecks = 0;
  const filesystem = {
    resolvePath: candidate => nodeFilesystem.resolvePath(candidate),
    joinPath: (...parts) => nodeFilesystem.joinPath(...parts),
    lstat: candidate => nodeFilesystem.lstat(candidate),
    realpath: async candidate => {
      if (candidate === root) {
        assert.equal(pathChecks > 0, true);
        return nodeFilesystem.realpath(outside);
      }
      return nodeFilesystem.realpath(candidate);
    },
    readFile: (...args) => nodeFilesystem.readFile(...args),
    pathHasSymlink: async candidate => {
      if (candidate === root) {
        pathChecks += 1;
        return false;
      }
      return nodeFilesystem.pathHasSymlink(candidate);
    }
  };

  await assertRejectsCode(WorkspaceSession.openDirectory(root, filesystem), 'WORKSPACE_INVALID');
});

test('break: invalid workspace roots stop reporting typed opening failures', async t => {
  const root = await workspaceFixture(t);
  const filesystem = new NodeFilesystem();
  const missing = path.join(root, 'missing');
  const file = path.join(root, 'not-a-directory');
  const noMetadata = path.join(root, 'no-metadata');
  const invalidMetadata = path.join(root, 'invalid-metadata');
  const arrayMetadata = path.join(root, 'array-metadata');
  const linkedWorkspace = path.join(root, 'linked-workspace');

  await writeFile(file, 'plain file');
  await mkdir(noMetadata);
  await mkdir(invalidMetadata);
  await writeFile(path.join(invalidMetadata, 'package.json'), '{');
  await mkdir(arrayMetadata);
  await writeFile(path.join(arrayMetadata, 'package.json'), '[]');
  await symlink(root, linkedWorkspace, 'dir');

  await assertRejectsCode(WorkspaceSession.open(missing, filesystem), 'WORKSPACE_NOT_FOUND');
  await assertRejectsCode(WorkspaceSession.open(file, filesystem), 'WORKSPACE_NOT_DIRECTORY');
  await assertRejectsCode(WorkspaceSession.open(linkedWorkspace, filesystem), 'WORKSPACE_SYMLINK');
  await assertRejectsCode(WorkspaceSession.open(noMetadata, filesystem), 'WORKSPACE_PACKAGE_MISSING');
  await assertRejectsCode(WorkspaceSession.open(invalidMetadata, filesystem), 'WORKSPACE_PACKAGE_INVALID');
  await assertRejectsCode(WorkspaceSession.open(arrayMetadata, filesystem), 'WORKSPACE_PACKAGE_INVALID');
});

test('break: nested contained read write and destructive paths stop resolving to exact workspace descendants', async t => {
  const { filesystem, root, session } = await openFixture(t);
  await mkdir(path.join(root, 'src', 'nested'), { recursive: true });
  await mkdir(path.join(root, 'scratch'), { recursive: true });
  await writeFile(path.join(root, 'src', 'nested', 'existing.txt'), 'read me');
  await writeFile(path.join(root, 'scratch', 'old.txt'), 'remove me');
  const policy = new PathPolicy(session, filesystem);

  assert.equal(
    await policy.resolveRead('src/nested/existing.txt'),
    path.join(session.root, 'src', 'nested', 'existing.txt')
  );
  assert.equal(await policy.resolveWrite('generated/output.txt'), path.join(session.root, 'generated', 'output.txt'));
  assert.equal(await policy.resolveDestructive('scratch/old.txt'), path.join(session.root, 'scratch', 'old.txt'));
  assert.equal(validateProjectName('academy-app'), 'academy-app');
});

test('break: literal traversal absolute Windows NUL and ambiguous paths stop being rejected on every host', async t => {
  const { filesystem, session } = await openFixture(t);
  const policy = new PathPolicy(session, filesystem);
  const invalidPaths = [
    '../x',
    'a/../x',
    './x',
    'a//b',
    '/tmp/x',
    String.raw`C:\x`,
    'C:/x',
    'C:relative-drive-path',
    String.raw`\\server\share`,
    String.raw`\\?\C:\x`,
    'nul\0byte',
    ''
  ];

  for (const invalidPath of invalidPaths) {
    await assertRejectsCode(policy.resolveWrite(invalidPath), 'PATH_INVALID');
  }
});

test('break: Windows drive-relative paths stop bypassing the cross-host absolute-path policy', async t => {
  const { filesystem, session } = await openFixture(t);
  const policy = new PathPolicy(session, filesystem);

  for (const candidate of ['C:x', 'z:folder/file.txt', 'Q:']) {
    await assertRejectsCode(policy.resolveWrite(candidate), 'PATH_INVALID');
  }
});

test('break: existing ancestor symlinks escaping the workspace stop being rejected for reads and writes', async t => {
  const { filesystem, root, session } = await openFixture(t);
  const outside = await mkdtemp(path.join(os.tmpdir(), 'open-cells-academy-outside-'));
  t.after(async () => {
    await rm(outside, { recursive: true, force: true });
  });
  await writeFile(path.join(outside, 'outside.txt'), 'outside');
  await symlink(outside, path.join(root, 'linked'), 'dir');
  const policy = new PathPolicy(session, filesystem);

  await assertRejectsCode(policy.resolveRead('linked/outside.txt'), 'PATH_OUTSIDE_WORKSPACE');
  await assertRejectsCode(policy.resolveWrite('linked/new.txt'), 'PATH_OUTSIDE_WORKSPACE');
});

test('break: destructive workspace-root requests stop receiving a dedicated protection failure', async t => {
  const { filesystem, session } = await openFixture(t);
  const policy = new PathPolicy(session, filesystem);

  await assertRejectsCode(policy.resolveDestructive('.'), 'DESTRUCTIVE_ROOT');
});

test('break: project names unsafe for one child directory stop being rejected', () => {
  const invalidNames = [
    '',
    ' leading',
    'trailing ',
    '.',
    '..',
    'nested/name',
    String.raw`nested\name`,
    '../escape',
    'nul\0name',
    String.raw`C:\project`,
    '@scope/project',
    'line\nfeed'
  ];

  for (const invalidName of invalidNames) {
    assert.throws(
      () => validateProjectName(invalidName),
      error => {
        assert.equal(error.code, 'PROJECT_NAME_INVALID');
        return true;
      }
    );
  }
});

test('break: read requests for absent descendants stop reporting a typed missing-path failure', async t => {
  const { filesystem, session } = await openFixture(t);
  const policy = new PathPolicy(session, filesystem);

  await assertRejectsCode(policy.resolveRead('does-not-exist.txt'), 'PATH_NOT_FOUND');
});

test('break: workspace metadata symlinks stop being rejected as ambiguous metadata', async t => {
  const root = await workspaceFixture(t);
  const filesystem = new NodeFilesystem();
  const outside = await mkdtemp(path.join(os.tmpdir(), 'open-cells-academy-metadata-'));
  t.after(async () => {
    await rm(outside, { recursive: true, force: true });
  });
  await writeFile(path.join(outside, 'package.json'), JSON.stringify({ name: 'outside' }));
  await rm(path.join(root, 'package.json'));
  await symlink(path.join(outside, 'package.json'), path.join(root, 'package.json'), 'file');

  await assertRejectsCode(WorkspaceSession.open(root, filesystem), 'WORKSPACE_PACKAGE_INVALID');
  assert.equal((await lstat(path.join(root, 'package.json'))).isSymbolicLink(), true);
});
