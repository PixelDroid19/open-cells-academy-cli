import { constants, access, readdir } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const CACHE_BROWSER_NAMES = Object.freeze(['chrome', 'chromium', 'headless_shell']);
const PATH_CANDIDATES = Object.freeze(['chromium', 'chromium-browser', 'google-chrome', 'google-chrome-stable']);

async function isExecutable(file) {
  if (typeof file !== 'string' || file.length === 0) return false;
  try {
    await access(file, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

async function findBrowserInTree(root, depth) {
  if (depth <= 0) return undefined;
  let entries;
  try {
    entries = await readdir(root, { withFileTypes: true });
  } catch {
    return undefined;
  }
  for (const entry of entries) {
    const candidate = path.join(root, entry.name);
    if (entry.isFile() && CACHE_BROWSER_NAMES.includes(entry.name) && (await isExecutable(candidate))) {
      return candidate;
    }
  }
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name === 'node_modules') continue;
    const found = await findBrowserInTree(path.join(root, entry.name), depth - 1);
    if (found !== undefined) return found;
  }
  return undefined;
}

async function findInPlaywrightCache(env) {
  const home = env.HOME ?? env.USERPROFILE ?? os.homedir();
  if (typeof home !== 'string' || home.length === 0) return undefined;
  const cacheRoot = path.join(home, '.cache', 'ms-playwright');
  let entries;
  try {
    entries = await readdir(cacheRoot, { withFileTypes: true });
  } catch {
    return undefined;
  }
  for (const entry of entries) {
    if (!entry.isDirectory() || !entry.name.startsWith('chromium')) continue;
    const found = await findBrowserInTree(path.join(cacheRoot, entry.name), 3);
    if (found !== undefined) return found;
  }
  return undefined;
}

function pathDirectories(env) {
  const raw = env.PATH ?? env.Path ?? '';
  if (typeof raw !== 'string' || raw.length === 0) return [];
  return raw.split(path.delimiter).filter(directory => directory.length > 0);
}

async function findOnPath(env) {
  for (const directory of pathDirectories(env)) {
    for (const name of PATH_CANDIDATES) {
      const candidate = path.join(directory, name);
      if (await isExecutable(candidate)) return candidate;
    }
  }
  return undefined;
}

function playwrightExecutablePath(createRequireFrom, candidateRoot) {
  try {
    const require = createRequireFrom(path.join(candidateRoot, 'package.json'));
    const playwrightCore = require('playwright-core');
    const executable = playwrightCore?.chromium?.executablePath?.();
    return typeof executable === 'string' && executable.length > 0 ? executable : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Detection-only Chromium probe for the testing capability. It reports whether
 * a Chromium executable is already present (explicit path, Playwright cache, or
 * system PATH) and never downloads or installs a browser.
 */
export class ChromiumProbe {
  #candidateRoot;
  #createRequireFrom;
  #env;

  constructor({ candidateRoot, createRequireFrom, env = process.env } = {}) {
    if (typeof candidateRoot !== 'string' || candidateRoot.length === 0) throw new TypeError('Invalid Chromium probe candidate root');
    if (typeof createRequireFrom !== 'function') throw new TypeError('Invalid Chromium probe require factory');
    this.#candidateRoot = candidateRoot;
    this.#createRequireFrom = createRequireFrom;
    this.#env = env;
    Object.freeze(this);
  }

  async chromiumLocation({ executablePath } = {}) {
    if (typeof executablePath === 'string' && executablePath.length > 0) {
      return (await isExecutable(executablePath)) ? executablePath : undefined;
    }
    if (typeof this.#env.CHROMIUM_EXECUTABLE === 'string' && (await isExecutable(this.#env.CHROMIUM_EXECUTABLE))) {
      return this.#env.CHROMIUM_EXECUTABLE;
    }
    const playwrightPath = playwrightExecutablePath(this.#createRequireFrom, this.#candidateRoot);
    if (playwrightPath !== undefined && (await isExecutable(playwrightPath))) {
      return playwrightPath;
    }
    const cached = await findInPlaywrightCache(this.#env);
    if (cached !== undefined) return cached;
    return findOnPath(this.#env);
  }

  async chromiumAvailable(options = {}) {
    return (await this.chromiumLocation(options)) !== undefined;
  }
}
