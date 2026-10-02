/**
 * Reads the test-mode background diagnostics written by runtime-pre-esm/diagnostics.cjs
 * and turns them into log lines for the E2E output.
 *
 * The question it answers for an opaque post-restart screenshot: did the
 * window's background color change after the transparency method was
 * installed, and did that change go through setBackgroundColor (which the
 * `overwrite` method intercepts) or around it?
 */

function parseEvents(text) {
  const events = [];
  for (const line of String(text || '').split('\n')) {
    if (!line.trim()) continue;
    try {
      events.push(JSON.parse(line));
    } catch {
      // A line cut short by the kill at the end of the launch; skip it.
    }
  }
  return events;
}

/**
 * @param {object[]} events
 * @returns {{ lines: string[], bypass: boolean, changed: boolean }}
 */
function summarizeEvents(events) {
  const lines = [];
  let anyBypass = false;
  let anyChange = false;

  const byWindow = new Map();
  for (const ev of events) {
    if (!byWindow.has(ev.id)) byWindow.set(ev.id, []);
    byWindow.get(ev.id).push(ev);
  }

  if (byWindow.size === 0) {
    lines.push('Background diagnostics: no events recorded (the runtime did not load)');
    return { lines, bypass: false, changed: false };
  }

  for (const [id, list] of byWindow) {
    const ready = list.filter((ev) => ev.event === 'dom-ready');
    const calls = list.filter((ev) => ev.event === 'setBackgroundColor');
    const samples = list.filter((ev) => ev.event === 'sample');

    for (const ev of ready) {
      lines.push(`Window ${id}: dom-ready (${ev.method}, ${ev.type}) bg ${ev.bgBefore} -> ${ev.bgAfter} [${ev.url}]`);
    }

    const requested = [...new Set(calls.map((ev) => ev.requested))];
    lines.push(
      `Window ${id}: ${calls.length} setBackgroundColor call(s) after install` +
        (requested.length ? `, requested ${requested.join(', ')}` : '')
    );

    // A sampled change is explained if a setBackgroundColor call since the
    // previous sample left the window at that color; otherwise it was set
    // some other way, which `overwrite` cannot see.
    const bypasses = [];
    let explained = new Set();
    for (const ev of list) {
      if (ev.event === 'setBackgroundColor') {
        explained.add(ev.after);
      } else if (ev.event === 'sample') {
        if (ev.previous !== undefined && !explained.has(ev.bg)) bypasses.push(ev);
        explained = new Set();
      }
    }

    const changes = samples.filter((ev) => ev.previous !== undefined);
    const final = samples.length ? samples[samples.length - 1].bg : 'unknown';
    lines.push(`Window ${id}: background changed ${changes.length} time(s) after install; final ${final}`);
    for (const ev of bypasses) {
      lines.push(`Window ${id}: BYPASS — background went ${ev.previous} -> ${ev.bg} without a setBackgroundColor call`);
    }

    anyChange = anyChange || changes.length > 0;
    anyBypass = anyBypass || bypasses.length > 0;
  }

  return { lines, bypass: anyBypass, changed: anyChange };
}

module.exports = { parseEvents, summarizeEvents };
