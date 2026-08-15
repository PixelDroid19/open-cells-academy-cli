import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { SassCompiler } from '../../src/adapters/sass/sass-compiler.js';
import { NodeFilesystem } from '../../src/adapters/node/node-filesystem.js';
import { compileSass } from '../../src/application/component/compile-sass.js';
import { ScaffoldPlan } from '../../src/domain/scaffold-plan.js';
import { WorkspaceSession, typedError } from '../../src/domain/workspace-session.js';

const fixtureDirectory = path.join(import.meta.dirname, '../fixtures/task-7-sass');

class AtomicPublisher {
  calls = 0;
  files;
  #fail;

  constructor({ files = {}, fail = false } = {}) {
    this.files = new Map(Object.entries(files));
    this.#fail = fail;
  }

  async publish(session, plan) {
    this.calls += 1;
    const staged = new Map(this.files);
    for (const file of ScaffoldPlan.snapshot(plan).files) {
      staged.set(file.path, typeof file.content === 'string' ? file.content : Buffer.from(file.content).toString('utf8'));
    }
    if (this.#fail) {
      throw typedError('PUBLISH_FAILED');
    }
    this.files = staged;
    return Object.freeze({ session: session.root, fileCount: staged.size });
  }
}

function compilerWith({ cssFor = input => `.compiled-${input.replaceAll('/', '-')}{}`, failureFor = undefined, events = [] } = {}) {
  const publicApi = {
    async compileStringAsync(source, options) {
      const input = new URL(options.url).pathname;
      events.push(Object.freeze({ method: 'compileStringAsync', source, input, loadPaths: options.loadPaths }));
      if (failureFor !== undefined && failureFor(input)) {
        throw new Error('fixture-sass-source-secret');
      }
      options.logger.warn(`warn:${path.basename(input)}`);
      options.logger.debug(`debug:${path.basename(input)}`);
      return Object.freeze({ css: cssFor(input, source) });
    }
  };
  return new SassCompiler(publicApi);
}

async function workspace(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'open-cells-academy-sass-'));
  t.after(async () => {
    await rm(root, { recursive: true, force: true });
  });
  await writeFile(path.join(root, 'package.json'), '{"name":"sass-fixture","private":true}\n');
  const filesystem = new NodeFilesystem();
  const session = await WorkspaceSession.open(root, filesystem);
  return { filesystem, root, session };
}

async function copyFixture(root, relativePath, fixtureName) {
  const target = path.join(root, relativePath);
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, await readFile(path.join(fixtureDirectory, fixtureName), 'utf8'));
}

async function writeWorkspaceFile(root, relativePath, content) {
  const target = path.join(root, relativePath);
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, content);
}

function context(session, filesystem, compiler, overrides = {}) {
  return Object.freeze({ session, filesystem, compiler, ...overrides });
}

function filesIn(plan) {
  return Object.fromEntries(ScaffoldPlan.snapshot(plan).files.map(file => [file.path, typeof file.content === 'string' ? file.content : Buffer.from(file.content).toString('utf8')]));
}

function outputTemplate(content) {
  const start = content.indexOf('export default css`');
  return content.slice(start + 'export default css`'.length, -3);
}

function isEscaped(value, index) {
  let backslashes = 0;
  for (let cursor = index - 1; cursor >= 0 && value[cursor] === '\\'; cursor -= 1) {
    backslashes += 1;
  }
  return backslashes % 2 === 1;
}

function assertNoTemplateInjection(value) {
  for (let index = 0; index < value.length; index += 1) {
    if (value[index] === '`') {
      assert.equal(isEscaped(value, index), true);
    }
    if (value[index] === '$' && value[index + 1] === '{') {
      assert.equal(isEscaped(value, index), true);
    }
  }
}

async function assertCode(promise, code) {
  await assert.rejects(promise, error => {
    assert.equal(error?.code, code);
    return true;
  });
}

test('break: Sass discovers sorted root, src, app elements, and app styles entries while skipping partials and node_modules', async t => {
  const { filesystem, root, session } = await workspace(t);
  await copyFixture(root, 'root.scss', 'root.scss');
  await copyFixture(root, '_root.scss', '_partial.scss');
  await copyFixture(root, 'src/zeta.scss', 'component.scss');
  await copyFixture(root, 'src/nested/alpha.scss', 'component.scss');
  await copyFixture(root, 'src/_partial.scss', '_partial.scss');
  await copyFixture(root, 'app/elements/card.scss', 'component.scss');
  await copyFixture(root, 'app/elements/_card.scss', '_partial.scss');
  await copyFixture(root, 'app/styles/theme.scss', 'theme.scss');
  await copyFixture(root, 'node_modules/ignored.scss', 'component.scss');
  const events = [];
  const plan = await compileSass(context(session, filesystem, compilerWith({ events })));

  assert.deepEqual(events.map(event => path.relative(root, event.input)), [
    'app/elements/card.scss',
    'app/styles/theme.scss',
    'root.scss',
    'src/nested/alpha.scss',
    'src/zeta.scss'
  ]);
  assert.deepEqual(Object.keys(filesIn(plan)), [
    'app/elements/card.css.js',
    'app/styles/theme.css',
    'root.css.js',
    'src/nested/alpha.css.js',
    'src/zeta.css.js'
  ]);
  assert.equal(Object.isFrozen(plan), true);
});

test('break: Sass maps app styles to css and replaces css.js or safe styles.js output deterministically', async t => {
  const { filesystem, root, session } = await workspace(t);
  await copyFixture(root, 'app/styles/theme.scss', 'theme.scss');
  await copyFixture(root, 'src/card.scss', 'component.scss');
  await copyFixture(root, 'root.scss', 'root.scss');
  await writeWorkspaceFile(root, 'src/card.styles.js', "import { css } from 'lit';\n\nexport default css`old`;\n");
  await writeWorkspaceFile(root, 'root.css.js', "import { css } from 'lit';\n\nexport default css`old`;\n");
  const plan = await compileSass(context(session, filesystem, compilerWith({ cssFor: input => `.${path.basename(input, '.scss')}{color:purple}` })));

  assert.deepEqual(filesIn(plan), {
    'app/styles/theme.css': '.theme{color:purple}',
    'root.css.js': "import { css } from 'lit';\n\nexport default css`.root{color:purple}`;\n",
    'src/card.styles.js': "import { css } from 'lit';\n\nexport default css`.card{color:purple}`;\n"
  });
});

test('break: Sass escapes compiled CSS so it cannot terminate a Lit template or interpolate JavaScript', async t => {
  const { filesystem, root, session } = await workspace(t);
  await copyFixture(root, 'root.scss', 'root.scss');
  const css = 'a { content: "\\` ${danger}"; }';
  const plan = await compileSass(context(session, filesystem, compilerWith({ cssFor: () => css })));
  const output = filesIn(plan)['root.css.js'];

  assert.match(output, /^import \{ css \} from 'lit';\n\nexport default css`/);
  assert.equal(output.endsWith('`;\n'), true);
  assert.equal(outputTemplate(output).includes('\\${danger}'), true);
  assertNoTemplateInjection(outputTemplate(output));
});

test('break: Sass reports warnings at warn and verbose, reports debug only at verbose, and suppresses both at error', async t => {
  const { filesystem, root, session } = await workspace(t);
  await copyFixture(root, 'root.scss', 'root.scss');
  const verbose = { warnings: [], debugMessages: [] };
  verbose.warn = message => verbose.warnings.push(message);
  verbose.debug = message => verbose.debugMessages.push(message);
  const warning = { warnings: [], debugMessages: [] };
  warning.warn = message => warning.warnings.push(message);
  warning.debug = message => warning.debugMessages.push(message);
  const silent = { warnings: [], debugMessages: [] };
  silent.warn = message => silent.warnings.push(message);
  silent.debug = message => silent.debugMessages.push(message);

  await compileSass(context(session, filesystem, compilerWith(), { logLevel: 'verbose', logger: verbose }));
  await compileSass(context(session, filesystem, compilerWith(), { logLevel: 'warn', logger: warning }));
  await compileSass(context(session, filesystem, compilerWith(), { logLevel: 'error', logger: silent }));

  assert.deepEqual(verbose.warnings, ['warn:root.scss']);
  assert.deepEqual(verbose.debugMessages, ['debug:root.scss']);
  assert.deepEqual(warning.warnings, ['warn:root.scss']);
  assert.deepEqual(warning.debugMessages, []);
  assert.deepEqual(silent.warnings, []);
  assert.deepEqual(silent.debugMessages, []);
});

test('break: Sass rejects invalid log level and load paths before compiler or publisher side effects', async t => {
  const { filesystem, root, session } = await workspace(t);
  await copyFixture(root, 'root.scss', 'root.scss');
  const events = [];
  const publisher = new AtomicPublisher({ files: { sentinel: 'unchanged' } });

  await assertCode(compileSass(context(session, filesystem, compilerWith({ events }), { logLevel: 'loud', publisher })), 'SASS_INPUT_INVALID');
  await assertCode(compileSass(context(session, filesystem, compilerWith({ events }), { loadPaths: ['../escape'], publisher })), 'PATH_INVALID');

  assert.deepEqual(events, []);
  assert.equal(publisher.calls, 0);
  assert.deepEqual(Object.fromEntries(publisher.files), { sentinel: 'unchanged' });
});

test('break: Sass rejects a mutable input record before compiler or publisher side effects', async t => {
  const { filesystem, root, session } = await workspace(t);
  await copyFixture(root, 'root.scss', 'root.scss');
  const events = [];
  const publisher = new AtomicPublisher({ files: { sentinel: 'unchanged' } });

  await assertCode(compileSass({ session, filesystem, compiler: compilerWith({ events }), publisher }), 'SASS_INPUT_INVALID');

  assert.deepEqual(events, []);
  assert.equal(publisher.calls, 0);
  assert.deepEqual(Object.fromEntries(publisher.files), { sentinel: 'unchanged' });
});

test('break: Sass syntax failure after an earlier compile produces a safe typed input error without a plan or publisher mutation', async t => {
  const { filesystem, root, session } = await workspace(t);
  await copyFixture(root, 'app/elements/good.scss', 'component.scss');
  await copyFixture(root, 'src/broken.scss', 'syntax-error.scss');
  const events = [];
  const publisher = new AtomicPublisher({ files: { sentinel: 'unchanged' } });

  await assert.rejects(
    compileSass(context(session, filesystem, compilerWith({ events, failureFor: input => input.endsWith('/src/broken.scss') }), { publisher })),
    error => {
      assert.equal(error?.code, 'SASS_COMPILE_FAILED');
      assert.deepEqual(error?.details, { input: 'src/broken.scss' });
      assert.equal(error?.cause, undefined);
      assert.doesNotMatch(`${error.message} ${JSON.stringify(error.details)}`, /fixture-sass-source-secret|\.broken/);
      return true;
    }
  );

  assert.deepEqual(events.map(event => path.relative(root, event.input)), ['app/elements/good.scss', 'src/broken.scss']);
  assert.equal(publisher.calls, 0);
  assert.deepEqual(Object.fromEntries(publisher.files), { sentinel: 'unchanged' });
});

test('break: Sass rejects unsafe styles markers before a single publisher transaction can mutate targets', async t => {
  const { filesystem, root, session } = await workspace(t);
  await copyFixture(root, 'root.scss', 'root.scss');
  await copyFixture(root, 'src/card.scss', 'component.scss');
  for (const source of ['export default notCss`old`;', '// export default css`old`;']) {
    await writeWorkspaceFile(root, 'src/card.styles.js', source);
    const publisher = new AtomicPublisher({ files: { sentinel: 'unchanged' } });

    await assertCode(compileSass(context(session, filesystem, compilerWith(), { publisher })), 'SASS_OUTPUT_INVALID');

    assert.equal(publisher.calls, 0);
    assert.deepEqual(Object.fromEntries(publisher.files), { sentinel: 'unchanged' });
  }
});

test('break: Sass publisher failure leaves its atomic target unchanged after all output bytes are staged', async t => {
  const { filesystem, root, session } = await workspace(t);
  await copyFixture(root, 'root.scss', 'root.scss');
  await copyFixture(root, 'src/card.scss', 'component.scss');
  const publisher = new AtomicPublisher({ files: { sentinel: 'unchanged' }, fail: true });

  await assertCode(compileSass(context(session, filesystem, compilerWith(), { publisher })), 'SASS_PUBLISH_FAILED');

  assert.equal(publisher.calls, 1);
  assert.deepEqual(Object.fromEntries(publisher.files), { sentinel: 'unchanged' });
});

test('break: Sass rejects symlinked source targets without compiling or publishing outside the workspace', async t => {
  const { filesystem, root, session } = await workspace(t);
  const outside = await mkdtemp(path.join(os.tmpdir(), 'open-cells-academy-sass-outside-'));
  t.after(async () => {
    await rm(outside, { recursive: true, force: true });
  });
  await writeFile(path.join(outside, 'escaped.scss'), '.escaped { color: red; }');
  await mkdir(path.join(root, 'src'), { recursive: true });
  await symlink(path.join(outside, 'escaped.scss'), path.join(root, 'src', 'escaped.scss'));
  const events = [];
  const publisher = new AtomicPublisher({ files: { sentinel: 'unchanged' } });

  await assertCode(compileSass(context(session, filesystem, compilerWith({ events }), { publisher })), 'SASS_SOURCE_INVALID');

  assert.deepEqual(events, []);
  assert.equal(publisher.calls, 0);
  assert.deepEqual(Object.fromEntries(publisher.files), { sentinel: 'unchanged' });
});

test('break: repeated Sass planning has byte-identical exact-path outputs and no temporary workspace residue', async t => {
  const { filesystem, root, session } = await workspace(t);
  await copyFixture(root, 'app/styles/theme.scss', 'theme.scss');
  await copyFixture(root, 'src/card.scss', 'component.scss');
  const compiler = compilerWith({ cssFor: input => `.${path.basename(input, '.scss')}{color:stable}` });
  const first = await compileSass(context(session, filesystem, compiler));
  const second = await compileSass(context(session, filesystem, compiler));

  assert.deepEqual(filesIn(second), filesIn(first));
  assert.deepEqual((await readdir(root)).filter(entry => entry.startsWith('.open-cells-academy-')), []);
});

test('break: Sass compiler fallback passes only file-compiler options and freezes its CSS result', async () => {
  const calls = [];
  const compiler = new SassCompiler({
    compile(inputPath, options) {
      calls.push({ inputPath, options });
      return { css: '.fallback{}' };
    }
  });
  const result = await compiler.compile({
    source: '.ignored{}',
    inputPath: '/tmp/open-cells-academy-sass-adapter.scss',
    loadPaths: ['/tmp/load-path'],
    logger: { warn() {}, debug() {} }
  });

  assert.deepEqual(result, { css: '.fallback{}' });
  assert.equal(Object.isFrozen(result), true);
  assert.deepEqual(calls.map(call => ({ inputPath: call.inputPath, keys: Object.keys(call.options).sort(), loadPaths: call.options.loadPaths })), [{
    inputPath: '/tmp/open-cells-academy-sass-adapter.scss',
    keys: ['loadPaths', 'logger'],
    loadPaths: ['/tmp/load-path']
  }]);
});
