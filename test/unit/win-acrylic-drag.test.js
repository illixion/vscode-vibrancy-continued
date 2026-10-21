const { EventEmitter } = require('events');
const followCursorWhileDragging = require('../../runtime-pre-esm/win-acrylic-drag.cjs');

const WM_SYSCOMMAND = 0x0112;
const WM_EXITSIZEMOVE = 0x0232;
const SC_MOVE_CAPTION = 0xF012; // SC_MOVE | HTCAPTION
const SC_MOVE_KEYBOARD = 0xF010;
const SC_SIZE_LEFT = 0xF001; // SC_SIZE | WMSZ_LEFT
const SC_SIZE_BOTTOMRIGHT = 0xF008;
const SC_MAXIMIZE_CAPTION = 0xF032; // SC_MAXIMIZE | HTCAPTION, a title bar double-click

function buffer32(value) {
  const b = Buffer.alloc(8);
  b.writeInt32LE(value, 0);
  return b;
}

function pointLParam(x, y) {
  const b = Buffer.alloc(8);
  b.writeInt16LE(x, 0);
  b.writeInt16LE(y, 2);
  return b;
}

function setup({ bounds = { x: 100, y: 100, width: 800, height: 600 }, maximized = false, addon, options } = {}) {
  const transitions = [];
  const win = new EventEmitter();
  const hooks = {};
  win.bounds = { ...bounds };
  win.maximized = maximized;
  win.calls = [];
  win.hookWindowMessage = (msg, cb) => { hooks[msg] = cb; };
  win.isDestroyed = () => false;
  win.isMaximized = () => win.maximized;
  win.getBounds = () => ({ ...win.bounds });
  win.getMinimumSize = () => [400, 270];
  win.getNativeWindowHandle = () => buffer32(0x1234);
  win.setPosition = (x, y) => { win.calls.push(['setPosition', x, y]); win.bounds = { ...win.bounds, x, y }; };
  win.setBounds = (b) => { win.calls.push(['setBounds', b]); win.bounds = { ...b }; };
  win.maximize = () => { win.calls.push(['maximize', transitions.at(-1)]); win.maximized = true; };

  const screen = {
    cursor: { x: 0, y: 0 },
    getCursorScreenPoint: () => ({ ...screen.cursor }),
    screenToDipPoint: (p) => p,
    getDisplayMatching: () => ({ displayFrequency: 100 }), // 10 ms frames
    getDisplayNearestPoint: () => ({ bounds: { x: 0, y: 0, width: 2560, height: 1440 } }),
  };
  const nativeAddon = addon || { setTransitionsDisabled: (hwnd, disabled) => transitions.push([hwnd, disabled]) };

  let now = 1000000000n;
  vi.spyOn(process.hrtime, 'bigint').mockImplementation(() => now);
  const advance = (ms) => { now += BigInt(ms * 1e6); };

  followCursorWhileDragging(win, screen, nativeAddon, options);

  const press = (command, x, y) => {
    screen.cursor = { x, y };
    hooks[WM_SYSCOMMAND](buffer32(command), pointLParam(x, y));
  };
  // Windows' proposal for the move/size loop; returns whether it was prevented.
  const willChange = (name, x, y, proposal = win.getBounds()) => {
    screen.cursor = { x, y };
    let prevented = false;
    win.emit(name, { preventDefault: () => { prevented = true; } }, proposal);
    return prevented;
  };
  const exit = () => hooks[WM_EXITSIZEMOVE](buffer32(0), buffer32(0));

  return { win, screen, transitions, advance, press, willChange, exit, hooks };
}

describe('followCursorWhileDragging', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('places the window from the cursor and blocks the loop\'s own moves', () => {
    const t = setup();
    t.press(SC_MOVE_CAPTION, 300, 110);
    expect(t.willChange('will-move', 310, 115)).toBe(true);
    expect(t.win.calls).toEqual([['setPosition', 110, 105]]);
    t.advance(10);
    expect(t.willChange('will-move', 400, 150)).toBe(true);
    expect(t.win.bounds).toMatchObject({ x: 200, y: 140 });
  });

  it('places at most once per display frame', () => {
    const t = setup();
    t.press(SC_MOVE_CAPTION, 300, 110);
    t.willChange('will-move', 301, 110);
    for (let i = 2; i <= 9; i++) {
      t.advance(1);
      expect(t.willChange('will-move', 300 + i, 110)).toBe(true);
    }
    expect(t.win.calls).toHaveLength(1);
    t.advance(2);
    t.willChange('will-move', 310, 110);
    expect(t.win.calls).toHaveLength(2);
    expect(t.win.bounds.x).toBe(110);
  });

  it('never places the window outside will-move, so nothing is left for Electron to replay', () => {
    vi.useFakeTimers();
    const t = setup();
    t.press(SC_MOVE_CAPTION, 300, 110);
    t.willChange('will-move', 301, 110);
    t.advance(1);
    t.willChange('will-move', 350, 110); // throttled
    vi.advanceTimersByTime(1000);
    expect(t.win.calls).toHaveLength(1);
  });

  it('puts the window at the cursor when the drag ends between frames', () => {
    const t = setup();
    t.press(SC_MOVE_CAPTION, 300, 110);
    t.willChange('will-move', 301, 110);
    t.advance(1);
    t.willChange('will-move', 350, 110); // throttled
    t.exit();
    expect(t.win.bounds.x).toBe(150);
  });

  it('leaves the window alone at the end when Windows snapped it on release', () => {
    const t = setup();
    t.press(SC_MOVE_CAPTION, 300, 110);
    t.willChange('will-move', 301, 110);
    t.advance(1);
    t.screen.cursor = { x: 0, y: 1439 };
    const snapped = { x: 0, y: 720, width: 1280, height: 720 };
    t.win.bounds = { ...snapped }; // Windows' quarter snap
    t.exit();
    expect(t.win.bounds).toEqual(snapped);
  });

  it('leaves a keyboard Move to Windows', () => {
    const t = setup();
    t.press(SC_MOVE_KEYBOARD, 0, 0);
    expect(t.willChange('will-move', 500, 500)).toBe(false);
    expect(t.win.calls).toEqual([]);
  });

  it('lets Windows restore a maximized window, then follows from where it put it', () => {
    const t = setup({ bounds: { x: 0, y: 0, width: 2560, height: 1400 }, maximized: true });
    t.press(SC_MOVE_CAPTION, 1000, 10);
    const restored = { x: 600, y: 2, width: 800, height: 600 };
    expect(t.willChange('will-move', 1005, 12, restored)).toBe(false);
    t.win.maximized = false;
    t.win.bounds = { ...restored };
    t.advance(10);
    expect(t.willChange('will-move', 1005, 12)).toBe(true);
    t.advance(10);
    t.willChange('will-move', 1105, 62);
    expect(t.win.bounds).toMatchObject({ x: 700, y: 52, width: 800, height: 600 });
  });

  it('copes with a restored drag that ends on its first, native move', () => {
    const t = setup({ bounds: { x: 0, y: 0, width: 2560, height: 1400 }, maximized: true });
    t.press(SC_MOVE_CAPTION, 1000, 10);
    t.willChange('will-move', 1005, 12, { x: 600, y: 2, width: 800, height: 600 });
    expect(() => t.exit()).not.toThrow();
    expect(t.win.calls).toEqual([]);
  });

  describe('with follow: false (Windows 11)', () => {
    it('leaves moves and resizes to Windows', () => {
      const t = setup({ options: { follow: false } });
      t.press(SC_MOVE_CAPTION, 300, 110);
      expect(t.willChange('will-move', 310, 115)).toBe(false);
      t.exit();
      t.press(SC_SIZE_LEFT, 100, 400);
      expect(t.willChange('will-resize', 150, 400)).toBe(false);
      t.exit();
      expect(t.win.calls).toEqual([]);
    });

    it('still keeps transitions off except for a title bar drag away from the top', () => {
      vi.useFakeTimers();
      const t = setup({ options: { follow: false } });
      expect(t.transitions).toEqual([[0x1234, true]]);
      t.press(SC_MOVE_CAPTION, 300, 110);
      t.willChange('will-move', 0, 700);
      expect(t.transitions.at(-1)).toEqual([0x1234, false]);
      t.willChange('will-move', 800, 3);
      expect(t.transitions.at(-1)).toEqual([0x1234, true]);
      t.willChange('will-move', 0, 700);
      t.exit();
      vi.advanceTimersByTime(400);
      expect(t.transitions.at(-1)).toEqual([0x1234, true]);
    });
  });

  it('resizes from the left edge with the right edge fixed, down to the minimum size', () => {
    const t = setup();
    t.press(SC_SIZE_LEFT, 100, 400);
    expect(t.willChange('will-resize', 150, 400)).toBe(true);
    expect(t.win.bounds).toEqual({ x: 150, y: 100, width: 750, height: 600 });
    t.advance(20);
    t.willChange('will-resize', 700, 400);
    expect(t.win.bounds).toEqual({ x: 500, y: 100, width: 400, height: 600 });
  });

  it('resizes from a corner at 60 Hz', () => {
    const t = setup();
    t.press(SC_SIZE_BOTTOMRIGHT, 900, 700);
    t.willChange('will-resize', 910, 710);
    t.advance(10);
    t.willChange('will-resize', 950, 750); // within 1/60 s: skipped
    expect(t.win.bounds).toMatchObject({ width: 810, height: 610 });
    t.advance(7);
    t.willChange('will-resize', 960, 760);
    expect(t.win.bounds).toMatchObject({ width: 860, height: 660 });
  });

  it('only takes over a resize that started on an edge, not a move', () => {
    const t = setup();
    t.press(SC_MOVE_CAPTION, 300, 110);
    expect(t.willChange('will-resize', 310, 110)).toBe(false);
  });

  describe('transitions', () => {
    it('turns them off when attached', () => {
      const t = setup();
      expect(t.transitions).toEqual([[0x1234, true]]);
    });

    it('turns them on while dragging, off near the top edge where release maximizes', () => {
      const t = setup();
      t.press(SC_MOVE_CAPTION, 300, 110);
      t.willChange('will-move', 310, 300);
      expect(t.transitions.at(-1)).toEqual([0x1234, false]);
      t.willChange('will-move', 800, 3);
      expect(t.transitions.at(-1)).toEqual([0x1234, true]);
      t.willChange('will-move', 10, 3); // top-left corner: a quarter snap
      expect(t.transitions.at(-1)).toEqual([0x1234, false]);
    });

    it('turns them off again once a snap animation has had time to finish', () => {
      vi.useFakeTimers();
      const t = setup();
      t.press(SC_MOVE_CAPTION, 300, 110);
      t.willChange('will-move', 0, 700);
      t.exit();
      expect(t.transitions.at(-1)).toEqual([0x1234, false]);
      vi.advanceTimersByTime(400);
      expect(t.transitions.at(-1)).toEqual([0x1234, true]);
    });

    it('turns them off at once for a maximize straight after a drag', () => {
      vi.useFakeTimers();
      const t = setup();
      t.press(SC_MOVE_CAPTION, 300, 110);
      t.willChange('will-move', 1200, 700);
      t.exit();
      expect(t.transitions.at(-1)).toEqual([0x1234, false]);
      vi.advanceTimersByTime(100);
      t.hooks[0x0112](buffer32(SC_MAXIMIZE_CAPTION), pointLParam(300, 110));
      expect(t.transitions.at(-1)).toEqual([0x1234, true]);
      expect(t.willChange('will-move', 400, 400)).toBe(false); // not mistaken for a drag
    });

    it('turns them off before VSCode\'s own title bar maximizes the window', () => {
      const t = setup();
      t.press(SC_MOVE_CAPTION, 300, 110);
      t.willChange('will-move', 1200, 700);
      t.exit();
      t.win.maximize();
      expect(t.win.calls.at(-1)).toEqual(['maximize', [0x1234, true]]);
    });

    it('keeps them off for a resize', () => {
      const t = setup();
      t.press(SC_SIZE_LEFT, 100, 400);
      t.willChange('will-resize', 150, 400);
      expect(t.transitions).toEqual([[0x1234, true]]);
    });

    it('works with an older native module that has no setTransitionsDisabled', () => {
      const t = setup({ addon: {} });
      t.press(SC_MOVE_CAPTION, 300, 110);
      expect(t.willChange('will-move', 310, 115)).toBe(true);
      expect(() => t.exit()).not.toThrow();
    });
  });
});
