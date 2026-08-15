import assert from 'node:assert/strict';
import test from 'node:test';

import { ScaffoldPlan } from '../../src/domain/scaffold-plan.js';

function assertPlanError(callback, code = 'PLAN_CONFLICT') {
  assert.throws(callback, error => {
    assert.equal(error.code, code);
    return true;
  });
}

test('break: adding scaffold declarations stops returning frozen persistent plans without changing prior plans', () => {
  const empty = ScaffoldPlan.empty();
  const withDirectory = empty.addDirectory('src');
  const withFile = withDirectory.addFile('src/index.js', 'export const answer = 42;');
  const complete = withFile.addDependency('lit', '^3.0.0', 'runtime');

  assert.equal(Object.isFrozen(empty), true);
  assert.equal(Object.isFrozen(complete), true);
  assert.deepEqual(empty.directories, []);
  assert.deepEqual(empty.files, []);
  assert.deepEqual(empty.dependencies, []);
  assert.deepEqual(withDirectory.directories, ['src']);
  assert.deepEqual(withFile.files.map(file => [file.path, file.content]), [['src/index.js', 'export const answer = 42;']]);
  assert.deepEqual(complete.dependencies, [{ name: 'lit', version: '^3.0.0', kind: 'runtime' }]);
  assert.throws(() => {
    complete.directories.push('escape');
  }, TypeError);
});

test('break: byte file content stops being copied defensively across input and plan snapshots', () => {
  const source = new Uint8Array([1, 2, 3]);
  const plan = ScaffoldPlan.empty().addFile('assets/data.bin', source);
  source[0] = 9;
  const firstSnapshot = plan.files[0].content;
  firstSnapshot[1] = 8;

  assert.deepEqual([...plan.files[0].content], [1, 2, 3]);
  assert.notStrictEqual(plan.files[0].content, firstSnapshot);
});

test('break: duplicate declarations stop being idempotent while conflicting file directory and ancestor paths pass', () => {
  const base = ScaffoldPlan.empty().addDirectory('src').addFile('src/index.js', 'export {};');
  const repeated = base.addDirectory('src').addFile('src/index.js', 'export {};');

  assert.deepEqual(repeated.directories, ['src']);
  assert.deepEqual(repeated.files.map(file => file.path), ['src/index.js']);
  assertPlanError(() => base.addFile('src/index.js', 'different content'));
  assertPlanError(() => base.addDirectory('src/index.js'));
  assertPlanError(() => base.addFile('src', 'a file cannot replace a directory'));
  assertPlanError(() => ScaffoldPlan.empty().addFile('src', 'file').addFile('src/child.js', 'child'));
  assertPlanError(() => ScaffoldPlan.empty().addFile('src/child.js', 'child').addFile('src', 'file'));
});

test('break: logical plan paths stop using the strict relative path grammar', () => {
  const invalidPaths = [
    '../x',
    'a/../x',
    './x',
    'a//b',
    '/tmp/x',
    String.raw`C:\x`,
    'C:/x',
    String.raw`\\server\share`,
    String.raw`\\?\C:\x`,
    'nul\0byte',
    ''
  ];

  for (const invalidPath of invalidPaths) {
    assertPlanError(() => ScaffoldPlan.empty().addFile(invalidPath, 'content'), 'PATH_INVALID');
  }
});

test('break: dependency version and kind conflicts stop being rejected while identical declarations remain idempotent', () => {
  const plan = ScaffoldPlan.empty().addDependency('lit', '^3.0.0', 'runtime');
  const repeated = plan.addDependency('lit', '^3.0.0', 'runtime');

  assert.deepEqual(repeated.dependencies, [{ name: 'lit', version: '^3.0.0', kind: 'runtime' }]);
  assertPlanError(() => plan.addDependency('lit', '^4.0.0', 'runtime'));
  assertPlanError(() => plan.addDependency('lit', '^3.0.0', 'dev'));
  assertPlanError(() => ScaffoldPlan.empty().addDependency('lit', '^3.0.0', 'invalid-kind'), 'DEPENDENCY_INVALID');
});

test('break: plan merge stops producing deterministic immutable combined declarations', () => {
  const left = ScaffoldPlan.empty().addDirectory('src').addFile('src/index.js', 'export {};').addDependency('lit', '^3.0.0');
  const right = ScaffoldPlan.empty()
    .addDirectory('assets')
    .addFile('assets/theme.css', ':host {}')
    .addDependency('@open-cells/core', '^1.2.1', 'peer');
  const merged = left.merge(right);
  const idempotent = merged.merge(left);

  assert.deepEqual(merged.directories, ['assets', 'src']);
  assert.deepEqual(merged.files.map(file => file.path), ['assets/theme.css', 'src/index.js']);
  assert.deepEqual(merged.dependencies, [
    { name: '@open-cells/core', version: '^1.2.1', kind: 'peer' },
    { name: 'lit', version: '^3.0.0', kind: 'runtime' }
  ]);
  assert.deepEqual(idempotent.files, merged.files);
  assert.deepEqual(left.directories, ['src']);
  assertPlanError(() => left.merge(ScaffoldPlan.empty().addFile('src', 'conflict')));
});

test('break: unsafe mode declarations stop being rejected before a filesystem adapter can apply them', () => {
  assertPlanError(() => ScaffoldPlan.empty().addFile('bin/tool.js', 'console.log(1);', { mode: 0o4755 }), 'FILE_MODE_INVALID');
  const safe = ScaffoldPlan.empty().addFile('bin/tool.js', 'console.log(1);', { mode: 0o755 });

  assert.equal(safe.files[0].mode, 0o755);
});
