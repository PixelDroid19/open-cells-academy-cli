import { spawn } from 'node:child_process';

import { typedError } from '../../domain/workspace-session.js';

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);

function safeLocalHttpUrl(value) {
  if (typeof value !== 'string' || /[\u0000-\u001f\u007f]/.test(value)) {
    return null;
  }
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== 'http:' || parsed.username || parsed.password || !LOCAL_HOSTS.has(parsed.hostname)) {
      return null;
    }
    return parsed.href;
  } catch {
    return null;
  }
}

function openerCommand(platform, url) {
  if (platform === 'darwin') {
    return { file: 'open', args: [url], detached: true };
  }
  if (platform === 'win32') {
    return { file: 'rundll32.exe', args: ['url.dll,FileProtocolHandler', url], detached: false };
  }
  if (platform === 'linux') {
    return { file: 'xdg-open', args: [url], detached: true };
  }
  throw typedError('TUI_URL_OPENER_UNAVAILABLE', { platform });
}

function waitForSpawn(child) {
  if (child === null || typeof child !== 'object' || typeof child.once !== 'function') {
    return Promise.reject(typedError('TUI_URL_OPEN_FAILED'));
  }
  return new Promise((resolve, reject) => {
    child.once('spawn', resolve);
    child.once('error', reject);
  });
}

/**
 * Opens a ready local HTTP server without invoking a shell.
 * @param {object} options
 * @returns {(url: string) => Promise<string>}
 */
export function createUrlOpener({ platform = process.platform, spawnProcess = spawn } = {}) {
  if (typeof spawnProcess !== 'function') {
    throw typedError('INVALID_INPUT', { field: 'spawnProcess' });
  }
  return async url => {
    const safeUrl = safeLocalHttpUrl(url);
    if (safeUrl === null) {
      throw typedError('UNSAFE_TUI_URL');
    }
    const command = openerCommand(platform, safeUrl);
    let child;
    try {
      child = spawnProcess(command.file, command.args, {
        detached: command.detached,
        shell: false,
        stdio: 'ignore',
        windowsHide: true
      });
      await waitForSpawn(child);
    } catch (cause) {
      if (cause?.code === 'UNSAFE_TUI_URL' || cause?.code === 'TUI_URL_OPENER_UNAVAILABLE') {
        throw cause;
      }
      throw typedError('TUI_URL_OPEN_FAILED', undefined, cause);
    }
    if (typeof child.unref === 'function') {
      child.unref();
    }
    return safeUrl;
  };
}
