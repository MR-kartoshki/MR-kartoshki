import { readFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";

const directory = ".browser-linux-build/assets";
const manifest = JSON.parse(await readFile(`${directory}/manifest.json`, "utf8"));
for (const file of manifest.files) {
  const type = file.path.endsWith(".json") ? "application/json" : file.path.endsWith(".wasm") ? "application/wasm" : "application/octet-stream";
  const result = spawnSync("node_modules/.bin/wrangler", ["r2", "object", "put", `portfolio-media/browser-linux/${manifest.version}/${file.path}`, "--file", `${directory}/${file.path}`, "--remote", "--content-type", type, "--cache-control", "public, max-age=31536000, immutable"], { stdio: "inherit" });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status || 1);
}
