const osModule = require('os');

describe('platform detection', () => {
  let originalPlatform;
  let originalRelease;

  beforeEach(() => {
    originalPlatform = process.platform;
    originalRelease = osModule.release;
    // Clear require cache to re-evaluate platform.js
    delete require.cache[require.resolve('../../extension/platform')];
  });

  afterEach(() => {
    Object.defineProperty(process, 'platform', { value: originalPlatform });
    osModule.release = originalRelease;
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

  it('detects Windows 10+', () => {
    Object.defineProperty(process, 'platform', { value: 'win32' });
    osModule.release = () => '10.0.22621';
    const os = require('../../extension/platform');
    expect(os).toBe('win10');
  });

  it('returns unknown for older Windows', () => {
    Object.defineProperty(process, 'platform', { value: 'win32' });
    osModule.release = () => '6.1.7601';
    const os = require('../../extension/platform');
    expect(os).toBe('unknown');
  });

  it('returns unknown for unsupported platforms', () => {
    Object.defineProperty(process, 'platform', { value: 'freebsd' });
    const os = require('../../extension/platform');
    expect(os).toBe('unknown');
  });
});
