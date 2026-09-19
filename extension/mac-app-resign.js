const cp = require('child_process');
const { shellEscape, elevatedShellScript } = require('./elevated-file-writer');

/**
 * Ad-hoc re-signing of the macOS app bundle, offered during Enable when the
 * vibrancy type is liquid-glass.
 *
 * WHY: VSCode ships signed by Microsoft with the hardened runtime, which
 * enables library validation — the main process may only dlopen native
 * libraries signed with the same Team ID. The Liquid Glass addon is ad-hoc
 * signed by node-gyp, so a stock install refuses it and the runtime falls
 * back to under-window vibrancy. Re-signing the bundle ad-hoc drops the
 * hardened runtime (and with it library validation), which lets the addon
 * load. It changes no code, only signatures; every auto-update restores the
 * original signature, so this is offered again after each update.
 *
 * See LIQUID-GLASS-NOTES.md for the full explanation and the manual command.
 */

/**
 * Derive the .app bundle path from the running executable.
 * process.execPath is `<bundle>/Contents/MacOS/<binary>`.
 * @param {string} execPath
 * @returns {string | null}
 */
function appBundlePath(execPath) {
  if (!execPath) return null;
  const parts = execPath.split('/');
  const macosIdx = parts.lastIndexOf('MacOS');
  if (macosIdx < 2 || parts[macosIdx - 1] !== 'Contents') return null;
  // Strip both MacOS/ and Contents/ to get at the bundle root.
  const bundle = parts.slice(0, macosIdx - 1).join('/');
  return bundle.endsWith('.app') ? bundle : null;
}

/**
 * Parse `codesign -dvv` output (it reports on stderr).
 * @param {string} output
 * @returns {{ signed: boolean, teamId: string | null, adHoc: boolean }}
 */
function parseCodesignInfo(output) {
  const match = /TeamIdentifier=(.+)/.exec(output || '');
  if (!match) return { signed: false, teamId: null, adHoc: false };
  const team = match[1].trim();
  if (team === 'not set') return { signed: true, teamId: null, adHoc: true };
  return { signed: true, teamId: team, adHoc: false };
}

/**
 * @param {string} appPath
 * @returns {Promise<{ signed: boolean, teamId: string | null, adHoc: boolean } | null>}
 *   null when the signature couldn't be inspected at all.
 */
function getCodesignInfo(appPath) {
  return new Promise((resolve) => {
    cp.execFile('codesign', ['-dvv', appPath], (error, stdout, stderr) => {
      const output = `${stderr || ''}\n${stdout || ''}`;
      if (error && !/TeamIdentifier=/.test(output)) {
        resolve(null);
        return;
      }
      resolve(parseCodesignInfo(output));
    });
  });
}

/**
 * The shell command that replaces every signature in the bundle with an
 * ad-hoc one and strips the quarantine attribute for a clean first launch.
 * @param {string} appPath
 * @returns {string}
 */
function reSignCommand(appPath) {
  const q = `'${shellEscape(appPath)}'`;
  return `codesign --force --deep --sign - ${q} && { xattr -dr com.apple.quarantine ${q} 2>/dev/null || true; }`;
}

function execShell(command) {
  return new Promise((resolve, reject) => {
    cp.execFile('/bin/sh', ['-c', command], (error, _stdout, stderr) => {
      if (error) {
        reject(new Error(stderr || error.message));
      } else {
        resolve();
      }
    });
  });
}

const PERMISSION_ERROR = /permission denied|not permitted|eacces|eperm/i;

/**
 * Run the re-sign, escalating to an administrator prompt only if the bundle
 * isn't writable by the current user (the usual case for /Applications).
 * @param {string} appPath
 * @returns {Promise<void>}
 */
async function reSignApp(appPath) {
  const command = reSignCommand(appPath);
  try {
    await execShell(command);
  } catch (err) {
    const message = String((err && err.message) || err);
    if (!PERMISSION_ERROR.test(message)) throw err;
    await elevatedShellScript(command);
  }
}

module.exports = {
  appBundlePath,
  parseCodesignInfo,
  getCodesignInfo,
  reSignCommand,
  reSignApp,
};
