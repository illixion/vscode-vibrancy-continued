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

  it('drops colorCustomizations entirely once nothing is left in it', () => {
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
    // The bare `"workbench.colorCustomizations": {}` left behind is Vibrancy's
    // litter, not the user's, so it goes too — but only because everything
    // inside it was ours. See the comment-only case below.
    expect(result).not.toContain('"workbench.colorCustomizations"');
    expect(result).toContain('"editor.fontSize"');
  });

  it('keeps an emptied colorCustomizations that still holds a comment', () => {
    fs.writeFileSync(settingsPath, [
      '{',
      '    "workbench.colorCustomizations": {',
      '        // I had colours here once',
      '        "sideBar.background": "#1e1e1ecc"',
      '    },',
      '    "editor.fontSize": 14',
      '}',
    ].join('\n') + '\n');

    restorePreviousSettings(null, settingsPath);

    const result = fs.readFileSync(settingsPath, 'utf-8');
    expect(result).not.toContain('"sideBar.background"');
    // Removing the property would take the comment text with it.
    expect(result).toContain('// I had colours here once');
    expect(result).toContain('"workbench.colorCustomizations"');
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

  it('commented-out 6-digit hex colors in vibrancy keys are preserved', () => {
    // Users often comment out alternative theme configs. The regex only matches
    // 8-digit hex colors (with alpha), so 6-digit colors in comments are safe.
    fs.writeFileSync(settingsPath, [
      '{',
      '    "workbench.colorCustomizations": {',
      '        // "sideBar.background": "#282c34",',
      '        // "editor.background": "#1d1f21",',
      '        "sideBar.background": "#1e1e1ecc",',
      '        "editor.background": "#1e1e1ee6"',
      '    }',
      '}',
    ].join('\n') + '\n');

    restorePreviousSettings(null, settingsPath);

    const result = fs.readFileSync(settingsPath, 'utf-8');
    // Commented-out 6-digit hex values survive
    expect(result).toContain('"#282c34"');
    expect(result).toContain('"#1d1f21"');
    // Actual 8-digit vibrancy values are removed
    expect(result).not.toContain('"#1e1e1ecc"');
    expect(result).not.toContain('"#1e1e1ee6"');
  });

  it('no longer edits inside comments, whatever hex they contain', () => {
    // This used to be documented as an accepted limitation: the regex matched
    // an 8-digit hex for a vibrancy key even inside a comment, and mangled it.
    // A parser sees a comment as a comment, so the limitation is simply gone.
    fs.writeFileSync(settingsPath, [
      '{',
      '    "workbench.colorCustomizations": {',
      '        // "sideBar.background": "#282c34ff"',
      '        "sideBar.background": "#1e1e1ecc"',
      '    }',
      '}',
    ].join('\n') + '\n');

    restorePreviousSettings(null, settingsPath);

    const result = fs.readFileSync(settingsPath, 'utf-8');
    // The commented-out colour survives untouched...
    expect(result).toContain('// "sideBar.background": "#282c34ff"');
    // ...while the real vibrancy value is removed.
    expect(result).not.toContain('"#1e1e1ecc"');
  });
});

// --- uninstall hook key coverage (drift guard) ---

describe('resolveHookBgKeys', () => {
  const { resolveHookBgKeys } = require('../../extension/uninstallHook');
  const { ALL_VIBRANCY_BG_KEYS } = require('../../extension/file-transforms');

  it('covers every vibrancy-managed key', () => {
    // Regression: this list was maintained by hand in two places and had
    // drifted — terminalStickyScroll.background was never cleaned up on
    // Windows. It is now derived, so it cannot drift again.
    const keys = resolveHookBgKeys(null);
    for (const key of ALL_VIBRANCY_BG_KEYS) {
      if (key === 'terminal.background') continue;
      expect(keys).toContain(key);
    }
  });

  it('includes keys a theme introduced, which no hard-coded list would know', () => {
    const keys = resolveHookBgKeys({
      saved: true,
      vibrancyBackgrounds: { 'statusBar.background': null, 'editor.background': '#123456' },
    });

    expect(keys).toContain('statusBar.background');
  });

  it('leaves terminal.background to its own dedicated handling', () => {
    expect(resolveHookBgKeys(null)).not.toContain('terminal.background');
    expect(resolveHookBgKeys({
      saved: true,
      vibrancyBackgrounds: { 'terminal.background': '#abcdef' },
    })).not.toContain('terminal.background');
  });

  it('never returns duplicates', () => {
    const keys = resolveHookBgKeys({
      saved: true,
      vibrancyBackgrounds: Object.fromEntries(ALL_VIBRANCY_BG_KEYS.map(k => [k, null])),
    });
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('survives a missing or malformed backup', () => {
    for (const value of [null, undefined, {}, { vibrancyBackgrounds: 'nonsense' }]) {
      expect(resolveHookBgKeys(value).length).toBeGreaterThan(0);
    }
  });
});

// --- deferred Windows cleanup ---
//
// The hook runs during VSCode *startup*, not at exit — uninstalling only marks
// the extension for removal, and the cleanup happens on the next launch, with a
// live VSCode around it. On Windows a settings.json write made in that window is
// lost, so the edit is deferred until the user quits. By then this extension
// directory has been deleted, so the code that performs it has to be staged
// elsewhere first. These tests actually run the staged script, because "it was
// written to disk" is not the same claim as "it still works once the extension
// is gone".
describe('stageDeferredRestore', () => {
  const { stageDeferredRestore, buildRestorePlan } = require('../../extension/uninstallHook');
  const { execFileSync } = require('child_process');

  let tmpDir;
  let settingsPath;
  let staged;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vibrancy-defer-test-'));
    settingsPath = path.join(tmpDir, 'settings.json');
    staged = null;
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    if (staged) fs.rmSync(staged.dir, { recursive: true, force: true });
  });

  const run = () => execFileSync(process.execPath, [staged.entry], { encoding: 'utf-8' });

  it('stages a bundle that runs without the extension directory', () => {
    fs.writeFileSync(settingsPath, [
      '{',
      '    // mine',
      '    "workbench.colorCustomizations": {',
      '        "sideBar.background": "#1e1e1ecc"',
      '    },',
      '    "window.controlsStyle": "custom",',
      '    "editor.fontSize": 14',
      '}',
    ].join('\n') + '\n');

    staged = stageDeferredRestore(settingsPath, buildRestorePlan(null));
    expect(staged).not.toBeNull();

    // jsonc-parser has to sit in a node_modules for its bare require to resolve
    // once the copy is running from a temp directory.
    expect(fs.existsSync(path.join(staged.dir, 'node_modules', 'jsonc-parser', 'package.json'))).toBe(true);
    expect(fs.existsSync(path.join(staged.dir, 'jsonc-settings.js'))).toBe(true);

    expect(run()).toContain('reverted');

    const result = fs.readFileSync(settingsPath, 'utf-8');
    expect(result).not.toContain('"sideBar.background"');
    expect(result).not.toContain('"window.controlsStyle"');
    expect(result).toContain('// mine');
    expect(result).toContain('"editor.fontSize"');
  });

  it('reverts identically to the direct path', () => {
    // The two used to be separate hand-written regex lists, which is how
    // terminalStickyScroll.background ended up cleaned on POSIX but not on
    // Windows. Sharing buildRestorePlan is what stops that recurring.
    const content = [
      '{',
      '    "workbench.colorCustomizations": {',
      '        "terminalStickyScroll.background": "#1e1e1ebf",',
      '        "editor.background": "#1e1e1e4d"',
      '    }',
      '}',
    ].join('\n') + '\n';
    const directPath = path.join(tmpDir, 'direct.json');

    fs.writeFileSync(settingsPath, content);
    fs.writeFileSync(directPath, content);

    staged = stageDeferredRestore(settingsPath, buildRestorePlan(null));
    run();
    restorePreviousSettings(null, directPath);

    expect(fs.readFileSync(settingsPath, 'utf-8')).toBe(fs.readFileSync(directPath, 'utf-8'));
  });

  it('leaves a damaged settings.json alone and says so', () => {
    const broken = '{\n  "workbench.colorCustomizations": {\n    "editor.background": "#1e1e1e4d",\n';
    fs.writeFileSync(settingsPath, broken);

    staged = stageDeferredRestore(settingsPath, buildRestorePlan(null));

    // Non-zero exit, and crucially the file is untouched rather than edited
    // into something even less parseable.
    expect(() => run()).toThrow();
    expect(fs.readFileSync(settingsPath, 'utf-8')).toBe(broken);
  });

  it('does nothing when the settings file is gone', () => {
    staged = stageDeferredRestore(path.join(tmpDir, 'absent.json'), buildRestorePlan(null));
    expect(run()).toContain('not found');
  });
});

describe('buildDeferredScript', () => {
  const { buildDeferredScript } = require('../../extension/uninstallHook');
  const script = () => buildDeferredScript({
    exeName: "Code - Insid'ers",
    nodePath: 'C:\\Programs\\Code.exe',
    entry: 'C:\\Temp\\stage\\restore.js',
    stageDir: 'C:\\Temp\\stage',
    cliCommand: "C:\\bin\\o'brien.cmd",
    logPath: 'C:\\Temp\\cleanup.log',
  });

  it('waits for the restore instead of firing and forgetting it', () => {
    // Measured on a real Windows box: `& $node $script` returns in 8ms without
    // waiting and without connecting stdout, because Code.exe is a GUI-subsystem
    // binary. Everything after it then races the restore — deleting the staged
    // bundle out from under a process still starting, and relaunching VSCode in
    // time to re-cache the settings being edited, which is the exact race the
    // deferral exists to prevent.
    const text = script();

    expect(text).toContain('-Wait -NoNewWindow');
    expect(text).toContain('-PassThru');
    expect(text).not.toMatch(/&\s+\$node\s+\$script/);
  });

  it('escapes single quotes in every interpolated path', () => {
    // A path with an apostrophe would otherwise end the PowerShell string and
    // turn the rest of the line into commands.
    const text = script();

    expect(text).toContain("$proc = 'Code - Insid''ers'");
    expect(text).toContain("Start-Process 'C:\\bin\\o''brien.cmd'");
  });

  it('launches the interpreter only after the wait loop', () => {
    // VSCode's own binary is the interpreter, so starting it any earlier would
    // make the wait loop see a running instance and spin forever.
    const lines = script().split('\r\n');
    const waitLine = lines.findIndex((line) => line.startsWith('while (Get-Process'));
    const startLine = lines.findIndex((line) => line.includes('Start-Process -FilePath $node'));

    expect(waitLine).toBeGreaterThan(-1);
    expect(startLine).toBeGreaterThan(waitLine);
  });

  it('cleans up the staged bundle and its capture files', () => {
    expect(script()).toContain('Remove-Item $stage -Recurse -Force');
    expect(script()).toContain('Remove-Item $out, $err -Force');
  });

  it('is CRLF, as a .ps1 written for Windows should be', () => {
    expect(script()).not.toMatch(/[^\r]\n/);
  });
});
