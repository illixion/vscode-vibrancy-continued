# Known Errors and Solutions

Please check this list for a solution if you're encountering an error when installing Vibrancy Continued.

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

### I'm on Windows 10 and I'm experiencing lag when dragging the window

[Please read here for details](https://github.com/EYHN/vscode-vibrancy/discussions/80).

### VSCode window cannot be resized/moved/maximized after enabling Vibrancy

Please see [Important notice for Windows users](https://github.com/illixion/vscode-vibrancy-continued?tab=readme-ov-file#%EF%B8%8F-important-notice-for-windows-1011-users) at the top of the description.

### Effect doesn't work, but there are no errors

If the vibrancy effect isn't visible but there are no error messages, check the following in order:

1. **OS-level transparency settings** — Some operating systems allow you to disable all transparency effects globally. Look in Accessibility settings for an option called "Transparency effects," "Reduce transparency," or similar. If this is disabled, enable it and restart VSCode.

2. **Laptop power-saver mode** — On laptops, power-saver or battery-saver modes may disable transparency effects to save power. Try disabling power-saver mode or plugging in your laptop to see if the effect appears.

3. **DWM/system-wide acrylic utilities** — Software like DWMBlurGlass or other DWM customization tools can interfere with the vibrancy effect. If you have any programs that globally modify Windows DWM acrylic or transparency, try temporarily disabling them to test. Some of these tools conflict with the extension's rendering.

4. **GPU or driver issues** — If you have recently updated your graphics drivers, try rolling back or updating to the latest version. In rare cases, try disabling GPU acceleration by passing `--disable-gpu-compositing` in your VSCode launch arguments.

5. **Reinstall VSCode** — As a last resort, reinstall VSCode. This won't affect your settings or extensions, but ensures your installation is consistent.
