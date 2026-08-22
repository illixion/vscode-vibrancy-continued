const path = require('path');
const {
  resolveInstallPaths,
  rebaseInstallPaths,
  CJS_RUNTIME_SRC,
  ESM_RUNTIME_SRC,
} = require('../../extension/install-paths');

const APP = path.join('/opt', 'code', 'resources', 'app', 'out');
const j = (rel) => path.join(APP, ...rel.split('/'));

const MAIN = j('main.js');
const SEPARATE_ELECTRON_MAIN = j('vs/code/electron-main/main.js');
const SANDBOX_HTML = j('vs/code/electron-sandbox/workbench/workbench.html');
const BROWSER_HTML = j('vs/code/electron-browser/workbench/workbench.html');
const ESM_HTML = j('vs/code/electron-sandbox/workbench/workbench.esm.html');

/** An install whose only files are the ones named. */
const installOf = (...files) => {
  const present = new Set(files);
  return (p) => present.has(p);
};

// Layouts as shipped, oldest to newest. Named by the VSCode version that
// introduced them so a future move has an obvious place to be added.
const LAYOUTS = {
  // <= 1.93: separate Electron main, sandboxed workbench, CJS runtime
  pre94: installOf(MAIN, SEPARATE_ELECTRON_MAIN, SANDBOX_HTML),
  // 1.94 only: ESM workbench
  esm94: installOf(MAIN, SEPARATE_ELECTRON_MAIN, ESM_HTML),
  // 1.95: Electron main merged into main.js, back to CJS
  merged95: installOf(MAIN, SANDBOX_HTML),
  // 1.102: electron-sandbox renamed to electron-browser
  browser102: installOf(MAIN, BROWSER_HTML),
};

describe('resolveInstallPaths', () => {
  it('finds the sandboxed workbench and the CJS runtime on 1.95+', () => {
    const paths = resolveInstallPaths({ appDir: APP, exists: LAYOUTS.merged95 });

    expect(paths.htmlFile).toBe(SANDBOX_HTML);
    expect(paths.useEsmRuntime).toBe(false);
    expect(paths.runtimeSrcDir).toBe(CJS_RUNTIME_SRC);
  });

  it('follows the electron-sandbox -> electron-browser rename in 1.102', () => {
    const paths = resolveInstallPaths({ appDir: APP, exists: LAYOUTS.browser102 });

    expect(paths.htmlFile).toBe(BROWSER_HTML);
    // The rename did not change the runtime flavour, and reading it as a
    // missing workbench.html would hand a current VSCode the 1.94 ESM runtime.
    expect(paths.useEsmRuntime).toBe(false);
    expect(paths.runtimeSrcDir).toBe(CJS_RUNTIME_SRC);
  });

  it('picks the ESM workbench and ESM runtime together on 1.94', () => {
    const paths = resolveInstallPaths({ appDir: APP, exists: LAYOUTS.esm94 });

    expect(paths.htmlFile).toBe(ESM_HTML);
    expect(paths.useEsmRuntime).toBe(true);
    expect(paths.runtimeSrcDir).toBe(ESM_RUNTIME_SRC);
  });

  it('prefers the sandbox path when an install somehow has both', () => {
    // Whichever VSCode itself loads is the one worth patching, and that is
    // still workbench.html under electron-sandbox for every version that has
    // the file at all.
    const paths = resolveInstallPaths({
      appDir: APP,
      exists: installOf(MAIN, SANDBOX_HTML, BROWSER_HTML),
    });

    expect(paths.htmlFile).toBe(SANDBOX_HTML);
  });

  it('reports the merged main.js of 1.95+ as one file', () => {
    const paths = resolveInstallPaths({ appDir: APP, exists: LAYOUTS.merged95 });

    expect(paths.electronJsFile).toBe(paths.jsFile);
    expect(paths.mergedMain).toBe(true);
  });

  it('keeps the two main.js files apart before 1.95', () => {
    const paths = resolveInstallPaths({ appDir: APP, exists: LAYOUTS.pre94 });

    expect(paths.jsFile).toBe(MAIN);
    expect(paths.electronJsFile).toBe(SEPARATE_ELECTRON_MAIN);
    expect(paths.mergedMain).toBe(false);
  });

  it('puts the runtime beside the install, keyed by runtime version', () => {
    expect(resolveInstallPaths({ appDir: APP, exists: LAYOUTS.merged95 }).runtimeDir)
      .toBe(j('vscode-vibrancy-runtime-v6'));
    expect(resolveInstallPaths({ appDir: APP, exists: LAYOUTS.merged95, runtimeVersion: 'v7' }).runtimeDir)
      .toBe(j('vscode-vibrancy-runtime-v7'));
  });

  it('falls back to the ESM layout when nothing can be found', () => {
    // Not a preference — the ESM branch is reached by elimination, so it is
    // also where an appDir that does not exist yet lands. That is precisely
    // why the paths must be resolved before any mirror retargeting, and why
    // rebaseInstallPaths refuses to move paths it did not resolve.
    const paths = resolveInstallPaths({ appDir: APP, exists: () => false });

    expect(paths.useEsmRuntime).toBe(true);
    expect(paths.mergedMain).toBe(true);
  });

  it('refuses to guess at missing inputs', () => {
    expect(() => resolveInstallPaths({ exists: () => true })).toThrow(/appDir is required/);
    expect(() => resolveInstallPaths({ appDir: APP })).toThrow(/exists must be a function/);
    expect(() => resolveInstallPaths()).toThrow(/appDir is required/);
  });
});

describe('rebaseInstallPaths', () => {
  const MIRROR = path.join('/home', 'u', '.local', 'share', 'vscode-vibrancy', 'mirror-abc', 'lib', 'vscode', 'resources', 'app', 'out');
  const move = { fromDir: APP, toDir: MIRROR };

  it('moves every install path, keeping its place in the package', () => {
    const moved = rebaseInstallPaths(resolveInstallPaths({ appDir: APP, exists: LAYOUTS.pre94 }), move);

    expect(moved.appDir).toBe(MIRROR);
    expect(moved.jsFile).toBe(path.join(MIRROR, 'main.js'));
    expect(moved.electronJsFile).toBe(path.join(MIRROR, 'vs', 'code', 'electron-main', 'main.js'));
    expect(moved.htmlFile).toBe(path.join(MIRROR, 'vs', 'code', 'electron-sandbox', 'workbench', 'workbench.html'));
    expect(moved.runtimeDir).toBe(path.join(MIRROR, 'vscode-vibrancy-runtime-v6'));
  });

  it('leaves the original alone', () => {
    // Retargeting used to mutate the live paths in place, so a second
    // retarget — a nixos-rebuild moving the store path under a running
    // mirror — rebased already-rebased paths.
    const original = resolveInstallPaths({ appDir: APP, exists: LAYOUTS.merged95 });
    const snapshot = { ...original };

    rebaseInstallPaths(original, move);

    expect(original).toEqual(snapshot);
  });

  it('keeps the merged-main identity that Install() branches on', () => {
    // Install() compares these two by identity to decide whether both patches
    // must land on one in-memory copy. If a rebase broke the equality it would
    // re-read between patches and silently drop the window options.
    const moved = rebaseInstallPaths(resolveInstallPaths({ appDir: APP, exists: LAYOUTS.merged95 }), move);

    expect(moved.electronJsFile).toBe(moved.jsFile);
    expect(moved.mergedMain).toBe(true);
  });

  it('carries the runtime flavour across unchanged', () => {
    // A mirror is a verbatim copy of the package, so the flavour probed
    // against the original still holds — and must not be re-probed against a
    // mirror that has not been created yet.
    const moved = rebaseInstallPaths(resolveInstallPaths({ appDir: APP, exists: LAYOUTS.esm94 }), move);

    expect(moved.useEsmRuntime).toBe(true);
    expect(moved.runtimeSrcDir).toBe(ESM_RUNTIME_SRC);
  });

  it('rejects paths that never lived under fromDir', () => {
    // The mistake this guards: resolving the layout *after* retargeting, which
    // reads as a harmless simplification at the call site. Every probe would
    // miss against a not-yet-created mirror, the ESM fallback would be taken,
    // and the wrong runtime would be written before anything noticed.
    const elsewhere = resolveInstallPaths({ appDir: MIRROR, exists: LAYOUTS.merged95 });

    expect(() => rebaseInstallPaths(elsewhere, move))
      .toThrow(/is not inside/);
  });

  it('rejects rebasing the same paths twice', () => {
    const moved = rebaseInstallPaths(resolveInstallPaths({ appDir: APP, exists: LAYOUTS.merged95 }), move);

    expect(() => rebaseInstallPaths(moved, move)).toThrow(/is not inside/);
  });

  it('re-mirrors an already-mirrored install when the store path moves', () => {
    // The NixOS staleness path: VSCode is running from an old mirror and a
    // rebuild has produced a new store hash, so fromDir is the old mirror.
    const NEW_MIRROR = MIRROR.replace('mirror-abc', 'mirror-def');
    const moved = rebaseInstallPaths(
      rebaseInstallPaths(resolveInstallPaths({ appDir: APP, exists: LAYOUTS.merged95 }), move),
      { fromDir: MIRROR, toDir: NEW_MIRROR },
    );

    expect(moved.appDir).toBe(NEW_MIRROR);
    expect(moved.jsFile).toBe(path.join(NEW_MIRROR, 'main.js'));
  });

  it('refuses to guess at missing inputs', () => {
    const paths = resolveInstallPaths({ appDir: APP, exists: LAYOUTS.merged95 });

    expect(() => rebaseInstallPaths(null, move)).toThrow(/paths is required/);
    expect(() => rebaseInstallPaths(paths, { fromDir: APP })).toThrow(/fromDir and toDir are required/);
    expect(() => rebaseInstallPaths(paths)).toThrow(/fromDir and toDir are required/);
  });
});
