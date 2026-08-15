import assert from 'node:assert/strict';
import test from 'node:test';

import { TitleAnimator } from '../../src/adapters/terminal/title-animator.js';

test('domain: TitleAnimator generates subtle color shimmer on active frames', () => {
  const animator = new TitleAnimator({ enabled: true });
  const frame0 = animator.render();
  assert.match(frame0, /ACADEMY CELLS/);

  animator.tick();
  const frame1 = animator.render();
  assert.match(frame1, /ACADEMY CELLS/);
});

test('domain: TitleAnimator keeps every visible title character while animating', () => {
  const animator = new TitleAnimator({ enabled: true, env: {} });
  const visible = value => value.replace(/\x1b\[[0-9;]*m/g, '');

  assert.equal(visible(animator.render()), 'ACADEMY CELLS');
  animator.tick();
  assert.equal(visible(animator.render()), 'ACADEMY CELLS');
});

test('domain: TitleAnimator returns plain static text when disabled, NO_COLOR, or TERM=dumb', () => {
  const staticAnimator = new TitleAnimator({ enabled: false });
  assert.equal(staticAnimator.render(), 'ACADEMY CELLS');

  const noColorAnimator = new TitleAnimator({ enabled: true, env: { NO_COLOR: '1' } });
  assert.equal(noColorAnimator.render(), 'ACADEMY CELLS');

  const dumbAnimator = new TitleAnimator({ enabled: true, env: { TERM: 'dumb' } });
  assert.equal(dumbAnimator.render(), 'ACADEMY CELLS');
});

test('domain: TitleAnimator suspends on idle and resumes on activity', () => {
  const animator = new TitleAnimator({ enabled: true, idleTimeoutMs: 100 });
  assert.equal(animator.isSuspended, false);

  animator.suspend();
  assert.equal(animator.isSuspended, true);

  animator.touch();
  assert.equal(animator.isSuspended, false);
});
