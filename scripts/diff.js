// Diffs language-en.json against every other language-*.json in src/locales/.
// For each language file:
//   - Keys in English but missing from the language file → added as "" placeholders
//   - Keys in the language file but not in English → removed
//
// Writes src/diff.json with the change report.
// Writes the GitHub Actions output "has_changes=true" to $GITHUB_OUTPUT if any file changed.
//
// Usage: node scripts/diff.js

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const srcDir = path.join(__dirname, '../src');
const localesDir = path.join(srcDir, 'locales');

// Recursively collect all dot-notation leaf key paths from an object
function flattenKeys(obj, prefix = '') {
  const keys = [];
  for (const [k, v] of Object.entries(obj)) {
    const fullKey = prefix ? `${prefix}.${k}` : k;
    if (v !== null && typeof v === 'object' && !Array.isArray(v)) {
      keys.push(...flattenKeys(v, fullKey));
    } else {
      keys.push(fullKey);
    }
  }
  return keys;
}

// Get/set a nested value by dot-notation path
function getByPath(obj, keyPath) {
  return keyPath.split('.').reduce((o, k) => o?.[k], obj);
}

function setByPath(obj, keyPath, value) {
  const parts = keyPath.split('.');
  let cur = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    if (!cur[parts[i]] || typeof cur[parts[i]] !== 'object') {
      cur[parts[i]] = {};
    }
    cur = cur[parts[i]];
  }
  cur[parts[parts.length - 1]] = value;
}

function deleteByPath(obj, keyPath) {
  const parts = keyPath.split('.');
  let cur = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    if (!cur[parts[i]]) {
      return;
    }
    cur = cur[parts[i]];
  }
  delete cur[parts[parts.length - 1]];
}

// Load src/language-en.json
const enPath = path.join(srcDir, 'language-en.json');
if (!fs.existsSync(enPath)) {
  console.error('language-en.json not found. Run sync first.');
  process.exit(1);
}
const enData = JSON.parse(fs.readFileSync(enPath, 'utf8'));
const enKeys = new Set(flattenKeys(enData));

// Discover all language files in src/locales/
if (!fs.existsSync(localesDir)) {
  console.log('No src/locales/ directory found — nothing to diff.');
  process.exit(0);
}

const langFiles = fs
  .readdirSync(localesDir)
  .filter((f) => f.startsWith('language-') && f.endsWith('.json'));

if (langFiles.length === 0) {
  console.log('No language files found in src/locales/ — nothing to diff.');
  process.exit(0);
}

const report = {};
let anyChanges = false;

for (const filename of langFiles) {
  const locale = filename.replace('language-', '').replace('.json', '');
  const filePath = path.join(localesDir, filename);
  const langData = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  const langKeys = new Set(flattenKeys(langData));

  const added = [...enKeys].filter((k) => !langKeys.has(k));
  const removed = [...langKeys].filter((k) => !enKeys.has(k));

  report[locale] = {
    added,
    removed,
    present: langKeys.size,
  };

  if (added.length === 0 && removed.length === 0) {
    console.log(`[${locale}] up to date (${langKeys.size} keys)`);
    continue;
  }

  anyChanges = true;
  console.log(`[${locale}] +${added.length} added, -${removed.length} removed`);

  for (const key of added) {
    setByPath(langData, key, '');
  }

  for (const key of removed) {
    deleteByPath(langData, key);
  }

  fs.writeFileSync(filePath, JSON.stringify(langData, null, 2));
}

// Write diff report
const diffPath = path.join(srcDir, 'diff.json');
fs.writeFileSync(diffPath, JSON.stringify(report, null, 2));
console.log(`\nDiff report written to ${diffPath}`);

// Write GitHub Actions output
if (process.env.GITHUB_OUTPUT) {
  fs.appendFileSync(process.env.GITHUB_OUTPUT, `has_changes=${anyChanges}\n`);
}

if (anyChanges) {
  console.log('\nhas_changes=true');
} else {
  console.log('\nAll language files are up to date.');
}
