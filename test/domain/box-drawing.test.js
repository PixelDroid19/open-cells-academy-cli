import assert from 'node:assert/strict';
import test from 'node:test';

import {
  truncate,
  pad,
  stripAnsi,
  visibleLength,
  drawBox,
  splitPanels
} from '../../src/adapters/terminal/box-drawing.js';

test('domain: string utilities handle ANSI colors and visible length accurately', () => {
  const colored = '\x1b[32mHello\x1b[39m \x1b[1mWorld\x1b[22m';
  assert.equal(stripAnsi(colored), 'Hello World');
  assert.equal(visibleLength(colored), 11);

  assert.equal(truncate('Hello World', 8), 'Hello...');
  assert.equal(truncate(colored, 8), '\x1b[32mHello\x1b[39m...');
  assert.equal(pad('Test', 8), 'Test    ');
  assert.equal(pad('Test', 8, 'right'), '    Test');
});

test('domain: drawBox creates responsive bordered boxes with title', () => {
  const box = drawBox({
    title: 'COMMANDS',
    lines: ['Item 1', 'Item 2'],
    width: 20,
    height: 5
  });

  const lines = box.split('\n');
  assert.equal(lines.length, 5);
  assert.match(lines[0], /┌─ COMMANDS ─+┐/);
  assert.match(lines[1], /│ Item 1 +│/);
  assert.match(lines[2], /│ Item 2 +│/);
  assert.match(lines[3], /│ +│/);
  assert.match(lines[4], /└─+┘/);
});

test('domain: splitPanels calculates layout dimensions for wide, medium, and narrow terminals', () => {
  const wide = splitPanels({ columns: 120, rows: 30 });
  assert.equal(wide.mode, 'wide');
  assert.equal(wide.leftWidth + wide.rightWidth, 120);
  assert.ok(wide.leftWidth >= 35);
  assert.ok(wide.rightWidth >= 70);

  const medium = splitPanels({ columns: 80, rows: 25 });
  assert.equal(medium.mode, 'medium');

  const narrow = splitPanels({ columns: 60, rows: 20 });
  assert.equal(narrow.mode, 'narrow');
});
