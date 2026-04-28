const { computeVibrancyColors, ALL_VIBRANCY_BG_KEYS } = require('./file-transforms');

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
    if (!previousCustomizations.saved) {
      const vibrancyBackgrounds = {};
      for (const key of ALL_VIBRANCY_BG_KEYS) {
        const v = currentColorCustomizations[key];
        vibrancyBackgrounds[key] = looksLikeVibrancyValue(v, themeBackground) ? null : (v ?? null);
      }

      const cleanTerminalBg =
        currentBackground === "#00000000" || looksLikeVibrancyValue(currentBackground, themeBackground)
          ? null
          : currentBackground;

      previousCustomizations = {
        saved: true,
        terminalBackground: cleanTerminalBg,
        vibrancyBackgrounds: vibrancyBackgrounds,
        gpuAcceleration: currentGpuAcceleration,
        removedFromApplyToAllProfiles: previousCustomizations.removedFromApplyToAllProfiles || false,
        systemColorTheme: currentSystemColorTheme,
        autoDetectColorScheme: currentAutoDetectColorScheme,
      };
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
      });

      const newColorCustomization = {
        ...currentColorCustomizations,
        "terminal.background": "#00000000",
        ...vibrancyColors,
      };

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

        for (const key of ALL_VIBRANCY_BG_KEYS) {
          const originalValue = previousCustomizations.vibrancyBackgrounds[key];
          if (originalValue != null) {
            restoredColorCustomizations[key] = originalValue;
          } else {
            delete restoredColorCustomizations[key];
          }
        }

        await settingsStore.update("workbench.colorCustomizations", restoredColorCustomizations);
      } catch (error) {
        console.error("Error restoring color customizations:", error);
      }

      delete previousCustomizations.vibrancyBackgrounds;
      delete previousCustomizations.terminalBackground;
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
 */
async function restoreSettings(deps) {
  const { settingsStore, globalState, disableColorCustomizations } = deps;
  const previousCustomizations = globalState.get('customizations');

  try {
    if (!disableColorCustomizations) {
      const terminalColorConfig = settingsStore.inspect("workbench.colorCustomizations");
      const restoredColorCustomizations = { ...(terminalColorConfig?.globalValue || {}) };

      if (restoredColorCustomizations["terminal.background"] === "#00000000") {
        delete restoredColorCustomizations["terminal.background"];
      }

      for (const key of ALL_VIBRANCY_BG_KEYS) {
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
