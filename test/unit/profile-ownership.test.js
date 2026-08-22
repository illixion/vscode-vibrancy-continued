const path = require('path');
const {
  deriveProfileIdentity,
  evaluateUninstallOwnership,
  isOwnershipTakeover,
} = require('../../extension/profile-ownership');

// Real on-disk layouts: the default profile stores extension state directly
// under <data>/globalStorage, a named profile under <data>/profiles/<id>/...
const DEFAULT_PROFILE = path.join(
  '/Users/x/Library/Application Support/Code/User',
  'globalStorage', 'illixion.vscode-vibrancy-continued',
);
const NAMED_PROFILE = path.join(
  '/Users/x/Library/Application Support/Code/User/profiles/abc123',
  'globalStorage', 'illixion.vscode-vibrancy-continued',
);

describe('deriveProfileIdentity', () => {
  it('derives a stable key and a human hint', () => {
    const first = deriveProfileIdentity(DEFAULT_PROFILE);
    const second = deriveProfileIdentity(DEFAULT_PROFILE);

    expect(first).toEqual(second);
    expect(first.key).toMatch(/^[0-9a-f]{16}$/);
    expect(first.hint).toBe('User');
  });

  it('gives different profiles different keys', () => {
    const a = deriveProfileIdentity(DEFAULT_PROFILE);
    const b = deriveProfileIdentity(NAMED_PROFILE);

    expect(a.key).not.toBe(b.key);
    expect(b.hint).toBe('abc123');
  });

  it('is not confused by a different extension in the same profile', () => {
    const ours = deriveProfileIdentity(DEFAULT_PROFILE);
    const theirs = deriveProfileIdentity(
      path.join('/Users/x/Library/Application Support/Code/User', 'globalStorage', 'other.extension'),
    );

    // Same profile, so the same owner — the extension id must not affect it
    expect(ours.key).toBe(theirs.key);
  });

  it('returns null when the path is missing or unusable', () => {
    for (const value of [undefined, null, '', 42, {}, '/']) {
      expect(deriveProfileIdentity(value)).toBeNull();
    }
  });
});

describe('evaluateUninstallOwnership', () => {
  const current = deriveProfileIdentity(DEFAULT_PROFILE);
  const other = deriveProfileIdentity(NAMED_PROFILE);

  it('allows the owning profile through', () => {
    expect(evaluateUninstallOwnership({ ownerKey: current.key, currentProfile: current }))
      .toEqual({ allowed: true, reason: 'owner' });
  });

  it('stops a profile that does not own the install', () => {
    expect(evaluateUninstallOwnership({ ownerKey: other.key, currentProfile: current }))
      .toEqual({ allowed: false, reason: 'foreign-profile' });
  });

  it('allows through when no owner was ever recorded', () => {
    // Installed by a version from before ownership was tracked — Vibrancy must
    // not make itself impossible to remove.
    for (const ownerKey of [undefined, null, '']) {
      expect(evaluateUninstallOwnership({ ownerKey, currentProfile: current }).allowed).toBe(true);
    }
  });

  it('allows through when the current profile cannot be determined', () => {
    expect(evaluateUninstallOwnership({ ownerKey: other.key, currentProfile: null }))
      .toEqual({ allowed: true, reason: 'profile-unknown' });
  });
});

describe('isOwnershipTakeover', () => {
  const current = deriveProfileIdentity(DEFAULT_PROFILE);
  const other = deriveProfileIdentity(NAMED_PROFILE);

  it('is a takeover when another profile owns the install', () => {
    expect(isOwnershipTakeover({ ownerKey: other.key, currentProfile: current })).toBe(true);
  });

  it('is not a takeover when re-enabling in the owning profile', () => {
    expect(isOwnershipTakeover({ ownerKey: current.key, currentProfile: current })).toBe(false);
  });

  it('is not a takeover on a first install, or with an unknown profile', () => {
    expect(isOwnershipTakeover({ ownerKey: null, currentProfile: current })).toBe(false);
    expect(isOwnershipTakeover({ ownerKey: other.key, currentProfile: null })).toBe(false);
  });
});
