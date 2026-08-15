export const academyIntlMsgSource = `const LANGUAGE_UPDATE_EVENT = 'language-update';

function academyError(code) {
  const error = new Error('Academy i18n error: ' + code);
  error.code = code;
  return error;
}

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function assertLanguage(value) {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw academyError('ACADEMY_I18N_INVALID_INPUT');
  }
  return value;
}

function assertLocalesHost(value) {
  if (typeof value !== 'string') {
    throw academyError('ACADEMY_I18N_INVALID_INPUT');
  }
  return value;
}

function assertCatalogs(value) {
  if (!isRecord(value)) {
    throw academyError('ACADEMY_I18N_INVALID_CATALOGS');
  }
  const languages = Object.keys(value);
  if (languages.length === 0) {
    throw academyError('ACADEMY_I18N_INVALID_CATALOGS');
  }
  let expectedKeys;
  const copiedCatalogs = Object.create(null);
  for (const language of languages) {
    assertLanguage(language);
    const catalog = value[language];
    if (!isRecord(catalog)) {
      throw academyError('ACADEMY_I18N_INVALID_CATALOGS');
    }
    const keys = Object.keys(catalog).sort();
    if (keys.length === 0) {
      throw academyError('ACADEMY_I18N_INVALID_CATALOGS');
    }
    if (expectedKeys === undefined) {
      expectedKeys = keys;
    } else if (keys.length !== expectedKeys.length || keys.some((key, index) => key !== expectedKeys[index])) {
      throw academyError('ACADEMY_I18N_INVALID_CATALOGS');
    }
    const copiedCatalog = Object.create(null);
    for (const key of keys) {
      if (key.length === 0 || typeof catalog[key] !== 'string' || catalog[key].length === 0) {
        throw academyError('ACADEMY_I18N_INVALID_CATALOGS');
      }
      copiedCatalog[key] = catalog[key];
    }
    copiedCatalogs[language] = Object.freeze(copiedCatalog);
  }
  return Object.freeze(copiedCatalogs);
}

function assertSupportedLanguage(language, catalogs) {
  if (!Object.hasOwn(catalogs, language)) {
    throw academyError('ACADEMY_I18N_UNSUPPORTED_LANGUAGE');
  }
}

function dispatchLanguageUpdate(language) {
  if (typeof globalThis.dispatchEvent !== 'function' || typeof globalThis.CustomEvent !== 'function') {
    return;
  }
  globalThis.dispatchEvent(new globalThis.CustomEvent(LANGUAGE_UPDATE_EVENT, { detail: { language } }));
}

function normalizeResponse(response) {
  if (response === null || typeof response !== 'object' || response.ok !== true || typeof response.json !== 'function') {
    throw academyError('ACADEMY_I18N_LOAD_FAILED');
  }
  return response.json();
}

function normalizeLoadError(error) {
  if (typeof error?.code === 'string' && error.code.startsWith('ACADEMY_I18N_')) {
    return error;
  }
  return academyError('ACADEMY_I18N_LOAD_FAILED');
}

function observeRejection(promise) {
  promise.catch(() => {});
  return promise;
}

function assertParams(params) {
  if (!isRecord(params)) {
    throw academyError('ACADEMY_I18N_INVALID_INPUT');
  }
  return params;
}

export function installIntlMsg(options = {}) {
  if (!isRecord(options)) {
    throw academyError('ACADEMY_I18N_INVALID_INPUT');
  }
  const hasCatalogs = options.catalogs !== undefined;
  let catalogs = hasCatalogs ? assertCatalogs(options.catalogs) : undefined;
  let requestedLanguage = assertLanguage(options.language ?? 'en');
  let language = catalogs === undefined ? 'en' : requestedLanguage;
  let localesHost = assertLocalesHost(options.localesHost ?? '');
  let forTesting = options.forTesting ?? false;
  if (typeof forTesting !== 'boolean' || (options.fetchImpl !== undefined && typeof options.fetchImpl !== 'function')) {
    throw academyError('ACADEMY_I18N_INVALID_INPUT');
  }
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  if (catalogs !== undefined) {
    assertSupportedLanguage(requestedLanguage, catalogs);
  }

  let latestLoad;
  let loadVersion = 0;
  let languageVersion = 0;
  let pendingLoadVersion;
  let loadUrlResourcesComplete = Promise.resolve(catalogs);

  function requestLanguage(nextLanguage) {
    const next = assertLanguage(nextLanguage);
    const request = { language: next, version: ++languageVersion };
    requestedLanguage = next;
    return request;
  }

  function restoreRequestedLanguage(request) {
    if (request.version === languageVersion) {
      requestedLanguage = language;
    }
  }

  function commitLanguage(request, nextCatalogs) {
    assertSupportedLanguage(request.language, nextCatalogs);
    if (request.version !== languageVersion) {
      return false;
    }
    const changed = language !== request.language;
    language = request.language;
    requestedLanguage = request.language;
    if (changed) {
      dispatchLanguageUpdate(language);
    }
    return true;
  }

  function scheduleCatalogLanguageCommit(request) {
    const requestLoadVersion = loadVersion;
    const completion = Promise.resolve()
      .then(() => {
        if (requestLoadVersion !== loadVersion) {
          return latestLoad ?? catalogs;
        }
        commitLanguage(request, catalogs);
        return catalogs;
      })
      .catch(error => {
        if (requestLoadVersion === loadVersion) {
          restoreRequestedLanguage(request);
        }
        throw normalizeLoadError(error);
      });
    const observedCompletion = observeRejection(completion);
    loadUrlResourcesComplete = observedCompletion;
    return observedCompletion;
  }

  function loadUrlResources(url = localesHost) {
    const requestVersion = ++loadVersion;
    const requestLanguage = requestedLanguage;
    let requestUrl;
    try {
      requestUrl = assertLocalesHost(url);
      if (requestUrl.trim().length === 0 || typeof fetchImpl !== 'function') {
        throw academyError('ACADEMY_I18N_INVALID_INPUT');
      }
    } catch (error) {
      pendingLoadVersion = undefined;
      const rejected = observeRejection(Promise.reject(error));
      latestLoad = rejected;
      loadUrlResourcesComplete = rejected;
      return rejected;
    }
    pendingLoadVersion = requestVersion;
    const request = Promise.resolve()
      .then(() => fetchImpl(requestUrl))
      .then(normalizeResponse)
      .then(nextCatalogs => {
        const copiedCatalogs = assertCatalogs(nextCatalogs);
        const responseLanguage = requestVersion === loadVersion ? requestedLanguage : requestLanguage;
        assertSupportedLanguage(responseLanguage, copiedCatalogs);
        if (requestVersion === loadVersion) {
          catalogs = copiedCatalogs;
          language = responseLanguage;
          requestedLanguage = responseLanguage;
          pendingLoadVersion = undefined;
          dispatchLanguageUpdate(language);
        }
        return copiedCatalogs;
      })
      .catch(error => {
        const normalizedError = normalizeLoadError(error);
        if (requestVersion === loadVersion && normalizedError.code === 'ACADEMY_I18N_UNSUPPORTED_LANGUAGE') {
          requestedLanguage = language;
        }
        if (requestVersion === loadVersion) {
          pendingLoadVersion = undefined;
        }
        throw normalizedError;
      });
    const observedRequest = observeRejection(request);
    latestLoad = observedRequest;
    loadUrlResourcesComplete = observedRequest;
    return observedRequest;
  }

  function setLanguage(nextLanguage) {
    let request;
    try {
      request = requestLanguage(nextLanguage);
    } catch (error) {
      const rejected = observeRejection(Promise.reject(error));
      loadUrlResourcesComplete = rejected;
      return rejected;
    }
    if (catalogs !== undefined && pendingLoadVersion !== loadVersion) {
      return scheduleCatalogLanguageCommit(request);
    }
    const completion = latestLoad ?? loadUrlResources();
    completion.catch(() => {
      if (catalogs === undefined) {
        restoreRequestedLanguage(request);
      }
    });
    loadUrlResourcesComplete = completion;
    return completion;
  }

  const intlMsg = {
    get lang() {
      return requestedLanguage;
    },
    set lang(nextLanguage) {
      const request = requestLanguage(nextLanguage);
      if (catalogs !== undefined && pendingLoadVersion !== loadVersion) {
        scheduleCatalogLanguageCommit(request).catch(() => {});
      }
    },
    get localesHost() {
      return localesHost;
    },
    set localesHost(nextLocalesHost) {
      localesHost = assertLocalesHost(nextLocalesHost);
      if (localesHost.trim().length > 0) {
        loadUrlResources();
      }
    },
    get forTesting() {
      return forTesting;
    },
    set forTesting(nextForTesting) {
      if (typeof nextForTesting !== 'boolean') {
        throw academyError('ACADEMY_I18N_INVALID_INPUT');
      }
      forTesting = nextForTesting;
    },
    get loadUrlResourcesComplete() {
      return loadUrlResourcesComplete;
    },
    loadUrlResources,
    setLanguage,
    t(key, params = {}) {
      if (typeof key !== 'string' || key.length === 0) {
        throw academyError('ACADEMY_I18N_INVALID_INPUT');
      }
      const catalog = catalogs?.[language];
      const message = catalog?.[key];
      if (typeof message !== 'string') {
        return key;
      }
      const values = assertParams(params);
      return message.replace(/\\{([A-Za-z0-9_]+)\\}/g, (_placeholder, name) => {
        const value = values[name];
        return value === undefined || value === null ? '' : String(value);
      });
    }
  };

  globalThis.IntlMsg = intlMsg;
  if (catalogs === undefined && localesHost.trim().length > 0) {
    loadUrlResources();
  }
  return intlMsg;
}
`;
