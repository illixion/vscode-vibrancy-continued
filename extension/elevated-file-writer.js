const fs = require('fs');
const fsPromises = require('fs').promises;
const fsExtra = require('fs-extra');
const path = require('path');
const os = require('os');
const { execFile, execSync } = require('child_process');

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
    fs.accessSync(appDir, fs.constants.W_OK);
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
 * Escape a string for use inside a double-quoted PowerShell argument.
 */
function psEscape(str) {
  return str.replace(/`/g, '``').replace(/"/g, '`"').replace(/\$/g, '`$');
}

/**
 * Check if Windows 11 built-in sudo is available.
 */
function hasWindowsSudo() {
  try {
    execSync('where sudo', { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
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
 * Build a Windows cmd script from an array of file operations.
 */
function buildWindowsScript(operations) {
  const commands = [];

  for (const op of operations) {
    switch (op.type) {
      case 'mkdir':
        commands.push(`mkdir "${op.path}"`);
        break;
      case 'rmdir':
        commands.push(`rmdir /s /q "${op.path}"`);
        break;
      case 'copy':
        commands.push(`copy /y "${op.src}" "${op.dest}"`);
        break;
      case 'copyDir':
        commands.push(`xcopy "${op.src}" "${op.dest}" /e /i /y /q`);
        break;
    }
  }

  return commands.join(' && ');
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
      // Windows: try sudo --inline first (Win11 24H2+), fall back to PowerShell UAC
      const winScript = buildWindowsScript(operations);

      if (hasWindowsSudo()) {
        execFile('sudo', ['--inline', 'cmd', '/c', winScript], (error, _stdout, stderr) => {
          if (error) {
            reject(new Error(`Elevation failed: ${stderr || error.message}`));
          } else {
            resolve();
          }
        });
      } else {
        // PowerShell Start-Process -Verb RunAs fallback
        const psCommand = `Start-Process -FilePath cmd -ArgumentList '/c ${psEscape(winScript)}' -Verb RunAs -Wait`;
        execFile('powershell', ['-Command', psCommand], (error, _stdout, stderr) => {
          if (error) {
            reject(new Error(`Elevation failed: ${stderr || error.message}`));
          } else {
            resolve();
          }
        });
      }
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
  hasWindowsSudo,
  StagedFileWriter,
};
