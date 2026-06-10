// Suppress the legacy acrylic accent while a window is being moved or resized
// on Windows 10.
//
// ACCENT_ENABLE_ACRYLICBLURBEHIND forces DWM to re-blur the whole backdrop every
// frame on the legacy composition path. During the modal move/resize loop the
// window's content present can't keep up, so the contents lag behind the window
// frame — the classic "ghost cursor trailing the window" drag lag (issue #52).
// Windows 11 routes acrylic through a modern backdrop that doesn't have this cost,
// which is why this is Win10-only.
//
// Dropping the accent for the duration of the drag and restoring it shortly after
// the window goes idle keeps movement perfectly smooth while preserving the
// acrylic look whenever the window is stationary (the same approach Windows
// Terminal uses).

const RESTORE_DELAY_MS = 180;

/**
 * @param {import('electron').BrowserWindow} window
 * @param {{ disableVibrancy: (hwnd: number) => void }} addon - native vibrancy module
 * @param {() => void} reapply - re-applies the accent the window had before suppression
 */
export default function suppressAcrylicWhileDragging(window, addon, reapply) {
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
}
