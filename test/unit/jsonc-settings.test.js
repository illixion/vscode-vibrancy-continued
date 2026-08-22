const {
  detectFormatting,
  parseSettings,
  readColorCustomizations,
  editSettings,
  applySettingsRestore,
} = require('../../extension/jsonc-settings');

describe('detectFormatting', () => {
  it('reads the indent unit off the file', () => {
    expect(detectFormatting('{\n  "a": 1\n}\n')).toEqual({ tabSize: 2, insertSpaces: true, eol: '\n' });
    expect(detectFormatting('{\n    "a": 1\n}\n')).toEqual({ tabSize: 4, insertSpaces: true, eol: '\n' });
  });

  it('recognises tab indentation', () => {
    expect(detectFormatting('{\n\t"a": 1\n}\n')).toEqual({ tabSize: 4, insertSpaces: false, eol: '\n' });
  });

  it('recognises CRLF', () => {
    expect(detectFormatting('{\r\n  "a": 1\r\n}\r\n').eol).toBe('\r\n');
  });

  it('falls back to VSCode defaults when there is nothing to go on', () => {
    for (const value of ['{}', '', undefined, null]) {
      expect(detectFormatting(value)).toEqual({ tabSize: 4, insertSpaces: true, eol: '\n' });
    }
  });

  it('ignores blank lines that only contain whitespace', () => {
    // A stray indented empty line says nothing about the indent unit; taking it
    // as the answer would reformat the whole edited region.
    expect(detectFormatting('{\n        \n  "a": 1\n}\n').tabSize).toBe(2);
  });
});

describe('parseSettings', () => {
  it('accepts everything VSCode accepts', () => {
    const { value, errors } = parseSettings(`{
      // a comment
      "a": 1,
      /* another */
      "b": 2,
    }`);

    expect(errors).toEqual([]);
    expect(value).toEqual({ a: 1, b: 2 });
  });

  it('reports damage instead of throwing', () => {
    const { errors } = parseSettings('{\n  "a": 1,\n');
    expect(errors.length).toBeGreaterThan(0);
  });
});

describe('readColorCustomizations', () => {
  it('reads the block', () => {
    expect(readColorCustomizations('{"workbench.colorCustomizations": {"a": "#112233ff"}}'))
      .toEqual({ a: '#112233ff' });
  });

  it('returns an empty map when the block is absent or the wrong shape', () => {
    expect(readColorCustomizations('{"a": 1}')).toEqual({});
    expect(readColorCustomizations('{"workbench.colorCustomizations": []}')).toEqual({});
    expect(readColorCustomizations('{"workbench.colorCustomizations": "nope"}')).toEqual({});
    expect(readColorCustomizations('not json at all')).toEqual({});
  });
});

describe('editSettings', () => {
  it('applies several edits in sequence without stale offsets', () => {
    // Each edit is computed against the text produced by the previous one.
    // Batching them would place the second at an offset that no longer exists.
    const result = editSettings('{\n  "a": 1,\n  "b": 2\n}\n', [
      { path: ['a'], value: undefined },
      { path: ['c'], value: 3 },
    ]);

    expect(parseSettings(result).value).toEqual({ b: 2, c: 3 });
    expect(parseSettings(result).errors).toEqual([]);
  });
});

describe('applySettingsRestore', () => {
  const settings = `{
    // Keep me — this comment is the user's.
    "editor.fontSize": 13,
    "workbench.colorCustomizations": {
        "editor.background": "#1e1e1ecc",
        "sideBar.background": "#1e1e1e80",
        "terminal.background": "#00000000",
        "activityBar.foreground": "#ff0000"
    },
    "terminal.integrated.gpuAcceleration": "off",
    "window.controlsStyle": "custom"
}
`;

  it('removes vibrancy keys and restores the user originals', () => {
    const { text, changed, errors } = applySettingsRestore(settings, {
      colors: {
        'editor.background': null,
        'sideBar.background': '#2d2d2dff',
        'terminal.background': null,
      },
      settings: {
        'terminal.integrated.gpuAcceleration': 'auto',
        'window.controlsStyle': null,
      },
    });

    expect(errors).toEqual([]);
    expect(changed).toBe(true);

    const { value } = parseSettings(text);
    expect(value['workbench.colorCustomizations']).toEqual({
      'sideBar.background': '#2d2d2dff',
      // Untouched: not a key vibrancy manages, so not ours to remove.
      'activityBar.foreground': '#ff0000',
    });
    expect(value['terminal.integrated.gpuAcceleration']).toBe('auto');
    expect(value['window.controlsStyle']).toBeUndefined();
    expect(value['editor.fontSize']).toBe(13);
  });

  it("leaves the user's comments and indentation alone", () => {
    const { text } = applySettingsRestore(settings, { colors: { 'editor.background': null } });

    expect(text).toContain("// Keep me — this comment is the user's.");
    // 4-space file stays a 4-space file — the regex approach used to leave
    // `"key": "value",\n            ` debris behind instead.
    expect(text).toContain('\n    "editor.fontSize": 13,');
    // Nested keys sit at 8; anything deeper is leftover indentation debris.
    expect(text).not.toMatch(/\n {9,}"/);
  });

  it('refuses to touch a settings.json that does not parse', () => {
    const broken = '{\n  "workbench.colorCustomizations": {\n    "editor.background": "#1e1e1ecc",\n';

    const { text, changed, errors } = applySettingsRestore(broken, {
      colors: { 'editor.background': null },
    });

    // jsonc.modify happily edits a malformed document into a worse one, so the
    // error list is the only thing preventing that write.
    expect(errors.length).toBeGreaterThan(0);
    expect(changed).toBe(false);
    expect(text).toBe(broken);
  });

  it('drops the colour block once it is empty, but not while the user still has colours', () => {
    const onlyOurs = '{\n  "workbench.colorCustomizations": {\n    "editor.background": "#1e1e1ecc"\n  }\n}\n';
    const emptied = applySettingsRestore(onlyOurs, { colors: { 'editor.background': null } });
    expect(parseSettings(emptied.text).value).toEqual({});
    expect(emptied.text).not.toContain('colorCustomizations');

    const shared = applySettingsRestore(
      '{\n  "workbench.colorCustomizations": {\n    "editor.background": "#1e1e1ecc",\n    "mine": "#abcdef"\n  }\n}\n',
      { colors: { 'editor.background': null } },
    );
    expect(parseSettings(shared.text).value['workbench.colorCustomizations']).toEqual({ mine: '#abcdef' });
  });

  it('does not invent keys a profile never had', () => {
    // Restoring a value into a profile that never carried the key would be
    // adding a customization the user never asked for.
    const { text, changed } = applySettingsRestore('{\n  "editor.fontSize": 13\n}\n', {
      colors: { 'editor.background': '#2d2d2dff' },
    });

    expect(changed).toBe(false);
    expect(text).not.toContain('editor.background');
  });

  it('reports no change when there is nothing of ours left', () => {
    const clean = '{\n  "editor.fontSize": 13\n}\n';
    expect(applySettingsRestore(clean, { colors: { 'editor.background': null } }))
      .toEqual({ text: clean, changed: false, errors: [] });
  });

  it('scopes colour keys to the colour block', () => {
    // A regex matching `"editor.background"` anywhere in the file would hit
    // this top-level key too. Structure is the whole point of the parser.
    const odd = '{\n  "editor.background": "#1e1e1ecc",\n  "workbench.colorCustomizations": {\n    "editor.background": "#1e1e1ecc"\n  }\n}\n';
    const { text } = applySettingsRestore(odd, { colors: { 'editor.background': null } });

    const { value } = parseSettings(text);
    expect(value['editor.background']).toBe('#1e1e1ecc');
    expect(value['workbench.colorCustomizations']).toBeUndefined();
  });

  it('keeps CRLF files on CRLF', () => {
    const crlf = '{\r\n    "a": 1,\r\n    "window.controlsStyle": "custom"\r\n}\r\n';
    const { text } = applySettingsRestore(crlf, { settings: { 'window.controlsStyle': null } });

    expect(text).not.toMatch(/[^\r]\n/);
  });
});
