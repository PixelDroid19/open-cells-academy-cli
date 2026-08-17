import { generateAppLocales } from './generate-locales.js';
import { loadCellsConfig } from '../../adapters/vite/config-loader.js';
import { typedError } from '../../domain/workspace-session.js';

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function frozenContext(context) {
  if (!isRecord(context) || !Object.isFrozen(context) || context.session === undefined || context.filesystem === undefined || typeof context.configName !== 'string' || context.toolchain === null || typeof context.toolchain?.buildApp !== 'function') {
    throw typedError('APP_BUILD_INVALID');
  }
  if (context.options !== undefined && !isRecord(context.options)) throw typedError('APP_BUILD_INVALID');
  if (context.localeRequest !== undefined && !Object.isFrozen(context.localeRequest)) throw typedError('APP_BUILD_INVALID');
  if (context.serviceWorker !== undefined && (!isRecord(context.serviceWorker) || !Object.isFrozen(context.serviceWorker))) throw typedError('APP_BUILD_INVALID');
  return Object.freeze({ ...context, options: Object.freeze({ ...(context.options ?? {}) }) });
}

export async function buildApp(context) {
  const normalized = frozenContext(context);
  const config = await loadCellsConfig(normalized.session, normalized.configName);
  const localePlan = normalized.localeRequest === undefined
    ? undefined
    : await generateAppLocales(Object.freeze({
      session: normalized.session,
      filesystem: normalized.filesystem,
      request: Object.freeze({ ...normalized.localeRequest, config: config.locales })
    }));
  return normalized.toolchain.buildApp(Object.freeze({
    session: normalized.session,
    filesystem: normalized.filesystem,
    compiler: normalized.compiler,
    configName: normalized.configName,
    config,
    options: normalized.options,
    localePlan,
    serviceWorker: normalized.serviceWorker
  }));
}
