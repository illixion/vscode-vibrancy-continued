const crypto = require('crypto');
const path = require('path');
const {
  checksumOf,
  productFileFor,
  checksumKey,
  setChecksum,
  planInstallChecksum,
  planUninstallChecksum,
} = require('../../extension/checksums');

const KEY = 'vs/code/electron-browser/workbench/workbench.html';
const PRISTINE = '<html><head><meta http-equiv="Content-Security-Policy" content="x"></head></html>\n';
const PATCHED = PRISTINE.replace('content="x"', 'content="x vibrancy"');

/** product.json as VSCode ships it: tab-indented, other keys around checksums. */
function product(checksums) {
  return JSON.stringify({
    nameShort: 'Code',
    checksumFailMoreInfoUrl: 'https://go.microsoft.com/fwlink/?LinkId=828886',
    checksums: {
      'vs/base/parts/sandbox/electron-browser/preload.js': 'oSbNaAX1VT0Jx1RpUO5pntFomiyFJnlC7YXxUriVxEw',
      ...checksums,
    },
    commit: 'abc',
  }, null, '\t') + '\n';
}

const storedIn = (text) => JSON.parse(text).checksums[KEY];
const removeVibrancy = (html) => html.replace(' vibrancy', '');

describe('checksumOf', () => {
  it('matches the format product.json uses: SHA-256, base64, no padding', () => {
    const expected = crypto.createHash('sha256').update(Buffer.from(PRISTINE, 'utf-8')).digest('base64');
    expect(expected.endsWith('=')).toBe(true);
    expect(checksumOf(PRISTINE)).toBe(expected.replace(/=+$/, ''));
  });

  it('hashes a string as the UTF-8 bytes it is written as', () => {
    const text = '<title>Vibrancy ✨ 日本語</title>';
    expect(checksumOf(text)).toBe(checksumOf(Buffer.from(text, 'utf-8')));
  });
});

describe('productFileFor / checksumKey', () => {
  it('finds product.json beside the out directory', () => {
    const appDir = path.join('/x', 'resources', 'app', 'out');
    expect(productFileFor(appDir)).toBe(path.join('/x', 'resources', 'app', 'product.json'));
  });

  it('keys a file by its path from out, with forward slashes', () => {
    const appDir = path.join('/x', 'out');
    const html = path.join(appDir, 'vs', 'code', 'electron-browser', 'workbench', 'workbench.html');
    expect(checksumKey(appDir, html)).toBe(KEY);
  });
});

describe('setChecksum', () => {
  it('replaces only that value and keeps the formatting', () => {
    const before = product({ [KEY]: checksumOf(PRISTINE) });
    const after = setChecksum(before, KEY, checksumOf(PATCHED));

    expect(storedIn(after)).toBe(checksumOf(PATCHED));
    expect(after.replace(checksumOf(PATCHED), checksumOf(PRISTINE))).toBe(before);
  });

  it('copes with a checksum containing regex characters', () => {
    const stored = 'a+b/c+d/e+f/g'.padEnd(43, 'h');
    const after = setChecksum(product({ [KEY]: stored }), KEY, 'new$&value');
    expect(storedIn(after)).toBe('new$&value');
  });

  it('leaves the file alone when nothing would change', () => {
    expect(setChecksum(product({ [KEY]: 'same' }), KEY, 'same')).toBeNull();
  });

  it('leaves an editor that does not check the file alone', () => {
    expect(setChecksum(product({}), KEY, 'new')).toBeNull();
    expect(setChecksum(JSON.stringify({ nameShort: 'Code' }), KEY, 'new')).toBeNull();
  });

  it('leaves a product.json it cannot parse alone', () => {
    expect(setChecksum('{ "checksums": {', KEY, 'new')).toBeNull();
    expect(setChecksum('﻿' + product({ [KEY]: 'old' }), KEY, 'new')).toBeNull();
  });

  it('gives up when the value appears under the key more than once', () => {
    const text = product({ [KEY]: 'old' }).replace('"commit"', `"other": { "${KEY}": "old" },\n\t"commit"`);
    expect(setChecksum(text, KEY, 'new')).toBeNull();
  });

  it('gives up when the key is written in a form it does not recognise', () => {
    const text = product({ [KEY]: 'old' }).replace(KEY, KEY.replace(/\//g, '\\/'));
    expect(JSON.parse(text).checksums[KEY]).toBe('old');
    expect(setChecksum(text, KEY, 'new')).toBeNull();
  });

  it('asks before replacing', () => {
    const text = product({ [KEY]: 'old' });
    const asked = [];
    expect(setChecksum(text, KEY, 'new', (stored) => { asked.push(stored); return false; })).toBeNull();
    expect(asked).toEqual(['old']);
  });
});

describe('planInstallChecksum', () => {
  const html = { before: PRISTINE, after: PATCHED, unpatched: PRISTINE };

  it('covers the patch on a pristine install, and records what it replaced', () => {
    const { text, record } = planInstallChecksum(product({ [KEY]: checksumOf(PRISTINE) }), KEY, html);
    expect(storedIn(text)).toBe(checksumOf(PATCHED));
    expect(record).toEqual({ key: KEY, written: checksumOf(PATCHED), previous: checksumOf(PRISTINE) });
  });

  it('covers an install patched before this existed, whose checksum is still the original', () => {
    const { text } = planInstallChecksum(product({ [KEY]: checksumOf(PRISTINE) }), KEY, { ...html, before: PATCHED });
    expect(storedIn(text)).toBe(checksumOf(PATCHED));
  });

  it('follows a re-patch whose checksum was already updated', () => {
    const repatched = PATCHED.replace('vibrancy', 'vibrancy2');
    const { text, record } = planInstallChecksum(product({ [KEY]: checksumOf(PATCHED) }), KEY, {
      before: PATCHED, after: repatched, unpatched: PRISTINE,
    });
    expect(storedIn(text)).toBe(checksumOf(repatched));
    expect(record.previous).toBe(checksumOf(PRISTINE));
  });

  it('keeps the record when the checksum is already right', () => {
    const { text, record } = planInstallChecksum(product({ [KEY]: checksumOf(PATCHED) }), KEY, { ...html, before: PATCHED });
    expect(text).toBeNull();
    expect(record.written).toBe(checksumOf(PATCHED));
  });

  it('leaves the warning when something else has changed the file', () => {
    const foreign = PRISTINE.replace('</head>', '<script src="other.js"></script></head>');
    const { text, record } = planInstallChecksum(product({ [KEY]: checksumOf(PRISTINE) }), KEY, {
      before: foreign,
      after: foreign.replace('content="x"', 'content="x vibrancy"'),
      unpatched: foreign,
    });
    expect(text).toBeNull();
    expect(record).toBeNull();
  });

  it('covers another patcher\'s change once a checksum fixer has accepted it', () => {
    const foreign = PRISTINE.replace('</head>', '<script src="other.js"></script></head>');
    const both = foreign.replace('content="x"', 'content="x vibrancy"');
    const { text, record } = planInstallChecksum(product({ [KEY]: checksumOf(foreign) }), KEY, {
      before: foreign, after: both, unpatched: foreign,
    });
    expect(storedIn(text)).toBe(checksumOf(both));
    expect(record.previous).toBe(checksumOf(foreign));
  });

  it('takes its own checksum back when another patcher changed the file since', () => {
    const record = { key: KEY, written: checksumOf(PATCHED), previous: checksumOf(PRISTINE) };
    const both = PATCHED.replace('</head>', '<script src="other.js"></script></head>');
    const plan = planInstallChecksum(product({ [KEY]: checksumOf(PATCHED) }), KEY, {
      before: both, after: both, unpatched: removeVibrancy(both),
    }, record);
    expect(storedIn(plan.text)).toBe(checksumOf(PRISTINE));
    expect(plan.record).toBeNull();
  });

  it('leaves a product.json without the key alone', () => {
    expect(planInstallChecksum(product({}), KEY, html)).toEqual({ text: null, record: null });
  });
});

describe('planUninstallChecksum', () => {
  const record = { key: KEY, written: checksumOf(PATCHED), previous: checksumOf(PRISTINE) };

  it('puts the original back when the checksum was the patched file\'s', () => {
    const text = planUninstallChecksum(product({ [KEY]: checksumOf(PATCHED) }), KEY, { before: PATCHED, after: PRISTINE });
    expect(storedIn(text)).toBe(checksumOf(PRISTINE));
  });

  it('leaves a checksum it did not write alone', () => {
    const text = product({ [KEY]: checksumOf(PRISTINE) });
    expect(planUninstallChecksum(text, KEY, { before: PATCHED, after: PRISTINE }, record)).toBeNull();
  });

  it('takes its own checksum back when another patcher changed the file since', () => {
    const both = PATCHED.replace('</head>', '<script src="other.js"></script></head>');
    const text = planUninstallChecksum(product({ [KEY]: checksumOf(PATCHED) }), KEY, {
      before: both, after: removeVibrancy(both),
    }, record);
    expect(storedIn(text)).toBe(checksumOf(PRISTINE));
  });

  it('takes it back when the patch is already gone', () => {
    const text = planUninstallChecksum(product({ [KEY]: checksumOf(PATCHED) }), KEY, {
      before: PRISTINE, after: PRISTINE,
    }, record);
    expect(storedIn(text)).toBe(checksumOf(PRISTINE));
  });

  it('only takes its own checksum back when told not to move the value along', () => {
    const fixed = product({ [KEY]: checksumOf(PATCHED) });
    expect(planUninstallChecksum(fixed, KEY, { before: PATCHED, after: PRISTINE }, null, { moveAlong: false })).toBeNull();
    const own = planUninstallChecksum(fixed, KEY, { before: PATCHED, after: PRISTINE }, record, { moveAlong: false });
    expect(storedIn(own)).toBe(checksumOf(PRISTINE));
  });

  it('ignores a record for another file', () => {
    const text = product({ [KEY]: checksumOf(PATCHED) });
    expect(planUninstallChecksum(text, KEY, { before: PRISTINE, after: PRISTINE }, { ...record, key: 'other' })).toBeNull();
  });
});
