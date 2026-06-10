// CJS counterpart of win-acrylic-drag.mjs for older (pre-ESM) VSCode runtimes.
// See runtime/win-acrylic-drag.mjs for the full rationale (issue #52).

const RESTORE_DELAY_MS = 180;

/**
 * @param {import('electron').BrowserWindow} window
 * @param {{ disableVibrancy: (hwnd: number) => void }} addon - native vibrancy module
 * @param {() => void} reapply - re-applies the accent the window had before suppression
 */
module.exports = function suppressAcrylicWhileDragging(window, addon, reapply) {
  let suppressed = false;
  let restoreTimer = null;

  function hwnd() {
    return window.getNativeWindowHandle().readInt32LE(0);
  }

  function onActivity() {
    if (window.isDestroyed()) return;
    if (!suppressed) {
      suppressed = true;
      try { addon.disableVibrancy(hwnd()); } catch (err) { /* window may be gone */ }
    }
    if (restoreTimer) clearTimeout(restoreTimer);
    restoreTimer = setTimeout(() => {
      suppressed = false;
      if (window.isDestroyed()) return;
      try { reapply(); } catch (err) { /* window may be gone */ }
    }, RESTORE_DELAY_MS);
  }

  window.on('move', onActivity);
  window.on('will-resize', onActivity);
  window.on('resize', onActivity);
  window.on('closed', () => { if (restoreTimer) clearTimeout(restoreTimer); });
};
