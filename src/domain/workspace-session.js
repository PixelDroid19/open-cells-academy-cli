/**
 * An expected, machine-readable failure for workspace and filesystem policy.
 * User-facing rendering is deliberately mapped later from `code`.
 */
export class AcademyCliError extends Error {
  constructor(code, { details = undefined, cause = undefined } = {}) {
    super(code, cause === undefined ? undefined : { cause });
    this.name = 'AcademyCliError';
    this.code = code;
    if (details !== undefined) {
      this.details = immutableCopy(details);
    }
  }
}

export function typedError(code, details = undefined, cause = undefined) {
  return new AcademyCliError(code, { details, cause });
}

export function hasSystemCode(error, code) {
  return error !== null && typeof error === 'object' && error.code === code;
}

function immutableCopy(value, seen = new WeakMap()) {
  if (value === null || typeof value !== 'object') {
    return value;
  }

  if (seen.has(value)) {
    return seen.get(value);
  }

  if (Array.isArray(value)) {
    const copy = [];
    seen.set(value, copy);
    for (const item of value) {
      copy.push(immutableCopy(item, seen));
    }
    return Object.freeze(copy);
  }

  const copy = {};
  seen.set(value, copy);
  for (const [key, item] of Object.entries(value)) {
    copy[key] = immutableCopy(item, seen);
  }
  return Object.freeze(copy);
}

function requireFilesystem(filesystem) {
  const required = ['resolvePath', 'joinPath', 'lstat', 'realpath', 'readFile', 'pathHasSymlink'];
  if (filesystem === null || typeof filesystem !== 'object' || required.some(method => typeof filesystem[method] !== 'function')) {
    throw typedError('WORKSPACE_FILESYSTEM_INVALID');
  }
}

function metadataFromJson(contents) {
  let parsed;
  try {
    parsed = JSON.parse(contents);
  } catch (cause) {
    throw typedError('WORKSPACE_PACKAGE_INVALID', undefined, cause);
  }

  if (parsed === null || Array.isArray(parsed) || typeof parsed !== 'object') {
    throw typedError('WORKSPACE_PACKAGE_INVALID');
  }
  return immutableCopy(parsed);
}

function sameIdentity(left, right) {
  return left.dev === right.dev && left.ino === right.ino;
}

async function assertPathHasNoSymlink(candidate, filesystem) {
  try {
    if (await filesystem.pathHasSymlink(candidate)) {
      throw typedError('WORKSPACE_SYMLINK');
    }
  } catch (cause) {
    if (cause instanceof AcademyCliError) {
      throw cause;
    }
    throw typedError('WORKSPACE_INVALID', undefined, cause);
  }
}

async function canonicalDirectory(cwd, filesystem) {
  requireFilesystem(filesystem);
  if (typeof cwd !== 'string' || cwd.length === 0) {
    throw typedError('WORKSPACE_INVALID');
  }

  let requestedRoot;
  try {
    requestedRoot = filesystem.resolvePath(cwd);
  } catch (cause) {
    throw typedError('WORKSPACE_INVALID', undefined, cause);
  }

  let rootStat;
  try {
    rootStat = await filesystem.lstat(requestedRoot);
  } catch (cause) {
    if (hasSystemCode(cause, 'ENOENT')) {
      throw typedError('WORKSPACE_NOT_FOUND', undefined, cause);
    }
    throw typedError('WORKSPACE_INVALID', undefined, cause);
  }

  if (rootStat.isSymbolicLink()) {
    throw typedError('WORKSPACE_SYMLINK');
  }
  if (!rootStat.isDirectory()) {
    throw typedError('WORKSPACE_NOT_DIRECTORY');
  }

  const initialIdentity = Object.freeze({ dev: rootStat.dev, ino: rootStat.ino });
  await assertPathHasNoSymlink(requestedRoot, filesystem);

  let canonicalRoot;
  try {
    canonicalRoot = await filesystem.realpath(requestedRoot);
  } catch (cause) {
    throw typedError('WORKSPACE_INVALID', undefined, cause);
  }

  let currentRootStat;
  try {
    currentRootStat = await filesystem.lstat(requestedRoot);
  } catch (cause) {
    throw typedError('WORKSPACE_INVALID', undefined, cause);
  }
  if (currentRootStat.isSymbolicLink()) {
    throw typedError('WORKSPACE_SYMLINK');
  }
  if (!currentRootStat.isDirectory() || !sameIdentity(initialIdentity, currentRootStat)) {
    throw typedError('WORKSPACE_INVALID');
  }

  await assertPathHasNoSymlink(requestedRoot, filesystem);

  let currentCanonicalRoot;
  try {
    currentCanonicalRoot = await filesystem.realpath(requestedRoot);
  } catch (cause) {
    throw typedError('WORKSPACE_INVALID', undefined, cause);
  }
  if (currentCanonicalRoot !== canonicalRoot) {
    throw typedError('WORKSPACE_INVALID');
  }

  let canonicalRootStat;
  try {
    canonicalRootStat = await filesystem.lstat(currentCanonicalRoot);
  } catch (cause) {
    throw typedError('WORKSPACE_INVALID', undefined, cause);
  }
  if (canonicalRootStat.isSymbolicLink()) {
    throw typedError('WORKSPACE_SYMLINK');
  }
  if (!canonicalRootStat.isDirectory() || !sameIdentity(initialIdentity, canonicalRootStat)) {
    throw typedError('WORKSPACE_INVALID');
  }

  return Object.freeze({
    canonical: canonicalRoot,
    identity: Object.freeze({ dev: canonicalRootStat.dev, ino: canonicalRootStat.ino })
  });
}

/**
 * Canonical, immutable workspace boundary. It deliberately accepts an
 * injected filesystem port so domain code never reaches for process.cwd() or
 * Node's filesystem globals.
 */
export class WorkspaceSession {
  #root;
  #packageMetadata;
  #rootIdentity;

  constructor(root, packageMetadata, rootIdentity) {
    this.#root = root;
    this.#packageMetadata = packageMetadata;
    this.#rootIdentity = rootIdentity;
    Object.freeze(this);
  }

  get root() {
    return this.#root;
  }

  get packageMetadata() {
    return this.#packageMetadata;
  }

  /**
   * Immutable `dev`/`ino` identity of the root directory captured when the
   * session opened. Transactional publication anchors against this identity so
   * a same-path root replacement is detected instead of followed.
   */
  get rootIdentity() {
    return this.#rootIdentity;
  }

  /**
   * @param {string} cwd
   * @param {{resolvePath: Function, joinPath: Function, lstat: Function, realpath: Function, readFile: Function, pathHasSymlink: Function}} filesystem
   * @returns {Promise<WorkspaceSession>}
   */
  static async open(cwd, filesystem) {
    const resolved = await canonicalDirectory(cwd, filesystem);
    const root = resolved.canonical;

    const packagePath = filesystem.joinPath(root, 'package.json');
    let packageStat;
    try {
      packageStat = await filesystem.lstat(packagePath);
    } catch (cause) {
      if (hasSystemCode(cause, 'ENOENT')) {
        throw typedError('WORKSPACE_PACKAGE_MISSING', undefined, cause);
      }
      throw typedError('WORKSPACE_PACKAGE_INVALID', undefined, cause);
    }

    if (packageStat.isSymbolicLink() || !packageStat.isFile()) {
      throw typedError('WORKSPACE_PACKAGE_INVALID');
    }

    let contents;
    try {
      contents = await filesystem.readFile(packagePath, 'utf8');
    } catch (cause) {
      throw typedError('WORKSPACE_PACKAGE_INVALID', undefined, cause);
    }

    return new WorkspaceSession(root, metadataFromJson(contents), resolved.identity);
  }

  /**
   * Opens a canonical directory boundary for scaffold creation. Creation does
   * not need parent package metadata, but retains the same directory and
   * symlink checks as an existing workspace session.
   *
   * @param {string} cwd
   * @param {{resolvePath: Function, joinPath: Function, lstat: Function, realpath: Function, readFile: Function, pathHasSymlink: Function}} filesystem
   * @returns {Promise<WorkspaceSession>}
   */
  static async openDirectory(cwd, filesystem) {
    const resolved = await canonicalDirectory(cwd, filesystem);
    return new WorkspaceSession(resolved.canonical, Object.freeze({}), resolved.identity);
  }
}
