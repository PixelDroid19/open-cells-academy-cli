import { loadCellsConfig } from '../../adapters/vite/config-loader.js';
import { typedError } from '../../domain/workspace-session.js';

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function normalizedContext(context) {
  if (!isRecord(context) || !Object.isFrozen(context) || context.session === undefined || typeof context.configName !== 'string' || context.toolchain === null || typeof context.toolchain?.startPreview !== 'function') throw typedError('APP_PREVIEW_INVALID');
  if (context.signals !== undefined && (context.signals === null || typeof context.signals.on !== 'function' || typeof context.signals.removeListener !== 'function')) throw typedError('APP_PREVIEW_INVALID');
  if (context.onCloseError !== undefined && typeof context.onCloseError !== 'function') throw typedError('APP_PREVIEW_INVALID');
  if (context.options !== undefined && !isRecord(context.options)) throw typedError('APP_PREVIEW_INVALID');
  return Object.freeze({ ...context, options: Object.freeze({ ...(context.options ?? {}) }) });
}

function withSignals(handle, signals, onCloseError) {
  if (signals === undefined) return handle;
  let closing;
  let closeErrorReported = false;
  const close = () => {
    closing ??= Promise.resolve(handle.close()).finally(() => {
      signals.removeListener('SIGINT', onSignal);
      signals.removeListener('SIGTERM', onSignal);
    });
    return closing;
  };
  const onSignal = () => {
    void close().catch(() => {
      if (!closeErrorReported) {
        closeErrorReported = true;
        onCloseError?.(typedError('APP_PREVIEW_CLOSE_FAILED'));
      }
    });
  };
  signals.on('SIGINT', onSignal);
  signals.on('SIGTERM', onSignal);
  return Object.freeze({ ready: handle.ready, close });
}

export async function previewApp(context) {
  const normalized = normalizedContext(context);
  const config = await loadCellsConfig(normalized.session, normalized.configName);
  const configured = config.preview ?? {};
  const host = normalized.options.host ?? configured.host ?? '127.0.0.1';
  const port = normalized.options.port ?? configured.port ?? 8001;
  const strictPort = normalized.options.strictPort ?? configured.strictPort ?? false;
  if (typeof host !== 'string' || !Number.isInteger(port) || port < 0 || port > 65535 || typeof strictPort !== 'boolean') throw typedError('APP_PREVIEW_INVALID');
  const handle = await normalized.toolchain.startPreview(Object.freeze({
    session: normalized.session,
    configName: normalized.configName,
    host,
    port,
    strictPort,
    open: normalized.options.open ?? configured.open ?? false
  }));
  return withSignals(handle, normalized.signals, normalized.onCloseError);
}
