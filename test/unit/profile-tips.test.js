const path = require('path');
const { findVibrancyLeftovers, assessProfileSituation } = require('../../extension/profile-tips');
const { listProfiles } = require('../../extension/profile-registry');

const USER = '/Users/x/Library/Application Support/Code/User';
const MANAGED = ['editor.background', 'sideBar.background', 'panel.background'];

describe('findVibrancyLeftovers', () => {
  it('finds translucent values under managed keys', () => {
    expect(findVibrancyLeftovers({
      'editor.background': '#1e1e1ecc',
      'sideBar.background': '#1e1e1e80',
      'terminal.background': '#00000000',
    }, MANAGED)).toEqual(['editor.background', 'sideBar.background', 'terminal.background']);
  });

  it("ignores the user's own opaque colours", () => {
    // A hand-picked `#1e1e1eff` under editor.background is entirely normal.
    // Reporting it would send someone hunting a problem they do not have.
    expect(findVibrancyLeftovers({
      'editor.background': '#1e1e1eff',
      'sideBar.background': '#2d2d2dFF',
    }, MANAGED)).toEqual([]);
  });

  it('ignores keys vibrancy never manages, however they look', () => {
    expect(findVibrancyLeftovers({ 'activityBar.foreground': '#11223344' }, MANAGED)).toEqual([]);
  });

  it('ignores values that are not 8-digit hex', () => {
    expect(findVibrancyLeftovers({
      'editor.background': '#1e1e1e',
      'sideBar.background': 'red',
      'panel.background': 42,
    }, MANAGED)).toEqual([]);
  });

  it('always considers terminal.background, which is managed unconditionally', () => {
    expect(findVibrancyLeftovers({ 'terminal.background': '#00000000' }, [])).toEqual(['terminal.background']);
  });

  it('copes with junk input', () => {
    for (const colors of [null, undefined, 'nope', 42]) {
      expect(findVibrancyLeftovers(colors, MANAGED)).toEqual([]);
    }
    expect(findVibrancyLeftovers({ 'editor.background': '#1e1e1ecc' }, null)).toEqual([]);
  });
});

describe('assessProfileSituation', () => {
  const singleProfile = listProfiles(USER, null);
  const withProfiles = listProfiles(USER, {
    userDataProfiles: [{ location: 'abc', name: 'Work' }, { location: 'def', name: 'Play' }],
  });
  const sharedOnly = listProfiles(USER, {
    userDataProfiles: [{ location: 'builtin/agents', name: 'Agents', useDefaultFlags: { settings: true } }],
  });

  it('says nothing to a single-profile setup', () => {
    expect(assessProfileSituation({ profiles: singleProfile }).kind).toBe('none');
  });

  it('says nothing when every profile shares the default settings file', () => {
    // Those profiles cannot diverge from the default, so there is no scope
    // mismatch to explain.
    expect(assessProfileSituation({ profiles: sharedOnly }).kind).toBe('none');
  });

  it('introduces the scope mismatch once, naming the other profiles', () => {
    const situation = assessProfileSituation({ profiles: withProfiles });

    expect(situation.kind).toBe('introduction');
    expect(situation.profileNames).toEqual(['Play', 'Work']);
  });

  it('does not repeat the introduction', () => {
    expect(assessProfileSituation({ profiles: withProfiles, introductionShown: true }).kind).toBe('none');
  });

  it('reports stranded colours in preference to the introduction', () => {
    const situation = assessProfileSituation({
      profiles: withProfiles,
      leftovers: [
        { profileNames: ['Work'], keys: ['editor.background', 'terminal.background'] },
        { profileNames: ['Play'], keys: [] },
      ],
    });

    expect(situation.kind).toBe('stranded');
    expect(situation.profileNames).toEqual(['Work']);
    expect(situation.keys).toEqual(['editor.background', 'terminal.background']);
  });

  it('keeps reporting stranded colours even after the introduction was shown', () => {
    // Actionable, so unlike the introduction it is worth repeating until fixed.
    const situation = assessProfileSituation({
      profiles: withProfiles,
      leftovers: [{ profileNames: ['Work'], keys: ['editor.background'] }],
      introductionShown: true,
    });

    expect(situation.kind).toBe('stranded');
  });

  it('merges and de-duplicates across settings files', () => {
    const situation = assessProfileSituation({
      profiles: withProfiles,
      leftovers: [
        { profileNames: ['Default', 'Agents'], keys: ['editor.background'] },
        { profileNames: ['Work'], keys: ['editor.background', 'panel.background'] },
      ],
    });

    expect(situation.profileNames).toEqual(['Agents', 'Default', 'Work']);
    expect(situation.keys).toEqual(['editor.background', 'panel.background']);
  });

  it('copes with junk input', () => {
    expect(assessProfileSituation({}).kind).toBe('none');
    expect(assessProfileSituation({ profiles: null, leftovers: null }).kind).toBe('none');
  });
});

describe('reachability of stranded colours', () => {
  const withProfiles = listProfiles(USER, {
    userDataProfiles: [{ location: 'abc', name: 'Work' }, { location: 'def', name: 'Copy' }],
  });

  it('flags a profile that has the colours but not Vibrancy as unreachable', () => {
    // "Copy from profile" without extensions: nothing in that profile can run
    // Disable, so "switch there and disable it" would be useless advice.
    const situation = assessProfileSituation({
      profiles: withProfiles,
      leftovers: [{ profileNames: ['Copy'], keys: ['editor.background'], hasVibrancy: false }],
    });

    expect(situation.kind).toBe('unreachable');
    expect(situation.profileNames).toEqual(['Copy']);
  });

  it('prefers the unreachable case when both kinds are present', () => {
    // The reachable one resolves itself when the user visits that profile; the
    // unreachable one never will, so it is the one worth saying.
    const situation = assessProfileSituation({
      profiles: withProfiles,
      leftovers: [
        { profileNames: ['Work'], keys: ['panel.background'], hasVibrancy: true },
        { profileNames: ['Copy'], keys: ['editor.background'], hasVibrancy: false },
      ],
    });

    expect(situation.kind).toBe('unreachable');
    expect(situation.profileNames).toEqual(['Copy']);
  });

  it('treats an unknown answer as reachable', () => {
    // The softer message: send the user somewhere to look rather than telling
    // them to edit settings.json by hand on a guess.
    expect(assessProfileSituation({
      profiles: withProfiles,
      leftovers: [{ profileNames: ['Work'], keys: ['editor.background'] }],
    }).kind).toBe('stranded');
  });
});

// --- wiring guard ---
//
// index.js is one large activate() with side effects, so the tip's call site
// can't be reached by a unit test. It still needs a guard, because the bug here
// was entirely in the wiring: the logic above was correct and tested, while the
// call sat in Install() behind an `if (!sharedWriter)` copied from the
// ownership-takeover warning next to it. Update() always passes a shared writer,
// so the tip never fired for existing users upgrading — precisely the people it
// is written for, and the only ones who never run Enable.
describe('showProfileTip call site', () => {
  const fs = require('fs');
  const source = fs.readFileSync(require.resolve('../../extension/index.js'), 'utf-8');

  /** Body of a named function declared at activate()'s indent level. */
  const bodyOf = (name) => {
    const lines = source.split('\n');
    const start = lines.findIndex((l) => new RegExp(`^\\s*(async )?function ${name}\\b`).test(l));
    expect(start).toBeGreaterThan(-1);
    const rest = lines.slice(start + 1);
    const end = rest.findIndex((l) => /^  (async )?function \w+/.test(l));
    return rest.slice(0, end === -1 ? undefined : end).join('\n');
  };

  it('is called from the shared post-install path, so updates trigger it too', () => {
    // Every successful enable and update goes through applyPostInstallSettings;
    // Install() alone does not, because Update() calls Install() with a writer.
    expect(bodyOf('applyPostInstallSettings')).toContain('showProfileTip()');
  });

  it('is called exactly once, and not from Install()', () => {
    // Install() runs again on the elevated-retry path, so a call there would
    // announce profile advice twice — and, sitting before the file work, would
    // announce it for an install that then failed.
    const calls = source.match(/(?<!function )showProfileTip\(\)/g) || [];
    expect(calls).toHaveLength(1);
    expect(bodyOf('Install')).not.toContain('showProfileTip');
  });

  it('is not gated on sharedWriter', () => {
    const body = bodyOf('applyPostInstallSettings');
    const line = body.split('\n').find((l) => l.includes('showProfileTip()'));
    expect(line).not.toMatch(/sharedWriter/);
    // and nothing wraps it in such a condition within that function
    expect(body).not.toMatch(/if\s*\(\s*!?\s*sharedWriter\s*\)[^\n]*\n[^\n]*showProfileTip/);
  });
});
