# 1.1.23

* Added "Custom theme" option to simplify development of new themes (#106)

# 1.1.22

* Added Catppuccin Mocha theme (#92)

# 1.1.21

* Updated Tokyo Night Storm theme to fix a few visual issues (#81)
* Fixed extension not working on Windows (VSCode 1.82.0) (#95)

# 1.1.20

* Fix implementation bug of background window transparency on macOS

# 1.1.19

* Set visualEffectState of the VSCode window to enable transparency while not in focus on macOS

# 1.1.18

* Added support for Jupyter notebook files (by @dike-okayama)

# 1.1.17

* Added a more descriptive error when workbench.html is different from what is expected (fixes `ReferenceError: newHTML is not defined`)

# 1.1.16

* Added input validation to the opacity setting
* Updated the description to clarify that -1 means use theme-specified opacity.

# 1.1.15

* Updated the install/uninstall function to work with VSCode v1.78.0

# 1.1.14

* No code changes, re-deploying a failed build due to a broken badge URL in README.

# 1.1.13

* Added new method to prevent window flashing when it's being resized. Enabled by default, but can be disabled in settings if it causes issues. Thanks [@arily](https://github.com/arily)!
* Disable native window controls when enabling Vibrancy (Windows only)
* Added a workaround for .node files being locked by VSCode as "in use", enabling/reloading Vibrancy now doesn't require manually deleting the `runtime` folder.
* Code improvements

# 1.1.12

* Fix rimraf not working correctly on Windows by reimplementing a recursive delete ourselves

# 1.1.11

* Hotfix for extension not working due to an incorrect dependency being installed

# 1.1.10

* Switch to rimraf to clean the runtime folder before updating it (fixes EEXIST error on Windows)
* Update Windows 10 fix to no longer cause issues with snapping

# 1.1.9

* Changed background transparency refresh interval to 10, which makes brief flashes when changing window size less noticeable

* Added config option to control the background transparency refresh interval

# 1.1.8

* Moved custom imports loading to extension code, as it was broken before due to CSP

# 1.1.7

* Added new theme: Solarized Dark+

# 1.1.6

* Force extension to be local-only

# 1.1.5

* Added Tokyo Night Storm theme

# 1.1.4

* Fix disable action not fully restoring files
* Fix inconsistent behavior when re-enabling
* Change activation events to *

# 1.1.3

* Extension is no longer in preview

# 1.1.2

* Update readme

# 1.1.1

Add Noir et blanc theme (by [pryter](https://github.com/pryter))

# 1.1.0

* Fix extension not working in VS Code 1.70.0 (by [slanterns](https://github.com/slanterns))
* Update activation events
* Extension is now maintained by [Illixion](https://github.com/illixion)

# 1.0.16

* fix: turn off gpuAcceleration
* fix: vscode 1.57.0

# 1.0.14

* fix: not work with Customize UI
# 1.0.13

* fix: not working in vscode 1.53.0-insider

# 1.0.12

* feat: Add "Light (Only Subbar)" theme

# 1.0.11

* fix: Optimize the fullscreen style fixed #82

# 1.0.10

* New runtime implementation.
* fix: win10 dragging lay
* Remove win7 support

# 1.0.9

* fix: Disable auto restart
* i18n: Add Japanese translations
* fix: Support vscode 1.41.1

# 1.0.8

* fix: Support vscode 1.41.0

# 1.0.7

* fix: multiple pop-ups when color theme is changed
* fix: opacity in win10
* docs: Add macOS theme screenshots
* docs: Add solution to removing [Unsupported] on VS Code's titlebar

# 1.0.6

* fix: Delete the wrong ',' in the generated html
* feat: The opacity option is now also available for macos.
By default, Macos has a background with opacity of 0.3.

* feat: new light theme
* fix: support import file path begin with 'file://'
* feat: i18n zh-cn
* feat: macos effect type
You can change the effect type of macos, but generally 'auto' is the best.

* fix: multiple pop-ups when config is changed


# 1.0.5

* fix: support v1.37.0
* feat: auto config terminal renderer type
If there is no "terminal.integrated.rendererType" in the global configuration, it will be set to "dom".

* feat: auto restart vscode

# 1.0.4

* feat: theme system
* feat: custom import css/js file
* fix: Auto reload error when config is changed

# 1.0.3

* No longer dependent on the Visual C++ 2015
* docs: update README

# 1.0.2

* feat: Windows7 support
* feat: Configurable opacity
* feat: User-friendly installation prompt dialog

> Windows users please make sure you have [Visual C++ Redistributable Packages for Visual Studio 2015 x86](https://www.microsoft.com/en-us/download/details.aspx?id=48145) installed!
