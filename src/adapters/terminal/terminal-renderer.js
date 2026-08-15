import { ANSI_SEQUENCES } from './ansi-screen.js';
import { drawBox, pad, truncate, splitPanels, visibleLength } from './box-drawing.js';
import { filterCommands, getCommandCatalog } from '../../domain/tui/command-catalog.js';
import { sanitizeTerminalText } from '../../domain/tui/ring-buffer.js';
import { translate } from '../../i18n/translator.js';

function text(state, key, params) {
  return sanitizeTerminalText(translate(state.language, key, params));
}

function externalText(value) {
  return sanitizeTerminalText(value);
}

function formatDuration(startedAt, finishedAt = null) {
  const end = finishedAt || Date.now();
  const seconds = Math.max(0, Math.floor((end - startedAt) / 1000));
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

function taskLabel(state, type) {
  return text(state, `tui_task_${type}`);
}

function statusLabel(state, status) {
  return text(state, `tui_status_${status}`);
}

function renderHeader({ state, titleAnimator, width }) {
  const title = titleAnimator.render();
  const workspaceType = text(state, `tui_workspace_${externalText(state.workspace?.type || 'unknown')}`);
  const rightTag = `[${text(state, 'tui_workspace', { name: externalText(state.workspace?.name || text(state, 'tui_workspace_default')), type: workspaceType })}]`;
  const leftBar = `┌─ ${title} `;
  const rightBar = ` ${rightTag} ─┐`;
  const middleLen = Math.max(0, width - visibleLength(leftBar) - visibleLength(rightBar));
  return `${leftBar}${'─'.repeat(middleLen)}${rightBar}`;
}

function renderCommandsPane({ state, width, height }) {
  const filtered = filterCommands(getCommandCatalog(), state.searchQuery, state.workspace?.type || 'all');
  const innerHeight = Math.max(1, height - 2);
  const lines = [];
  if (state.searchQuery || state.searchActive) {
    lines.push(`${text(state, 'tui_filter')}: /${externalText(state.searchQuery)}`);
  }
  const availableHeight = state.searchQuery || state.searchActive ? innerHeight - 1 : innerHeight;
  const startIndex = Math.max(0, Math.min(state.selectedCommandIndex - Math.floor(availableHeight / 2), filtered.length - availableHeight));
  const visibleCommands = filtered.slice(startIndex, startIndex + availableHeight);
  for (let index = 0; index < visibleCommands.length; index += 1) {
    const command = visibleCommands[index];
    const selected = startIndex + index === state.selectedCommandIndex;
    const prefix = selected ? `${ANSI_SEQUENCES.bold}${ANSI_SEQUENCES.cyan}> ` : '  ';
    const shortcut = command.shortcut ? `[${command.shortcut}] ` : '    ';
    lines.push(`${prefix}${shortcut}${command.name}${selected ? ANSI_SEQUENCES.reset : ''}`);
  }
  return drawBox({
    title: state.focusedPanel === 'commands' ? `${ANSI_SEQUENCES.bold}${text(state, 'tui_commands')}${ANSI_SEQUENCES.reset}` : text(state, 'tui_commands'),
    lines,
    width,
    height,
    active: state.focusedPanel === 'commands'
  });
}

function renderTasksPane({ state, width, height }) {
  const innerHeight = Math.max(1, height - 2);
  const lines = [];
  if (state.tasks.length === 0) {
    lines.push(`  ${ANSI_SEQUENCES.gray}${text(state, 'tui_no_active_tasks')}${ANSI_SEQUENCES.reset}`);
  } else {
    for (const task of state.tasks.slice(-innerHeight)) {
      const statusColor = task.status === 'running' || task.status === 'passed'
        ? ANSI_SEQUENCES.green
        : task.status === 'failed'
          ? ANSI_SEQUENCES.red
          : task.status === 'stopping'
            ? ANSI_SEQUENCES.yellow
            : ANSI_SEQUENCES.gray;
      const duration = formatDuration(task.startedAt, task.finishedAt);
      const pid = task.pid ? text(state, 'tui_pid', { pid: task.pid }) : '';
      const url = task.url ? ` ${externalText(task.url)}` : '';
      const coverage = task.metrics?.coveragePct ? ` ${text(state, 'tui_coverage_short', { value: task.metrics.coveragePct })}` : '';
      lines.push(` [${taskLabel(state, task.type)}] ${pid} ${statusColor}${statusLabel(state, task.status)}${ANSI_SEQUENCES.reset} (${duration})${url}${coverage}`);
    }
  }
  return drawBox({
    title: state.focusedPanel === 'tasks' ? `${ANSI_SEQUENCES.bold}${text(state, 'tui_active_tasks')}${ANSI_SEQUENCES.reset}` : text(state, 'tui_active_tasks'),
    lines,
    width,
    height,
    active: state.focusedPanel === 'tasks'
  });
}

function renderLogsPane({ state, ringBuffer, width, height }) {
  const innerHeight = Math.max(1, height - 2);
  const filteredLogs = ringBuffer.filter({ type: state.logFilter });
  const offset = state.autoScroll ? 0 : Math.min(state.logOffset ?? 0, Math.max(0, filteredLogs.length - innerHeight));
  const start = Math.max(0, filteredLogs.length - innerHeight - offset);
  const visibleLogs = filteredLogs.slice(start, start + innerHeight);
  const lines = [];
  if (visibleLogs.length === 0) {
    lines.push(`  ${ANSI_SEQUENCES.gray}${text(state, 'tui_no_logs')}${ANSI_SEQUENCES.reset}`);
  } else {
    for (const entry of visibleLogs) {
      const time = new Date(entry.timestamp).toTimeString().slice(0, 8);
      const tagColor = entry.type === 'error' ? ANSI_SEQUENCES.red : ANSI_SEQUENCES.cyan;
      lines.push(` ${ANSI_SEQUENCES.gray}${time}${ANSI_SEQUENCES.reset} ${tagColor}[${taskLabel(state, entry.type)}]${ANSI_SEQUENCES.reset} ${externalText(entry.message)}`);
    }
  }
  const mode = state.autoScroll ? text(state, 'tui_live') : text(state, 'tui_scrolled');
  const unseen = !state.autoScroll && state.unseenLogCount > 0
    ? ` ${text(state, 'tui_new_logs_available', { count: state.unseenLogCount })}`
    : '';
  const filterTag = `${text(state, 'tui_filter')}: ${text(state, `tui_filter_${state.logFilter}`)} | ${mode}${unseen}`;
  return drawBox({
    title: state.focusedPanel === 'logs' ? `${ANSI_SEQUENCES.bold}${text(state, 'tui_logs')} (${filterTag})${ANSI_SEQUENCES.reset}` : `${text(state, 'tui_logs')} (${filterTag})`,
    lines,
    width,
    height,
    active: state.focusedPanel === 'logs'
  });
}

function renderStatusBar({ state, width }) {
  const server = state.serverStatus?.url ? `${text(state, 'tui_server')}: ${externalText(state.serverStatus.url)}` : `${text(state, 'tui_server')}: ${text(state, 'tui_idle')}`;
  const hmr = state.lastHmr?.file ? `${text(state, 'tui_hmr')}: ${externalText(state.lastHmr.file)}` : `${text(state, 'tui_hmr')}: ${text(state, 'tui_idle')}`;
  const tests = state.testMetrics ? `${text(state, 'tui_tests')}: ${state.testMetrics.passed} ${text(state, 'tui_passed')}` : `${text(state, 'tui_tests')}: ${text(state, 'tui_idle')}`;
  const coverage = state.coverageMetrics?.linesPct ? ` ${text(state, 'tui_coverage_short', { value: state.coverageMetrics.linesPct })}` : '';
  return pad(truncate(` ${text(state, 'tui_status_label')}: ${server} | ${hmr} | ${tests}${coverage}`, width - 2), width);
}

function renderFooterBar({ state, width }) {
  const footer = text(state, 'tui_footer');
  return `${ANSI_SEQUENCES.dim}${pad(truncate(` ${footer}`, width), width)}${ANSI_SEQUENCES.reset}`;
}

function renderCreateForm({ state, createForm, width, height }) {
  if (createForm === undefined) {
    return null;
  }
  const fields = createForm.kind === 'app'
    ? [
        ['name', 'tui_create_name', createForm.name || text(state, 'tui_create_name_placeholder')],
        ['profile', 'tui_create_profile', createForm.profile],
        ['e2e', 'tui_create_e2e', createForm.e2e ? text(state, 'tui_enabled') : text(state, 'tui_disabled')],
        ['installDeps', 'tui_create_install_deps', createForm.installDeps ? text(state, 'tui_enabled') : text(state, 'tui_disabled')]
      ]
    : [
        ['name', 'tui_create_name', createForm.name || text(state, 'tui_create_name_placeholder')],
        ['namespace', 'tui_create_namespace', createForm.namespace],
        ['e2e', 'tui_create_e2e', createForm.e2e ? text(state, 'tui_enabled') : text(state, 'tui_disabled')],
        ['installDeps', 'tui_create_install_deps', createForm.installDeps ? text(state, 'tui_enabled') : text(state, 'tui_disabled')]
      ];
  const lines = [
    `  ${text(state, 'tui_create_form_hint')}`,
    '',
    ...fields.map(([name, label, value], index) => `  ${index === createForm.activeIndex ? '>' : ' '} ${text(state, label)}: ${externalText(value)}${name === 'e2e' || name === 'installDeps' ? ' [Space]' : ''}`),
    '',
    `  ${text(state, 'tui_create_submit_hint')}`
  ];
  return drawBox({
    title: text(state, createForm.kind === 'app' ? 'tui_create_app_title' : 'tui_create_component_title'),
    lines,
    width: Math.min(68, width - 4),
    height: Math.min(12, height - 4),
    active: true
  });
}

function renderModalOverlay({ state, createForm, width, height }) {
  if (!state.modal) {
    return null;
  }
  if (state.modal === 'help') {
    const lines = [
      `  ${text(state, 'tui_keyboard_shortcuts')}:`,
      '  ------------------',
      `  [s]        ${text(state, 'tui_help_serve')}`,
      `  [r]        ${text(state, 'tui_help_restart')}`,
      `  [u]        ${text(state, 'tui_help_unit')}`,
      `  [c]        ${text(state, 'tui_help_coverage')}`,
      `  [e]        ${text(state, 'tui_help_e2e')}`,
      `  [b]        ${text(state, 'tui_help_build')}`,
      `  [p]        ${text(state, 'tui_help_preview')}`,
      `  [i]        ${text(state, 'tui_help_locales')}`,
      `  [d]        ${text(state, 'tui_help_documentation')}`,
      `  [+]        ${text(state, 'tui_help_create')}`,
      `  [o]        ${text(state, 'tui_help_open')}`,
      `  [l]        ${text(state, 'tui_help_filter')}`,
      `  [/]        ${text(state, 'tui_help_search')}`,
      `  [Tab]      ${text(state, 'tui_help_panel')}`,
      `  [PgUp/PgDn] ${text(state, 'tui_help_paging')}`,
      `  [Esc]      ${text(state, 'tui_help_escape')}`,
      `  [q]        ${text(state, 'tui_help_quit')}`,
      '',
      `  ${text(state, 'tui_help_close')}`
    ];
    return drawBox({
      title: text(state, 'tui_keyboard_help'),
      lines,
      width: Math.min(68, width - 4),
      height: Math.min(20, height - 4),
      active: true
    });
  }
  if (state.modal === 'confirm_quit') {
    return drawBox({
      title: text(state, 'tui_confirm_quit_title'),
      lines: ['', `  ${text(state, 'tui_confirm_quit_message')}`, '', `  ${text(state, 'tui_confirm_quit_hint')}`],
      width: Math.min(65, width - 4),
      height: 7,
      active: true
    });
  }
  if (state.modal === 'create') {
    return renderCreateForm({ state, createForm, width, height });
  }
  return null;
}

function stripSgr(frame) {
  return frame.replace(/\u001b\[[0-9;]*m/g, '');
}

/**
 * Renders only the top header for animation ticks. It deliberately excludes
 * a screen clear and all panels so an active title does not redraw the TUI.
 * @param {object} options
 * @returns {string}
 */
export function renderTuiHeader({ state, titleAnimator, width = 80, colorEnabled = true }) {
  const header = renderHeader({ state, titleAnimator, width });
  return colorEnabled ? header : stripSgr(header);
}

/**
 * Main renderer that outputs full ANSI frame buffer for the TUI session.
 * @param {object} options
 * @returns {string}
 */
export function renderTuiView({ state, ringBuffer, titleAnimator, dimensions = { columns: 80, rows: 24 }, colorEnabled = true, createForm = undefined }) {
  const { columns, rows } = dimensions;
  const layout = splitPanels({ columns, rows });
  const header = renderTuiHeader({ state, titleAnimator, width: columns, colorEnabled });
  const statusBar = renderStatusBar({ state, width: columns });
  const footer = renderFooterBar({ state, width: columns });
  let bodyContent = '';
  if (layout.mode === 'wide') {
    const totalBodyHeight = rows - 4;
    const tasksHeight = Math.max(5, Math.floor(totalBodyHeight * 0.35));
    const logsHeight = totalBodyHeight - tasksHeight;
    const leftLines = renderCommandsPane({ state, width: layout.leftWidth, height: totalBodyHeight }).split('\n');
    const rightLines = [
      ...renderTasksPane({ state, width: layout.rightWidth, height: tasksHeight }).split('\n'),
      ...renderLogsPane({ state, ringBuffer, width: layout.rightWidth, height: logsHeight }).split('\n')
    ];
    bodyContent = Array.from({ length: totalBodyHeight }, (_, index) => `${leftLines[index] || ' '.repeat(layout.leftWidth)}${rightLines[index] || ' '.repeat(layout.rightWidth)}`).join('\n');
  } else {
    const totalBodyHeight = rows - 4;
    const topHeight = Math.max(6, Math.floor(totalBodyHeight * 0.45));
    const bottomHeight = totalBodyHeight - topHeight;
    const topBox = state.focusedPanel === 'tasks'
      ? renderTasksPane({ state, width: columns, height: topHeight })
      : renderCommandsPane({ state, width: columns, height: topHeight });
    bodyContent = `${topBox}\n${renderLogsPane({ state, ringBuffer, width: columns, height: bottomHeight })}`;
  }
  const modal = renderModalOverlay({ state, createForm, width: columns, height: rows });
  const frame = modal
    ? `${ANSI_SEQUENCES.clearScreen}${header}\n${bodyContent}\n${statusBar}\n${footer}\n\n${modal}`
    : `${ANSI_SEQUENCES.clearScreen}${header}\n${bodyContent}\n${statusBar}\n${footer}`;
  return colorEnabled ? frame : stripSgr(frame);
}
