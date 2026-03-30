const fs = require('fs');
const path = require('path');
const os = require('os');
const {
  generateNewJS,
  removeJSMarkers,
  injectElectronOptions,
  removeElectronOptions,
  patchCSP,
  removeCSPPatch,
} = require('../../extension/file-transforms');

const FIXTURES = path.join(__dirname, '..', 'fixtures');

describe('install/uninstall round-trip', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vibrancy-integration-'));
    // Copy fixtures into a fake VSCode install
    fs.cpSync(FIXTURES, tmpDir, { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe('separate main.js and electron main.js (pre-1.95)', () => {
    it('full install then uninstall restores original files', () => {
      const mainPath = path.join(tmpDir, 'main.js');
      const htmlPath = path.join(tmpDir, 'workbench.html');
      const electronPath = path.join(tmpDir, 'main-merged.js'); // as a stand-in for electron main

      const originalMain = fs.readFileSync(mainPath, 'utf-8');
      const originalHtml = fs.readFileSync(htmlPath, 'utf-8');
      const originalElectron = fs.readFileSync(electronPath, 'utf-8');

      // --- Install ---
      const runtimePath = '/fake/runtime/index.mjs';
      const injectData = { theme: 'Default Dark', os: 'macos' };

      // 1. Inject JS markers
      const newMain = generateNewJS(originalMain, '/app', injectData, runtimePath);
      fs.writeFileSync(mainPath, newMain);
      expect(fs.readFileSync(mainPath, 'utf-8')).toContain('VSCODE-VIBRANCY-START');

      // 2. Patch CSP
      const { result: patchedHtml } = patchCSP(originalHtml);
      fs.writeFileSync(htmlPath, patchedHtml);
      expect(fs.readFileSync(htmlPath, 'utf-8')).toContain('VscodeVibrancyContinued');

      // 3. Inject electron options
      const newElectron = injectElectronOptions(originalElectron, { useFrame: true, isMacos: true });
      fs.writeFileSync(electronPath, newElectron);
      expect(fs.readFileSync(electronPath, 'utf-8')).toContain('frame:false,transparent:true');
      expect(fs.readFileSync(electronPath, 'utf-8')).toContain('visualEffectState:"active"');

      // --- Uninstall ---
      // 1. Remove JS markers
      const { result: cleanedMain } = removeJSMarkers(fs.readFileSync(mainPath, 'utf-8'));
      fs.writeFileSync(mainPath, cleanedMain);

      // 2. Remove CSP patch
      const cleanedHtml = removeCSPPatch(fs.readFileSync(htmlPath, 'utf-8'));
      fs.writeFileSync(htmlPath, cleanedHtml);

      // 3. Remove electron options
      const cleanedElectron = removeElectronOptions(fs.readFileSync(electronPath, 'utf-8'));
      fs.writeFileSync(electronPath, cleanedElectron);

      // --- Verify byte-for-byte match ---
      expect(fs.readFileSync(mainPath, 'utf-8')).toBe(originalMain);
      expect(fs.readFileSync(htmlPath, 'utf-8')).toBe(originalHtml);
      expect(fs.readFileSync(electronPath, 'utf-8')).toBe(originalElectron);
    });
  });

  describe('merged main.js (VSCode 1.95+)', () => {
    it('full install then uninstall on merged file restores original', () => {
      const mergedPath = path.join(tmpDir, 'main-merged.js');
      const htmlPath = path.join(tmpDir, 'workbench.html');
      const original = fs.readFileSync(mergedPath, 'utf-8');
      const originalHtml = fs.readFileSync(htmlPath, 'utf-8');

      // --- Install (both JS injection and electron options on same file) ---
      let content = original;
      content = generateNewJS(content, '/app', { theme: 'dark' }, '/runtime/index.mjs');
      content = injectElectronOptions(content, { useFrame: true, isMacos: true });
      fs.writeFileSync(mergedPath, content);

      const { result: patchedHtml } = patchCSP(originalHtml);
      fs.writeFileSync(htmlPath, patchedHtml);

      // Verify modifications
      const installed = fs.readFileSync(mergedPath, 'utf-8');
      expect(installed).toContain('VSCODE-VIBRANCY-START');
      expect(installed).toContain('frame:false,transparent:true');
      expect(installed).toContain('visualEffectState:"active"');

      // --- Uninstall (all cleanups on single buffer) ---
      let uninstalled = fs.readFileSync(mergedPath, 'utf-8');
      const { result } = removeJSMarkers(uninstalled);
      uninstalled = removeElectronOptions(result);
      fs.writeFileSync(mergedPath, uninstalled);

      const cleanedHtml = removeCSPPatch(fs.readFileSync(htmlPath, 'utf-8'));
      fs.writeFileSync(htmlPath, cleanedHtml);

      // --- Verify byte-for-byte match ---
      expect(fs.readFileSync(mergedPath, 'utf-8')).toBe(original);
      expect(fs.readFileSync(htmlPath, 'utf-8')).toBe(originalHtml);
    });
  });

  describe('edge cases', () => {
    it('double install does not corrupt files', () => {
      const mergedPath = path.join(tmpDir, 'main-merged.js');
      const original = fs.readFileSync(mergedPath, 'utf-8');

      // Install twice
      let content = generateNewJS(original, '/app', { v: 1 }, '/runtime/index.mjs');
      content = injectElectronOptions(content, { useFrame: true, isMacos: false });
      content = generateNewJS(content, '/app', { v: 2 }, '/runtime/index.mjs');
      content = injectElectronOptions(content, { useFrame: true, isMacos: false });

      // Should have exactly one set of markers
      expect((content.match(/VSCODE-VIBRANCY-START/g) || []).length).toBe(1);
      expect((content.match(/frame:false/g) || []).length).toBe(1);

      // Uninstall should still produce original
      const { result } = removeJSMarkers(content);
      expect(removeElectronOptions(result)).toBe(original);
    });

    it('uninstall on clean files is safe', () => {
      const mainPath = path.join(tmpDir, 'main.js');
      const htmlPath = path.join(tmpDir, 'workbench.html');
      const original = fs.readFileSync(mainPath, 'utf-8');
      const originalHtml = fs.readFileSync(htmlPath, 'utf-8');

      // Uninstall on files that were never installed to
      const { result, hadMarkers } = removeJSMarkers(original);
      expect(hadMarkers).toBe(false);
      expect(result).toBe(original);

      const cleanedHtml = removeCSPPatch(originalHtml);
      expect(cleanedHtml).toBe(originalHtml);
    });

    it('handles HTML without CSP meta tag', () => {
      const htmlPath = path.join(tmpDir, 'workbench-no-csp.html');
      const original = fs.readFileSync(htmlPath, 'utf-8');
      const { result, noMetaTag } = patchCSP(original);
      expect(noMetaTag).toBe(true);
      expect(result).toBe(original);
    });
  });
});
