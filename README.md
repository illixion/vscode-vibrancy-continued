# Visual Studio Code Extension - Vibrancy

Enable Acrylic/Glass effect for your VS Code.

![screenshot](./screenshot.png)

[![](https://vsmarketplacebadge.apphb.com/version/eyhn.vscode-vibrancy.svg)](https://marketplace.visualstudio.com/items?itemName=eyhn.vscode-vibrancy)&nbsp;
[![](https://img.shields.io/visual-studio-marketplace/stars/eyhn.vscode-vibrancy.svg)](https://marketplace.visualstudio.com/items?itemName=eyhn.vscode-vibrancy)

[![](https://img.shields.io/github/stars/eyhn/vscode-vibrancy.svg?style=social)](https://github.com/eyhn/vscode-vibrancy)&nbsp;
[![](https://img.shields.io/github/watchers/eyhn/vscode-vibrancy.svg?style=social)](https://github.com/eyhn/vscode-vibrancy)

Links: [Github](https://github.com/eyhn/vscode-vibrancy) | [Visual Studio Code Marketplace](https://marketplace.visualstudio.com/items?itemName=eyhn.vscode-vibrancy) | [issues](https://github.com/eyhn/vscode-vibrancy/issues)

## Supported Operating Systems

Windows 7 ✔

Windows 10 ✔

MacOS ✔

## Getting Started

> Windows users please make sure you have [Visual C++ Redistributable Packages for Visual Studio 2015 x86](https://www.microsoft.com/en-us/download/details.aspx?id=48145) installed!

1. Make sure the color theme you selected is the 'Dark+ (default)'

![step-1](./step-1.png)

2. Install this extension from [the Visual Studio Code Marketplace](https://marketplace.visualstudio.com/items?itemName=eyhn.vscode-vibrancy).

3. Press F1 and Activate command "Reload Vibrancy".

![step-3](./step-3.png)

4. Restart.

Every time after Code is updated, please re-enable vibrancy.

## Warns：
This extension works by editting the vscode's css file.
So, a information appears while the first time to install or vscode update.U can click the [never show again] to avoid it.

![screenshot](./warns.png)

## Options

#### vscode_vibrancy.type (Windows Only)

Native method of Vibrancy Effect.

* auto : Automatically switch with system version.
* dwm : (Windows 7 only) Windows Aero blur.
* acrylic : (Windows 10 only) Fluent Design blur.

#### vscode_vibrancy.opacity (Windows Only)

Opacity of Vibrancy Effect.

*value: 0.0 ~ 0.1*

## FAQs

### How to uninstall?

Press F1 and Activate command "Disable Vibrancy", and Restart Visual Studio Code.

## Thanks ⭐

[be5invis/vscode-custom-css](https://github.com/be5invis/vscode-custom-css) : The basis of this extension program

[DIYgod](https://github.com/microsoft/vscode/issues/32257#issuecomment-509936623) : Fix issues with VSCode 1.36