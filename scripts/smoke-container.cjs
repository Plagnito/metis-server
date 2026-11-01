"use strict";
const { execFileSync } = require("node:child_process"),
  crypto = require("node:crypto"),
  assert = require("node:assert/strict");
if (process.env.METIS_CONTAINER_SMOKE !== "1")
  throw new Error(
    "Réservé à une instance conteneur de recette vierge (METIS_CONTAINER_SMOKE=1).",
  );
const base = "http://127.0.0.1:4880";
const project = process.env.METIS_COMPOSE_PROJECT || "metis-server";
if (!/^[a-z0-9][a-z0-9_-]{0,80}$/.test(project))
  throw new Error("Nom de projet de recette invalide.");
(async () => {
  const before = await fetch(base + "/api/status").then((r) => r.json());
  assert.equal(
    before.initialized,
    false,
    "La recette refuse de modifier une instance déjà configurée.",
  );
  const code = execFileSync(
    "docker",
    [
      "compose",
      "-p",
      project,
      "exec",
      "-T",
      "metis",
      "cat",
      "/data/.bootstrap_token",
    ],
    { encoding: "utf8" },
  ).trim();
  const r = await fetch(base + "/api/bootstrap", {
    method: "POST",
    headers: {
      Origin: base,
      "X-Metis-Request": "1",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      code,
      username: "ci-admin",
      password: crypto.randomBytes(24).toString("hex"),
    }),
  });
  assert.equal(r.status, 200);
  const value = await r.json(),
    cookie = r.headers.get("set-cookie").split(";")[0];
  const state = await fetch(base + "/api/state", {
    headers: { Cookie: cookie },
  }).then((r) => r.json());
  assert.equal(state.config.repositories.length, 0);
  assert.equal(state.routines.length, 0);
  assert.ok(value.csrf);
  execFileSync("docker", ["compose", "-p", project, "restart"], {
    stdio: "pipe",
  });
  let after;
  for (let i = 0; i < 60; i++) {
    try {
      const response = await fetch(base + "/api/status");
      if (response.ok) {
        after = await response.json();
        break;
      }
    } catch {}
    await new Promise((r) => setTimeout(r, 500));
  }
  assert.equal(
    after?.initialized,
    true,
    "L’administrateur doit survivre au redémarrage.",
  );
  console.log(
    "Installation conteneur, premier compte et persistance vérifiés.",
  );
})().catch((e) => {
  console.error(e.message);
  process.exitCode = 1;
});
