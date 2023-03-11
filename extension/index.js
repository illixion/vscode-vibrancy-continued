var vscode = require('vscode');
var fs = require('mz/fs');
var fsExtra = require('fs-extra');
var path = require('path');
var lockPath = path.join(__dirname, '../firstload.lock');

/**
 * @type {(info: string) => string}
 */
const localize = require('./i18n');

/**
 * @type {'unknown' | 'win10' | 'macos'}
 */
const os = require('./platform');

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
}

var defaultTheme = 'Default Dark';

function getCurrentTheme(config) {
  return config.theme in themeStylePaths ? config.theme : defaultTheme;
}

async function changeTerminalRendererType() {
  // Check if "terminal.integrated.gpuAcceleration" has a global value
  const terminalConfig = vscode.workspace.getConfiguration().inspect("terminal.integrated.gpuAcceleration");

  if (terminalConfig?.globalValue === undefined) {
    return;
  }

  // If "terminal.integrated.gpuAcceleration" is not enabled, disable it
  if (!terminalConfig.globalValue) {
    await vscode.workspace.getConfiguration().update("terminal.integrated.gpuAcceleration", "off", vscode.ConfigurationTarget.Global);
  }
}

async function changeNativeWindowControls() {
  // Check if "window.experimental.windowControlsOverlay.enabled" has a global value
  const windowNativeControlsConfig = vscode.workspace.getConfiguration().inspect("window.experimental.windowControlsOverlay.enabled");

  if (windowNativeControlsConfig?.globalValue === undefined) {
    return;
  }

  // If "window.experimental.windowControlsOverlay.enabled" is enabled, disable it
  if (!windowNativeControlsConfig.globalValue) {
    await vscode.workspace.getConfiguration().update("window.experimental.windowControlsOverlay.enabled", false, vscode.ConfigurationTarget.Global);
  }
}

async function promptRestart() {
  // Store the current value of "window.titleBarStyle"
  const titleBarStyle = vscode.workspace.getConfiguration().get("window.titleBarStyle");

  // Toggle the value of "window.titleBarStyle" to prompt for a restart
  await vscode.workspace.getConfiguration().update("window.titleBarStyle", titleBarStyle === "native" ? "custom" : "native", vscode.ConfigurationTarget.Global);

  // Reset the value of "window.titleBarStyle" to its original value
  await vscode.workspace.getConfiguration().update("window.titleBarStyle", titleBarStyle, vscode.ConfigurationTarget.Global);
}

async function checkColorTheme() {
  // Get the current color theme and target theme from configuration files
  const currentTheme = getCurrentTheme(vscode.workspace.getConfiguration("vscode_vibrancy"));
  const themeConfig = require(path.join(__dirname, themeConfigPaths[currentTheme]));
  const targetTheme = themeConfig.colorTheme;
  const currentColorTheme = vscode.workspace.getConfiguration().get("workbench.colorTheme");

  // Show a message to the user if the current color theme doesn't match the target theme
  if (targetTheme !== currentColorTheme) {
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

function deepEqual(obj1, obj2) {
  if (obj1 === obj2) {
    // Objects are the same
    return true;
  }

  if (isPrimitive(obj1) && isPrimitive(obj2)) {
    // Compare primitive values
    return obj1 === obj2;
  }

  if (Object.keys(obj1).length !== Object.keys(obj2).length) {
    // Objects have different number of properties
    return false;
  }

  // Compare objects with the same number of properties
  for (const key in obj1) {
    if (!(key in obj2)) {
      // Other object doesn't have this property
      return false;
    }

    if (!deepEqual(obj1[key], obj2[key])) {
      // Properties are not equal
      return false;
    }
  }

  // Objects are equal
  return true;
}

//check if value is primitive
function isPrimitive(obj) {
  return (obj !== Object(obj));
}

function isFirstload() {
  try {
    fs.readFileSync(lockPath);
    return false
  } catch (err) {
    return true
  }
}

function lockFirstload() {
  fs.writeFileSync(lockPath, '', () => { });
}

function activate(context) {
  console.log('vscode-vibrancy is active!');

  var appDir = path.dirname(require.main.filename);

  var HTMLFile = appDir + '/vs/code/electron-sandbox/workbench/workbench.html';
  var JSFile = appDir + '/main.js';

  var runtimeVersion = 'v6';
  var runtimeDir = appDir + '/vscode-vibrancy-runtime-' + runtimeVersion;

  async function installRuntime() {
    // if runtimeDir exists, recurse through it and delete all files
    // (recursive fs.rm does not work properly on Windows)
    if (fs.existsSync(runtimeDir)) {
      // fs.readdirSync(runtimeDir).forEach((file, index) => {
      //   const curPath = path.join(runtimeDir, file);
      //   fs.unlinkSync(curPath);
      // });
      fs.rmSync(runtimeDir, { recursive: true, force: true });
    }

    await fs.mkdir(runtimeDir);
    await fsExtra.copy(path.resolve(__dirname, '../runtime'), path.resolve(runtimeDir));
  }

  async function installJS() {
    const config = vscode.workspace.getConfiguration("vscode_vibrancy");
    const currentTheme = getCurrentTheme(config);
    const themeConfig = require(path.resolve(__dirname, themeConfigPaths[currentTheme]));
    const themeCSS = await fs.readFile(path.join(__dirname, themeStylePaths[currentTheme]), 'utf-8');

    const JS = await fs.readFile(JSFile, 'utf-8');

    // generate imports by reading all files in config.imports
    const imports = {
      css: "",
      js: "",
    };
    for (let i = 0; i < config.imports.length; i++) {
      if (config.imports[i] === "/path/to/file") continue;

      try {
        const importContent = await fs.readFile(config.imports[i], 'utf-8');

        if (config.imports[i].endsWith('.css')) {
          imports.css += `<style>${importContent}</style>`;
        } else {
          imports.js += `<script>${importContent}</script>`;
        }
      } catch (err) {
        vscode.window.showWarningMessage(localize('messages.importError').replace('%1', config.imports[i]));
      }
    }

    const injectData = {
      os: os,
      config: config,
      theme: themeConfig,
      themeCSS: themeCSS,
      imports: imports,
    }

    const base = __filename;

    const newJS = JS.replace(/\n\/\* !! VSCODE-VIBRANCY-START !! \*\/[\s\S]*?\/\* !! VSCODE-VIBRANCY-END !! \*\//, '')
      + '\n/* !! VSCODE-VIBRANCY-START !! */\n;(function(){\n'
      + `if (!require(\'fs\').existsSync(${JSON.stringify(base)})) return;\n`
      + `global.vscode_vibrancy_plugin = ${JSON.stringify(injectData)}; try{ require(${JSON.stringify(runtimeDir)}); } catch (err) {console.error(err)}\n`
      + '})()\n/* !! VSCODE-VIBRANCY-END !! */';
    await fs.writeFile(JSFile, newJS, 'utf-8');
  }

  async function installHTML() {
    const HTML = await fs.readFile(HTMLFile, 'utf-8');

    const newHTML = HTML.replace(
      /<meta http-equiv="Content-Security-Policy" content="require-trusted-types-for 'script'; trusted-types (.+);">/g,
      (_, trustedTypes) => {
        return `<meta http-equiv="Content-Security-Policy" content="require-trusted-types-for 'script';  trusted-types ${trustedTypes} VscodeVibrancy;">`;
      }
    );

    if (HTML !== newHTML) {
      await fs.writeFile(HTMLFile, newHTML, 'utf-8');
    }
  }

  async function uninstallJS() {
    const JS = await fs.readFile(JSFile, 'utf-8');
    const needClean = /\n\/\* !! VSCODE-VIBRANCY-START !! \*\/[\s\S]*?\/\* !! VSCODE-VIBRANCY-END !! \*\//.test(JS);
    if (needClean) {
      const newJS = JS
        .replace(/\n\/\* !! VSCODE-VIBRANCY-START !! \*\/[\s\S]*?\/\* !! VSCODE-VIBRANCY-END !! \*\//, '')
      await fs.writeFile(JSFile, newJS, 'utf-8');
    }
  }

  async function uninstallHTML() {
    const HTML = await fs.readFile(HTMLFile, 'utf-8');
    const needClean = / VscodeVibrancy;/.test(HTML);
    if (needClean) {
      const newHTML = HTML.replace(" VscodeVibrancy;", ";").replace(";  trusted-types", "; trusted-types")
      await fs.writeFile(HTMLFile, newHTML, 'utf-8');
    }
  }

  function enabledRestart() {
    vscode.window.showInformationMessage(localize('messages.enabled'), { title: localize('messages.restartIde') })
      .then(function (msg) {
        msg && promptRestart();
      });
  }

  function disabledRestart() {
    vscode.window.showInformationMessage(localize('messages.disabled'), { title: localize('messages.restartIde') })
      .then(function (msg) {
        msg && promptRestart();
      });
  }

  // ####  main commands ######################################################

  async function Install() {

    if (os === 'unknown') {
      vscode.window.showInformationMessage(localize('messages.unsupported'));
      throw new Error('unsupported');
    }

    try {
      await fs.stat(JSFile);
      await fs.stat(HTMLFile);

      await installRuntime();
      await installJS();
      await installHTML();
      await changeTerminalRendererType();
      await changeNativeWindowControls();
    } catch (error) {
      if (error && (error.code === 'EPERM' || error.code === 'EACCES')) {
        vscode.window.showInformationMessage(localize('messages.admin') + error);
      }
      else {
        vscode.window.showInformationMessage(localize('messages.smthingwrong') + error);
      }
      throw error;
    }
  }

  async function Uninstall() {
    try {
      // uninstall old version
      await fs.stat(HTMLFile);
      await uninstallHTML();
    } finally {

    }

    try {
      await fs.stat(JSFile);

      await uninstallJS();
    } catch (error) {
      if (error && (error.code === 'EPERM' || error.code === 'EACCES')) {
        vscode.window.showInformationMessage(localize('messages.admin') + error);
      }
      else {
        vscode.window.showInformationMessage(localize('messages.smthingwrong') + error);
      }
      throw error;
    }
  }

  async function Update() {
    await Uninstall();
    await Install();
  }

  var installVibrancy = vscode.commands.registerCommand('extension.installVibrancy', async () => {
    await Install();
    enabledRestart();
  });
  var uninstallVibrancy = vscode.commands.registerCommand('extension.uninstallVibrancy', async () => {
    await Uninstall()
    disabledRestart();
  });
  var updateVibrancy = vscode.commands.registerCommand('extension.updateVibrancy', async () => {
    await Update();
    enabledRestart();
  });

  context.subscriptions.push(installVibrancy);
  context.subscriptions.push(uninstallVibrancy);
  context.subscriptions.push(updateVibrancy);

  if (isFirstload()) {
    vscode.window.showInformationMessage(localize('messages.firstload'), { title: localize('messages.installIde') })
      .then(async (msg) => {
        if (msg) {
          await Update();
          await checkColorTheme();
          enabledRestart();
        }
      });
    lockFirstload();
  }

  var lastConfig = vscode.workspace.getConfiguration("vscode_vibrancy");

  vscode.workspace.onDidChangeConfiguration(() => {
    newConfig = vscode.workspace.getConfiguration("vscode_vibrancy");
    if (!deepEqual(lastConfig, newConfig)) {
      lastConfig = newConfig;
      vscode.window.showInformationMessage(localize('messages.configupdate'), { title: localize('messages.reloadIde') })
        .then(async (msg) => {
          if (msg) {
            await Update();
            if (newConfig.theme !== vscode.workspace.getConfiguration("vscode_vibrancy")) {
              await checkColorTheme();
            }
            enabledRestart();
          }
        });
      lockFirstload();
    }
  });
}
exports.activate = activate;

// this method is called when your extension is deactivated
function deactivate() { }
exports.deactivate = deactivate;
