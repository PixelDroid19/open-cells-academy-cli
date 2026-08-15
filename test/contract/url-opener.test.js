import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import test from 'node:test';

import { createUrlOpener } from '../../src/adapters/node/url-opener.js';

test('contract: local URL opener uses a structured, shell-free command and rejects remote URLs', async () => {
  const calls = [];
  const opener = createUrlOpener({
    platform: 'linux',
    spawnProcess(file, args, options) {
      calls.push({ file, args, options });
      const child = new EventEmitter();
      child.unref = () => {};
      queueMicrotask(() => child.emit('spawn'));
      return child;
    }
  });

  await opener('http://127.0.0.1:8001/academy?view=ready');

  assert.deepEqual(calls, [{
    file: 'xdg-open',
    args: ['http://127.0.0.1:8001/academy?view=ready'],
    options: { detached: true, shell: false, stdio: 'ignore', windowsHide: true }
  }]);
  await assert.rejects(() => opener('https://example.com/'), { code: 'UNSAFE_TUI_URL' });
  await assert.rejects(() => opener('http://user:password@127.0.0.1:8001/'), { code: 'UNSAFE_TUI_URL' });
});
