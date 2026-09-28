const fs = require('fs');
const os = require('os');
const path = require('path');
const { EventEmitter } = require('events');
const { parseEvents, summarizeEvents } = require('../e2e/background-diagnostics');

describe('parseEvents', () => {
  it('skips blank and truncated lines', () => {
    const text = '{"event":"sample","id":1,"bg":"#00000000"}\n\n{"event":"sam';
    expect(parseEvents(text)).toEqual([{ event: 'sample', id: 1, bg: '#00000000' }]);
  });
});

describe('summarizeEvents', () => {
  it('reports no events', () => {
    const { lines, bypass, changed } = summarizeEvents([]);
    expect(lines[0]).toMatch(/no events recorded/);
    expect(bypass).toBe(false);
    expect(changed).toBe(false);
  });

  it('treats a change explained by a setBackgroundColor call as no bypass', () => {
    const { lines, bypass, changed } = summarizeEvents([
      { event: 'dom-ready', id: 1, method: 'overwrite', type: 'transparent', bgBefore: '#1E1E1E', bgAfter: '#00000000', url: 'workbench.html' },
      { event: 'sample', id: 1, bg: '#00000000' },
      { event: 'setBackgroundColor', id: 1, requested: '#1E1E1E', after: '#00000000' },
      { event: 'setBackgroundColor', id: 1, requested: '#FFFFFF', after: '#FFFFFF' },
      { event: 'sample', id: 1, bg: '#FFFFFF', previous: '#00000000' },
    ]);
    expect(changed).toBe(true);
    expect(bypass).toBe(false);
    expect(lines).toContain('Window 1: 2 setBackgroundColor call(s) after install, requested #1E1E1E, #FFFFFF');
    expect(lines).toContain('Window 1: background changed 1 time(s) after install; final #FFFFFF');
  });

  it('flags a change with no matching call as a bypass', () => {
    const { lines, bypass } = summarizeEvents([
      { event: 'sample', id: 1, bg: '#00000000' },
      { event: 'setBackgroundColor', id: 1, requested: '#1E1E1E', after: '#00000000' },
      { event: 'sample', id: 1, bg: '#1E1E1E', previous: '#00000000' },
    ]);
    expect(bypass).toBe(true);
    expect(lines.some((l) => l.includes('BYPASS') && l.includes('#00000000 -> #1E1E1E'))).toBe(true);
  });
});

describe('runtime diagnostics', () => {
  let createDiagnostics;
  let tmpDir;

  beforeAll(async () => {
    ({ default: createDiagnostics } = await import('../../runtime/diagnostics.mjs'));
  });

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vibrancy-diag-'));
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function fakeWindow() {
    const win = new EventEmitter();
    win.id = 7;
    win.bg = '#00000000';
    win.isDestroyed = () => false;
    win.getBackgroundColor = () => win.bg;
    // Stand-in for the `overwrite` method: always forces transparent.
    win.setBackgroundColor = () => { win.bg = '#00000000'; };
    return win;
  }

  it('is disabled without a path', () => {
    expect(createDiagnostics(null)).toBeNull();
  });

  it('logs calls through the installed method and detects a bypass', () => {
    const file = path.join(tmpDir, 'diag.jsonl');
    const diagnostics = createDiagnostics(file);
    const win = fakeWindow();

    diagnostics.watch(win);
    diagnostics.watch(win); // idempotent across reloads
    win.setBackgroundColor('#1E1E1E');
    win.bg = '#1E1E1E'; // set natively, around the JS method
    vi.advanceTimersByTime(600);

    const events = parseEvents(fs.readFileSync(file, 'utf-8'));
    expect(events.filter((ev) => ev.event === 'setBackgroundColor')).toHaveLength(1);
    expect(events.find((ev) => ev.event === 'setBackgroundColor')).toMatchObject({ requested: '#1E1E1E', after: '#00000000' });
    expect(summarizeEvents(events).bypass).toBe(true);
  });

  it('stops sampling and call logging once the 30s window has passed', () => {
    const file = path.join(tmpDir, 'diag.jsonl');
    const diagnostics = createDiagnostics(file);
    const win = fakeWindow();

    diagnostics.watch(win);
    vi.advanceTimersByTime(31000);
    win.setBackgroundColor('#1E1E1E');
    win.bg = '#FFFFFF';
    vi.advanceTimersByTime(1000);

    const events = parseEvents(fs.readFileSync(file, 'utf-8'));
    expect(events).toHaveLength(1); // only the baseline sample
  });
});
