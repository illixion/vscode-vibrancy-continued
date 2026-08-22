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

// Vibrancy only ever writes translucent colours: the transparent tier is alpha
// `00`, the opaque tier `e6`, and every tier in between is derived from the
// user's opacity. So an 8-digit hex with a non-`ff` alpha under a key Vibrancy
// manages is very likely ours.
//
// The alpha check is what keeps this from flagging the user's own colours: a
// hand-picked `#1e1e1eff` is a perfectly ordinary thing to have under
// `editor.background`, and calling that a leftover would send people hunting
// for a problem they don't have. A theme's `colorCustomizations` block can
// name a fully opaque literal, which this will miss — under-reporting is the
// right way to be wrong here.
const TRANSLUCENT_HEX = /^#[0-9a-f]{6}(?![fF]{2}$)[0-9a-f]{2}$/i;

/**
 * Find colour keys in a profile's settings that look like Vibrancy's output.
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
    if (typeof value === 'string' && TRANSLUCENT_HEX.test(value)) found.push(key);
  }

  return found.sort();
}

/**
 * Work out which profile tip, if any, is worth showing.
 *
 * Three outcomes, in descending order of how much the user needs to hear it:
 *
 *   - `stranded`: another profile is carrying Vibrancy's colours with no way to
 *     revert them from here. Actionable, and worth repeating.
 *   - `introduction`: profiles exist and Vibrancy is active, but nothing is
 *     stranded yet. Worth saying once, before it becomes a problem.
 *   - `none`: a single-profile setup, where none of this applies. Most users.
 *
 * The tip is deliberately not scoped to whichever profile happens to be active.
 * Sitting in the default profile does not make the others any less likely to
 * inherit a bare effect, so the situation is worth describing either way.
 *
 * @param {Object} opts
 * @param {Array} opts.profiles - Result of listProfiles
 * @param {Array<{profileNames: string[], keys: string[]}>} [opts.leftovers] - Per-file scan results
 * @param {boolean} [opts.introductionShown] - Has the introduction already been shown here?
 * @returns {{kind: 'none'|'introduction'|'stranded', profileNames: string[], keys: string[]}}
 */
function assessProfileSituation({ profiles, leftovers, introductionShown }) {
  const all = Array.isArray(profiles) ? profiles : [];
  const usesProfiles = all.some((profile) => !profile.isDefault);

  const stranded = (leftovers || []).filter((entry) => entry.keys?.length > 0);
  if (stranded.length > 0) {
    return {
      kind: 'stranded',
      profileNames: [...new Set(stranded.flatMap((entry) => entry.profileNames))].sort(),
      keys: [...new Set(stranded.flatMap((entry) => entry.keys))].sort(),
    };
  }

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
