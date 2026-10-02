const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  extensionsDirOf, readRecord, writeRecord, removeRecord, LEGACY_FILE, RECORDS_DIR,
} = require('../../extension/install-records');

let configDir;
const legacyPath = () => path.join(configDir, LEGACY_FILE);
const readLegacy = () => JSON.parse(fs.readFileSync(legacyPath(), 'utf-8'));
const recordCount = () => {
  try { return fs.readdirSync(path.join(configDir, RECORDS_DIR)).length; } catch { return 0; }
};

const CODE = { extensionsDir: '/home/u/.vscode/extensions', jsPath: '/opt/code/out/main.js' };
const INSIDERS = { extensionsDir: '/home/u/.vscode-insiders/extensions', jsPath: '/opt/insiders/out/main.js' };
const recordFor = (install, extra = {}) => ({ extensionsDir: install.extensionsDir, jsPath: install.jsPath, ...extra });

beforeEach(() => {
  configDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vibrancy-records-'));
});

afterEach(() => {
  fs.rmSync(configDir, { recursive: true, force: true });
});

describe('extensionsDirOf', () => {
  it('is the directory holding the extension folder', () => {
    expect(extensionsDirOf('/home/u/.vscode/extensions/illixion.vscode-vibrancy-continued-1.1.94'))
      .toBe(path.resolve('/home/u/.vscode/extensions'));
  });
});

describe('install records', () => {
  it('keeps each editor\'s record separate', () => {
    writeRecord(configDir, recordFor(CODE, { tag: 'code' }));
    writeRecord(configDir, recordFor(INSIDERS, { tag: 'insiders' }));

    expect(readRecord(configDir, CODE).tag).toBe('code');
    expect(readRecord(configDir, INSIDERS).tag).toBe('insiders');
  });

  it('copies the latest record to config.json for older uninstall hooks', () => {
    writeRecord(configDir, recordFor(CODE, { tag: 'code' }));
    expect(readLegacy().tag).toBe('code');
  });

  it('removing one editor\'s record leaves the other\'s, and hands config.json to it', () => {
    // The bug: Disable in Insiders deleted the only record, so VSCode's
    // uninstall hook later had nothing to unpatch VSCode with.
    writeRecord(configDir, recordFor(CODE, { tag: 'code' }));
    writeRecord(configDir, recordFor(INSIDERS, { tag: 'insiders' }));

    removeRecord(configDir, INSIDERS);

    expect(readRecord(configDir, INSIDERS)).toBeNull();
    expect(readRecord(configDir, CODE).tag).toBe('code');
    expect(readLegacy().tag).toBe('code');
  });

  it('leaves config.json alone when it describes another editor', () => {
    writeRecord(configDir, recordFor(INSIDERS, { tag: 'insiders' }));
    writeRecord(configDir, recordFor(CODE, { tag: 'code' }));

    removeRecord(configDir, INSIDERS);

    expect(readLegacy().tag).toBe('code');
  });

  it('removes config.json with the last record', () => {
    writeRecord(configDir, recordFor(CODE));
    removeRecord(configDir, CODE);

    expect(fs.existsSync(legacyPath())).toBe(false);
    expect(recordCount()).toBe(0);
  });

  it('refuses a record that names no editor', () => {
    expect(() => writeRecord(configDir, { jsPath: '/x' })).toThrow(/extensionsDir/);
  });
});

describe('a config.json from before records were per install', () => {
  beforeEach(() => {
    fs.writeFileSync(legacyPath(), JSON.stringify({ jsPath: CODE.jsPath, tag: 'old' }));
  });

  it('is adopted by the install whose main.js it names', () => {
    expect(readRecord(configDir, CODE).tag).toBe('old');
  });

  it('is not adopted by another editor', () => {
    expect(readRecord(configDir, INSIDERS)).toBeNull();
  });

  it('is adopted by an uninstall hook, which cannot know its main.js', () => {
    expect(readRecord(configDir, { extensionsDir: CODE.extensionsDir }).tag).toBe('old');
  });

  it('is removed only by the install it describes', () => {
    removeRecord(configDir, INSIDERS);
    expect(fs.existsSync(legacyPath())).toBe(true);

    removeRecord(configDir, CODE);
    expect(fs.existsSync(legacyPath())).toBe(false);
  });
});
