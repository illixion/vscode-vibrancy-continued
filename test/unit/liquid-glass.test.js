const fs = require('fs');
const path = require('path');

// Guards for the macOS Liquid Glass feature ("vscode_vibrancy.type":
// "liquid-glass"): a native NSGlassEffectView addon replaces Electron's
// setVibrancy() on macOS 26+, with a fallback to under-window vibrancy.
//
// The runtime (runtime/index.mjs + runtime-pre-esm/index.cjs) executes inside
// VSCode's Electron main process and can't be loaded here — 'electron' and the
// injected global don't exist — so, as in index-wiring.test.js, the invariants
// that matter are guarded by reading the source. Every guard below corresponds
// to a way this feature could silently break: the two macOS effect paths
// fighting each other, the addon never being staged next to the runtime, or
// the setting not reaching the user.

const root = path.join(__dirname, '..', '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf-8');

const runtimeFiles = ['runtime/index.mjs', 'runtime-pre-esm/index.cjs'];

describe('the liquid-glass setting is contributed', () => {
  const pkg = require('../../package.json');
  const type = pkg.contributes.configuration.properties['vscode_vibrancy.type'];

  it('is in the type enum', () => {
    expect(type.enum).toContain('liquid-glass');
  });

  it('keeps enumDescriptions aligned with the enum', () => {
    // VSCode zips these two arrays positionally; a misaligned description
    // silently documents the wrong type.
    expect(type.enumDescriptions).toHaveLength(type.enum.length);
    const idx = type.enum.indexOf('liquid-glass');
    expect(type.enumDescriptions[idx]).toBe('%configuration.type.liquid-glass.description%');
  });

  it('is described in every bundled locale and the nls schema', () => {
    for (const nls of ['package.nls.json', 'package.nls.ja.json', 'package.nls.zh-cn.json']) {
      const strings = JSON.parse(read(nls));
      expect(strings['configuration.type.liquid-glass.description'], nls).toBeTruthy();
    }
    const schema = JSON.parse(read('nls-schema.json'));
    expect(schema.properties['configuration.type.liquid-glass.description']).toBeTruthy();
    expect(schema.required).toContain('configuration.type.liquid-glass.description');
  });
});

describe.each(runtimeFiles)('%s liquid-glass wiring', (file) => {
  const src = read(file);

  it('accepts liquid-glass on macOS instead of coercing it to auto', () => {
    // The macOS type validation would otherwise rewrite the unknown type to
    // 'auto' and the user's choice would never reach the effect branch.
    expect(src).toMatch(/!macosType\.includes\(type\) && type !== LIQUID_GLASS_TYPE/);
    expect(src).not.toContain("'liquid-glass',\n];"); // not smuggled into macosType/setVibrancy list
    expect(src.match(/const macosType = \[[\s\S]*?\];/)[0]).not.toContain('liquid-glass');
  });

  it('routes liquid-glass to the native addon and every other macOS type to setVibrancy', () => {
    // The two effects are mutually exclusive: calling setVibrancy() alongside
    // the glass view makes Electron install an NSVisualEffectView that hides
    // the glass. The branch order IS the guarantee, so guard the exact shape.
    expect(src).toMatch(
      /if \(isLiquidGlass\) \{\s*\/\/[^\n]*\n(\s*\/\/[^\n]*\n)*\s*glassViewId = applyLiquidGlass\(window\);\s*\} else if \(app\.os === 'macos' && !isUniversalType\) \{\s*window\.setVibrancy\(type\);/
    );
  });

  it('never passes liquid-glass to setVibrancy', () => {
    expect(src).not.toMatch(/setVibrancy\(LIQUID_GLASS/);
    expect(src).not.toContain("setVibrancy('liquid-glass')");
  });

  it('loads the per-arch native addon from beside the runtime', () => {
    expect(src).toContain('liquidglass-darwin-${process.arch}.node');
  });

  it('falls back to Electron under-window vibrancy when glass is unavailable', () => {
    // macOS < 26, a missing prebuilt, or a failed addView must degrade to the
    // supported API rather than show a broken/opaque window.
    expect(src).toContain("setVibrancy('under-window')");
    expect(src).toMatch(/!glass\.isGlassSupported\(\)/);
  });

  it('keeps Chromium fully transparent so the glass shows through', () => {
    expect(src).toContain("window.setBackgroundColor('#00000000')");
  });

  it('releases the native view when the window closes', () => {
    expect(src).toMatch(/removeView\(glassViewId\)/);
  });

  it('injects the translucent-surface CSS overlay only for liquid-glass', () => {
    expect(src).toContain('liquidGlassCSS');
    expect(src).toMatch(/\$\{isLiquidGlass \? liquidGlassCSS\(\) : ''\}/);
    // The overlay must land after the theme CSS to win equal-specificity ties.
    expect(src.indexOf('${themeCSS}')).toBeLessThan(src.indexOf("${isLiquidGlass ? liquidGlassCSS() : ''}"));
  });

  it('gives liquid-glass its own default html opacity, honoring explicit values', () => {
    const styleBody = src.slice(src.indexOf('function styleHTML()'));
    const explicitCheck = styleBody.indexOf('opacity < 0');
    const defaultLine = styleBody.indexOf('LIQUID_GLASS_DEFAULT_OPACITY');
    expect(explicitCheck).toBeGreaterThan(-1);
    // The liquid-glass default lives inside the "theme default" (< 0) branch,
    // so an explicitly-set vscode_vibrancy.opacity is never overridden.
    expect(defaultLine).toBeGreaterThan(explicitCheck);
    // 0 is unreadable over the glass and the theme-era values wash it out.
    expect(src).toMatch(/const LIQUID_GLASS_DEFAULT_OPACITY = 0\.6;/);
  });
});

describe('the native addon source', () => {
  const mm = read('native/liquidglass.mm');

  it('looks NSGlassEffectView up dynamically (private API, older-SDK safe)', () => {
    expect(mm).toContain('NSClassFromString(@"NSGlassEffectView")');
  });

  it('falls back to NSVisualEffectView when the glass class is missing', () => {
    expect(mm).toContain('NSVisualEffectView');
    expect(mm).toContain('NSVisualEffectBlendingModeBehindWindow');
  });

  it('inserts the view below the web content and lets it follow resizes', () => {
    expect(mm).toContain('NSWindowBelow');
    expect(mm).toContain('NSViewWidthSizable | NSViewHeightSizable');
  });

  it('exposes the JS surface the runtime calls', () => {
    for (const api of ['addView', 'setVariant', 'removeView', 'isGlassSupported']) {
      expect(mm, api).toContain(`"${api}"`);
    }
    expect(mm).toContain('NODE_API_MODULE');
  });

  it('has a darwin gyp config building it as an N-API addon', () => {
    const gyp = read('binding.gyp.mac.dist');
    expect(gyp).toContain('"target_name": "liquidglass"');
    expect(gyp).toContain('native/liquidglass.mm');
    expect(gyp).toContain('AppKit');
    expect(gyp).toContain('NAPI_VERSION=8');
  });
});

describe('the installer stages the addon', () => {
  const src = read('extension/index.js');

  /** Body of a named function declaration in extension/index.js (see index-wiring.test.js). */
  const bodyOf = (name) => {
    const lines = src.split('\n');
    const start = lines.findIndex((l) => new RegExp(`^\\s*(async )?function ${name}\\s*\\(`).test(l));
    expect(start, `no declaration of ${name}()`).toBeGreaterThan(-1);
    const close = `${/^\s*/.exec(lines[start])[0]}}`;
    const end = lines.findIndex((l, i) => i > start && l === close);
    expect(end, `closing brace of ${name}()`).toBeGreaterThan(start);
    return lines.slice(start + 1, end).join('\n');
  };

  it('copies the darwin prebuilts into the runtime dir on macOS', () => {
    const body = bodyOf('installRuntime');
    expect(body).toContain("process.platform === 'darwin'");
    expect(body).toMatch(/liquidglass-darwin-\(arm64\|x64\)\\\.node/);
    expect(body).toContain('copyFile');
  });

  it('does not ship the darwin prebuilts into Windows installs', () => {
    expect(bodyOf('installRuntimeWin')).toContain("file.startsWith('liquidglass-darwin-')");
  });

  it('flags liquid-glass as needing a transparent window (macOS only)', () => {
    const body = bodyOf('modifyElectronJSFile');
    expect(body).toMatch(/osType === 'macos' && resolvedType === 'liquid-glass'/);
  });
});

describe('the publish pipeline builds the addon', () => {
  const yml = read('.github/workflows/publish.yml');

  it('has a macOS job producing both-arch prebuilts', () => {
    expect(yml).toContain('build-native-mac:');
    expect(yml).toContain('liquidglass-darwin-arm64.node');
    expect(yml).toContain('liquidglass-darwin-x64.node');
  });

  it('gates packaging on the macOS build', () => {
    expect(yml).toMatch(/needs: \[build-native, build-native-mac\]/);
    expect(yml).toContain('name: native-darwin');
  });
});
