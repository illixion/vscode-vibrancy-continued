# CLAUDE.md

## Project Overview

VSCode extension that applies vibrancy/transparency effects to the Visual Studio Code UI. Works by modifying VSCode's internal files (workbench HTML, main JS, Electron JS) and injecting runtime modules.

## Key Architecture

### Extension entry point
- `extension/index.js` — Main extension logic: install, uninstall, update flows
- `extension/elevated-file-writer.js` — Cross-platform elevated file operations (UAC on Windows, pkexec on Linux, osascript on macOS)
- `extension/platform.js` — Platform detection
- `extension/uninstallHook.js` — Cleanup on extension uninstall

### Runtime modules
- `runtime/` — ESM runtime injected into VSCode's workbench (modern VSCode)
- `runtime-pre-esm/` — CJS runtime for older VSCode versions
- `native/` — C++ native modules for Windows vibrancy effects; prebuilt binaries in `native/prebuilt/`

### Themes and i18n
- `themes/` — Theme configuration and CSS files
- `package.nls.json`, `package.nls.ja.json`, `package.nls.zh-CN.json` — Localization strings

## Important Patterns

### StagedFileWriter (elevated-file-writer.js)
All file modifications to VSCode's install directory go through `StagedFileWriter`. When elevation is needed, writes are staged to a temp directory and executed in a single elevated operation. Never bypass the writer with direct `fs` calls to the VSCode install path.

### ElectronJSFile === JSFile (VSCode 1.95+)
Since VSCode 1.95, the Electron main.js and workbench main.js are the same file. Any code that reads/writes both must handle this: use a single in-memory buffer for all modifications to avoid the second disk read (from the elevated staged path) overwriting the first write.

### Windows elevation uses PowerShell, not batch
The elevated copy on Windows uses PowerShell cmdlets (`Copy-Item`, `Remove-Item`, `New-Item`) with `-EncodedCommand` (Base64 UTF-16LE) passed through `Start-Process -Verb RunAs`. This avoids batch script quoting pitfalls (`rem` eating command chains, `&&` cascading failures, parentheses in paths).

### Windows .node file locking
Windows hard-locks `.node` native modules while VSCode is running. The elevated PowerShell script uses `-ErrorAction SilentlyContinue` on `Remove-Item` so locked files don't abort the entire operation. This is expected and acceptable — the locked files are replaced on next restart.

### Concurrency guard
`operationInProgress` flag in `index.js` prevents concurrent Install/Update/Uninstall operations. The `onDidChangeConfiguration` handler is suppressed during operations to prevent `applyPostInstallSettings()` (which changes VSCode settings) from triggering a spurious Update cycle.

## Build & Test

This is a VSCode extension — no build step required. Load it via F5 (Run Extension) in VSCode for testing or ask the user for manual testing. The extension modifies VSCode's own installation files, so test with care.

## Branches

- `main` — Release branch
- `development` — Active development branch
