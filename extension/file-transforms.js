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
 * Inject Electron BrowserWindow options (frame, transparent, visualEffectState).
 * @param {string} electronJS - Electron main.js content
 * @param {{ useFrame: boolean, isMacos: boolean }} opts
 * @returns {string} Modified content
 */
function injectElectronOptions(electronJS, { useFrame, isMacos }) {
  let result = electronJS;

  // Add visualEffectState to keep vibrancy active when unfocused (macOS only)
  if (!result.includes('visualEffectState') && isMacos) {
    result = result.replace(/experimentalDarkMode/g, 'visualEffectState:"active",experimentalDarkMode');
  }

  // Add frameless + transparent window options
  if (useFrame && !result.includes('frame:false,')) {
    result = result.replace(/experimentalDarkMode/g, 'frame:false,transparent:true,experimentalDarkMode');
  }

  return result;
}

/**
 * Remove injected Electron BrowserWindow options.
 * @param {string} electronJS - Electron main.js content
 * @returns {string} Cleaned content
 */
function removeElectronOptions(electronJS) {
  return electronJS
    .replace(/frame:false,transparent:true,experimentalDarkMode/g, 'experimentalDarkMode')
    .replace(/visualEffectState:"active",experimentalDarkMode/g, 'experimentalDarkMode');
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
  "inlineChat.background",
];

const OPAQUE_BG_KEYS = [
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
