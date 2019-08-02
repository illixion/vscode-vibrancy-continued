var vscode = require('vscode');
var fs = require('mz/fs');
var os = require('os');
var path = require('path');
var msg = require('./messages').messages;
var lockPath = path.join(__dirname, '../firstload.lock');

var isWin = /^win/.test(process.platform);
var isWin10 = isWin && os.release().split(".").map(Number)[0] === 10;

var themeStylePaths = {
	'Default Dark': '../themes/Default Dark.css',
	'Dark (Only Subbar)': '../themes/Dark (Only Subbar).css'
}

var defaultTheme = 'Default Dark';

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

function injectHTML(config) {
	var type = config.type;
	if (type === 'auto') {
		type = isWin10 ? 'acrylic' : 'dwm';
	}
	var enableBackground = isWin && type == 'dwm'; path.join(__dirname, '../themes/default.css')
	var currentTheme = config.theme in themeStylePaths ? config.theme : defaultTheme;

	const HTML = [
		`
		<style>
			html {
				background: ${enableBackground ? `rgba(30,30,30,${config.opacity})` : 'transparent'} !important;
			}
		</style>
		`,
		config.imports.map(function (x) {
			if (!x) return;
			if (typeof x === 'string') {
				x = x.replace('%theme-style%', path.join(__dirname, themeStylePaths[currentTheme]));
				if (/^.*\.js$/.test(x)) return '<script src="file://' + x + '"></script>';
				if (/^.*\.css$/.test(x)) return '<link rel="stylesheet" href="file://' + x + '"/>';
			}
		})
	]

	return HTML.join('')
}

function injectJS(config) {
	var type = config.type;
	if (type === 'auto') {
		type = isWin10 ? 'acrylic' : 'dwm';
	}
	return `
	const electron = require('electron');

  electron.app.on('browser-window-created', (event, window) => {
    window.webContents.on('dom-ready', () => {
      window.setBackgroundColor('#00000000');

      ${isWin ? 
				`require("child_process")
					.spawn(${JSON.stringify(__dirname + '\\blur-cli.exe')}, [new Uint32Array(window.getNativeWindowHandle().buffer)[0], '--type', ${JSON.stringify(type)}, '--enable', 'true', '--opacity', ${JSON.stringify(config.opacity)}]);` :
				`window.setVibrancy('ultra-dark');`
			}
      // hack
      const width = window.getBounds().width;
      window.setBounds({
          width: width + 1,
      });
      window.setBounds({
          width,
      });

      window.webContents.executeJavaScript(${JSON.stringify("document.body.innerHTML += " + JSON.stringify(injectHTML(config)))})
    });
  })
	`
}

function activate(context) {
	console.log('vscode-vibrancy is active!');

	process.on('uncaughtException', function (err) {
		if (/ENOENT|EACCES|EPERM/.test(err.code)) {
			vscode.window.showInformationMessage(msg.admin);
			return;
		}
	});

	var isWin = /^win/.test(process.platform);
	var appDir = path.dirname(require.main.filename);

	var HTMLFile = appDir + (isWin ? '\\vs\\code\\electron-browser\\workbench\\workbench.html' : '/vs/code/electron-browser/workbench/workbench.html');
	var JSFile = appDir + (isWin ? '\\main.js' : '/main.js');

	async function installJS() {
		const JS = await fs.readFile(JSFile, 'utf-8');
		const newJS = JS.replace(/\/\* !! VSCODE-VIBRANCY-START !! \*\/[\s\S]*?\/\* !! VSCODE-VIBRANCY-END !! \*\//, '')
			+ '\n/* !! VSCODE-VIBRANCY-START !! */\n(function(){' + injectJS(vscode.workspace.getConfiguration("vscode_vibrancy")) + '})()\n/* !! VSCODE-VIBRANCY-END !! */\n';
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
		vscode.window.showInformationMessage(msg.enabled, { title: msg.okIde });
	}

	function disabledRestart() {
		vscode.window.showInformationMessage(msg.disabled, { title: msg.okIde });
	}

	// ####  main commands ######################################################

	async function Install(autoreload) {
		try {
			await fs.stat(JSFile);
		} catch (error) {
			vscode.window.showInformationMessage(msg.smthingwrong + error);
			throw error;
		}

		try {
			await installJS();
		} catch (error) {
			vscode.window.showInformationMessage(msg.admin);
			throw error;
		}
	}

	async function Uninstall() {
		try {
			await fs.stat(JSFile);
			await fs.stat(HTMLFile);
		} catch(error) {
			vscode.window.showInformationMessage(msg.smthingwrong + error);
			throw error;
		}
		
		try {
			await uninstallHTML();
			await uninstallJS();
		} catch(error) {
			vscode.window.showInformationMessage(msg.admin);
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
		vscode.window.showInformationMessage(msg.firstload, { title: msg.installIde })
			.then(async (msg) => {
				if (msg) {
					await Update();
					enabledRestart();
				}
			});
		lockFirstload();
	}

	var lastConfig = vscode.workspace.getConfiguration("vscode_vibrancy");

	vscode.workspace.onDidChangeConfiguration(() => {
		if (!deepEqual(lastConfig, vscode.workspace.getConfiguration("vscode_vibrancy"))) {
			vscode.window.showInformationMessage(msg.configupdate, { title: msg.reloadIde })
				.then(async (msg) => {
					if (msg) {
						await Update();
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
