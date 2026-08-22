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
