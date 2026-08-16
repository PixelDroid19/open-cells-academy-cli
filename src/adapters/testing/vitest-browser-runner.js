import { typedError } from '../../domain/workspace-session.js';
import { captureProjectTestFiles, prepareTestArtifacts } from './test-files.js';

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
  const passed = (result.stdout.match(/(\d+)\s+passed/g) ?? []).reduce((sum, match) => sum + Number(match.match(/\d+/)[0]), 0);
  const failures = (result.stderr.match(/FAIL/g) ?? []).length;
  return Object.freeze({ passed, failures });
}

function outcome(result, request) {
  if (result.exitCode === 0) {
    return Object.freeze({ ok: true, data: summaryFrom(result) });
  }
  if (result.signal === 'SIGINT' || result.signal === 'SIGTERM' || result.exitCode === 130) {
    return Object.freeze({ ok: false, code: 'INTERRUPTED', params: Object.freeze({ signal: result.signal }) });
  }
  if (result.stdout.includes('No test files found') || result.stderr.includes('No test files found')) {
    return Object.freeze({ ok: false, code: 'TEST_NO_TESTS', params: Object.freeze({}) });
  }
  return Object.freeze({ ok: false, code: 'TEST_FAILED', params: summaryFrom(result) });
}

/**
 * Runner for the Vitest browser path. It invokes the public Vitest CLI through
 * the injected process runner, writes JUnit and coverage configuration into the
 * target project, and returns typed pass/failure/interrupt outcomes. It never
 * installs a browser.
 */
export class VitestBrowserRunner {
  #process;
  #vitestExecutable;
  #platform;

  constructor(process, vitestExecutable = 'vitest', options = undefined) {
    assertProcess(process);
    if (typeof vitestExecutable !== 'string' || vitestExecutable.length === 0) throw typedError('TEST_RUNNER_INVALID');
    if (options !== undefined && (options === null || typeof options !== 'object' || Array.isArray(options) || Object.keys(options).some(key => key !== 'platform'))) throw typedError('TEST_RUNNER_INVALID');
    const platform = options?.platform ?? globalThis.process.platform;
    if (typeof platform !== 'string' || platform.length === 0) throw typedError('TEST_RUNNER_INVALID');
    this.#process = process;
    this.#vitestExecutable = vitestExecutable;
    this.#platform = platform;
    Object.freeze(this);
  }

  async run(request) {
    assertRequest(request);
    const capturedTests = await captureProjectTestFiles(request.session.root);
    const testFiles = capturedTests.files;
    if (testFiles.length === 0) return Object.freeze({ ok: false, code: 'TEST_NO_TESTS', params: Object.freeze({}) });
    const args = request.watch === true ? ['watch', ...testFiles] : ['run', ...testFiles];
    if (request.updateSnapshots === true) args.push('--update');
    if (request.coverage === true) args.push('--coverage');
    const cwd = request.session.root;
    const artifacts = await prepareTestArtifacts(cwd, capturedTests, { platform: this.#platform });
    if (request.coverage === true && artifacts.projectOutput !== true) throw typedError('TEST_ARTIFACT_FAILED');
    try {
      const result = await this.#process.runProcess(Object.freeze({
        file: this.#vitestExecutable,
        args: Object.freeze(args),
        cwd,
        env: request.env ?? Object.freeze({}),
        signal: request.signal,
        timeoutMs: request.timeoutMs,
        beforeSpawn: artifacts.verify
      }));
      if (!isRecord(result)) throw typedError('TEST_TOOL_FAILED');
      return outcome(result, request);
    } catch (cause) {
      if (cause?.code === 'TEST_NO_TESTS' || cause?.code === 'TEST_FAILED' || cause?.code === 'INTERRUPTED') throw cause;
      if (cause?.code === 'INTERRUPTED') throw cause;
      throw typedError('TEST_TOOL_FAILED', undefined, cause);
    }
  }
}
