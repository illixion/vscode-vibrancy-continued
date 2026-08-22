/**
 * Stand-in for the `vscode` module, which only exists inside the extension
 * host. Reached via test/helpers/vscode-host.js, which teaches Node's module
 * resolver about the specifier.
 *
 * Deliberately a controllable fake rather than a set of no-ops: it is what lets
 * extension/index.js — one large activate() closure that cannot otherwise be
 * loaded under test — be driven end to end against a throwaway VSCode install.
 * See test/integration/activate-flows.test.js.
 *
 * Settings are held in one flat map keyed exactly as VSCode keys them
 * ("vscode_vibrancy.opacity", "workbench.colorCustomizations"), so a sectioned
 * getConfiguration("vscode_vibrancy") and a bare getConfiguration() read and
 * write the same store — the same aliasing the real API has, and the reason a
 * write through one is visible through the other.
 */

/**
 * The extension's own settings default from package.json, exactly as the real
 * getConfiguration().get() resolves them. Reading these from the manifest
 * rather than restating them keeps a new setting from silently arriving as
 * `undefined` in every test that doesn't know about it — which reads as a
 * crash somewhere deep in the transforms rather than as a missing default.
 */
function manifestDefaults() {
  const { properties } = require('../package.json').contributes.configuration;
  return Object.fromEntries(
    Object.entries(properties)
      .filter(([, schema]) => schema.default !== undefined)
      .map(([key, schema]) => [key, structuredClone(schema.default)]),
  );
}

const state = {
  /** Manifest defaults, behind anything explicitly set. @type {Record<string, any>} */
  defaults: manifestDefaults(),
  /** What the user has set. @type {Record<string, any>} */
  settings: {},
  /** @type {Array<{kind: string, message: string, options: any[]}>} */
  messages: [],
  /**
   * Answers handed to the next showInformationMessage/showWarningMessage
   * calls, oldest first. `undefined` means the user dismissed it. Anything
   * left over is ignored, so a test only queues what it cares about.
   */
  responses: [],
  /** @type {Map<string, any>} */
  globalState: new Map(),
  /** @type {Map<string, Function>} */
  commands: new Map(),
  /** @type {Function[]} */
  configListeners: [],
  /** @type {Function[]} */
  themeListeners: [],
  version: '1.119.0',
  appName: 'Visual Studio Code',
  colorThemeKind: 2, // Dark
};

/** Reset every captured interaction. Call from beforeEach. */
function __reset(overrides = {}) {
  state.defaults = manifestDefaults();
  state.settings = { ...(overrides.settings || {}) };
  state.messages = [];
  state.responses = overrides.responses ? [...overrides.responses] : [];
  state.globalState = new Map(Object.entries(overrides.globalState || {}));
  state.commands = new Map();
  state.configListeners = [];
  state.themeListeners = [];
  state.version = overrides.version || '1.119.0';
  state.appName = overrides.appName || 'Visual Studio Code';
  state.colorThemeKind = overrides.colorThemeKind ?? 2;
  return state;
}

const fullKey = (section, key) => (section ? `${section}.${key}` : key);

function getConfiguration(section) {
  const config = {
    // get() falls back to the manifest default, as the real API does.
    get: (key) => (fullKey(section, key) in state.settings
      ? state.settings[fullKey(section, key)]
      : state.defaults[fullKey(section, key)]),
    // inspect() does not: globalValue is what the user has actually set, and
    // restoreSettings tells "no backup" apart from "backup of undefined", so
    // reporting a default here would look like a user-set value.
    inspect: (key) => (fullKey(section, key) in state.settings
      ? { globalValue: state.settings[fullKey(section, key)] }
      : undefined),
    has: (key) => fullKey(section, key) in state.settings
      || fullKey(section, key) in state.defaults,
    update: async (key, value) => {
      const k = fullKey(section, key);
      if (value === undefined) delete state.settings[k];
      else state.settings[k] = value;
    },
  };

  // A real WorkspaceConfiguration also exposes each setting in the section as a
  // plain property, and index.js reads several of them that way (`config.type`,
  // `config.imports`). Without these it crashes inside the transforms with an
  // undefined-property error that looks nothing like a missing setting.
  if (section) {
    const prefix = `${section}.`;
    const keys = new Set(
      [...Object.keys(state.defaults), ...Object.keys(state.settings)]
        .filter((k) => k.startsWith(prefix))
        .map((k) => k.slice(prefix.length)),
    );
    for (const key of keys) {
      Object.defineProperty(config, key, { enumerable: true, get: () => config.get(key) });
    }
  }

  return config;
}

const record = (kind) => (message, ...options) => {
  state.messages.push({ kind, message, options });
  return Promise.resolve(state.responses.length ? state.responses.shift() : undefined);
};

const disposable = () => ({ dispose: () => {} });

module.exports = {
  __state: state,
  __reset,

  get version() { return state.version; },
  env: { get appName() { return state.appName; } },

  workspace: {
    getConfiguration,
    onDidChangeConfiguration: (cb) => { state.configListeners.push(cb); return disposable(); },
  },

  window: {
    showInformationMessage: record('info'),
    showWarningMessage: record('warn'),
    showErrorMessage: record('error'),
    withProgress: (_options, task) => task({ report: () => {} }),
    get activeColorTheme() { return { kind: state.colorThemeKind }; },
    onDidChangeActiveColorTheme: (cb) => { state.themeListeners.push(cb); return disposable(); },
  },

  commands: {
    registerCommand: (id, fn) => { state.commands.set(id, fn); return disposable(); },
    executeCommand: async () => {},
  },

  extensions: { getExtension: () => null },

  ConfigurationTarget: { Global: 1, Workspace: 2, WorkspaceFolder: 3 },
  ProgressLocation: { SourceControl: 1, Window: 10, Notification: 15 },
  ColorThemeKind: { Light: 1, Dark: 2, HighContrast: 3, HighContrastLight: 4 },
};
