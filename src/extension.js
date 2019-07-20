var vscode = require('vscode');
var fs = require('fs');
var os = require('os');
var path = require('path');
var events = require('events');
var msg = require('./messages').messages;
var lockPath = path.join(__dirname, '../firstload.lock');

var isWin = /^win/.test(process.platform);
var isWin10 = isWin && os.release().split(".").map(Number)[0] === 10;

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
	var enableBackground = isWin && type == 'dwm';

	return `
	<script>
	w = nodeRequire('electron')
   .remote
   .getCurrentWindow();

	w.setBackgroundColor('#00000000');

	${isWin ? 
		`nodeRequire("child_process")
			.spawn(${JSON.stringify(__dirname + '\\blur-cli.exe')}, [new Uint32Array(w.getNativeWindowHandle().buffer)[0], '--type', ${JSON.stringify(type)}, '--enable', 'true', '--opacity', ${JSON.stringify(config.opacity)}]);` :
		`w.setVibrancy('ultra-dark');`
	}
	
	// hack
	const width = w.getBounds().width;
	w.setBounds({
			width: width + 1,
	});
	w.setBounds({
			width,
	});

	</script>

	<style>
	html {
		background: ${enableBackground ? `rgba(30,30,30,${config.opacity})` : 'transparent'} !important;
	}
	
	.scroll-decoration {
		box-shadow: none !important;
	}
	
	.minimap, .editor-scrollable>.decorationsOverviewRuler {
		opacity: 0.6;
	}
	
	.editor-container {
		background: transparent !important;
	}
	
	.search-view .search-widget .input-box, .search-view .search-widget .input-box .monaco-inputbox,
	.monaco-workbench>.part.editor>.content>.one-editor-silo>.container>.title .tabs-container>.tab,
	.monaco-editor-background,
	.monaco-editor .margin,
	.monaco-workbench>.part>.content,
	.monaco-workbench>.editor>.content>.one-editor-silo.editor-one,
	.monaco-workbench>.part.editor>.content>.one-editor-silo>.container>.title,
	.monaco-workbench>.part>.title,
	.monaco-workbench,
	.monaco-workbench>.part,
	body {
		background: transparent !important;
	}
	
	.editor-group-container>.tabs {
		background-color: transparent !important;
	}
	
	.editor-group-container>.tabs .tab {
		background-color: transparent !important;
	}
	
	.editor-group-container>.tabs .tab.active, .editor-group-container>.tabs .monaco-breadcrumbs {
		background-color: rgba(37, 37, 37,0.3) !important;
	}
	
	.monaco-list.settings-toc-tree .monaco-list-row.focused {
		outline-color: rgb(37, 37, 37,0.6) !important;
	}
	
	.monaco-list.settings-toc-tree .monaco-list-row.selected,
	.monaco-list.settings-toc-tree .monaco-list-row.focused,
	.monaco-list .monaco-list-row.selected,
	.monaco-list.settings-toc-tree:not(.drop-target) .monaco-list-row:hover:not(.selected):not(.focused) {
		background-color: rgb(37, 37, 37,0.6) !important;
	}
	
	.monaco-list.settings-editor-tree .monaco-list-row {
		background-color: transparent !important;
		outline-color: transparent !important;
	}
	
	.monaco-inputbox {
		background-color: rgba(41, 41, 41,0.2) !important;
	}
	
	.monaco-editor .selected-text {
		background-color: rgba(58, 61, 65,0.6) !important;
	}
	
	.monaco-editor .focused .selected-text {
		background-color: rgba(38, 79, 120,0.6) !important;
	}
	
	.monaco-editor .view-overlays .current-line {
		border-color: rgba(41, 41, 41,0.2) !important;
	}
	
	.extension-editor,
	.monaco-workbench>.part.editor>.content>.one-editor-silo>.container>.title .tabs-container>.tab.active,
	.preferences-editor>.preferences-header,
	.preferences-editor>.preferences-editors-container.side-by-side-preferences-editor .preferences-header-container,
	.monaco-editor, .monaco-editor .inputarea.ime-input {
		background: transparent !important;
	}

	
	.monaco-workbench>.part.sidebar {
		background-color: rgba(37, 37, 38, 0.3) !important;
	}
	
	
	.editor-group-container>.tabs .tab {
		border: none !important;
	}
	</style>
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

	var eventEmitter = new events.EventEmitter();
	var isWin = /^win/.test(process.platform);
	var appDir = path.dirname(require.main.filename);

	var base = appDir + (isWin ? '\\vs\\code' : '/vs/code');

	var htmlFile = base + (isWin ? '\\electron-browser\\workbench\\workbench.html' : '/electron-browser/workbench/workbench.html');
	var htmlFileBack = base + (isWin ? '\\electron-browser\\workbench\\workbench.html.bak-vibrancy' : '/electron-browser/workbench/workbench.bak-vibrancy');

	function replaceCss() {
		try {
			var html = fs.readFileSync(htmlFile, 'utf-8');
			html = html.replace(/<!-- !! VSCODE-VIBRANCY-START !! -->[\s\S]*?<!-- !! VSCODE-VIBRANCY-END !! -->/, '');

			html = html.replace(/<meta.*http-equiv="Content-Security-Policy".*>/, '');

			html = html.replace(/(<\/html>)/,
				'<!-- !! VSCODE-VIBRANCY-START !! -->' + injectHTML(vscode.workspace.getConfiguration("vscode_vibrancy")) + '<!-- !! VSCODE-VIBRANCY-END !! --></html>');
			fs.writeFileSync(htmlFile, html, 'utf-8');
		} catch (e) {
			console.log(e);
		}
	}

	function timeDiff(d1, d2) {
		var timeDiff = Math.abs(d2.getTime() - d1.getTime());
		return timeDiff;
	}

	function hasBeenUpdated(stats1, stats2) {
		var dbak = new Date(stats1.ctime);
		var dor = new Date(stats2.ctime);
		var segs = timeDiff(dbak, dor) / 1000;
		return segs > 60;
	}

	function cleanCssInstall() {
		var c = fs.createReadStream(htmlFile).pipe(fs.createWriteStream(htmlFileBack));
		c.on('finish', function () {
			replaceCss();
		});
	}

	function installItem(bakfile, orfile, cleanInstallFunc) {
		fs.stat(bakfile, function (errBak, statsBak) {
			console.log(errBak, statsBak)
			if (errBak) {
				// clean installation
				cleanInstallFunc();
			} else {
				// check htmlFileBack's timestamp and compare it to the htmlFile's.
				fs.stat(orfile, function (errOr, statsOr) {
					if (errOr) {
						vscode.window.showInformationMessage(msg.smthingwrong + errOr);
					} else {
						var updated = hasBeenUpdated(statsBak, statsOr);
						if (updated) {
							// some update has occurred. clean install
							cleanInstallFunc();
						}
					}
				});
			}
		});
	}

	function emitEndUninstall() {
		eventEmitter.emit('endUninstall');
	}

	function restoredAction(isRestored, willReinstall) {
		if (isRestored >= 1) {
			if (willReinstall) {
				emitEndUninstall();
			} else {
				disabledRestart();
			}
		}
	}

	function restoreBak(willReinstall) {
		var restore = 0;
		fs.unlink(htmlFile, function (err) {
			if (err) {
				vscode.window.showInformationMessage(msg.admin);
				return;
			}
			var c = fs.createReadStream(htmlFileBack).pipe(fs.createWriteStream(htmlFile));
			c.on('finish', function () {
				fs.unlinkSync(htmlFileBack);
				restore++;
				restoredAction(restore, willReinstall);
			});
		});
	}

	function reloadWindow() {
		// reload vscode-window
		vscode.commands.executeCommand("workbench.action.reloadWindow");
	}

	function enabledRestart() {
		vscode.window.showInformationMessage(msg.enabled, { title: msg.restartIde })
			.then(function (msg) {
				reloadWindow();
			});
	}
	function disabledRestart() {
		vscode.window.showInformationMessage(msg.disabled, { title: msg.restartIde })
			.then(function (msg) {
				reloadWindow();
			});
	}

	// ####  main commands ######################################################

	function fInstall(autoreload) {
		installItem(htmlFileBack, htmlFile, cleanCssInstall);
		if (autoreload)
			reloadWindow();
		else
			enabledRestart();
	}

	function fUninstall(willReinstall) {
		fs.stat(htmlFileBack, function (errBak, statsBak) {
			if (errBak) {
				if (willReinstall) {
					emitEndUninstall();
				}
				return;
			}
			fs.stat(htmlFile, function (errOr, statsOr) {
				if (errOr) {
					vscode.window.showInformationMessage(msg.smthingwrong + errOr);
				} else {
					restoreBak(willReinstall);
				}
			});
		});
	}

	function fUpdate() {
		eventEmitter.once('endUninstall', fInstall);
		fUninstall(true);
	}

	var installVibrancy = vscode.commands.registerCommand('extension.installVibrancy', fInstall);
	var uninstallVibrancy = vscode.commands.registerCommand('extension.uninstallVibrancy', fUninstall);
	var updateVibrancy = vscode.commands.registerCommand('extension.updateVibrancy', fUpdate);

	context.subscriptions.push(installVibrancy);
	context.subscriptions.push(uninstallVibrancy);
	context.subscriptions.push(updateVibrancy);

	if (isFirstload()) {
		vscode.window.showInformationMessage(msg.firstload, { title: msg.installIde })
			.then(function (msg) {
				eventEmitter.once('endUninstall', () => fInstall(true));
				fUninstall(true);
			});
		lockFirstload();
	}

	var lastConfig = vscode.workspace.getConfiguration("vscode_vibrancy");

	vscode.workspace.onDidChangeConfiguration(() => {
		if (!deepEqual(lastConfig, vscode.workspace.getConfiguration("vscode_vibrancy"))) {
			vscode.window.showInformationMessage(msg.configupdate, { title: msg.reloadIde })
				.then(function () {
					eventEmitter.once('endUninstall', () => fInstall(true));
					fUninstall(true);
				});
			lockFirstload();
		}
	});
}
exports.activate = activate;

// this method is called when your extension is deactivated
function deactivate() { }
exports.deactivate = deactivate;
