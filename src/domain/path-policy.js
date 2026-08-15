import { hasSystemCode, typedError } from './workspace-session.js';

function isWindowsAbsolute(value) {
  return /^[A-Za-z]:/.test(value) || /^[\\/]{2}/.test(value);
}

/**
 * Normalizes a logical path only after rejecting every representation that can
 * hide a traversal on a different host platform.
 *
 * @param {string} relativePath
 * @returns {readonly string[]}
 */
export function normalizeRelativePath(relativePath) {
  if (typeof relativePath !== 'string' || relativePath.length === 0) {
    throw typedError('PATH_INVALID');
  }
  if (relativePath.includes('\u0000') || /[\u0001-\u001f\u007f]/.test(relativePath)) {
    throw typedError('PATH_INVALID');
  }
  if (relativePath.startsWith('/') || isWindowsAbsolute(relativePath) || relativePath.includes('\\')) {
    throw typedError('PATH_INVALID');
  }

  const segments = relativePath.split('/');
  if (segments.some(segment => segment.length === 0 || segment === '.' || segment === '..')) {
    throw typedError('PATH_INVALID');
  }

  return Object.freeze(segments);
}

function assertFilesystem(filesystem) {
  const required = ['joinPath', 'lstat', 'realpath', 'isPathWithin'];
  if (filesystem === null || typeof filesystem !== 'object' || required.some(method => typeof filesystem[method] !== 'function')) {
    throw typedError('PATH_FILESYSTEM_INVALID');
  }
}

function assertSession(session) {
  if (session === null || typeof session !== 'object' || typeof session.root !== 'string' || session.root.length === 0) {
    throw typedError('WORKSPACE_INVALID');
  }
}

function isSamePath(left, right) {
  return left === right;
}

/**
 * Validates a project directory name separately from npm package metadata.
 * Scoped package names intentionally do not qualify as a child directory.
 */
export function validateProjectName(name) {
  if (
    typeof name !== 'string' ||
    name.length === 0 ||
    name.trim() !== name ||
    name === '.' ||
    name === '..' ||
    name.startsWith('@') ||
    name.includes('/') ||
    name.includes('\\') ||
    name.includes('\u0000') ||
    /[\u0001-\u001f\u007f]/.test(name) ||
    !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(name)
  ) {
    throw typedError('PROJECT_NAME_INVALID');
  }
  return name;
}

/**
 * Resolves user-supplied logical paths against a fixed WorkspaceSession.
 */
export class PathPolicy {
  #session;
  #filesystem;

  constructor(session, filesystem) {
    assertSession(session);
    assertFilesystem(filesystem);
    this.#session = session;
    this.#filesystem = filesystem;
    Object.freeze(this);
  }

  async #nearestExisting(segments) {
    let candidate = this.#session.root;
    for (let index = 0; index < segments.length; index += 1) {
      const next = this.#filesystem.joinPath(candidate, segments[index]);
      try {
        await this.#filesystem.lstat(next);
      } catch (cause) {
        if (hasSystemCode(cause, 'ENOENT')) {
          return { existing: candidate, remaining: segments.slice(index) };
        }
        throw typedError('PATH_INVALID', undefined, cause);
      }
      candidate = next;
    }
    return { existing: candidate, remaining: [] };
  }

  async #containedTarget(segments, { mustExist }) {
    const nearest = await this.#nearestExisting(segments);
    let canonicalExisting;
    try {
      canonicalExisting = await this.#filesystem.realpath(nearest.existing);
    } catch (cause) {
      throw typedError('PATH_INVALID', undefined, cause);
    }

    if (!this.#filesystem.isPathWithin(this.#session.root, canonicalExisting)) {
      throw typedError('PATH_OUTSIDE_WORKSPACE');
    }

    if (mustExist && nearest.remaining.length > 0) {
      throw typedError('PATH_NOT_FOUND');
    }

    const target =
      nearest.remaining.length === 0
        ? canonicalExisting
        : this.#filesystem.joinPath(canonicalExisting, ...nearest.remaining);

    if (!this.#filesystem.isPathWithin(this.#session.root, target)) {
      throw typedError('PATH_OUTSIDE_WORKSPACE');
    }
    return target;
  }

  async resolveRead(relativePath) {
    return this.#containedTarget(normalizeRelativePath(relativePath), { mustExist: true });
  }

  async resolveWrite(relativePath) {
    return this.#containedTarget(normalizeRelativePath(relativePath), { mustExist: false });
  }

  async resolveDestructive(relativePath) {
    if (relativePath === '.') {
      throw typedError('DESTRUCTIVE_ROOT');
    }
    const target = await this.#containedTarget(normalizeRelativePath(relativePath), { mustExist: true });
    if (isSamePath(target, this.#session.root)) {
      throw typedError('DESTRUCTIVE_ROOT');
    }
    return target;
  }
}
