import * as vscode from 'vscode'
import localize from './i18n'
import fs from 'fs/promises'
import { defaultTheme, lockPath, themeConfigPaths, themeStylePaths } from './CONSTANTS'
import path from 'path'

export const getCurrentTheme = (config: vscode.WorkspaceConfiguration): keyof typeof themeStylePaths => {
  return config.theme in themeStylePaths ? config.theme : defaultTheme
}

const promptRestart = async () => {
  // This is a hacky way to display the restart prompt
  const conf = vscode.workspace.getConfiguration()
  const v = conf.inspect('window.titleBarStyle')
  if (v !== undefined) {
    const value = conf.get('window.titleBarStyle')
    await conf.update('window.titleBarStyle',
      value === 'native' ? 'custom' : 'native',
      vscode.ConfigurationTarget.Global)
    await conf.update('window.titleBarStyle',
      v.globalValue,
      vscode.ConfigurationTarget.Global)
  }
}

export const enabledRestart = async () => {
  const msg = await vscode.window.showInformationMessage(localize('messages.enabled'), { title: localize('messages.restartIde') })
  if (msg != null) {
    await promptRestart()
  }
}

export const disabledRestart = async () => {
  const msg = await vscode.window.showInformationMessage(localize('messages.disabled'), { title: localize('messages.restartIde') })
  if (msg != null) {
    await promptRestart()
  }
}

export const changeTerminalRendererType = async () => {
  const v = vscode.workspace.getConfiguration().inspect('terminal.integrated.gpuAcceleration')
  if (v !== undefined) {
    if (!v.globalValue) {
      await vscode.workspace.getConfiguration().update('terminal.integrated.gpuAcceleration', 'off', vscode.ConfigurationTarget.Global)
    }
  }
}
export const isFirstload = async () => {
  try {
    await fs.readFile(lockPath)
    return false
  } catch (err) {
    return true
  }
}
export const lockFirstload = async () => {
  await fs.writeFile(lockPath, '')
}

export const checkColorTheme = async () => {
  const currentTheme = getCurrentTheme(vscode.workspace.getConfiguration('vscode_vibrancy'))
  const themeConfigPath = path.resolve(__dirname, themeConfigPaths[currentTheme])
  const themeConfig = JSON.parse(await fs.readFile(themeConfigPath, { encoding: 'utf-8' }))

  const target = themeConfig.colorTheme
  const currentColorTheme = vscode.workspace.getConfiguration().get<string>('workbench.colorTheme') ?? ''
  if (target !== currentColorTheme) {
    const message = localize('messages.recommendedColorTheme').replace('%1', currentColorTheme).replace('%2', target)
    await vscode.window.showInformationMessage(message, localize('messages.changeColorThemeIde'), localize('messages.noIde'))
      .then(async (msg) => {
        if (msg === localize('messages.changeColorThemeIde')) {
          await vscode.workspace.getConfiguration().update('workbench.colorTheme', target, vscode.ConfigurationTarget.Global)
        }
      })
  }
}

/**
 * check if value is primitive
 * @param obj
 * @returns
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const isPrimitive = (obj: any) => {
  return (obj !== Object(obj))
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const deepEqual = (obj1: any, obj2: any) => {
  if (obj1 === obj2) { // it's just the same object. No need to compare.
    return true
  }

  if (isPrimitive(obj1) && isPrimitive(obj2)) { // compare primitives
    return obj1 === obj2
  }

  if (Object.keys(obj1).length !== Object.keys(obj2).length) { return false }

  // compare objects with same number of keys
  for (const key in obj1) {
    if (!(key in obj2)) return false // other object doesn't have this prop
    if (!deepEqual(obj1[key], obj2[key])) return false
  }

  return true
}
