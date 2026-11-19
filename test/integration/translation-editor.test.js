// The translation editor's extension side, driven through its webview message
// protocol the way the page drives it. The page itself is plain DOM code; this
// covers loading, saving, sending and every kind of native preview.
const vscode = require('../helpers/vscode-host');
const fs = require('fs');
const os = require('os');
const path = require('path');

const repoRoot = path.join(__dirname, '../..');
const english = require('../../package.nls.json');
const ja = require('../../package.nls.ja.json');

let editor;
let localize;
let tmp;
let context;
let panel;

function makeContext() {
  return {
    extensionPath: repoRoot,
    globalStorageUri: { fsPath: path.join(tmp, 'globalStorage') },
    globalState: {
      get: (k) => vscode.__state.globalState.get(k),
      update: async (k, v) => { vscode.__state.globalState.set(k, v); },
    },
  };
}

/** Sends a message as the page would and lets the handler finish. */
async function page(message) {
  panel.receive(message);
  for (let i = 0; i < 10; i++) await new Promise((resolve) => setImmediate(resolve));
}

const posted = (type) => panel.posted.filter((m) => m.type === type);
const last = (type) => posted(type).at(-1);

function openEditor(overrides = {}) {
  vscode.__reset(overrides);
  context = makeContext();
  editor.open(context, localize);
  panel = vscode.__state.panels.at(-1);
}

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'vibrancy-translate-'));
  editor = require('../../extension/translation/editor');
  localize = require('../../extension/i18n');
});

afterEach(() => {
  panel?.dispose();
  panel = null;
  localize.setOverride(null);
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe('opening', () => {
  it('opens one panel, and reveals it when opened again', () => {
    openEditor();
    editor.open(context, localize);
    expect(vscode.__state.panels).toHaveLength(1);
    expect(panel.revealed).toBe(1);
  });

  it('serves its scripts with a nonce under a strict policy', () => {
    openEditor();
    const html = panel.webview.html;
    const nonce = /'nonce-([^']+)'/.exec(html)[1];
    expect(html).toContain("default-src 'none'");
    expect(html).toContain(`<script nonce="${nonce}" src="webview:${path.join(repoRoot, 'extension', 'translation', 'rules.js')}">`);
    expect(html).toContain(`<script nonce="${nonce}" src="webview:${path.join(repoRoot, 'extension', 'translation', 'webview', 'editor.js')}">`);
    expect(panel.options.localResourceRoots[0].fsPath).toBe(path.join(repoRoot, 'extension', 'translation'));
  });

  it('sends the catalog, then no language until one is chosen', async () => {
    openEditor({ language: 'zh-tw' });
    await page({ type: 'ready' });
    const init = last('init');
    expect(init.catalog.entries.length).toBe(Object.keys(english).length - 1);
    expect(init.mode).toBe('draft');
    expect(init.languages).toEqual(require('../../extension/translation/languages'));
    expect(init.displayLanguage).toBe('zh-tw');
    expect(last('locale')).toMatchObject({ locale: null, messages: {} });
    expect(last('locale').locales.map((l) => l.code)).toEqual(expect.arrayContaining(['ja', 'zh-cn']));
  });
});

describe('languages', () => {
  it('starts a new language empty and remembers it', async () => {
    openEditor();
    await page({ type: 'ready' });
    await page({ type: 'selectLocale', code: 'XX' });
    expect(last('locale')).toMatchObject({ locale: 'xx', messages: {}, source: 'new', released: false, hasDraft: false });
    expect(vscode.__state.globalState.get('translation.locale')).toBe('xx');
  });

  it('starts an existing language from the released translation', async () => {
    openEditor();
    await page({ type: 'selectLocale', code: 'ja' });
    expect(last('locale')).toMatchObject({ locale: 'ja', source: 'released', released: true });
    expect(last('locale').messages['messages.enabled']).toBe(ja['messages.enabled']);
  });

  it('refuses a code VS Code would never use', async () => {
    openEditor();
    await page({ type: 'selectLocale', code: '../../etc' });
    expect(last('error').message).toMatch(/isn't a language code/);
    expect(posted('locale')).toEqual([]);
  });
});

describe('saving', () => {
  it('writes a draft in global storage, not in the extension', async () => {
    openEditor();
    await page({ type: 'save', locale: 'xx', messages: { 'messages.enabled': '已啟用。', 'messages.disabled': '' } });
    const file = path.join(tmp, 'globalStorage', 'translations', 'package.nls.xx.json');
    expect(last('saved')).toMatchObject({ locale: 'xx', path: file, hasDraft: true });
    expect(JSON.parse(fs.readFileSync(file, 'utf8'))).toEqual({ $schema: './nls-schema.json', 'messages.enabled': '已啟用。' });
    expect(fs.existsSync(path.join(repoRoot, 'package.nls.xx.json'))).toBe(false);

    await page({ type: 'selectLocale', code: 'xx' });
    expect(last('locale')).toMatchObject({ source: 'draft', hasDraft: true });
  });

  it('writes straight into a clone of the repository', async () => {
    const clone = path.join(tmp, 'clone');
    fs.mkdirSync(clone);
    for (const f of ['package.json', 'package.nls.json']) fs.copyFileSync(path.join(repoRoot, f), path.join(clone, f));
    openEditor({ workspaceFolders: [{ uri: { fsPath: clone } }] });
    await page({ type: 'ready' });
    expect(last('init')).toMatchObject({ mode: 'repo', repoRoot: clone });
    await page({ type: 'save', locale: 'zh-tw', messages: { 'messages.enabled': '已啟用。' } });
    expect(last('saved').path).toBe(path.join(clone, 'package.nls.zh-tw.json'));
  });

  it('discards a draft only after confirming', async () => {
    openEditor({ responses: [undefined, 'Discard Draft'] });
    await page({ type: 'save', locale: 'ja', messages: { 'messages.enabled': '下書き' } });

    await page({ type: 'discard', locale: 'ja' });
    expect(last('locale')).toBeUndefined();

    await page({ type: 'discard', locale: 'ja' });
    expect(last('locale')).toMatchObject({ locale: 'ja', source: 'released', hasDraft: false });
  });

  it('updates Vibrancy\'s own messages as you save while the draft setting is on', async () => {
    openEditor({ settings: { 'vscode_vibrancy.useTranslationDraft': true } });
    await page({ type: 'selectLocale', code: 'xx' });
    await page({ type: 'save', locale: 'xx', messages: { 'messages.enabled': '已啟用。' } });
    expect(localize('messages.enabled')).toBe('已啟用。');
    expect(localize('messages.disabled')).toBe(english['messages.disabled']);
  });
});

describe('sending', () => {
  it('copies the file and opens a translation issue', async () => {
    openEditor();
    await page({ type: 'submit', locale: 'zh-tw', languageName: 'Chinese (Taiwan)', messages: { 'messages.enabled': '已啟用。' } });
    expect(JSON.parse(vscode.__state.clipboard)).toEqual({ $schema: './nls-schema.json', 'messages.enabled': '已啟用。' });
    expect(vscode.__state.opened[0]).toBe(
      'https://github.com/illixion/vscode-vibrancy-continued/issues/new?template=translation.yml&title=%5BTranslation%5D%3A%20Chinese%20(Taiwan)%20(zh-tw)',
    );
  });

  it('saves a copy where the translator chooses', async () => {
    const target = path.join(tmp, 'mine.json');
    openEditor({ saveDialogResult: vscode.Uri.file(target) });
    await page({ type: 'saveCopy', locale: 'zh-tw', messages: { 'messages.enabled': '已啟用。' } });
    expect(JSON.parse(fs.readFileSync(target, 'utf8'))['messages.enabled']).toBe('已啟用。');
  });
});

describe('native previews', () => {
  const draft = {
    'messages.enabled': '已啟用。',
    'messages.restartIde': '重新啟動',
    'messages.editorWontStartRestorable': '%1 無法啟動：%2（%3）',
    'extension.installVibrancy.title': '啟用 Vibrancy',
    'terminal.elevationTitle': 'Vibrancy：系統管理員權限',
  };

  beforeEach(() => openEditor());

  it('shows a notification with the draft text and its buttons', async () => {
    await page({ type: 'preview', key: 'messages.restartIde', messages: draft });
    expect(vscode.__state.messages.at(-1)).toEqual({ kind: 'info', message: '已啟用。', options: [{}, '重新啟動'] });
  });

  it('shows a dialog with example values and English fallbacks', async () => {
    await page({ type: 'preview', key: 'messages.editorWontStartRestorable', messages: draft });
    expect(vscode.__state.messages.at(-1)).toEqual({
      kind: 'error',
      message: "Visual Studio Code 無法啟動：main.js（SyntaxError: Unexpected token '}'）",
      options: [{ modal: true, detail: undefined }, english['messages.restartAnyway']],
    });
  });

  it('lists the commands with the draft titles', async () => {
    await page({ type: 'preview', key: 'extension.installVibrancy.title', messages: draft });
    const pick = vscode.__state.quickPicks[0];
    expect(pick.items.map((i) => i.label)).toContain('啟用 Vibrancy');
    expect(pick.activeItems.map((i) => i.label)).toEqual(['啟用 Vibrancy']);
  });

  it('opens a terminal named as the draft says', async () => {
    await page({ type: 'preview', key: 'terminal.elevationPrompt', messages: draft });
    expect(vscode.__state.terminals[0].options.name).toBe('Vibrancy：系統管理員權限');
    expect(vscode.__state.terminals[0].options.pty).toBeDefined();
  });

  it('opens the real setting for context', async () => {
    await page({ type: 'preview', key: 'configuration.type.mica.description', messages: draft });
    expect(vscode.__state.executed.at(-1)).toEqual(['workbench.action.openSettings', 'vscode_vibrancy.type']);
  });
});
