const {
  TITLEBAR_RESTORE_KEY,
  toggleTitleBarForRestartPrompt,
  healStrandedTitleBarToggle,
} = require('../../extension/mac-restart-toggle');

/**
 * In-memory stand-ins for VSCode's global settings and extension globalState.
 * `writes` records every settings update so tests can assert the flip that
 * pops VSCode's built-in restart prompt actually happened.
 */
function makeStores({ titleBarStyle } = {}) {
  const settings = {};
  if (titleBarStyle !== undefined) settings['window.titleBarStyle'] = titleBarStyle;
  const state = {};
  const writes = [];

  const settingsStore = {
    inspect: (key) => ({ globalValue: settings[key] }),
    // Effective value: explicit setting, else VSCode's macOS default
    get: (key) => (settings[key] !== undefined ? settings[key] : 'custom'),
    update: async (key, value) => {
      writes.push(value);
      if (value === undefined) delete settings[key];
      else settings[key] = value;
    },
  };
  const globalState = {
    get: (key) => state[key],
    update: async (key, value) => {
      if (value === undefined) delete state[key];
      else state[key] = value;
    },
  };
  return { settings, state, writes, settingsStore, globalState };
}

describe('toggleTitleBarForRestartPrompt', () => {
  it('flips away and restores an explicit value, clearing the sentinel', async () => {
    const s = makeStores({ titleBarStyle: 'custom' });

    await toggleTitleBarForRestartPrompt(s);

    expect(s.writes).toEqual(['native', 'custom']);
    expect(s.settings['window.titleBarStyle']).toBe('custom');
    expect(s.state[TITLEBAR_RESTORE_KEY]).toBeUndefined();
  });

  it('restores an unset value by removing the key, not writing the default', async () => {
    const s = makeStores();

    await toggleTitleBarForRestartPrompt(s);

    expect(s.writes).toEqual(['native', undefined]);
    expect('window.titleBarStyle' in s.settings).toBe(false);
    expect(s.state[TITLEBAR_RESTORE_KEY]).toBeUndefined();
  });

  it('toggles from an explicit native value without stranding it', async () => {
    const s = makeStores({ titleBarStyle: 'native' });

    await toggleTitleBarForRestartPrompt(s);

    expect(s.writes).toEqual(['custom', 'native']);
    expect(s.settings['window.titleBarStyle']).toBe('native');
  });

  it('uses the sentinel, not the live (mid-toggle) value, when a toggle is already pending', async () => {
    // Simulate a second restart click landing while a previous toggle already
    // flipped custom -> native: the live setting reads "native", but the
    // sentinel still knows the user's real value.
    const s = makeStores({ titleBarStyle: 'native' });
    s.state[TITLEBAR_RESTORE_KEY] = { value: 'custom' };

    await toggleTitleBarForRestartPrompt(s);

    expect(s.settings['window.titleBarStyle']).toBe('custom');
    expect(s.state[TITLEBAR_RESTORE_KEY]).toBeUndefined();
  });

  it('restores immediately when the flip-back write fails once', async () => {
    const s = makeStores({ titleBarStyle: 'custom' });
    // First write (flip) succeeds, second write (restore) fails, the
    // catch-path retry succeeds.
    let failures = 1;
    const realUpdate = s.settingsStore.update;
    let calls = 0;
    s.settingsStore.update = async (key, value) => {
      calls++;
      if (calls === 2 && failures-- > 0) throw new Error('settings.json is dirty');
      return realUpdate(key, value);
    };

    await toggleTitleBarForRestartPrompt(s);

    expect(s.settings['window.titleBarStyle']).toBe('custom');
    expect(s.state[TITLEBAR_RESTORE_KEY]).toBeUndefined();
  });

  it('leaves the sentinel set when every restore write fails', async () => {
    const s = makeStores({ titleBarStyle: 'custom' });
    const realUpdate = s.settingsStore.update;
    let calls = 0;
    s.settingsStore.update = async (key, value) => {
      calls++;
      if (calls >= 2) throw new Error('settings.json is dirty');
      return realUpdate(key, value);
    };

    await toggleTitleBarForRestartPrompt(s);

    // Stranded on the flipped value — but the sentinel survives for healing.
    expect(s.settings['window.titleBarStyle']).toBe('native');
    expect(s.state[TITLEBAR_RESTORE_KEY]).toEqual({ value: 'custom' });
  });
});

describe('healStrandedTitleBarToggle', () => {
  it('restores the recorded original and clears the sentinel', async () => {
    // A toggle interrupted by quit/reload: settings stranded on "native".
    const s = makeStores({ titleBarStyle: 'native' });
    s.state[TITLEBAR_RESTORE_KEY] = { value: 'custom' };

    const healed = await healStrandedTitleBarToggle(s);

    expect(healed).toBe(true);
    expect(s.settings['window.titleBarStyle']).toBe('custom');
    expect(s.state[TITLEBAR_RESTORE_KEY]).toBeUndefined();
  });

  it('restores a null-recorded original by removing the key', async () => {
    const s = makeStores({ titleBarStyle: 'native' });
    s.state[TITLEBAR_RESTORE_KEY] = { value: null };

    const healed = await healStrandedTitleBarToggle(s);

    expect(healed).toBe(true);
    expect('window.titleBarStyle' in s.settings).toBe(false);
  });

  it('does nothing without a sentinel', async () => {
    const s = makeStores({ titleBarStyle: 'custom' });

    const healed = await healStrandedTitleBarToggle(s);

    expect(healed).toBe(false);
    expect(s.writes).toEqual([]);
    expect(s.settings['window.titleBarStyle']).toBe('custom');
  });
});

describe('interleaved toggles', () => {
  it('always converges on the original value regardless of write ordering', async () => {
    // Two stacked restart notifications clicked in quick succession: both
    // toggles run concurrently. The sentinel guarantees the second never
    // adopts the first's flipped value as the value to restore.
    const s = makeStores({ titleBarStyle: 'custom' });
    // Yield between writes so the two runs interleave.
    const realUpdate = s.settingsStore.update;
    s.settingsStore.update = async (key, value) => {
      await new Promise((r) => setImmediate(r));
      return realUpdate(key, value);
    };

    await Promise.all([
      toggleTitleBarForRestartPrompt(s),
      toggleTitleBarForRestartPrompt(s),
    ]);

    expect(s.settings['window.titleBarStyle']).toBe('custom');
    expect(s.state[TITLEBAR_RESTORE_KEY]).toBeUndefined();
  });
});
