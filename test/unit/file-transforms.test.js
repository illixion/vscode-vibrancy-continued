const fs = require('fs');
const path = require('path');
const {
  generateNewJS,
  removeJSMarkers,
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

// --- injectElectronOptions ---

describe('injectElectronOptions', () => {
  it('injects frame:false,transparent:true when useFrame is true', () => {
    const original = loadFixture('main-merged.js');
    const result = injectElectronOptions(original, { useFrame: true, isMacos: false });
    expect(result).toContain('frame:false,transparent:true,experimentalDarkMode');
  });

  it('does not inject frame options when useFrame is false', () => {
    const original = loadFixture('main-merged.js');
    const result = injectElectronOptions(original, { useFrame: false, isMacos: false });
    expect(result).not.toContain('frame:false');
    expect(result).toContain('experimentalDarkMode');
  });

  it('injects visualEffectState on macOS', () => {
    const original = loadFixture('main-merged.js');
    const result = injectElectronOptions(original, { useFrame: false, isMacos: true });
    expect(result).toContain('visualEffectState:"active",experimentalDarkMode');
  });

  it('injects both frame and visualEffectState on macOS with useFrame', () => {
    const original = loadFixture('main-merged.js');
    const result = injectElectronOptions(original, { useFrame: true, isMacos: true });
    expect(result).toContain('visualEffectState:"active"');
    expect(result).toContain('frame:false,transparent:true');
  });

  it('does not double-inject if already present', () => {
    const original = loadFixture('main-merged.js');
    const first = injectElectronOptions(original, { useFrame: true, isMacos: true });
    const second = injectElectronOptions(first, { useFrame: true, isMacos: true });
    expect(second).toBe(first);
  });
});

// --- removeElectronOptions ---

describe('removeElectronOptions', () => {
  it('removes frame:false,transparent:true', () => {
    const injected = 'frame:false,transparent:true,experimentalDarkMode';
    expect(removeElectronOptions(injected)).toBe('experimentalDarkMode');
  });

  it('removes visualEffectState', () => {
    const injected = 'visualEffectState:"active",experimentalDarkMode';
    expect(removeElectronOptions(injected)).toBe('experimentalDarkMode');
  });

  it('round-trips: inject then remove produces original', () => {
    const original = loadFixture('main-merged.js');
    const injected = injectElectronOptions(original, { useFrame: true, isMacos: true });
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
    // 9 transparent + 10 semi-transparent + 7 opaque = 26
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
