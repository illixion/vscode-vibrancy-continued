const fs = require('fs');
const fsPromises = require('fs').promises;
const fsExtra = require('fs-extra');
const path = require('path');
const os = require('os');
const { exec, execFile, execSync } = require('child_process');

/**
 * Check if the VSCode installation directory requires elevated privileges to write to.
 * Returns:
 *   false    - no elevation needed (user has write access)
 *   'snap'   - Snap install detected (immutable filesystem, elevation impossible)
 *   true     - elevation needed
 */
function checkNeedsElevation(appDir) {
  // Snap detection: squashfs mounts are immutable, even root can't write
  if (appDir.startsWith('/snap/') || process.env.SNAP) {
    return 'snap';
  }

  try {
    // On Windows, fs.accessSync(dir, W_OK) is unreliable — NTFS ACLs may allow
    // directory access but deny file writes. Test with an actual file write.
    const testFile = path.join(appDir, '.vibrancy-write-test');
    fs.writeFileSync(testFile, '');
    fs.unlinkSync(testFile);
    return false;
  } catch (err) {
    if (err.code === 'EACCES' || err.code === 'EPERM') {
      return true;
    }
    // For other errors (e.g. ENOENT), don't attempt elevation
    return false;
  }
}

/**
 * Escape a string for use inside a single-quoted shell argument.
 */
function shellEscape(str) {
  return str.replace(/'/g, "'\\''");
}

/**
 * Escape a string for use inside a PowerShell single-quoted string.
 * In PowerShell, single quotes are escaped by doubling them.
 */
function psEscape(str) {
  return str.replace(/'/g, "''");
}

/**
 * Check if pkexec (Polkit) is available on Linux.
 */
function hasPkexec() {
  try {
    execSync('which pkexec', { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

/**
 * Check if the current process has no_new_privs set (Linux).
 * When set, setuid binaries like pkexec/sudo won't gain privileges.
 * This typically happens after VSCode performs an in-process reload.
 */
function hasNoNewPrivs() {
  try {
    const status = fs.readFileSync('/proc/self/status', 'utf-8');
    const match = status.match(/NoNewPrivs:\s*(\d+)/);
    return match && match[1] === '1';
  } catch {
    return false;
  }
}

/**
 * Build a shell script string from an array of file operations.
 * Each operation is { type: 'copy'|'mkdir'|'rmdir'|'copyDir', src?, dest/path }
 */
function buildShellScript(operations) {
  const commands = ['set -e'];

  for (const op of operations) {
    switch (op.type) {
      case 'mkdir':
        commands.push(`mkdir -p '${shellEscape(op.path)}'`);
        break;
      case 'rmdir':
        commands.push(`rm -rf '${shellEscape(op.path)}'`);
        break;
      case 'copy':
        commands.push(`cp '${shellEscape(op.src)}' '${shellEscape(op.dest)}'`);
        break;
      case 'copyDir':
        commands.push(`cp -r '${shellEscape(op.src)}/.' '${shellEscape(op.dest)}/'`);
        break;
    }
  }

  return commands.join('\n');
}

/**
 * Build a PowerShell script from an array of file operations.
 * Uses PowerShell cmdlets which handle paths with spaces natively.
 */
function buildPowerShellScript(operations) {
  const commands = [];

  for (const op of operations) {
    switch (op.type) {
      case 'mkdir':
        commands.push(`New-Item -Path '${psEscape(op.path)}' -ItemType Directory -Force | Out-Null`);
        break;
      case 'rmdir':
        // SilentlyContinue: don't fail if dir doesn't exist or has locked files
        commands.push(`Remove-Item -Path '${psEscape(op.path)}' -Recurse -Force -ErrorAction SilentlyContinue`);
        break;
      case 'copy':
        commands.push(`Copy-Item -Path '${psEscape(op.src)}' -Destination '${psEscape(op.dest)}' -Force`);
        break;
      case 'copyDir':
        // Copy directory contents recursively, creating destination if needed
        commands.push(`Copy-Item -Path '${psEscape(op.src)}\\*' -Destination '${psEscape(op.dest)}' -Recurse -Force`);
        break;
    }
  }

  return commands.join('\n');
}

/**
 * Execute file operations with elevated privileges on Windows.
 * Uses PowerShell Start-Process -Verb RunAs to trigger UAC, with the payload
 * encoded as Base64 to avoid all quoting/escaping issues.
 */
function elevatedCopyWindows(operations) {
  return new Promise((resolve, reject) => {
    const statusFile = path.join(os.tmpdir(), `vibrancy-elev-${Date.now()}.txt`);
    const psScript = buildPowerShellScript(operations);

    // Wrap in try/catch so we can report errors via the status file
    const payload = [
      '$ErrorActionPreference = "Continue"',
      psScript,
      `'OK' | Set-Content -Path '${psEscape(statusFile)}' -Encoding UTF8`,
    ].join('\n');

    // Encode as Base64 (UTF-16LE required by PowerShell's -EncodedCommand)
    const encodedPayload = Buffer.from(payload, 'utf16le').toString('base64');

    // Build the elevation command:
    // Outer powershell calls Start-Process -Verb RunAs on an inner powershell
    // that runs the encoded payload. -Wait ensures the outer PS waits for completion.
    const innerArgs = `-NoProfile -ExecutionPolicy Bypass -EncodedCommand ${encodedPayload}`;
    const elevateCmd = [
      'powershell.exe', '-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command',
      `"Start-Process powershell.exe -ArgumentList '${innerArgs}' -Verb RunAs -WindowStyle Hidden -Wait"`,
    ].join(' ');

    exec(elevateCmd, { encoding: 'utf-8' }, (error) => {
      try {
        const status = fs.readFileSync(statusFile, 'utf-8').trim();
        fs.unlinkSync(statusFile);
        if (status === 'OK') {
          resolve();
        } else {
          reject(new Error(`Elevation failed: ${status}`));
        }
      } catch (readErr) {
        // Status file wasn't created — user likely denied UAC or process crashed
        if (error) {
          reject(new Error('Elevation failed: user denied elevation or process was cancelled'));
        } else {
          reject(new Error('Elevation failed: elevated process did not complete'));
        }
      }
    });
  });
}

/**
 * Execute file operations with elevated privileges.
 * Returns a Promise that resolves on success or rejects with an error.
 */
function elevatedCopy(operations) {
  return new Promise((resolve, reject) => {
    if (operations.length === 0) {
      resolve();
      return;
    }

    const platform = process.platform;

    if (platform === 'darwin') {
      // macOS: use osascript with administrator privileges
      const script = buildShellScript(operations);
      const escapedScript = script.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
      const osaScript = `do shell script "${escapedScript}" with administrator privileges`;

      execFile('osascript', ['-e', osaScript], (error, _stdout, stderr) => {
        if (error) {
          reject(new Error(`Elevation failed: ${stderr || error.message}`));
        } else {
          resolve();
        }
      });
    } else if (platform === 'linux') {
      // Linux: use pkexec (Polkit GUI dialog)

      if (hasNoNewPrivs()) {
        // no_new_privs is set — setuid binaries won't work.
        // This happens after VSCode does an in-process reload.
        reject(new Error('no_new_privs'));
        return;
      }

      if (!hasPkexec()) {
        reject(new Error('pkexec_missing'));
        return;
      }

      const script = buildShellScript(operations);

      execFile('pkexec', ['sh', '-c', script], (error, _stdout, stderr) => {
        if (error) {
          if (stderr && stderr.includes('setuid root')) {
            reject(new Error('no_new_privs'));
          } else {
            reject(new Error(`Elevation failed: ${stderr || error.message}`));
          }
        } else {
          resolve();
        }
      });
    } else if (platform === 'win32') {
      // Windows: use PowerShell Start-Process -Verb RunAs to trigger UAC
      elevatedCopyWindows(operations).then(resolve, reject);
    } else {
      reject(new Error('Unsupported platform for elevation'));
    }
  });
}

/**
 * StagedFileWriter - transparently stages file writes to a temp directory
 * when elevation is required, then copies them all at once via a single
 * elevated command.
 *
 * When requiresElevation is false, all operations go directly to their targets.
 */
class StagedFileWriter {
  constructor(requiresElevation) {
    this.requiresElevation = requiresElevation;
    this.tmpDir = null;
    this.operations = [];
    this._counter = 0;
  }

  async init() {
    if (this.requiresElevation) {
      this.tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vibrancy-'));
    }
  }

  /**
   * Generate a unique temp file path to avoid collisions when multiple
   * files with the same basename are staged.
   */
  _tmpPath(targetPath) {
    const name = `${this._counter++}_${path.basename(targetPath)}`;
    return path.join(this.tmpDir, name);
  }

  async writeFile(targetPath, content, encoding) {
    if (!this.requiresElevation) {
      await fsPromises.writeFile(targetPath, content, encoding);
    } else {
      const tmpFile = this._tmpPath(targetPath);
      await fsPromises.writeFile(tmpFile, content, encoding);
      this.operations.push({ type: 'copy', src: tmpFile, dest: targetPath });
    }
  }

  async mkdir(targetPath) {
    if (!this.requiresElevation) {
      await fsPromises.mkdir(targetPath, { recursive: true });
    } else {
      this.operations.push({ type: 'mkdir', path: targetPath });
    }
  }

  async rmdir(targetPath) {
    if (!this.requiresElevation) {
      fs.rmSync(targetPath, { recursive: true, force: true });
    } else {
      this.operations.push({ type: 'rmdir', path: targetPath });
    }
  }

  async copyFile(srcPath, destPath) {
    if (!this.requiresElevation) {
      fs.copyFileSync(srcPath, destPath);
    } else {
      const tmpFile = this._tmpPath(destPath);
      fs.copyFileSync(srcPath, tmpFile);
      this.operations.push({ type: 'copy', src: tmpFile, dest: destPath });
    }
  }

  async copyDir(src, dest) {
    if (!this.requiresElevation) {
      await fsExtra.copy(src, dest);
    } else {
      // Copy source to a temp location first, then stage the elevated copy
      const tmpDest = path.join(this.tmpDir, `dir_${this._counter++}`);
      await fsExtra.copy(src, tmpDest);
      this.operations.push({ type: 'copyDir', src: tmpDest, dest: dest });
    }
  }

  /**
   * Execute all staged operations with elevation.
   * No-op if not in elevated mode or no operations queued.
   */
  async flush() {
    if (this.requiresElevation && this.operations.length > 0) {
      await elevatedCopy(this.operations);
      this.operations = [];
    }
    this.cleanup();
  }

  /**
   * Clean up the temp directory. Safe to call multiple times.
   */
  cleanup() {
    if (this.tmpDir) {
      try {
        fs.rmSync(this.tmpDir, { recursive: true, force: true });
      } catch {
        // Best effort cleanup
      }
      this.tmpDir = null;
    }
  }
}

module.exports = {
  checkNeedsElevation,
  elevatedCopy,
  hasPkexec,
  hasNoNewPrivs,
  StagedFileWriter,
};
