"use strict";
const test = require("node:test"),
  assert = require("node:assert/strict"),
  fs = require("node:fs"),
  path = require("node:path");
const { openStore, validateConfig } = require("../src/store.cjs");
const { backup } = require("../scripts/backup.cjs"),
  { restore } = require("../scripts/restore.cjs");
const { temp } = require("./helpers.cjs");
test("Secrets are encrypted, bound to their field and persist across restarts", () => {
  const dir = temp();
  let s = openStore(dir);
  s.secret("provider", "private-fixture-secret");
  s.secret("github", "github-fixture-secret");
  const raw = s.db
    .prepare("SELECT value FROM secrets WHERE name=?")
    .get("provider").value;
  assert.ok(!raw.includes("private-fixture-secret"));
  s.db.prepare("UPDATE secrets SET value=? WHERE name=?").run(raw, "github");
  assert.throws(() => s.secret("github"));
  s.close();
  s = openStore(dir);
  assert.equal(s.secret("provider"), "private-fixture-secret");
  s.close();
});
test("Public URLs, local provider URLs, owner/repo syntax and explicit settings are validated", () => {
  const s = openStore(temp()),
    base = s.config();
  assert.throws(
    () => validateConfig({ ...base, baseUrl: "http://example.com" }),
    /HTTPS/,
  );
  assert.throws(
    () => validateConfig({ ...base, baseUrl: "https://example.com/path" }),
    /origine/,
  );
  assert.throws(
    () => validateConfig({ ...base, repositories: ["../bad"] }),
    /Format/,
  );
  assert.throws(
    () => validateConfig({ ...base, timezone: "Mars/Base" }),
    /Fuseau/,
  );
  assert.throws(
    () =>
      validateConfig({
        ...base,
        provider: {
          kind: "compatible",
          model: "x",
          baseUrl: "http://169.254.169.254",
        },
      }),
    /HTTPS/,
  );
  assert.equal(
    validateConfig({
      ...base,
      provider: {
        kind: "compatible",
        model: "x",
        baseUrl: "http://host.docker.internal:11434/v1",
      },
    }).provider.baseUrl,
    "http://host.docker.internal:11434/v1",
  );
  s.close();
});
test("Backup is consistent; restoration checks the entire manifest and revokes old grants", async () => {
  const parent = temp(),
    s = openStore(path.join(parent, "data"));
  s.secret("provider", "backup-fixture-secret");
  s.transaction(() =>
    s.saveDocument(
      {
        slug: "saved",
        title: "Saved fixture",
        body: "Versioned content",
        expected_version: 0,
      },
      "test",
    ),
  );
  s.db
    .prepare("INSERT INTO sessions VALUES(?,?,?)")
    .run("session-hash", "csrf", Date.now() + 100000);
  s.db
    .prepare("INSERT INTO tokens VALUES(?,?,?,?,?,?,?)")
    .run(
      "token-id",
      "token-hash",
      "label",
      '["metis:read"]',
      Date.now() + 100000,
      null,
      "fixture",
    );
  const destination = path.join(parent, "backup");
  await backup(s.dir, destination);
  s.close();
  const restored = path.join(parent, "restored");
  await restore(destination, restored);
  const r = openStore(restored);
  assert.equal(r.secret("provider"), "backup-fixture-secret");
  assert.equal(
    r.db.prepare("SELECT body FROM documents").get().body,
    "Versioned content",
  );
  assert.equal(r.db.prepare("SELECT COUNT(*) n FROM tokens").get().n, 0);
  assert.equal(r.db.prepare("SELECT COUNT(*) n FROM sessions").get().n, 0);
  r.close();
  await assert.rejects(restore(destination, restored), /nouveau/);
  fs.writeFileSync(path.join(destination, "unexpected"), "bad");
  await assert.rejects(
    restore(destination, path.join(parent, "reject-extra")),
    /absents/,
  );
  fs.unlinkSync(path.join(destination, "unexpected"));
  fs.appendFileSync(path.join(destination, "metis.db"), "tampered");
  await assert.rejects(
    restore(destination, path.join(parent, "reject-tamper")),
    /Empreinte/,
  );
});
test("Document transaction rolls back all writes when its payload fails", () => {
  const s = openStore(temp());
  assert.throws(
    () =>
      s.mutation("test", "key", { x: 1 }, () => {
        s.saveDocument(
          {
            slug: "rollback",
            title: "Fixture",
            body: "Data",
            expected_version: 0,
          },
          "test",
        );
        throw new Error("Abort");
      }),
    /Abort/,
  );
  assert.equal(s.db.prepare("SELECT COUNT(*) n FROM documents").get().n, 0);
  assert.equal(
    s.db.prepare("SELECT COUNT(*) n FROM document_versions").get().n,
    0,
  );
  s.close();
});
test("An existing database never receives a silently regenerated instance key", () => {
  const dir = temp(),
    s = openStore(dir);
  s.secret("provider", "protected-fixture");
  s.close();
  fs.renameSync(path.join(dir, "instance.key"), path.join(dir, "saved.key"));
  assert.throws(() => openStore(dir), /clé instance.key manque/);
  assert.equal(fs.existsSync(path.join(dir, "instance.key")), false);
});
