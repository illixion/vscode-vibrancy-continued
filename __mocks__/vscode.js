// Mock for the vscode module (not available outside VSCode extension host)
module.exports = {
  workspace: {
    getConfiguration: () => ({
      get: () => undefined,
      update: async () => {},
      inspect: () => ({}),
    }),
  },
  window: {
    showInformationMessage: async () => {},
    showWarningMessage: async () => {},
    showErrorMessage: async () => {},
    activeColorTheme: { kind: 2 },
    onDidChangeActiveColorTheme: () => ({ dispose: () => {} }),
  },
  env: {
    appName: 'Visual Studio Code',
  },
  commands: {
    registerCommand: () => ({ dispose: () => {} }),
  },
  extensions: {
    getExtension: () => null,
  },
  ConfigurationTarget: {
    Global: 1,
    Workspace: 2,
    WorkspaceFolder: 3,
  },
  ColorThemeKind: {
    Light: 1,
    Dark: 2,
    HighContrast: 3,
  },
  version: '1.100.0',
};
