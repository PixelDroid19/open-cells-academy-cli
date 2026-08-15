const ANSI_REGEX = /\x1b\[[0-9;]*[a-zA-Z]/g;

/**
 * Removes ANSI escape sequences from a string.
 * @param {string} text
 * @returns {string}
 */
export function stripAnsi(text) {
  return typeof text === 'string' ? text.replace(ANSI_REGEX, '') : '';
}

/**
 * Calculates the visible length of a string in terminal cells.
 * @param {string} text
 * @returns {number}
 */
export function visibleLength(text) {
  return stripAnsi(text).length;
}

/**
 * Truncates a string to a maximum visible length, appending an ellipsis if truncated.
 * @param {string} text
 * @param {number} maxLength
 * @returns {string}
 */
export function truncate(text, maxLength) {
  if (typeof text !== 'string' || maxLength <= 0) return '';
  const plain = stripAnsi(text);
  if (plain.length <= maxLength) return text;
  if (maxLength <= 3) return plain.slice(0, maxLength);

  // If text contains no ANSI, simple slice
  if (plain.length === text.length) {
    return `${text.slice(0, maxLength - 3)}...`;
  }

  // Preserve ANSI codes while trimming visible characters
  let visibleCount = 0;
  let result = '';
  const limit = maxLength - 3;
  let inEscape = false;
  let escapeBuffer = '';

  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (char === '\x1b') {
      inEscape = true;
      escapeBuffer = char;
      continue;
    }
    if (inEscape) {
      escapeBuffer += char;
      if (/[a-zA-Z]/.test(char)) {
        inEscape = false;
        result += escapeBuffer;
        escapeBuffer = '';
      }
      continue;
    }

    if (visibleCount < limit) {
      result += char;
      visibleCount++;
    } else {
      break;
    }
  }

  return `${result}...`;
}

/**
 * Pads a string with spaces to a target visible width.
 * @param {string} text
 * @param {number} targetLength
 * @param {'left' | 'right' | 'center'} align
 * @returns {string}
 */
export function pad(text, targetLength, align = 'left') {
  const current = visibleLength(text);
  if (current >= targetLength) return text;
  const missing = targetLength - current;

  if (align === 'right') {
    return `${' '.repeat(missing)}${text}`;
  }
  if (align === 'center') {
    const left = Math.floor(missing / 2);
    const right = missing - left;
    return `${' '.repeat(left)}${text}${' '.repeat(right)}`;
  }
  return `${text}${' '.repeat(missing)}`;
}

/**
 * Draws a bordered rectangular box for the terminal.
 * @param {object} options
 * @returns {string}
 */
export function drawBox({
  title = '',
  lines = [],
  width = 40,
  height = 10,
  active = false
} = {}) {
  const safeWidth = Math.max(10, width);
  const safeHeight = Math.max(3, height);
  const innerWidth = safeWidth - 2;
  const innerHeight = safeHeight - 2;

  const result = [];

  // Top border
  if (title && title.length > 0) {
    const cleanTitle = truncate(title, innerWidth - 4);
    const titleBar = `─ ${cleanTitle} `;
    const remaining = Math.max(0, innerWidth - visibleLength(titleBar));
    result.push(`┌${titleBar}${'─'.repeat(remaining)}┐`);
  } else {
    result.push(`┌${'─'.repeat(innerWidth)}┐`);
  }

  // Content lines
  const contentWidth = Math.max(1, innerWidth - 2);
  for (let i = 0; i < innerHeight; i++) {
    const line = lines[i] !== undefined ? lines[i] : '';
    const truncatedLine = truncate(line, contentWidth);
    const paddedLine = pad(truncatedLine, contentWidth);
    result.push(`│ ${paddedLine} │`);
  }

  // Bottom border
  result.push(`└${'─'.repeat(innerWidth)}┘`);

  return result.join('\n');
}

/**
 * Calculates responsive panel layout boundaries based on terminal dimensions.
 * @param {{columns: number, rows: number}} dimensions
 * @returns {object}
 */
export function splitPanels({ columns = 80, rows = 24 } = {}) {
  const safeCols = Math.max(40, columns);
  const safeRows = Math.max(15, rows);

  if (safeCols >= 100 && safeRows >= 20) {
    const leftWidth = Math.max(35, Math.min(45, Math.floor(safeCols * 0.35)));
    const rightWidth = safeCols - leftWidth;
    return {
      mode: 'wide',
      columns: safeCols,
      rows: safeRows,
      leftWidth,
      rightWidth,
      contentHeight: safeRows - 4 // minus header (2), status (1), footer (1)
    };
  }

  if (safeCols >= 70) {
    const topHeight = Math.max(6, Math.floor((safeRows - 4) * 0.4));
    const bottomHeight = safeRows - 4 - topHeight;
    return {
      mode: 'medium',
      columns: safeCols,
      rows: safeRows,
      topHeight,
      bottomHeight
    };
  }

  return {
    mode: 'narrow',
    columns: safeCols,
    rows: safeRows,
    contentHeight: safeRows - 4
  };
}
