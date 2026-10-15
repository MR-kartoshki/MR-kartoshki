import { createHash } from "node:crypto";
import { open, readFile, readdir, writeFile } from "node:fs/promises";

const directory = ".browser-linux-build/assets";
const packed = await open(`${directory}/rootfs.pack`, "w");
const index = {};
let offset = 0;
for (const name of (await readdir(`${directory}/rootfs`)).sort()) {
  const data = await readFile(`${directory}/rootfs/${name}`);
  await packed.write(data);
  index[name] = { offset, length: data.length };
  offset += data.length;
}
await packed.close();
await writeFile(`${directory}/rootfs-index.json`, JSON.stringify(index));
const files = [];
for (const name of ["fs.json", "rootfs-index.json", "rootfs.pack", "seabios.bin", "vgabios.bin", "v86.wasm", "v86-fallback.wasm"]) {
  const data = await readFile(`${directory}/${name}`);
  files.push({ path: name, size: data.length, sha256: createHash("sha256").update(data).digest("hex") });
}
files.sort((a, b) => a.path.localeCompare(b.path));
const version = createHash("sha256").update(JSON.stringify(files)).digest("hex").slice(0, 16);
const manifest = { version, alpine: "3.23.6", v86: "0.5.471", memory: 256 * 1024 * 1024, files };
await writeFile(`${directory}/manifest.json`, `${JSON.stringify(manifest, null, 2)}\n`);
await writeFile("terminal/image.json", `${JSON.stringify({ ...manifest, files: undefined, base: `/vm-assets/${version}/` }, null, 2)}\n`);
console.log(`Built Alpine ${manifest.alpine}, asset version ${version} (${files.length} files).`);
