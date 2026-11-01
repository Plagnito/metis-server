"use strict";
const test = require("node:test"),
  assert = require("node:assert/strict"),
  crypto = require("node:crypto");
const { openStore } = require("../src/store.cjs"),
  { createProviders } = require("../src/providers.cjs"),
  { createGithub, readable } = require("../src/github.cjs");
const { temp, response } = require("./helpers.cjs");
const tool = {
  name: "read_file",
  description: "Read a file",
  inputSchema: {
    type: "object",
    properties: { path: { type: "string" } },
    required: ["path"],
  },
};
const messages = [
  { role: "system", content: "Audit fixture" },
  { role: "user", content: "Start" },
  {
    role: "assistant",
    content: "",
    calls: [{ id: "one", name: "read_file", arguments: { path: "x.js" } }],
  },
  { role: "tool", id: "one", content: "fixture source" },
];
for (const kind of ["openai", "anthropic", "compatible"])
  test(
    kind + " adapter translates tool histories and accounts usage",
    async () => {
      const s = openStore(temp()),
        c = s.config();
      c.provider = {
        kind,
        model: "fixture-model",
        baseUrl: kind === "compatible" ? "http://localhost:11434/v1" : "",
      };
      s.set("config", c);
      s.secret("provider", "provider-fixture-key");
      let sent, reserved;
      const fetchImpl = async (url, init) => {
        sent = { url, body: JSON.parse(init.body), headers: init.headers };
        if (kind === "openai")
          return response({
            status: "completed",
            output: [
              {
                type: "function_call",
                call_id: "two",
                name: "read_file",
                arguments: '{"path":"y.js"}',
              },
            ],
            usage: { total_tokens: 123 },
          });
        if (kind === "anthropic")
          return response({
            stop_reason: "tool_use",
            content: [
              {
                type: "tool_use",
                id: "two",
                name: "read_file",
                input: { path: "y.js" },
              },
            ],
            usage: { input_tokens: 100, output_tokens: 23 },
          });
        return response({
          choices: [
            {
              finish_reason: "tool_calls",
              message: {
                tool_calls: [
                  {
                    id: "two",
                    function: {
                      name: "read_file",
                      arguments: '{"path":"y.js"}',
                    },
                  },
                ],
              },
            },
          ],
          usage: { total_tokens: 123 },
        });
      };
      const p = createProviders(s, fetchImpl),
        r = await p.turn(
          messages,
          [tool],
          {
            maxOutputTokens: 256,
            remainingTokens: 10000,
            reserve: (n) => (reserved = n),
          },
          AbortSignal.timeout(5000),
        );
      assert.equal(r.tokens, 123);
      assert.equal(r.calls[0].arguments.path, "y.js");
      assert.ok(reserved > 256);
      if (kind === "openai") {
        assert.equal(sent.url, "https://api.openai.com/v1/responses");
        assert.equal(sent.body.store, false);
        assert.ok(
          sent.body.input.some((i) => i.type === "function_call_output"),
        );
      }
      if (kind === "anthropic") {
        assert.ok(
          sent.body.messages.some(
            (m) =>
              Array.isArray(m.content) &&
              m.content.some((x) => x.type === "tool_result"),
          ),
        );
        assert.equal(sent.headers["x-api-key"], "provider-fixture-key");
      }
      if (kind === "compatible")
        assert.ok(
          sent.body.messages.some(
            (m) => m.role === "tool" && m.tool_call_id === "one",
          ),
        );
      s.close();
    },
  );
test("Provider budget is checked before network; truncated or malformed responses fail closed", async () => {
  const s = openStore(temp()),
    c = s.config();
  c.provider.model = "fixture";
  s.set("config", c);
  s.secret("provider", "fixture");
  let calls = 0;
  const p = createProviders(s, async () => {
    calls++;
    return response({ status: "incomplete", output: [] });
  });
  await assert.rejects(
    p.turn(
      messages,
      [tool],
      { maxOutputTokens: 256, remainingTokens: 1 },
      AbortSignal.timeout(5000),
    ),
    /Budget/,
  );
  assert.equal(calls, 0);
  await assert.rejects(
    p.turn(
      messages,
      [tool],
      { maxOutputTokens: 256, remainingTokens: 10000 },
      AbortSignal.timeout(5000),
    ),
    /terminé/,
  );
  assert.equal(calls, 1);
  s.close();
});
test("GitHub App requests read-only installation tokens, caches them and pins API targets", async () => {
  const s = openStore(temp()),
    c = s.config();
  c.github = { mode: "app", appId: "123", installationId: "456" };
  c.repositories = ["Example/project"];
  s.set("config", c);
  const keys = crypto.generateKeyPairSync("rsa", {
    modulusLength: 2048,
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
    publicKeyEncoding: { type: "spki", format: "pem" },
  });
  s.secret("githubAppKey", keys.privateKey);
  let grants = 0;
  const g = createGithub(s, async (url, init) => {
    if (String(url).includes("/access_tokens")) {
      grants++;
      const body = JSON.parse(init.body);
      assert.deepEqual(body.permissions, {
        contents: "read",
        pull_requests: "read",
      });
      const jwt = init.headers.Authorization.slice(7).split(".");
      assert.equal(JSON.parse(Buffer.from(jwt[1], "base64url")).iss, "123");
      return response({
        token: "installation-fixture-token",
        expires_at: new Date(Date.now() + 3600000).toISOString(),
      });
    }
    assert.equal(
      init.headers.Authorization,
      "Bearer installation-fixture-token",
    );
    return response({ full_name: "Example/project" });
  });
  await g.describe("Example/project");
  await g.describe("Example/project");
  assert.equal(grants, 1);
  await assert.rejects(g.rawFetch("https://evil.example/"), /non autorisée/);
  assert.throws(() => g.selected("Other/private"), /non sélectionné/);
  s.close();
});
test("Source policy rejects secrets, binaries and traversal paths", () => {
  for (const p of [
    ".env",
    ".env.example",
    "secrets.json",
    "private.pem",
    "node_modules/lib.js",
    "../x.js",
    ".git/config",
    "data.db",
  ])
    assert.equal(readable(p), false, p);
  for (const p of ["src/auth.js", ".github/workflows/test.yml", "README.md"])
    assert.equal(readable(p), true, p);
});
