import { translate } from '../i18n/translator.js';

function renderMessage(message, language) {
  return translate(language, message.key, message.params);
}

/**
 * Converts an Outcome into an entrypoint-neutral stream payload.
 *
 * @param {{ok: boolean}} outcome
 * @param {string} language
 * @returns {{stdout: string, stderr: string, exitCode: number}}
 */
export function renderOutcome(outcome, language = 'en') {
  if (outcome.ok) {
    const messages = (outcome.messages ?? []).map(message => renderMessage(message, language));
    return {
      stdout: messages.length === 0 ? '' : `${messages.join('\n')}\n`,
      stderr: '',
      exitCode: 0
    };
  }

  const lines = [translate(language, outcome.messageKey, outcome.params)];
  if (outcome.remediationKey) {
    lines.push(translate(language, outcome.remediationKey, outcome.params));
  }
  return { stdout: '', stderr: `${lines.join('\n')}\n`, exitCode: 1 };
}
