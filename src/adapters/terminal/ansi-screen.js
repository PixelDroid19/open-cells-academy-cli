export const ANSI_SEQUENCES = Object.freeze({
  enterAlternateScreen: '\x1b[?1049h',
  leaveAlternateScreen: '\x1b[?1049l',
  hideCursor: '\x1b[?25l',
  showCursor: '\x1b[?25h',
  saveCursor: '\x1b7',
  restoreCursor: '\x1b8',
  cursorHome: '\x1b[H',
  clearScreen: '\x1b[2J\x1b[H',
  eraseLine: '\x1b[2K',
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  italic: '\x1b[3m',
  underline: '\x1b[4m',
  inverse: '\x1b[7m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
  white: '\x1b[37m',
  gray: '\x1b[90m',
  bgBlue: '\x1b[44m',
  bgCyan: '\x1b[46m',
  bgGray: '\x1b[100m'
});

/**
 * Parses raw terminal keyboard escape sequences into structured key events.
 * @param {string | Buffer} input
 * @returns {object}
 */
export function parseKeySequence(input) {
  const str = String(input ?? '');
  if (str.length === 0) return { name: undefined };

  // Control keys
  if (str === '\r' || str === '\n') return { name: 'return', ctrl: false, meta: false };
  if (str === '\t') return { name: 'tab', shift: false, ctrl: false, meta: false };
  if (str === '\x1b[Z') return { name: 'tab', shift: true, ctrl: false, meta: false };
  if (str === '\x1b') return { name: 'escape', ctrl: false, meta: false };
  if (str === '\x7f' || str === '\x08') return { name: 'backspace', ctrl: false, meta: false };

  // Arrows
  if (str === '\x1b[A' || str === '\x1bOA') return { name: 'up', ctrl: false, meta: false };
  if (str === '\x1b[B' || str === '\x1bOB') return { name: 'down', ctrl: false, meta: false };
  if (str === '\x1b[C' || str === '\x1bOC') return { name: 'right', ctrl: false, meta: false };
  if (str === '\x1b[D' || str === '\x1bOD') return { name: 'left', ctrl: false, meta: false };

  // Paging
  if (str === '\x1b[5~') return { name: 'pageup', ctrl: false, meta: false };
  if (str === '\x1b[6~') return { name: 'pagedown', ctrl: false, meta: false };
  if (str === '\x1b[H' || str === '\x1b[1~') return { name: 'home', ctrl: false, meta: false };
  if (str === '\x1b[F' || str === '\x1b[4~') return { name: 'end', ctrl: false, meta: false };

  // Ctrl+C
  if (str === '\x03') return { name: 'c', ctrl: true, meta: false };

  // Printable single characters
  if (str === '/') return { name: 'slash', sequence: '/', ctrl: false, meta: false };
  if (str === '?') return { name: 'question', sequence: '?', ctrl: false, meta: false };

  if (str.length === 1) {
    return { name: str, sequence: str, ctrl: false, meta: false };
  }

  return { name: 'unknown', raw: str, ctrl: false, meta: false };
}
