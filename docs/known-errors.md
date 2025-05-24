# Known Errors and Solutions

Please check this list for a solution if you're encountering an error when installing Vibrancy Continued.

### `EACCES: permission denied` when enabling Vibrancy on macOS?

Your installation of VSCode is owned by another user. Run the following commands exactly as-is in the Terminal app to take ownership of the files, and enter your password when prompted:
```shell
sudo chown -R $(whoami):staff "/Applications/Visual Studio Code.app/"
sudo chmod -R 755 "/Applications/Visual Studio Code.app/"
```

A reinstallation will also fix this issue without any loss of settings.

### `EROFS: read-only file system` when enabling Vibrancy on macOS?

Your installation of VSCode is affected by [App Translocation](https://eclecticlight.co/2023/05/09/what-causes-app-translocation/).

To fix this, either use the Finder and move VSCode to `/Applications` (or move it out of `/Applications` and then back in), or run the following terminal command:

```shell
sudo xattr -dr com.apple.quarantine "/Applications/Visual Studio Code.app"
```

### Effect doesn't work correctly in VSCode terminal?

Check your settings. You should change the renderer type of the terminal to `dom`.

`"terminal.integrated.gpuAcceleration": "off"`

### Prompt "Run Visual Studio Code with administrator privileges"?

It usually appears on Windows when you are using the VSCode System Installer. You should close VSCode completely, then run VSCode as administrator and retry what you did before (Enable/Reload/Disable Vibrancy).

### I'm on Windows 10 and I'm experiencing lag when dragging the window

[Please read here for details](https://github.com/EYHN/vscode-vibrancy/discussions/80).

### VSCode window cannot be resized/moved/maximized after enabling Vibrancy

Please see [Important notice for Windows users](#️-important-notice-for-windows-1011-users) at the top of the description.

### Effect doesn't work, but there are no errors

Ensure that you don't have transparency effects disabled globally through your OS settings. This can usually be found under Accessibility settings, and it may be called "Transparency effects" or "Reduce transparency." If that didn't help, you can also check the Console section in VSCode's Developer Tools, which can be accessed through the command palette.

If nothing else worked, try reinstalling VSCode, you won't lose any settings and this will ensure that your VSCode installation is consistent.