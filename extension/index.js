var vscode = require('vscode');
var fs = require('mz/fs');
var path = require('path');
var os = require('os');
var { spawn } = require('child_process');
var {
  generateNewJS: _generateNewJS,
  removeJSMarkers,
  injectElectronOptions,
  removeElectronOptions,
  patchCSP: _patchCSP,
  removeCSPPatch,
  deepEqual,
  checkRuntimeUpdate,
  getConfigDir,
} = require('./file-transforms');
const { applySettings, restoreSettings } = require('./vscode-settings');

/**
 * @type {(info: string) => string}
 */
const localize = require('./i18n');

/**
 * @type {'unknown' | 'win10' | 'macos'}
 */
const osType = require('./platform');

const { StagedFileWriter, checkNeedsElevation, hasNoNewPrivs } = require('./elevated-file-writer');

var themeStylePaths = {
  'Default Dark': '../themes/Default Dark.css',
  'Dark (Exclude Tab Line)': '../themes/Dark (Exclude Tab Line).css',
  'Dark (Only Subbar)': '../themes/Dark (Only Subbar).css',
  'Default Light': '../themes/Default Light.css',
  'Light (Only Subbar)': '../themes/Light (Only Subbar).css',
  'Tokyo Night Storm': '../themes/Tokyo Night Storm.css',
  'Tokyo Night Storm (Outer)': '../themes/Tokyo Night Storm (Outer).css',
  'Noir et blanc': '../themes/Noir et blanc.css',
  'Solarized Dark+': '../themes/Solarized Dark+.css',
  'Catppuccin Mocha': '../themes/Catppuccin Mocha.css',
  'GitHub Dark Default': '../themes/GitHub Dark Default.css',
  'Paradise Smoked Glass': '../themes/Paradise Smoked Glass.css',
  'Paradise Frosted Glass': '../themes/Paradise Frosted Glass.css',
  'Custom theme (use imports)': '../themes/Custom Theme.css',
}

const themeConfigPaths = {
  'Default Dark': '../themes/Default Dark.json',
  'Dark (Exclude Tab Line)': '../themes/Dark (Exclude Tab Line).json',
  'Dark (Only Subbar)': '../themes/Dark (Only Subbar).json',
  'Default Light': '../themes/Default Light.json',
  'Light (Only Subbar)': '../themes/Light (Only Subbar).json',
  'Tokyo Night Storm': '../themes/Tokyo Night Storm.json',
  'Tokyo Night Storm (Outer)': '../themes/Tokyo Night Storm (Outer).json',
  'Noir et blanc': '../themes/Noir et blanc.json',
  'Solarized Dark+': '../themes/Solarized Dark+.json',
  'Catppuccin Mocha': '../themes/Catppuccin Mocha.json',
  'GitHub Dark Default': '../themes/GitHub Dark Default.json',
  'Paradise Smoked Glass': '../themes/Paradise Smoked Glass.json',
  'Paradise Frosted Glass': '../themes/Paradise Frosted Glass.json',
  'Custom theme (use imports)': '../themes/Custom Theme.json',
}

const themeFixPaths = {
  'Cursor': {
    'Default Dark': '../themes/fixes/Cursor Dark.css',
    'Default Light': '../themes/fixes/Cursor Light.css',
    'Paradise Smoked Glass': '../themes/fixes/Paradise Cursor.css',
    'Paradise Frosted Glass': '../themes/fixes/Paradise Cursor.css',
  },
  'Antigravity': {
    'Default Dark': '../themes/fixes/Antigravity.css',
    'Default Light': '../themes/fixes/Antigravity.css',
  }
}

const knownEditors = [
  'Visual Studio Code',
  'Visual Studio Code - Insiders',
  'VSCodium',
  'Cursor',
  'Code - OSS',
  'Antigravity'
];

// Map editor app names to their CLI commands for relaunch
const editorCliCommands = {
  'Visual Studio Code': 'code',
  'Visual Studio Code - Insiders': 'code-insiders',
  'VSCodium': 'codium',
  'Cursor': 'cursor',
  'Code - OSS': 'code-oss',
  'Antigravity': 'antigravity',
};

// Map editor app names to their config directory names (for settings.json path)
const editorConfigDirNames = {
  'Visual Studio Code': 'Code',
  'Visual Studio Code - Insiders': 'Code - Insiders',
  'VSCodium': 'VSCodium',
  'Cursor': 'Cursor',
  'Code - OSS': 'Code - OSS',
  'Antigravity': 'Antigravity',
};

var defaultTheme = 'Default Dark';

// Compute the platform-specific settings.json path for a given editor
function getEditorSettingsPath(appName) {
  const dirName = editorConfigDirNames[appName] || 'Code';
  const home = os.homedir();
  if (process.platform === 'win32') {
    return path.join(process.env.APPDATA || path.join(home, 'AppData', 'Roaming'), dirName, 'User', 'settings.json');
  } else if (process.platform === 'darwin') {
    return path.join(home, 'Library', 'Application Support', dirName, 'User', 'settings.json');
  } else {
    return path.join(process.env.XDG_CONFIG_HOME || path.join(home, '.config'), dirName, 'User', 'settings.json');
  }
}

// Pending .node file copies deferred until after VSCode exits (Windows only).
// Windows hard-locks loaded .node modules, so the restart script copies them
// in the gap between exit and relaunch.
var pendingNodeCopies = [];

function getCurrentTheme(config) {
  return config.theme in themeStylePaths ? config.theme : defaultTheme;
}

function checkDarkLightMode(theme) {
  const currentTheme = theme.kind;

  // Sync Vibrancy theme with VSCode color theme
  const currentColorTheme = vscode.workspace.getConfiguration().get("vscode_vibrancy.theme");
  const enableAutoTheme = vscode.workspace.getConfiguration().get("vscode_vibrancy.enableAutoTheme");
  const preferredDarkColorTheme = vscode.workspace.getConfiguration().get("vscode_vibrancy.preferedDarkTheme");
  const preferredLightColorTheme = vscode.workspace.getConfiguration().get("vscode_vibrancy.preferedLightTheme");

  let targetVibrancyTheme;
  if (currentTheme === vscode.ColorThemeKind.Dark) {
    targetVibrancyTheme = preferredDarkColorTheme;
  } else if (currentTheme === vscode.ColorThemeKind.Light) {
    targetVibrancyTheme = preferredLightColorTheme;}
  else {
    return;
  }

  if (enableAutoTheme && currentColorTheme !== targetVibrancyTheme) {
      vscode.workspace.getConfiguration("vscode_vibrancy").update("theme", targetVibrancyTheme, vscode.ConfigurationTarget.Global);
  }
}

async function promptRestart(setControlsStyle) {
  // Set/remove window.controlsStyle right before quit — deferred to here so it
  // doesn't trigger VSCode's built-in restart prompt during install/uninstall,
  // which would cause an in-process reload and break polkit elevation.
  if (osType === 'win10' || process.platform === 'linux') {
    try {
      const value = setControlsStyle ? "custom" : undefined;
      await vscode.workspace.getConfiguration().update("window.controlsStyle", value, vscode.ConfigurationTarget.Global);
    } catch (error) {
      console.warn("window.controlsStyle is not supported in this version of VSCode.");
    }
  }

  // Perform a full quit + relaunch to avoid the no_new_privs issue that
  // occurs with in-process reloads (which prevents sudo/pkexec from working
  // on subsequent elevation attempts).
  //
  // We write a self-contained script to /tmp and use nohup + setsid to fully
  // detach it from VSCode's process tree, so it survives the parent exiting.
  // Use the CLI command (e.g. 'code') instead of the raw Electron binary,
  // since the CLI wrapper sets up the required environment.
  const cliName = editorCliCommands[vscode.env.appName] || 'code';
  const pid = process.pid;

  if (process.platform === 'win32') {
    // Resolve the full path to the CLI .cmd wrapper next to the install dir
    // e.g. C:\Users\X\AppData\Local\Programs\Microsoft VS Code\bin\code.cmd
    const cliFullPath = path.join(path.dirname(process.execPath), 'bin', `${cliName}.cmd`);
    const cliCommand = require('fs').existsSync(cliFullPath) ? cliFullPath : cliName;

    // Build .node copy commands for the restart script.
    // .node files are locked while VSCode runs, so we copy them after exit.
    const nodeCopyLines = [];
    if (pendingNodeCopies.length > 0) {
      const needsElevation = checkNeedsElevation(path.dirname(pendingNodeCopies[0].dest));
      if (needsElevation) {
        // Write a PowerShell script to copy the .node files, run it elevated.
        // VSCode is relaunched AFTER this completes, as a normal (non-admin) process.
        const psCommands = pendingNodeCopies.map(({ src, dest }) =>
          `Copy-Item -Path '${src.replace(/'/g, "''")}' -Destination '${dest.replace(/'/g, "''")}' -Force`
        );
        psCommands.push(`Remove-Item -Path '${os.tmpdir().replace(/'/g, "''")}\\vibrancy-node-copy.ps1' -Force -ErrorAction SilentlyContinue`);
        const psScript = psCommands.join('\n');
        const psPath = path.join(os.tmpdir(), 'vibrancy-node-copy.ps1');
        require('fs').writeFileSync(psPath, psScript, 'utf-8');
        nodeCopyLines.push(
          `WshShell.Run "powershell.exe -NoProfile -ExecutionPolicy Bypass -Command ""Start-Process powershell.exe -ArgumentList '-NoProfile -ExecutionPolicy Bypass -File """"${psPath.replace(/"/g, '""')}""""' -Verb RunAs -WindowStyle Hidden -Wait""", 0, True`,
        );
      } else {
        // No elevation needed — copy via PowerShell (handles Unicode paths
        // correctly, unlike VBScript's FileSystemObject which is ANSI-only).
        const psCommands = pendingNodeCopies.map(({ src, dest }) =>
          `Copy-Item -Path '${src.replace(/'/g, "''")}' -Destination '${dest.replace(/'/g, "''")}' -Force`
        );
        const psInline = psCommands.join('; ');
        nodeCopyLines.push(
          `WshShell.Run "powershell.exe -NoProfile -ExecutionPolicy Bypass -Command ""${psInline.replace(/"/g, '""')}""", 0, True`,
        );
      }
    }

    // Pure VBScript: poll for process exit via WMI, copy .node files,
    // relaunch hidden, self-delete.
    const vbsScript = [
      `Set WshShell = CreateObject("WScript.Shell")`,
      `Set WMI = GetObject("winmgmts:\\\\.\\root\\cimv2")`,
      `Do`,
      `  WScript.Sleep 1000`,
      `  Set procs = WMI.ExecQuery("SELECT ProcessId FROM Win32_Process WHERE ProcessId = ${pid}")`,
      `  If procs.Count = 0 Then Exit Do`,
      `Loop`,
      `WScript.Sleep 1000`,
      ...nodeCopyLines,
      `WshShell.Run """${cliCommand}""", 0, False`,
      `CreateObject("Scripting.FileSystemObject").DeleteFile WScript.ScriptFullName`,
    ].join('\r\n');
    const vbsPath = path.join(os.tmpdir(), 'vibrancy-restart.vbs');
    // Write as UTF-16LE with BOM so wscript.exe correctly handles Unicode
    // paths (e.g. non-ASCII usernames) instead of misinterpreting UTF-8.
    const vbsBom = Buffer.from([0xFF, 0xFE]);
    const vbsContent = Buffer.from(vbsScript, 'utf16le');
    require('fs').writeFileSync(vbsPath, Buffer.concat([vbsBom, vbsContent]));
    spawn('wscript', [vbsPath], {
      detached: true,
      stdio: 'ignore',
    }).unref();
  } else if (process.platform === 'darwin') {
    // macOS: use VSCode's built-in restart prompt by toggling titleBarStyle
    const titleBarStyle = vscode.workspace.getConfiguration().get("window.titleBarStyle");
    await vscode.workspace.getConfiguration().update(
      "window.titleBarStyle",
      titleBarStyle === "native" ? "custom" : "native",
      vscode.ConfigurationTarget.Global
    );
    await vscode.workspace.getConfiguration().update(
      "window.titleBarStyle",
      titleBarStyle,
      vscode.ConfigurationTarget.Global
    );
    return;
  } else {
    // Linux: use setsid + nohup to fully detach from VSCode's process tree
    const binName = path.basename(process.execPath);
    const script = `#!/bin/sh\nwhile pgrep -x '${binName.replace(/'/g, "'\\''")}' >/dev/null 2>&1; do sleep 1; done\nsleep 1\n${cliName} &\nrm -f "$0"\n`;
    const scriptPath = path.join(os.tmpdir(), `vibrancy-restart-${pid}.sh`);
    require('fs').writeFileSync(scriptPath, script, { mode: 0o755 });
    spawn('setsid', ['nohup', scriptPath], {
      detached: true,
      stdio: ['ignore', 'ignore', 'ignore'],
      env: { ...process.env, HOME: process.env.HOME },
    }).unref();
  }

  // Quit VSCode — the detached script will relaunch after exit completes
  vscode.commands.executeCommand('workbench.action.quit');
}

async function checkColorTheme(testMode) {
  // Get the current color theme and target theme from configuration files
  const currentTheme = getCurrentTheme(vscode.workspace.getConfiguration("vscode_vibrancy"));

  // if theme is "Custom theme (use imports)", skip the check
  if (currentTheme === 'Custom theme (use imports)') {
    return;
  }

  const themeConfig = require(path.join(__dirname, themeConfigPaths[currentTheme]));
  const targetTheme = themeConfig.colorTheme;
  const currentColorTheme = vscode.workspace.getConfiguration().get("workbench.colorTheme");

  // VSCode 1.113 has renamed some built-in themes (e.g. "Default Dark+" -> "Dark+").
  // Normalize both sides so renamed themes don't trigger a false mismatch.
  const themeAliases = {
    'Default Dark+': 'Dark+',
    'Default Light+': 'Light+',
  };
  const normalizeThemeName = (name) => themeAliases[name] || name;
  const themesMatch = normalizeThemeName(targetTheme) === normalizeThemeName(currentColorTheme);

  // Show a message to the user if the current color theme doesn't match the target theme
  if (!themesMatch) {
    if (testMode) {
      // In test mode, force-set the color theme without prompting
      await vscode.workspace.getConfiguration().update("workbench.colorTheme", targetTheme, vscode.ConfigurationTarget.Global);
      return;
    }

    const message = localize('messages.recommendedColorTheme')
      .replace('%1', currentColorTheme)
      .replace('%2', targetTheme);

    const result = await vscode.window.showInformationMessage(message, localize('messages.changeColorThemeIde'), localize('messages.noIde'));

    // If the user chooses to change the color theme, update the configuration
    if (result === localize('messages.changeColorThemeIde')) {
      await vscode.workspace.getConfiguration().update("workbench.colorTheme", targetTheme, vscode.ConfigurationTarget.Global);
    }
  }
}

// Electron 26 changed the available vibrancy types, this ensures that upgrading users switch
async function checkElectronDeprecatedType() {
  let electronVersion = process.versions.electron;
  let majorVersion = parseInt(electronVersion.split('.')[0]);

  if (majorVersion > 25) {
    const currentType = vscode.workspace.getConfiguration("vscode_vibrancy").type;
    const deprecatedTypes = [
      "appearance-based",
      "dark",
      "ultra-dark",
      "light",
      "medium-light"
    ];

    if (deprecatedTypes.includes(currentType)) {
      vscode.window.showWarningMessage(
        localize('messages.electronDeprecatedType').replace('%1', currentType),
        { title: "Default" },
        { title: "Transparent" }
      ).then(async (msg) => {
        if (msg) {
          const newType = msg.title === "Default" ? "under-window" : "fullscreen-ui";
          await vscode.workspace
            .getConfiguration("vscode_vibrancy")
            .update("type", newType, vscode.ConfigurationTarget.Global);
        }
      });
    }
  }
}

function activate(context) {
  const testModeFile = path.join(getConfigDir('vscode-vibrancy-continued'), 'test-mode');
  const testMode = require('fs').existsSync(testModeFile);
  console.log('vscode-vibrancy is active!' + (testMode ? ' (test mode)' : ''));

  if (testMode) {
    vscode.window.showInformationMessage('Vibrancy Continued: Test mode active');
  }

  const testSignalPath = testMode ? path.join(path.dirname(testModeFile), 'test-result') : null;

  function writeTestSignal(status, message) {
    if (!testMode) return;
    try {
      require('fs').writeFileSync(testSignalPath, JSON.stringify({ status, message, ts: Date.now() }));
      console.log(`Vibrancy test signal: ${status} — ${message}`);
    } catch (err) {
      console.error('Failed to write test signal:', err);
    }
  }

  // Check if the harness is requesting an uninstall
  const testUninstallFile = testMode ? path.join(path.dirname(testModeFile), 'test-uninstall') : null;
  const testUninstallRequested = testMode && require('fs').existsSync(testUninstallFile);

  var appDir;
  try {
    appDir = path.dirname(require.main.filename);
  } catch {
    appDir = _VSCODE_FILE_ROOT;
  }
  let useEsmRuntime = false;
  var JSFile = path.join(appDir, '/main.js');
  var ElectronJSFile = path.join(appDir, '/vs/code/electron-main/main.js');

  // VSC 1.95 merges these main.js files
  if (!fs.existsSync(ElectronJSFile)) {
    ElectronJSFile = JSFile;
  }

  var runtimeVersion = 'v6';
  var runtimeDir = path.join(appDir, '/vscode-vibrancy-runtime-' + runtimeVersion);
  var runtimeSrcDir = "../runtime-pre-esm"

  // VSC 1.94 used ESM, 1.95 dropped it
  const workbenchHtmlPath = path.join(appDir, 'vs/code/electron-sandbox/workbench/workbench.html');
  const workbenchEsmHtmlPath = path.join(appDir, 'vs/code/electron-sandbox/workbench/workbench.esm.html');
  // VSC 1.102.0 and later renamed electron-sandbox to electron-browser
  const workbenchHtmlPath102 = path.join(appDir, 'vs/code/electron-browser/workbench/workbench.html');
  var HTMLFile;
  if (fs.existsSync(workbenchHtmlPath)) {
    HTMLFile = workbenchHtmlPath;
  } else if (fs.existsSync(workbenchHtmlPath102)) {
    HTMLFile = workbenchHtmlPath102;
  } else {
    HTMLFile = workbenchEsmHtmlPath;
    useEsmRuntime = true;
    runtimeSrcDir = "../runtime"
  }

  async function installRuntime(writer) {
    // if runtimeDir exists, recurse through it and delete all files
    if (fs.existsSync(runtimeDir)) {
      await writer.rmdir(runtimeDir);
    }

    await writer.mkdir(runtimeDir);
    await writer.copyDir(path.resolve(__dirname, runtimeSrcDir), path.resolve(runtimeDir));
  }

  async function installRuntimeWin(writer) {
    if (fs.existsSync(runtimeDir)) {
      try {
        await writer.rmdir(runtimeDir);
      } catch (err) {
        // On Windows, locked .node files may prevent full deletion.
        // Continue — copyDir will overwrite unlocked files, and locked
        // .node files will be handled by the deferred copy below.
        if (err.code !== 'EBUSY' && err.code !== 'EPERM') {
          throw err;
        }
      }
    }
    await writer.mkdir(runtimeDir);
    await writer.copyDir(path.resolve(__dirname, runtimeSrcDir), path.resolve(runtimeDir));

    // .node files may be locked by the running VSCode process on Windows.
    // Try to copy them directly first; if locked (EBUSY/EPERM), defer to
    // the restart script which copies them after VSCode exits.
    // When elevation is required, the staged flush() also runs while VSCode
    // is active, so .node files must always be deferred in that case.
    pendingNodeCopies = [];
    const nativePrebuiltDir = path.resolve(__dirname, '../native/prebuilt');
    if (fs.existsSync(nativePrebuiltDir)) {
      const files = fs.readdirSync(nativePrebuiltDir);
      for (const file of files) {
        if (file.endsWith('.node')) {
          if (writer.requiresElevation) {
            pendingNodeCopies.push({
              src: path.join(nativePrebuiltDir, file),
              dest: path.join(runtimeDir, file),
            });
          } else {
            try {
              await writer.copyFile(
                path.join(nativePrebuiltDir, file),
                path.join(runtimeDir, file)
              );
            } catch (err) {
              if (err.code === 'EBUSY' || err.code === 'EPERM') {
                pendingNodeCopies.push({
                  src: path.join(nativePrebuiltDir, file),
                  dest: path.join(runtimeDir, file),
                });
              } else {
                throw err;
              }
            }
          }
        } else {
          await writer.copyFile(
            path.join(nativePrebuiltDir, file),
            path.join(runtimeDir, file)
          );
        }
      }
    }
  }

  async function installJS(writer) {
    const config = vscode.workspace.getConfiguration("vscode_vibrancy");
    const currentTheme = getCurrentTheme(config);
    const themeConfigPath = path.resolve(__dirname, themeConfigPaths[currentTheme]);
    const themeConfig = require(themeConfigPath);
    const themeStylePath = path.join(__dirname, themeStylePaths[currentTheme]);
    const themeCSS = await fs.readFile(themeStylePath, 'utf-8');
    const JS = await fs.readFile(JSFile, 'utf-8');

    const imports = await generateImports(config);

    const injectData = {
      os: osType,
      config: config,
      theme: themeConfig,
      themeCSS: themeCSS,
      imports: imports,
    };

    const base = __filename;
    const newJS = generateNewJS(JS, base, injectData);

    await writer.writeFile(JSFile, newJS, 'utf-8');
  }

  async function generateImports(config) {
    const imports = {
      css: "",
      js: "",
    };

    // Add theme fixes for non-VSCode editors
    const disableThemeFixes = vscode.workspace.getConfiguration().get("vscode_vibrancy.disableThemeFixes");
    const currentColorTheme = vscode.workspace.getConfiguration().get("vscode_vibrancy.theme");
    if (
      !disableThemeFixes &&
      vscode.env.appName in themeFixPaths &&
      themeFixPaths[vscode.env.appName][currentColorTheme]
    ) {
      let targetPatchTheme = themeFixPaths[vscode.env.appName][currentColorTheme];
      const themePatchPath = path.join(__dirname, targetPatchTheme);

      try {
        const themePatchContent = await fs.readFile(themePatchPath, 'utf-8');
        imports.css += `<style>${themePatchContent.replace(/<\/style/gi, '<\\/style')}</style>`;
      } catch (err) {
        vscode.window.showWarningMessage(localize('messages.importError').replace('%1', targetPatchTheme));
      }
    }

    for (let i = 0; i < config.imports.length; i++) {
      if (config.imports[i] === "/path/to/file") continue;

      try {
        const importContent = await fs.readFile(config.imports[i], 'utf-8');

        if (config.imports[i].endsWith('.css')) {
          imports.css += `<style>${importContent.replace(/<\/style/gi, '<\\/style')}</style>`;
        } else {
          imports.js += `<script>${importContent.replace(/<\/script/gi, '<\\/script')}</script>`;
        }
      } catch (err) {
        vscode.window.showWarningMessage(localize('messages.importError').replace('%1', config.imports[i]));
      }
    }

    return imports;
  }

  function generateNewJS(JS, base, injectData) {
    const runtimePath = useEsmRuntime
      ? path.join(runtimeDir, "index.mjs")
      : path.join(runtimeDir, "index.cjs");
    return _generateNewJS(JS, base, injectData, runtimePath);
  }

  // BrowserWindow option modification
  async function modifyElectronJSFile(ElectronJSFile, writer) {
    const config = vscode.workspace.getConfiguration("vscode_vibrancy");
    const electronMajorVersion = parseInt(process.versions.electron.split('.')[0]);
    let ElectronJS = await fs.readFile(ElectronJSFile, 'utf-8');
    let useFrame = false;

    // On Cursor, always use frame
    if (vscode.env.appName === 'Cursor') {
      useFrame = true;
    }

    // On Windows with Electron >=27, always use frame (issue 122)
    if (process.platform === 'win32' && electronMajorVersion >= 27) {
      useFrame = true;
    }

    // Linux doesn't have a universal native API for transparent frames, 
    // so we need to handle transparency and window frames manually.
    if (process.platform === 'linux') {
      useFrame = true;
    }

    if (config.disableFramelessWindow) {
      useFrame = false;
    }

    if (config.forceFramelessWindow) {
      useFrame = true;
    }

    // On non-VSCode editors, this is risky, check against a list of known working editors
    if (!knownEditors.includes(vscode.env.appName)) {
      // If frame was enabled, fail installation
      if (useFrame) {
        throw new Error(localize('messages.unsupportedEditor'));
      }
      return;
    }

    ElectronJS = injectElectronOptions(ElectronJS, { useFrame, isMacos: osType === 'macos' });

    await writer.writeFile(ElectronJSFile, ElectronJS, 'utf-8');
  }

  async function installHTML(writer) {
    const HTML = await fs.readFile(HTMLFile, 'utf-8');
    const { result, alreadyPatched, noMetaTag } = _patchCSP(HTML);

    if (noMetaTag) return;

    // Always write if already patched to overwrite any staged uninstall in Update flow
    if (alreadyPatched) {
      await writer.writeFile(HTMLFile, HTML, 'utf-8');
      return;
    }

    await writer.writeFile(HTMLFile, result, 'utf-8');
  }

  async function uninstallJS(writer) {
    let JS = await fs.readFile(JSFile, 'utf-8');
    const { result, hadMarkers } = removeJSMarkers(JS);
    JS = result;

    if (knownEditors.includes(vscode.env.appName)) {
      if (ElectronJSFile === JSFile) {
        // VSCode 1.95+: both files are the same main.js — apply all cleanups
        // to a single in-memory copy to avoid the second write overwriting the first
        JS = removeElectronOptions(JS);
        await writer.writeFile(JSFile, JS, 'utf-8');
      } else {
        if (hadMarkers) {
          await writer.writeFile(JSFile, JS, 'utf-8');
        }
        const ElectronJS = await fs.readFile(ElectronJSFile, 'utf-8');
        await writer.writeFile(ElectronJSFile, removeElectronOptions(ElectronJS), 'utf-8');
      }
    } else if (hadMarkers) {
      await writer.writeFile(JSFile, JS, 'utf-8');
    }
  }

  async function uninstallHTML(writer) {
    const HTML = await fs.readFile(HTMLFile, 'utf-8');
    const newHTML = removeCSPPatch(HTML);
    if (newHTML !== HTML) {
      await writer.writeFile(HTMLFile, newHTML, 'utf-8');
    }
  }

  function enabledRestart() {
    if (testMode) return;
    vscode.window.showInformationMessage(localize('messages.enabled'), { title: localize('messages.restartIde') })
      .then(function (msg) {
        msg && promptRestart(true);
      });
  }

  function disabledRestart() {
    if (testMode) return;
    vscode.window.showInformationMessage(localize('messages.disabled'), { title: localize('messages.restartIde') })
      .then(function (msg) {
        msg && promptRestart(false);
      });
  }

  function isVSCodeThisVersionOrNewer(requiredVersion) {
    const currentVersion = vscode.version; // e.g., "1.96.0"

    // Extract only the numeric parts of the version string (e.g., "1.95.0-insider" -> "1.95.0")
    const currentVersionCleaned = currentVersion.match(/^\d+\.\d+\.\d+/)[0];

    // Split the version strings into major, minor, and patch numbers
    const currentParts = currentVersionCleaned.split('.').map(Number);
    const requiredParts = requiredVersion.split('.').map(Number);

    // Compare each part of the version
    for (let i = 0; i < requiredParts.length; i++) {
        if ((currentParts[i] || 0) > requiredParts[i]) {
            return true;
        } else if ((currentParts[i] || 0) < requiredParts[i]) {
            return false;
        }
    }

    // If all parts are equal, return true
    return true;
  }

  // Fix UI rendering by modifying VSCode settings
  async function changeVSCodeSettings() {
    const vibrancyConfig = vscode.workspace.getConfiguration("vscode_vibrancy");
    const vibrancyTheme = getCurrentTheme(vibrancyConfig);
    const themeConfigPath = path.resolve(__dirname, themeConfigPaths[vibrancyTheme]);
    const themeConfig = require(themeConfigPath);
    const enableAutoTheme = vscode.workspace.getConfiguration().get("vscode_vibrancy.enableAutoTheme");
    const disableColorCustomizations = vibrancyConfig.get("disableColorCustomizations");

    let opacity = vibrancyConfig.get("opacity");
    if (opacity < 0) {
      opacity = themeConfig.opacity?.[osType] ?? 0.5;
    }

    const themeBackground = vibrancyConfig.get("backgroundOverride")
      ? vibrancyConfig.get("backgroundOverride").replace('#', '')
      : themeConfig.background;

    const config = vscode.workspace.getConfiguration();
    const settingsStore = {
      inspect: (key) => config.inspect(key),
      update: (key, value) => config.update(key, value, vscode.ConfigurationTarget.Global),
    };

    return applySettings({
      settingsStore,
      globalState: context.globalState,
      themeConfig,
      enableAutoTheme,
      disableColorCustomizations,
      opacity,
      themeBackground,
      showInfo: (msg) => vscode.window.showInformationMessage(msg),
      localize,
    });
  }

  // Function to restore previous settings on uninstall
  async function restorePreviousSettings() {
    const disableColorCustomizations = vscode.workspace.getConfiguration("vscode_vibrancy").get("disableColorCustomizations");
    const config = vscode.workspace.getConfiguration();

    return restoreSettings({
      settingsStore: {
        inspect: (key) => config.inspect(key),
        update: (key, value) => config.update(key, value, vscode.ConfigurationTarget.Global),
      },
      globalState: context.globalState,
      disableColorCustomizations,
    });
  }

  async function getLocalConfigPath() {
    const configDir = getConfigDir('vscode-vibrancy-continued');
    const configFilePath = path.join(configDir, 'config.json');

    // Ensure the directory exists recursively
    await fs.mkdir(configDir, { recursive: true }).catch(() =>
      console.warn(`Failed to create directory: ${configDir}`)
    );

    return configFilePath;
  }

  async function setLocalConfig(state, paths, previousCustomizations) {
    const configFilePath = await getLocalConfigPath();

    // Convert undefined values in previousCustomizations to null
    if (previousCustomizations && typeof previousCustomizations === 'object') {
      previousCustomizations = Object.fromEntries(
          Object.entries(previousCustomizations).map(([key, value]) => [key, value === undefined ? null : value])
      );
    }

    if (state) {
      const cliName = editorCliCommands[vscode.env.appName] || 'code';
      const cliFullPath = process.platform === 'win32'
        ? path.join(path.dirname(process.execPath), 'bin', `${cliName}.cmd`)
        : cliName;
      const configData = {
        workbenchHtmlPath: paths.workbenchHtmlPath,
        jsPath: paths.jsPath,
        electronJsPath: paths.electronJsPath,
        settingsJsonPath: getEditorSettingsPath(vscode.env.appName),
        cliCommand: require('fs').existsSync(cliFullPath) ? cliFullPath : cliName,
        previousCustomizations,
      };
      await fs.writeFile(configFilePath, JSON.stringify(configData, null, 2), 'utf-8');
    } else {
        await fs.unlink(configFilePath).catch(() => { });
    }
  }


  // ####  main commands ######################################################

  /**
   * Check if elevation is needed and prompt the user for permission.
   * Returns the resolved elevation state (true/false), or null if the user
   * cancelled or the operation should be aborted (e.g. Snap).
   */
  async function resolveElevation(forceElevation) {
    if (testMode) return false;
    let needsElevation = forceElevation || checkNeedsElevation(appDir);

    if (needsElevation === 'snap') {
      vscode.window.showErrorMessage(localize('messages.snapImmutable'));
      return null;
    }

    if (needsElevation) {
      // Check if elevation is even possible before prompting the user
      if (process.platform === 'linux' && hasNoNewPrivs()) {
        vscode.window.showErrorMessage(localize('messages.noNewPrivs'));
        return null;
      }

      const choice = await vscode.window.showWarningMessage(
        localize('messages.elevationRequired'),
        { title: localize('messages.elevationYes') },
        { title: localize('messages.elevationNo') }
      );
      if (!choice || choice.title === localize('messages.elevationNo')) {
        return null;
      }
    }

    return needsElevation;
  }

  function handleElevationError(error, retryFn) {
    if (error && error.message === 'no_new_privs') {
      vscode.window.showErrorMessage(localize('messages.noNewPrivs'));
    } else if (error && (error.code === 'EPERM' || error.code === 'EACCES')) {
      vscode.window.showErrorMessage(
        localize('messages.admin') + error + ". Click here for more info: [Known Errors](https://github.com/illixion/vscode-vibrancy-continued/blob/main/docs/known-errors.md)",
        { title: localize('messages.retryElevated') }
      ).then(retryChoice => {
        if (retryChoice) retryFn();
      });
    } else if (error && error.message && error.message.includes('pkexec_missing')) {
      vscode.window.showErrorMessage(localize('messages.pkexecMissing') + appDir);
    } else if (error && error.message && error.message.includes('Elevation failed')) {
      vscode.window.showErrorMessage(localize('messages.elevationFailed') + error.message + ". Click here for more info: [Known Errors](https://github.com/illixion/vscode-vibrancy-continued/blob/main/docs/known-errors.md)");
    } else {
      vscode.window.showErrorMessage(localize('messages.smthingwrong') + error + ". Click here for more info: [Known Errors](https://github.com/illixion/vscode-vibrancy-continued/blob/main/docs/known-errors.md)");
    }
  }

  async function applyPostInstallSettings() {
    await checkColorTheme(testMode);
    await checkElectronDeprecatedType();
    await setLocalConfig(true, {
      workbenchHtmlPath: HTMLFile,
      jsPath: JSFile,
      electronJsPath: ElectronJSFile,
    }, await changeVSCodeSettings());
  }

  async function Install(sharedWriter) {

    if (osType === 'unknown') {
      vscode.window.showInformationMessage(localize('messages.unsupported'));
      throw new Error('unsupported');
    }

    // BUG: prevent installation on macOS with Electron 32.2.6 used in VSCode 1.96 (#178)
    if (process.versions.electron === "32.2.6" && process.platform === 'darwin') {
      vscode.window.showErrorMessage("Vibrancy doesn't work with this version of VSCode, see [here](https://github.com/illixion/vscode-vibrancy-continued/issues/178) for more info.");
      throw new Error('unsupported');
    }

    // Use shared writer if provided (e.g. from Update), otherwise create our own
    let writer = sharedWriter;
    if (!writer) {
      const needsElevation = await resolveElevation(false);
      if (needsElevation === null) return;
      writer = new StagedFileWriter(needsElevation);
      await writer.init();
    }

    try {
      await fs.stat(JSFile);
      await fs.stat(HTMLFile);

      if (osType === 'win10') {
        await installRuntimeWin(writer);
      } else {
        await installRuntime(writer);
      }
      await modifyElectronJSFile(ElectronJSFile, writer);
      await installJS(writer);
      await installHTML(writer);

      // Flush if we own the writer (not shared). Shared writer is flushed by caller.
      if (!sharedWriter) {
        await writer.flush();
        // Apply VSCode settings and local config after flush succeeds
        await applyPostInstallSettings();
        enabledRestart();
      }
    } catch (error) {
      if (!sharedWriter) writer.cleanup();
      // Re-throw when using shared writer so the caller (Update) can handle it
      if (sharedWriter) throw error;
      handleElevationError(error, async () => {
        const elevatedWriter = new StagedFileWriter(true);
        await elevatedWriter.init();
        try {
          await Install(elevatedWriter);
          await elevatedWriter.flush();
          await applyPostInstallSettings();
          enabledRestart();
        } catch (retryError) {
          elevatedWriter.cleanup();
          handleElevationError(retryError, () => {});
        }
      });
    }
  }

  async function Uninstall(promptRestart = true, sharedWriter) {
    // Defer settings restore when part of Update flow — Update handles it after flush
    if (!sharedWriter) {
      await restorePreviousSettings();
    }

    // Use shared writer if provided (e.g. from Update), otherwise create our own
    let writer = sharedWriter;
    if (!writer) {
      const needsElevation = await resolveElevation(false);
      if (needsElevation === null) return;
      writer = new StagedFileWriter(needsElevation);
      await writer.init();
    }

    try {
      // uninstall old version
      await fs.stat(HTMLFile);
      await uninstallHTML(writer);

      await fs.stat(JSFile);
      await uninstallJS(writer);

      // Flush if we own the writer (not shared). Shared writer is flushed by caller.
      if (!sharedWriter) {
        await writer.flush();
        await setLocalConfig(false);

        if (promptRestart) {
          disabledRestart();
        }
      }
    } catch (error) {
      if (!sharedWriter) writer.cleanup();
      // Re-throw when using shared writer so the caller (Update) can handle it
      if (sharedWriter) throw error;
      handleElevationError(error, async () => {
        const elevatedWriter = new StagedFileWriter(true);
        await elevatedWriter.init();
        try {
          await Uninstall(promptRestart, elevatedWriter);
          await elevatedWriter.flush();
          await setLocalConfig(false);
          if (promptRestart) {
            disabledRestart();
          }
        } catch (retryError) {
          elevatedWriter.cleanup();
          handleElevationError(retryError, () => {});
        }
      });
    }
  }

  async function Update() {
    const needsElevation = await resolveElevation(false);
    if (needsElevation === null) return;

    // Single writer for both uninstall + install — one elevation prompt
    const writer = new StagedFileWriter(needsElevation);
    await writer.init();

    try {
      await Uninstall(false, writer);
      await Install(writer);
      // Flush all file changes at once, then apply settings only on success
      await writer.flush();
      await applyPostInstallSettings();
      enabledRestart();
    } catch (error) {
      writer.cleanup();
      handleElevationError(error, async () => {
        const elevatedWriter = new StagedFileWriter(true);
        await elevatedWriter.init();
        try {
          await Uninstall(false, elevatedWriter);
          await Install(elevatedWriter);
          await elevatedWriter.flush();
          await applyPostInstallSettings();
          enabledRestart();
        } catch (retryError) {
          elevatedWriter.cleanup();
          handleElevationError(retryError, () => {});
        }
      });
    }
  }

  var operationInProgress = false;

  async function runExclusive(fn) {
    if (operationInProgress) return;
    operationInProgress = true;
    try {
      await fn();
    } finally {
      operationInProgress = false;
    }
  }

  var installVibrancy = vscode.commands.registerCommand('extension.installVibrancy', () => {
    runExclusive(() => Install());
  });
  var uninstallVibrancy = vscode.commands.registerCommand('extension.uninstallVibrancy', () => {
    runExclusive(() => Uninstall());
  });
  var updateVibrancy = vscode.commands.registerCommand('extension.updateVibrancy', () => {
    runExclusive(() => Update());
  });

  context.subscriptions.push(installVibrancy);
  context.subscriptions.push(uninstallVibrancy);
  context.subscriptions.push(updateVibrancy);

  const currentVersion = context.extension.packageJSON.version;
  let lastVersion = context.globalState.get('lastVersion');
  let updateMsg = "messages.updateNeeded"

  // Detect first time install
  if (!lastVersion) {
    lastVersion = '0.0.0';
    updateMsg = "messages.firstload"
  }

  // Check if the current version is a minor update from the last version
  if (checkRuntimeUpdate(currentVersion, lastVersion)) {
    if (testMode) {
      runExclusive(() => Update()).then(() => {
        // Include diagnostic info about the runtime directory
        const runtimeFiles = require('fs').existsSync(runtimeDir)
          ? require('fs').readdirSync(runtimeDir).join(', ')
          : 'DIR NOT FOUND';
        const pendingCopies = typeof pendingNodeCopies !== 'undefined' ? pendingNodeCopies.length : 0;
        writeTestSignal('success', `Install completed. Runtime: [${runtimeFiles}]. Pending .node copies: ${pendingCopies}. appDir: ${appDir}`);
      }).catch((err) => {
        writeTestSignal('error', String(err && err.message || err));
      });
    } else {
      vscode.window.showInformationMessage(localize(updateMsg), { title: localize('messages.installIde') })
        .then(async (msg) => {
          if (msg) {
            await runExclusive(() => Update());
          }
        });
    }
    // Update the global state with the current version
    context.globalState.update('lastVersion', currentVersion);
  }

  // Test harness can request an uninstall by creating a test-uninstall file
  if (testUninstallRequested) {
    runExclusive(() => Uninstall(false)).then(() => {
      try { require('fs').unlinkSync(testUninstallFile); } catch {}
      writeTestSignal('uninstalled', 'Uninstall completed');
    }).catch((err) => {
      writeTestSignal('error', `Uninstall failed: ${err && err.message || err}`);
    });
  }

  var lastConfig = vscode.workspace.getConfiguration("vscode_vibrancy");

  vscode.workspace.onDidChangeConfiguration(() => {
    if (operationInProgress) return;
    newConfig = vscode.workspace.getConfiguration("vscode_vibrancy");
    if (!deepEqual(lastConfig, newConfig)) {
      lastConfig = newConfig;
      vscode.window.showInformationMessage(localize('messages.configupdate'), { title: localize('messages.reloadIde') })
      .then(async (msg) => {
          if (msg) {
            await runExclusive(() => Update());
          }
        });
      context.globalState.update('lastVersion', currentVersion);
      }
  });

  checkDarkLightMode(vscode.window.activeColorTheme)
  vscode.window.onDidChangeActiveColorTheme((theme) => {
    checkDarkLightMode(theme)
  });
}
exports.activate = activate;

// this method is called when your extension is deactivated
function deactivate() { }
exports.deactivate = deactivate;

// Exported for testing
exports._test = { getCurrentTheme };
