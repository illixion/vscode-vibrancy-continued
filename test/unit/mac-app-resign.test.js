const {
  appBundlePath,
  parseCodesignInfo,
  reSignCommand,
} = require('../../extension/mac-app-resign');
const fs = require('fs');
const path = require('path');

// Guards for the macOS ad-hoc re-sign offered during Enable when the type is
// liquid-glass. The logic itself is pure and tested below; the wiring into
// the install flow is guarded by reading index.js, as in index-wiring.test.js.

describe('appBundlePath', () => {
  it('derives the bundle from the main executable', () => {
    expect(appBundlePath('/Applications/Visual Studio Code.app/Contents/MacOS/Electron'))
      .toBe('/Applications/Visual Studio Code.app');
    expect(appBundlePath('/Applications/Visual Studio Code - Insiders.app/Contents/MacOS/Code - Insiders'))
      .toBe('/Applications/Visual Studio Code - Insiders.app');
  });

  it('rejects paths that are not a macOS app bundle', () => {
    expect(appBundlePath('/usr/local/bin/node')).toBeNull();
    expect(appBundlePath('/Applications/NotABundle/Contents/MacOS/x')).toBeNull();
    expect(appBundlePath('MacOS/Electron')).toBeNull();
    expect(appBundlePath('')).toBeNull();
  });
});

describe('parseCodesignInfo', () => {
  it('reads a real Team ID', () => {
    const info = parseCodesignInfo('Authority=Developer ID Application: Microsoft Corporation (UBF8T3EM6G)\nTeamIdentifier=UBF8T3EM6G\n');
    expect(info).toEqual({ signed: true, teamId: 'UBF8T3EM6G', adHoc: false });
  });

  it('recognises an ad-hoc signature', () => {
    expect(parseCodesignInfo('TeamIdentifier=not set\n').adHoc).toBe(true);
  });

  it('treats missing output as unsigned', () => {
    expect(parseCodesignInfo('codesign: error: code object is not signed at all'))
      .toEqual({ signed: false, teamId: null, adHoc: false });
  });
});

describe('reSignCommand', () => {
  it('force-deep-signs ad-hoc and strips quarantine without masking codesign failures', () => {
    const cmd = reSignCommand('/Applications/Visual Studio Code - Insiders.app');
    expect(cmd).toContain('codesign --force --deep --sign -');
    expect(cmd).toContain("xattr -dr com.apple.quarantine");
    // codesign's exit status must survive: the xattr half is the only part
    // allowed to fail (no quarantine attribute is the common case).
    expect(cmd).toMatch(/codesign [^;]+&& \{ xattr .* \|\| true; \}$/);
  });

  it('single-quotes the path for the shell', () => {
    expect(reSignCommand("/Apps/It's Code.app")).toContain("'/Apps/It'\\''s Code.app'");
  });
});

describe('the re-sign is wired into the install flow', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', '..', 'extension', 'index.js'), 'utf-8');

  const bodyOf = (name) => {
    const lines = source.split('\n');
    const start = lines.findIndex((l) => new RegExp(`^\\s*(async )?function ${name}\\s*\\(`).test(l));
    expect(start, `no declaration of ${name}()`).toBeGreaterThan(-1);
    const close = `${/^\s*/.exec(lines[start])[0]}}`;
    const end = lines.findIndex((l, i) => i > start && l === close);
    expect(end, `closing brace of ${name}()`).toBeGreaterThan(start);
    return lines.slice(start + 1, end).join('\n');
  };

  it('runs from the shared post-install path, so updates offer it too', () => {
    expect(bodyOf('applyPostInstallSettings')).toContain('maybeReSignAppForLiquidGlass()');
  });

  it('only triggers for liquid-glass on macOS, and only for foreign signatures', () => {
    const body = bodyOf('maybeReSignAppForLiquidGlass');
    expect(body).toContain("process.platform !== 'darwin'");
    expect(body).toContain("'liquid-glass'");
    expect(body).toMatch(/if \(!info \|\| !info\.signed \|\| info\.adHoc\) return;/);
  });

  it('asks before re-signing and never fails the install over it', () => {
    const body = bodyOf('maybeReSignAppForLiquidGlass');
    expect(body).toContain('modal: true');
    expect(body).toContain('showWarningMessage');
    // The failure path informs instead of throwing into the install flow.
    expect(body).toMatch(/catch \(err\) \{[\s\S]*liquidGlassReSignFailed/);
  });
});

describe('the consent and failure messages exist in every locale', () => {
  const keys = [
    'messages.liquidGlassReSign',
    'messages.liquidGlassReSignDetail',
    'messages.liquidGlassReSignYes',
    'messages.liquidGlassReSignDone',
    'messages.liquidGlassReSignFailed',
  ];
  for (const file of ['package.nls.json', 'package.nls.ja.json', 'package.nls.zh-cn.json']) {
    it(`${file} defines them all`, () => {
      const strings = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', file), 'utf-8'));
      for (const key of keys) {
        expect(strings[key], key).toBeTruthy();
      }
    });
  }
});
