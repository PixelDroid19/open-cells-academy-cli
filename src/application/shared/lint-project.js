import { fail, ok } from '../../domain/outcome.js';
import { typedError } from '../../domain/workspace-session.js';

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
function normalizedContext(context) {
  if (!isRecord(context) || !Object.isFrozen(context) || context.session === undefined || context.eslint === null || typeof context.eslint?.lint !== 'function') {
    throw typedError('LINT_INVALID');
  }
  const options = context.options ?? {};
  if (!isRecord(options)) throw typedError('LINT_INVALID');
  if (options.fix !== undefined && typeof options.fix !== 'boolean') throw typedError('LINT_INVALID');
  if (options.abortOnFailure !== undefined && typeof options.abortOnFailure !== 'boolean') throw typedError('LINT_INVALID');
  return Object.freeze({
    session: context.session,
    eslint: context.eslint,
    plugins: context.plugins,
    options: Object.freeze({
      fix: options.fix ?? false,
      abortOnFailure: options.abortOnFailure ?? true
    })
  });
}

/**
 * Shared lint use case for applications and components. `kind` selects the
 * owned source patterns; the ESLint adapter owns ESLint and the flat config.
 */
export async function lintProject(context, kind) {
  if (kind !== 'app' && kind !== 'component') throw typedError('LINT_INVALID');
  const normalized = normalizedContext(context);
  const summary = await normalized.eslint.lint(Object.freeze({
    session: normalized.session,
    kind,
    fix: normalized.options.fix,
    abortOnFailure: normalized.options.abortOnFailure,
    plugins: normalized.plugins
  }));
  if (summary.ok === true) {
    return ok(Object.freeze({ errorCount: summary.errorCount, warningCount: summary.warningCount }));
  }
  return fail('LINT_FAILED', 'lintFailed', { errorCount: summary.errorCount, warningCount: summary.warningCount }, 'lintFailedRemediation', summary);
}
