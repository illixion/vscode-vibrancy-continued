const vscode = require('vscode');
const fs = require('fs');
const os = require('os');
const path = require('path');

/**
 * Fallback elevation path for Linux, used when pkexec can't do the job.
 *
 * pkexec only shows a graphical password prompt if a Polkit authentication
 * agent is registered. Without one it falls back to a text prompt that opens
 * /dev/tty directly — which fails outright when the caller is a GUI app with
 * no controlling terminal (common on minimal window managers that don't
 * autostart an agent). Rather than trying to predict whether an agent exists,
 * or hunting for a graphical askpass helper that may not be installed, run the
 * command in a VSCode integrated terminal: that's a real pty, so the OS's own
 * sudo prompt works with nothing extra installed.
 */

// Guard against a hung sudo prompt leaving the caller's promise pending forever.
const TIMEOUT_MS = 5 * 60 * 1000;

function shellQuote(str) {
  return `'${String(str).replace(/'/g, "'\\''")}'`;
}

/**
 * Run a shell script under `sudoCommand` in a VSCode terminal.
 *
 * Completion is detected from a status file holding the script's exit code,
 * not by scraping terminal output — Terminal Shell Integration isn't available
 * for every shell/version, and the terminal's own exit code would be that of
 * the trailing bookkeeping command rather than the payload.
 *
 * @param {{ command: string, script: string, title?: string, prompt?: string }} options
 * @returns {Promise<void>} resolves on success, rejects with `cancelled` if the
 *   user closes the terminal or aborts the prompt.
 */
function runElevatedInTerminal({ command, script, title, prompt }) {
  return new Promise((resolve, reject) => {
    let tmpDir;
    try {
      tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vibrancy-elev-'));
    } catch (err) {
      reject(new Error(`Elevation failed: ${err.message}`));
      return;
    }

    const scriptFile = path.join(tmpDir, 'elevate.sh');
    const statusFile = path.join(tmpDir, 'status');

    const cleanup = () => {
      try {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      } catch {
        // Best effort cleanup
      }
    };

    try {
      fs.writeFileSync(scriptFile, script, { mode: 0o700 });
    } catch (err) {
      cleanup();
      reject(new Error(`Elevation failed: ${err.message}`));
      return;
    }

    // `exec` on the last line so the terminal closes as soon as the payload is
    // done, which is what signals completion to onDidCloseTerminal below.
    const wrapper = [
      prompt ? `printf '%s\\n\\n' ${shellQuote(prompt)}` : null,
      `${command} sh ${shellQuote(scriptFile)}`,
      `printf '%s' "$?" > ${shellQuote(statusFile)}`,
      'exit',
    ].filter(Boolean).join('\n');

    // A bare `sh -c` shell rather than the user's configured default: no rc
    // files, no prompt customisations, and it exits when the payload does.
    const terminal = vscode.window.createTerminal({
      name: title || 'Vibrancy: administrator privileges',
      shellPath: '/bin/sh',
      shellArgs: ['-c', wrapper],
    });

    let settled = false;
    let closeListener;
    let timer;

    const finish = (fn, arg) => {
      if (settled) return;
      settled = true;
      if (closeListener) closeListener.dispose();
      if (timer) clearTimeout(timer);
      cleanup();
      fn(arg);
    };

    closeListener = vscode.window.onDidCloseTerminal((closed) => {
      if (closed !== terminal) return;

      let status = null;
      try {
        status = fs.readFileSync(statusFile, 'utf-8').trim();
      } catch {
        // No status file — the terminal was closed before the payload finished.
      }

      if (status === '0') {
        finish(resolve);
      } else if (status === null) {
        finish(reject, new Error('cancelled'));
      } else {
        // sudo exits non-zero when the user aborts the prompt or authentication
        // fails; the payload itself exits non-zero if a file operation failed.
        finish(reject, new Error(`Elevation failed: command exited with status ${status}`));
      }
    });

    timer = setTimeout(() => {
      try {
        terminal.dispose();
      } catch {
        // Terminal may already be gone
      }
      finish(reject, new Error('Elevation failed: timed out waiting for administrator privileges'));
    }, TIMEOUT_MS);

    // Focus the terminal so the user can type their password straight away.
    terminal.show();
  });
}

module.exports = { runElevatedInTerminal, shellQuote };
