# Known Errors and Solutions

Please check this list for a solution if you're encountering an error when installing Vibrancy Continued.

### `EROFS: read-only file system` when enabling Vibrancy on macOS

Your installation of VSCode is affected by [App Translocation](https://developer.apple.com/forums/thread/724969).

To fix this, either use the Finder and move VSCode to `/Applications` (or move it out of `/Applications` and then back in), or run the following terminal command:

```shell
sudo xattr -dr com.apple.quarantine "/Applications/Visual Studio Code.app"
```

### Vibrancy didn't install: with its changes, main.js would no longer load in this editor

Before changing anything, Vibrancy checks that the editor could still load its files with those changes. This error means it couldn't, so Vibrancy stopped and left your editor's files as they were. It usually means an editor update changed the files Vibrancy expects. Please open an issue with your editor's name and version, and the error text.

### The editor won't start, or its window is invisible, after enabling Vibrancy

Disable can't run when the editor doesn't start, but the original files can be put back without reinstalling the editor: see [Restoring an editor that won't start](https://github.com/illixion/vscode-vibrancy-continued?tab=readme-ov-file#restoring-an-editor-that-wont-start).

### Your code editor is not supported.

See here for the list of supported editors: [Supported Code Editors](https://github.com/illixion/vscode-vibrancy-continued?tab=readme-ov-file#supported-code-editors)

On an editor that isn't on that list, Vibrancy only changes the window when it can tell exactly where the change goes, and shows this error when it can't. Nothing has been changed when you see it. Please open an issue with your editor's name and version so it can be looked at.

If you're using an unsupported code editor and you're on Windows, you must perform these steps prior to activating Vibrancy Continued: [Windows Install Guide](https://github.com/illixion/vscode-vibrancy-continued?tab=readme-ov-file#%EF%B8%8F-important-notice-for-windows-1011-users)

### An error mentions a file this version doesn't use, or Vibrancy doesn't seem to have updated

For example `ENOENT ... workbench.esm.html`, which only Vibrancy 1.1.92 and older looked for. The editor can show the new version as installed while still running the old one: an extension update only takes effect once the editor fully restarts, and reloading a window isn't enough. To fix it:

1. Quit the editor completely. On Windows, check that no `Code.exe` is left in Task Manager.
2. Reopen it, and run **Developer: Show Running Extensions** to see which Vibrancy version is actually running.
3. If it's still the old one, uninstall Vibrancy, restart the editor, and install it again.

The diagnostic script below shows the version that patched your editor next to the versions installed. On Windows it also shows which version the editor has recorded as the one it loads.

If the old version comes back after reinstalling, check that the extension's folder (under `~/.vscode/extensions`) and the editor's install folder aren't read-only. A sync tool, an antivirus, or a manual change can leave them read-only, and then the editor can't replace the old version. On Windows the diagnostic script reports any read-only files it finds there.

### Effect doesn't work correctly in VSCode terminal

Check your settings. You should change the renderer type of the terminal to `dom`.

`"terminal.integrated.gpuAcceleration": "off"`

### I'm on Windows 10 and I'm experiencing lag when dragging the window

[Please read here for details](https://github.com/EYHN/vscode-vibrancy/discussions/80).

### VSCode window cannot be resized/moved/maximized after enabling Vibrancy

Please see [Important notice for Windows users](https://github.com/illixion/vscode-vibrancy-continued?tab=readme-ov-file#%EF%B8%8F-important-notice-for-windows-1011-users) at the top of the description.

### Effect doesn't work, but there are no errors

If the vibrancy effect isn't visible but there are no error messages, first check **which patches actually landed**. Vibrancy works by modifying files inside VSCode's own installation, and an install can report success while one of those patches didn't apply. Run the diagnostic script. On Linux and macOS:

```shell
curl -fsSL https://raw.githubusercontent.com/illixion/vscode-vibrancy-continued/main/scripts/diagnose.sh | bash
```

On Windows, in PowerShell:

```powershell
irm https://raw.githubusercontent.com/illixion/vscode-vibrancy-continued/main/scripts/diagnose.ps1 | iex
```

It only reads files and changes nothing. Run it with Vibrancy **enabled**, and after fully quitting and reopening VSCode — an in-process reload doesn't re-read the patched files. If your install isn't auto-detected, pass its path, e.g. `bash diagnose.sh /usr/share/code/resources/app/out`, or on Windows `& ([scriptblock]::Create((irm <url above>))) -Filter 'C:\path\to\resources\app\out'`.

Two results are worth acting on immediately:

* **`frame:false,transparent:true` is `NO` on Linux** — the window isn't transparent. On Linux the effect comes *entirely* from window transparency (there's no native blur material as on macOS/Windows), so nothing will show. Check `windowMode` under section `2b`: if it's `framed`, set `vscode_vibrancy.windowMode` back to `auto` and run **Enable Vibrancy** again.
* **`injection anchor present` is `NO`** — your VSCode build isn't one this version knows how to patch. Please [open an issue](https://github.com/illixion/vscode-vibrancy-continued/issues) with the full output and your VSCode version.

Please include the script's full output when opening an issue — it answers most of the questions we'd otherwise have to ask.

If the diagnostic looks correct, check the following in order:

1. **OS-level transparency settings** — Some operating systems allow you to disable all transparency effects globally. Look in Accessibility settings for an option called "Transparency effects," "Reduce transparency," or similar. If this is disabled, enable it and restart VSCode.

2. **Laptop power-saver mode** — On laptops, power-saver or battery-saver modes may disable transparency effects to save power. Try disabling power-saver mode or plugging in your laptop to see if the effect appears.

3. **DWM/system-wide acrylic utilities** — Software like DWMBlurGlass or other DWM customization tools can interfere with the vibrancy effect. If you have any programs that globally modify Windows DWM acrylic or transparency, try temporarily disabling them to test. Some of these tools conflict with the extension's rendering.

4. **GPU or driver issues** — If you have recently updated your graphics drivers, try rolling back or updating to the latest version. In rare cases, try disabling GPU acceleration by passing `--disable-gpu-compositing` in your VSCode launch arguments.

5. **Reinstall VSCode** — As a last resort, reinstall VSCode. This won't affect your settings or extensions, but ensures your installation is consistent.
