#!/usr/bin/env node
// Markdown PR body from src/wallet-new/diff.json. Used as: --body "$(node scripts/wallet-new/pr-body.mjs)"

import process from 'node:process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { FAMILY_DIR, readJson } from './lib.mjs';

const diffPath = path.join(FAMILY_DIR, 'diff.json');
if (!existsSync(diffPath)) {
  console.log('No diff.json found.');
  process.exit(0);
}

const report = readJson(diffPath);
const locales = Object.keys(report);
const translated = process.env.TRANSLATED_BY ?? '';
const sourceSha = process.env.SOURCE_SHA ?? '';

const lines = ['## rehive-wallet-new translations', ''];

if (translated) {
  lines.push(`Machine-filled by \`${translated}\`. **Every value below needs a human read before merge** — the checks catch dropped placeholders, altered brand names and wrong plural forms, not wrong wording.`);
} else {
  lines.push('New keys were added as empty placeholders. No API key was available, so nothing was machine-translated.');
}
lines.push('');
if (sourceSha) {
  lines.push(`Source: [rehive-wallet-new@${sourceSha.slice(0, 8)}](https://github.com/rehive/rehive-wallet-new/commit/${sourceSha}).`);
  lines.push('');
}

lines.push('| Language | Translated | Fill rate | New | Stale | Renamed | Removed | Still empty |');
lines.push('|---|---:|---:|---:|---:|---:|---:|---:|');
for (const locale of locales) {
  const r = report[locale];
  lines.push(
    `| \`${locale}\` | ${r.translated}/${r.expected} | ${r.fillRate}% | ${r.added.length} | ` +
      `${r.stale.length} | ${r.renamed.length} | ${r.removed.length} | ${r.empty.length} |`,
  );
}
lines.push('');

for (const locale of locales) {
  const r = report[locale];
  const notable = r.added.length + r.stale.length + r.renamed.length + r.removed.length + r.empty.length;
  if (notable === 0) continue;
  lines.push(`<details><summary><code>${locale}</code> — ${notable} key(s) changed</summary>`, '');
  const section = (title, keys) => {
    if (keys.length === 0) return;
    lines.push(`**${title} (${keys.length})**`, '');
    for (const key of keys.slice(0, 40)) lines.push(`- \`${key}\``);
    if (keys.length > 40) lines.push(`- …and ${keys.length - 40} more`);
    lines.push('');
  };
  section('New', r.added);
  section('English changed since translation', r.stale);
  section('Removed', r.removed);
  section('Still empty — needs a human', r.empty);
  if (r.renamed.length > 0) {
    lines.push(`**Renamed (${r.renamed.length})** — translation carried over, English unchanged`, '');
    for (const { from, to } of r.renamed.slice(0, 40)) lines.push(`- \`${from}\` → \`${to}\``);
    lines.push('');
  }
  if (r.staleReviewed.length > 0) {
    lines.push(
      `**Human-reviewed, English moved on (${r.staleReviewed.length})** — left untouched on purpose. ` +
        'Remove the key from the lock\'s `reviewed` list to let the machine redo it.',
      '',
    );
  }
  lines.push('</details>', '');
}

process.stdout.write(`${lines.join('\n')}\n`);
