import * as vscode from 'vscode'
import * as sudoPrompt from '@vscode/sudo-prompt'
import fs from 'fs/promises'
import path from 'path'
import { tmpdir } from 'os'
import { randomUUID } from 'crypto'
import * as childProcess from 'child_process'

const _suToDoList: string[] = []

const mvcmd = process.platform === 'win32' ? 'move /Y' : 'mv -f'
const cpcmd = process.platform === 'win32' ? 'copy /Y' : 'cp -f'

const sudo = async (cmd: string, name?: string): Promise<{stdout: string | Buffer | undefined, stderr: string | Buffer | undefined}> => {
  return await new Promise((resolve, reject) => {
    sudoPrompt.exec(cmd, { name }, (err, stdout, stderr) => {
      if (err) reject(err)
      resolve({ stdout, stderr })
    })
  })
}

const udo = async (cmd: string): Promise<{stdout: string | Buffer | undefined, stderr: string | Buffer | undefined}> => {
  return await new Promise((resolve, reject) => {
    childProcess.exec(cmd, (err, stdout, stderr) => {
      if (err) reject(err)
      resolve({ stdout, stderr })
    })
  })
}

const assertError = (error: unknown) => {
  const fserr = error as vscode.FileSystemError
  if (!('code' in fserr)) throw error
  if (fserr.code !== 'EPERM' && fserr.code !== 'EACCES') throw error
}

/**
 * Write string to file
 * @param file file path
 * @param data file content
 */
export const writeFile = async (file: string, data: string) => {
  try {
    await fs.writeFile(file, data, 'utf-8')
  } catch (error) {
    assertError(error)

    const tmpFile = path.join(tmpdir(), `vibrancy-${randomUUID()}.temp`)
    await fs.writeFile(tmpFile, data, 'utf-8')

    _suToDoList.push(`${mvcmd} "${tmpFile}" "${file}"`)
  }
}

/**
 * Make Directory
 * @param path
 */
export const mkdir = async (path: string) => {
  try {
    await fs.mkdir(path, { recursive: true })
  } catch (error) {
    assertError(error)

    _suToDoList.push(`mkdir "${path}"`)
  }
}

/**
 * Copy File or Folder
 * @param source
 * @param destination
 */
export const cp = async (source: string, destination: string) => {
  const cmd = `${cpcmd} "${source}" "${destination}"`
  try {
    // not support folder?
    // await fs.cp(source, destination)
    const { stdout, stderr } = await udo(cmd)
    console.log(stdout)
    console.log(stderr)
  } catch (error) {
    // assertError(error)

    _suToDoList.push(cmd)
  }
}

/**
 * retry by admin
 */
export const retryByAdminPrompt = async () => {
  // return when _suToDoList is empty
  if (!_suToDoList.length) return

  try {
    const message =
      'We cannot write some file. Do you want to try it by admin?'
    // button text
    const retry = 'Retry with Admin/Sudo'
    const result = await vscode.window.showErrorMessage(message, retry)
    // throw an error when cancel
    if (result !== retry) throw new vscode.CancellationError()

    const fullcmd = _suToDoList.join(' && ')
    await sudo(fullcmd, 'Visual Studio Code Vibrancy Extension')
  } finally {
    // clear _suToDoList
    _suToDoList.splice(0, _suToDoList.length)
  }
}
