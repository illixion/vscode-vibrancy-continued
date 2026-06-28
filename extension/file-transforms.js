var { pathToFileURL } = require('url');
var path = require('path');
var os = require('os');

// --- Utility Functions ---

function deepEqual(obj1, obj2) {
  if (obj1 === obj2) return true;
  if (isPrimitive(obj1) && isPrimitive(obj2)) return obj1 === obj2;
  if (Object.keys(obj1).length !== Object.keys(obj2).length) return false;
  for (const key in obj1) {
    if (!(key in obj2)) return false;
    if (!deepEqual(obj1[key], obj2[key])) return false;
  }
  return true;
}

function isPrimitive(obj) {
  return (obj !== Object(obj));
}

function checkRuntimeUpdate(current, last) {
  const [currentMajor, currentMinor] = current.split('.').slice(0, 2);
  const [lastMajor, lastMinor] = last.split('.').slice(0, 2);
  return (parseInt(currentMajor) !== parseInt(lastMajor)) || (parseInt(currentMinor) !== parseInt(lastMinor));
}

function getConfigDir(name) {
  const homedir = os.homedir();
  if (process.platform === 'darwin') {
    return path.join(homedir, 'Library', 'Preferences', name);
  }
  if (process.platform === 'win32') {
    return path.join(process.env.APPDATA || path.join(homedir, 'AppData', 'Roaming'), name, 'Config');
  }
  return path.join(process.env.XDG_CONFIG_HOME || path.join(homedir, '.config'), name);
}

// --- Markers ---

const VIBRANCY_START = '/* !! VSCODE-VIBRANCY-START !! */';
const VIBRANCY_END = '/* !! VSCODE-VIBRANCY-END !! */';
const MARKER_REGEX = /\n\/\* !! VSCODE-VIBRANCY-START !! \*\/[\s\S]*?\/\* !! VSCODE-VIBRANCY-END !! \*\//;

// --- JS Injection ---

/**
 * Inject vibrancy runtime markers into VSCode's main.js.
 * @param {string} js - Original main.js content
 * @param {string} base - Base directory path for existence check
 * @param {object} injectData - Data to inject as global.vscode_vibrancy_plugin
 * @param {string} runtimePath - Absolute path to the runtime entry file (index.mjs or index.cjs)
 * @returns {string} Modified JS content
 */
function generateNewJS(js, base, injectData, runtimePath) {
  // Remove existing injection if present
  const cleaned = js.replace(MARKER_REGEX, '');

  return cleaned
    + `\n${VIBRANCY_START}\n;(function(){\n`
    + `if (!import('fs').then(fs => fs.existsSync(${JSON.stringify(base)}))) return;\n`
    + `global.vscode_vibrancy_plugin = ${JSON.stringify(injectData)}; try{ import("${pathToFileURL(runtimePath)}"); } catch (err) {console.error(err)}\n`
    + `})()\n${VIBRANCY_END}`;
}

/**
 * Remove vibrancy runtime markers from JS content.
 * @param {string} js - JS content potentially containing markers
 * @returns {{ result: string, hadMarkers: boolean }}
 */
function removeJSMarkers(js) {
  const hadMarkers = MARKER_REGEX.test(js);
  return {
    result: js.replace(MARKER_REGEX, ''),
    hadMarkers,
  };
}

// --- Electron BrowserWindow Options ---

/**
 * Inject options before the `experimentalDarkMode` anchor used by bundled
 * VSCode BrowserWindow object literals.
 * @param {string} electronJS - Electron main.js content
 * @param {string} injectedOptions - Comma-delimited options to prepend
 * @returns {string} Patched content, or the original string if no anchor exists
 */
function injectObjectLiteralWindowOptions(electronJS, injectedOptions) {
  return electronJS.replace(
    /experimentalDarkMode/g,
    `${injectedOptions},experimentalDarkMode`
  );
}

/**
 * Inject options before the `titleBarStyle="hidden"` assignment used by newer
 * Cursor window builders.
 * @param {string} electronJS - Electron main.js content
 * @param {(target: string, quote: string) => string} createInjectedOptions
 * @returns {string} Patched content, or the original string if no anchor exists
 */
function injectCursorWindowOptions(electronJS, createInjectedOptions) {
  return electronJS.replace(
    /([A-Za-z_$][\w$]*)\.titleBarStyle=(["'])hidden\2,/g,
    (_, target, quote) =>
      `${createInjectedOptions(target, quote)}${target}.titleBarStyle=${quote}hidden${quote},`
  );
}

/**
 * Remove assignment-style window options injected into newer Cursor bundles.
 * @param {string} electronJS - Electron main.js content
 * @returns {string} Cleaned content
 */
function removeCursorWindowOptions(electronJS) {
  return electronJS
    .replace(/([A-Za-z_$][\w$]*)\.frame=false,\1\.transparent=(?:true|false),/g, '')
    .replace(/[A-Za-z_$][\w$]*\.visualEffectState=(["'])active\1,/g, '');
}

/**
 * Inject macOS-only visual effect state into Electron window builders.
 * @param {string} electronJS - Electron main.js content
 * @returns {string} Patched content
 */
function injectVisualEffectState(electronJS) {
  if (
    electronJS.includes('visualEffectState:"active"') ||
    /[A-Za-z_$][\w$]*\.visualEffectState=(["'])active\1,/.test(electronJS)
  ) {
    return electronJS;
  }

  const objectLiteralPatched = injectObjectLiteralWindowOptions(
    electronJS,
    'visualEffectState:"active"'
  );
  if (objectLiteralPatched !== electronJS) {
    return objectLiteralPatched;
  }

  return injectCursorWindowOptions(
    electronJS,
    (target, quote) => `${target}.visualEffectState=${quote}active${quote},`
  );
}

/**
 * Inject frameless-window options into Electron window builders.
 * @param {string} electronJS - Electron main.js content
 * @returns {string} Patched content
 */
function injectFramelessWindow(electronJS, transparent = true) {
  const t = transparent ? 'true' : 'false';
  if (
    electronJS.includes(`frame:false,transparent:${t}`) ||
    new RegExp(`([A-Za-z_$][\\w$]*)\\.frame=false,\\1\\.transparent=${t},`).test(electronJS)
  ) {
    return electronJS;
  }

  const objectLiteralPatched = injectObjectLiteralWindowOptions(
    electronJS,
    `frame:false,transparent:${t}`
  );
  if (objectLiteralPatched !== electronJS) {
    return objectLiteralPatched;
  }

  return injectCursorWindowOptions(
    electronJS,
    (target) => `${target}.frame=false,${target}.transparent=${t},`
  );
}

/**
 * Whether a FRAMELESS window should be transparent (per-pixel alpha) in this
 * context. An opaque window is preferred everywhere it works, because a
 * transparent (layered) window on Windows can't Aero-Snap or maximize, and on
 * macOS Tahoe needlessly drives WindowServer GPU/power (issue #207). Vibrancy
 * still shows on an opaque window — macOS via the native NSVisualEffectView,
 * Windows via the DWM material / legacy accent applied to the HWND. So opaque is
 * the default and transparency is opt-in, only for the see-through 'transparent'
 * vibrancy type (which paints no blur material of its own).
 *
 * The lone exception is Linux, which has no native compositor path and relies on
 * an actually-transparent window.
 *
 * @param {{ osType: string, platform: NodeJS.Platform, isWindows11?: boolean, transparentType?: boolean }} ctx
 * @returns {boolean}
 */
function framelessWindowTransparency({ osType, platform, isWindows11 = false, transparentType = false }) {
  if (platform === 'linux') return true; // Linux: no native compositor, needs a transparent window.
  // macOS + Windows (incl. Win10): opaque, so the window keeps snap/maximize and
  // (on macOS) avoids the WindowServer GPU cost; transparent only for the
  // see-through 'transparent' type.
  return transparentType;
}

/**
 * Resolve the effective windowMode, folding in the deprecated boolean settings.
 *
 * An explicit windowMode (anything other than 'auto') always wins. Otherwise the
 * legacy flags are migrated onto the enum, preserving their original precedence
 * (forceFramelessWindow won over disableFramelessWindow) AND original intent —
 * which was only ever "force the window frameless / force it framed", not a
 * transparency choice. So the frameless variant is picked to match what the
 * platform/material actually needs, sparing users (who likely don't know what
 * the flags do) broken combinations:
 *   - disableFramelessWindow → 'framed'
 *   - forceFramelessWindow   → 'frameless' on macOS / Win11 DWM materials (opaque,
 *                              the safe + low-power choice), 'frameless-transparent'
 *                              where a see-through window is actually wanted
 *                              (Win10, Linux, or the 'transparent' type)
 *
 * `forceFramelessWindow` still matters under 'auto' on configs where auto stays
 * framed — e.g. older VSCode on Windows with Electron <27 (issue #140).
 *
 * @param {{
 *   windowMode?: string,
 *   forceFramelessWindow?: boolean,
 *   disableFramelessWindow?: boolean,
 *   osType?: string,
 *   platform?: NodeJS.Platform,
 *   isWindows11?: boolean,
 *   transparentType?: boolean,
 * }} opts
 * @returns {'auto' | 'framed' | 'frameless' | 'frameless-transparent'}
 */
function resolveEffectiveWindowMode(opts) {
  const {
    windowMode = 'auto',
    forceFramelessWindow = false,
    disableFramelessWindow = false,
  } = opts;
  if (windowMode && windowMode !== 'auto') return windowMode;
  if (forceFramelessWindow) {
    return framelessWindowTransparency(opts) ? 'frameless-transparent' : 'frameless';
  }
  if (disableFramelessWindow) return 'framed';
  return 'auto';
}

/**
 * Resolve the effective window mode into concrete BrowserWindow flags
 * ({ frameless, transparent }).
 *
 * `windowMode` (vscode_vibrancy.windowMode) values:
 *   - 'auto'                  platform/editor-appropriate default (see below)
 *   - 'framed'                keep the OS frame, opaque window
 *   - 'frameless'             borderless, opaque window
 *   - 'frameless-transparent' borderless, transparent (see-through) window
 *
 * `transparent` is the BrowserWindow's per-pixel-alpha flag, NOT the vibrancy
 * effect: macOS vibrancy comes from a native NSVisualEffectView painted over an
 * OPAQUE window, and Win11 DWM materials (Mica/Acrylic) also require an opaque
 * window. A transparent window is only needed for the see-through 'transparent'
 * vibrancy type (which paints no blur material), and on macOS Tahoe it
 * needlessly drives WindowServer GPU/power that scales with window size and
 * count (issue #207) — so transparency is opt-in, derived from the type.
 *
 * 'auto' resolution:
 *   - Cursor:               frameless on every platform it runs on
 *   - macOS:                frameless; opaque unless the 'transparent' type is in use
 *   - Windows Electron >=27: frameless (issue #122) + opaque, so Aero Snap /
 *                            maximize work (a thin border shows on Win10); only
 *                            the 'transparent' type uses a see-through window
 *   - Windows Electron <27:  framed
 *   - Linux:                frameless + transparent (handled manually)
 *
 * @param {{
 *   osType: string,
 *   platform: NodeJS.Platform,
 *   electronMajorVersion: number,
 *   appName: string,
 *   isWindows11?: boolean,
 *   transparentType?: boolean,
 *   windowMode?: 'auto' | 'framed' | 'frameless' | 'frameless-transparent',
 * }} opts - `transparentType` is whether the resolved vibrancy type === 'transparent'.
 * @returns {{ frameless: boolean, transparent: boolean }}
 */
function resolveWindowMode({
  osType,
  platform,
  electronMajorVersion,
  appName,
  isWindows11 = false,
  transparentType = false,
  windowMode = 'auto',
}) {
  // Explicit overrides map directly to flags.
  if (windowMode === 'framed') return { frameless: false, transparent: false };
  if (windowMode === 'frameless') return { frameless: true, transparent: false };
  if (windowMode === 'frameless-transparent') return { frameless: true, transparent: true };

  // windowMode === 'auto': pick frame and transparency per platform/editor.
  let frameless;
  if (appName === 'Cursor') {
    frameless = true;
  } else if (osType === 'macos') {
    frameless = true;
  } else if (platform === 'win32') {
    // Electron >=27 needs frame:false for vibrancy on Windows (issue #122).
    frameless = electronMajorVersion >= 27;
  } else if (platform === 'linux') {
    frameless = true;
  } else {
    frameless = false;
  }

  const transparent = frameless
    ? framelessWindowTransparency({ osType, platform, isWindows11, transparentType })
    : false;

  return { frameless, transparent };
}

/**
 * Inject Electron BrowserWindow options (frame, transparent, visualEffectState).
 * @param {string} electronJS - Electron main.js content
 * @param {{ frameless: boolean, isMacos: boolean, transparent?: boolean }} opts
 * @returns {string} Modified content
 */
function injectElectronOptions(electronJS, { frameless, isMacos, transparent = true }) {
  let result = electronJS;

  // visualEffectState is a macOS-only Electron option.
  if (isMacos) {
    result = injectVisualEffectState(result);
  }

  // Add frameless + (optionally) transparent window options. The caller passes
  // transparent:false for opaque modes (e.g. macOS vibrancy, Win11 DWM materials).
  if (frameless) {
    result = injectFramelessWindow(result, transparent);
  }

  return result;
}

/**
 * Remove injected Electron BrowserWindow options.
 * @param {string} electronJS - Electron main.js content
 * @returns {string} Cleaned content
 */
function removeElectronOptions(electronJS) {
  const withoutObjectLiteralOptions = electronJS
    .replace(/visualEffectState:"active",frame:false,transparent:(?:true|false),experimentalDarkMode/g, 'experimentalDarkMode')
    .replace(/frame:false,transparent:(?:true|false),visualEffectState:"active",experimentalDarkMode/g, 'experimentalDarkMode')
    .replace(/frame:false,transparent:(?:true|false),experimentalDarkMode/g, 'experimentalDarkMode')
    .replace(/visualEffectState:"active",experimentalDarkMode/g, 'experimentalDarkMode');

  return removeCursorWindowOptions(withoutObjectLiteralOptions);
}

// --- CSP / HTML ---

/**
 * Add VscodeVibrancyContinued to the CSP trusted-types directive.
 * @param {string} html - Workbench HTML content
 * @returns {{ result: string, alreadyPatched: boolean, noMetaTag: boolean }}
 */
function patchCSP(html) {
  const metaTagRegex = /<meta\s+http-equiv="Content-Security-Policy"\s+content="([\s\S]+?)">/;
  const metaTagMatch = html.match(metaTagRegex);

  if (!metaTagMatch) {
    return { result: html, alreadyPatched: false, noMetaTag: true };
  }

  const cspContent = metaTagMatch[1];

  if (cspContent.includes('VscodeVibrancyContinued')) {
    return { result: html, alreadyPatched: true, noMetaTag: false };
  }

  let newCspContent;
  if (cspContent.includes('trusted-types')) {
    // Remove legacy marker (original vscode-vibrancy) if present
    let cleanedCsp = cspContent.replace(/ VscodeVibrancy(?!Continued)/g, '');
    // Add VscodeVibrancyContinued to existing trusted-types directive
    newCspContent = cleanedCsp.replace(/(?<!-)trusted-types(?!-)/, 'trusted-types VscodeVibrancyContinued');
  } else {
    // No trusted-types directive — add one
    newCspContent = cspContent.replace(/;?\s*$/, '; trusted-types VscodeVibrancyContinued');
  }

  const newMetaTag = metaTagMatch[0].replace(cspContent, newCspContent);
  return { result: html.replace(metaTagMatch[0], newMetaTag), alreadyPatched: false, noMetaTag: false };
}

/**
 * Remove VscodeVibrancy/VscodeVibrancyContinued from CSP.
 * @param {string} html - HTML content
 * @returns {string} Cleaned HTML
 */
function removeCSPPatch(html) {
  if (!html.includes('VscodeVibrancy')) return html;
  return html
    .replace(/ VscodeVibrancyContinued/g, '')
    .replace(/ VscodeVibrancy/g, '');
}

// --- Color Utilities ---

/**
 * Compute #RRGGBBAA hex from a theme background hex and opacity float.
 * @param {string} themeBackground - 6-char hex without # (e.g. "1e1e1e")
 * @param {number} opacity - 0.0 to 1.0
 * @returns {string} "#RRGGBBAA"
 */
function computeTransparentHex(themeBackground, opacity) {
  const alpha = Math.round(opacity * 255).toString(16).padStart(2, '0');
  return `#${themeBackground}${alpha}`;
}

/**
 * Extract 6-char hex RGB from a user color value.
 * Handles #RGB, #RRGGBB, #RRGGBBAA (strips alpha), and bare hex strings.
 * Returns null if the value is not a valid hex color.
 * @param {*} value - Color string from user settings
 * @returns {string|null} 6-char hex without # (e.g. "f6f6f6"), or null
 */
function extractBaseColor(value) {
  if (typeof value !== 'string') return null;
  const hex = value.replace(/^#/, '');
  if (/^[0-9a-fA-F]{6}$/.test(hex)) return hex.toLowerCase();
  if (/^[0-9a-fA-F]{8}$/.test(hex)) return hex.slice(0, 6).toLowerCase();
  if (/^[0-9a-fA-F]{3}$/.test(hex)) {
    return (hex[0]+hex[0]+hex[1]+hex[1]+hex[2]+hex[2]).toLowerCase();
  }
  return null;
}

/**
 * Compute per-key vibrancy color overrides, preserving the user's original
 * color for each key (if any) instead of using a single global background.
 *
 * @param {Object} opts
 * @param {string} opts.themeBackground - 6-char fallback hex (e.g. "1e1e1e")
 * @param {number} opts.opacity - User's vibrancy opacity (0.0–1.0)
 * @param {Object<string, string|null>} opts.originalColors - Backed-up per-key
 *   color values from the user's settings (before vibrancy was applied).
 *   Keys not present or null fall back to themeBackground.
 * @returns {Object<string, string>} Map of color key → "#RRGGBBAA" value
 */
function computeVibrancyColors({ themeBackground, opacity, originalColors = {} }) {
  const result = {};
  for (const key of TRANSPARENT_BG_KEYS) {
    const base = extractBaseColor(originalColors[key]) ?? themeBackground;
    result[key] = `#${base}00`;
  }
  for (const key of SEMITRANSPARENT_BG_KEYS) {
    const base = extractBaseColor(originalColors[key]) ?? themeBackground;
    result[key] = computeTransparentHex(base, opacity);
  }
  for (const key of OPAQUE_BG_KEYS) {
    const base = extractBaseColor(originalColors[key]) ?? themeBackground;
    result[key] = computeTransparentHex(base, 0.9);
  }
  return result;
}

// --- Background Key Constants ---

const TRANSPARENT_BG_KEYS = [
  "editorPane.background",
  "editorGroupHeader.tabsBackground",
  "editorGroupHeader.noTabsBackground",
  "breadcrumb.background",
  "editorGutter.background",
  "panel.background",
  "panelStickyScroll.background",
  "tab.activeBackground",
  "tab.unfocusedActiveBackground",
];

const SEMITRANSPARENT_BG_KEYS = [
  "sideBar.background",
  "sideBarTitle.background",
  "sideBarStickyScroll.background",
  "activityBar.background",
  "editor.background",
  "editorStickyScroll.background",
  "editorStickyScrollGutter.background",
  "tab.inactiveBackground",
  "tab.unfocusedInactiveBackground",
];

const OPAQUE_BG_KEYS = [
  "inlineChat.background",
  "editorWidget.background",
  "editorHoverWidget.background",
  "editorSuggestWidget.background",
  "notifications.background",
  "notificationCenterHeader.background",
  "menu.background",
  "quickInput.background",
];

const ALL_VIBRANCY_BG_KEYS = [...TRANSPARENT_BG_KEYS, ...SEMITRANSPARENT_BG_KEYS, ...OPAQUE_BG_KEYS];

module.exports = {
  VIBRANCY_START,
  VIBRANCY_END,
  MARKER_REGEX,
  generateNewJS,
  removeJSMarkers,
  resolveEffectiveWindowMode,
  resolveWindowMode,
  injectElectronOptions,
  removeElectronOptions,
  patchCSP,
  removeCSPPatch,
  computeTransparentHex,
  extractBaseColor,
  computeVibrancyColors,
  TRANSPARENT_BG_KEYS,
  SEMITRANSPARENT_BG_KEYS,
  OPAQUE_BG_KEYS,
  ALL_VIBRANCY_BG_KEYS,
  deepEqual,
  isPrimitive,
  checkRuntimeUpdate,
  getConfigDir,
};
