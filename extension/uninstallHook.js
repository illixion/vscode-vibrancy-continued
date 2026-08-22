const { execSync, spawn } = require('child_process');
const fs = require('fs').promises; // Use fs.promises for Promise-based APIs
const fsSync = require('fs'); // Import standard fs for synchronous methods
const path = require('path');
const os = require('os');
const { StagedFileWriter, checkNeedsElevation } = require('./elevated-file-writer');
const { removeJSMarkers, removeElectronOptions, removeCSPPatch, getConfigDir, ALL_VIBRANCY_BG_KEYS } = require('./file-transforms');
const { applySettingsRestore } = require('./jsonc-settings');

/**
 * When this actually runs, because it is not when you would expect.
 *
 * `vscode:uninstall` is not an exit hook. Uninstalling Vibrancy only marks it
 * for removal; nothing happens until VSCode is quit and started again, and then
 * this script runs early in *startup* — with a live VSCode around it, which then
 * carries on running. That is why the messages here ask the user to restart
 * rather than announcing that it is finished: the patched files are still loaded
 * in the very session that is running the cleanup.
 *
 * Two things follow from it.
 *
 * Startup is an awkward moment to be editing settings.json, because it is
 * roughly when VSCode is reading it. The Windows-only deferral below exists
 * because that write was reported lost there and not elsewhere.
 *
 * That report has not been reproducible. Writing settings.json from outside
 * while VSCode ran was measured on Windows 10 (VSCode 1.10x, a real workbench in
 * the interactive session), on Linux and on macOS 1.134 — during startup, after
 * startup, and across a genuinely graceful shutdown (`CloseMainWindow` returning
 * true and every process gone). The edit survived every time. VSCode also
 * demonstrably *notices* the change on Windows: removing a restart-scoped
 * setting made it raise its own "a setting has changed that requires a restart"
 * dialog. So "Windows caches settings.json and writes it back over us" is not a
 * mechanism that can be demonstrated on current versions, and no claim about one
 * is made here.
 *
 * The deferral stays regardless. The reports came from real users on
 * configurations these tests do not cover — Settings Sync, a redirected or
 * OneDrive-backed AppData, antivirus, older VSCode — and it now has a second,
 * verifiable benefit: writing after VSCode has quit is what stops that restart
 * dialog appearing mid-uninstall, since the keys being removed here
 * (window.controlsStyle, gpuAcceleration, systemColorTheme,
 * autoDetectColorScheme) are all restart-scoped.
 *
 * And the wait loop is not waiting out a shutdown already in progress. It waits
 * for the user to quit the session they have just opened, edits the file once
 * nothing holds it, then relaunches VSCode for them.
 */

/**
 * Every colour key this hook should clear out of settings.json.
 *
 * Derived rather than hand-listed: two copies of this list (here and in the
 * Windows deferred script) had already drifted apart by a key, and themes can
 * now name colour keys of their own via their `colorCustomizations` block, which
 * no hard-coded list would ever know about. So take vibrancy's built-in keys
 * plus whatever the recorded backup actually covers — that backup is written
 * from the same resolved key set that did the installing.
 *
 * This hook has no access to the vscode API, so it stays best-effort by design:
 * it can only reach the one settings.json recorded in config.json, and it only
 * recognises vibrancy's usual `#RRGGBBAA` output (a theme could in principle
 * write a short `#abc` literal, but matching shorter hex would risk deleting a
 * user's own 6-digit colour, which is worse).
 *
 * @param {Object} previousCustomizations - `previousCustomizations` from config.json
 * @returns {string[]}
 */
function resolveHookBgKeys(previousCustomizations) {
    const recorded = previousCustomizations?.vibrancyBackgrounds;
    return [...new Set([
        ...ALL_VIBRANCY_BG_KEYS,
        ...(recorded && typeof recorded === 'object' ? Object.keys(recorded) : []),
    ])].filter((key) => key !== 'terminal.background');
}

function getVSCodeSettingsPath(configSettingsPath) {
    // Prefer the path stored in local config (supports Insiders, Cursor, etc.)
    if (configSettingsPath) {
        return configSettingsPath;
    }
    // Fallback to standard VSCode path
    const platform = os.platform();
    const home = os.homedir();

    if (platform === 'win32') {
        return path.join(process.env.APPDATA, 'Code', 'User', 'settings.json');
    } else if (platform === 'darwin') {
        return path.join(home, 'Library', 'Application Support', 'Code', 'User', 'settings.json');
    } else {
        return path.join(home, '.config', 'Code', 'User', 'settings.json');
    }
}

/**
 * Turn a recorded backup into the set of edits that undoes Vibrancy's writes.
 *
 * Shared by the direct path and the deferred Windows one so both revert
 * identically — the two used to be hand-maintained regex lists that had already
 * drifted apart by a key.
 *
 * `null` means "remove it"; anything else is the user's own value going back in.
 * When no backup was saved at all, every managed key is removed rather than
 * restored: without a record there is nothing to restore *to*, and leaving
 * Vibrancy's translucent colours behind is the one outcome that definitely
 * looks broken once the effect is gone.
 *
 * @param {Object} previousCustomizations - `previousCustomizations` from config.json
 * @returns {{colors: Object, settings: Object}} a plan for applySettingsRestore
 */
function buildRestorePlan(previousCustomizations) {
    const saved = previousCustomizations?.saved ? previousCustomizations : null;
    const savedBgs = saved?.vibrancyBackgrounds || {};

    const colors = {};
    for (const key of resolveHookBgKeys(previousCustomizations)) {
        colors[key] = savedBgs[key] ?? null;
    }

    // `#00000000` is Vibrancy's own forced transparency, never a value worth
    // handing back even if it somehow ended up in the backup.
    const savedTerminal = saved?.terminalBackground;
    colors['terminal.background'] = savedTerminal != null && savedTerminal !== '#00000000' ? savedTerminal : null;

    // Set by promptRestart, never something the user chose, so it always goes.
    const settings = { 'window.controlsStyle': null };

    // The other three are only touched when there *is* a backup, and that
    // asymmetry with the colours above is deliberate. Vibrancy sets
    // `gpuAcceleration: "off"` — but so might the user, and with no record of
    // which it was, removing it would silently undo their setting. Leaving it
    // costs nothing visible. Translucent colours are the opposite: left behind
    // once the effect is gone, they look unmistakably broken, so those are
    // cleared either way.
    if (saved) {
        settings['window.systemColorTheme'] = saved.systemColorTheme ?? null;
        settings['window.autoDetectColorScheme'] = saved.autoDetectColorScheme ?? null;
        settings['terminal.integrated.gpuAcceleration'] = saved.gpuAcceleration ?? null;
    }

    return { colors, settings };
}

/**
 * Revert Vibrancy's settings.json writes.
 *
 * Goes through jsonc-parser rather than regex substitution: see the header of
 * jsonc-settings.js for why. The practical difference here is that a colour key
 * is now matched by its position under `workbench.colorCustomizations` instead
 * of by name anywhere in the file, restored values keep the file's own
 * indentation, and a settings.json that fails to parse is left alone rather
 * than being edited into something worse.
 */
function restorePreviousSettings(previousCustomizations, configSettingsPath) {
    const settingsPath = getVSCodeSettingsPath(configSettingsPath);

    if (!fsSync.existsSync(settingsPath)) {
        console.error('VSCode settings.json not found!');
        return;
    }

    let settingsContent = '';
    try {
        settingsContent = fsSync.readFileSync(settingsPath, 'utf-8');
    } catch (err) {
        console.error('Failed to read settings.json:', err);
        return;
    }

    const { text, changed, errors } = applySettingsRestore(
        settingsContent,
        buildRestorePlan(previousCustomizations),
    );

    if (errors.length > 0) {
        console.error(
            'Vibrancy: settings.json could not be parsed, leaving it untouched. ' +
            'Remove Vibrancy\'s colour customizations by hand if they are still there.',
        );
        return;
    }

    if (!changed) {
        console.log('VSCode settings.json had nothing left to revert.');
        return;
    }

    try {
        fsSync.writeFileSync(settingsPath, text, 'utf-8');
        console.log('VSCode settings.json successfully reverted.');
    } catch (err) {
        console.error('Failed to write settings.json:', err);
    }
}

/**
 * Stage a self-contained copy of the restore logic in a temp directory.
 *
 * The deferred cleanup does not run until the user quits the session that
 * started this hook, and this extension directory is long gone by then — VSCode
 * removes it during the same startup, once the hook returns. So the code that
 * does the work has to be somewhere else by the time it is needed: a copy of
 * jsonc-settings.js, the jsonc-parser package it imports (positioned in a
 * `node_modules` so its bare `require` still resolves), the restore plan, and a
 * small entry point.
 *
 * @returns {{dir: string, entry: string}|null} null when staging failed
 */
function stageDeferredRestore(settingsPath, plan) {
    const dir = path.join(os.tmpdir(), `vibrancy-cleanup-${Date.now()}`);

    try {
        const parserRoot = path.dirname(require.resolve('jsonc-parser/package.json'));
        fsSync.mkdirSync(path.join(dir, 'node_modules'), { recursive: true });
        fsSync.cpSync(parserRoot, path.join(dir, 'node_modules', 'jsonc-parser'), { recursive: true });
        fsSync.copyFileSync(path.join(__dirname, 'jsonc-settings.js'), path.join(dir, 'jsonc-settings.js'));
        fsSync.writeFileSync(path.join(dir, 'plan.json'), JSON.stringify({ settingsPath, plan }, null, 2), 'utf-8');

        const entry = path.join(dir, 'restore.js');
        fsSync.writeFileSync(entry, [
            `const fs = require('fs');`,
            `const path = require('path');`,
            `const { applySettingsRestore } = require('./jsonc-settings');`,
            `const job = JSON.parse(fs.readFileSync(path.join(__dirname, 'plan.json'), 'utf-8'));`,
            `if (!fs.existsSync(job.settingsPath)) { console.log('settings.json not found'); process.exit(0); }`,
            `const before = fs.readFileSync(job.settingsPath, 'utf-8');`,
            `const result = applySettingsRestore(before, job.plan);`,
            `if (result.errors.length > 0) { console.error('settings.json did not parse, left untouched'); process.exit(2); }`,
            `if (!result.changed) { console.log('nothing left to revert'); process.exit(0); }`,
            `fs.writeFileSync(job.settingsPath, result.text, 'utf-8');`,
            `console.log('reverted ' + (before.length - result.text.length) + ' bytes');`,
            ''].join('\n'), 'utf-8');

        return { dir, entry };
    } catch (err) {
        console.error('Vibrancy: could not stage the deferred settings cleanup:', err);
        try { fsSync.rmSync(dir, { recursive: true, force: true }); } catch {}
        return null;
    }
}

/** Single-quote a value for PowerShell, where doubling escapes the quote. */
function psQuote(value) {
    return `'${String(value).replace(/'/g, "''")}'`;
}

/**
 * Build the deferred-cleanup PowerShell script.
 *
 * Pure, and exported, so the riskiest part of the uninstall can be inspected and
 * run somewhere other than a real uninstall. It used to be an inline template
 * string, which is how it stayed untested long enough for its two regex lists to
 * drift from the POSIX ones.
 *
 * The division of labour: PowerShell waits for VSCode to exit, then hands the
 * actual edit to the staged node bundle, so Windows and POSIX revert through the
 * same code. VSCode's own binary is the interpreter — Electron runs as plain node
 * given ELECTRON_RUN_AS_NODE, and it is the one runtime guaranteed to be present
 * on the machine. Launching it only *after* the wait loop matters: started any
 * earlier it would itself count as a running instance and the loop would spin
 * forever.
 *
 * @param {Object} opts
 * @param {string} opts.exeName - VSCode's process name, e.g. "Code - Insiders"
 * @param {string} opts.nodePath - Interpreter (VSCode's own executable)
 * @param {string} opts.entry - Staged restore script
 * @param {string} opts.stageDir - Staged bundle directory, removed afterwards
 * @param {string} opts.cliCommand - How to relaunch VSCode
 * @param {string} opts.logPath - Where to append progress
 * @returns {string} the script, CRLF-joined
 */
function buildDeferredScript({ exeName, nodePath, entry, stageDir, cliCommand, logPath }) {
    return [
        `$log = ${psQuote(logPath)}`,
        `function Log($msg) { Add-Content -Path $log -Value "$(Get-Date -Format o) $msg" }`,
        `Log "Vibrancy cleanup started"`,
        `$proc = ${psQuote(exeName)}`,
        `$node = ${psQuote(nodePath)}`,
        `$script = ${psQuote(entry)}`,
        `$stage = ${psQuote(stageDir)}`,
        `$out = "$stage.out"`,
        `$err = "$stage.err"`,
        `Log "Waiting for $proc to exit..."`,
        // Wait for all instances of the VSCode exe to exit
        `while (Get-Process -Name $proc -ErrorAction SilentlyContinue) { Start-Sleep -Seconds 1 }`,
        `Start-Sleep -Seconds 2`,
        `Log "Process exited, reverting settings via $script"`,
        `$env:ELECTRON_RUN_AS_NODE = '1'`,
        // Start-Process -Wait, deliberately, and not `& $node $script`. Code.exe
        // is a GUI-subsystem binary, so PowerShell neither waits for it nor
        // connects its stdout: measured on a real Windows box, that form
        // returned in 8ms with the restore not having run at all. Everything
        // below would then race it — deleting the staged bundle out from under
        // a process still starting up, and relaunching VSCode in time to
        // re-cache the very settings we were about to edit, which is the exact
        // race this whole deferral exists to avoid.
        `try {`,
        `  $p = Start-Process -FilePath $node -ArgumentList @($script) -Wait -NoNewWindow -RedirectStandardOutput $out -RedirectStandardError $err -PassThru`,
        `  Log "Restore exit $($p.ExitCode): $(((Get-Content $out, $err -Raw -ErrorAction SilentlyContinue) -join ' ').Trim())"`,
        `} catch {`,
        `  Log "Restore failed: $_"`,
        `}`,
        `Remove-Item $stage -Recurse -Force -ErrorAction SilentlyContinue`,
        `Remove-Item $out, $err -Force -ErrorAction SilentlyContinue`,
        // Relaunch VSCode
        `Log "Relaunching: $(${psQuote(cliCommand)})"`,
        `Start-Process ${psQuote(cliCommand)}`,
        `Log "Cleanup complete, removing script"`,
        `Remove-Item $MyInvocation.MyCommand.Path -Force`,
    ].join('\r\n');
}

// Hand the edit to a detached PowerShell script that waits for VSCode to be
// quit, applies it while nothing holds the file, and reopens VSCode afterwards.
// See the note at the top of this file for what is and is not established about
// why Windows needs this.
function deferSettingsRestoreWindows(settingsPath, cliCommand, previousCustomizations) {
    const staged = stageDeferredRestore(settingsPath, buildRestorePlan(previousCustomizations));
    if (!staged) {
        // Best-effort fallback: write now and accept that VSCode may overwrite
        // it on exit. A cleanup that sometimes sticks beats none at all.
        restorePreviousSettings(previousCustomizations, settingsPath);
        return;
    }

    const psScript = buildDeferredScript({
        exeName: path.basename(process.execPath, '.exe'), // e.g. "Code - Insiders"
        nodePath: process.execPath,
        entry: staged.entry,
        stageDir: staged.dir,
        cliCommand: cliCommand || 'code',
        logPath: path.join(os.tmpdir(), 'vibrancy-cleanup.log'),
    });

    const scriptPath = path.join(os.tmpdir(), `vibrancy-cleanup-${Date.now()}.ps1`);
    fsSync.writeFileSync(scriptPath, psScript, 'utf-8');
    spawn('powershell.exe', [
        '-NoProfile', '-ExecutionPolicy', 'Bypass', '-WindowStyle', 'Hidden', '-File', scriptPath,
    ], { detached: true, stdio: 'ignore' }).unref();
}

function showFatalError(message) {
    if (process.platform === 'win32') {
        try {
            const vbs = `MsgBox "${String(message).replace(/"/g, '""')}", 16, "Vibrancy Continued"`;
            const vbsPath = path.join(os.tmpdir(), `vibrancy-fatal-${Date.now()}.vbs`);
            fsSync.writeFileSync(vbsPath, vbs);
            execSync(`wscript "${vbsPath}"`, { stdio: 'ignore' });
            try { fsSync.unlinkSync(vbsPath); } catch {}
        } catch {}
    } else {
        try { execSync(`zenity --error --title="Vibrancy Continued" --text="${String(message).replace(/"/g, '\\"')}"`); } catch {}
    }
}

// Exported for testing
module.exports = {
    restorePreviousSettings,
    getVSCodeSettingsPath,
    resolveHookBgKeys,
    buildRestorePlan,
    stageDeferredRestore,
    buildDeferredScript,
};

// Only run uninstall logic when invoked directly as a script (not when required by tests)
if (require.main === module) (async () => {
  try {
    const configDir = getConfigDir('vscode-vibrancy-continued');
    const configFilePath = path.join(configDir, 'config.json');

    function loadConfig() {
        if (fsSync.existsSync(configFilePath)) {
            try {
                return JSON.parse(fsSync.readFileSync(configFilePath, 'utf-8'));
            } catch (err) {
                console.error(
                    'Vibrancy: config.json is corrupt or unreadable, treating as absent:',
                    err.message
                );
                return null;
            }
        }
        return null;
    }

    async function uninstallJS(jsFilePath, electronJsFilePath, writer) {
        let JS = await fs.readFile(jsFilePath, 'utf-8');
        const { result, hadMarkers } = removeJSMarkers(JS);
        JS = result;

        if (electronJsFilePath === jsFilePath) {
            // Since VSCode 1.95, both files are the same — apply all cleanups to one buffer
            JS = removeElectronOptions(JS);
            await writer.writeFile(jsFilePath, JS, 'utf-8');
        } else {
            if (hadMarkers) {
                await writer.writeFile(jsFilePath, JS, 'utf-8');
            }
            const ElectronJS = await fs.readFile(electronJsFilePath, 'utf-8');
            await writer.writeFile(electronJsFilePath, removeElectronOptions(ElectronJS), 'utf-8');
        }
    }

    async function uninstallHTML(htmlFilePath, writer) {
        const HTML = await fs.readFile(htmlFilePath, 'utf-8');
        const newHTML = removeCSPPatch(HTML);
        if (newHTML !== HTML) {
            await writer.writeFile(htmlFilePath, newHTML, 'utf-8');
        }
    }

    // Blocking notification — must complete before continuing (e.g. pre-UAC warning)
    function showNotificationSync(message, title = 'Vibrancy Continued') {
        if (process.platform === 'win32') {
            const vbs = `MsgBox "${message.replace(/"/g, '""')}", 64, "${title.replace(/"/g, '""')}"`;
            const vbsPath = path.join(os.tmpdir(), `vibrancy-notify-${Date.now()}.vbs`);
            fsSync.writeFileSync(vbsPath, vbs);
            execSync(`wscript "${vbsPath}"`, { stdio: 'ignore' });
            try { fsSync.unlinkSync(vbsPath); } catch {}
        } else if (process.platform === 'darwin') {
            const escapedMessage = message.replace(/'/g, "\\'").replace(/"/g, '\\"');
            execSync(`osascript -e 'display alert "${title}" message "${escapedMessage}" as critical'`);
        } else {
            const escapedMessage = message.replace(/'/g, "\\'").replace(/"/g, '\\"');
            execSync(`zenity --info --title="${title}" --text="${escapedMessage}"`);
        }
    }

    // Fire-and-forget notification — survives the Node process exiting
    function showNotification(message) {
        if (process.platform === 'win32') {
            const js = `javascript:var sh=new ActiveXObject('WScript.Shell'); sh.Popup('${message.replace(/'/g, "\\'")}', 0, 'Vibrancy Continued', 64); close()`;
            spawn('mshta', [js], { detached: true, stdio: 'ignore' }).unref();
        } else if (process.platform === 'darwin') {
            const escapedMessage = message.replace(/'/g, "\\'").replace(/"/g, '\\"');
            spawn('/bin/sh', ['-c', `osascript -e 'display alert "Vibrancy Continued" message "${escapedMessage}" as critical'`], { detached: true, stdio: 'ignore' }).unref();
        } else {
            const escapedMessage = message.replace(/'/g, "\\'").replace(/"/g, '\\"');
            spawn('/bin/sh', ['-c', `zenity --info --title="Vibrancy Continued" --text="${escapedMessage}"`], { detached: true, stdio: 'ignore' }).unref();
        }
    }

    const config = loadConfig();
    if (config) {
        const { workbenchHtmlPath, jsPath, electronJsPath, settingsJsonPath, cliCommand, previousCustomizations, nixMirrorBase, nixDesktopEntry } = config;

        // Determine elevation needs from the JS file path (part of VSCode install dir)
        const appDir = path.dirname(jsPath);
        const needsElevation = checkNeedsElevation(appDir);

        // Skip installs on immutable filesystems where no files were patched
        // in place (Snap) or where elevation can't help ('nix'/'immutable').
        // On NixOS the patched files live in the $HOME mirror (writable, so
        // needsElevation is false) — the store paths never appear here.
        if (needsElevation !== 'snap' && needsElevation !== 'nix' && needsElevation !== 'immutable') {
            if (needsElevation) {
                showNotificationSync(
                    "Vibrancy Continued was uninstalled and needs to revert changes to VSCode's internal files. " +
                    "You will be prompted for administrator privileges.",
                );
            }

            const writer = new StagedFileWriter(needsElevation === true);
            await writer.init();

            let fileOpsError = null;
            try {
                await uninstallJS(jsPath, electronJsPath, writer);
                await uninstallHTML(workbenchHtmlPath, writer);
                await writer.flush();
            } catch (err) {
                writer.cleanup();
                // On NixOS the patched files live in a $HOME mirror that may
                // already be gone (removed by Disable or nix GC churn) — a
                // missing file is not a failed revert there.
                if (!(nixMirrorBase && err && err.code === 'ENOENT')) {
                    fileOpsError = err;
                    console.error('Failed to revert VSCode files:', err);
                }
            }

            // NixOS shadow install: remove the $HOME mirror and its desktop
            // entry entirely — reverting the copy is not enough, the whole
            // shadow install belongs to this extension.
            if (nixMirrorBase) {
                try {
                    // Guard against Electron asar path interception (no-op in plain node)
                    process.noAsar = true;
                    // Interrupted mirror copies keep the store's non-writable
                    // dir modes, which rmSync can't delete — chmod first
                    try { execSync(`chmod -R u+w "${nixMirrorBase}"`, { stdio: 'ignore' }); } catch {}
                    fsSync.rmSync(nixMirrorBase, { recursive: true, force: true });
                    if (nixDesktopEntry) {
                        fsSync.rmSync(nixDesktopEntry, { force: true });
                    }
                } catch (err) {
                    console.error('Failed to remove Vibrancy mirror:', err);
                }
            }

            if (process.platform === 'win32') {
                // Windows was reported to lose a settings.json write made during
                // startup, which is when this hook runs — so defer it until
                // VSCode is quit. Deferring also keeps VSCode's own
                // "restart to apply" dialog out of the uninstall.
                deferSettingsRestoreWindows(settingsJsonPath || getVSCodeSettingsPath(), cliCommand, previousCustomizations);
            } else {
                restorePreviousSettings(previousCustomizations, settingsJsonPath);
            }

            if (fileOpsError) {
                showNotification("Vibrancy Continued: Failed to revert VSCode files. You may need to reinstall VSCode or manually revert changes.");
            } else if (process.platform !== 'win32') {
                // On Windows the deferred script relaunches VSCode automatically
                showNotification("Vibrancy Continued has been removed. Please restart VSCode to apply changes.");
            }
        }
    }
  } catch (fatalError) {
    showFatalError(`Uninstall hook crashed: ${fatalError && fatalError.message || fatalError}`);
  }
})();