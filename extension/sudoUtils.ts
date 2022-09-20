import * as vscode from 'vscode'
import { exec } from '@vscode/sudo-prompt'
import fs from 'fs/promises'
import path from 'path'
import { tmpdir } from 'os'
import { randomUUID } from 'crypto'

const sudo = async (cmd: string, name?: string) => {
  return await new Promise((resolve, reject) => {
    exec(cmd, { name }, (err, stdout, stderr) => {
      if (err) reject(err)
      resolve({ stdout, stderr })
    })
  })
}

const sudoWriteFile = async (file: string, data: string) => {
  const tmpFile = path.join(tmpdir(), `vibrancy-${randomUUID()}.temp`)
  await fs.writeFile(tmpFile, data, 'utf-8')

  try {
    const sudocmd = process.platform === 'win32' ? 'move /Y' : 'mv -f'
    const fullcmd = `${sudocmd} "${tmpFile}" "${file}"`
    await sudo(fullcmd, 'Visual Studio Code Vibrancy Extension')
  } finally {
    await fs.rm(tmpFile)
  }
}

export const writeFile = async (file: string, data: string) => {
  try {
    // normal write
    await fs.writeFile(file, data, 'utf-8')
  } catch (error) {
    if (!(error instanceof vscode.FileSystemError)) throw error
    if (error.code !== 'EPERM' && error.code !== 'EACCES') throw error

    const msg = error.message
    const retry = 'Retry with Admin/Sudo'
    const result = await vscode.window.showErrorMessage(msg, retry)
    if (result !== retry) throw new vscode.CancellationError()
    await sudoWriteFile(file, data)
  }
}
