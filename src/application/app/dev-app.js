import { loadCellsConfig } from '../../adapters/vite/config-loader.js';
import { typedError } from '../../domain/workspace-session.js';

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function normalizedContext(context) {
  if (!isRecord(context) || !Object.isFrozen(context) || context.session === undefined || typeof context.configName !== 'string' || context.toolchain === null || typeof context.toolchain?.startDev !== 'function') {
    throw typedError('APP_DEV_INVALID');
  }
  if (context.signals !== undefined && (context.signals === null || typeof context.signals.on !== 'function' || typeof context.signals.removeListener !== 'function')) {
    throw typedError('APP_DEV_INVALID');
  }
  if (context.onCloseError !== undefined && typeof context.onCloseError !== 'function') throw typedError('APP_DEV_INVALID');
  const options = context.options ?? {};
  if (!isRecord(options)) throw typedError('APP_DEV_INVALID');
  return Object.freeze({
    session: context.session,
    configName: context.configName,
    toolchain: context.toolchain,
    signals: context.signals,
    onCloseError: context.onCloseError,
    options: Object.freeze({ ...options })
  });
}

function optionValue(options, name, fallback) {
  return options[name] === undefined ? fallback : options[name];
}

function serverOptions(config, context) {
  const configured = config.server ?? {};
  const options = context.options;
  const host = optionValue(options, 'host', configured.host ?? '127.0.0.1');
  const port = optionValue(options, 'port', configured.port ?? 8001);
  const strictPort = optionValue(options, 'strictPort', configured.strictPort ?? false);
  if (typeof host !== 'string' || !Number.isInteger(port) || port < 0 || port > 65535 || typeof strictPort !== 'boolean') throw typedError('APP_DEV_INVALID');
  return Object.freeze({
    session: context.session,
    config,
    configName: context.configName,
    host,
    port,
    strictPort,
    open: optionValue(options, 'open', configured.open ?? false),
    clearScreen: optionValue(options, 'clearScreen', false),
    debug: optionValue(options, 'debug', false),
    sassLogLevel: options.sassLogLevel
  });
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
        onCloseError?.(typedError('APP_DEV_CLOSE_FAILED'));
      }
    });
  };
  signals.on('SIGINT', onSignal);
  signals.on('SIGTERM', onSignal);
  return Object.freeze({ ready: handle.ready, close });
}

export async function devApp(context) {
  const normalized = normalizedContext(context);
  const config = await loadCellsConfig(normalized.session, normalized.configName);
  const handle = await normalized.toolchain.startDev(serverOptions(config, normalized));
  return withSignals(handle, normalized.signals, normalized.onCloseError);
}
