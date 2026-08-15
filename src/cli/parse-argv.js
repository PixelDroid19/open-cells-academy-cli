import { deepFreeze } from '../domain/command-definition.js';
import { fail } from '../domain/outcome.js';
import { supportedLanguage } from '../i18n/translator.js';

const ROOT_HELP_OPTIONS = new Set(['--help', '-h']);
const ROOT_VERSION_OPTIONS = new Set(['--version', '-v']);
const LANGUAGE_OPTIONS = new Set(['--language', '-l']);
const COMMAND_ALIASES = new Map([
  ['lit-component:serve', 'component:dev'],
  ['lit-components:serve', 'component:dev'],
  ['lit-component:test', 'component:test'],
  ['lit-component:documentation', 'component:documentation'],
  ['lit-component:locales', 'component:locales'],
  ['lit-component:build:demo', 'component:build:demo'],
  ['lit-component:lint', 'component:lint']
]);

function freezeResult(result) {
  return Object.freeze(result);
}

function resolveLocale(context) {
  if (typeof context.locale === 'string') {
    return context.locale;
  }

  try {
    return Intl.DateTimeFormat().resolvedOptions().locale;
  } catch {
    return 'en';
  }
}

function languageFromAmbient(value) {
  if (typeof value !== 'string') {
    return undefined;
  }

  const language = value.toLowerCase().replace('_', '-').split('-')[0];
  return supportedLanguage(language) ? language : undefined;
}

function ambientLanguage(context) {
  const environment = context.env ?? process.env;
  return languageFromAmbient(environment.CELLS_ACADEMY_LANGUAGE) ?? languageFromAmbient(resolveLocale(context)) ?? 'en';
}

function error(language, code, messageKey, params) {
  return freezeResult({ ...fail(code, messageKey, params), language });
}

function splitOption(token) {
  const equalIndex = token.indexOf('=');
  if (equalIndex === -1) {
    return { alias: token, hasInlineValue: false, inlineValue: undefined };
  }
  return {
    alias: token.slice(0, equalIndex),
    hasInlineValue: true,
    inlineValue: token.slice(equalIndex + 1)
  };
}

function parseLanguageValue(alias, rawValue, fallbackLanguage) {
  if (rawValue === undefined || rawValue === '') {
    return { error: error(fallbackLanguage, 'INVALID_INPUT', 'missing_option_value', { option: alias }) };
  }

  const language = String(rawValue).toLowerCase();
  if (!supportedLanguage(language)) {
    return {
      error: error(fallbackLanguage, 'INVALID_INPUT', 'invalid_choice', { option: alias, choices: 'en, es' })
    };
  }
  return { language };
}

function consumeGlobalLanguage(argv, index, language) {
  const token = argv[index];
  if (typeof token !== 'string') {
    return undefined;
  }
  const { alias, hasInlineValue, inlineValue } = splitOption(token);
  if (!LANGUAGE_OPTIONS.has(alias)) {
    return undefined;
  }

  if (hasInlineValue) {
    const parsed = parseLanguageValue(alias, inlineValue, language);
    return parsed.error ? { error: parsed.error } : { nextIndex: index + 1, language: parsed.language };
  }

  const parsed = parseLanguageValue(alias, argv[index + 1], language);
  return parsed.error ? { error: parsed.error } : { nextIndex: index + 2, language: parsed.language };
}

function parseBoolean(value) {
  if (typeof value !== 'string') {
    return undefined;
  }

  if (value.toLowerCase() === 'true') {
    return true;
  }
  if (value.toLowerCase() === 'false') {
    return false;
  }
  return undefined;
}

function parseValue(option, rawValue) {
  if (option.type === 'string') {
    return { value: rawValue };
  }

  if (option.type === 'number') {
    const parsed = Number(rawValue);
    if (!Number.isFinite(parsed) || !Number.isInteger(parsed)) {
      return { error: ['INVALID_INPUT', 'invalid_option_type', { option: option.aliases[0], expected: 'number' }] };
    }
    if (option.name === 'port' && (parsed < 1 || parsed > 65535)) {
      return { error: ['INVALID_INPUT', 'invalid_port', { option: option.aliases[0] }] };
    }
    return { value: parsed };
  }

  if (option.type === 'json') {
    try {
      return { value: JSON.parse(rawValue) };
    } catch {
      return { error: ['INVALID_INPUT', 'invalid_option_type', { option: option.aliases[0], expected: 'json' }] };
    }
  }

  if (option.type === 'jsonOrPath') {
    const firstCharacter = rawValue.trimStart().charAt(0);
    if (firstCharacter !== '{' && firstCharacter !== '[') {
      return { value: rawValue };
    }
    try {
      const value = JSON.parse(rawValue);
      if (value === null || typeof value !== 'object' || Array.isArray(value)) {
        return { error: ['INVALID_INPUT', 'invalid_option_type', { option: option.aliases[0], expected: 'json' }] };
      }
      return { value };
    } catch {
      return { error: ['INVALID_INPUT', 'invalid_option_type', { option: option.aliases[0], expected: 'json' }] };
    }
  }

  return { error: ['INVALID_INPUT', 'invalid_option_type', { option: option.aliases[0], expected: option.type }] };
}

function optionIndex(definition) {
  const byAlias = new Map();
  for (const option of definition.options) {
    for (const alias of option.aliases) {
      byAlias.set(alias, option);
    }
  }
  return byAlias;
}

function negatedBooleanOption(alias, options) {
  if (!alias.startsWith('--no-')) {
    return undefined;
  }

  const positiveAlias = `--${alias.slice('--no-'.length)}`;
  const option = options.get(positiveAlias);
  return option?.type === 'boolean' ? option : undefined;
}

function isValueToken(token, type) {
  if (token === undefined) {
    return false;
  }

  if (typeof token !== 'string' || !token.startsWith('-')) {
    return true;
  }

  return type === 'number' && /^-\d+$/.test(token);
}

function commandResult(command, options, providedOptions, language) {
  return freezeResult({
    ok: true,
    action: 'command',
    command,
    options: deepFreeze(options),
    providedOptions: deepFreeze(providedOptions),
    language
  });
}

function helpResult(language, command = undefined) {
  return freezeResult({ ok: true, action: 'help', command, language });
}

function commandFromRegistry(registry, token) {
  return registry.get(token) ?? registry.get(COMMAND_ALIASES.get(token));
}

function validateRequired(command, options, language) {
  for (const option of command.options) {
    if (option.required && !Object.hasOwn(options, option.name)) {
      return error(language, 'INVALID_INPUT', 'missing_required_option', {
        option: option.aliases[0],
        command: command.name
      });
    }
  }
  return undefined;
}

function parseCommand(argv, command, startIndex, initialLanguage) {
  const aliases = optionIndex(command);
  const options = {};
  const providedOptions = {};
  let language = initialLanguage;

  for (const option of command.options) {
    if (Object.hasOwn(option, 'defaultValue')) {
      options[option.name] = option.defaultValue;
    }
  }

  for (let index = startIndex; index < argv.length; index += 1) {
    const token = argv[index];
    if (typeof token !== 'string' || !token.startsWith('-')) {
      return error(language, 'INVALID_INPUT', 'unknown_option', { option: String(token), command: command.name });
    }

    const { alias, hasInlineValue, inlineValue } = splitOption(token);
    const option = aliases.get(alias);

    if (option) {
      if (option.type === 'boolean') {
        if (hasInlineValue) {
          const parsed = parseBoolean(inlineValue);
          if (parsed === undefined) {
            return error(language, 'INVALID_INPUT', 'invalid_option_type', { option: alias, expected: 'boolean' });
          }
          options[option.name] = parsed;
          providedOptions[option.name] = parsed;
          continue;
        }

        const parsedNext = parseBoolean(argv[index + 1]);
        if (parsedNext !== undefined) {
          options[option.name] = parsedNext;
          providedOptions[option.name] = parsedNext;
          index += 1;
        } else {
          options[option.name] = true;
          providedOptions[option.name] = true;
        }
        continue;
      }

      let rawValue;
      if (hasInlineValue) {
        rawValue = inlineValue;
      } else if (isValueToken(argv[index + 1], option.type)) {
        rawValue = argv[index + 1];
        index += 1;
      } else {
        return error(language, 'INVALID_INPUT', 'missing_option_value', { option: alias });
      }

      if (rawValue === '') {
        return error(language, 'INVALID_INPUT', 'missing_option_value', { option: alias });
      }

      const parsed = parseValue(option, rawValue);
      if (parsed.error) {
        return error(language, ...parsed.error);
      }

      if (option.choices !== undefined && !option.choices.includes(parsed.value)) {
        return error(language, 'INVALID_INPUT', 'invalid_choice', {
          option: alias,
          choices: option.choices.join(', ')
        });
      }

      options[option.name] = parsed.value;
      providedOptions[option.name] = parsed.value;
      continue;
    }

    const negated = negatedBooleanOption(alias, aliases);
    if (negated && !hasInlineValue) {
      options[negated.name] = false;
      providedOptions[negated.name] = false;
      continue;
    }

    if (ROOT_HELP_OPTIONS.has(alias)) {
      for (let next = index + 1; next < argv.length; next += 1) {
        const globalLanguage = consumeGlobalLanguage(argv, next, language);
        if (globalLanguage) {
          if (globalLanguage.error) {
            return globalLanguage.error;
          }
          language = globalLanguage.language;
          next = globalLanguage.nextIndex - 1;
          continue;
        }
        return error(language, 'UNKNOWN_OPTION', 'unknown_option', { option: splitOption(argv[next]).alias, command: command.name });
      }
      return helpResult(language, command);
    }

    const globalLanguage = consumeGlobalLanguage(argv, index, language);
    if (globalLanguage) {
      if (globalLanguage.error) {
        return globalLanguage.error;
      }
      language = globalLanguage.language;
      index = globalLanguage.nextIndex - 1;
      continue;
    }

    return error(language, 'UNKNOWN_OPTION', 'unknown_option', { option: alias, command: command.name });
  }

  return validateRequired(command, options, language) ?? commandResult(command, options, providedOptions, language);
}

function parseRootAction(argv, startIndex, action, language) {
  let resolvedLanguage = language;
  for (let index = startIndex; index < argv.length; index += 1) {
    const globalLanguage = consumeGlobalLanguage(argv, index, resolvedLanguage);
    if (globalLanguage) {
      if (globalLanguage.error) {
        return globalLanguage.error;
      }
      resolvedLanguage = globalLanguage.language;
      index = globalLanguage.nextIndex - 1;
      continue;
    }
    return error(resolvedLanguage, 'UNKNOWN_OPTION', 'unknown_option', {
      option: splitOption(String(argv[index])).alias
    });
  }
  return action === 'help' ? helpResult(resolvedLanguage) : freezeResult({ ok: true, action, language: resolvedLanguage });
}

function parseHelpCommand(argv, commandIndex, registry, language) {
  let target;
  let resolvedLanguage = language;
  for (let index = commandIndex + 1; index < argv.length; index += 1) {
    const globalLanguage = consumeGlobalLanguage(argv, index, resolvedLanguage);
    if (globalLanguage) {
      if (globalLanguage.error) {
        return globalLanguage.error;
      }
      resolvedLanguage = globalLanguage.language;
      index = globalLanguage.nextIndex - 1;
      continue;
    }
    if (target !== undefined) {
      return error(resolvedLanguage, 'UNKNOWN_OPTION', 'unknown_option', { option: splitOption(String(argv[index])).alias, command: 'help' });
    }
    target = argv[index];
  }

  if (target === undefined) {
    return helpResult(resolvedLanguage);
  }

  const command = commandFromRegistry(registry, target);
  if (!command) {
    return error(resolvedLanguage, 'UNKNOWN_COMMAND', 'unknown_command', { command: target });
  }
  return helpResult(resolvedLanguage, command);
}

function isInteractiveTty(context) {
  const env = context.env ?? process.env;
  if (env.CI && env.CI !== 'false' && env.CI !== '0') {
    return false;
  }
  if (env.TERM === 'dumb') {
    return false;
  }
  if (typeof context.isTTY === 'boolean') {
    return context.isTTY;
  }
  const stdinTty = context.stdin?.isTTY ?? (typeof process.stdin?.isTTY === 'boolean' ? process.stdin.isTTY : undefined);
  const stdoutTty = context.stdout?.isTTY ?? (typeof process.stdout?.isTTY === 'boolean' ? process.stdout.isTTY : undefined);
  if (stdinTty !== undefined && stdoutTty !== undefined) {
    return Boolean(stdinTty && stdoutTty);
  }
  return false;
}

function parseTuiAction(argv, startIndex, language) {
  let resolvedLanguage = language;
  let animation = true;
  for (let index = startIndex; index < argv.length; index += 1) {
    const token = argv[index];
    const globalLanguage = consumeGlobalLanguage(argv, index, resolvedLanguage);
    if (globalLanguage) {
      if (globalLanguage.error) {
        return globalLanguage.error;
      }
      resolvedLanguage = globalLanguage.language;
      index = globalLanguage.nextIndex - 1;
      continue;
    }
    const { alias } = splitOption(String(token));
    if (alias === '--no-animation') {
      animation = false;
      continue;
    }
    if (alias === '--animation') {
      animation = true;
      continue;
    }
    if (ROOT_HELP_OPTIONS.has(alias)) {
      return helpResult(resolvedLanguage);
    }
    return error(resolvedLanguage, 'UNKNOWN_OPTION', 'unknown_option', {
      option: alias,
      command: 'tui'
    });
  }
  return freezeResult({
    ok: true,
    action: 'tui',
    options: Object.freeze({ animation }),
    language: resolvedLanguage
  });
}

function tuiFallbackHelp(argv, startIndex, language) {
  let resolvedLanguage = language;
  for (let index = startIndex; index < argv.length; index += 1) {
    const globalLanguage = consumeGlobalLanguage(argv, index, resolvedLanguage);
    if (globalLanguage === undefined) {
      continue;
    }
    if (globalLanguage.error) {
      return globalLanguage.error;
    }
    resolvedLanguage = globalLanguage.language;
    index = globalLanguage.nextIndex - 1;
  }
  return helpResult(resolvedLanguage);
}

/**
 * Parses the raw CLI grammar without executing a command.
 *
 * @param {string[]} argv
 * @param {ReadonlyMap<string, Readonly<object>>} registry
 * @param {{env?: Record<string, string | undefined>, locale?: string, isTTY?: boolean, stdin?: {isTTY?: boolean}, stdout?: {isTTY?: boolean}}} [context]
 * @returns {Readonly<object>}
 */
export function parseArgv(argv, registry, context = {}) {
  const input = Array.isArray(argv) ? [...argv] : [];
  let language = ambientLanguage(context);

  for (let index = 0; index < input.length; index += 1) {
    const token = input[index];
    const globalLanguage = consumeGlobalLanguage(input, index, language);
    if (globalLanguage) {
      if (globalLanguage.error) {
        return globalLanguage.error;
      }
      language = globalLanguage.language;
      index = globalLanguage.nextIndex - 1;
      continue;
    }

    if (ROOT_HELP_OPTIONS.has(token)) {
      return parseRootAction(input, index + 1, 'help', language);
    }

    if (ROOT_VERSION_OPTIONS.has(token)) {
      return parseRootAction(input, index + 1, 'version', language);
    }

    if (token === 'tui') {
      if (!isInteractiveTty(context)) {
        return tuiFallbackHelp(input, index + 1, language);
      }
      return parseTuiAction(input, index + 1, language);
    }

    if (typeof token === 'string' && token.startsWith('-')) {
      return error(language, 'UNKNOWN_OPTION', 'unknown_root_option', { option: splitOption(token).alias });
    }

    if (token === 'help') {
      return parseHelpCommand(input, index, registry, language);
    }

    const command = commandFromRegistry(registry, token);
    if (!command) {
      return error(language, 'UNKNOWN_COMMAND', 'unknown_command', { command: String(token) });
    }

    return parseCommand(input, command, index + 1, language);
  }

  if (isInteractiveTty(context)) {
    return freezeResult({
      ok: true,
      action: 'tui',
      options: Object.freeze({ animation: true }),
      language
    });
  }

  return helpResult(language);
}
