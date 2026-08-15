import { translate } from '../i18n/translator.js';
import { findCommand } from '../domain/tui/command-catalog.js';

function optionUsage(option, language) {
  const aliases = option.aliases.join(', ');
  const type = option.type === 'jsonOrPath' ? 'json' : option.type;
  const placeholder = option.type === 'boolean' ? '' : ` <${translate(language, `type_${type}`)}>`;
  const annotations = [];

  if (option.required) {
    annotations.push(translate(language, 'required'));
  }
  if (Object.hasOwn(option, 'defaultValue')) {
    annotations.push(translate(language, 'default_value', { value: String(option.defaultValue) }));
  }
  if (option.choices !== undefined) {
    annotations.push(translate(language, 'choices', { values: option.choices.join('|') }));
  }

  const negation = option.type === 'boolean' ? option.aliases.find(alias => alias.startsWith('--')) : undefined;
  const suffix = annotations.length === 0 ? '' : ` (${annotations.join('; ')})`;
  const negationHint = negation ? `; --no-${negation.slice(2)}` : '';
  return `  ${aliases}${placeholder}${negationHint}${suffix}`;
}

function rootHelp(registry, language) {
  const lines = [
    translate(language, 'cli_title'),
    '',
    translate(language, 'usage_root'),
    '',
    translate(language, 'commands_heading')
  ];

  for (const command of registry.values()) {
    lines.push(`  ${command.name.padEnd(25)} ${translate(language, command.summaryKey)}`);
  }

  lines.push(
    '',
    translate(language, 'global_options_heading'),
    `  -h, --help                 ${translate(language, 'show_help')}`,
    `  -v, --version              ${translate(language, 'show_version')}`,
    `  -l, --language <en|es>     ${translate(language, 'language_option')}`
  );

  return `${lines.join('\n')}\n`;
}

function commandHelp(command, language) {
  const lines = [
    translate(language, 'usage_command', { command: command.name }),
    '',
    translate(language, command.summaryKey),
    '',
    translate(language, 'options_heading')
  ];

  if (command.options.length === 0) {
    lines.push(`  ${translate(language, 'none')}`);
  } else {
    for (const option of command.options) {
      lines.push(optionUsage(option, language));
    }
  }

  const catalogItem = findCommand(command.name);
  if (catalogItem?.aliases && catalogItem.aliases.length > 0) {
    lines.push('', translate(language, 'aliases_heading'));
    for (const alias of catalogItem.aliases) {
      lines.push(`  ${alias}`);
    }
  }

  lines.push('', translate(language, 'global_options_heading'));
  lines.push(`  -h, --help                 ${translate(language, 'show_help')}`);
  lines.push(`  -l, --language <en|es>     ${translate(language, 'language_option')}`);
  return `${lines.join('\n')}\n`;
}

/**
 * Renders help entirely from the immutable grammar.
 *
 * @param {ReadonlyMap<string, Readonly<object>>} registry
 * @param {string} language
 * @param {string | Readonly<object> | undefined} commandReference
 * @returns {string}
 */
export function renderHelp(registry, language = 'en', commandReference = undefined) {
  const command =
    typeof commandReference === 'string'
      ? registry.get(commandReference)
      : commandReference;

  return command ? commandHelp(command, language) : rootHelp(registry, language);
}
