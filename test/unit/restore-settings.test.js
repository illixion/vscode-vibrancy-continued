const fs = require('fs');
const path = require('path');
const os = require('os');
const { restorePreviousSettings } = require('../../extension/uninstallHook');

/**
 * Build a settings.json string with vibrancy keys injected.
 * Simulates what VSCode's settings look like while vibrancy is active.
 */
function buildVibrancySettings(extras = {}) {
  return JSON.stringify({
    "editor.fontSize": 14,
    "editor.tabSize": 2,
    "workbench.colorCustomizations": {
      "terminal.background": "#00000000",
      "editorPane.background": "#1e1e1e00",
      "sideBar.background": "#1e1e1ecc",
      "editor.background": "#1e1e1ee6",
      "activityBar.background": "#1e1e1ecc",
      "tab.activeBackground": "#1e1e1e00",
      "notifications.background": "#1e1e1ee6",
      ...extras,
    },
    "terminal.integrated.gpuAcceleration": "off",
    "window.systemColorTheme": "dark",
    "window.autoDetectColorScheme": true,
    "window.controlsStyle": "custom",
    "files.autoSave": "afterDelay",
  }, null, 4) + '\n';
}

describe('restorePreviousSettings', () => {
  let tmpDir;
  let settingsPath;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vibrancy-settings-test-'));
    settingsPath = path.join(tmpDir, 'settings.json');
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('removes all vibrancy-managed background keys', () => {
    fs.writeFileSync(settingsPath, buildVibrancySettings());

    restorePreviousSettings(null, settingsPath);

    const result = fs.readFileSync(settingsPath, 'utf-8');
    expect(result).not.toContain('"terminal.background"');
    expect(result).not.toContain('"editorPane.background"');
    expect(result).not.toContain('"sideBar.background"');
    expect(result).not.toContain('"editor.background"');
    expect(result).not.toContain('"activityBar.background"');
    expect(result).not.toContain('"tab.activeBackground"');
    expect(result).not.toContain('"notifications.background"');
  });

  it('removes window.controlsStyle', () => {
    fs.writeFileSync(settingsPath, buildVibrancySettings());

    restorePreviousSettings(null, settingsPath);

    const result = fs.readFileSync(settingsPath, 'utf-8');
    expect(result).not.toContain('"window.controlsStyle"');
  });

  it('preserves non-vibrancy settings', () => {
    fs.writeFileSync(settingsPath, buildVibrancySettings());

    restorePreviousSettings(null, settingsPath);

    const result = fs.readFileSync(settingsPath, 'utf-8');
    expect(result).toContain('"editor.fontSize"');
    expect(result).toContain('"editor.tabSize"');
    expect(result).toContain('"files.autoSave"');
  });

  it('restores user terminal.background from saved customizations', () => {
    fs.writeFileSync(settingsPath, buildVibrancySettings());

    restorePreviousSettings({
      saved: true,
      terminalBackground: '#1a1b26',
    }, settingsPath);

    const result = fs.readFileSync(settingsPath, 'utf-8');
    expect(result).toContain('"terminal.background": "#1a1b26"');
    expect(result).toContain('"editor.fontSize"');
  });

  it('removes terminal.background if user original was also transparent', () => {
    fs.writeFileSync(settingsPath, buildVibrancySettings());

    restorePreviousSettings({
      saved: true,
      terminalBackground: '#00000000',
    }, settingsPath);

    const result = fs.readFileSync(settingsPath, 'utf-8');
    expect(result).not.toContain('"terminal.background"');
  });

  it('restores gpuAcceleration to user original value', () => {
    fs.writeFileSync(settingsPath, buildVibrancySettings());

    restorePreviousSettings({
      saved: true,
      gpuAcceleration: 'auto',
    }, settingsPath);

    const result = fs.readFileSync(settingsPath, 'utf-8');
    expect(result).toContain('"terminal.integrated.gpuAcceleration": "auto"');
  });

  it('removes gpuAcceleration if user had no original value', () => {
    fs.writeFileSync(settingsPath, buildVibrancySettings());

    restorePreviousSettings({
      saved: true,
      gpuAcceleration: null,
    }, settingsPath);

    const result = fs.readFileSync(settingsPath, 'utf-8');
    expect(result).not.toContain('"terminal.integrated.gpuAcceleration"');
  });

  it('restores systemColorTheme to user original value', () => {
    fs.writeFileSync(settingsPath, buildVibrancySettings());

    restorePreviousSettings({
      saved: true,
      systemColorTheme: 'light',
    }, settingsPath);

    const result = fs.readFileSync(settingsPath, 'utf-8');
    expect(result).toContain('"window.systemColorTheme": "light"');
  });

  it('removes systemColorTheme if user had no original value', () => {
    fs.writeFileSync(settingsPath, buildVibrancySettings());

    restorePreviousSettings({
      saved: true,
      systemColorTheme: null,
    }, settingsPath);

    const result = fs.readFileSync(settingsPath, 'utf-8');
    expect(result).not.toContain('"window.systemColorTheme"');
  });

  it('restores autoDetectColorScheme to user original value', () => {
    fs.writeFileSync(settingsPath, buildVibrancySettings());

    restorePreviousSettings({
      saved: true,
      autoDetectColorScheme: false,
    }, settingsPath);

    const result = fs.readFileSync(settingsPath, 'utf-8');
    expect(result).toContain('"window.autoDetectColorScheme": false');
  });

  it('removes autoDetectColorScheme if user had no original value', () => {
    fs.writeFileSync(settingsPath, buildVibrancySettings());

    restorePreviousSettings({
      saved: true,
      autoDetectColorScheme: null,
    }, settingsPath);

    const result = fs.readFileSync(settingsPath, 'utf-8');
    expect(result).not.toContain('"window.autoDetectColorScheme"');
  });

  it('restores user-customized vibrancy background keys', () => {
    // User had a custom sidebar background before vibrancy was installed.
    // Vibrancy overwrote it with a transparent value.
    fs.writeFileSync(settingsPath, buildVibrancySettings());

    restorePreviousSettings({
      saved: true,
      vibrancyBackgrounds: {
        "sideBar.background": "#282c34",
        "editor.background": "#1d1f21",
      },
    }, settingsPath);

    const result = fs.readFileSync(settingsPath, 'utf-8');
    expect(result).toContain('"sideBar.background": "#282c34"');
    expect(result).toContain('"editor.background": "#1d1f21"');
    // Keys without a saved original are still stripped
    expect(result).not.toContain('"editorPane.background"');
    // Non-vibrancy settings survive
    expect(result).toContain('"editor.fontSize"');
    expect(result).toContain('"files.autoSave"');
  });

  it('handles settings with no previousCustomizations (null)', () => {
    fs.writeFileSync(settingsPath, buildVibrancySettings());

    restorePreviousSettings(null, settingsPath);

    const result = fs.readFileSync(settingsPath, 'utf-8');
    // Should still strip all vibrancy keys and controlsStyle
    expect(result).not.toContain('"terminal.background"');
    expect(result).not.toContain('"window.controlsStyle"');
    // But leaves gpuAcceleration, systemColorTheme, autoDetectColorScheme
    // since we have no saved state to know they should be removed
    expect(result).toContain('"terminal.integrated.gpuAcceleration"');
  });

  it('handles settings with saved=false (incomplete backup)', () => {
    fs.writeFileSync(settingsPath, buildVibrancySettings());

    restorePreviousSettings({ saved: false }, settingsPath);

    const result = fs.readFileSync(settingsPath, 'utf-8');
    // Vibrancy bg keys and controlsStyle are always removed
    expect(result).not.toContain('"editorPane.background"');
    expect(result).not.toContain('"window.controlsStyle"');
    // But no restoration of saved values happens
  });

  it('full round-trip: user settings survive install+uninstall', () => {
    // User's original settings before vibrancy
    const originalSettings = JSON.stringify({
      "editor.fontSize": 14,
      "terminal.integrated.gpuAcceleration": "auto",
      "window.systemColorTheme": "light",
      "window.autoDetectColorScheme": false,
      "workbench.colorCustomizations": {
        "statusBar.background": "#007acc",
      },
      "files.autoSave": "afterDelay",
    }, null, 4) + '\n';

    // Simulate vibrancy install: vibrancy adds its keys on top
    const afterInstall = JSON.stringify({
      "editor.fontSize": 14,
      "terminal.integrated.gpuAcceleration": "off",
      "window.systemColorTheme": "dark",
      "window.autoDetectColorScheme": true,
      "window.controlsStyle": "custom",
      "workbench.colorCustomizations": {
        "statusBar.background": "#007acc",
        "terminal.background": "#00000000",
        "editorPane.background": "#1e1e1e00",
        "sideBar.background": "#1e1e1ecc",
        "editor.background": "#1e1e1ee6",
        "activityBar.background": "#1e1e1ecc",
      },
      "files.autoSave": "afterDelay",
    }, null, 4) + '\n';

    fs.writeFileSync(settingsPath, afterInstall);

    // Uninstall with the backup that was saved during install
    restorePreviousSettings({
      saved: true,
      terminalBackground: null,  // user had no terminal.background
      gpuAcceleration: 'auto',
      systemColorTheme: 'light',
      autoDetectColorScheme: false,
      vibrancyBackgrounds: {},  // user had no vibrancy bg keys
    }, settingsPath);

    const result = fs.readFileSync(settingsPath, 'utf-8');

    // Vibrancy keys should be gone
    expect(result).not.toContain('"terminal.background"');
    expect(result).not.toContain('"editorPane.background"');
    expect(result).not.toContain('"sideBar.background"');
    expect(result).not.toContain('"editor.background"');
    expect(result).not.toContain('"activityBar.background"');
    expect(result).not.toContain('"window.controlsStyle"');

    // User's original values should be restored
    expect(result).toContain('"terminal.integrated.gpuAcceleration": "auto"');
    expect(result).toContain('"window.systemColorTheme": "light"');
    expect(result).toContain('"window.autoDetectColorScheme": false');

    // User's non-vibrancy settings should be untouched
    expect(result).toContain('"editor.fontSize"');
    expect(result).toContain('"statusBar.background"');
    expect(result).toContain('"files.autoSave"');
  });
});

describe('restorePreviousSettings (JSONC)', () => {
  let tmpDir;
  let settingsPath;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vibrancy-jsonc-test-'));
    settingsPath = path.join(tmpDir, 'settings.json');
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('line comments between vibrancy keys survive uninstall', () => {
    fs.writeFileSync(settingsPath, [
      '{',
      '    "workbench.colorCustomizations": {',
      '        "sideBar.background": "#1e1e1ecc",',
      '        // User note about colors',
      '        "editor.background": "#1e1e1ee6"',
      '    },',
      '    "editor.fontSize": 14',
      '}',
    ].join('\n') + '\n');

    restorePreviousSettings(null, settingsPath);

    const result = fs.readFileSync(settingsPath, 'utf-8');
    expect(result).toContain('// User note about colors');
    expect(result).not.toContain('"sideBar.background"');
    expect(result).not.toContain('"editor.background"');
    expect(result).toContain('"editor.fontSize"');
  });

  it('block comments between vibrancy keys survive uninstall', () => {
    fs.writeFileSync(settingsPath, [
      '{',
      '    "workbench.colorCustomizations": {',
      '        "sideBar.background": "#1e1e1ecc",',
      '        /* customization section */',
      '        "editor.background": "#1e1e1ee6"',
      '    },',
      '    "editor.fontSize": 14',
      '}',
    ].join('\n') + '\n');

    restorePreviousSettings(null, settingsPath);

    const result = fs.readFileSync(settingsPath, 'utf-8');
    expect(result).toContain('/* customization section */');
    expect(result).not.toContain('"sideBar.background"');
    expect(result).not.toContain('"editor.background"');
  });

  it('inline comments after vibrancy values are preserved', () => {
    fs.writeFileSync(settingsPath, [
      '{',
      '    "workbench.colorCustomizations": {',
      '        "sideBar.background": "#1e1e1ecc", // my sidebar',
      '        "editor.background": "#1e1e1ee6"',
      '    },',
      '    "editor.fontSize": 14',
      '}',
    ].join('\n') + '\n');

    restorePreviousSettings(null, settingsPath);

    const result = fs.readFileSync(settingsPath, 'utf-8');
    expect(result).toContain('// my sidebar');
    expect(result).not.toContain('"sideBar.background"');
  });

  it('trailing comma after removal is valid JSONC', () => {
    fs.writeFileSync(settingsPath, [
      '{',
      '    "workbench.colorCustomizations": {',
      '        "statusBar.background": "#007acc",',
      '        "sideBar.background": "#1e1e1ecc"',
      '    }',
      '}',
    ].join('\n') + '\n');

    restorePreviousSettings(null, settingsPath);

    const result = fs.readFileSync(settingsPath, 'utf-8');
    expect(result).not.toContain('"sideBar.background"');
    expect(result).toContain('"statusBar.background": "#007acc"');
    // Trailing comma before } is valid JSONC
    expect(result).toMatch(/"statusBar\.background":\s*"#007acc",?\s*\}/);
  });

  it('empty colorCustomizations object after removing all vibrancy keys', () => {
    fs.writeFileSync(settingsPath, [
      '{',
      '    "workbench.colorCustomizations": {',
      '        "sideBar.background": "#1e1e1ecc",',
      '        "editor.background": "#1e1e1ee6"',
      '    },',
      '    "editor.fontSize": 14',
      '}',
    ].join('\n') + '\n');

    restorePreviousSettings(null, settingsPath);

    const result = fs.readFileSync(settingsPath, 'utf-8');
    expect(result).not.toContain('"sideBar.background"');
    expect(result).not.toContain('"editor.background"');
    expect(result).toContain('"workbench.colorCustomizations"');
    expect(result).toContain('"editor.fontSize"');
  });

  it('full round-trip with JSONC preserves comments and non-vibrancy settings', () => {
    fs.writeFileSync(settingsPath, [
      '{',
      '    // My editor preferences',
      '    "editor.fontSize": 14,',
      '    "workbench.colorCustomizations": {',
      '        "statusBar.background": "#007acc", // status bar',
      '        "terminal.background": "#00000000",',
      '        "sideBar.background": "#1e1e1ecc",',
      '        // Vibrancy auto-generated:',
      '        "editor.background": "#1e1e1ee6",',
      '        "activityBar.background": "#1e1e1ecc"',
      '    },',
      '    "terminal.integrated.gpuAcceleration": "off",',
      '    "window.systemColorTheme": "dark",',
      '    "window.autoDetectColorScheme": true,',
      '    "window.controlsStyle": "custom",',
      '    /* Other settings below */',
      '    "files.autoSave": "afterDelay"',
      '}',
    ].join('\n') + '\n');

    restorePreviousSettings({
      saved: true,
      terminalBackground: null,
      gpuAcceleration: 'auto',
      systemColorTheme: 'light',
      autoDetectColorScheme: false,
      vibrancyBackgrounds: {},
    }, settingsPath);

    const result = fs.readFileSync(settingsPath, 'utf-8');

    // Comments survive
    expect(result).toContain('// My editor preferences');
    expect(result).toContain('// status bar');
    expect(result).toContain('// Vibrancy auto-generated:');
    expect(result).toContain('/* Other settings below */');

    // Non-vibrancy settings survive
    expect(result).toContain('"editor.fontSize"');
    expect(result).toContain('"statusBar.background": "#007acc"');
    expect(result).toContain('"files.autoSave"');

    // Vibrancy keys removed
    expect(result).not.toContain('"terminal.background"');
    expect(result).not.toContain('"sideBar.background"');
    expect(result).not.toContain('"editor.background"');
    expect(result).not.toContain('"activityBar.background"');
    expect(result).not.toContain('"window.controlsStyle"');

    // Originals restored
    expect(result).toContain('"terminal.integrated.gpuAcceleration": "auto"');
    expect(result).toContain('"window.systemColorTheme": "light"');
    expect(result).toContain('"window.autoDetectColorScheme": false');
  });

  it('inline comment on top-level vibrancy setting is preserved', () => {
    fs.writeFileSync(settingsPath, [
      '{',
      '    "terminal.integrated.gpuAcceleration": "off", // was auto',
      '    "window.controlsStyle": "custom",',
      '    "editor.fontSize": 14',
      '}',
    ].join('\n') + '\n');

    restorePreviousSettings({
      saved: true,
      gpuAcceleration: null,
    }, settingsPath);

    const result = fs.readFileSync(settingsPath, 'utf-8');
    expect(result).toContain('// was auto');
    expect(result).not.toContain('"window.controlsStyle"');
    expect(result).toContain('"editor.fontSize"');
  });

  it('known limitation: regex matches key patterns inside comments', () => {
    // If a user writes a comment that contains a vibrancy key-value pattern,
    // the regex will match inside the comment and mangle it. This is accepted
    // because it requires an extremely specific comment format that is
    // unrealistic in practice (exact key name, colon, quoted value).
    fs.writeFileSync(settingsPath, [
      '{',
      '    "workbench.colorCustomizations": {',
      '        // Old: "sideBar.background": "#my-old-color"',
      '        "sideBar.background": "#1e1e1ecc",',
      '        "editor.background": "#1e1e1ee6"',
      '    }',
      '}',
    ].join('\n') + '\n');

    restorePreviousSettings(null, settingsPath);

    const result = fs.readFileSync(settingsPath, 'utf-8');
    // The comment gets mangled because the regex matches the key pattern inside it
    expect(result).not.toContain('"#my-old-color"');
    // The actual key is still removed correctly
    expect(result).not.toContain('"#1e1e1ecc"');
  });
});
