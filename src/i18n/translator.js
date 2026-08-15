import en from './en.js';
import es from './es.js';

const catalogs = Object.freeze({ en, es });

function catalogFor(language) {
  return catalogs[language] ?? catalogs.en;
}

/**
 * Resolves a catalog key without allowing application code to embed visible
 * command-line text.
 *
 * @param {string} language
 * @param {string} key
 * @param {Record<string, unknown>} [params]
 * @returns {string}
 */
export function translate(language, key, params = {}) {
  const template = catalogFor(language)[key] ?? catalogFor('en')[key] ?? key;
  return template.replace(/\{([A-Za-z0-9_]+)\}/g, (placeholder, name) => {
    if (!Object.hasOwn(params, name)) {
      return placeholder;
    }
    return String(params[name]);
  });
}

export function supportedLanguage(language) {
  return language === 'en' || language === 'es';
}
