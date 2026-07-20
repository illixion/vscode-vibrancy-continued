const fs = require('fs');
const path = require('path');
const os = require('os');
const {
  mirrorBase,
  deriveStoreRoot,
  mirrorRootFor,
  isMirrorPath,
  rebasePath,
  repointContent,
  ensureMirror,
  currentSymlinkPath,
  mirrorBinFor,
  readMirrorMeta,
  writeDesktopEntry,
  desktopEntryPath,
} = require('../../extension/nix-mirror');

const STORE_ROOT = '/nix/store/8h4bfjzr0i7cwzcr3dw6qjxs2p9v1n5a-vscode-1.119.0';
const APP_DIR = path.join(STORE_ROOT, 'lib/vscode/resources/app/out');

// --- pure path helpers ---

describe('deriveStoreRoot', () => {
  it('derives the package root from the app dir', () => {
    expect(deriveStoreRoot(APP_DIR)).toBe(STORE_ROOT);
  });

  it('returns the root itself for a root path', () => {
    expect(deriveStoreRoot(STORE_ROOT)).toBe(STORE_ROOT);
  });

  it('throws for non-store paths', () => {
    expect(() => deriveStoreRoot('/usr/lib/code')).toThrow(/Not a Nix store path/);
    expect(() => deriveStoreRoot('/nix/store')).toThrow(/Not a Nix store path/);
  });
});

describe('mirrorRootFor / isMirrorPath', () => {
  it('keys the mirror by the full store basename', () => {
    const root = mirrorRootFor(STORE_ROOT);
    expect(root).toBe(path.join(mirrorBase(), 'mirror-' + path.basename(STORE_ROOT)));
  });

  it('detects paths inside the mirror base', () => {
    expect(isMirrorPath(path.join(mirrorRootFor(STORE_ROOT), 'lib/vscode'))).toBe(true);
    expect(isMirrorPath(APP_DIR)).toBe(false);
    expect(isMirrorPath(os.homedir())).toBe(false);
  });
});

describe('rebasePath', () => {
  it('maps store paths onto the mirror preserving structure', () => {
    const mirrorRoot = mirrorRootFor(STORE_ROOT);
    expect(rebasePath(APP_DIR, STORE_ROOT, mirrorRoot))
      .toBe(path.join(mirrorRoot, 'lib/vscode/resources/app/out'));
  });
});

describe('repointContent', () => {
  it('replaces every occurrence of the store root', () => {
    const content = `#!/bin/sh\nVSCODE_PATH='${STORE_ROOT}/lib/vscode'\nexec ${STORE_ROOT}/bin/.code-wrapped "$@"\n`;
    const out = repointContent(content, STORE_ROOT, '/home/u/.local/share/vscode-vibrancy/mirror-x');
    expect(out).not.toContain(STORE_ROOT);
    expect(out).toContain("VSCODE_PATH='/home/u/.local/share/vscode-vibrancy/mirror-x/lib/vscode'");
    expect(out).toContain('exec /home/u/.local/share/vscode-vibrancy/mirror-x/bin/.code-wrapped');
  });

  it('leaves other store paths untouched', () => {
    const other = '/nix/store/zzzz-glibc-2.40/lib';
    const content = `LD_LIBRARY_PATH=${other}\ncd ${STORE_ROOT}`;
    const out = repointContent(content, STORE_ROOT, '/mirror');
    expect(out).toContain(other);
    expect(out).toContain('cd /mirror');
  });
});

// --- ensureMirror against a fake package tree ---

describe('ensureMirror', () => {
  let tmpHome;
  let fakeStore;
  let prevXdgData;

  beforeEach(() => {
    tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'vibrancy-nix-test-'));
    prevXdgData = process.env.XDG_DATA_HOME;
    process.env.XDG_DATA_HOME = path.join(tmpHome, 'data');

    // Fake nixpkgs vscode package. ensureMirror repoints wrappers by string
    // replacement of the storeRoot, so the tree doesn't need to be in
    // /nix/store — it just needs the nixpkgs layout.
    fakeStore = path.join(tmpHome, 'store', 'abc123-vscode-1.119.0');
    fs.mkdirSync(path.join(fakeStore, 'bin'), { recursive: true });
    fs.mkdirSync(path.join(fakeStore, 'lib/vscode/resources/app/out'), { recursive: true });
    fs.writeFileSync(
      path.join(fakeStore, 'bin', 'code'),
      `#!/bin/sh\nexec ${fakeStore}/bin/.code-wrapped "$@"\n`,
      { mode: 0o555 }
    );
    fs.writeFileSync(
      path.join(fakeStore, 'bin', '.code-wrapped'),
      `#!/bin/sh\nVSCODE_PATH='${fakeStore}/lib/vscode'\nexec "$VSCODE_PATH/code" "$@"\n`,
      { mode: 0o555 }
    );
    fs.writeFileSync(path.join(fakeStore, 'lib/vscode/resources/app/out', 'main.js'), '// vscode', { mode: 0o444 });
  });

  afterEach(() => {
    if (prevXdgData === undefined) delete process.env.XDG_DATA_HOME;
    else process.env.XDG_DATA_HOME = prevXdgData;
    fs.rmSync(tmpHome, { recursive: true, force: true });
  });

  it('copies the package, repoints wrappers, and makes files writable', async () => {
    const { mirrorRoot, created } = await ensureMirror(fakeStore, { vscodeVersion: '1.119.0' });
    expect(created).toBe(true);
    expect(mirrorRoot.startsWith(process.env.XDG_DATA_HOME)).toBe(true);

    const wrapper = fs.readFileSync(path.join(mirrorRoot, 'bin', 'code'), 'utf-8');
    expect(wrapper).not.toContain(fakeStore);
    expect(wrapper).toContain(mirrorRoot);

    const inner = fs.readFileSync(path.join(mirrorRoot, 'bin', '.code-wrapped'), 'utf-8');
    expect(inner).toContain(`VSCODE_PATH='${mirrorRoot}/lib/vscode'`);

    // Patch target must be writable now
    const mainJs = path.join(mirrorRoot, 'lib/vscode/resources/app/out', 'main.js');
    expect(() => fs.writeFileSync(mainJs, '// patched')).not.toThrow();

    expect(readMirrorMeta(mirrorRoot)).toMatchObject({ storeRoot: fakeStore, vscodeVersion: '1.119.0' });
  });

  it('reuses an existing mirror for the same store root', async () => {
    const first = await ensureMirror(fakeStore);
    fs.writeFileSync(path.join(first.mirrorRoot, 'lib/vscode/resources/app/out', 'main.js'), '// patched');
    const second = await ensureMirror(fakeStore);
    expect(second.created).toBe(false);
    expect(second.mirrorRoot).toBe(first.mirrorRoot);
    // Patched content survives the no-op ensure
    expect(fs.readFileSync(path.join(first.mirrorRoot, 'lib/vscode/resources/app/out', 'main.js'), 'utf-8'))
      .toBe('// patched');
  });

  it('prunes mirrors of older store generations', async () => {
    const first = await ensureMirror(fakeStore);

    // Simulate a nixos-rebuild: same package content at a new store path
    const newStore = path.join(tmpHome, 'store', 'def456-vscode-1.120.0');
    fs.cpSync(fakeStore, newStore, { recursive: true });
    const second = await ensureMirror(newStore);

    expect(second.created).toBe(true);
    expect(second.mirrorRoot).not.toBe(first.mirrorRoot);
    expect(fs.existsSync(first.mirrorRoot)).toBe(false);
  });

  it('maintains the stable "current" symlink across generations', async () => {
    const first = await ensureMirror(fakeStore);
    expect(fs.readlinkSync(currentSymlinkPath())).toBe(first.mirrorRoot);
    // The stable CLI path resolves to a real launchable wrapper
    expect(fs.existsSync(path.join(currentSymlinkPath(), 'bin', 'code'))).toBe(true);

    const newStore = path.join(tmpHome, 'store', 'def456-vscode-1.120.0');
    fs.cpSync(fakeStore, newStore, { recursive: true });
    const second = await ensureMirror(newStore);
    expect(fs.readlinkSync(currentSymlinkPath())).toBe(second.mirrorRoot);
  });

  it('desktop entry routes Exec and Icon through the stable symlink', async () => {
    fs.mkdirSync(path.join(fakeStore, 'share/pixmaps'), { recursive: true });
    fs.writeFileSync(path.join(fakeStore, 'share/pixmaps', 'vscode.png'), 'png');
    const { mirrorRoot } = await ensureMirror(fakeStore);
    await writeDesktopEntry(mirrorRoot, 'Visual Studio Code');

    const entry = fs.readFileSync(desktopEntryPath(), 'utf-8');
    expect(entry).toContain(`Exec="${path.join(currentSymlinkPath(), 'bin', 'code')}" %F`);
    expect(entry).toContain(`Icon=${path.join(currentSymlinkPath(), 'share/pixmaps', 'vscode.png')}`);
    expect(entry).toContain('Name=Visual Studio Code (Vibrancy)');
  });

  it('exposes the launchable wrapper via mirrorBinFor', async () => {
    const { mirrorRoot } = await ensureMirror(fakeStore);
    expect(mirrorBinFor(mirrorRoot)).toBe(path.join(mirrorRoot, 'bin', 'code'));
  });

  it('repoints VSCodium wrappers, including the .codium-wrapped store symlink', async () => {
    // nixpkgs vscodium layout: bin/codium was originally a symlink to
    // lib/vscode/bin/codium; wrapProgram renamed that symlink (absolute,
    // into the store) to bin/.codium-wrapped and generated the bin/codium
    // env-wrapper script in its place.
    const codiumStore = path.join(tmpHome, 'store', 'fff777-vscodium-1.119.0');
    fs.mkdirSync(path.join(codiumStore, 'bin'), { recursive: true });
    fs.mkdirSync(path.join(codiumStore, 'lib/vscode/bin'), { recursive: true });
    fs.mkdirSync(path.join(codiumStore, 'lib/vscode/resources/app/out'), { recursive: true });
    fs.writeFileSync(
      path.join(codiumStore, 'bin', 'codium'),
      `#!/bin/sh\nexec -a "$0" "${codiumStore}/bin/.codium-wrapped" "$@"\n`,
      { mode: 0o555 }
    );
    fs.writeFileSync(
      path.join(codiumStore, 'lib/vscode/bin', 'codium'),
      '#!/bin/sh\nexec "$(dirname "$(readlink -f "$0")")/../codium" "$@"\n',
      { mode: 0o555 }
    );
    fs.symlinkSync(
      path.join(codiumStore, 'lib/vscode/bin/codium'),
      path.join(codiumStore, 'bin', '.codium-wrapped')
    );
    // A dependency symlink to a DIFFERENT store path must stay untouched
    const depTarget = '/nix/store/zzzz-electron-34.0.0/bin/electron';
    fs.symlinkSync(depTarget, path.join(codiumStore, 'bin', '.electron-dep'));

    const { mirrorRoot } = await ensureMirror(codiumStore);

    const wrapper = fs.readFileSync(path.join(mirrorRoot, 'bin', 'codium'), 'utf-8');
    expect(wrapper).not.toContain(codiumStore);
    expect(wrapper).toContain(`${mirrorRoot}/bin/.codium-wrapped`);

    // The store symlink must now point inside the mirror and resolve to a file
    const linkTarget = fs.readlinkSync(path.join(mirrorRoot, 'bin', '.codium-wrapped'));
    expect(linkTarget).toBe(path.join(mirrorRoot, 'lib/vscode/bin/codium'));
    expect(fs.realpathSync(path.join(mirrorRoot, 'bin', '.codium-wrapped')))
      .toBe(fs.realpathSync(path.join(mirrorRoot, 'lib/vscode/bin/codium')));

    // Other-store dependency symlinks are left alone
    expect(fs.readlinkSync(path.join(mirrorRoot, 'bin', '.electron-dep'))).toBe(depTarget);

    // The desktop entry's Exec target is the repointed mirror wrapper
    expect(mirrorBinFor(mirrorRoot)).toBe(path.join(mirrorRoot, 'bin', 'codium'));
  });

  it('leaves relative intra-package symlinks untouched', async () => {
    fs.writeFileSync(path.join(fakeStore, 'bin', 'code-real'), '#!/bin/sh\n', { mode: 0o555 });
    fs.symlinkSync('code-real', path.join(fakeStore, 'bin', 'code-alias'));

    const { mirrorRoot } = await ensureMirror(fakeStore);

    expect(fs.readlinkSync(path.join(mirrorRoot, 'bin', 'code-alias'))).toBe('code-real');
    expect(fs.existsSync(path.join(mirrorRoot, 'bin', 'code-alias'))).toBe(true);
  });

  it('leaves binary files in bin/ untouched', async () => {
    // A real electron binary would contain the store path in rpath strings;
    // string-replacing inside a binary would corrupt it
    const blob = Buffer.concat([Buffer.from([0x7f, 0x45, 0x4c, 0x46, 0x00, 0xff]), Buffer.from(fakeStore)]);
    fs.writeFileSync(path.join(fakeStore, 'bin', 'helper-binary'), blob, { mode: 0o555 });

    const { mirrorRoot } = await ensureMirror(fakeStore);

    const copied = fs.readFileSync(path.join(mirrorRoot, 'bin', 'helper-binary'));
    expect(copied.equals(blob)).toBe(true);
  });
});
