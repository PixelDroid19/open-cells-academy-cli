import { createServer } from 'node:http';
import { readFile, realpath, stat } from 'node:fs/promises';
import path from 'node:path';

const CONTENT_TYPES = Object.freeze({
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8'
});

function within(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}

async function serve(root, request, response) {
  try {
    const pathname = decodeURIComponent(new URL(request.url ?? '/', 'http://fixture.test').pathname);
    const relative = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
    const candidate = path.resolve(root, relative);
    if (!within(root, candidate)) throw new Error('outside');
    const canonical = await realpath(candidate);
    if (!within(root, canonical) || !(await stat(canonical)).isFile()) throw new Error('invalid');
    const bytes = await readFile(canonical);
    response.writeHead(200, {
      'cache-control': 'no-store',
      'content-length': bytes.length,
      'content-type': CONTENT_TYPES[path.extname(canonical)] ?? 'application/octet-stream',
      connection: 'close'
    });
    response.end(bytes);
  } catch {
    response.writeHead(404, { connection: 'close' });
    response.end('Not found');
  }
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
    server.close(error => error ? reject(error) : resolve());
    server.closeIdleConnections?.();
    for (const socket of sockets) socket.destroy();
  });
}

export async function startStaticServer(root) {
  const canonicalRoot = await realpath(root);
  const sockets = new Set();
  const server = createServer((request, response) => void serve(canonicalRoot, request, response));
  server.on('connection', socket => {
    sockets.add(socket);
    socket.once('close', () => sockets.delete(socket));
  });
  await listen(server);
  const address = server.address();
  if (address === null || typeof address === 'string') throw new Error('Static fixture has no TCP address');
  let closePromise;
  return Object.freeze({
    origin: `http://127.0.0.1:${address.port}`,
    close() {
      closePromise ??= closeServer(server, sockets);
      return closePromise;
    }
  });
}
