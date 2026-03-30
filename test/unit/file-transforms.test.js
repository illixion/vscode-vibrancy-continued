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
  VIBRANCY_START,
  VIBRANCY_END,
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
    // 9 transparent + 12 semi-transparent + 5 opaque = 26
    expect(ALL_VIBRANCY_BG_KEYS).toHaveLength(26);
  });

  it('includes key representative keys', () => {
    expect(ALL_VIBRANCY_BG_KEYS).toContain('editor.background');
    expect(ALL_VIBRANCY_BG_KEYS).toContain('sideBar.background');
    expect(ALL_VIBRANCY_BG_KEYS).toContain('editorPane.background');
  });
});
