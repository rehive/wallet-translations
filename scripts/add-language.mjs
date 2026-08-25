#!/usr/bin/env node
// Scaffold a language: node scripts/add-language.mjs <locale>
//
// This does NOT mirror English's key shape. It writes the plural forms the TARGET language needs —
// six for `ar`, one for `ja` — because that is what the wallet's parity gate demands and what
// `diff.mjs` will keep in step from here on.

import process from 'node:process';
import { existsSync } from 'node:fs';
import {
  SOURCE_FILE,
  expectedKeys,
  localeFile,
  readJson,
  setPath,
  writeJson,
  writeLock,
} from './lib.mjs';

const locale = process.argv[2];
if (!locale) {
  console.error('usage: node scripts/add-language.mjs <locale>   e.g. fr, pt-BR, ar');
  process.exit(1);
}
if (locale === 'en') {
  console.error('error: English is the source, pushed by rehive-wallet-new CI.');
  process.exit(1);
}

// Intl throws on a malformed tag, which is the cheapest way to reject a typo before it becomes a
// committed file nothing can translate.
try {
  new Intl.PluralRules(locale);
} catch {
  console.error(`error: "${locale}" is not a valid BCP 47 language tag.`);
  process.exit(1);
}

if (!existsSync(SOURCE_FILE)) {
  console.error('error: src/language-en.json not found — nothing to scaffold from.');
  process.exit(1);
}
if (existsSync(localeFile(locale))) {
  console.error(`error: language-${locale}.json already exists.`);
  process.exit(1);
}

const english = readJson(SOURCE_FILE);
const expected = expectedKeys(english, locale);
const scaffold = {};
for (const entry of expected) setPath(scaffold, entry.key, '');

writeJson(localeFile(locale), scaffold);
writeLock(locale, { reviewed: [], source: {} });

console.log(`Created src/locales/language-${locale}.json (${expected.length} keys, all empty)`);
console.log(`Created src/locks/language-${locale}.json`);
console.log('\nNext: commit this, and the sync workflow will fill it on the next English change.');
console.log(`Or fill it now:  node scripts/translate.mjs --lang ${locale}`);
