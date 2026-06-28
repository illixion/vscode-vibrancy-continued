const fs = require('fs');
const path = require('path');
const {
  generateNewJS,
  removeJSMarkers,
  resolveEffectiveWindowMode,
  resolveWindowMode,
  injectElectronOptions,
  removeElectronOptions,
  patchCSP,
  removeCSPPatch,
  computeTransparentHex,
  extractBaseColor,
  computeVibrancyColors,
  VIBRANCY_START,
  VIBRANCY_END,
  TRANSPARENT_BG_KEYS,
  SEMITRANSPARENT_BG_KEYS,
  OPAQUE_BG_KEYS,
  ALL_VIBRANCY_BG_KEYS,
} = require('../../extension/file-transforms');

const FIXTURES = path.join(__dirname, '..', 'fixtures');
const loadFixture = (name) => fs.readFileSync(path.join(FIXTURES, name), 'utf-8');
const cursorWindowBuilder = loadFixture('cursor-window-builder.js');

// --- generateNewJS ---

describe('generateNewJS', () => {
  it('injects markers into clean JS', () => {
    const original = loadFixture('main.js');
    const result = generateNewJS(original, '/app', { theme: 'dark' }, '/runtime/index.mjs');
    expect(result).toContain(VIBRANCY_START);
    expect(result).toContain(VIBRANCY_END);
    expect(result).toContain('global.vscode_vibrancy_plugin');
    expect(result).toContain('"theme":"dark"');
  });

  it('replaces existing injection (idempotent)', () => {
    const original = loadFixture('main.js');
    const first = generateNewJS(original, '/app', { v: 1 }, '/runtime/index.mjs');
    const second = generateNewJS(first, '/app', { v: 2 }, '/runtime/index.mjs');

    // Should have exactly one set of markers
    const startCount = (second.match(/VSCODE-VIBRANCY-START/g) || []).length;
    expect(startCount).toBe(1);

    // Should contain updated data
    expect(second).toContain('"v":2');
    expect(second).not.toContain('"v":1');
  });

  it('includes the correct runtime path as file URL', () => {
    const original = loadFixture('main.js');
    const runtimePath = path.resolve('/some/path/index.mjs');
    const result = generateNewJS(original, '/app', {}, runtimePath);
    const { pathToFileURL } = require('url');
    expect(result).toContain(pathToFileURL(runtimePath).href);
  });
});

// --- removeJSMarkers ---

describe('removeJSMarkers', () => {
  it('removes injected markers', () => {
    const original = loadFixture('main.js');
    const injected = generateNewJS(original, '/app', {}, '/runtime/index.mjs');
    const { result, hadMarkers } = removeJSMarkers(injected);
    expect(hadMarkers).toBe(true);
    expect(result).toBe(original);
  });

  it('returns unchanged content when no markers present', () => {
    const original = loadFixture('main.js');
    const { result, hadMarkers } = removeJSMarkers(original);
    expect(hadMarkers).toBe(false);
    expect(result).toBe(original);
  });

  it('round-trips: inject then remove produces original', () => {
    const original = loadFixture('main-merged.js');
    const injected = generateNewJS(original, '/app', { foo: 'bar' }, '/runtime/index.cjs');
    const { result } = removeJSMarkers(injected);
    expect(result).toBe(original);
  });
});

// --- resolveEffectiveWindowMode (legacy setting migration) ---

describe('resolveEffectiveWindowMode', () => {
  const mac = { osType: 'macos', platform: 'darwin' };
  // winOpaqueSafe: true models a current VSCode build (opaque vibrancy confirmed
  // OK); older builds (false) keep a transparent window — covered separately.
  const win11 = { osType: 'win10', platform: 'win32', isWindows11: true, winOpaqueSafe: true };
  const win10 = { osType: 'win10', platform: 'win32', isWindows11: false, winOpaqueSafe: true };
  const linux = { osType: 'unknown', platform: 'linux' };

  it('defaults to auto when nothing is set', () => {
    expect(resolveEffectiveWindowMode({ ...mac })).toBe('auto');
  });

  it('migrates disableFramelessWindow to framed on any platform', () => {
    expect(resolveEffectiveWindowMode({ ...mac, disableFramelessWindow: true })).toBe('framed');
    expect(resolveEffectiveWindowMode({ ...win11, disableFramelessWindow: true })).toBe('framed');
  });

  // forceFramelessWindow was only ever a "force frameless" toggle; the migration
  // picks the frameless variant that matches what the platform/material needs.
  it('migrates forceFramelessWindow to transparent frameless on macOS', () => {
    expect(resolveEffectiveWindowMode({ ...mac, forceFramelessWindow: true })).toBe('frameless-transparent');
  });

  it('migrates forceFramelessWindow to transparent frameless on macOS only for the transparent type', () => {
    expect(resolveEffectiveWindowMode({ ...mac, transparentType: true, forceFramelessWindow: true }))
      .toBe('frameless-transparent');
  });

  it('migrates forceFramelessWindow to opaque frameless on Win11 with a DWM material (Mica/Acrylic)', () => {
    expect(resolveEffectiveWindowMode({ ...win11, transparentType: false, forceFramelessWindow: true }))
      .toBe('frameless');
  });

  it('migrates forceFramelessWindow to opaque frameless on current Windows, transparent frameless on Linux', () => {
    expect(resolveEffectiveWindowMode({ ...win10, forceFramelessWindow: true })).toBe('frameless');
    expect(resolveEffectiveWindowMode({ ...linux, forceFramelessWindow: true })).toBe('frameless-transparent');
  });

  it('migrates forceFramelessWindow to transparent frameless on older Windows (opaque not yet safe)', () => {
    expect(resolveEffectiveWindowMode({ ...win10, winOpaqueSafe: false, forceFramelessWindow: true }))
      .toBe('frameless-transparent');
  });

  it('forceFramelessWindow wins over disableFramelessWindow (preserves legacy precedence)', () => {
    expect(resolveEffectiveWindowMode({ ...win10, forceFramelessWindow: true, disableFramelessWindow: true }))
      .toBe('frameless');
  });

  it('an explicit windowMode always wins over the legacy flags', () => {
    expect(resolveEffectiveWindowMode({
      ...mac, windowMode: 'framed', forceFramelessWindow: true, disableFramelessWindow: true,
    })).toBe('framed');
    expect(resolveEffectiveWindowMode({ ...win10, windowMode: 'frameless', forceFramelessWindow: true }))
      .toBe('frameless');
  });
});

// --- resolveWindowMode ---

describe('resolveWindowMode', () => {
  const base = {
    osType: 'win10',
    platform: 'win32',
    electronMajorVersion: 27,
    appName: 'Visual Studio Code',
    isWindows11: false,
    transparentType: false,
    winOpaqueSafe: true, // current VSCode build (opaque vibrancy confirmed OK)
    windowMode: 'auto',
  };
  const macos = { ...base, osType: 'macos', platform: 'darwin', electronMajorVersion: 0 };
  const linux = { ...base, osType: 'unknown', platform: 'linux', electronMajorVersion: 0 };

  // --- auto: platform defaults ---

  // Windows default is frameless + OPAQUE so Aero Snap / maximize work (a thin
  // border shows on Win10). Only the see-through 'transparent' type opts into a
  // transparent window (which gives up snap).
  it('auto: Windows Electron >=27 is frameless + opaque (snappable)', () => {
    expect(resolveWindowMode({ ...base, electronMajorVersion: 27 })).toEqual({ frameless: true, transparent: false });
  });

  it('auto: Windows with the transparent type is frameless + transparent', () => {
    expect(resolveWindowMode({ ...base, electronMajorVersion: 27, transparentType: true }))
      .toEqual({ frameless: true, transparent: true });
  });

  // Older VSCode builds (opaque vibrancy not yet confirmed safe) keep the
  // transparent (no-snap) window to avoid issue #122 text shearing.
  it('auto: older Windows (opaque not safe) is frameless + transparent', () => {
    expect(resolveWindowMode({ ...base, electronMajorVersion: 27, winOpaqueSafe: false }))
      .toEqual({ frameless: true, transparent: true });
  });

  it('auto: Windows Electron <27 is framed', () => {
    expect(resolveWindowMode({ ...base, electronMajorVersion: 26 })).toEqual({ frameless: false, transparent: false });
  });

  it('auto: Win11 with a DWM material (Mica/Acrylic) is frameless + opaque', () => {
    expect(resolveWindowMode({ ...base, isWindows11: true, transparentType: false }))
      .toEqual({ frameless: true, transparent: false });
  });

  it('auto: Win11 with the transparent type is frameless + transparent', () => {
    expect(resolveWindowMode({ ...base, isWindows11: true, transparentType: true }))
      .toEqual({ frameless: true, transparent: true });
  });

  it('auto: Linux is frameless + transparent', () => {
    expect(resolveWindowMode(linux)).toEqual({ frameless: true, transparent: true });
  });

  it('auto: Cursor is frameless on every platform', () => {
    expect(resolveWindowMode({ ...macos, appName: 'Cursor' }).frameless).toBe(true);
    expect(resolveWindowMode({ ...linux, appName: 'Cursor' }).frameless).toBe(true);
  });

  // macOS default is now frameless + OPAQUE: it fixes the file-browser hover
  // flash (#200/#206/#207) without the WindowServer GPU cost of a transparent
  // window on Tahoe. The see-through 'transparent' type is the exception.
  it('auto: macOS is frameless + transparent by default (fixes #207, avoids opaque-backing ghost)', () => {
    expect(resolveWindowMode(macos)).toEqual({ frameless: true, transparent: true });
  });

  it('auto: macOS with the transparent type is frameless + transparent', () => {
    expect(resolveWindowMode({ ...macos, transparentType: true }))
      .toEqual({ frameless: true, transparent: true });
  });

  // --- explicit overrides win over platform defaults ---

  it('framed: always framed + opaque, even on macOS', () => {
    expect(resolveWindowMode({ ...macos, windowMode: 'framed' }))
      .toEqual({ frameless: false, transparent: false });
  });

  it('frameless: frameless + opaque, even where auto would be transparent', () => {
    expect(resolveWindowMode({ ...linux, windowMode: 'frameless' }))
      .toEqual({ frameless: true, transparent: false });
  });

  it('frameless-transparent: frameless + transparent, even on macOS', () => {
    expect(resolveWindowMode({ ...macos, windowMode: 'frameless-transparent' }))
      .toEqual({ frameless: true, transparent: true });
  });

  it('explicit framed forces frame even on an otherwise-frameless Linux config', () => {
    expect(resolveWindowMode({ ...linux, windowMode: 'framed' }).frameless).toBe(false);
  });
});

// --- injectElectronOptions ---

describe('injectElectronOptions', () => {
  it('injects frame:false,transparent:true when frameless is true', () => {
    const original = loadFixture('main-merged.js');
    const result = injectElectronOptions(original, { frameless: true, isMacos: false });
    expect(result).toContain('frame:false,transparent:true,experimentalDarkMode');
  });

  it('does not inject frame options when frameless is false', () => {
    const original = loadFixture('main-merged.js');
    const result = injectElectronOptions(original, { frameless: false, isMacos: false });
    expect(result).not.toContain('frame:false');
    expect(result).toContain('experimentalDarkMode');
  });

  it('injects visualEffectState on macOS', () => {
    const original = loadFixture('main-merged.js');
    const result = injectElectronOptions(original, { frameless: false, isMacos: true });
    expect(result).toContain('visualEffectState:"active",experimentalDarkMode');
  });

  it('injects both frame and visualEffectState on macOS when frameless', () => {
    const original = loadFixture('main-merged.js');
    const result = injectElectronOptions(original, { frameless: true, isMacos: true });
    expect(result).toContain('visualEffectState:"active"');
    expect(result).toContain('frame:false,transparent:true');
  });

  it('injects visualEffectState into assignment-based Cursor window builders', () => {
    const result = injectElectronOptions(cursorWindowBuilder, { frameless: false, isMacos: true });
    expect(result).toContain('u.visualEffectState="active",u.titleBarStyle="hidden"');
  });

  it('injects frameless options into assignment-based Cursor window builders', () => {
    const result = injectElectronOptions(cursorWindowBuilder, { frameless: true, isMacos: false });
    expect(result).toContain('u.frame=false,u.transparent=true,u.titleBarStyle="hidden"');
  });

  it('injects frame:false,transparent:false when transparent is false (Win11 Mica)', () => {
    const original = loadFixture('main-merged.js');
    const result = injectElectronOptions(original, { frameless: true, isMacos: false, transparent: false });
    expect(result).toContain('frame:false,transparent:false,experimentalDarkMode');
    expect(result).not.toContain('transparent:true');
  });

  it('injects opaque frameless options into Cursor window builders when transparent is false', () => {
    const result = injectElectronOptions(cursorWindowBuilder, { frameless: true, isMacos: false, transparent: false });
    expect(result).toContain('u.frame=false,u.transparent=false,u.titleBarStyle="hidden"');
  });

  it('does not double-inject if already present', () => {
    const original = loadFixture('main-merged.js');
    const first = injectElectronOptions(original, { frameless: true, isMacos: true });
    const second = injectElectronOptions(first, { frameless: true, isMacos: true });
    expect(second).toBe(first);
  });

  it('does not double-inject assignment-based window builders', () => {
    const first = injectElectronOptions(cursorWindowBuilder, { frameless: true, isMacos: true });
    const second = injectElectronOptions(first, { frameless: true, isMacos: true });
    expect(second).toBe(first);
  });
});

// --- removeElectronOptions ---

describe('removeElectronOptions', () => {
  it('removes frame:false,transparent:true', () => {
    const injected = 'frame:false,transparent:true,experimentalDarkMode';
    expect(removeElectronOptions(injected)).toBe('experimentalDarkMode');
  });

  it('removes frame:false,transparent:false (Win11 Mica)', () => {
    const injected = 'frame:false,transparent:false,experimentalDarkMode';
    expect(removeElectronOptions(injected)).toBe('experimentalDarkMode');
  });

  it('round-trips opaque (transparent:false) inject then remove', () => {
    const original = loadFixture('main-merged.js');
    const injected = injectElectronOptions(original, { frameless: true, isMacos: true, transparent: false });
    expect(removeElectronOptions(injected)).toBe(original);
  });

  it('removes visualEffectState', () => {
    const injected = 'visualEffectState:"active",experimentalDarkMode';
    expect(removeElectronOptions(injected)).toBe('experimentalDarkMode');
  });

  it('removes assignment-based Cursor injections', () => {
    const injected = injectElectronOptions(cursorWindowBuilder, { frameless: true, isMacos: true });
    expect(removeElectronOptions(injected)).toBe(cursorWindowBuilder);
  });

  it('round-trips: inject then remove produces original', () => {
    const original = loadFixture('main-merged.js');
    const injected = injectElectronOptions(original, { frameless: true, isMacos: true });
    const cleaned = removeElectronOptions(injected);
    expect(cleaned).toBe(original);
  });

  it('is safe on content without injections', () => {
    const original = loadFixture('main-merged.js');
    expect(removeElectronOptions(original)).toBe(original);
  });
});

// --- patchCSP ---

describe('patchCSP', () => {
  it('adds VscodeVibrancyContinued to existing trusted-types', () => {
    const html = loadFixture('workbench.html');
    const { result, alreadyPatched, noMetaTag } = patchCSP(html);
    expect(alreadyPatched).toBe(false);
    expect(noMetaTag).toBe(false);
    expect(result).toContain('trusted-types VscodeVibrancyContinued');
  });

  it('reports already patched when VscodeVibrancyContinued is present', () => {
    const html = loadFixture('workbench.html');
    const { result: patched } = patchCSP(html);
    const { alreadyPatched } = patchCSP(patched);
    expect(alreadyPatched).toBe(true);
  });

  it('adds trusted-types directive when none exists', () => {
    const html = loadFixture('workbench-no-trusted-types.html');
    const { result, noMetaTag } = patchCSP(html);
    expect(noMetaTag).toBe(false);
    expect(result).toContain('trusted-types VscodeVibrancyContinued');
  });

  it('reports noMetaTag when no CSP meta tag exists', () => {
    const html = loadFixture('workbench-no-csp.html');
    const { noMetaTag } = patchCSP(html);
    expect(noMetaTag).toBe(true);
  });

  it('removes legacy VscodeVibrancy marker when patching', () => {
    const html = loadFixture('workbench.html')
      .replace('trusted-types', 'trusted-types VscodeVibrancy');
    const { result } = patchCSP(html);
    // Should have VscodeVibrancyContinued but not the bare VscodeVibrancy
    expect(result).toContain('VscodeVibrancyContinued');
    const cspMatch = result.match(/trusted-types ([^"]+)/);
    expect(cspMatch[1]).not.toMatch(/\bVscodeVibrancy\b(?!Continued)/);
  });
});

// --- removeCSPPatch ---

describe('removeCSPPatch', () => {
  it('removes VscodeVibrancyContinued from CSP', () => {
    const html = loadFixture('workbench.html');
    const { result: patched } = patchCSP(html);
    const cleaned = removeCSPPatch(patched);
    expect(cleaned).not.toContain('VscodeVibrancyContinued');
  });

  it('removes legacy VscodeVibrancy marker too', () => {
    const html = 'trusted-types VscodeVibrancy amdLoader';
    const cleaned = removeCSPPatch(html);
    expect(cleaned).not.toContain('VscodeVibrancy');
    expect(cleaned).toContain('amdLoader');
  });

  it('round-trips: patch then remove produces original', () => {
    const html = loadFixture('workbench.html');
    const { result: patched } = patchCSP(html);
    const cleaned = removeCSPPatch(patched);
    expect(cleaned).toBe(html);
  });

  it('removes marker from HTML that originally had no trusted-types directive', () => {
    const html = loadFixture('workbench-no-trusted-types.html');
    const { result: patched } = patchCSP(html);
    expect(patched).toContain('VscodeVibrancyContinued');
    const cleaned = removeCSPPatch(patched);
    expect(cleaned).not.toContain('VscodeVibrancyContinued');
    // Note: an empty "trusted-types" directive remains after removal since
    // patchCSP added the directive and removeCSPPatch only strips the marker name.
    // This is harmless — an empty trusted-types directive is a no-op in browsers.
    expect(cleaned).toContain('trusted-types');
  });

  it('is safe on content without markers', () => {
    const html = loadFixture('workbench-no-csp.html');
    expect(removeCSPPatch(html)).toBe(html);
  });
});

// --- computeTransparentHex ---

describe('computeTransparentHex', () => {
  it('computes fully transparent', () => {
    expect(computeTransparentHex('1e1e1e', 0)).toBe('#1e1e1e00');
  });

  it('computes fully opaque', () => {
    expect(computeTransparentHex('1e1e1e', 1)).toBe('#1e1e1eff');
  });

  it('computes half opacity', () => {
    const result = computeTransparentHex('ffffff', 0.5);
    // 0.5 * 255 = 127.5 -> round to 128 -> 0x80
    expect(result).toBe('#ffffff80');
  });

  it('computes 0.9 opacity', () => {
    const result = computeTransparentHex('1e1e1e', 0.9);
    // 0.9 * 255 = 229.5 -> round to 230 -> 0xe6
    expect(result).toBe('#1e1e1ee6');
  });

  it('computes 0.8 opacity', () => {
    const result = computeTransparentHex('1e1e1e', 0.8);
    // 0.8 * 255 = 204 -> 0xcc
    expect(result).toBe('#1e1e1ecc');
  });
});

// --- Constants ---

describe('ALL_VIBRANCY_BG_KEYS', () => {
  it('contains expected number of keys', () => {
    // 9 transparent + 9 semi-transparent + 8 opaque = 26
    expect(ALL_VIBRANCY_BG_KEYS).toHaveLength(26);
  });

  it('includes key representative keys', () => {
    expect(ALL_VIBRANCY_BG_KEYS).toContain('editor.background');
    expect(ALL_VIBRANCY_BG_KEYS).toContain('sideBar.background');
    expect(ALL_VIBRANCY_BG_KEYS).toContain('editorPane.background');
  });
});

// --- extractBaseColor ---

describe('extractBaseColor', () => {
  it('extracts 6-char hex with #', () => {
    expect(extractBaseColor('#f6f6f6')).toBe('f6f6f6');
  });

  it('extracts 6-char hex without #', () => {
    expect(extractBaseColor('1e1e1e')).toBe('1e1e1e');
  });

  it('strips alpha from 8-char hex', () => {
    expect(extractBaseColor('#f6f6f6ff')).toBe('f6f6f6');
    expect(extractBaseColor('#1e1e1e80')).toBe('1e1e1e');
  });

  it('expands 3-char shorthand hex', () => {
    expect(extractBaseColor('#fff')).toBe('ffffff');
    expect(extractBaseColor('abc')).toBe('aabbcc');
  });

  it('lowercases the result', () => {
    expect(extractBaseColor('#F6F6F6')).toBe('f6f6f6');
    expect(extractBaseColor('AABBCC')).toBe('aabbcc');
  });

  it('returns null for non-string values', () => {
    expect(extractBaseColor(null)).toBeNull();
    expect(extractBaseColor(undefined)).toBeNull();
    expect(extractBaseColor(123)).toBeNull();
  });

  it('returns null for invalid hex strings', () => {
    expect(extractBaseColor('red')).toBeNull();
    expect(extractBaseColor('#gggggg')).toBeNull();
    expect(extractBaseColor('#12345')).toBeNull();
    expect(extractBaseColor('')).toBeNull();
  });
});

// --- computeVibrancyColors ---

describe('computeVibrancyColors', () => {
  const fallback = '1e1e1e';
  const opacity = 0.5;

  it('uses fallback themeBackground when no original colors exist', () => {
    const result = computeVibrancyColors({
      themeBackground: fallback,
      opacity,
      originalColors: {},
    });

    // Transparent keys get #RRGGBB00
    for (const key of TRANSPARENT_BG_KEYS) {
      expect(result[key]).toBe('#1e1e1e00');
    }
    // Semi-transparent keys get opacity applied
    for (const key of SEMITRANSPARENT_BG_KEYS) {
      expect(result[key]).toBe('#1e1e1e80');
    }
    // Opaque keys get 0.9 opacity
    for (const key of OPAQUE_BG_KEYS) {
      expect(result[key]).toBe('#1e1e1ee6');
    }
  });

  it('uses user original color when available', () => {
    const result = computeVibrancyColors({
      themeBackground: fallback,
      opacity,
      originalColors: {
        'sideBar.background': '#f6f6f6',
        'editor.background': '#fdf6e3',
      },
    });

    // sideBar.background is SEMITRANSPARENT — should use f6f6f6, not 1e1e1e
    expect(result['sideBar.background']).toBe('#f6f6f680');
    // editor.background is SEMITRANSPARENT — should use fdf6e3
    expect(result['editor.background']).toBe('#fdf6e380');
    // A key with no original should still use fallback
    expect(result['activityBar.background']).toBe('#1e1e1e80');
  });

  it('uses user original color for transparent keys', () => {
    const result = computeVibrancyColors({
      themeBackground: fallback,
      opacity,
      originalColors: {
        'editorPane.background': '#eee8d5',
      },
    });

    expect(result['editorPane.background']).toBe('#eee8d500');
  });

  it('uses user original color for opaque keys', () => {
    const result = computeVibrancyColors({
      themeBackground: fallback,
      opacity,
      originalColors: {
        'quickInput.background': '#f6f6f6',
      },
    });

    // 0.9 * 255 = 230 -> 0xe6
    expect(result['quickInput.background']).toBe('#f6f6f6e6');
  });

  it('strips alpha from user original before recomputing', () => {
    const result = computeVibrancyColors({
      themeBackground: fallback,
      opacity,
      originalColors: {
        'sideBar.background': '#f6f6f6ff',
      },
    });

    expect(result['sideBar.background']).toBe('#f6f6f680');
  });

  it('falls back to themeBackground for invalid original values', () => {
    const result = computeVibrancyColors({
      themeBackground: fallback,
      opacity,
      originalColors: {
        'sideBar.background': 'not-a-color',
        'editor.background': null,
      },
    });

    expect(result['sideBar.background']).toBe('#1e1e1e80');
    expect(result['editor.background']).toBe('#1e1e1e80');
  });

  it('returns an entry for every vibrancy key', () => {
    const result = computeVibrancyColors({
      themeBackground: fallback,
      opacity,
      originalColors: {},
    });

    expect(Object.keys(result)).toHaveLength(ALL_VIBRANCY_BG_KEYS.length);
    for (const key of ALL_VIBRANCY_BG_KEYS) {
      expect(result[key]).toBeDefined();
    }
  });
});
