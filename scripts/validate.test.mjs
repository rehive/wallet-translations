// node --test scripts/validate.test.mjs
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { validateBatchShape, validateTranslation } from './validate.mjs';
import { expectedKeys, pluralBase, requiredPluralSuffixes } from './lib.mjs';

const base = { source: 'Send', translation: 'Envoyer', language: 'fr' };

test('accepts a clean translation', () => {
  assert.deepEqual(validateTranslation(base), []);
});

test('rejects a dropped placeholder', () => {
  const problems = validateTranslation({
    ...base,
    source: 'Send {{amount}} to {{name}}',
    translation: 'Envoyer {{amount}}',
  });
  assert.equal(problems.length, 1);
  assert.match(problems[0], /placeholders changed/);
});

test('rejects a renamed placeholder', () => {
  const problems = validateTranslation({
    ...base,
    source: 'Send {{amount}}',
    translation: 'Envoyer {{montant}}',
  });
  assert.match(problems[0], /placeholders changed/);
});

test('rejects a translated do-not-translate term', () => {
  const problems = validateTranslation({
    ...base,
    source: 'Powered by Bridge',
    translation: 'Propulsé par Pont',
    doNotTranslate: ['Bridge'],
  });
  assert.match(problems[0], /do-not-translate term missing: Bridge/);
});

test('rejects non-Latin digits', () => {
  const problems = validateTranslation({
    source: 'Enter the 6 digit code',
    translation: 'أدخل الرمز المكون من ٦ أرقام',
    language: 'ar',
  });
  assert.match(problems.join(' '), /non-Latin digits/);
});

test('rejects a dropped paragraph break', () => {
  const problems = validateTranslation({
    ...base,
    source: 'First line.\n\nSecond line.',
    translation: 'Première ligne. Deuxième ligne.',
  });
  assert.match(problems[0], /newline count changed/);
});

test('rejects untranslated English for longer copy but allows short matches', () => {
  assert.match(
    validateTranslation({ ...base, source: 'Send money to a friend', translation: 'Send money to a friend' })[0],
    /identical to English/,
  );
  assert.deepEqual(validateTranslation({ ...base, source: 'OK', translation: 'OK' }), []);
});

test('rejects empty and non-string values', () => {
  assert.deepEqual(validateTranslation({ ...base, translation: '  ' }), ['empty']);
  assert.deepEqual(validateTranslation({ ...base, translation: 42 }), ['not a string (number)']);
});

test('batch shape catches missing, extra and duplicate keys', () => {
  assert.deepEqual(validateBatchShape(['a', 'b'], ['a', 'b']), []);
  assert.deepEqual(validateBatchShape(['a', 'b'], ['a']), ['missing key: b']);
  assert.deepEqual(validateBatchShape(['a'], ['a', 'z']), ['unexpected key: z']);
  assert.deepEqual(validateBatchShape(['a'], ['a', 'a']), ['duplicate key: a']);
});

test('plural suffixes follow CLDR per language', () => {
  assert.deepEqual(requiredPluralSuffixes('en'), ['one', 'other']);
  assert.deepEqual(requiredPluralSuffixes('ar'), ['zero', 'one', 'two', 'few', 'many', 'other']);
  assert.deepEqual(requiredPluralSuffixes('ja'), ['other']);
});

test('pluralBase only matches real plural suffixes', () => {
  assert.equal(pluralBase('accountCount_one'), 'accountCount');
  assert.equal(pluralBase('send_to_mobile'), null);
});

test('expectedKeys expands English pairs into the target language forms', () => {
  const english = { title: 'Accounts', accountCount_one: '{{count}} account', accountCount_other: '{{count}} accounts' };

  const french = expectedKeys(english, 'fr').map((entry) => entry.key);
  assert.deepEqual(french, ['title', 'accountCount_one', 'accountCount_other']);

  const arabic = expectedKeys(english, 'ar').map((entry) => entry.key);
  assert.deepEqual(arabic, [
    'title',
    'accountCount_zero',
    'accountCount_one',
    'accountCount_two',
    'accountCount_few',
    'accountCount_many',
    'accountCount_other',
  ]);

  const japanese = expectedKeys(english, 'ja').map((entry) => entry.key);
  assert.deepEqual(japanese, ['title', 'accountCount_other']);

  // Every plural form translates from the English plural, not the singular.
  assert.equal(expectedKeys(english, 'ar')[1].source, 'accountCount_other');
});
