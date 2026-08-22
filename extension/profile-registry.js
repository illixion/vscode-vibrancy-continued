const path = require('path');

/**
 * Enumerating VSCode's profiles from disk.
 *
 * Vibrancy has a scope mismatch at its centre: the effect comes from patching
 * VSCode's own installation files, which is machine-wide, but the colour
 * customizations that make the effect look right live in
 * `workbench.colorCustomizations`, which is per profile. Reasoning about that
 * needs to know which profiles exist and which settings.json each one reads —
 * neither of which the extension API exposes.
 *
 * It is however all recorded in `<User>/globalStorage/storage.json`, which
 * VSCode maintains itself. Reading it is the only way to turn "some other
 * profile has stale colours" into something a message can actually name.
 */

/**
 * Read the profile registry.
 *
 * The default profile is implicit — it is not listed in `userDataProfiles`, so
 * it is synthesised here. `useDefaultFlags.settings` is the subtle part: a
 * profile can opt into sharing the *default* profile's settings.json rather
 * than owning one, which is how VSCode's built-in "Agents" profile is set up.
 * Such a profile has no settings file of its own, so anything written for it
 * lands in the default's file, and several profiles can end up pointing at one
 * path.
 *
 * @param {string} userDir - VSCode's `User` directory (parent of settings.json)
 * @param {Object|null} storage - Parsed contents of globalStorage/storage.json
 * @returns {Array<{id: string, name: string, isDefault: boolean, settingsPath: string, sharesDefaultSettings: boolean}>}
 */
function listProfiles(userDir, storage) {
  const defaultSettingsPath = path.join(userDir, 'settings.json');

  const profiles = [{
    id: '__default__',
    name: 'Default',
    isDefault: true,
    settingsPath: defaultSettingsPath,
    sharesDefaultSettings: true,
    // The default profile never narrows the extension set, so there is no
    // per-profile file to consult.
    extensionsPath: null,
  }];

  const entries = Array.isArray(storage?.userDataProfiles) ? storage.userDataProfiles : [];

  for (const entry of entries) {
    const location = entry?.location;
    if (typeof location !== 'string' || location === '') continue;

    // `location` is a directory name under `profiles/`, but it is user-
    // influenced data from a file on disk, so treat it as untrusted: a
    // traversal component or an absolute path would send writes somewhere
    // outside the profile tree entirely.
    const profileDir = path.join(userDir, 'profiles', location);
    const profilesRoot = path.join(userDir, 'profiles');
    if (path.isAbsolute(location) || !isInside(profilesRoot, profileDir)) continue;

    const sharesDefaultSettings = entry?.useDefaultFlags?.settings === true;

    profiles.push({
      id: location,
      name: typeof entry.name === 'string' && entry.name !== '' ? entry.name : location,
      isDefault: false,
      settingsPath: sharesDefaultSettings ? defaultSettingsPath : path.join(profileDir, 'settings.json'),
      sharesDefaultSettings,
      // Only profiles with their own extension set get this file; without it a
      // profile simply uses whatever is installed globally.
      extensionsPath: path.join(profileDir, 'extensions.json'),
    });
  }

  return profiles;
}

/**
 * Is an extension enabled in a profile?
 *
 * Profiles choose which of the globally-installed extensions they enable, and a
 * profile that has made a choice records it in its own `extensions.json`. A
 * profile without that file has not narrowed anything down, so it sees the whole
 * global set — which is why `null` means yes rather than no.
 *
 * This is what separates the two shapes of "copy from profile": copying with
 * extensions gives a profile that carries Vibrancy's colours *and* Vibrancy,
 * which can clean up after itself; copying without them leaves the colours
 * behind with nothing there to remove them.
 *
 * @param {Array|null} extensionList - Parsed extensions.json, or null if absent
 * @param {string} extensionId - e.g. 'illixion.vscode-vibrancy-continued'
 * @returns {boolean}
 */
function profileHasExtension(extensionList, extensionId) {
  if (!Array.isArray(extensionList)) return true;
  return extensionList.some((entry) => entry?.identifier?.id === extensionId);
}

/** Is `child` at or below `parent`? */
function isInside(parent, child) {
  const relative = path.relative(parent, child);
  return relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative);
}

/**
 * Collapse a profile list down to the distinct settings files behind it.
 *
 * Writes have to be keyed by file, not by profile. Two profiles sharing the
 * default's settings.json would otherwise be visited twice, and the second
 * visit would be working from a stale read of what the first one just wrote.
 *
 * A `hasVibrancy` flag on the input profiles is carried through as an OR: if any
 * profile reading a file has Vibrancy, that file's colours can be cleaned up
 * from inside VSCode. It stays undefined when nothing is known either way.
 *
 * @param {Array} profiles - Result of listProfiles, optionally with `hasVibrancy`
 * @returns {Array<{settingsPath: string, profileNames: string[], hasVibrancy: boolean|undefined}>}
 */
function groupBySettingsFile(profiles) {
  const byPath = new Map();

  for (const profile of profiles || []) {
    const existing = byPath.get(profile.settingsPath);
    if (existing) {
      existing.profileNames.push(profile.name);
      if (profile.hasVibrancy !== undefined) {
        existing.hasVibrancy = existing.hasVibrancy || profile.hasVibrancy;
      }
    } else {
      byPath.set(profile.settingsPath, {
        settingsPath: profile.settingsPath,
        profileNames: [profile.name],
        hasVibrancy: profile.hasVibrancy,
      });
    }
  }

  return [...byPath.values()];
}

/**
 * Which profile does an extension host belong to?
 *
 * Extension global storage is profile-scoped — `<User>/globalStorage/<ext>` for
 * the default profile, `<User>/profiles/<id>/globalStorage/<ext>` otherwise —
 * so the directory two levels up names the profile.
 *
 * This is what `getEditorSettingsPath` could not do. That function always
 * returned the *default* profile's settings.json, so every install performed
 * from a named profile recorded the wrong file for the uninstall hook to clean:
 * the hook stripped colour keys out of the default profile (which may never
 * have had any) while leaving the real ones in place.
 *
 * @param {Array} profiles - Result of listProfiles
 * @param {string} globalStoragePath - `context.globalStorageUri.fsPath`
 * @returns {Object|null} the matching profile, or null when it can't be matched
 */
function findProfileByGlobalStorage(profiles, globalStoragePath) {
  if (typeof globalStoragePath !== 'string' || globalStoragePath === '') return null;

  const profileDir = path.dirname(path.dirname(globalStoragePath));
  if (!profileDir || profileDir === path.dirname(profileDir)) return null;

  const dirName = path.basename(profileDir);
  const parentName = path.basename(path.dirname(profileDir));

  for (const profile of profiles || []) {
    if (profile.isDefault) continue;
    // `id` can itself contain a separator ("builtin/agents"), so compare the
    // trailing path segments rather than just the directory name.
    const segments = profile.id.split(/[\\/]/).filter(Boolean);
    if (segments.length > 1) {
      if (segments[segments.length - 1] === dirName && segments[segments.length - 2] === parentName) {
        return profile;
      }
    } else if (segments[0] === dirName) {
      return profile;
    }
  }

  // `<User>/globalStorage/<ext>` — the default profile's own storage.
  const defaultProfile = (profiles || []).find((profile) => profile.isDefault);
  if (defaultProfile && path.join(profileDir, 'settings.json') === defaultProfile.settingsPath) {
    return defaultProfile;
  }

  return null;
}

module.exports = {
  listProfiles,
  groupBySettingsFile,
  findProfileByGlobalStorage,
  profileHasExtension,
};
