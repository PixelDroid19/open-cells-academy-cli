import { readFile, writeFile } from 'node:fs/promises';

import { FileWorkspaceLock } from '../../src/adapters/node/file-workspace-lock.js';
import { NodeFilesystem } from '../../src/adapters/node/node-filesystem.js';
import { WorkspaceSession } from '../../src/domain/workspace-session.js';

const [workspace, operation, readyPath] = process.argv.slice(2);
const controller = new AbortController();
let handle;

async function finish(code = 0) {
  try {
    await handle?.release();
  } finally {
    process.exit(code);
  }
}

process.once('SIGINT', () => {
  controller.abort();
  void finish(130);
});

try {
  const filesystem = new NodeFilesystem();
  const session = await WorkspaceSession.open(workspace, filesystem);
  handle = await new FileWorkspaceLock({ filesystem }).acquire(session, operation, controller.signal);
  await writeFile(readyPath, JSON.stringify({ pid: process.pid, record: handle.record }));
  await new Promise(resolve => setInterval(resolve, 50));
} catch (error) {
  process.stderr.write(`${JSON.stringify({ code: error.code, details: error.details })}\n`);
  process.exit(error.code === 'WORKSPACE_LOCKED' ? 73 : 1);
}
