import electron from 'electron';
/**
 * @type {(window) => Record<'interval' | 'overwrite', {install: () => void, uninstall: () => void>}
 */
import transparencyMethods from './methods/index.mjs';

/**
 * @type {{
 *  os: string,
 *  config: {
 *    type:  "auto" | "acrylic" | "under-window" | "fullscreen-ui" | "titlebar" | "selection" | "menu" | "popover" | "sidebar" | "content" | "header" | "hud" | "sheet" | "tooltip" | "under-page" | "window" | "appearance-based" | "dark" | "ultra-dark" | "light" | "medium-light",
 *    opacity: number,
 *    theme: "Default Dark" | "Dark (Only Subbar)" | "Default Light" | "Light (Only Subbar)" | "Tokyo Night Storm" | "Tokyo Night Storm (Outer)" | "Noir et blanc" | "Dark (Exclude Tab Line)" | "Solarized Dark+",
 *    imports: string[],
 *    refreshInterval: number,
 *    preventFlash: boolean
 *  },
 *  themeCSS: string,
 *  theme: any,
 *  imports: {
 *    css: string,
 *    js: string
 *  }
 * }}
 */
const app = global.vscode_vibrancy_plugin;
// @ts-check

const macosType = [
  'under-window',
  'fullscreen-ui',
  'titlebar',
  'selection',
  'menu',
  'popover',
  'sidebar',
  'content',
  'header',
  'hud',
  'sheet',
  'tooltip',
  'under-page',
  'window',
  'appearance-based',
  'dark',
  'ultra-dark',
  'light',
  'medium-light'
];

const windowsType = ['acrylic'];

/**
 * @param {string} hex
 * @returns {{ r: any; g: any; b: any; } | null}
 */
function hexToRgb(hex) {
  var result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  return result
    ? {
      r: parseInt(result[1], 16),
      g: parseInt(result[2], 16),
      b: parseInt(result[3], 16),
    }
    : null;
}

electron.app.on('browser-window-created', (_, window) => {
  const methods = transparencyMethods(window);
  const hackMethod = app.config.preventFlash ? 'overwrite' : 'interval';
  const effects = methods[hackMethod];

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
    opacity = app.theme.opacity[app.os];
  }

  const backgroundRGB = hexToRgb(app.theme.background) || { r: 0, g: 0, b: 0 };

  if (app.os === 'win10') {
    const bindings = require('./vibrancy.mjs');
    bindings.setVibrancy(
      window.getNativeWindowHandle().readInt32LE(0),
      1,
      backgroundRGB.r,
      backgroundRGB.g,
      backgroundRGB.b,
      0
    );
    const win10refresh = require('./win10refresh.mjs');
    win10refresh(window, 60);

    window.webContents.once('dom-ready', () => {
      const currentURL = window.webContents.getURL();

      if (
        !(
          currentURL.includes('workbench.html') ||
          currentURL.includes('workbench.esm.html') ||
          currentURL.includes('workbench-monkey-patch.html')
        )
      ) {
        return;
      }

      if (window.isMaximized()) {
        window.unmaximize();
        window.maximize();
      }
    });
  }

  window.on('closed', () => {
    effects.uninstall();
  });

  window.webContents.on('dom-ready', () => {
    const currentURL = window.webContents.getURL();

    if (
      !(
        currentURL.includes('workbench.html') ||
        currentURL.includes('workbench.esm.html') ||
        currentURL.includes('workbench-monkey-patch.html')
      )
    ) {
      return;
    }

    window.setBackgroundColor('#00000000');

    effects.install();

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
    styleElement.innerHTML = vscodeVibrancyTTP.createHTML(${JSON.stringify(
    styleHTML()
  )});
    document.body.appendChild(styleElement);

    document.getElementById("vscode-vibrancy-script")?.remove();
    const scriptElement = document.createElement("div");
    scriptElement.id = "vscode-vibrancy-script";
    scriptElement.innerHTML = vscodeVibrancyTTP.createHTML(${JSON.stringify(
    scriptHTML()
  )});
    document.body.appendChild(scriptElement);
  })();`);
}


function scriptHTML() {
  return app.imports.js;
}

function styleHTML() {
  if (app.os === 'unknown') return '';

  var type = app.config.type;
  if (type === 'auto') {
    type = app.theme.type[app.os];
  }

  let opacity = app.config.opacity;

  if (opacity < 0) {
    opacity = app.theme.opacity[app.os];
  }

  const backgroundRGB = hexToRgb(app.theme.background) || { r: 0, g: 0, b: 0 };

  const HTML = [
    `
    <style>
      html {
        background: rgba(${backgroundRGB.r},${backgroundRGB.g},${backgroundRGB.b},${opacity}) !important;
      }
      ${app.themeCSS}
    </style>
    `,
    app.imports.css,
  ];

  return HTML.join('');
}
