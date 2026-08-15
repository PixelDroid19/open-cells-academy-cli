import { GitPort } from '../../ports/git.js';
import { typedError } from '../../domain/workspace-session.js';

const FIELD = '\u001f';
const RECORD = '\u001e';
const HASH = /^[0-9a-f]{40}$/;
const SHORT_HASH = /^[0-9a-f]{7,40}$/;
const DATE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[+-]\d{2}:\d{2}$/;

function assertSession(session) {
  if (session === null || typeof session !== 'object' || typeof session.root !== 'string') {
    throw typedError('WORKSPACE_INVALID');
  }
}

function assertRunner(processRunner) {
  if (processRunner === null || typeof processRunner !== 'object' || typeof processRunner.run !== 'function') {
    throw typedError('INVALID_INPUT', { field: 'processRunner' });
  }
}

function resultOrFailure(result, tool = 'git') {
  if (result === null || typeof result !== 'object') {
    throw typedError('TOOL_FAILED', { tool, reason: 'INVALID_RESULT' });
  }
  if (result.exitCode !== 0 || result.signal !== null) {
    throw typedError('TOOL_FAILED', { tool, result });
  }
  return result;
}

function frozenCommit(fields) {
  const [hash, shortHash, authorDate, subject, body] = fields;
  if (!HASH.test(hash) || !SHORT_HASH.test(shortHash) || !DATE.test(authorDate) || subject.includes(RECORD) || subject.includes(FIELD) || body.includes(RECORD)) {
    throw typedError('TOOL_FAILED', { tool: 'git', reason: 'MALFORMED_HISTORY' });
  }
  return Object.freeze({ hash, shortHash, authorDate, subject, body });
}

function parseHistory(stdout) {
  if (typeof stdout !== 'string') {
    throw typedError('TOOL_FAILED', { tool: 'git', reason: 'MALFORMED_HISTORY' });
  }
  const normalized = stdout.endsWith(`${RECORD}\n`) ? stdout.slice(0, -1) : stdout;
  if (normalized.length === 0) {
    return Object.freeze([]);
  }
  if (!normalized.endsWith(RECORD)) {
    throw typedError('TOOL_FAILED', { tool: 'git', reason: 'MALFORMED_HISTORY' });
  }
  const records = normalized.slice(0, -RECORD.length).split(RECORD);
  const commits = records.map((record, index) => {
    const normalizedRecord = index === 0 ? record : record.startsWith('\n') ? record.slice(1) : record;
    const fields = normalizedRecord.split(FIELD);
    if (fields.length !== 5) {
      throw typedError('TOOL_FAILED', { tool: 'git', reason: 'MALFORMED_HISTORY' });
    }
    return frozenCommit(fields);
  });
  return Object.freeze(commits);
}

/**
 * Direct Git process adapter. The field and record delimiters are rejected in
 * parsed records so a malformed subject/body cannot shift structured fields.
 */
export class GitAdapter extends GitPort {
  #processRunner;
  #tool;

  constructor({ processRunner, tool = 'git' } = {}) {
    super();
    assertRunner(processRunner);
    if (typeof tool !== 'string' || tool.length === 0 || tool.includes('\u0000')) {
      throw typedError('INVALID_INPUT', { field: 'tool' });
    }
    this.#processRunner = processRunner;
    this.#tool = tool;
    Object.freeze(this);
  }

  async #run(session, args) {
    assertSession(session);
    return this.#processRunner.run({ file: this.#tool, args, cwd: session.root, env: {}, stdio: 'pipe' });
  }

  async inspectRepository(session) {
    const repository = await this.#run(session, ['rev-parse', '--is-inside-work-tree']);
    if (repository.exitCode !== 0 || repository.signal !== null || repository.stdout.trim() !== 'true') {
      throw typedError('GIT_REPOSITORY_REQUIRED', { result: repository });
    }
    const topLevel = await this.#run(session, ['rev-parse', '--show-toplevel']);
    if (topLevel.exitCode !== 0 || topLevel.signal !== null || topLevel.stdout.trim() !== session.root) {
      throw typedError('GIT_REPOSITORY_REQUIRED', { result: topLevel });
    }
    const [head, count] = await Promise.all([
      this.#run(session, ['rev-parse', '--verify', 'HEAD']),
      this.#run(session, ['rev-list', '--count', 'HEAD'])
    ]);
    if (head.exitCode !== 0 || count.exitCode !== 0 || head.signal !== null || count.signal !== null) {
      throw typedError('NO_COMMITS', { head, count });
    }
    const hash = head.stdout.trim();
    const commitCount = Number.parseInt(count.stdout.trim(), 10);
    if (!HASH.test(hash) || !Number.isSafeInteger(commitCount) || commitCount < 1) {
      throw typedError('TOOL_FAILED', { tool: 'git', reason: 'MALFORMED_INSPECTION' });
    }
    return Object.freeze({ head: hash, shortHead: hash.slice(0, 7), commitCount });
  }

  async readConventionalCommits(session, options = {}) {
    if (options === null || typeof options !== 'object' || Array.isArray(options)) {
      throw typedError('INVALID_INPUT', { field: 'options' });
    }
    await this.inspectRepository(session);
    const format = '%H%x1f%h%x1f%aI%x1f%s%x1f%b%x1e';
    const result = resultOrFailure(await this.#run(session, ['log', '--date-order', `--format=${format}`]));
    return parseHistory(result.stdout);
  }
}
