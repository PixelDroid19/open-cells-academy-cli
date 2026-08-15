import { createServer } from 'node:http';
import { createServer as createNetServer } from 'node:net';
import { EventEmitter } from 'node:events';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
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

function contentType(file) {
  if (file.endsWith('.html')) return 'text/html; charset=utf-8';
  if (file.endsWith('.js')) return 'text/javascript; charset=utf-8';
  if (file.endsWith('.json')) return 'application/json; charset=utf-8';
  if (file.endsWith('.css')) return 'text/css; charset=utf-8';
  if (file.endsWith('.map')) return 'application/json; charset=utf-8';
  return 'application/octet-stream';
}

async function listenWithFallback(server, { host, port, strictPort }) {
  try {
    await listen(server, port, host);
  } catch (error) {
    if (strictPort || error?.code !== 'EADDRINUSE') throw error;
    await listen(server, 0, host);
  }
}

function runChain(chain, request, response, fallback) {
  let index = 0;
  const next = async () => {
    if (response.writableEnded || response.headersSent) return;
    if (index >= chain.length) {
      await fallback();
      return;
    }
    const middleware = chain[index];
    index += 1;
    let nextCalled = false;
    const forwarded = () => {
      nextCalled = true;
      void next();
    };
    try {
      await middleware(request, response, forwarded);
    } catch {
      if (!response.headersSent && !response.writableEnded) {
        response.statusCode = 500;
        response.end('Server error');
      }
      return;
    }
    if (!nextCalled && !response.headersSent && !response.writableEnded) {
      await fallback();
    }
  };
  void next();
}

async function serveStatic(root, request, response) {
  const pathname = new URL(request.url ?? '/', 'http://academy.test').pathname;
  let relative = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
  if (relative.endsWith('/')) relative = `${relative}index.html`;
  if (relative.includes('..')) {
    response.writeHead(403);
    response.end('Forbidden');
    return;
  }
  const candidate = path.resolve(root, relative);
  if (!path.relative(root, candidate).startsWith('..')) {
    try {
      const content = await readFile(candidate);
      response.writeHead(200, { 'content-type': contentType(candidate) });
      response.end(content);
      return;
    } catch {}
  }
  response.writeHead(404);
  response.end('Not found');
}

/**
 * Minimal Vite-shaped fake for the component dev server. It executes the
 * Academy-owned dev plugins' `configureServer` hooks over a real HTTP chain and
 * falls back to static serving from `config.root`, mirroring how Vite composes
 * middleware. Public imports and the HMR client are served by the fallback.
 */
export function createFakeComponentVite({ failBuild = false } = {}) {
  const calls = [];
  let latestServer;

  return Object.freeze({
    calls,
    get latestServer() {
      return latestServer;
    },
    async createServer(config) {
      calls.push(Object.freeze({ method: 'createServer', config }));
      const chain = [];
      const watcher = new EventEmitter();
      const ws = new EventEmitter();
      const httpServer = createServer((request, response) => {
        if (request.url?.startsWith('/@vite/client')) {
          response.writeHead(200, { 'content-type': 'text/javascript; charset=utf-8' });
          response.end('export const createHotContext = () => ({ accept() {} });');
          return;
        }
        runChain(chain, request, response, () => serveStatic(config.root, request, response));
      });
      const fake = {
        httpServer,
        middlewares: Object.freeze({ use(middleware) { chain.push(middleware); } }),
        watcher,
        ws,
        config,
        resolvedUrls: undefined,
        async listen() {
          await listenWithFallback(httpServer, config.server);
          const address = httpServer.address();
          if (address === null || typeof address === 'string') throw new Error('Fake component Vite did not bind TCP');
          fake.resolvedUrls = Object.freeze({ local: Object.freeze([publicUrl(config.server.host, address.port)]) });
        },
        async close() {
          if (httpServer.listening) await close(httpServer);
        }
      };
      latestServer = fake;
      for (const plugin of config.plugins ?? []) {
        if (typeof plugin.configureServer === 'function') {
          await plugin.configureServer(fake);
        }
      }
      return fake;
    },
    async build(config) {
      calls.push(Object.freeze({ method: 'build', config }));
      if (failBuild) throw new Error('fake-component-build-failure');
      const outDir = config.build?.outDir;
      if (typeof outDir !== 'string') throw new Error('fake component build missing outDir');
      const root = config.root;
      const input = config.build?.rollupOptions?.input;
      const entryFileNames = config.build?.rollupOptions?.output?.entryFileNames;
      const entries = Array.isArray(input) ? input : [input];
      for (const entry of entries) {
        if (typeof entry !== 'string') throw new Error('fake component build missing input');
        let source;
        try {
          source = await readFile(entry, 'utf8');
        } catch {
          throw new Error('fake-component-entry-missing');
        }
        const broken = /(?:from\s+|\bimport\s+)(['"])(\.\.?\/[^'"]+)\1/.exec(source);
        if (broken !== null && !(await stat(path.join(path.dirname(entry), broken[2])).then(() => true).catch(() => false))) {
          throw new Error('fake-component-broken-import');
        }
        const relative = typeof entryFileNames === 'string' ? entryFileNames : path.basename(entry);
        const target = path.join(outDir, relative);
        await mkdir(path.dirname(target), { recursive: true });
        await writeFile(target, `/* academy-demo-bundle ${path.basename(entry)} */\n${source}`);
        if (config.build?.sourcemap === true) {
          await writeFile(`${target}.map`, '{"version":3}\n');
        }
      }
      return Object.freeze({ outDir });
    },
    async preview() {
      throw new Error('not used by component toolchain');
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
