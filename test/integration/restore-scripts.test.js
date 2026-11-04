const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

/**
 * scripts/restore.sh and restore.ps1 are what a user runs when the editor no
 * longer starts, so nothing inside it can help (patch-safety.js). Each copies
 * the `.vibrancy-orig` originals back: those beside the patched files in
 * `out/`, and product.json's, one level up.
 */

const SCRIPTS = path.join(__dirname, '..', '..', 'scripts');
const has = (cmd) => spawnSync(cmd, ['--version'], { stdio: 'ignore' }).status === 0;

let appRoot;
let outDir;

beforeEach(() => {
  appRoot = path.join(fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'vibrancy-restore-')), 'resources', 'app');
  outDir = path.join(appRoot, 'out');
  fs.mkdirSync(outDir, { recursive: true });

  // An editor that won't start: a broken main.js and product.json, with the
  // originals Vibrancy kept beside them.
  fs.writeFileSync(path.join(outDir, 'main.js'), 'const x = {;');
  fs.writeFileSync(path.join(outDir, 'main.js.vibrancy-orig'), 'console.log("original");\n');
  fs.writeFileSync(path.join(appRoot, 'product.json'), '{ "checksums": {');
  fs.writeFileSync(path.join(appRoot, 'product.json.vibrancy-orig'), '{\n\t"checksums": {}\n}\n');
});

afterEach(() => fs.rmSync(path.dirname(path.dirname(appRoot)), { recursive: true, force: true }));

function expectRestored(result) {
  expect(result.status, result.stdout + result.stderr).toBe(0);
  expect(fs.readFileSync(path.join(outDir, 'main.js'), 'utf-8')).toBe('console.log("original");\n');
  expect(fs.readFileSync(path.join(appRoot, 'product.json'), 'utf-8')).toBe('{\n\t"checksums": {}\n}\n');
  expect(fs.existsSync(path.join(outDir, 'main.js.vibrancy-orig'))).toBe(false);
  expect(fs.existsSync(path.join(appRoot, 'product.json.vibrancy-orig'))).toBe(false);
  expect(result.stdout).toMatch(/restored: .*product\.json/);
}

describe.skipIf(process.platform === 'win32' || !has('bash'))('restore.sh', () => {
  it('puts back the originals in out/ and product.json beside it', () => {
    expectRestored(spawnSync('bash', [path.join(SCRIPTS, 'restore.sh'), outDir], { encoding: 'utf-8' }));
  });

  it('works on an install that has no product.json backup', () => {
    fs.rmSync(path.join(appRoot, 'product.json.vibrancy-orig'));
    const result = spawnSync('bash', [path.join(SCRIPTS, 'restore.sh'), outDir], { encoding: 'utf-8' });
    expect(result.status).toBe(0);
    expect(fs.readFileSync(path.join(outDir, 'main.js'), 'utf-8')).toBe('console.log("original");\n');
    expect(result.stdout).not.toMatch(/FAILED/);
  });
});

// pwsh is a .NET app: on the ubuntu runner it usually starts in 1-2s, but a
// cold start once took 6.4s (nightly run 39785551643) and blew vitest's 5s
// default. The test checks what the script does, not how fast pwsh boots.
describe.skipIf(!has('pwsh'))('restore.ps1', () => {
  it('puts back the originals in out/ and product.json beside it', () => {
    expectRestored(spawnSync('pwsh', ['-NoProfile', '-File', path.join(SCRIPTS, 'restore.ps1'), '-Filter', outDir], { encoding: 'utf-8' }));
  }, 30_000);
});
