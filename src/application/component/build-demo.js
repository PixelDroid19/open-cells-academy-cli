import { typedError } from '../../domain/workspace-session.js';

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function normalizedContext(context) {
  if (!isRecord(context) || !Object.isFrozen(context) || context.session === undefined || context.filesystem === null || typeof context.filesystem?.applyPlanAtomically !== 'function' || context.toolchain === null || typeof context.toolchain?.buildDemo !== 'function') {
    throw typedError('COMPONENT_DEMO_INVALID');
  }
  if (context.options !== undefined && !isRecord(context.options)) throw typedError('COMPONENT_DEMO_INVALID');
  if (context.logger !== undefined && (context.logger === null || typeof context.logger.info !== 'function')) throw typedError('COMPONENT_DEMO_INVALID');
  return Object.freeze({
    session: context.session,
    filesystem: context.filesystem,
    toolchain: context.toolchain,
    demo: context.demo,
    dist: context.dist,
    options: Object.freeze({ ...(context.options ?? {}) }),
    logger: context.logger
  });
}

export async function buildComponentDemo(context) {
  const normalized = normalizedContext(context);
  return normalized.toolchain.buildDemo(Object.freeze({
    session: normalized.session,
    filesystem: normalized.filesystem,
    demo: normalized.demo,
    dist: normalized.dist,
    options: normalized.options,
    logger: normalized.logger
  }));
}
