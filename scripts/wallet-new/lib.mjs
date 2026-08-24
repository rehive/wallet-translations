// Shared helpers for the rehive-wallet-new translation family.
//
// Deliberately separate from the legacy scripts/{sync,diff,add-language}.js, which serve
// wallet-react and wallet-react-native. Those two apps share one flat merged key space and have
// no plural forms; the new wallet is namespaced per file, uses i18next plural suffixes, and its
// namespace names COLLIDE with the legacy ones (`common.select` is a string there and an object
// here). Merging the two families would corrupt both, so they share no data and no code.

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const FAMILY_DIR = path.join(ROOT, 'src', 'wallet-new');
export const LOCALES_DIR = path.join(FAMILY_DIR, 'locales');
export const LOCKS_DIR = path.join(FAMILY_DIR, 'locks');
export const SOURCE_LANGUAGE = 'en';
export const SOURCE_FILE = path.join(FAMILY_DIR, `language-${SOURCE_LANGUAGE}.json`);

export const PLURAL_SUFFIXES = ['zero', 'one', 'two', 'few', 'many', 'other'];

export function readJson(file) {
  return JSON.parse(readFileSync(file, 'utf8'));
}

export function writeJson(file, value) {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}

export function hash(value) {
  return createHash('sha256').update(String(value)).digest('hex');
}

/** Every leaf path in a tree, dot-joined. */
export function leafPaths(value, prefix = '') {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return [prefix];
  return Object.entries(value).flatMap(([key, child]) =>
    leafPaths(child, prefix ? `${prefix}.${key}` : key),
  );
}

export function getPath(tree, keyPath) {
  return keyPath.split('.').reduce((node, key) => (node == null ? undefined : node[key]), tree);
}

export function setPath(tree, keyPath, value) {
  const parts = keyPath.split('.');
  let node = tree;
  for (const key of parts.slice(0, -1)) {
    if (node[key] === undefined || typeof node[key] !== 'object' || node[key] === null) {
      node[key] = {};
    }
    node = node[key];
  }
  node[parts[parts.length - 1]] = value;
}

export function deletePath(tree, keyPath) {
  const parts = keyPath.split('.');
  let node = tree;
  for (const key of parts.slice(0, -1)) {
    if (node[key] === undefined) return;
    node = node[key];
  }
  delete node[parts[parts.length - 1]];
}

/** `accountCount_one` → `accountCount`. Null when the key is not a plural form. */
export function pluralBase(keyPath) {
  const match = /^(.*)_(zero|one|two|few|many|other)$/.exec(keyPath);
  return match ? match[1] : null;
}

/**
 * The CLDR categories a language actually uses — Arabic six, French two, Japanese one.
 *
 * Probes counts rather than reading `resolvedOptions().pluralCategories`, matching the wallet's
 * own `bundled-parity.test.ts`: that gate runs on Hermes where the field is not always populated,
 * and if the two disagreed this pipeline would emit bundles the app rejects.
 */
export function requiredPluralSuffixes(language) {
  const rules = new Intl.PluralRules(language);
  return PLURAL_SUFFIXES.filter((suffix) =>
    [0, 1, 2, 3, 11, 100].some((count) => rules.select(count) === suffix),
  );
}

/**
 * Every key a language owes, expanded from English.
 *
 * English ships `_one`/`_other`; a target owes its OWN categories for that base and nothing else.
 * Returned in English's own key order so generated files stay diff-stable.
 */
export function expectedKeys(english, language) {
  const suffixes = requiredPluralSuffixes(language);
  const keys = [];
  const seenBases = new Set();
  for (const keyPath of leafPaths(english)) {
    const base = pluralBase(keyPath);
    if (base === null) {
      keys.push({ key: keyPath, source: keyPath, plural: null });
      continue;
    }
    if (seenBases.has(base)) continue;
    seenBases.add(base);
    // Every form is translated from the English `_other` where present, else the form we have.
    const sourceKey = getPath(english, `${base}_other`) !== undefined ? `${base}_other` : keyPath;
    for (const suffix of suffixes) {
      keys.push({ key: `${base}_${suffix}`, source: sourceKey, plural: suffix });
    }
  }
  return keys;
}

export function localeFile(language) {
  return path.join(LOCALES_DIR, `language-${language}.json`);
}

export function lockFile(language) {
  return path.join(LOCKS_DIR, `language-${language}.json`);
}

export function readLock(language) {
  const file = lockFile(language);
  if (!existsSync(file)) return { version: 1, reviewed: [], source: {} };
  const lock = readJson(file);
  return { version: 1, reviewed: lock.reviewed ?? [], source: lock.source ?? {} };
}

export function writeLock(language, lock) {
  writeJson(lockFile(language), {
    version: 1,
    reviewed: [...lock.reviewed].sort((a, b) => a.localeCompare(b)),
    source: Object.fromEntries(
      Object.entries(lock.source).sort(([a], [b]) => a.localeCompare(b)),
    ),
  });
}

/** Languages with a locale file, excluding the English source. */
export function translatedLanguages() {
  if (!existsSync(LOCALES_DIR)) return [];
  return readdirSync(LOCALES_DIR)
    .map((entry) => /^language-(.+)\.json$/.exec(entry)?.[1])
    .filter((id) => id !== undefined && id !== SOURCE_LANGUAGE)
    .sort((a, b) => a.localeCompare(b));
}

export function readGlossary() {
  const file = path.join(FAMILY_DIR, 'glossary.json');
  if (!existsSync(file)) return { doNotTranslate: [], terms: {} };
  const glossary = readJson(file);
  return { doNotTranslate: glossary.doNotTranslate ?? [], terms: glossary.terms ?? {} };
}
