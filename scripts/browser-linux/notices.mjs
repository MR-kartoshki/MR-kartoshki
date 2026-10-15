import { readFile, writeFile } from "node:fs/promises";

const directory = ".browser-linux-build/v86";
const notices = [await readFile(`${directory}/LICENSE.MIT`, "utf8"), await readFile("terminal/vendor/zstd-LICENSE", "utf8")];
for (const filename of ["lib/softfloat/softfloat.c", "lib/zstd/zstddeclib.c"]) {
  const source = await readFile(`${directory}/${filename}`, "utf8");
  for (const [comment] of source.matchAll(/\/\*[\s\S]*?\*\//g)) {
    if (comment.includes("Redistribution and use")) notices.push(comment);
  }
}
await writeFile("terminal/vendor/v86-NOTICES", [...new Set(notices)].join("\n\n"));
