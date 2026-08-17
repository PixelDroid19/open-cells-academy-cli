import { ScaffoldPlan } from '../../domain/scaffold-plan.js';
import { typedError } from '../../domain/workspace-session.js';
import { createBridge4Sources } from '../../../templates/apps/bridge4/bridge4-sources.js';

const APPLICATION_PROFILES = new Set(['blank', 'web-app', 'web-mobile-app', 'academy-app']);

function assertOptions(profile, options) {
  if (
    !APPLICATION_PROFILES.has(profile) ||
    options === null ||
    typeof options !== 'object' ||
    Array.isArray(options) ||
    options.cellsVersion !== '5' ||
    typeof options.name !== 'string' ||
    options.name.length === 0 ||
    typeof options.e2e !== 'boolean'
  ) {
    throw typedError('INVALID_INPUT', { field: 'profile' });
  }
  return Object.freeze({ e2e: options.e2e, name: options.name, profile });
}

/**
 * Produces the CLI 5 application family. Source text remains in the template
 * module so this boundary only validates inputs and composes an immutable plan.
 */
export function createBridge4ApplicationPayload(profile, options) {
  const normalized = assertOptions(profile, options);
  const sources = createBridge4Sources(normalized.profile, normalized.name, { e2e: normalized.e2e });
  let plan = ScaffoldPlan.empty()
    .addDirectory('app/resources')
    .addDirectory('app/vendor')
    .addDirectory('test/coverage');
  for (const [path, source] of Object.entries(sources)) {
    plan = plan.addFile(path, source);
  }
  return plan;
}
