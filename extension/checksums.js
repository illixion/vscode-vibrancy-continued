/**
 * Keeping the editor's integrity check quiet about the workbench HTML.
 *
 * At startup the workbench hashes every file listed under `checksums` in
 * product.json and compares the result with the stored value. Any difference
 * shows "Your installation appears to be corrupt" and adds [Unsupported] to the
 * title bar. Vibrancy patches workbench.html, which is on that list, so without
 * this every patched editor shows both.
 *
 * VSCode's warning has a "Don't Show Again" button, but only because its
 * product.json sets `checksumFailMoreInfoUrl`. Cursor and Kiro don't set it, so
 * there the warning can't be dismissed at all, and nowhere does dismissing it
 * remove [Unsupported]. So after patching, the stored checksum of
 * workbench.html is set to the hash of the HTML Vibrancy wrote.
 *
 * That only covers what Vibrancy itself wrote. The checksum is replaced only
 * when the stored value matches the HTML as it was before the patch, or with
 * the patch taken out (removeCSPPatch gives back the original bytes). If
 * anything else has changed the file, such as another patcher, the warning
 * stays. A stored value matching the patched file can also come from a
 * checksum fixer (Fix VSCode Checksums Next rehashes every listed file), and
 * is moved along with the file the same way.
 *
 * Other patchers can also change the file after Vibrancy has stored its
 * checksum. The stored value then matches neither version of the file, and
 * left alone it would outlive both patches: once the other patcher is removed
 * too, a clean file would be reported as corrupt. So the install record keeps
 * what Vibrancy wrote and what the file's checksum was without its patch
 * (ChecksumRecord). When the stored value is still Vibrancy's but no longer
 * describes the file, that earlier value is put back, and the editor reports
 * whatever the other patcher changed.
 *
 * With vscode_vibrancy.fixChecksums off nothing new is stored, and a Reload
 * only takes back Vibrancy's own value: a fixer's value for the patched file
 * stays valid, since the re-patch writes the same bytes.
 *
 * product.json is read before any window opens, so a broken one stops the
 * editor from starting (see patch-safety.js). The edit is therefore a text
 * replacement of the one value, and is only used if the result still parses
 * and differs from the original in that value alone. Anything unexpected
 * leaves the file untouched rather than failing the install.
 */
const crypto = require('crypto');
const path = require('path');

/**
 * The checksum format product.json uses: SHA-256, base64 without padding.
 * @param {string|Buffer} content - A string is hashed as UTF-8, as it's written
 */
function checksumOf(content) {
  return crypto.createHash('sha256').update(content).digest('base64').replace(/=+$/, '');
}

/**
 * product.json sits next to the `out` directory the patched files live in.
 * @param {string} appDir - The editor's `out` directory
 */
function productFileFor(appDir) {
  return path.join(path.dirname(appDir), 'product.json');
}

/**
 * The key product.json lists a file under: its path from `out`, with forward
 * slashes on every platform.
 * @param {string} appDir
 * @param {string} file
 */
function checksumKey(appDir, file) {
  return path.relative(appDir, file).split(path.sep).join('/');
}

function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
}

/**
 * Replace one checksum in product.json's text.
 *
 * @param {string} productText
 * @param {string} key
 * @param {string} checksum
 * @param {(stored: string) => boolean} [mayReplace] - Asked with the stored
 *   value; the checksum is only replaced when it returns true
 * @returns {string|null} The new text, or null to leave the file as it is
 */
function setChecksum(productText, key, checksum, mayReplace = () => true) {
  let product;
  try {
    product = JSON.parse(productText);
  } catch {
    return null;
  }
  const stored = product?.checksums?.[key];
  if (typeof stored !== 'string' || stored === checksum || !mayReplace(stored)) return null;

  const pattern = new RegExp(`("${escapeRegExp(key)}"\\s*:\\s*")${escapeRegExp(stored)}"`, 'g');
  const matches = productText.match(pattern);
  if (!matches || matches.length !== 1) return null;
  const result = productText.replace(pattern, (_, prefix) => `${prefix}${checksum}"`);

  // Must still parse, and differ from the original in this one value only.
  let updated;
  try {
    updated = JSON.parse(result);
  } catch {
    return null;
  }
  product.checksums[key] = checksum;
  return JSON.stringify(updated) === JSON.stringify(product) ? result : null;
}

/**
 * What Vibrancy last stored in product.json, kept in its install record.
 * @typedef {object} ChecksumRecord
 * @property {string} key - The file's key in `checksums`
 * @property {string} written - The checksum Vibrancy stored
 * @property {string} previous - The checksum of the file without Vibrancy's
 *   patch at the time, put back when `written` no longer describes the file
 */

/** The stored checksum of `key`, or null if there is none to read. */
function storedChecksum(productText, key) {
  try {
    const stored = JSON.parse(productText)?.checksums?.[key];
    return typeof stored === 'string' ? stored : null;
  } catch {
    return null;
  }
}

/**
 * Put back the value Vibrancy replaced, if the stored one is still what
 * Vibrancy wrote.
 * @param {string} productText
 * @param {string} key
 * @param {ChecksumRecord | null | undefined} record
 * @returns {string|null}
 */
function undoChecksum(productText, key, record) {
  if (!record || record.key !== key) return null;
  return setChecksum(productText, key, record.previous, (stored) => stored === record.written);
}

/**
 * After patching: store the checksum of the HTML Vibrancy wrote, if the file
 * held nothing else unaccounted for.
 *
 * @param {string} productText
 * @param {string} key
 * @param {{ before: string, after: string, unpatched: string }} html - The file
 *   before the patch, as written, and with Vibrancy's patch taken out
 * @param {ChecksumRecord | null} [record] - From the last install
 * @returns {{ text: string|null, record: ChecksumRecord|null }} The new
 *   product.json text (null to leave it), and the record to keep
 */
function planInstallChecksum(productText, key, { before, after, unpatched }, record) {
  const stored = storedChecksum(productText, key);
  if (stored === null) return { text: null, record: null };

  const written = checksumOf(after);
  if (stored === checksumOf(before) || stored === checksumOf(unpatched)) {
    const text = setChecksum(productText, key, written);
    const recorded = text !== null || stored === written;
    return { text, record: recorded ? { key, written, previous: checksumOf(unpatched) } : null };
  }
  return { text: undoChecksum(productText, key, record), record: null };
}

/**
 * After unpatching: move the checksum along with the file if it was the
 * patched file's, or put back the one Vibrancy replaced if its own is still
 * stored. Anything else is left for the integrity check to report.
 *
 * @param {string} productText
 * @param {string} key
 * @param {{ before: string, after: string }} html - The file before and after
 *   the patch was taken out
 * @param {ChecksumRecord | null} [record] - From the last install
 * @param {{ moveAlong?: boolean }} [options] - moveAlong false only takes back
 *   Vibrancy's own checksum: a Reload with fixChecksums off, which re-patches
 *   straight after without storing anything, so a checksum fixer's value for
 *   the patched file has to stay
 * @returns {string|null}
 */
function planUninstallChecksum(productText, key, { before, after }, record, { moveAlong = true } = {}) {
  const patched = checksumOf(before);
  return (moveAlong ? setChecksum(productText, key, checksumOf(after), (stored) => stored === patched) : null)
    ?? undoChecksum(productText, key, record);
}

module.exports = {
  checksumOf,
  productFileFor,
  checksumKey,
  setChecksum,
  planInstallChecksum,
  planUninstallChecksum,
};
