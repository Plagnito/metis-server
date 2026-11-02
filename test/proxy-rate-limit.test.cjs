"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const { instance } = require("./helpers.cjs");
const { canonicalIp, trustedProxyIps, clientIp } = require("../src/client-ip.cjs");

async function fixtureProxy(t, upstream) {
  const upstreamHost = new URL(upstream).host;
  const server = http.createServer((req, res) => {
    // A controlled reverse proxy: append the actual peer IP after any
    // attacker-supplied forwarded chain, never accept it as the last hop.
    const observed = req.headers["x-fixture-client-ip"] || "198.51.100.10";
    const forwarded = req.headers["x-forwarded-for"];
    const headers = {
      ...req.headers,
      host: upstreamHost,
      "x-forwarded-for": forwarded ? forwarded + ", " + observed : observed,
    };
    delete headers["x-fixture-client-ip"];
    const next = http.request(upstream + req.url, {
      method: req.method, headers,
    }, (response) => {
      res.writeHead(response.statusCode, response.headers);
      response.pipe(res);
    });
    next.on("error", () => {
      if (!res.headersSent) res.writeHead(502);
      res.end();
    });
    req.pipe(next);
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  t.after(() => new Promise((resolve) => server.close(resolve)));
  return "http://127.0.0.1:" + server.address().port;
}

test("Trusted reverse proxy isolates login and OAuth quotas across real HTTP clients", async (t) => {
  const x = await instance(t, { trustedProxyIps: ["127.0.0.1"] });
  const proxy = await fixtureProxy(t, x.base);
  const a = "198.51.100.10", b = "198.51.100.20";
  const post = async (route, input, client, extra = {}) => {
    const form = typeof input === "string";
    const response = await fetch(proxy + route, {
      method: "POST",
      headers: {
        "Content-Type": form ? "application/x-www-form-urlencoded" : "application/json",
        Origin: x.base,
        "X-Metis-Request": "1",
        "X-Fixture-Client-IP": client,
        ...extra,
      },
      body: form ? input : JSON.stringify(input),
    });
    return { status: response.status, value: await response.json() };
  };
  const code = fs.readFileSync(path.join(x.app.store.dir, ".bootstrap_token"), "utf8").trim();
  assert.equal((await post("/api/bootstrap", {
    code, username: "tester", password: "test-password-long-enough",
  }, b)).status, 200);

  // Attacker controls the left side of XFF; the proxy appends the observed peer.
  for (let i = 0; i < 9; i++) {
    const result = await post("/api/login", {}, a, {
      "X-Forwarded-For": "192.0.2." + (i + 1),
    });
    assert.equal(result.status, i < 8 ? 400 : 429);
  }
  assert.equal((await post("/api/login", {
    username: "tester", password: "test-password-long-enough",
  }, b)).status, 200);
  assert.equal((await post("/api/login", {}, a)).status, 429);

  for (let i = 0; i < 6; i++)
    assert.equal((await post("/oauth/register", {}, a)).status, i < 5 ? 400 : 429);
  assert.equal((await post("/oauth/register", {
    client_name: "Synthetic client",
    redirect_uris: ["http://127.0.0.1:5000/callback"],
    token_endpoint_auth_method: "none",
  }, b)).status, 201);

  for (let i = 0; i < 31; i++)
    assert.equal((await post("/oauth/token", "grant_type=invalid", a)).status, i < 30 ? 400 : 429);
  assert.equal((await post("/oauth/token", "grant_type=invalid", b)).status, 400);
  for (let i = 0; i < 11; i++)
    assert.equal((await post("/oauth/revoke", "token=synthetic", a)).status, i < 10 ? 200 : 429);
  assert.equal((await post("/oauth/revoke", "token=synthetic", b)).status, 200);
});

test("Untrusted direct peers cannot forge quota identities via X-Forwarded-For", async (t) => {
  const x = await instance(t);
  assert.equal((await x.bootstrap()).status, 200);
  for (let i = 0; i < 9; i++) {
    const r = await x.call("/api/login", "POST", {}, {
      "X-Forwarded-For": "203.0.113." + (i + 1),
    });
    assert.equal(r.status, i < 8 ? 400 : 429);
  }
  assert.equal((await x.call("/api/login", "POST", {
    username: "tester", password: "test-password-long-enough",
  })).status, 429);
});

test("Proxy identity parsing rejects malformed, missing or all-trusted chains", () => {
  assert.equal(canonicalIp("::ffff:127.0.0.1"), "127.0.0.1");
  assert.equal(canonicalIp("2001:0db8::1"), "2001:db8::1");
  assert.equal(canonicalIp("203.0.113.8:1234"), null);
  assert.throws(() => trustedProxyIps("127.0.0.1,not-an-ip"), /invalide/);
  const trusted = trustedProxyIps("127.0.0.1,::1");
  const req = (forwarded) => ({
    socket: { remoteAddress: "::ffff:127.0.0.1" },
    headers: forwarded === undefined ? {} : { "x-forwarded-for": forwarded },
  });
  assert.equal(clientIp(req("192.0.2.4, 203.0.113.8"), trusted), "203.0.113.8");
  assert.equal(clientIp(req("192.0.2.4, ::1"), trusted), "192.0.2.4");
  for (const header of [undefined, "bad", "192.0.2.1, bad", "127.0.0.1", "192.0.2.1:1234"])
    assert.throws(() => clientIp(req(header), trusted), /proxy|IP|client/i);
  assert.equal(clientIp({ socket: { remoteAddress: "203.0.113.2" },
    headers: { "x-forwarded-for": "198.51.100.1" } }, trusted), "203.0.113.2");
});
