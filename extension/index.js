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
	'Dark (Only Subbar)': '../themes/Dark (Only Subbar).css',
	'Default Light': '../themes/Default Light.css',
	'Light (Only Subbar)': '../themes/Light (Only Subbar).css',
}

const themeConfigPaths = {
	'Default Dark': '../themes/Default Dark.json',
	'Dark (Only Subbar)': '../themes/Dark (Only Subbar).json',
	'Default Light': '../themes/Default Light.json',
	'Light (Only Subbar)': '../themes/Light (Only Subbar).json',
}

var defaultTheme = 'Default Dark';

function getCurrentTheme(config) {
	return config.theme in themeStylePaths ? config.theme : defaultTheme;
}

async function changeTerminalRendererType() {
	let v = vscode.workspace.getConfiguration().inspect("terminal.integrated.gpuAcceleration");
	if (v !== undefined) {
		if (!v.globalValue) {
			await vscode.workspace.getConfiguration().update("terminal.integrated.gpuAcceleration", "off", vscode.ConfigurationTarget.Global);
		}
	}
}

async function promptRestart() {
	// This is a hacky way to display the restart prompt
	let v = vscode.workspace.getConfiguration().inspect("window.titleBarStyle");
	if (v !== undefined) {
		let value = vscode.workspace.getConfiguration().get("window.titleBarStyle");
		await vscode.workspace.getConfiguration().update("window.titleBarStyle", value === "native" ? "custom" : "native", vscode.ConfigurationTarget.Global);
		vscode.workspace.getConfiguration().update("window.titleBarStyle", v.globalValue, vscode.ConfigurationTarget.Global);
	}
}

async function checkColorTheme() {
	const currentTheme = getCurrentTheme(vscode.workspace.getConfiguration("vscode_vibrancy"));
	const themeConfig = require(path.join(__dirname, themeConfigPaths[currentTheme]));
	const target = themeConfig.colorTheme;
	const currentColorTheme = vscode.workspace.getConfiguration().get("workbench.colorTheme");
	if (target !== currentColorTheme) {
		const message = localize('messages.recommendedColorTheme').replace('%1', currentColorTheme).replace('%2', target);
		await vscode.window.showInformationMessage(message, localize('messages.changeColorThemeIde'), localize('messages.noIde'))
			.then(async (msg) => {
				if (msg === localize('messages.changeColorThemeIde')) {
					await vscode.workspace.getConfiguration().update("workbench.colorTheme", target, vscode.ConfigurationTarget.Global);
				}
			});
	}
}

function deepEqual(obj1, obj2) {

	if (obj1 === obj2) // it's just the same object. No need to compare.
		return true;

	if (isPrimitive(obj1) && isPrimitive(obj2)) // compare primitives
		return obj1 === obj2;

	if (Object.keys(obj1).length !== Object.keys(obj2).length)
		return false;

	// compare objects with same number of keys
	for (let key in obj1) {
		if (!(key in obj2)) return false; //other object doesn't have this prop
		if (!deepEqual(obj1[key], obj2[key])) return false;
	}

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

	var HTMLFile = appDir + '/vs/code/electron-browser/workbench/workbench.html';
	var JSFile = appDir + '/main.js';

	var runtimeVersion = 'v6';
	var runtimeDir = appDir + '/vscode-vibrancy-runtime-' + runtimeVersion;

	async function installRuntime() {
		if (fs.existsSync(runtimeDir)) return;

		await fs.mkdir(runtimeDir);
		await fsExtra.copy(path.resolve(__dirname, '../runtime'), path.resolve(runtimeDir));
	}

	async function installJS() {
		const config = vscode.workspace.getConfiguration("vscode_vibrancy");
		const currentTheme = getCurrentTheme(config);
		const themeConfig = require(path.resolve(__dirname, themeConfigPaths[currentTheme]));
		const themeCSS = await fs.readFile(path.join(__dirname, themeStylePaths[currentTheme]), 'utf-8');

		const JS = await fs.readFile(JSFile, 'utf-8');

		const injectData = {
			os: os,
			config: config,
			theme: themeConfig,
			themeCSS: themeCSS
		}

		const base = __filename;

		const newJS = JS.replace(/\/\* !! VSCODE-VIBRANCY-START !! \*\/[\s\S]*?\/\* !! VSCODE-VIBRANCY-END !! \*\//, '')
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
		const needClean = /\/\* !! VSCODE-VIBRANCY-START !! \*\/[\s\S]*?\/\* !! VSCODE-VIBRANCY-END !! \*\//.test(JS);
		if (needClean) {
			const newJS = JS
				.replace(/\/\* !! VSCODE-VIBRANCY-START !! \*\/[\s\S]*?\/\* !! VSCODE-VIBRANCY-END !! \*\//, '')
			await fs.writeFile(JSFile, newJS, 'utf-8');
		}
	}

	async function uninstallHTML() {
		const HTML = await fs.readFile(HTMLFile, 'utf-8');
		const needClean = /<!-- !! VSCODE-VIBRANCY-START !! -->[\s\S]*?<!-- !! VSCODE-VIBRANCY-END !! -->/.test(HTML);
		if (needClean) {
			const newHTML = HTML
				.replace(/<!-- !! VSCODE-VIBRANCY-START !! -->[\s\S]*?<!-- !! VSCODE-VIBRANCY-END !! -->/, '')
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
