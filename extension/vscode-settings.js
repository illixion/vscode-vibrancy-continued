const {
  computeVibrancyColors,
  parseThemeColorCustomizations,
  resolveManagedBgKeys,
} = require('./file-transforms');

// A value is treated as "vibrancy-applied, not user-set" when it is an
// 8-char `#RRGGBBAA` hex whose RGB matches the current theme background.
// This protects the initial backup from being poisoned when settings.json
// still contains vibrancy values from a previous install (issue #247).
function looksLikeVibrancyValue(value, themeBackground) {
  if (typeof value !== 'string') return false;
  const m = /^#([0-9a-f]{6})([0-9a-f]{2})$/i.exec(value);
  if (!m) return false;
  return !!themeBackground && m[1].toLowerCase() === themeBackground.toLowerCase();
}

/**
 * Apply vibrancy-related VSCode settings (color customizations, gpu acceleration, auto theme).
 *
 * @param {Object} deps - Injected dependencies
 * @param {Object} deps.settingsStore - Settings read/write interface
 * @param {(key: string) => { globalValue: any }} deps.settingsStore.inspect
 * @param {(key: string, value: any) => Promise<void>} deps.settingsStore.update
 * @param {Object} deps.globalState - Extension global state
 * @param {(key: string) => any} deps.globalState.get
 * @param {(key: string, value: any) => Promise<void>} deps.globalState.update
 * @param {Object} deps.themeConfig - Resolved theme config JSON
 * @param {boolean} deps.enableAutoTheme
 * @param {boolean} deps.disableColorCustomizations
 * @param {number} deps.opacity - Resolved opacity value
 * @param {string} deps.themeBackground - 6-char hex background (e.g. "1e1e1e")
 * @param {(msg: string) => void} deps.showInfo - Show info message
 * @param {(key: string) => string} deps.localize - Localization function
 * @returns {Promise<Object>} previousCustomizations
 */
async function applySettings(deps) {
  const {
    settingsStore,
    globalState,
    themeConfig,
    enableAutoTheme,
    disableColorCustomizations,
    opacity,
    themeBackground,
    showInfo,
    localize,
  } = deps;

  const gpuAccelerationConfig = settingsStore.inspect("terminal.integrated.gpuAcceleration");
  const systemColorTheme = settingsStore.inspect("window.systemColorTheme");
  const autoDetectColorScheme = settingsStore.inspect("window.autoDetectColorScheme");

  let previousCustomizations = globalState.get('customizations') || {};

  const currentGpuAcceleration = gpuAccelerationConfig?.globalValue;
  const currentSystemColorTheme = systemColorTheme?.globalValue;
  const currentAutoDetectColorScheme = autoDetectColorScheme?.globalValue;

  // Keys vibrancy owns under this theme: its own defaults plus anything the
  // theme's `colorCustomizations` enrichment names.
  const managedKeys = resolveManagedBgKeys(themeConfig?.colorCustomizations);

  if (!disableColorCustomizations) {
    const terminalColorConfig = settingsStore.inspect("workbench.colorCustomizations");
    const applyToAllProfilesConfig = settingsStore.inspect("workbench.settings.applyToAllProfiles");
    const currentColorCustomizations = terminalColorConfig?.globalValue || {};
    const currentBackground = currentColorCustomizations?.["terminal.background"];
    const currentApplyToAllProfiles = applyToAllProfilesConfig?.globalValue;

    // Store original values if not already saved.
    // Sanitise against vibrancy's own output: when settings.json still holds
    // vibrancy values from a previous install (e.g. user removed the extension
    // without disabling first, then reinstalled — issue #247), treating those
    // values as "user originals" would poison the backup so disable later
    // re-applies them. Drop them to null so disable cleanly removes the keys.
    // A theme's literal colours don't derive from themeBackground, so
    // looksLikeVibrancyValue can't recognise them as vibrancy's own output.
    // Match them per-key as well, otherwise reinstalling without disabling
    // first would back up a theme's literal as if the user had chosen it
    // (the same poisoning issue #247 describes, via a different route).
    const { overrides: themeOverrides } = parseThemeColorCustomizations(themeConfig?.colorCustomizations);

    const captureOriginal = (key) => {
      const v = currentColorCustomizations[key];
      if (looksLikeVibrancyValue(v, themeBackground)) return null;

      const literal = themeOverrides[key]?.literal;
      if (literal && typeof v === 'string' && v.toLowerCase() === literal.toLowerCase()) return null;

      return v ?? null;
    };

    const cleanTerminalBg =
      currentBackground === "#00000000" || looksLikeVibrancyValue(currentBackground, themeBackground)
        ? null
        : currentBackground;

    if (!previousCustomizations.saved) {
      const vibrancyBackgrounds = {};
      for (const key of managedKeys) {
        vibrancyBackgrounds[key] = captureOriginal(key);
      }

      previousCustomizations = {
        saved: true,
        terminalBackground: cleanTerminalBg,
        vibrancyBackgrounds: vibrancyBackgrounds,
        gpuAcceleration: currentGpuAcceleration,
        removedFromApplyToAllProfiles: previousCustomizations.removedFromApplyToAllProfiles || false,
        systemColorTheme: currentSystemColorTheme,
        autoDetectColorScheme: currentAutoDetectColorScheme,
      };
    } else if (!previousCustomizations.vibrancyBackgrounds) {
      // Saved, but the colour backup is gone: a previous run handed the colours
      // back and dropped it — either disableColorCustomizations was switched on
      // and has now been switched off again, or the very first install happened
      // while it was on. settings.json currently holds the user's own colours,
      // so the backup has to be re-taken before we overwrite them. Without
      // this, toggling that setting on and off silently destroyed any custom
      // background colours the user had.
      const vibrancyBackgrounds = {};
      for (const key of managedKeys) {
        vibrancyBackgrounds[key] = captureOriginal(key);
      }
      previousCustomizations.vibrancyBackgrounds = vibrancyBackgrounds;
      previousCustomizations.terminalBackground = cleanTerminalBg;
    } else {
      // Backfill keys this theme names that the existing backup never captured
      // (the user switched to a theme whose `colorCustomizations` reaches keys
      // the previous theme left alone). Without this their pre-vibrancy values
      // would be lost and disable couldn't restore them.
      for (const key of managedKeys) {
        if (key in previousCustomizations.vibrancyBackgrounds) continue;
        previousCustomizations.vibrancyBackgrounds[key] = captureOriginal(key);
      }
    }

    try {
      // Remove "workbench.colorCustomizations" from applyToAllProfiles if it's there
      if (!previousCustomizations.removedFromApplyToAllProfiles && currentApplyToAllProfiles?.includes("workbench.colorCustomizations")) {
        const updatedApplyToAllProfiles = currentApplyToAllProfiles.filter(setting => setting !== "workbench.colorCustomizations");
        await settingsStore.update("workbench.settings.applyToAllProfiles", updatedApplyToAllProfiles);

        showInfo(localize('messages.applyToAllProfiles'));
      }
      previousCustomizations.removedFromApplyToAllProfiles = true;

      const vibrancyColors = computeVibrancyColors({
        themeBackground,
        opacity,
        originalColors: previousCustomizations.vibrancyBackgrounds || {},
        themeColorCustomizations: themeConfig?.colorCustomizations,
      });

      const newColorCustomization = {
        ...currentColorCustomizations,
        "terminal.background": "#00000000",
        ...vibrancyColors,
      };

      // Keys the theme opted out of (spec `null`): hand them back to the colour
      // theme by restoring the user's own value, or removing the key entirely.
      // `terminal.background` is included so a theme can opt out of the forced
      // transparency above and let the panel render opaque.
      const { unmanaged } = parseThemeColorCustomizations(themeConfig?.colorCustomizations);
      for (const key of unmanaged) {
        const original = key === "terminal.background"
          ? previousCustomizations.terminalBackground
          : previousCustomizations.vibrancyBackgrounds?.[key];

        if (original != null) {
          newColorCustomization[key] = original;
        } else {
          delete newColorCustomization[key];
        }
      }

      await settingsStore.update("workbench.colorCustomizations", newColorCustomization);
    } catch (error) {
      console.error("Error updating color customizations:", error);
    }
  } else {
    // Setting was enabled — restore any previously saved color customizations
    if (previousCustomizations.saved && previousCustomizations.vibrancyBackgrounds) {
      try {
        const terminalColorConfig = settingsStore.inspect("workbench.colorCustomizations");
        const restoredColorCustomizations = { ...(terminalColorConfig?.globalValue || {}) };

        if (restoredColorCustomizations["terminal.background"] === "#00000000") {
          if (previousCustomizations.terminalBackground && previousCustomizations.terminalBackground !== "#00000000") {
            restoredColorCustomizations["terminal.background"] = previousCustomizations.terminalBackground;
          } else {
            delete restoredColorCustomizations["terminal.background"];
          }
        }

        // Union with whatever was actually backed up, so keys introduced by a
        // theme's `colorCustomizations` (this theme's or a previously active
        // one) are cleaned up too rather than left orphaned.
        const keysToRestore = new Set([
          ...managedKeys,
          ...Object.keys(previousCustomizations.vibrancyBackgrounds),
        ]);

        for (const key of keysToRestore) {
          const originalValue = previousCustomizations.vibrancyBackgrounds[key];
          if (originalValue != null) {
            restoredColorCustomizations[key] = originalValue;
          } else {
            delete restoredColorCustomizations[key];
          }
        }

        await settingsStore.update("workbench.colorCustomizations", restoredColorCustomizations);

        // Drop the backup only once the restore has actually landed. Dropping it
        // unconditionally meant a failed write left vibrancy's colours in
        // settings.json with nothing left to restore them from.
        delete previousCustomizations.vibrancyBackgrounds;
        delete previousCustomizations.terminalBackground;
      } catch (error) {
        console.error("Error restoring color customizations:", error);
      }
    }

    // Still store non-color settings for backup/restore
    if (!previousCustomizations.saved) {
      previousCustomizations = {
        saved: true,
        gpuAcceleration: currentGpuAcceleration,
        removedFromApplyToAllProfiles: previousCustomizations.removedFromApplyToAllProfiles || false,
        systemColorTheme: currentSystemColorTheme,
        autoDetectColorScheme: currentAutoDetectColorScheme,
      };
    }
  }

  try {
    await settingsStore.update("terminal.integrated.gpuAcceleration", "off");

    if (enableAutoTheme) {
      try {
        await settingsStore.update("window.autoDetectColorScheme", true);
      } catch (error) {
        console.warn("window.autoDetectColorScheme is not supported in this version of VSCode.");
      }
      try {
        await settingsStore.update("window.systemColorTheme", undefined);
      } catch (error) {
        console.warn("window.systemColorTheme is not supported in this version of VSCode.");
      }
    } else {
      try {
        await settingsStore.update("window.systemColorTheme", themeConfig.systemColorTheme);
      } catch (error) {
        console.warn("window.systemColorTheme is not supported in this version of VSCode.");
      }
      try {
        await settingsStore.update("window.autoDetectColorScheme", false);
      } catch (error) {
        console.warn("window.autoDetectColorScheme is not supported in this version of VSCode.");
      }
    }
  } catch (error) {
    console.error("Error updating settings:", error);
  }

  await globalState.update('customizations', previousCustomizations);

  return previousCustomizations;
}

/**
 * Restore previous VSCode settings on uninstall/disable.
 *
 * @param {Object} deps - Injected dependencies
 * @param {Object} deps.settingsStore - Settings read/write interface
 * @param {Object} deps.globalState - Extension global state
 * @param {boolean} deps.disableColorCustomizations
 * @param {Object} [deps.themeConfig] - Resolved theme config JSON, so keys the
 *   active theme's `colorCustomizations` introduces are cleaned up even if the
 *   backup is missing.
 */
async function restoreSettings(deps) {
  const { settingsStore, globalState, disableColorCustomizations, themeConfig } = deps;
  const previousCustomizations = globalState.get('customizations');

  // A surviving colour backup proves vibrancy has writes in settings.json that
  // were never handed back, so they must be cleaned up even when
  // disableColorCustomizations is on — that setting means "don't touch my
  // colours", not "abandon the ones you already wrote". Skipping the cleanup
  // here used to strand vibrancy's translucent colours in settings.json and
  // then wipe the backup below, losing the user's originals irrecoverably.
  const hasOutstandingColorWrites = !!previousCustomizations?.vibrancyBackgrounds;

  try {
    if (!disableColorCustomizations || hasOutstandingColorWrites) {
      const terminalColorConfig = settingsStore.inspect("workbench.colorCustomizations");
      const restoredColorCustomizations = { ...(terminalColorConfig?.globalValue || {}) };

      if (restoredColorCustomizations["terminal.background"] === "#00000000") {
        delete restoredColorCustomizations["terminal.background"];
      }

      // Clear vibrancy's built-in keys, anything the active theme introduces,
      // and anything the backup recorded (which may come from a theme that was
      // active earlier). The theme is consulted as well as the backup so a
      // wiped globalState doesn't orphan theme-introduced keys.
      const keysToClear = new Set([
        ...resolveManagedBgKeys(themeConfig?.colorCustomizations),
        ...Object.keys(previousCustomizations?.vibrancyBackgrounds || {}),
      ]);

      for (const key of keysToClear) {
        delete restoredColorCustomizations[key];
      }

      if (previousCustomizations?.saved) {
        if (previousCustomizations.terminalBackground !== undefined) {
          if (previousCustomizations.terminalBackground === null || previousCustomizations.terminalBackground === "#00000000") {
            delete restoredColorCustomizations["terminal.background"];
          } else {
            restoredColorCustomizations["terminal.background"] = previousCustomizations.terminalBackground;
          }
        }

        if (previousCustomizations.vibrancyBackgrounds) {
          for (const [key, originalValue] of Object.entries(previousCustomizations.vibrancyBackgrounds)) {
            if (originalValue === null || originalValue === undefined) {
              delete restoredColorCustomizations[key];
            } else {
              restoredColorCustomizations[key] = originalValue;
            }
          }
        }
      }

      await settingsStore.update("workbench.colorCustomizations", restoredColorCustomizations);
    }

    if (previousCustomizations?.saved) {
      try {
        await settingsStore.update("window.systemColorTheme", previousCustomizations.systemColorTheme);
      } catch (error) {
        console.warn("window.systemColorTheme is not supported in this version of VSCode.");
      }
      try {
        await settingsStore.update("window.autoDetectColorScheme", previousCustomizations.autoDetectColorScheme);
      } catch (error) {
        console.warn("window.autoDetectColorScheme is not supported in this version of VSCode.");
      }
      await settingsStore.update("terminal.integrated.gpuAcceleration", previousCustomizations.gpuAcceleration);

      const removedFromApplyToAllProfiles = previousCustomizations.removedFromApplyToAllProfiles;
      await globalState.update('customizations', { removedFromApplyToAllProfiles });
    }
  } catch (error) {
    console.error("Error updating settings:", error);
  }
}

module.exports = { applySettings, restoreSettings };
