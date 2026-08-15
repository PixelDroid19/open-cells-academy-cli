import { planAppLocales } from '../../adapters/vite/locales-pipeline.js';
import { typedError } from '../../domain/workspace-session.js';

function assertContext(context) {
  if (
    context === null ||
    typeof context !== 'object' ||
    !Object.isFrozen(context) ||
    context.session === undefined ||
    context.filesystem === undefined ||
    context.request === undefined
  ) {
    throw typedError('LOCALES_CONTEXT_INVALID');
  }
  if (context.publisher !== undefined && (context.publisher === null || typeof context.publisher?.publish !== 'function')) {
    throw typedError('LOCALES_CONTEXT_INVALID');
  }
}

/**
 * Returns an immutable workspace-relative ScaffoldPlan. Supplying a publisher
 * is opt-in; it receives the complete plan once and is responsible for the
 * enclosing transaction used by the composition root.
 */
export async function generateAppLocales(context) {
  assertContext(context);
  const plan = await planAppLocales(context);
  if (plan.files.length > 0 && context.publisher !== undefined) {
    await context.publisher.publish(context.session, plan, { signal: context.request.signal });
  }
  return plan;
}
