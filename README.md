# Visual Studio Code Extension - Vibrancy Continued

> The original extension has been deprecated, this version will continue to be supported and receive community updates.

> Windows 10 users may have a slight mouse lag when moving the window, [please read here for details](https://github.com/EYHN/vscode-vibrancy/discussions/80).

> For questions about installation and uninstallation, please read [FAQs](#FAQs).

Enable Acrylic/Glass effect in VS Code.

![screenshot](./screenshot.png)

[![](https://vsmarketplacebadges.dev/version/illixion.vscode-vibrancy-continued.svg)](https://marketplace.visualstudio.com/items?itemName=illixion.vscode-vibrancy-continued)&nbsp;
[![](https://vsmarketplacebadges.dev/rating-star/illixion.vscode-vibrancy-continued.svg)](https://marketplace.visualstudio.com/items?itemName=illixion.vscode-vibrancy-continued)&nbsp;
[![](https://vsmarketplacebadges.dev/installs-short/illixion.vscode-vibrancy-continued.svg)](https://marketplace.visualstudio.com/items?itemName=illixion.vscode-vibrancy-continued)

![](https://img.shields.io/badge/Vistual%20Studio%20Code%20v1.70.2-Tested%20%E2%9C%94%EF%B8%8F-brightgreen?logo=Visual-Studio-Code&logoColor=ffffff)

[![](https://img.shields.io/github/stars/illixion/vscode-vibrancy-continued.svg?style=social)](https://github.com/illixion/vscode-vibrancy-continued)&nbsp;
[![](https://img.shields.io/github/watchers/illixion/vscode-vibrancy-continued.svg?style=social)](https://github.com/illixion/vscode-vibrancy-continued)

Links: [GitHub](https://github.com/illixion/vscode-vibrancy-continued) | [Visual Studio Code Marketplace](https://marketplace.visualstudio.com/items?itemName=illixion.vscode-vibrancy-continued) | [issues](https://github.com/illixion/vscode-vibrancy-continued/issues)

[中文教程 (Chinese README)](https://eyhn.in/vscode-vibrancy/)

# Warning

This extension works by editing VS Code's checksum-verified CSS file, which means that a warning prompt will appear after installing and enabling `vscode-vibrancy-continued`. This warning is safe to disregard, and all changes can be reverted. Click on the cogwheel and select **Don't Show Again** to hide it.

![screenshot](./warn.png)
![screenshot](./warnfix.png)

To fix the "[Unsupported]" warning on VS Code's title bar, please refer to this extension: [Fix VSCode Checksums](https://marketplace.visualstudio.com/items?itemName=lehni.vscode-fix-checksums).

# Supported Operating Systems

Windows 11 ✔

Windows 10 ✔

MacOS ✔

# Getting Started

1. Make sure the color theme you selected is the 'Dark+ (default)'

![step-1](./step-1.png)

2. Install this extension from [the Visual Studio Code Marketplace](https://marketplace.visualstudio.com/items?itemName=illixion.vscode-vibrancy-continued).

3. Press F1 and Activate command "Reload Vibrancy".

![step-3](./step-3.png)

4. Restart.

Every time after VS Code is updated, please re-enable Vibrancy.

## Options

#### vscode_vibrancy.type

Native method of Vibrancy Effect.

* auto : Automatically switch with system version.
* acrylic : (Windows 10 only) Fluent Design blur.
* appearance-based, light, dark, titlebar, selection, menu, popover, sidebar, medium-light, ultra-dark: (MacOS only)

#### vscode_vibrancy.opacity

Opacity of Vibrancy Effect.

*value: 0.0 ~ 1*

#### vscode_vibrancy.preventFlash

Use an alternative method to prevent window flashing when resizing. Eliminates the need for a refresh interval, but may be less compatible in some cases.

*boolean, default is true*

#### vscode_vibrancy.refreshInterval

Refresh interval (in milliseconds) for making the background transparent after window resizing. Lower values make the update less visible at the cost of increased CPU utilization. Ignored when using "Prevent Flash" method.

*value: 1 ~ 1000, default is 10*

#### vscode_vibrancy.theme

Select Vibrancy theme:

* Default Dark
* Dark (Only Subbar)
* Default Light
* Light (Only Subbar)
* Noir et blanc
* Tokyo Night Storm
* Tokyo Night Storm (Outer)
* Solarized Dark+

| Theme | Screenshot |
| ---- | ---- |
| Default Dark | ![](./theme-default.jpg) |
| Dark (Only Subbar) | ![](./theme-subbar.jpg) |
| Noir et blanc | ![](./theme-noir-et-blanc.jpg) |
| Tokyo Night Storm | ![](./theme-tokyo-night-storm.png) |
| Tokyo Night Storm (Only Subbar) | ![](./theme-tokyo-night-storm-outer.png) |
| Solarized Dark+ (with theme: [Solarized](https://marketplace.visualstudio.com/items?itemName=ryanolsonx.solarized)) | ![](./theme-solarized-dark%2B.png)

> You can contribute more themes! [see here](https://github.com/illixion/vscode-vibrancy-continued/tree/master/themes).

#### vscode_vibrancy.imports

Import CSS/JS files, as file paths.

EXAMPLE: `C:/Users/MyUserName/Documents/custom.css`

*value: array[]*

# FAQs

### How to uninstall Vibrancy?

Press F1 or ⌘+Shift+P and activate command "Disable Vibrancy", then restart Visual Studio Code.

### Effect doesn't work for terminal?

Check your settings. You should change the renderer type of the terminal to dom.

`"terminal.integrated.gpuAcceleration": "off"`

### Prompt "Run Visual Studio Code with administrator privileges"?

It usually appears on windows when you are using the VSCode System Installer. You should close VSCode completely, then run VSCode as administrator and retry what you did before (Enable/Reload/Disable Vibrancy).

### VSCode window loses transparency for a brief moment after resizing

This is caused by VSCode refreshing the background color whenever a repaint is triggered, for example when resizing the window or closing side panes.

You can update the `vibrancy_code.refreshInterval` config variable to change how quickly the background will be changed back to be transparent, with 1ms being imperceptible. Please note that values lower than 10ms will cause a noticeable increase in CPU usage.

# Contributing

Contributions are what make the open source community such an amazing place to learn, inspire, and create. Any contributions you make are **greatly appreciated**.

If you have a suggestion that would make this better, please fork the repo and create a pull request. You can also simply open an issue with the tag "enhancement".
Don't forget to give the project a star! Thanks again!

1. Fork the Project
2. Create your Feature Branch (`git checkout -b feature/AmazingFeature`)
3. Commit your Changes (`git commit -m 'Add some AmazingFeature'`)
4. Push to the Branch (`git push origin feature/AmazingFeature`)
5. Open a Pull Request

# License

Distributed under the MIT License. See `LICENSE.txt` for more information.

## Thanks ⭐

[EYHN](https://github.com/EYHN) : for making the original extension that this is a fork of

[be5invis/vscode-custom-css](https://github.com/be5invis/vscode-custom-css) : The basis of this extension program

[DIYgod](https://github.com/microsoft/vscode/issues/32257#issuecomment-509936623) : Fix issues with VSCode 1.36
