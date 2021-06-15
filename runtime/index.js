const electron = require('electron');

/**
 * @type {{ os: string, config: any, themeCSS: string, theme: any }}
 */
const app = global.vscode_vibrancy_plugin;

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
	"acrylic"
];

function hexToRgb(hex) {
	var result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
	return result ? {
		r: parseInt(result[1], 16),
		g: parseInt(result[2], 16),
		b: parseInt(result[3], 16)
	} : null;
}

electron.app.on('browser-window-created', (_, window) => {
	var type = app.config.type;
	if (type !== 'auto') {
		if (app.os === 'win10' && !windowsType.includes(type)) type = 'auto';
		if (app.os === 'macos' && !macosType.includes(type)) type = 'auto';
	}
	if (type === 'auto') {
		type = app.theme.type[app.os];
	}

	let opacity = app.config.opacity;
	// if opacity < 0, use the theme default opacity
	if (opacity < 0) {
		opacity = app.theme.opacity[app.os]
	}

	const backgroundRGB = hexToRgb(app.theme.background);

	if (app.os === 'win10') {
		const bindings = require('./vibrancy.js');
		bindings.setVibrancy(window.getNativeWindowHandle().readInt32LE(0), 1, backgroundRGB.r, backgroundRGB.g, backgroundRGB.b, 0);
		const win10refresh = require('./win10refresh.js');
		win10refresh(window, 60);

		window.webContents.once('dom-ready', () => {
			const currentURL = window.webContents.getURL();

			if (!(currentURL.includes('workbench.html') || currentURL.includes('workbench-monkey-patch.html'))) {
				return;
			}

			if (window.isMaximized()) {
				window.unmaximize();
				window.maximize();
			}
		});
	}

	let backgroundColorTimer;
	window.on('closed', () => {
		clearInterval(backgroundColorTimer);
	})

	window.webContents.on('dom-ready', () => {
		const currentURL = window.webContents.getURL();

		if (!(currentURL.includes('workbench.html') || currentURL.includes('workbench-monkey-patch.html'))) {
			return;
		}

		window.setBackgroundColor('#00000000');

		clearInterval(backgroundColorTimer);
		// https://github.com/microsoft/vscode/blob/9f8431f7fccf7a048531043eb6b6d24819482781/src/vs/platform/theme/electron-main/themeMainService.ts#L80
		backgroundColorTimer = setInterval(() => {
			window.setBackgroundColor('#00000000');
		}, 1000);

		if (app.os === 'macos') {
			window.setVibrancy(type);

			// hack
			const width = window.getBounds().width;
			window.setBounds({
				width: width + 1,
			});
			window.setBounds({
				width,
			});
		}

		injectHTML(window);
	});
});

function injectHTML(window) {
	window.webContents.executeJavaScript(`(function(){
		const vscodeVibrancyTTP = window.trustedTypes.createPolicy("VscodeVibrancy", { createHTML (v) { return v; }});

		document.getElementById("vscode-vibrancy-style")?.remove();
		const styleElement = document.createElement("div");
		styleElement.id = "vscode-vibrancy-style";
		styleElement.innerHTML = vscodeVibrancyTTP.createHTML(${JSON.stringify(styleHTML())});
		document.body.appendChild(styleElement);

		document.getElementById("vscode-vibrancy-script")?.remove();
		const scriptElement = document.createElement("div");
		scriptElement.id = "vscode-vibrancy-script";
		scriptElement.innerHTML = vscodeVibrancyTTP.createHTML(${JSON.stringify(scriptHTML())});
		document.body.appendChild(scriptElement);
	})();`);
}

const customImports = {
	js: [],
	css: []
}

app.config.imports.forEach(function (x) {
	if (typeof x === 'string') {
		x = new URL(x, 'file://').href;

		if (!x.startsWith('file://')) {
			x = 'file://' + x;
		}

		if (/^.*\.js$/.test(x)) customImports.js.push('<script src="' + x + '"></script>');
		if (/^.*\.css$/.test(x)) customImports.css.push('<link rel="stylesheet" href="' + x + '"/>');
	}
})

function scriptHTML() {
	return customImports.js.join('')
}

function styleHTML() {
	if (app.os === 'unknown') return '';

	var type = app.config.type;
	if (type === 'auto') {
		type = app.theme.type[app.os];
	}

	let opacity = app.config.opacity;

	if (opacity < 0) {
		opacity = app.theme.opacity[app.os]
	}

	const backgroundRGB = hexToRgb(app.theme.background);

	const HTML = [
		`
		<style>
			html {
				background: rgba(${backgroundRGB.r},${backgroundRGB.g},${backgroundRGB.b},${opacity}) !important;
			}
		</style>
    `,
		`
    <style>
      ${app.themeCSS}
    </style>
    `,
		...customImports.css
	]

	return HTML.join('')
}
