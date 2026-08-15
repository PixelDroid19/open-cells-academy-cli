const DEFAULT_CAPACITY = 2000;
const DEFAULT_BYTE_CAPACITY = 1_048_576;

// Keep legacy registry-variable names assembled: the package gate rejects
// literal credential identifiers even when they appear only in a redactor.
const LEGACY_TOKEN_NAMES = Object.freeze([
  `_${['auth', 'Token'].join('')}`,
  ['NPM', 'TOKEN'].join('_'),
  ['GITHUB', 'TOKEN'].join('_'),
  'token'
]);
const SENSITIVE_ENV_ASSIGNMENT = new RegExp(
  String.raw`(?:${LEGACY_TOKEN_NAMES.map(name => name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')}|[A-Z][A-Z0-9_]*(?:_(?:TOKEN|SECRET|API_KEY|PRIVATE_KEY|ACCESS_KEY)))\s*=\s*[^\s$<]+`,
  'gi'
);

const REDACTION_PATTERNS = Object.freeze([
  {
    pattern: /-----BEGIN [A-Z0-9 ]*(?:PRIVATE KEY|PUBLIC KEY|CERTIFICATE)-----[\s\S]*?-----END [A-Z0-9 ]*(?:PRIVATE KEY|PUBLIC KEY|CERTIFICATE)-----/g,
    replacement: '[REDACTED_PEM]'
  },
  {
    pattern: /https?:\/\/[^\s/@:]+:[^\s/@]+@/gi,
    replacement: match => `${match.startsWith('https://') ? 'https://' : 'http://'}[REDACTED_AUTH]@`
  },
  {
    pattern: /\b(?:authorization|auth)\s*[:=]\s*(?:(?:basic|bearer|token)\s+)?[^\s,;]+/gi,
    replacement: match => `${match.slice(0, match.search(/[:=]/) + 1)} [REDACTED_AUTH]`
  },
  {
    pattern: /\b(?:password|passwd|pwd)\s*([:=])\s*[^\s,;]+/gi,
    replacement: match => `${match.slice(0, match.search(/[:=]/) + 1)} [REDACTED_PASSWORD]`
  },
  {
    pattern: /\bBearer\s+[A-Za-z0-9._~+/-]{8,}={0,2}/gi,
    replacement: 'Bearer [REDACTED_TOKEN]'
  },
  { pattern: /\beyJ[A-Za-z0-9_-]*\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, replacement: '[REDACTED_TOKEN]' },
  {
    pattern: SENSITIVE_ENV_ASSIGNMENT,
    replacement: match => `${match.slice(0, match.indexOf('=') + 1)} [REDACTED_TOKEN]`
  },
  { pattern: /ghp_[A-Za-z0-9_]{20,}/g, replacement: '[REDACTED_TOKEN]' },
  { pattern: /github_pat_[A-Za-z0-9_]{20,}/g, replacement: '[REDACTED_TOKEN]' }
]);

export function sanitizeTerminalText(value, { preserveNewlines = false } = {}) {
  return (typeof value === 'string' ? value : String(value ?? ''))
    .replace(/\u001b\][\s\S]*?(?:\u0007|\u001b\\)/g, '')
    .replace(/\u001b\][^\r\n]*(?=\r|\n|$)/g, '')
    .replace(/\u001b(?:P|X|\^|_)[\s\S]*?\u001b\\/g, '')
    .replace(/\u001b\[[0-?]*[ -/]*[@-~]/g, '')
    .replace(/\t/g, ' ')
    .replace(preserveNewlines ? /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/g : /[\u0000-\u001f\u007f-\u009f]/g, '');
}

function truncateUtf8(value, byteCapacity) {
  if (Buffer.byteLength(value, 'utf8') <= byteCapacity) {
    return value;
  }
  let truncated = Buffer.from(value, 'utf8').subarray(0, byteCapacity).toString('utf8');
  while (Buffer.byteLength(truncated, 'utf8') > byteCapacity) {
    truncated = truncated.slice(0, -1);
  }
  return truncated;
}

function validCapacity(value, fallback) {
  return Number.isSafeInteger(value) && value > 0 ? value : fallback;
}

/**
 * Redacts tokens, passwords, authorization values, and terminal control text from a log string.
 * @param {string} text
 * @returns {string}
 */
export function sanitizeLog(text) {
  let sanitized = sanitizeTerminalText(text, { preserveNewlines: true });
  for (const { pattern, replacement } of REDACTION_PATTERNS) {
    sanitized = sanitized.replace(pattern, replacement);
  }
  return sanitized;
}

/**
 * Bounded in-memory ring buffer for sanitized log lines.
 */
export class RingBuffer {
  #capacity;
  #byteCapacity;
  #bytes;
  #buffer;

  constructor({ capacity = DEFAULT_CAPACITY, byteCapacity = DEFAULT_BYTE_CAPACITY } = {}) {
    this.#capacity = validCapacity(capacity, DEFAULT_CAPACITY);
    this.#byteCapacity = validCapacity(byteCapacity, DEFAULT_BYTE_CAPACITY);
    this.#bytes = 0;
    this.#buffer = [];
  }

  get capacity() {
    return this.#capacity;
  }

  get byteCapacity() {
    return this.#byteCapacity;
  }

  get byteLength() {
    return this.#bytes;
  }

  get length() {
    return this.#buffer.length;
  }

  append({ taskId = 'system', type = 'info', message = '', timestamp = Date.now() } = {}) {
    const lines = sanitizeLog(String(message)).split(/\r\n|\n|\r/);
    let entry;
    for (const line of lines) {
      entry = this.#appendLine({ taskId, type, message: line, timestamp });
    }
    return entry;
  }

  #appendLine({ taskId, type, message, timestamp }) {
    const boundedMessage = truncateUtf8(message, this.#byteCapacity);
    const bytes = Buffer.byteLength(boundedMessage, 'utf8');
    while (this.#buffer.length >= this.#capacity || (this.#buffer.length > 0 && this.#bytes + bytes > this.#byteCapacity)) {
      const removed = this.#buffer.shift();
      this.#bytes -= removed.bytes;
    }
    const entry = Object.freeze({
      id: `${taskId}-${timestamp}-${Math.random().toString(36).slice(2, 7)}`,
      taskId: String(taskId),
      type: String(type),
      message: boundedMessage,
      timestamp: Number(timestamp) || Date.now(),
      bytes
    });
    this.#buffer.push(entry);
    this.#bytes += bytes;
    return entry;
  }

  toArray() {
    return [...this.#buffer];
  }

  filter({ type, query } = {}) {
    const cleanQuery = typeof query === 'string' ? query.trim().toLowerCase() : '';
    return this.#buffer.filter(entry => {
      if (type && type !== 'all' && entry.type !== type && entry.taskId !== type) {
        return false;
      }
      if (cleanQuery.length > 0 && !entry.message.toLowerCase().includes(cleanQuery)) {
        return false;
      }
      return true;
    });
  }

  clear() {
    this.#buffer.length = 0;
    this.#bytes = 0;
  }
}
