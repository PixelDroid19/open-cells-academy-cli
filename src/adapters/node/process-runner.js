import { spawn } from 'node:child_process';
import { stat } from 'node:fs/promises';
import path from 'node:path';

import { ProcessPort } from '../../ports/processes.js';
import { typedError } from '../../domain/workspace-session.js';

const DEFAULT_OUTPUT_LIMIT_BYTES = 1_048_576;
const DEFAULT_TERMINATE_GRACE_MS = 250;
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
  return Object.freeze({
    file,
    args: Object.freeze(args),
    cwd,
    env: Object.freeze(copyEnvironment(request.env ?? {})),
    stdin: request.stdin,
    signal: request.signal,
    timeoutMs: requireMilliseconds(request.timeoutMs, 'timeoutMs', undefined),
    terminateGraceMs: requireMilliseconds(request.terminateGraceMs, 'terminateGraceMs', defaults.terminateGraceMs),
    outputLimitBytes: requireMilliseconds(request.outputLimitBytes, 'outputLimitBytes', defaults.outputLimitBytes)
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

/**
 * Spawns direct children only. POSIX operations retain their independently
 * owned process-group id until final settlement; Windows falls back to the
 * exact direct child because portable process-group signaling is unavailable.
 * Portable Node has no pidfd/cgroup handle, so group-ID reuse between the
 * final liveness check and signal remains a sub-syscall POSIX boundary. The
 * saved PGID comes only from this adapter's detached spawn, never a request.
 */
export class NodeProcessRunner extends ProcessPort {
  #outputLimitBytes;
  #terminateGraceMs;
  #ownedGroupOperations;

  constructor({
    outputLimitBytes = DEFAULT_OUTPUT_LIMIT_BYTES,
    terminateGraceMs = DEFAULT_TERMINATE_GRACE_MS,
    ownedGroupOperations = DEFAULT_OWNED_GROUP_OPERATIONS
  } = {}) {
    super();
    this.#outputLimitBytes = requireMilliseconds(outputLimitBytes, 'outputLimitBytes', DEFAULT_OUTPUT_LIMIT_BYTES);
    this.#terminateGraceMs = requireMilliseconds(terminateGraceMs, 'terminateGraceMs', DEFAULT_TERMINATE_GRACE_MS);
    this.#ownedGroupOperations = validateOwnedGroupOperations(ownedGroupOperations);
    Object.freeze(this);
  }

  async run(request) {
    const prepared = validateRequest(request, {
      outputLimitBytes: this.#outputLimitBytes,
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
      const captured = { bytes: 0, limit: prepared.outputLimitBytes };
      const stdout = [];
      const stderr = [];
      const usesGroup = process.platform !== 'win32';
      let child;
      let ownedPgid;
      let settled = false;
      let closeResult;
      let timeout;
      let killTimer;
      let forcedFailure;
      let abortHandler;
      let childError;
      let finalizing = false;

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
        if (killTimer !== undefined) {
          clearTimeout(killTimer);
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

      const signalOwned = signalName => {
        if (usesGroup) {
          if (!Number.isSafeInteger(ownedPgid) || ownedPgid <= 0) {
            return;
          }
          try {
            this.#ownedGroupOperations.signal(-ownedPgid, signalName);
          } catch (cause) {
            if (cause?.code !== 'ESRCH') {
              childError ??= cause;
            }
          }
          return;
        }
        if (Number.isSafeInteger(child?.pid) && child.pid > 0) {
          try {
            child.kill(signalName);
          } catch (cause) {
            if (cause?.code !== 'ESRCH') {
              childError ??= cause;
            }
          }
        }
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
              signalOwned('SIGKILL');
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
        }
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

      const beginTermination = failure => {
        if (forcedFailure !== undefined || settled) {
          return;
        }
        forcedFailure = failure;
        signalOwned('SIGTERM');
        killTimer = setTimeout(() => {
          void finalizeForcedTermination();
        }, prepared.terminateGraceMs);
      };

      const stdoutHandler = chunk => {
        if (appendCaptured(stdout, chunk, captured)) {
          beginTermination({ code: 'TOOL_FAILED', reason: 'OUTPUT_LIMIT' });
        }
      };
      const stderrHandler = chunk => {
        if (appendCaptured(stderr, chunk, captured)) {
          beginTermination({ code: 'TOOL_FAILED', reason: 'OUTPUT_LIMIT' });
        }
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
          return;
        }
        const result = currentResult();
        if (childError !== undefined) {
          settle(typedError('TOOL_FAILED', { file: prepared.file, result }, childError), result);
          return;
        }
        settle(undefined, result);
      };

      abortHandler = () => beginTermination({ code: 'INTERRUPTED', reason: 'ABORTED' });
      if (prepared.signal !== undefined) {
        prepared.signal.addEventListener('abort', abortHandler, { once: true });
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
      if (prepared.timeoutMs !== undefined) {
        timeout = setTimeout(() => beginTermination({ code: 'INTERRUPTED', reason: 'TIMEOUT' }), prepared.timeoutMs);
      }
      child.stdin.end(prepared.stdin);
    });
  }
}
