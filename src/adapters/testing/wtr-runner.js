import { access, constants as fsConstants, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { typedError } from '../../domain/workspace-session.js';

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function assertProcess(process) {
  if (process === null || typeof process !== 'object' || typeof process.runProcess !== 'function') {
    throw typedError('TEST_PROCESS_INVALID');
  }
}

function assertRequest(request) {
  if (!isRecord(request) || request.session === undefined || request.session === null || typeof request.session.root !== 'string') {
    throw typedError('TEST_INVALID');
  }
}

function summaryFrom(result) {
  const failures = (result.stderr.match(/FAIL/g) ?? []).length;
  const passed = (result.stdout.match(/(\d+)\s+passed/g) ?? []).reduce((sum, match) => sum + Number(match.match(/\d+/)[0]), 0);
  return Object.freeze({ passed, failures });
}

function outcome(result) {
  if (result.exitCode === 0) {
    return Object.freeze({ ok: true, data: summaryFrom(result) });
  }
  if (result.signal === 'SIGINT' || result.signal === 'SIGTERM' || result.exitCode === 130) {
    return Object.freeze({ ok: false, code: 'INTERRUPTED', params: Object.freeze({ signal: result.signal }) });
  }
  return Object.freeze({ ok: false, code: 'TEST_FAILED', params: summaryFrom(result) });
}

function configSource(launcherSpecifier, browserExecutable, junitSpecifier) {
  const launcherOptions = typeof browserExecutable === 'string' && browserExecutable.length > 0
    ? `{ product: 'chromium', launchOptions: { executablePath: ${JSON.stringify(browserExecutable)} } }`
    : `{ product: 'chromium' }`;
  const junitImport = junitSpecifier === undefined ? '' : `import { junitReporter } from '${junitSpecifier}';\n`;
  const reporters = junitSpecifier === undefined
    ? `reporters: ['default'],`
    : `reporters: ['default', junitReporter({ outputPath: 'test/coverage/junit-report.xml' })],`;
  return `${junitImport}import { playwrightLauncher } from '${launcherSpecifier}';

export default {
  nodeResolve: true,
  files: ['test/**/*.test.js'],
  testFramework: { config: { ui: 'tdd' } },
  browsers: [playwrightLauncher(${launcherOptions})],
  coverageConfig: { reportDir: 'test/coverage' },
  ${reporters}
};
`;
}

async function projectHasPackage(cwd, packageName) {
  try {
    await access(path.join(cwd, 'node_modules', ...packageName.split('/'), 'package.json'), fsConstants.R_OK);
    return true;
  } catch {
    return false;
  }
}

/**
 * Runner for the Web Test Runner compatibility path. It writes an Academy-owned
 * WTR config into the target project and invokes the public WTR CLI through the
 * injected process runner. It only discovers real tests under the project's
 * test directory and performs no synthetic imports or coverage inflation. The
 * launcher import prefers the project's own `@web/test-runner-playwright` and
 * falls back to the CLI-provided copy; a located Chromium executable is passed
 * through so Playwright never downloads a browser.
 */
export class WtrRunner {
  #process;
  #wtrExecutable;
  #launcherEntry;
  #junitEntry;

  constructor(process, wtrExecutable = 'web-test-runner', launcherEntry = undefined, junitEntry = undefined) {
    assertProcess(process);
    if (typeof wtrExecutable !== 'string' || wtrExecutable.length === 0) throw typedError('TEST_RUNNER_INVALID');
    if (launcherEntry !== undefined && (typeof launcherEntry !== 'string' || launcherEntry.length === 0)) throw typedError('TEST_RUNNER_INVALID');
    if (junitEntry !== undefined && (typeof junitEntry !== 'string' || junitEntry.length === 0)) throw typedError('TEST_RUNNER_INVALID');
    this.#process = process;
    this.#wtrExecutable = wtrExecutable;
    this.#launcherEntry = launcherEntry;
    this.#junitEntry = junitEntry;
    Object.freeze(this);
  }

  async run(request) {
    assertRequest(request);
    const cwd = request.session.root;
    const configPath = path.join(cwd, 'wtr.academy.config.mjs');
    const launcherSpecifier = (await projectHasPackage(cwd, '@web/test-runner-playwright'))
      ? '@web/test-runner-playwright'
      : this.#launcherEntry === undefined
        ? undefined
        : pathToFileURL(this.#launcherEntry).href;
    if (launcherSpecifier === undefined) throw typedError('TEST_LAUNCHER_MISSING');
    const junitSpecifier = (await projectHasPackage(cwd, '@web/test-runner-junit-reporter'))
      ? '@web/test-runner-junit-reporter'
      : this.#junitEntry === undefined
        ? undefined
        : pathToFileURL(this.#junitEntry).href;
    try {
      await mkdir(path.join(cwd, 'test', 'coverage'), { recursive: true });
      await writeFile(configPath, configSource(launcherSpecifier, request.browserExecutable, junitSpecifier));
    } catch (cause) {
      throw typedError('TEST_ARTIFACT_FAILED', undefined, cause);
    }
    const args = ['--config', 'wtr.academy.config.mjs'];
    if (request.watch === true) args.push('--watch');
    if (request.updateSnapshots === true) args.push('--update-snapshots');
    if (request.coverage === true) args.push('--coverage');
    try {
      const result = await this.#process.runProcess(Object.freeze({
        file: this.#wtrExecutable,
        args: Object.freeze(args),
        cwd,
        env: request.env ?? Object.freeze({}),
        signal: request.signal,
        timeoutMs: request.timeoutMs
      }));
      if (!isRecord(result)) throw typedError('TEST_TOOL_FAILED');
      return outcome(result);
    } catch (cause) {
      if (cause?.code === 'TEST_FAILED' || cause?.code === 'INTERRUPTED' || cause?.code === 'TEST_NO_TESTS') throw cause;
      throw typedError('TEST_TOOL_FAILED', undefined, cause);
    }
  }
}
