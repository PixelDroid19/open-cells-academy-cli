import { normalizeRelativePath } from './path-policy.js';
import { typedError } from './workspace-session.js';

const DEPENDENCY_KINDS = new Set(['runtime', 'dev', 'optional', 'peer']);
const SAFE_FILE_MODES = new Set([0o600, 0o640, 0o644, 0o700, 0o750, 0o755]);

function normalizePlanPath(value) {
  return normalizeRelativePath(value).join('/');
}

function cloneByteContent(value) {
  if (value instanceof ArrayBuffer) {
    return new Uint8Array(value.slice(0));
  }
  if (ArrayBuffer.isView(value) && !(value instanceof DataView)) {
    return new Uint8Array(value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength));
  }
  return undefined;
}

function normalizeContent(content) {
  if (typeof content === 'string') {
    return { kind: 'string', value: content };
  }
  const bytes = cloneByteContent(content);
  if (bytes !== undefined) {
    return { kind: 'bytes', value: bytes };
  }
  throw typedError('FILE_CONTENT_INVALID');
}

function cloneStoredFile(file) {
  return {
    path: file.path,
    kind: file.kind,
    value: file.kind === 'bytes' ? new Uint8Array(file.value) : file.value,
    mode: file.mode
  };
}

function fileSnapshot(file) {
  const snapshot = {
    path: file.path,
    content: file.kind === 'bytes' ? new Uint8Array(file.value) : file.value
  };
  if (file.mode !== undefined) {
    snapshot.mode = file.mode;
  }
  return Object.freeze(snapshot);
}

function sameContent(left, right) {
  if (left.kind !== right.kind || left.mode !== right.mode) {
    return false;
  }
  if (left.kind === 'string') {
    return left.value === right.value;
  }
  if (left.value.length !== right.value.length) {
    return false;
  }
  return left.value.every((byte, index) => byte === right.value[index]);
}

function isAncestor(ancestor, child) {
  return child.startsWith(`${ancestor}/`);
}

function normalizedMode(options) {
  if (options === undefined) {
    return undefined;
  }
  if (options === null || typeof options !== 'object' || Object.keys(options).some(key => key !== 'mode')) {
    throw typedError('FILE_MODE_INVALID');
  }
  if (!Object.hasOwn(options, 'mode')) {
    return undefined;
  }
  if (!SAFE_FILE_MODES.has(options.mode)) {
    throw typedError('FILE_MODE_INVALID');
  }
  return options.mode;
}

function normalizeDependency(name, version, kind) {
  if (
    typeof name !== 'string' ||
    name.length === 0 ||
    name.trim() !== name ||
    /[\u0000-\u001f\u007f]/.test(name) ||
    typeof version !== 'string' ||
    version.length === 0 ||
    version.trim() !== version
  ) {
    throw typedError('DEPENDENCY_INVALID');
  }
  const resolvedKind = kind ?? 'runtime';
  if (!DEPENDENCY_KINDS.has(resolvedKind)) {
    throw typedError('DEPENDENCY_INVALID');
  }
  return Object.freeze({ name, version, kind: resolvedKind });
}

function sorted(values, compare = undefined) {
  return [...values].sort(compare);
}

/**
 * Immutable declaration of directories, files and package dependencies. Its
 * snapshots are defensive so byte data cannot be mutated through a plan.
 */
export class ScaffoldPlan {
  #directories;
  #files;
  #dependencies;

  constructor({ directories = [], files = [], dependencies = [] } = {}) {
    this.#directories = Object.freeze(sorted(new Set(directories)));
    this.#files = Object.freeze(sorted(files.map(cloneStoredFile), (left, right) => left.path.localeCompare(right.path)));
    this.#dependencies = Object.freeze(
      sorted(dependencies.map(dependency => ({ ...dependency })), (left, right) => left.name.localeCompare(right.name))
    );
    Object.freeze(this);
  }

  static empty() {
    return new ScaffoldPlan();
  }

  /**
   * Produces an adapter-safe snapshot from this class's private slots. The
   * `instanceof` check excludes lookalikes and the private field access rejects
   * subclasses that do not carry a real ScaffoldPlan brand.
   */
  static snapshot(plan) {
    if (!(plan instanceof ScaffoldPlan)) {
      throw typedError('PLAN_INVALID');
    }
    try {
      return Object.freeze({
        directories: Object.freeze(plan.#directories.map(directory => normalizePlanPath(directory))),
        files: Object.freeze(
          plan.#files.map(file => {
            const content = normalizeContent(file.kind === 'bytes' ? new Uint8Array(file.value) : file.value);
            const mode = file.mode === undefined ? undefined : normalizedMode({ mode: file.mode });
            return Object.freeze({ path: normalizePlanPath(file.path), content: content.kind === 'bytes' ? new Uint8Array(content.value) : content.value, mode });
          })
        )
      });
    } catch (cause) {
      if (cause?.code !== undefined) {
        throw cause;
      }
      throw typedError('PLAN_INVALID', undefined, cause);
    }
  }

  get directories() {
    return Object.freeze([...this.#directories]);
  }

  get files() {
    return Object.freeze(this.#files.map(fileSnapshot));
  }

  get dependencies() {
    return Object.freeze(this.#dependencies.map(dependency => Object.freeze({ ...dependency })));
  }

  #with({ directories = this.#directories, files = this.#files, dependencies = this.#dependencies }) {
    return new ScaffoldPlan({ directories, files, dependencies });
  }

  addDirectory(relativePath) {
    const directory = normalizePlanPath(relativePath);
    if (this.#directories.includes(directory)) {
      return this;
    }
    if (this.#files.some(file => file.path === directory || isAncestor(file.path, directory))) {
      throw typedError('PLAN_CONFLICT');
    }
    return this.#with({ directories: [...this.#directories, directory] });
  }

  addFile(relativePath, content, options = undefined) {
    const path = normalizePlanPath(relativePath);
    const candidate = { path, ...normalizeContent(content), mode: normalizedMode(options) };
    const exact = this.#files.find(file => file.path === path);
    if (exact !== undefined) {
      if (sameContent(exact, candidate)) {
        return this;
      }
      throw typedError('PLAN_CONFLICT');
    }
    if (
      this.#directories.includes(path) ||
      this.#directories.some(directory => isAncestor(path, directory)) ||
      this.#files.some(file => isAncestor(file.path, path) || isAncestor(path, file.path))
    ) {
      throw typedError('PLAN_CONFLICT');
    }
    return this.#with({ files: [...this.#files, candidate] });
  }

  addDependency(name, version, kind = undefined) {
    const candidate = normalizeDependency(name, version, kind);
    const exact = this.#dependencies.find(dependency => dependency.name === candidate.name);
    if (exact !== undefined) {
      if (exact.version === candidate.version && exact.kind === candidate.kind) {
        return this;
      }
      throw typedError('PLAN_CONFLICT');
    }
    return this.#with({ dependencies: [...this.#dependencies, candidate] });
  }

  merge(other) {
    if (!(other instanceof ScaffoldPlan)) {
      throw typedError('PLAN_INVALID');
    }
    let merged = this;
    for (const directory of other.#directories) {
      merged = merged.addDirectory(directory);
    }
    for (const file of other.#files) {
      merged = merged.addFile(file.path, file.kind === 'bytes' ? new Uint8Array(file.value) : file.value, file.mode === undefined ? undefined : { mode: file.mode });
    }
    for (const dependency of other.#dependencies) {
      merged = merged.addDependency(dependency.name, dependency.version, dependency.kind);
    }
    return merged;
  }
}
