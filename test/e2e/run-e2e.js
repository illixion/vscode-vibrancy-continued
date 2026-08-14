/**
 * E2E test for VSCode Vibrancy Continued.
 *
 * Flow:
 *   1. Download VSCode via @vscode/test-electron
 *   2. Set the desktop wallpaper to solid green (and start a compositor on
 *      Linux) — with vibrancy type "transparent", green pixels inside the
 *      VSCode window can only come from the desktop showing THROUGH the
 *      window, so this verifies real end-to-end transparency rather than just
 *      CSS injection. (An injection-only check passed right through the
 *      VSCode 1.133 Modern UI regression, where injected CSS lost to the new
 *      opaque !important panel backgrounds — issue #269.)
 *      A baseline capture then confirms the desktop really is green, and fails
 *      the run if not — an unusable desktop makes every downstream
 *      transparency check meaningless, and skipping would silently drop the
 *      coverage instead of telling anyone (see verifyDesktopBaseline).
 *   3. Install extension via CLI (--install-extension)
 *   4. Create test-mode flag + settings in the vibrancy config dir. Settings
 *      use the bundled "Default Dark" theme (so the shipped theme CSS is what
 *      gets tested), force workbench.experimental.modernUI on (so the Modern
 *      UI opaque backgrounds are exercised even outside the A/B cohort), and
 *      import a solid magenta "beacon" CSS to prove injection independently.
 *   5. Launch VSCode — extension activates, detects test mode, auto-installs
 *   6. Wait for extension to write a signal file (success/error)
 *   7. Relaunch VSCode (post-restart), screenshot, and verify: green shows
 *      through the editor AND the sidebar (the region Modern UI painted
 *      opaque), and the magenta beacon is present
 *   8. Uninstall, relaunch, verify green/magenta are gone
 *
 * Usage:   node test/e2e/run-e2e.js
 * Linux:   xvfb-run --auto-servernum --server-args="-screen 0 1920x1080x24" node test/e2e/run-e2e.js
 *          (requires openbox, picom, hsetroot for the transparency check)
 */

const path = require('path');
const fs = require('fs');
const os = require('os');
const { execSync, spawn } = require('child_process');
const { ALL_VIBRANCY_BG_KEYS } = require('../../extension/file-transforms');

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

  const importCssPath = path.join(__dirname, 'test-import.css');
  const configDir = getConfigDir();
  const testModeFile = path.join(configDir, 'test-mode');
  const signalFile = path.join(configDir, 'test-result');
  let userDataDir, tmpWorkspace, vsixPath;
  let desktopCleanup = null;

  try {
    console.log('=== E2E Test: VSCode Vibrancy Continued ===\n');

    // --- Step 1: Download VSCode ---
    const vscodeVersion = process.env.VSCODE_VERSION || 'stable';
    console.log(`[1/9] Downloading VSCode (${vscodeVersion})...`);
    const vscodeCachePath = path.join(process.cwd(), '.vscode-test');
    const vscodeExe = await downloadVSCodeWithRetry(downloadAndUnzipVSCode, vscodeVersion, vscodeCachePath);
    const cliPath = resolveCliPathFromVSCodeExecutablePath(vscodeExe);
    console.log(`  Executable: ${vscodeExe}`);
    console.log(`  CLI: ${cliPath}`);

    const versionInfo = getVSCodeVersionInfo(cliPath);
    console.log(`  VSCode version: ${versionInfo.version}`);
    console.log(`  VSCode commit:  ${versionInfo.commit}`);
    console.log(`  VSCode arch:    ${versionInfo.arch}`);

    // --- Step 2: Green wallpaper + test mode BEFORE extension ever runs ---
    console.log('\n[2/9] Preparing desktop (green wallpaper) and test mode...');
    desktopCleanup = setupDesktop();
    const baseline = verifyDesktopBaseline(screenshotDir);
    fs.mkdirSync(configDir, { recursive: true });
    fs.writeFileSync(testModeFile, `e2e-${Date.now()}`);
    try { fs.unlinkSync(signalFile); } catch {}
    console.log(`  Test mode file: ${testModeFile}`);

    // --- Step 3: Prepare user-data-dir with settings ---
    console.log('\n[3/9] Preparing settings...');
    userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vibrancy-e2e-userdata-'));
    const userSettingsDir = path.join(userDataDir, 'User');
    fs.mkdirSync(userSettingsDir, { recursive: true });
    fs.writeFileSync(path.join(userSettingsDir, 'settings.json'), JSON.stringify({
      // Test the bundled theme (its CSS carries the Modern UI overrides), with
      // the see-through "transparent" type so the green wallpaper is visible
      // through the window — the only way the green checks can pass.
      "vscode_vibrancy.theme": "Default Dark",
      "vscode_vibrancy.type": "transparent",
      // Low backdrop opacity so the wallpaper reads clearly through the html
      // background layer; the theme's own per-part tints stay in effect.
      "vscode_vibrancy.opacity": 0.15,
      // Injection beacon: paints a solid magenta square at the window center.
      "vscode_vibrancy.imports": [importCssPath],
      // Force the 1.133+ Modern UI on (it's A/B flighted server-side, default
      // off in CI) so its opaque !important panel backgrounds are exercised.
      // Unknown on older VSCode versions, where it's ignored.
      "workbench.experimental.modernUI": true,
      // Maximize so screen captures are (almost) all window — region checks
      // and the post-uninstall "no green" check rely on this.
      "window.newWindowDimensions": "maximized",
      "workbench.colorTheme": "Default Dark+",
      // Pin dark theme so uninstall restores to dark (not system default which may be light)
      "window.systemColorTheme": "dark",
      "window.autoDetectColorScheme": false,
      "security.workspace.trust.enabled": false,
      "workbench.welcome.enabled": false,
      "workbench.startupEditor": "none",
      "workbench.tips.enabled": false,
      "telemetry.telemetryLevel": "off",
      "update.mode": "none",
      "extensions.autoUpdate": false,
    }, null, 2));
    console.log(`  User data dir: ${userDataDir}`);

    // Snapshot original settings before any vibrancy changes
    const settingsJsonPath = path.join(userSettingsDir, 'settings.json');
    const originalSettings = JSON.parse(fs.readFileSync(settingsJsonPath, 'utf-8'));

    // --- Step 4: Package and install extension ---
    console.log('\n[4/9] Packaging and installing extension...');
    const extensionDir = path.resolve(__dirname, '..', '..');
    vsixPath = path.join(os.tmpdir(), 'vibrancy-e2e-test.vsix');
    const extensionsInstallDir = path.join(userDataDir, 'extensions');
    execSync(
      `npx @vscode/vsce package --out "${vsixPath}"`,
      { cwd: extensionDir, stdio: 'inherit', timeout: 300000 }
    );
    console.log(`  Packaged: ${vsixPath}`);
    // --extensions-dir is required; --user-data-dir alone does NOT control
    // where extensions get installed (they'd go to ~/.vscode/extensions/)
    execSync(
      `"${cliPath}" --install-extension "${vsixPath}" --extensions-dir "${extensionsInstallDir}" --force`,
      { stdio: 'inherit', timeout: 120000 }
    );

    // Verify extension installed
    if (fs.existsSync(extensionsInstallDir)) {
      console.log(`  Installed: ${fs.readdirSync(extensionsInstallDir).filter(f => !f.startsWith('.')).join(', ')}`);
    } else {
      console.log('  WARNING: extensions directory not created');
    }

    // --- Step 5: First launch — extension activates, sees test-mode, auto-installs ---
    console.log('\n[5/9] First launch (extension installs vibrancy)...');
    tmpWorkspace = fs.mkdtempSync(path.join(os.tmpdir(), 'vibrancy-e2e-workspace-'));
    const screenshot1 = path.join(screenshotDir, `vibrancy-e2e-${process.platform}-1-install.png`);

    const firstResult = await launchAndWaitForSignal(vscodeExe, userDataDir, extensionsInstallDir, tmpWorkspace, {
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

    // Verify settings.json after install (read after VSCode exits to avoid flush race)
    const installSettingsCheck = verifySettingsAfterInstall(settingsJsonPath);
    console.log(`  Settings after install: ${installSettingsCheck.ok ? 'PASS' : 'FAIL'}`);
    if (!installSettingsCheck.ok) {
      for (const err of installSettingsCheck.errors) console.log(`    - ${err}`);
    }

    // --- Step 6: Second launch (post-restart, vibrancy active) ---
    console.log('\n[6/9] Second launch (post-restart, screenshot)...');
    const screenshot2 = path.join(screenshotDir, `vibrancy-e2e-${process.platform}-2-post-restart.png`);

    const secondResult = await launchAndWaitForSignal(vscodeExe, userDataDir, extensionsInstallDir, tmpWorkspace, {
      signalFile: null,
      screenshotDelay: 12000,
      screenshotPath: screenshot2,
      killTimeout: 20000,
    });
    console.log(`  Exit code: ${secondResult.exitCode}`);

    // True-transparency checks on the post-restart screenshot. Green comes
    // exclusively from the wallpaper behind the window, so each region proves
    // the window is actually see-through there.
    //
    //  - center crop: overall transparency (mostly editor area)
    //  - left strip (x 6-14%, y 25-75%): the sidebar — the region VSCode
    //    1.133's Modern UI painted opaque (#269); would pass an editor-only
    //    transparency but catch opaque panels
    //  - whole capture: the magenta frame from test-import.css — proves the
    //    custom-imports CSS was injected, independent of transparency
    const SIDEBAR_REGION = '0.06,0.25,0.14,0.75';
    const greenPct = checkPixels(screenshot2, '10', 'green');
    const greenOk = greenPct !== null && greenPct >= 30.0;
    console.log(`  Green through window (center): ${fmtPct(greenPct)} (${greenOk ? 'PASS' : 'FAIL'})`);
    const sidebarPct = checkPixels(screenshot2, SIDEBAR_REGION, 'green');
    const sidebarOk = sidebarPct !== null && sidebarPct >= 50.0;
    console.log(`  Green through sidebar: ${fmtPct(sidebarPct)} (${sidebarOk ? 'PASS' : 'FAIL'})`);
    // The beacon frame hugs the window edges, so measure the whole capture
    // rather than a region: a modal dialog can cover part of the frame but
    // never all of it. ~5-8% of the capture is frame when it renders.
    const beaconPct = checkPixels(screenshot2, '0', 'magenta');
    const beaconOk = beaconPct !== null && beaconPct >= 1.5;
    console.log(`  Import beacon (magenta frame): ${fmtPct(beaconPct)} (${beaconOk ? 'PASS' : 'FAIL'})`);

    // --- Step 7: Request uninstall ---
    console.log('\n[7/9] Third launch (uninstall vibrancy)...');
    // Clear previous signal and create uninstall request file
    try { fs.unlinkSync(signalFile); } catch {}
    const uninstallFile = path.join(configDir, 'test-uninstall');
    fs.writeFileSync(uninstallFile, `uninstall-${Date.now()}`);

    const thirdResult = await launchAndWaitForSignal(vscodeExe, userDataDir, extensionsInstallDir, tmpWorkspace, {
      signalFile,
      signalTimeout: 30000,
      killTimeout: 40000,
    });
    console.log(`  Exit code: ${thirdResult.exitCode}`);
    if (thirdResult.signal) {
      console.log(`  Signal: ${thirdResult.signal.status} — ${thirdResult.signal.message}`);
    } else {
      console.log('  Signal: NOT RECEIVED');
    }

    // Verify settings.json after uninstall (read after VSCode exits to avoid flush race)
    const uninstallSettingsCheck = verifySettingsAfterUninstall(settingsJsonPath, originalSettings);
    console.log(`  Settings after uninstall: ${uninstallSettingsCheck.ok ? 'PASS' : 'FAIL'}`);
    if (!uninstallSettingsCheck.ok) {
      for (const err of uninstallSettingsCheck.errors) console.log(`    - ${err}`);
    }

    // --- Step 8: Fourth launch (post-uninstall, verify clean) ---
    console.log('\n[8/9] Fourth launch (post-uninstall, verify clean)...');
    const screenshot4 = path.join(screenshotDir, `vibrancy-e2e-${process.platform}-3-post-uninstall.png`);

    const fourthResult = await launchAndWaitForSignal(vscodeExe, userDataDir, extensionsInstallDir, tmpWorkspace, {
      signalFile: null,
      screenshotDelay: 12000,
      screenshotPath: screenshot4,
      killTimeout: 20000,
    });
    console.log(`  Exit code: ${fourthResult.exitCode}`);

    // Verify transparency and the injected beacon are gone after uninstall.
    // The wallpaper is still green, so this also proves the window is opaque
    // again (a maximized opaque window leaves no wallpaper in the crop).
    const postUninstallGreen = checkPixels(screenshot4, '10', 'green');
    const postUninstallBeacon = checkPixels(screenshot4, '0', 'magenta');
    const uninstallClean =
      (postUninstallGreen === null || postUninstallGreen < 5.0) &&
      (postUninstallBeacon === null || postUninstallBeacon < 0.5);
    console.log(`  Green after uninstall: ${fmtPct(postUninstallGreen)}, beacon: ${fmtPct(postUninstallBeacon)} (${uninstallClean ? 'PASS' : 'FAIL'})`);

    // --- Step 9: Results ---
    console.log('\n[9/9] Results:');
    const installOk = firstResult.signal && firstResult.signal.status === 'success';
    const nocrash = secondResult.exitCode === 0 || secondResult.exitCode === null;
    const installSettingsOk = installSettingsCheck.ok;
    const uninstallOk = thirdResult.signal && thirdResult.signal.status === 'uninstalled';
    const uninstallSettingsOk = uninstallSettingsCheck.ok;
    const postUninstallNocrash = fourthResult.exitCode === 0 || fourthResult.exitCode === null;
    const success = baseline.supported && installOk && nocrash && greenOk && sidebarOk && beaconOk && installSettingsOk && uninstallOk && uninstallSettingsOk && postUninstallNocrash && uninstallClean;

    console.log(`  Desktop baseline: ${baseline.supported ? 'PASS' : 'FAIL'}`);
    console.log(`  Install signal: ${installOk ? 'PASS' : 'FAIL'}`);
    console.log(`  Post-install crash: ${nocrash ? 'PASS' : 'FAIL'}`);
    console.log(`  Transparency (center): ${greenOk ? 'PASS' : 'FAIL'}`);
    console.log(`  Transparency (sidebar): ${sidebarOk ? 'PASS' : 'FAIL'}`);
    console.log(`  CSS import beacon: ${beaconOk ? 'PASS' : 'FAIL'}`);
    console.log(`  Settings after install: ${installSettingsOk ? 'PASS' : 'FAIL'}`);
    console.log(`  Uninstall signal: ${uninstallOk ? 'PASS' : 'FAIL'}`);
    console.log(`  Settings after uninstall: ${uninstallSettingsOk ? 'PASS' : 'FAIL'}`);
    console.log(`  Post-uninstall crash: ${postUninstallNocrash ? 'PASS' : 'FAIL'}`);
    console.log(`  Vibrancy removed: ${uninstallClean ? 'PASS' : 'FAIL'}`);
    console.log(`  Overall: ${success ? 'PASS' : 'FAIL'}`);

    if (!baseline.supported) {
      console.log('');
      console.log('  ^ ENVIRONMENT FAILURE, not a vibrancy regression: the desktop behind');
      console.log(`  ^ VSCode was only ${fmtPct(baseline.pct)} green, so the transparency checks above`);
      console.log('  ^ could not measure anything. Fix the harness, not the extension.');
    }

    writeGitHubSummary(success, screenshot2, {
      installOk, nocrash, greenOk, greenPct, sidebarOk, sidebarPct, beaconOk, beaconPct,
      installSettingsOk, uninstallOk, uninstallSettingsOk, postUninstallNocrash,
      uninstallClean, postUninstallGreen, postUninstallBeacon,
      baselineSupported: baseline.supported, baselinePct: baseline.pct,
    }, { vscodeVersion, versionInfo });

    process.exit(success ? 0 : 1);

  } finally {
    try { if (desktopCleanup) desktopCleanup(); } catch {}
    try { fs.unlinkSync(testModeFile); } catch {}
    try { fs.unlinkSync(signalFile); } catch {}
    try { fs.unlinkSync(path.join(configDir, 'test-uninstall')); } catch {}
    try { if (userDataDir) fs.rmSync(userDataDir, { recursive: true, force: true }); } catch {}
    try { if (tmpWorkspace) fs.rmSync(tmpWorkspace, { recursive: true, force: true }); } catch {}
    try { if (vsixPath) fs.unlinkSync(vsixPath); } catch {}
  }
}

/**
 * Launch VSCode, optionally poll for a signal file, capture a screenshot, then kill.
 */
function launchAndWaitForSignal(executablePath, userDataDir, extensionsDir, workspace, opts) {
  const { signalFile, signalTimeout, screenshotDelay, screenshotPath, killTimeout } = opts;

  return new Promise((resolve) => {
    const args = [
      '--user-data-dir', userDataDir,
      '--extensions-dir', extensionsDir,
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

// --- VSCode version probe ---

/**
 * Run the resolved VSCode CLI with --version. Output is three lines:
 * version, commit hash, architecture.
 */
/**
 * Resolve the real VSCode executable, working around microsoft/vscode-test#349.
 *
 * VSCode 1.110+ renamed the macOS main binary from Contents/MacOS/Electron to
 * the product name ("Code - Insiders" / "Code"); a compat symlink kept the old
 * name working until it was removed in July 2026. @vscode/test-electron still
 * hardcodes .../Contents/MacOS/Electron, so the path it returns no longer
 * exists and spawning it fails with ENOENT. (The CLI path is derived by
 * relative traversal and is unaffected, which is why --version still works.)
 *
 * If the returned path exists, use it as-is. Otherwise, on macOS, look up the
 * bundle's real executable via CFBundleExecutable, falling back to the sole
 * binary in Contents/MacOS.
 */
function resolveVSCodeExecutable(rawExe) {
  if (fs.existsSync(rawExe)) return rawExe;
  if (process.platform !== 'darwin') return rawExe;

  const macOsDir = path.dirname(rawExe); // .../Contents/MacOS
  // Prefer the bundle's declared executable. PlistBuddy handles both XML and
  // binary plists, so this is robust regardless of the plist encoding.
  try {
    const plist = path.join(macOsDir, '..', 'Info.plist');
    const name = execSync(
      `/usr/libexec/PlistBuddy -c "Print :CFBundleExecutable" "${plist}"`,
      { encoding: 'utf-8' }
    ).trim();
    const candidate = path.join(macOsDir, name);
    if (name && fs.existsSync(candidate)) return candidate;
  } catch {}
  // Fallback: Contents/MacOS holds exactly one binary (helpers live under
  // Contents/Frameworks), so pick the non-"Electron" entry if present.
  try {
    const entries = fs.readdirSync(macOsDir);
    const picked = entries.length === 1 ? entries[0] : entries.find(e => e !== 'Electron');
    if (picked) return path.join(macOsDir, picked);
  } catch {}
  return rawExe;
}

/**
 * Download VSCode with retries.
 *
 * Returns the resolved executable path (see resolveVSCodeExecutable). Also
 * guards against the occasional incomplete extraction where the download
 * reports success but the bundle isn't fully materialized: verify the resolved
 * executable exists and, on failure, wipe the cache to force a clean
 * re-download.
 */
async function downloadVSCodeWithRetry(downloadFn, version, cachePath, attempts = 3) {
  let lastErr;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      const rawExe = await downloadFn({ version, cachePath });
      const vscodeExe = resolveVSCodeExecutable(rawExe);
      if (fs.existsSync(vscodeExe)) return vscodeExe;
      lastErr = new Error(`VSCode executable not found after download: ${vscodeExe}`);
    } catch (err) {
      lastErr = err;
    }
    console.log(`  Download attempt ${attempt}/${attempts} failed: ${(lastErr.message || '').split('\n')[0]}`);
    if (attempt < attempts) {
      // Wipe the cache so the next attempt re-downloads instead of reusing a
      // partially-extracted bundle the library would treat as cached.
      try { fs.rmSync(cachePath, { recursive: true, force: true }); } catch {}
      console.log('  Cleared VSCode cache; retrying...');
    }
  }
  throw lastErr;
}

function getVSCodeVersionInfo(cliPath) {
  try {
    const out = execSync(`"${cliPath}" --version`, { encoding: 'utf-8', timeout: 15000 });
    const lines = out.trim().split(/\r?\n/).map(s => s.trim()).filter(Boolean);
    return {
      version: lines[0] || 'unknown',
      commit: lines[1] || 'unknown',
      arch: lines[2] || 'unknown',
    };
  } catch (err) {
    console.log(`  Failed to probe VSCode version: ${(err.message || '').split('\n')[0]}`);
    return { version: 'unknown', commit: 'unknown', arch: 'unknown' };
  }
}

// --- Desktop setup: green wallpaper (+ compositor on Linux) ---

/**
 * Encode a small solid-color PNG (RGB, no interlace) for use as a wallpaper.
 */
function solidPng(r, g, b, size = 64) {
  const zlib = require('zlib');
  const chunk = (type, data) => {
    const typeBuf = Buffer.from(type, 'ascii');
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(zlib.crc32(Buffer.concat([typeBuf, data])) >>> 0);
    return Buffer.concat([len, typeBuf, data, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;  // bit depth
  ihdr[9] = 2;  // color type: RGB
  const row = Buffer.concat([Buffer.from([0]), Buffer.alloc(size * 3).fill(Buffer.from([r, g, b]))]);
  const raw = Buffer.concat(Array(size).fill(row));
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const SET_WALLPAPER_PS = (imagePath) => [
  `Add-Type @"`,
  `using System.Runtime.InteropServices;`,
  `public class WallpaperSetter {`,
  `    [DllImport("user32.dll", SetLastError = true)]`,
  `    public static extern int SystemParametersInfo(int uAction, int uParam, string lpvParam, int fuWinIni);`,
  `}`,
  `"@`,
  // 20 = SPI_SETDESKWALLPAPER, 3 = SPIF_UPDATEINIFILE | SPIF_SENDCHANGE
  `$r = [WallpaperSetter]::SystemParametersInfo(20, 0, '${imagePath.replace(/'/g, "''")}', 3)`,
  `if ($r -eq 0) { throw "SystemParametersInfo failed" }`,
].join('\r\n');

/**
 * Make the desktop behind the VSCode window solid green so transparency is
 * measurable, and (on Linux) start a window manager + compositor — X11 shows
 * nothing through a transparent window without a compositing manager, and
 * window.newWindowDimensions=maximized needs a WM to honor it.
 *
 * Returns a cleanup function that restores the previous wallpaper (macOS,
 * Windows) and stops the spawned processes (Linux).
 */
function setupDesktop() {
  const cleanup = [];

  if (process.platform === 'linux') {
    for (const [cmd, args] of [['openbox', []], ['picom', ['--backend', 'xrender']]]) {
      try {
        const proc = spawn(cmd, args, { stdio: 'ignore' });
        proc.on('error', (err) => console.log(`  ${cmd} failed to start: ${err.message}`));
        cleanup.push(() => { try { proc.kill('SIGTERM'); } catch {} });
        console.log(`  Started ${cmd} (pid ${proc.pid})`);
      } catch (err) {
        console.log(`  ${cmd} unavailable: ${err.message}`);
      }
    }
    // hsetroot sets the root pixmap atoms compositors read for the wallpaper;
    // xsetroot only recolors the root window (fine without a compositor).
    try {
      execSync('hsetroot -solid "#00FF00"', { timeout: 10000 });
      console.log('  Wallpaper set via hsetroot');
    } catch {
      try {
        execSync('xsetroot -solid "#00FF00"', { timeout: 10000 });
        console.log('  Wallpaper set via xsetroot (hsetroot unavailable)');
      } catch (err) {
        console.log(`  Failed to set root color: ${err.message.split('\n')[0]}`);
      }
    }
    // Give openbox/picom a moment to map before anything is captured.
    try { execSync('sleep 2'); } catch {}
  } else if (process.platform === 'darwin') {
    const pngPath = path.join(os.tmpdir(), 'vibrancy-e2e-green.png');
    fs.writeFileSync(pngPath, solidPng(0, 255, 0));
    let previous = null;
    try {
      previous = execSync(
        `osascript -e 'tell application "System Events" to get picture of first desktop'`,
        { encoding: 'utf-8', timeout: 15000 }
      ).trim();
    } catch {}
    try {
      execSync(
        `osascript -e 'tell application "System Events" to set picture of every desktop to "${pngPath}"'`,
        { timeout: 15000 }
      );
      console.log(`  Wallpaper set to ${pngPath}`);
      if (previous) {
        cleanup.push(() => {
          try {
            execSync(
              `osascript -e 'tell application "System Events" to set picture of every desktop to "${previous.replace(/"/g, '\\"')}"'`,
              { timeout: 15000 }
            );
          } catch {}
        });
      }
    } catch (err) {
      console.log(`  Failed to set wallpaper: ${err.message.split('\n')[0]}`);
    }
    cleanup.push(() => { try { fs.unlinkSync(pngPath); } catch {} });
  } else if (process.platform === 'win32') {
    const bmpPath = path.join(os.tmpdir(), 'vibrancy-e2e-green.bmp');
    let previous = null;
    try {
      previous = runPsScript(`(Get-ItemProperty 'HKCU:\\Control Panel\\Desktop').WallPaper`).trim();
    } catch {}
    try {
      // Write a screen-sized 24bpp BMP rather than a small 32bpp one: some
      // Windows builds refuse a 32bpp wallpaper outright, and a tiny image is
      // subject to the user's tile/center/fill style (an arm64 runner kept its
      // default wallpaper this way). Setting the style explicitly and matching
      // the screen size removes both variables.
      runPsScript([
        `Add-Type -AssemblyName System.Drawing`,
        `Add-Type -AssemblyName System.Windows.Forms`,
        `$b = [System.Windows.Forms.SystemInformation]::VirtualScreen`,
        `$w = [Math]::Max($b.Width, 640); $h = [Math]::Max($b.Height, 480)`,
        `$bmp = New-Object System.Drawing.Bitmap($w, $h, [System.Drawing.Imaging.PixelFormat]::Format24bppRgb)`,
        `$gfx = [System.Drawing.Graphics]::FromImage($bmp)`,
        `$gfx.Clear([System.Drawing.Color]::FromArgb(0, 255, 0))`,
        `$bmp.Save('${bmpPath.replace(/'/g, "''")}', [System.Drawing.Imaging.ImageFormat]::Bmp)`,
        `$gfx.Dispose(); $bmp.Dispose()`,
        `Set-ItemProperty 'HKCU:\\Control Panel\\Desktop' -Name WallpaperStyle -Value '10'`,
        `Set-ItemProperty 'HKCU:\\Control Panel\\Desktop' -Name TileWallpaper -Value '0'`,
        `Write-Host "Wallpaper bitmap: ${'$'}w x ${'$'}h"`,
      ].join('\r\n'));
      runPsScript(SET_WALLPAPER_PS(bmpPath));
      console.log(`  Wallpaper set to ${bmpPath}`);
      if (previous) {
        cleanup.push(() => { try { runPsScript(SET_WALLPAPER_PS(previous)); } catch {} });
      }
    } catch (err) {
      console.log(`  Failed to set wallpaper: ${err.message.split('\n')[0]}`);
    }
    cleanup.push(() => { try { fs.unlinkSync(bmpPath); } catch {} });
  }

  return () => { for (const fn of cleanup.reverse()) fn(); };
}

/**
 * Windows only: minimize every visible top-level window that doesn't belong to
 * VSCode, then raise VSCode.
 *
 * Without this the check measures the wrong thing entirely. A transparent
 * window shows whatever is *behind* it, and on hosted runners that is not the
 * desktop: the x64 runner keeps the Actions agent console maximized behind
 * VSCode (so the "see-through" pixels were black console text, reading as 0%
 * green even though transparency worked perfectly), and the arm64 runner puts
 * the Windows OOBE privacy wizard on top of everything.
 *
 * Shell windows (Progman/WorkerW/Shell_TrayWnd) are skipped — Progman *is* the
 * desktop, and minimizing the taskbar isn't useful. VSCode is matched by PID so
 * its dialogs and secondary windows are left alone too.
 */
function minimizeOtherWindows() {
  if (process.platform !== 'win32') return;
  try {
    const out = runPsScript([
      `Add-Type @"`,
      `using System;`,
      `using System.Text;`,
      `using System.Runtime.InteropServices;`,
      `public class WinMgr {`,
      `    public delegate bool EnumProc(IntPtr hWnd, IntPtr lParam);`,
      `    [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc cb, IntPtr lParam);`,
      `    [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hWnd);`,
      `    [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);`,
      `    [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);`,
      `    [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetClassName(IntPtr hWnd, StringBuilder s, int max);`,
      `    [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);`,
      `    public static string ClassOf(IntPtr h) { var sb = new StringBuilder(256); GetClassName(h, sb, 256); return sb.ToString(); }`,
      `}`,
      `"@`,
      // Only the shell itself is exempt. UWP window classes are deliberately
      // NOT skipped — the arm64 runner's OOBE privacy wizard is one.
      `$skipClasses = @('Progman', 'WorkerW', 'Shell_TrayWnd')`,
      `$codeProcs = @(Get-Process -ErrorAction SilentlyContinue | Where-Object { $_.ProcessName -match '^Code( - Insiders)?$' })`,
      `$codePids = @($codeProcs | ForEach-Object { $_.Id })`,
      `$targets = New-Object System.Collections.ArrayList`,
      `$cb = [WinMgr+EnumProc]{ param($h, $l)`,
      `  if ([WinMgr]::IsWindowVisible($h)) {`,
      `    $cls = [WinMgr]::ClassOf($h)`,
      `    if ($skipClasses -notcontains $cls) {`,
      `      $owner = 0`,
      `      [WinMgr]::GetWindowThreadProcessId($h, [ref]$owner) | Out-Null`,
      `      if ($codePids -notcontains [int]$owner) { [void]$targets.Add($h) }`,
      `    }`,
      `  }`,
      `  return $true`,
      `}`,
      `[WinMgr]::EnumWindows($cb, [IntPtr]::Zero) | Out-Null`,
      // 6 = SW_MINIMIZE
      `foreach ($t in $targets) { [WinMgr]::ShowWindow($t, 6) | Out-Null }`,
      `Write-Host "Minimized $($targets.Count) non-VSCode window(s)"`,
      `$main = $codeProcs | Where-Object { $_.MainWindowHandle -ne [IntPtr]::Zero } | Select-Object -First 1`,
      `if ($main) { [WinMgr]::SetForegroundWindow($main.MainWindowHandle) | Out-Null }`,
      `Start-Sleep -Milliseconds 600`,
    ].join('\r\n'));
    if (out && out.trim()) console.log(`  ${out.trim()}`);
  } catch (err) {
    console.log(`  Could not minimize other windows: ${(err.message || '').split('\n')[0]}`);
  }
}

/**
 * Confirm the desktop really is green before the transparency checks depend on
 * it. Runs with no VSCode open, so the capture should be almost entirely
 * wallpaper.
 *
 * This is a check in its own right, and a failing one fails the run. If a
 * runner can't give us a green desktop (wallpaper API refused, an OOBE wizard
 * covering the screen), the transparency checks downstream are measuring the
 * environment rather than the product — but silently skipping them would
 * quietly delete the coverage that catches regressions like #269, and a green
 * CI run is exactly when nobody looks. Failing loudly means a runner-image
 * change surfaces immediately; this message is here to make clear that the fix
 * belongs in the harness, not in the extension.
 *
 * @returns {{ supported: boolean, pct: number|null }}
 */
function verifyDesktopBaseline(screenshotDir) {
  minimizeOtherWindows();
  const baselinePath = path.join(screenshotDir, `vibrancy-e2e-${process.platform}-0-desktop.png`);
  captureScreenshot(baselinePath, { fullScreen: true });
  const pct = checkPixels(baselinePath, '10', 'green');
  const supported = pct !== null && pct >= 90.0;
  console.log(`  Desktop baseline green: ${fmtPct(pct)} (${supported ? 'PASS' : 'FAIL'})`);
  if (!supported) {
    console.log('  !! The desktop behind VSCode is not green, so nothing downstream can');
    console.log('  !! attribute see-through pixels to vibrancy. This is an ENVIRONMENT');
    console.log('  !! failure, not a vibrancy regression — the runner could not provide');
    console.log('  !! a clean green desktop. Check the *-0-desktop.png artifact: expect a');
    console.log('  !! new wallpaper API restriction, or a window this harness failed to');
    console.log('  !! minimize (a setup wizard, an installer, an agent console).');
  }
  return { supported, pct };
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

function captureScreenshot(outputPath, opts = {}) {
  const { fullScreen = false } = opts;
  const methods = [];

  // On Windows, whatever sits behind the transparent window is what the green
  // check sees, so clear the screen of other windows first.
  if (process.platform === 'win32' && !fullScreen) minimizeOtherWindows();

  if (process.platform === 'darwin') {
    methods.push(() => execSync(`screencapture -x "${outputPath}"`, { timeout: 10000 }));
  } else if (process.platform === 'linux') {
    methods.push(() => execSync(`import -window root "${outputPath}"`, { timeout: 10000 }));
    methods.push(() => execSync(`xwd -root -silent | convert xwd:- png:"${outputPath}"`, { timeout: 10000 }));
    methods.push(() => execSync(`scrot "${outputPath}"`, { timeout: 10000 }));
  } else if (process.platform === 'win32') {
    const psPath = outputPath.replace(/'/g, "''");

    // Method 1: Bring the VSCode window to the foreground and capture its
    // screen rect via CopyFromScreen. This MUST be a screen capture, not
    // PrintWindow: PrintWindow renders only the window's own content, so a
    // transparent window comes out black and the see-through wallpaper check
    // can never pass. Capturing the window rect (rather than the full screen)
    // still excludes the taskbar and anything outside the window.
    // Skipped for the baseline capture, where no VSCode window exists yet.
    if (!fullScreen) methods.push(() => runPsScript([
      `Add-Type -AssemblyName System.Drawing`,
      `Add-Type @"`,
      `using System;`,
      `using System.Runtime.InteropServices;`,
      `public class WindowLocator {`,
      `    [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);`,
      `    [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT r);`,
      `    [StructLayout(LayoutKind.Sequential)] public struct RECT { public int L,T,R,B; }`,
      `}`,
      `"@`,
      `$p = Get-Process -ErrorAction SilentlyContinue | Where-Object { $_.ProcessName -match '^Code( - Insiders)?$' -and $_.MainWindowHandle -ne [IntPtr]::Zero } | Select-Object -First 1`,
      `if (-not $p) { throw "No Code process with a visible window" }`,
      `Write-Host "Capturing Code window rect (PID $($p.Id), handle $($p.MainWindowHandle))"`,
      `[WindowLocator]::SetForegroundWindow($p.MainWindowHandle) | Out-Null`,
      `Start-Sleep -Milliseconds 800`,
      `$r = New-Object 'WindowLocator+RECT'`,
      `[WindowLocator]::GetWindowRect($p.MainWindowHandle, [ref]$r) | Out-Null`,
      `$w = $r.R - $r.L; $h = $r.B - $r.T`,
      `if ($w -le 0 -or $h -le 0) { throw "Window $w x $h" }`,
      `$bmp = New-Object System.Drawing.Bitmap($w, $h)`,
      `$gfx = [System.Drawing.Graphics]::FromImage($bmp)`,
      `$gfx.CopyFromScreen($r.L, $r.T, 0, 0, $bmp.Size)`,
      `$bmp.Save('${psPath}', [System.Drawing.Imaging.ImageFormat]::Png)`,
      `$gfx.Dispose(); $bmp.Dispose()`,
    ].join('\r\n')));

    // Method 2: Full screen capture as fallback
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

// --- Pixel color checks ---

/**
 * Measure what percentage of a screenshot region matches a target color.
 * Uses a Python script for cross-platform PNG decoding without native deps.
 *
 * @param {string} screenshotPath
 * @param {string} spec - Crop percentage ('10') or region fractions ('x0,y0,x1,y1')
 * @param {string} color - 'green' or 'magenta'
 * @returns {number|null} percentage (0-100), or null if the check failed
 */
function checkPixels(screenshotPath, spec, color) {
  if (!screenshotPath || !fs.existsSync(screenshotPath)) return null;
  const checkScript = path.join(__dirname, 'check-green.py');
  try {
    const result = execSync(
      `python3 "${checkScript}" "${screenshotPath}" "${spec}" ${color}`,
      { timeout: 30000, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }
    );
    return parseFloat(result.trim());
  } catch (err) {
    console.log(`  Pixel check error (${color} ${spec}): ${(err.stderr || err.message || '').slice(0, 200)}`);
    return null;
  }
}

function fmtPct(pct) {
  return pct !== null ? pct.toFixed(1) + '%' : 'check failed';
}

// --- Settings verification ---

/**
 * Read and parse the VSCode settings.json from the user-data-dir.
 * Returns the parsed object, or null if the file doesn't exist or is invalid.
 */
function readSettings(settingsPath) {
  try {
    return JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));
  } catch {
    return null;
  }
}

/**
 * Verify that vibrancy color customizations were applied to settings.json.
 * Checks that workbench.colorCustomizations contains the expected vibrancy keys
 * and that terminal.background is set to transparent.
 *
 * @param {string} settingsPath - Path to settings.json
 * @returns {{ ok: boolean, errors: string[] }}
 */
function verifySettingsAfterInstall(settingsPath) {
  const errors = [];
  const settings = readSettings(settingsPath);
  if (!settings) {
    return { ok: false, errors: ['settings.json not found or unparseable'] };
  }

  const colors = settings['workbench.colorCustomizations'];
  if (!colors || typeof colors !== 'object') {
    errors.push('workbench.colorCustomizations missing or not an object');
    return { ok: false, errors };
  }

  if (colors['terminal.background'] !== '#00000000') {
    errors.push(`terminal.background: expected "#00000000", got "${colors['terminal.background']}"`);
  }

  // Check that vibrancy bg keys are present (they should all be set to hex+alpha values)
  const missingKeys = ALL_VIBRANCY_BG_KEYS.filter(key => !colors[key]);
  if (missingKeys.length > 0) {
    errors.push(`missing ${missingKeys.length}/${ALL_VIBRANCY_BG_KEYS.length} vibrancy bg keys: ${missingKeys.slice(0, 5).join(', ')}${missingKeys.length > 5 ? '...' : ''}`);
  }

  if (settings['terminal.integrated.gpuAcceleration'] !== 'off') {
    errors.push(`gpuAcceleration: expected "off", got "${settings['terminal.integrated.gpuAcceleration']}"`);
  }

  return { ok: errors.length === 0, errors };
}

/**
 * Verify that vibrancy color customizations were removed from settings.json after uninstall,
 * and that pre-install values were restored.
 *
 * @param {string} settingsPath - Path to settings.json
 * @param {Object} originalSettings - The settings.json content before any vibrancy changes
 * @returns {{ ok: boolean, errors: string[] }}
 */
function verifySettingsAfterUninstall(settingsPath, originalSettings) {
  const errors = [];
  const settings = readSettings(settingsPath);
  if (!settings) {
    return { ok: false, errors: ['settings.json not found or unparseable'] };
  }

  const colors = settings['workbench.colorCustomizations'] || {};

  // Vibrancy bg keys should all be gone
  const leftoverKeys = ALL_VIBRANCY_BG_KEYS.filter(key => colors[key] !== undefined);
  if (leftoverKeys.length > 0) {
    errors.push(`${leftoverKeys.length} vibrancy bg keys still present: ${leftoverKeys.slice(0, 5).join(', ')}${leftoverKeys.length > 5 ? '...' : ''}`);
  }

  // terminal.background should not be the vibrancy transparent value
  if (colors['terminal.background'] === '#00000000') {
    errors.push('terminal.background still "#00000000" after uninstall');
  }

  // Original settings should be restored
  const origGpu = originalSettings['terminal.integrated.gpuAcceleration'];
  const currentGpu = settings['terminal.integrated.gpuAcceleration'];
  if (origGpu !== undefined && currentGpu !== origGpu) {
    errors.push(`gpuAcceleration: expected "${origGpu}" (original), got "${currentGpu}"`);
  } else if (origGpu === undefined && currentGpu !== undefined) {
    errors.push(`gpuAcceleration: expected removed (was not set originally), got "${currentGpu}"`);
  }

  const origSystemTheme = originalSettings['window.systemColorTheme'];
  if (origSystemTheme !== undefined && settings['window.systemColorTheme'] !== origSystemTheme) {
    errors.push(`systemColorTheme: expected "${origSystemTheme}" (original), got "${settings['window.systemColorTheme']}"`);
  }

  const origAutoDetect = originalSettings['window.autoDetectColorScheme'];
  if (origAutoDetect !== undefined && settings['window.autoDetectColorScheme'] !== origAutoDetect) {
    errors.push(`autoDetectColorScheme: expected ${origAutoDetect} (original), got ${settings['window.autoDetectColorScheme']}`);
  }

  return { ok: errors.length === 0, errors };
}

// --- GitHub summary ---

function writeGitHubSummary(success, screenshotPath, checks, meta = {}) {
  const summaryFile = process.env.GITHUB_STEP_SUMMARY;
  if (!summaryFile) return;

  const platform = { darwin: 'macOS', linux: 'Linux', win32: 'Windows' }[process.platform] || process.platform;
  const chk = (v) => v ? '✅' : '❌';

  let md = `## E2E Test — ${platform}\n\n`;
  if (meta.versionInfo) {
    const channel = meta.vscodeVersion ? ` (\`${meta.vscodeVersion}\` channel)` : '';
    const shortCommit = (meta.versionInfo.commit || '').slice(0, 8) || 'unknown';
    md += `**Tested against VS Code ${meta.versionInfo.version || 'unknown'}** (commit \`${shortCommit}\`, ${meta.versionInfo.arch || 'unknown'})${channel}\n\n`;
  }
  md += `| Check | Status |\n`;
  md += `|-------|--------|\n`;
  md += `| Overall | ${chk(success)} ${success ? 'PASS' : 'FAIL'} |\n`;
  const pct = (v) => v !== null ? v.toFixed(1) + '%' : '?';
  md += `| Desktop baseline is green (${pct(checks.baselinePct)}) | ${chk(checks.baselineSupported)} |\n`;
  md += `| Install signal | ${chk(checks.installOk)} |\n`;
  md += `| Post-install crash | ${chk(checks.nocrash)} |\n`;
  md += `| Transparency: wallpaper through window (${pct(checks.greenPct)}) | ${chk(checks.greenOk)} |\n`;
  md += `| Transparency: wallpaper through sidebar (${pct(checks.sidebarPct)}) | ${chk(checks.sidebarOk)} |\n`;
  md += `| CSS import beacon (${pct(checks.beaconPct)}) | ${chk(checks.beaconOk)} |\n`;
  md += `| Settings after install | ${chk(checks.installSettingsOk)} |\n`;
  md += `| Uninstall signal | ${chk(checks.uninstallOk)} |\n`;
  md += `| Settings after uninstall | ${chk(checks.uninstallSettingsOk)} |\n`;
  md += `| Post-uninstall crash | ${chk(checks.postUninstallNocrash)} |\n`;
  md += `| Vibrancy removed (green ${pct(checks.postUninstallGreen)}, beacon ${pct(checks.postUninstallBeacon)}) | ${chk(checks.uninstallClean)} |\n`;
  md += `\n`;

  if (!checks.baselineSupported) {
    md += `> ⚠️ **This is an environment failure, not a vibrancy regression.** The\n`;
    md += `> desktop behind VSCode measured only ${pct(checks.baselinePct)} green, so the transparency\n`;
    md += `> checks could not measure anything — expect a new wallpaper API\n`;
    md += `> restriction, or a window the harness failed to minimize (setup wizard,\n`;
    md += `> installer, agent console). Check the \`*-0-desktop.png\` artifact; the fix\n`;
    md += `> belongs in \`test/e2e/run-e2e.js\`, not in the extension.\n\n`;
  }

  if (screenshotPath && fs.existsSync(screenshotPath)) {
    md += `📸 Screenshots captured — see **screenshots** artifact.\n`;
  } else {
    md += `_No screenshot captured._\n`;
  }

  fs.appendFileSync(summaryFile, md);
}

main().catch((err) => {
  console.error('E2E test failed:', err);
  process.exit(1);
});
