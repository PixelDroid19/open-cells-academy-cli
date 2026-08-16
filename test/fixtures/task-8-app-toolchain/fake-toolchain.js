import { createServer } from 'node:http';
import { createServer as createNetServer } from 'node:net';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

function listen(server, port, host) {
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
    server.listen(port, host);
  });
}

function close(server) {
  return new Promise((resolve, reject) => {
    server.close(error => error === undefined ? resolve() : reject(error));
  });
}

function publicUrl(host, port) {
  return `http://${host}:${port}/`;
}

async function transformHtml(config, html) {
  let transformed = html;
  for (const plugin of config.plugins ?? []) {
    const hook = plugin?.transformIndexHtml;
    if (typeof hook === 'function') transformed = await hook(transformed);
    else if (typeof hook?.handler === 'function') transformed = await hook.handler(transformed);
  }
  return transformed;
}

function contentType(file) {
  if (file.endsWith('.html')) return 'text/html; charset=utf-8';
  if (file.endsWith('.js')) return 'text/javascript; charset=utf-8';
  if (file.endsWith('.json') || file.endsWith('.map')) return 'application/json; charset=utf-8';
  return 'application/octet-stream';
}

async function serveFile(root, request, response) {
  const pathname = new URL(request.url ?? '/', 'http://academy.test').pathname;
  const relative = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
  const candidate = path.resolve(root, relative);
  if (path.relative(root, candidate).startsWith('..')) {
    response.writeHead(404);
    response.end('Not found');
    return;
  }
  try {
    const content = await readFile(candidate);
    response.writeHead(200, { 'content-type': contentType(candidate) });
    response.end(content);
  } catch {
    response.writeHead(404);
    response.end('Not found');
  }
}

async function listenWithFallback(server, { host, port, strictPort }) {
  try {
    await listen(server, port, host);
  } catch (error) {
    if (strictPort || error?.code !== 'EADDRINUSE') throw error;
    await listen(server, 0, host);
  }
}

export function createFakeVite({ failBuild = false } = {}) {
  const calls = [];
  let latestServer;

  return Object.freeze({
    calls,
    get latestServer() {
      return latestServer;
    },
    async createServer(config) {
      calls.push(Object.freeze({ method: 'createServer', config }));
      let body = '<main data-toolchain="dev">development</main>';
      const server = createServer((request, response) => {
        if (request.url === '/@vite/client') {
          response.writeHead(200, { 'content-type': 'text/javascript; charset=utf-8' });
          response.end('export const createHotContext = () => ({ accept() {} });');
          return;
        }
        response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
        response.end(body);
      });
      const fake = {
        httpServer: server,
        resolvedUrls: undefined,
        async listen() {
          await listenWithFallback(server, config.server);
          const address = server.address();
          if (address === null || typeof address === 'string') throw new Error('Fake Vite did not bind TCP');
          fake.resolvedUrls = Object.freeze({ local: Object.freeze([publicUrl(config.server.host, address.port)]) });
        },
        async close() {
          if (server.listening) await close(server);
        },
        setBody(value) {
          body = value;
        }
      };
      latestServer = fake;
      return fake;
    },
    async build(config) {
      calls.push(Object.freeze({ method: 'build', config }));
      if (failBuild) throw new Error('fake-build-failure');
      const outDir = config.build.outDir;
      let html = await readFile(path.join(config.root, 'index.html'), 'utf8');
      html = await transformHtml(config, html);
      await mkdir(path.join(outDir, 'assets'), { recursive: true });
      await writeFile(path.join(outDir, 'index.html'), html);
      await writeFile(path.join(outDir, 'assets', 'main.js'), config.build.sourcemap ? 'console.log("built");\n//# sourceMappingURL=main.js.map\n' : 'console.log("built");\n');
      if (config.build.sourcemap) await writeFile(path.join(outDir, 'assets', 'main.js.map'), '{"version":3}\n');
      return Object.freeze({ outDir });
    },
    async preview(config) {
      calls.push(Object.freeze({ method: 'preview', config }));
      const root = config.build.outDir;
      const server = createServer((request, response) => void serveFile(root, request, response));
      await listenWithFallback(server, config.preview);
      const address = server.address();
      if (address === null || typeof address === 'string') throw new Error('Fake Vite preview did not bind TCP');
      return Object.freeze({
        httpServer: server,
        resolvedUrls: Object.freeze({ local: Object.freeze([publicUrl(config.preview.host, address.port)]) }),
        async close() {
          if (server.listening) await close(server);
        }
      });
    }
  });
}

export function createFakeWorkbox({ fail = false } = {}) {
  const calls = [];
  return Object.freeze({
    calls,
    async generateSW(options) {
      calls.push(Object.freeze({ method: 'generateSW', options }));
      if (fail) throw new Error('fake-workbox-failure');
      await writeFile(options.swDest, 'self.addEventListener("install", () => self.skipWaiting());\n');
      return Object.freeze({ count: 1 });
    },
    async injectManifest(options) {
      calls.push(Object.freeze({ method: 'injectManifest', options }));
      if (fail) throw new Error('fake-workbox-failure');
      const source = await readFile(options.swSrc, 'utf8');
      await writeFile(options.swDest, `${source}\nself.__WB_MANIFEST;\n`);
      return Object.freeze({ count: 1 });
    }
  });
}

export async function occupyPort() {
  const server = createNetServer();
  await listen(server, 0, '127.0.0.1');
  const address = server.address();
  if (address === null || typeof address === 'string') throw new Error('Port probe did not bind TCP');
  return Object.freeze({
    port: address.port,
    async close() {
      if (server.listening) await close(server);
    }
  });
}

export async function portIsReleased(port) {
  const probe = createNetServer();
  try {
    await listen(probe, port, '127.0.0.1');
    return true;
  } catch {
    return false;
  } finally {
    if (probe.listening) await close(probe);
  }
}
