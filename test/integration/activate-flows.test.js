const fs = require('fs');
const path = require('path');
const os = require('os');
// Makes require('vscode') resolvable for the extension too; see the helper.
const vscode = require('../helpers/vscode-host');
const { getConfigDir } = require('../../extension/file-transforms');

/**
 * Drives extension/index.js the way VSCode does — activate(), then the
 * registered commands — against a throwaway VSCode install in a temp dir.
 *
 * Worth the setup because the file work and the settings work are two halves of
 * one operation that have to succeed or fail together, and nothing below
 * activate() can see both. The unit suites cover each half in isolation; these
 * cover the seam, which is where the bugs have actually been:
 *
 *   - Disable reverted the colour customizations before it touched a file, so
 *     any abandoned uninstall left VSCode patched with the colours already
 *     gone: a visibly broken editor with no hint that re-running Disable fixes
 *     it. Guarded by "leaves the colours alone when the file work fails".
 *   - Install picks the runtime flavour by probing the install layout, and a
 *     wrong guess writes the wrong runtime and only fails afterwards. Guarded
 *     by the two "installs the ... runtime" cases.
 */

const FIXTURES = path.join(__dirname, '..', 'fixtures');
const SANDBOX_HTML = path.join('vs', 'code', 'electron-sandbox', 'workbench', 'workbench.html');
const ESM_HTML = path.join('vs', 'code', 'electron-sandbox', 'workbench', 'workbench.esm.html');

let tmpRoot;
let appDir;
let savedEnv;
let extension;

/** Lay down a fake VSCode install and point the extension at it. */
function makeInstall({ htmlRelPath = SANDBOX_HTML } = {}) {
  appDir = path.join(tmpRoot, 'resources', 'app', 'out');
  fs.mkdirSync(path.join(appDir, path.dirname(htmlRelPath)), { recursive: true });
  // The 1.95+ layout: one merged main.js, no vs/code/electron-main/main.js.
  fs.copyFileSync(path.join(FIXTURES, 'main-merged.js'), path.join(appDir, 'main.js'));
  fs.copyFileSync(path.join(FIXTURES, 'workbench.html'), path.join(appDir, htmlRelPath));

  // activate() finds the install via require.main, which vitest does not
  // define, and falls back to this global — the one VSCode's own bundle sets.
  globalThis._VSCODE_FILE_ROOT = appDir;
  return { htmlPath: path.join(appDir, htmlRelPath), jsPath: path.join(appDir, 'main.js') };
}

function activate({ settings = {} } = {}) {
  vscode.__reset({
    settings: {
      // Matching the theme keeps the "your colour theme doesn't match" prompt
      // out of the captured messages; the rest come from the manifest.
      'workbench.colorTheme': 'Default Dark+',
      ...settings,
    },
    // Pre-seeded so activate() doesn't offer a first-run install or kick off an
    // update of its own; each test drives the commands it wants explicitly.
    globalState: { lastVersion: require('../../package.json').version },
  });

  const context = {
    subscriptions: [],
    // Identifies the profile the install belongs to — see profile-ownership.js.
    globalStorageUri: { fsPath: path.join(tmpRoot, 'home', 'globalStorage', 'illixion.vscode-vibrancy-continued') },
    globalState: {
      get: (k) => vscode.__state.globalState.get(k),
      update: async (k, v) => { vscode.__state.globalState.set(k, v); },
    },
    extension: { packageJSON: require('../../package.json') },
  };

  extension.activate(context);
  return context;
}

const run = (command) => vscode.__state.commands.get(command)();
const read = (p) => fs.readFileSync(p, 'utf-8');
const colours = () => vscode.__state.settings['workbench.colorCustomizations'];

beforeEach(() => {
  // realpath so the temp dir doesn't sit behind a symlink (/var -> /private/var
  // on macOS), which would make path comparisons against it fail.
  tmpRoot = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'vibrancy-activate-'));
  const fakeHome = path.join(tmpRoot, 'home');

  // Everything index.js reads out of the home directory — its own config.json,
  // the profile registry, settings.json, the NixOS mirror base — is derived
  // from os.homedir() or an XDG variable, so redirecting both is enough to keep
  // the run off the real machine. Set explicitly rather than deleted, so the
  // result doesn't depend on what the CI runner happens to export.
  savedEnv = {
    HOME: process.env.HOME,
    XDG_CONFIG_HOME: process.env.XDG_CONFIG_HOME,
    XDG_DATA_HOME: process.env.XDG_DATA_HOME,
    APPDATA: process.env.APPDATA,
  };
  process.env.HOME = fakeHome;
  process.env.XDG_CONFIG_HOME = path.join(fakeHome, '.config');
  process.env.XDG_DATA_HOME = path.join(fakeHome, '.local', 'share');
  process.env.APPDATA = path.join(fakeHome, 'AppData', 'Roaming');
  fs.mkdirSync(fakeHome, { recursive: true });

  // The extension only ever runs inside Electron and reads its major version to
  // decide how to inject the window options. Node doesn't report one.
  if (!process.versions.electron) {
    Object.defineProperty(process.versions, 'electron', { value: '37.2.0', configurable: true });
  }

  extension = require('../../extension/index.js');
});

afterEach(() => {
  for (const [k, v] of Object.entries(savedEnv || {})) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  delete globalThis._VSCODE_FILE_ROOT;
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

describe('the home directory is redirected', () => {
  it('so nothing in these tests can reach the real config', () => {
    // If this ever fails, every test below is writing to the developer's own
    // vibrancy config and VSCode settings.
    expect(getConfigDir('vscode-vibrancy-continued')).toContain(tmpRoot);
  });
});

describe('Enable', () => {
  it('patches the install and writes the colour customizations', async () => {
    const { jsPath, htmlPath } = makeInstall();
    activate();

    await run('extension.installVibrancy');

    expect(read(jsPath)).toContain('VSCODE-VIBRANCY-START');
    expect(read(htmlPath)).not.toBe(read(path.join(FIXTURES, 'workbench.html')));
    expect(colours()).toMatchObject({ 'editor.background': expect.stringMatching(/^#[0-9a-f]{8}$/i) });
  });

  it('records what it patched, so the uninstall hook can undo it', async () => {
    const { jsPath, htmlPath } = makeInstall();
    activate();

    await run('extension.installVibrancy');

    const config = JSON.parse(read(path.join(getConfigDir('vscode-vibrancy-continued'), 'config.json')));
    expect(config.jsPath).toBe(jsPath);
    expect(config.workbenchHtmlPath).toBe(htmlPath);
    // 1.95+ merged the two main.js files into one; both patches land there.
    expect(config.electronJsPath).toBe(jsPath);
  });

  it('installs the CJS runtime for a modern install', async () => {
    makeInstall({ htmlRelPath: SANDBOX_HTML });
    activate();

    await run('extension.installVibrancy');

    const runtime = fs.readdirSync(path.join(appDir, 'vscode-vibrancy-runtime-v6'));
    expect(runtime).toContain('index.cjs');
    expect(runtime).not.toContain('index.mjs');
  });

  it('installs the ESM runtime for a 1.94 install', async () => {
    // The pairing that matters: the ESM workbench and the ESM runtime are
    // chosen by the same probe, and getting them out of step writes a runtime
    // the workbench cannot load — with no error until VSCode next starts.
    makeInstall({ htmlRelPath: ESM_HTML });
    activate();

    await run('extension.installVibrancy');

    const runtime = fs.readdirSync(path.join(appDir, 'vscode-vibrancy-runtime-v6'));
    expect(runtime).toContain('index.mjs');
    expect(runtime).not.toContain('index.cjs');
  });
});

describe('Disable', () => {
  it('restores the files byte for byte and reverts the colours', async () => {
    const { jsPath, htmlPath } = makeInstall();
    const originalJs = read(jsPath);
    const originalHtml = read(htmlPath);
    activate({ settings: { 'workbench.colorCustomizations': { 'editor.foreground': '#abcdef' } } });

    await run('extension.installVibrancy');
    await run('extension.uninstallVibrancy');

    expect(read(jsPath)).toBe(originalJs);
    expect(read(htmlPath)).toBe(originalHtml);
    // The user's own customization survives; vibrancy's translucent ones go.
    expect(colours()).toEqual({ 'editor.foreground': '#abcdef' });
  });

  it('leaves the colours alone when the file work fails', async () => {
    // The regression this exists for. Disable used to revert the colours in its
    // preamble, before it knew the files could be written at all — so a failure
    // here left VSCode still patched with the vibrancy colours already gone.
    const { htmlPath } = makeInstall();
    activate();

    await run('extension.installVibrancy');
    const patchedColours = { ...colours() };
    expect(patchedColours['editor.background']).toBeTruthy();

    // Stand-in for any reason the file work can't complete: a declined
    // elevation prompt, a read-only install dir, an antivirus lock.
    fs.rmSync(htmlPath);
    await run('extension.uninstallVibrancy');

    expect(colours()).toEqual(patchedColours);
    expect(vscode.__state.messages.some((m) => m.kind === 'error')).toBe(true);
    // Still on record as installed, so re-running Disable can finish the job.
    expect(fs.existsSync(path.join(getConfigDir('vscode-vibrancy-continued'), 'config.json'))).toBe(true);
  });
});

describe('Reload', () => {
  it('re-patches in place and keeps the colours applied', async () => {
    const { jsPath } = makeInstall();
    activate();

    await run('extension.installVibrancy');
    await run('extension.updateVibrancy');

    expect(read(jsPath)).toContain('VSCODE-VIBRANCY-START');
    // Update() re-installs rather than disabling, so nothing should have been
    // reverted along the way.
    expect(colours()['editor.background']).toBeTruthy();
    // And exactly one set of markers — not one per update.
    expect(read(jsPath).match(/VSCODE-VIBRANCY-START/g)).toHaveLength(1);
  });
});
