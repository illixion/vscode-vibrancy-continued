/**
 * E2E test for VSCode Vibrancy Continued.
 *
 * Downloads a real VSCode instance, installs the extension with testMode enabled,
 * verifies it installs without crashing, and captures a screenshot while running.
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
  const { downloadAndUnzipVSCode, resolveCliPathFromVSCodeExecutablePath } = require('@vscode/test-electron');

  const screenshotDir = path.join(__dirname, '..', 'screenshots');
  fs.mkdirSync(screenshotDir, { recursive: true });

  console.log('=== E2E Test: VSCode Vibrancy Continued ===\n');

  // Step 1: Download VSCode
  console.log('[1/5] Downloading VSCode...');
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
    // Disable workspace trust dialog — it blocks extension activation entirely
    "security.workspace.trust.enabled": false,
    // Suppress first-run experience and tips
    "workbench.welcome.enabled": false,
    "workbench.startupEditor": "none",
    "workbench.tips.enabled": false,
    // Disable telemetry and update checks
    "telemetry.telemetryLevel": "off",
    "update.mode": "none",
    "extensions.autoUpdate": false,
  }, null, 2));
  console.log(`  User data dir: ${userDataDir}`);

  // Step 3: Package and install the extension
  console.log('\n[2/5] Packaging and installing extension...');
  const extensionDir = path.resolve(__dirname, '..', '..');
  const vsixPath = path.join(os.tmpdir(), 'vibrancy-e2e-test.vsix');
  try {
    execSync(
      `npx @vscode/vsce package --out "${vsixPath}" --no-dependencies --allow-star-activation`,
      { cwd: extensionDir, stdio: 'inherit', timeout: 180000 }
    );
    console.log(`  Packaged: ${vsixPath}`);
    execSync(
      `"${cliPath}" --install-extension "${vsixPath}" --user-data-dir "${userDataDir}" --force`,
      { stdio: 'inherit', timeout: 120000 }
    );
  } catch (err) {
    console.error('Failed to package/install extension:', err.message);
    process.exit(1);
  }

  // Step 4: First launch — extension activates, testMode auto-installs, then exits
  console.log('\n[3/5] First launch (extension installs vibrancy)...');
  const tmpWorkspace = fs.mkdtempSync(path.join(os.tmpdir(), 'vibrancy-e2e-workspace-'));
  const firstLaunchExitCode = await launchVSCode(vscodeExecutablePath, userDataDir, tmpWorkspace, {
    totalTimeout: 20000,
  });
  console.log(`  Exit code: ${firstLaunchExitCode}`);

  // Step 5: Second launch — let it render, capture screenshot while running, then kill
  console.log('\n[4/5] Second launch (screenshot + crash check)...');
  const screenshotPath = path.join(screenshotDir, `vibrancy-e2e-${process.platform}-${Date.now()}.png`);
  const secondLaunchExitCode = await launchVSCode(vscodeExecutablePath, userDataDir, tmpWorkspace, {
    totalTimeout: 20000,
    // Wait for the window to fully render before capturing
    screenshotDelay: 10000,
    screenshotPath,
  });
  console.log(`  Exit code: ${secondLaunchExitCode}`);

  if (fs.existsSync(screenshotPath)) {
    console.log(`  Screenshot saved: ${screenshotPath}`);
  } else {
    console.log('  Screenshot capture failed or not available');
  }

  // Results
  console.log('\n[5/5] Results:');
  const success = secondLaunchExitCode === 0 || secondLaunchExitCode === null;
  if (success) {
    console.log('  PASS: VSCode launched successfully after vibrancy install');
  } else {
    console.log(`  FAIL: VSCode crashed with exit code ${secondLaunchExitCode}`);
  }

  // Write GitHub Actions job summary if available
  writeGitHubSummary(success, screenshotPath, secondLaunchExitCode);

  // Cleanup
  fs.rmSync(userDataDir, { recursive: true, force: true });
  fs.rmSync(tmpWorkspace, { recursive: true, force: true });
  try { fs.unlinkSync(vsixPath); } catch {}

  process.exit(success ? 0 : 1);
}

/**
 * Launch VSCode, optionally capture a screenshot while it's running, then kill it.
 *
 * @param {string} executablePath
 * @param {string} userDataDir
 * @param {string} workspace
 * @param {object} opts
 * @param {number} opts.totalTimeout  - Kill VSCode after this many ms
 * @param {number} [opts.screenshotDelay] - Capture screenshot after this many ms (must be < totalTimeout)
 * @param {string} [opts.screenshotPath] - Where to save the screenshot
 * @returns {Promise<number|null>} Exit code, or null if we killed it (success)
 */
function launchVSCode(executablePath, userDataDir, workspace, opts) {
  return new Promise((resolve) => {
    const { totalTimeout, screenshotDelay, screenshotPath } = opts;

    const args = [
      '--user-data-dir', userDataDir,
      '--disable-gpu',
      '--no-sandbox',
      '--disable-workspace-trust',
      '--skip-release-notes',
      '--skip-welcome',
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

    // Capture screenshot while VSCode is still running
    if (screenshotDelay && screenshotPath) {
      setTimeout(() => {
        if (!exited) {
          console.log('  Capturing screenshot...');
          captureScreenshot(screenshotPath);
        }
      }, screenshotDelay);
    }

    // Kill after total timeout
    setTimeout(() => {
      if (!exited) {
        proc.kill('SIGTERM');
        setTimeout(() => {
          if (!exited) {
            proc.kill('SIGKILL');
            resolve(null);
          }
        }, 3000);
      }
    }, totalTimeout);
  });
}

/**
 * Capture a screenshot of the current display.
 * Tries multiple methods per platform for reliability in CI.
 */
function captureScreenshot(outputPath) {
  const methods = [];

  if (process.platform === 'darwin') {
    methods.push(() => execSync(`screencapture -x "${outputPath}"`, { timeout: 10000 }));
  } else if (process.platform === 'linux') {
    // xvfb-run provides a virtual X display; import (ImageMagick) captures it
    methods.push(() => execSync(`import -window root "${outputPath}"`, { timeout: 10000 }));
    methods.push(() => execSync(`xwd -root -silent | convert xwd:- png:"${outputPath}"`, { timeout: 10000 }));
    methods.push(() => execSync(`scrot "${outputPath}"`, { timeout: 10000 }));
  } else if (process.platform === 'win32') {
    const escapedPath = outputPath.replace(/\\/g, '\\\\').replace(/'/g, "''");

    // Method 1: CopyFromScreen — works on interactive desktops
    methods.push(() => {
      const psScript = `
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
$bounds = [System.Windows.Forms.SystemInformation]::VirtualScreen
if ($bounds.Width -le 0 -or $bounds.Height -le 0) { throw "No screen: $($bounds.Width)x$($bounds.Height)" }
Write-Host "Screen bounds: $($bounds.Width)x$($bounds.Height)"
$bitmap = New-Object System.Drawing.Bitmap($bounds.Width, $bounds.Height)
$graphics = [System.Drawing.Graphics]::FromImage($bitmap)
$graphics.CopyFromScreen($bounds.Location, [System.Drawing.Point]::Empty, $bounds.Size)
$bitmap.Save('${escapedPath}', [System.Drawing.Imaging.ImageFormat]::Png)
$graphics.Dispose()
$bitmap.Dispose()
      `.trim();
      const out = execSync(`powershell -NoProfile -Command "${psScript}"`, { timeout: 15000, encoding: 'utf-8' });
      if (out.trim()) console.log(`  ${out.trim()}`);
    });

    // Method 2: Win32 PrintWindow — captures a specific window even without
    // an interactive desktop session. Finds the VSCode window by title.
    methods.push(() => {
      const psScript = `
Add-Type @"
using System;
using System.Runtime.InteropServices;
using System.Drawing;
using System.Drawing.Imaging;
public class ScreenCapture {
    [DllImport("user32.dll")] static extern IntPtr GetDesktopWindow();
    [DllImport("user32.dll")] static extern IntPtr GetWindowDC(IntPtr hWnd);
    [DllImport("user32.dll")] static extern int ReleaseDC(IntPtr hWnd, IntPtr hDC);
    [DllImport("gdi32.dll")] static extern IntPtr CreateCompatibleDC(IntPtr hdc);
    [DllImport("gdi32.dll")] static extern IntPtr CreateCompatibleBitmap(IntPtr hdc, int w, int h);
    [DllImport("gdi32.dll")] static extern IntPtr SelectObject(IntPtr hdc, IntPtr obj);
    [DllImport("gdi32.dll")] static extern bool BitBlt(IntPtr hdcDst, int x1, int y1, int w, int h, IntPtr hdcSrc, int x2, int y2, int op);
    [DllImport("gdi32.dll")] static extern bool DeleteDC(IntPtr hdc);
    [DllImport("gdi32.dll")] static extern bool DeleteObject(IntPtr obj);
    [DllImport("user32.dll")] static extern bool GetWindowRect(IntPtr hWnd, out RECT r);
    [StructLayout(LayoutKind.Sequential)] public struct RECT { public int L,T,R,B; }
    public static void Capture(string path) {
        IntPtr desk = GetDesktopWindow();
        RECT r; GetWindowRect(desk, out r);
        int w = r.R - r.L, h = r.B - r.T;
        if (w <= 0 || h <= 0) throw new Exception("Desktop " + w + "x" + h);
        IntPtr hdc = GetWindowDC(desk);
        IntPtr mdc = CreateCompatibleDC(hdc);
        IntPtr bmp = CreateCompatibleBitmap(hdc, w, h);
        SelectObject(mdc, bmp);
        BitBlt(mdc, 0, 0, w, h, hdc, r.L, r.T, 0x00CC0020);
        var img = Image.FromHbitmap(bmp);
        img.Save(path, ImageFormat.Png);
        img.Dispose(); DeleteObject(bmp); DeleteDC(mdc); ReleaseDC(desk, hdc);
    }
}
"@
[ScreenCapture]::Capture('${escapedPath}')
      `.trim();
      execSync(`powershell -NoProfile -Command "${psScript}"`, { timeout: 15000, encoding: 'utf-8' });
    });
  }

  for (const method of methods) {
    try {
      method();
      if (fs.existsSync(outputPath) && fs.statSync(outputPath).size > 0) {
        return; // success
      }
    } catch (err) {
      console.log(`  Screenshot method failed: ${err.message.split('\n')[0]}`);
    }
  }
  console.log('  All screenshot methods exhausted');
}

/**
 * Write a GitHub Actions job summary.
 *
 * Note: GitHub step summaries don't support data: URIs or local images.
 * Screenshots are uploaded as artifacts instead. To get inline images,
 * a future enhancement could use `gh-attach` (gh extension) with a PAT
 * to upload images to a GitHub issue and get a githubusercontent.com URL.
 */
function writeGitHubSummary(success, screenshotPath, exitCode) {
  const summaryFile = process.env.GITHUB_STEP_SUMMARY;
  if (!summaryFile) return;

  const platform = { darwin: 'macOS', linux: 'Linux', win32: 'Windows' }[process.platform] || process.platform;
  const status = success ? '✅ PASS' : '❌ FAIL';
  const exitInfo = exitCode === null ? 'killed by test (expected)' : `exit code ${exitCode}`;

  let md = `## E2E Test — ${platform}\n\n`;
  md += `| Result | Exit | Platform |\n`;
  md += `|--------|------|----------|\n`;
  md += `| ${status} | ${exitInfo} | ${platform} |\n\n`;

  if (screenshotPath && fs.existsSync(screenshotPath)) {
    const size = (fs.statSync(screenshotPath).size / 1024).toFixed(1);
    md += `### Screenshot\n\n`;
    md += `📸 Screenshot captured (${size} KB) — download the **screenshots-${
      process.platform === 'win32' ? 'windows-11-arm' : process.platform === 'darwin' ? 'macos-latest' : 'ubuntu-latest'
    }** artifact to view.\n`;
  } else {
    md += `_No screenshot captured._\n`;
  }

  fs.appendFileSync(summaryFile, md);
}

main().catch((err) => {
  console.error('E2E test failed:', err);
  process.exit(1);
});
