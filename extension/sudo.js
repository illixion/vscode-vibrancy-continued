const sudo = require('@vscode/sudo-prompt')
const fs = require('fs/promises')
const fsExtra = require('fs-extra');
const path = require('path')
const { tmpdir } = require('os')

const todo = []
const mvcmd = process.platform === 'win32' ? 'MOVE /Y' : 'mv -f'
const cpcmd = process.platform === 'win32' ? 'COPY /Y' : 'cp -f'
const cprcmd = process.platform === 'win32' ? 'XCOPY /Y' : 'cp -rf'

const exec = cmd => new Promise((resolve, reject) => sudo.exec(
  cmd,
  { name: 'Vibrancy Sudo' },
  (err, stdo, stde) => {
    if (err) reject({ err, stdo, stde })

    resolve({ stdo, stde })
  }))

export const run = () => exec(todo.join(' && '))

export const writeFile = async (file, data, options) => {
  try {
    await fs.writeFile(file, data, options)
  } catch {
    const tmp = path.join(tmpdir(), `vibrancy-${randomUUID()}.temp`)
    await fs.writeFile(tmp, data, options)

    todo.push(`${mvcmd} "${tmpFile}" "${file}"`)
  }
}

export const rm = async (target, options) => {
  try {
    await fs.rm(target, options)
  } catch {
    let cmd
    if (process.platform === 'win32') {
      if ('recursive' in options && options.recursive === true) {
        cmd = 'RD /S /Q'
      } else {
        cmd = 'DEL /Q'
        if ('force' in options && options.force === true)
          cmd += ' /F'
      }
    } else {
      cmd = 'rm'
      if ('recursive' in options && options.recursive === true)
        cmd += ' -r'
      if ('force' in options && options.force === true)
        cmd += ' -f'
    }

    todo.push(`${cmd} "${target}"`)
  }
}

export const mkdir = async (path) => {
  try {
    await fs.mkdir(path)
  } catch {
    todo.push(`mkdir "${path}"`)
  }
}

export const copyFile = async (src, dest) => {
  try {
    await fs.copyFile(src, dest)
  } catch {
    todo.push(`${cpcmd} "${src}" "${dest}"`)
  }
}

export const copy = async (src, dest) => {
  try {
    await fsExtra.copy(src, dest)
  } catch {
    todo.push(`${cprcmd} "${src}" "${dest}"`)
  }
}
