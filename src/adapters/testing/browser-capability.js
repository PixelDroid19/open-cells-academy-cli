import { typedError } from '../../domain/workspace-session.js';

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Bounded browser availability check for the testing path. It never installs a
 * browser; it only reports whether a usable Chromium entry is available through
 * the injected probe. The explicit executable path, when provided, wins.
 */
export class BrowserCapability {
  #probe;

  constructor(probe) {
    if (!isRecord(probe) || typeof probe.chromiumAvailable !== 'function') {
      throw typedError('BROWSER_CAPABILITY_INVALID');
    }
    this.#probe = probe;
    Object.freeze(this);
  }

  async available({ executablePath } = {}) {
    if (typeof executablePath === 'string' && executablePath.length > 0) {
      return this.#probe.chromiumAvailable({ executablePath });
    }
    return this.#probe.chromiumAvailable({});
  }

  async locate({ executablePath } = {}) {
    if (typeof this.#probe.chromiumLocation !== 'function') return undefined;
    const options = typeof executablePath === 'string' && executablePath.length > 0 ? { executablePath } : {};
    const location = await this.#probe.chromiumLocation(options);
    return typeof location === 'string' && location.length > 0 ? location : undefined;
  }

  assertAvailable({ executablePath } = {}) {
    return this.available({ executablePath }).then(available => {
      if (available === true) return true;
      throw typedError('CHROMIUM_UNAVAILABLE');
    });
  }
}
