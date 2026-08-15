import { typedError } from '../../domain/workspace-session.js';

const SASS_LOG_LEVELS = new Set(['verbose', 'warn', 'error']);

export function sassLogLevelValue(candidate) {
  if (candidate === undefined) return 'warn';
  if (typeof candidate !== 'string' || !SASS_LOG_LEVELS.has(candidate)) {
    throw typedError('SASS_INPUT_INVALID', { field: 'sassLogLevel' });
  }
  return candidate;
}

/**
 * Maps the public `--sassLogLevel` flag onto Vite's sass preprocessor options.
 * `warn` keeps the sass default logger; `error` suppresses debug and warning
 * output; `verbose` surfaces debug messages as well. Returns `undefined` when
 * no override is needed so callers leave the Vite config untouched.
 */
export function sassPreprocessorOptions(logLevel) {
  const level = sassLogLevelValue(logLevel);
  if (level === 'warn') return undefined;
  if (level === 'error') {
    return {
      logger: {
        debug() {},
        warn() {},
        error(message) {
          console.error(message);
        }
      }
    };
  }
  return {
    logger: {
      debug(message) {
        console.error(message);
      },
      warn(message) {
        console.error(`WARNING: ${message}`);
      },
      error(message) {
        console.error(`ERROR: ${message}`);
      }
    }
  };
}
