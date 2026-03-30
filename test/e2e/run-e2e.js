/**
 * E2E test for VSCode Vibrancy Continued.
 *
 * Downloads a real VSCode instance, installs the extension with testMode enabled,
 * verifies it installs without crashing, and captures a screenshot.
 *
 * Usage:
 *   node test/e2e/run-e2e.js
 *
 * Requirements:
 *   npm install --save-dev @vscode/test-electron
 *
 * On Linux CI, run under xvfb:
 *   xvfb-run node test/e2e/run-e2e.js
 */

const path = require('path');
const fs = require('fs');
const os = require('os');
const { execSync, spawn } = require('child_process');

async function main() {
  // Lazy-require so this script doesn't fail at import time if the package
  // isn't installed (it's only needed for E2E).
  const { downloadAndUnzipVSCode, resolveCliPathFromVSCodeExecutablePath } = require('@vscode/test-electron');

  const screenshotDir = path.join(__dirname, '..', 'screenshots');
  fs.mkdirSync(screenshotDir, { recursive: true });

  console.log('=== E2E Test: VSCode Vibrancy Continued ===\n');

  // Step 1: Download VSCode
  console.log('[1/6] Downloading VSCode...');
  const vscodeExecutablePath = await downloadAndUnzipVSCode('stable');
  const cliPath = resolveCliPathFromVSCodeExecutablePath(vscodeExecutablePath);
  console.log(`  VSCode: ${vscodeExecutablePath}`);
  console.log(`  CLI: ${cliPath}`);

  // Step 2: Create a temporary user-data-dir with testMode settings
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vibrancy-e2e-userdata-'));
  const userSettingsDir = path.join(userDataDir, 'User');
  fs.mkdirSync(userSettingsDir, { recursive: true });
  fs.writeFileSync(path.join(userSettingsDir, 'settings.json'), JSON.stringify({
    "vscode_vibrancy.testMode": true,
    "vscode_vibrancy.theme": "__Test Green",
    "workbench.colorTheme": "Default Dark+",
    // Disable telemetry and update checks for cleaner test
    "telemetry.telemetryLevel": "off",
    "update.mode": "none",
    "extensions.autoUpdate": false,
  }, null, 2));
  console.log(`  User data dir: ${userDataDir}`);

  // Step 3: Package and install the extension
  console.log('\n[2/6] Packaging and installing extension...');
  const extensionDir = path.resolve(__dirname, '..', '..');
  const vsixPath = path.join(os.tmpdir(), 'vibrancy-e2e-test.vsix');
  try {
    execSync(
      `npx @vscode/vsce package --out "${vsixPath}" --no-dependencies --allow-star-activation`,
      { cwd: extensionDir, stdio: 'inherit', timeout: 60000 }
    );
    console.log(`  Packaged: ${vsixPath}`);
    execSync(
      `"${cliPath}" --install-extension "${vsixPath}" --user-data-dir "${userDataDir}" --force`,
      { stdio: 'inherit', timeout: 60000 }
    );
  } catch (err) {
    console.error('Failed to package/install extension:', err.message);
    process.exit(1);
  }

  // Step 4: First launch — extension activates, testMode auto-installs
  console.log('\n[3/6] First launch (extension installs vibrancy)...');
  const tmpWorkspace = fs.mkdtempSync(path.join(os.tmpdir(), 'vibrancy-e2e-workspace-'));
  const firstLaunchExitCode = await launchVSCode(vscodeExecutablePath, userDataDir, tmpWorkspace, 15000);
  console.log(`  Exit code: ${firstLaunchExitCode}`);

  // Step 5: Second launch — verify modified VSCode doesn't crash
  console.log('\n[4/6] Second launch (verify no crash)...');
  const secondLaunchExitCode = await launchVSCode(vscodeExecutablePath, userDataDir, tmpWorkspace, 15000);
  console.log(`  Exit code: ${secondLaunchExitCode}`);

  // Step 6: Capture screenshot
  console.log('\n[5/6] Capturing screenshot...');
  const screenshotPath = await captureScreenshot(screenshotDir);
  if (screenshotPath) {
    console.log(`  Screenshot saved: ${screenshotPath}`);
  } else {
    console.log('  Screenshot capture not available on this platform/environment');
  }

  // Step 7: Report results
  console.log('\n[6/6] Results:');
  const success = secondLaunchExitCode === 0 || secondLaunchExitCode === null;
  if (success) {
    console.log('  PASS: VSCode launched successfully after vibrancy install');
  } else {
    console.log(`  FAIL: VSCode crashed with exit code ${secondLaunchExitCode}`);
  }

  // Cleanup
  fs.rmSync(userDataDir, { recursive: true, force: true });
  fs.rmSync(tmpWorkspace, { recursive: true, force: true });
  try { fs.unlinkSync(vsixPath); } catch {}

  process.exit(success ? 0 : 1);
}

/**
 * Launch VSCode, wait for it to start, then kill it after a timeout.
 * Returns the exit code (0 if killed by us, non-zero if it crashed).
 */
function launchVSCode(executablePath, userDataDir, workspace, timeoutMs) {
  return new Promise((resolve) => {
    const args = [
      '--user-data-dir', userDataDir,
      '--disable-gpu',
      '--no-sandbox',
      workspace,
    ];

    const proc = spawn(executablePath, args, {
      stdio: 'pipe',
      env: { ...process.env, ELECTRON_DISABLE_SANDBOX: '1' },
    });

    let stderr = '';
    proc.stderr?.on('data', (chunk) => { stderr += chunk.toString(); });

    let exited = false;
    proc.on('exit', (code) => {
      exited = true;
      if (stderr && code !== 0) {
        console.log(`  stderr: ${stderr.slice(0, 500)}`);
      }
      resolve(code);
    });

    // Kill after timeout — this is expected/success
    setTimeout(() => {
      if (!exited) {
        proc.kill('SIGTERM');
        // Give it a moment to exit gracefully
        setTimeout(() => {
          if (!exited) {
            proc.kill('SIGKILL');
            resolve(null); // killed by us = success
          }
        }, 3000);
      }
    }, timeoutMs);
  });
}

/**
 * Capture a screenshot of the current display.
 * Platform-specific: macOS (screencapture), Linux (import/xdg), Windows (nircmd/PowerShell).
 */
async function captureScreenshot(outputDir) {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const filename = `vibrancy-e2e-${process.platform}-${timestamp}.png`;
  const outputPath = path.join(outputDir, filename);

  try {
    if (process.platform === 'darwin') {
      execSync(`screencapture -x "${outputPath}"`, { timeout: 5000 });
    } else if (process.platform === 'linux') {
      // Try import (ImageMagick) first, then gnome-screenshot
      try {
        execSync(`import -window root "${outputPath}"`, { timeout: 5000 });
      } catch {
        execSync(`gnome-screenshot -f "${outputPath}"`, { timeout: 5000 });
      }
    } else if (process.platform === 'win32') {
      // PowerShell screenshot
      const psScript = `
        Add-Type -AssemblyName System.Windows.Forms
        [System.Windows.Forms.Screen]::PrimaryScreen | ForEach-Object {
          $bitmap = New-Object System.Drawing.Bitmap($_.Bounds.Width, $_.Bounds.Height)
          $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
          $graphics.CopyFromScreen($_.Bounds.Location, [System.Drawing.Point]::Empty, $_.Bounds.Size)
          $bitmap.Save('${outputPath.replace(/'/g, "''")}')
          $graphics.Dispose()
          $bitmap.Dispose()
        }
      `.trim();
      execSync(`powershell -Command "${psScript}"`, { timeout: 10000 });
    }
    return fs.existsSync(outputPath) ? outputPath : null;
  } catch {
    return null;
  }
}

main().catch((err) => {
  console.error('E2E test failed:', err);
  process.exit(1);
});
