const { spawn, exec } = require('child_process');
const fs = require('fs').promises; // Use fs.promises for Promise-based APIs
const fsSync = require('fs'); // Import standard fs for synchronous methods
const path = require('path');

(async () => {
    const envPaths = (await import('env-paths')).default;
    const paths = envPaths('vscode-vibrancy-continued');
    const configFilePath = path.join(paths.config, 'config.json');

    function loadConfig() {
        if (fsSync.existsSync(configFilePath)) {
            return JSON.parse(fsSync.readFileSync(configFilePath, 'utf-8'));
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
        const { workbenchHtmlPath, jsPath, electronJsPath } = config;

        await uninstallJS(jsPath, electronJsPath);
        await uninstallHTML(workbenchHtmlPath);

        showNotification("Vibrancy Continued has been removed. Please restart VSCode to apply changes.");
    }
})();