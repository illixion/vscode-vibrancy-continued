const { execSync, spawn } = require('child_process');
const fs = require('fs').promises; // Use fs.promises for Promise-based APIs
const fsSync = require('fs'); // Import standard fs for synchronous methods
const path = require('path');
const os = require('os');
const { StagedFileWriter, checkNeedsElevation } = require('./elevated-file-writer');

function getConfigDir(name) {
    const homedir = os.homedir();
    if (process.platform === 'darwin') {
        return path.join(homedir, 'Library', 'Preferences', name);
    }
    if (process.platform === 'win32') {
        return path.join(process.env.APPDATA || path.join(homedir, 'AppData', 'Roaming'), name, 'Config');
    }
    return path.join(process.env.XDG_CONFIG_HOME || path.join(homedir, '.config'), name);
}

function getVSCodeSettingsPath(configSettingsPath) {
    // Prefer the path stored in local config (supports Insiders, Cursor, etc.)
    if (configSettingsPath) {
        return configSettingsPath;
    }
    // Fallback to standard VSCode path
    const platform = os.platform();
    const home = os.homedir();

    if (platform === 'win32') {
        return path.join(process.env.APPDATA, 'Code', 'User', 'settings.json');
    } else if (platform === 'darwin') {
        return path.join(home, 'Library', 'Application Support', 'Code', 'User', 'settings.json');
    } else {
        return path.join(home, '.config', 'Code', 'User', 'settings.json');
    }
}

// Function to restore previous settings
// Because VSCode uses JSONC, we need to be careful with comments
// and formatting. We will use regex to find and replace the specific settings.
function restorePreviousSettings(previousCustomizations, configSettingsPath) {
    const settingsPath = getVSCodeSettingsPath(configSettingsPath);

    if (!fsSync.existsSync(settingsPath)) {
        console.error('VSCode settings.json not found!');
        return;
    }

    let settingsContent = '';
    try {
        settingsContent = fsSync.readFileSync(settingsPath, 'utf-8');
    } catch (err) {
        console.error('Failed to read settings.json:', err);
        return;
    }

    // Remove transparent terminal background
    settingsContent = settingsContent.replace(
        /"terminal\.background"\s*:\s*"#00000000",?\s*/g,
        ''
    );

    // Remove all vibrancy-managed background keys — must match ALL_VIBRANCY_BG_KEYS in index.js
    const vibrancyBgKeys = [
        "editorPane.background", "editorGroupHeader.tabsBackground",
        "editorGroupHeader.noTabsBackground", "breadcrumb.background", "editorGutter.background",
        "panel.background", "panelStickyScroll.background", "tab.activeBackground",
        "tab.unfocusedActiveBackground", "sideBar.background", "sideBarTitle.background",
        "sideBarStickyScroll.background", "activityBar.background", "editorWidget.background",
        "editorHoverWidget.background", "editorSuggestWidget.background", "editorStickyScroll.background",
        "editorStickyScrollGutter.background", "tab.inactiveBackground",
        "tab.unfocusedInactiveBackground", "inlineChat.background", "editor.background",
        "notifications.background", "notificationCenterHeader.background",
        "menu.background", "quickInput.background",
    ];
    for (const key of vibrancyBgKeys) {
        const escapedKey = key.replace(/\./g, '\\.');
        settingsContent = settingsContent.replace(
            new RegExp(`"${escapedKey}"\\s*:\\s*".*?",?\\s*`, 'g'),
            ''
        );
    }

    // Restore saved customizations
    if (previousCustomizations?.saved) {
        if (previousCustomizations.terminalBackground != null) {
            if (
                previousCustomizations.terminalBackground === '#00000000'
            ) {
                settingsContent = settingsContent.replace(
                    /"terminal\.background"\s*:\s*".*?",?\s*/g,
                    ''
                );
            } else {
                settingsContent = settingsContent.replace(
                    /"terminal\.background"\s*:\s*".*?",?\s*/g,
                    `"terminal.background": "${previousCustomizations.terminalBackground}",`
                );
            }
        }

        // Restore vibrancy background keys to their original values
        if (previousCustomizations.vibrancyBackgrounds) {
            for (const [key, originalValue] of Object.entries(previousCustomizations.vibrancyBackgrounds)) {
                if (originalValue != null) {
                    const escapedKey = key.replace(/\./g, '\\.');
                    // If the key still exists (was restored above or user re-added), replace it
                    const regex = new RegExp(`"${escapedKey}"\\s*:\\s*".*?",?\\s*`, 'g');
                    if (regex.test(settingsContent)) {
                        settingsContent = settingsContent.replace(regex,
                            `"${key}": "${originalValue}",`
                        );
                    }
                    // Note: if key was fully removed and had an original value, we can't easily
                    // re-insert into JSONC without a proper parser. The VSCode API restore handles this.
                }
            }
        }

        if (previousCustomizations.systemColorTheme != null) {
            settingsContent = settingsContent.replace(
                /"window\.systemColorTheme"\s*:\s*".*?",?\s*/g,
                `"window.systemColorTheme": "${previousCustomizations.systemColorTheme}",`
            );
        } else {
            settingsContent = settingsContent.replace(
                /"window\.systemColorTheme"\s*:\s*".*?",?\s*/g,
                ''
            );
        }

        if (previousCustomizations.autoDetectColorScheme != null) {
            settingsContent = settingsContent.replace(
                /"window\.autoDetectColorScheme"\s*:\s*(true|false),?\s*/g,
                `"window.autoDetectColorScheme": ${previousCustomizations.autoDetectColorScheme},`
            );
        } else {
            settingsContent = settingsContent.replace(
                /"window\.autoDetectColorScheme"\s*:\s*(true|false),?\s*/g,
                ''
            );
        }

        if (previousCustomizations.gpuAcceleration != null) {
            settingsContent = settingsContent.replace(
                /"terminal\.integrated\.gpuAcceleration"\s*:\s*".*?",?\s*/g,
                `"terminal.integrated.gpuAcceleration": "${previousCustomizations.gpuAcceleration}",`
            );
        } else {
            settingsContent = settingsContent.replace(
                /"terminal\.integrated\.gpuAcceleration"\s*:\s*".*?",?\s*/g,
                ''
            );
        }
    }

    // Always remove window.controlsStyle — set by our promptRestart, never user-owned
    settingsContent = settingsContent.replace(
        /"window\.controlsStyle"\s*:\s*".*?",?\s*/g,
        ''
    );

    // Write updated settings back to disk
    try {
        fsSync.writeFileSync(settingsPath, settingsContent.trim() + '\n', 'utf-8');
        console.log('VSCode settings.json successfully reverted.');
    } catch (err) {
        console.error('Failed to write settings.json:', err);
    }
}

// On Windows, VSCode caches settings.json in memory at startup and writes it back later,
// overwriting any changes the hook makes directly. Instead, spawn a detached PowerShell
// script that waits for the VSCode process to fully exit, then cleans up settings.json.
function deferSettingsRestoreWindows(settingsPath, cliCommand) {
    const exeName = path.basename(process.execPath, '.exe'); // e.g. "Code - Insiders"
    const logPath = path.join(os.tmpdir(), 'vibrancy-cleanup.log').replace(/\\/g, '\\\\');

    // All vibrancy-managed keys (nested inside workbench.colorCustomizations)
    const colorKeys = [
        'terminal\\.background',
        'editorPane\\.background', 'editorGroupHeader\\.tabsBackground',
        'editorGroupHeader\\.noTabsBackground', 'breadcrumb\\.background',
        'editorGutter\\.background', 'panel\\.background', 'panelStickyScroll\\.background',
        'tab\\.activeBackground', 'tab\\.unfocusedActiveBackground',
        'sideBar\\.background', 'sideBarTitle\\.background', 'sideBarStickyScroll\\.background',
        'activityBar\\.background', 'editorWidget\\.background', 'editorHoverWidget\\.background',
        'editorSuggestWidget\\.background', 'editorStickyScroll\\.background',
        'editorStickyScrollGutter\\.background', 'tab\\.inactiveBackground',
        'tab\\.unfocusedInactiveBackground', 'inlineChat\\.background',
        'editor\\.background', 'notifications\\.background', 'notificationCenterHeader\\.background',
        'menu\\.background', 'quickInput\\.background',
    ];

    const colorReplaces = colorKeys.map(k =>
        `$c = $c -replace '(?m)"${k}"\\s*:\\s*"[^"]*",?[ \\t]*\\r?\\n?', ''`
    ).join('\r\n');

    const cli = (cliCommand || 'code').replace(/'/g, "''");

    const psScript = [
        `$log = '${logPath}'`,
        `function Log($msg) { Add-Content -Path $log -Value "$(Get-Date -Format o) $msg" }`,
        `Log "Vibrancy cleanup started"`,
        `$proc = '${exeName.replace(/'/g, "''")}'`,
        `$settings = '${settingsPath.replace(/'/g, "''")}'`,
        `Log "Waiting for $proc to exit..."`,
        // Wait for all instances of the VSCode exe to exit
        `while (Get-Process -Name $proc -ErrorAction SilentlyContinue) { Start-Sleep -Seconds 1 }`,
        `Start-Sleep -Seconds 2`,
        `Log "Process exited, cleaning settings at: $settings"`,
        `if (Test-Path $settings) {`,
        `  $before = (Get-Item $settings).Length`,
        `  Log "Settings file found, size: $before bytes"`,
        `  $c = [System.IO.File]::ReadAllText($settings)`,
        colorReplaces,
        // Remove top-level vibrancy settings
        `  $c = $c -replace '(?m)"terminal\\.integrated\\.gpuAcceleration"\\s*:\\s*"[^"]*",?[ \\t]*\\r?\\n?', ''`,
        `  $c = $c -replace '(?m)"window\\.systemColorTheme"\\s*:\\s*"[^"]*",?[ \\t]*\\r?\\n?', ''`,
        `  $c = $c -replace '(?m)"window\\.autoDetectColorScheme"\\s*:\\s*(true|false),?[ \\t]*\\r?\\n?', ''`,
        `  $c = $c -replace '(?m)"window\\.controlsStyle"\\s*:\\s*"[^"]*",?[ \\t]*\\r?\\n?', ''`,
        `  $c = $c.Trim() + [System.Environment]::NewLine`,
        `  [System.IO.File]::WriteAllText($settings, $c, [System.Text.Encoding]::UTF8)`,
        `  $after = (Get-Item $settings).Length`,
        `  Log "Settings cleaned, new size: $after bytes (removed $($before - $after) bytes)"`,
        `} else {`,
        `  Log "Settings file not found at: $settings"`,
        `}`,
        // Relaunch VSCode
        `Log "Relaunching: ${cli}"`,
        `Start-Process '${cli}'`,
        `Log "Cleanup complete, removing script"`,
        `Remove-Item $MyInvocation.MyCommand.Path -Force`,
    ].join('\r\n');

    const scriptPath = path.join(os.tmpdir(), `vibrancy-cleanup-${Date.now()}.ps1`);
    fsSync.writeFileSync(scriptPath, psScript, 'utf-8');
    spawn('powershell.exe', [
        '-NoProfile', '-ExecutionPolicy', 'Bypass', '-WindowStyle', 'Hidden', '-File', scriptPath,
    ], { detached: true, stdio: 'ignore' }).unref();
}

function showFatalError(message) {
    if (process.platform === 'win32') {
        try {
            const vbs = `MsgBox "${String(message).replace(/"/g, '""')}", 16, "Vibrancy Continued"`;
            const vbsPath = path.join(os.tmpdir(), `vibrancy-fatal-${Date.now()}.vbs`);
            fsSync.writeFileSync(vbsPath, vbs);
            execSync(`wscript "${vbsPath}"`, { stdio: 'ignore' });
            try { fsSync.unlinkSync(vbsPath); } catch {}
        } catch {}
    } else {
        try { execSync(`zenity --error --title="Vibrancy Continued" --text="${String(message).replace(/"/g, '\\"')}"`); } catch {}
    }
}

(async () => {
  try {
    const configDir = getConfigDir('vscode-vibrancy-continued');
    const configFilePath = path.join(configDir, 'config.json');

    function loadConfig() {
        if (fsSync.existsSync(configFilePath)) {
            return JSON.parse(fsSync.readFileSync(configFilePath, 'utf-8'));
        }
        return null;
    }

    async function uninstallJS(jsFilePath, electronJsFilePath, writer) {
        let JS = await fs.readFile(jsFilePath, 'utf-8');
        const needClean = /\n\/\* !! VSCODE-VIBRANCY-START !! \*\/[\s\S]*?\/\* !! VSCODE-VIBRANCY-END !! \*\//.test(JS);
        if (needClean) {
            JS = JS.replace(/\n\/\* !! VSCODE-VIBRANCY-START !! \*\/[\s\S]*?\/\* !! VSCODE-VIBRANCY-END !! \*\//, '');
        }

        if (electronJsFilePath === jsFilePath) {
            // Since VSCode 1.95, both files are the same — apply all cleanups to one buffer
            JS = JS
                .replace(/frame:false,transparent:true,experimentalDarkMode/g, 'experimentalDarkMode')
                .replace(/visualEffectState:"active",experimentalDarkMode/g, 'experimentalDarkMode');
            await writer.writeFile(jsFilePath, JS, 'utf-8');
        } else {
            if (needClean) {
                await writer.writeFile(jsFilePath, JS, 'utf-8');
            }
            const ElectronJS = await fs.readFile(electronJsFilePath, 'utf-8');
            const newElectronJS = ElectronJS
                .replace(/frame:false,transparent:true,experimentalDarkMode/g, 'experimentalDarkMode')
                .replace(/visualEffectState:"active",experimentalDarkMode/g, 'experimentalDarkMode');
            await writer.writeFile(electronJsFilePath, newElectronJS, 'utf-8');
        }
    }

    async function uninstallHTML(htmlFilePath, writer) {
        const HTML = await fs.readFile(htmlFilePath, 'utf-8');
        // Remove both current and legacy (original vscode-vibrancy) markers
        if (HTML.includes('VscodeVibrancy')) {
            const newHTML = HTML
                .replace(/ VscodeVibrancyContinued/g, '')
                .replace(/ VscodeVibrancy/g, '');
            await writer.writeFile(htmlFilePath, newHTML, 'utf-8');
        }
    }

    // Blocking notification — must complete before continuing (e.g. pre-UAC warning)
    function showNotificationSync(message, title = 'Vibrancy Continued') {
        if (process.platform === 'win32') {
            const vbs = `MsgBox "${message.replace(/"/g, '""')}", 64, "${title.replace(/"/g, '""')}"`;
            const vbsPath = path.join(os.tmpdir(), `vibrancy-notify-${Date.now()}.vbs`);
            fsSync.writeFileSync(vbsPath, vbs);
            execSync(`wscript "${vbsPath}"`, { stdio: 'ignore' });
            try { fsSync.unlinkSync(vbsPath); } catch {}
        } else if (process.platform === 'darwin') {
            const escapedMessage = message.replace(/'/g, "\\'").replace(/"/g, '\\"');
            execSync(`osascript -e 'display alert "${title}" message "${escapedMessage}" as critical'`);
        } else {
            const escapedMessage = message.replace(/'/g, "\\'").replace(/"/g, '\\"');
            execSync(`zenity --info --title="${title}" --text="${escapedMessage}"`);
        }
    }

    // Fire-and-forget notification — survives the Node process exiting
    function showNotification(message) {
        if (process.platform === 'win32') {
            const js = `javascript:var sh=new ActiveXObject('WScript.Shell'); sh.Popup('${message.replace(/'/g, "\\'")}', 0, 'Vibrancy Continued', 64); close()`;
            spawn('mshta', [js], { detached: true, stdio: 'ignore' }).unref();
        } else if (process.platform === 'darwin') {
            const escapedMessage = message.replace(/'/g, "\\'").replace(/"/g, '\\"');
            spawn('/bin/sh', ['-c', `osascript -e 'display alert "Vibrancy Continued" message "${escapedMessage}" as critical'`], { detached: true, stdio: 'ignore' }).unref();
        } else {
            const escapedMessage = message.replace(/'/g, "\\'").replace(/"/g, '\\"');
            spawn('/bin/sh', ['-c', `zenity --info --title="Vibrancy Continued" --text="${escapedMessage}"`], { detached: true, stdio: 'ignore' }).unref();
        }
    }

    const config = loadConfig();
    if (config) {
        const { workbenchHtmlPath, jsPath, electronJsPath, settingsJsonPath, cliCommand, previousCustomizations } = config;

        // Determine elevation needs from the JS file path (part of VSCode install dir)
        const appDir = path.dirname(jsPath);
        const needsElevation = checkNeedsElevation(appDir);

        // Snap installs are unsupported and should be skipped
        if (needsElevation !== 'snap') {
            if (needsElevation) {
                showNotificationSync(
                    "Vibrancy Continued was uninstalled and needs to revert changes to VSCode's internal files. " +
                    "You will be prompted for administrator privileges.",
                );
            }

            const writer = new StagedFileWriter(needsElevation === true);
            await writer.init();

            let fileOpsError = null;
            try {
                await uninstallJS(jsPath, electronJsPath, writer);
                await uninstallHTML(workbenchHtmlPath, writer);
                await writer.flush();
            } catch (err) {
                writer.cleanup();
                fileOpsError = err;
                console.error('Failed to revert VSCode files:', err);
            }

            if (process.platform === 'win32') {
                // Windows: VSCode caches settings in memory at startup and overwrites our changes.
                // Defer cleanup to a detached script that runs after VSCode fully exits.
                deferSettingsRestoreWindows(settingsJsonPath || getVSCodeSettingsPath(), cliCommand);
            } else {
                restorePreviousSettings(previousCustomizations, settingsJsonPath);
            }

            if (fileOpsError) {
                showNotification("Vibrancy Continued: Failed to revert VSCode files. You may need to reinstall VSCode or manually revert changes.");
            } else if (process.platform !== 'win32') {
                // On Windows the deferred script relaunches VSCode automatically
                showNotification("Vibrancy Continued has been removed. Please restart VSCode to apply changes.");
            }
        }
    }
  } catch (fatalError) {
    showFatalError(`Uninstall hook crashed: ${fatalError && fatalError.message || fatalError}`);
  }
})();