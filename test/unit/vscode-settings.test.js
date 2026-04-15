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
    const vibrancyColors = {};
    for (const key of ALL_VIBRANCY_BG_KEYS) {
      vibrancyColors[key] = '#1e1e1ecc';
    }

    const store = createSettingsStore({
      'workbench.colorCustomizations': {
        'terminal.background': '#00000000',
        ...vibrancyColors,
      },
      'terminal.integrated.gpuAcceleration': 'off',
    });

    const globalState = createGlobalState({
      customizations: {
        saved: true,
        terminalBackground: '#1a1b26',
        vibrancyBackgrounds: {},
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
    const colors = store.data['workbench.colorCustomizations'];
    expect(colors['terminal.background']).toBe('#00000000');
    for (const key of ALL_VIBRANCY_BG_KEYS) {
      expect(colors[key]).toBe('#1e1e1ecc');
    }
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
