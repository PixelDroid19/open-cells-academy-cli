import { spawn } from 'node:child_process';
import { stat } from 'node:fs/promises';
import path from 'node:path';

import { ProcessPort } from '../../ports/processes.js';
import { typedError } from '../../domain/workspace-session.js';

const DEFAULT_OUTPUT_LIMIT_BYTES = 1_048_576;
const DEFAULT_INTERRUPT_GRACE_MS = 500;
const DEFAULT_TERMINATE_GRACE_MS = 500;
const GROUP_CHECK_INTERVAL_MS = 10;
const GROUP_CHECK_ATTEMPTS = 20;
const ENVIRONMENT_KEY = /^[A-Za-z_][A-Za-z0-9_]*$/;

function containsInvalidText(value) {
  return value.includes('\u0000') || /[\u0001-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value);
}

function requireText(value, field, { allowEmpty = false } = {}) {
  if (typeof value !== 'string' || (!allowEmpty && value.length === 0) || containsInvalidText(value)) {
    throw typedError('INVALID_INPUT', { field });
  }
  return value;
}

function requireMilliseconds(value, field, fallback) {
  if (value === undefined) {
    return fallback;
  }
  if (!Number.isSafeInteger(value) || value < 0) {
    throw typedError('INVALID_INPUT', { field });
  }
  return value;
}

function optionalCallback(value, field) {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== 'function') {
    throw typedError('INVALID_INPUT', { field });
  }
  return value;
}

function notify(callback, value) {
  if (callback === undefined) {
    return;
  }
  try {
    callback(value);
  } catch {
    // Observer failures must not alter the lifecycle of an owned child process.
  }
}

function copyEnvironment(environment) {
  if (environment === null || typeof environment !== 'object' || Array.isArray(environment)) {
    throw typedError('INVALID_INPUT', { field: 'env' });
  }
  const copied = {};
  for (const [key, value] of Object.entries(environment)) {
    if (!ENVIRONMENT_KEY.test(key) || typeof value !== 'string' || containsInvalidText(value)) {
      throw typedError('INVALID_INPUT', { field: 'env' });
    }
    copied[key] = value;
  }
  return copied;
}

function validateRequest(request, defaults) {
  if (request === null || typeof request !== 'object' || Array.isArray(request)) {
    throw typedError('INVALID_INPUT', { field: 'request' });
  }
  const file = requireText(request.file, 'file');
  if (!Array.isArray(request.args) && request.args !== undefined) {
    throw typedError('INVALID_INPUT', { field: 'args' });
  }
  const args = (request.args ?? []).map((argument, index) => requireText(argument, `args[${index}]`, { allowEmpty: true }));
  const cwd = requireText(request.cwd, 'cwd');
  if (!path.isAbsolute(cwd)) {
    throw typedError('INVALID_INPUT', { field: 'cwd' });
  }
  if (request.stdio !== undefined && request.stdio !== 'pipe') {
    throw typedError('INVALID_INPUT', { field: 'stdio' });
  }
  if (request.stdin !== undefined && typeof request.stdin !== 'string' && !(request.stdin instanceof Uint8Array)) {
    throw typedError('INVALID_INPUT', { field: 'stdin' });
  }
  if (typeof request.stdin === 'string' && containsInvalidText(request.stdin)) {
    throw typedError('INVALID_INPUT', { field: 'stdin' });
  }
  if (request.signal !== undefined && (request.signal === null || typeof request.signal.addEventListener !== 'function')) {
    throw typedError('INVALID_INPUT', { field: 'signal' });
  }
  const terminateGraceMs = requireMilliseconds(request.terminateGraceMs, 'terminateGraceMs', defaults.terminateGraceMs);
  return Object.freeze({
    file,
    args: Object.freeze(args),
    cwd,
    env: Object.freeze(copyEnvironment(request.env ?? {})),
    stdin: request.stdin,
    signal: request.signal,
    timeoutMs: requireMilliseconds(request.timeoutMs, 'timeoutMs', undefined),
    interruptGraceMs: requireMilliseconds(request.interruptGraceMs, 'interruptGraceMs', request.terminateGraceMs ?? defaults.interruptGraceMs),
    terminateGraceMs,
    outputLimitBytes: requireMilliseconds(request.outputLimitBytes, 'outputLimitBytes', defaults.outputLimitBytes),
    isServer: request.isServer === true,
    onStart: optionalCallback(request.onStart, 'onStart'),
    onOutput: optionalCallback(request.onOutput, 'onOutput')
  });
}

function freezeResult({ exitCode = null, signal = null, stdout = '', stderr = '', durationMs }) {
  return Object.freeze({
    exitCode: Number.isSafeInteger(exitCode) ? exitCode : null,
    signal: typeof signal === 'string' ? signal : null,
    stdout,
    stderr,
    durationMs: Math.max(0, Math.round(durationMs))
  });
}

function appendCaptured(chunks, chunk, state) {
  const next = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
  state.bytes += next.length;
  if (state.bytes <= state.limit) {
    chunks.push(next);
    return false;
  }
  const remaining = Math.max(0, state.limit - (state.bytes - next.length));
  if (remaining > 0) {
    chunks.push(next.subarray(0, remaining));
  }
  return true;
}

function appendRollingCaptured(chunks, chunk, state) {
  const next = Buffer.from(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  if (next.length >= state.limit) {
    for (const entry of state.entries) {
      entry.chunks.length = 0;
    }
    state.entries.length = 0;
    state.bytes = 0;
    const retained = Buffer.from(next.subarray(next.length - state.limit));
    chunks.push(retained);
    state.entries.push({ chunks, buffer: retained });
    state.bytes = retained.length;
    return;
  }

  chunks.push(next);
  state.entries.push({ chunks, buffer: next });
  state.bytes += next.length;
  while (state.bytes > state.limit && state.entries.length > 0) {
    const oldest = state.entries[0];
    const excess = state.bytes - state.limit;
    const index = oldest.chunks.indexOf(oldest.buffer);
    if (index === -1) {
      state.entries.shift();
      continue;
    }
    if (oldest.buffer.length <= excess) {
      oldest.chunks.splice(index, 1);
      state.bytes -= oldest.buffer.length;
      state.entries.shift();
      continue;
    }
    const retained = Buffer.from(oldest.buffer.subarray(excess));
    oldest.chunks[index] = retained;
    oldest.buffer = retained;
    state.bytes -= excess;
  }
}

function isMissingExecutable(cause, file) {
  return cause?.code === 'ENOENT' && (cause.path === undefined || cause.path === file);
}

function delay(milliseconds) {
  return new Promise(resolve => setTimeout(resolve, milliseconds));
}

const DEFAULT_OWNED_GROUP_OPERATIONS = Object.freeze({
  exists(pgid) {
    try {
      process.kill(pgid, 0);
      return true;
    } catch (cause) {
      if (cause?.code === 'ESRCH') {
        return false;
      }
      throw cause;
    }
  },
  signal(pgid, signalName) {
    process.kill(pgid, signalName);
  }
});

const DEFAULT_WINDOWS_TREE_OPERATIONS = Object.freeze({
  terminate(pid) {
    if (!Number.isSafeInteger(pid) || pid <= 0) {
      return Promise.reject(typedError('INVALID_INPUT', { field: 'ownedPid' }));
    }
    return new Promise((resolve, reject) => {
      let taskkill;
      let settled = false;
      const finish = callback => value => {
        if (settled) return;
        settled = true;
        callback(value);
      };
      try {
        taskkill = spawn('taskkill.exe', ['/PID', String(pid), '/T', '/F'], {
          shell: false,
          stdio: 'ignore',
          windowsHide: true
        });
      } catch (cause) {
        reject(cause);
        return;
      }
      taskkill.once('error', finish(reject));
      taskkill.once('close', finish(exitCode => {
        if (exitCode === 0) {
          resolve();
          return;
        }
        reject(typedError('TOOL_FAILED', { reason: 'WINDOWS_TREE_CLEANUP_FAILED', exitCode }));
      }));
    });
  }
});

function validateOwnedGroupOperations(operations) {
  if (
    operations === null ||
    typeof operations !== 'object' ||
    Array.isArray(operations) ||
    typeof operations.exists !== 'function' ||
    typeof operations.signal !== 'function'
  ) {
    throw typedError('INVALID_INPUT', { field: 'ownedGroupOperations' });
  }
  return operations;
}

function validateWindowsTreeOperations(operations) {
  if (
    operations === null ||
    typeof operations !== 'object' ||
    Array.isArray(operations) ||
    typeof operations.terminate !== 'function'
  ) {
    throw typedError('INVALID_INPUT', { field: 'windowsTreeOperations' });
  }
  return operations;
}

function validatePlatform(platform) {
  if (typeof platform !== 'string' || platform.length === 0 || containsInvalidText(platform)) {
    throw typedError('INVALID_INPUT', { field: 'platform' });
  }
  return platform;
}

/**
 * Spawns direct children only. POSIX operations retain their independently
 * owned process-group id until final settlement. On Windows, cooperative
 * direct-child signals escalate to an injected taskkill tree operation that
 * receives only the PID created by this adapter. A leader that exits also
 * waits for that owned-tree operation before final settlement.
 * Portable Node has no pidfd/cgroup handle, so group-ID reuse between the
 * final liveness check and signal remains a sub-syscall POSIX boundary. The
 * saved PGID comes only from this adapter's detached spawn, never a request.
 */
export class NodeProcessRunner extends ProcessPort {
  #outputLimitBytes;
  #interruptGraceMs;
  #terminateGraceMs;
  #ownedGroupOperations;
  #windowsTreeOperations;
  #platform;

  constructor({
    outputLimitBytes = DEFAULT_OUTPUT_LIMIT_BYTES,
    interruptGraceMs,
    terminateGraceMs = DEFAULT_TERMINATE_GRACE_MS,
    ownedGroupOperations = DEFAULT_OWNED_GROUP_OPERATIONS,
    windowsTreeOperations = DEFAULT_WINDOWS_TREE_OPERATIONS,
    platform = process.platform
  } = {}) {
    super();
    this.#outputLimitBytes = requireMilliseconds(outputLimitBytes, 'outputLimitBytes', DEFAULT_OUTPUT_LIMIT_BYTES);
    this.#terminateGraceMs = requireMilliseconds(terminateGraceMs, 'terminateGraceMs', DEFAULT_TERMINATE_GRACE_MS);
    this.#interruptGraceMs = requireMilliseconds(interruptGraceMs, 'interruptGraceMs', this.#terminateGraceMs);
    this.#ownedGroupOperations = validateOwnedGroupOperations(ownedGroupOperations);
    this.#windowsTreeOperations = validateWindowsTreeOperations(windowsTreeOperations);
    this.#platform = validatePlatform(platform);
    Object.freeze(this);
  }

  async run(request) {
    const prepared = validateRequest(request, {
      outputLimitBytes: this.#outputLimitBytes,
      interruptGraceMs: this.#interruptGraceMs,
      terminateGraceMs: this.#terminateGraceMs
    });
    if (prepared.signal?.aborted) {
      throw typedError('INTERRUPTED', { reason: 'ABORTED' });
    }
    try {
      const cwdStat = await stat(prepared.cwd);
      if (!cwdStat.isDirectory()) {
        throw typedError('TOOL_FAILED', { reason: 'CWD_INVALID' });
      }
    } catch (cause) {
      if (cause?.code === 'TOOL_FAILED') {
        throw cause;
      }
      throw typedError('TOOL_FAILED', { reason: 'CWD_INVALID' }, cause);
    }

    return new Promise((resolve, reject) => {
      const startedAt = performance.now();
      const captured = { bytes: 0, limit: prepared.outputLimitBytes, entries: [] };
      const stdout = [];
      const stderr = [];
      const usesGroup = this.#platform !== 'win32';
      let child;
      let ownedPgid;
      let settled = false;
      let closeResult;
      let timeout;
      let interruptTimer;
      let terminateTimer;
      let forcedFailure;
      let abortHandler;
      let childError;
      let finalizing = false;
      let directChildOwned = false;
      let ownedWindowsPid;

      const currentResult = () =>
        freezeResult({
          exitCode: closeResult?.exitCode ?? null,
          signal: closeResult?.signal ?? null,
          stdout: Buffer.concat(stdout).toString('utf8'),
          stderr: Buffer.concat(stderr).toString('utf8'),
          durationMs: performance.now() - startedAt
        });

      const cleanup = () => {
        if (timeout !== undefined) {
          clearTimeout(timeout);
        }
        if (interruptTimer !== undefined) {
          clearTimeout(interruptTimer);
        }
        if (terminateTimer !== undefined) {
          clearTimeout(terminateTimer);
        }
        if (prepared.signal !== undefined && abortHandler !== undefined) {
          prepared.signal.removeEventListener('abort', abortHandler);
        }
        if (child !== undefined) {
          child.stdout?.removeListener('data', stdoutHandler);
          child.stderr?.removeListener('data', stderrHandler);
          child.stdin?.removeListener('error', stdinErrorHandler);
          child.removeListener('error', childErrorHandler);
          child.removeListener('close', closeHandler);
        }
      };

      const settle = (error, result = currentResult()) => {
        if (settled) {
          return;
        }
        settled = true;
        cleanup();
        if (error !== undefined) {
          reject(error);
        } else {
          resolve(result);
        }
      };

      const groupExists = () => {
        if (!usesGroup || !Number.isSafeInteger(ownedPgid) || ownedPgid <= 0) {
          return false;
        }
        const exists = this.#ownedGroupOperations.exists(-ownedPgid);
        if (typeof exists !== 'boolean') {
          throw typedError('TOOL_FAILED', { reason: 'OWNED_GROUP_CLEANUP_FAILED' });
        }
        return exists;
      };

      const signalOwned = async signalName => {
        if (usesGroup) {
          if (!Number.isSafeInteger(ownedPgid) || ownedPgid <= 0) {
            return false;
          }
          try {
            this.#ownedGroupOperations.signal(-ownedPgid, signalName);
          } catch (cause) {
            if (cause?.code !== 'ESRCH') {
              childError ??= cause;
            }
          }
          return true;
        }
        if (!directChildOwned || !Number.isSafeInteger(child?.pid) || child.pid <= 0) {
          if (signalName === 'SIGKILL') {
            throw typedError('TOOL_FAILED', { reason: 'WINDOWS_TREE_OWNERSHIP_LOST' });
          }
          return false;
        }
        try {
          if (signalName === 'SIGKILL') {
            await this.#windowsTreeOperations.terminate(child.pid);
          } else {
            child.kill(signalName);
          }
        } catch (cause) {
          if (cause?.code !== 'ESRCH') {
            childError ??= cause;
            throw cause;
          }
        }
        return true;
      };

      const finalizeWindowsClose = async result => {
        if (settled) {
          return;
        }
        if (!directChildOwned || !Number.isSafeInteger(ownedWindowsPid) || ownedWindowsPid <= 0) {
          settle(typedError('TOOL_FAILED', { reason: 'WINDOWS_TREE_OWNERSHIP_LOST', result }), result);
          return;
        }
        try {
          await this.#windowsTreeOperations.terminate(ownedWindowsPid);
        } catch (cause) {
          settle(typedError('TOOL_FAILED', { reason: 'WINDOWS_TREE_CLEANUP_FAILED', result }, cause), result);
          return;
        }
        directChildOwned = false;
        if (forcedFailure !== undefined) {
          settleForcedFailure();
          return;
        }
        if (childError !== undefined) {
          settle(typedError('TOOL_FAILED', { file: prepared.file, result }, childError), result);
          return;
        }
        settle(undefined, result);
      };

      const settleForcedFailure = cleanupFailure => {
        const result = currentResult();
        if (cleanupFailure !== undefined) {
          const code = forcedFailure.code === 'INTERRUPTED' ? 'INTERRUPTED' : 'TOOL_FAILED';
          settle(
            typedError(
              code,
              { reason: forcedFailure.reason, cleanupReason: 'OWNED_GROUP_CLEANUP_FAILED', result },
              cleanupFailure
            ),
            result
          );
          return;
        }
        settle(typedError(forcedFailure.code, { reason: forcedFailure.reason, result }, forcedFailure.cause), result);
      };

      const finalizeForcedTermination = async () => {
        if (finalizing || settled || forcedFailure === undefined) {
          return;
        }
        finalizing = true;
        let cleanupFailure;
        if (usesGroup) {
          try {
            if (groupExists()) {
              await signalOwned('SIGKILL');
            }
          } catch (cause) {
            cleanupFailure = cause;
          }
          for (let attempt = 0; attempt < GROUP_CHECK_ATTEMPTS; attempt += 1) {
            try {
              if (!groupExists()) {
                break;
              }
            } catch (cause) {
              cleanupFailure = cause;
              break;
            }
            await delay(GROUP_CHECK_INTERVAL_MS);
          }
          try {
            if (groupExists()) {
              cleanupFailure ??= typedError('TOOL_FAILED', { reason: 'OWNED_GROUP_CLEANUP_FAILED' });
            }
          } catch (cause) {
            cleanupFailure ??= cause;
          }
        } else {
          try {
            await signalOwned('SIGKILL');
          } catch (cause) {
            cleanupFailure ??= cause;
          }
          cleanupFailure ??= childError;
        }
        settleForcedFailure(cleanupFailure);
      };

      const escalateToTerminate = () => {
        if (settled || forcedFailure === undefined) {
          return;
        }
        if (usesGroup) {
          try {
            if (!groupExists()) {
              settleForcedFailure();
              return;
            }
          } catch (cause) {
            settleForcedFailure(cause);
            return;
          }
        }
        void signalOwned('SIGTERM').catch(cause => {
          childError ??= cause;
        });
        terminateTimer = setTimeout(() => {
          void finalizeForcedTermination();
        }, prepared.terminateGraceMs);
      };

      const beginTermination = failure => {
        if (forcedFailure !== undefined || settled) {
          return;
        }
        forcedFailure = failure;
        void signalOwned('SIGINT').catch(cause => {
          childError ??= cause;
        });
        interruptTimer = setTimeout(escalateToTerminate, prepared.interruptGraceMs);
      };

      const stdoutHandler = chunk => {
        const output = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        const exceeded = prepared.isServer
          ? (appendRollingCaptured(stdout, output, captured), false)
          : appendCaptured(stdout, output, captured);
        if (exceeded) {
          beginTermination({ code: 'TOOL_FAILED', reason: 'OUTPUT_LIMIT' });
        }
        notify(prepared.onOutput, Object.freeze({ stream: 'stdout', text: output.toString('utf8') }));
      };
      const stderrHandler = chunk => {
        const output = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        const exceeded = prepared.isServer
          ? (appendRollingCaptured(stderr, output, captured), false)
          : appendCaptured(stderr, output, captured);
        if (exceeded) {
          beginTermination({ code: 'TOOL_FAILED', reason: 'OUTPUT_LIMIT' });
        }
        notify(prepared.onOutput, Object.freeze({ stream: 'stderr', text: output.toString('utf8') }));
      };
      const stdinErrorHandler = cause => {
        beginTermination({ code: 'TOOL_FAILED', reason: 'STDIN_FAILED', cause });
      };
      const childErrorHandler = cause => {
        childError = cause;
        if (!Number.isSafeInteger(child?.pid)) {
          const code = isMissingExecutable(cause, prepared.file) ? 'TOOL_MISSING' : 'TOOL_FAILED';
          settle(typedError(code, { file: prepared.file }, cause));
        }
      };
      const closeHandler = (exitCode, signal) => {
        closeResult = { exitCode, signal };
        if (forcedFailure !== undefined) {
          directChildOwned = false;
          if (usesGroup) {
            try {
              if (!groupExists()) {
                settleForcedFailure();
              }
            } catch (cause) {
              settleForcedFailure(cause);
            }
          }
          return;
        }
        const result = currentResult();
        if (!usesGroup) {
          void finalizeWindowsClose(result);
          return;
        }
        directChildOwned = false;
        if (childError !== undefined) {
          settle(typedError('TOOL_FAILED', { file: prepared.file, result }, childError), result);
          return;
        }
        if (usesGroup) {
          try {
            if (groupExists()) {
              beginTermination({ code: 'TOOL_FAILED', reason: 'OWNED_GROUP_ORPHANED' });
              return;
            }
          } catch (cause) {
            settle(typedError('TOOL_FAILED', { reason: 'OWNED_GROUP_CLEANUP_FAILED', result }, cause), result);
            return;
          }
        }
        settle(undefined, result);
      };

      abortHandler = () => beginTermination({ code: 'INTERRUPTED', reason: 'ABORTED' });
      if (prepared.signal !== undefined) {
        prepared.signal.addEventListener('abort', abortHandler, { once: true });
        if (prepared.signal.aborted) {
          settle(typedError('INTERRUPTED', { reason: 'ABORTED' }));
          return;
        }
      }

      try {
        child = spawn(prepared.file, prepared.args, {
          cwd: prepared.cwd,
          env: prepared.env,
          shell: false,
          stdio: 'pipe',
          detached: usesGroup,
          windowsHide: true
        });
        if (usesGroup && Number.isSafeInteger(child.pid) && child.pid > 0) {
          ownedPgid = child.pid;
        }
        if (!usesGroup && Number.isSafeInteger(child.pid) && child.pid > 0) {
          directChildOwned = true;
          ownedWindowsPid = child.pid;
        }
      } catch (cause) {
        const code = isMissingExecutable(cause, prepared.file) ? 'TOOL_MISSING' : 'TOOL_FAILED';
        settle(typedError(code, { file: prepared.file }, cause));
        return;
      }

      child.stdout.on('data', stdoutHandler);
      child.stderr.on('data', stderrHandler);
      child.stdin.on('error', stdinErrorHandler);
      child.on('error', childErrorHandler);
      child.on('close', closeHandler);
      if (Number.isSafeInteger(child.pid) && child.pid > 0) {
        notify(prepared.onStart, Object.freeze({ pid: child.pid }));
      }
      if (prepared.timeoutMs !== undefined) {
        timeout = setTimeout(() => beginTermination({ code: 'INTERRUPTED', reason: 'TIMEOUT' }), prepared.timeoutMs);
      }
      child.stdin.end(prepared.stdin);
    });
  }
}
