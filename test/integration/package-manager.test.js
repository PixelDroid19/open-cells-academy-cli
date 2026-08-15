import assert from 'node:assert/strict';
import { copyFile, lstat, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { NodeFilesystem } from '../../src/adapters/node/node-filesystem.js';
import { NodeProcessRunner } from '../../src/adapters/node/process-runner.js';
import { PublicPackageManager } from '../../src/adapters/node/public-package-manager.js';
import { installProject } from '../../src/application/shared/install-project.js';
import { WorkspaceSession, typedError } from '../../src/domain/workspace-session.js';

const packageRoot = path.resolve(import.meta.dirname, '../..');
const lifecycleFixture = path.join(packageRoot, 'test/fixtures/package-lifecycle.js');
const tempParent = path.join(os.tmpdir(), 'open-cells-academy');
const filesystem = new NodeFilesystem();

class RecordingRunner {
  requests = [];

  async run(request) {
    this.requests.push(request);
    return Object.freeze({ exitCode: 0, signal: null, stdout: '', stderr: '', durationMs: 1 });
  }
}

class ControlledRunner {
  requests = [];
  #run;

  constructor(run) {
    this.#run = run;
  }

  async run(request) {
    this.requests.push(request);
    return this.#run(request);
  }
}

async function makeRoot() {
  await mkdir(tempParent, { recursive: true, mode: 0o700 });
  return mkdtemp(path.join(tempParent, 'open-cells-academy-task-3-package-'));
}

async function createWorkspace(root, packageMetadata, { locks = {} } = {}) {
  const workspace = path.join(root, 'workspace');
  await mkdir(workspace, { recursive: true, mode: 0o700 });
  await writeFile(path.join(workspace, 'package.json'), `${JSON.stringify(packageMetadata, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
  for (const [name, content] of Object.entries(locks)) {
    await writeFile(path.join(workspace, name), content, { encoding: 'utf8', mode: 0o600 });
  }
  return WorkspaceSession.open(workspace, filesystem);
}

function packageMetadata(overrides = {}) {
  return {
    name: 'open-cells-academy-task-three-fixture',
    version: '1.0.0',
    private: true,
    ...overrides
  };
}

function manager(root, options = {}) {
  return new PublicPackageManager({
    processRunner: new NodeProcessRunner({ outputLimitBytes: 512_000, terminateGraceMs: 100 }),
    tempRoot: path.join(root, 'runtime'),
    cacheRoot: path.join(root, 'cache'),
    timeoutMs: 60_000,
    ...options
  });
}

function assertOnlyPublicRegistry(lockText) {
  const urls = lockText.match(/https:\/\/[^"\s]+/g) ?? [];
  assert.ok(urls.length > 0, 'expected at least one resolved public package URL');
  for (const url of urls) {
    assert.equal(new URL(url).host, 'registry.npmjs.org');
  }
}

test('selects npm install and public lock verification through an isolated public registry', async () => {
  const root = await makeRoot();

  try {
    const session = await createWorkspace(root, packageMetadata({ dependencies: { 'is-number': '7.0.0' } }));
    const packageManager = manager(root);

    const installed = await packageManager.install({ mode: 'install', allowScripts: false, offline: false }, session);
    assert.equal(installed.tool, 'npm');
    assert.equal(installed.mode, 'install');
    assert.equal(installed.result.exitCode, 0);

    const lockPath = path.join(session.root, 'package-lock.json');
    assertOnlyPublicRegistry(await readFile(lockPath, 'utf8'));

    const ciWorkspace = await createWorkspace(path.join(root, 'ci-no-dependencies'), packageMetadata(), {
      locks: { 'package-lock.json': JSON.stringify({ name: 'open-cells-academy-task-three-fixture', lockfileVersion: 3, packages: {} }) }
    });
    const ci = await packageManager.install({ mode: 'ci', allowScripts: false, offline: true }, ciWorkspace);
    assert.equal(ci.tool, 'npm');
    assert.equal(ci.mode, 'ci');
    assert.equal(ci.result.exitCode, 0);
    assert.deepEqual(await readdir(path.join(root, 'runtime')), []);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('suppresses lifecycle scripts by default and permits only the explicit allowScripts opt-in', async () => {
  const root = await makeRoot();

  try {
    const session = await createWorkspace(root, packageMetadata({ scripts: { postinstall: 'node lifecycle.js mark' } }));
    await copyFile(lifecycleFixture, path.join(session.root, 'lifecycle.js'));
    const packageManager = manager(root);

    await packageManager.install({ mode: 'install', allowScripts: false, offline: false }, session);
    await assert.rejects(readFile(path.join(session.root, 'lifecycle-ran.txt'), 'utf8'), error => error?.code === 'ENOENT');

    await packageManager.install({ mode: 'install', allowScripts: true, offline: false }, session);
    assert.equal(await readFile(path.join(session.root, 'lifecycle-ran.txt'), 'utf8'), 'ran\n');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('selects pnpm install and frozen CI only from matching metadata and lock state', async () => {
  const root = await makeRoot();

  try {
    const session = await createWorkspace(root, packageMetadata({ packageManager: 'pnpm@10.33.0' }));
    const packageManager = manager(root);
    const installed = await packageManager.install({ mode: 'install', allowScripts: false, offline: false }, session);
    assert.equal(installed.tool, 'pnpm');
    assert.equal(installed.result.exitCode, 0);

    const ci = await packageManager.install({ mode: 'ci', allowScripts: false, offline: true }, await WorkspaceSession.open(session.root, filesystem));
    assert.equal(ci.tool, 'pnpm');
    assert.equal(ci.mode, 'ci');
    assert.equal(ci.result.exitCode, 0);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('passes immutable public-manager arguments for offline and lifecycle policy rather than consulting ambient package config', async () => {
  const root = await makeRoot();

  try {
    const session = await createWorkspace(root, packageMetadata());
    const runner = new RecordingRunner();
    const packageManager = new PublicPackageManager({
      processRunner: runner,
      tempRoot: path.join(root, 'runtime'),
      cacheRoot: path.join(root, 'cache')
    });

    await packageManager.install({ mode: 'install', allowScripts: false, offline: true }, session);
    const [request] = runner.requests;
    assert.equal(request.file, 'npm');
    assert.deepEqual(request.args.slice(0, 2), ['install', '--ignore-scripts']);
    assert.ok(request.args.includes('--offline'));
    assert.ok(request.args.includes('--registry=https://registry.npmjs.org/'));
    assert.equal(request.env.NPM_CONFIG_REGISTRY, 'https://registry.npmjs.org/');
    assert.equal(Object.hasOwn(request.env, 'NPM_CONFIG_USERCONFIG'), true);
    assert.equal(Object.hasOwn(request.env, 'NPM_TOKEN'), false);
    assert.deepEqual(await readdir(path.join(root, 'runtime')), []);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('fails closed for malformed, conflicting, mismatched, and CI-without-lock package manager selection', async () => {
  const root = await makeRoot();

  try {
    const packageManager = manager(root);
    const malformed = await createWorkspace(root, packageMetadata(), { locks: { 'package-lock.json': '{' } });
    await assert.rejects(packageManager.install({ mode: 'install', allowScripts: false, offline: false }, malformed), error => error?.code === 'CONFIG_INVALID');

    const conflicting = await createWorkspace(path.join(root, 'conflicting'), packageMetadata(), {
      locks: { 'package-lock.json': '{}', 'pnpm-lock.yaml': "lockfileVersion: '9.0'\n" }
    });
    await assert.rejects(packageManager.install({ mode: 'install', allowScripts: false, offline: false }, conflicting), error => error?.code === 'LOCK_CONFLICT');

    const mismatched = await createWorkspace(path.join(root, 'mismatched'), packageMetadata({ packageManager: 'npm@11.0.0' }), {
      locks: { 'pnpm-lock.yaml': "lockfileVersion: '9.0'\n" }
    });
    await assert.rejects(packageManager.install({ mode: 'install', allowScripts: false, offline: false }, mismatched), error => error?.code === 'LOCK_MISMATCH');

    const noLock = await createWorkspace(path.join(root, 'no-lock'), packageMetadata());
    await assert.rejects(packageManager.install({ mode: 'ci', allowScripts: false, offline: false }, noLock), error => error?.code === 'LOCK_MISMATCH');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('retains child failure and missing pnpm as typed failures instead of returning a false install outcome', async () => {
  const root = await makeRoot();

  try {
    const failing = await createWorkspace(root, packageMetadata({ scripts: { postinstall: 'node lifecycle.js fail' } }));
    await copyFile(lifecycleFixture, path.join(failing.root, 'lifecycle.js'));
    const packageManager = manager(root);
    await assert.rejects(
      packageManager.install({ mode: 'install', allowScripts: true, offline: false }, failing),
      error => error?.code === 'TOOL_FAILED' && error.details?.result?.exitCode === 17
    );

    const missingPnpm = await createWorkspace(path.join(root, 'missing-pnpm'), packageMetadata({ packageManager: 'pnpm@10.33.0' }));
    await assert.rejects(
      manager(root, { tools: { npm: 'npm', pnpm: path.join(root, 'not-a-pnpm') } }).install(
        { mode: 'install', allowScripts: false, offline: false },
        missingPnpm
      ),
      error => error?.code === 'TOOL_MISSING'
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('maps package-manager typed results to immutable application outcomes without process or filesystem access', async () => {
  const root = await makeRoot();

  try {
    const session = await createWorkspace(root, packageMetadata());
    const success = await installProject(
      { mode: 'install', allowScripts: false, offline: false },
      {
        session,
        packageManager: {
          async install() {
            return Object.freeze({ tool: 'npm', mode: 'install', result: Object.freeze({ exitCode: 0 }) });
          }
        }
      }
    );
    assert.equal(success.ok, true);
    assert.equal(success.data.tool, 'npm');
    assert.equal(Object.isFrozen(success), true);

    const failure = await installProject(
      { mode: 'install', allowScripts: false, offline: false },
      {
        session,
        packageManager: {
          async install() {
            throw typedError('LOCK_CONFLICT');
          }
        }
      }
    );
    assert.equal(failure.ok, false);
    assert.equal(failure.code, 'LOCK_CONFLICT');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('rejects nonpublic npm and pnpm lock artifact locations before any process request', async () => {
  const root = await makeRoot();

  try {
    const cases = [
      {
        name: 'npm package resolved host',
        metadata: packageMetadata(),
        locks: {
          'package-lock.json': JSON.stringify({
            lockfileVersion: 3,
            packages: { 'node_modules/fixture': { resolved: 'https://invalid.example.test/fixture.tgz' } }
          })
        },
        code: 'PRIVATE_REGISTRY_FORBIDDEN'
      },
      {
        name: 'legacy npm dependency protocol relative artifact',
        metadata: packageMetadata(),
        locks: {
          'package-lock.json': JSON.stringify({
            lockfileVersion: 1,
            dependencies: { fixture: { resolved: '//registry.npmjs.org/fixture/-/fixture.tgz' } }
          })
        },
        code: 'PRIVATE_REGISTRY_FORBIDDEN'
      },
      {
        name: 'npm credentials in an otherwise public host',
        metadata: packageMetadata(),
        locks: {
          'package-lock.json': JSON.stringify({
            lockfileVersion: 3,
            packages: { fixture: { resolved: 'https://fixture:fixture@registry.npmjs.org/fixture.tgz' } }
          })
        },
        code: 'PRIVATE_REGISTRY_FORBIDDEN'
      },
      {
        name: 'pnpm inline tarball host',
        metadata: packageMetadata({ packageManager: 'pnpm@10.33.0' }),
        locks: {
          'pnpm-lock.yaml': "lockfileVersion: '9.0'\npackages:\n  fixture@1.0.0:\n    resolution: {tarball: https://invalid.example.test/fixture.tgz}\n"
        },
        code: 'PRIVATE_REGISTRY_FORBIDDEN'
      },
      {
        name: 'pnpm multiline Git artifact',
        metadata: packageMetadata({ packageManager: 'pnpm@10.33.0' }),
        locks: {
          'pnpm-lock.yaml': "lockfileVersion: '9.0'\npackages:\n  fixture@1.0.0:\n    resolution:\n      tarball: git+https://example.test/fixture.git\n"
        },
        code: 'PRIVATE_REGISTRY_FORBIDDEN'
      },
      {
        name: 'malformed artifact URL remains a configuration error',
        metadata: packageMetadata(),
        locks: {
          'package-lock.json': JSON.stringify({
            lockfileVersion: 3,
            packages: { fixture: { resolved: 'https://' } }
          })
        },
        code: 'CONFIG_INVALID'
      }
    ];

    for (const [index, fixture] of cases.entries()) {
      const session = await createWorkspace(path.join(root, `lock-${index}`), fixture.metadata, { locks: fixture.locks });
      const runner = new RecordingRunner();
      const packageManager = new PublicPackageManager({
        processRunner: runner,
        tempRoot: path.join(root, `runtime-${index}`),
        cacheRoot: path.join(root, `cache-${index}`)
      });

      await assert.rejects(
        packageManager.install({ mode: 'install', allowScripts: false, offline: false }, session),
        error => {
          assert.equal(error?.code, fixture.code, fixture.name);
          assert.equal(JSON.stringify(error?.details ?? {}).includes('example.test'), false);
          return true;
        }
      );
      assert.deepEqual(runner.requests, [], fixture.name);
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('rejects escaped pnpm source-bearing scalars before lock preflight can spawn a package manager', async () => {
  const root = await makeRoot();

  try {
    const cases = [
      {
        name: 'Unicode-escaped colon',
        source: 'tarball: "https\\u003a//private.example/fixture.tgz"'
      },
      {
        name: 'fully escaped URL separators',
        source: 'tarball: "https\\u003a\\u002f\\u002fprivate.example/fixture.tgz"'
      },
      {
        name: 'hex-escaped colon',
        source: 'resolved: "https\\x3a//private.example/fixture.tgz"'
      },
      {
        name: 'escaped scheme letter',
        source: 'resolution: "\\u0068ttps://private.example/fixture.tgz"'
      },
      {
        name: 'double-quoted line continuation',
        source: 'tarball: "https:\\\\' + '\n        //private.example/fixture.tgz"'
      }
    ];

    for (const [index, fixture] of cases.entries()) {
      const session = await createWorkspace(path.join(root, `escaped-${index}`), packageMetadata({ packageManager: 'pnpm@10.33.0' }), {
        locks: {
          'pnpm-lock.yaml': `lockfileVersion: '9.0'\npackages:\n  fixture@1.0.0:\n    ${fixture.source}\n`
        }
      });
      const runner = new RecordingRunner();
      const packageManager = new PublicPackageManager({
        processRunner: runner,
        tempRoot: path.join(root, `runtime-${index}`),
        cacheRoot: path.join(root, `cache-${index}`)
      });

      const failure = await packageManager.install({ mode: 'install', allowScripts: false, offline: true }, session).then(
        () => undefined,
        error => error
      );
      assert.equal(runner.requests.length, 0, fixture.name);
      assert.equal(failure?.code, 'CONFIG_INVALID', fixture.name);
      assert.equal(JSON.stringify(failure?.details ?? {}).includes('private.example'), false, fixture.name);
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('accepts ordinary generated pnpm public-registry lock scalars after escaped-source preflight', async () => {
  const root = await makeRoot();

  try {
    const session = await createWorkspace(root, packageMetadata({ packageManager: 'pnpm@10.33.0' }), {
      locks: {
        'pnpm-lock.yaml': [
          "lockfileVersion: '9.0'",
          'packages:',
          '  fixture@1.0.0:',
          '    resolution:',
          '      integrity: sha512-fixture',
          '      tarball: https://registry.npmjs.org/fixture/-/fixture-1.0.0.tgz',
          ''
        ].join('\n')
      }
    });
    const runner = new RecordingRunner();
    const packageManager = new PublicPackageManager({
      processRunner: runner,
      tempRoot: path.join(root, 'runtime'),
      cacheRoot: path.join(root, 'cache')
    });

    await packageManager.install({ mode: 'install', allowScripts: false, offline: true }, session);
    assert.equal(runner.requests.length, 1);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('rejects quoted and escaped pnpm source mapping keys before package-manager spawn', async () => {
  const root = await makeRoot();

  try {
    const escapedPrivateValue = '"https\\u003a\\u002f\\u002fprivate.example/pkg.tgz"';
    const cases = [
      {
        name: 'double-quoted tarball key',
        lock: `lockfileVersion: '9.0'\npackages:\n  fixture@1.0.0:\n    "tarball": ${escapedPrivateValue}\n`
      },
      {
        name: 'single-quoted resolved key',
        lock: `lockfileVersion: '9.0'\npackages:\n  fixture@1.0.0:\n    'resolved': ${escapedPrivateValue}\n`
      },
      {
        name: 'Unicode-escaped double-quoted tarball key',
        lock: `lockfileVersion: '9.0'\npackages:\n  fixture@1.0.0:\n    "tar\\u0062all": ${escapedPrivateValue}\n`
      },
      {
        name: 'flow mapping quoted tarball key',
        lock: `lockfileVersion: '9.0'\npackages: { fixture@1.0.0: { "tarball": ${escapedPrivateValue} } }\n`
      },
      {
        name: 'quoted resolution key with nested quoted tarball key',
        lock: `lockfileVersion: '9.0'\npackages:\n  fixture@1.0.0:\n    "resolution":\n      "tarball": ${escapedPrivateValue}\n`
      }
    ];

    for (const [index, fixture] of cases.entries()) {
      const session = await createWorkspace(path.join(root, `quoted-source-${index}`), packageMetadata({ packageManager: 'pnpm@10.33.0' }), {
        locks: { 'pnpm-lock.yaml': fixture.lock }
      });
      const runner = new RecordingRunner();
      const packageManager = new PublicPackageManager({
        processRunner: runner,
        tempRoot: path.join(root, `runtime-${index}`),
        cacheRoot: path.join(root, `cache-${index}`)
      });

      const failure = await packageManager.install({ mode: 'install', allowScripts: false, offline: true }, session).then(
        () => undefined,
        error => error
      );
      assert.equal(runner.requests.length, 0, fixture.name);
      assert.equal(failure?.code, 'CONFIG_INVALID', fixture.name);
      assert.equal(JSON.stringify(failure?.details ?? {}).includes('private.example'), false, fixture.name);
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('accepts fully canonicalized quoted pnpm public tarball mapping keys', async () => {
  const root = await makeRoot();

  try {
    const session = await createWorkspace(root, packageMetadata({ packageManager: 'pnpm@10.33.0' }), {
      locks: {
        'pnpm-lock.yaml': [
          "lockfileVersion: '9.0'",
          'packages:',
          '  fixture@1.0.0:',
          '    "tarball": "https://registry.npmjs.org/fixture/-/fixture-1.0.0.tgz"',
          ''
        ].join('\n')
      }
    });
    const runner = new RecordingRunner();
    const packageManager = new PublicPackageManager({
      processRunner: runner,
      tempRoot: path.join(root, 'runtime'),
      cacheRoot: path.join(root, 'cache')
    });

    await packageManager.install({ mode: 'install', allowScripts: false, offline: true }, session);
    assert.equal(runner.requests.length, 1);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('rejects an escaped pnpm tarball after a double quote in a plain scalar before package-manager spawn', async () => {
  const root = await makeRoot();

  try {
    const session = await createWorkspace(root, packageMetadata({ packageManager: 'pnpm@10.33.0' }), {
      locks: {
        'pnpm-lock.yaml': "lockfileVersion: '9.0'\npackages:\n  fixture@1.0.0:\n    harmless: abc\"\n    tarball: \"https\\u003a\\u002f\\u002fprivate.example/pkg.tgz\"\n"
      }
    });
    const runner = new RecordingRunner();
    const packageManager = new PublicPackageManager({
      processRunner: runner,
      tempRoot: path.join(root, 'runtime'),
      cacheRoot: path.join(root, 'cache')
    });

    const failure = await packageManager.install({ mode: 'install', allowScripts: false, offline: true }, session).then(
      () => undefined,
      error => error
    );
    assert.equal(runner.requests.length, 0);
    assert.equal(failure?.code, 'CONFIG_INVALID');
    assert.equal(JSON.stringify(failure?.details ?? {}).includes('private.example'), false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('treats quotes in plain pnpm scalars as non-quoting before later escaped source keys', async () => {
  const root = await makeRoot();

  try {
    const escapedPrivateTarball = '"https\\u003a\\u002f\\u002fprivate.example/pkg.tgz"';
    const cases = [
      {
        name: 'single quote in a block plain scalar',
        lock: `lockfileVersion: '9.0'\npackages:\n  fixture@1.0.0:\n    harmless: abc'\n    tarball: ${escapedPrivateTarball}\n`
      },
      {
        name: 'double quote in a flow plain scalar',
        lock: `lockfileVersion: '9.0'\npackages: { fixture@1.0.0: { harmless: abc\", tarball: ${escapedPrivateTarball} } }\n`
      }
    ];

    for (const [index, fixture] of cases.entries()) {
      const session = await createWorkspace(path.join(root, `plain-quote-${index}`), packageMetadata({ packageManager: 'pnpm@10.33.0' }), {
        locks: { 'pnpm-lock.yaml': fixture.lock }
      });
      const runner = new RecordingRunner();
      const packageManager = new PublicPackageManager({
        processRunner: runner,
        tempRoot: path.join(root, `runtime-${index}`),
        cacheRoot: path.join(root, `cache-${index}`)
      });

      const failure = await packageManager.install({ mode: 'install', allowScripts: false, offline: true }, session).then(
        () => undefined,
        error => error
      );
      assert.equal(failure?.code, 'CONFIG_INVALID', fixture.name);
      assert.equal(runner.requests.length, 0, fixture.name);
      assert.equal(JSON.stringify(failure?.details ?? {}).includes('private.example'), false, fixture.name);
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('accepts comments and correctly delimited quoted pnpm scalar values before public source keys', async () => {
  const root = await makeRoot();

  try {
    const publicTarball = 'https://registry.npmjs.org/fixture/-/fixture-1.0.0.tgz';
    const cases = [
      {
        name: 'comment with a double quote',
        lock: `lockfileVersion: '9.0'\npackages:\n  fixture@1.0.0:\n    # harmless: abc\"\n    tarball: ${publicTarball}\n`
      },
      {
        name: 'double-quoted harmless scalar',
        lock: `lockfileVersion: '9.0'\npackages:\n  fixture@1.0.0:\n    harmless: "abc'quoted'"\n    tarball: ${publicTarball}\n`
      },
      {
        name: 'single-quoted harmless scalar',
        lock: `lockfileVersion: '9.0'\npackages:\n  fixture@1.0.0:\n    harmless: 'abc"quoted"'\n    tarball: ${publicTarball}\n`
      },
      {
        name: 'flow mapping with a double-quoted harmless scalar',
        lock: `lockfileVersion: '9.0'\npackages: { fixture@1.0.0: { harmless: "abc'quoted'", tarball: ${publicTarball} } }\n`
      }
    ];

    for (const [index, fixture] of cases.entries()) {
      const session = await createWorkspace(path.join(root, `harmless-quote-${index}`), packageMetadata({ packageManager: 'pnpm@10.33.0' }), {
        locks: { 'pnpm-lock.yaml': fixture.lock }
      });
      const runner = new RecordingRunner();
      const packageManager = new PublicPackageManager({
        processRunner: runner,
        tempRoot: path.join(root, `runtime-${index}`),
        cacheRoot: path.join(root, `cache-${index}`)
      });

      await packageManager.install({ mode: 'install', allowScripts: false, offline: true }, session);
      assert.equal(runner.requests.length, 1, fixture.name);
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('rejects pnpm decorator and complex mapping keys before package-manager spawn', async () => {
  const root = await makeRoot();

  try {
    const escapedPrivateValue = '"https\\u003a\\u002f\\u002fprivate.example/pkg.tgz"';
    const cases = [
      {
        name: 'URI tag before tarball key',
        lock: `lockfileVersion: '9.0'\npackages:\n  fixture@1.0.0:\n    !<tag:yaml.org,2002:str> tarball: ${escapedPrivateValue}\n`
      },
      {
        name: 'secondary shorthand tag before tarball key',
        lock: `lockfileVersion: '9.0'\npackages:\n  fixture@1.0.0:\n    !!str tarball: ${escapedPrivateValue}\n`
      },
      {
        name: 'anchor before tarball key',
        lock: `lockfileVersion: '9.0'\npackages:\n  fixture@1.0.0:\n    &source tarball: ${escapedPrivateValue}\n`
      },
      {
        name: 'alias key after harmless anchor',
        lock: `lockfileVersion: '9.0'\npackages:\n  fixture@1.0.0:\n    harmless: &source safe\n    *source: ${escapedPrivateValue}\n`
      },
      {
        name: 'explicit complex tarball key',
        lock: `lockfileVersion: '9.0'\npackages:\n  fixture@1.0.0:\n    ? tarball\n    : ${escapedPrivateValue}\n`
      },
      {
        name: 'flow sequence complex tarball key',
        lock: `lockfileVersion: '9.0'\npackages: { [tarball]: ${escapedPrivateValue} }\n`
      }
    ];

    for (const [index, fixture] of cases.entries()) {
      const session = await createWorkspace(path.join(root, `decorator-source-${index}`), packageMetadata({ packageManager: 'pnpm@10.33.0' }), {
        locks: { 'pnpm-lock.yaml': fixture.lock }
      });
      const runner = new RecordingRunner();
      const packageManager = new PublicPackageManager({
        processRunner: runner,
        tempRoot: path.join(root, `runtime-${index}`),
        cacheRoot: path.join(root, `cache-${index}`)
      });

      const failure = await packageManager.install({ mode: 'install', allowScripts: false, offline: true }, session).then(
        () => undefined,
        error => error
      );
      assert.equal(runner.requests.length, 0, fixture.name);
      assert.equal(failure?.code, 'CONFIG_INVALID', fixture.name);
      assert.equal(JSON.stringify(failure?.details ?? {}).includes('private.example'), false, fixture.name);
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('rejects direct remote dependency specs before spawn while permitting semver npm aliases and safe local tarballs', async () => {
  const root = await makeRoot();

  try {
    const rejected = await createWorkspace(root, packageMetadata({
      dependencies: { fixture: 'git+ssh://example.test/fixture.git' }
    }));
    const rejectedRunner = new RecordingRunner();
    const rejectedManager = new PublicPackageManager({
      processRunner: rejectedRunner,
      tempRoot: path.join(root, 'runtime-rejected'),
      cacheRoot: path.join(root, 'cache-rejected')
    });
    await assert.rejects(
      rejectedManager.install({ mode: 'install', allowScripts: false, offline: false }, rejected),
      error => error?.code === 'PRIVATE_REGISTRY_FORBIDDEN' && JSON.stringify(error.details ?? {}).includes('example.test') === false
    );
    assert.deepEqual(rejectedRunner.requests, []);

    const accepted = await createWorkspace(path.join(root, 'accepted'), packageMetadata({
      dependencies: {
        semver: '^1.2.3',
        alias: 'npm:semver@^1.2.3',
        localCli: 'file:tools/open-cells-academy.tgz'
      }
    }));
    const acceptedRunner = new RecordingRunner();
    const acceptedManager = new PublicPackageManager({
      processRunner: acceptedRunner,
      tempRoot: path.join(root, 'runtime-accepted'),
      cacheRoot: path.join(root, 'cache-accepted')
    });
    await acceptedManager.install({ mode: 'install', allowScripts: false, offline: true }, accepted);
    assert.equal(acceptedRunner.requests.length, 1);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('uses collision-free operation-owned runtime cache and store directories and removes all owned children', async () => {
  const root = await makeRoot();

  try {
    const first = await createWorkspace(path.join(root, 'first'), packageMetadata());
    const second = await createWorkspace(path.join(root, 'second'), packageMetadata());
    let release;
    const gate = new Promise(resolve => {
      release = resolve;
    });
    const runner = new ControlledRunner(async () => {
      await gate;
      return Object.freeze({ exitCode: 0, signal: null, stdout: '', stderr: '', durationMs: 1 });
    });
    const runtimeRoot = path.join(root, 'runtime');
    const cacheRoot = path.join(root, 'cache');
    const packageManager = new PublicPackageManager({ processRunner: runner, tempRoot: runtimeRoot, cacheRoot });
    const pending = [
      packageManager.install({ mode: 'install', allowScripts: false, offline: true }, first),
      packageManager.install({ mode: 'install', allowScripts: false, offline: true }, second)
    ];
    while (runner.requests.length !== 2) {
      await new Promise(resolve => setTimeout(resolve, 1));
    }
    assert.notEqual(runner.requests[0].env.NPM_CONFIG_CACHE, runner.requests[1].env.NPM_CONFIG_CACHE);
    assert.notEqual(runner.requests[0].env.PNPM_STORE_DIR, runner.requests[1].env.PNPM_STORE_DIR);
    assert.notEqual(runner.requests[0].env.HOME, runner.requests[1].env.HOME);
    release();
    await Promise.all(pending);
    assert.deepEqual(await readdir(runtimeRoot), []);
    assert.deepEqual(await readdir(cacheRoot), []);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('surfaces owned cache tampering as cleanup failure with both operation and cleanup causes', async () => {
  const root = await makeRoot();

  try {
    const session = await createWorkspace(root, packageMetadata());
    const runtimeRoot = path.join(root, 'runtime');
    const cacheRoot = path.join(root, 'cache');
    let replacedCache;
    const runner = new ControlledRunner(async request => {
      replacedCache = request.env.NPM_CONFIG_CACHE;
      await rm(replacedCache, { recursive: true, force: true });
      await mkdir(replacedCache, { recursive: true, mode: 0o700 });
      throw typedError('TOOL_MISSING');
    });
    const packageManager = new PublicPackageManager({ processRunner: runner, tempRoot: runtimeRoot, cacheRoot });

    await assert.rejects(
      packageManager.install({ mode: 'install', allowScripts: false, offline: true }, session),
      error => {
        assert.equal(error?.code, 'TOOL_FAILED');
        assert.equal(error?.details?.reason, 'TEMP_CLEANUP_FAILED');
        assert.ok(error.cause instanceof AggregateError);
        assert.ok(error.cause.errors.some(cause => cause?.code === 'TOOL_MISSING'));
        return true;
      }
    );
    const cacheOperation = path.dirname(replacedCache);
    assert.equal((await lstat(cacheOperation)).isDirectory(), true);
    await rm(cacheOperation, { recursive: true, force: true });
    assert.deepEqual(await readdir(runtimeRoot), []);
    assert.deepEqual(await readdir(cacheRoot), []);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
