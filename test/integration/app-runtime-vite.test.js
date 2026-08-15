import assert from 'node:assert/strict';
import test from 'node:test';

import { buildTaskFiveViteFixture } from '../fixtures/runtime-contracts/vite-app/harness.js';

test('red: generated Task 5 runtime builds and serves through exact public Vite without SSR or service worker fallback', async t => {
  const result = await buildTaskFiveViteFixture(t);

  assert.equal(result.clientBuild.exitCode, 0);
  assert.equal(result.indexStatus, 200);
  assert.equal(result.assetStatus, 200);
  assert.equal(result.ssrError.code, 'ACADEMY_CORE_BROWSER_ONLY');
  assert.equal(result.publicLockOnly, true);
  assert.equal(result.serviceWorkerRegistrationFound, false);
  assert.equal(result.portReleased, true);
});
