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
  /** vscode.env.appRoot, the install's resources/app directory. */
  appRoot: undefined,
  colorThemeKind: 2, // Dark
  /** vscode.env.language, the display language. */
  language: 'en',
  /** vscode.workspace.workspaceFolders. @type {Array<{uri: {fsPath: string}}> | undefined} */
  workspaceFolders: undefined,
  /** Webview panels created, each with what it was sent in `posted`. @type {any[]} */
  panels: [],
  /** executeCommand calls, as argument lists. @type {any[][]} */
  executed: [],
  /** What showSaveDialog returns. */
  saveDialogResult: undefined,
  clipboard: '',
  /** URLs passed to openExternal. @type {string[]} */
  opened: [],
  /** Quick picks and terminals shown. @type {any[]} */
  quickPicks: [],
  terminals: [],
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
  state.appRoot = overrides.appRoot;
  state.colorThemeKind = overrides.colorThemeKind ?? 2;
  state.language = overrides.language || 'en';
  state.workspaceFolders = overrides.workspaceFolders;
  state.panels = [];
  state.executed = [];
  state.saveDialogResult = overrides.saveDialogResult;
  state.clipboard = '';
  state.opened = [];
  state.quickPicks = [];
  state.terminals = [];
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

class EventEmitter {
  constructor() {
    this.listeners = [];
    this.event = (listener) => { this.listeners.push(listener); return disposable(); };
  }
  fire(value) { this.listeners.forEach((listener) => listener(value)); }
  dispose() {}
}

const Uri = {
  file: (fsPath) => ({ scheme: 'file', fsPath, path: fsPath, toString: () => `file://${fsPath}` }),
  joinPath: (base, ...parts) => Uri.file(require('path').join(base.fsPath, ...parts)),
  parse: (value) => ({ value, toString: () => value }),
};

/**
 * A webview panel that records what the extension sends it. A test plays the
 * page by calling `panel.receive(message)` and reads replies from `posted`.
 */
function createWebviewPanel(viewType, title, column, options) {
  const panel = {
    viewType,
    title,
    options,
    posted: [],
    revealed: 0,
    disposeListeners: [],
    receive: null,
    webview: {
      html: '',
      cspSource: 'vscode-webview://test',
      asWebviewUri: (uri) => ({ toString: () => `webview:${uri.fsPath}` }),
      postMessage: async (message) => { panel.posted.push(message); return true; },
      onDidReceiveMessage: (cb) => { panel.receive = cb; return disposable(); },
    },
    reveal: () => { panel.revealed += 1; },
    onDidDispose: (cb) => { panel.disposeListeners.push(cb); return disposable(); },
    dispose: () => panel.disposeListeners.forEach((cb) => cb()),
  };
  state.panels.push(panel);
  return panel;
}

module.exports = {
  __state: state,
  __reset,

  get version() { return state.version; },
  env: {
    get appName() { return state.appName; },
    get appRoot() { return state.appRoot; },
    get language() { return state.language; },
    clipboard: { writeText: async (text) => { state.clipboard = text; } },
    openExternal: async (uri) => { state.opened.push(uri.toString()); return true; },
  },

  workspace: {
    getConfiguration,
    onDidChangeConfiguration: (cb) => { state.configListeners.push(cb); return disposable(); },
    get workspaceFolders() { return state.workspaceFolders; },
  },

  window: {
    showInformationMessage: record('info'),
    showWarningMessage: record('warn'),
    showErrorMessage: record('error'),
    withProgress: (_options, task) => task({ report: () => {} }),
    get activeColorTheme() { return { kind: state.colorThemeKind }; },
    onDidChangeActiveColorTheme: (cb) => { state.themeListeners.push(cb); return disposable(); },
    createWebviewPanel,
    showSaveDialog: async () => state.saveDialogResult,
    createQuickPick: () => {
      const pick = {
        items: [],
        activeItems: [],
        placeholder: '',
        show: () => state.quickPicks.push(pick),
        hide: () => {},
        dispose: () => {},
        onDidAccept: () => disposable(),
        onDidHide: () => disposable(),
      };
      return pick;
    },
    createTerminal: (options) => {
      const terminal = { options, show: () => state.terminals.push(terminal) };
      return terminal;
    },
  },

  commands: {
    registerCommand: (id, fn) => { state.commands.set(id, fn); return disposable(); },
    executeCommand: async (...args) => { state.executed.push(args); },
  },

  extensions: { getExtension: () => null },

  EventEmitter,
  Uri,
  ViewColumn: { Active: -1, Beside: -2, One: 1 },
  ConfigurationTarget: { Global: 1, Workspace: 2, WorkspaceFolder: 3 },
  ProgressLocation: { SourceControl: 1, Window: 10, Notification: 15 },
  ColorThemeKind: { Light: 1, Dark: 2, HighContrast: 3, HighContrastLight: 4 },
};
