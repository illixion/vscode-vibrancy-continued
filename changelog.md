# 1.1.61

* Themes:
  * Fix opaque terminal background in Paradise Cursor theme

# 1.1.60

* Themes:
  * Add Paradise theme Cursor support

# 1.1.59

* Core:
  * Update `window.controlsStyle` on Windows (resolves [#49](https://github.com/illixion/vscode-vibrancy-continued/issues/49))
* Docs:
  * Added a page with screenshots of various [Vibrancy Continued types](https://github.com/illixion/vscode-vibrancy-continued/blob/main/docs/vibrancy-types.md) (`vscode_vibrancy.type`)

# 1.1.58

* Themes:
  * Fix for Paradise Smoked Glass aux-bar tabs and status-bar color

# 1.1.57

* Core:
  * Added setting to force frameless VSCode window to fix rendering issues in some macOS environments (`vscode_vibrancy.forceFramelessWindow`)

# 1.1.56

* Core:
  * Fixed startup crash when used on Trae.ai IDE (resolves [#201](https://github.com/illixion/vscode-vibrancy-continued/issues/201))
* Themes:
  * Added Paradise dark and light themes by [@nickesc](https://github.com/nickesc)

# 1.1.55

* Added Cursor themes by [@RobbieMinderhoud](https://github.com/RobbieMinderhoud) and [@cncn123](https://github.com/cncn123) (resolves [#176](https://github.com/illixion/vscode-vibrancy-continued/issues/176))
  * These themes apply on top of Default Dark and Default Light
  * They can be disabled via `vscode_vibrancy.disableThemeFixes`, and otherwise load before custom imports

# 1.1.54

* Added new workbench HTML location for VSCode 1.102.0-insider

# 1.1.53

* Added link to known errors and solutions in all error messages.

# 1.1.52

* Updated uninstall hook to also attempt to restore VSCode config settings

# 1.1.51

* Reduced package size to ~1 MB by not bundling dev dependencies
* Allow frameless window mitigation to be disabled, which when combined with `--disable-gpu-compositing` on Windows resolves the issue with blurry text on VSCode 1.86 and newer

# 1.1.50

* Vibrancy will now attempt to automatically remove itself when uninstalled without running "Disable Vibrancy"
  * This doesn't cover VSCode config changes for now
* Reduced package size by not bundling node-gyp
* Fixed a regression that caused activation errors on VSCode 1.85.2

# 1.1.49

* Updated uninstall hook message
* Updated readme

# 1.1.48

* Fix activation bug related to Vibrancy installation and VSCode settings update

# 1.1.47

* Vibrancy will now update `window.systemColorTheme` and `window.autoDetectColorScheme` to fix issues related to dark/light mode auto detection, and restore them on uninstall (resolves [#165](https://github.com/illixion/vscode-vibrancy-continued/issues/165))

# 1.1.46

* Reduced package size by excluding unnecessary files
* Added an alert when uninstalling without performing the "Disable Vibrancy" action

# 1.1.45

* Windows on ARM is now supported (resolves [#9](https://github.com/illixion/vscode-vibrancy-continued/issues/9))

# 1.1.44

* Updated the code responsible for updating terminal-related settings to restore original settings on uninstallation
* Ensure terminal color changes are only applied only to the current profile ([#183](https://github.com/illixion/vscode-vibrancy-continued/issues/183))

# 1.1.43

* Update install blocking code to check Electron version directly in preparation for a future fix ([#178](https://github.com/illixion/vscode-vibrancy-continued/issues/178))

# 1.1.42

* Prevent installation on macOS and VSC 1.96.x ([#178](https://github.com/illixion/vscode-vibrancy-continued/issues/178))

# 1.1.41

* Fix incorrect syntax in non-ESM runtime, leading to crashing on Windows VSCode with certain versions

# 1.1.40

* Fix for VSCode 1.94 on Windows
  * Refactored ESM code to account for different `import` behavior on Windows compared to macOS ([#166](https://github.com/illixion/vscode-vibrancy-continued/issues/166))
* Fix for VSCode 1.95-insiders
  * VSCode 1.95-insiders seems to have reverted the recent change to make workbench.html use ESM. This also restores support for older VSCode versions.

# 1.1.39

* Add VSCode 1.94 fixes from pre-release version

# 1.1.38 (pre-release)

* Added support for VSCode 1.94 (Insiders)
* Refactored code to support the ESM version of workbench.html

# 1.1.37

* Fixed bug that prevented auto dark/light mode from detecting changes when VSCode is closed

# 1.1.36

* Automatically set terminal transparency (fix for VSCode 1.92, see [#155](https://github.com/illixion/vscode-vibrancy-continued/issues/155))

# 1.1.35

* Updated readme to enhance Windows warning visibility
* No code changes

# 1.1.34

* Add changes from 1.1.33
* Fix GitHub Actions workflow syntax that made previous version pre-release by accident

# 1.1.33 (pre-release)

* Fixed bug where minimap was not visible in the catppuccin mocha theme (PR [#134](https://github.com/illixion/vscode-vibrancy-continued/pull/134))

# 1.1.32

* Pre-releases now available
* Main branch renamed
* No code changes

# 1.1.31

* Fix automatic dark/light mode switch not working
* Allow toggling auto dark/light mode setting

# 1.1.30

* Add automatic dark/light mode switch (PR [#146](https://github.com/illixion/vscode-vibrancy-continued/pull/146))

# 1.1.29

* Implement workaround for VSCode 1.86.x on Windows (bug [#122](https://github.com/illixion/vscode-vibrancy-continued/issues/122))

# 1.1.28

* Update readme with a notice for Windows users (bug [#122](https://github.com/illixion/vscode-vibrancy-continued/issues/122))
* No code changes

# 1.1.27

* Clarified that light mode works as expected with new vibrancy types
* Updated default type for light themes
* Updated localization files

# 1.1.26

* Added all currently available BrowserWindow Electron types
* Added deprecation notice for old themes
* Updated themes to use the new types (since they're already available in VSCode 1.85)
* Updated localization files

# 1.1.25

* Added `fullscreen-ui` and `under-window` types to fix Vibrancy on VSC 1.86 ([#116](https://github.com/illixion/vscode-vibrancy-continued/issues/116))

# 1.1.24

* Updated first load check to ignore extension patch updates ([#34](https://github.com/illixion/vscode-vibrancy-continued/issues/34))
* Added a custom message for updates vs first time installation
* Prevent installation on ARM Windows due to VSCode crashes ([#9](https://github.com/illixion/vscode-vibrancy-continued/issues/9))
* Added GitHub Dark Default theme ([#102](https://github.com/illixion/vscode-vibrancy-continued/issues/102))

# 1.1.23

* Added "Custom theme" option to simplify development of new themes ([#106](https://github.com/illixion/vscode-vibrancy-continued/issues/106))

# 1.1.22

* Added Catppuccin Mocha theme ([#92](https://github.com/illixion/vscode-vibrancy-continued/issues/92))

# 1.1.21

* Updated Tokyo Night Storm theme to fix a few visual issues ([#81](https://github.com/illixion/vscode-vibrancy-continued/issues/81))
* Fixed extension not working on Windows (VSCode 1.82.0) ([#95](https://github.com/illixion/vscode-vibrancy-continued/issues/95))

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

* Add Noir et blanc theme (by [pryter](https://github.com/pryter))

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
