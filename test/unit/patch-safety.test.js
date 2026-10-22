const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn, spawnSync } = require('child_process');
const {
  backupPathFor,
  isPatched,
  planBackup,
  moduleTypeOf,
  canRunAsNode,
  checkSyntax,
  checkFileSyntax,
  checkJSON,
  startupFiles,
  findStartupProblems,
  planJSONBackup,
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

describe('checkFileSyntax', () => {
  // As checkSyntax, with Node standing in for the editor's binary.
  let tmpDir;
  beforeEach(() => { tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vibrancy-file-syntax-')); });
  afterEach(() => fs.rmSync(tmpDir, { recursive: true, force: true }));

  const write = (name, code) => {
    const file = path.join(tmpDir, name);
    fs.writeFileSync(file, code);
    return file;
  };
  const check = (file, overrides = {}) => checkFileSyntax(file, { execPath: process.execPath, spawn, ...overrides });

  it('passes a file that parses and fails one that does not', async () => {
    expect(await check(write('ok.js', WINDOW_PATCHED))).toEqual({ ok: true });
    const broken = await check(write('broken.js', 'const x = {;\n'));
    expect(broken.ok).toBe(false);
    expect(broken.message).toMatch(/SyntaxError/);
  });

  it('parses with the module system of where the file is', async () => {
    // Sloppy-mode code: fine as CommonJS, a SyntaxError in a module.
    const sloppy = 'with ({}) { var x = 1; }\n';
    expect((await check(write('plain.js', sloppy))).ok).toBe(true);
    fs.writeFileSync(path.join(tmpDir, 'package.json'), JSON.stringify({ type: 'module' }));
    expect((await check(write('module.js', sloppy))).ok).toBe(false);
  });

  it('reports a check that could not run as skipped, not as a failure', async () => {
    const result = await check(write('ok.js', PRISTINE), { execPath: path.join(tmpDir, 'no-such-binary') });
    expect(result).toMatchObject({ ok: true, skipped: true });
  });

  it('reports a check that ran out of time as skipped', async () => {
    const slow = write('slow.js', PRISTINE);
    const result = await check(slow, { execPath: process.execPath, timeout: 1, spawn: (exe) => spawn(exe, ['-e', 'setTimeout(() => {}, 5000)']) });
    expect(result).toMatchObject({ ok: true, skipped: true });
  });
});

describe('checkJSON', () => {
  it('reads JSON as require() does, ignoring a BOM', () => {
    expect(checkJSON('\uFEFF{"a":1}')).toEqual({ ok: true });
  });

  it('fails JSON that does not parse', () => {
    expect(checkJSON('{"a":').ok).toBe(false);
  });
});

describe('startupFiles', () => {
  const appDir = path.join('/x', 'resources', 'app', 'out');
  const all = () => true;

  it('lists what the editor loads before any extension runs', () => {
    const files = startupFiles({ appDir, jsFile: path.join(appDir, 'main.js'), windowOptionsFile: path.join(appDir, 'mainImpl.js') }, all);
    expect(files).toEqual([
      { file: path.join(appDir, 'main.js'), kind: 'js' },
      { file: path.join(appDir, 'mainImpl.js'), kind: 'js' },
      { file: path.join('/x', 'resources', 'app', 'product.json'), kind: 'json' },
      { file: path.join('/x', 'resources', 'app', 'package.json'), kind: 'json' },
      { file: path.join(appDir, 'vs', 'workbench', 'workbench.desktop.main.js'), kind: 'js' },
    ]);
  });

  it('lists main.js once when it also creates the window, and skips what is not there', () => {
    const main = path.join(appDir, 'main.js');
    const files = startupFiles({ appDir, jsFile: main, windowOptionsFile: main }, (p) => !p.endsWith('package.json'));
    expect(files.map((f) => path.basename(f.file))).toEqual(['main.js', 'product.json', 'workbench.desktop.main.js']);
  });
});

describe('findStartupProblems', () => {
  const files = [{ file: 'main.js', kind: 'js' }, { file: 'product.json', kind: 'json' }];
  const readFile = (contents) => (p) => { if (!(p in contents)) throw new Error(`ENOENT ${p}`); return contents[p]; };

  it('finds nothing when everything loads', async () => {
    const problems = await findStartupProblems(files, { readFile: readFile({ 'product.json': '{}' }), checkJS: async () => ({ ok: true }) });
    expect(problems).toEqual([]);
  });

  it('reports each file that would not load', async () => {
    const problems = await findStartupProblems(files, {
      readFile: readFile({ 'product.json': '{' }),
      checkJS: async () => ({ ok: false, message: 'SyntaxError: x' }),
    });
    expect(problems.map((p) => p.file)).toEqual(['main.js', 'product.json']);
  });

  it('still checks the JSON files when JavaScript cannot be checked', async () => {
    const problems = await findStartupProblems(files, { readFile: readFile({}) });
    expect(problems).toEqual([{ file: 'product.json', message: 'ENOENT product.json' }]);
  });
});

describe('planJSONBackup', () => {
  const product = (commit, extra = '') => JSON.stringify({ commit, version: '1.0' }) + extra;

  it('keeps a copy of a product.json that parses', () => {
    expect(planJSONBackup(product('a'), undefined)).toBe(product('a'));
  });

  it('leaves the first copy while the editor is the same build', () => {
    expect(planJSONBackup(product('a', ' '), product('a'))).toBeNull();
  });

  it('replaces it once the editor has updated, or the copy is unusable', () => {
    expect(planJSONBackup(product('b'), product('a'))).toBe(product('b'));
    expect(planJSONBackup(product('a'), '{')).toBe(product('a'));
  });

  it('never keeps a copy that would not load', () => {
    expect(planJSONBackup('{', undefined)).toBeNull();
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
