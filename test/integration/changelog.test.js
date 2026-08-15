import assert from 'node:assert/strict';
import { lstat, mkdir, mkdtemp, readFile, readdir, rename, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { AtomicTextDocuments } from '../../src/adapters/node/atomic-text-documents.js';
import { GitAdapter } from '../../src/adapters/node/git-adapter.js';
import { NodeFilesystem } from '../../src/adapters/node/node-filesystem.js';
import { NodeProcessRunner } from '../../src/adapters/node/process-runner.js';
import { generateChangelog } from '../../src/application/shared/generate-changelog.js';
import { WorkspaceSession, typedError } from '../../src/domain/workspace-session.js';

const tempParent = path.join(os.tmpdir(), 'open-cells-academy');
const filesystem = new NodeFilesystem();

async function makeRoot() {
  await mkdir(tempParent, { recursive: true, mode: 0o700 });
  return mkdtemp(path.join(tempParent, 'open-cells-academy-task-3-changelog-'));
}

async function createWorkspace(root, name = 'workspace') {
  const workspace = path.join(root, name);
  await mkdir(workspace, { recursive: true, mode: 0o700 });
  await writeFile(
    path.join(workspace, 'package.json'),
    '{"name":"open-cells-academy-task-three-changelog","version":"1.0.0","private":true}\n',
    { encoding: 'utf8', mode: 0o600 }
  );
  return WorkspaceSession.open(workspace, filesystem);
}

function fixtureEnvironment(root) {
  return {
    PATH: process.env.PATH ?? '/usr/local/bin:/usr/bin:/bin',
    HOME: path.join(root, 'home'),
    GIT_CONFIG_NOSYSTEM: '1'
  };
}

async function git(runner, root, args) {
  const result = await runner.run({
    file: 'git',
    args,
    cwd: root,
    env: fixtureEnvironment(root)
  });
  assert.equal(result.exitCode, 0, result.stderr);
  return result;
}

async function initializeRepository(runner, session) {
  await mkdir(path.join(session.root, 'home'), { recursive: true, mode: 0o700 });
  await git(runner, session.root, ['init', '--quiet', '--initial-branch=main']);
}

async function commit(runner, session, filename, contents, subject, body = undefined) {
  await writeFile(path.join(session.root, filename), contents, { encoding: 'utf8', mode: 0o600 });
  await git(runner, session.root, ['add', '--', filename]);
  const args = ['-c', 'user.name=Academy Fixture', '-c', 'user.email=academy-fixture@example.test', 'commit', '--quiet', '-m', subject];
  if (body !== undefined) {
    args.push('-m', body);
  }
  await git(runner, session.root, args);
}

function context(session, { gitAdapter, documents, clock = () => new Date('2026-08-12T14:00:00.000Z') } = {}) {
  return {
    session,
    git: gitAdapter,
    documents,
    clock
  };
}

test('reads structured newest-first Git commits and produces a deterministic escaped changelog append with breaking and other sections', async () => {
  const root = await makeRoot();
  const runner = new NodeProcessRunner();

  try {
    const session = await createWorkspace(root);
    await initializeRepository(runner, session);
    await commit(runner, session, 'feature.txt', 'feature\n', 'feat(core)!: add [public] API', 'BREAKING CHANGE: remove old [API]');
    await commit(runner, session, 'bug.txt', 'bug\n', 'fix: resolve issue');
    await commit(runner, session, 'other.txt', 'other\n', 'docs: explain (usage)');

    const gitAdapter = new GitAdapter({ processRunner: runner });
    const documents = new AtomicTextDocuments();
    const commits = await gitAdapter.readConventionalCommits(session);
    assert.equal(commits.length, 3);
    assert.equal(commits[0].subject, 'docs: explain (usage)');
    assert.equal(commits[2].body, 'BREAKING CHANGE: remove old [API]\n');
    assert.equal(Object.isFrozen(commits), true);
    assert.equal(Object.isFrozen(commits[0]), true);

    await documents.writeAtomically(session, 'CHANGELOG.md', 'Existing bytes\n', { replace: false });
    const outcome = await generateChangelog(
      { preset: 'angular', full: false, name: 'CHANGELOG.md' },
      context(session, { gitAdapter, documents })
    );

    assert.equal(outcome.ok, true);
    const rendered = await documents.read(session, 'CHANGELOG.md');
    assert.match(rendered, /^Existing bytes\n\n## 2026-08-12\n<!-- open-cells-academy: preset=angular -->\n\n/m);
    assert.match(rendered, /### Features\n- add \\\[public\\\] API \([0-9a-f]{7,}\)/);
    assert.match(rendered, /### Bug Fixes\n- resolve issue \([0-9a-f]{7,}\)/);
    assert.match(rendered, /### Breaking Changes\n- add \\\[public\\\] API \([0-9a-f]{7,}\)\n- remove old \\\[API\\\] \([0-9a-f]{7,}\)/);
    assert.match(rendered, /### Other Changes\n- docs: explain \\\(usage\\\) \([0-9a-f]{7,}\)/);
    assert.equal(Object.isFrozen(outcome), true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('replaces a requested custom document atomically for full changelog output while preserving a preexisting parent', async () => {
  const root = await makeRoot();
  const runner = new NodeProcessRunner();

  try {
    const session = await createWorkspace(root);
    await initializeRepository(runner, session);
    await commit(runner, session, 'feature.txt', 'feature\n', 'feat: create release');
    await mkdir(path.join(session.root, 'docs'), { mode: 0o700 });
    const documents = new AtomicTextDocuments();
    await documents.writeAtomically(session, 'docs/RELEASE.md', 'obsolete', { replace: false });

    const outcome = await generateChangelog(
      { preset: 'conventionalcommits', full: true, name: 'docs/RELEASE.md' },
      context(session, { gitAdapter: new GitAdapter({ processRunner: runner }), documents })
    );
    assert.equal(outcome.ok, true);
    const rendered = await documents.read(session, 'docs/RELEASE.md');
    assert.equal(rendered.includes('obsolete'), false);
    assert.match(rendered, /preset=conventionalcommits/);
    assert.match(rendered, /create release/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('reports invalid preset, non-repository, zero commits, and missing Git without a false changelog success', async () => {
  const root = await makeRoot();
  const runner = new NodeProcessRunner();

  try {
    const session = await createWorkspace(root);
    const documents = new AtomicTextDocuments();
    const gitAdapter = new GitAdapter({ processRunner: runner });

    const invalid = await generateChangelog({ preset: 'unknown', full: false, name: 'CHANGELOG.md' }, context(session, { gitAdapter, documents }));
    assert.deepEqual({ ok: invalid.ok, code: invalid.code }, { ok: false, code: 'INVALID_INPUT' });

    const outside = await generateChangelog({ preset: 'angular', full: false, name: 'CHANGELOG.md' }, context(session, { gitAdapter, documents }));
    assert.deepEqual({ ok: outside.ok, code: outside.code }, { ok: false, code: 'GIT_REPOSITORY_REQUIRED' });

    await initializeRepository(runner, session);
    const empty = await generateChangelog({ preset: 'angular', full: false, name: 'CHANGELOG.md' }, context(session, { gitAdapter, documents }));
    assert.deepEqual({ ok: empty.ok, code: empty.code }, { ok: false, code: 'NO_COMMITS' });

    const missing = await generateChangelog(
      { preset: 'angular', full: false, name: 'CHANGELOG.md' },
      context(session, {
        gitAdapter: new GitAdapter({ processRunner: { async run() { throw typedError('TOOL_MISSING'); } } }),
        documents
      })
    );
    assert.deepEqual({ ok: missing.ok, code: missing.code }, { ok: false, code: 'TOOL_MISSING' });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('rejects a nested package workspace instead of reading commits from a parent Git worktree', async () => {
  const root = await makeRoot();
  const runner = new NodeProcessRunner();

  try {
    const repository = await createWorkspace(root, 'repository');
    await initializeRepository(runner, repository);
    await commit(runner, repository, 'feature.txt', 'feature\n', 'feat: parent history');
    const nestedRoot = path.join(repository.root, 'nested');
    await mkdir(nestedRoot, { mode: 0o700 });
    await writeFile(path.join(nestedRoot, 'package.json'), '{"name":"nested","version":"1.0.0","private":true}\n', {
      encoding: 'utf8',
      mode: 0o600
    });
    const nested = await WorkspaceSession.open(nestedRoot, filesystem);

    await assert.rejects(
      new GitAdapter({ processRunner: runner }).inspectRepository(nested),
      error => error?.code === 'GIT_REPOSITORY_REQUIRED'
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('rejects malformed structured Git output rather than guessing at a changelog record boundary', async () => {
  const root = await makeRoot();

  try {
    const session = await createWorkspace(root);
    const responses = [
      Object.freeze({ exitCode: 0, signal: null, stdout: 'true\n', stderr: '', durationMs: 1 }),
      Object.freeze({ exitCode: 0, signal: null, stdout: `${session.root}\n`, stderr: '', durationMs: 1 }),
      Object.freeze({ exitCode: 0, signal: null, stdout: '0123456789012345678901234567890123456789\n', stderr: '', durationMs: 1 }),
      Object.freeze({ exitCode: 0, signal: null, stdout: '1\n', stderr: '', durationMs: 1 }),
      Object.freeze({ exitCode: 0, signal: null, stdout: 'broken record', stderr: '', durationMs: 1 })
    ];
    const gitAdapter = new GitAdapter({
      processRunner: {
        async run() {
          return responses.shift();
        }
      }
    });
    await assert.rejects(gitAdapter.readConventionalCommits(session), error => error?.code === 'TOOL_FAILED');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('rejects document path escapes, output substitution, injected failure, and abort without publishing a partial file or residue', async () => {
  const root = await makeRoot();

  try {
    const session = await createWorkspace(root);
    const documents = new AtomicTextDocuments();
    await mkdir(path.join(session.root, 'docs'), { mode: 0o700 });
    await documents.writeAtomically(session, 'docs/CHANGELOG.md', 'original', { replace: false });

    for (const unsafe of ['../CHANGELOG.md', '/tmp/CHANGELOG.md', 'C:\\CHANGELOG.md', 'bad\u0000name']) {
      await assert.rejects(documents.writeAtomically(session, unsafe, 'x', { replace: false }), error => error?.code === 'PATH_INVALID');
    }
    await mkdir(path.join(root, 'outside'), { mode: 0o700 });
    await symlink(path.join(root, 'outside'), path.join(session.root, 'escape'));
    await assert.rejects(documents.writeAtomically(session, 'escape/CHANGELOG.md', 'x', { replace: false }), error => error?.code === 'PATH_OUTSIDE_WORKSPACE');

    await assert.rejects(
      documents.writeAtomically(session, 'docs/CHANGELOG.md', 'replacement', {
        replace: true,
        hooks: {
          async beforeRename() {
            await rm(path.join(session.root, 'docs/CHANGELOG.md'));
            await writeFile(path.join(session.root, 'docs/CHANGELOG.md'), 'substituted', { encoding: 'utf8', mode: 0o600 });
          }
        }
      }),
      error => error?.code === 'PATH_CHANGED'
    );
    assert.equal(await documents.read(session, 'docs/CHANGELOG.md'), 'substituted');

    await assert.rejects(
      documents.writeAtomically(session, 'docs/failure.md', 'never-published', {
        replace: false,
        hooks: {
          async beforeWrite() {
            throw new Error('injected write failure');
          }
        }
      }),
      error => error?.code === 'DOCUMENT_WRITE_FAILED'
    );
    await assert.rejects(documents.read(session, 'docs/failure.md'), error => error?.code === 'PATH_NOT_FOUND');

    const controller = new AbortController();
    await assert.rejects(
      documents.writeAtomically(session, 'docs/aborted.md', 'never-published', {
        replace: false,
        signal: controller.signal,
        hooks: {
          beforeRename() {
            controller.abort();
          }
        }
      }),
      error => error?.code === 'INTERRUPTED'
    );
    await assert.rejects(documents.read(session, 'docs/aborted.md'), error => error?.code === 'PATH_NOT_FOUND');

    const residues = (await readdir(path.join(session.root, 'docs'))).filter(name => name.includes('.open-cells-academy-'));
    assert.deepEqual(residues, []);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('rejects a substituted owned temporary file after beforeRename without publishing foreign bytes', async () => {
  const root = await makeRoot();

  try {
    const session = await createWorkspace(root);
    const documents = new AtomicTextDocuments();
    await mkdir(path.join(session.root, 'docs'), { mode: 0o700 });
    await assert.rejects(
      documents.writeAtomically(session, 'docs/CHANGELOG.md', 'academy-bytes', {
        replace: false,
        hooks: {
          async beforeRename({ temporary }) {
            await rm(temporary);
            await writeFile(temporary, 'foreign-bytes', { encoding: 'utf8', mode: 0o600 });
          }
        }
      }),
      error => error?.code === 'PATH_CHANGED'
    );
    await assert.rejects(documents.read(session, 'docs/CHANGELOG.md'), error => error?.code === 'PATH_NOT_FOUND');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('retains a file close failure, avoids publication, and cleans only its exact owned temporary file', async () => {
  const root = await makeRoot();

  try {
    const session = await createWorkspace(root);
    const documents = new AtomicTextDocuments({
      io: {
        async open(...args) {
          const real = await (await import('node:fs/promises')).open(...args);
          return {
            writeFile: (...writeArgs) => real.writeFile(...writeArgs),
            sync: () => real.sync(),
            async close() {
              await real.close();
              throw new Error('injected close failure');
            }
          };
        }
      }
    });
    await mkdir(path.join(session.root, 'docs'), { mode: 0o700 });
    await assert.rejects(
      documents.writeAtomically(session, 'docs/close.md', 'never-published', { replace: false }),
      error => error?.code === 'DOCUMENT_WRITE_FAILED' && error.cause?.message === 'injected close failure'
    );
    await assert.rejects(documents.read(session, 'docs/close.md'), error => error?.code === 'PATH_NOT_FOUND');
    assert.deepEqual((await readdir(path.join(session.root, 'docs'))).filter(name => name.includes('.open-cells-academy-')), []);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('returns immutable content and byte-bound version from a stable document read', async () => {
  const root = await makeRoot();

  try {
    const session = await createWorkspace(root);
    const documents = new AtomicTextDocuments();
    await documents.writeAtomically(session, 'CHANGELOG.md', 'base', { replace: false });
    const versioned = await documents.readVersioned(session, 'CHANGELOG.md');
    assert.equal(versioned.content, 'base');
    assert.equal(typeof versioned.version.digest, 'string');
    assert.equal(Object.isFrozen(versioned), true);
    assert.equal(Object.isFrozen(versioned.version), true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('append changelog CAS preserves external replacement, same-inode edits, and missing-file appearances after versioned read', async () => {
  const root = await makeRoot();

  try {
    const session = await createWorkspace(root);
    const runner = new NodeProcessRunner();
    await initializeRepository(runner, session);
    await commit(runner, session, 'feature.txt', 'feature\n', 'feat: append safely');
    await mkdir(path.join(session.root, 'docs'), { mode: 0o700 });
    const documents = new AtomicTextDocuments();
    const gitAdapter = new GitAdapter({ processRunner: runner });
    const cases = [
      {
        name: 'replacement',
        initial: 'base',
        mutate: async target => {
          await rm(target);
          await writeFile(target, 'external replacement', { encoding: 'utf8', mode: 0o600 });
        },
        expected: 'external replacement'
      },
      {
        name: 'same inode edit',
        initial: 'base',
        mutate: target => writeFile(target, 'external same inode edit', { encoding: 'utf8', mode: 0o600 }),
        expected: 'external same inode edit'
      },
      {
        name: 'missing appearance',
        initial: undefined,
        mutate: target => writeFile(target, 'external new document', { encoding: 'utf8', mode: 0o600 }),
        expected: 'external new document'
      }
    ];
    for (const fixture of cases) {
      const name = `docs/${fixture.name}.md`;
      const target = path.join(session.root, name);
      if (fixture.initial !== undefined) {
        await documents.writeAtomically(session, name, fixture.initial, { replace: false });
      }
      const interleavingDocuments = {
        readVersioned: async (...args) => documents.readVersioned(...args),
        writeAtomically: async (workspace, relative, content, options) => {
          await fixture.mutate(path.join(workspace.root, relative));
          return documents.writeAtomically(workspace, relative, content, options);
        }
      };
      const outcome = await generateChangelog(
        { preset: 'angular', full: false, name },
        context(session, { gitAdapter, documents: interleavingDocuments })
      );
      assert.deepEqual({ ok: outcome.ok, code: outcome.code }, { ok: false, code: 'PATH_CHANGED' });
      assert.equal(await documents.read(session, name), fixture.expected);
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
