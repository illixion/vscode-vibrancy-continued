const fs = require('fs');
const os = require('os');
const path = require('path');
const { loadMessages, pickLocale } = require('../../extension/locales');
const { checkLocales, placeholders } = require('../../scripts/check-i18n');

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

  it('reports extra keys, empty values and placeholder mismatches', () => {
    const dir = tempDir({
      'package.nls.json': { a: 'Hello {0}', b: 'Two {0} {1}', c: 'C' },
      'package.nls.fr.json': { a: 'Bonjour', b: 'Deux {1} {0}', c: ' ', z: 'extra' },
    });
    const [fr] = checkLocales(dir).results;
    expect(fr.errors).toHaveLength(3);
    expect(fr.errors.join('\n')).toMatch(/"a" must contain the same placeholders/);
    expect(fr.errors.join('\n')).toMatch(/"c" is empty/);
    expect(fr.errors.join('\n')).toMatch(/"z" is not an English key/);
  });

  it('lists untranslated keys as missing, not as errors', () => {
    const dir = tempDir({ 'package.nls.json': { a: 'A', b: 'B' }, 'package.nls.fr.json': { a: 'A' } });
    const [fr] = checkLocales(dir).results;
    expect(fr.errors).toEqual([]);
    expect(fr.missing).toEqual(['b']);
  });

  it('ignores $schema and placeholder order', () => {
    expect(placeholders('{1} then {0}')).toBe(placeholders('{0} then {1}'));
    const dir = tempDir({
      'package.nls.json': { $schema: 'x', a: 'A' },
      'package.nls.fr.json': { $schema: 'y', a: 'A' },
    });
    const [fr] = checkLocales(dir).results;
    expect(fr.errors).toEqual([]);
    expect(fr.missing).toEqual([]);
  });
});
