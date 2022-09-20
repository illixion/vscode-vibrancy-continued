import * as vscode from 'vscode'
import path from 'path'
import fs from 'fs/promises'
import fs1 from 'fs'
import localize from './i18n'
import os from './platform'
import { HTMLFile, JSFile, runtimeDir, themeConfigPaths, themeStylePaths } from './CONSTANTS'
import { changeTerminalRendererType, getCurrentTheme } from './utils'
import * as sudo from './sudoUtils'

const installRuntime = async () => {
  if (fs1.existsSync(runtimeDir)) return

  await fs.mkdir(runtimeDir)
  await fs.cp(path.resolve(__dirname, '../runtime'), path.resolve(runtimeDir))
}

const installJS = async () => {
  const config = vscode.workspace.getConfiguration('vscode_vibrancy')
  const currentTheme = getCurrentTheme(config)

  const themeConfigPath = path.resolve(__dirname, themeConfigPaths[currentTheme])
  const themeConfig = JSON.parse(await fs.readFile(themeConfigPath, { encoding: 'utf-8' }))
  const themeCSS = await fs.readFile(path.join(__dirname, themeStylePaths[currentTheme]), 'utf-8')

  const JS = await fs.readFile(JSFile, 'utf-8')

  const injectData = {
    os,
    config,
    theme: themeConfig,
    themeCSS
  }

  const base = __filename

  const newJS = JS.replace(/\n\/\* !! VSCODE-VIBRANCY-START !! \*\/[\s\S]*?\/\* !! VSCODE-VIBRANCY-END !! \*\//, '') +
      '\n/* !! VSCODE-VIBRANCY-START !! */\n;(function(){\n' +
      `if (!require('fs').existsSync(${JSON.stringify(base)})) return;\n` +
      `global.vscode_vibrancy_plugin = ${JSON.stringify(injectData)}; try{ require(${JSON.stringify(runtimeDir)}); } catch (err) {console.error(err)}\n` +
      '})()\n/* !! VSCODE-VIBRANCY-END !! */'
  await sudo.writeFile(JSFile, newJS)
}

const installHTML = async () => {
  const HTML = await fs.readFile(HTMLFile, 'utf-8')

  const newHTML = HTML.replace(
    /<meta http-equiv="Content-Security-Policy" content="require-trusted-types-for 'script'; trusted-types (.+);">/g,
    (_, trustedTypes: string) => {
      return `<meta http-equiv="Content-Security-Policy" content="require-trusted-types-for 'script';  trusted-types ${trustedTypes} VscodeVibrancy;">`
    }
  )

  if (HTML !== newHTML) {
    await sudo.writeFile(HTMLFile, newHTML)
  }
}

const uninstallJS = async () => {
  const JS = await fs.readFile(JSFile, 'utf-8')
  const needClean = /\n\/\* !! VSCODE-VIBRANCY-START !! \*\/[\s\S]*?\/\* !! VSCODE-VIBRANCY-END !! \*\//.test(JS)
  if (needClean) {
    const newJS = JS
      .replace(/\n\/\* !! VSCODE-VIBRANCY-START !! \*\/[\s\S]*?\/\* !! VSCODE-VIBRANCY-END !! \*\//, '')
    await sudo.writeFile(JSFile, newJS)
  }
}

const uninstallHTML = async () => {
  const HTML = await fs.readFile(HTMLFile, 'utf-8')
  const needClean = HTML.includes(' VscodeVibrancy;')
  if (needClean) {
    const newHTML = HTML.replace(' VscodeVibrancy;', ';').replace(';  trusted-types', '; trusted-types')
    await sudo.writeFile(HTMLFile, newHTML)
  }
}

// ####  main commands ######################################################

const catchError = async (error: vscode.FileSystemError) => {
  if (error && (error.code === 'EPERM' || error.code === 'EACCES')) {
    await vscode.window.showInformationMessage(localize('messages.admin') + error.message)
  } else {
    await vscode.window.showInformationMessage(localize('messages.smthingwrong') + error.message)
  }
  throw error
}

const Install = async () => {
  if (os === 'unknown') {
    await vscode.window.showInformationMessage(localize('messages.unsupported'))
    throw new Error('unsupported')
  }

  try {
    await fs.stat(JSFile)
    await fs.stat(HTMLFile)

    await installRuntime()
    await installJS()
    await installHTML()
    await changeTerminalRendererType()
  } catch (error) {
    await catchError(error as vscode.FileSystemError)
  }
}

const Uninstall = async () => {
  try {
    // uninstall old version
    await fs.stat(HTMLFile)
    await uninstallHTML()

    await fs.stat(JSFile)
    await uninstallJS()
  } catch (error) {
    await catchError(error as vscode.FileSystemError)
  }
}

const Update = async () => {
  await Uninstall()
  await Install()
}

export default {
  init: installRuntime,
  install: Install,
  uninstall: Uninstall,
  update: Update,
  js: {
    install: installJS,
    uninstall: uninstallJS
  },
  html: {
    install: installHTML,
    uninstall: uninstallHTML
  }
}
