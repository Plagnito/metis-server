"use strict";
const fs = require("node:fs"),
  os = require("node:os"),
  path = require("node:path");
const { createApp } = require("../src/app.cjs");
function temp(prefix = "metis-test-") {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}
async function instance(t, options = {}) {
  const app = createApp({ dataDir: temp(), scheduler: false, ...options });
  await app.listen(0, "127.0.0.1");
  const base = "http://127.0.0.1:" + app.server.address().port;
  let cookie = "",
    csrf = "";
  const call = async (p, method = "GET", data, headers = {}) => {
    const h = {
      ...(cookie ? { Cookie: cookie } : {}),
      ...(method !== "GET"
        ? {
            "Content-Type": "application/json",
            Origin: base,
            "X-Metis-Request": "1",
            ...(csrf ? { "X-CSRF-Token": csrf } : {}),
          }
        : {}),
      ...headers,
    };
    const r = await fetch(base + p, {
      method,
      headers: h,
      body:
        data === undefined
          ? undefined
          : typeof data === "string"
            ? data
            : JSON.stringify(data),
      redirect: "manual",
    });
    const raw = await r.text();
    let value;
    try {
      value = JSON.parse(raw);
    } catch {
      value = raw;
    }
    const c = r.headers.get("set-cookie");
    if (c) cookie = c.split(";")[0];
    if (value.csrf) csrf = value.csrf;
    return { status: r.status, headers: r.headers, value, raw };
  };
  const bootstrap = () =>
    call("/api/bootstrap", "POST", {
      code: fs
        .readFileSync(path.join(app.store.dir, ".bootstrap_token"), "utf8")
        .trim(),
      username: "tester",
      password: "test-password-long-enough",
    });
  t.after(() => app.close());
  return {
    app,
    base,
    call,
    bootstrap,
    get cookie() {
      return cookie;
    },
    get csrf() {
      return csrf;
    },
  };
}
const response = (value, status = 200) =>
  new Response(JSON.stringify(value), {
    status,
    headers: { "Content-Type": "application/json" },
  });
function fakeUpstreams(options = {}) {
  const seen = [];
  let turns = 0;
  const commit = "a".repeat(40),
    tree = "b".repeat(40),
    blob = "c".repeat(40);
  const source =
    "export function read(user, resource) {\n  return resource.data;\n}\n";
  async function fetchImpl(url, init = {}) {
    url = String(url);
    const body = init.body ? JSON.parse(init.body) : null;
    seen.push({ url, body, headers: init.headers });
    if (url === "https://api.github.com/repos/Example/project")
      return response({
        full_name: "Example/project",
        name: "project",
        owner: { login: "Example" },
        default_branch: "main",
        private: true,
      });
    if (url.includes("/commits/"))
      return response({ sha: commit, commit: { tree: { sha: tree } } });
    if (url.includes("/git/trees/"))
      return response({
        tree: [
          {
            type: "blob",
            mode: "100644",
            path: "src/access.js",
            sha: blob,
            size: source.length,
          },
          { type: "blob", mode: "100644", path: ".env", sha: blob, size: 40 },
          {
            type: "blob",
            mode: "120000",
            path: "link.js",
            sha: blob,
            size: 20,
          },
        ],
        truncated: false,
      });
    if (url.includes("/git/blobs/"))
      return response({
        encoding: "base64",
        size: source.length,
        content: Buffer.from(source).toString("base64"),
      });
    if (url === "https://api.openai.com/v1/responses") {
      if (body.tools.some((t) => t.name === "connection_check"))
        return response({
          status: "completed",
          output: [
            {
              type: "function_call",
              call_id: "check",
              name: "connection_check",
              arguments: '{"value":"metis-ok"}',
            },
          ],
          usage: { total_tokens: 75 },
        });
      if (options.providerError) return response({ error: "fixture" }, 429);
      if (options.customTurn) return options.customTurn(body, ++turns);
      const scripted = [
        ["read_file", { path: "src/access.js", start_line: 1, line_count: 3 }],
        [
          "record_finding",
          {
            title: "Missing authorization in synthetic fixture",
            severity: "moyenne",
            cwe: "CWE-862",
            path: "src/access.js",
            line: 2,
            excerpt: "  return resource.data;",
            description:
              "Synthetic fixture: user ownership is not checked before returning data.",
          },
        ],
        [
          "finish_audit",
          {
            summary:
              "Un contrôle d’accès candidat dans la fixture synthétique.",
            limitations:
              "Analyse statique limitée à un fichier ; aucun test exécuté.",
          },
        ],
      ];
      const [name, args] = scripted[turns++] || scripted[2];
      return response({
        status: "completed",
        output: [
          {
            type: "function_call",
            call_id: "call-" + turns,
            name,
            arguments: JSON.stringify(args),
          },
        ],
        usage: { total_tokens: 200 },
      });
    }
    throw new Error("Unexpected network target in test: " + url);
  }
  return { fetchImpl, seen, commit, source };
}
function configure(app) {
  const c = app.store.config();
  c.repositories = ["Example/project"];
  c.provider.model = "fixture-model";
  app.store.set("config", c);
  app.store.secret("provider", "fixture-provider-key");
  app.security.declarerDepots("fixture", {
    depots: [{ nom_complet: "Example/project" }],
  });
}
module.exports = { temp, instance, response, fakeUpstreams, configure };
