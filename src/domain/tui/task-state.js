export const TASK_TYPES = Object.freeze([
  'serve',
  'unit',
  'coverage',
  'e2e',
  'lint',
  'locales',
  'documentation',
  'build',
  'install',
  'create',
  'changelog',
  'sass',
  'generic'
]);

export const TASK_STATUSES = Object.freeze([
  'idle',
  'starting',
  'running',
  'passed',
  'failed',
  'stopping',
  'stopped'
]);

/**
 * Creates an immutable task state representation.
 * @param {object} options
 * @returns {Readonly<object>}
 */
export function createTask({
  id = `task-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
  type = 'generic',
  logicalCommand = '',
  file = '',
  args = [],
  cwd = '',
  pid = null,
  status = 'idle',
  url = undefined,
  port = undefined,
  startedAt = Date.now(),
  finishedAt = null,
  exitCode = null,
  metrics = null
} = {}) {
  return Object.freeze({
    id: String(id),
    type: String(type),
    logicalCommand: String(logicalCommand),
    file: String(file),
    args: Object.freeze([...args]),
    cwd: String(cwd),
    pid: typeof pid === 'number' ? pid : null,
    status: String(status),
    url: typeof url === 'string' ? url : undefined,
    port: typeof port === 'number' ? port : undefined,
    startedAt: Number(startedAt) || Date.now(),
    finishedAt: typeof finishedAt === 'number' ? finishedAt : null,
    exitCode: typeof exitCode === 'number' ? exitCode : null,
    metrics: metrics ? Object.freeze({ ...metrics }) : null
  });
}
