const fs = require('fs');

// Source-level guards for index.js.
//
// activate() is one large closure full of side effects and can't be loaded
// under vitest at all: `require.main` is undefined, so the appDir lookup
// throws, and its catch reaches for `_VSCODE_FILE_ROOT`, a global that only
// exists inside VSCode's own bundle. So the *logic* worth testing gets
// extracted into modules with their own tests, and what stays behind — the
// wiring between them — is guarded by reading the source.
//
// That is a weak form of test and it earns its place only where the bug was in
// the wiring rather than the logic. Every guard here corresponds to a bug that
// actually shipped.
const source = fs.readFileSync(require.resolve('../../extension/index.js'), 'utf-8');

/**
 * The body of a named function declaration, excluding its own braces.
 *
 * The indent is derived from the declaration and the closing brace must be
 * found, rather than assuming a fixed nesting depth. The first version of this
 * helper looked for the next line matching `^  function`, which meant that if
 * index.js were ever reindented it would return several hundred lines instead
 * of a few dozen and go on passing — a guard that had silently stopped
 * guarding. See the bounds test below.
 */
const bodyOf = (name) => {
  const lines = source.split('\n');
  const start = lines.findIndex((l) => new RegExp(`^\\s*(async )?function ${name}\\s*\\(`).test(l));
  expect(start, `no declaration of ${name}() found in index.js`).toBeGreaterThan(-1);

  const close = `${/^\s*/.exec(lines[start])[0]}}`;
  const end = lines.findIndex((l, i) => i > start && l === close);
  expect(end, `could not find the closing brace of ${name}()`).toBeGreaterThan(start);

  return lines.slice(start + 1, end).join('\n');
};

describe('bodyOf', () => {
  it('returns a bounded function body, not the rest of the file', () => {
    const body = bodyOf('applyPostInstallSettings');

    expect(body.split('\n').length).toBeLessThan(80);
    expect(body).not.toContain('function Install');
  });

  it('fails loudly for a function that is not there', () => {
    expect(() => bodyOf('noSuchFunction')).toThrow();
  });
});

// --- the profile tip ---
//
// The logic behind it is covered in profile-tips.test.js. The bug was entirely
// in the wiring: the call sat in Install() behind an `if (!sharedWriter)`
// copied from the ownership-takeover warning next to it. Update() always
// passes a shared writer, so the tip never fired for existing users
// upgrading — precisely the people it is written for, and the only ones who
// never run Enable.
describe('showProfileTip call site', () => {
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
    expect(body).not.toMatch(/if\s*\(\s*!?\s*sharedWriter\s*\)[^\n]*\n[^\n]*showProfileTip/);
  });
});

// --- reverting colour customizations ---
//
// Disable does two things that have to happen together: unpatch VSCode's files
// and put the user's colour customizations back. Either one alone leaves a
// visibly wrong editor. The restore used to run first, up in the preamble, so
// every abandoned uninstall past that point stranded the user in the half-done
// state — with nothing to suggest that re-running Disable is the fix.
describe('Uninstall settings restore', () => {
  const body = bodyOf('Uninstall');

  it('does not revert settings before the file work is known to be possible', () => {
    // The abandoned paths this covers: a declined elevation prompt (which
    // returns before a writer exists), a failed write, and a declined or
    // failed elevated retry.
    const preamble = body.slice(0, body.indexOf('Standalone disable when the mirror'));

    expect(preamble).toContain('confirmUninstallFromOwningProfile');
    expect(preamble).not.toContain('restorePreviousSettings');
  });

  it('reverts settings after every flush that completes an uninstall', () => {
    // Two flushes: the normal path and the elevated retry. Each is a point
    // where the files really are unpatched, so each owes the user a restore.
    const afterEachFlush = body.split(/\.flush\(\);/).slice(1);

    expect(afterEachFlush).toHaveLength(2);
    for (const tail of afterEachFlush) {
      expect(tail).toContain('restorePreviousSettings()');
    }
  });

  it('still reverts settings on the mirror-only teardown, which flushes nothing', () => {
    // NixOS disable where the mirror was never created: there are no patched
    // files to unpatch, so this path returns before any writer exists — but
    // the colour customizations were still written and still need reverting.
    const mirrorOnly = body.slice(body.indexOf('Standalone disable when the mirror'));

    expect(mirrorOnly.slice(0, mirrorOnly.indexOf('return;'))).toContain('restorePreviousSettings()');
  });
});
