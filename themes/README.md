## Adding a new theme to Vibrancy Continued

Thank you for your interest in creating a new theme for this project! This document will guide you through the process of creating a new theme.

### Step 1: Creating a new theme file

When creating a new theme, you may want to start off with an existing theme to familiarize yourself with the CSS selectors that VSCode uses. Default Dark is a good starting off point. Don't forget to create the associated JSON file to store the default Vibrancy settings for your theme.

#### Tuning the color customizations from your theme's JSON

CSS is only half of what makes a surface translucent. Vibrancy also writes
`workbench.colorCustomizations` for a fixed set of background keys — the editor,
side bar, tabs, panel and so on — deriving each value from your theme's
`background` and the user's opacity. Those colors are what
`var(--vscode-editor-background)` and friends resolve to, so a CSS rule alone
can't make a surface opaque again if the underlying color key is translucent.

If your theme only wants *part* of the workbench translucent, add an optional
`colorCustomizations` block to its JSON. Each entry names a color key and takes
one of three forms:

| Spec | Effect |
| --- | --- |
| `0`–`1` | Alpha applied to that key's base color (the user's own value for the key if they set one, otherwise your theme's `background`). |
| `"#RRGGBB"` / `"#RRGGBBAA"` | Written verbatim. `#RGB` and `#RGBA` also work. |
| `null` | **Unmanaged** — Vibrancy writes nothing for this key, so the active color theme's own value applies. |

For an "only subbar"-style theme — vibrancy on the chrome, a normal opaque
editor — `null` is almost always what you want for the editor keys. An alpha of
`1` would technically be opaque, but every key would be flattened to the same
`background` color, so tabs, breadcrumbs and the gutter would all lose their
distinct shades. Opting out keeps each key's real color and the region renders
exactly like stock VSCode:

```json
"colorCustomizations": {
  "editor.background": null,
  "editorGroupHeader.tabsBackground": null,
  "tab.activeBackground": null,
  "panel.background": null,
  "terminal.background": null
}
```

Two things worth knowing:

* You can name keys Vibrancy doesn't normally touch (e.g. `statusBar.background`).
  They're backed up and cleaned out on disable just like the built-in ones.
* `terminal.background` is otherwise forced fully transparent, so opting out of
  it is the way to give the panel an opaque terminal.

Users who'd rather manage all of this themselves can still switch the whole
mechanism off with `vscode_vibrancy.disableColorCustomizations`, which skips your
theme's block along with Vibrancy's own defaults.

### Step 2: Testing the theme

Vibrancy Continued has a "Custom theme" setting that allows you to enable Vibrancy without loading an existing theme. This allows you to utilize the `vscode_vibrancy.imports` setting to load your new theme and test it live. Simply specify the full path to the CSS file in the `vscode_vibrancy.imports` array, ensuring that you're using forward slashes if you're on Windows, and reload Vibrancy afterwards (as well as whenever the file changes.)

### Step 3: Submitting your theme

Once you are satisfied with your theme, you can submit it to this repository by creating a pull request. You are free to submit just the CSS file, and the maintainers will perform any necessary changes to integrate it. However, you are free to make those changes yourself, and you can use [this PR as an example](https://github.com/illixion/vscode-vibrancy-continued/pull/92/files).

### Step 4: Updating your theme

If you need to make changes to your theme, you can do so by forking this repository and creating a new pull request. Your changes will be published with the next Vibrancy release, although you can request a hotfix release if necessary.
## Don't add a full-screen fallback

Themes used to carry a `.monaco-workbench.fullscreen { background-color: … }`
rule that painted an opaque background in full screen. It was removed in 1.1.92
after testing showed the selector no longer matches anything — a probe colour
set on that rule produced no change on screen, while a marker rule in the same
stylesheet applied normally.

It also isn't wanted any more. On Windows and Linux a full-screen window still
has the desktop behind it, so the effect works there and an opaque fallback
would be a regression. On macOS full screen moves the window to its own Space
with nothing rendered behind it, so the effect can't work regardless of what the
CSS says.
