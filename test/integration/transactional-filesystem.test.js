import assert from 'node:assert/strict';
import { lstat, mkdir, mkdtemp, readdir, readFile, rename, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { NodeFilesystem } from '../../src/adapters/node/node-filesystem.js';
import { ScaffoldPlan } from '../../src/domain/scaffold-plan.js';
import { WorkspaceSession } from '../../src/domain/workspace-session.js';

async function fixture(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'open-cells-academy-transaction-'));
  t.after(async () => {
    await rm(root, { recursive: true, force: true });
  });
  await writeFile(path.join(root, 'package.json'), JSON.stringify({ name: 'transaction-fixture' }));
  const filesystem = new NodeFilesystem();
  const session = await WorkspaceSession.open(root, filesystem);
  return { filesystem, root, session };
}

async function assertNoOwnedResidue(root) {
  const entries = await readdir(root);
  assert.deepEqual(entries.filter(entry => entry.startsWith('.open-cells-academy-')), []);
}

async function assertCode(promise, code) {
  await assert.rejects(promise, error => {
    assert.equal(error.code, code);
    return true;
  });
}

test('break: successful transactions stop publishing a complete plan atomically into a new destination', async t => {
  const { filesystem, root, session } = await fixture(t);
  const plan = ScaffoldPlan.empty()
    .addDirectory('src')
    .addFile('src/index.js', 'export const message = "ready";')
    .addFile('package.json', '{"private":true}\n');

  const result = await filesystem.applyPlanAtomically(session, plan, 'generated');

  assert.equal(result.destination, path.join(session.root, 'generated'));
  assert.equal(await readFile(path.join(root, 'generated', 'src', 'index.js'), 'utf8'), 'export const message = "ready";');
  assert.equal(await readFile(path.join(root, 'generated', 'package.json'), 'utf8'), '{"private":true}\n');
  await assertNoOwnedResidue(root);
});

test('break: staging starts becoming visible at the requested destination before publish', async t => {
  const { filesystem, root, session } = await fixture(t);
  let observed;
  const plan = ScaffoldPlan.empty().addFile('index.js', 'export {};');

  await filesystem.applyPlanAtomically(session, plan, 'output', {
    hooks: {
      async beforePublish({ staging, destination }) {
        observed = {
          destinationExists: await lstat(destination).then(() => true, () => false),
          stagedContent: await readFile(path.join(staging, 'index.js'), 'utf8')
        };
      }
    }
  });

  assert.deepEqual(observed, { destinationExists: false, stagedContent: 'export {};' });
  assert.equal(await readFile(path.join(root, 'output', 'index.js'), 'utf8'), 'export {};');
  await assertNoOwnedResidue(root);
});

test('break: a mid-plan write failure starts leaving a partial destination or owned staging residue', async t => {
  const { filesystem, root, session } = await fixture(t);
  const plan = ScaffoldPlan.empty().addFile('one.txt', 'one').addFile('two.txt', 'two');

  await assertCode(
    filesystem.applyPlanAtomically(session, plan, 'output', {
      hooks: {
        beforeWrite({ file }) {
          if (file.path === 'two.txt') {
            throw new Error('injected write failure');
          }
        }
      }
    }),
    'TRANSACTION_FAILED'
  );

  await assert.rejects(lstat(path.join(root, 'output')), { code: 'ENOENT' });
  await assertNoOwnedResidue(root);
});

test('break: a publish rename failure stops restoring an existing destination unchanged', async t => {
  const { filesystem, root, session } = await fixture(t);
  await mkdir(path.join(root, 'output'));
  await writeFile(path.join(root, 'output', 'old.txt'), 'old output');
  const plan = ScaffoldPlan.empty().addFile('new.txt', 'new output');

  await assertCode(
    filesystem.applyPlanAtomically(session, plan, 'output', {
      replace: true,
      hooks: {
        beforePublishRename() {
          throw new Error('injected rename failure');
        }
      }
    }),
    'TRANSACTION_FAILED'
  );

  assert.equal(await readFile(path.join(root, 'output', 'old.txt'), 'utf8'), 'old output');
  await assert.rejects(lstat(path.join(root, 'output', 'new.txt')), { code: 'ENOENT' });
  await assertNoOwnedResidue(root);
});

test('break: an abort during a transaction starts leaving destination files or owned temp trees behind', async t => {
  const { filesystem, root, session } = await fixture(t);
  const controller = new AbortController();
  const plan = ScaffoldPlan.empty().addFile('one.txt', 'one').addFile('two.txt', 'two');

  await assertCode(
    filesystem.applyPlanAtomically(session, plan, 'aborted', {
      signal: controller.signal,
      hooks: {
        afterWrite({ file }) {
          if (file.path === 'one.txt') {
            controller.abort();
          }
        }
      }
    }),
    'INTERRUPTED'
  );

  await assert.rejects(lstat(path.join(root, 'aborted')), { code: 'ENOENT' });
  await assertNoOwnedResidue(root);
});

test('break: existing output collisions stop preserving the current output under default non-replacement behavior', async t => {
  const { filesystem, root, session } = await fixture(t);
  await mkdir(path.join(root, 'output'));
  await writeFile(path.join(root, 'output', 'keep.txt'), 'keep');
  const plan = ScaffoldPlan.empty().addFile('replacement.txt', 'replacement');

  await assertCode(filesystem.applyPlanAtomically(session, plan, 'output'), 'OUTPUT_EXISTS');

  assert.equal(await readFile(path.join(root, 'output', 'keep.txt'), 'utf8'), 'keep');
  await assert.rejects(lstat(path.join(root, 'output', 'replacement.txt')), { code: 'ENOENT' });
  await assertNoOwnedResidue(root);
});

test('break: explicit replacement stops retaining prior output until a complete staging tree has published', async t => {
  const { filesystem, root, session } = await fixture(t);
  await mkdir(path.join(root, 'output'));
  await writeFile(path.join(root, 'output', 'old.txt'), 'old');
  const plan = ScaffoldPlan.empty().addFile('new.txt', 'new');

  await filesystem.applyPlanAtomically(session, plan, 'output', { replace: true });

  assert.equal(await readFile(path.join(root, 'output', 'new.txt'), 'utf8'), 'new');
  await assert.rejects(lstat(path.join(root, 'output', 'old.txt')), { code: 'ENOENT' });
  await assertNoOwnedResidue(root);
});

test('break: a replacement target swap after capture stops moving a foreign directory into the backup', async t => {
  const { filesystem, root, session } = await fixture(t);
  const destination = path.join(root, 'output');
  const displacedA = path.join(root, 'displaced-a');
  const foreignB = path.join(root, 'foreign-b');
  await mkdir(destination);
  await writeFile(path.join(destination, 'captured-a.txt'), 'captured A');
  await mkdir(foreignB);
  await writeFile(path.join(foreignB, 'foreign-b.txt'), 'foreign B');
  const plan = ScaffoldPlan.empty().addFile('new.txt', 'new output');

  await assertCode(
    filesystem.applyPlanAtomically(session, plan, 'output', {
      replace: true,
      hooks: {
        async beforeBackupRename() {
          await rename(destination, displacedA);
          await rename(foreignB, destination);
        }
      }
    }),
    'PATH_CHANGED'
  );

  assert.equal(await readFile(path.join(destination, 'foreign-b.txt'), 'utf8'), 'foreign B');
  assert.equal(await readFile(path.join(displacedA, 'captured-a.txt'), 'utf8'), 'captured A');
  await assert.rejects(lstat(path.join(destination, 'new.txt')), { code: 'ENOENT' });
  await assertNoOwnedResidue(root);
});

test('break: transaction destinations stop rejecting literal traversal and Windows hostile path forms', async t => {
  const { filesystem, session } = await fixture(t);
  const plan = ScaffoldPlan.empty().addFile('index.js', 'export {};');
  const invalid = ['../escape', 'a/../escape', './output', 'a//b', '/tmp/out', String.raw`C:\out`, 'C:/out', String.raw`\\server\share`, String.raw`\\?\C:\out`, ''];

  for (const destination of invalid) {
    await assertCode(filesystem.applyPlanAtomically(session, plan, destination), 'PATH_INVALID');
  }
});

test('break: files with explicit safe modes stop publishing with the requested regular-file permissions', async t => {
  const { filesystem, root, session } = await fixture(t);
  const plan = ScaffoldPlan.empty().addFile('bin/tool.js', 'console.log(1);', { mode: 0o755 });

  await filesystem.applyPlanAtomically(session, plan, 'output');

  const entry = await lstat(path.join(root, 'output', 'bin', 'tool.js'));
  assert.equal(entry.mode & 0o777, 0o755);
  await assertNoOwnedResidue(root);
});

test('break: structural plan lookalikes stop writing forged file paths outside the workspace', async t => {
  const { filesystem, root, session } = await fixture(t);
  const escaped = path.join(path.dirname(root), `open-cells-academy-forged-${path.basename(root)}.txt`);
  t.after(async () => {
    await rm(escaped, { force: true });
  });
  const forged = { directories: [], files: [{ path: `../../${path.basename(escaped)}`, content: 'escaped' }] };

  await assertCode(filesystem.applyPlanAtomically(session, forged, 'output'), 'PLAN_INVALID');

  await assert.rejects(lstat(escaped), { code: 'ENOENT' });
  await assert.rejects(lstat(path.join(root, 'output')), { code: 'ENOENT' });
});

test('break: forged directory traversal declarations stop creating directories outside staging', async t => {
  const { filesystem, root, session } = await fixture(t);
  const escaped = path.join(path.dirname(root), `open-cells-academy-forged-dir-${path.basename(root)}`);
  t.after(async () => {
    await rm(escaped, { recursive: true, force: true });
  });
  const forged = { directories: [`../../${path.basename(escaped)}`], files: [{ path: 'index.js', content: 'export {};' }] };

  await assertCode(filesystem.applyPlanAtomically(session, forged, 'output'), 'PLAN_INVALID');

  await assert.rejects(lstat(escaped), { code: 'ENOENT' });
});

test('break: subclass getters stop injecting forged file declarations after a genuine ScaffoldPlan has initialized', async t => {
  const { filesystem, root, session } = await fixture(t);
  const escaped = path.join(path.dirname(root), `open-cells-academy-subclass-forged-${path.basename(root)}.txt`);
  t.after(async () => {
    await rm(escaped, { force: true });
  });
  class GetterForgingPlan extends ScaffoldPlan {
    get files() {
      return [{ path: `../../${path.basename(escaped)}`, content: 'escaped' }];
    }
  }
  const plan = new GetterForgingPlan().addFile('safe.txt', 'safe');

  await filesystem.applyPlanAtomically(session, plan, 'output');

  assert.equal(await readFile(path.join(root, 'output', 'safe.txt'), 'utf8'), 'safe');
  await assert.rejects(lstat(escaped), { code: 'ENOENT' });
});

test('break: invalid forged content and mode stop reaching staging writes', async t => {
  const { filesystem, root, session } = await fixture(t);
  const forged = { directories: [], files: [{ path: 'unsafe.txt', content: { not: 'bytes' }, mode: 0o4755 }] };
  let createdStaging = false;

  await assertCode(
    filesystem.applyPlanAtomically(session, forged, 'output', {
      hooks: { onStagingCreated() { createdStaging = true; } }
    }),
    'PLAN_INVALID'
  );

  assert.equal(createdStaging, false);
  await assert.rejects(lstat(path.join(root, 'output')), { code: 'ENOENT' });
});

test('break: drive-relative transaction destinations stop bypassing hostile Windows path rejection', async t => {
  const { filesystem, session } = await fixture(t);
  const plan = ScaffoldPlan.empty().addFile('index.js', 'export {};');

  for (const destination of ['C:x', 'z:folder/output', 'Q:']) {
    await assertCode(filesystem.applyPlanAtomically(session, plan, destination), 'PATH_INVALID');
  }
});

test('break: missing and non-directory destination parents stop leaking raw staging failures', async t => {
  const { filesystem, root, session } = await fixture(t);
  const plan = ScaffoldPlan.empty().addFile('index.js', 'export {};');
  await writeFile(path.join(root, 'not-a-directory'), 'file');

  await assertCode(filesystem.applyPlanAtomically(session, plan, 'missing-parent/output'), 'DESTINATION_PARENT_MISSING');
  await assertCode(filesystem.applyPlanAtomically(session, plan, 'not-a-directory/output'), 'DESTINATION_PARENT_INVALID');
});

test('break: existing canonical nested destination parents stop supporting atomic publication', async t => {
  const { filesystem, root, session } = await fixture(t);
  await mkdir(path.join(root, 'nested'));
  const plan = ScaffoldPlan.empty().addFile('index.js', 'export {};');

  await filesystem.applyPlanAtomically(session, plan, 'nested/output');

  assert.equal(await readFile(path.join(root, 'nested', 'output', 'index.js'), 'utf8'), 'export {};');
});

test('break: a parent symlink swap before publication stops being detected before an outside target can appear', async t => {
  const { filesystem, root, session } = await fixture(t);
  const outside = await mkdtemp(path.join(os.tmpdir(), 'open-cells-academy-parent-outside-'));
  const nested = path.join(root, 'nested');
  const displaced = path.join(root, 'nested-displaced');
  t.after(async () => {
    await rm(outside, { recursive: true, force: true });
  });
  await mkdir(nested);
  const plan = ScaffoldPlan.empty().addFile('index.js', 'export {};');

  await assertCode(
    filesystem.applyPlanAtomically(session, plan, 'nested/output', {
      hooks: {
        async beforePublish() {
          await rename(nested, displaced);
          await symlink(outside, nested, 'dir');
        }
      }
    }),
    'PATH_OUTSIDE_WORKSPACE'
  );

  await assert.rejects(lstat(path.join(outside, 'output')), { code: 'ENOENT' });
});

test('break: a same-path parent identity swap before publication stops being detected as changed', async t => {
  const { filesystem, root, session } = await fixture(t);
  const nested = path.join(root, 'nested');
  const displaced = path.join(root, 'nested-displaced');
  await mkdir(nested);
  const plan = ScaffoldPlan.empty().addFile('index.js', 'export {};');

  await assertCode(
    filesystem.applyPlanAtomically(session, plan, 'nested/output', {
      hooks: {
        async beforePublish() {
          await rename(nested, displaced);
          await mkdir(nested);
        }
      }
    }),
    'PATH_CHANGED'
  );

  await assert.rejects(lstat(path.join(nested, 'output')), { code: 'ENOENT' });
});

test('break: post-publication faults stop leaving replacement output instead of restoring the prior tree', async t => {
  const { filesystem, root, session } = await fixture(t);
  await mkdir(path.join(root, 'output'));
  await writeFile(path.join(root, 'output', 'old.txt'), 'old');
  const plan = ScaffoldPlan.empty().addFile('new.txt', 'new');

  await assertCode(
    filesystem.applyPlanAtomically(session, plan, 'output', {
      replace: true,
      hooks: { afterPublish() { throw new Error('post-publish failure'); } }
    }),
    'TRANSACTION_FAILED'
  );

  assert.equal(await readFile(path.join(root, 'output', 'old.txt'), 'utf8'), 'old');
  await assert.rejects(lstat(path.join(root, 'output', 'new.txt')), { code: 'ENOENT' });
});

test('break: post-publication aborts stop restoring the prior output and removing staged replacement data', async t => {
  const { filesystem, root, session } = await fixture(t);
  await mkdir(path.join(root, 'output'));
  await writeFile(path.join(root, 'output', 'old.txt'), 'old');
  const controller = new AbortController();
  const plan = ScaffoldPlan.empty().addFile('new.txt', 'new');

  await assertCode(
    filesystem.applyPlanAtomically(session, plan, 'output', {
      replace: true,
      signal: controller.signal,
      hooks: { afterPublish() { controller.abort(); } }
    }),
    'INTERRUPTED'
  );

  assert.equal(await readFile(path.join(root, 'output', 'old.txt'), 'utf8'), 'old');
  await assert.rejects(lstat(path.join(root, 'output', 'new.txt')), { code: 'ENOENT' });
});

test('break: failed rollback restore stops preserving the old backup and returning a typed fail-closed error', async t => {
  const { filesystem, root, session } = await fixture(t);
  await mkdir(path.join(root, 'output'));
  await writeFile(path.join(root, 'output', 'old.txt'), 'old');
  const plan = ScaffoldPlan.empty().addFile('new.txt', 'new');

  await assertCode(
    filesystem.applyPlanAtomically(session, plan, 'output', {
      replace: true,
      hooks: {
        afterPublish() { throw new Error('post-publish failure'); },
        beforeRollbackRestore() { throw new Error('restore failure'); }
      }
    }),
    'TRANSACTION_ROLLBACK_FAILED'
  );

  const retainedBackups = (await readdir(root)).filter(entry => entry.startsWith('.open-cells-academy-backup-'));
  assert.equal(retainedBackups.length, 1);
  assert.equal(await readFile(path.join(root, retainedBackups[0], 'previous', 'old.txt'), 'utf8'), 'old');
  assert.equal(await readFile(path.join(root, 'output', 'new.txt'), 'utf8'), 'new');
});

test('break: adversarial replacement of an owned staging path stops being recursively deleted by cleanup', async t => {
  const { filesystem, root, session } = await fixture(t);
  const plan = ScaffoldPlan.empty().addFile('index.js', 'export {};');
  let replacement;

  await assertCode(
    filesystem.applyPlanAtomically(session, plan, 'output', {
      hooks: {
        async afterWrite({ staging }) {
          const displaced = `${staging}-displaced`;
          await rename(staging, displaced);
          await mkdir(staging);
          await writeFile(path.join(staging, 'adversary.txt'), 'do not delete');
          replacement = staging;
          throw new Error('trigger cleanup');
        }
      }
    }),
    'TRANSACTION_CLEANUP_FAILED'
  );

  assert.equal(await readFile(path.join(replacement, 'adversary.txt'), 'utf8'), 'do not delete');
  await assert.rejects(lstat(path.join(root, 'output')), { code: 'ENOENT' });
});

test('break: a root replaced before the transaction stops publishing into a foreign root inode', async t => {
  const { filesystem, root, session } = await fixture(t);
  const displaced = `${root}-displaced`;
  t.after(async () => {
    await rm(displaced, { recursive: true, force: true });
  });
  const plan = ScaffoldPlan.empty().addFile('inner.txt', 'data');

  await rename(root, displaced);
  await mkdir(root);

  await assertCode(
    filesystem.applyPlanAtomically(session, plan, 'generated'),
    'PATH_CHANGED'
  );

  await assert.rejects(lstat(path.join(root, 'generated')), { code: 'ENOENT' });
});

test('break: a root replaced just before the publish rename stops publishing and fails closed as changed', async t => {
  const { filesystem, root, session } = await fixture(t);
  const displaced = `${root}-displaced`;
  t.after(async () => {
    await rm(root, { recursive: true, force: true });
    await rm(displaced, { recursive: true, force: true });
  });
  const plan = ScaffoldPlan.empty().addFile('inner.txt', 'data');

  await assertCode(
    filesystem.applyPlanAtomically(session, plan, 'generated', {
      hooks: {
        async beforePublishRename() {
          await rename(root, displaced);
          await mkdir(root);
        }
      }
    }),
    'PATH_CHANGED'
  );

  await assert.rejects(lstat(path.join(root, 'generated')), { code: 'ENOENT' });
  await assert.rejects(lstat(path.join(displaced, 'generated')), { code: 'ENOENT' });
});

test('break: a root turned into a symlink before the transaction stops opening the workspace anchor', async t => {
  const { filesystem, root, session } = await fixture(t);
  const displaced = `${root}-displaced`;
  const outside = await mkdtemp(path.join(os.tmpdir(), 'open-cells-academy-rootsym-outside-'));
  t.after(async () => {
    await rm(root, { recursive: true, force: true });
    await rm(displaced, { recursive: true, force: true });
    await rm(outside, { recursive: true, force: true });
  });
  const plan = ScaffoldPlan.empty().addFile('inner.txt', 'data');

  await rename(root, displaced);
  await symlink(outside, root, 'dir');

  await assertCode(
    filesystem.applyPlanAtomically(session, plan, 'generated'),
    'PATH_CHANGED'
  );

  await assert.rejects(lstat(path.join(outside, 'generated')), { code: 'ENOENT' });
});
