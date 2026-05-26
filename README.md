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

## GitHub secrets required

| Secret | Where | Description |
|--------|-------|-------------|
| `CROSS_REPO_TOKEN` | wallet-react, wallet-react-native | Write access to this (`wallet-translations`) repo, used to push translation files and history snapshots |
| `CROSS_REPO_TOKEN` | wallet-translations | Write access to this repo, used to push the `sync-and-update` translation branch |

The built-in `GITHUB_TOKEN` is used for opening pull requests within this repo.

---

## Translation guidelines

- Preserve any template variables exactly: `{{name}}`, `{{count}}`, `{{company.name}}`
- Preserve Markdown formatting where present: `**bold**`, `_italic_`
- Do not translate keys — only values
- If a string has no direct translation, use a best-effort approximation and note it in the PR

---

## Accessing language files

Since this repo is public, language files can be fetched directly:

```
https://raw.githubusercontent.com/rehive/wallet-translations/main/src/language-en.json
https://raw.githubusercontent.com/rehive/wallet-translations/main/src/locales/language-fr.json
```
