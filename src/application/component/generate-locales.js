import { planComponentLocales } from '../../adapters/vite/locales-pipeline.js';
import { typedError } from '../../domain/workspace-session.js';

function assertContext(context) {
  if (
    context === null ||
    typeof context !== 'object' ||
    !Object.isFrozen(context) ||
    context.session === undefined ||
    context.filesystem === undefined ||
    context.request === undefined ||
    context.dependencyTree === undefined
  ) {
    throw typedError('LOCALES_CONTEXT_INVALID');
  }
  if (context.publisher !== undefined && (context.publisher === null || typeof context.publisher?.publish !== 'function')) {
    throw typedError('LOCALES_CONTEXT_INVALID');
  }
}

/**
 * Returns an immutable exact-path ScaffoldPlan for demo and unit locales.
 * Optional publication is delegated to the injected transaction owner.
 */
export async function generateComponentLocales(context) {
  assertContext(context);
  const plan = await planComponentLocales(context);
  if (plan.files.length > 0 && context.publisher !== undefined) {
    await context.publisher.publish(context.session, plan, { signal: context.request.signal });
  }
  return plan;
}
