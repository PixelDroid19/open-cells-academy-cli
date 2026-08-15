function immutableCopy(value, seen = new WeakMap()) {
  if (value === null || typeof value !== 'object') {
    return value;
  }

  if (seen.has(value)) {
    return seen.get(value);
  }

  if (value instanceof Error) {
    return value;
  }

  const copy = Array.isArray(value) ? [] : {};
  seen.set(value, copy);

  for (const [key, item] of Object.entries(value)) {
    copy[key] = immutableCopy(item, seen);
  }

  return Object.freeze(copy);
}

function immutableMessages(messages) {
  if (!Array.isArray(messages)) {
    throw new TypeError('Outcome messages must be an array');
  }

  return Object.freeze(
    messages.map(message => {
      if (typeof message === 'string') {
        return Object.freeze({ key: message, params: Object.freeze({}) });
      }

      if (message === null || typeof message !== 'object' || typeof message.key !== 'string') {
        throw new TypeError('Each outcome message must have a string key');
      }

      return Object.freeze({
        key: message.key,
        params: immutableCopy(message.params ?? {})
      });
    })
  );
}

/**
 * Creates a successful application outcome with immutable data and messages.
 *
 * @param {unknown} [data]
 * @param {Array<{key: string, params?: Record<string, unknown>} | string>} [messages]
 * @returns {{ok: true, data: unknown, messages: readonly {key: string, params: Record<string, unknown>}[]}}
 */
export function ok(data = undefined, messages = []) {
  return Object.freeze({
    ok: true,
    data: immutableCopy(data),
    messages: immutableMessages(messages)
  });
}

/**
 * Creates an expected failure outcome. The cause is retained for diagnostics,
 * while user-visible rendering is driven only by catalog keys.
 *
 * @param {string} code
 * @param {string} messageKey
 * @param {Record<string, unknown>} [params]
 * @param {string | undefined} [remediationKey]
 * @param {unknown} [cause]
 * @returns {{ok: false, code: string, messageKey: string, params: Record<string, unknown>, remediationKey: string | undefined, cause: unknown}}
 */
export function fail(code, messageKey, params = {}, remediationKey = undefined, cause = undefined) {
  return Object.freeze({
    ok: false,
    code,
    messageKey,
    params: immutableCopy(params),
    remediationKey,
    cause
  });
}
