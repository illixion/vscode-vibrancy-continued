const {
  deepEqual,
  isPrimitive,
  checkRuntimeUpdate,
  getConfigDir,
} = require('../../extension/file-transforms');

// --- deepEqual ---

describe('deepEqual', () => {
  it('returns true for identical primitives', () => {
    expect(deepEqual(1, 1)).toBe(true);
    expect(deepEqual('a', 'a')).toBe(true);
    expect(deepEqual(true, true)).toBe(true);
  });

  it('returns false for different primitives', () => {
    expect(deepEqual(1, 2)).toBe(false);
    expect(deepEqual('a', 'b')).toBe(false);
  });

  it('returns true for same object reference', () => {
    const obj = { a: 1 };
    expect(deepEqual(obj, obj)).toBe(true);
  });

  it('returns true for deeply equal objects', () => {
    expect(deepEqual({ a: 1, b: { c: 2 } }, { a: 1, b: { c: 2 } })).toBe(true);
  });

  it('returns false for objects with different keys', () => {
    expect(deepEqual({ a: 1 }, { b: 1 })).toBe(false);
  });

  it('returns false for objects with different values', () => {
    expect(deepEqual({ a: 1 }, { a: 2 })).toBe(false);
  });

  it('returns false for objects with different key counts', () => {
    expect(deepEqual({ a: 1 }, { a: 1, b: 2 })).toBe(false);
  });

  it('handles nested arrays', () => {
    expect(deepEqual([1, [2, 3]], [1, [2, 3]])).toBe(true);
    expect(deepEqual([1, [2, 3]], [1, [2, 4]])).toBe(false);
  });

  it('handles null and undefined', () => {
    expect(deepEqual(null, null)).toBe(true);
    expect(deepEqual(undefined, undefined)).toBe(true);
    expect(deepEqual(null, undefined)).toBe(false);
  });
});

// --- isPrimitive ---

describe('isPrimitive', () => {
  it('returns true for primitives', () => {
    expect(isPrimitive(1)).toBe(true);
    expect(isPrimitive('a')).toBe(true);
    expect(isPrimitive(true)).toBe(true);
    expect(isPrimitive(null)).toBe(true);
    expect(isPrimitive(undefined)).toBe(true);
  });

  it('returns false for objects', () => {
    expect(isPrimitive({})).toBe(false);
    expect(isPrimitive([])).toBe(false);
    expect(isPrimitive(new Date())).toBe(false);
  });
});

// --- checkRuntimeUpdate ---

describe('checkRuntimeUpdate', () => {
  it('returns false for same version', () => {
    expect(checkRuntimeUpdate('1.1.5', '1.1.3')).toBe(false);
  });

  it('returns true for minor version change', () => {
    expect(checkRuntimeUpdate('1.2.0', '1.1.5')).toBe(true);
  });

  it('returns true for major version change', () => {
    expect(checkRuntimeUpdate('2.0.0', '1.5.0')).toBe(true);
  });

  it('returns false for patch-only change', () => {
    expect(checkRuntimeUpdate('1.1.10', '1.1.3')).toBe(false);
  });

  it('handles first install (0.0.0)', () => {
    expect(checkRuntimeUpdate('1.1.0', '0.0.0')).toBe(true);
  });
});

// --- getConfigDir ---

describe('getConfigDir', () => {
  const originalPlatform = process.platform;

  afterEach(() => {
    Object.defineProperty(process, 'platform', { value: originalPlatform });
  });

  it('returns XDG path on Linux', () => {
    Object.defineProperty(process, 'platform', { value: 'linux' });
    const dir = getConfigDir('test-app');
    expect(dir).toContain('test-app');
    expect(dir).toMatch(/\.config|XDG/i);
  });

  it('returns Library/Preferences on macOS', () => {
    Object.defineProperty(process, 'platform', { value: 'darwin' });
    const dir = getConfigDir('test-app');
    expect(dir).toContain('Library');
    expect(dir).toContain('Preferences');
    expect(dir).toContain('test-app');
  });
});
