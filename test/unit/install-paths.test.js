const path = require('path');
const {
  resolveInstallPaths,
  rebaseInstallPaths,
  RUNTIME_SRC,
} = require('../../extension/install-paths');

const APP = path.join('/opt', 'code', 'resources', 'app', 'out');
const j = (rel) => path.join(APP, ...rel.split('/'));

const MAIN = j('main.js');
const SANDBOX_HTML = j('vs/code/electron-sandbox/workbench/workbench.html');
const BROWSER_HTML = j('vs/code/electron-browser/workbench/workbench.html');
const ESM_HTML = j('vs/code/electron-sandbox/workbench/workbench.esm.html');

/** An install whose only files are the ones named. */
const installOf = (...files) => {
  const present = new Set(files);
  return (p) => present.has(p);
};

// Supported layouts, oldest to newest. Named by the VSCode version that
// introduced them so a future move has an obvious place to be added.
const LAYOUTS = {
  // 1.95 (the supported floor): Electron main merged into main.js
  merged95: installOf(MAIN, SANDBOX_HTML),
  // 1.102: electron-sandbox renamed to electron-browser
  browser102: installOf(MAIN, BROWSER_HTML),
};

describe('resolveInstallPaths', () => {
  it('finds the sandboxed workbench on 1.95-1.101', () => {
    const paths = resolveInstallPaths({ appDir: APP, exists: LAYOUTS.merged95 });

    expect(paths.jsFile).toBe(MAIN);
    expect(paths.htmlFile).toBe(SANDBOX_HTML);
    expect(paths.runtimeSrcDir).toBe(RUNTIME_SRC);
  });

  it('follows the electron-sandbox -> electron-browser rename in 1.102', () => {
    const paths = resolveInstallPaths({ appDir: APP, exists: LAYOUTS.browser102 });

    expect(paths.jsFile).toBe(MAIN);
    expect(paths.htmlFile).toBe(BROWSER_HTML);
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

  it('falls back to electron-browser when nothing can be found', () => {
    // Not a preference — electron-browser is reached by elimination, so it is
    // also where an appDir that does not exist yet lands. That is precisely
    // why the paths must be resolved before any mirror retargeting, and why
    // rebaseInstallPaths refuses to move paths it did not resolve.
    const paths = resolveInstallPaths({ appDir: APP, exists: () => false });

    expect(paths.htmlFile).toBe(BROWSER_HTML);
  });

  it('gives a 1.94 install a path that does not exist, so Install() rejects it', () => {
    // 1.94 is below the floor. Its workbench.esm.html is no longer probed for,
    // and the fallback names a file this install lacks, which the fs.stat in
    // Install() turns into an error before anything is written.
    const exists = installOf(MAIN, ESM_HTML);
    const paths = resolveInstallPaths({ appDir: APP, exists });

    expect(exists(paths.htmlFile)).toBe(false);
  });

  it('puts the runtime beside the install, keyed by runtime version', () => {
    expect(resolveInstallPaths({ appDir: APP, exists: LAYOUTS.merged95 }).runtimeDir)
      .toBe(j('vscode-vibrancy-runtime-v6'));
    expect(resolveInstallPaths({ appDir: APP, exists: LAYOUTS.merged95, runtimeVersion: 'v7' }).runtimeDir)
      .toBe(j('vscode-vibrancy-runtime-v7'));
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
    const moved = rebaseInstallPaths(resolveInstallPaths({ appDir: APP, exists: LAYOUTS.merged95 }), move);

    expect(moved.appDir).toBe(MIRROR);
    expect(moved.jsFile).toBe(path.join(MIRROR, 'main.js'));
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

  it('carries the runtime source across unchanged', () => {
    // It names a directory inside this extension, not inside the install.
    const moved = rebaseInstallPaths(resolveInstallPaths({ appDir: APP, exists: LAYOUTS.merged95 }), move);

    expect(moved.runtimeSrcDir).toBe(RUNTIME_SRC);
  });

  it('rejects paths that never lived under fromDir', () => {
    // The mistake this guards: resolving the layout *after* retargeting, which
    // reads as a harmless simplification at the call site. Every probe would
    // miss against a not-yet-created mirror and a 1.95-1.101 install would be
    // handed the electron-browser path it does not have.
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
