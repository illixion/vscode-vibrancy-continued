#!/usr/bin/env bash
#
# Vibrancy Continued — check whether the patches actually landed.
#
# Vibrancy works by patching files inside VSCode's own installation. When the
# effect doesn't show up, the useful question is which of those patches are
# present, since an install can report success while a patch silently no-ops.
# This reads the installed files directly and reports what it finds.
#
# Usage:
#   ./diagnose.sh [path/to/resources/app/out]
#
# The path is only needed if your install isn't in one of the common locations
# below. Nothing is modified — this only reads.

CANDIDATES=(
  "$1"
  # Linux
  /usr/share/code/resources/app/out
  /usr/lib/code/resources/app/out
  /opt/visual-studio-code/resources/app/out
  /usr/share/code-insiders/resources/app/out
  /usr/share/codium/resources/app/out
  /usr/lib/codium/resources/app/out
  /opt/vscodium-bin/resources/app/out
  # Linux, Vibrancy's writable copy on read-only installs (NixOS)
  "$HOME/.local/share/vscode-vibrancy/current/resources/app/out"
  # macOS
  "/Applications/Visual Studio Code.app/Contents/Resources/app/out"
  "/Applications/VSCodium.app/Contents/Resources/app/out"
)

OUT=""
for c in "${CANDIDATES[@]}"; do
  [ -n "$c" ] && [ -f "$c/main.js" ] && OUT="$c" && break
done

if [ -z "$OUT" ]; then
  echo "Could not find VSCode's app/out directory."
  echo "Re-run with the path, e.g.: $0 /usr/share/code/resources/app/out"
  exit 1
fi

MAIN="$OUT/main.js"
ELECTRON_MAIN="$OUT/vs/code/electron-main/main.js"
# VSCode 1.95+ merged the Electron main and workbench main into one file.
[ -f "$ELECTRON_MAIN" ] || ELECTRON_MAIN="$MAIN"

say() { printf '%-42s %s\n' "$1" "$2"; }
has() { grep -qF "$2" "$1" 2>/dev/null && echo yes || echo NO; }

echo "=== Vibrancy Continued diagnostic ==="
say "app/out:" "$OUT"
say "electron main is a separate file:" "$([ "$ELECTRON_MAIN" = "$MAIN" ] && echo "no (merged, VSCode 1.95+)" || echo yes)"
say "VSCode version:" "$(grep -o '"version":[[:space:]]*"[^"]*"' "$OUT/../package.json" 2>/dev/null | head -1 | cut -d'"' -f4)"
say "writable without sudo:" "$([ -w "$MAIN" ] && echo yes || echo "NO (install needs elevation)")"
echo

# Everything below is meaningless if Vibrancy isn't currently applied, so say so
# up front rather than letting an unpatched file read as a broken patch.
if ! grep -qF 'vscode_vibrancy_plugin' "$MAIN" 2>/dev/null; then
  echo "!!! Vibrancy is NOT currently installed in this VSCode."
  echo "!!! Run 'Enable Vibrancy', fully quit and reopen VSCode, then re-run this."
  echo
fi

# The runtime bootstrap. If these are missing, the install didn't complete.
echo "--- 1. runtime bootstrap (workbench main.js) ---"
say "vibrancy markers present:" "$(has "$MAIN" 'VSCODE-VIBRANCY-START')"
say "vscode_vibrancy_plugin injected:" "$(has "$MAIN" 'vscode_vibrancy_plugin')"
say "runtime folder present:" "$([ -d "$OUT/vscode-vibrancy-runtime-v6" ] && echo yes || echo NO)"
echo

# The window options. On Linux the effect comes entirely from window
# transparency, so 'transparent:true' missing here means no visible effect even
# though everything above may be present.
echo "--- 2. window options (electron main) ---"
say "frame:false,transparent:true:" "$(has "$ELECTRON_MAIN" 'frame:false,transparent:true')"
say "frame:false,transparent:false:" "$(has "$ELECTRON_MAIN" 'frame:false,transparent:false')"
# Options are injected at this anchor; if it's absent the injection can't apply.
say "injection anchor present:" "$(has "$ELECTRON_MAIN" 'experimentalDarkMode')"
echo

# Vibrancy embeds its settings into main.js at install time, so this shows the
# config that actually produced the patch above — not what's in settings.json now.
echo "--- 2b. config used at install time (read back from main.js) ---"
# Matched with [^}]* rather than a bounded .\{0,N\} repetition: macOS ships BSD
# grep, which rejects counts above RE_DUP_MAX (255) with "maximum repetition
# exceeds 255". The config object holds no nested braces, so [^}]* ends exactly
# at its closing brace. -E throughout, since \? is a GNU BRE extension.
CFG=$(grep -o '"config":{[^}]*}' "$MAIN" 2>/dev/null | head -1)
for k in type windowMode windowControlsStyle forceFramelessWindow disableFramelessWindow; do
  v=$(printf '%s' "$CFG" | grep -Eo "\"$k\":\"?[A-Za-z0-9._-]*\"?" | head -1 | cut -d: -f2- | tr -d '"')
  say "$k:" "${v:-<not found>}"
done
echo

echo "--- 3. CSP (workbench.html) ---"
HTML=$(ls "$OUT"/vs/code/electron-*/workbench/workbench*.html 2>/dev/null | head -1)
if [ -n "$HTML" ]; then
  say "html:" "${HTML#$OUT/}"
  say "trusted-types patched:" "$(has "$HTML" 'VscodeVibrancyContinued')"
else
  say "html:" "NOT FOUND"
fi
echo

echo "--- 4. session (Linux) ---"
say "session type:" "${XDG_SESSION_TYPE:-unknown} / ${XDG_CURRENT_DESKTOP:-unknown}"
AGENT=$(pgrep -laf 'polkit.*agent|polkit-.*-authentication|hyprpolkitagent' 2>/dev/null | head -1)
say "polkit agent running:" "${AGENT:-none found}"
echo "=== end ==="
