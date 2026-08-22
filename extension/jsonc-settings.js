const jsonc = require('jsonc-parser');

/**
 * Reading and editing a VSCode settings.json as text.
 *
 * Vibrancy normally edits settings through the `vscode` configuration API,
 * which handles all of this itself. Two places can't use that API:
 *
 *   - the `vscode:uninstall` hook, which runs as a bare node script with no
 *     extension host around it;
 *   - any profile other than the active one, since the API only ever addresses
 *     the profile the extension host belongs to.
 *
 * Both used to fall back to regex substitution over the raw file. That is what
 * produced a `terminalStickyScroll.background` that was cleaned up on POSIX but
 * not on Windows, and left `"key": "value",\n            ` indentation debris
 * behind on every restore. Regexes also can't see structure, so a colour key
 * nested under `workbench.colorCustomizations` was indistinguishable from a
 * same-named key anywhere else in the document.
 *
 * So this goes through `jsonc-parser` — the same library VSCode itself uses to
 * apply settings edits (microsoft/node-jsonc-parser, MIT, no dependencies).
 *
 * Its `modify()` helper is not quite right for removals, though. Removing a
 * property makes it rewrite the span between the surrounding properties, so a
 * comment sitting in that span disappears with it:
 *
 *     "sideBar.background": "#1e1e1ecc", // my sidebar
 *     // User note about colors
 *     "editor.background": "#1e1e1ee6"
 *
 * removing both keys via `modify()` takes both comments with them. Fine for an
 * editor, where the user can undo; not fine for an uninstall hook editing a file
 * nobody is watching. So removals and value replacements are done as surgery on
 * the exact byte ranges `parseTree()` reports for a property — ranges that
 * exclude comments by construction — and `modify()` is kept only for inserting
 * a key that isn't there, where there is nothing adjacent to lose.
 */

const COLOR_CUSTOMIZATIONS = 'workbench.colorCustomizations';

// VSCode's own settings reader tolerates comments and trailing commas, so
// anything it accepts has to be accepted here too — rejecting a file VSCode
// reads happily would mean refusing to clean up a perfectly normal settings.json.
const PARSE_OPTIONS = { allowTrailingComma: true, disallowComments: false };

/**
 * Work out how a settings file is formatted, so edits blend into it.
 *
 * This matters more than it looks: `modify` re-indents the region it touches
 * using the options it is handed, so guessing wrong is exactly how a 2-space
 * file ends up with a 4-space block wedged into it, or a CRLF file grows lone
 * LF lines. Both are diff noise in a file users keep in dotfile repos.
 *
 * @param {string} text - Raw settings.json contents
 * @returns {{tabSize: number, insertSpaces: boolean, eol: string}}
 */
function detectFormatting(text) {
  const source = typeof text === 'string' ? text : '';

  // A single CRLF is enough: VSCode writes one EOL style per file, and a mixed
  // file is going to be normalised by whoever writes it next anyway.
  const eol = source.includes('\r\n') ? '\r\n' : '\n';

  // The first indented line that carries content. Blank lines and lines that
  // are only whitespace say nothing about the indent unit.
  const indent = /^([ \t]+)\S/m.exec(source)?.[1];

  if (indent === undefined) {
    return { tabSize: 4, insertSpaces: true, eol };
  }
  if (indent.startsWith('\t')) {
    // Tab-indented: tabSize is a display preference, not something the bytes
    // reveal, so leave it at VSCode's default and just stop inserting spaces.
    return { tabSize: 4, insertSpaces: false, eol };
  }
  return { tabSize: Math.min(indent.length, 8), insertSpaces: true, eol };
}

/**
 * Parse a settings document, reporting rather than throwing on damage.
 *
 * `jsonc.modify` does not fail on a malformed document — it splices an edit in
 * anyway and returns something that is no longer valid JSON. That makes the
 * error list the only thing standing between a half-saved settings.json and a
 * write that corrupts it further, so callers are expected to check it.
 *
 * @param {string} text
 * @returns {{value: any, errors: Array<{error: number, offset: number}>}}
 */
function parseSettings(text) {
  const errors = [];
  const value = jsonc.parse(typeof text === 'string' ? text : '', errors, PARSE_OPTIONS);
  return { value, errors };
}

/**
 * Read `workbench.colorCustomizations` out of a settings document.
 *
 * @param {string} text
 * @returns {Object} the colour map, or `{}` when absent or unusable
 */
function readColorCustomizations(text) {
  const { value } = parseSettings(text);
  const colors = value?.[COLOR_CUSTOMIZATIONS];
  return colors && typeof colors === 'object' && !Array.isArray(colors) ? colors : {};
}

/** Find the property node for `key` inside an object node, or undefined. */
function findProperty(objectNode, key) {
  if (objectNode?.type !== 'object') return undefined;
  return objectNode.children?.find((property) => property.children?.[0]?.value === key);
}

/**
 * Work out the byte range to cut when removing a property.
 *
 * Starts from the range `parseTree` reports — which covers exactly
 * `"key": value` and no surrounding trivia — then extends it just far enough to
 * leave valid, tidy JSON:
 *
 *   - forward over a following comma, so the object doesn't end up with two;
 *   - outward to swallow the whole line, but *only* when nothing else shares it.
 *     A trailing `// comment` keeps its line, and its indentation with it.
 *
 * A dangling comma before a closing brace is left alone: JSONC allows it, VSCode
 * reads it, and chasing it risks eating a comment that sits in the way.
 */
function propertyDeletionRange(text, propertyNode) {
  let start = propertyNode.offset;
  let end = propertyNode.offset + propertyNode.length;

  let cursor = end;
  while (cursor < text.length && (text[cursor] === ' ' || text[cursor] === '\t')) cursor += 1;
  if (text[cursor] === ',') end = cursor + 1;

  // Is the property alone on its line? Only then is the line itself ours.
  let lineStart = start;
  while (lineStart > 0 && text[lineStart - 1] !== '\n') lineStart -= 1;
  const beforeIsBlank = /^[ \t]*$/.test(text.slice(lineStart, start));

  let lineEnd = end;
  while (lineEnd < text.length && text[lineEnd] !== '\n') lineEnd += 1;
  const afterIsBlank = /^[ \t]*$/.test(text.slice(end, lineEnd));

  if (beforeIsBlank && afterIsBlank) {
    return { start: lineStart, end: Math.min(lineEnd + 1, text.length) };
  }

  return { start, end };
}

/**
 * Apply a list of edits to a settings document.
 *
 * Removals and replacements are collected as byte ranges against the document as
 * it stands, then applied back-to-front so earlier offsets stay valid.
 * Insertions can't work that way — there is no existing range to replace — so
 * they go through `modify()` afterwards, one at a time, since each one shifts
 * the offsets the next would have been computed against.
 *
 * @param {string} text
 * @param {Array<{path: (string|number)[], value: any}>} edits - `value: undefined` deletes
 * @param {{tabSize: number, insertSpaces: boolean, eol: string}} [formattingOptions]
 * @returns {string}
 */
function editSettings(text, edits, formattingOptions) {
  const source = typeof text === 'string' ? text : '';
  const options = { formattingOptions: formattingOptions || detectFormatting(source) };
  const tree = jsonc.parseTree(source, [], PARSE_OPTIONS);

  const ranges = [];
  const insertions = [];

  for (const { path, value } of edits) {
    // Walk the path to the property, so a key is only ever matched in the
    // object it actually belongs to.
    let node = tree;
    let property;
    for (const segment of path) {
      property = findProperty(node, segment);
      if (!property) break;
      node = property.children[1];
    }

    if (!property) {
      // Nothing there to remove; an insert has to be built by modify().
      if (value !== undefined) insertions.push({ path, value });
      continue;
    }

    if (value === undefined) {
      ranges.push({ ...propertyDeletionRange(source, property), text: '' });
    } else {
      const valueNode = property.children[1];
      ranges.push({
        start: valueNode.offset,
        end: valueNode.offset + valueNode.length,
        text: JSON.stringify(value),
      });
    }
  }

  ranges.sort((a, b) => b.start - a.start);

  let result = source;
  for (const range of ranges) {
    result = result.slice(0, range.start) + range.text + result.slice(range.end);
  }

  for (const { path, value } of insertions) {
    result = jsonc.applyEdits(result, jsonc.modify(result, path, value, options));
  }

  return result;
}

/**
 * Does the colour block hold literally nothing — no keys, and no comments?
 *
 * Checked against the raw text rather than the parsed value, because a block
 * containing only a comment parses to `{}` while still carrying something the
 * user wrote.
 */
function isEmptyColorBlock(text) {
  const tree = jsonc.parseTree(text, [], PARSE_OPTIONS);
  const property = findProperty(tree, COLOR_CUSTOMIZATIONS);
  const block = property?.children?.[1];
  if (block?.type !== 'object') return false;

  const body = text.slice(block.offset + 1, block.offset + block.length - 1);
  return /^\s*,?\s*$/.test(body);
}

/**
 * Revert Vibrancy's writes in a settings document.
 *
 * A `null` in either map means "this key was ours and the user had nothing of
 * their own there" — so remove it outright. Any other value is the user's
 * original, to be put back. That distinction is the whole point of the backup:
 * deleting unconditionally would throw away colours the user chose before
 * Vibrancy ever ran.
 *
 * @param {string} text - Raw settings.json contents
 * @param {Object} plan
 * @param {Object<string, string|null>} [plan.colors] - Keys under `workbench.colorCustomizations`
 * @param {Object<string, any>} [plan.settings] - Top-level settings keys
 * @returns {{text: string, changed: boolean, errors: Array}} `errors` non-empty means nothing was applied
 */
function applySettingsRestore(text, plan) {
  const original = typeof text === 'string' ? text : '';
  const { value, errors } = parseSettings(original);

  // Refuse to touch a document we can't read. The regex approach had no way to
  // notice this and would happily edit a truncated file into a worse one.
  if (errors.length > 0) {
    return { text: original, changed: false, errors };
  }

  const formatting = detectFormatting(original);
  const colors = plan?.colors || {};
  const settings = plan?.settings || {};

  const existingColors = value?.[COLOR_CUSTOMIZATIONS];
  const hasColorBlock = !!existingColors && typeof existingColors === 'object' && !Array.isArray(existingColors);

  const edits = [];

  for (const [key, originalValue] of Object.entries(colors)) {
    // Only act on keys actually present. Writing a restored value into a
    // profile that never had the key would be inventing a customization the
    // user never asked for.
    if (!hasColorBlock || !(key in existingColors)) continue;
    edits.push({ path: [COLOR_CUSTOMIZATIONS, key], value: originalValue ?? undefined });
  }

  for (const [key, originalValue] of Object.entries(settings)) {
    const present = value !== undefined && value !== null && key in value;
    if (originalValue == null) {
      if (present) edits.push({ path: [key], value: undefined });
    } else {
      edits.push({ path: [key], value: originalValue });
    }
  }

  if (edits.length === 0) {
    return { text: original, changed: false, errors: [] };
  }

  let result = editSettings(original, edits, formatting);

  // Emptying the colour block leaves `"workbench.colorCustomizations": {}`
  // behind. Harmless, but it is Vibrancy's litter rather than the user's, so
  // clear it up — as long as it really is empty. A block still holding the
  // user's own colours stays, and so does one holding only their comments:
  // removing the property would take the comment text with it.
  if (hasColorBlock && Object.keys(existingColors).length > 0 && isEmptyColorBlock(result)) {
    result = editSettings(result, [{ path: [COLOR_CUSTOMIZATIONS], value: undefined }], formatting);
  }

  return { text: result, changed: result !== original, errors: [] };
}

module.exports = {
  COLOR_CUSTOMIZATIONS,
  detectFormatting,
  parseSettings,
  readColorCustomizations,
  editSettings,
  applySettingsRestore,
};
