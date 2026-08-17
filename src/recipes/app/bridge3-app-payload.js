import { ScaffoldPlan } from '../../domain/scaffold-plan.js';
import { typedError } from '../../domain/workspace-session.js';
import { createBridge3Sources } from '../../../templates/apps/bridge3/bridge3-sources.js';

const APPLICATION_PROFILES = new Set(['blank', 'web-app', 'web-mobile-app', 'academy-app']);

function assertOptions(profile, options) {
  if (
    !APPLICATION_PROFILES.has(profile) ||
    options === null ||
    typeof options !== 'object' ||
    Array.isArray(options) ||
    options.cellsVersion !== '4' ||
    typeof options.name !== 'string' ||
    options.name.length === 0 ||
    typeof options.e2e !== 'boolean'
  ) {
    throw typedError('INVALID_INPUT', { field: 'profile' });
  }
  return Object.freeze({ e2e: options.e2e, name: options.name, profile });
}

/**
 * Produces the CLI 4-compatible Bridge 3 application family. Source text stays
 * in the template module while this boundary validates inputs and composes an
 * immutable public dependency and file plan.
 */
export function createBridge3ApplicationPayload(profile, options) {
  const normalized = assertOptions(profile, options);
  const sources = createBridge3Sources(normalized.profile, normalized.name, { e2e: normalized.e2e });
  let plan = ScaffoldPlan.empty()
    .addDirectory('app/resources')
    .addDirectory('app/vendor')
    .addDirectory('test/coverage')
    .addDependency('@cells/cells-bridge', '^3.22.0', 'runtime')
    .addDependency('@cells/cells-page-mixin', '^1.0.0', 'runtime')
    .addDependency('cells-app-template', '^6.0.0', 'runtime')
    .addDependency('lit', '^3.2.0', 'runtime')
    .addDependency('@open-wc/testing', '^4.0.0', 'dev')
    .addDependency('sass', '^1.80.0', 'dev')
    .addDependency('vite', '7.3.6', 'dev')
    .addDependency('vitest', '^3.0.0', 'dev');
  if (normalized.e2e) plan = plan.addDependency('playwright', '^1.50.0', 'dev');
  for (const [path, source] of Object.entries(sources)) {
    plan = plan.addFile(path, source);
  }
  return plan;
}
