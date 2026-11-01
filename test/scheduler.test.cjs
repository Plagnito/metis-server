"use strict";
const test = require("node:test"),
  assert = require("node:assert/strict");
const {
  instance,
  fakeUpstreams,
  configure,
  response,
} = require("./helpers.cjs");
const {
  localParts,
  nextDaily,
  occurrence,
  DEFAULT_LIMITS,
} = require("../src/scheduler.cjs");
test("Autonomous audit pins source, reads a file, records exact evidence and produces an honest report", async (t) => {
  const upstream = fakeUpstreams(),
    x = await instance(t, { fetchImpl: upstream.fetchImpl });
  configure(x.app);
  await x.app.providers.test(AbortSignal.timeout(5000));
  const { id } = x.app.scheduler.manual(
    { repository: "Example/project" },
    "fixture",
  );
  await x.app.scheduler.tick();
  const j = x.app.scheduler.getJob(id);
  assert.equal(j.state, "completed", j.error);
  assert.equal(j.result.tests_executed, false);
  assert.equal(j.result.commit, upstream.commit);
  assert.equal(j.usage.calls, 3);
  assert.equal(j.usage.tokens, 600);
  assert.equal(j.usage.files, 1);
  const findings = x.app.security.listerFailles("test", {}).failles;
  assert.equal(findings.length, 1);
  assert.equal(findings[0].emplacement, "src/access.js:2");
  const f = x.app.security.lireFaille("test", { id: findings[0].id }).faille;
  assert.ok(
    f.preuves.some((p) => p.ref?.includes(upstream.commit.slice(0, 12))),
  );
  assert.ok(!upstream.seen.some((x) => x.url.includes("/contents/.env")));
});
test("A failed billed call retains its reservation and is not automatically retried", async (t) => {
  const upstream = fakeUpstreams({ providerError: true }),
    x = await instance(t, { fetchImpl: upstream.fetchImpl });
  configure(x.app);
  await x.app.providers.test(AbortSignal.timeout(5000));
  const { id } = x.app.scheduler.manual(
    { repository: "Example/project" },
    "failed",
  );
  await x.app.scheduler.tick();
  const j = x.app.scheduler.getJob(id);
  assert.equal(j.state, "failed");
  assert.equal(j.usage.calls, 1);
  assert.ok(j.usage.tokens > 0);
  assert.match(j.error, /HTTP 429/);
  await x.app.scheduler.tick();
  assert.equal(
    upstream.seen.filter((c) => c.url.endsWith("/responses")).length,
    2,
  );
});
test("Call budget stops an unfinished audit and preserves its read activity", async (t) => {
  const upstream = fakeUpstreams(),
    x = await instance(t, { fetchImpl: upstream.fetchImpl });
  configure(x.app);
  await x.app.providers.test(AbortSignal.timeout(5000));
  const { id } = x.app.scheduler.manual(
    { repository: "Example/project", limits: { maxCalls: 1 } },
    "one-call",
  );
  await x.app.scheduler.tick();
  const j = x.app.scheduler.getJob(id);
  assert.equal(j.state, "failed");
  assert.match(j.error, /maximal/);
  assert.equal(j.usage.files, 1);
  assert.throws(() => x.app.scheduler.resume(id), /épuisé/);
});
test("Fabricated evidence is rejected; unknown tools cannot execute repository commands", async (t) => {
  const upstream = fakeUpstreams({
    customTurn: async (body, n) => {
      const scripts = [
        ["read_file", { path: "src/access.js", start_line: 1, line_count: 3 }],
        ["execute_shell", { command: "echo unsafe" }],
        [
          "record_finding",
          {
            title: "Fabricated fixture finding",
            severity: "haute",
            path: "src/access.js",
            line: 2,
            excerpt: "invented code",
            description: "Fabricated finding should be refused.",
          },
        ],
        [
          "finish_audit",
          {
            summary: "La fixture a été examinée sans preuve recevable.",
            limitations:
              "Analyse d’un fichier synthétique ; aucun code exécuté.",
          },
        ],
      ];
      if (n === 3) assert.match(JSON.stringify(body), /TOOL_DENIED/);
      if (n === 4) assert.match(JSON.stringify(body), /EVIDENCE_REQUIRED/);
      const [name, args] = scripts[n - 1];
      return response({
        status: "completed",
        output: [
          {
            type: "function_call",
            call_id: "tool-" + n,
            name,
            arguments: JSON.stringify(args),
          },
        ],
        usage: { total_tokens: 100 },
      });
    },
  });
  const x = await instance(t, { fetchImpl: upstream.fetchImpl });
  configure(x.app);
  await x.app.providers.test(AbortSignal.timeout(5000));
  const { id } = x.app.scheduler.manual(
    { repository: "Example/project" },
    "untrusted",
  );
  await x.app.scheduler.tick();
  const j = x.app.scheduler.getJob(id);
  assert.equal(j.state, "completed", j.error);
  assert.equal(j.result.findings.length, 0);
  assert.equal(x.app.security.listerFailles("test", {}).total, 0);
});
test("Daily scheduling handles spring gaps and deduplicates the repeated autumn hour", () => {
  const r = { id: "daily", timezone: "Europe/Paris", hour: 2, minute: 30 };
  assert.equal(
    nextDaily(r, new Date("2026-03-29T00:59:00Z")),
    "2026-03-29T01:00:00.000Z",
  );
  assert.equal(
    occurrence(r, new Date("2026-10-25T00:35:00Z")),
    occurrence(r, new Date("2026-10-25T01:35:00Z")),
  );
  assert.equal(
    localParts(new Date("2026-03-29T01:00:00Z"), "Europe/Paris").minute,
    180,
  );
});
test("One daily occurrence survives repeated ticks and server interruption", async (t) => {
  const upstream = fakeUpstreams(),
    x = await instance(t, { fetchImpl: upstream.fetchImpl });
  configure(x.app);
  await x.app.providers.test(AbortSignal.timeout(5000));
  x.app.scheduler.saveRoutine({
    title: "Daily",
    repository: "Example/project",
    kind: "audit",
    timezone: "UTC",
    hour: 9,
    minute: 0,
    enabled: true,
    limits: DEFAULT_LIMITS,
    expected_revision: 0,
  });
  await x.app.scheduler.tick(new Date("2026-11-01T10:00:00Z"));
  await x.app.scheduler.tick(new Date("2026-11-01T11:00:00Z"));
  assert.equal(x.app.scheduler.listJobs().length, 1);
  const j = x.app.scheduler.listJobs()[0];
  x.app.store.db
    .prepare("UPDATE jobs SET state='running' WHERE id=?")
    .run(j.id);
  const count = upstream.seen.length;
  x.app.scheduler.recover();
  assert.equal(x.app.scheduler.getJob(j.id).state, "interrupted");
  assert.equal(upstream.seen.length, count);
});
test("Manual launch is idempotent and active work excludes a second worker", async (t) => {
  let release, started;
  const blocked = new Promise((r) => (release = r)),
    signalStarted = new Promise((r) => (started = r));
  const upstream = fakeUpstreams({
    customTurn: async () => {
      started();
      await blocked;
      return response({
        status: "completed",
        output: [],
        usage: { total_tokens: 20 },
      });
    },
  });
  const x = await instance(t, { fetchImpl: upstream.fetchImpl });
  configure(x.app);
  await x.app.providers.test(AbortSignal.timeout(5000));
  const first = x.app.scheduler.manual(
    { repository: "Example/project" },
    "same",
  );
  assert.equal(
    x.app.scheduler.manual({ repository: "Example/project" }, "same").id,
    first.id,
  );
  x.app.scheduler.manual({ repository: "Example/project" }, "second");
  const pending = x.app.scheduler.tick();
  await signalStarted;
  await x.app.scheduler.tick();
  assert.equal(
    x.app.scheduler.listJobs().filter((j) => j.state === "running").length,
    1,
  );
  assert.equal(
    x.app.scheduler.listJobs().filter((j) => j.state === "queued").length,
    1,
  );
  release();
  await pending;
});
test("A deselected repository cannot be launched and untested provider cannot enable a routine", async (t) => {
  const x = await instance(t);
  configure(x.app);
  assert.throws(
    () =>
      x.app.scheduler.saveRoutine({
        title: "Daily",
        repository: "Example/project",
        kind: "audit",
        timezone: "UTC",
        hour: 9,
        minute: 0,
        enabled: true,
        limits: DEFAULT_LIMITS,
        expected_revision: 0,
      }),
    /Testez/,
  );
  const c = x.app.store.config();
  c.repositories = [];
  x.app.store.set("config", c);
  assert.throws(
    () =>
      x.app.scheduler.manual({ repository: "Example/project" }, "not-selected"),
    /non sélectionné/,
  );
});
test("A queued job can be cancelled without any provider call", async (t) => {
  const upstream = fakeUpstreams(),
    x = await instance(t, { fetchImpl: upstream.fetchImpl });
  configure(x.app);
  await x.app.providers.test(AbortSignal.timeout(5000));
  const { id } = x.app.scheduler.manual(
    { repository: "Example/project" },
    "cancel",
  );
  const before = upstream.seen.length;
  x.app.scheduler.cancel(id);
  await x.app.scheduler.tick();
  assert.equal(x.app.scheduler.getJob(id).state, "cancelled");
  assert.equal(upstream.seen.length, before);
});
