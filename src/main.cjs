"use strict";
const fs = require("node:fs"),
  path = require("node:path");
const { createApp } = require("./app.cjs");
const dataDir = path.resolve(
  process.env.METIS_DATA_DIR || path.join(__dirname, "../data"),
);
fs.mkdirSync(dataDir, { recursive: true, mode: 0o700 });
const lock = path.join(dataDir, "server.pid");
function acquire() {
  try {
    fs.writeFileSync(lock, String(process.pid), { flag: "wx", mode: 0o600 });
  } catch (e) {
    if (e.code !== "EEXIST") throw e;
    const pid = Number(fs.readFileSync(lock, "utf8"));
    let exists = pid !== process.pid;
    if (exists && Number.isSafeInteger(pid) && pid > 0) {
      try {
        process.kill(pid, 0);
      } catch (error) {
        if (error.code === "ESRCH") exists = false;
      }
    }
    if (exists)
      throw new Error(
        "Une instance utilise déjà ce dossier de données (server.pid).",
      );
    fs.unlinkSync(lock);
    fs.writeFileSync(lock, String(process.pid), { flag: "wx", mode: 0o600 });
  }
}
acquire();
let app,
  closing = false;
async function stop() {
  if (closing) return;
  closing = true;
  try {
    if (app) await app.close();
  } finally {
    try {
      if (fs.readFileSync(lock, "utf8") === String(process.pid))
        fs.unlinkSync(lock);
    } catch {}
  }
}
process.on("SIGINT", () => void stop().then(() => process.exit()));
process.on("SIGTERM", () => void stop().then(() => process.exit()));
(async () => {
  app = createApp({ dataDir });
  const port = Number(process.env.PORT || 4880);
  if (!Number.isInteger(port) || port < 1 || port > 65535)
    throw new Error("PORT invalide.");
  await app.listen(port, process.env.METIS_HOST || "127.0.0.1");
  console.log("Métis Server — http://localhost:" + port);
  if (!app.auth.initialized())
    console.log(
      "Code d’installation : " +
        fs.readFileSync(path.join(dataDir, ".bootstrap_token"), "utf8").trim(),
    );
  console.log("Données : " + dataDir);
})().catch(async (e) => {
  console.error(e.message);
  await stop();
  process.exitCode = 1;
});
