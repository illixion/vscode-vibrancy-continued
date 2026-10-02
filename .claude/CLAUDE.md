## Project Overview

VSCode extension that applies vibrancy/transparency effects to the Visual Studio Code UI. Works by modifying VSCode's internal files (workbench HTML, main JS, Electron JS) and injecting runtime modules.

## Key Architecture

### Extension entry point
- `extension/index.js` — Main extension logic: install, uninstall, update flows
- `extension/elevated-file-writer.js` — Cross-platform elevated file operations (UAC on Windows, pkexec on Linux, osascript on macOS)
- `extension/platform.js` — Platform detection
- `extension/uninstallHook.js` — Cleanup on extension uninstall

### Runtime modules
- `runtime-pre-esm/` — the CJS runtime injected into VSCode's main process, and the only runtime. The name is historical: an ESM `runtime/` existed solely for VSCode 1.94's `workbench.esm.html` layout and was removed when the floor went to 1.95.
- `native/` — C++ native modules for Windows vibrancy effects; prebuilt binaries in `native/prebuilt/`

### Themes and i18n
- `themes/` — Theme configuration and CSS files
- `package.nls.json`, `package.nls.ja.json`, `package.nls.zh-CN.json` — Localization strings

## Important Patterns

### StagedFileWriter (elevated-file-writer.js)
All file modifications to VSCode's install directory go through `StagedFileWriter`. When elevation is needed, writes are staged to a temp directory and executed in a single elevated operation. Never bypass the writer with direct `fs` calls to the VSCode install path.

### One main.js carries both patches
The minimum supported VSCode is 1.95 (`engines.vscode`), where the Electron main entry and the workbench main are the same `main.js`. The window-options patch and the runtime injection must be applied to a single in-memory buffer: re-reading the file between them (from the elevated staged path) returns the pristine original and drops the first patch.

### Windows elevation uses PowerShell, not batch
The elevated copy on Windows uses PowerShell cmdlets (`Copy-Item`, `Remove-Item`, `New-Item`) with `-EncodedCommand` (Base64 UTF-16LE) passed through `Start-Process -Verb RunAs`. This avoids batch script quoting pitfalls (`rem` eating command chains, `&&` cascading failures, parentheses in paths).

### Windows .node file locking
Windows hard-locks `.node` native modules while VSCode is running. The elevated PowerShell script uses `-ErrorAction SilentlyContinue` on `Remove-Item` so locked files don't abort the entire operation. This is expected and acceptable — the locked files are replaced on next restart.

### Concurrency guard
`operationInProgress` flag in `index.js` prevents concurrent Install/Update/Uninstall operations. The `onDidChangeConfiguration` handler is suppressed during operations to prevent `applyPostInstallSettings()` (which changes VSCode settings) from triggering a spurious Update cycle.

## Build & Test

This is a VSCode extension — no build step required. Load it via F5 (Run Extension) in VSCode for testing or ask the user for manual testing. The extension modifies VSCode's own installation files, so test with care.

### Running tests locally

After making changes, run the unit/integration tests (same as CI minus E2E):

```sh
npm install   # ensure deps are up to date
npm test      # runs `vitest run`
```

Do **not** run E2E tests (`npm run test:e2e`) locally — they require platform-specific setup (xvfb, native module builds, etc.) and are handled by CI.

## Branches

- `main` — Release branch
- `development` — Active development branch
