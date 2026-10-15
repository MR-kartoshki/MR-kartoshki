const types = { "fs.json": "application/json", "rootfs-index.json": "application/json", "seabios.bin": "application/octet-stream", "vgabios.bin": "application/octet-stream", "v86.wasm": "application/wasm", "v86-fallback.wasm": "application/wasm" };

export async function serveVmAsset(request, env, ctx) {
  if (request.method !== "GET" && request.method !== "HEAD") {
    return new Response("Method not allowed", { status: 405, headers: { Allow: "GET, HEAD" } });
  }
  const url = new URL(request.url);
  const match = /^\/vm-assets\/([a-f0-9]{16})\/(rootfs\/[a-f0-9]{10}\.bin|[^/]+)$/.exec(url.pathname);
  if (!match) return new Response("Not found", { status: 404 });
  const [, version, name] = match;
  if (!name.startsWith("rootfs/") && !types[name]) return new Response("Not found", { status: 404 });
  const key = new Request(`${url.origin}${url.pathname}`);
  const cached = await caches.default.match(key);
  if (cached) return request.method === "HEAD" ? new Response(null, cached) : cached;
  const prefix = `browser-linux/${version}/`;
  let object;
  if (name.startsWith("rootfs/")) {
    const indexKey = new Request(`${url.origin}/vm-assets/${version}/rootfs-index.json`);
    let indexResponse = await caches.default.match(indexKey);
    if (!indexResponse) {
      const index = await env.MEDIA.get(`${prefix}rootfs-index.json`);
      if (!index) return new Response("Not found", { status: 404 });
      indexResponse = new Response(index.body, { headers: { "Content-Type": "application/json", "Cache-Control": "public, max-age=31536000, immutable" } });
      ctx.waitUntil(caches.default.put(indexKey, indexResponse.clone()));
    }
    const index = await indexResponse.json();
    const range = index[name.slice("rootfs/".length)];
    if (!range) return new Response("Not found", { status: 404 });
    if (!range.length) return new Response(null, { headers: { "Cache-Control": "public, max-age=31536000, immutable" } });
    object = await env.MEDIA.get(`${prefix}rootfs.pack`, { range });
  } else {
    object = await env.MEDIA.get(`${prefix}${name}`);
  }
  if (!object) return new Response("Not found", { status: 404 });
  const response = new Response(object.body, { headers: {
    "Content-Type": types[name] || "application/octet-stream",
    "Content-Length": String(object.range?.length ?? object.size),
    "Cache-Control": "public, max-age=31536000, immutable",
    "X-Content-Type-Options": "nosniff",
  } });
  ctx.waitUntil(caches.default.put(key, response.clone()));
  return request.method === "HEAD" ? new Response(null, response) : response;
}
