import fs from 'fs';

// Test-mode only: records how a window's background color evolves after the
// transparency method is installed, so an E2E run that comes out opaque shows
// whether something reset the color and whether it went through
// setBackgroundColor (visible to the `overwrite` method) or around it.
const SAMPLE_INTERVAL_MS = 500;
const SAMPLE_DURATION_MS = 30000;
const MAX_LOGGED_CALLS = 200;

function callerOf(stack) {
  return String(stack || '')
    .split('\n')
    .slice(2, 5)
    .map((line) => line.trim())
    .join(' <- ');
}

export default function createDiagnostics(filePath) {
  if (!filePath) return null;

  const log = (event, data) => {
    try {
      fs.appendFileSync(filePath, JSON.stringify({ t: Date.now(), event, ...data }) + '\n');
    } catch {}
  };

  const readBg = (window) => {
    try {
      return window.isDestroyed() ? null : window.getBackgroundColor();
    } catch (err) {
      return `error: ${err.message}`;
    }
  };

  const watched = new WeakSet();

  return {
    log,
    readBg,
    // Wraps whatever setBackgroundColor currently is (i.e. on top of the
    // installed method) and samples the actual color for a while, logging
    // only changes. A sampled change with no matching call is a bypass.
    watch(window) {
      if (watched.has(window)) return;
      watched.add(window);

      const started = Date.now();
      let calls = 0;
      const inner = window.setBackgroundColor;
      window.setBackgroundColor = function (color) {
        const result = inner.call(window, color);
        // Bounded: the `interval` method calls this on every tick.
        if (Date.now() - started > SAMPLE_DURATION_MS || ++calls > MAX_LOGGED_CALLS) return result;
        log('setBackgroundColor', {
          id: window.id,
          requested: color,
          after: readBg(window),
          caller: callerOf(new Error().stack),
        });
        return result;
      };

      let last = readBg(window);
      log('sample', { id: window.id, bg: last });
      const timer = setInterval(() => {
        if (window.isDestroyed() || Date.now() - started > SAMPLE_DURATION_MS) {
          clearInterval(timer);
          return;
        }
        const bg = readBg(window);
        if (bg !== last) {
          log('sample', { id: window.id, bg, previous: last });
          last = bg;
        }
      }, SAMPLE_INTERVAL_MS);
      window.on('closed', () => clearInterval(timer));
    },
  };
}
