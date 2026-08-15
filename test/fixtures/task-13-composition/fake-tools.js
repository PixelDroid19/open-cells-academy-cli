import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

/**
 * Public-API-shaped fake for the tool APIs the composition root resolves.
 * Mirrors the surface the real adapters consume so the composition wiring is
 * validated before the real packages are injected in Task 15/16.
 */
export function createFakeToolApi(overrides = {}) {
  const calls = {
    installCalls: [],
    viteBuildCalls: 0,
    viteDevCalls: 0,
    vitePreviewCalls: 0,
    eslintRuns: 0,
    testingRuns: 0,
    workboxCalls: 0
  };
  const errorMode = overrides.errorMode === true;

  function failSecret() {
    if (errorMode) {
      const error = new Error('tool-secret');
      error.code = 'TOOL_FAILED';
      throw error;
    }
  }

  const api = {
    calls,
    get installCalls() {
      return calls.installCalls;
    },
    get viteBuildCalls() {
      return calls.viteBuildCalls;
    },
    get viteDevCalls() {
      return calls.viteDevCalls;
    },
    get vitePreviewCalls() {
      return calls.vitePreviewCalls;
    },
    get eslintRuns() {
      return calls.eslintRuns;
    },
    get testingRuns() {
      return calls.testingRuns;
    },
    async runProcess(request) {
      failSecret();
      return Object.freeze({ exitCode: 0, signal: null, stdout: '', stderr: '', durationMs: 1 });
    },
    async packageManagerInstall(request) {
      calls.installCalls.push(Object.freeze({ mode: request.mode }));
      failSecret();
      return Object.freeze({ tool: 'npm', mode: request.mode, result: Object.freeze({ exitCode: 0 }) });
    },
    packageManager: {
      async install(request, session) {
        return api.packageManagerInstall(request);
      }
    },
    async packLocalCli(request) {
      failSecret();
      const bytes = new TextEncoder().encode('fake-cli-tarball');
      const hash = await import('node:crypto').then(({ createHash }) => createHash('sha512').update(bytes).digest('base64'));
      return Object.freeze({
        fileName: 'open-cells-academy-cli-0.1.0.tgz',
        content: new Uint8Array(bytes),
        integrity: `sha512-${hash}`
      });
    },
    git: {
      async inspectRepository() {
        failSecret();
        return Object.freeze({ isRepository: true, head: 'abc1234' });
      },
      async readConventionalCommits() {
        failSecret();
        return Object.freeze([
          Object.freeze({ hash: 'abc1234', shortHash: 'abc1234', subject: 'feat: add thing', body: '' })
        ]);
      }
    },
    documents: {
      async readVersioned(session, name) {
        failSecret();
        return Object.freeze({ version: undefined, content: '' });
      },
      async writeAtomically(session, name, content) {
        failSecret();
        const target = path.join(session.root, ...name.split('/'));
        await mkdir(path.dirname(target), { recursive: true });
        await writeFile(target, content);
        return Object.freeze({ destination: target });
      }
    },
    clock() {
      return new Date('2026-08-13T00:00:00Z');
    },
    sass: {
      async compile() {
        failSecret();
        return Object.freeze({ css: overrides.sass?.css ?? '.compiled{}' });
      }
    },
    eslintApi: {
      ESLint: class {
        constructor() {
          calls.eslintRuns += 1;
          failSecret();
        }
        async lintFiles() {
          return Object.freeze([]);
        }
      }
    },
    testing: {
      runProcess(request) {
        calls.testingRuns += 1;
        failSecret();
        return Promise.resolve(Object.freeze({ exitCode: overrides.testing?.exitCode ?? 0, signal: null, stdout: '', stderr: '' }));
      }
    },
    vite: {
      async createServer(config) {
        calls.viteDevCalls += 1;
        failSecret();
        return Object.freeze({
          httpServer: { address: () => ({ port: 43001 }) },
          async listen() {},
          async close() {}
        });
      },
      async build(config) {
        calls.viteBuildCalls += 1;
        failSecret();
        await mkdir(config.build.outDir, { recursive: true });
        await writeFile(path.join(config.build.outDir, 'index.html'), '<main>built</main>\n');
        return Object.freeze({ outDir: config.build.outDir });
      },
      async preview(config) {
        calls.vitePreviewCalls += 1;
        failSecret();
        return Object.freeze({
          httpServer: { address: () => ({ port: 43002 }) },
          async close() {}
        });
      }
    },
    workbox: {
      async generateSW() {
        calls.workboxCalls += 1;
        failSecret();
      },
      async injectManifest() {
        calls.workboxCalls += 1;
        failSecret();
      }
    },
    cem: {
      ts: {
        ScriptTarget: { ESNext: 99 },
        ScriptKind: { JS: 1, TS: 2 },
        createSourceFile(fileName, source, scriptTarget, setParentNodes, scriptKind) {
          return Object.freeze({ fileName, scriptTarget, scriptKind });
        }
      },
      async create() {
        failSecret();
        return overrides.cem?.manifest ?? Object.freeze({ schemaVersion: '1.0.0', modules: [] });
      }
    },
    browser: {
      async chromiumAvailable() {
        failSecret();
        return true;
      }
    },
    processRunner: {
      async run(request) {
        failSecret();
        return Object.freeze({ exitCode: 0, signal: null, stdout: '', stderr: '', durationMs: 1 });
      }
    }
  };
  return api;
}

export async function mkWorkspace(root, files = {}) {
  await writeFile(path.join(root, 'package.json'), '{"name":"composition-fixture","private":true,"type":"module"}\n');
  for (const [relative, content] of Object.entries(files)) {
    const target = path.join(root, relative);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, content);
  }
  return root;
}
