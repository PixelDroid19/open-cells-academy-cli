export const messagesSource = `const catalogs = Object.freeze({
  en: Object.freeze({ welcome: 'Welcome, {name}!' }),
  es: Object.freeze({ welcome: '¡Bienvenida, {name}!' })
});

function academyError(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}

function installedIntlMsg() {
  const intlMsg = globalThis.IntlMsg;
  if (
    intlMsg === undefined ||
    typeof intlMsg.setLanguage !== 'function' ||
    typeof intlMsg.t !== 'function' ||
    !('loadUrlResourcesComplete' in intlMsg)
  ) {
    throw academyError('ACADEMY_I18N_NOT_INSTALLED');
  }
  return intlMsg;
}

export { catalogs };

export async function loadMessages(language) {
  const intlMsg = installedIntlMsg();
  await intlMsg.setLanguage(language);
  await intlMsg.loadUrlResourcesComplete;
  return intlMsg;
}

export function translate(key, params = {}) {
  const intlMsg = installedIntlMsg();
  const message = intlMsg.t(key, params);
  if (message === key) {
    throw academyError('ACADEMY_I18N_MISSING_KEY');
  }
  return message;
}
`;
