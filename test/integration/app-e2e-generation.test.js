import assert from 'node:assert/strict';
import test from 'node:test';

import { runGeneratedApplicationE2e } from '../fixtures/app-e2e-lifecycle.js';

test('red: all four generated E2E suites execute against their real public app runtime', { timeout: 360_000 }, async t => {
  const profiles = ['blank', 'web-app', 'web-mobile-app', 'academy-app'];
  const results = await runGeneratedApplicationE2e(t, profiles);

  assert.deepEqual(results.map(result => result.profile), profiles);
  for (const result of results) {
    assert.equal(result.exitCode, 0, `${result.profile} E2E failed:\n${result.stderr}\n${result.stdout}`);
    assert.equal(result.portReleased, true, `${result.profile} E2E port remained open`);
  }
});
