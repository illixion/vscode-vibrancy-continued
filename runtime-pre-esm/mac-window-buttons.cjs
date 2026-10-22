// @ts-check

// With macWindowButtons the window is frameless and the native traffic lights
// are put back, relying on the workbench's title bar to leave room for them.
// When VSCode hides that title bar (it does when the title bar would be
// empty) the tabs start at the top of the window and the lights sit on top of
// them. Like iTerm2, keep the lights hidden then, and show them only while the
// cursor is in the window's top-left corner. The cursor is only polled while
// the window has focus.

const MESSAGE_PREFIX = '__vscode_vibrancy_titlebar__:';

// The cursor has to enter the show zone to reveal the lights and leave the
// larger hide zone (for HIDE_AFTER_POLLS polls in a row) to hide them again, so
// moving across the buttons themselves doesn't make them flicker.
const SHOW_ZONE = { width: 90, height: 30 };
const HIDE_ZONE = { width: 130, height: 50 };
const POLL_MS = 100;
const HIDE_AFTER_POLLS = 3;

/**
 * Script run in the workbench. It reports whether the title bar is visible by
 * logging MESSAGE_PREFIX + "visible" | "hidden" (the runtime has no IPC; the
 * main process reads these from the console-message event).
 * @returns {string}
 */
function rendererScript() {
  return `(function(){
    if (window.__vscodeVibrancyTitleBar) return;
    window.__vscodeVibrancyTitleBar = true;
    const selector = '.part.titlebar, #workbench\\\\.parts\\\\.titlebar';
    let last;
    const report = (el) => {
      let visible = false;
      if (el) {
        const style = getComputedStyle(el);
        visible = style.display !== 'none' && style.visibility !== 'hidden' && el.getBoundingClientRect().height > 0;
      }
      const state = visible ? 'visible' : 'hidden';
      if (state !== last) {
        last = state;
        console.debug(${JSON.stringify(MESSAGE_PREFIX)} + state);
      }
    };
    const observe = (el) => {
      new ResizeObserver(() => report(el)).observe(el);
      report(el);
    };
    const existing = document.querySelector(selector);
    if (existing) return observe(existing);
    report(null);
    const found = new MutationObserver(() => {
      const el = document.querySelector(selector);
      if (!el) return;
      found.disconnect();
      observe(el);
    });
    found.observe(document.documentElement, { childList: true, subtree: true });
  })();`;
}

/**
 * @param {string} message - a console message from the workbench
 * @returns {boolean | null} whether the title bar is visible, or null if the
 *   message isn't ours
 */
function parseMessage(message) {
  if (typeof message !== 'string' || !message.startsWith(MESSAGE_PREFIX)) return null;
  const state = message.slice(MESSAGE_PREFIX.length);
  if (state === 'visible') return true;
  if (state === 'hidden') return false;
  return null;
}

/**
 * @param {Electron.BrowserWindow} window
 * @param {Pick<Electron.Screen, 'getCursorScreenPoint'>} screen
 */
function createWindowButtons(window, screen) {
  /** @type {boolean | null} */
  let shown = null;
  /** @type {ReturnType<typeof setInterval> | null} */
  let timer = null;
  let outsidePolls = 0;
  /** @type {boolean | null} null until the workbench first reports */
  let titleBarVisible = null;
  let focused = window.isFocused();

  const setShown = (visible) => {
    if (shown === visible || window.isDestroyed()) return;
    shown = visible;
    window.setWindowButtonVisibility(visible);
  };

  const stop = () => {
    if (timer) clearInterval(timer);
    timer = null;
    outsidePolls = 0;
  };

  const poll = () => {
    if (window.isDestroyed()) return stop();
    const bounds = window.getBounds();
    const cursor = screen.getCursorScreenPoint();
    const x = cursor.x - bounds.x;
    const y = cursor.y - bounds.y;
    const zone = shown ? HIDE_ZONE : SHOW_ZONE;
    if (x >= 0 && x <= zone.width && y >= 0 && y <= zone.height) {
      outsidePolls = 0;
      setShown(true);
    } else if (++outsidePolls >= HIDE_AFTER_POLLS) {
      setShown(false);
    }
  };

  const update = () => {
    stop();
    if (titleBarVisible === null) return;
    if (titleBarVisible) return setShown(true);
    setShown(false);
    if (focused) timer = setInterval(poll, POLL_MS);
  };

  return {
    /** @param {boolean} visible - whether the workbench's title bar is visible */
    setTitleBarVisible(visible) {
      titleBarVisible = visible;
      update();
    },
    /** @param {boolean} value - whether the window has focus */
    setFocused(value) {
      if (focused === value) return;
      focused = value;
      update();
    },
    dispose: stop,
  };
}

const attached = new WeakSet();

/**
 * Start tracking the workbench's title bar in `window`. Safe to call on every
 * dom-ready: the listeners are added once and only the reporter script re-runs
 * (a reload starts a new document).
 * @param {Electron.BrowserWindow} window
 * @param {Pick<Electron.Screen, 'getCursorScreenPoint'>} screen
 */
function attach(window, screen) {
  if (!attached.has(window)) {
    attached.add(window);
    const buttons = createWindowButtons(window, screen);
    // Electron 35+ passes one details object; older versions (event, level, message).
    window.webContents.on('console-message', (event, _level, message) => {
      const visible = parseMessage(typeof message === 'string' ? message : event && event.message);
      if (visible !== null) buttons.setTitleBarVisible(visible);
    });
    window.on('focus', () => buttons.setFocused(true));
    window.on('blur', () => buttons.setFocused(false));
    window.once('closed', buttons.dispose);
  }
  return window.webContents.executeJavaScript(rendererScript());
}

module.exports = {
  MESSAGE_PREFIX,
  SHOW_ZONE,
  HIDE_ZONE,
  POLL_MS,
  HIDE_AFTER_POLLS,
  rendererScript,
  parseMessage,
  createWindowButtons,
  attach,
};
