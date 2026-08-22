/**
 * Deciding what to tell someone who uses VSCode profiles.
 *
 * Vibrancy's two halves have different scopes, and nothing in the UI hints at
 * it: the patched VSCode files are machine-wide, so the effect appears in every
 * profile at once, while `workbench.colorCustomizations` is per profile, so the
 * colours that make the effect legible only exist where Vibrancy actually ran.
 *
 * A profile that inherits the effect without the colours is where the confusing
 * failures come from — issue #183 is the visible symptom, a stale
 * `terminal.background` of `#00000000` outlining every glyph in the terminal.
 * Users reasonably read that as Vibrancy being broken rather than as a profile
 * scoping artefact, so it is worth saying out loud, once, at the point where the
 * situation is detectable.
 */

const { looksLikeVibrancyValue } = require('./file-transforms');

/**
 * Find colour keys in a profile's settings that look like Vibrancy's output.
 *
 * Only keys Vibrancy actually manages are considered, so a translucent colour
 * the user set on some unrelated key is never mistaken for a leftover. A theme
 * can name a fully opaque literal through its `colorCustomizations` block, which
 * this will miss — under-reporting is the right way to be wrong here, since the
 * alternative is telling someone their own colour is a leftover.
 *
 * @param {Object} colors - A profile's `workbench.colorCustomizations`
 * @param {string[]} managedKeys - Keys Vibrancy writes (from resolveManagedBgKeys)
 * @returns {string[]} the leftover keys, sorted for stable messages
 */
function findVibrancyLeftovers(colors, managedKeys) {
  if (!colors || typeof colors !== 'object') return [];

  const candidates = new Set([...(managedKeys || []), 'terminal.background']);
  const found = [];

  for (const [key, value] of Object.entries(colors)) {
    if (!candidates.has(key)) continue;
    if (looksLikeVibrancyValue(value)) found.push(key);
  }

  return found.sort();
}

/**
 * Work out which profile tip, if any, is worth showing.
 *
 * Four outcomes, in descending order of how much the user needs to hear it:
 *
 *   - `unreachable`: another profile carries Vibrancy's colours and does not
 *     have Vibrancy enabled, so nothing there can ever clean them up. The worst
 *     case, and the one "copy from profile" produces when extensions are left
 *     behind: the colours are copied, the extension is not.
 *   - `stranded`: another profile carries the colours but does have Vibrancy, so
 *     the user can go there and disable it. Actionable, and worth repeating.
 *   - `introduction`: profiles exist and Vibrancy is active, but nothing is
 *     stranded yet. Worth saying once, before it becomes a problem.
 *   - `none`: a single-profile setup, where none of this applies. Most users.
 *
 * Splitting the first two matters because the advice differs completely. Telling
 * someone to "switch to that profile and disable Vibrancy" is useless when
 * Vibrancy isn't installed there — they would go looking for a command that
 * doesn't exist.
 *
 * The tip is deliberately not scoped to whichever profile happens to be active.
 * Sitting in the default profile does not make the others any less likely to
 * inherit a bare effect, so the situation is worth describing either way.
 *
 * @param {Object} opts
 * @param {Array} opts.profiles - Result of listProfiles
 * @param {Array<{profileNames: string[], keys: string[], hasVibrancy?: boolean}>} [opts.leftovers]
 * @param {boolean} [opts.introductionShown] - Has the introduction already been shown here?
 * @returns {{kind: 'none'|'introduction'|'stranded'|'unreachable', profileNames: string[], keys: string[]}}
 */
function assessProfileSituation({ profiles, leftovers, introductionShown }) {
  const all = Array.isArray(profiles) ? profiles : [];
  const usesProfiles = all.some((profile) => !profile.isDefault);

  const summarise = (kind, entries) => ({
    kind,
    profileNames: [...new Set(entries.flatMap((entry) => entry.profileNames))].sort(),
    keys: [...new Set(entries.flatMap((entry) => entry.keys))].sort(),
  });

  const stranded = (leftovers || []).filter((entry) => entry.keys?.length > 0);

  // `hasVibrancy: undefined` means we couldn't tell. Treat that as reachable —
  // the softer message, since it sends the user somewhere to look rather than
  // telling them their settings need editing by hand.
  const unreachable = stranded.filter((entry) => entry.hasVibrancy === false);
  if (unreachable.length > 0) return summarise('unreachable', unreachable);
  if (stranded.length > 0) return summarise('stranded', stranded);

  // Not "profiles exist" but "profiles exist *and* there is more than one
  // settings.json in play": profiles that share the default's settings file
  // can never diverge from it, so there is nothing to warn about.
  const distinctSettingsFiles = new Set(all.map((profile) => profile.settingsPath));
  if (usesProfiles && distinctSettingsFiles.size > 1 && !introductionShown) {
    return {
      kind: 'introduction',
      profileNames: all.filter((profile) => !profile.isDefault).map((profile) => profile.name).sort(),
      keys: [],
    };
  }

  return { kind: 'none', profileNames: [], keys: [] };
}

module.exports = {
  findVibrancyLeftovers,
  assessProfileSituation,
};
