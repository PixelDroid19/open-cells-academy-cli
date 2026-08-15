import { typedError } from '../../domain/workspace-session.js';

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function normalizedContext(context) {
  if (!isRecord(context) || !Object.isFrozen(context) || context.session === undefined || context.toolchain === null || typeof context.toolchain?.startDev !== 'function') {
    throw typedError('COMPONENT_DEV_INVALID');
  }
  if (context.signals !== undefined && (context.signals === null || typeof context.signals.on !== 'function' || typeof context.signals.removeListener !== 'function')) {
    throw typedError('COMPONENT_DEV_INVALID');
  }
  if (context.onCloseError !== undefined && typeof context.onCloseError !== 'function') throw typedError('COMPONENT_DEV_INVALID');
  const options = context.options ?? {};
  if (!isRecord(options)) throw typedError('COMPONENT_DEV_INVALID');
  return Object.freeze({
    session: context.session,
    toolchain: context.toolchain,
    signals: context.signals,
    onCloseError: context.onCloseError,
    options: Object.freeze({ ...options })
  });
}

function optionValue(options, name, fallback) {
  return options[name] === undefined ? fallback : options[name];
}

function serverOptions(context) {
  const options = context.options;
  const host = optionValue(options, 'host', '127.0.0.1');
  const port = optionValue(options, 'port', 8001);
  const strictPort = optionValue(options, 'strictPort', false);
  if (typeof host !== 'string' || !Number.isInteger(port) || port < 0 || port > 65535 || typeof strictPort !== 'boolean') throw typedError('COMPONENT_DEV_INVALID');
  return Object.freeze({
    session: context.session,
    host,
    port,
    strictPort,
    open: optionValue(options, 'open', true),
    clearScreen: optionValue(options, 'clearScreen', false),
    demo: optionValue(options, 'demo', 'demo'),
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
        onCloseError?.(typedError('COMPONENT_DEV_CLOSE_FAILED'));
      }
    });
  };
  signals.on('SIGINT', onSignal);
  signals.on('SIGTERM', onSignal);
  return Object.freeze({ ready: handle.ready, close });
}

export async function devComponent(context) {
  const normalized = normalizedContext(context);
  const handle = await normalized.toolchain.startDev(serverOptions(normalized));
  return withSignals(handle, normalized.signals, normalized.onCloseError);
}
