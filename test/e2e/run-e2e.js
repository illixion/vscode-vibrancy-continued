/**
 * E2E test for VSCode Vibrancy Continued.
 *
 * Flow:
 *   1. Download VSCode via @vscode/test-electron
 *   2. Install extension via CLI (--install-extension)
 *   3. Create test-mode flag + settings in the vibrancy config dir
 *   4. Launch VSCode — extension activates, detects test mode, auto-installs
 *   5. Wait for extension to write a signal file (success/error)
 *   6. Take screenshot, kill VSCode
 *   7. Relaunch VSCode (post-restart), take second screenshot
 *   8. Report results
 *
 * Usage:   node test/e2e/run-e2e.js
 * Linux:   xvfb-run --auto-servernum --server-args="-screen 0 1920x1080x24" node test/e2e/run-e2e.js
 */

const path = require('path');
const fs = require('fs');
const os = require('os');
const { execSync, spawn } = require('child_process');

function getConfigDir() {
  const homedir = os.homedir();
  const name = 'vscode-vibrancy-continued';
  if (process.platform === 'darwin') return path.join(homedir, 'Library', 'Preferences', name);
  if (process.platform === 'win32') return path.join(process.env.APPDATA || path.join(homedir, 'AppData', 'Roaming'), name, 'Config');
  return path.join(process.env.XDG_CONFIG_HOME || path.join(homedir, '.config'), name);
}

async function main() {
  const { downloadAndUnzipVSCode, resolveCliPathFromVSCodeExecutablePath } = require('@vscode/test-electron');

  const screenshotDir = path.join(__dirname, '..', 'screenshots');
  fs.mkdirSync(screenshotDir, { recursive: true });

  const greenCssPath = path.join(__dirname, 'test-green.css');
  const configDir = getConfigDir();
  const testModeFile = path.join(configDir, 'test-mode');
  const signalFile = path.join(configDir, 'test-result');
  let userDataDir, tmpWorkspace, vsixPath;

  try {
    console.log('=== E2E Test: VSCode Vibrancy Continued ===\n');

    // --- Step 1: Download VSCode ---
    console.log('[1/7] Downloading VSCode...');
    const vscodeExe = await downloadAndUnzipVSCode('stable');
    const cliPath = resolveCliPathFromVSCodeExecutablePath(vscodeExe);
    console.log(`  Executable: ${vscodeExe}`);
    console.log(`  CLI: ${cliPath}`);

    // --- Step 2: Prepare user-data-dir with settings ---
    console.log('\n[2/7] Preparing settings...');
    userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vibrancy-e2e-userdata-'));
    const userSettingsDir = path.join(userDataDir, 'User');
    fs.mkdirSync(userSettingsDir, { recursive: true });
    fs.writeFileSync(path.join(userSettingsDir, 'settings.json'), JSON.stringify({
      "vscode_vibrancy.theme": "Custom theme (use imports)",
      "vscode_vibrancy.imports": [greenCssPath],
      "workbench.colorTheme": "Default Dark+",
      "security.workspace.trust.enabled": false,
      "workbench.welcome.enabled": false,
      "workbench.startupEditor": "none",
      "workbench.tips.enabled": false,
      "telemetry.telemetryLevel": "off",
      "update.mode": "none",
      "extensions.autoUpdate": false,
    }, null, 2));
    console.log(`  User data dir: ${userDataDir}`);

    // --- Step 3: Package and install extension ---
    console.log('\n[3/7] Packaging and installing extension...');
    const extensionDir = path.resolve(__dirname, '..', '..');
    vsixPath = path.join(os.tmpdir(), 'vibrancy-e2e-test.vsix');
    execSync(
      `npx @vscode/vsce package --out "${vsixPath}" --no-dependencies --allow-star-activation`,
      { cwd: extensionDir, stdio: 'inherit', timeout: 180000 }
    );
    console.log(`  Packaged: ${vsixPath}`);
    execSync(
      `"${cliPath}" --install-extension "${vsixPath}" --user-data-dir "${userDataDir}" --force`,
      { stdio: 'inherit', timeout: 120000 }
    );

    // Verify extension installed
    const extensionsDir = path.join(userDataDir, 'extensions');
    if (fs.existsSync(extensionsDir)) {
      console.log(`  Installed: ${fs.readdirSync(extensionsDir).join(', ')}`);
    }

    // --- Step 4: Enable test mode ---
    console.log('\n[4/7] Enabling test mode...');
    fs.mkdirSync(configDir, { recursive: true });
    fs.writeFileSync(testModeFile, `e2e-${Date.now()}`);
    // Clear any stale signal
    try { fs.unlinkSync(signalFile); } catch {}
    console.log(`  Test mode file: ${testModeFile}`);

    // --- Step 5: First launch — extension installs vibrancy ---
    console.log('\n[5/7] First launch (extension installs vibrancy)...');
    tmpWorkspace = fs.mkdtempSync(path.join(os.tmpdir(), 'vibrancy-e2e-workspace-'));
    const screenshot1 = path.join(screenshotDir, `vibrancy-e2e-${process.platform}-1-install.png`);

    const firstResult = await launchAndWaitForSignal(vscodeExe, userDataDir, tmpWorkspace, {
      signalFile,
      signalTimeout: 30000,
      screenshotDelay: 15000,
      screenshotPath: screenshot1,
      killTimeout: 40000,
    });

    console.log(`  Exit code: ${firstResult.exitCode}`);
    if (firstResult.signal) {
      console.log(`  Signal: ${firstResult.signal.status} — ${firstResult.signal.message}`);
    } else {
      console.log('  Signal: NOT RECEIVED (extension may not have activated)');
    }

    // Check settings.json for changes by the extension
    const settingsAfter = fs.readFileSync(path.join(userSettingsDir, 'settings.json'), 'utf-8');
    const settingsChanged = !settingsAfter.includes('"workbench.startupEditor": "none"') ||
                            settingsAfter.includes('colorCustomizations');
    console.log(`  Settings modified by extension: ${settingsChanged}`);

    // --- Step 6: Second launch (post-restart) ---
    console.log('\n[6/7] Second launch (post-restart, screenshot)...');
    const screenshot2 = path.join(screenshotDir, `vibrancy-e2e-${process.platform}-2-post-restart.png`);

    const secondResult = await launchAndWaitForSignal(vscodeExe, userDataDir, tmpWorkspace, {
      signalFile: null, // Don't wait for signal on second launch
      screenshotDelay: 12000,
      screenshotPath: screenshot2,
      killTimeout: 20000,
    });
    console.log(`  Exit code: ${secondResult.exitCode}`);

    // --- Step 7: Results ---
    console.log('\n[7/7] Results:');
    const installOk = firstResult.signal && firstResult.signal.status === 'success';
    const nocrash = secondResult.exitCode === 0 || secondResult.exitCode === null;
    const success = installOk && nocrash;

    console.log(`  Extension installed: ${installOk ? 'PASS' : 'FAIL'}`);
    console.log(`  Post-restart crash check: ${nocrash ? 'PASS' : 'FAIL'}`);
    console.log(`  Overall: ${success ? 'PASS' : 'FAIL'}`);

    writeGitHubSummary(success, screenshot2, firstResult, secondResult);

    process.exit(success ? 0 : 1);

  } finally {
    try { fs.unlinkSync(testModeFile); } catch {}
    try { fs.unlinkSync(signalFile); } catch {}
    try { if (userDataDir) fs.rmSync(userDataDir, { recursive: true, force: true }); } catch {}
    try { if (tmpWorkspace) fs.rmSync(tmpWorkspace, { recursive: true, force: true }); } catch {}
    try { if (vsixPath) fs.unlinkSync(vsixPath); } catch {}
  }
}

/**
 * Launch VSCode, optionally poll for a signal file, capture a screenshot, then kill.
 */
function launchAndWaitForSignal(executablePath, userDataDir, workspace, opts) {
  const { signalFile, signalTimeout, screenshotDelay, screenshotPath, killTimeout } = opts;

  return new Promise((resolve) => {
    const args = [
      '--user-data-dir', userDataDir,
      '--disable-gpu',
      '--no-sandbox',
      '--disable-workspace-trust',
      '--skip-release-notes',
      '--skip-welcome',
      workspace,
    ];

    console.log(`  Launching: ${path.basename(executablePath)} ${args.slice(0, 3).join(' ')} ...`);

    const proc = spawn(executablePath, args, {
      stdio: 'pipe',
      env: { ...process.env, ELECTRON_DISABLE_SANDBOX: '1' },
    });

    let stdout = '';
    let stderr = '';
    proc.stdout?.on('data', (chunk) => { stdout += chunk.toString(); });
    proc.stderr?.on('data', (chunk) => { stderr += chunk.toString(); });

    let exited = false;
    let signal = null;
    let pollInterval;

    function finish(exitCode) {
      if (exited) return;
      exited = true;
      if (pollInterval) clearInterval(pollInterval);
      if (stdout.trim()) console.log(`  stdout: ${stdout.slice(0, 300)}`);
      if (stderr.trim()) console.log(`  stderr: ${stderr.slice(0, 300)}`);
      resolve({ exitCode, signal });
    }

    proc.on('exit', (code) => finish(code));

    // Poll for signal file from the extension
    if (signalFile && signalTimeout) {
      const pollStart = Date.now();
      pollInterval = setInterval(() => {
        try {
          if (fs.existsSync(signalFile)) {
            signal = JSON.parse(fs.readFileSync(signalFile, 'utf-8'));
            console.log(`  Signal received after ${((Date.now() - pollStart) / 1000).toFixed(1)}s`);
            // Don't kill yet — let the screenshot happen
          }
        } catch {}
        if (Date.now() - pollStart > signalTimeout && !signal) {
          console.log('  Signal timeout — extension did not write a result');
        }
      }, 1000);
    }

    // Screenshot while VSCode is running
    if (screenshotDelay && screenshotPath) {
      setTimeout(() => {
        if (!exited) {
          console.log('  Capturing screenshot...');
          captureScreenshot(screenshotPath);
        }
      }, screenshotDelay);
    }

    // Kill after timeout
    setTimeout(() => {
      if (!exited) {
        proc.kill('SIGTERM');
        setTimeout(() => {
          if (!exited) {
            proc.kill('SIGKILL');
            finish(null);
          }
        }, 3000);
      }
    }, killTimeout);
  });
}

// --- Screenshot capture ---

/**
 * Write a PowerShell script to a temp file and execute it.
 */
function runPsScript(script) {
  const scriptPath = path.join(os.tmpdir(), `vibrancy-screenshot-${Date.now()}.ps1`);
  try {
    fs.writeFileSync(scriptPath, script, 'utf-8');
    return execSync(
      `powershell -NoProfile -ExecutionPolicy Bypass -File "${scriptPath}"`,
      { timeout: 15000, encoding: 'utf-8' }
    );
  } finally {
    try { fs.unlinkSync(scriptPath); } catch {}
  }
}

function captureScreenshot(outputPath) {
  const methods = [];

  if (process.platform === 'darwin') {
    methods.push(() => execSync(`screencapture -x "${outputPath}"`, { timeout: 10000 }));
  } else if (process.platform === 'linux') {
    methods.push(() => execSync(`import -window root "${outputPath}"`, { timeout: 10000 }));
    methods.push(() => execSync(`xwd -root -silent | convert xwd:- png:"${outputPath}"`, { timeout: 10000 }));
    methods.push(() => execSync(`scrot "${outputPath}"`, { timeout: 10000 }));
  } else if (process.platform === 'win32') {
    const psPath = outputPath.replace(/'/g, "''");

    methods.push(() => {
      const out = runPsScript([
        `Add-Type -AssemblyName System.Windows.Forms`,
        `Add-Type -AssemblyName System.Drawing`,
        `$bounds = [System.Windows.Forms.SystemInformation]::VirtualScreen`,
        `if ($bounds.Width -le 0 -or $bounds.Height -le 0) { throw "No screen: $($bounds.Width)x$($bounds.Height)" }`,
        `Write-Host "Screen bounds: $($bounds.Width)x$($bounds.Height)"`,
        `$bitmap = New-Object System.Drawing.Bitmap($bounds.Width, $bounds.Height)`,
        `$graphics = [System.Drawing.Graphics]::FromImage($bitmap)`,
        `$graphics.CopyFromScreen($bounds.Location, [System.Drawing.Point]::Empty, $bounds.Size)`,
        `$bitmap.Save('${psPath}', [System.Drawing.Imaging.ImageFormat]::Png)`,
        `$graphics.Dispose()`,
        `$bitmap.Dispose()`,
      ].join('\r\n'));
      if (out.trim()) console.log(`  ${out.trim()}`);
    });

    methods.push(() => runPsScript([
      `Add-Type @"`,
      `using System;`,
      `using System.Runtime.InteropServices;`,
      `using System.Drawing;`,
      `using System.Drawing.Imaging;`,
      `public class ScreenCapture {`,
      `    [DllImport("user32.dll")] static extern IntPtr GetDesktopWindow();`,
      `    [DllImport("user32.dll")] static extern IntPtr GetWindowDC(IntPtr hWnd);`,
      `    [DllImport("user32.dll")] static extern int ReleaseDC(IntPtr hWnd, IntPtr hDC);`,
      `    [DllImport("gdi32.dll")] static extern IntPtr CreateCompatibleDC(IntPtr hdc);`,
      `    [DllImport("gdi32.dll")] static extern IntPtr CreateCompatibleBitmap(IntPtr hdc, int w, int h);`,
      `    [DllImport("gdi32.dll")] static extern IntPtr SelectObject(IntPtr hdc, IntPtr obj);`,
      `    [DllImport("gdi32.dll")] static extern bool BitBlt(IntPtr hdcDst, int x1, int y1, int w, int h, IntPtr hdcSrc, int x2, int y2, int op);`,
      `    [DllImport("gdi32.dll")] static extern bool DeleteDC(IntPtr hdc);`,
      `    [DllImport("gdi32.dll")] static extern bool DeleteObject(IntPtr obj);`,
      `    [DllImport("user32.dll")] static extern bool GetWindowRect(IntPtr hWnd, out RECT r);`,
      `    [StructLayout(LayoutKind.Sequential)] public struct RECT { public int L,T,R,B; }`,
      `    public static void Capture(string path) {`,
      `        IntPtr desk = GetDesktopWindow();`,
      `        RECT r; GetWindowRect(desk, out r);`,
      `        int w = r.R - r.L, h = r.B - r.T;`,
      `        if (w <= 0 || h <= 0) throw new Exception("Desktop " + w + "x" + h);`,
      `        IntPtr hdc = GetWindowDC(desk);`,
      `        IntPtr mdc = CreateCompatibleDC(hdc);`,
      `        IntPtr bmp = CreateCompatibleBitmap(hdc, w, h);`,
      `        SelectObject(mdc, bmp);`,
      `        BitBlt(mdc, 0, 0, w, h, hdc, r.L, r.T, 0x00CC0020);`,
      `        var img = Image.FromHbitmap(bmp);`,
      `        img.Save(path, ImageFormat.Png);`,
      `        img.Dispose(); DeleteObject(bmp); DeleteDC(mdc); ReleaseDC(desk, hdc);`,
      `    }`,
      `}`,
      `"@`,
      `[ScreenCapture]::Capture('${psPath}')`,
    ].join('\r\n')));
  }

  for (const method of methods) {
    try {
      method();
      if (fs.existsSync(outputPath) && fs.statSync(outputPath).size > 0) return;
    } catch (err) {
      console.log(`  Screenshot method failed: ${err.message.split('\n')[0]}`);
    }
  }
  console.log('  All screenshot methods exhausted');
}

// --- GitHub summary ---

function writeGitHubSummary(success, screenshotPath, firstResult, secondResult) {
  const summaryFile = process.env.GITHUB_STEP_SUMMARY;
  if (!summaryFile) return;

  const platform = { darwin: 'macOS', linux: 'Linux', win32: 'Windows' }[process.platform] || process.platform;
  const check = (v) => v ? '✅' : '❌';
  const installOk = firstResult.signal && firstResult.signal.status === 'success';
  const nocrash = secondResult.exitCode === 0 || secondResult.exitCode === null;

  let md = `## E2E Test — ${platform}\n\n`;
  md += `| Check | Status |\n`;
  md += `|-------|--------|\n`;
  md += `| Overall | ${check(success)} ${success ? 'PASS' : 'FAIL'} |\n`;
  md += `| Extension signal | ${check(installOk)} ${firstResult.signal ? firstResult.signal.status : 'no signal'} |\n`;
  md += `| Post-restart crash | ${check(nocrash)} |\n`;
  if (firstResult.signal && firstResult.signal.message) {
    md += `| Signal message | ${firstResult.signal.message} |\n`;
  }
  md += `\n`;

  if (screenshotPath && fs.existsSync(screenshotPath)) {
    const size = (fs.statSync(screenshotPath).size / 1024).toFixed(1);
    md += `📸 Screenshot captured (${size} KB) — see **screenshots** artifact.\n`;
  } else {
    md += `_No screenshot captured._\n`;
  }

  fs.appendFileSync(summaryFile, md);
}

main().catch((err) => {
  console.error('E2E test failed:', err);
  process.exit(1);
});
