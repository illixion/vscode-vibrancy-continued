/**
 * Safety net for the files Vibrancy patches inside the editor's install.
 *
 * main.js (and mainImpl.js on VSCode 1.140+) run in the main process before any
 * window opens, so a bad patch there can stop the editor from starting at all —
 * and then Disable, Uninstall and the uninstall hook, which all run inside the
 * editor, can't undo it (issue #201: a window-options patch produced a syntax
 * error and Trae crashed at launch). Two layers guard against that:
 *
 *   1. Every patched file is parsed with the editor's own JavaScript engine
 *      before it is written, and the install is refused if it doesn't compile.
 *   2. A pristine copy of each patched file is kept next to it
 *      (`main.js.vibrancy-orig`), so whatever slips past the check is fixable
 *      without reinstalling the editor: scripts/restore.sh and restore.ps1 copy
 *      the originals back with the editor closed.
 */
const path = require('path');
const { removeJSMarkers, removeElectronOptions } = require('./file-transforms');

const BACKUP_SUFFIX = '.vibrancy-orig';

function backupPathFor(file) {
  return file + BACKUP_SUFFIX;
}

/** Does this file carry any of Vibrancy's patches? */
function isPatched(js) {
  return removeJSMarkers(js).hadMarkers || removeElectronOptions(js) !== js;
}

/**
 * Decide what, if anything, to write as the pristine backup of a file about to
 * be patched.
 *
 * An unpatched file *is* the original, and replaces any older backup: a
 * different one means the editor updated since. A file that is already patched
 * can't be trusted as an original, so it only seeds a backup when there is
 * none yet — the upgrade from a version that kept no backups — and then only
 * once stripping our patches leaves nothing of them behind.
 *
 * @param {string} current - The file's content on disk
 * @param {string|undefined} existingBackup - The current backup, if one exists
 * @returns {string|null} Content to write as the backup, or null to leave it
 */
function planBackup(current, existingBackup) {
  if (!isPatched(current)) return current === existingBackup ? null : current;
  if (existingBackup !== undefined) return null;
  const stripped = removeElectronOptions(removeJSMarkers(current).result);
  return isPatched(stripped) ? null : stripped;
}

/**
 * The module system a file under the app directory is parsed with, from the
 * nearest package.json's `type` (VSCode's app/package.json says "module").
 * @param {string} file
 * @param {(p: string) => string} readFile - throws when the file is missing
 * @returns {'module'|'commonjs'}
 */
function moduleTypeOf(file, readFile) {
  let dir = path.dirname(file);
  for (let i = 0; i < 4; i++) {
    try {
      return JSON.parse(readFile(path.join(dir, 'package.json'))).type === 'module' ? 'module' : 'commonjs';
    } catch {
      // missing or unreadable: keep walking up
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return 'commonjs';
}

/**
 * Whether the editor's binary can be run as plain Node.
 *
 * Electron can be built with that switch (the RunAsNode fuse) turned off, and
 * then running the binary starts the editor instead of a script. VSCode's own
 * command-line launcher is a script that needs the switch, so an editor whose
 * launcher sets ELECTRON_RUN_AS_NODE has it on.
 *
 * @param {string[]} binDirs - Candidate launcher directories
 * @param {{ readdir: (d: string) => string[], readFile: (p: string) => string }} io
 */
function canRunAsNode(binDirs, { readdir, readFile }) {
  for (const dir of binDirs) {
    let names;
    try { names = readdir(dir); } catch { continue; }
    for (const name of names) {
      try {
        if (readFile(path.join(dir, name)).includes('ELECTRON_RUN_AS_NODE')) return true;
      } catch {
        // a subdirectory or unreadable entry
      }
    }
  }
  return false;
}

/**
 * Parse `code` with the editor's own engine, without running it.
 *
 * Uses `--check` under ELECTRON_RUN_AS_NODE, so the file is parsed exactly as
 * the editor will parse it: same V8, and the same module system, picked by the
 * temp file's extension. Anything that stops the check itself from running is
 * reported as `skipped`, not as a failure — the check can refuse a patch, but
 * never blocks an install it couldn't evaluate.
 *
 * @param {string} code
 * @param {{
 *   execPath: string,
 *   moduleType: 'module'|'commonjs',
 *   tmpDir: string,
 *   spawnSync: typeof import('child_process').spawnSync,
 *   writeFile: (p: string, s: string) => void,
 *   unlink: (p: string) => void,
 *   timeout?: number,
 * }} opts
 * @returns {{ ok: boolean, skipped?: boolean, message?: string }}
 */
function checkSyntax(code, { execPath, moduleType, tmpDir, spawnSync, writeFile, unlink, timeout = 30000 }) {
  const ext = moduleType === 'module' ? '.mjs' : '.cjs';
  const file = path.join(tmpDir, `vibrancy-check-${process.pid}-${Date.now()}${ext}`);
  try {
    writeFile(file, code);
  } catch (error) {
    return { ok: true, skipped: true, message: error.message };
  }
  try {
    const result = spawnSync(execPath, ['--check', file], {
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
      encoding: 'utf-8',
      timeout,
      windowsHide: true,
    });
    if (result.error || result.status === null) {
      return { ok: true, skipped: true, message: String(result.error?.message || result.signal) };
    }
    if (result.status === 0) return { ok: true };
    // Only a SyntaxError is a verdict on the code; any other exit means the
    // check itself didn't work.
    const syntaxLine = String(result.stderr).split('\n').find((l) => /SyntaxError/.test(l));
    if (!syntaxLine) return { ok: true, skipped: true, message: String(result.stderr).slice(0, 300) };
    return { ok: false, message: syntaxLine.trim().slice(0, 300) };
  } finally {
    try { unlink(file); } catch { /* best effort */ }
  }
}

/**
 * Is a window-options anchor in this file unambiguous enough to patch an
 * editor Vibrancy hasn't been tested with?
 *
 * A fork that builds windows differently may carry the anchor somewhere other
 * than its main window's options, where the patch would compile and still
 * break the window. So require exactly one of each anchor the patch uses: the
 * `experimentalDarkMode` option, in the options object with `webPreferences`,
 * and on macOS at most one custom-title-bar assignment, which carries the frame
 * options there.
 *
 * @param {string} js - The file that creates the window
 * @param {{ isMacos: boolean }} opts
 * @returns {boolean}
 */
function hasUnambiguousWindowAnchor(js, { isMacos }) {
  const literal = [...js.matchAll(/experimentalDarkMode/g)];
  if (literal.length !== 1) return false;
  const before = js.slice(Math.max(0, literal[0].index - 3000), literal[0].index);
  if (!before.includes('webPreferences')) return false;

  if (!isMacos) return true;
  const hidden = js.match(/(?<![\w$])[A-Za-z_$][\w$]*\.titleBarStyle=(["'])hidden\1,/g) || [];
  return hidden.length <= 1;
}

module.exports = {
  BACKUP_SUFFIX,
  backupPathFor,
  isPatched,
  planBackup,
  moduleTypeOf,
  canRunAsNode,
  checkSyntax,
  hasUnambiguousWindowAnchor,
};
