import path from 'path';
import electron from 'electron';
/**
 * @type {(window) => Record<'interval' | 'overwrite', {install: () => void, uninstall: () => void>}
 */
import transparencyMethods from './methods/index.mjs';
import { createRequire } from 'module';
import { fileURLToPath } from 'url';


/**
 * @type {{
 *  os: string,
 *  config: {
 *    type:  "auto" | "acrylic" | "transparent" | "under-window" | "fullscreen-ui" | "titlebar" | "selection" | "menu" | "popover" | "sidebar" | "content" | "header" | "hud" | "sheet" | "tooltip" | "under-page" | "window" | "appearance-based" | "dark" | "ultra-dark" | "light" | "medium-light",
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

const esmRequire = createRequire(import.meta.url);
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

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

// 'mica' and 'tabbed' (Mica Alt) are Windows 11 DWM backdrop materials. On
// Windows 10 they have no legacy equivalent and fall back to acrylic blur.
const windowsType = ['acrylic', 'mica', 'tabbed'];

const universalType = ['transparent'];

// 'liquid-glass' is NOT an Electron vibrancy type — it swaps setVibrancy() for
// a native NSGlassEffectView (macOS 26+) inserted underneath Chromium's
// content view by native/liquidglass.mm. Never run both: Electron's
// NSVisualEffectView overrides the glass and produces the old blurry effect.
const LIQUID_GLASS_TYPE = 'liquid-glass';

// NSGlassEffectView material variants (private API, experimental). 2 is the
// Dock-style glass; full table in native/liquidglass.mm / electron-liquid-glass.
const LIQUID_GLASS_VARIANT = 2;
// Roughly matches the corner rounding macOS itself applies to windows.
const LIQUID_GLASS_CORNER_RADIUS = 12;
// Html-tint scrim used when vscode_vibrancy.opacity is left on the theme
// default (-1): fully clear (0) is unreadable over the glass and the
// theme-era values (0.3) wash it out — 0.6 measured as the sweet spot.
// An explicitly-set vscode_vibrancy.opacity still wins.
const LIQUID_GLASS_DEFAULT_OPACITY = 0.6;

// Windows AccentState values (must match enum in native/vibrancy.cc)
const ACCENT_TRANSPARENT = 2; // ACCENT_ENABLE_TRANSPARENTGRADIENT
const ACCENT_ACRYLIC = 4;     // ACCENT_ENABLE_ACRYLICBLURBEHIND

// Map a vibrancy type to an Electron BrowserWindow backgroundMaterial value
// (Windows 11 only). https://www.electronjs.org/docs/latest/api/browser-window
function backgroundMaterialForType(type) {
  switch (type) {
    case 'mica': return 'mica';
    case 'tabbed': return 'tabbed';
    case 'transparent': return 'none';
    case 'acrylic':
    default: return 'acrylic';
  }
}

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

// --- macOS Liquid Glass -----------------------------------------------------

// undefined: load not attempted yet; null: unavailable; else the addon instance.
let liquidGlassAddon;

function getLiquidGlassAddon() {
  if (liquidGlassAddon !== undefined) return liquidGlassAddon;
  liquidGlassAddon = null;
  try {
    // The installer copies liquidglass-darwin-*.node from native/prebuilt next
    // to this runtime file (same layout as the Windows vibrancy addon).
    const addonPath = path.resolve(__dirname, `./liquidglass-darwin-${process.arch}.node`);
    const mod = esmRequire(addonPath);
    liquidGlassAddon = new mod.LiquidGlassNative();
  } catch (err) {
    console.error('Vibrancy: failed to load the Liquid Glass native addon:', err);
  }
  return liquidGlassAddon;
}

// The ±1px resize nudge that makes macOS re-evaluate the window material.
function nudgeWindowSize(window) {
  const width = window.getBounds().width;
  window.setBounds({ width: width + 1 });
  window.setBounds({ width });
}

// Electron's supported vibrancy — the fallback whenever real Liquid Glass
// can't be had (macOS < 26, addon missing, addView failed).
function applyVibrancyFallback(window) {
  window.setVibrancy('under-window');
  nudgeWindowSize(window);
}

/**
 * @returns {number | null} the glass view id, or null when the fallback ran
 */
function applyLiquidGlass(window) {
  const glass = getLiquidGlassAddon();
  if (!glass) {
    console.error('Vibrancy: Liquid Glass addon unavailable; falling back to under-window vibrancy.');
    applyVibrancyFallback(window);
    return null;
  }
  if (!glass.isGlassSupported()) {
    console.error('Vibrancy: NSGlassEffectView not available on this macOS; falling back to under-window vibrancy.');
    applyVibrancyFallback(window);
    return null;
  }

  // Chromium has to be fully see-through for the native glass behind it to show.
  window.setBackgroundColor('#00000000');

  // frame:false windows can end up with hidden traffic lights; keep them.
  if (typeof window.setWindowButtonVisibility === 'function') {
    try {
      window.setWindowButtonVisibility(true);
    } catch {
      // older Electron — nothing to do
    }
  }

  let id;
  try {
    id = glass.addView(window.getNativeWindowHandle(), {
      cornerRadius: LIQUID_GLASS_CORNER_RADIUS,
      tintColor: '#00000000',
      opaque: false,
    });
  } catch (err) {
    console.error('Vibrancy: Liquid Glass addView threw:', err);
    id = -1;
  }
  if (typeof id !== 'number' || id < 0) {
    console.error('Vibrancy: Liquid Glass addView failed; falling back to under-window vibrancy.');
    applyVibrancyFallback(window);
    return null;
  }

  glass.setVariant(id, LIQUID_GLASS_VARIANT);
  console.log(`Vibrancy: Liquid Glass active (view ${id}, variant ${LIQUID_GLASS_VARIANT}).`);
  return id;
}

/**
 * Apple-style translucent surfaces for the Liquid Glass type: workbench chrome
 * fully transparent, subtle fills on the parts that need separation from the
 * glass. Injected AFTER the theme CSS, so it wins ties against the theme's
 * vibrancy-era fills. Tint polarity follows the theme's declared color scheme.
 */
function liquidGlassCSS() {
  const light = app.theme && app.theme.systemColorTheme === 'light';
  const tint = (a) => (light ? `rgba(0,0,0,${a})` : `rgba(255,255,255,${a})`);
  return `
    .monaco-workbench,
    .monaco-workbench .part,
    .monaco-workbench .part > .content,
    .monaco-workbench .monaco-editor-background,
    .monaco-editor,
    .monaco-editor .inputarea.ime-input {
      background: transparent !important;
    }

    .monaco-workbench .part.titlebar { background-color: ${tint(0.03)} !important; }
    .monaco-workbench .part.activitybar { background-color: ${tint(0.04)} !important; }
    .monaco-workbench .part.sidebar { background-color: ${tint(0.06)} !important; }
    .monaco-workbench .part.auxiliarybar { background-color: ${tint(0.05)} !important; }
    .monaco-workbench .part.panel { background-color: ${tint(0.05)} !important; }
    .monaco-workbench .part.statusbar { background-color: ${tint(0.04)} !important; }
    .monaco-workbench .part.editor > .content .editor-group-container { background-color: ${tint(0.025)} !important; }
  `;
}

electron.app.on('browser-window-created', (_, window) => {
  const methods = transparencyMethods(window);
  const hackMethod = app.config.preventFlash ? 'overwrite' : 'interval';
  const effects = methods[hackMethod];

  var type = app.config.type;
  if (type !== 'auto') {
    if (!universalType.includes(type)) {
      if (app.os === 'win10' && !windowsType.includes(type)) type = 'auto';
      if (app.os === 'macos' && !macosType.includes(type) && type !== LIQUID_GLASS_TYPE) type = 'auto';
    }
  }
  if (type === 'auto') {
    type = app.theme.type[app.os];
  }

  const isUniversalType = universalType.includes(type);
  const isLiquidGlass = app.os === 'macos' && type === LIQUID_GLASS_TYPE;

  let opacity = app.config.opacity;
  // if opacity < 0, use the theme default opacity
  if (opacity < 0) {
    opacity = app.theme.opacity[app.os];
  }

  const backgroundRGB = (app.config.backgroundOverride && hexToRgb(app.config.backgroundOverride))
    || hexToRgb(app.theme.background)
    || { r: 0, g: 0, b: 0 };

  if (app.os === 'win10') {
    if (app.win11) {
      // Windows 11: use the modern DWM backdrop material (Mica / Acrylic / Tabbed)
      // via Electron's BrowserWindow.setBackgroundMaterial. This composites on the
      // GPU and has no per-frame blur cost, so it doesn't lag while dragging the
      // way the legacy acrylic accent does on Win10 (issue #52). It also gives us
      // Mica and Mica Alt support (issue #19).
      const material = backgroundMaterialForType(type);
      if (typeof window.setBackgroundMaterial === 'function') {
        try {
          window.setBackgroundMaterial(material);
        } catch (err) {
          console.error('setBackgroundMaterial failed:', err);
        }
      }
    } else {
      // Windows 10: legacy SetWindowCompositionAttribute accent.
      const effect = type === 'transparent' ? ACCENT_TRANSPARENT : ACCENT_ACRYLIC;
      const arch = process.arch; // 'x64', 'arm64', etc.

      try {
        const addonPath = path.resolve(__dirname, `./vibrancy-${arch}.node`);
        const addon = esmRequire(addonPath);
        const applyAccent = () => {
          if (window.isDestroyed()) return;
          addon.setVibrancy(
            window.getNativeWindowHandle().readInt32LE(0),
            effect,
            backgroundRGB.r,
            backgroundRGB.g,
            backgroundRGB.b,
            0
          );
        };
        applyAccent();

        // ACCENT_ENABLE_ACRYLICBLURBEHIND lags badly while dragging on Win10, so
        // drop it during move/resize and restore it once the window goes idle.
        if (effect === ACCENT_ACRYLIC) {
          import('./win-acrylic-drag.mjs')
            .then((module) => module.default(window, addon, applyAccent))
            .catch((error) => console.error('Error loading win-acrylic-drag:', error));
        }
      } catch (err) {
        throw new Error(`Failed to load vibrancy addon for arch ${arch}. Error: ${err.message}`);
      }
    }

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

  let glassViewId = null;
  window.on('closed', () => {
    effects.uninstall();
    // Drop the native glass view with the window, so the addon registry can't
    // accumulate one detached (retained) view per closed window.
    if (glassViewId !== null && liquidGlassAddon) {
      try {
        liquidGlassAddon.removeView(glassViewId);
      } catch {
        // best effort
      }
      glassViewId = null;
    }
  });

  window.webContents.on('dom-ready', () => {
    const currentURL = window.webContents.getURL();

    // Floating editor windows (issue #115) are auxiliary windows opened as
    // about:blank children of the workbench and populated via DOM calls from
    // the opener; their container mirrors the main workbench's classes, so the
    // theme CSS applies as-is. VSCode's main process only permits about:blank
    // child windows, so this cannot match anything else. The URL reads as ''
    // until the initial empty document commits, so accept both forms.
    const isAuxiliaryWindow = currentURL === 'about:blank' || currentURL === '';

    if (
      !(
        isAuxiliaryWindow ||
        currentURL.includes('workbench.html') ||
        currentURL.includes('workbench.esm.html') ||
        currentURL.includes('workbench-monkey-patch.html')
      )
    ) {
      return;
    }

    window.setBackgroundColor('#00000000');

    effects.install();

    if (isLiquidGlass) {
      // Real Apple Liquid Glass (NSGlassEffectView) — and explicitly NOT
      // window.setVibrancy(), which would hide the glass behind Electron's
      // own NSVisualEffectView. applyLiquidGlass falls back to
      // setVibrancy('under-window') when glass is unavailable.
      glassViewId = applyLiquidGlass(window);
    } else if (app.os === 'macos' && !isUniversalType) {
      window.setVibrancy(type);

      // hack
      nudgeWindowSize(window);
    }

    injectHTML(window);
  });
});

function injectHTML(window) {
  window.webContents.executeJavaScript(`(function(){
    const vscodeVibrancyTTP = window.trustedTypes.createPolicy("VscodeVibrancyContinued", { createHTML (v) { return v; }});

    // Auxiliary (floating) windows stub document.createElement to throw
    // (see VSCode's auxiliaryWindowService createContainer), so go through
    // the prototype. Our containers are inert, so the "instanceof HTMLElement"
    // concern behind that stub doesn't apply here.
    const createElement = (tag) => Document.prototype.createElement.call(document, tag);

    document.getElementById("vscode-vibrancy-style")?.remove();
    const styleElement = createElement("div");
    styleElement.id = "vscode-vibrancy-style";
    styleElement.innerHTML = vscodeVibrancyTTP.createHTML(${JSON.stringify(
    styleHTML()
  )});
    document.body.appendChild(styleElement);

    document.getElementById("vscode-vibrancy-script")?.remove();
    const scriptElement = createElement("div");
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
  const isLiquidGlass = app.os === 'macos' && type === LIQUID_GLASS_TYPE;

  let opacity = app.config.opacity;

  if (opacity < 0) {
    // The glass provides its own frost; a fully clear html background is
    // unreadable over it and the theme-era defaults wash it out, so
    // liquid-glass gets its own default scrim. An explicit user opacity
    // is still honored verbatim.
    opacity = isLiquidGlass ? LIQUID_GLASS_DEFAULT_OPACITY : app.theme.opacity[app.os];
  }

  const themeBackgroundRGB = hexToRgb(app.theme.background) || { r: 0, g: 0, b: 0 };
  const overrideRGB = app.config.backgroundOverride ? hexToRgb(app.config.backgroundOverride) : null;
  const backgroundRGB = overrideRGB || themeBackgroundRGB;

  // When background override is set, recolor the theme CSS so element backgrounds
  // (sidebar, tabs, lists, etc.) use the override color instead of the theme's gray.
  let themeCSS = app.themeCSS;
  if (overrideRGB) {
    const recolorCSS = (css, fromRGB, toRGB) => {
      // Replace rgba(R, G, B, A) and rgb(R, G, B) where RGB is close to the theme background
      css = css.replace(
        /rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/g,
        (match, rs, gs, bs) => {
          const r = parseInt(rs), g = parseInt(gs), b = parseInt(bs);
          const dist = Math.abs(r - fromRGB.r) + Math.abs(g - fromRGB.g) + Math.abs(b - fromRGB.b);
          if (dist < 60) {
            const prefix = match.startsWith('rgba') ? 'rgba(' : 'rgb(';
            return `${prefix}${toRGB.r}, ${toRGB.g}, ${toRGB.b}`;
          }
          return match;
        }
      );
      // Replace #RRGGBB hex colors close to the theme background
      css = css.replace(
        /#([0-9a-fA-F]{2})([0-9a-fA-F]{2})([0-9a-fA-F]{2})\b/g,
        (match, rh, gh, bh) => {
          const r = parseInt(rh, 16), g = parseInt(gh, 16), b = parseInt(bh, 16);
          const dist = Math.abs(r - fromRGB.r) + Math.abs(g - fromRGB.g) + Math.abs(b - fromRGB.b);
          if (dist < 60) {
            const hex = (n) => n.toString(16).padStart(2, '0');
            return `#${hex(toRGB.r)}${hex(toRGB.g)}${hex(toRGB.b)}`;
          }
          return match;
        }
      );
      return css;
    };
    themeCSS = recolorCSS(themeCSS, themeBackgroundRGB, overrideRGB);
  }

  const HTML = [
    `
    <style>
      html {
        background: rgba(${backgroundRGB.r},${backgroundRGB.g},${backgroundRGB.b},${opacity}) !important;
      }
      ${themeCSS}
      ${isLiquidGlass ? liquidGlassCSS() : ''}
    </style>
    `,
    app.imports.css,
  ];

  return HTML.join('');
}
