const fs = require('fs');
const os = require('os');
const path = require('path');
const { loadMessages, pickLocale } = require('../../extension/locales');
const { checkLocales } = require('../../scripts/check-i18n');

const repoRoot = path.join(__dirname, '../..');

function tempDir(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vibrancy-i18n-'));
  for (const [name, content] of Object.entries(files)) {
    fs.writeFileSync(path.join(dir, name), typeof content === 'string' ? content : JSON.stringify(content));
  }
  return dir;
}

describe('pickLocale', () => {
  const available = ['en', 'ja', 'zh-cn', 'zh-tw', 'pt'];

  it('uses the exact locale when there is one', () => {
    expect(pickLocale('zh-TW', available)).toBe('zh-tw');
    expect(pickLocale('zh-cn', available)).toBe('zh-cn');
  });

  it('falls back to the base language', () => {
    expect(pickLocale('pt-BR', available)).toBe('pt');
  });

  it('falls back to English when the language is not translated', () => {
    expect(pickLocale('de', available)).toBe('en');
    expect(pickLocale('zh-hk', available)).toBe('en');
    expect(pickLocale(undefined, available)).toBe('en');
  });
});

describe('loadMessages', () => {
  it('picks up any package.nls.<locale>.json without registration', () => {
    const dir = tempDir({
      'package.nls.json': { a: 'A' },
      'package.nls.zh-TW.json': { a: '甲' },
      'package.nls.txt': 'ignored',
    });
    expect(loadMessages(dir)).toEqual({ en: { a: 'A' }, 'zh-tw': { a: '甲' } });
  });

  it('skips a translation that is not valid JSON', () => {
    const dir = tempDir({ 'package.nls.json': { a: 'A' }, 'package.nls.fr.json': '{ oops' });
    expect(Object.keys(loadMessages(dir))).toEqual(['en']);
  });
});

describe('checkLocales', () => {
  it('passes for the shipped translations', () => {
    const { results } = checkLocales(repoRoot);
    expect(results.length).toBeGreaterThan(0);
    for (const r of results) expect(r.errors, r.file).toEqual([]);
  });
});
