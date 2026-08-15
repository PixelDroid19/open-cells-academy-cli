import http from 'node:http';

const SUCCESS_PAYLOAD = Object.freeze({
  courses: Object.freeze([
    Object.freeze({ id: 'course-42', title: 'Local API course' })
  ])
});

function sendJson(response, statusCode, payload, headers = {}) {
  if (response.destroyed || response.writableEnded) {
    return;
  }
  response.writeHead(statusCode, {
    'cache-control': 'no-store',
    'content-type': 'application/json; charset=utf-8',
    connection: 'close',
    ...headers
  });
  response.end(JSON.stringify(payload));
}

function sendDelayedJson(request, response, delayMs) {
  let completed = false;
  let timer;
  const cancel = () => {
    if (completed) {
      return;
    }
    completed = true;
    clearTimeout(timer);
    request.removeListener('aborted', cancel);
    response.removeListener('close', cancel);
  };
  request.once('aborted', cancel);
  response.once('close', cancel);
  timer = setTimeout(() => {
    if (!completed) {
      completed = true;
      request.removeListener('aborted', cancel);
      response.removeListener('close', cancel);
      sendJson(response, 200, SUCCESS_PAYLOAD);
    }
  }, delayMs);
}

function createRequestHandler({ delayMs, onRequest }) {
  return (request, response) => {
    const url = new URL(request.url ?? '/', 'http://local-api.test');
    const resource = url.pathname.replace('/fixtures/local-api/', '');
    const mode = url.searchParams.get('mode');
    if (request.method !== 'GET' || resource !== 'courses' || !['success', 'error', 'delayed'].includes(mode)) {
      sendJson(response, 404, { code: 'NOT_FOUND' });
      return;
    }
    onRequest?.(Object.freeze({ resource, mode }));
    if (mode === 'success') {
      sendJson(response, 200, SUCCESS_PAYLOAD);
      return;
    }
    if (mode === 'error') {
      sendJson(
        response,
        503,
        { code: 'FIXTURE_UNAVAILABLE', secret: 'fixture-response-secret' },
        { 'x-fixture-secret': 'fixture-header-secret' }
      );
      return;
    }
    sendDelayedJson(request, response, delayMs);
  };
}

function listen(server) {
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
    server.listen(0, '127.0.0.1');
  });
}

function closeServer(server, sockets) {
  return new Promise((resolve, reject) => {
    server.close(error => {
      if (error && error.code !== 'ERR_SERVER_NOT_RUNNING') {
        reject(error);
        return;
      }
      resolve();
    });
    server.closeIdleConnections?.();
    for (const socket of sockets) {
      socket.destroy();
    }
  });
}

export async function startLocalApiServer({ delayMs = 200, onRequest } = {}) {
  if (!Number.isInteger(delayMs) || delayMs < 1 || delayMs > 10000) {
    throw new TypeError('delayMs must be a positive integer below 10000');
  }
  if (onRequest !== undefined && typeof onRequest !== 'function') {
    throw new TypeError('onRequest must be a function');
  }
  const sockets = new Set();
  const server = http.createServer(createRequestHandler({ delayMs, onRequest }));
  server.on('connection', socket => {
    sockets.add(socket);
    socket.once('close', () => sockets.delete(socket));
  });
  await listen(server);
  const address = server.address();
  if (address === null || typeof address === 'string') {
    await closeServer(server, sockets);
    throw new Error('Local API fixture did not receive a TCP address');
  }
  let closePromise;
  return Object.freeze({
    origin: `http://127.0.0.1:${address.port}`,
    close() {
      closePromise ??= closeServer(server, sockets);
      return closePromise;
    }
  });
}
