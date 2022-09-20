import * as vscode from 'vscode'
import path from 'path'
import fs from 'fs'

type LangEnum = 'en' | 'zh-cn' | 'ja'

const i18nMessages = {
  en: JSON.parse(fs.readFileSync(path.join(__dirname, '../package.nls.json'), 'utf-8')),
  'zh-cn': JSON.parse(fs.readFileSync(path.join(__dirname, '../package.nls.zh-CN.json'), 'utf-8')),
  ja: JSON.parse(fs.readFileSync(path.join(__dirname, '../package.nls.ja.json'), 'utf-8'))
}
const defaultLocale = 'en'
const locale: LangEnum = (vscode.env.language ?? defaultLocale).toLowerCase() as LangEnum

const localize = (info: string): string => {
  if (locale in i18nMessages && info in i18nMessages[locale]) {
    return i18nMessages[locale][info]
  } else {
    return i18nMessages[defaultLocale][info]
  }
}

export default localize
