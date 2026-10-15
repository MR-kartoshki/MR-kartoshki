import assert from "node:assert/strict";
import { test } from "node:test";
import { serveVmAsset } from "./vm-assets.js";

const version = "0123456789abcdef";
const base = `https://portfolio.example/vm-assets/${version}/`;

test("VM filesystem files are sliced from the pack and cached by immutable path", async (t) => {
  const previous = globalThis.caches;
  t.after(() => { globalThis.caches = previous; });
  const cache = new Map();
  globalThis.caches = { default: {
    match: async (key) => cache.get(key.url)?.clone(),
    put: async (key, response) => { cache.set(key.url, response); },
  } };
  const calls = [];
  const env = { MEDIA: { get: async (key, options) => {
    calls.push({ key, options });
    if (key.endsWith("rootfs-index.json")) return { body: JSON.stringify({ "abcde01234.bin": { offset: 2, length: 3 } }) };
    assert.deepEqual(options.range, { offset: 2, length: 3 });
    return { body: new TextEncoder().encode("abc"), size: 10, range: options.range };
  } } };
  const pending = [];
  const ctx = { waitUntil: (promise) => pending.push(promise) };
  const response = await serveVmAsset(new Request(`${base}rootfs/abcde01234.bin?ignored=1`), env, ctx);
  assert.equal(await response.text(), "abc");
  assert.equal(response.headers.get("Content-Length"), "3");
  assert.match(response.headers.get("Cache-Control"), /immutable/);
  await Promise.all(pending);
  const head = await serveVmAsset(new Request(`${base}rootfs/abcde01234.bin`, { method: "HEAD" }), env, ctx);
  assert.equal(await head.text(), "");
  assert.equal(head.headers.get("Content-Length"), "3");
  assert.equal(calls.length, 2);
  assert.equal(calls[1].key, `browser-linux/${version}/rootfs.pack`);
  assert.equal((await serveVmAsset(new Request(`${base}rootfs/ffffffff00.bin`), env, ctx)).status, 404);
});

test("VM asset route rejects writes, invalid versions, and internal pack access", async () => {
  for (const name of ["../secret", "rootfs.pack", "rootfs/invalid.bin"]) {
    assert.equal((await serveVmAsset(new Request(base + name), {}, {})).status, 404);
  }
  assert.equal((await serveVmAsset(new Request(base + "fs.json", { method: "POST" }), {}, {})).status, 405);
});
