import { typedError } from '../../domain/workspace-session.js';

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function assertApi(api) {
  if (!isRecord(api) || typeof api.generateSW !== 'function' || typeof api.injectManifest !== 'function') {
    throw typedError('WORKBOX_API_INVALID');
  }
}

function assertOptions(options) {
  if (!isRecord(options) || typeof options.mode !== 'string' || typeof options.swDest !== 'string') {
    throw typedError('SERVICE_WORKER_INVALID');
  }
  if (options.mode === 'injectManifest' && typeof options.swSrc !== 'string') throw typedError('SERVICE_WORKER_INVALID');
  if (options.mode !== 'generateSW' && options.mode !== 'injectManifest') throw typedError('SERVICE_WORKER_INVALID');
}

/**
 * Thin injected adapter for the two public Workbox build modes.
 */
export class ServiceWorker {
  #api;

  constructor(api) {
    assertApi(api);
    this.#api = api;
    Object.freeze(this);
  }

  async build(options) {
    assertOptions(options);
    const { mode, ...workboxOptions } = options;
    try {
      if (mode === 'generateSW') return await this.#api.generateSW(Object.freeze(workboxOptions));
      return await this.#api.injectManifest(Object.freeze(workboxOptions));
    } catch {
      throw typedError('SERVICE_WORKER_FAILED');
    }
  }
}
