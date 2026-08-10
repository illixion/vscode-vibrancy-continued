const fs = require('fs');
const path = require('path');
const os = require('os');
const cp = require('child_process');
const {
  shellEscape,
  psEscape,
  buildShellScript,
  buildPowerShellScript,
  checkNeedsElevation,
  hasCommand,
  elevatedCopy,
  setTerminalRunner,
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

  it("returns 'nix' for /nix/store paths without probing", () => {
    const result = checkNeedsElevation('/nix/store/abc123-vscode-1.119.0/lib/vscode/resources/app/out');
    expect(result).toBe('nix');
  });

  it("returns 'immutable' when the write probe fails with EROFS", () => {
    const err = new Error('read-only file system');
    err.code = 'EROFS';
    const spy = vi.spyOn(fs, 'writeFileSync').mockImplementation(() => { throw err; });
    try {
      expect(checkNeedsElevation('/usr/lib/code/resources/app/out')).toBe('immutable');
    } finally {
      spy.mockRestore();
    }
  });

  it("returns 'snap' before the nix check for snap paths", () => {
    expect(checkNeedsElevation('/snap/code/current/usr/share/code')).toBe('snap');
  });
});

// --- hasCommand ---

describe('hasCommand', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns true when the command resolves', () => {
    vi.spyOn(cp, 'execSync').mockReturnValue('');
    expect(hasCommand('pkexec')).toBe(true);
  });

  it('returns false when the lookup fails', () => {
    vi.spyOn(cp, 'execSync').mockImplementation(() => { throw new Error('not found'); });
    expect(hasCommand('pkexec')).toBe(false);
  });
});

// --- elevatedCopy (Linux elevation strategy) ---

describe('elevatedCopy on Linux', () => {
  const OPS = [{ type: 'mkdir', path: '/opt/vscode/out' }];
  const originalPlatform = Object.getOwnPropertyDescriptor(process, 'platform');

  /** Make hasCommand() report only the listed binaries as present. */
  function stubAvailableCommands(available) {
    vi.spyOn(cp, 'execSync').mockImplementation((cmd) => {
      const name = String(cmd).replace('command -v ', '');
      if (available.includes(name)) return '';
      throw new Error(`${name} not found`);
    });
  }

  /** Stub pkexec's execFile call with a given error (null = success). */
  function stubPkexec(error, stderr = '') {
    vi.spyOn(cp, 'execFile').mockImplementation((file, args, cb) => {
      expect(file).toBe('pkexec');
      cb(error, '', stderr);
    });
  }

  beforeEach(() => {
    Object.defineProperty(process, 'platform', { value: 'linux', configurable: true });
    // hasNoNewPrivs() reads /proc/self/status, which doesn't exist off Linux.
    vi.spyOn(fs, 'readFileSync').mockReturnValue('NoNewPrivs:\t0\n');
  });

  afterEach(() => {
    Object.defineProperty(process, 'platform', originalPlatform);
    setTerminalRunner(null);
    vi.restoreAllMocks();
  });

  it('resolves without a terminal when pkexec succeeds', async () => {
    stubAvailableCommands(['pkexec', 'sudo']);
    stubPkexec(null);
    const runner = vi.fn();
    setTerminalRunner(runner);

    await expect(elevatedCopy(OPS)).resolves.toBeUndefined();
    expect(runner).not.toHaveBeenCalled();
  });

  it('falls back to the terminal when pkexec is not installed', async () => {
    stubAvailableCommands(['sudo']);
    const runner = vi.fn().mockResolvedValue(undefined);
    setTerminalRunner(runner);

    await expect(elevatedCopy(OPS)).resolves.toBeUndefined();
    expect(runner).toHaveBeenCalledWith({
      command: 'sudo',
      script: buildShellScript(OPS),
    });
  });

  it('falls back to the terminal when pkexec fails for any reason', async () => {
    stubAvailableCommands(['pkexec', 'sudo']);
    stubPkexec(Object.assign(new Error('exit 127'), { code: 127 }), 'some locale-specific message');
    const runner = vi.fn().mockResolvedValue(undefined);
    setTerminalRunner(runner);

    await expect(elevatedCopy(OPS)).resolves.toBeUndefined();
    expect(runner).toHaveBeenCalledOnce();
  });

  it('uses doas when sudo is unavailable', async () => {
    stubAvailableCommands(['doas']);
    const runner = vi.fn().mockResolvedValue(undefined);
    setTerminalRunner(runner);

    await elevatedCopy(OPS);
    expect(runner).toHaveBeenCalledWith(expect.objectContaining({ command: 'doas' }));
  });

  it('does not re-prompt in a terminal when the user dismissed the pkexec dialog', async () => {
    stubAvailableCommands(['pkexec', 'sudo']);
    stubPkexec(Object.assign(new Error('dismissed'), { code: 126 }));
    const runner = vi.fn();
    setTerminalRunner(runner);

    await expect(elevatedCopy(OPS)).rejects.toThrow('cancelled');
    expect(runner).not.toHaveBeenCalled();
  });

  it('reports no_new_privs from pkexec stderr', async () => {
    stubAvailableCommands(['pkexec', 'sudo']);
    stubPkexec(new Error('failed'), 'pkexec must be setuid root');
    setTerminalRunner(vi.fn());

    await expect(elevatedCopy(OPS)).rejects.toThrow('no_new_privs');
  });

  it('rejects with no_elevation_method when nothing is available', async () => {
    stubAvailableCommands([]);
    setTerminalRunner(vi.fn());

    await expect(elevatedCopy(OPS)).rejects.toThrow('no_elevation_method');
  });

  it("surfaces pkexec's error when no fallback command exists", async () => {
    stubAvailableCommands(['pkexec']);
    stubPkexec(new Error('boom'), 'pkexec exploded');
    setTerminalRunner(vi.fn());

    await expect(elevatedCopy(OPS)).rejects.toThrow('pkexec exploded');
  });
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
