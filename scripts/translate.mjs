#!/usr/bin/env node
// Fill the empty and stale values in every language file using Claude.
//
//   node scripts/translate.mjs [--lang <code>] [--dry-run] [--model <id>]
//                              [--batch <n>] [--effort <low|medium|high|xhigh|max>]
//
// Needs ANTHROPIC_API_KEY. Without one it reports the plan and exits 0, so the sync workflow still
// opens a placeholder PR — the pipeline degrades to the old manual flow instead of breaking.
//
// Output is NOT trusted. Every value goes through validate.mjs (placeholders, do-not-translate
// terms, paragraph structure, non-Latin digits) and a failure is retried once, then left empty for
// a human rather than written. The lock is stamped only for values that passed, so a key that
// failed is picked up again on the next run instead of looking finished.

import process from 'node:process';
import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { z } from 'zod';
import {
  SOURCE_FILE,
  expectedKeys,
  getPath,
  hash,
  localeFile,
  readGlossary,
  readJson,
  readLock,
  requiredPluralSuffixes,
  setPath,
  translatedLanguages,
  writeJson,
  writeLock,
} from './lib.mjs';
import { validateBatchShape, validateTranslation } from './validate.mjs';

const DEFAULTS = { model: 'claude-opus-5', batch: 60 };

const args = process.argv.slice(2);
const options = { lang: [], dryRun: false, ...DEFAULTS };
for (let i = 0; i < args.length; i += 1) {
  if (args[i] === '--lang') options.lang.push(args[(i += 1)]);
  else if (args[i] === '--dry-run') options.dryRun = true;
  else if (args[i] === '--model') options.model = args[(i += 1)];
  else if (args[i] === '--batch') options.batch = Number(args[(i += 1)]);
  else if (args[i] === '--effort') options.effort = args[(i += 1)];
  else {
    console.error(`unknown option: ${args[i]}`);
    process.exit(1);
  }
}

const english = readJson(SOURCE_FILE);
const glossary = readGlossary();
const languages = translatedLanguages().filter(
  (id) => options.lang.length === 0 || options.lang.includes(id),
);

if (languages.length === 0) {
  console.log('No language files to fill.');
  process.exit(0);
}

const hasKey = Boolean(process.env.ANTHROPIC_API_KEY);
if (!hasKey && !options.dryRun) {
  console.log('ANTHROPIC_API_KEY is not set — reporting the plan only, nothing translated.');
}

const Translations = z.object({
  translations: z.array(z.object({ key: z.string(), value: z.string() })),
});

const client = hasKey && !options.dryRun ? new Anthropic() : null;

const INSTRUCTIONS = `You translate user-interface copy for a consumer financial wallet app: balances, transfers, cards, identity verification, support copy.

Rules, in order of importance:

1. Preserve every {{placeholder}} EXACTLY as written — same spelling, same braces, same count. They are substituted at runtime with amounts, names and dates. Never translate, reorder away, add or drop one.
2. Preserve the paragraph structure. If the source contains newlines, the translation must contain the same number.
3. Preserve leading and trailing spaces exactly — several keys are sentence fragments joined at runtime.
4. Never translate the do-not-translate terms listed below. Brand, network and payment-scheme names stay verbatim.
5. Use Latin digits (0-9) only, never localised numerals. Amounts and dates elsewhere in the app are always Latin, and mixed numerals look broken.
6. Match the register a mainstream bank or payment app uses in the target language: plain, direct, polite, no marketing tone. Prefer the formal second person where the language distinguishes it.
7. Keep it tight. These strings sit in buttons, list rows and headers on a phone; a translation much longer than the source will be clipped.
8. Translate the MEANING, not word for word. Financial terms take their established local equivalent.
9. Return every requested key exactly once, and no keys that were not requested.`;

/** Plural forms this app expects, spelled out — the model must produce the target's own set. */
function pluralGuidance(language, suffixes) {
  return `This language uses these i18next plural categories: ${suffixes.join(', ')}.

A key like \`itemCount_few\` is the form used for counts that fall in that category in ${language}. Write copy that reads naturally for that category — do not copy the same sentence into every form, and do not use a form the list above does not include. English usually has only two forms, so several categories may need wording English does not distinguish.`;
}

function glossaryBlock() {
  const dnt = glossary.doNotTranslate;
  const lines = [`Do-not-translate terms: ${dnt.length > 0 ? dnt.join(', ') : '(none)'}`];
  return lines.join('\n');
}

function termsBlock(language) {
  const terms = glossary.terms?.[language];
  if (!terms || Object.keys(terms).length === 0) return '';
  const rows = Object.entries(terms).map(([from, to]) => `- "${from}" → "${to}"`);
  return `\n\nUse these established translations consistently:\n${rows.join('\n')}`;
}

async function translateBatch({ language, namespace, batch, suffixes }) {
  const requested = batch.map((entry) => entry.key);
  const payload = batch.map((entry) => ({
    key: entry.key,
    english: getPath(english, `${namespace}.${entry.sourceKey}`),
    ...(entry.plural ? { pluralCategory: entry.plural } : {}),
  }));

  const response = await client.messages.parse({
    model: options.model,
    max_tokens: 16000,
    // Stable blocks first, volatile last: the cached prefix is the instructions + glossary + the
    // whole English namespace, so translating one namespace into ten languages pays for that
    // context once instead of ten times.
    system: [
      { type: 'text', text: INSTRUCTIONS },
      { type: 'text', text: glossaryBlock() },
      {
        type: 'text',
        text: `Full English namespace "${namespace}", for context on tone and neighbouring copy:\n\n${JSON.stringify(
          english[namespace],
          null,
          2,
        )}`,
        cache_control: { type: 'ephemeral' },
      },
    ],
    messages: [
      {
        role: 'user',
        content: `Target language: ${language}${termsBlock(language)}

${pluralGuidance(language, suffixes)}

Translate each of these into ${language}. Return one entry per key.

${JSON.stringify(payload, null, 2)}`,
      },
    ],
    output_config: {
      format: zodOutputFormat(Translations),
      ...(options.effort ? { effort: options.effort } : {}),
    },
  });

  const parsed = response.parsed_output;
  if (!parsed) throw new Error('model returned no parsable output');

  const shapeProblems = validateBatchShape(
    requested,
    parsed.translations.map((entry) => entry.key),
  );
  const byKey = new Map(parsed.translations.map((entry) => [entry.key, entry.value]));
  return { byKey, shapeProblems, usage: response.usage };
}

let grandTotal = 0;
let grandWritten = 0;
let grandFailed = 0;
const usageTotals = { input: 0, cacheRead: 0, cacheWrite: 0, output: 0 };

for (const language of languages) {
  const locale = readJson(localeFile(language));
  const lock = readLock(language);
  const suffixes = requiredPluralSuffixes(language);
  const expected = expectedKeys(english, language);

  // Anything empty, or whose English moved since it was translated and no human has claimed it.
  const reviewed = new Set(lock.reviewed);
  const work = [];
  for (const entry of expected) {
    const current = getPath(locale, entry.key);
    const sourceValue = getPath(english, entry.source);
    if (typeof sourceValue !== 'string') continue;
    const isEmpty = typeof current !== 'string' || current.trim() === '';
    const isStale = lock.source[entry.key] !== hash(sourceValue);
    if (!isEmpty && (!isStale || reviewed.has(entry.key))) continue;
    const [namespace, ...rest] = entry.key.split('.');
    const [, ...sourceRest] = entry.source.split('.');
    work.push({
      key: entry.key,
      namespace,
      localKey: rest.join('.'),
      sourceKey: sourceRest.join('.'),
      plural: entry.plural,
      sourceValue,
    });
  }

  grandTotal += work.length;
  if (work.length === 0) {
    console.log(`[${language}] nothing to translate`);
    continue;
  }

  const byNamespace = new Map();
  for (const item of work) {
    if (!byNamespace.has(item.namespace)) byNamespace.set(item.namespace, []);
    byNamespace.get(item.namespace).push(item);
  }

  const batches = [];
  for (const [namespace, items] of byNamespace) {
    for (let i = 0; i < items.length; i += options.batch) {
      batches.push({ namespace, items: items.slice(i, i + options.batch) });
    }
  }

  console.log(
    `[${language}] ${work.length} key(s) to translate across ${byNamespace.size} namespace(s), ` +
      `${batches.length} request(s)`,
  );

  if (!client) continue;

  let written = 0;
  const failures = [];
  for (const [index, { namespace, items }] of batches.entries()) {
    const label = `[${language}] ${namespace} (${index + 1}/${batches.length})`;
    const batch = items.map((item) => ({
      key: item.localKey,
      sourceKey: item.sourceKey,
      plural: item.plural,
    }));

    let result;
    try {
      result = await translateBatch({ language, namespace, batch, suffixes });
    } catch (error) {
      console.error(`${label} request failed: ${error.message}`);
      failures.push(...items.map((item) => ({ item, problems: [error.message] })));
      continue;
    }

    if (result.shapeProblems.length > 0) {
      console.error(`${label} shape problems: ${result.shapeProblems.slice(0, 5).join('; ')}`);
    }
    usageTotals.input += result.usage?.input_tokens ?? 0;
    usageTotals.output += result.usage?.output_tokens ?? 0;
    usageTotals.cacheRead += result.usage?.cache_read_input_tokens ?? 0;
    usageTotals.cacheWrite += result.usage?.cache_creation_input_tokens ?? 0;

    for (const item of items) {
      const value = result.byKey.get(item.localKey);
      const problems = validateTranslation({
        source: item.sourceValue,
        translation: value,
        language,
        doNotTranslate: glossary.doNotTranslate,
      });
      if (problems.length > 0) {
        failures.push({ item, problems });
        continue;
      }
      setPath(locale, item.key, value);
      lock.source[item.key] = hash(item.sourceValue);
      written += 1;
    }
    console.log(`${label} ${written} written so far`);
  }

  // One retry, one key at a time: a batch usually fails on one awkward string, and re-asking for
  // just that string with the failure spelled out fixes most of them.
  const stillFailing = [];
  for (const { item, problems } of failures) {
    try {
      const result = await translateBatch({
        language,
        namespace: item.namespace,
        batch: [{ key: item.localKey, sourceKey: item.sourceKey, plural: item.plural }],
        suffixes,
      });
      const value = result.byKey.get(item.localKey);
      const retryProblems = validateTranslation({
        source: item.sourceValue,
        translation: value,
        language,
        doNotTranslate: glossary.doNotTranslate,
      });
      if (retryProblems.length > 0) {
        stillFailing.push({ item, problems: retryProblems });
        continue;
      }
      setPath(locale, item.key, value);
      lock.source[item.key] = hash(item.sourceValue);
      written += 1;
    } catch (error) {
      stillFailing.push({ item, problems: [error.message, ...problems] });
    }
  }

  writeJson(localeFile(language), locale);
  writeLock(language, { reviewed: [...reviewed], source: lock.source });

  grandWritten += written;
  grandFailed += stillFailing.length;
  console.log(`[${language}] wrote ${written}/${work.length}`);
  for (const { item, problems } of stillFailing.slice(0, 20)) {
    console.error(`  left empty: ${item.key} — ${problems.join('; ')}`);
  }
  if (stillFailing.length > 20) {
    console.error(`  …and ${stillFailing.length - 20} more left empty`);
  }
}

if (!client) {
  console.log(`\nPlan only: ${grandTotal} key(s) would be translated.`);
  process.exit(0);
}

console.log(
  `\nTranslated ${grandWritten}/${grandTotal} key(s); ${grandFailed} left for a human.\n` +
    `Tokens — input ${usageTotals.input}, cache read ${usageTotals.cacheRead}, ` +
    `cache write ${usageTotals.cacheWrite}, output ${usageTotals.output}`,
);
if (usageTotals.cacheRead === 0 && usageTotals.cacheWrite > 0) {
  console.warn('Cache never read — check that the English namespace block is byte-stable across requests.');
}
