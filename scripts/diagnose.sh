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
# VSCode 1.95+ merged the Electron main and workbench main into one file, and
# 1.140 moved window creation out of it again, into a sibling mainImpl.js.
[ -f "$ELECTRON_MAIN" ] || ELECTRON_MAIN="$OUT/mainImpl.js"
[ -f "$ELECTRON_MAIN" ] || ELECTRON_MAIN="$MAIN"

say() { printf '%-42s %s\n' "$1" "$2"; }
has() { grep -qF "$2" "$1" 2>/dev/null && echo yes || echo NO; }

echo "=== Vibrancy Continued diagnostic ==="
say "app/out:" "$OUT"
case "$ELECTRON_MAIN" in
  "$MAIN") window_file="main.js (merged, VSCode 1.95-1.139)" ;;
  */mainImpl.js) window_file="mainImpl.js (VSCode 1.140+)" ;;
  *) window_file="vs/code/electron-main/main.js (before VSCode 1.95)" ;;
esac
say "window options live in:" "$window_file"
say "VSCode version:" "$(grep -o '"version":[[:space:]]*"[^"]*"' "$OUT/../package.json" 2>/dev/null | head -1 | cut -d'"' -f4)"
say "writable without sudo:" "$([ -w "$MAIN" ] && echo yes || echo "NO (install needs elevation)")"
# The patch records the version that made it. An installed version newer than
# that means the files predate the last update (Reload Vibrancy, then fully quit
# and reopen, rewrites them). Patches before 1.4.0 carry it only in the
# extension path they embed, so fall back to that.
patched_by=$(grep -Eo '"vibrancyVersion":"[0-9][0-9.]*[0-9]' "$MAIN" 2>/dev/null | head -1 | cut -d'"' -f4)
[ -n "$patched_by" ] || patched_by=$(grep -Eo 'illixion\.vscode-vibrancy-continued-[0-9][0-9.]*' "$MAIN" 2>/dev/null | head -1 | sed 's/.*-//')
say "Vibrancy version that patched:" "${patched_by:-<none>}"
installed=""
for d in "$HOME"/.*/extensions/illixion.vscode-vibrancy-continued-*; do
  [ -d "$d" ] || continue
  editor_dir=${d#"$HOME"/}
  # Open VSX installs carry a target suffix: ...-1.2.0-universal.
  v=${d##*/illixion.vscode-vibrancy-continued-}
  installed="$installed${installed:+, }${v%%-*} (~/${editor_dir%%/*})"
done
say "Vibrancy installed:" "${installed:-<not found>}"
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
# macOS puts frame:false on the custom title bar branch (X.frame=false,) and only
# the transparency in the options literal; elsewhere both sit in the literal.
hasE() { grep -qE "$2" "$1" 2>/dev/null && echo yes || echo NO; }
say "frameless (frame:false):" "$(hasE "$ELECTRON_MAIN" 'frame:false|[A-Za-z_$][A-Za-z0-9_$]*\.frame=false,')"
say "transparent:true:" "$(hasE "$ELECTRON_MAIN" 'transparent:true|\.transparent=true,')"
say "transparent:false:" "$(hasE "$ELECTRON_MAIN" 'transparent:false|\.transparent=false,')"
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
# Set when nativeFullScreen=false forced the native title bar: the window stays
# borderless, frame options in the literal, and the runtime restores the
# traffic lights. Older Vibrancy versions don't write it.
v=$(grep -Eo '"macWindowButtons":(true|false)' "$MAIN" 2>/dev/null | head -1 | cut -d: -f2)
say "macWindowButtons:" "${v:-<not found>}"
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
