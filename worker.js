const username = "MR-kartoshki";
const freshnessMs = 10 * 60_000;

async function githubJson(path, token) {
  const response = await fetch(`https://api.github.com${path}`, {
    headers: {
      Accept: "application/vnd.github+json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      "User-Agent": "mr-kartoshki-portfolio",
    },
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) {
    throw new Error(`GitHub returned ${response.status} for ${path}`);
  }
  return response.json();
}

async function loadRepositories(token) {
  const repos = [];
  for (let page = 1; ; page += 1) {
    const batch = await githubJson(`/users/${username}/repos?per_page=100&sort=updated&page=${page}`, token);
    repos.push(...batch);
    if (batch.length < 100) break;
  }

  const repoLanguages = {};
  let incomplete = false;
  for (const repo of repos) {
    if (!token) {
      incomplete = true;
      repoLanguages[repo.id] = repo.language ? [repo.language] : [];
      continue;
    }
    try {
      const languages = await githubJson(`/repos/${username}/${encodeURIComponent(repo.name)}/languages`, token);
      repoLanguages[repo.id] = Object.entries(languages)
        .sort(([, a], [, b]) => b - a)
        .map(([language]) => language);
    } catch (error) {
      incomplete = true;
      repoLanguages[repo.id] = repo.language ? [repo.language] : [];
      console.warn(JSON.stringify({ message: "Repository languages unavailable", error: error.message }));
    }
  }

  return {
    generated_at: new Date().toISOString(),
    has_incomplete_language_data: incomplete,
    repos: repos.map((repo) => ({
      id: repo.id,
      name: repo.name,
      description: repo.description,
      language: repo.language,
      fork: repo.fork,
      stargazers_count: repo.stargazers_count,
      forks_count: repo.forks_count,
      updated_at: repo.updated_at,
      created_at: repo.created_at,
      pushed_at: repo.pushed_at,
      html_url: repo.html_url,
    })),
    repo_languages: repoLanguages,
  };
}

async function featuredMetadata(request, env, ctx) {
  if (request.method !== "GET") return new Response("Method not allowed", { status: 405, headers: { Allow: "GET" } });
  const key = new Request(`${new URL(request.url).origin}/api/featured`);
  const cached = await caches.default.match(key);
  if (cached) return cached;
  const result = {};
  await Promise.all([
    (async () => {
      try {
        const options = { headers: { "User-Agent": "mr-kartoshki-portfolio" }, signal: AbortSignal.timeout(8000) };
        const [project, versions] = await Promise.all([
          fetch("https://api.modrinth.com/v2/project/rawlands", options),
          fetch("https://api.modrinth.com/v2/project/rawlands/version", options),
        ]);
        if (!project.ok || !versions.ok) return;
        const data = await project.json();
        const releases = await versions.json();
        const latest = releases.find((release) => release.version_type === "release");
        result.rawlands = `${Number(data.downloads).toLocaleString("en-US")} downloads${latest ? ` · Latest: ${latest.version_number}` : ""}`;
      } catch (error) {
        console.warn(JSON.stringify({ message: "Rawlands metadata unavailable", error: error.message }));
      }
    })(),
    (async () => {
      try {
        const tags = await githubJson("/repos/Frog-Linux-repos/Frog-Linux/tags?per_page=1", env.GITHUB_TOKEN);
        if (tags.length) result["frog-linux"] = `Latest tag: ${tags[0].name}`;
      } catch (error) {
        console.warn(JSON.stringify({ message: "Frog Linux metadata unavailable", error: error.message }));
      }
    })(),
  ]);
  const response = Response.json(result, { headers: { "Cache-Control": "public, max-age=600" } });
  ctx.waitUntil(caches.default.put(key, response.clone()));
  return response;
}

const videoFiles = new Set(["qr-final.mp4", "qr-final-preview.mp4", "bezier-final.mp4", "bezier-final-preview.mp4", "sudoku-final.mp4", "sudoku-final-preview.mp4"]);

async function serveVideo(request, env, ctx) {
  if (request.method !== "GET" && request.method !== "HEAD") {
    return new Response("Method not allowed", { status: 405, headers: { Allow: "GET, HEAD" } });
  }
  const url = new URL(request.url);
  const filename = url.pathname.slice("/media/videos/".length);
  if (!videoFiles.has(filename)) return new Response("Not found", { status: 404 });
  const key = new Request(`${url.origin}${url.pathname}`);
  // Cache API can satisfy browser byte ranges from an already cached full response.
  const cached = await caches.default.match(new Request(key, { headers: request.headers }));
  if (cached) return request.method === "HEAD" ? new Response(null, cached) : cached;
  const objectKey = `bad-apple/${filename}`;
  const metadata = await env.MEDIA.head(objectKey);
  if (!metadata) return new Response("Not found", { status: 404 });
  const headers = new Headers({
    "Content-Type": "video/mp4",
    "Accept-Ranges": "bytes",
    "Cache-Control": "public, max-age=86400",
    ETag: metadata.httpEtag,
    "Content-Length": String(metadata.size),
  });
  if (request.headers.get("If-None-Match") === metadata.httpEtag) return new Response(null, { status: 304, headers });
  let range;
  const rangeHeader = request.headers.get("Range");
  const ifRange = request.headers.get("If-Range");
  if (rangeHeader && (!ifRange || ifRange === metadata.httpEtag)) {
    const match = /^bytes=(\d*)-(\d*)$/.exec(rangeHeader);
    if (match && (match[1] || match[2])) {
      const start = match[1] ? Number(match[1]) : Math.max(0, metadata.size - Number(match[2]));
      const end = match[1] && match[2] ? Math.min(Number(match[2]), metadata.size - 1) : metadata.size - 1;
      if (Number.isSafeInteger(start) && Number.isSafeInteger(end) && start <= end && start < metadata.size) {
        range = { offset: start, length: end - start + 1 };
      }
    }
    if (!range) return new Response(null, { status: 416, headers: { "Content-Range": `bytes */${metadata.size}` } });
    headers.set("Content-Range", `bytes ${range.offset}-${range.offset + range.length - 1}/${metadata.size}`);
    headers.set("Content-Length", String(range.length));
  }
  if (request.method === "HEAD") return new Response(null, { status: range ? 206 : 200, headers });
  const object = await env.MEDIA.get(objectKey, range ? { range } : undefined);
  if (!object) return new Response("Not found", { status: 404 });
  const response = new Response(object.body, { status: range ? 206 : 200, headers });
  // Cache small previews; teeing a full video can buffer too much for slow clients.
  if (!range && filename.endsWith("-preview.mp4")) ctx.waitUntil(caches.default.put(key, response.clone()));
  return response;
}

function contactResponse(body, status = 200, headers = {}) {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store", ...headers } });
}

async function handleContact(request, env) {
  if (request.method !== "POST") {
    return contactResponse({ error: "Method not allowed." }, 405, { Allow: "POST" });
  }
  if (request.headers.get("Origin") !== new URL(request.url).origin) {
    return contactResponse({ error: "Please send your message from the portfolio website." }, 403);
  }
  if (request.headers.get("Content-Type")?.split(";")[0] !== "application/x-www-form-urlencoded") {
    return contactResponse({ error: "Unsupported form format." }, 415);
  }

  try {
    const { success } = await env.CONTACT_RATE_LIMIT.limit({
      key: request.headers.get("CF-Connecting-IP") || "local",
    });
    if (!success) {
      return contactResponse({ error: "Too many messages. Please try again in a minute." }, 429, { "Retry-After": "60" });
    }

    // Bound the actual stream; Content-Length can be missing or inaccurate.
    const reader = request.body?.getReader();
    if (!reader) return contactResponse({ error: "Please complete the form." }, 400);
    const decoder = new TextDecoder();
    let size = 0;
    let body = "";
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 128_000) {
        await reader.cancel();
        return contactResponse({ error: "Your message is too large." }, 413);
      }
      body += decoder.decode(value, { stream: true });
    }
    body += decoder.decode();
    const form = new URLSearchParams(body);
    if (form.get("_gotcha")) return contactResponse({ success: true });
    const name = (form.get("name") || "").trim();
    const email = (form.get("email") || "").trim();
    const message = (form.get("message") || "").trim();
    if (!name || name.length > 100 || email.length > 254 ||
        !/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(email) ||
        !message || message.length > 5000) {
      return contactResponse({ error: "Please enter a name, a valid email, and a message of up to 5,000 characters." }, 400);
    }

    await env.CONTACT_EMAIL.send({
      from: { email: "portfolio@iaske.net", name: "MR-Kartoshki Portfolio" },
      to: "nikita@iaske.net",
      replyTo: email,
      subject: "Portfolio contact",
      text: `Name: ${name}\nEmail: ${email}\n\n${message}`,
    });
    return contactResponse({ success: true });
  } catch (error) {
    console.error(JSON.stringify({ message: "Contact email failed", code: error.code || "UNKNOWN" }));
    return contactResponse({ error: "Your message could not be sent. Please try again later." }, 503);
  }
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.pathname.startsWith("/media/videos/")) return serveVideo(request, env, ctx);
    if (url.pathname === "/api/featured") return featuredMetadata(request, env, ctx);
    if (url.pathname === "/api/contact") return handleContact(request, env);
    if (url.pathname !== "/api/repos") return env.ASSETS.fetch(request);
    if (request.method !== "GET") {
      return new Response("Method not allowed", { status: 405, headers: { Allow: "GET" } });
    }

    // Ignore query strings so visitors cannot force new GitHub requests.
    const cacheKey = new Request(`${url.origin}/api/repos`);
    const cached = await caches.default.match(cacheKey);
    const cacheFreshness = env.GITHUB_TOKEN ? freshnessMs : 60 * 60_000;
    if (cached && Date.now() - Date.parse(cached.headers.get("Last-Modified")) < cacheFreshness) {
      const response = new Response(cached.body, cached);
      response.headers.set("Cache-Control", "public, max-age=60");
      return response;
    }

    try {
      const payload = await loadRepositories(env.GITHUB_TOKEN);
      const response = Response.json(payload, {
        headers: {
          "Cache-Control": "public, max-age=86400",
          "Last-Modified": new Date(payload.generated_at).toUTCString(),
        },
      });
      ctx.waitUntil(caches.default.put(cacheKey, response.clone()));
      response.headers.set("Cache-Control", "public, max-age=60");
      return response;
    } catch (error) {
      console.error(JSON.stringify({ message: "Repository refresh failed", error: error.message }));
      if (cached) {
        const response = new Response(cached.body, cached);
        response.headers.set("Cache-Control", "no-store");
        return response;
      }
      return Response.json({ error: "Repositories are temporarily unavailable." }, {
        status: 503,
        headers: { "Cache-Control": "no-store" },
      });
    }
  },
};
