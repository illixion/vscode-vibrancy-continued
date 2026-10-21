// Suppress the legacy acrylic accent while a window is being moved or resized
// (Windows 10, and the 'acrylic-classic' type on Windows 11).
//
// ACCENT_ENABLE_ACRYLICBLURBEHIND forces DWM to re-blur the whole backdrop every
// frame on the legacy composition path. During the modal move/resize loop the
// window's content present can't keep up, so the contents lag behind the window
// frame — the classic "ghost cursor trailing the window" drag lag (issue #52).
// Windows 11's 'acrylic' goes through a modern backdrop that doesn't have this
// cost; 'acrylic-classic' opts back into the legacy accent, and with it this.
//
// Swapping the accent for a cheaper one for the duration of the drag and
// restoring it shortly after the window goes idle keeps movement smooth while
// preserving the acrylic look whenever the window is stationary (the same
// approach Windows Terminal uses). The swap must not leave the window with no
// accent at all: the page is transparent, and on Windows 11 the system Mica is
// switched off for the legacy accent, so the window would go see-through.

const RESTORE_DELAY_MS = 180;

/**
 * @param {import('electron').BrowserWindow} window
 * @param {() => void} suppress - applies the cheaper accent used while dragging
 * @param {() => void} reapply - re-applies the accent the window had before suppression
 */
module.exports = function suppressAcrylicWhileDragging(window, suppress, reapply) {
  let suppressed = false;
  let restoreTimer = null;

  function onActivity() {
    if (window.isDestroyed()) return;
    if (!suppressed) {
      suppressed = true;
      try { suppress(); } catch (err) { /* window may be gone */ }
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
