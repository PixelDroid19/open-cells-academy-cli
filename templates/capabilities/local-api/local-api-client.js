export const localApiClientSource = `const RESOURCE_PATHS = Object.freeze({
  account: 'account',
  courses: 'courses',
  lessons: 'lessons',
  movements: 'movements'
});

const MODES = new Set(['success', 'error', 'delayed']);
const localErrors = new WeakSet();

function createError(code, message, name = 'AcademyLocalApiError') {
  const error = new Error(message);
  error.name = name;
  error.code = code;
  localErrors.add(error);
  return error;
}

function abortError() {
  return createError('ACADEMY_LOCAL_API_ABORTED', 'Local API request was aborted.', 'AbortError');
}

function assertPlainObject(value, code, message) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw createError(code, message);
  }
}

function resolveFetch(fetchImpl) {
  const implementation = fetchImpl === undefined ? globalThis.fetch : fetchImpl;
  if (typeof implementation !== 'function') {
    throw createError('ACADEMY_LOCAL_API_INVALID_FETCH', 'Local API fetch implementation is invalid.');
  }
  return fetchImpl === undefined ? implementation.bind(globalThis) : implementation;
}

function resolveBaseUrl(baseUrl) {
  if (typeof baseUrl !== 'string' || baseUrl.length === 0 || baseUrl.trim() !== baseUrl) {
    throw createError('ACADEMY_LOCAL_API_INVALID_BASE_URL', 'Local API base URL is invalid.');
  }
  try {
    const url = new URL(baseUrl);
    const loopbackHosts = new Set(['127.0.0.1', 'localhost', '[::1]']);
    if (!['http:', 'https:'].includes(url.protocol) || !loopbackHosts.has(url.hostname) || url.username !== '' || url.password !== '') {
      throw new TypeError('Unsupported local API base URL');
    }
    return url.origin;
  } catch {
    throw createError('ACADEMY_LOCAL_API_INVALID_BASE_URL', 'Local API base URL is invalid.');
  }
}

function resolveInput(input) {
  assertPlainObject(input, 'ACADEMY_LOCAL_API_INVALID_REQUEST', 'Local API request is invalid.');
  if (Object.keys(input).some(key => key !== 'resource' && key !== 'mode')) {
    throw createError('ACADEMY_LOCAL_API_INVALID_REQUEST', 'Local API request is invalid.');
  }
  if (typeof input.resource !== 'string' || !Object.hasOwn(RESOURCE_PATHS, input.resource)) {
    throw createError('ACADEMY_LOCAL_API_UNSUPPORTED_RESOURCE', 'Local API resource is not supported.');
  }
  if (typeof input.mode !== 'string' || !MODES.has(input.mode)) {
    throw createError('ACADEMY_LOCAL_API_UNSUPPORTED_MODE', 'Local API mode is not supported.');
  }
  return Object.freeze({ resource: input.resource, mode: input.mode });
}

function resolveSignal(options) {
  if (options === undefined) {
    return undefined;
  }
  assertPlainObject(options, 'ACADEMY_LOCAL_API_INVALID_OPTIONS', 'Local API request options are invalid.');
  if (Object.keys(options).some(key => key !== 'signal')) {
    throw createError('ACADEMY_LOCAL_API_INVALID_OPTIONS', 'Local API request options are invalid.');
  }
  const signal = options.signal;
  if (signal !== undefined && (signal === null || typeof signal !== 'object' || typeof signal.aborted !== 'boolean')) {
    throw createError('ACADEMY_LOCAL_API_INVALID_SIGNAL', 'Local API abort signal is invalid.');
  }
  return signal;
}

function isAbort(error, signal) {
  return signal?.aborted === true || error?.name === 'AbortError';
}

function parseResponse(response, signal) {
  if (signal?.aborted === true) {
    throw abortError();
  }
  if (response === null || typeof response !== 'object' || typeof response.ok !== 'boolean') {
    throw createError('ACADEMY_LOCAL_API_MALFORMED_RESPONSE', 'Local API response was malformed.');
  }
  if (!response.ok) {
    throw createError('ACADEMY_LOCAL_API_HTTP_ERROR', 'Local API request failed.');
  }
  if (typeof response.json !== 'function') {
    throw createError('ACADEMY_LOCAL_API_MALFORMED_RESPONSE', 'Local API response was malformed.');
  }
  return Promise.resolve(response.json()).then(
    data => {
      if (signal?.aborted === true) {
        throw abortError();
      }
      if (data === undefined) {
        throw createError('ACADEMY_LOCAL_API_MALFORMED_RESPONSE', 'Local API response was malformed.');
      }
      return data;
    },
    error => {
      if (isAbort(error, signal)) {
        throw abortError();
      }
      throw createError('ACADEMY_LOCAL_API_MALFORMED_RESPONSE', 'Local API response was malformed.');
    }
  );
}

export function createLocalApiRequest({ fetchImpl, baseUrl } = {}) {
  const requestFetch = resolveFetch(fetchImpl);
  const origin = resolveBaseUrl(baseUrl);

  return Object.freeze(function requestLocalApi(input, options = undefined) {
    const request = resolveInput(input);
    const signal = resolveSignal(options);
    if (signal?.aborted === true) {
      return Promise.reject(abortError());
    }
    const url = new URL('/fixtures/local-api/' + RESOURCE_PATHS[request.resource], origin);
    url.searchParams.set('mode', request.mode);
    return Promise.resolve()
      .then(() => requestFetch(url.href, { method: 'GET', signal }))
      .then(response => parseResponse(response, signal))
      .catch(error => {
        if (localErrors.has(error)) {
          throw error;
        }
        if (isAbort(error, signal)) {
          throw abortError();
        }
        throw createError('ACADEMY_LOCAL_API_REQUEST_FAILED', 'Local API request failed.');
      });
  });
}
`;
