import { sanitizeTerminalText } from './ring-buffer.js';

function optionalTerminalText(value) {
  if (typeof value !== 'string') {
    return undefined;
  }
  const sanitized = sanitizeTerminalText(value);
  return sanitized.length > 0 ? sanitized : undefined;
}

function terminalText(value, fallback) {
  return optionalTerminalText(value) ?? fallback;
}

/**
 * Creates the initial immutable session state for a TUI run.
 * @param {object} options
 * @returns {Readonly<object>}
 */
export function createSessionState({
  workspace = { name: 'workspace', type: 'unknown', root: process.cwd() },
  language = 'en',
  focusedPanel = 'commands',
  selectedCommandIndex = 0,
  searchQuery = '',
  searchActive = false,
  modal = null,
  autoScroll = true,
  logOffset = 0,
  unseenLogCount = 0,
  logFilter = 'all',
  tasks = [],
  serverStatus = null,
  lastHmr = null,
  testMetrics = null,
  coverageMetrics = null
} = {}) {
  return Object.freeze({
    workspace: Object.freeze({
      name: terminalText(workspace.name, 'workspace'),
      type: terminalText(workspace.type, 'unknown'),
      root: String(workspace.root || process.cwd()),
      appConfigs: Object.freeze(Array.isArray(workspace.appConfigs) ? workspace.appConfigs.map(optionalTerminalText).filter(config => config !== undefined) : []),
      defaultAppConfig: optionalTerminalText(workspace.defaultAppConfig),
      defaultBuildConfig: optionalTerminalText(workspace.defaultBuildConfig)
    }),
    language: String(language || 'en'),
    focusedPanel: String(focusedPanel || 'commands'),
    selectedCommandIndex: Math.max(0, Number(selectedCommandIndex) || 0),
    searchQuery: String(searchQuery || ''),
    searchActive: Boolean(searchActive),
    modal: modal ? String(modal) : null,
    autoScroll: Boolean(autoScroll),
    logOffset: Math.max(0, Number.isSafeInteger(logOffset) ? logOffset : 0),
    unseenLogCount: Math.max(0, Number.isSafeInteger(unseenLogCount) ? unseenLogCount : 0),
    logFilter: String(logFilter || 'all'),
    tasks: Object.freeze([...tasks]),
    serverStatus: serverStatus ? Object.freeze({ ...serverStatus }) : null,
    lastHmr: lastHmr ? Object.freeze({ ...lastHmr, file: terminalText(lastHmr.file, '') }) : null,
    testMetrics: testMetrics ? Object.freeze({ ...testMetrics }) : null,
    coverageMetrics: coverageMetrics ? Object.freeze({ ...coverageMetrics }) : null
  });
}

/**
 * Pure state reducer for TUI actions.
 * @param {Readonly<object>} state
 * @param {object} action
 * @returns {Readonly<object>}
 */
export function sessionReducer(state, action) {
  if (!action || typeof action !== 'object') {
    return state;
  }

  switch (action.type) {
    case 'FOCUS_PANEL':
      return createSessionState({ ...state, focusedPanel: action.panel });

    case 'SELECT_COMMAND_INDEX':
      return createSessionState({ ...state, selectedCommandIndex: Math.max(0, action.index) });

    case 'SET_SEARCH_QUERY':
      return createSessionState({ ...state, searchQuery: action.query, selectedCommandIndex: 0 });

    case 'START_SEARCH':
      return createSessionState({ ...state, searchActive: true });

    case 'END_SEARCH':
      return createSessionState({
        ...state,
        searchActive: false,
        searchQuery: action.clear ? '' : state.searchQuery,
        selectedCommandIndex: 0
      });

    case 'OPEN_MODAL':
      return createSessionState({ ...state, modal: action.modal });

    case 'CLOSE_MODAL':
      return createSessionState({ ...state, modal: null });

    case 'SET_LOG_FILTER':
      return createSessionState({ ...state, logFilter: action.filter });

    case 'SET_AUTO_SCROLL':
      return createSessionState({
        ...state,
        autoScroll: action.autoScroll,
        logOffset: action.autoScroll ? 0 : state.logOffset,
        unseenLogCount: action.autoScroll ? 0 : state.unseenLogCount
      });

    case 'SET_LOG_OFFSET':
      return createSessionState({ ...state, autoScroll: false, logOffset: Math.max(0, Number(action.offset) || 0) });

    case 'LOG_RECEIVED':
      return createSessionState({
        ...state,
        unseenLogCount: state.autoScroll ? 0 : state.unseenLogCount + 1
      });

    case 'TASK_UPSERT': {
      const incoming = action.task;
      const index = state.tasks.findIndex(t => t.id === incoming.id);
      const nextTasks = [...state.tasks];
      if (index === -1) {
        nextTasks.push(incoming);
      } else {
        nextTasks[index] = incoming;
      }

      let serverStatus = state.serverStatus;
      if (incoming.type === 'serve') {
        if (incoming.status === 'running' || incoming.status === 'starting') {
          serverStatus = Object.freeze({
            url: incoming.status === 'running' ? incoming.url : undefined,
            port: incoming.port,
            pid: incoming.pid,
            status: incoming.status,
            startedAt: incoming.startedAt,
            finishedAt: incoming.finishedAt
          });
        } else {
          serverStatus = null;
        }
      }

      return createSessionState({
        ...state,
        tasks: nextTasks,
        serverStatus
      });
    }

    case 'UPDATE_HMR':
      return createSessionState({
        ...state,
        lastHmr: Object.freeze({
          file: terminalText(action.file, ''),
          timestamp: action.timestamp ?? Date.now()
        })
      });

    case 'UPDATE_TEST_METRICS':
      return createSessionState({
        ...state,
        testMetrics: action.testResult ? Object.freeze({ ...action.testResult }) : state.testMetrics,
        coverageMetrics: action.coverageResult ? Object.freeze({ ...action.coverageResult }) : state.coverageMetrics
      });

    default:
      return state;
  }
}
