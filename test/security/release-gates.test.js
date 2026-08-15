import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));

async function collectFiles(root, { exclude = [] } = {}) {
  const files = [];
  async function visit(directory, relative) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const candidate = path.join(directory, entry.name);
      const childRelative = relative === '' ? entry.name : `${relative}/${entry.name}`;
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) {
        if (['node_modules', '.git', 'dist', 'build', 'coverage'].includes(entry.name) || exclude.some(prefix => childRelative.startsWith(prefix))) continue;
        await visit(candidate, childRelative);
      } else {
        files.push(candidate);
      }
    }
  }
  await visit(root, '');
  return files;
}

test('release: packageable source contains no credential assignment or implicit telemetry', async () => {
  const files = [];
  for (const relative of ['bin', 'src', 'templates']) {
    files.push(...await collectFiles(path.join(ROOT, relative)));
  }
  const forbidden = [
    /(?:_authToken|NPM_TOKEN|password)\s*=\s*[^\s$<]+/i,
    /https?:\/\/[^\s/@:]+:[^\s/@]+@/i,
    /machine-?id/i,
    /telemetry/i,
    /analytics[_-]?id/i
  ];
  const hits = [];
  for (const file of files) {
    const contents = await readFile(file, 'utf8');
    for (const pattern of forbidden) {
      if (pattern.test(contents)) hits.push(`${path.relative(ROOT, file)} matched ${pattern}`);
    }
  }
  assert.deepEqual(hits, []);
});

test('release: every public JavaScript and JSON file parses', async () => {
  const files = await collectFiles(ROOT, {
    exclude: [
      'docs/superpowers/plans/2026-08-12-',
      'docs/superpowers/specs/2026-08-12-',
      'test/integration/external-project-compatibility.test.js'
    ]
  });
  for (const file of files.filter(candidate => candidate.endsWith('.js') || candidate.endsWith('.mjs'))) {
    await new Promise((resolve, reject) => {
      execFile(process.execPath, ['--check', file], error => (error ? reject(error) : resolve()));
    });
  }
  for (const file of files.filter(candidate => candidate.endsWith('.json') && !candidate.includes('fixtures') && !candidate.includes('malformed'))) {
    JSON.parse(await readFile(file, 'utf8'));
  }
});

test('release: package identity and generated manifest schema stay aligned', async () => {
  const manifest = JSON.parse(await readFile(path.join(ROOT, 'package.json'), 'utf8'));
  const self = JSON.parse(await readFile(path.join(ROOT, 'package-self-manifest.json'), 'utf8'));
  assert.equal(manifest.name, 'open-cells-academy-cli');
  assert.equal(manifest.version, '0.1.0');
  assert.equal(Object.hasOwn(manifest, 'private'), false);
  assert.equal(self.package.name, manifest.name);
  assert.equal(self.package.version, manifest.version);
  assert.deepEqual(self.package.bin, manifest.bin);
  assert.deepEqual(self.package.engines, manifest.engines);
});

test('release: no lock, stage, temporary, coverage, or build residue is tracked as source', async () => {
  const names = await collectFiles(ROOT);
  const residue = names
    .map(file => path.relative(ROOT, file))
    .filter(relative => /(?:^|\/)(?:\.open-cells-academy-|coverage\/|build\/|dist\/|test-results\/|playwright-report\/)/.test(relative));
  assert.deepEqual(residue, []);
});
