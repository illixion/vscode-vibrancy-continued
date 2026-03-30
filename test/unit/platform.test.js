describe('platform detection', () => {
  let originalPlatform;
  let originalRelease;

  beforeEach(() => {
    originalPlatform = process.platform;
    // Clear require cache to re-evaluate platform.js
    delete require.cache[require.resolve('../../extension/platform')];
  });

  afterEach(() => {
    Object.defineProperty(process, 'platform', { value: originalPlatform });
    delete require.cache[require.resolve('../../extension/platform')];
  });

  it('detects macOS', () => {
    Object.defineProperty(process, 'platform', { value: 'darwin' });
    const os = require('../../extension/platform');
    expect(os).toBe('macos');
  });

  it('detects Linux', () => {
    Object.defineProperty(process, 'platform', { value: 'linux' });
    const os = require('../../extension/platform');
    expect(os).toBe('linux');
  });

  it('returns unknown for unsupported platforms', () => {
    Object.defineProperty(process, 'platform', { value: 'freebsd' });
    const os = require('../../extension/platform');
    expect(os).toBe('unknown');
  });
});
