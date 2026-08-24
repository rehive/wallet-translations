# wallet-translations

Centralized translation files for Rehive wallet apps ([wallet-react](https://github.com/rehive/wallet-react) and [wallet-react-native](https://github.com/rehive/wallet-react-native)).

The canonical English file (`src/language-en.json`) is **auto-generated** — do not edit it by hand. All other language files are maintained here by translators.

---

## How it works

Each wallet app generates and pushes its own merged translation file directly to this repo whenever `.en.json` files change on `main`. This gives a clear per-app history and keeps the workflow simple — no cross-repo checkouts needed here.

```
wallet-react                    wallet-react-native
  *.en.json changes on main       *.en.json changes on main
  → runs languageSyncSelf.cjs     → runs languageSync.cjs
  → pushes src/wallet-react.json  → pushes src/wallet-react-native.json
         │                                      │
         └──────────────┬───────────────────────┘
                        ▼
              wallet-translations
     merge-app-translations.yml fires
       → sync.cjs merges the two files
       → commits src/language-en.json
                        │
                        ▼
              sync-and-update.yml fires
       → diff.js compares language-en.json
         against each language-*.json
       → PR opened with empty-string
         placeholders for new keys,
         tagged to the developer who
         introduced the change
```

**No PR = no changes.** If the English keys are already up to date across all language files, the workflow exits cleanly.

---

## File structure

```
src/
  language-en.json              ← merged English master (auto-generated, do not edit)
  source/
    wallet-react.json           ← latest from wallet-react (auto-updated by CI)
    wallet-react-native.json    ← latest from wallet-react-native (auto-updated by CI)
    sync-meta.json              ← last sync metadata (actor, repo, sha — auto-generated)
  locales/
    language-de.json            ← German (manually translated)
    language-fr.json            ← French (manually translated)
    language-<locale>.json      ← other languages
history/
  wallet-react/
    2026-05-25T10-00-00Z.json   ← timestamped snapshot of each push
    2026-05-26T14-30-00Z.json
  wallet-react-native/
    2026-05-25T11-00-00Z.json
    ...
```

Language files use [BCP 47](https://tools.ietf.org/html/bcp47) locale codes as suffixes (e.g. `de`, `fr`, `es`, `pt-BR`, `zh-CN`, `ar`).

---

## Adding a new language

1. Make sure `src/language-en.json` is up to date (it will be if the CI has run recently).
2. Scaffold the new language file:
   ```bash
   node scripts/add-language.js <locale>
   # e.g.
   node scripts/add-language.js de
   node scripts/add-language.js zh-CN
   ```
   This creates `src/locales/language-<locale>.json` with every English key present and an empty string as the value.
3. Fill in the translations. Every key with an empty string `""` needs a translation.
4. Commit and open a PR.
5. Once merged, future English key changes will automatically be reflected in this file via the `sync-and-update` workflow.

---

## Keeping translations up to date (automated)

When English keys change in either wallet app, this is the automated flow:

1. The wallet app's CI generates a merged JSON of its own `.en.json` files and pushes it to `src/wallet-react.json` (or `wallet-react-native.json`)
2. `merge-app-translations.yml` triggers, merges both app files into `src/language-en.json`, and commits it
3. `sync-and-update.yml` triggers on that commit and:
   - Diffs `language-en.json` against every `language-*.json` in `src/locales/`
   - For any language with missing or stale keys, opens a PR that adds new keys as empty-string placeholders and removes keys no longer in English
   - Tags the developer who introduced the change in the PR body

Translators review the PR, fill in the empty strings, and merge.

---

## Running locally

```bash
# Generate language-en.json from the committed per-app files
yarn sync

# Diff and patch all language files
yarn diff

# Preview the PR body that would be generated
node scripts/pr-body.js
```

To regenerate the per-app source files locally, run the sync script in each wallet repo:

```bash
# wallet-react — scans only its own src/**/*.en.json
node languageSyncSelf.cjs   # outputs to tmp/language-en.json

# wallet-react-native — scans only its own src/**/*.en.json
node languageSync.cjs       # outputs to tmp/language-en.json
```

Then copy the outputs into `src/source/` here and run `yarn sync`.

---

---

## rehive-wallet-new (separate family)

[rehive-wallet-new](https://github.com/rehive/rehive-wallet-new) is the wallet rebuild. Its
translations live under `src/wallet-new/` and share **nothing** with the two legacy apps above.

**Why separate.** The legacy apps merge into one flat key space. The new wallet's namespace names
collide with it on 27 top-level keys, and the types disagree — legacy `common.select` is a string,
the new wallet's is an object with `select.searchPlaceholder` underneath; legacy `profile.title` is
a Mr/Ms salutation, the new wallet's is a screen title. Merging the families would corrupt both.
The new wallet also uses i18next plural suffixes, which the legacy files do not have at all.

```
src/wallet-new/
  language-en.json              ← pushed by rehive-wallet-new CI (auto-generated, do not edit)
  glossary.json                 ← do-not-translate terms + per-language wording
  locales/language-<locale>.json
  locks/language-<locale>.json  ← English content hash per key + human-reviewed list
```

### Flow

```
rehive-wallet-new: src/i18n/en/** changes on main
  → pushes src/wallet-new/language-en.json here
       ↓
wallet-new-sync.yml
  → diff.mjs      adds new keys, drops departed ones, carries renames, reports fill rate
  → translate.mjs fills every empty/stale value with Claude, validates, stamps the lock
  → opens ONE PR for review
       ↓
merge → deploy-pages.yml publishes wallet-new/language-<locale>.json
       ↓
rehive-wallet-new: `node ./scripts/i18n.mjs pull` installs finished languages (a reviewed commit —
  a bundled language ships inside the binary, so it is never a bot push)
```

### Commands

```bash
yarn wallet-new:add-language fr      # scaffold, with fr's own plural forms
yarn wallet-new:diff                 # structure + fill-rate report → src/wallet-new/diff.json
yarn wallet-new:translate --dry-run  # what would be sent, no API calls
yarn wallet-new:translate --lang fr  # fill fr (needs ANTHROPIC_API_KEY)
yarn test                            # validator + plural-expansion tests
```

### What the machine output is checked against

`translate.mjs` does not trust the model. Every value must pass `scripts/wallet-new/validate.mjs`
or it is retried once and then **left empty for a human** — never written half-right:

- `{{placeholders}}` identical to the source, same set and count
- do-not-translate terms from `glossary.json` still present verbatim
- newline count unchanged, so multi-paragraph help copy keeps its structure
- no Arabic-Indic or Persian digits — the wallet pins Latin numerals for money and dates
- not byte-identical to the English for anything longer than three words

The lock is stamped only for values that passed, so a failed key is picked up again next run
instead of looking finished.

### Plurals

English ships `_one`/`_other`. Each target gets **its own** CLDR categories, from
`Intl.PluralRules`: Arabic six, French two, Japanese one. On the current source that is 2242 keys
for `fr`, 2262 for `ar`, 2237 for `ja`. This is the main reason the legacy scripts could not be
reused — a key-for-key diff against English deletes forms Arabic needs and demands forms Japanese
has no rule for, and the wallet's `bundled-parity.test.ts` rejects both.

### Renames and human edits

`locks/language-<locale>.json` stores the SHA-256 of the English value each translation was made
from. Two things fall out of that:

- **Rename detection** — a key that left English whose recorded hash matches a key that just
  arrived is a rename, so the finished translation moves with it instead of being deleted and paid
  for again.
- **Stale detection** — if the English changed, the translation is queued for redoing. Add a key to
  the lock's `reviewed` list and it is left alone permanently; the PR reports it as
  human-reviewed-but-English-moved rather than silently overwriting a native speaker's fix.

### Required secret

| Secret | Purpose |
|--------|---------|
| `ANTHROPIC_API_KEY` | `translate.mjs`. **Until this is set the translate step is skipped** and the workflow opens a PR of empty placeholders — the old manual flow, not a failure. |

## GitHub secrets required

Cross-repo pushes are authenticated by the **`rehive-translations-bot`** GitHub App (installed on `wallet-translations` only, with Contents: write). Each repo that needs to push reads the app credentials from these org-level secrets:

| Secret | Where | Description |
|--------|-------|-------------|
| `TRANSLATIONS_BOT_APP_ID` | wallet-react, wallet-react-native, wallet-translations | App ID of `rehive-translations-bot`. |
| `TRANSLATIONS_BOT_PRIVATE_KEY` | wallet-react, wallet-react-native, wallet-translations | Private key (PEM) of `rehive-translations-bot`. |

Each workflow mints a short-lived installation token via [`actions/create-github-app-token`](https://github.com/actions/create-github-app-token):

- **wallet-react / wallet-react-native** — mint a token scoped to `wallet-translations` and push their `src/source/*.json` file here. The token can only touch `wallet-translations`, never the wallet repo it runs in.
- **wallet-translations** (`merge-app-translations.yml`) — mints a token to push `src/language-en.json`. This is required because a push made with the built-in `GITHUB_TOKEN` does **not** trigger other workflows; pushing as the app lets `sync-and-update.yml` and `deploy-pages.yml` fire.

The remaining workflows here (`sync-and-update.yml`, `deploy-pages.yml`) use only the built-in `GITHUB_TOKEN`.

> **Why a GitHub App and not a PAT?** The app isn't tied to a person, mints short-lived tokens, and never expires (no annual renewal). If its private key leaks, the blast radius is write access to `wallet-translations` only — the one repo it's installed on.

---

## Translation guidelines

- Preserve any template variables exactly: `{{name}}`, `{{count}}`, `{{company.name}}`
- Preserve Markdown formatting where present: `**bold**`, `_italic_`
- Do not translate keys — only values
- If a string has no direct translation, use a best-effort approximation and note it in the PR

---

## Accessing language files

Language files are deployed to GitHub Pages on every push to `main`. Files are served flat — no need to know the internal directory structure:

```
https://rehive.github.io/wallet-translations/language-en.json
https://rehive.github.io/wallet-translations/language-fr.json
https://rehive.github.io/wallet-translations/language-de.json
```

An `index.json` is also generated listing all available locale codes:

```
https://rehive.github.io/wallet-translations/index.json
```

```json
{ "locales": ["en", "fr", "de"] }
```
