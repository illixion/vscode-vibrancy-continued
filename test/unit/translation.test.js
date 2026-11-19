const fs = require('fs');
const os = require('os');
const path = require('path');
const rules = require('../../extension/translation/rules');
const messagesMeta = require('../../extension/translation/messages-meta');
const { buildCatalog, markdownKeys, settingLabel } = require('../../extension/translation/catalog');
const { DraftStore, findRepo, normalizeLocale } = require('../../extension/translation/draft-store');

const repoRoot = path.join(__dirname, '../..');
const english = require('../../package.nls.json');
const pkg = require('../../package.json');

function tempDir(files = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vibrancy-translation-'));
  for (const [name, content] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, name)), { recursive: true });
    fs.writeFileSync(path.join(dir, name), typeof content === 'string' ? content : JSON.stringify(content));
  }
  return dir;
}

describe('rules.placeholders', () => {
  it('finds both styles, once each, sorted', () => {
    expect(rules.placeholders('%1 and {0}, then %1 again and %2')).toEqual(['%1', '%2', '{0}']);
  });
});

describe('rules.checkEntry', () => {
  it('accepts placeholders in any order and repeated', () => {
    expect(rules.checkEntry('%1 then %2', '%2 avant %1 et %1')).toEqual([]);
  });

  it('reports a missing placeholder and an unknown one', () => {
    const problems = rules.checkEntry('Hello %1', 'Bonjour %2');
    expect(problems).toHaveLength(2);
    expect(problems[0]).toMatch(/Missing %1/);
    expect(problems[1]).toMatch(/%2 isn't a placeholder/);
  });

  it('has nothing to say about an empty translation', () => {
    expect(rules.checkEntry('Hello %1', '  ')).toEqual([]);
  });

  it('flags backticks and ** in plain text, but not in Markdown', () => {
    expect(rules.checkEntry('Use the setting', 'Utilisez `le réglage`')[0]).toMatch(/backticks/);
    expect(rules.checkEntry('Use the setting', '**Utilisez**')[0]).toMatch(/backticks/);
    expect(rules.checkEntry('Use the setting', 'Utilisez `le réglage`', { markdown: true })).toEqual([]);
  });

  it('requires link targets to be kept', () => {
    const en = '[Open the editor](command:extension.translateVibrancy) to help.';
    expect(rules.checkEntry(en, '[Ouvrir](command:extension.translateVibrancy) pour aider.', { markdown: true })).toEqual([]);
    expect(rules.checkEntry(en, 'Ouvrir l\'éditeur pour aider.', { markdown: true })[0]).toMatch(/Keep the link/);
  });
});

describe('rules.checkFile', () => {
  it('reports extra keys, empty values and placeholder mismatches; lists missing ones', () => {
    const en = { $schema: 'x', a: 'Hello {0}', b: 'Two', c: 'C', d: 'D' };
    const { errors, missing } = rules.checkFile(en, { $schema: 'y', a: 'Bonjour', b: ' ', c: 'C', z: 'extra' });
    expect(errors).toHaveLength(3);
    expect(errors.join('\n')).toMatch(/"z" is not an English key/);
    expect(errors.join('\n')).toMatch(/"b" is empty/);
    expect(errors.join('\n')).toMatch(/"a": Missing \{0\}/);
    expect(missing).toEqual(['d']);
  });

  it('allows Markdown only in the keys it is told about', () => {
    const en = { a: 'A', b: 'B' };
    const messages = { a: '`A`', b: '`B`' };
    expect(rules.checkFile(en, messages, ['b']).errors).toEqual([expect.stringMatching(/^"a": .*backticks/)]);
  });
});

describe('rules.serialize', () => {
  it('writes English key order, only translated strings, schema first, final newline', () => {
    const en = { $schema: './nls-schema.json', b: 'B', a: 'A', c: 'C' };
    const text = rules.serialize(en, { a: 'Ä', c: '', b: 'Bé', stray: 'x' });
    expect(text).toBe('{\n  "$schema": "./nls-schema.json",\n  "b": "Bé",\n  "a": "Ä"\n}\n');
  });
});

describe('rules.composeNotification', () => {
  const lookup = (key) => english[key];

  it('shows a thrown error inside the generic failure message', () => {
    const n = rules.composeNotification(messagesMeta, 'messages.patchWontLoad', lookup);
    expect(n.kind).toBe('error');
    const text = rules.segmentsText(n.message);
    expect(text.startsWith(english['messages.smthingwrong'] + 'Error: ')).toBe(true);
    expect(text).toContain('main.js');
    expect(text).not.toContain('%1');
    expect(text.endsWith(rules.KNOWN_ERRORS_TAIL)).toBe(true);
  });

  it('previews a button on the message it belongs to', () => {
    const n = rules.composeNotification(messagesMeta, 'messages.restartAnyway', lookup);
    expect(n.main).toBe('messages.editorWontStartRestorable');
    expect(n.modal).toBe(true);
    expect(n.highlight).toBe('messages.restartAnyway');
    expect(n.buttons).toEqual([{ key: 'messages.restartAnyway', text: english['messages.restartAnyway'] }]);
  });

  it('previews a dialog detail with its heading, filling every occurrence of a placeholder', () => {
    const n = rules.composeNotification(messagesMeta, 'messages.nixRelaunch', lookup);
    expect(n.highlight).toBe('detail');
    expect(rules.segmentsText(n.message)).toBe(english['messages.nixRelaunchTitle']);
    expect(rules.segmentsText(n.detail)).not.toMatch(/%1/);

    const all = rules.composeNotification(messagesMeta, 'messages.editorWontStartRestorable', lookup);
    expect(rules.segmentsText(all.message)).not.toMatch(/%\d/);
  });

  it('keeps English button labels the code passes as-is', () => {
    const n = rules.composeNotification(messagesMeta, 'messages.electronDeprecatedType', lookup);
    expect(n.buttons).toEqual([{ text: 'Default', fixed: true }, { text: 'Transparent', fixed: true }]);
  });
});

describe('catalog', () => {
  const catalog = buildCatalog(repoRoot);
  const keys = Object.keys(english).filter(k => !rules.isMeta(k));

  it('describes every string exactly once, none left uncategorised', () => {
    expect(catalog.entries.map(e => e.key).sort()).toEqual([...keys].sort());
    expect(catalog.entries.filter(e => e.group === 'other').map(e => e.key)).toEqual([]);
  });

  it('has metadata for every runtime string, and only for real ones', () => {
    const runtime = catalog.entries.filter(e => e.group === 'notifications' || e.group === 'terminal').map(e => e.key);
    expect(Object.keys(messagesMeta).sort()).toEqual([...runtime].sort());
  });

  it('links buttons, details and wrappers to messages of the right kind', () => {
    const shown = ['info', 'warning', 'error'];
    for (const [key, meta] of Object.entries(messagesMeta)) {
      for (const button of meta.buttons || []) expect(messagesMeta[button].kind, `${key} → ${button}`).toBe('button');
      if (meta.detail) expect(messagesMeta[meta.detail].kind).toBe('detail');
      if (meta.wrappedBy) expect(messagesMeta[meta.wrappedBy].appended).toBeDefined();
      for (const parent of meta.usedBy || []) {
        expect(shown, `${key} usedBy ${parent}`).toContain(messagesMeta[parent].kind);
        const refs = [...(messagesMeta[parent].buttons || []), messagesMeta[parent].detail];
        expect(refs, `${parent} should list ${key}`).toContain(key);
      }
    }
  });

  it('has a sample value for every placeholder', () => {
    for (const [key, meta] of Object.entries(messagesMeta)) {
      expect(Object.keys(meta.samples || {}).sort(), key).toEqual(rules.placeholders(english[key]));
    }
  });

  it('refers only to strings the code or the manifest uses', () => {
    const source = fs.readdirSync(path.join(repoRoot, 'extension'))
      .filter(f => f.endsWith('.js'))
      .map(f => fs.readFileSync(path.join(repoRoot, 'extension', f), 'utf8'))
      .join('\n') + JSON.stringify(pkg);
    const unused = keys.filter(k => !source.includes(`'${k}'`) && !source.includes(`"${k}"`) && !source.includes(`%${k}%`));
    expect(unused).toEqual([]);
  });

  it('maps settings and commands to the manifest', () => {
    for (const e of catalog.entries.filter(x => x.group === 'settings')) {
      expect(pkg.contributes.configuration.properties[e.setting], e.key).toBeDefined();
    }
    expect(catalog.commands.map(c => c.id)).toEqual(pkg.contributes.commands.map(c => c.command));
    const type = catalog.entries.find(e => e.key === 'configuration.type.acrylic.description');
    expect(type).toMatchObject({ setting: 'vscode_vibrancy.type', field: 'enum' });
    expect(catalog.settings['vscode_vibrancy.type'].enum[type.enumIndex]).toBe('acrylic');
  });

  it('treats only Markdown fields as Markdown', () => {
    expect(markdownKeys(catalog)).toEqual(['configuration.useTranslationDraft.description']);
  });

  it('keeps Markdown out of English strings VS Code shows as plain text', () => {
    const plain = catalog.entries.filter(e => !e.markdown);
    for (const e of plain) expect(e.english, e.key).not.toMatch(/`|\*\*/);
  });

  it('links the Settings description to a command that exists', () => {
    const text = english['configuration.useTranslationDraft.description'];
    const target = /\]\(command:([^)]+)\)/.exec(text)[1];
    expect(pkg.contributes.commands.map(c => c.command)).toContain(target);
  });

  it('keeps nls-schema.json in step with the English keys, with every key optional', () => {
    const schema = require('../../nls-schema.json');
    expect(Object.keys(schema.properties).sort()).toEqual(['$schema', ...keys].sort());
    expect(schema.required).toBeUndefined();
    expect(schema.additionalProperties).toBe(false);
  });

  it('labels settings like the Settings editor', () => {
    expect(settingLabel('vscode_vibrancy.enableAutoTheme')).toEqual({ category: 'Vscode_vibrancy', name: 'Enable Auto Theme' });
  });
});

describe('DraftStore', () => {
  const en = { $schema: './nls-schema.json', a: 'A', b: 'B' };

  it('starts from the released translation and saves drafts outside the extension', () => {
    const ext = tempDir({ 'package.json': { name: 'x' }, 'package.nls.json': en, 'package.nls.ja.json': { a: 'エー' } });
    const storage = tempDir();
    const store = new DraftStore({ extensionRoot: ext, storageDir: storage });

    expect(store.mode).toBe('draft');
    expect(store.load('ja')).toEqual({ messages: { a: 'エー' }, source: 'released' });
    expect(store.load('ko')).toEqual({ messages: {}, source: 'new' });

    const file = store.save('ja', { a: 'エー', b: 'ビー' });
    expect(file).toBe(path.join(storage, 'translations', 'package.nls.ja.json'));
    expect(store.load('ja')).toEqual({ messages: { $schema: './nls-schema.json', a: 'エー', b: 'ビー' }, source: 'draft' });
    expect(JSON.parse(fs.readFileSync(path.join(ext, 'package.nls.ja.json'), 'utf8'))).toEqual({ a: 'エー' });

    store.save('ko', { a: '에이' });
    expect(store.locales()).toEqual([
      { code: 'ja', released: true, draft: true },
      { code: 'ko', released: false, draft: true },
    ]);

    store.discard('ja');
    expect(store.load('ja').source).toBe('released');
  });

  it('edits the repo files directly in a clone of the extension', () => {
    const repo = tempDir({ 'package.json': { name: 'vscode-vibrancy-continued' }, 'package.nls.json': en, 'package.nls.ja.json': { a: 'エー' } });
    const other = tempDir({ 'package.json': { name: 'something-else' } });
    expect(findRepo([other, repo])).toBe(repo);
    expect(findRepo([other])).toBe(null);

    const store = new DraftStore({ extensionRoot: tempDir(), storageDir: tempDir(), repoRoot: repo });
    expect(store.mode).toBe('repo');
    expect(store.load('ja').source).toBe('repo');
    store.save('zh-tw', { b: '乙' });
    expect(fs.readFileSync(path.join(repo, 'package.nls.zh-tw.json'), 'utf8')).toBe('{\n  "$schema": "./nls-schema.json",\n  "b": "乙"\n}\n');
    expect(store.locales().map(l => l.code)).toEqual(['ja', 'zh-tw']);
  });

  it('accepts VS Code locale codes only', () => {
    expect(normalizeLocale('zh-TW')).toBe('zh-tw');
    expect(normalizeLocale('pt_BR')).toBe('pt-br');
    expect(normalizeLocale('en')).toBe(null);
    expect(normalizeLocale('../etc')).toBe(null);
    expect(normalizeLocale('')).toBe(null);
  });
});
