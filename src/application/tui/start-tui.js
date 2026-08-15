import { inspectWorkspace } from './workspace-inspector.js';
import { RingBuffer } from '../../domain/tui/ring-buffer.js';
import { TitleAnimator } from '../../adapters/terminal/title-animator.js';
import { TaskSupervisor } from '../../adapters/node/task-supervisor.js';
import { TuiController } from './tui-controller.js';
import { NodeProcessRunner } from '../../adapters/node/process-runner.js';
import { createUrlOpener } from '../../adapters/node/url-opener.js';

/**
 * Composition root that launches an interactive TUI session.
 * @param {object} options
 * @returns {Promise<{ok: boolean, data: object}>}
 */
export async function startTui({
  cwd = process.cwd(),
  env = process.env,
  stdin = process.stdin,
  stdout = process.stdout,
  language = 'en',
  animation = true,
  processRunner = new NodeProcessRunner(),
  cliEntrypoint,
  terminalEvents,
  urlOpener = createUrlOpener()
} = {}) {
  const workspace = await inspectWorkspace(cwd);
  const ringBuffer = new RingBuffer({ capacity: 2000 });
  const titleAnimator = new TitleAnimator({ enabled: animation, env });
  const colorEnabled = !(env.NO_COLOR && env.NO_COLOR !== '0');

  let controller;

  const supervisor = new TaskSupervisor({
    processRunner,
    onTaskUpdate: (task) => controller?.handleTaskUpdate(task),
    onLog: (log) => controller?.handleLog(log),
    onHmrUpdate: (file) => controller?.handleHmrUpdate(file),
    onTestMetrics: (metrics) => controller?.handleTestMetrics(metrics)
  });

  controller = new TuiController({
    workspace,
    language,
    stdin,
    stdout,
    supervisor,
    ringBuffer,
    titleAnimator,
    cliEntrypoint,
    terminalEvents,
    urlOpener,
    colorEnabled
  });

  await controller.start();
  const closedResult = await controller.closed;

  return Object.freeze({
    ok: true,
    data: Object.freeze({
      status: 'tui_closed',
      exitCode: closedResult?.exitCode ?? 0
    })
  });
}
