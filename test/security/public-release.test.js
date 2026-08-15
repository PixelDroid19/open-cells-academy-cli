import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const execFileAsync = promisify(execFile);
const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const PACKAGE_NAME = 'open-cells-academy-cli';
const REPOSITORY = 'PixelDroid19/open-cells-academy-cli';

async function json(relative) {
  return JSON.parse(await readFile(path.join(ROOT, relative), 'utf8'));
}

async function publicFiles() {
  const { stdout } = await execFileAsync(
    'git',
    ['ls-files', '--cached', '--others', '--exclude-standard', '-z'],
    { cwd: ROOT, encoding: 'buffer' }
  );
  return stdout
    .toString('utf8')
    .split('\0')
    .filter(Boolean)
    .sort();
}

test('public release has one consistent installable package identity', async () => {
  const manifest = await json('package.json');
  const lock = await json('package-lock.json');
  const self = await json('package-self-manifest.json');

  assert.equal(manifest.name, PACKAGE_NAME);
  assert.equal(manifest.version, '0.1.0');
  assert.equal(Object.hasOwn(manifest, 'private'), false);
  assert.deepEqual(manifest.bin, { cells: 'bin/cells.js' });
  assert.equal(manifest.license, 'Apache-2.0');
  assert.equal(manifest.repository?.url, `git+https://github.com/${REPOSITORY}.git`);
  assert.equal(manifest.homepage, `https://github.com/${REPOSITORY}#readme`);
  assert.equal(manifest.bugs?.url, `https://github.com/${REPOSITORY}/issues`);
  assert.deepEqual(manifest.publishConfig, { access: 'public', registry: 'https://registry.npmjs.org/' });
  assert.equal(manifest.files.includes('LICENSE'), true);
  assert.equal(manifest.scripts?.['verify:release'], 'node --test --test-concurrency=1 test/security/public-release.test.js test/security/release-gates.test.js');
  assert.equal(manifest.scripts?.prepack, 'npm run verify:release');

  assert.equal(lock.name, manifest.name);
  assert.equal(lock.version, manifest.version);
  assert.equal(lock.packages[''].name, manifest.name);
  assert.equal(lock.packages[''].version, manifest.version);
  assert.equal(self.package.name, manifest.name);
  assert.equal(self.package.version, manifest.version);
  assert.deepEqual(self.package.bin, manifest.bin);
});

test('public release documentation contains executable GitHub and Cells lifecycle examples', async () => {
  const readme = await readFile(path.join(ROOT, 'README.md'), 'utf8');
  const releaseTarball = 'https://github.com/PixelDroid19/open-cells-academy-cli/releases/download/v0.1.0/open-cells-academy-cli-0.1.0.tgz';
  for (const expected of [
    `npm install --global ${releaseTarball}`,
    'github:PixelDroid19/open-cells-academy-cli',
    'npm exec --yes --package=github:PixelDroid19/open-cells-academy-cli -- cells',
    'cells app:create --scaffold app.json',
    'cells app:test',
    'cells app:build -c prod.js',
    'cells app:dev -c dev.js',
    'cells app:preview -c prod.js',
    'cells component:create --scaffold component.json',
    'cells component:test --coverage',
    'cells component:build:demo',
    'cells component:dev',
    'WidgetMixin(ScopedElementsMixin(LitElement))',
    'this.emitEvent(',
    'this.t('
  ]) {
    assert.match(readme, new RegExp(expected.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }
  assert.equal(readme.includes('npm install --global github:PixelDroid19/open-cells-academy-cli'), false);
});

test('public repository candidates contain no local paths, secrets, or private registries', async () => {
  const textExtensions = new Set(['.js', '.json', '.md', '.txt', '.yml', '.yaml', '.npmrc']);
  const packageForbidden = [/(?:_authToken|NPM_TOKEN|password)\s*=\s*[^\s$<]+/i, /https?:\/\/[^\s/@:]+:[^\s/@]+@/i];
  const packageRoots = ['bin/', 'src/', 'templates/'];
  const packageFiles = new Set(['README.md', 'THIRD_PARTY_NOTICES.md', 'package.json', 'package-self-manifest.json']);
  const retiredIdentity = new RegExp(['academy', 'cli', 'next'].join('-'), 'i');
  const sessionTemp = new RegExp(`${path.sep}tmp${path.sep}codex-`, 'i');
  const localFileUrl = /file:\/\/\/(?:home\/|run\/media\/|Users\/|[A-Za-z]:[\\/])/i;
  const hits = [];

  for (const relative of await publicFiles()) {
    if (relative === 'test/security/public-release.test.js') continue;
    if (!textExtensions.has(path.extname(relative)) && path.basename(relative) !== '.npmrc') continue;
    const contents = await readFile(path.join(ROOT, relative), 'utf8');
    assert.equal(contents.includes(ROOT), false, `${relative} contains the development checkout path`);
    assert.equal(contents.includes(os.homedir()), false, `${relative} contains the development home path`);
    assert.equal(retiredIdentity.test(contents), false, `${relative} contains the retired development identity`);
    assert.equal(sessionTemp.test(contents), false, `${relative} contains a session-specific temporary path`);
    assert.equal(localFileUrl.test(contents), false, `${relative} contains a local file URL`);
    assert.equal(contents.split(/\r?\n/).some(line => /[ \t]+$/.test(line)), false, `${relative} contains trailing whitespace`);
    const patterns = [];
    if (packageRoots.some(prefix => relative.startsWith(prefix)) || packageFiles.has(relative)) {
      patterns.push(...packageForbidden);
    }
    for (const pattern of patterns) {
      if (pattern.test(contents)) hits.push(`${relative} matched ${pattern}`);
    }
  }

  assert.deepEqual(hits, []);
});

test('public lockfile resolves packages only from the public npm registry', async () => {
  const lock = await json('package-lock.json');
  const foreign = Object.entries(lock.packages)
    .filter(([, value]) => typeof value.resolved === 'string')
    .filter(([, value]) => !value.resolved.startsWith('https://registry.npmjs.org/'))
    .map(([name, value]) => `${name}: ${value.resolved}`);
  assert.deepEqual(foreign, []);
});

test('every reachable public commit contains only the neutral OpenCells identity', async () => {
  const { stdout } = await execFileAsync('git', ['rev-list', '--all'], { cwd: ROOT });
  const commits = stdout.trim().split('\n').filter(Boolean);
  const forbidden = [
    ['academy', 'cli', 'next'].join('-'),
    ['bb', 'va'].join(''),
    ['sphe', 'rica'].join(''),
    ROOT,
    os.homedir()
  ];
  const hits = [];

  for (const commit of commits) {
    for (const pattern of forbidden) {
      try {
        const result = await execFileAsync('git', ['grep', '-I', '-n', '-i', '-F', pattern, commit, '--', '.'], { cwd: ROOT });
        if (result.stdout.trim() !== '') hits.push(`${commit} contains a retired public-history value`);
      } catch (error) {
        if (error.code !== 1) throw error;
      }
    }
  }

  assert.deepEqual(hits, []);
});
