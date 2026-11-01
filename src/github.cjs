"use strict";
const { fail, repo, text, int, jsonFetch } = require("./util.cjs");
const crypto = require("node:crypto");
const CODE =
  /\.(?:[cm]?[jt]sx?|py|rs|go|java|kt|kts|c|h|cc|cpp|hpp|cs|php|rb|sh|ps1|sql|vue|svelte|html|css|json|ya?ml|toml|md|xml|gradle)$/i;
function readable(p) {
  return (
    typeof p === "string" &&
    p.length < 600 &&
    !p
      .split("/")
      .some(
        (s) =>
          s === ".." ||
          s === "." ||
          s === ".git" ||
          s === "node_modules" ||
          s === "vendor",
      ) &&
    !/(?:^|\/)(?:\.env(?:\..*)?|\.npmrc|\.pypirc|id_rsa|id_ed25519|credentials[^/]*|secrets?[^/]*|[^/]*\.(?:pem|key|p12|pfx|db|sqlite))$/i.test(
      p,
    ) &&
    CODE.test(p)
  );
}
function createGithub(store, fetchImpl = fetch) {
  let cached = null;
  async function accessToken(signal) {
    const c = store.config().github || { mode: "token" };
    if (c.mode !== "app") return store.secret("github");
    const key = store.secret("githubAppKey"),
      fingerprint = require("./util.cjs").hash(
        key + ":" + c.appId + ":" + c.installationId,
      );
    if (!key)
      fail(
        "GITHUB_APP_NOT_CONFIGURED",
        "Enregistrez la clé privée de votre GitHub App.",
      );
    if (
      cached?.fingerprint === fingerprint &&
      cached.expires > Date.now() + 120000
    )
      return cached.token;
    const now = Math.floor(Date.now() / 1000),
      head = Buffer.from(JSON.stringify({ alg: "RS256", typ: "JWT" })).toString(
        "base64url",
      ),
      payload = Buffer.from(
        JSON.stringify({ iat: now - 60, exp: now + 540, iss: c.appId }),
      ).toString("base64url");
    let signature;
    try {
      signature = crypto
        .sign("RSA-SHA256", Buffer.from(head + "." + payload), key)
        .toString("base64url");
    } catch {
      fail("GITHUB_APP_NOT_CONFIGURED", "Clé privée GitHub App invalide.");
    }
    const r = await jsonFetch(
      fetchImpl,
      "https://api.github.com/app/installations/" +
        c.installationId +
        "/access_tokens",
      {
        method: "POST",
        headers: {
          Accept: "application/vnd.github+json",
          "User-Agent": "metis-server",
          Authorization: "Bearer " + head + "." + payload + "." + signature,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          permissions: { contents: "read", pull_requests: "read" },
        }),
        signal: signal || AbortSignal.timeout(30000),
      },
    );
    if (
      typeof r.token !== "string" ||
      !Number.isFinite(Date.parse(r.expires_at))
    )
      fail("UPSTREAM_ERROR", "Jeton d’installation GitHub invalide.", 502);
    cached = { fingerprint, token: r.token, expires: Date.parse(r.expires_at) };
    return r.token;
  }
  function selected(name) {
    repo(name);
    if (
      !store
        .config()
        .repositories.some((x) => x.toLowerCase() === name.toLowerCase())
    )
      fail("REPOSITORY_DENIED", "Dépôt non sélectionné.", 403);
  }
  async function api(endpoint, signal, max = 4000000) {
    const key = await accessToken(signal);
    return jsonFetch(
      fetchImpl,
      "https://api.github.com" + endpoint,
      {
        headers: {
          Accept: "application/vnd.github+json",
          "User-Agent": "metis-server",
          "X-GitHub-Api-Version": "2022-11-28",
          ...(key ? { Authorization: "Bearer " + key } : {}),
        },
        signal: signal || AbortSignal.timeout(30000),
      },
      max,
    );
  }
  async function describe(name, signal) {
    selected(name);
    const r = await api("/repos/" + name, signal);
    if (r.full_name?.toLowerCase() !== name.toLowerCase())
      fail(
        "REPOSITORY_MOVED",
        "Le dépôt a été déplacé ; mettez à jour sa sélection.",
      );
    return r;
  }
  async function snapshot(name, signal) {
    const d = await describe(name, signal);
    const commit = await api(
      "/repos/" + name + "/commits/" + encodeURIComponent(d.default_branch),
      signal,
    );
    if (
      !/^[a-f0-9]{40}$/.test(commit.sha) ||
      !/^[a-f0-9]{40}$/.test(commit.commit?.tree?.sha)
    )
      fail("UPSTREAM_ERROR", "Révision GitHub invalide.", 502);
    const t = await api(
      "/repos/" +
        name +
        "/git/trees/" +
        commit.commit.tree.sha +
        "?recursive=1",
      signal,
      6000000,
    );
    if (!Array.isArray(t.tree))
      fail("UPSTREAM_ERROR", "Arbre GitHub invalide.", 502);
    const files = t.tree
      .filter(
        (x) =>
          x.type === "blob" &&
          x.mode !== "120000" &&
          x.size <= 160000 &&
          /^[a-f0-9]{40}$/.test(x.sha) &&
          readable(x.path),
      )
      .map((x) => ({ path: x.path, sha: x.sha, size: x.size }));
    return {
      repository: name,
      commit: commit.sha,
      files: files.slice(0, 6000),
      truncated: !!t.truncated || files.length > 6000,
    };
  }
  async function read(snapshot, args, signal) {
    selected(snapshot.repository);
    const p = text(args.path, "Chemin", 600),
      entry = snapshot.files.find((f) => f.path === p);
    if (!entry || !readable(p))
      fail("PATH_DENIED", "Fichier non disponible dans cette révision.", 403);
    const start = int(args.start_line ?? 1, "Première ligne", 1, 1000000),
      count = int(args.line_count ?? 100, "Nombre de lignes", 1, 160);
    const b = await api(
      "/repos/" + snapshot.repository + "/git/blobs/" + entry.sha,
      signal,
      300000,
    );
    if (
      b.encoding !== "base64" ||
      typeof b.content !== "string" ||
      b.size > 160000
    )
      fail("FILE_TOO_LARGE", "Fichier binaire ou trop volumineux.");
    const raw = Buffer.from(b.content, "base64");
    if (raw.length > 160000 || raw.includes(0))
      fail("PATH_DENIED", "Fichier binaire ou trop volumineux.");
    const content = raw.toString("utf8"),
      lines = content.split("\n");
    return {
      path: p,
      commit: snapshot.commit,
      start_line: start,
      end_line: Math.min(lines.length, start + count - 1),
      total_lines: lines.length,
      content: lines.slice(start - 1, start + count - 1).join("\n"),
    };
  }
  async function rawFetch(url, options = {}) {
    const u = new URL(url);
    if (u.origin !== "https://api.github.com")
      fail("GITHUB_TARGET_DENIED", "Cible GitHub non autorisée.");
    const key = await accessToken(options.signal),
      response = await fetchImpl(url, {
        ...options,
        headers: {
          ...options.headers,
          ...(key ? { Authorization: "Bearer " + key } : {}),
        },
        redirect: "error",
      });
    return {
      ok: response.ok,
      status: response.status,
      json: () => jsonFetch(async () => response, url, {}, 4000000),
    };
  }
  return { api, describe, snapshot, read, selected, rawFetch };
}
module.exports = { createGithub, readable };
