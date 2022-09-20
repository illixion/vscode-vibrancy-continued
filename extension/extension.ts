import * as vscode from 'vscode'
import localize from './i18n'
import runtime from './runtime'
import { checkColorTheme, deepEqual, disabledRestart, enabledRestart, isFirstload, lockFirstload } from './utils'

export const activate = async (context: vscode.ExtensionContext) => {
  console.info(
    '%c vscode-vibrancy %c active ',
    'padding: 1px; border-radius: 3px 0 0 3px; color: #fff; background-color: #606060',
    'padding: 1px; border-radius: 0 3px 3px 0; color: #fff; background-color: #1081c2'
  )
  const installVibrancy = vscode.commands.registerCommand('extension.installVibrancy', async () => {
    await runtime.install()
    await enabledRestart()
  })
  const uninstallVibrancy = vscode.commands.registerCommand('extension.uninstallVibrancy', async () => {
    await runtime.uninstall()
    await disabledRestart()
  })
  const updateVibrancy = vscode.commands.registerCommand('extension.updateVibrancy', async () => {
    await runtime.update()
    await enabledRestart()
  })
  context.subscriptions.push(installVibrancy)
  context.subscriptions.push(uninstallVibrancy)
  context.subscriptions.push(updateVibrancy)

  if (await isFirstload()) {
    const msg = await vscode.window.showInformationMessage(
      localize('messages.firstload'),
      { title: localize('messages.installIde') })

    if (msg) {
      await runtime.update()
      await checkColorTheme()
      await enabledRestart()
    }
    await lockFirstload()
  }

  let lastConfig = vscode.workspace.getConfiguration('vscode_vibrancy')

  vscode.workspace.onDidChangeConfiguration(async () => {
    const newConfig = vscode.workspace.getConfiguration('vscode_vibrancy')
    if (!deepEqual(lastConfig, newConfig)) {
      lastConfig = newConfig
      const msg = await vscode.window.showInformationMessage(localize('messages.configupdate'), { title: localize('messages.reloadIde') })

      if (msg) {
        await runtime.update()
        if (newConfig.theme !== vscode.workspace.getConfiguration('vscode_vibrancy')) {
          await checkColorTheme()
        }
        await enabledRestart()
      }
      await lockFirstload()
    }
  })
}
export const deactivate = () => { }
