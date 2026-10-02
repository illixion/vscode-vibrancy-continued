/**
 * The record of what Vibrancy patched, which Disable and the uninstall hook
 * need in order to undo it.
 *
 * There is one record per editor install. They all live in one config
 * directory, which is keyed by $HOME and shared by every VSCode-based editor
 * on the machine, so a single config.json used to serve all of them: disabling
 * Vibrancy in Insiders deleted the record that VSCode's uninstall hook needed
 * to unpatch VSCode. Records are keyed by the editor's extensions directory
 * (~/.vscode/extensions, ~/.vscode-insiders/extensions, ~/.cursor/extensions,
 * a custom --extensions-dir), which both the running extension and its
 * uninstall hook can work out from their own location.
 *
 * config.json is still written as a copy of the latest record, because older
 * versions' uninstall hooks read only that file and a downgrade followed by an
 * uninstall should still find it. It is removed only by the install it
 * describes.
 *
 * Synchronous on purpose: the uninstall hook is a plain script, and these are
 * small files.
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const LEGACY_FILE = 'config.json';
const RECORDS_DIR = 'installs';

/**
 * The extensions directory an extension was loaded from.
 * @param {string} extensionRoot  the extension's own folder (holding package.json)
 */
function extensionsDirOf(extensionRoot) {
  return path.dirname(path.resolve(extensionRoot));
}

function recordFile(configDir, extensionsDir) {
  const id = crypto.createHash('sha256').update(path.resolve(extensionsDir)).digest('hex').slice(0, 16);
  return path.join(configDir, RECORDS_DIR, `${id}.json`);
}

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf-8'));
  } catch {
    return null;
  }
}

/**
 * Does a record describe this install?
 *
 * A config.json written before records were per install names no editor. It is
 * matched by the main.js it patched when that is known; the uninstall hook
 * doesn't know it, and takes such a record as its own, as it always has.
 */
function belongsTo(record, { extensionsDir, jsPath }) {
  if (!record) return false;
  if (record.extensionsDir) return path.resolve(record.extensionsDir) === path.resolve(extensionsDir);
  return jsPath === undefined || record.jsPath === jsPath;
}

/**
 * This install's record, or null when Vibrancy isn't enabled in it.
 * @param {string} configDir
 * @param {{ extensionsDir: string, jsPath?: string }} install
 */
function readRecord(configDir, install) {
  const own = readJson(recordFile(configDir, install.extensionsDir));
  if (own) return own;
  const legacy = readJson(path.join(configDir, LEGACY_FILE));
  return belongsTo(legacy, install) ? legacy : null;
}

/**
 * Save this install's record, and copy it to config.json for older hooks.
 * @param {string} configDir
 * @param {object} record  must carry `extensionsDir`
 */
function writeRecord(configDir, record) {
  if (!record.extensionsDir) throw new Error('writeRecord: record.extensionsDir is required');
  const text = JSON.stringify(record, null, 2);
  const file = recordFile(configDir, record.extensionsDir);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text, 'utf-8');
  fs.writeFileSync(path.join(configDir, LEGACY_FILE), text, 'utf-8');
}

/**
 * Forget this install's record. config.json goes too if it describes this
 * install, and is then refilled from another install's record if one is left,
 * so an older hook in that editor still finds what it needs.
 * @param {string} configDir
 * @param {{ extensionsDir: string, jsPath?: string }} install
 */
function removeRecord(configDir, install) {
  fs.rmSync(recordFile(configDir, install.extensionsDir), { force: true });

  const legacyFile = path.join(configDir, LEGACY_FILE);
  if (!belongsTo(readJson(legacyFile), install)) return;
  fs.rmSync(legacyFile, { force: true });

  const recordsDir = path.join(configDir, RECORDS_DIR);
  let remaining = [];
  try {
    remaining = fs.readdirSync(recordsDir).filter((name) => name.endsWith('.json'));
  } catch {
    // No records directory: nothing to promote.
  }
  for (const name of remaining) {
    const other = readJson(path.join(recordsDir, name));
    if (other) {
      fs.writeFileSync(legacyFile, JSON.stringify(other, null, 2), 'utf-8');
      return;
    }
  }
}

module.exports = {
  extensionsDirOf,
  readRecord,
  writeRecord,
  removeRecord,
  LEGACY_FILE,
  RECORDS_DIR,
};
