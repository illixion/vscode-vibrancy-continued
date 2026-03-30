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
 */
function captureScreenshot(outputPath) {
  try {
    if (process.platform === 'darwin') {
      execSync(`screencapture -x "${outputPath}"`, { timeout: 5000 });
    } else if (process.platform === 'linux') {
      try {
        execSync(`import -window root "${outputPath}"`, { timeout: 5000 });
      } catch {
        execSync(`gnome-screenshot -f "${outputPath}"`, { timeout: 5000 });
      }
    } else if (process.platform === 'win32') {
      const psScript = `
        Add-Type -AssemblyName System.Windows.Forms
        Add-Type -AssemblyName System.Drawing
        [System.Windows.Forms.Screen]::PrimaryScreen | ForEach-Object {
          $bitmap = New-Object System.Drawing.Bitmap($_.Bounds.Width, $_.Bounds.Height)
          $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
          $graphics.CopyFromScreen($_.Bounds.Location, [System.Drawing.Point]::Empty, $_.Bounds.Size)
          $bitmap.Save('${outputPath.replace(/\\/g, '\\\\').replace(/'/g, "''")}')
          $graphics.Dispose()
          $bitmap.Dispose()
        }
      `.trim();
      execSync(`powershell -Command "${psScript}"`, { timeout: 10000 });
    }
  } catch (err) {
    console.log(`  Screenshot capture error: ${err.message}`);
  }
}

/**
 * Generate a small PNG thumbnail and return it as base64.
 * Uses native OS tools to avoid heavy dependencies.
 */
function generateThumbnailBase64(screenshotPath) {
  const thumbPath = screenshotPath.replace('.png', '-thumb.png');
  try {
    if (process.platform === 'darwin') {
      // sips is built into macOS
      execSync(`sips -z 270 480 "${screenshotPath}" --out "${thumbPath}"`, { stdio: 'ignore', timeout: 10000 });
    } else if (process.platform === 'linux') {
      // ImageMagick convert — typically available in CI with xvfb
      execSync(`convert "${screenshotPath}" -resize 480x270 "${thumbPath}"`, { stdio: 'ignore', timeout: 10000 });
    } else if (process.platform === 'win32') {
      const psScript = `
        Add-Type -AssemblyName System.Drawing
        $src = [System.Drawing.Image]::FromFile('${screenshotPath.replace(/\\/g, '\\\\').replace(/'/g, "''")}')
        $thumb = $src.GetThumbnailImage(480, 270, $null, [IntPtr]::Zero)
        $thumb.Save('${thumbPath.replace(/\\/g, '\\\\').replace(/'/g, "''")}', [System.Drawing.Imaging.ImageFormat]::Png)
        $thumb.Dispose()
        $src.Dispose()
      `.trim();
      execSync(`powershell -Command "${psScript}"`, { stdio: 'ignore', timeout: 10000 });
    }

    if (fs.existsSync(thumbPath)) {
      const base64 = fs.readFileSync(thumbPath, 'base64');
      fs.unlinkSync(thumbPath);
      return base64;
    }
  } catch (err) {
    console.log(`  Thumbnail generation error: ${err.message}`);
  }
  return null;
}

/**
 * Write a GitHub Actions job summary with inline screenshot.
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
    const thumbBase64 = generateThumbnailBase64(screenshotPath);
    if (thumbBase64) {
      md += `### Screenshot\n\n`;
      md += `<img src="data:image/png;base64,${thumbBase64}" width="480" alt="VSCode E2E screenshot — ${platform}">\n\n`;
      md += `_Full-resolution image in the **screenshots** artifact._\n`;
    } else {
      md += `### Screenshot\n\n`;
      md += `_Thumbnail generation failed — see the **screenshots** artifact for the full image._\n`;
    }
  } else {
    md += `_No screenshot captured._\n`;
  }

  fs.appendFileSync(summaryFile, md);
}

main().catch((err) => {
  console.error('E2E test failed:', err);
  process.exit(1);
});
