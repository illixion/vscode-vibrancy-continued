// macOS has no reliable detached quit+relaunch path, so promptRestart triggers
// VSCode's built-in "restart to take effect" prompt by flipping
// window.titleBarStyle to the opposite value and immediately restoring it.
// The flipped value is genuinely persisted to settings.json for a moment,
// which makes the trick fragile: a quit/reload between the two writes, a
// failed restore write (e.g. settings.json open and dirty), or a second
// toggle reading the transient flipped value as the "original" all strand
// titleBarStyle on the wrong value — and a stranded "native" hides the
// window controls on a vibrancy-patched (frameless) window with no obvious
// user-facing fix.
//
// The sequencing here makes the toggle self-healing: the pre-toggle value is
// recorded in globalState BEFORE the first write and cleared only after a
// successful restore, so activate() can finish the restore after any
// interruption, and a concurrent toggle reuses the recorded original instead
// of re-reading a mid-toggle value.

const TITLEBAR_RESTORE_KEY = 'macTitleBarStyleRestore';

// globalState can't hold undefined as a value (it means "delete"), so an
// unset original is stored as null and mapped back on read.
function originalFromSentinel(sentinel) {
  return sentinel.value === null ? undefined : sentinel.value;
}

/**
 * Flip window.titleBarStyle away and back to pop VSCode's restart prompt.
 *
 * @param {Object} deps
 * @param {Object} deps.settingsStore - Settings read/write interface
 * @param {(key: string) => { globalValue: any } | undefined} deps.settingsStore.inspect
 * @param {(key: string) => any} deps.settingsStore.get - Effective (defaults-resolved) value
 * @param {(key: string, value: any) => Promise<void>} deps.settingsStore.update
 * @param {Object} deps.globalState
 * @param {(key: string) => any} deps.globalState.get
 * @param {(key: string, value: any) => Promise<void>} deps.globalState.update
 */
async function toggleTitleBarForRestartPrompt({ settingsStore, globalState }) {
  const pending = globalState.get(TITLEBAR_RESTORE_KEY);
  let original;
  if (pending) {
    // A previous toggle is still in flight (or was interrupted): the live
    // setting may hold the flipped value, so the sentinel is the only
    // trustworthy source of the original.
    original = originalFromSentinel(pending);
  } else {
    original = (settingsStore.inspect('window.titleBarStyle') || {}).globalValue;
    await globalState.update(TITLEBAR_RESTORE_KEY, {
      value: original === undefined ? null : original,
    });
  }

  const effective = original !== undefined ? original : settingsStore.get('window.titleBarStyle');
  const flipped = effective === 'native' ? 'custom' : 'native';

  try {
    await settingsStore.update('window.titleBarStyle', flipped);
    await settingsStore.update('window.titleBarStyle', original);
    await globalState.update(TITLEBAR_RESTORE_KEY, undefined);
  } catch (error) {
    try {
      await settingsStore.update('window.titleBarStyle', original);
      await globalState.update(TITLEBAR_RESTORE_KEY, undefined);
    } catch {
      // Restore failed too — leave the sentinel set so the next activation
      // (healStrandedTitleBarToggle) finishes the restore.
    }
  }
}

/**
 * Finish a toggle that never restored the original value (run on activation).
 * Returns true when a stranded toggle was found and restored.
 */
async function healStrandedTitleBarToggle({ settingsStore, globalState }) {
  const pending = globalState.get(TITLEBAR_RESTORE_KEY);
  if (!pending) return false;
  await settingsStore.update('window.titleBarStyle', originalFromSentinel(pending));
  await globalState.update(TITLEBAR_RESTORE_KEY, undefined);
  return true;
}

module.exports = {
  TITLEBAR_RESTORE_KEY,
  toggleTitleBarForRestartPrompt,
  healStrandedTitleBarToggle,
};
