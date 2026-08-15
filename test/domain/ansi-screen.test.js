import assert from 'node:assert/strict';
import test from 'node:test';

import { parseKeySequence, ANSI_SEQUENCES } from '../../src/adapters/terminal/ansi-screen.js';

test('domain: parseKeySequence accurately parses arrows, vim keys, tabs, and shortcuts', () => {
  assert.deepEqual(parseKeySequence('\x1b[A'), { name: 'up', ctrl: false, meta: false });
  assert.deepEqual(parseKeySequence('\x1b[B'), { name: 'down', ctrl: false, meta: false });
  assert.deepEqual(parseKeySequence('k'), { name: 'k', sequence: 'k', ctrl: false, meta: false });
  assert.deepEqual(parseKeySequence('j'), { name: 'j', sequence: 'j', ctrl: false, meta: false });
  assert.deepEqual(parseKeySequence('\r'), { name: 'return', ctrl: false, meta: false });
  assert.deepEqual(parseKeySequence('\n'), { name: 'return', ctrl: false, meta: false });
  assert.deepEqual(parseKeySequence('\t'), { name: 'tab', shift: false, ctrl: false, meta: false });
  assert.deepEqual(parseKeySequence('\x1b[Z'), { name: 'tab', shift: true, ctrl: false, meta: false });
  assert.deepEqual(parseKeySequence('\x1b'), { name: 'escape', ctrl: false, meta: false });
  assert.deepEqual(parseKeySequence('s'), { name: 's', sequence: 's', ctrl: false, meta: false });
  assert.deepEqual(parseKeySequence('u'), { name: 'u', sequence: 'u', ctrl: false, meta: false });
  assert.deepEqual(parseKeySequence('c'), { name: 'c', sequence: 'c', ctrl: false, meta: false });
  assert.deepEqual(parseKeySequence('e'), { name: 'e', sequence: 'e', ctrl: false, meta: false });
  assert.deepEqual(parseKeySequence('b'), { name: 'b', sequence: 'b', ctrl: false, meta: false });
  assert.deepEqual(parseKeySequence('r'), { name: 'r', sequence: 'r', ctrl: false, meta: false });
  assert.deepEqual(parseKeySequence('l'), { name: 'l', sequence: 'l', ctrl: false, meta: false });
  assert.deepEqual(parseKeySequence('/'), { name: 'slash', sequence: '/', ctrl: false, meta: false });
  assert.deepEqual(parseKeySequence('?'), { name: 'question', sequence: '?', ctrl: false, meta: false });
  assert.deepEqual(parseKeySequence('q'), { name: 'q', sequence: 'q', ctrl: false, meta: false });
});

test('domain: ANSI_SEQUENCES contains alternate buffer, cursor and clean codes', () => {
  assert.equal(ANSI_SEQUENCES.enterAlternateScreen, '\x1b[?1049h');
  assert.equal(ANSI_SEQUENCES.leaveAlternateScreen, '\x1b[?1049l');
  assert.equal(ANSI_SEQUENCES.hideCursor, '\x1b[?25l');
  assert.equal(ANSI_SEQUENCES.showCursor, '\x1b[?25h');
  assert.equal(ANSI_SEQUENCES.saveCursor, '\x1b7');
  assert.equal(ANSI_SEQUENCES.restoreCursor, '\x1b8');
  assert.equal(ANSI_SEQUENCES.cursorHome, '\x1b[H');
  assert.equal(ANSI_SEQUENCES.clearScreen, '\x1b[2J\x1b[H');
});
