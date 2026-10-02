/**
 * Where in a VSCode installation the files vibrancy patches live.
 *
 * Two things make this worth its own module rather than a few lines inside
 * activate():
 *
 *  1. The layout is probed, not versioned. `vscode.version` is never
 *     consulted: forks (Cursor, VSCodium) report the VSCode version they are
 *     based on, not a layout. The layout is inferred purely from which files
 *     exist, which makes the whole decision a pure function of a directory
 *     listing: every layout can be covered by tests, on any platform, with no
 *     VSCode install present.
 *
 *  2. It is the one place that knows where VSCode keeps the workbench HTML,
 *     which moved from electron-sandbox to electron-browser in 1.102.
 *
 * The supported floor is VSCode 1.95 (package.json `engines.vscode`), so two
 * older layouts are gone rather than probed for: 1.94's ESM workbench
 * (workbench.esm.html, which needed its own runtime flavour) and the separate
 * Electron main entry (vs/code/electron-main/main.js) that 1.95 merged into
 * main.js.
 *
 * One layout since then splits them again: VSCode 1.140 moved BrowserWindow
 * creation into a sibling mainImpl.js that main.js loads. The window options
 * must land there, so `windowOptionsFile` names it when it exists (and is
 * `jsFile` otherwise). The caller patches one file or two accordingly.
 *
 * ORDERING RULE — resolve against the directory VSCode is really running
 * from, then move the result with rebaseInstallPaths(). Never resolve against
 * a NixOS mirror directory: the mirror is created *during* the install, so at
 * resolve time it may not exist yet, every probe would miss, and a 1.95-1.101
 * install would be given the electron-browser path it does not have. That
 * mistake looks like a simplification when reading the call site, so
 * rebaseInstallPaths() refuses paths that don't live under its `fromDir` —
 * turning it into a throw rather than a wrongly-patched editor.
 */

const path = require('path');

const DEFAULT_RUNTIME_VERSION = 'v6';

/** Runtime source directory, relative to this file. */
const RUNTIME_SRC = '../runtime-pre-esm';

/** Path keys that name a file or directory inside the install. */
const REBASED_KEYS = ['jsFile', 'windowOptionsFile', 'htmlFile', 'runtimeDir'];

/**
 * @typedef {object} InstallPaths
 * @property {string} appDir          directory the paths were resolved against
 * @property {string} jsFile          main.js: the Electron main entry and workbench main in one
 * @property {string} windowOptionsFile  the file that creates BrowserWindow: mainImpl.js
 *   on 1.140+, otherwise the same as jsFile
 * @property {string} htmlFile        workbench HTML
 * @property {string} runtimeDir      where the injected runtime is installed
 * @property {string} runtimeSrcDir   runtime to copy, relative to this file
 */

/**
 * Work out the install layout by probing for files.
 *
 * @param {object} options
 * @param {string} options.appDir  VSCode's `out` directory
 * @param {(p: string) => boolean} options.exists  existence probe (injected so
 *   this stays pure and testable; production passes fs.existsSync)
 * @param {string} [options.runtimeVersion]  runtime dir suffix
 * @returns {InstallPaths}
 */
function resolveInstallPaths({ appDir, exists, runtimeVersion = DEFAULT_RUNTIME_VERSION } = {}) {
  if (!appDir) throw new Error('resolveInstallPaths: appDir is required');
  if (typeof exists !== 'function') throw new Error('resolveInstallPaths: exists must be a function');

  const sandboxHtml = path.join(appDir, 'vs', 'code', 'electron-sandbox', 'workbench', 'workbench.html');
  const browserHtml = path.join(appDir, 'vs', 'code', 'electron-browser', 'workbench', 'workbench.html');

  // electron-browser is reached by elimination, so it is also where an
  // unreadable or not-yet-created appDir lands — hence the ordering rule in
  // this file's header. A wrong guess is caught by the fs.stat in Install()
  // before anything is written.
  const htmlFile = exists(sandboxHtml) ? sandboxHtml : browserHtml;

  const jsFile = path.join(appDir, 'main.js');
  const mainImpl = path.join(appDir, 'mainImpl.js');

  return {
    appDir,
    jsFile,
    windowOptionsFile: exists(mainImpl) ? mainImpl : jsFile,
    htmlFile,
    runtimeDir: path.join(appDir, `vscode-vibrancy-runtime-${runtimeVersion}`),
    runtimeSrcDir: RUNTIME_SRC,
  };
}

/**
 * Every runtime folder Vibrancy has installed beside VSCode: the current one
 * and any left by an older runtime version.
 *
 * @param {string} appDir  VSCode's `out` directory
 * @param {(dir: string) => string[]} readdir  directory listing (injected, as
 *   with resolveInstallPaths; production passes fs.readdirSync)
 * @returns {string[]}
 */
function findRuntimeDirs(appDir, readdir) {
  let names = [];
  try {
    names = readdir(appDir);
  } catch {
    return [];
  }
  return names
    .filter((name) => /^vscode-vibrancy-runtime(?:-|$)/.test(name))
    .map((name) => path.join(appDir, name));
}

/**
 * Move an already-resolved layout from one install directory to another,
 * keeping each path's position within the package. Used for the NixOS shadow
 * install, where patching is redirected to a writable mirror of a read-only
 * /nix/store package.
 *
 * Returns a new object; the input is left alone. The old in-place version
 * meant a second retarget — a nixos-rebuild moving the store path under a
 * running mirror — rebased already-rebased paths.
 *
 * @param {InstallPaths} paths
 * @param {{fromDir: string, toDir: string}} move
 * @returns {InstallPaths}
 */
function rebaseInstallPaths(paths, { fromDir, toDir } = {}) {
  if (!paths) throw new Error('rebaseInstallPaths: paths is required');
  if (!fromDir || !toDir) throw new Error('rebaseInstallPaths: fromDir and toDir are required');

  const rebase = (p) => {
    const rel = path.relative(fromDir, p);
    // A path that has to climb out of fromDir was never inside it, which means
    // these paths were resolved against some other directory. Joining anyway
    // yields a plausible-looking path pointing at the wrong install, so refuse.
    if (rel === '' || rel === '..' || rel.startsWith(`..${path.sep}`) || path.isAbsolute(rel)) {
      throw new Error(`rebaseInstallPaths: ${p} is not inside ${fromDir}`);
    }
    return path.join(toDir, rel);
  };

  // Spread first so runtimeSrcDir carries over untouched: it describes this
  // extension, not the install.
  const rebased = { ...paths, appDir: toDir };
  for (const key of REBASED_KEYS) {
    if (paths[key] !== undefined) rebased[key] = rebase(paths[key]);
  }
  return rebased;
}

module.exports = {
  resolveInstallPaths,
  findRuntimeDirs,
  rebaseInstallPaths,
  DEFAULT_RUNTIME_VERSION,
  RUNTIME_SRC,
};
