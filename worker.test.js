import assert from "node:assert/strict";
import { test } from "node:test";
import worker from "./worker.js";

function setup(t, cached) {
  const writes = [];
  t.mock.method(globalThis, "fetch", async () => { throw new Error("Unexpected fetch"); });
  const previous = globalThis.caches;
  t.after(() => { globalThis.caches = previous; });
  globalThis.caches = { default: {
    match: async () => cached?.clone(),
    put: async (key, response) => writes.push({ key, response }),
  } };
  const pending = [];
  return { writes, pending, ctx: { waitUntil: (promise) => pending.push(promise) } };
}

const request = () => new Request("https://portfolio.example/api/repos?ignored=1");

function snapshot(age) {
  return Response.json({ repos: [{ id: 1 }] }, {
    headers: { "Last-Modified": new Date(Date.now() - age).toUTCString() },
  });
}

test("fresh cache avoids GitHub requests", async (t) => {
  const { ctx } = setup(t, snapshot(60_000));
  const response = await worker.fetch(request(), {}, ctx);
  assert.equal(response.status, 200);
  assert.equal((await response.json()).repos.length, 1);
  assert.equal(fetch.mock.callCount(), 0);
});

test("GitHub failures serve stale data, cold failures return 503", async (t) => {
  const { ctx } = setup(t, snapshot(20 * 60_000));
  const response = await worker.fetch(request(), { GITHUB_TOKEN: "test" }, ctx);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("Cache-Control"), "no-store");
  assert.equal((await response.json()).repos[0].id, 1);
  caches.default.match = async () => undefined;
  assert.equal((await worker.fetch(request(), {}, ctx)).status, 503);
});

test("paginates repositories and tolerates unavailable languages", async (t) => {
  const { ctx, writes, pending } = setup(t);
  const repos = Array.from({ length: 100 }, (_, id) => ({ id, name: `repo-${id}`, language: "Java" }));
  fetch.mock.mockImplementation(async (url, options) => {
    assert.equal(options.headers.Authorization, "Bearer test");
    if (new URL(url).searchParams.get("page") === "1") return Response.json(repos);
    if (new URL(url).searchParams.get("page") === "2") return Response.json([{ id: 100, name: "last", language: "Rust" }]);
    if (url.endsWith("/last/languages")) return new Response(null, { status: 403 });
    return Response.json({ Java: 10, Python: 50 });
  });
  const response = await worker.fetch(request(), { GITHUB_TOKEN: "test" }, ctx);
  const data = await response.json();
  assert.equal(data.repos.length, 101);
  assert.deepEqual(data.repo_languages[0], ["Python", "Java"]);
  assert.deepEqual(data.repo_languages[100], ["Rust"]);
  assert.equal(data.has_incomplete_language_data, true);
  await Promise.all(pending);
  assert.equal(writes[0].key.url, "https://portfolio.example/api/repos");
  assert.equal(writes[0].response.headers.get("Cache-Control"), "public, max-age=86400");
  assert.equal(response.headers.get("Cache-Control"), "public, max-age=60");
});

test("without a token, loads public repos using their primary languages", async (t) => {
  const { ctx, pending } = setup(t);
  fetch.mock.mockImplementation(async (url, options) => {
    assert.equal(options.headers.Authorization, undefined);
    assert.ok(new URL(url).pathname.endsWith("/repos"));
    return Response.json([{ id: 1, name: "example", language: "Rust" }]);
  });
  const response = await worker.fetch(request(), {}, ctx);
  assert.equal(response.status, 200);
  const data = await response.json();
  assert.deepEqual(data.repo_languages[1], ["Rust"]);
  assert.equal(data.has_incomplete_language_data, true);
  assert.equal(fetch.mock.callCount(), 1);
  await Promise.all(pending);
});

test("static requests use the asset binding and API rejects writes", async (t) => {
  const { ctx } = setup(t);
  const env = { ASSETS: { fetch: async () => new Response("portfolio") } };
  assert.equal(await (await worker.fetch(new Request("https://portfolio.example/"), env, ctx)).text(), "portfolio");
  assert.equal((await worker.fetch(new Request(request(), { method: "POST" }), env, ctx)).status, 405);
});
