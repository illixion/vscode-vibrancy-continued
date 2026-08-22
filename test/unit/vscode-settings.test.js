const { applySettings, restoreSettings } = require('../../extension/vscode-settings');
const { ALL_VIBRANCY_BG_KEYS } = require('../../extension/file-transforms');

/**
 * Create a mock settings store backed by a plain object.
 * `inspect(key)` returns `{ globalValue }` and `update(key, value)` writes it.
 */
function createSettingsStore(initial = {}) {
  const data = { ...initial };
  return {
    data,
    inspect(key) {
      return { globalValue: data[key] };
    },
    async update(key, value) {
      if (value === undefined) {
        delete data[key];
      } else {
        data[key] = value;
      }
    },
  };
}

/** Create a mock globalState backed by a plain object. */
function createGlobalState(initial = {}) {
  const data = { ...initial };
  return {
    data,
    get(key) { return data[key]; },
    async update(key, value) { data[key] = value; },
  };
}

/** Default theme config matching "Default Dark" */
const defaultThemeConfig = {
  background: '1e1e1e',
  opacity: { win10: 0.8, macos: 0.3, linux: 0.8 },
  systemColorTheme: 'dark',
};

/** Build default deps for applySettings, with overrides */
function buildApplyDeps(overrides = {}) {
  return {
    settingsStore: createSettingsStore(),
    globalState: createGlobalState(),
    themeConfig: defaultThemeConfig,
    enableAutoTheme: false,
    disableColorCustomizations: false,
    opacity: 0.5,
    themeBackground: '1e1e1e',
    showInfo: () => {},
    localize: (key) => key,
    ...overrides,
  };
}

// --- applySettings ---

describe('applySettings', () => {
  it('writes vibrancy color customizations when disableColorCustomizations is false', async () => {
    const store = createSettingsStore();
    const deps = buildApplyDeps({ settingsStore: store });

    await applySettings(deps);

    const colors = store.data['workbench.colorCustomizations'];
    expect(colors).toBeDefined();
    expect(colors['terminal.background']).toBe('#00000000');
    // Should have all vibrancy bg keys set
    for (const key of ALL_VIBRANCY_BG_KEYS) {
      expect(colors[key]).toBeDefined();
    }
  });

  it('sets gpuAcceleration to off', async () => {
    const store = createSettingsStore();
    const deps = buildApplyDeps({ settingsStore: store });

    await applySettings(deps);

    expect(store.data['terminal.integrated.gpuAcceleration']).toBe('off');
  });

  it('sets auto theme settings when enableAutoTheme is false', async () => {
    const store = createSettingsStore();
    const deps = buildApplyDeps({ settingsStore: store, enableAutoTheme: false });

    await applySettings(deps);

    expect(store.data['window.systemColorTheme']).toBe('dark');
    expect(store.data['window.autoDetectColorScheme']).toBe(false);
  });

  it('sets auto theme settings when enableAutoTheme is true', async () => {
    const store = createSettingsStore();
    const deps = buildApplyDeps({ settingsStore: store, enableAutoTheme: true });

    await applySettings(deps);

    expect(store.data['window.autoDetectColorScheme']).toBe(true);
    expect(store.data['window.systemColorTheme']).toBeUndefined();
  });

  it('backs up original values on first run', async () => {
    const store = createSettingsStore({
      'terminal.integrated.gpuAcceleration': 'auto',
      'window.systemColorTheme': 'light',
      'window.autoDetectColorScheme': false,
      'workbench.colorCustomizations': {
        'terminal.background': '#1a1b26',
        'statusBar.background': '#007acc',
      },
    });
    const globalState = createGlobalState();
    const deps = buildApplyDeps({ settingsStore: store, globalState });

    const result = await applySettings(deps);

    expect(result.saved).toBe(true);
    expect(result.terminalBackground).toBe('#1a1b26');
    expect(result.gpuAcceleration).toBe('auto');
    expect(result.systemColorTheme).toBe('light');
    expect(result.autoDetectColorScheme).toBe(false);
    expect(result.vibrancyBackgrounds).toBeDefined();
  });

  it('preserves user non-vibrancy color customizations', async () => {
    const store = createSettingsStore({
      'workbench.colorCustomizations': {
        'statusBar.background': '#007acc',
        'titleBar.activeBackground': '#ff0000',
      },
    });
    const deps = buildApplyDeps({ settingsStore: store });

    await applySettings(deps);

    const colors = store.data['workbench.colorCustomizations'];
    expect(colors['statusBar.background']).toBe('#007acc');
    expect(colors['titleBar.activeBackground']).toBe('#ff0000');
  });

  it('does not overwrite backup on subsequent runs', async () => {
    const globalState = createGlobalState({
      customizations: {
        saved: true,
        terminalBackground: '#original',
        vibrancyBackgrounds: {},
        gpuAcceleration: 'auto',
        removedFromApplyToAllProfiles: true,
        systemColorTheme: 'light',
        autoDetectColorScheme: false,
      },
    });
    const store = createSettingsStore({
      'terminal.integrated.gpuAcceleration': 'off',
      'workbench.colorCustomizations': { 'terminal.background': '#00000000' },
    });
    const deps = buildApplyDeps({ settingsStore: store, globalState });

    const result = await applySettings(deps);

    // Original backup should be preserved, not overwritten with current vibrancy values
    expect(result.terminalBackground).toBe('#original');
    expect(result.gpuAcceleration).toBe('auto');
  });

  it('removes colorCustomizations from applyToAllProfiles', async () => {
    const store = createSettingsStore({
      'workbench.settings.applyToAllProfiles': [
        'editor.fontSize',
        'workbench.colorCustomizations',
        'terminal.integrated.gpuAcceleration',
      ],
    });
    const messages = [];
    const deps = buildApplyDeps({
      settingsStore: store,
      showInfo: (msg) => messages.push(msg),
    });

    await applySettings(deps);

    const profiles = store.data['workbench.settings.applyToAllProfiles'];
    expect(profiles).not.toContain('workbench.colorCustomizations');
    expect(profiles).toContain('editor.fontSize');
    expect(messages.length).toBe(1);
  });
});

// --- applySettings reinstall poisoning protection (issue #247) ---

/** Build a settings.json snapshot that looks like vibrancy was already applied. */
function buildPoisonedColorCustomizations(themeBackground = '1e1e1e') {
  const colors = { 'terminal.background': '#00000000' };
  for (const key of ALL_VIBRANCY_BG_KEYS) {
    // Mix of vibrancy alphas: 00 (transparent), bf (semi), e6 (opaque-ish)
    colors[key] = `#${themeBackground}bf`;
  }
  return colors;
}

describe('applySettings reinstall poisoning protection (issue #247)', () => {
  it('drops vibrancy-shape values to null when taking the initial backup', async () => {
    const store = createSettingsStore({
      'workbench.colorCustomizations': buildPoisonedColorCustomizations('1e1e1e'),
    });
    const globalState = createGlobalState();
    const deps = buildApplyDeps({ settingsStore: store, globalState });

    const result = await applySettings(deps);

    expect(result.saved).toBe(true);
    expect(result.terminalBackground).toBeNull();
    for (const key of ALL_VIBRANCY_BG_KEYS) {
      expect(result.vibrancyBackgrounds[key]).toBeNull();
    }
  });

  it('preserves genuine 6-char user values in the initial backup', async () => {
    const store = createSettingsStore({
      'workbench.colorCustomizations': {
        'terminal.background': '#1a1b26',
        'sideBar.background': '#282c34',
        'editor.background': '#1d1f21',
      },
    });
    const globalState = createGlobalState();
    const deps = buildApplyDeps({ settingsStore: store, globalState });

    const result = await applySettings(deps);

    expect(result.terminalBackground).toBe('#1a1b26');
    expect(result.vibrancyBackgrounds['sideBar.background']).toBe('#282c34');
    expect(result.vibrancyBackgrounds['editor.background']).toBe('#1d1f21');
  });

  it('disable after reinstall removes all vibrancy keys (no resurrection)', async () => {
    const store = createSettingsStore({
      'workbench.colorCustomizations': buildPoisonedColorCustomizations('1e1e1e'),
    });
    const globalState = createGlobalState();

    // Step 1: reinstall path — applySettings runs against poisoned settings
    await applySettings(buildApplyDeps({ settingsStore: store, globalState }));

    // Step 2: user runs Disable — restoreSettings should leave settings clean
    await restoreSettings({
      settingsStore: store,
      globalState,
      disableColorCustomizations: false,
    });

    const colors = store.data['workbench.colorCustomizations'] || {};
    expect(colors['terminal.background']).toBeUndefined();
    for (const key of ALL_VIBRANCY_BG_KEYS) {
      expect(colors[key]).toBeUndefined();
    }
  });

  it('with mixed user-set and poisoned values, only the user value is preserved', async () => {
    const poisoned = buildPoisonedColorCustomizations('1e1e1e');
    poisoned['sideBar.background'] = '#282c34'; // legitimate user value
    const store = createSettingsStore({
      'workbench.colorCustomizations': poisoned,
    });
    const globalState = createGlobalState();
    const deps = buildApplyDeps({ settingsStore: store, globalState });

    const result = await applySettings(deps);

    expect(result.vibrancyBackgrounds['sideBar.background']).toBe('#282c34');
    for (const key of ALL_VIBRANCY_BG_KEYS) {
      if (key === 'sideBar.background') continue;
      expect(result.vibrancyBackgrounds[key]).toBeNull();
    }
  });
});

// --- applySettings with disableColorCustomizations ---

describe('applySettings with disableColorCustomizations', () => {
  it('does not write color customizations when setting is enabled', async () => {
    const store = createSettingsStore();
    const deps = buildApplyDeps({
      settingsStore: store,
      disableColorCustomizations: true,
    });

    await applySettings(deps);

    expect(store.data['workbench.colorCustomizations']).toBeUndefined();
  });

  it('still sets gpuAcceleration when color customizations are disabled', async () => {
    const store = createSettingsStore();
    const deps = buildApplyDeps({
      settingsStore: store,
      disableColorCustomizations: true,
    });

    await applySettings(deps);

    expect(store.data['terminal.integrated.gpuAcceleration']).toBe('off');
  });

  it('still sets auto theme settings when color customizations are disabled', async () => {
    const store = createSettingsStore();
    const deps = buildApplyDeps({
      settingsStore: store,
      disableColorCustomizations: true,
      enableAutoTheme: false,
    });

    await applySettings(deps);

    expect(store.data['window.systemColorTheme']).toBe('dark');
    expect(store.data['window.autoDetectColorScheme']).toBe(false);
  });

  it('restores previous color customizations when setting is enabled mid-session', async () => {
    // Simulate: vibrancy was previously installed with colors
    const vibrancyColors = {};
    for (const key of ALL_VIBRANCY_BG_KEYS) {
      vibrancyColors[key] = '#1e1e1ecc';
    }

    const store = createSettingsStore({
      'workbench.colorCustomizations': {
        'terminal.background': '#00000000',
        'statusBar.background': '#007acc', // user's own customization
        ...vibrancyColors,
      },
    });

    const globalState = createGlobalState({
      customizations: {
        saved: true,
        terminalBackground: '#1a1b26',
        vibrancyBackgrounds: {
          'sideBar.background': '#282c34', // user had a custom sidebar color
        },
        gpuAcceleration: 'auto',
        removedFromApplyToAllProfiles: true,
        systemColorTheme: 'light',
        autoDetectColorScheme: false,
      },
    });

    const deps = buildApplyDeps({
      settingsStore: store,
      globalState,
      disableColorCustomizations: true,
    });

    const result = await applySettings(deps);

    const colors = store.data['workbench.colorCustomizations'];
    // terminal.background should be restored to original
    expect(colors['terminal.background']).toBe('#1a1b26');
    // User's non-vibrancy customization preserved
    expect(colors['statusBar.background']).toBe('#007acc');
    // User's original sidebar color restored
    expect(colors['sideBar.background']).toBe('#282c34');
    // Other vibrancy keys should be removed (original was null/undefined)
    for (const key of ALL_VIBRANCY_BG_KEYS) {
      if (key !== 'sideBar.background') {
        expect(colors[key]).toBeUndefined();
      }
    }
    // Color backup should be cleared from saved state
    expect(result.vibrancyBackgrounds).toBeUndefined();
    expect(result.terminalBackground).toBeUndefined();
  });

  it('removes transparent terminal.background when no original was saved', async () => {
    const store = createSettingsStore({
      'workbench.colorCustomizations': {
        'terminal.background': '#00000000',
      },
    });

    const globalState = createGlobalState({
      customizations: {
        saved: true,
        terminalBackground: null,
        vibrancyBackgrounds: {},
        gpuAcceleration: 'auto',
        removedFromApplyToAllProfiles: true,
      },
    });

    const deps = buildApplyDeps({
      settingsStore: store,
      globalState,
      disableColorCustomizations: true,
    });

    await applySettings(deps);

    const colors = store.data['workbench.colorCustomizations'];
    expect(colors['terminal.background']).toBeUndefined();
  });

  it('does not touch colorCustomizations if no previous backup exists', async () => {
    const store = createSettingsStore({
      'workbench.colorCustomizations': {
        'statusBar.background': '#007acc',
      },
    });
    const globalState = createGlobalState();
    const deps = buildApplyDeps({
      settingsStore: store,
      globalState,
      disableColorCustomizations: true,
    });

    await applySettings(deps);

    // User's customizations should remain untouched
    const colors = store.data['workbench.colorCustomizations'];
    expect(colors['statusBar.background']).toBe('#007acc');
  });

  it('saves non-color backup even when color customizations are disabled', async () => {
    const store = createSettingsStore({
      'terminal.integrated.gpuAcceleration': 'auto',
      'window.systemColorTheme': 'light',
    });
    const globalState = createGlobalState();
    const deps = buildApplyDeps({
      settingsStore: store,
      globalState,
      disableColorCustomizations: true,
    });

    const result = await applySettings(deps);

    expect(result.saved).toBe(true);
    expect(result.gpuAcceleration).toBe('auto');
    expect(result.systemColorTheme).toBe('light');
    expect(result.vibrancyBackgrounds).toBeUndefined();
  });
});

// --- restoreSettings ---

describe('restoreSettings', () => {
  it('restores color customizations on uninstall', async () => {
    const vibrancyColors = {};
    for (const key of ALL_VIBRANCY_BG_KEYS) {
      vibrancyColors[key] = '#1e1e1ecc';
    }

    const store = createSettingsStore({
      'workbench.colorCustomizations': {
        'terminal.background': '#00000000',
        'statusBar.background': '#007acc',
        ...vibrancyColors,
      },
      'terminal.integrated.gpuAcceleration': 'off',
      'window.systemColorTheme': 'dark',
      'window.autoDetectColorScheme': true,
    });

    const globalState = createGlobalState({
      customizations: {
        saved: true,
        terminalBackground: '#1a1b26',
        vibrancyBackgrounds: { 'sideBar.background': '#282c34' },
        gpuAcceleration: 'auto',
        systemColorTheme: 'light',
        autoDetectColorScheme: false,
        removedFromApplyToAllProfiles: true,
      },
    });

    await restoreSettings({
      settingsStore: store,
      globalState,
      disableColorCustomizations: false,
    });

    const colors = store.data['workbench.colorCustomizations'];
    expect(colors['terminal.background']).toBe('#1a1b26');
    expect(colors['statusBar.background']).toBe('#007acc');
    expect(colors['sideBar.background']).toBe('#282c34');
    // Other vibrancy keys removed
    for (const key of ALL_VIBRANCY_BG_KEYS) {
      if (key !== 'sideBar.background') {
        expect(colors[key]).toBeUndefined();
      }
    }
    expect(store.data['terminal.integrated.gpuAcceleration']).toBe('auto');
    expect(store.data['window.systemColorTheme']).toBe('light');
    expect(store.data['window.autoDetectColorScheme']).toBe(false);
  });

  it('skips color customizations restore when disableColorCustomizations is true', async () => {
    // No colour backup means vibrancy never wrote any colours, so whatever is
    // in settings.json belongs to the user and must be left exactly as-is.
    // (When a backup *does* survive, vibrancy has outstanding writes and has to
    // clean them up regardless of this setting — see the lifecycle tests below.)
    const userColors = {
      'editor.background': '#123456',
      'sideBar.background': '#abcdef',
      'terminal.background': '#1a1b26',
    };

    const store = createSettingsStore({
      'workbench.colorCustomizations': { ...userColors },
      'terminal.integrated.gpuAcceleration': 'off',
    });

    const globalState = createGlobalState({
      customizations: {
        saved: true,
        gpuAcceleration: 'auto',
        removedFromApplyToAllProfiles: true,
      },
    });

    await restoreSettings({
      settingsStore: store,
      globalState,
      disableColorCustomizations: true,
    });

    // Color customizations should NOT have been touched
    expect(store.data['workbench.colorCustomizations']).toEqual(userColors);
    // But non-color settings should still be restored
    expect(store.data['terminal.integrated.gpuAcceleration']).toBe('auto');
  });

  it('clears saved state but preserves removedFromApplyToAllProfiles flag', async () => {
    const globalState = createGlobalState({
      customizations: {
        saved: true,
        terminalBackground: null,
        vibrancyBackgrounds: {},
        gpuAcceleration: null,
        removedFromApplyToAllProfiles: true,
      },
    });

    await restoreSettings({
      settingsStore: createSettingsStore({
        'workbench.colorCustomizations': {},
      }),
      globalState,
      disableColorCustomizations: false,
    });

    const state = globalState.data.customizations;
    expect(state.removedFromApplyToAllProfiles).toBe(true);
    expect(state.saved).toBeUndefined();
  });

  it('handles null previousCustomizations gracefully', async () => {
    const store = createSettingsStore({
      'workbench.colorCustomizations': {
        'terminal.background': '#00000000',
        'editor.background': '#1e1e1ecc',
      },
    });

    await restoreSettings({
      settingsStore: store,
      globalState: createGlobalState(),
      disableColorCustomizations: false,
    });

    const colors = store.data['workbench.colorCustomizations'];
    // Vibrancy transparent terminal.background should be removed
    expect(colors['terminal.background']).toBeUndefined();
    // Vibrancy bg keys should be removed
    expect(colors['editor.background']).toBeUndefined();
  });
});

// --- Full round-trip scenarios ---

describe('full round-trip', () => {
  it('install then uninstall restores original settings', async () => {
    const originalSettings = {
      'workbench.colorCustomizations': {
        'statusBar.background': '#007acc',
        'terminal.background': '#1a1b26',
      },
      'terminal.integrated.gpuAcceleration': 'auto',
      'window.systemColorTheme': 'light',
      'window.autoDetectColorScheme': false,
    };

    const store = createSettingsStore({ ...originalSettings });
    const globalState = createGlobalState();

    // Install
    await applySettings(buildApplyDeps({
      settingsStore: store,
      globalState,
    }));

    // Verify vibrancy was applied
    expect(store.data['workbench.colorCustomizations']['terminal.background']).toBe('#00000000');
    expect(store.data['terminal.integrated.gpuAcceleration']).toBe('off');

    // Uninstall
    await restoreSettings({
      settingsStore: store,
      globalState,
      disableColorCustomizations: false,
    });

    // Verify originals restored
    expect(store.data['workbench.colorCustomizations']['statusBar.background']).toBe('#007acc');
    expect(store.data['workbench.colorCustomizations']['terminal.background']).toBe('#1a1b26');
    expect(store.data['terminal.integrated.gpuAcceleration']).toBe('auto');
    expect(store.data['window.systemColorTheme']).toBe('light');
    expect(store.data['window.autoDetectColorScheme']).toBe(false);
    // Vibrancy keys should be gone
    for (const key of ALL_VIBRANCY_BG_KEYS) {
      expect(store.data['workbench.colorCustomizations'][key]).toBeUndefined();
    }
  });

  it('install then disable colorCustomizations then reload restores colors', async () => {
    const store = createSettingsStore({
      'workbench.colorCustomizations': {
        'statusBar.background': '#007acc',
        'sideBar.background': '#282c34',
      },
      'terminal.integrated.gpuAcceleration': 'auto',
    });
    const globalState = createGlobalState();

    // Step 1: Install with color customizations enabled
    await applySettings(buildApplyDeps({
      settingsStore: store,
      globalState,
    }));

    // Verify vibrancy colors were written
    const colorsAfterInstall = store.data['workbench.colorCustomizations'];
    expect(colorsAfterInstall['terminal.background']).toBe('#00000000');
    expect(colorsAfterInstall['sideBar.background']).toBeDefined();
    expect(colorsAfterInstall['sideBar.background']).not.toBe('#282c34'); // overwritten by vibrancy

    // Step 2: User enables disableColorCustomizations and reloads
    await applySettings(buildApplyDeps({
      settingsStore: store,
      globalState,
      disableColorCustomizations: true,
    }));

    // Verify colors were restored
    const colorsAfterDisable = store.data['workbench.colorCustomizations'];
    expect(colorsAfterDisable['statusBar.background']).toBe('#007acc');
    expect(colorsAfterDisable['sideBar.background']).toBe('#282c34');
    expect(colorsAfterDisable['terminal.background']).toBeUndefined();
    // All vibrancy keys should be cleaned up
    for (const key of ALL_VIBRANCY_BG_KEYS) {
      if (key !== 'sideBar.background') {
        expect(colorsAfterDisable[key]).toBeUndefined();
      }
    }

    // Non-color settings should still be managed
    expect(store.data['terminal.integrated.gpuAcceleration']).toBe('off');
  });

  it('install with disableColorCustomizations from the start skips colors entirely', async () => {
    const store = createSettingsStore({
      'workbench.colorCustomizations': {
        'statusBar.background': '#007acc',
      },
    });
    const globalState = createGlobalState();

    await applySettings(buildApplyDeps({
      settingsStore: store,
      globalState,
      disableColorCustomizations: true,
    }));

    // Color customizations should be untouched
    const colors = store.data['workbench.colorCustomizations'];
    expect(colors['statusBar.background']).toBe('#007acc');
    expect(colors['terminal.background']).toBeUndefined();
    for (const key of ALL_VIBRANCY_BG_KEYS) {
      expect(colors[key]).toBeUndefined();
    }

    // gpuAcceleration should still be managed
    expect(store.data['terminal.integrated.gpuAcceleration']).toBe('off');
  });

  it('multiple reloads with disableColorCustomizations do not corrupt state', async () => {
    const store = createSettingsStore({
      'workbench.colorCustomizations': { 'statusBar.background': '#007acc' },
    });
    const globalState = createGlobalState();

    // Install
    await applySettings(buildApplyDeps({ settingsStore: store, globalState }));

    // Disable and reload 3 times
    for (let i = 0; i < 3; i++) {
      await applySettings(buildApplyDeps({
        settingsStore: store,
        globalState,
        disableColorCustomizations: true,
      }));
    }

    const colors = store.data['workbench.colorCustomizations'];
    expect(colors['statusBar.background']).toBe('#007acc');
    // No vibrancy keys should be present
    for (const key of ALL_VIBRANCY_BG_KEYS) {
      expect(colors[key]).toBeUndefined();
    }
  });
});

// --- theme colorCustomizations enrichment ---

describe('applySettings with a theme colorCustomizations block', () => {
  /** "Only Subbar"-style theme: editor region handed back to the color theme */
  const subbarThemeConfig = {
    ...defaultThemeConfig,
    colorCustomizations: {
      'editor.background': null,
      'panel.background': null,
      'terminal.background': null,
      'statusBar.background': 1,
    },
  };

  it('does not write keys the theme opts out of', async () => {
    const store = createSettingsStore();
    await applySettings(buildApplyDeps({ settingsStore: store, themeConfig: subbarThemeConfig }));

    const colors = store.data['workbench.colorCustomizations'];
    expect(colors).not.toHaveProperty('editor.background');
    expect(colors).not.toHaveProperty('panel.background');
    // Sidebar vibrancy is untouched by the opt-outs
    expect(colors['sideBar.background']).toBe('#1e1e1e80');
  });

  it('lets a theme opt out of the forced transparent terminal background', async () => {
    const store = createSettingsStore();
    await applySettings(buildApplyDeps({ settingsStore: store, themeConfig: subbarThemeConfig }));

    expect(store.data['workbench.colorCustomizations']).not.toHaveProperty('terminal.background');
  });

  it('still forces the transparent terminal background for a theme that stays quiet', async () => {
    const store = createSettingsStore();
    await applySettings(buildApplyDeps({ settingsStore: store }));

    expect(store.data['workbench.colorCustomizations']['terminal.background']).toBe('#00000000');
  });

  it('writes a theme-introduced key outside the built-in tiers', async () => {
    const store = createSettingsStore();
    await applySettings(buildApplyDeps({ settingsStore: store, themeConfig: subbarThemeConfig }));

    expect(store.data['workbench.colorCustomizations']['statusBar.background']).toBe('#1e1e1eff');
  });

  it('restores the user own value for an opted-out key instead of dropping it', async () => {
    const store = createSettingsStore({
      'workbench.colorCustomizations': {
        'editor.background': '#123456',
        'terminal.background': '#654321',
      },
    });

    await applySettings(buildApplyDeps({ settingsStore: store, themeConfig: subbarThemeConfig }));

    const colors = store.data['workbench.colorCustomizations'];
    expect(colors['editor.background']).toBe('#123456');
    expect(colors['terminal.background']).toBe('#654321');
  });

  it('backs up a theme-introduced key so disable can clean it up', async () => {
    const store = createSettingsStore({
      'workbench.colorCustomizations': { 'statusBar.background': '#abcdef' },
    });
    const globalState = createGlobalState();

    await applySettings(buildApplyDeps({ settingsStore: store, globalState, themeConfig: subbarThemeConfig }));

    expect(globalState.data.customizations.vibrancyBackgrounds['statusBar.background']).toBe('#abcdef');

    await restoreSettings({ settingsStore: store, globalState, disableColorCustomizations: false });

    expect(store.data['workbench.colorCustomizations']['statusBar.background']).toBe('#abcdef');
  });

  it('removes a theme-introduced key on disable when the user had none', async () => {
    const store = createSettingsStore();
    const globalState = createGlobalState();

    await applySettings(buildApplyDeps({ settingsStore: store, globalState, themeConfig: subbarThemeConfig }));
    expect(store.data['workbench.colorCustomizations']).toHaveProperty('statusBar.background');

    await restoreSettings({ settingsStore: store, globalState, disableColorCustomizations: false });
    expect(store.data['workbench.colorCustomizations']).not.toHaveProperty('statusBar.background');
  });

  it('backfills a key when switching to a theme that reaches further than the first one', async () => {
    const store = createSettingsStore({
      'workbench.colorCustomizations': { 'statusBar.background': '#abcdef' },
    });
    const globalState = createGlobalState();

    // First install with a theme that never touches statusBar.background
    await applySettings(buildApplyDeps({ settingsStore: store, globalState }));
    expect(globalState.data.customizations.vibrancyBackgrounds)
      .not.toHaveProperty('statusBar.background');

    // Switching themes must capture the still-pristine user value
    await applySettings(buildApplyDeps({ settingsStore: store, globalState, themeConfig: subbarThemeConfig }));
    expect(globalState.data.customizations.vibrancyBackgrounds['statusBar.background']).toBe('#abcdef');

    await restoreSettings({ settingsStore: store, globalState, disableColorCustomizations: false });
    expect(store.data['workbench.colorCustomizations']['statusBar.background']).toBe('#abcdef');
  });

  it('does not treat its own previous output as a user value when backfilling', async () => {
    const store = createSettingsStore();
    const globalState = createGlobalState();

    await applySettings(buildApplyDeps({ settingsStore: store, globalState }));
    // Vibrancy wrote its own value for this key under the first theme
    store.data['workbench.colorCustomizations']['statusBar.background'] = '#1e1e1e80';

    await applySettings(buildApplyDeps({ settingsStore: store, globalState, themeConfig: subbarThemeConfig }));

    expect(globalState.data.customizations.vibrancyBackgrounds['statusBar.background']).toBeNull();
  });

  it('re-applies vibrancy to a key when switching back to a theme that manages it', async () => {
    const store = createSettingsStore();
    const globalState = createGlobalState();

    await applySettings(buildApplyDeps({ settingsStore: store, globalState, themeConfig: subbarThemeConfig }));
    expect(store.data['workbench.colorCustomizations']).not.toHaveProperty('editor.background');

    await applySettings(buildApplyDeps({ settingsStore: store, globalState }));
    expect(store.data['workbench.colorCustomizations']['editor.background']).toBe('#1e1e1e80');
  });

  it('cleans up theme-introduced keys when disableColorCustomizations is turned on', async () => {
    const store = createSettingsStore();
    const globalState = createGlobalState();

    await applySettings(buildApplyDeps({ settingsStore: store, globalState, themeConfig: subbarThemeConfig }));
    expect(store.data['workbench.colorCustomizations']).toHaveProperty('statusBar.background');

    await applySettings(buildApplyDeps({
      settingsStore: store,
      globalState,
      themeConfig: subbarThemeConfig,
      disableColorCustomizations: true,
    }));

    expect(store.data['workbench.colorCustomizations']).not.toHaveProperty('statusBar.background');
  });
});

// --- disableColorCustomizations lifecycle (settings-corruption regressions) ---

describe('disableColorCustomizations lifecycle', () => {
  const userColors = { 'editor.background': '#123456', 'sideBar.background': '#abcdef' };

  it('survives the setting being toggled on and then off again', async () => {
    // Regression: the colour backup was dropped when the setting went on and
    // never re-taken when it went off, so the next disable deleted the user's
    // own colours instead of restoring them.
    const store = createSettingsStore({ 'workbench.colorCustomizations': { ...userColors } });
    const globalState = createGlobalState();

    await applySettings(buildApplyDeps({ settingsStore: store, globalState }));
    await applySettings(buildApplyDeps({ settingsStore: store, globalState, disableColorCustomizations: true }));

    // Colours handed back while the setting is on
    expect(store.data['workbench.colorCustomizations']['editor.background']).toBe('#123456');

    await applySettings(buildApplyDeps({ settingsStore: store, globalState, disableColorCustomizations: false }));

    // Vibrancy applies again, and crucially derives from the user's own colour
    expect(store.data['workbench.colorCustomizations']['editor.background']).toBe('#12345680');

    await restoreSettings({ settingsStore: store, globalState, disableColorCustomizations: false });

    expect(store.data['workbench.colorCustomizations']['editor.background']).toBe('#123456');
    expect(store.data['workbench.colorCustomizations']['sideBar.background']).toBe('#abcdef');
  });

  it('takes a backup when the first install happened with the setting on', async () => {
    const store = createSettingsStore({ 'workbench.colorCustomizations': { ...userColors } });
    const globalState = createGlobalState();

    await applySettings(buildApplyDeps({ settingsStore: store, globalState, disableColorCustomizations: true }));
    expect(store.data['workbench.colorCustomizations']['editor.background']).toBe('#123456');

    await applySettings(buildApplyDeps({ settingsStore: store, globalState, disableColorCustomizations: false }));
    await restoreSettings({ settingsStore: store, globalState, disableColorCustomizations: false });

    expect(store.data['workbench.colorCustomizations']['editor.background']).toBe('#123456');
  });

  it('cleans up its own writes on disable even when the setting is now on', async () => {
    // Regression: the setting being turned on after vibrancy had already
    // written meant restoreSettings skipped the cleanup entirely, stranding
    // translucent colours in settings.json and then wiping the backup.
    const store = createSettingsStore({ 'workbench.colorCustomizations': { ...userColors } });
    const globalState = createGlobalState();

    await applySettings(buildApplyDeps({ settingsStore: store, globalState }));
    expect(store.data['workbench.colorCustomizations']['editor.background']).toBe('#12345680');

    // The apply path never ran for the setting change (suppressed handler,
    // crash, or a hand-edited settings.json) — disable must still clean up.
    await restoreSettings({ settingsStore: store, globalState, disableColorCustomizations: true });

    expect(store.data['workbench.colorCustomizations']['editor.background']).toBe('#123456');
    expect(store.data['workbench.colorCustomizations']['terminal.background']).toBeUndefined();
  });

  it('leaves colors completely alone on disable when it never wrote any', async () => {
    const store = createSettingsStore({ 'workbench.colorCustomizations': { ...userColors } });
    const globalState = createGlobalState();

    // Installed and disabled entirely while the setting was on
    await applySettings(buildApplyDeps({ settingsStore: store, globalState, disableColorCustomizations: true }));
    await restoreSettings({ settingsStore: store, globalState, disableColorCustomizations: true });

    expect(store.data['workbench.colorCustomizations']).toEqual(userColors);
  });

  it('keeps the backup when the restoring write fails', async () => {
    const store = createSettingsStore({ 'workbench.colorCustomizations': { ...userColors } });
    const globalState = createGlobalState();

    await applySettings(buildApplyDeps({ settingsStore: store, globalState }));

    const failing = {
      ...store,
      update: async (key, value) => {
        if (key === 'workbench.colorCustomizations') throw new Error('write failed');
        return store.update(key, value);
      },
    };

    await applySettings(buildApplyDeps({
      settingsStore: failing,
      globalState,
      disableColorCustomizations: true,
    }));

    // The backup must survive so a later attempt can still restore the originals
    expect(globalState.data.customizations.vibrancyBackgrounds['editor.background']).toBe('#123456');

    await restoreSettings({ settingsStore: store, globalState, disableColorCustomizations: false });
    expect(store.data['workbench.colorCustomizations']['editor.background']).toBe('#123456');
  });

  it('cleans up theme-introduced keys on disable when the backup is missing', async () => {
    // globalState can be lost (new machine with settings sync, wiped storage)
    // while settings.json still holds vibrancy's values.
    const themeConfig = {
      ...defaultThemeConfig,
      colorCustomizations: { 'statusBar.background': 1 },
    };
    const store = createSettingsStore({
      'workbench.colorCustomizations': {
        'statusBar.background': '#1e1e1eff',
        'editor.background': '#1e1e1e4d',
      },
    });

    await restoreSettings({
      settingsStore: store,
      globalState: createGlobalState(),
      disableColorCustomizations: false,
      themeConfig,
    });

    expect(store.data['workbench.colorCustomizations']).not.toHaveProperty('statusBar.background');
    expect(store.data['workbench.colorCustomizations']).not.toHaveProperty('editor.background');
  });
});

// --- reinstall poisoning via theme literal colors (issue #247, second route) ---

describe('applySettings reinstall poisoning protection for theme literals', () => {
  const literalThemeConfig = {
    ...defaultThemeConfig,
    colorCustomizations: { 'editor.background': '#ff0000cc' },
  };

  it('does not back up a theme literal as if the user had chosen it', async () => {
    // settings.json still holds vibrancy's output from a previous install that
    // was removed without disabling first.
    const store = createSettingsStore({
      'workbench.colorCustomizations': { 'editor.background': '#ff0000cc' },
    });
    const globalState = createGlobalState();

    await applySettings(buildApplyDeps({
      settingsStore: store,
      globalState,
      themeConfig: literalThemeConfig,
    }));

    expect(globalState.data.customizations.vibrancyBackgrounds['editor.background']).toBeNull();

    await restoreSettings({
      settingsStore: store,
      globalState,
      disableColorCustomizations: false,
      themeConfig: literalThemeConfig,
    });

    expect(store.data['workbench.colorCustomizations']).not.toHaveProperty('editor.background');
  });

  it('still backs up a genuine user color under a literal-using theme', async () => {
    const store = createSettingsStore({
      'workbench.colorCustomizations': { 'editor.background': '#123456' },
    });
    const globalState = createGlobalState();

    await applySettings(buildApplyDeps({
      settingsStore: store,
      globalState,
      themeConfig: literalThemeConfig,
    }));

    expect(globalState.data.customizations.vibrancyBackgrounds['editor.background']).toBe('#123456');
    expect(store.data['workbench.colorCustomizations']['editor.background']).toBe('#ff0000cc');

    await restoreSettings({
      settingsStore: store,
      globalState,
      disableColorCustomizations: false,
      themeConfig: literalThemeConfig,
    });

    expect(store.data['workbench.colorCustomizations']['editor.background']).toBe('#123456');
  });
});

// --- settings.json changing underneath us ---

describe('settings.json changing underneath us', () => {
  // The recorded backup can disagree with what is actually in settings.json:
  // the user edited it by hand, or Settings Sync brought a value from another
  // machine. Whatever is there belongs to the user and must be adopted, not
  // overwritten from a stale backup.
  const C = 'workbench.colorCustomizations';

  it('adopts a value the backup never captured', async () => {
    const globalState = createGlobalState();
    const store = createSettingsStore({ [C]: { 'editor.background': '#123456' } });

    await applySettings(buildApplyDeps({ settingsStore: store, globalState }));

    // Settings Sync replaces the whole object with another machine's values
    store.data[C] = { 'editor.background': '#ff0000' };
    await applySettings(buildApplyDeps({ settingsStore: store, globalState }));

    expect(store.data[C]['editor.background']).toBe('#ff000080');
    expect(globalState.data.customizations.vibrancyBackgrounds['editor.background']).toBe('#ff0000');
  });

  it('restores the adopted value rather than the stale one on disable', async () => {
    const globalState = createGlobalState();
    const store = createSettingsStore({ [C]: { 'editor.background': '#123456' } });

    await applySettings(buildApplyDeps({ settingsStore: store, globalState }));
    store.data[C] = { 'editor.background': '#ff0000' };
    await applySettings(buildApplyDeps({ settingsStore: store, globalState }));
    await restoreSettings({
      settingsStore: store,
      globalState,
      disableColorCustomizations: false,
      themeConfig: defaultThemeConfig,
    });

    expect(store.data[C]['editor.background']).toBe('#ff0000');
  });

  it('recognises its own output as its own across repeated applies', async () => {
    // The reconciliation must not mistake vibrancy's own value for a user value
    // and start layering alpha onto alpha.
    const store = createSettingsStore({ [C]: { 'editor.background': '#123456' } });
    const globalState = createGlobalState();

    for (let i = 0; i < 3; i++) {
      await applySettings(buildApplyDeps({ settingsStore: store, globalState }));
      expect(store.data[C]['editor.background']).toBe('#12345680');
      expect(globalState.data.customizations.vibrancyBackgrounds['editor.background']).toBe('#123456');
    }
  });

  it('picks up a hand-edited color rather than silently overwriting it', async () => {
    const store = createSettingsStore();
    const globalState = createGlobalState();

    await applySettings(buildApplyDeps({ settingsStore: store, globalState }));

    // User edits settings.json directly while vibrancy is active
    store.data[C]['editor.background'] = '#abcdef';
    await applySettings(buildApplyDeps({ settingsStore: store, globalState }));

    expect(globalState.data.customizations.vibrancyBackgrounds['editor.background']).toBe('#abcdef');
    expect(store.data[C]['editor.background']).toBe('#abcdef80');

    await restoreSettings({ settingsStore: store, globalState, disableColorCustomizations: false });
    expect(store.data[C]['editor.background']).toBe('#abcdef');
  });
});
