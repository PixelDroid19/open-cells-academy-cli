import { typedError } from '../../domain/workspace-session.js';

const APP_PATTERNS = Object.freeze(['app/**/*.js', 'app/**/*.mjs']);
const COMPONENT_PATTERNS = Object.freeze(['src/**/*.{js,mjs}', 'test/**/*.{js,mjs}', '*.js']);
const BASE_LANGUAGE_OPTIONS = Object.freeze({ ecmaVersion: 'latest', sourceType: 'module' });

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function assertApi(api) {
  if (!isRecord(api) || typeof api.ESLint !== 'function') {
    throw typedError('LINT_ESLINT_INVALID');
  }
}

function assertSession(session) {
  if (!isRecord(session) || typeof session.root !== 'string' || session.root.length === 0) {
    throw typedError('WORKSPACE_INVALID');
  }
}

function assertPlugins(plugins) {
  if (plugins === undefined) return Object.freeze({});
  if (!isRecord(plugins)) throw typedError('LINT_CONFIG_INVALID');
  const allowed = new Set(['lit', 'wc', 'html', 'litA11y', 'htmlEslint']);
  for (const key of Object.keys(plugins)) {
    if (!allowed.has(key)) throw typedError('LINT_CONFIG_INVALID');
    if (plugins[key] === null || typeof plugins[key] !== 'object') throw typedError('LINT_CONFIG_INVALID');
  }
  return Object.freeze({ ...plugins });
}

function pluginConfigBlock(plugins) {
  const config = {};
  if (plugins.lit !== undefined) config.plugins = { ...(config.plugins ?? {}), lit: plugins.lit };
  if (plugins.wc !== undefined) config.plugins = { ...(config.plugins ?? {}), wc: plugins.wc };
  if (plugins.html !== undefined) config.plugins = { ...(config.plugins ?? {}), html: plugins.html };
  if (plugins.litA11y !== undefined) config.plugins = { ...(config.plugins ?? {}), 'lit-a11y': plugins.litA11y };
  if (plugins.htmlEslint !== undefined) config.plugins = { ...(config.plugins ?? {}), '@html-eslint': plugins.htmlEslint };
  return config;
}

function flatConfigFor(kind, plugins, fix) {
  const base = Object.freeze({
    name: 'academy-base',
    files: kind === 'app' ? ['**/*.js', '**/*.mjs'] : ['src/**/*.js', 'src/**/*.mjs', 'test/**/*.js', '*.js'],
    languageOptions: BASE_LANGUAGE_OPTIONS,
    rules: Object.freeze({ 'no-const-assign': 'error', 'no-extra-semi': fix ? 'off' : 'error' })
  });
  const pluginBlock = pluginConfigBlock(plugins);
  const blocks = [];
  if (pluginBlock.plugins !== undefined) {
    const litRules = plugins.lit === undefined ? {} : Object.freeze({ 'lit/no-legacy-template-syntax': 'error' });
    const wcRules = plugins.wc === undefined ? {} : Object.freeze({ 'wc/no-constructor-attributes': 'warn' });
    blocks.push(Object.freeze({
      name: 'academy-web-components',
      files: ['**/*.js', '**/*.mjs'],
      ...pluginBlock,
      rules: Object.freeze({ ...litRules, ...wcRules })
    }));
  }
  if (plugins.html !== undefined) {
    blocks.push(Object.freeze({
      name: 'academy-html',
      files: ['**/*.html'],
      plugins: { html: plugins.html },
      rules: Object.freeze({})
    }));
  }
  if (plugins.litA11y !== undefined) {
    blocks.push(Object.freeze({
      name: 'academy-lit-a11y',
      files: ['**/*.js', '**/*.mjs'],
      plugins: { 'lit-a11y': plugins.litA11y },
      rules: Object.freeze({ 'lit-a11y/alt-text': 'warn' })
    }));
  }
  if (plugins.htmlEslint !== undefined) {
    blocks.push(Object.freeze({
      name: 'academy-html-eslint',
      files: ['**/*.html'],
      plugins: { '@html-eslint': plugins.htmlEslint },
      rules: Object.freeze({ '@html-eslint/indent': 'off' })
    }));
  }
  return Object.freeze([base, ...blocks]);
}

function patternsFor(kind) {
  return kind === 'app' ? APP_PATTERNS : COMPONENT_PATTERNS;
}

function resultSummary(results) {
  let errorCount = 0;
  let warningCount = 0;
  const messages = [];
  for (const result of results ?? []) {
    if (!isRecord(result)) continue;
    errorCount += Number.isInteger(result.errorCount) ? result.errorCount : 0;
    warningCount += Number.isInteger(result.warningCount) ? result.warningCount : 0;
    for (const message of result.messages ?? []) {
      if (isRecord(message) && typeof message.ruleId === 'string' && typeof message.message === 'string' && Number.isInteger(message.severity)) {
        messages.push(Object.freeze({
          ruleId: message.ruleId,
          message: message.message,
          severity: message.severity,
          line: message.line,
          column: message.column,
          filePath: result.filePath
        }));
      }
    }
  }
  return Object.freeze({ errorCount, warningCount, messages: Object.freeze(messages) });
}

/**
 * Adapter around the injected public ESLint v9 flat-config API. The
 * composition root resolves the `ESLint` constructor and the public Lit/Web
 * Component plugin objects, so importing this module never requires ESLint to
 * exist.
 */
export class EslintAdapter {
  #api;

  constructor(api) {
    assertApi(api);
    this.#api = api;
    Object.freeze(this);
  }

  async lint({ session, kind, fix = false, abortOnFailure = true, plugins = undefined }) {
    assertSession(session);
    if (kind !== 'app' && kind !== 'component') throw typedError('LINT_INVALID');
    if (typeof fix !== 'boolean' || typeof abortOnFailure !== 'boolean') throw typedError('LINT_INVALID');
    const normalizedPlugins = assertPlugins(plugins);
    const flatConfig = flatConfigFor(kind, normalizedPlugins, fix);
    let instance;
    try {
      instance = new this.#api.ESLint(Object.freeze({
        cwd: session.root,
        fix,
        overrideConfig: Object.freeze(flatConfig)
      }));
    } catch (cause) {
      throw typedError('LINT_CONFIG_FAILED');
    }
    if (!isRecord(instance) || typeof instance.lintFiles !== 'function') throw typedError('LINT_ESLINT_INVALID');
    let results;
    try {
      results = await instance.lintFiles(patternsFor(kind));
    } catch (cause) {
      throw typedError('LINT_TOOL_FAILED');
    }
    if (!Array.isArray(results)) throw typedError('LINT_TOOL_FAILED');
    const summary = resultSummary(results);
    if (summary.errorCount > 0 && abortOnFailure) {
      throw typedError('LINT_ABORTED', { errorCount: summary.errorCount });
    }
    return Object.freeze({ ok: summary.errorCount === 0, ...summary });
  }
}
