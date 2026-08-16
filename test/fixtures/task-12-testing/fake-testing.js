import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const JUNIT = '<?xml version="1.0" encoding="UTF-8"?><testsuites><testsuite name="fake" tests="1" failures="0"><testcase name="fake" classname="fake"/></testsuite></testsuites>\n';

/**
 * Minimal public-API-shaped fake for the test runner adapters. It simulates
 * the Vitest/WTR CLI behavior the Academy adapters depend on: writes
 * JUnit/coverage artifacts into the target project and returns an exit code
 * derived from the requested mode. The adapter is unchanged when the real
 * runner CLI is injected in Task 13/15/16.
 */
export function createFakeTestToolchain({ mode = 'green', interrupt = false } = {}) {
  const state = {
    vitestCalls: 0,
    vitestLast: undefined,
    wtrCalls: 0,
    wtrLast: undefined,
    wtrConfigSource: undefined
  };

  function coverageDir(cwd) {
    return path.join(cwd, 'test', 'coverage');
  }

  async function writeArtifacts(cwd) {
    const dir = coverageDir(cwd);
    await mkdir(dir, { recursive: true });
    await writeFile(path.join(dir, 'junit-report.xml'), JUNIT);
    await writeFile(path.join(dir, 'coverage-final.json'), '{"total":{}}\n');
  }

  function resultFor(mode) {
    switch (mode) {
      case 'assertion':
        return { exitCode: 1, stdout: '', stderr: 'FAIL assertion failed\n' };
      case 'import':
        return { exitCode: 1, stdout: '', stderr: 'FAIL could not load ./missing.js\n' };
      case 'no-tests':
        return { exitCode: 1, stdout: 'No test files found\n', stderr: '' };
      default:
        return { exitCode: 0, stdout: 'Test Files  1 passed (1)\n', stderr: '' };
    }
  }

  return Object.freeze({
    state,
    get vitestCalls() {
      return state.vitestCalls;
    },
    get vitestLast() {
      return state.vitestLast;
    },
    get wtrCalls() {
      return state.wtrCalls;
    },
    get wtrLast() {
      return state.wtrLast;
    },
    get wtrConfigSource() {
      return state.wtrConfigSource;
    },
    async runProcess(request) {
      const isVitest = String(request.file).includes('vitest') || request.args.some(arg => arg.includes('vitest'));
      if (isVitest) {
        state.vitestCalls += 1;
        state.vitestLast = Object.freeze({ ...request });
      } else {
        state.wtrCalls += 1;
        state.wtrLast = Object.freeze({ ...request });
        const configIndex = request.args.indexOf('--config');
        if (configIndex >= 0) {
          state.wtrConfigSource = await readFile(path.resolve(request.cwd, request.args[configIndex + 1]), 'utf8');
        }
      }
      if (interrupt) {
        if (request.signal?.aborted === true) {
          return Object.freeze({ exitCode: 130, signal: 'SIGINT', stdout: '', stderr: '' });
        }
        await new Promise(resolve => setTimeout(resolve, 50));
        request.signal?.emit?.('abort');
        return Object.freeze({ exitCode: 130, signal: 'SIGINT', stdout: '', stderr: '' });
      }
      await writeArtifacts(request.cwd);
      return Object.freeze(resultFor(mode));
    }
  });
}
