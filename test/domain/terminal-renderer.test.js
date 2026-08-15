import assert from 'node:assert/strict';
import test from 'node:test';

import { RingBuffer } from '../../src/domain/tui/ring-buffer.js';
import { createSessionState } from '../../src/domain/tui/session-state.js';
import { renderTuiView } from '../../src/adapters/terminal/terminal-renderer.js';
import { TitleAnimator } from '../../src/adapters/terminal/title-animator.js';

test('domain: terminal renderer localizes visible labels and omits SGR colors when color is disabled', () => {
  const state = createSessionState({
    language: 'es',
    workspace: { name: 'mi-app', type: 'app', root: '/tmp/app' },
    modal: 'help',
    tasks: [{ id: 'idle-task', type: 'generic', status: 'idle', startedAt: Date.now() }]
  });
  const frame = renderTuiView({
    state,
    ringBuffer: new RingBuffer({ capacity: 10 }),
    titleAnimator: new TitleAnimator({ enabled: false }),
    dimensions: { columns: 100, rows: 24 },
    colorEnabled: false
  });

  assert.match(frame, /COMANDOS/);
  assert.match(frame, /TAREAS ACTIVAS/);
  assert.match(frame, /TAREA/);
  assert.match(frame, /INACTIVA/);
  assert.match(frame, /Servidor: inactivo/);
  assert.match(frame, /Atajos de teclado/);
  assert.doesNotMatch(frame, /\x1b\[[0-9;]*m/);
  assert.match(frame, /\x1b\[2J\x1b\[H/);
});

test('domain: terminal renderer strips OSC controls from workspace and HMR text while preserving Unicode', () => {
  const oscOpen = '\x1b]8;;https://example.invalid\x1b\\';
  const oscClose = '\x1b]8;;\x1b\\';
  const state = createSessionState({
    workspace: {
      name: `${oscOpen}Banco Ñandú${oscClose}`,
      type: 'app',
      root: '/tmp/app',
      appConfigs: ['\x1b[31mdev.js\x1b[0m'],
      defaultAppConfig: '\x1b[31mdev.js\x1b[0m',
      defaultBuildConfig: '\x1b[31mdev.js\x1b[0m'
    },
    lastHmr: { file: `${oscOpen}/src/mañana.js${oscClose}`, timestamp: 1 }
  });
  const frame = renderTuiView({
    state,
    ringBuffer: new RingBuffer({ capacity: 10 }),
    titleAnimator: new TitleAnimator({ enabled: false }),
    dimensions: { columns: 100, rows: 24 },
    colorEnabled: false
  });

  assert.match(frame, /Banco Ñandú/);
  assert.match(frame, /\/src\/mañana\.js/);
  assert.doesNotMatch(frame, /\x1b\]|https:\/\/example\.invalid/);
  assert.equal(state.workspace.defaultAppConfig, 'dev.js');
  assert.equal(state.workspace.defaultBuildConfig, 'dev.js');
});
