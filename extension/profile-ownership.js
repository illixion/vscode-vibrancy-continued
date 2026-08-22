const path = require('path');
const crypto = require('crypto');

/**
 * Which VSCode profile owns a Vibrancy install.
 *
 * Vibrancy's effect comes from patching VSCode's own installation files, which
 * are machine-wide. But `workbench.colorCustomizations` and the backup of the
 * user's original colours are per-profile: each profile gets its own
 * `globalStorage/state.vscdb`, so each has its own backup paired with its own
 * settings.json. That asymmetry means exactly one profile "owns" an install —
 * the one whose settings hold the colour customizations that need reverting.
 *
 * Disabling from a different profile would unpatch VSCode for every profile
 * while only being able to revert this one's colours, leaving the owner's
 * translucent values behind with no vibrancy under them. Issue #183 is what
 * that looks like from the user's side: a stale `terminal.background` of
 * `#00000000` outlining every glyph in the terminal.
 */

/**
 * Derive a stable identity for the profile an extension host belongs to.
 *
 * There is no API for the current profile, but extension global storage is
 * profile-scoped — `<data>/globalStorage/<ext>` for the default profile and
 * `<data>/profiles/<id>/globalStorage/<ext>` otherwise — so the directory two
 * levels up identifies the profile. The path is hashed so the stored config
 * carries an opaque key rather than a filesystem path; the directory name is
 * kept as a hint because it's the closest thing to a profile identifier the
 * API exposes (VSCode never surfaces the display name).
 *
 * @param {string} globalStoragePath - `context.globalStorageUri.fsPath`
 * @returns {{key: string, hint: string}|null} null when it can't be determined
 */
function deriveProfileIdentity(globalStoragePath) {
  if (typeof globalStoragePath !== 'string' || globalStoragePath === '') return null;

  const profileDir = path.dirname(path.dirname(globalStoragePath));
  if (!profileDir || profileDir === '.' || profileDir === path.dirname(profileDir)) return null;

  return {
    key: crypto.createHash('sha256').update(profileDir).digest('hex').slice(0, 16),
    hint: path.basename(profileDir),
  };
}

/**
 * Decide whether a Disable should go ahead, given who owns the install.
 *
 * Blocking is deliberately limited to the case we're sure about — a recorded
 * owner that demonstrably isn't us. When nothing is recorded (installed by a
 * version before ownership was tracked) or the current profile can't be
 * determined, Vibrancy gets out of the way rather than making itself
 * impossible to remove.
 *
 * @param {Object} opts
 * @param {string|null|undefined} opts.ownerKey - Recorded owning profile key
 * @param {{key: string}|null} opts.currentProfile - Result of deriveProfileIdentity
 * @returns {{allowed: boolean, reason: string}} `allowed: false` means ask the user first
 */
function evaluateUninstallOwnership({ ownerKey, currentProfile }) {
  if (!ownerKey) return { allowed: true, reason: 'no-owner-recorded' };
  if (!currentProfile) return { allowed: true, reason: 'profile-unknown' };
  if (ownerKey === currentProfile.key) return { allowed: true, reason: 'owner' };
  return { allowed: false, reason: 'foreign-profile' };
}

/**
 * Should enabling warn that it's taking ownership from another profile?
 *
 * Enabling from a second profile is where the stranding gets set up: the new
 * install claims ownership, so the previous owner's colours can no longer be
 * reverted by its Disable. Worth saying, but not worth blocking — the effect is
 * machine-wide, so wanting it configured in this profile too is reasonable.
 *
 * @param {Object} opts
 * @param {string|null|undefined} opts.ownerKey - Recorded owning profile key
 * @param {{key: string}|null} opts.currentProfile - Result of deriveProfileIdentity
 * @returns {boolean}
 */
function isOwnershipTakeover({ ownerKey, currentProfile }) {
  return !!ownerKey && !!currentProfile && ownerKey !== currentProfile.key;
}

module.exports = {
  deriveProfileIdentity,
  evaluateUninstallOwnership,
  isOwnershipTakeover,
};
