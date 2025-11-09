# Known Errors and Solutions

Please check this list for a solution if you're encountering an error when installing Vibrancy Continued.

### Nothing happens first time Reload/Enable Vibrancy is used

There is a known issue with Vibrancy sometimes not working on the first try after VSCode updates, perform the same action again to resolve.

### `EACCES: permission denied` when enabling Vibrancy on macOS

Your installation of VSCode is owned by another user. Run the following commands exactly as-is in the Terminal app to take ownership of the files, and enter your password when prompted:
```shell
sudo chown -R $(whoami):staff "/Applications/Visual Studio Code.app/"
sudo chmod -R 755 "/Applications/Visual Studio Code.app/"
```

A reinstallation will also fix this issue without any loss of settings.

### `EROFS: read-only file system` when enabling Vibrancy on macOS

Your installation of VSCode is affected by [App Translocation](https://developer.apple.com/forums/thread/724969).

To fix this, either use the Finder and move VSCode to `/Applications` (or move it out of `/Applications` and then back in), or run the following terminal command:

```shell
sudo xattr -dr com.apple.quarantine "/Applications/Visual Studio Code.app"
```

### Your code editor is not supported.

See here for the list of supported editors: [Supported Code Editors](https://github.com/illixion/vscode-vibrancy-continued?tab=readme-ov-file#supported-code-editors)

If you're using an unsupported code editor and you're on Windows, you must perform these steps prior to activating Vibrancy Continued: [Windows Install Guide](https://github.com/illixion/vscode-vibrancy-continued?tab=readme-ov-file#%EF%B8%8F-important-notice-for-windows-1011-users)

### Effect doesn't work correctly in VSCode terminal

Check your settings. You should change the renderer type of the terminal to `dom`.

`"terminal.integrated.gpuAcceleration": "off"`

### Prompt "Run Visual Studio Code with administrator privileges"

It usually appears on Windows when you are using the VSCode System Installer. You should close VSCode completely, then run VSCode as administrator and retry what you did before (Enable/Reload/Disable Vibrancy).

### I'm on Windows 10 and I'm experiencing lag when dragging the window

[Please read here for details](https://github.com/EYHN/vscode-vibrancy/discussions/80).

### VSCode window cannot be resized/moved/maximized after enabling Vibrancy

Please see [Important notice for Windows users](https://github.com/illixion/vscode-vibrancy-continued?tab=readme-ov-file#%EF%B8%8F-important-notice-for-windows-1011-users) at the top of the description.

### Effect doesn't work, but there are no errors

Ensure that you don't have transparency effects disabled globally through your OS settings. This can usually be found under Accessibility settings, and it may be called "Transparency effects" or "Reduce transparency." If that didn't help, you can also check the Console section in VSCode's Developer Tools, which can be accessed through the command palette.

If nothing else worked, try reinstalling VSCode, you won't lose any settings and this will ensure that your VSCode installation is consistent.
