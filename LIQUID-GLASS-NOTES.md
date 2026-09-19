# Liquid Glass on macOS: build, test & code-signing notes

The Liquid Glass native addon (`native/liquidglass.mm`) is AppKit code: it can
only be compiled on macOS, and the real `NSGlassEffectView` effect only exists
on macOS 26+. This document covers building the addon, testing the effect
end-to-end in VSCode, and the code-signing constraint stock VSCode puts on
third-party native addons.

> **Requirements:** macOS **26 (Tahoe)** or later for the real glass effect,
> Xcode Command Line Tools **matching your macOS/SDK version**, Node.js ≥ 18,
> and a VSCode build to test against (**VSCode Insiders** is recommended so you
> don't patch your daily editor). On macOS < 26 the feature still works — it
> just falls back to `under-window` vibrancy — so you can validate the fallback
> path there too.
>
> If you're on a **beta** macOS (e.g. an SDK named `MacOSX27.0.sdk`), the
> standalone Command Line Tools' linker is often a build behind and can't parse
> the beta SDK's `.tbd` stubs — install the matching **full Xcode** and point
> `xcode-select` at it (see Troubleshooting).

The working directory for every command below is the root of this repository:

```sh
cd <your checkout of vscode-vibrancy-continued>
```

---

## 1. Install JS deps

```sh
npm install          # node-addon-api, node-gyp, vitest, etc.
```

## 2. Build the native addon (macOS only)

This compiles `native/liquidglass.mm` into an N-API `.node`, stages it where the
installer picks it up (`native/prebuilt/liquidglass-darwin-<arch>.node`), and
runs a smoke test that loads it in plain Node:

```sh
# Just your machine's arch (fastest, all you need for local testing):
scripts/build-liquidglass.sh "$(node -p process.arch)"

# Or both arches (arm64 + x64), like CI does — needed only for a distributable VSIX:
scripts/build-liquidglass.sh
```

Expected tail of the output:

```
==> Staged prebuilts:
.../liquidglass-darwin-arm64.node:
smoke: addon loaded from .../liquidglass-darwin-arm64.node
smoke: isGlassSupported() -> true          # false on macOS < 26 — that's the fallback path
smoke: OK — NSGlassEffectView is available; VS Code will get real Liquid Glass.
```

- `isGlassSupported() -> true` means you're on macOS 26+ and will get real glass.
- `false` means macOS < 26: the addon built fine, and VSCode will fall back to
  `under-window` vibrancy (still worth confirming the fallback isn't broken).

> The addon is N-API, so **one build runs under VSCode's Electron** with no
> rebuild against Electron headers. If the x64 cross-build fails on your machine,
> don't worry — build only your own arch for local testing.

## 3. Run the JS test suite (optional, cross-platform)

Confirms the runtime/installer/manifest wiring (the guards in
`test/unit/liquid-glass.test.js`):

```sh
npm test
```

## 4. Get the extension into a VSCode to test

Pick **one** of the two routes.

### Route A — Package a VSIX and install it (recommended)

This is the real test: the extension patches the target VSCode's own files and
loads the native addon inside its Electron main process.

```sh
npm install --omit=dev                    # prod deps only, like CI
npx @vscode/vsce package                  # writes vscode-vibrancy-continued-1.2.0.vsix
```

`vsce` bundles everything not in `.vscodeignore` — including
`native/prebuilt/*.node`, so the addon you built in step 2 ships inside the VSIX.

Install into **Insiders** (or stable) and open it:

```sh
code-insiders --install-extension vscode-vibrancy-continued-1.2.0.vsix
code-insiders
```

### Route B — F5 Extension Development Host (JS-side iteration only)

Open this folder in VSCode and press **F5** (uses `.vscode/launch.json`). This
is handy for the extension-host JS, but note the extension patches the install
it runs in, so for the *native glass effect* Route A is the reliable one.

## 5. Enable the effect

In the VSCode you just launched:

1. Open Settings (JSON) and set the type (and optionally a theme):
   ```jsonc
   {
     "vscode_vibrancy.type": "liquid-glass",
     "vscode_vibrancy.theme": "Default Dark",   // any theme; liquid-glass overlay applies on top
     "vscode_vibrancy.opacity": -1              // -1 = liquid-glass default (0.6 scrim)
   }
   ```
2. `Cmd+Shift+P` → **Enable Vibrancy** (`extension.installVibrancy`).
3. Approve the elevation prompt (the extension edits VSCode's install files).
4. `Cmd+Shift+P` → **Developer: Reload Window**, or fully **quit and reopen**
   VSCode. A full restart is the reliable path — the effect is applied when the
   Electron main process creates the window.

## 6. What to look for

- **macOS 26+:** the workbench sits on real Apple Liquid Glass — the desktop
  behind the window is refracted/frosted through the native `NSGlassEffectView`,
  with the activity bar / sidebar / panel showing subtle translucent fills.
  This is visibly different from (and crisper than) the old `under-window` blur.
- **macOS < 26, or if the addon didn't load:** the window falls back to
  `under-window` vibrancy — still translucent, never broken/opaque.
- Resize the window: the glass tracks it (the native view has an autoresizing
  mask). Close and reopen windows: no leak (the view is released on `closed`).

### Confirming which path ran

The runtime logs to the Electron main process console. Launch VSCode from a
terminal to see it:

```sh
# Insiders, from Terminal:
/Applications/Visual\ Studio\ Code\ -\ Insiders.app/Contents/MacOS/Electron --enable-logging
```

- Glass active: no fallback message.
- Fallback: you'll see `Vibrancy: failed to load the Liquid Glass native addon:`
  (addon missing) or `Liquid Glass addView failed; falling back…`.

Also verify the addon was staged next to the runtime:

```sh
ls "/Applications/Visual Studio Code - Insiders.app/Contents/Resources/app/out/vscode-vibrancy-runtime-v6/"
# expect: index.mjs (or index.cjs) + liquidglass-darwin-<arch>.node + methods/ ...
```

## 7. Uninstall / revert

`Cmd+Shift+P` → **Disable Vibrancy** (`extension.uninstallVibrancy`), then
restart. This removes the injected runtime and restores VSCode's patched files.

---

## Tuning the look

The native glass is fixed (variant `2`, corner radius `12`) — edit
`LIQUID_GLASS_VARIANT` / `LIQUID_GLASS_CORNER_RADIUS` in `runtime/index.mjs`
**and** `runtime-pre-esm/index.cjs`, then re-run Enable + restart (no native
rebuild needed for those).

The translucent-surface CSS is `liquidGlassCSS()` in the same two files — adjust
the per-part `rgba(...)` alphas there. `vscode_vibrancy.opacity` controls the
overall html tint — a scrim over the glass. Left on the theme default (`-1`),
liquid-glass uses `0.6` (fully clear is unreadable over the glass); set an
explicit value to override.

## Troubleshooting

| Symptom | Likely cause / fix |
|---|---|
| Window fully opaque, no effect | Not restarted fully (quit + reopen, not just Reload Window); or Enable didn't complete / elevation was declined. |
| Old blurry vibrancy instead of glass | Running macOS < 26 (expected fallback), **or** the addon failed to load — check the main-process console (step 6). |
| `failed to load the Liquid Glass native addon` | `.node` not staged, or arch mismatch. Re-run step 2 for your arch; confirm the file in step 6 exists and matches `node -p process.arch`. |
| `smoke: isGlassSupported() -> false` on macOS 26 | Unexpected — the class lookup failed. Confirm `sw_vers -productVersion` ≥ 26. |
| x64 build fails on Apple Silicon | Fine for local testing — build only `arm64`. Cross-arch is only needed for a distributable VSIX. |
| Link fails: `tapi error: malformed file` / `unknown architecture arm64e.x1-macos` (reading `libSystem.B.tbd`, `AppKit.tbd`, …) | Your linker is older than the SDK. The `.o` compiles; only `SOLINK_MODULE` fails, on Apple's system libs — not our code. Install the **full Xcode** matching your macOS and switch to it: `sudo xcode-select -s /Applications/Xcode.app/Contents/Developer`, confirm with `xcode-select -p` and `ld -v`, then re-run step 2. If you only have Command Line Tools, reinstall the latest: `sudo rm -rf /Library/Developer/CommandLineTools && sudo xcode-select --install`. |
| `dlopen(...liquidglass-darwin-arm64.node) … different Team IDs` in the main-process log, then `falling back to under-window` | macOS library validation on a stock install — see [macOS code signing](#macos-code-signing-why-the-addon-can-be-rejected-and-the-local-workaround) below. |
| Effect gone after a VSCode update | VSCode updates overwrite the patched files — re-run **Enable Vibrancy**. |

## macOS code signing: why the addon can be rejected (and the local workaround)

VSCode ships signed by Microsoft **with the hardened runtime**, which enables
**library validation**: its main process may only `dlopen` native libraries
signed with the *same Team ID*. A `.node` produced by node-gyp is ad-hoc signed
(no team), so a stock VSCode refuses to load it:

```
dlopen(.../liquidglass-darwin-arm64.node): code signature ... not valid for
use in process: mapping process and mapped file (non-platform) have
different Team IDs
```

The runtime catches this and falls back to `under-window` vibrancy, so you get
a working-but-not-glass window instead of a crash — the same graceful
degradation as the macOS < 26 path.

**The fix is an ad-hoc re-sign of the app bundle**, which replaces every
signature (app, frameworks, helpers) with an ad-hoc one and drops the hardened
runtime — and with it, library validation — so the addon loads. **Enable
Vibrancy offers to do this for you** when the type is `liquid-glass` and the
bundle carries a foreign Team ID: a consent dialog explains the trade-offs,
and the extension runs the re-sign through its usual privilege escalation
(administrator prompt). If the automatic re-sign fails, the dialog shows the
manual command:

```sh
sudo codesign --force --deep --sign - "/Applications/Visual Studio Code - Insiders.app"
xattr -dr com.apple.quarantine "/Applications/Visual Studio Code - Insiders.app"
```

What to know before accepting (or running it yourself):

- It changes **no code** — only signatures. The notarization stamp is gone, so
  the quarantine attribute is stripped for a clean first launch.
- macOS Sequoia+ protects app bundles with the **App Management** TCC
  permission: grant it to whatever triggers the re-sign (your terminal for the
  manual command, VSCode for the automatic one — System Settings → Privacy &
  Security → App Management) or even `sudo codesign` fails with
  `Operation not permitted` (the same gate blocks plain `cp` into the bundle).
- Every auto-update restores Microsoft's signature *and* overwrites the
  vibrancy patch: Enable offers to re-sign again after each update. Undoing it
  entirely = reinstall the app.
- Prefer doing this on a throwaway install (Insiders), not your daily editor.

This is the structural constraint of the whole feature: a third-party `.node`
can never carry Microsoft's Team ID, so real Liquid Glass on macOS always
needs either a re-signed app (automated here) or a VSCode build that ships the
addon under its own signature.
