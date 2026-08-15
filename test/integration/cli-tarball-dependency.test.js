import assert from 'node:assert/strict';
import { cp, mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { gunzipSync, gzipSync } from 'node:zlib';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { NodePackageSelf } from '../../src/adapters/node/package-self.js';
import { NodeFilesystem } from '../../src/adapters/node/node-filesystem.js';
import { NodeProcessRunner } from '../../src/adapters/node/process-runner.js';
import { PublicPackageManager } from '../../src/adapters/node/public-package-manager.js';
import { createApp } from '../../src/application/app/create-app.js';
import { WorkspaceSession } from '../../src/domain/workspace-session.js';

const candidateRoot = path.resolve(import.meta.dirname, '../..');

async function fixture(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'open-cells-academy-tarball-'));
  t.after(async () => {
    await rm(root, { recursive: true, force: true });
  });
  await writeFile(path.join(root, 'package.json'), JSON.stringify({ name: 'tarball-fixture', private: true }));
  const filesystem = new NodeFilesystem();
  const session = await WorkspaceSession.open(root, filesystem);
  return { filesystem, root, session };
}

function tarEntries(bytes) {
  const archive = gunzipSync(bytes);
  const entries = [];
  let offset = 0;
  while (offset + 512 <= archive.length) {
    const header = archive.subarray(offset, offset + 512);
    if (header.every(byte => byte === 0)) {
      break;
    }
    const read = (start, length) => header.subarray(start, start + length).toString('utf8').replace(/\0.*$/, '');
    const name = `${read(345, 155)}${read(0, 100)}`;
    const size = Number.parseInt(read(124, 12).trim() || '0', 8);
    const type = read(156, 1) || '0';
    const contentStart = offset + 512;
    entries.push(Object.freeze({ name, type, content: archive.subarray(contentStart, contentStart + size) }));
    offset = contentStart + Math.ceil(size / 512) * 512;
  }
  return entries;
}

function writeTarText(header, start, length, value) {
  const bytes = Buffer.from(value, 'utf8');
  assert.ok(bytes.length <= length);
  bytes.copy(header, start);
}

function writeTarOctal(header, start, length, value) {
  writeTarText(header, start, length, `${value.toString(8).padStart(length - 1, '0')}\0`);
}

function ustarHeader(entry, content) {
  const header = Buffer.alloc(512);
  writeTarText(header, 0, 100, entry.name);
  writeTarOctal(header, 100, 8, 0o644);
  writeTarOctal(header, 108, 8, 0);
  writeTarOctal(header, 116, 8, 0);
  writeTarOctal(header, 124, 12, content.length);
  writeTarOctal(header, 136, 12, 0);
  header.fill(0x20, 148, 156);
  header[156] = '0'.charCodeAt(0);
  writeTarText(header, 257, 6, 'ustar\0');
  writeTarText(header, 263, 2, '00');
  writeTarText(header, 345, 155, entry.prefix ?? '');
  writeTarText(header, 148, 8, `${header.reduce((total, byte) => total + byte, 0).toString(8).padStart(6, '0')}\0 `);
  return header;
}

function ustarArchive(entries) {
  const blocks = [];
  for (const entry of entries) {
    const content = Buffer.from(entry.content, 'utf8');
    blocks.push(ustarHeader(entry, content), content, Buffer.alloc(Math.ceil(content.length / 512) * 512 - content.length));
  }
  return gzipSync(Buffer.concat([...blocks, Buffer.alloc(1024)]));
}

function maliciousUstarRunner() {
  return Object.freeze({
    async run(request) {
      const destination = request.args.find(argument => argument.startsWith('--pack-destination='));
      assert.equal(request.file, 'npm');
      assert.ok(destination);
      const output = destination.slice('--pack-destination='.length);
      const archive = ustarArchive([
        { name: 'package/package.json', content: JSON.stringify({ name: 'open-cells-academy-cli', version: '0.1.0', bin: { cells: 'bin/cells.js' } }) },
        { name: 'package/bin/cells.js', content: 'process.stdout.write("0.1.0\\n");\n' },
        { prefix: `package/${'long-directory-'.repeat(8)}entry`, name: 'node_modules/evil.js', content: 'export default null;\n' }
      ]);
      await writeFile(path.join(output, 'open-cells-academy-cli-0.1.0.tgz'), archive, { flag: 'wx' });
      return Object.freeze({
        exitCode: 0,
        signal: null,
        stdout: JSON.stringify([{ name: 'open-cells-academy-cli', version: '0.1.0', filename: 'open-cells-academy-cli-0.1.0.tgz', integrity: 'sha512-Zml4dHVyZQ==' }]),
        stderr: ''
      });
    }
  });
}

async function packer(filesystem) {
  return new NodePackageSelf({ candidateRoot, processRunner: new NodeProcessRunner(), filesystem });
}

async function candidateWithRegistryUrl(t, url) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'open-cells-academy-private-host-'));
  t.after(async () => {
    await rm(root, { recursive: true, force: true });
  });
  for (const source of ['bin', 'src', 'templates', 'README.md', 'LICENSE', 'THIRD_PARTY_NOTICES.md', 'package-self-manifest.json']) {
    await cp(path.join(candidateRoot, source), path.join(root, source), { recursive: true, dereference: false });
  }
  const sourcePath = path.join(root, 'src/adapters/node/public-package-manager.js');
  const source = await readFile(sourcePath, 'utf8');
  await writeFile(sourcePath, source.replace('https://registry.npmjs.org/', url));
  return root;
}

test('break: self packing stops creating a final public identity archive with only owned source files and byte-derived integrity', async t => {
  const { filesystem, root, session } = await fixture(t);
  const result = await (await packer(filesystem)).packSelf('packed-cli', { session });
  const bytes = await readFile(result.tarballPath);
  const entries = tarEntries(bytes);
  const names = entries.map(entry => entry.name).sort();
  const metadataEntry = entries.find(entry => entry.name === 'package/package.json');

  assert.equal(path.dirname(result.tarballPath), path.join(root, 'packed-cli'));
  assert.match(path.basename(result.tarballPath), /^open-cells-academy-cli-0\.1\.0\.tgz$/);
  assert.match(result.integrity, /^sha512-[A-Za-z0-9+/]+={0,2}$/);
  assert.ok(metadataEntry);
  assert.deepEqual(JSON.parse(metadataEntry.content.toString('utf8')).bin, { cells: 'bin/cells.js' });
  assert.equal(JSON.parse(metadataEntry.content.toString('utf8')).name, 'open-cells-academy-cli');
  assert.equal(JSON.parse(metadataEntry.content.toString('utf8')).version, '0.1.0');
  assert.ok(names.includes('package/bin/cells.js'));
  assert.ok(names.includes('package/src/cli/command-registry.js'));
  assert.ok(names.includes('package/templates/capabilities/cells-core/main.js'));
  assert.ok(names.includes('package/templates/capabilities/data-manager/data-manager.js'));
  assert.ok(names.includes('package/templates/capabilities/i18n/messages.js'));
  assert.ok(names.includes('package/templates/capabilities/scoped-elements/scoped-hosts.js'));
  assert.ok(names.includes('package/templates/capabilities/local-api/local-api-client.js'));
  assert.ok(names.includes('package/LICENSE'));
  assert.ok(names.includes('package/THIRD_PARTY_NOTICES.md'));
  const packedMetadata = JSON.parse(metadataEntry.content.toString('utf8'));
  assert.deepEqual(packedMetadata.files, ['bin', 'src', 'templates', 'README.md', 'LICENSE', 'THIRD_PARTY_NOTICES.md']);
  assert.equal(packedMetadata.license, 'Apache-2.0');
  assert.equal(packedMetadata.repository.url, 'git+https://github.com/PixelDroid19/open-cells-academy-cli.git');
  assert.equal(packedMetadata.publishConfig.registry, 'https://registry.npmjs.org/');
  assert.equal(names.some(name => name.split('/').includes('node_modules')), false);
  assert.equal(names.some(name => name.includes('test/')), false);
  assert.equal(names.some(name => name.includes('package-self-manifest')), false);
  assert.equal(entries.some(entry => /(?:NPM_TOKEN|_authToken|password=)/i.test(entry.content.toString('utf8'))), false);
});

test('break: archive validation ignores a bare scheme but rejects nonpublic complete HTTP(S) URLs before publication', async t => {
  const { filesystem, root, session } = await fixture(t);
  for (const [label, url] of [
    ['private-host', 'https://private.example/'],
    ['http', 'http://registry.npmjs.org/'],
    ['credentials', 'https://user:secret@registry.npmjs.org/'],
    ['port', 'https://registry.npmjs.org:444/']
  ]) {
    const candidateRoot = await candidateWithRegistryUrl(t, url);
    const instance = new NodePackageSelf({ candidateRoot, processRunner: new NodeProcessRunner(), filesystem });
    const destination = `invalid-${label}`;

    await assert.rejects(instance.packSelf(destination, { session }), error => {
      assert.equal(error?.code, 'PACK_INVALID');
      return true;
    });
    assert.equal((await readdir(root)).includes(destination), false);
  }
});

test('break: archive validation permits owned loopback fixture URLs but rejects remote HTTP URLs', async t => {
  const { filesystem, root, session } = await fixture(t);
  const allowedRoot = await candidateWithRegistryUrl(t, 'http://127.0.0.1:4173/');
  const allowed = new NodePackageSelf({ candidateRoot: allowedRoot, processRunner: new NodeProcessRunner(), filesystem });
  const packed = await allowed.packSelf('allowed-loopback', { session });
  assert.equal(path.dirname(packed.tarballPath), path.join(root, 'allowed-loopback'));

  const deniedRoot = await candidateWithRegistryUrl(t, 'http://example.com:4173/');
  const denied = new NodePackageSelf({ candidateRoot: deniedRoot, processRunner: new NodeProcessRunner(), filesystem });
  await assert.rejects(denied.packSelf('denied-remote-http', { session }), error => {
    assert.equal(error?.code, 'PACK_INVALID');
    return true;
  });
});

test('break: a USTAR prefix stops hiding node_modules from archive path validation', async t => {
  const { filesystem, root, session } = await fixture(t);
  const instance = new NodePackageSelf({ candidateRoot, processRunner: maliciousUstarRunner(), filesystem });

  await assert.rejects(instance.packSelf('invalid-ustar', { session }), error => {
    assert.equal(error?.code, 'PACK_INVALID');
    return true;
  });
  assert.equal((await readdir(root)).includes('invalid-ustar'), false);
});

test('break: self-pack destinations stop rejecting absolute, traversal, symlink, and collision paths before npm pack', async t => {
  const { filesystem, root, session } = await fixture(t);
  const instance = await packer(filesystem);
  await mkdir(path.join(root, 'occupied'));
  const outside = await mkdtemp(path.join(os.tmpdir(), 'open-cells-academy-tarball-outside-'));
  t.after(async () => {
    await rm(outside, { recursive: true, force: true });
  });
  await symlink(outside, path.join(root, 'escaped'), 'dir');

  for (const destination of ['/absolute', '../outside', 'occupied', 'escaped/output']) {
    await assert.rejects(instance.packSelf(destination, { session }), error => {
      assert.ok(['PATH_INVALID', 'PATH_OUTSIDE_WORKSPACE', 'OUTPUT_EXISTS'].includes(error?.code));
      return true;
    });
  }
  assert.deepEqual(await readdir(root), ['escaped', 'occupied', 'package.json']);
});

test('break: a generated project stops resolving cells from an external PATH instead of the final identity local tarball', async t => {
  const { filesystem, root, session } = await fixture(t);
  const packWorkspace = path.join(root, 'pack-workspace');
  await mkdir(packWorkspace);
  await writeFile(path.join(packWorkspace, 'package.json'), JSON.stringify({ name: 'pack-workspace', private: true }));
  const packSession = await WorkspaceSession.open(packWorkspace, filesystem);
  const self = await packer(filesystem);
  const packed = await self.packSelf('archive', { session: packSession });
  const tarballBytes = new Uint8Array(await readFile(packed.tarballPath));
  const tarballName = path.basename(packed.tarballPath);
  await rm(packWorkspace, { recursive: true, force: true });

  const created = await createApp(
    { scaffold: { name: 'generated-app', scaffold: 'blank' } },
    {
      filesystem,
      session,
      workspaceLock: {
        async acquire() {
          return { async release() {} };
        }
      },
      async packLocalCli() {
        return Object.freeze({ fileName: tarballName, content: new Uint8Array(tarballBytes), integrity: packed.integrity });
      }
    }
  );
  assert.equal(created.ok, true);
  const target = path.join(root, 'generated-app');
  const targetSession = await WorkspaceSession.open(target, filesystem);
  const packageManager = new PublicPackageManager({
    processRunner: new NodeProcessRunner(),
    tempRoot: path.join(root, 'package-runtime'),
    cacheRoot: path.join(root, 'package-cache'),
    timeoutMs: 300_000
  });
  const installed = await packageManager.install({ mode: 'install', allowScripts: false, offline: false }, targetSession);
  assert.equal(installed.tool, 'npm');
  const cleanBin = path.join(root, 'clean-bin');
  await mkdir(cleanBin);
  await symlink(process.execPath, path.join(cleanBin, 'node'));
  const local = await new NodeProcessRunner().run({
    file: path.join(target, 'node_modules', '.bin', 'cells'),
    args: ['--version'],
    cwd: target,
    env: { PATH: cleanBin }
  });

  assert.equal(local.exitCode, 0);
  assert.equal(local.stderr, '');
  assert.equal(local.stdout, '0.1.0\n');
  const metadata = JSON.parse(await readFile(path.join(target, 'package.json'), 'utf8'));
  assert.equal(metadata.devDependencies['open-cells-academy-cli'], `file:tools/${tarballName}`);
  assert.equal((await readdir(path.join(target, 'tools'))).includes(tarballName), true);
});
