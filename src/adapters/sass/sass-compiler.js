import { pathToFileURL } from 'node:url';

import { typedError } from '../../domain/workspace-session.js';

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function assertPublicApi(api) {
  if (!isRecord(api) || (typeof api.compileStringAsync !== 'function' && typeof api.compile !== 'function')) {
    throw typedError('SASS_COMPILER_INVALID');
  }
}

function assertRequest(request) {
  if (
    !isRecord(request) ||
    typeof request.source !== 'string' ||
    typeof request.inputPath !== 'string' ||
    request.inputPath.length === 0 ||
    !Array.isArray(request.loadPaths) ||
    request.loadPaths.some(loadPath => typeof loadPath !== 'string') ||
    !isRecord(request.logger) ||
    typeof request.logger.warn !== 'function' ||
    typeof request.logger.debug !== 'function'
  ) {
    throw typedError('SASS_COMPILER_INVALID');
  }
}

function importersFor(api) {
  if (typeof api.NodePackageImporter !== 'function') {
    return undefined;
  }
  return Object.freeze([new api.NodePackageImporter()]);
}

/**
 * Thin adapter around the documented public Sass API. The caller supplies the
 * API object so dependency composition remains outside this module.
 */
export class SassCompiler {
  #api;

  constructor(api) {
    assertPublicApi(api);
    this.#api = api;
    Object.freeze(this);
  }

  async compile(request) {
    assertRequest(request);
    const options = {
      loadPaths: Object.freeze([...request.loadPaths]),
      logger: request.logger
    };
    const importers = importersFor(this.#api);
    if (importers !== undefined) {
      options.importers = importers;
    }
    let result;
    if (typeof this.#api.compileStringAsync === 'function') {
      result = await this.#api.compileStringAsync(request.source, { ...options, url: pathToFileURL(request.inputPath) });
    } else {
      result = await this.#api.compile(request.inputPath, options);
    }
    if (!isRecord(result) || typeof result.css !== 'string') {
      throw typedError('SASS_COMPILER_INVALID');
    }
    return Object.freeze({ css: result.css });
  }
}
