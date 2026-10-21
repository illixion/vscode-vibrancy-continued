const { EventEmitter } = require('events');
const {
  MESSAGE_PREFIX,
  SHOW_ZONE,
  HIDE_ZONE,
  POLL_MS,
  HIDE_AFTER_POLLS,
  rendererScript,
  parseMessage,
  createWindowButtons,
  attach,
} = require('../../runtime-pre-esm/mac-window-buttons.cjs');

function fakeWindow(bounds = { x: 100, y: 200, width: 800, height: 600 }) {
  const window = new EventEmitter();
  window.webContents = Object.assign(new EventEmitter(), {
    executeJavaScript: vi.fn(() => Promise.resolve()),
  });
  window.calls = [];
  window.destroyed = false;
  window.isDestroyed = () => window.destroyed;
  window.getBounds = () => bounds;
  window.setWindowButtonVisibility = (v) => window.calls.push(v);
  return window;
}

function fakeScreen() {
  const screen = { point: { x: 0, y: 0 }, getCursorScreenPoint: () => screen.point };
  return screen;
}

describe('parseMessage', () => {
  it('reads the title bar state', () => {
    expect(parseMessage(`${MESSAGE_PREFIX}visible`)).toBe(true);
    expect(parseMessage(`${MESSAGE_PREFIX}hidden`)).toBe(false);
  });

  it('ignores anything else', () => {
    expect(parseMessage('hello')).toBeNull();
    expect(parseMessage(`${MESSAGE_PREFIX}bogus`)).toBeNull();
    expect(parseMessage(undefined)).toBeNull();
  });
});

describe('rendererScript', () => {
  it('is valid JavaScript that logs the sentinel', () => {
    const script = rendererScript();
    expect(() => new Function(script)).not.toThrow();
    expect(script).toContain(MESSAGE_PREFIX);
  });

  it('reports hidden when the title bar is missing, then visible once it appears', () => {
    const logs = [];
    let mutation;
    const titlebar = {};
    let found = null;
    const sandbox = {
      window: {},
      document: {
        querySelector: () => found,
        documentElement: {},
      },
      getComputedStyle: () => ({ display: 'flex', visibility: 'visible' }),
      console: { debug: (m) => logs.push(m) },
      ResizeObserver: class { observe() {} },
      MutationObserver: class {
        constructor(cb) { mutation = cb; }
        observe() {}
        disconnect() {}
      },
    };
    titlebar.getBoundingClientRect = () => ({ height: 35 });
    new Function(...Object.keys(sandbox), rendererScript())(...Object.values(sandbox));
    expect(logs).toEqual([`${MESSAGE_PREFIX}hidden`]);

    found = titlebar;
    mutation();
    expect(logs).toEqual([`${MESSAGE_PREFIX}hidden`, `${MESSAGE_PREFIX}visible`]);
  });
});

describe('createWindowButtons', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  const tick = (n = 1) => vi.advanceTimersByTime(POLL_MS * n);
  const cursorAt = (screen, window, dx, dy) => {
    const b = window.getBounds();
    screen.point = { x: b.x + dx, y: b.y + dy };
  };

  it('keeps the buttons visible while the title bar is visible', () => {
    const window = fakeWindow();
    const screen = fakeScreen();
    const buttons = createWindowButtons(window, screen);
    buttons.setTitleBarVisible(true);
    cursorAt(screen, window, 500, 500);
    tick(10);
    expect(window.calls).toEqual([true]);
  });

  it('hides the buttons when the title bar is hidden and shows them on hover', () => {
    const window = fakeWindow();
    const screen = fakeScreen();
    const buttons = createWindowButtons(window, screen);
    cursorAt(screen, window, 500, 500);
    buttons.setTitleBarVisible(false);
    expect(window.calls).toEqual([false]);

    cursorAt(screen, window, SHOW_ZONE.width - 1, SHOW_ZONE.height - 1);
    tick();
    expect(window.calls).toEqual([false, true]);
  });

  it('does not show them just outside the show zone', () => {
    const window = fakeWindow();
    const screen = fakeScreen();
    const buttons = createWindowButtons(window, screen);
    buttons.setTitleBarVisible(false);
    cursorAt(screen, window, SHOW_ZONE.width + 5, 5);
    tick(5);
    expect(window.calls).toEqual([false]);
  });

  it('keeps them while the cursor stays inside the larger hide zone', () => {
    const window = fakeWindow();
    const screen = fakeScreen();
    const buttons = createWindowButtons(window, screen);
    buttons.setTitleBarVisible(false);
    cursorAt(screen, window, 5, 5);
    tick();
    cursorAt(screen, window, HIDE_ZONE.width - 1, HIDE_ZONE.height - 1);
    tick(10);
    expect(window.calls).toEqual([false, true]);
  });

  it('hides them again only after leaving for a few polls, including out of the window', () => {
    const window = fakeWindow();
    const screen = fakeScreen();
    const buttons = createWindowButtons(window, screen);
    buttons.setTitleBarVisible(false);
    cursorAt(screen, window, 5, 5);
    tick();

    cursorAt(screen, window, 5, -40); // above the window, in the menu bar
    tick(HIDE_AFTER_POLLS - 1);
    expect(window.calls).toEqual([false, true]);
    tick();
    expect(window.calls).toEqual([false, true, false]);
  });

  it('stops polling and shows the buttons when the title bar comes back', () => {
    const window = fakeWindow();
    const screen = fakeScreen();
    const buttons = createWindowButtons(window, screen);
    buttons.setTitleBarVisible(false);
    buttons.setTitleBarVisible(true);
    expect(window.calls).toEqual([false, true]);
    cursorAt(screen, window, 500, 500);
    tick(10);
    expect(window.calls).toEqual([false, true]);
  });

  it('stops polling once the window is destroyed', () => {
    const window = fakeWindow();
    const screen = fakeScreen();
    const buttons = createWindowButtons(window, screen);
    buttons.setTitleBarVisible(false);
    window.destroyed = true;
    cursorAt(screen, window, 5, 5);
    tick(5);
    expect(window.calls).toEqual([false]);
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe('attach', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('drives the buttons from console messages, in both Electron signatures', () => {
    const window = fakeWindow();
    attach(window, fakeScreen());

    window.webContents.emit('console-message', {}, 0, `${MESSAGE_PREFIX}hidden`);
    expect(window.calls).toEqual([false]);
    window.webContents.emit('console-message', { message: `${MESSAGE_PREFIX}visible` });
    expect(window.calls).toEqual([false, true]);
  });

  it('registers its listeners once across dom-ready reloads but re-runs the script', () => {
    const window = fakeWindow();
    attach(window, fakeScreen());
    attach(window, fakeScreen());
    expect(window.webContents.listenerCount('console-message')).toBe(1);
    expect(window.webContents.executeJavaScript).toHaveBeenCalledTimes(2);
  });

  it('cleans up the poll timer when the window closes', () => {
    const window = fakeWindow();
    attach(window, fakeScreen());
    window.webContents.emit('console-message', {}, 0, `${MESSAGE_PREFIX}hidden`);
    expect(vi.getTimerCount()).toBe(1);
    window.emit('closed');
    expect(vi.getTimerCount()).toBe(0);
  });
});
