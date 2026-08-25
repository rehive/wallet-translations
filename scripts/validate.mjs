// Hard checks on one machine-produced translation. A failure is never written to disk.
//
// These exist because the wallet fails LOUDLY on some of these and SILENTLY on others. A dropped
// `{{amount}}` renders a confirm screen with a hole in it; a translated brand name renders wrong
// copy that reads as correct. Neither is caught by any downstream gate, so they are caught here.

/** i18next interpolation, e.g. `{{amount}}`. Not ICU — the wallet does not use ICU messages. */
const PLACEHOLDER = /\{\{[^}]*\}\}/g;

// Money and dates are always Latin-digit in the wallet (`lib/format-date.ts` pins `-u-nu-latn`),
// so copy that introduces Arabic-Indic or Persian digits would clash with the numbers beside it.
const NON_LATIN_DIGITS = /[٠-٩۰-۹]/;

function placeholders(value) {
  return [...String(value).matchAll(PLACEHOLDER)].map((match) => match[0]).sort();
}

function newlineCount(value) {
  return (String(value).match(/\n/g) ?? []).length;
}

/**
 * @returns {string[]} one message per problem; empty means the translation is safe to write.
 */
export function validateTranslation({ source, translation, language, doNotTranslate = [] }) {
  const problems = [];

  if (typeof translation !== 'string') {
    return [`not a string (${typeof translation})`];
  }
  if (translation.trim() === '') {
    return ['empty'];
  }

  const wanted = placeholders(source);
  const got = placeholders(translation);
  if (wanted.join('|') !== got.join('|')) {
    problems.push(`placeholders changed: expected ${wanted.join(' ') || '(none)'}, got ${got.join(' ') || '(none)'}`);
  }

  // Paragraph structure is layout: several keys are multi-paragraph help copy.
  if (newlineCount(source) !== newlineCount(translation)) {
    problems.push(`newline count changed: ${newlineCount(source)} → ${newlineCount(translation)}`);
  }

  for (const term of doNotTranslate) {
    if (source.includes(term) && !translation.includes(term)) {
      problems.push(`do-not-translate term missing: ${term}`);
    }
  }

  if (NON_LATIN_DIGITS.test(translation)) {
    problems.push('contains non-Latin digits — money and dates in the wallet are always Latin');
  }

  // A model that echoes English has not translated anything. Single words legitimately match
  // across languages (`OK`, brand names), so only flag longer copy.
  if (language !== 'en' && translation === source && source.trim().split(/\s+/).length > 3) {
    problems.push('identical to English');
  }

  return problems;
}

/** The returned batch must answer exactly the keys that were asked for. */
export function validateBatchShape(requested, returned) {
  const problems = [];
  const wanted = new Set(requested);
  const seen = new Set();
  for (const key of returned) {
    if (!wanted.has(key)) problems.push(`unexpected key: ${key}`);
    if (seen.has(key)) problems.push(`duplicate key: ${key}`);
    seen.add(key);
  }
  for (const key of requested) {
    if (!seen.has(key)) problems.push(`missing key: ${key}`);
  }
  return problems;
}
