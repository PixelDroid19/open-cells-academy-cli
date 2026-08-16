import { createServer } from 'node:http';
import path from 'node:path';

import { typedError } from '../../domain/workspace-session.js';
import { DevServer } from '../../ports/dev-server.js';

const CONTENT_TYPES = Object.freeze({
  '.css': 'text/css; charset=utf-8',
  '.gif': 'image/gif',
  '.html': 'text/html; charset=utf-8',
  '.ico': 'image/x-icon',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml; charset=utf-8',
  '.ttf': 'font/ttf',
  '.webp': 'image/webp',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2'
});

function displayHost(host) {
  if (host === '0.0.0.0') return '127.0.0.1';
  if (host === '::') return '::1';
  return host;
}

function readyUrl(host, port) {
  const display = displayHost(host);
  if (display.includes('[') || display.includes(']')) throw typedError('VITE_SERVER_INVALID');
  const hostname = display.includes(':') ? `[${display}]` : display;
  try {
    return new URL(`http://${hostname}:${port}/`).href;
  } catch (cause) {
    throw typedError('VITE_SERVER_INVALID', undefined, cause);
  }
}

function requestPath(url) {
  try {
    return new URL(url ?? '/', 'http://127.0.0.1').pathname;
  } catch (cause) {
    throw typedError('LEGACY_APP_RUNTIME_INVALID', undefined, cause);
  }
}

function send(response, status, body = undefined, headers = undefined, head = false) {
  const content = body ?? Buffer.alloc(0);
  response.writeHead(status, {
    'Cache-Control': 'no-store',
    'Content-Length': content.byteLength,
    'X-Content-Type-Options': 'nosniff',
    ...headers
  });
  response.end(head ? undefined : content);
}

function handler(runtime) {
  return (request, response) => {
    void (async () => {
      const method = request.method ?? 'GET';
      if (method !== 'GET' && method !== 'HEAD') {
        send(response, 405, undefined, { Allow: 'GET, HEAD' }, method === 'HEAD');
        return;
      }
      let asset = await runtime.read(requestPath(request.url));
      if (asset === undefined) {
        send(response, 404, Buffer.from('Not found\n'), { 'Content-Type': 'text/plain; charset=utf-8' }, method === 'HEAD');
        return;
      }
      const contentType = CONTENT_TYPES[path.extname(asset.relativePath).toLowerCase()] ?? 'application/octet-stream';
      send(response, 200, asset.content, { 'Content-Type': contentType }, method === 'HEAD');
    })().catch(() => {
      if (!response.headersSent) send(response, 500, Buffer.from('Server error\n'), { 'Content-Type': 'text/plain; charset=utf-8' });
      else response.destroy();
    });
  };
}

async function listen(runtime, host, requestedPort, strictPort) {
  let port = requestedPort;
  while (port <= 65535) {
    const server = createServer(handler(runtime));
    try {
      await new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen({ host, port }, () => {
          server.removeListener('error', reject);
          resolve();
        });
      });
      return server;
    } catch (cause) {
      await new Promise(resolve => server.close(() => resolve())).catch(() => undefined);
      if (cause?.code !== 'EADDRINUSE' || strictPort || port === 0) throw cause;
      port += 1;
    }
  }
  throw typedError('VITE_SERVER_INVALID');
}

export async function startLegacyStaticServer({ runtime, host, port, strictPort, onDispose }) {
  if (runtime === null || typeof runtime?.read !== 'function' || typeof runtime?.verify !== 'function') {
    throw typedError('LEGACY_APP_RUNTIME_INVALID');
  }
  await runtime.verify();
  const server = await listen(runtime, host, port, strictPort);
  try {
    const address = server.address();
    if (address === null || typeof address === 'string' || !Number.isInteger(address.port)) throw typedError('VITE_SERVER_INVALID');
    await runtime.verify();
    let closePromise;
    return new DevServer({
      ready: Promise.resolve(Object.freeze({ url: readyUrl(host, address.port), host, port: address.port })),
      close() {
        closePromise ??= new Promise((resolve, reject) => {
          server.close(cause => cause === undefined ? resolve() : reject(cause));
        }).finally(() => onDispose?.());
        return closePromise;
      }
    });
  } catch (cause) {
    await new Promise(resolve => server.close(() => resolve())).catch(() => undefined);
    throw cause;
  }
}
