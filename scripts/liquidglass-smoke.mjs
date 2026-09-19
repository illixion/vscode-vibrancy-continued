// Smoke test for the built Liquid Glass addon. Loads native/prebuilt/
// liquidglass-darwin-<arch>.node in plain Node (N-API addons are runtime-
// agnostic) and exercises everything that doesn't need a real window:
// module load, class construction, and the NSGlassEffectView capability probe.
//
//   node scripts/liquidglass-smoke.mjs
//
// addView() needs a live Electron BrowserWindow handle, so it is NOT called
// here — see LIQUID-GLASS-NOTES.md for the full in-VS Code test.
import { createRequire } from 'module';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);

if (process.platform !== 'darwin') {
  console.error('smoke: this addon is macOS-only; nothing to check here.');
  process.exit(1);
}

const addonPath = path.resolve(__dirname, `../native/prebuilt/liquidglass-darwin-${process.arch}.node`);
if (!fs.existsSync(addonPath)) {
  console.error(`smoke: ${addonPath} not found — run scripts/build-liquidglass.sh first.`);
  process.exit(1);
}

const mod = require(addonPath);
const glass = new mod.LiquidGlassNative();

const supported = glass.isGlassSupported();
console.log(`smoke: addon loaded from ${addonPath}`);
console.log(`smoke: isGlassSupported() -> ${supported}`);
console.log(supported
  ? 'smoke: OK — NSGlassEffectView is available; VS Code will get real Liquid Glass.'
  : 'smoke: OK — addon works, but NSGlassEffectView is missing (macOS < 26); VS Code will fall back to under-window vibrancy.');

// The free function export must agree with the instance method.
if (mod.isGlassSupported() !== supported) {
  console.error('smoke: module-level isGlassSupported() disagrees with the instance method.');
  process.exit(1);
}
