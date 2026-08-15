function deepFreeze(value, seen = new WeakSet()) {
  if (value === null || typeof value !== 'object' || seen.has(value)) {
    return value;
  }

  seen.add(value);
  for (const key of Reflect.ownKeys(value)) {
    deepFreeze(value[key], seen);
  }
  return Object.freeze(value);
}

const OPTION_TYPES = new Set(['string', 'number', 'json', 'jsonOrPath', 'boolean']);

function normalizeOption(option) {
  if (option === null || typeof option !== 'object') {
    throw new TypeError('A command option must be an object');
  }

  if (!Array.isArray(option.aliases) || option.aliases.length === 0) {
    throw new TypeError(`Option ${option.name ?? '<unknown>'} needs at least one alias`);
  }

  if (!OPTION_TYPES.has(option.type)) {
    throw new TypeError(`Option ${option.name ?? '<unknown>'} has an unsupported type`);
  }

  const normalized = {
    name: option.name,
    aliases: [...option.aliases],
    type: option.type,
    required: Boolean(option.required)
  };

  if (Object.hasOwn(option, 'defaultValue')) {
    normalized.defaultValue = option.defaultValue;
  }

  if (option.choices !== undefined) {
    normalized.choices = [...option.choices];
  }

  return deepFreeze(normalized);
}

/**
 * Builds one immutable command grammar record.
 *
 * @param {{name: string, summaryKey: string, options: object[], requiresWorkspace: boolean, execute?: unknown}} definition
 * @returns {Readonly<object>}
 */
export function defineCommand(definition) {
  if (definition === null || typeof definition !== 'object') {
    throw new TypeError('A command definition must be an object');
  }

  if (typeof definition.name !== 'string' || definition.name.length === 0) {
    throw new TypeError('A command definition needs a name');
  }

  if (typeof definition.summaryKey !== 'string' || definition.summaryKey.length === 0) {
    throw new TypeError(`Command ${definition.name} needs a summary key`);
  }

  const options = (definition.options ?? []).map(normalizeOption);
  const aliases = new Set();
  for (const option of options) {
    for (const alias of option.aliases) {
      if (aliases.has(alias)) {
        throw new TypeError(`Command ${definition.name} declares ${alias} more than once`);
      }
      aliases.add(alias);
    }
  }

  return deepFreeze({
    name: definition.name,
    summaryKey: definition.summaryKey,
    options,
    requiresWorkspace: Boolean(definition.requiresWorkspace),
    execute: definition.execute ?? null
  });
}

/**
 * Creates a structural ReadonlyMap whose backing store is not reachable by
 * callers. Mutation methods deliberately throw instead of becoming no-ops.
 *
 * @template K, V
 * @param {Iterable<[K, V]>} entries
 * @returns {ReadonlyMap<K, V>}
 */
export function createReadonlyMap(entries) {
  const source = new Map(entries);
  let view;

  view = {
    get size() {
      return source.size;
    },
    get(key) {
      return source.get(key);
    },
    has(key) {
      return source.has(key);
    },
    entries() {
      return source.entries();
    },
    keys() {
      return source.keys();
    },
    values() {
      return source.values();
    },
    forEach(callback, thisArg) {
      source.forEach((value, key) => callback.call(thisArg, value, key, view));
    },
    [Symbol.iterator]() {
      return source[Symbol.iterator]();
    },
    set() {
      throw new TypeError('Command registries are read-only');
    },
    delete() {
      throw new TypeError('Command registries are read-only');
    },
    clear() {
      throw new TypeError('Command registries are read-only');
    }
  };

  return Object.freeze(view);
}

export { deepFreeze };
