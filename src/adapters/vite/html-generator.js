import { typedError } from '../../domain/workspace-session.js';

const TOKENS = Object.freeze([
  Object.freeze({ token: '##app.lang##', path: Object.freeze(['app', 'lang']) }),
  Object.freeze({ token: '##app.title##', path: Object.freeze(['app', 'title']) }),
  Object.freeze({ token: '##app.description##', path: Object.freeze(['app', 'description']) }),
  Object.freeze({ token: '##app.header##', path: Object.freeze(['app', 'header']) }),
  Object.freeze({ token: '##app.name##', path: Object.freeze(['app', 'name']) }),
  Object.freeze({ token: '##app.version##', path: Object.freeze(['app', 'version']) }),
  Object.freeze({ token: '##env.mode##', path: Object.freeze(['env', 'mode']) })
]);

function isPlainObject(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function requirePlainObject(value, code, field) {
  try {
    if (!isPlainObject(value)) {
      throw typedError(code, { field });
    }
    return value;
  } catch (cause) {
    if (cause?.code === code) {
      throw cause;
    }
    throw typedError(code, { field });
  }
}

function countOccurrences(template, token) {
  let count = 0;
  let index = template.indexOf(token);
  while (index !== -1) {
    count += 1;
    index = template.indexOf(token, index + token.length);
  }
  return count;
}

function assertTemplate(template) {
  if (typeof template !== 'string') {
    throw typedError('HTML_TEMPLATE_INVALID', { field: 'template' });
  }
  for (const entry of TOKENS) {
    if (countOccurrences(template, entry.token) !== 1) {
      throw typedError('HTML_TEMPLATE_INVALID', { token: entry.token });
    }
  }
  const literalTokens = template.match(/##[\s\S]*?##/g) ?? [];
  if (literalTokens.length !== TOKENS.length || literalTokens.some(token => !TOKENS.some(entry => entry.token === token))) {
    throw typedError('HTML_TEMPLATE_INVALID');
  }
}

function valueAt(values, entry) {
  let current = values;
  for (const segment of entry.path) {
    try {
      if (!isPlainObject(current) || !Object.hasOwn(current, segment)) {
        throw typedError('HTML_VALUE_MISSING', { field: entry.path.join('.') });
      }
      current = current[segment];
    } catch (cause) {
      if (cause?.code === 'HTML_VALUE_MISSING') {
        throw cause;
      }
      throw typedError('HTML_VALUE_MISSING', { field: entry.path.join('.') });
    }
  }
  if (typeof current !== 'string') {
    throw typedError('HTML_VALUE_MISSING', { field: entry.path.join('.') });
  }
  return current;
}

function escapeHtml(value) {
  return value.replace(/[&<>"']/g, character => {
    switch (character) {
      case '&':
        return '&amp;';
      case '<':
        return '&lt;';
      case '>':
        return '&gt;';
      case '"':
        return '&quot;';
      default:
        return '&#39;';
    }
  });
}

/**
 * Renders a complete application document from a literal seven-token template.
 * Values use the public nested shape `{ app: {...}, env: { mode } }`.
 */
export function generateAppHtml(request) {
  const validRequest = requirePlainObject(request, 'HTML_TEMPLATE_INVALID', 'request');
  let template;
  try {
    template = validRequest.template;
  } catch {
    throw typedError('HTML_TEMPLATE_INVALID', { field: 'request' });
  }
  assertTemplate(template);
  let values;
  try {
    values = validRequest.values;
  } catch {
    throw typedError('HTML_VALUE_MISSING', { field: 'values' });
  }
  requirePlainObject(values, 'HTML_VALUE_MISSING', 'values');
  let output = template;
  for (const entry of TOKENS) {
    output = output.replace(entry.token, escapeHtml(valueAt(values, entry)));
  }
  if (/##[\s\S]*?##/.test(output)) {
    throw typedError('HTML_TEMPLATE_INVALID');
  }
  return output;
}
