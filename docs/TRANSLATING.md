# Translating Vibrancy

Vibrancy has a translation editor built in. You need nothing but VS Code with
Vibrancy installed: no git, no Node, no files to edit by hand.

Currently translated: English (the source), Japanese (`ja`), Simplified Chinese (`zh-cn`).

## With the translation editor

1. Open VS Code's Settings, search for **Vibrancy translation**, and click
   **Open the translation editor** in the description of the **Use Translation
   Draft** setting.
2. Pick a language to improve, or choose one to add from the list. It starts
   with your VS Code display language.
3. Work through the list on the left. Each string shows the English text, where
   it appears, a field for your translation and a preview. The preview copies
   the real place it's shown (a setting, a notification, a dialog, the Command
   Palette, a terminal) and updates as you type.
   - **To do** lists what's left, and **Problems** lists strings to fix.
   - Ctrl+Enter (⌘+Enter on a Mac) saves and moves to the next string to do.
   - The button beside each preview shows the real thing in VS Code, with your
     text: the actual notification or dialog, a terminal, or the Command
     Palette. For a setting, it opens the real setting for context. Setting
     descriptions can't show your text there, because VS Code reads them only
     when it starts.
4. Your work is saved as you type, and kept across Vibrancy updates.
5. To see your translation in Vibrancy's real messages while you use it, tick
   **Use for Vibrancy's notifications** at the bottom of the editor (the same as
   the **Use Translation Draft** setting).
6. When you're done, click **Send to Vibrancy**. It copies your file and opens a
   GitHub issue. Paste the file into the issue or attach it. Or use **Save a
   Copy** to write the file anywhere and open a pull request with it.

A partial translation is welcome. Untranslated strings show in English, so you
can send what you have and add the rest later.

Write from the English text, the way your language is used in your region,
rather than converting another translation.

## Things to keep as they are

The editor checks these as you type and lists anything to fix under the field.

- **Placeholders**: `%1`, `%2` and `{0}`, `{1}` are replaced with a file name, a
  profile name, a count and so on when the message is shown. Keep each one, in
  whatever position your language needs. Click a placeholder under the field to
  insert it.
- **Links**: in `[text](target)`, translate only the text in square brackets.
- **Plain text**: setting descriptions, command names and notifications are shown
  as they are, so don't add Markdown such as backticks or `**`.
- **Names the user must type or find**: setting names like `vscode_vibrancy.type`,
  command names in quotes such as "Disable Vibrancy" (use what your language's
  VS Code shows, if it's translated, or keep the English), file names, and
  product names (Vibrancy, Visual Studio Code, Mica, Acrylic).
- **Line breaks** in the English text are worth keeping where they separate
  paragraphs.

## In a clone of the repository

Open the repository folder in VS Code, press F5, and open the translation editor from the setting in the window that opens. The editor
sees the clone and writes straight into its `package.nls.<locale>.json` files,
ready to commit. A file in the repo root is all a language needs; nothing else
registers it.

You can also edit the files by hand: copy `package.nls.json` to
`package.nls.<locale>.json` and translate the values. Then check it:

```sh
npm run check:i18n                    # errors fail; untranslated strings are listed
node scripts/check-i18n.js --strict   # untranslated strings fail too
```

The checker and the editor use the same rules (`extension/translation/rules.js`),
and `npm test` runs the check on every translation file.

When English text changes, the other languages keep showing their old
translation until it is updated. Nothing can tell a stale translation from a
current one, so a change to an existing English string is worth a note in the
pull request asking translators to review it.

## For maintainers: adding a string

- A setting description or command title only needs its key in
  `package.nls.json`. The editor finds where it's used from `package.json`.
- A message the extension shows needs an entry in
  `extension/translation/messages-meta.js`: its kind (info, warning, error,
  button…), buttons, sample values for its placeholders, and a sentence on when
  it appears. A test fails until it has one.
- Keep Markdown out of strings VS Code shows as plain text. A test checks this.
