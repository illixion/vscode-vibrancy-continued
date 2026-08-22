const path = require('path');
const {
  listProfiles,
  groupBySettingsFile,
  findProfileByGlobalStorage,
  profileHasExtension,
} = require('../../extension/profile-registry');

const USER = path.join('/Users/x/Library/Application Support/Code/User');

// Shape taken verbatim from a real globalStorage/storage.json: the built-in
// "Agents" profile shares the default's settings, a user-created one does not,
// and the default profile is not listed at all.
const STORAGE = {
  userDataProfiles: [
    {
      location: 'builtin/agents',
      name: 'Agents',
      useDefaultFlags: { settings: true, extensions: true },
    },
    { location: '-5a4fcfb6', name: 'ClaudeTest', icon: 'vr' },
  ],
};

describe('listProfiles', () => {
  it('synthesises the default profile, which the registry never lists', () => {
    const [first] = listProfiles(USER, STORAGE);

    expect(first).toEqual({
      id: '__default__',
      name: 'Default',
      isDefault: true,
      settingsPath: path.join(USER, 'settings.json'),
      sharesDefaultSettings: true,
      extensionsPath: null,
    });
  });

  it('points a useDefaultFlags.settings profile at the default settings file', () => {
    const agents = listProfiles(USER, STORAGE).find((p) => p.name === 'Agents');

    expect(agents.sharesDefaultSettings).toBe(true);
    expect(agents.settingsPath).toBe(path.join(USER, 'settings.json'));
  });

  it('gives an ordinary profile its own settings file', () => {
    const claudeTest = listProfiles(USER, STORAGE).find((p) => p.name === 'ClaudeTest');

    expect(claudeTest.sharesDefaultSettings).toBe(false);
    expect(claudeTest.settingsPath).toBe(path.join(USER, 'profiles', '-5a4fcfb6', 'settings.json'));
  });

  it('copes with a missing or unusable registry', () => {
    for (const storage of [null, undefined, {}, { userDataProfiles: 'nope' }]) {
      const profiles = listProfiles(USER, storage);
      expect(profiles).toHaveLength(1);
      expect(profiles[0].isDefault).toBe(true);
    }
  });

  it('refuses locations that would escape the profiles directory', () => {
    // storage.json is a file on disk; a traversal component in `location` would
    // otherwise aim writes at an arbitrary path.
    const profiles = listProfiles(USER, {
      userDataProfiles: [
        { location: '../../../../etc', name: 'Escape' },
        { location: '/tmp/absolute', name: 'Absolute' },
        { location: '', name: 'Empty' },
        { location: 'ok', name: 'Fine' },
      ],
    });

    expect(profiles.map((p) => p.name)).toEqual(['Default', 'Fine']);
  });

  it('falls back to the location when a profile has no name', () => {
    const [, unnamed] = listProfiles(USER, { userDataProfiles: [{ location: 'abc123' }] });
    expect(unnamed.name).toBe('abc123');
  });
});

describe('groupBySettingsFile', () => {
  it('collapses profiles that share one file into a single target', () => {
    const targets = groupBySettingsFile(listProfiles(USER, STORAGE));

    // Default + Agents share one file; ClaudeTest has its own.
    expect(targets).toHaveLength(2);
    const shared = targets.find((t) => t.settingsPath === path.join(USER, 'settings.json'));
    expect(shared.profileNames).toEqual(['Default', 'Agents']);
  });

  it('is empty for an empty list', () => {
    expect(groupBySettingsFile([])).toEqual([]);
    expect(groupBySettingsFile(null)).toEqual([]);
  });
});

describe('findProfileByGlobalStorage', () => {
  const profiles = listProfiles(USER, STORAGE);

  it('matches the default profile from its global storage path', () => {
    const found = findProfileByGlobalStorage(
      profiles,
      path.join(USER, 'globalStorage', 'illixion.vscode-vibrancy-continued'),
    );

    expect(found.isDefault).toBe(true);
    expect(found.settingsPath).toBe(path.join(USER, 'settings.json'));
  });

  it('matches a named profile, giving the settings path the hook must clean', () => {
    // getEditorSettingsPath always returned the *default* file, so an install
    // performed here recorded the wrong path and the real colour customizations
    // were never reverted.
    const found = findProfileByGlobalStorage(
      profiles,
      path.join(USER, 'profiles', '-5a4fcfb6', 'globalStorage', 'illixion.vscode-vibrancy-continued'),
    );

    expect(found.name).toBe('ClaudeTest');
    expect(found.settingsPath).toBe(path.join(USER, 'profiles', '-5a4fcfb6', 'settings.json'));
  });

  it('matches a nested location without confusing it for a top-level one', () => {
    const found = findProfileByGlobalStorage(
      profiles,
      path.join(USER, 'profiles', 'builtin', 'agents', 'globalStorage', 'illixion.vscode-vibrancy-continued'),
    );

    expect(found.name).toBe('Agents');
    // Shares the default's settings file, so that is what gets cleaned.
    expect(found.settingsPath).toBe(path.join(USER, 'settings.json'));
  });

  it('returns null rather than guessing when nothing matches', () => {
    expect(findProfileByGlobalStorage(profiles, '/somewhere/else/globalStorage/ext')).toBeNull();
    for (const value of [undefined, null, '', '/']) {
      expect(findProfileByGlobalStorage(profiles, value)).toBeNull();
    }
  });
});

describe('profileHasExtension', () => {
  const VIBRANCY = 'illixion.vscode-vibrancy-continued';

  it('finds an extension in a profile that narrows its set', () => {
    expect(profileHasExtension([
      { identifier: { id: 'other.thing' } },
      { identifier: { id: VIBRANCY }, version: '1.1.92' },
    ], VIBRANCY)).toBe(true);
  });

  it('reports absence when the profile has a set that excludes it', () => {
    // "Copy from profile" without extensions: settings came across, Vibrancy
    // did not, so nothing there can clean up the copied colours.
    expect(profileHasExtension([{ identifier: { id: 'other.thing' } }], VIBRANCY)).toBe(false);
  });

  it('treats a missing extensions.json as "uses everything installed"', () => {
    // A profile only writes that file once it has narrowed the set, so its
    // absence means the global set applies — not that nothing is installed.
    expect(profileHasExtension(null, VIBRANCY)).toBe(true);
    expect(profileHasExtension(undefined, VIBRANCY)).toBe(true);
    expect(profileHasExtension('not an array', VIBRANCY)).toBe(true);
  });

  it('is not confused by malformed entries', () => {
    expect(profileHasExtension([null, {}, { identifier: null }], VIBRANCY)).toBe(false);
  });
});

describe('per-profile extension list location', () => {
  it('points each named profile at its own extensions.json', () => {
    const claudeTest = listProfiles(USER, STORAGE).find((p) => p.name === 'ClaudeTest');
    expect(claudeTest.extensionsPath).toBe(path.join(USER, 'profiles', '-5a4fcfb6', 'extensions.json'));
  });
});
