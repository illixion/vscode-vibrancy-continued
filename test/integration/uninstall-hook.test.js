const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { patchCSP } = require('../../extension/file-transforms');
const { writeRecord, extensionsDirOf } = require('../../extension/install-records');
const { checksumOf } = require('../../extension/checksums');

/**
 * Runs extension/uninstallHook.js as VSCode does on uninstall: a separate Node
 * process, outside the editor, reading the install record Vibrancy left. The
 * home directory is redirected so it can only find the record written here.
 *
 * Not on Windows: there the hook defers its settings work to a script that
 * waits for the editor to quit.
 */

const REPO = path.join(__dirname, '..', '..');
const FIXTURES = path.join(__dirname, '..', 'fixtures');
const HTML_KEY = 'vs/code/electron-browser/workbench/workbench.html';
const OTHER = '<script src="other-patcher.js"></script>';

let tmpRoot;
let home;
let appRoot;
let appDir;

function env() {
  return {
    HOME: home,
    XDG_CONFIG_HOME: path.join(home, '.config'),
    XDG_DATA_HOME: path.join(home, '.local', 'share'),
    // No PATH: the hook's closing notification (osascript, zenity) can't pop up.
    PATH: path.join(tmpRoot, 'no-bin'),
  };
}

function runHook() {
  return spawnSync(process.execPath, [path.join(REPO, 'extension', 'uninstallHook.js')], {
    env: env(), encoding: 'utf-8', timeout: 30000,
  });
}

beforeEach(() => {
  tmpRoot = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'vibrancy-hook-'));
  home = path.join(tmpRoot, 'home');
  appRoot = path.join(tmpRoot, 'resources', 'app');
  appDir = path.join(appRoot, 'out');
  fs.mkdirSync(path.join(appDir, path.dirname(HTML_KEY)), { recursive: true });
  fs.mkdirSync(home, { recursive: true });
});

afterEach(() => fs.rmSync(tmpRoot, { recursive: true, force: true }));

/**
 * An install Vibrancy patched and stored a checksum for, as Enable leaves it.
 * @returns {{ pristine: string, patched: string, product: string }}
 */
function patchedInstall() {
  const pristine = fs.readFileSync(path.join(FIXTURES, 'workbench.html'), 'utf-8');
  const patched = patchCSP(pristine).result;
  fs.writeFileSync(path.join(appDir, HTML_KEY), patched);
  fs.writeFileSync(path.join(appDir, 'main.js'), 'console.log("main");\n');
  fs.writeFileSync(path.join(appDir, 'main.js.vibrancy-orig'), 'console.log("main");\n');

  const product = (checksum) => JSON.stringify({ nameShort: 'Code', checksums: { [HTML_KEY]: checksum } }, null, '\t');
  fs.writeFileSync(path.join(appRoot, 'product.json'), product(checksumOf(patched)));
  fs.writeFileSync(path.join(appRoot, 'product.json.vibrancy-orig'), product(checksumOf(pristine)));

  const settingsJsonPath = path.join(home, 'settings.json');
  fs.writeFileSync(settingsJsonPath, '{}');
  writeRecord(getConfigDirFor(home), {
    extensionsDir: extensionsDirOf(REPO),
    workbenchHtmlPath: path.join(appDir, HTML_KEY),
    jsPath: path.join(appDir, 'main.js'),
    settingsJsonPath,
    checksum: { key: HTML_KEY, written: checksumOf(patched), previous: checksumOf(pristine) },
  });
  return { pristine, patched, product: product(checksumOf(pristine)) };
}

/** getConfigDir reads os.homedir(), so resolve it in a process with HOME redirected. */
function getConfigDirFor(dir) {
  return spawnSync(process.execPath, ['-e',
    `process.stdout.write(require(${JSON.stringify(path.join(REPO, 'extension', 'file-transforms'))}).getConfigDir('vscode-vibrancy-continued'))`,
  ], { env: { ...env(), HOME: dir }, encoding: 'utf-8' }).stdout;
}

const stored = () => JSON.parse(fs.readFileSync(path.join(appRoot, 'product.json'), 'utf-8')).checksums[HTML_KEY];

describe.skipIf(process.platform === 'win32')('the uninstall hook', () => {
  it('unpatches the HTML, puts the checksum back and removes the backups', () => {
    const { pristine } = patchedInstall();

    const result = runHook();

    expect(result.status, result.stderr).toBe(0);
    expect(fs.readFileSync(path.join(appDir, HTML_KEY), 'utf-8')).toBe(pristine);
    expect(stored()).toBe(checksumOf(pristine));
    expect(fs.existsSync(path.join(appRoot, 'product.json.vibrancy-orig'))).toBe(false);
    expect(fs.existsSync(path.join(appDir, 'main.js.vibrancy-orig'))).toBe(false);
  });

  it('takes back its own checksum when another patcher changed the file since', () => {
    const { pristine, patched } = patchedInstall();
    fs.writeFileSync(path.join(appDir, HTML_KEY), patched.replace('</head>', `${OTHER}</head>`));

    const result = runHook();

    expect(result.status, result.stderr).toBe(0);
    const html = fs.readFileSync(path.join(appDir, HTML_KEY), 'utf-8');
    expect(html).toContain(OTHER);
    expect(html).not.toContain('VscodeVibrancy');
    // The editor reports the other patcher's change, and once that is undone
    // too, the file and the check agree again.
    expect(stored()).toBe(checksumOf(pristine));
    expect(html.replace(OTHER, '')).toBe(pristine);
  });
});
