const { spawn, exec } = require('child_process');
const fs = require('fs').promises; // Use fs.promises for Promise-based APIs
const fsSync = require('fs'); // Import standard fs for synchronous methods
const path = require('path');
const os = require('os');

function getVSCodeSettingsPath() {
    const platform = os.platform();
    const home = os.homedir();

    if (platform === 'win32') {
        return path.join(process.env.APPDATA, 'Code', 'User', 'settings.json');
    } else if (platform === 'darwin') {
        return path.join(home, 'Library', 'Application Support', 'Code', 'User', 'settings.json');
    } else {
        // Assume Linux
        return path.join(home, '.config', 'Code', 'User', 'settings.json');
    }
}

// Function to restore previous settings
// Because VSCode uses JSONC, we need to be careful with comments
// and formatting. We will use regex to find and replace the specific settings.
function restorePreviousSettings(previousCustomizations) {
    const settingsPath = getVSCodeSettingsPath();

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

    // Restore saved customizations
    if (previousCustomizations?.saved) {
        if (previousCustomizations.terminalBackground !== null) {
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

        if (previousCustomizations.systemColorTheme !== null) {
            settingsContent = settingsContent.replace(
                /"window\.systemColorTheme"\s*:\s*".*?",?\s*/g,
                previousCustomizations.systemColorTheme === null
                    ? ''
                    : `"window.systemColorTheme": "${previousCustomizations.systemColorTheme}",`
            );
        } else {
            settingsContent = settingsContent.replace(
                /"window\.systemColorTheme"\s*:\s*".*?",?\s*/g,
                ''
            );
        }

        if (previousCustomizations.autoDetectColorScheme !== null) {
            settingsContent = settingsContent.replace(
                /"window\.autoDetectColorScheme"\s*:\s*(true|false),?\s*/g,
                previousCustomizations.autoDetectColorScheme === null
                    ? ''
                    : `"window.autoDetectColorScheme": ${previousCustomizations.autoDetectColorScheme},`
            );
        } else {
            settingsContent = settingsContent.replace(
                /"window\.autoDetectColorScheme"\s*:\s*(true|false),?\s*/g,
                ''
            );
        }

        if (previousCustomizations.gpuAcceleration !== null) {
            settingsContent = settingsContent.replace(
                /"terminal\.integrated\.gpuAcceleration"\s*:\s*".*?",?\s*/g,
                previousCustomizations.gpuAcceleration === null
                    ? ''
                    : `"terminal.integrated.gpuAcceleration": "${previousCustomizations.gpuAcceleration}",`
            );
        } else {
            settingsContent = settingsContent.replace(
                /"terminal\.integrated\.gpuAcceleration"\s*:\s*".*?",?\s*/g,
                ''
            );
        }
    }

    // Write updated settings back to disk
    try {
        fsSync.writeFileSync(settingsPath, settingsContent.trim() + '\n', 'utf-8');
        console.log('VSCode settings.json successfully reverted.');
    } catch (err) {
        console.error('Failed to write settings.json:', err);
    }
}

(async () => {
    const altConfigPath = path.join(os.homedir(), '.vscode-vibrancy-continued');
    let configPathToUse;

    if (fsSync.existsSync(altConfigPath)) {
        configPathToUse = altConfigPath;
    } else {
        const envPaths = (await import('env-paths')).default;
        const paths = envPaths('vscode-vibrancy-continued');
        configPathToUse = path.join(paths.config, 'config.json');
    }

    function loadConfig() {
        if (configPathToUse) {
            return JSON.parse(fsSync.readFileSync(configPathToUse, 'utf-8'));
        }
        return null;
    }

    async function uninstallJS(jsFilePath, electronJsFilePath) {
        const JS = await fs.readFile(jsFilePath, 'utf-8');
        const needClean = /\n\/\* !! VSCODE-VIBRANCY-START !! \*\/[\s\S]*?\/\* !! VSCODE-VIBRANCY-END !! \*\//.test(JS);
        if (needClean) {
            const newJS = JS.replace(/\n\/\* !! VSCODE-VIBRANCY-START !! \*\/[\s\S]*?\/\* !! VSCODE-VIBRANCY-END !! \*\//, '');
            await fs.writeFile(jsFilePath, newJS, 'utf-8');
        }

        const ElectronJS = await fs.readFile(electronJsFilePath, 'utf-8');
        const newElectronJS = ElectronJS
            .replace(/frame:false,transparent:true,experimentalDarkMode/g, 'experimentalDarkMode')
            .replace(/visualEffectState:"active",experimentalDarkMode/g, 'experimentalDarkMode');
        await fs.writeFile(electronJsFilePath, newElectronJS, 'utf-8');
    }

    async function uninstallHTML(htmlFilePath) {
        const HTML = await fs.readFile(htmlFilePath, 'utf-8');
        const needClean = /trusted-types VscodeVibrancy/.test(HTML);
        if (needClean) {
            const newHTML = HTML.replace(/trusted-types VscodeVibrancy(\r\n|\r|\n)/, "trusted-types$1");
            await fs.writeFile(htmlFilePath, newHTML, 'utf-8');
        }
    }

    function showNotification(message) {
        const escapedMessage = message.replace(/'/g, "\\'").replace(/"/g, '\\"');

        if (process.platform === 'win32') {
            const js = `javascript:var sh=new ActiveXObject('WScript.Shell'); sh.Popup('${escapedMessage}', 0, 'Alert', 64); close()`;
            const child = spawn('mshta', [js], {
                detached: true,
                stdio: 'ignore'
            });
            child.unref();
        } else if (process.platform === 'darwin') {
            exec(`osascript -e 'display alert "Notification" message "${escapedMessage}" as critical'`);
        } else {
            exec(`zenity --info --title="Notification" --text="${escapedMessage}"`);
        }
    }

    const config = loadConfig();
    if (config) {
        const { workbenchHtmlPath, jsPath, electronJsPath, previousCustomizations } = config;

        await uninstallJS(jsPath, electronJsPath);
        await uninstallHTML(workbenchHtmlPath);
        restorePreviousSettings(previousCustomizations);

        showNotification("Vibrancy Continued has been removed. Please restart VSCode to apply changes.");
    }
})();