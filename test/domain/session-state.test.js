import assert from 'node:assert/strict';
import test from 'node:test';

import { createSessionState, sessionReducer } from '../../src/domain/tui/session-state.js';

test('domain: sessionState initial structure and immutability', () => {
  const state = createSessionState({
    workspace: { name: 'my-button', type: 'component', root: '/tmp/workspace', testRunner: 'wtr' },
    language: 'en'
  });

  assert.equal(state.workspace.name, 'my-button');
  assert.equal(state.workspace.type, 'component');
  assert.equal(state.workspace.testRunner, 'wtr');
  assert.equal(state.focusedPanel, 'commands');
  assert.equal(state.selectedCommandIndex, 0);
  assert.equal(state.searchQuery, '');
  assert.equal(state.modal, null);
  assert.equal(state.autoScroll, true);
  assert.equal(state.logFilter, 'all');
  assert.deepEqual(state.tasks, []);
  assert.ok(Object.isFrozen(state));
});

test('domain: sessionReducer handles panel focus, command selection, search, and modals', () => {
  let state = createSessionState({
    workspace: { name: 'my-app', type: 'app', root: '/tmp/app' }
  });

  state = sessionReducer(state, { type: 'FOCUS_PANEL', panel: 'logs' });
  assert.equal(state.focusedPanel, 'logs');

  state = sessionReducer(state, { type: 'SELECT_COMMAND_INDEX', index: 3 });
  assert.equal(state.selectedCommandIndex, 3);

  state = sessionReducer(state, { type: 'SET_SEARCH_QUERY', query: 'test' });
  assert.equal(state.searchQuery, 'test');

  state = sessionReducer(state, { type: 'OPEN_MODAL', modal: 'help' });
  assert.equal(state.modal, 'help');

  state = sessionReducer(state, { type: 'CLOSE_MODAL' });
  assert.equal(state.modal, null);

  state = sessionReducer(state, { type: 'SET_LOG_FILTER', filter: 'errors' });
  assert.equal(state.logFilter, 'errors');

  state = sessionReducer(state, { type: 'SET_AUTO_SCROLL', autoScroll: false });
  assert.equal(state.autoScroll, false);
});

test('domain: sessionReducer stores editable search state and bounded log paging position', () => {
  let state = createSessionState({
    workspace: { name: 'my-app', type: 'app', root: '/tmp/app' }
  });

  assert.equal(state.searchActive, false);
  assert.equal(state.logOffset, 0);

  state = sessionReducer(state, { type: 'START_SEARCH' });
  state = sessionReducer(state, { type: 'SET_SEARCH_QUERY', query: 'test' });
  state = sessionReducer(state, { type: 'SET_LOG_OFFSET', offset: 10 });
  assert.equal(state.searchActive, true);
  assert.equal(state.searchQuery, 'test');
  assert.equal(state.autoScroll, false);
  assert.equal(state.logOffset, 10);

  state = sessionReducer(state, { type: 'SET_AUTO_SCROLL', autoScroll: true });
  state = sessionReducer(state, { type: 'END_SEARCH', clear: true });
  assert.equal(state.autoScroll, true);
  assert.equal(state.logOffset, 0);
  assert.equal(state.searchActive, false);
  assert.equal(state.searchQuery, '');
});

test('domain: sessionReducer manages task updates and server metrics', () => {
  let state = createSessionState({
    workspace: { name: 'my-app', type: 'app', root: '/tmp/app' }
  });

  const task1 = {
    id: 'serve-1',
    type: 'serve',
    logicalCommand: 'app:dev',
    pid: 12345,
    status: 'running',
    url: 'http://127.0.0.1:8001/',
    port: 8001,
    startedAt: 1000
  };

  state = sessionReducer(state, { type: 'TASK_UPSERT', task: task1 });
  assert.equal(state.tasks.length, 1);
  assert.equal(state.serverStatus?.url, 'http://127.0.0.1:8001/');
  assert.equal(state.serverStatus?.pid, 12345);

  state = sessionReducer(state, {
    type: 'UPDATE_HMR',
    file: 'src/app.js',
    timestamp: 2000
  });
  assert.equal(state.lastHmr?.file, 'src/app.js');
  assert.equal(state.lastHmr?.timestamp, 2000);

  state = sessionReducer(state, {
    type: 'UPDATE_TEST_METRICS',
    testResult: { passed: 10, failures: 0, status: 'passed' },
    coverageResult: { linesPct: 98.2 }
  });
  assert.equal(state.testMetrics?.passed, 10);
  assert.equal(state.coverageMetrics?.linesPct, 98.2);

  state = sessionReducer(state, {
    type: 'TASK_UPSERT',
    task: { ...task1, status: 'stopped', finishedAt: 3000 }
  });
  assert.equal(state.tasks[0].status, 'stopped');
  assert.equal(state.serverStatus, null);
});
