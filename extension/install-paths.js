/**
 * Where in a VSCode installation the files vibrancy patches live.
 *
 * Two things make this worth its own module rather than a few lines inside
 * activate():
 *
 *  1. The layout is probed, not versioned. VSCode has moved these files three
 *     times — ESM workbench in 1.94, the Electron main entry merged into
 *     main.js in 1.95, electron-sandbox renamed to electron-browser in
 *     1.102 — and `vscode.version` is never consulted for any of it. The
 *     layout is inferred purely from which files exist, which makes the whole
 *     decision a pure function of a directory listing: every layout can be
 *     covered by tests, on any platform, with no VSCode install present.
 *
 *  2. Getting it wrong is silent. Taking the ESM branch on a CJS install
 *     copies the wrong runtime flavour into VSCode's own directory and only
 *     fails afterwards, at the `fs.stat` in Install() — i.e. after the write.
 *     Nothing downstream re-checks it.
 *
 * ORDERING RULE — resolve against the directory VSCode is really running
 * from, then move the result with rebaseInstallPaths(). Never resolve against
 * a NixOS mirror directory: the mirror is created *during* the install, so at
 * resolve time it may not exist yet, every probe would miss, and a modern
 * VSCode would be handed the 1.94 ESM runtime. That mistake looks like a
 * simplification when reading the call site, so rebaseInstallPaths() refuses
 * paths that don't live under its `fromDir` — turning it into a throw rather
 * than a wrongly-patched editor.
 */

const path = require('path');

const DEFAULT_RUNTIME_VERSION = 'v6';

/** Runtime flavour source directories, relative to this file. */
const CJS_RUNTIME_SRC = '../runtime-pre-esm';
const ESM_RUNTIME_SRC = '../runtime';

/** Path keys that name a file or directory inside the install. */
const REBASED_KEYS = ['jsFile', 'electronJsFile', 'htmlFile', 'runtimeDir'];

/**
 * @typedef {object} InstallPaths
 * @property {string} appDir          directory the paths were resolved against
 * @property {string} jsFile          workbench main.js
 * @property {string} electronJsFile  Electron main entry (=== jsFile on 1.95+)
 * @property {string} htmlFile        workbench HTML
 * @property {string} runtimeDir      where the injected runtime is installed
 * @property {string} runtimeSrcDir   runtime flavour to copy, relative to this file
 * @property {boolean} useEsmRuntime  true only for the VSCode 1.94 ESM layout
 * @property {boolean} mergedMain     electronJsFile and jsFile are one file
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

  const jsFile = path.join(appDir, 'main.js');

  // VSCode 1.95 merged the Electron main entry point into the workbench's
  // main.js. When the separate file is absent both patches target one file,
  // and the caller must apply them to a single in-memory copy — re-reading
  // between patches drops the first one. `mergedMain` is that signal.
  const separateElectronMain = path.join(appDir, 'vs', 'code', 'electron-main', 'main.js');
  const electronJsFile = exists(separateElectronMain) ? separateElectronMain : jsFile;

  const sandboxHtml = path.join(appDir, 'vs', 'code', 'electron-sandbox', 'workbench', 'workbench.html');
  const browserHtml = path.join(appDir, 'vs', 'code', 'electron-browser', 'workbench', 'workbench.html');
  const esmHtml = path.join(appDir, 'vs', 'code', 'electron-sandbox', 'workbench', 'workbench.esm.html');

  let htmlFile;
  let useEsmRuntime = false;
  if (exists(sandboxHtml)) {
    htmlFile = sandboxHtml;
  } else if (exists(browserHtml)) {
    htmlFile = browserHtml;
  } else {
    // Only VSCode 1.94 shipped workbench.esm.html; 1.95 reverted to CJS. This
    // branch is reached by elimination rather than by finding the file, so it
    // is also where an unreadable or not-yet-created appDir lands — hence the
    // ordering rule in this file's header.
    htmlFile = esmHtml;
    useEsmRuntime = true;
  }

  return {
    appDir,
    jsFile,
    electronJsFile,
    htmlFile,
    runtimeDir: path.join(appDir, `vscode-vibrancy-runtime-${runtimeVersion}`),
    runtimeSrcDir: useEsmRuntime ? ESM_RUNTIME_SRC : CJS_RUNTIME_SRC,
    useEsmRuntime,
    mergedMain: electronJsFile === jsFile,
  };
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

  // Spread first so the probe-derived flags (useEsmRuntime, runtimeSrcDir,
  // mergedMain) carry over untouched: they describe the package, and a mirror
  // is a verbatim copy of it. mergedMain stays true for free, because one
  // shared path string rebases to one shared path string.
  const rebased = { ...paths, appDir: toDir };
  for (const key of REBASED_KEYS) {
    if (paths[key] !== undefined) rebased[key] = rebase(paths[key]);
  }
  return rebased;
}

module.exports = {
  resolveInstallPaths,
  rebaseInstallPaths,
  DEFAULT_RUNTIME_VERSION,
  CJS_RUNTIME_SRC,
  ESM_RUNTIME_SRC,
};
