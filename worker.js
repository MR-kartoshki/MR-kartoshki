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

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
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
