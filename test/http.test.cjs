"use strict";
const test = require("node:test"),
  assert = require("node:assert/strict"),
  fs = require("node:fs"),
  path = require("node:path"),
  crypto = require("node:crypto");
const { instance } = require("./helpers.cjs");
test("First installation is local, gated, single-use, and does not expose the bootstrap code", async (t) => {
  const x = await instance(t);
  const code = fs.readFileSync(
    path.join(x.app.store.dir, ".bootstrap_token"),
    "utf8",
  );
  assert.equal((await x.call("/api/state")).status, 401);
  const status = await x.call("/api/status");
  assert.equal(status.value.initialized, false);
  assert.ok(!status.raw.includes(code));
  const wrong = await x.call("/api/bootstrap", "POST", {
    code: "wrong",
    username: "tester",
    password: "a-strong-test-password",
  });
  assert.equal(wrong.status, 403);
  const badOrigin = await x.call(
    "/api/bootstrap",
    "POST",
    { code, username: "tester", password: "a-strong-test-password" },
    { Origin: "https://evil.example" },
  );
  assert.equal(badOrigin.status, 403);
  assert.equal((await x.bootstrap()).status, 200);
  assert.equal(
    fs.existsSync(path.join(x.app.store.dir, ".bootstrap_token")),
    false,
  );
  assert.equal((await x.call("/api/state")).status, 200);
  assert.equal(
    (
      await x.call("/api/bootstrap", "POST", {
        code,
        username: "other",
        password: "a-strong-test-password",
      })
    ).status,
    409,
  );
});
test("Browser writes require CSRF; Host is validated; security headers are present", async (t) => {
  const x = await instance(t);
  await x.bootstrap();
  assert.equal(
    (await x.call("/api/logout", "POST", {}, { "X-CSRF-Token": "bad" })).status,
    403,
  );
  const hostStatus = await new Promise((resolve, reject) => {
    const req = require("node:http").request(
      x.base + "/health",
      { headers: { Host: "evil.example" } },
      (r) => {
        r.resume();
        resolve(r.statusCode);
      },
    );
    req.on("error", reject);
    req.end();
  });
  assert.equal(hostStatus, 403);
  const page = await x.call("/");
  assert.match(
    page.headers.get("content-security-policy"),
    /frame-ancestors 'none'/,
  );
  assert.equal(page.headers.get("cache-control"), "no-store");
  assert.equal((await x.call("/api/logout", "POST", {})).status, 200);
  assert.equal((await x.call("/api/state")).status, 401);
  assert.equal(
    (
      await x.call("/api/login", "POST", {
        username: "tester",
        password: "bad",
      })
    ).status,
    401,
  );
  assert.equal(
    (
      await x.call("/api/login", "POST", {
        username: "tester",
        password: "test-password-long-enough",
      })
    ).status,
    200,
  );
});
test("Document versions, replay keys and optimistic concurrency are enforced over HTTP", async (t) => {
  const x = await instance(t);
  await x.bootstrap();
  const d = {
    slug: "fixture",
    title: "Version one",
    body: "Research fixture",
    status: "draft",
    expected_version: 0,
  };
  const a = await x.call("/api/documents", "POST", d, {
    "Idempotency-Key": "first",
  });
  assert.equal(a.status, 200);
  assert.equal(a.value.version, 1);
  assert.equal(
    (await x.call("/api/documents", "POST", d, { "Idempotency-Key": "first" }))
      .value.version,
    1,
  );
  assert.equal(
    (
      await x.call(
        "/api/documents",
        "POST",
        { ...d, title: "different" },
        { "Idempotency-Key": "first" },
      )
    ).status,
    409,
  );
  assert.equal(
    (
      await x.call(
        "/api/documents",
        "POST",
        { ...d, title: "Version two", expected_version: 1 },
        { "Idempotency-Key": "second" },
      )
    ).value.version,
    2,
  );
  assert.equal(
    (await x.call("/api/documents", "POST", d, { "Idempotency-Key": "third" }))
      .status,
    409,
  );
  assert.equal(
    (await x.call("/api/documents/fixture?version=1")).value.title,
    "Version one",
  );
  assert.equal(
    (await x.call("/api/documents/fixture")).value.title,
    "Version two",
  );
});
test("MCP read tokens cannot mutate, access administration or survive revocation", async (t) => {
  const x = await instance(t);
  await x.bootstrap();
  const issued = (
    await x.call("/api/tokens", "POST", {
      label: "reader",
      days: 1,
      scopes: ["metis:read"],
    })
  ).value;
  const mcp = (method, params = {}) =>
    x.call(
      "/mcp",
      "POST",
      { jsonrpc: "2.0", id: 1, method, params },
      { Authorization: "Bearer " + issued.token },
    );
  const init = await mcp("initialize", { protocolVersion: "2025-11-25" });
  assert.equal(init.value.result.protocolVersion, "2025-11-25");
  const listed = (await mcp("tools/list")).value.result.tools;
  assert.ok(listed.some((t) => t.name === "search"));
  assert.ok(
    !listed.some(
      (t) => t.name === "publier_document" || t.name.startsWith("securite_"),
    ),
  );
  const denied = await mcp("tools/call", {
    name: "publier_document",
    arguments: {
      slug: "bad",
      titre: "bad",
      corps: "bad",
      idempotency_key: "x",
    },
  });
  assert.equal(denied.value.result.isError, true);
  assert.equal(
    x.app.store.db.prepare("SELECT COUNT(*) n FROM documents").get().n,
    0,
  );
  assert.equal(
    (
      await fetch(x.base + "/api/state", {
        headers: { Authorization: "Bearer " + issued.token },
      })
    ).status,
    401,
  );
  await x.call("/api/tokens/revoke", "POST", { id: issued.id });
  assert.equal((await mcp("tools/list")).status, 401);
});
test("Independent instances reject each other’s integration tokens", async (t) => {
  const a = await instance(t),
    b = await instance(t);
  await a.bootstrap();
  await b.bootstrap();
  const token = (
    await a.call("/api/tokens", "POST", {
      label: "A",
      days: 1,
      scopes: ["metis:read"],
    })
  ).value.token;
  const r = await fetch(b.base + "/mcp", {
    method: "POST",
    headers: {
      Authorization: "Bearer " + token,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
  });
  assert.equal(r.status, 401);
});
test("OAuth PKCE enforces exact redirects, consent, audience and single-use codes", async (t) => {
  const x = await instance(t);
  await x.bootstrap();
  const client = (
    await x.call("/oauth/register", "POST", {
      client_name: "Fixture <script>",
      redirect_uris: ["http://127.0.0.1:12345/callback"],
      token_endpoint_auth_method: "none",
    })
  ).value;
  const verifier = "v".repeat(64),
    challenge = crypto
      .createHash("sha256")
      .update(verifier)
      .digest("base64url");
  const params = {
    client_id: client.client_id,
    redirect_uri: client.redirect_uris[0],
    response_type: "code",
    code_challenge: challenge,
    code_challenge_method: "S256",
    scope: "metis:read",
    resource: x.app.origin() + "/mcp",
    state: "fixture-state",
  };
  assert.equal(
    (
      await x.call(
        "/oauth/authorize?" +
          new URLSearchParams({
            ...params,
            redirect_uri: "https://evil.example",
          }),
      )
    ).status,
    400,
  );
  assert.equal(
    (
      await x.call(
        "/oauth/authorize?" +
          new URLSearchParams({ ...params, code_challenge_method: "plain" }),
      )
    ).status,
    400,
  );
  const consentPage = await x.call(
    "/oauth/authorize?" + new URLSearchParams(params),
  );
  assert.match(consentPage.raw, /Fixture &lt;script&gt;/);
  assert.ok(!consentPage.raw.includes("Fixture <script>"));
  const consent = await x.call(
    "/oauth/authorize",
    "POST",
    new URLSearchParams({
      ...params,
      csrf: x.csrf,
      decision: "allow",
    }).toString(),
    { "Content-Type": "application/x-www-form-urlencoded" },
  );
  assert.equal(consent.status, 303);
  const location = new URL(consent.headers.get("location"));
  assert.equal(location.searchParams.get("state"), "fixture-state");
  const exchange = {
    grant_type: "authorization_code",
    client_id: client.client_id,
    redirect_uri: params.redirect_uri,
    resource: params.resource,
    code: location.searchParams.get("code"),
    code_verifier: verifier,
  };
  const form = (data) =>
    x.call("/oauth/token", "POST", new URLSearchParams(data).toString(), {
      "Content-Type": "application/x-www-form-urlencoded",
    });
  assert.equal(
    (await form({ ...exchange, resource: "https://evil.example/mcp" })).status,
    400,
  );
  assert.equal(
    (await form({ ...exchange, code_verifier: "x".repeat(64) })).status,
    400,
  );
  const granted = await form(exchange);
  assert.equal(granted.status, 200);
  assert.equal(granted.value.scope, "metis:read");
  assert.equal((await form(exchange)).status, 400);
  const r = await x.call(
    "/mcp",
    "POST",
    { jsonrpc: "2.0", id: 3, method: "tools/list" },
    { Authorization: "Bearer " + granted.value.access_token },
  );
  assert.equal(r.status, 200);
  await x.call("/api/clients/revoke", "POST", { id: client.client_id });
  assert.equal(
    (
      await x.call(
        "/mcp",
        "POST",
        { jsonrpc: "2.0", id: 3, method: "tools/list" },
        { Authorization: "Bearer " + granted.value.access_token },
      )
    ).status,
    401,
  );
});
test("Disabled research module no longer exposes document tools", async (t) => {
  const x = await instance(t);
  await x.bootstrap();
  const c = x.app.store.config();
  c.modules.research = false;
  x.app.store.set("config", c);
  const tools = x.app.tools.list({
    role: "integration",
    scopes: ["metis:read"],
  });
  assert.ok(!tools.some((t) => t.name === "fetch"));
  await assert.rejects(
    x.app.tools.call(
      "fetch",
      { id: "x" },
      { role: "integration", id: "r", scopes: ["metis:read"] },
    ),
    /Droits insuffisants/,
  );
});
test("Changing provider clears its old credential and secret updates are atomic", async (t) => {
  const x = await instance(t);
  await x.bootstrap();
  x.app.store.secret("provider", "old-provider-fixture");
  const c = x.app.store.config();
  c.provider = { kind: "anthropic", model: "fixture-model", baseUrl: "" };
  assert.equal(
    (await x.call("/api/config", "POST", { config: c, expected_revision: 1 }))
      .status,
    200,
  );
  assert.equal(x.app.store.secret("provider"), "");
  x.app.store.secret("github", "old-github-fixture");
  const bad = await x.call("/api/secrets", "POST", {
    github: "new-github-fixture",
    provider: 7,
  });
  assert.equal(bad.status, 400);
  assert.equal(x.app.store.secret("github"), "old-github-fixture");
});
