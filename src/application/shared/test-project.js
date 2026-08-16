import { fail, ok } from '../../domain/outcome.js';
import { typedError } from '../../domain/workspace-session.js';

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function assertRunner(runner) {
  if (runner === null || typeof runner !== 'object' || typeof runner.run !== 'function') {
    throw typedError('TEST_RUNNER_INVALID');
  }
}

function normalizedContext(context) {
  if (!isRecord(context) || !Object.isFrozen(context) || context.session === undefined || context.runner === undefined) {
    throw typedError('TEST_INVALID');
  }
  assertRunner(context.runner);
  const options = context.options ?? {};
  if (!isRecord(options)) throw typedError('TEST_INVALID');
  const booleans = ['wtr', 'watch', 'updateSnapshots', 'updateLocales', 'coverage'];
  for (const name of booleans) {
    if (options[name] !== undefined && typeof options[name] !== 'boolean') throw typedError('TEST_INVALID');
  }
  if (options.wtrTestsFinishTimeout !== undefined && (!Number.isSafeInteger(options.wtrTestsFinishTimeout) || options.wtrTestsFinishTimeout < 0)) {
    throw typedError('TEST_INVALID');
  }
  if (context.env !== undefined && !isRecord(context.env)) {
    throw typedError('TEST_INVALID');
  }
  return Object.freeze({
    session: context.session,
    runner: context.runner,
    browser: context.browser,
    signals: context.signals,
    env: context.env === undefined ? undefined : Object.freeze({ ...context.env }),
    signal: context.signal,
    updateLocales: context.updateLocales,
    options: Object.freeze({
      wtr: options.wtr ?? false,
      watch: options.watch ?? false,
      updateSnapshots: options.updateSnapshots ?? false,
      updateLocales: options.updateLocales ?? false,
      coverage: options.coverage ?? false,
      wtrTestsFinishTimeout: options.wtrTestsFinishTimeout ?? 120000
    })
  });
}

function withSignalGuards(signals) {
  if (signals === undefined) return Object.freeze({});
  if (signals === null || typeof signals.on !== 'function' || typeof signals.removeListener !== 'function') {
    throw typedError('TEST_INVALID');
  }
  let interrupted = false;
  const onSignal = () => {
    interrupted = true;
  };
  signals.on('SIGINT', onSignal);
  signals.on('SIGTERM', onSignal);
  return Object.freeze({
    get interrupted() {
      return interrupted;
    },
    remove() {
      signals.removeListener('SIGINT', onSignal);
      signals.removeListener('SIGTERM', onSignal);
    }
  });
}

function outcomeFromResult(result, guards) {
  if (guards.interrupted === true || result?.code === 'INTERRUPTED') {
    return fail('INTERRUPTED', 'testInterrupted', Object.freeze({}));
  }
  if (result?.ok === true) {
    return ok(Object.freeze({ passed: result.data?.passed ?? 0, failures: result.data?.failures ?? 0 }));
  }
  if (result?.code === 'TEST_NO_TESTS') {
    return fail('TEST_NO_TESTS', 'testNoTests', Object.freeze({}));
  }
  return fail(result?.code ?? 'TEST_FAILED', 'testFailed', Object.freeze({ failures: result?.params?.failures ?? 0 }));
}

/**
 * Shared testing use case. It selects the Vitest browser or WTR runner, checks
 * Chromium availability (without auto-install), guards SIGINT/SIGTERM, and maps
 * the runner result into a typed outcome. `updateLocales` is delegated to the
 * injected callback when provided; a missing callback is a typed failure.
 */
export async function testProject(context) {
  const normalized = normalizedContext(context);
  const guards = withSignalGuards(normalized.signals);
  try {
    let browserExecutable;
    if (normalized.browser !== undefined && normalized.browser !== null) {
      if (typeof normalized.browser.assertAvailable !== 'function') throw typedError('TEST_BROWSER_INVALID');
      await normalized.browser.assertAvailable({});
      if (typeof normalized.browser.locate === 'function') {
        browserExecutable = await normalized.browser.locate({});
      }
    }
    if (normalized.options.updateLocales) {
      if (typeof normalized.updateLocales !== 'function') {
        throw typedError('TEST_UPDATE_LOCALES_MISSING');
      }
      await normalized.updateLocales();
    }
    const result = await normalized.runner.run(Object.freeze({
      session: normalized.session,
      wtr: normalized.options.wtr,
      watch: normalized.options.watch,
      updateSnapshots: normalized.options.updateSnapshots,
      coverage: normalized.options.coverage,
      timeoutMs: normalized.options.wtrTestsFinishTimeout,
      signal: normalized.signal,
      env: normalized.env,
      browserExecutable
    }));
    return outcomeFromResult(result, guards);
  } catch (cause) {
    if (cause?.code === 'CHROMIUM_UNAVAILABLE') {
      return fail(cause.code, 'chromiumUnavailable', Object.freeze({}), 'chromiumUnavailableRemediation');
    }
    if (cause?.code === 'TEST_LAUNCHER_MISSING') {
      return fail(cause.code, 'testLauncherMissing', Object.freeze({}), 'testLauncherMissingRemediation');
    }
    if (cause?.code === 'INTERRUPTED' || cause?.code === 'TEST_UPDATE_LOCALES_MISSING' || cause?.code === 'TEST_NO_TESTS') {
      return fail(cause.code, cause.code === 'TEST_NO_TESTS' ? 'testNoTests' : 'testInterrupted', Object.freeze({}));
    }
    if (cause?.code !== undefined && typeof cause.code === 'string') {
      return fail(cause.code, 'testFailed', Object.freeze({ failures: 0 }));
    }
    return fail('TEST_FAILED', 'testFailed', Object.freeze({ failures: 0 }));
  } finally {
    guards.remove?.();
  }
}
