import { TaskSupervisorPort } from '../../ports/task-supervisor.js';
import { createTask } from '../../domain/tui/task-state.js';
import { NodeProcessRunner } from './process-runner.js';
import { typedError } from '../../domain/workspace-session.js';

const ACTIVE_STATUSES = new Set(['starting', 'running', 'stopping']);
const PEM_BEGIN = /-----BEGIN [A-Z0-9 ]*(?:PRIVATE KEY|PUBLIC KEY|CERTIFICATE)-----/i;
const PEM_END = /-----END [A-Z0-9 ]*(?:PRIVATE KEY|PUBLIC KEY|CERTIFICATE)-----/i;
const MAX_PARTIAL_OUTPUT_BYTES = 16_384;
const STREAM_REDACTION_TAIL_BYTES = 4_096;
const PARTIAL_OUTPUT_MARKER = '[OUTPUT_TRUNCATED]';
const PASSWORD_ASSIGNMENT = /(password|passwd|pwd)\s*([=:])\s*/i;
const AUTHORIZATION_ASSIGNMENT = /(authorization|auth)\s*([=:])\s*(?:(?:basic|bearer|token)\s+)?/i;
const BEARER_PREFIX = /(Bearer)\s+/i;
const URL_AUTHORITY_START = /(https?:\/\/)([^/\s?#@]+):/i;
const MAX_URL_PORT_DIGITS = 5;

function isLocalPort(port) {
  return Number.isSafeInteger(port) && port > 0 && port <= 65_535;
}

function parseOwnedReadyLine(text, requestedPort) {
  const match = text.match(/^(?:Server ready|Servidor listo):\s*(https?:\/\/[^\s]+)\s*$/i);
  if (!match) {
    return null;
  }
  try {
    const url = new URL(match[1]);
    const hostname = url.hostname.toLowerCase();
    const port = Number(url.port);
    if (
      url.protocol !== 'http:' ||
      !['localhost', '127.0.0.1', '[::1]', '::1'].includes(hostname) ||
      !isLocalPort(port) ||
      (isLocalPort(requestedPort) && port !== requestedPort)
    ) {
      return null;
    }
    return Object.freeze({ url: url.href, port });
  } catch {
    return null;
  }
}

function parseHmrFile(text) {
  const match = text.match(/(?:hmr update|page reload)\s+([^\s]+)/i);
  return match ? match[1] : null;
}

function parseTestMetrics(text) {
  const passedMatch = text.match(/(\d+)\s+passed/i);
  const failMatch = text.match(/(\d+)\s+failed/i);
  const covMatch = text.match(/(?:All files|Coverage)[^%]*?(\d+(?:\.\d+)?)%/i);
  return {
    passed: passedMatch ? Number(passedMatch[1]) : undefined,
    failures: failMatch ? Number(failMatch[1]) : undefined,
    coveragePct: covMatch ? Number(covMatch[1]) : undefined
  };
}

function isActive(task) {
  return ACTIVE_STATUSES.has(task.status);
}

function writerGroupFor(request) {
  if (typeof request.writerGroup === 'string' && request.writerGroup.length > 0) {
    return request.writerGroup;
  }
  if (request.type === 'unit' || request.type === 'coverage' || request.type === 'e2e') {
    return 'test-output';
  }
  if (request.type === 'build') {
    return 'build-output';
  }
  if (request.type === 'locales' || request.type === 'documentation' || request.type === 'sass') {
    return 'workspace-artifacts';
  }
  if (request.type === 'install') {
    return 'dependencies';
  }
  if (request.type === 'create') {
    return 'scaffold';
  }
  if (request.type === 'changelog') {
    return 'changelog';
  }
  return null;
}

function emit(callback, value) {
  try {
    callback(value);
  } catch {
    // TUI observers are not allowed to strand an owned task.
  }
}

function createOutputBuffer() {
  return { chunks: [], bytes: 0 };
}

function drainOutputBuffer(buffer) {
  const text = buffer.chunks.join('');
  buffer.chunks.length = 0;
  buffer.bytes = 0;
  return text;
}

function splitUtf8Prefix(text, byteLimit) {
  if (Buffer.byteLength(text, 'utf8') <= byteLimit) {
    return { prefix: text, remainder: '' };
  }
  let lower = 0;
  let upper = Math.min(text.length, byteLimit);
  while (lower < upper) {
    const middle = Math.ceil((lower + upper) / 2);
    if (Buffer.byteLength(text.slice(0, middle), 'utf8') <= byteLimit) {
      lower = middle;
    } else {
      upper = middle - 1;
    }
  }
  let end = lower;
  if (end > 0 && end < text.length && /[\uD800-\uDBFF]/.test(text[end - 1]) && /[\uDC00-\uDFFF]/.test(text[end])) {
    end -= 1;
  }
  return { prefix: text.slice(0, end), remainder: text.slice(end) };
}

function flushOutputBuffer(buffer, handleLine, { truncated = false, endOfLine = false } = {}) {
  if (buffer.bytes === 0) {
    return;
  }
  const line = drainOutputBuffer(buffer);
  handleLine(line, { truncated, endOfLine });
}

function appendOutputSegment(buffer, segment, handleLine) {
  let remaining = segment;
  while (remaining.length > 0) {
    const capacity = MAX_PARTIAL_OUTPUT_BYTES - buffer.bytes;
    if (capacity <= 0) {
      flushOutputBuffer(buffer, handleLine, { truncated: true });
      continue;
    }
    const { prefix, remainder } = splitUtf8Prefix(remaining, capacity);
    if (prefix.length === 0) {
      flushOutputBuffer(buffer, handleLine, { truncated: true });
      continue;
    }
    buffer.chunks.push(prefix);
    buffer.bytes += Buffer.byteLength(prefix, 'utf8');
    remaining = remainder;
    if (buffer.bytes >= MAX_PARTIAL_OUTPUT_BYTES) {
      flushOutputBuffer(buffer, handleLine, { truncated: true });
    }
  }
}

function consumeOutput(buffer, text, handleLine) {
  let start = 0;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (character !== '\n' && character !== '\r') {
      continue;
    }
    appendOutputSegment(buffer, text.slice(start, index), handleLine);
    flushOutputBuffer(buffer, handleLine, { endOfLine: true });
    if (character === '\r' && text[index + 1] === '\n') {
      index += 1;
    }
    start = index + 1;
  }
  appendOutputSegment(buffer, text.slice(start), handleLine);
}

function splitUtf8Suffix(text, byteLimit) {
  const bytes = Buffer.byteLength(text, 'utf8');
  if (bytes <= byteLimit) {
    return { prefix: '', suffix: text };
  }
  const { prefix, remainder } = splitUtf8Prefix(text, bytes - byteLimit);
  return { prefix, suffix: remainder };
}

function createStreamRedactionState() {
  return { carry: '', mode: null };
}

function isIdentifierCharacter(value) {
  return typeof value === 'string' && /^[A-Za-z0-9_]$/.test(value);
}

function isSensitiveEnvironmentName(name) {
  const normalized = name.toLowerCase();
  return normalized.endsWith('token') ||
    normalized.endsWith('secret') ||
    normalized.endsWith('api_key') ||
    normalized.endsWith('private_key') ||
    normalized.endsWith('access_key');
}

function findSensitiveAssignment(text) {
  for (let separatorIndex = 0; separatorIndex < text.length; separatorIndex += 1) {
    const separator = text[separatorIndex];
    if (separator !== '=' && separator !== ':') {
      continue;
    }
    let nameEnd = separatorIndex;
    while (nameEnd > 0 && /\s/.test(text[nameEnd - 1])) {
      nameEnd -= 1;
    }
    let nameStart = nameEnd;
    const floor = Math.max(0, nameEnd - STREAM_REDACTION_TAIL_BYTES);
    while (nameStart > floor && isIdentifierCharacter(text[nameStart - 1])) {
      nameStart -= 1;
    }
    const name = text.slice(nameStart, nameEnd);
    if (!isSensitiveEnvironmentName(name)) {
      continue;
    }
    let valueStart = separatorIndex + 1;
    while (valueStart < text.length && /\s/.test(text[valueStart])) {
      valueStart += 1;
    }
    return { index: nameStart, end: valueStart, label: name, separator };
  }
  return null;
}

function candidateFromMatch(kind, match) {
  if (match === null) {
    return null;
  }
  return {
    kind,
    index: match.index,
    end: match.index + match[0].length,
    label: match[1],
    separator: match[2]
  };
}

function urlAuthorityCandidate(text) {
  const match = URL_AUTHORITY_START.exec(text);
  if (match === null) {
    return null;
  }
  return {
    kind: 'urlAuthority',
    index: match.index,
    end: match.index + match[0].length,
    scheme: match[1],
    authorityPrefix: match[0]
  };
}

function firstSensitiveMatch(text) {
  const candidates = [
    candidateFromMatch('pem', PEM_BEGIN.exec(text)),
    urlAuthorityCandidate(text),
    findSensitiveAssignment(text),
    candidateFromMatch('password', PASSWORD_ASSIGNMENT.exec(text)),
    candidateFromMatch('auth', AUTHORIZATION_ASSIGNMENT.exec(text)),
    candidateFromMatch('bearer', BEARER_PREFIX.exec(text))
  ].filter(candidate => candidate !== null);
  if (candidates.length === 0) {
    return null;
  }
  candidates.sort((left, right) => left.index - right.index);
  return candidates[0];
}

function consumeSecretValue(state, text, endOfLine) {
  const boundary = text.search(/[\s,;$<]/);
  if (boundary === -1) {
    if (endOfLine) {
      state.mode = null;
    }
    return '';
  }
  state.mode = null;
  return text.slice(boundary);
}

function consumePem(state, text) {
  const end = PEM_END.exec(text);
  if (end === null) {
    return '';
  }
  state.mode = null;
  return text.slice(end.index + end[0].length);
}

function consumeUrlAuthentication(state, text, endOfLine) {
  const authorityBoundary = text.indexOf('@');
  if (authorityBoundary === -1) {
    if (endOfLine) {
      state.mode = null;
    }
    return '';
  }
  state.mode = null;
  return text.slice(authorityBoundary);
}

function isUrlAuthorityTerminator(character) {
  return character === '/' || character === '?' || character === '#' || /\s/.test(character);
}

function clearUrlAuthority(state) {
  state.mode = null;
  state.urlAuthority = undefined;
}

function beginUrlAuthentication(state) {
  const { safePrefix, scheme } = state.urlAuthority;
  state.urlAuthority = undefined;
  state.mode = 'urlAuth';
  return `${safePrefix}${scheme}[REDACTED_AUTH]`;
}

function consumeUrlAuthority(state, text, endOfLine, emitSafe) {
  const candidate = state.urlAuthority;
  let port = candidate.port;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (character === '@') {
      emitSafe(beginUrlAuthentication(state));
      clearUrlAuthority(state);
      return text.slice(index);
    }
    if (isUrlAuthorityTerminator(character)) {
      emitSafe(`${candidate.safePrefix}${candidate.authorityPrefix}${port}${character}`);
      clearUrlAuthority(state);
      return text.slice(index + 1);
    }
    if (/\d/.test(character) && port.length < MAX_URL_PORT_DIGITS) {
      port += character;
      candidate.port = port;
      continue;
    }
    emitSafe(beginUrlAuthentication(state));
    return text.slice(index);
  }
  if (endOfLine) {
    emitSafe(`${candidate.safePrefix}${candidate.authorityPrefix}${port}`);
    clearUrlAuthority(state);
  }
  return '';
}

function redactStreamSegment(state, text, { endOfLine = false, truncated = false } = {}, emitSafe) {
  let remaining = `${state.carry}${text}`;
  state.carry = '';
  while (remaining.length > 0) {
    if (state.mode === 'pem') {
      remaining = consumePem(state, remaining);
      continue;
    }
    if (state.mode === 'secret') {
      remaining = consumeSecretValue(state, remaining, endOfLine);
      continue;
    }
    if (state.mode === 'urlAuthority') {
      remaining = consumeUrlAuthority(state, remaining, endOfLine, emitSafe);
      continue;
    }
    if (state.mode === 'urlAuth') {
      remaining = consumeUrlAuthentication(state, remaining, endOfLine);
      continue;
    }
    const candidate = firstSensitiveMatch(remaining);
    if (candidate === null) {
      if (endOfLine) {
        emitSafe(remaining);
      } else {
        const { prefix, suffix } = splitUtf8Suffix(remaining, STREAM_REDACTION_TAIL_BYTES);
        if (prefix.length > 0) {
          emitSafe(prefix);
        }
        state.carry = suffix;
      }
      remaining = '';
      continue;
    }
    const safePrefix = remaining.slice(0, candidate.index);
    if (safePrefix.length > 0 && candidate.kind !== 'urlAuthority') {
      emitSafe(safePrefix);
    }
    remaining = remaining.slice(candidate.end);
    if (candidate.kind === 'pem') {
      emitSafe('[REDACTED_PEM]');
      state.mode = 'pem';
      continue;
    }
    if (candidate.kind === 'urlAuthority') {
      // A colon after an authority can be either a bounded host port or the
      // first half of user-info. Keep at most five possible port digits; any
      // other continuation becomes a streaming auth candidate and is dropped
      // through its eventual `@` without retaining credential-sized output.
      state.mode = 'urlAuthority';
      state.urlAuthority = {
        scheme: candidate.scheme,
        authorityPrefix: candidate.authorityPrefix,
        safePrefix,
        port: ''
      };
      continue;
    }
    if (candidate.kind === 'auth') {
      emitSafe(`${candidate.label}${candidate.separator} [REDACTED_AUTH]`);
    } else if (candidate.kind === 'password') {
      emitSafe(`${candidate.label}${candidate.separator} [REDACTED_PASSWORD]`);
    } else if (candidate.kind === 'bearer') {
      emitSafe(`${candidate.label} [REDACTED_TOKEN]`);
    } else {
      emitSafe(`${candidate.label}${candidate.separator} [REDACTED_TOKEN]`);
    }
    state.mode = 'secret';
  }
  if (endOfLine) {
    state.carry = '';
    if (state.mode === 'secret') {
      state.mode = null;
    }
  }
  if (truncated) {
    emitSafe(PARTIAL_OUTPUT_MARKER);
  }
}

/**
 * Node.js adapter for supervising background processes in a TUI session.
 */
export class TaskSupervisor extends TaskSupervisorPort {
  #processRunner;
  #tasks;
  #onTaskUpdate;
  #onLog;
  #onHmrUpdate;
  #onTestMetrics;

  constructor({
    processRunner = new NodeProcessRunner(),
    onTaskUpdate = () => {},
    onLog = () => {},
    onHmrUpdate = () => {},
    onTestMetrics = () => {}
  } = {}) {
    super();
    this.#processRunner = processRunner;
    this.#tasks = new Map();
    this.#onTaskUpdate = onTaskUpdate;
    this.#onLog = onLog;
    this.#onHmrUpdate = onHmrUpdate;
    this.#onTestMetrics = onTestMetrics;
  }

  getTask(id) {
    return this.#tasks.get(id)?.task;
  }

  getAllTasks() {
    return [...this.#tasks.values()].map(entry => entry.task);
  }

  getActiveServer() {
    for (const entry of this.#tasks.values()) {
      if (entry.task.type === 'serve' && isActive(entry.task)) {
        return entry.task;
      }
    }
    return null;
  }

  async startTask(request) {
    if (request.type === 'serve') {
      const activeServer = this.getActiveServer();
      if (activeServer) {
        throw typedError('SERVER_ALREADY_RUNNING', {
          message: `A server is already running with PID ${activeServer.pid} at ${activeServer.url || 'http://127.0.0.1:' + (activeServer.port || 8001)}`
        });
      }
    }

    const writerGroup = writerGroupFor(request);
    if (writerGroup !== null) {
      const conflict = [...this.#tasks.values()].find(entry => entry.writerGroup === writerGroup && isActive(entry.task));
      if (conflict) {
        throw typedError('TASK_CONFLICT', {
          taskType: request.type,
          writerGroup,
          activeTaskId: conflict.task.id
        });
      }
    }

    const id = request.id ?? `${request.type || 'task'}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const abortController = new AbortController();
    let task = createTask({
      id,
      type: request.type ?? 'generic',
      logicalCommand: request.logicalCommand ?? '',
      file: request.file ?? process.execPath,
      args: request.args ?? [],
      cwd: request.cwd ?? process.cwd(),
      status: 'starting',
      startedAt: Date.now(),
      port: request.port
    });
    const taskEntry = {
      task,
      abortController,
      request,
      writerGroup,
      promise: undefined
    };
    this.#tasks.set(id, taskEntry);
    emit(this.#onTaskUpdate, task);

    const updateTask = updates => {
      task = createTask({ ...task, ...updates });
      taskEntry.task = task;
      emit(this.#onTaskUpdate, task);
    };
    const outputBuffers = { stdout: createOutputBuffer(), stderr: createOutputBuffer() };
    const streamRedaction = { stdout: createStreamRedactionState(), stderr: createStreamRedactionState() };
    let sawLiveOutput = false;
    const markServerReady = ready => {
      if (task.type !== 'serve' || ready === null || task.status !== 'starting' || abortController.signal.aborted) {
        return;
      }
      updateTask({ status: 'running', url: ready.url, port: ready.port });
    };
    const emitSafeLine = (stream, safeLine) => {
      if (safeLine.length === 0) {
        return;
      }
      emit(this.#onLog, {
        taskId: id,
        type: stream === 'stderr' ? 'error' : task.type,
        message: safeLine,
        timestamp: Date.now()
      });
      if (task.type === 'serve') {
        markServerReady(parseOwnedReadyLine(safeLine, request.port));
        const hmrFile = parseHmrFile(safeLine);
        if (hmrFile !== null) {
          emit(this.#onHmrUpdate, hmrFile);
        }
      }
      const metrics = parseTestMetrics(safeLine);
      if (metrics.passed !== undefined || metrics.failures !== undefined || metrics.coveragePct !== undefined) {
        emit(this.#onTestMetrics, metrics);
      }
    };
    const handleLine = (stream, line, options) => {
      if (line.length === 0) {
        if (options?.truncated) {
          emitSafeLine(stream, PARTIAL_OUTPUT_MARKER);
        }
        return;
      }
      redactStreamSegment(streamRedaction[stream], line, options, safeLine => emitSafeLine(stream, safeLine));
    };
    const handleOutput = output => {
      const stream = output?.stream === 'stderr' ? 'stderr' : 'stdout';
      const text = typeof output?.text === 'string' ? output.text : String(output?.text ?? '');
      if (text.length === 0) {
        return;
      }
      sawLiveOutput = true;
      consumeOutput(outputBuffers[stream], text, (line, options) => handleLine(stream, line, options));
    };
    const flushOutput = () => {
      for (const stream of ['stdout', 'stderr']) {
        flushOutputBuffer(outputBuffers[stream], (line, options) => handleLine(stream, line, options), { endOfLine: true });
      }
    };

    const runPromise = (async () => {
      try {
        const result = await this.#processRunner.run({
          file: request.file ?? process.execPath,
          args: request.args ?? [],
          cwd: request.cwd ?? process.cwd(),
          env: request.env ?? process.env,
          signal: abortController.signal,
          isServer: request.isServer,
          port: request.port,
          onStart: started => {
            const pid = Number.isSafeInteger(started?.pid) && started.pid > 0 ? started.pid : null;
            updateTask({ pid, status: task.type === 'serve' ? 'starting' : 'running' });
          },
          onOutput: handleOutput
        });
        if (!sawLiveOutput) {
          handleOutput({ stream: 'stdout', text: result.stdout });
          handleOutput({ stream: 'stderr', text: result.stderr });
        }
        flushOutput();
        const isPassed = result.exitCode === 0 && result.signal === null;
        updateTask({
          status: abortController.signal.aborted ? 'stopped' : (isPassed ? 'passed' : 'failed'),
          exitCode: result.exitCode,
          finishedAt: Date.now(),
          ...(task.type === 'serve' ? { url: undefined } : {})
        });
        return result;
      } catch (cause) {
        flushOutput();
        updateTask({
          status: abortController.signal.aborted || cause?.code === 'INTERRUPTED' ? 'stopped' : 'failed',
          finishedAt: Date.now(),
          ...(task.type === 'serve' ? { url: undefined } : {})
        });
        throw cause;
      }
    })();
    taskEntry.promise = runPromise;
    runPromise.catch(() => {});
    return task;
  }

  async cancelTask(id) {
    const entry = this.#tasks.get(id);
    if (!entry || !isActive(entry.task)) {
      return;
    }
    entry.task = createTask({ ...entry.task, status: 'stopping' });
    emit(this.#onTaskUpdate, entry.task);
    entry.abortController.abort();
    try {
      await entry.promise;
    } catch {}
    if (entry.task.status !== 'stopped') {
      entry.task = createTask({ ...entry.task, status: 'stopped', url: undefined, finishedAt: Date.now() });
      emit(this.#onTaskUpdate, entry.task);
    }
  }

  async restartTask(id) {
    const entry = this.#tasks.get(id);
    if (!entry) {
      throw typedError('TASK_NOT_FOUND', { id });
    }
    const savedRequest = { ...entry.request };
    await this.cancelTask(id);
    return this.startTask(savedRequest);
  }

  async stopAll() {
    const activeIds = [...this.#tasks.values()]
      .filter(entry => isActive(entry.task))
      .map(entry => entry.task.id);
    await Promise.all(activeIds.map(id => this.cancelTask(id)));
  }
}
