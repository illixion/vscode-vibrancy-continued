const fs = require('fs');
const path = require('path');
const os = require('os');
const {
  shellEscape,
  psEscape,
  buildShellScript,
  buildPowerShellScript,
  checkNeedsElevation,
  StagedFileWriter,
} = require('../../extension/elevated-file-writer');

// --- shellEscape ---

describe('shellEscape', () => {
  it('escapes single quotes', () => {
    expect(shellEscape("it's")).toBe("it'\\''s");
  });

  it('handles empty string', () => {
    expect(shellEscape('')).toBe('');
  });

  it('passes through strings without quotes', () => {
    expect(shellEscape('hello world')).toBe('hello world');
  });

  it('handles multiple single quotes', () => {
    expect(shellEscape("a'b'c")).toBe("a'\\''b'\\''c");
  });

  it('handles Unicode characters', () => {
    expect(shellEscape('日本語')).toBe('日本語');
  });
});

// --- psEscape ---

describe('psEscape', () => {
  it('doubles single quotes', () => {
    expect(psEscape("it's")).toBe("it''s");
  });

  it('handles empty string', () => {
    expect(psEscape('')).toBe('');
  });

  it('passes through strings without quotes', () => {
    expect(psEscape('hello world')).toBe('hello world');
  });

  it('handles multiple single quotes', () => {
    expect(psEscape("a'b'c")).toBe("a''b''c");
  });
});

// --- buildShellScript ---

describe('buildShellScript', () => {
  it('starts with set -e', () => {
    const script = buildShellScript([]);
    expect(script).toBe('set -e');
  });

  it('generates mkdir -p commands', () => {
    const script = buildShellScript([{ type: 'mkdir', path: '/tmp/test dir' }]);
    expect(script).toContain("mkdir -p '/tmp/test dir'");
  });

  it('generates rm -rf commands', () => {
    const script = buildShellScript([{ type: 'rmdir', path: '/tmp/old' }]);
    expect(script).toContain("rm -rf '/tmp/old'");
  });

  it('generates cp commands', () => {
    const script = buildShellScript([{ type: 'copy', src: '/a', dest: '/b' }]);
    expect(script).toContain("cp '/a' '/b'");
  });

  it('generates cp -r commands for directories', () => {
    const script = buildShellScript([{ type: 'copyDir', src: '/a', dest: '/b' }]);
    expect(script).toContain("cp -r '/a/.' '/b/'");
  });

  it('escapes single quotes in paths', () => {
    const script = buildShellScript([{ type: 'mkdir', path: "/tmp/it's" }]);
    expect(script).toContain("mkdir -p '/tmp/it'\\''s'");
  });

  it('handles multiple operations in order', () => {
    const ops = [
      { type: 'rmdir', path: '/old' },
      { type: 'mkdir', path: '/new' },
      { type: 'copy', src: '/a', dest: '/new/a' },
    ];
    const script = buildShellScript(ops);
    const lines = script.split('\n');
    expect(lines[0]).toBe('set -e');
    expect(lines[1]).toContain('rm -rf');
    expect(lines[2]).toContain('mkdir -p');
    expect(lines[3]).toContain('cp');
  });
});

// --- buildPowerShellScript ---

describe('buildPowerShellScript', () => {
  it('generates New-Item commands for mkdir', () => {
    const script = buildPowerShellScript([{ type: 'mkdir', path: 'C:\\test' }]);
    expect(script).toContain("New-Item -Path 'C:\\test' -ItemType Directory -Force | Out-Null");
  });

  it('generates Remove-Item commands for rmdir', () => {
    const script = buildPowerShellScript([{ type: 'rmdir', path: 'C:\\old' }]);
    expect(script).toContain("Remove-Item -Path 'C:\\old' -Recurse -Force -ErrorAction SilentlyContinue");
  });

  it('generates Copy-Item commands for copy', () => {
    const script = buildPowerShellScript([{ type: 'copy', src: 'C:\\a', dest: 'C:\\b' }]);
    expect(script).toContain("Copy-Item -Path 'C:\\a' -Destination 'C:\\b' -Force");
  });

  it('generates Copy-Item -Recurse for copyDir', () => {
    const script = buildPowerShellScript([{ type: 'copyDir', src: 'C:\\a', dest: 'C:\\b' }]);
    expect(script).toContain("Copy-Item -Path 'C:\\a\\*' -Destination 'C:\\b' -Recurse -Force");
  });

  it('escapes single quotes in paths', () => {
    const script = buildPowerShellScript([{ type: 'mkdir', path: "C:\\it's a dir" }]);
    expect(script).toContain("'C:\\it''s a dir'");
  });
});

// --- checkNeedsElevation ---

describe('checkNeedsElevation', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vibrancy-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('returns false for writable directory', () => {
    const result = checkNeedsElevation(tmpDir);
    expect(result).toBe(false);
  });

  if (process.platform !== 'win32') {
    it('returns true for non-writable directory', () => {
      fs.chmodSync(tmpDir, 0o444);
      const result = checkNeedsElevation(tmpDir);
      expect(result).toBe(true);
      // Restore permissions for cleanup
      fs.chmodSync(tmpDir, 0o755);
    });
  }
});

// --- StagedFileWriter (non-elevated) ---

describe('StagedFileWriter (non-elevated)', () => {
  let tmpDir;
  let writer;

  beforeEach(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vibrancy-writer-'));
    writer = new StagedFileWriter(false);
    await writer.init();
  });

  afterEach(() => {
    writer.cleanup();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('writes files directly when not elevated', async () => {
    const filePath = path.join(tmpDir, 'test.txt');
    await writer.writeFile(filePath, 'hello', 'utf-8');
    expect(fs.readFileSync(filePath, 'utf-8')).toBe('hello');
  });

  it('creates directories', async () => {
    const dirPath = path.join(tmpDir, 'subdir');
    await writer.mkdir(dirPath);
    expect(fs.existsSync(dirPath)).toBe(true);
    expect(fs.statSync(dirPath).isDirectory()).toBe(true);
  });

  it('removes directories', async () => {
    const dirPath = path.join(tmpDir, 'to-remove');
    fs.mkdirSync(dirPath);
    fs.writeFileSync(path.join(dirPath, 'file.txt'), 'data');
    await writer.rmdir(dirPath);
    expect(fs.existsSync(dirPath)).toBe(false);
  });

  it('copies files', async () => {
    const src = path.join(tmpDir, 'src.txt');
    const dest = path.join(tmpDir, 'dest.txt');
    fs.writeFileSync(src, 'content');
    await writer.copyFile(src, dest);
    expect(fs.readFileSync(dest, 'utf-8')).toBe('content');
  });

  it('flush is a no-op for non-elevated writer', async () => {
    // Should not throw
    await writer.flush();
  });
});
