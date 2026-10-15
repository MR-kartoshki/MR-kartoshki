#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/../.."

build=.browser-linux-build
v86_commit=94faf3d6b19ecabc53a4010aaa24252fa6a162e2
mkdir -p "$build/assets/rootfs" terminal/vendor
if [[ ! -d "$build/v86/.git" ]]; then
    git clone https://github.com/copy/v86.git "$build/v86"
fi
git -C "$build/v86" fetch origin "$v86_commit"
git -C "$build/v86" checkout --detach "$v86_commit"

docker build --platform linux/386 -t portfolio-browser-alpine scripts/browser-linux
container=$(docker create --platform linux/386 portfolio-browser-alpine)
trap 'docker rm "$container" >/dev/null' EXIT
docker export "$container" > "$build/rootfs.tar"
tar --delete -f "$build/rootfs.tar" .dockerenv
python3 "$build/v86/tools/fs2json.py" --out "$build/assets/fs.json" "$build/rootfs.tar"
rm -rf "$build/assets/rootfs"
mkdir -p "$build/assets/rootfs"
python3 "$build/v86/tools/copy-to-sha256.py" "$build/rootfs.tar" "$build/assets/rootfs"
cp "$build/v86/bios/seabios.bin" "$build/assets/"
cp "$build/v86/bios/vgabios.bin" "$build/assets/"
cp node_modules/v86/build/v86.wasm "$build/assets/"
cp node_modules/v86/build/v86-fallback.wasm "$build/assets/"
cp node_modules/v86/build/libv86.mjs terminal/vendor/
node scripts/browser-linux/patch-console.mjs
cp node_modules/@xterm/xterm/lib/xterm.mjs terminal/vendor/
cp node_modules/@xterm/xterm/css/xterm.css terminal/vendor/
cp node_modules/@xterm/addon-fit/lib/addon-fit.mjs terminal/vendor/
cp node_modules/@xterm/addon-serialize/lib/addon-serialize.mjs terminal/vendor/
cp node_modules/v86/LICENSE terminal/vendor/v86-LICENSE
cp node_modules/@xterm/xterm/LICENSE terminal/vendor/xterm-LICENSE
cp node_modules/@xterm/addon-fit/LICENSE terminal/vendor/addon-fit-LICENSE
cp node_modules/@xterm/xterm/LICENSE terminal/vendor/addon-serialize-LICENSE
cp "$build/v86/bios/COPYING.LESSER" terminal/vendor/seabios-COPYING.LESSER
curl -fsS https://raw.githubusercontent.com/coreboot/seabios/rel-1.16.2/COPYING -o terminal/vendor/seabios-COPYING
curl -fsS https://raw.githubusercontent.com/facebook/zstd/v1.4.5/LICENSE -o terminal/vendor/zstd-LICENSE
node scripts/browser-linux/notices.mjs
node scripts/browser-linux/manifest.mjs
