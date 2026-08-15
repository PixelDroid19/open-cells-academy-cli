export const dataManagerSource = `function frozenState(status, fields = {}) {
  return Object.freeze({ status, ...fields });
}

function cloneData(value) {
  const serialized = JSON.stringify(value);
  if (serialized === undefined) {
    throw new TypeError('Data must be JSON-compatible');
  }
  return deepFreeze(JSON.parse(serialized));
}

function deepFreeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) {
      deepFreeze(child);
    }
    Object.freeze(value);
  }
  return value;
}

function safeError(error) {
  return Object.freeze({
    name: 'AcademyDataRequestError',
    message: 'Request failed'
  });
}

function isAbort(error, signal) {
  return signal.aborted || error?.name === 'AbortError';
}

function assertSuccessfulResponse(data) {
  if (data && typeof data === 'object' && data.ok === false) {
    const error = new Error('Request failed');
    error.name = 'AcademyDataRequestError';
    throw error;
  }
  return data;
}

function assertAbortSignal(signal) {
  if (
    signal !== undefined &&
    (
      signal === null ||
      typeof signal !== 'object' ||
      typeof signal.aborted !== 'boolean' ||
      typeof signal.addEventListener !== 'function' ||
      typeof signal.removeEventListener !== 'function'
    )
  ) {
    throw new TypeError('signal must be an AbortSignal');
  }
}

export function createDataManager({ request, publish } = {}) {
  if (typeof request !== 'function') {
    throw new TypeError('request must be a function');
  }
  if (publish !== undefined && typeof publish !== 'function') {
    throw new TypeError('publish must be a function');
  }

  let current = null;
  let disposed = false;
  let state = frozenState('idle');

  function setState(next) {
    state = next;
    publish?.(next);
  }

  function settle(active, result, { publish = true } = {}) {
    if (active.settled) return false;
    active.settled = true;
    active.signal?.removeEventListener('abort', active.onAbort);
    active.resolve(result);
    if (current?.token !== active.token) return true;
    current = null;
    if (publish) setState(result);
    return true;
  }

  function abortCurrent(reason, { publish = true } = {}) {
    if (!current) return false;
    const active = current;
    active.controller.abort(reason);
    settle(active, frozenState('aborted'), { publish });
    return true;
  }

  function cancel(reason) {
    abortCurrent(reason);
  }

  function load(input, { signal } = {}) {
    if (disposed) {
      const error = new Error('Data manager has been disposed');
      error.code = 'ACADEMY_DATA_MANAGER_DISPOSED';
      throw error;
    }
    assertAbortSignal(signal);
    abortCurrent('superseded', { publish: false });
    const controller = new AbortController();
    const token = {};
    let resolve;
    const resultPromise = new Promise(nextResolve => {
      resolve = nextResolve;
    });
    const active = {
      token,
      controller,
      onAbort: null,
      resolve,
      settled: false,
      signal
    };
    const onAbort = () => {
      abortCurrent(signal.reason);
    };
    active.onAbort = onAbort;
    current = active;
    setState(frozenState('loading'));
    if (signal?.aborted) {
      abortCurrent(signal.reason);
      return resultPromise;
    }
    signal?.addEventListener('abort', onAbort, { once: true });

    void Promise.resolve()
      .then(() => request(input, { signal: controller.signal }))
      .then(data => {
        if (active.settled) return;
        if (current?.token !== token || controller.signal.aborted) {
          settle(active, frozenState('aborted'), { publish: false });
          return;
        }
        const result = frozenState('success', { data: cloneData(assertSuccessfulResponse(data)) });
        settle(active, result);
      })
      .catch(error => {
        if (active.settled) return;
        const result = isAbort(error, controller.signal)
          ? frozenState('aborted')
          : frozenState('error', { error: safeError(error) });
        settle(active, result, { publish: current?.token === token });
      });
    return resultPromise;
  }

  function dispose() {
    if (!disposed) {
      disposed = true;
      const transitioned = abortCurrent('disposed');
      current = null;
      if (!transitioned) setState(frozenState('aborted'));
    }
  }

  return Object.freeze({
    get state() {
      return state;
    },
    load,
    cancel,
    dispose
  });
}
`;
