import { typedError } from '../domain/workspace-session.js';

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function readyValue(value) {
  if (!isRecord(value) || typeof value.url !== 'string' || typeof value.host !== 'string' || !Number.isInteger(value.port) || value.port < 1 || value.port > 65535) {
    throw typedError('DEV_SERVER_INVALID');
  }
  return Object.freeze({ url: value.url, host: value.host, port: value.port });
}

/**
 * Public lifecycle boundary returned by app development and preview servers.
 * Implementations expose the actual endpoint only after their ready promise
 * resolves and keep close idempotent.
 */
export class DevServer {
  #ready;
  #close;

  constructor({ ready, close }) {
    if (!(ready instanceof Promise) || typeof close !== 'function') {
      throw typedError('DEV_SERVER_INVALID');
    }
    this.#ready = ready.then(readyValue);
    this.#close = close;
    Object.freeze(this);
  }

  get ready() {
    return this.#ready;
  }

  close() {
    return this.#close();
  }
}
