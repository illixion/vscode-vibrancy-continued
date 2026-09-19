#!/bin/sh
# Build the macOS Liquid Glass native addon (native/liquidglass.mm) and stage
# the N-API prebuilts where the extension installer picks them up:
#   native/prebuilt/liquidglass-darwin-arm64.node
#   native/prebuilt/liquidglass-darwin-x64.node
#
# Usage:
#   scripts/build-liquidglass.sh            # both arches (default)
#   scripts/build-liquidglass.sh arm64      # only the host arch you name
#
# Requirements: macOS with Xcode Command Line Tools, Node.js >= 18, and
# `npm install` run once in the repo root (provides node-addon-api + node-gyp).
#
# The addon is N-API (NODE_API_MODULE + NAPI_VERSION=8), so one build loads in
# any Node/Electron that speaks N-API >= 8 — including the Electron bundled with
# VS Code — with no rebuild against Electron headers needed. Cross-arch works
# because macOS addons leave Node symbols undefined until load time.
set -eu

cd "$(dirname "$0")/.."

if [ "$(uname -s)" != "Darwin" ]; then
  echo "error: the Liquid Glass addon can only be built on macOS." >&2
  exit 1
fi

if ! xcode-select -p >/dev/null 2>&1; then
  echo "error: Xcode Command Line Tools not found. Run: xcode-select --install" >&2
  exit 1
fi

if [ ! -d node_modules/node-addon-api ]; then
  echo "error: node-addon-api missing. Run 'npm install' in the repo root first." >&2
  exit 1
fi

if [ "$#" -gt 0 ]; then
  ARCHS="$*"
else
  ARCHS="arm64 x64"
fi

mkdir -p native/prebuilt build

# node-gyp only ever reads ./binding.gyp; stage the mac config for the build
# and remove it again afterwards so the tree stays clean (CI does the same
# rename dance for the Windows binding.gyp.dist).
cleanup() { rm -f binding.gyp; }
trap cleanup EXIT INT TERM
cp -f binding.gyp.mac.dist binding.gyp

for arch in $ARCHS; do
  case "$arch" in
    arm64|x64) ;;
    *) echo "error: unknown arch '$arch' (expected arm64 or x64)" >&2; exit 1 ;;
  esac
  echo "==> Building liquidglass.node for darwin-$arch"
  npx --yes node-gyp@latest rebuild --arch="$arch"
  cp -f build/Release/liquidglass.node "native/prebuilt/liquidglass-darwin-$arch.node"
done

echo "==> Staged prebuilts:"
lipo -info native/prebuilt/liquidglass-darwin-*.node

# Sanity check: the addon must load in plain Node and answer the capability
# probe (true only on macOS 26+, where NSGlassEffectView exists).
node scripts/liquidglass-smoke.mjs
