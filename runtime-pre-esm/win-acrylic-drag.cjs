// Keep a window with the legacy acrylic accent responsive while it's dragged
// or resized on Windows 10 (issue #52).
//
// Windows' move/size loop moves or sizes the window once per mouse event, and
// with ACCENT_ENABLE_ACRYLICBLURBEHIND every change queues blur work in DWM.
// A mouse that reports faster than the display refreshes (1000 Hz against 60
// to 240 Hz) queues more than DWM gets through, so the window, and the cursor
// DWM draws, trail the hand as if at a speed limit. Windows 11 doesn't have
// this cost, so it passes `follow: false` and only gets the transitions
// handling below.
//
// Instead of dropping the accent for the drag, take the drag over: block each
// change the loop proposes (will-move is WM_MOVING, will-resize is WM_SIZING)
// and set the bounds from the live cursor position at most once per display
// frame, or 60 times a second for a resize, which repaints the whole
// workbench. Electron hands the loop the window's current rect when the event
// is prevented, so the loop keeps agreeing with where we put the window, and
// Windows still snaps it on release.
//
// The bounds are only ever set inside will-move/will-resize. Electron
// remembers a setBounds made during the loop and applies it again when the
// loop ends (pending_bounds_change_), after Windows has snapped the window,
// but forgets it when the event is prevented. A placement from a timer would
// survive to the end and undo the snap.
//
// DWM draws the maximize and restore animations without the accent, on
// Windows 10 and 11 alike, so the window shows through unblurred for a quarter
// of a second. Transitions stay
// off, except during a title bar drag away from the top edge and the snap
// animation after it, so a snap to a side or corner still animates. A
// maximize, restore or minimize turns them off at once, even if it comes
// straight after such a drag.

const WM_SYSCOMMAND = 0x0112;
const WM_EXITSIZEMOVE = 0x0232;
const SC_SIZE = 0xF000;
const SC_MOVE = 0xF010;
const SC_MINIMIZE = 0xF020;
const SC_MAXIMIZE = 0xF030;
const SC_RESTORE = 0xF120;
const HTCAPTION = 2;
// SC_SIZE's low bits are WMSZ_*: which sides follow the cursor.
const SIZE_EDGES = { 1: 'l', 2: 'r', 3: 't', 4: 'tl', 5: 'tr', 6: 'b', 7: 'bl', 8: 'br' };

const RESIZE_HZ = 60;
// Releasing a drag within this many pixels of the top edge maximizes the
// window, except in the corners, which snap it to a quarter.
const MAXIMIZE_ZONE = 8;
const CORNER_ZONE = 24;
// Long enough for a snap animation to finish before transitions go off again.
const SNAP_ANIMATION_MS = 400;

function sameBounds(a, b) {
  return a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height;
}

function sizedBounds(start, dx, dy, edge, [minWidth, minHeight]) {
  let { x, y, width, height } = start;
  if (edge.includes('l')) { const w = Math.max(minWidth, width - dx); x += width - w; width = w; }
  if (edge.includes('r')) width = Math.max(minWidth, width + dx);
  if (edge.includes('t')) { const h = Math.max(minHeight, height - dy); y += height - h; height = h; }
  if (edge.includes('b')) height = Math.max(minHeight, height + dy);
  return { x, y, width, height };
}

function inMaximizeZone(point, display) {
  return point.y < display.y + MAXIMIZE_ZONE
    && point.x >= display.x + CORNER_ZONE
    && point.x < display.x + display.width - CORNER_ZONE;
}

/**
 * @param {import('electron').BrowserWindow} window
 * @param {Pick<import('electron').Screen, 'getCursorScreenPoint' | 'screenToDipPoint' | 'getDisplayMatching' | 'getDisplayNearestPoint'>} screen
 * @param {{ setTransitionsDisabled?: (hwnd: number, disabled: boolean) => void }} addon - native vibrancy module
 * @param {{ follow?: boolean }} [options] - follow: false leaves moves and resizes to Windows
 */
module.exports = function followCursorWhileDragging(window, screen, addon, { follow = true } = {}) {
  let press = null; // what the mouse press started, where, and the window then
  let drag = null;
  let transitionsOn = null;
  let transitionsOffTimer = null;

  function setTransitions(on) {
    if (on === transitionsOn || typeof addon.setTransitionsDisabled !== 'function' || window.isDestroyed()) return;
    transitionsOn = on;
    try {
      addon.setTransitionsDisabled(window.getNativeWindowHandle().readInt32LE(0), !on);
    } catch (err) { /* window may be gone */ }
  }

  function transitionsOff() {
    clearTimeout(transitionsOffTimer);
    setTransitions(false);
  }

  // VSCode's own title bar buttons maximize and restore from JS, without a
  // WM_SYSCOMMAND.
  for (const name of ['maximize', 'unmaximize', 'minimize', 'restore']) {
    const original = window[name];
    if (typeof original !== 'function') continue;
    window[name] = (...args) => {
      transitionsOff();
      return original.apply(window, args);
    };
  }

  function frameNs(isResize) {
    if (isResize) return BigInt(Math.round(1e9 / RESIZE_HZ));
    const display = screen.getDisplayMatching(window.getBounds());
    const hz = display && display.displayFrequency > 0 ? display.displayFrequency : 60;
    return BigInt(Math.round(1e9 / hz));
  }

  // `final` is the placement when the loop ends. By then Windows may have
  // snapped or maximized the window on release, so it only corrects the
  // position while the window is still where we last put it.
  function apply(final) {
    // No anchor yet: a restored drag that ended on its first, native move.
    if (!drag || !drag.bounds || window.isDestroyed()) return;
    if (final && drag.placed && !sameBounds(window.getBounds(), drag.placed)) return;
    const cursor = screen.getCursorScreenPoint();
    const dx = cursor.x - drag.cursor.x;
    const dy = cursor.y - drag.cursor.y;
    drag.last = process.hrtime.bigint();
    if (dx === drag.dx && dy === drag.dy) return;
    drag.dx = dx;
    drag.dy = dy;
    if (drag.edge) {
      window.setBounds(sizedBounds(drag.bounds, dx, dy, drag.edge, window.getMinimumSize()));
    } else {
      window.setPosition(drag.bounds.x + dx, drag.bounds.y + dy);
    }
    drag.placed = window.getBounds();
  }

  // Chromium starts a mouse drag with WM_SYSCOMMAND carrying the press point:
  // SC_MOVE | HTCAPTION for the title bar, SC_SIZE | WMSZ_* for an edge. A
  // keyboard Move or Size from the system menu has neither, and is left to
  // Windows.
  window.hookWindowMessage(WM_SYSCOMMAND, (wParam, lParam) => {
    const command = wParam.readInt32LE(0) & 0xFFFF;
    // The caption buttons, a title bar double-click and the system menu.
    if ([SC_MINIMIZE, SC_MAXIMIZE, SC_RESTORE].includes(command & 0xFFF0)) {
      transitionsOff();
      return;
    }
    const edge = (command & 0xFFF0) === SC_SIZE ? SIZE_EDGES[command & 0xF] : undefined;
    if (command !== (SC_MOVE | HTCAPTION) && !edge) return;
    press = {
      edge,
      cursor: screen.screenToDipPoint({ x: lParam.readInt16LE(0), y: lParam.readInt16LE(2) }),
      bounds: window.getBounds(),
      maximized: window.isMaximized(),
    };
  });

  function onWillChange(event, newBounds, isResize) {
    if (!drag) {
      if (!press || Boolean(press.edge) !== isResize) return;
      clearTimeout(transitionsOffTimer);
      // A maximized or snapped window gets its old size back under the cursor
      // before it moves, so the press position no longer matches. Let Windows
      // make that first move and anchor on where it put the window.
      const restored = !isResize && (press.maximized
        || Math.abs(newBounds.width - press.bounds.width) > 32
        || Math.abs(newBounds.height - press.bounds.height) > 32);
      drag = {
        edge: press.edge,
        bounds: restored ? null : press.bounds,
        cursor: restored ? null : press.cursor,
        dx: null, dy: null, last: 0n, placed: null, frame: frameNs(isResize),
      };
      press = null;
      if (restored) return;
    }
    if (!drag.edge) {
      const cursor = screen.getCursorScreenPoint();
      setTransitions(!inMaximizeZone(cursor, screen.getDisplayNearestPoint(cursor).bounds));
    }
    if (!follow) return;
    if (!drag.bounds) {
      drag.bounds = window.getBounds();
      drag.cursor = screen.getCursorScreenPoint();
    }
    event.preventDefault();
    if (process.hrtime.bigint() - drag.last >= drag.frame) apply(false);
  }

  window.on('will-move', (event, newBounds) => onWillChange(event, newBounds, false));
  window.on('will-resize', (event, newBounds) => onWillChange(event, newBounds, true));

  window.hookWindowMessage(WM_EXITSIZEMOVE, () => {
    press = null;
    if (!drag) return;
    if (follow) apply(true);
    drag = null;
    if (transitionsOn) transitionsOffTimer = setTimeout(() => setTransitions(false), SNAP_ANIMATION_MS);
  });

  window.on('closed', () => {
    clearTimeout(transitionsOffTimer);
    drag = null;
  });

  setTransitions(false);
};
