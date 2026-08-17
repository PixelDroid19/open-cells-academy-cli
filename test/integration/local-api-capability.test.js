import assert from 'node:assert/strict';
import { createServer } from 'node:net';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { pathToFileURL } from 'node:url';

import { NodeFilesystem } from '../../src/adapters/node/node-filesystem.js';
import { WorkspaceSession } from '../../src/domain/workspace-session.js';
import { composeRecipe } from '../../src/recipes/compose-recipe.js';
import { startLocalApiServer } from '../fixtures/runtime-contracts/local-api-server.js';

const localApiClientFile = ['src', 'capabilities', 'local-api', 'local-api-client.js'];
const mainFile = ['src', 'main.js'];

async function materializeRuntime(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'open-cells-academy-local-api-'));
  t.after(async () => {
    await rm(root, { recursive: true, force: true });
  });
  await writeFile(path.join(root, 'package.json'), '{"name":"local-api-runtime","private":true}\n');
  const filesystem = new NodeFilesystem();
  const session = await WorkspaceSession.open(root, filesystem);
  const plan = composeRecipe('blank', { kind: 'app', name: 'local-api-runtime', cellsVersion: '4' });
  const publication = await filesystem.applyPlanAtomically(session, plan, 'local-api-runtime');
  return publication.destination;
}

function listen(server, port) {
  return new Promise((resolve, reject) => {
    const onError = error => {
      server.removeListener('listening', onListening);
      reject(error);
    };
    const onListening = () => {
      server.removeListener('error', onError);
      resolve();
    };
    server.once('error', onError);
    server.once('listening', onListening);
    server.listen(port, '127.0.0.1');
  });
}

function close(server) {
  return new Promise((resolve, reject) => {
    server.close(error => error ? reject(error) : resolve());
  });
}

async function assertPortReleased(origin) {
  const endpoint = new URL(origin);
  const probe = createServer();
  try {
    await listen(probe, Number(endpoint.port));
  } finally {
    if (probe.listening) {
      await close(probe);
    }
  }
}

function assertSafeError(error, code, message) {
  assert.equal(error instanceof Error, true);
  assert.equal(error.name, 'AcademyLocalApiError');
  assert.equal(error.code, code);
  assert.equal(error.message, message);
  assert.deepEqual(Object.keys(error).sort(), ['code', 'name']);
  assert.doesNotMatch(`${error.name} ${error.code} ${error.message} ${error.stack} ${JSON.stringify(error)}`, /fixture-(response|header|malformed)-secret/);
  return true;
}

async function waitFor(promise, timeoutMs = 1000) {
  let timer;
  try {
    await Promise.race([
      promise,
      new Promise((resolve, reject) => {
        timer = setTimeout(() => reject(new Error(`Timed out after ${timeoutMs}ms`)), timeoutMs);
      })
    ]);
  } finally {
    clearTimeout(timer);
  }
}

test('red: generated local API client safely requests only fixture resources and releases its local server', { concurrency: false }, async t => {
  const runtimeRoot = await materializeRuntime(t);
  const client = await import(pathToFileURL(path.join(runtimeRoot, ...localApiClientFile)).href);
  const main = await readFile(path.join(runtimeRoot, ...mainFile), 'utf8');
  assert.equal(typeof client.createLocalApiRequest, 'function');
  assert.doesNotMatch(main, /createLocalApiRequest/);
  let delayedRequestSeen;
  const delayedRequest = new Promise(resolve => {
    delayedRequestSeen = resolve;
  });
  const server = await startLocalApiServer({
    delayMs: 200,
    onRequest({ mode }) {
      if (mode === 'delayed') {
        delayedRequestSeen();
      }
    }
  });
  t.after(async () => {
    await server.close();
  });

  assert.deepEqual(Object.keys(server).sort(), ['close', 'origin']);
  const defaultRequest = client.createLocalApiRequest({ baseUrl: server.origin });
  assert.equal(Object.isFrozen(defaultRequest), true);
  assert.deepEqual(await defaultRequest({ resource: 'courses', mode: 'success' }), {
    courses: [{ id: 'course-42', title: 'Local API course' }]
  });

  const injectedCalls = [];
  const injectedRequest = client.createLocalApiRequest({
    baseUrl: server.origin,
    fetchImpl(input, init) {
      injectedCalls.push({ input: String(input), signal: init.signal });
      return fetch(input, init);
    }
  });
  await injectedRequest({ resource: 'courses', mode: 'success' });
  const injectedUrl = new URL(injectedCalls[0].input);
  assert.equal(injectedCalls.length, 1);
  assert.equal(injectedUrl.origin, server.origin);
  assert.equal(injectedUrl.pathname, '/fixtures/local-api/courses');
  assert.equal(injectedUrl.searchParams.get('mode'), 'success');

  let remoteFetchCalls = 0;
  assert.throws(
    () => client.createLocalApiRequest({
      baseUrl: 'https://outside.example',
      fetchImpl() {
        remoteFetchCalls += 1;
      }
    }),
    error => assertSafeError(error, 'ACADEMY_LOCAL_API_INVALID_BASE_URL', 'Local API base URL is invalid.')
  );
  assert.equal(remoteFetchCalls, 0);

  let invalidFetchCalls = 0;
  const rejectingRequest = client.createLocalApiRequest({
    baseUrl: server.origin,
    fetchImpl() {
      invalidFetchCalls += 1;
      throw new Error('fetch must not run for invalid fixture input');
    }
  });
  assert.throws(
    () => rejectingRequest({ resource: 'https://outside.example/courses', mode: 'success' }),
    error => assertSafeError(error, 'ACADEMY_LOCAL_API_UNSUPPORTED_RESOURCE', 'Local API resource is not supported.')
  );
  assert.throws(
    () => rejectingRequest({ resource: 'courses', mode: '../error' }),
    error => assertSafeError(error, 'ACADEMY_LOCAL_API_UNSUPPORTED_MODE', 'Local API mode is not supported.')
  );
  assert.equal(invalidFetchCalls, 0);

  await assert.rejects(
    defaultRequest({ resource: 'courses', mode: 'error' }),
    error => assertSafeError(error, 'ACADEMY_LOCAL_API_HTTP_ERROR', 'Local API request failed.')
  );

  const malformedRequest = client.createLocalApiRequest({
    baseUrl: server.origin,
    async fetchImpl() {
      return {
        ok: true,
        async json() {
          throw new Error('fixture-malformed-secret');
        }
      };
    }
  });
  await assert.rejects(
    malformedRequest({ resource: 'courses', mode: 'success' }),
    error => assertSafeError(error, 'ACADEMY_LOCAL_API_MALFORMED_RESPONSE', 'Local API response was malformed.')
  );

  const controller = new AbortController();
  let forwardedSignal;
  const abortableRequest = client.createLocalApiRequest({
    baseUrl: server.origin,
    fetchImpl(input, init) {
      forwardedSignal = init.signal;
      return fetch(input, init);
    }
  });
  const pending = abortableRequest({ resource: 'courses', mode: 'delayed' }, { signal: controller.signal });
  await waitFor(delayedRequest);
  controller.abort('local API test cancellation');
  await assert.rejects(pending, error => {
    assert.equal(error.name, 'AbortError');
    assert.equal(error.code, 'ACADEMY_LOCAL_API_ABORTED');
    assert.equal(error.message, 'Local API request was aborted.');
    return true;
  });
  assert.equal(forwardedSignal, controller.signal);

  const firstClose = server.close();
  assert.equal(server.close(), firstClose);
  await firstClose;
  await assertPortReleased(server.origin);
});
