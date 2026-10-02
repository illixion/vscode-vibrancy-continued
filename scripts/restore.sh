#!/usr/bin/env bash
#
# Vibrancy Continued — put back an editor's original files.
#
# Vibrancy patches files inside the editor's installation. If an editor won't
# start after enabling Vibrancy, or its window is invisible, Disable can't help:
# it runs inside the editor. Since 1.3.1 Vibrancy keeps the original of every
# file it patches next to it (main.js.vibrancy-orig), and this copies those
# originals back, so the editor starts again without being reinstalled.
#
# Usage:
#   ./restore.sh                 restore every editor that has originals saved
#   ./restore.sh Cursor          only installs whose path contains "Cursor"
#   ./restore.sh path/to/app/out only that install
#
# Run it with the editor closed. Vibrancy itself stays installed: once the
# editor starts, run "Disable Vibrancy" to remove its colour settings too.

FILTER="$1"
SUFFIX=".vibrancy-orig"

CANDIDATES=()
if [ -n "$FILTER" ] && [ -d "$FILTER" ]; then
  CANDIDATES=("$FILTER")
  FILTER=""
else
  shopt -s nullglob
  CANDIDATES=(
    # macOS
    /Applications/*.app/Contents/Resources/app/out
    "$HOME"/Applications/*.app/Contents/Resources/app/out
    # Linux
    /usr/share/*/resources/app/out
    /usr/lib/*/resources/app/out
    /opt/*/resources/app/out
    # Linux, Vibrancy's writable copy on read-only installs (NixOS)
    "$HOME"/.local/share/vscode-vibrancy/*/resources/app/out
    "$HOME"/.local/share/vscode-vibrancy/*/lib/*/resources/app/out
  )
  shopt -u nullglob
fi

restored=0
for out in "${CANDIDATES[@]}"; do
  [ -d "$out" ] || continue
  case "$out" in *"$FILTER"*) ;; *) continue ;; esac

  for backup in "$out"/*"$SUFFIX"; do
    [ -f "$backup" ] || continue
    original="${backup%"$SUFFIX"}"

    # Copy over the original rather than moving, so the file keeps its owner
    # and permissions; use sudo only where the install isn't writable.
    SUDO=""
    [ -w "$original" ] && [ -w "$out" ] || SUDO="sudo"
    if $SUDO cp "$backup" "$original" && $SUDO rm -f "$backup"; then
      echo "restored: $original"
      restored=$((restored + 1))
    else
      echo "FAILED:   $original (copy $backup over it by hand)"
    fi
  done
done

if [ "$restored" -eq 0 ]; then
  echo "Found no files to restore${FILTER:+ matching \"$FILTER\"}."
  echo "Vibrancy keeps originals from version 1.3.1 on. If the editor was patched by an"
  echo "older version, or yours is installed elsewhere, pass its app/out directory:"
  echo "  $0 /path/to/resources/app/out"
  echo "Otherwise reinstalling the editor restores its files."
  exit 1
fi

echo
echo "Done. Start the editor, then run \"Disable Vibrancy\" to remove its colour settings,"
echo "and please report what happened: https://github.com/illixion/vscode-vibrancy-continued/issues"
