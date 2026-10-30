#!/usr/bin/env bash
set -euo pipefail

mkdir -p terminal/vendor

# v86 emulator
cp node_modules/v86/build/libv86.mjs terminal/vendor/
node scripts/browser-linux/patch-console.mjs

# xterm.js
cp node_modules/@xterm/xterm/lib/xterm.mjs terminal/vendor/
cp node_modules/@xterm/xterm/css/xterm.css terminal/vendor/

# Terminal addons
cp node_modules/@xterm/addon-fit/lib/addon-fit.mjs terminal/vendor/
cp node_modules/@xterm/addon-serialize/lib/addon-serialize.mjs terminal/vendor/

# Dependency licenses
cp node_modules/v86/LICENSE terminal/vendor/v86-LICENSE
cp node_modules/@xterm/xterm/LICENSE terminal/vendor/xterm-LICENSE
cp node_modules/@xterm/addon-fit/LICENSE terminal/vendor/addon-fit-LICENSE
cp node_modules/@xterm/xterm/LICENSE terminal/vendor/addon-serialize-LICENSE
