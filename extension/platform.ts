import os from 'os'

const init = () => {
  if (/^win/.test(process.platform)) {
    // const [major, minor, build, revision] = os.release().split('.').map(Number)
    const [major, , build] = os.release().split('.').map(Number)
    if (major === 10) {
      if (build < 22000) {
        return 'win10'
      }
      return 'win11'
    }
  }

  if (process.platform === 'darwin') {
    return 'macos'
  }

  return 'unknown'
}

const current = init()
export default current
