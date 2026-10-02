const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const {
  backupPathFor,
  isPatched,
  planBackup,
  moduleTypeOf,
  canRunAsNode,
  checkSyntax,
  hasUnambiguousWindowAnchor,
} = require('../../extension/patch-safety');

const PRISTINE = 'const w = new BrowserWindow({webPreferences:{},experimentalDarkMode:true});\n';
const WINDOW_PATCHED = PRISTINE.replace('experimentalDarkMode', 'frame:false,transparent:true,experimentalDarkMode');
const RUNTIME_PATCHED = `${PRISTINE}/* !! VSCODE-VIBRANCY-START !! */;void 0;/* !! VSCODE-VIBRANCY-END !! */`;

describe('isPatched', () => {
  it('sees the window options and the runtime markers', () => {
    expect(isPatched(PRISTINE)).toBe(false);
    expect(isPatched(WINDOW_PATCHED)).toBe(true);
    expect(isPatched(RUNTIME_PATCHED)).toBe(true);
  });
});

describe('planBackup', () => {
  it('backs up an unpatched file when there is no backup', () => {
    expect(planBackup(PRISTINE, undefined)).toBe(PRISTINE);
  });

  it('leaves a backup that already matches', () => {
    expect(planBackup(PRISTINE, PRISTINE)).toBeNull();
  });

  it('replaces the backup once the editor has updated the file', () => {
    expect(planBackup(PRISTINE, 'the previous version')).toBe(PRISTINE);
  });

  it('never replaces a backup with a patched file', () => {
    expect(planBackup(WINDOW_PATCHED, PRISTINE)).toBeNull();
  });

  it('seeds a missing backup from a patched file, minus the patches', () => {
    // The upgrade from a version that kept no backups.
    expect(planBackup(WINDOW_PATCHED, undefined)).toBe(PRISTINE);
  });
});

describe('moduleTypeOf', () => {
  const files = {
    [path.join('/app', 'package.json')]: JSON.stringify({ type: 'module' }),
  };
  const readFile = (p) => {
    if (!(p in files)) throw new Error('ENOENT');
    return files[p];
  };

  it('reads the nearest package.json above the file', () => {
    expect(moduleTypeOf(path.join('/app', 'out', 'main.js'), readFile)).toBe('module');
  });

  it('defaults to CommonJS without one', () => {
    expect(moduleTypeOf(path.join('/other', 'out', 'main.js'), readFile)).toBe('commonjs');
  });
});

describe('canRunAsNode', () => {
  const io = (dirs) => ({
    readdir: (d) => {
      if (!(d in dirs)) throw new Error('ENOENT');
      return Object.keys(dirs[d]);
    },
    readFile: (p) => dirs[path.dirname(p)][path.basename(p)],
  });

  it('is true when a launcher script runs the binary as Node', () => {
    const dirs = { '/app/bin': { code: 'ELECTRON_RUN_AS_NODE=1 "$ELECTRON" "$CLI"' } };
    expect(canRunAsNode(['/missing', '/app/bin'], io(dirs))).toBe(true);
  });

  it('is false otherwise, so the binary is never started as the editor', () => {
    const dirs = { '/app/bin': { code: 'exec "$ELECTRON" "$@"' } };
    expect(canRunAsNode(['/app/bin'], io(dirs))).toBe(false);
  });
});

describe('checkSyntax', () => {
  // Node stands in for the editor's binary: it parses with --check the same
  // way, and simply ignores ELECTRON_RUN_AS_NODE.
  let tmpDir;
  beforeEach(() => { tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vibrancy-syntax-')); });
  afterEach(() => fs.rmSync(tmpDir, { recursive: true, force: true }));

  const check = (code, overrides = {}) => checkSyntax(code, {
    execPath: process.execPath,
    moduleType: 'module',
    tmpDir,
    spawnSync,
    writeFile: (p, s) => fs.writeFileSync(p, s),
    unlink: (p) => fs.unlinkSync(p),
    ...overrides,
  });

  it('passes code that parses', () => {
    expect(check(WINDOW_PATCHED)).toEqual({ ok: true });
  });

  it('fails code that does not, with the parser\'s message', () => {
    const result = check(PRISTINE.replace('experimentalDarkMode', 'frame:false;experimentalDarkMode'));
    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/SyntaxError/);
  });

  it('parses with the module system the editor uses', () => {
    const esm = 'import fs from "fs";\nexport const x = fs;\n';
    expect(check(esm, { moduleType: 'module' }).ok).toBe(true);
    expect(check(esm, { moduleType: 'commonjs' }).ok).toBe(false);
  });

  it('reports a check that could not run as skipped, not as a failure', () => {
    const result = check(PRISTINE, { execPath: path.join(tmpDir, 'no-such-binary') });
    expect(result).toMatchObject({ ok: true, skipped: true });
  });

  it('cleans up its temp file', () => {
    check(PRISTINE);
    expect(fs.readdirSync(tmpDir)).toEqual([]);
  });
});

describe('hasUnambiguousWindowAnchor', () => {
  it('accepts a single anchor beside webPreferences', () => {
    expect(hasUnambiguousWindowAnchor(PRISTINE, { isMacos: false })).toBe(true);
  });

  it('rejects an anchor outside the window options', () => {
    expect(hasUnambiguousWindowAnchor('const experimentalDarkMode = true;', { isMacos: false })).toBe(false);
  });

  it('rejects more than one window builder', () => {
    expect(hasUnambiguousWindowAnchor(PRISTINE + PRISTINE, { isMacos: false })).toBe(false);
  });

  it('on macOS, also rejects more than one custom title bar assignment', () => {
    const one = `${PRISTINE}c.titleBarStyle="hidden",c.x=1;`;
    expect(hasUnambiguousWindowAnchor(one, { isMacos: true })).toBe(true);
    expect(hasUnambiguousWindowAnchor(`${one}d.titleBarStyle="hidden",d.x=1;`, { isMacos: true })).toBe(false);
  });
});

describe('backupPathFor', () => {
  it('sits next to the file', () => {
    expect(backupPathFor('/app/out/main.js')).toBe('/app/out/main.js.vibrancy-orig');
  });
});
