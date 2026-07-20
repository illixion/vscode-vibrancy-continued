/**
 * NixOS shadow-install support.
 *
 * On NixOS the VSCode package lives in /nix/store, a read-only mount where
 * even root gets EROFS — elevation can't help. Instead, the whole package is
 * mirrored into a writable directory under $HOME, the two nixpkgs wrapper
 * scripts are repointed at the mirror, and all patching targets the mirror.
 * The nixpkgs build is patchelf'd with absolute /nix/store interpreter and
 * rpaths that remain valid from any location, so the copy runs unchanged.
 *
 * The user launches the patched copy via a separately-named desktop entry
 * ("<App Name> (Vibrancy)") — the original store install is never touched.
 *
 * Layout: <storeRoot>/lib/vscode/resources/app/out is the appDir the
 * extension patches; <storeRoot>/bin/code (env wrapper) execs
 * <storeRoot>/bin/.code-wrapped, which hardcodes VSCODE_PATH to the store
 * lib dir. Both must be repointed. The electron binary itself resolves
 * resources/app via /proc/self/exe, so as long as the copy is a real file
 * tree (not symlinks back to the store), it self-resolves to the mirror.
 */

const fs = require('fs');
const fsPromises = require('fs').promises;
const fsExtra = require('fs-extra');
const path = require('path');
const os = require('os');
const { execFile } = require('child_process');

/**
 * Run fn with Electron's asar path interception disabled. The extension host
 * patches fs so that *.asar files behave like directories; copying or
 * removing a VSCode package (which contains node_modules.asar) through the
 * patched fs fails with "Invalid package". Plain Node (tests, uninstall
 * hook) has no process.noAsar — setting it is harmless there.
 */
async function withNoAsar(fn) {
  const prev = process.noAsar;
  process.noAsar = true;
  try {
    return await fn();
  } finally {
    process.noAsar = prev;
  }
}

const META_FILE = '.vibrancy-mirror.json';
const MIRROR_PREFIX = 'mirror-';
const DESKTOP_ENTRY_NAME = 'code-vibrancy.desktop';

/**
 * Base directory that holds all mirrors: ~/.local/share/vscode-vibrancy
 * (respects XDG_DATA_HOME).
 */
function mirrorBase() {
  const dataHome = process.env.XDG_DATA_HOME || path.join(os.homedir(), '.local', 'share');
  return path.join(dataHome, 'vscode-vibrancy');
}

/**
 * Derive the Nix store package root from any path inside it.
 * e.g. /nix/store/<hash>-vscode-1.119.0/lib/vscode/resources/app/out
 *   -> /nix/store/<hash>-vscode-1.119.0
 */
function deriveStoreRoot(appDir) {
  const parts = appDir.split(path.sep);
  // ['', 'nix', 'store', '<hash>-name', ...]
  if (parts[1] !== 'nix' || parts[2] !== 'store' || !parts[3]) {
    throw new Error(`Not a Nix store path: ${appDir}`);
  }
  return parts.slice(0, 4).join(path.sep);
}

/**
 * Mirror directory for a given store root. The full store basename
 * (hash + package name) keys the mirror, so a system update (new hash)
 * naturally maps to a new mirror directory.
 */
function mirrorRootFor(storeRoot) {
  return path.join(mirrorBase(), MIRROR_PREFIX + path.basename(storeRoot));
}

/**
 * Whether a path is inside the mirror base (i.e. VSCode was launched from
 * a previously created mirror).
 */
function isMirrorPath(p) {
  return p.startsWith(mirrorBase() + path.sep);
}

/**
 * Rebase a path from inside the store package onto the mirror.
 */
function rebasePath(p, storeRoot, mirrorRoot) {
  return path.join(mirrorRoot, path.relative(storeRoot, p));
}

/**
 * Repoint wrapper script content from the store root to the mirror root.
 * Only the package's own root is replaced — references to other store
 * paths (GTK/GIO env, LD_LIBRARY_PATH deps) stay valid and are kept.
 */
function repointContent(content, storeRoot, mirrorRoot) {
  return content.split(storeRoot).join(mirrorRoot);
}

function metaPath(mirrorRoot) {
  return path.join(mirrorRoot, META_FILE);
}

function readMirrorMeta(mirrorRoot) {
  try {
    return JSON.parse(fs.readFileSync(metaPath(mirrorRoot), 'utf-8'));
  } catch {
    return null;
  }
}

async function writeMirrorMeta(mirrorRoot, meta) {
  await fsPromises.writeFile(metaPath(mirrorRoot), JSON.stringify(meta, null, 2), 'utf-8');
}

function run(cmd, args) {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, (error, _stdout, stderr) => {
      if (error) reject(new Error(`${cmd} failed: ${stderr || error.message}`));
      else resolve();
    });
  });
}

/**
 * Make the whole mirror tree user-writable. The store copy carries r-xr-xr-x
 * modes. chmod -R is much faster than a JS directory walk over ~650 MB.
 */
function makeWritable(dir) {
  return run('chmod', ['-R', 'u+w', dir]);
}

/**
 * Rebase absolute intra-package symlinks onto the mirror. cp -a preserves
 * symlinks verbatim, so a link targeting an absolute path inside the copied
 * package (e.g. nixpkgs' wrapProgram leaving bin/.codium-wrapped as a
 * symlink to <storeRoot>/lib/vscode/bin/codium) would still resolve into
 * the read-only store — silently launching the unpatched copy. Links to
 * *other* store paths (runtime deps) stay valid and are left alone, as are
 * relative links (they move with the tree).
 */
async function rebaseSymlinks(staging, storeRoot, mirrorRoot) {
  const links = await new Promise((resolve, reject) => {
    execFile('find', [staging, '-type', 'l'], { maxBuffer: 16 * 1024 * 1024 }, (error, stdout) => {
      if (error) reject(new Error(`find failed: ${error.message}`));
      else resolve(stdout.split('\n').filter(Boolean));
    });
  });
  for (const link of links) {
    const target = await fsPromises.readlink(link);
    if (target !== storeRoot && !target.startsWith(storeRoot + path.sep)) continue;
    // Point at the final mirror location (the tree is renamed there after
    // staging completes; symlink creation doesn't require the target to exist)
    const newTarget = mirrorRoot + target.slice(storeRoot.length);
    await fsPromises.unlink(link);
    await fsPromises.symlink(newTarget, link);
  }
}

/**
 * Remove a directory tree that may contain non-writable directories (a
 * mirror or an interrupted staging copy keeps the store's r-x dir modes
 * until makeWritable has run — plain rm/rmSync fails on those).
 */
async function forceRemove(dir) {
  if (!fs.existsSync(dir)) return;
  try {
    await makeWritable(dir);
  } catch {
    // Best effort — remove() will surface any real failure
  }
  await fsExtra.remove(dir);
}

/**
 * Ensure a writable mirror of the store package exists and is current.
 * Rebuilds from scratch when missing or keyed to a different store root.
 * Old mirrors (from previous system generations) are removed on success.
 *
 * Returns { mirrorRoot, created }.
 */
async function ensureMirror(storeRoot, extraMeta = {}) {
  return withNoAsar(async () => {
    const base = mirrorBase();
    const mirrorRoot = mirrorRootFor(storeRoot);

    const meta = readMirrorMeta(mirrorRoot);
    if (meta && meta.storeRoot === storeRoot) {
      return { mirrorRoot, created: false };
    }

    await fsPromises.mkdir(base, { recursive: true });

    // Copy into a temp sibling first so an interrupted copy never leaves a
    // half-populated mirror that would be mistaken for a complete one.
    const staging = mirrorRoot + '.tmp';
    await forceRemove(staging);
    await forceRemove(mirrorRoot);
    // cp -a preserves modes and intra-package symlinks (store symlinks keep
    // pointing at valid store paths) and is much faster than a JS-level walk
    // for a ~650 MB tree. The electron binary is a regular file in the
    // package, so /proc/self/exe resolves to the mirror after copying.
    await run('cp', ['-a', storeRoot, staging]);
    await makeWritable(staging);
    await rebaseSymlinks(staging, storeRoot, mirrorRoot);

    // Repoint the nixpkgs wrapper scripts at the mirror. Names vary by
    // editor (code/.code-wrapped, codium/.codium-wrapped, code-insiders, …),
    // so rewrite every small regular file in bin/ that references the store
    // root instead of hardcoding a wrapper pair.
    const binDir = path.join(staging, 'bin');
    for (const entry of await fsPromises.readdir(binDir).catch(() => [])) {
      const wrapperPath = path.join(binDir, entry);
      try {
        const stat = await fsPromises.lstat(wrapperPath);
        // Wrapper scripts are tiny; skip symlinks and anything binary-sized
        if (!stat.isFile() || stat.size > 1024 * 1024) continue;
        const raw = await fsPromises.readFile(wrapperPath);
        // NUL byte → binary (utf-8 decoding wouldn't error, it would mangle
        // the content with replacement chars and corrupt the file on write)
        if (raw.includes(0)) continue;
        const content = raw.toString('utf-8');
        if (!content.includes(storeRoot)) continue;
        await fsPromises.writeFile(wrapperPath, repointContent(content, storeRoot, mirrorRoot), 'utf-8');
      } catch {
        // Best effort — an unreadable entry is not a wrapper script
      }
    }

    await writeMirrorMeta(staging, { storeRoot, ...extraMeta });
    await fsPromises.rename(staging, mirrorRoot);

    // Refresh the stable "current" symlink. The mirror dir name changes on
    // every system update (it embeds the store hash), so this gives users a
    // durable path for shell aliases / PATH entries and lets the desktop
    // entry survive a rebuild even if its rewrite is missed.
    try {
      const current = currentSymlinkPath();
      await fsExtra.remove(current);
      await fsPromises.symlink(mirrorRoot, current);
    } catch (err) {
      console.error('Vibrancy: failed to refresh current-mirror symlink:', err);
    }

    // Prune mirrors of older store generations
    try {
      const entries = await fsPromises.readdir(base);
      for (const entry of entries) {
        if (entry.startsWith(MIRROR_PREFIX) && path.join(base, entry) !== mirrorRoot) {
          await forceRemove(path.join(base, entry));
        }
      }
    } catch {
      // Pruning is best-effort
    }

    return { mirrorRoot, created: true };
  });
}

/**
 * Stable path that always points at the active mirror:
 * ~/.local/share/vscode-vibrancy/current
 */
function currentSymlinkPath() {
  return path.join(mirrorBase(), 'current');
}

/**
 * The launchable binary inside a mirror (nixpkgs env wrapper).
 */
function mirrorBinFor(mirrorRoot) {
  const bin = path.join(mirrorRoot, 'bin');
  // nixpkgs vscode ships bin/code; vscodium ships bin/codium
  const known = ['code', 'codium', 'code-insiders', 'codium-insiders', 'code-oss'];
  try {
    const entries = fs.readdirSync(bin).filter((e) => !e.startsWith('.'));
    const preferred = known.find((name) => entries.includes(name));
    if (preferred) return path.join(bin, preferred);
    if (entries.length > 0) return path.join(bin, entries[0]);
  } catch {}
  return path.join(bin, 'code');
}

function desktopEntryPath() {
  const dataHome = process.env.XDG_DATA_HOME || path.join(os.homedir(), '.local', 'share');
  return path.join(dataHome, 'applications', DESKTOP_ENTRY_NAME);
}

function findIcon(mirrorRoot) {
  const pixmaps = path.join(mirrorRoot, 'share', 'pixmaps');
  try {
    const entries = fs.readdirSync(pixmaps).filter((e) => /\.(png|svg)$/.test(e));
    if (entries.length > 0) return path.join(pixmaps, entries[0]);
  } catch {}
  return 'vscode';
}

/**
 * Write a separately-named desktop entry pointing at the mirror. A distinct
 * entry (instead of overriding the system one) avoids desktop-database
 * precedence fights and works identically across DEs.
 */
async function writeDesktopEntry(mirrorRoot, appName) {
  const entryPath = desktopEntryPath();
  // Route Exec/Icon through the stable "current" symlink so the entry keeps
  // working across system updates (the hashed mirror dir changes each time)
  const stableRoot = fs.existsSync(currentSymlinkPath()) ? currentSymlinkPath() : mirrorRoot;
  const bin = path.join(stableRoot, path.relative(mirrorRoot, mirrorBinFor(mirrorRoot)));
  const icon = findIcon(mirrorRoot);
  const stableIcon = path.isAbsolute(icon)
    ? path.join(stableRoot, path.relative(mirrorRoot, icon))
    : icon;
  const content = [
    '[Desktop Entry]',
    `Name=${appName || 'Visual Studio Code'} (Vibrancy)`,
    'Comment=Patched copy managed by the Vibrancy Continued extension',
    'GenericName=Text Editor',
    `Exec="${bin}" %F`,
    `Icon=${stableIcon}`,
    'Type=Application',
    'StartupNotify=true',
    'Categories=Utility;TextEditor;Development;IDE;',
    'MimeType=text/plain;inode/directory;',
    'Keywords=vscode;vibrancy;',
    '',
  ].join('\n');

  await fsPromises.mkdir(path.dirname(entryPath), { recursive: true });
  await fsPromises.writeFile(entryPath, content, 'utf-8');

  // Best-effort desktop database refresh (only needed for MIME associations)
  execFile('update-desktop-database', [path.dirname(entryPath)], () => {});

  return entryPath;
}

async function removeDesktopEntry() {
  await fsExtra.remove(desktopEntryPath());
}

/**
 * Remove all mirrors (the entire mirror base directory).
 */
async function removeAllMirrors() {
  await withNoAsar(() => forceRemove(mirrorBase()));
}

/**
 * Resolve the store root of the *currently installed* system VSCode by
 * following the profile symlinks for the editor's CLI name. Returns null
 * when it can't be determined (e.g. non-standard install).
 */
function resolveSystemStoreRoot(cliName) {
  const user = process.env.USER || path.basename(os.homedir());
  const candidates = [
    path.join(os.homedir(), '.nix-profile', 'bin', cliName),
    path.join('/etc/profiles/per-user', user, 'bin', cliName),
    path.join('/run/current-system/sw/bin', cliName),
  ];
  for (const candidate of candidates) {
    try {
      const real = fs.realpathSync(candidate);
      if (real.startsWith('/nix/store/')) {
        return deriveStoreRoot(real);
      }
    } catch {
      // Candidate doesn't exist — try the next one
    }
  }
  return null;
}

/**
 * When running from a mirror, check whether the system VSCode has moved to
 * a different store path since the mirror was created (nixos-rebuild).
 * Returns { oldStoreRoot, newStoreRoot } when stale, null otherwise.
 */
function checkMirrorStale(mirrorAppDir, cliName) {
  // The mirror mimics the store layout: <mirrorRoot>/lib/vscode/resources/app/out
  const parts = path.relative(mirrorBase(), mirrorAppDir).split(path.sep);
  const mirrorRoot = path.join(mirrorBase(), parts[0]);
  const meta = readMirrorMeta(mirrorRoot);
  if (!meta || !meta.storeRoot) return null;
  const current = resolveSystemStoreRoot(cliName);
  if (current && current !== meta.storeRoot) {
    return { oldStoreRoot: meta.storeRoot, newStoreRoot: current, mirrorRoot };
  }
  return null;
}

module.exports = {
  mirrorBase,
  deriveStoreRoot,
  mirrorRootFor,
  isMirrorPath,
  rebasePath,
  repointContent,
  readMirrorMeta,
  ensureMirror,
  currentSymlinkPath,
  mirrorBinFor,
  desktopEntryPath,
  writeDesktopEntry,
  removeDesktopEntry,
  removeAllMirrors,
  resolveSystemStoreRoot,
  checkMirrorStale,
};
