#!/usr/bin/env node
// Bring every language file back in step with the English source.
//
//   node scripts/diff.mjs [--lang <code>] [--report-only]
//
// Writes src/diff.json and, for GitHub Actions, `has_changes` / `needs_translation`.
//
// Three things this does that a plain key-for-key diff does not, each earned the hard way:
//
//   1. PLURALS. English ships `_one`/`_other`. Arabic needs six forms and Japanese one, so
//      diffing key-for-key against English deletes forms Arabic requires and demands forms
//      Japanese has no rule for. The wallet's parity gate rejects both.
//   2. FILL RATE. Comparing key STRUCTURE alone lets a file of empty strings report "up to date".
//      That is not hypothetical: this repo's previous pipeline did exactly that, and three
//      language files sat at 0% translated for months with CI green. Empty values are counted.
//   3. RENAMES. Deleting every key that left English throws away finished work when a key is
//      merely renamed. The lock stores the English content hash each translation was made from,
//      so a rename is detected by content and the translation moves with it.

import process from 'node:process';
import { existsSync } from 'node:fs';
import {
  SRC_DIR,
  SOURCE_FILE,
  deletePath,
  expectedKeys,
  getPath,
  hash,
  leafPaths,
  localeFile,
  readJson,
  readLock,
  setPath,
  translatedLanguages,
  writeJson,
  writeLock,
} from './lib.mjs';
import path from 'node:path';

const args = process.argv.slice(2);
const only = [];
let reportOnly = false;
for (let i = 0; i < args.length; i += 1) {
  if (args[i] === '--lang') only.push(args[(i += 1)]);
  else if (args[i] === '--report-only') reportOnly = true;
  else {
    console.error(`unknown option: ${args[i]}`);
    process.exit(1);
  }
}

if (!existsSync(SOURCE_FILE)) {
  console.error(`error: ${path.relative(process.cwd(), SOURCE_FILE)} not found.`);
  console.error('It is pushed by rehive-wallet-new CI; nothing to diff against yet.');
  process.exit(1);
}

const english = readJson(SOURCE_FILE);
const languages = translatedLanguages().filter((id) => only.length === 0 || only.includes(id));

if (languages.length === 0) {
  console.log('No language files yet — add one with scripts/add-language.mjs.');
  process.exit(0);
}

const report = {};
let anyChanges = false;
let anyNeedsTranslation = false;

for (const language of languages) {
  const locale = readJson(localeFile(language));
  const lock = readLock(language);
  const reviewed = new Set(lock.reviewed);
  const expected = expectedKeys(english, language);
  const expectedByKey = new Map(expected.map((entry) => [entry.key, entry]));

  const present = leafPaths(locale).filter((keyPath) => getPath(locale, keyPath) !== undefined);
  const removed = present.filter((keyPath) => !expectedByKey.has(keyPath));

  // A removed key whose recorded English content matches a key that just appeared is a rename:
  // the copy did not change, so the finished translation is still correct.
  const arrivals = expected.filter((entry) => getPath(locale, entry.key) === undefined);
  const bySourceHash = new Map();
  for (const entry of arrivals) {
    const value = getPath(english, entry.source);
    if (typeof value === 'string') bySourceHash.set(hash(value), entry.key);
  }

  const renamed = [];
  for (const from of removed) {
    const recorded = lock.source[from];
    const to = recorded === undefined ? undefined : bySourceHash.get(recorded);
    if (to === undefined) continue;
    const carried = getPath(locale, from);
    if (typeof carried !== 'string' || carried.trim() === '') continue;
    renamed.push({ from, to });
    bySourceHash.delete(recorded);
  }
  const renamedFrom = new Set(renamed.map((entry) => entry.from));
  const renamedTo = new Set(renamed.map((entry) => entry.to));

  const added = [];
  const stale = [];
  const staleReviewed = [];
  const empty = [];
  for (const entry of expected) {
    if (renamedTo.has(entry.key)) continue;
    const value = getPath(locale, entry.key);
    const sourceValue = getPath(english, entry.source);
    if (value === undefined) {
      added.push(entry.key);
      continue;
    }
    if (typeof value !== 'string' || value.trim() === '') {
      empty.push(entry.key);
      continue;
    }
    if (typeof sourceValue === 'string' && lock.source[entry.key] !== hash(sourceValue)) {
      (reviewed.has(entry.key) ? staleReviewed : stale).push(entry.key);
    }
  }

  const needsTranslation = [...added, ...empty, ...stale];
  const changed =
    added.length > 0 || removed.length > 0 || renamed.length > 0 || stale.length > 0;

  report[language] = {
    expected: expected.length,
    translated: expected.length - needsTranslation.length,
    fillRate: Number((((expected.length - needsTranslation.length) / expected.length) * 100).toFixed(1)),
    added,
    removed: removed.filter((keyPath) => !renamedFrom.has(keyPath)),
    renamed,
    stale,
    staleReviewed,
    empty,
    needsTranslation,
  };

  console.log(
    `[${language}] ${report[language].translated}/${expected.length} translated ` +
      `(${report[language].fillRate}%) · +${added.length} new · ${empty.length} empty · ` +
      `${stale.length} stale · ${renamed.length} renamed · -${report[language].removed.length} removed`,
  );
  if (staleReviewed.length > 0) {
    console.log(
      `  ${staleReviewed.length} human-reviewed key(s) whose English changed — left alone, ` +
        'clear them from the lock\'s `reviewed` list to retranslate',
    );
  }

  if (needsTranslation.length > 0) anyNeedsTranslation = true;
  if (changed) anyChanges = true;
  if (reportOnly) continue;

  for (const { from, to } of renamed) {
    setPath(locale, to, getPath(locale, from));
    lock.source[to] = lock.source[from];
    if (reviewed.has(from)) reviewed.add(to);
  }
  for (const keyPath of removed) {
    deletePath(locale, keyPath);
    delete lock.source[keyPath];
    reviewed.delete(keyPath);
  }
  // Placeholders, not translations: `translate.mjs` fills them, and the lock is only stamped once
  // a real translation lands. An empty value with a current hash would look finished forever.
  for (const keyPath of added) setPath(locale, keyPath, '');

  // Rebuild in English's key order so the file stays diff-stable across runs.
  const ordered = {};
  for (const entry of expected) {
    const value = getPath(locale, entry.key);
    setPath(ordered, entry.key, typeof value === 'string' ? value : '');
  }
  writeJson(localeFile(language), ordered);
  writeLock(language, { reviewed: [...reviewed], source: lock.source });
}

writeJson(path.join(SRC_DIR, 'diff.json'), report);
console.log('\nReport → src/diff.json');

if (process.env.GITHUB_OUTPUT) {
  const { appendFileSync } = await import('node:fs');
  appendFileSync(
    process.env.GITHUB_OUTPUT,
    `has_changes=${anyChanges}\nneeds_translation=${anyNeedsTranslation}\n`,
  );
}
console.log(`has_changes=${anyChanges} needs_translation=${anyNeedsTranslation}`);
