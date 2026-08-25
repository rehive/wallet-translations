# wallet-translations

Translation files for the Rehive wallet ([rehive-wallet-new](https://github.com/rehive/rehive-wallet-new)).

English (`src/language-en.json`) is **auto-generated** — do not edit it by hand. Every other
language is machine-filled here with Claude and reviewed in a PR before merge.

> This repo previously also held a merged key space for `wallet-react` and `wallet-react-native`.
> That family was removed: no app-side workflow produced it, no repo consumed the published files,
> and its three language files never got past 0% translated. It is in git history if it is ever
> needed. Do **not** merge it back into this key space — the namespace names collide on 27
> top-level keys and the types disagree (its `common.select` is a string, this one's is an object),
> so one tree cannot hold both.

---

## How it works

```
rehive-wallet-new: src/i18n/en/** changes on main
  → pushes src/language-en.json here
       ↓
sync.yml
  → diff.mjs       adds new keys, drops departed ones, carries renames, reports fill rate
  → translate.mjs  fills every empty or stale value with Claude, validates, stamps the lock
  → opens ONE PR
       ↓
a human reads the PR and merges
       ↓
deploy-pages.yml publishes language-<locale>.json
       ↓
rehive-wallet-new: `node ./scripts/i18n.mjs pull` installs finished languages
```

The pull back into the wallet is deliberately **manual**. A bundled language ships inside the
binary, so installing one is a reviewed commit, never a bot push.

**No PR = no changes.** If every language is already in step with English, the workflow exits clean.

---

## File structure

```
src/
  language-en.json              ← English source (auto-generated, do not edit)
  glossary.json                 ← do-not-translate terms + per-language wording
  locales/
    language-fr.json            ← one per language
  locks/
    language-fr.json            ← English content hash per key + human-reviewed list
scripts/
  lib.mjs         shared helpers (paths, plural expansion, locks)
  validate.mjs    hard checks on machine output
  diff.mjs        keep every language in step with English
  translate.mjs   fill the gaps with Claude
  add-language.mjs
  pr-body.mjs
```

Locale codes are [BCP 47](https://tools.ietf.org/html/bcp47): `fr`, `de`, `pt-BR`, `zh-CN`, `ar`.

---

## Commands

```bash
yarn add-language fr        # scaffold, with fr's own plural forms
yarn diff                   # structure + fill-rate report → src/diff.json
yarn translate --dry-run     # what would be sent, no API calls
yarn translate --lang fr     # fill fr (needs ANTHROPIC_API_KEY)
yarn test                    # validator + plural-expansion tests
```

`translate.mjs` also takes `--model <id>` (default `claude-opus-5`), `--batch <n>` (default 60 keys
per request) and `--effort <low|medium|high|xhigh|max>`.

---

## Adding a language

```bash
yarn add-language de
```

This writes `src/locales/language-de.json` with every key German needs — including **German's own
plural forms**, not English's — plus an empty lock. Commit it. The next English change fills it, or
run `yarn translate --lang de` now.

Scaffolding a language you are not going to fill is how the previous pipeline ended up with three
0%-translated files, so add one only when it is going to be filled.

---

## Plurals

English ships `_one`/`_other`. Every target gets **its own** CLDR categories, from
`Intl.PluralRules`. On the current source:

| Language | Keys | vs English |
|---|---:|---|
| `fr` | 2242 | same two forms |
| `ar` | 2262 | +20 — five plural bases × four extra forms |
| `ja` | 2237 | −5 — one form per base |

The same count-probing is used as in the wallet's own `bundled-parity.test.ts`, which runs on
Hermes where `resolvedOptions().pluralCategories` is not always populated. If the two disagreed,
this pipeline would generate bundles the app rejects.

---

## What machine output is checked against

`translate.mjs` does not trust the model. Every value must pass `scripts/validate.mjs` or it is
retried once and then **left empty for a human** — never written half-right:

- `{{placeholders}}` identical to the source, same set and count. A dropped `{{amount}}` is a hole
  in a confirm screen.
- Do-not-translate terms from `glossary.json` still present verbatim. A translated brand name reads
  as correct copy and is caught by nothing downstream.
- Newline count unchanged, so multi-paragraph help copy keeps its structure.
- No Arabic-Indic or Persian digits — the wallet pins Latin numerals for money and dates.
- Not byte-identical to the English for anything longer than three words.

The lock is stamped **only** for values that passed, so a failed key is picked up again on the next
run instead of looking finished.

---

## Renames and human edits

`src/locks/language-<locale>.json` stores the SHA-256 of the English value each translation was
made from. Two things fall out of that:

- **Renames.** A key that left English whose recorded hash matches a key that just arrived is a
  rename, so the finished translation moves with it instead of being deleted and paid for twice.
- **Stale.** If the English changed, the translation is queued to be redone.

To protect a human edit, add its key to the lock's `reviewed` list. It will never be overwritten,
and the PR reports it as *human-reviewed, English moved on* rather than silently clobbering it.

---

## Translation guidelines (for PR review)

- Template variables stay exact: `{{name}}`, `{{count}}`, `{{company.name}}`
- Keys are never translated, only values
- Keep it tight — these strings sit in buttons and list rows on a phone
- Match the register a mainstream bank app uses in that language
- If a string has no good translation, leave it empty and say so in the PR

---

## Secrets

| Secret | Purpose |
|--------|---------|
| `ANTHROPIC_API_KEY` | `translate.mjs`. **Until this is set the translate step is skipped** and the workflow opens a PR of empty placeholders — the manual flow, not a failure. |
| `TRANSLATIONS_BOT_APP_ID` / `TRANSLATIONS_BOT_PRIVATE_KEY` | Lets `rehive-wallet-new` push `src/language-en.json` here. Add that repo to the secrets' repository list. |

The `rehive-translations-bot` GitHub App is installed on this repo only, with Contents: write, and
each workflow mints a short-lived token via
[`actions/create-github-app-token`](https://github.com/actions/create-github-app-token). If its
private key leaks, the blast radius is write access to this repo alone.

---

## Accessing language files

Published to GitHub Pages on every push to `main`, served flat:

```
https://rehive.github.io/wallet-translations/language-en.json
https://rehive.github.io/wallet-translations/language-fr.json
https://rehive.github.io/wallet-translations/index.json
```

`index.json` lists the available locale codes:

```json
{ "locales": ["en", "fr"] }
```

This is a convenience for tooling. The wallet bundles its languages at build time and does not
fetch them at runtime.
