# Translating Vibrancy

Adding a language is **one new file**. You don't need to edit any code, and you
don't need to run the extension to get started.

Currently translated: English (the source), Japanese (`ja`), Simplified Chinese (`zh-cn`).

## How it works

All text lives in `package.nls.json` (English). A translation is a copy of that
file named `package.nls.<locale>.json`, with the right-hand side of each line
translated. VS Code uses the same file for the setting descriptions and command
names in its UI, and the extension uses it for its own messages and
notifications. A language with a file is picked up automatically.

- Keys not in your file fall back to English, so a partial translation is fine
  and you can send it in stages.
- Copy `package.nls.json` and translate it, rather than starting from a
  translated file. Write from the English text in the way your language is used
  in your region.

## Steps

1. Pick your locale code: the one VS Code uses for its display language,
   lower-case (`zh-tw`, `pt-br`, `de`, `ko`). If you aren't sure, run
   **Configure Display Language** in VS Code and look at the codes it lists.
   A regional file (`pt-br`) is used for that region; a plain one (`pt`) is also
   used for the other regions of that language (`pt-pt`).
2. Copy `package.nls.json` to `package.nls.<locale>.json` in the repo root.
3. Translate the **values** (right of the colon). Leave the keys, the `$schema`
   line, and the JSON punctuation as they are.
4. Run `npm run check:i18n` (needs Node, no install step) to check your file.
   It reports mistakes and lists the strings you haven't translated yet.
5. Open a pull request, or attach the file to an issue and we'll add it.

## Things to keep as they are

- **Placeholders**: `{0}`, `{1}` are replaced with a profile name, a count and so
  on when the message is shown. Keep them in the translation (you may move
  them to wherever your language needs them). The checker fails if one is missing.
- **Names the user must type or find**: setting names like `vscode_vibrancy.type`,
  command names in quotes such as `"Disable Vibrancy"` (translate these to match
  what the user will see in your language's VS Code if it is translated, or
  keep the English), file names, and product names (Vibrancy, Visual Studio Code,
  Mica, Acrylic).
- **Escaped characters**: `\"` is a quotation mark inside the string, and `\n` is
  a line break. Keep them as they are, or use your language's own quotes.

## Trying it

1. Install the extension in a development copy (F5 in VS Code with this repo open).
2. Run **Configure Display Language**, pick your language, and restart.
   Setting descriptions appear in Settings, and the notification messages
   appear when you enable, update or disable Vibrancy.

## Checking

```sh
npm run check:i18n            # errors fail; untranslated strings are listed
node scripts/check-i18n.js --strict   # untranslated strings fail too
```

`npm test` also runs this check on every translation file, so a change that
breaks one is caught in CI.

When English text changes, the other languages keep showing their old
translation until updated. The checker can't tell a stale translation from a
current one, so a change to an existing English string is worth a note in the
pull request asking translators to review it.
