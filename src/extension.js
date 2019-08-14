var vscode = require('vscode');
var fs = require('mz/fs');
var path = require('path');
var lockPath = path.join(__dirname, '../firstload.lock');

const i18nMessages = {
	'en': JSON.parse(fs.readFileSync(path.join(__dirname, 'extension.nls.json'))),
	'zh-cn': JSON.parse(fs.readFileSync(path.join(__dirname, 'extension.nls.zh-CN.json')))
};
const defaultLocale = 'en';
const locale = (vscode.env.language || defaultLocale).toLowerCase();
const localize = (info) => {
	if (locale in i18nMessages && info in i18nMessages[locale]) {
		return i18nMessages[locale][info]
	} else {
		return i18nMessages[defaultLocale][info]
	}
}

let os = 'macos';
if (/^win/.test(process.platform)) {
	if (require('os').release().split(".").map(Number)[0] === 10) {
		os = 'win10';
	} else {
		os = 'win7';
	}
}

var themeStylePaths = {
	'Default Dark': '../themes/Default Dark.css',
	'Dark (Only Subbar)': '../themes/Dark (Only Subbar).css',
	'Default Light': '../themes/Default Light.css',
}

const themeConfigPaths = {
	'Default Dark': '../themes/Default Dark.json',
	'Dark (Only Subbar)': '../themes/Dark (Only Subbar).json',
	'Default Light': '../themes/Default Light.json',
}

var defaultTheme = 'Default Dark';

function getCurrentTheme(config) {
	return config.theme in themeStylePaths ? config.theme : defaultTheme;
}

async function changeTerminalRendererType() {
	// This is a hacky way to display the restart prompt
	let v = vscode.workspace.getConfiguration().inspect("terminal.integrated.rendererType");
	if (v !== undefined) {
		if (!v.globalValue) {
			await vscode.workspace.getConfiguration().update("terminal.integrated.rendererType", "dom", vscode.ConfigurationTarget.Global);
		}
	}
}

async function promptRestart() {
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

	if(obj1 === obj2) // it's just the same object. No need to compare.
			return true;

	if(isPrimitive(obj1) && isPrimitive(obj2)) // compare primitives
			return obj1 === obj2;

	if(Object.keys(obj1).length !== Object.keys(obj2).length)
			return false;

	// compare objects with same number of keys
	for(let key in obj1)
	{
			if(!(key in obj2)) return false; //other object doesn't have this prop
			if(!deepEqual(obj1[key], obj2[key])) return false;
	}

	return true;
}

function hexToRgb(hex) {
  var result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  return result ? {
    r: parseInt(result[1], 16),
    g: parseInt(result[2], 16),
    b: parseInt(result[3], 16)
  } : null;
}

//check if value is primitive
function isPrimitive(obj)
{
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
	fs.writeFileSync(lockPath, '', () => {});
}

function injectHTML(config, currentTheme, themeConfig) {
	var type = config.type;
	if (type === 'auto') {
		type = themeConfig.type[os];
	}

	let opacity = config.opacity;

	if (opacity < 0) {
		opacity = themeConfig.opacity[os]
	}

	const backgroundRGB = hexToRgb(themeConfig.background);

	const HTML = [
		`
		<style>
			html {
				background: rgba(${backgroundRGB.r},${backgroundRGB.g},${backgroundRGB.b},${opacity}) !important;
			}
		</style>
		`,
		...config.imports.map(function (x) {
			if (!x) return;
			if (typeof x === 'string') {
				x = x.replace('%theme-style%', path.join(__dirname, themeStylePaths[currentTheme]));
				x = x.replace('$theme-style$', path.join(__dirname, themeStylePaths[currentTheme]));
				x = new URL(x, 'file://').href;

				if (!x.startsWith('file://')) {
					x = 'file://' + x;
				}
				
				if (/^.*\.js$/.test(x)) return '<script src="' + x + '"></script>';
				if (/^.*\.css$/.test(x)) return '<link rel="stylesheet" href="' + x + '"/>';
			}
		})
	]

	return HTML.join('')
}

const macosType = [
	"appearance-based",
	"light", 
	"dark", 
	"titlebar", 
	"selection", 
	"menu", 
	"popover", 
	"sidebar", 
	"medium-light", 
	"ultra-dark"
];

const windowsType = [
	"dwm",
	"acrylic"
];

function injectJS(config, currentTheme, themeConfig) {
	var type = config.type;
	if (type !== 'auto') {
		if (os === 'win10' || os === 'win7' && !windowsType.includes(type)) type = 'auto';
		if (os === 'macos' && !macosType.includes(type)) type = 'auto';
	}
	if (type === 'auto') {
		type = themeConfig.type[os];
	}

	let opacity = config.opacity;

	if (opacity < 0) {
		opacity = themeConfig.opacity[os]
	}
	
	return `
	const electron = require('electron');

  electron.app.on('browser-window-created', (event, window) => {
    window.webContents.on('dom-ready', () => {
      window.setBackgroundColor('#00000000');

      ${os !== 'macos' ? 
				`require("child_process")
					.spawn(${JSON.stringify(__dirname + '\\blur-cli.exe')}, [new Uint32Array(window.getNativeWindowHandle().buffer)[0], '--type', ${JSON.stringify(type)}, '--enable', 'true', '--color', '${themeConfig.background}', '--opacity', ${JSON.stringify(opacity)}]);` :
				`window.setVibrancy(${JSON.stringify(type)});`
			}
			
      // hack
      const width = window.getBounds().width;
      window.setBounds({
          width: width + 1,
      });
      window.setBounds({
          width,
      });

      window.webContents.executeJavaScript(${JSON.stringify("document.body.innerHTML += " + JSON.stringify(injectHTML(config, currentTheme, themeConfig)))})
    });
  })
	`
}

function activate(context) {
	console.log('vscode-vibrancy is active!');

	process.on('uncaughtException', function (err) {
		if (/ENOENT|EACCES|EPERM/.test(err.code)) {
			vscode.window.showInformationMessage(localize('messages.admin'));
			return;
		}
	});

	var isWin = /^win/.test(process.platform);
	var appDir = path.dirname(require.main.filename);

	var HTMLFile = appDir + (isWin ? '\\vs\\code\\electron-browser\\workbench\\workbench.html' : '/vs/code/electron-browser/workbench/workbench.html');
	var JSFile = appDir + (isWin ? '\\main.js' : '/main.js');

	async function installJS() {
		const config = vscode.workspace.getConfiguration("vscode_vibrancy");
		const currentTheme = getCurrentTheme(config);
		const themeConfig = require(path.join(__dirname, themeConfigPaths[currentTheme]));

		const JS = await fs.readFile(JSFile, 'utf-8');
		const newJS = JS.replace(/\/\* !! VSCODE-VIBRANCY-START !! \*\/[\s\S]*?\/\* !! VSCODE-VIBRANCY-END !! \*\//, '')
			+ '\n/* !! VSCODE-VIBRANCY-START !! */\n(function(){' + injectJS(config, currentTheme, themeConfig) + '})()\n/* !! VSCODE-VIBRANCY-END !! */\n';
		await fs.writeFile(JSFile, newJS, 'utf-8');
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
				.replace(/<meta.*http-equiv="Content-Security-Policy".*>/, '');
			await fs.writeFile(HTMLFile, newHTML, 'utf-8');
		}
	}

	function enabledRestart() {
		vscode.window.showInformationMessage(localize('messages.enabled'), { title: localize('messages.reloadIde') })
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

	async function Install(autoreload) {
		try {
			await fs.stat(JSFile);
			await changeTerminalRendererType()
		} catch (error) {
			vscode.window.showInformationMessage(localize('messages.smthingwrong') + error);
			throw error;
		}

		try {
			await installJS();
		} catch (error) {
			vscode.window.showInformationMessage(localize('messages.admin'));
			throw error;
		}
	}

	async function Uninstall() {
		try {
			await fs.stat(JSFile);
			await fs.stat(HTMLFile);
		} catch(error) {
			vscode.window.showInformationMessage(localize('messages.smthingwrong') + error);
			throw error;
		}
		
		try {
			await uninstallHTML();
			await uninstallJS();
		} catch(error) {
			vscode.window.showInformationMessage(localize('messages.admin'));
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
		if (!deepEqual(lastConfig, vscode.workspace.getConfiguration("vscode_vibrancy"))) {
			vscode.window.showInformationMessage(localize('messages.configupdate'), { title: localize('messages.reloadIde') })
				.then(async (msg) => {
					if (msg) {
						await Update();
						if (lastConfig.theme !== vscode.workspace.getConfiguration("vscode_vibrancy")) {
							await checkColorTheme();
						}
						promptRestart();
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
