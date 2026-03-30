/**
 * E2E test for VSCode Vibrancy Continued.
 *
 * Downloads a real VSCode instance, installs the extension with testMode enabled,
 * verifies it installs without crashing, and captures screenshots at each stage.
 *
 * Usage:   node test/e2e/run-e2e.js
 * Linux:   xvfb-run node test/e2e/run-e2e.js
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

/**
 * Find the VSCode app resource directory (where main.js lives) from the executable path.
 */
function findAppDir(vscodeExecutablePath) {
  // @vscode/test-electron downloads to .vscode-test/vscode-<platform>-<version>/
  // macOS: ...Visual Studio Code.app/Contents/Resources/app/
  // Linux: ...resources/app/
  // Windows: ...resources/app/
  const candidates = [];
  if (process.platform === 'darwin') {
    // Go up from MacOS/Electron to Contents/Resources/app
    candidates.push(path.join(path.dirname(vscodeExecutablePath), '..', 'Resources', 'app'));
  }
  // Linux/Windows: resources/app is sibling to the executable's parent
  candidates.push(path.join(path.dirname(vscodeExecutablePath), 'resources', 'app'));
  candidates.push(path.join(path.dirname(vscodeExecutablePath), '..', 'resources', 'app'));

  for (const candidate of candidates) {
    const resolved = path.resolve(candidate);
    if (fs.existsSync(path.join(resolved, 'main.js'))) {
      return resolved;
    }
  }
  return null;
}

async function main() {
  const { downloadAndUnzipVSCode, resolveCliPathFromVSCodeExecutablePath } = require('@vscode/test-electron');

  const screenshotDir = path.join(__dirname, '..', 'screenshots');
  fs.mkdirSync(screenshotDir, { recursive: true });

  const greenCssPath = path.join(__dirname, 'test-green.css');
  let testModeFile;
  let userDataDir;
  let tmpWorkspace;
  let vsixPath;

  try {
    console.log('=== E2E Test: VSCode Vibrancy Continued ===\n');

    // --- Download VSCode ---
    console.log('[1/7] Downloading VSCode...');
    const vscodeExecutablePath = await downloadAndUnzipVSCode('stable');
    const cliPath = resolveCliPathFromVSCodeExecutablePath(vscodeExecutablePath);
    console.log(`  Executable: ${vscodeExecutablePath}`);
    console.log(`  CLI: ${cliPath}`);

    const appDir = findAppDir(vscodeExecutablePath);
    if (!appDir) {
      console.error('  ERROR: Could not find VSCode app directory (main.js)');
      process.exit(1);
    }
    console.log(`  App dir: ${appDir}`);

    const mainJsPath = path.join(appDir, 'main.js');
    // Determine which HTML file exists
    const htmlCandidates = [
      path.join(appDir, 'vs/code/electron-browser/workbench/workbench.html'),
      path.join(appDir, 'vs/code/electron-sandbox/workbench/workbench.html'),
      path.join(appDir, 'vs/code/electron-sandbox/workbench/workbench.esm.html'),
    ];
    const htmlPath = htmlCandidates.find(p => fs.existsSync(p));
    console.log(`  main.js: ${mainJsPath} (exists: ${fs.existsSync(mainJsPath)})`);
    console.log(`  HTML: ${htmlPath || 'NOT FOUND'}`);

    // --- Enable test mode ---
    console.log('\n[2/7] Enabling test mode...');
    const configDir = getConfigDir();
    testModeFile = path.join(configDir, 'test-mode');
    fs.mkdirSync(configDir, { recursive: true });
    fs.writeFileSync(testModeFile, `e2e-test-${Date.now()}`);
    console.log(`  Test mode file: ${testModeFile}`);

    // --- User settings ---
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

    // --- Package and install ---
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

    // Verify the extension is actually installed
    const extensionsDir = path.join(userDataDir, 'extensions');
    if (fs.existsSync(extensionsDir)) {
      const installed = fs.readdirSync(extensionsDir);
      console.log(`  Installed extensions: ${installed.join(', ') || '(none)'}`);
    } else {
      console.log('  WARNING: extensions directory does not exist');
    }

    // --- Snapshot main.js BEFORE first launch ---
    const mainJsBefore = fs.readFileSync(mainJsPath, 'utf-8');
    const htmlBefore = htmlPath ? fs.readFileSync(htmlPath, 'utf-8') : '';
    console.log(`\n  main.js before: ${mainJsBefore.length} bytes, has vibrancy markers: ${mainJsBefore.includes('VSCODE-VIBRANCY-START')}`);
    console.log(`  HTML before: ${htmlBefore.length} bytes, has CSP patch: ${htmlBefore.includes('VscodeVibrancyContinued')}`);

    // --- First launch ---
    console.log('\n[4/7] First launch (extension should install vibrancy)...');
    tmpWorkspace = fs.mkdtempSync(path.join(os.tmpdir(), 'vibrancy-e2e-workspace-'));
    const screenshot1 = path.join(screenshotDir, `vibrancy-e2e-${process.platform}-1-first-launch.png`);
    const firstExitCode = await launchVSCode(vscodeExecutablePath, userDataDir, tmpWorkspace, {
      totalTimeout: 25000,
      screenshotDelay: 12000,
      screenshotPath: screenshot1,
    });
    console.log(`  Exit code: ${firstExitCode}`);

    // --- Check if files were modified ---
    console.log('\n[5/7] Checking file modifications...');
    const mainJsAfter = fs.readFileSync(mainJsPath, 'utf-8');
    const htmlAfter = htmlPath ? fs.readFileSync(htmlPath, 'utf-8') : '';
    const mainJsModified = mainJsAfter !== mainJsBefore;
    const htmlModified = htmlAfter !== htmlBefore;
    const hasMarkers = mainJsAfter.includes('VSCODE-VIBRANCY-START');
    const hasCspPatch = htmlAfter.includes('VscodeVibrancyContinued');
    const runtimeDir = path.join(appDir, 'vscode-vibrancy-runtime-v6');
    const runtimeExists = fs.existsSync(runtimeDir);

    console.log(`  main.js modified: ${mainJsModified}`);
    console.log(`  main.js has vibrancy markers: ${hasMarkers}`);
    console.log(`  HTML modified: ${htmlModified}`);
    console.log(`  HTML has CSP patch: ${hasCspPatch}`);
    console.log(`  Runtime dir exists: ${runtimeExists}`);
    if (runtimeExists) {
      console.log(`  Runtime contents: ${fs.readdirSync(runtimeDir).join(', ')}`);
    }
    console.log(`  main.js after: ${mainJsAfter.length} bytes (was ${mainJsBefore.length})`);

    if (!mainJsModified) {
      console.log('\n  WARNING: main.js was NOT modified by the extension!');
      console.log('  The extension may not have activated or may have failed silently.');
      // Dump the last few lines of main.js to see if there's anything there
      const lines = mainJsAfter.split('\n');
      console.log(`  Last 5 lines of main.js:\n    ${lines.slice(-5).join('\n    ')}`);
    }

    // Check settings.json for any changes made by the extension
    const settingsAfter = fs.readFileSync(path.join(userSettingsDir, 'settings.json'), 'utf-8');
    console.log(`  settings.json after first launch (${settingsAfter.length} bytes):`);
    console.log(`    ${settingsAfter.slice(0, 500).replace(/\n/g, '\n    ')}`);

    // --- Second launch ---
    console.log('\n[6/7] Second launch (screenshot + crash check)...');
    const screenshot2 = path.join(screenshotDir, `vibrancy-e2e-${process.platform}-2-second-launch.png`);
    const secondExitCode = await launchVSCode(vscodeExecutablePath, userDataDir, tmpWorkspace, {
      totalTimeout: 25000,
      screenshotDelay: 12000,
      screenshotPath: screenshot2,
    });
    console.log(`  Exit code: ${secondExitCode}`);

    // --- Results ---
    console.log('\n[7/7] Results:');
    const nocrash = secondExitCode === 0 || secondExitCode === null;
    const filesModified = hasMarkers || hasCspPatch;

    console.log(`  Crash check: ${nocrash ? 'PASS' : 'FAIL'}`);
    console.log(`  Files modified: ${filesModified ? 'PASS' : 'FAIL'}`);

    const success = nocrash && filesModified;
    console.log(`  Overall: ${success ? 'PASS' : 'FAIL'}`);

    writeGitHubSummary(success, screenshot2, secondExitCode, { hasMarkers, hasCspPatch, runtimeExists, mainJsModified });

    process.exit(success ? 0 : 1);

  } finally {
    // Cleanup
    try { if (testModeFile) fs.unlinkSync(testModeFile); } catch {}
    try { if (userDataDir) fs.rmSync(userDataDir, { recursive: true, force: true }); } catch {}
    try { if (tmpWorkspace) fs.rmSync(tmpWorkspace, { recursive: true, force: true }); } catch {}
    try { if (vsixPath) fs.unlinkSync(vsixPath); } catch {}
  }
}

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

    console.log(`  Launching: ${path.basename(executablePath)} ${args.join(' ')}`);

    const proc = spawn(executablePath, args, {
      stdio: 'pipe',
      env: { ...process.env, ELECTRON_DISABLE_SANDBOX: '1' },
    });

    let stdout = '';
    let stderr = '';
    proc.stdout?.on('data', (chunk) => { stdout += chunk.toString(); });
    proc.stderr?.on('data', (chunk) => { stderr += chunk.toString(); });

    let exited = false;
    proc.on('exit', (code) => {
      exited = true;
      if (stdout.trim()) console.log(`  stdout: ${stdout.slice(0, 500)}`);
      if (stderr.trim()) console.log(`  stderr: ${stderr.slice(0, 500)}`);
      resolve(code);
    });

    if (screenshotDelay && screenshotPath) {
      setTimeout(() => {
        if (!exited) {
          console.log('  Capturing screenshot...');
          captureScreenshot(screenshotPath);
        }
      }, screenshotDelay);
    }

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
 * Write a PowerShell script to a temp file and execute it.
 * Avoids quoting issues with -Command when scripts contain here-strings or double quotes.
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

    // Method 1: CopyFromScreen — works on interactive desktops
    methods.push(() => {
      const script = [
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
      ].join('\r\n');
      const out = runPsScript(script);
      if (out.trim()) console.log(`  ${out.trim()}`);
    });

    // Method 2: Win32 BitBlt via temp .ps1 file (here-strings can't be passed inline)
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
      if (fs.existsSync(outputPath) && fs.statSync(outputPath).size > 0) {
        return;
      }
    } catch (err) {
      console.log(`  Screenshot method failed: ${err.message.split('\n')[0]}`);
    }
  }
  console.log('  All screenshot methods exhausted');
}

function writeGitHubSummary(success, screenshotPath, exitCode, checks) {
  const summaryFile = process.env.GITHUB_STEP_SUMMARY;
  if (!summaryFile) return;

  const platform = { darwin: 'macOS', linux: 'Linux', win32: 'Windows' }[process.platform] || process.platform;
  const status = success ? '✅ PASS' : '❌ FAIL';
  const exitInfo = exitCode === null ? 'killed by test (expected)' : `exit code ${exitCode}`;
  const check = (v) => v ? '✅' : '❌';

  let md = `## E2E Test — ${platform}\n\n`;
  md += `| Check | Status |\n`;
  md += `|-------|--------|\n`;
  md += `| Overall | ${status} |\n`;
  md += `| Crash check | ${check(exitCode === 0 || exitCode === null)} (${exitInfo}) |\n`;
  md += `| main.js modified | ${check(checks.mainJsModified)} |\n`;
  md += `| Vibrancy markers | ${check(checks.hasMarkers)} |\n`;
  md += `| CSP patched | ${check(checks.hasCspPatch)} |\n`;
  md += `| Runtime installed | ${check(checks.runtimeExists)} |\n\n`;

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
