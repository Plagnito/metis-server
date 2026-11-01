"use strict";
const fs = require("node:fs"),
  path = require("node:path"),
  crypto = require("node:crypto");
const { DatabaseSync } = require("node:sqlite");
async function digest(file) {
  const h = crypto.createHash("sha256");
  for await (const b of fs.createReadStream(file)) h.update(b);
  return h.digest("hex");
}
async function backup(source, target) {
  source = path.resolve(source);
  target = path.resolve(target);
  if (target === source || target.startsWith(source + path.sep))
    throw new Error(
      "La destination doit être extérieure au dossier de données.",
    );
  for (const name of ["metis.db", "instance.key"])
    if (
      !fs.lstatSync(path.join(source, name)).isFile() ||
      fs.lstatSync(path.join(source, name)).isSymbolicLink()
    )
      throw new Error(
        "Fichier de données manquant ou lien symbolique : " + name,
      );
  fs.mkdirSync(target, { mode: 0o700 });
  const db = new DatabaseSync(path.join(source, "metis.db"), {
    readOnly: true,
  });
  try {
    db.exec("PRAGMA busy_timeout=10000");
    db.prepare("VACUUM INTO ?").run(path.join(target, "metis.db"));
  } finally {
    db.close();
  }
  fs.copyFileSync(
    path.join(source, "instance.key"),
    path.join(target, "instance.key"),
    fs.constants.COPYFILE_EXCL,
  );
  fs.chmodSync(path.join(target, "instance.key"), 0o600);
  const files = [];
  for (const name of ["metis.db", "instance.key"])
    files.push({
      name,
      bytes: fs.statSync(path.join(target, name)).size,
      sha256: await digest(path.join(target, name)),
    });
  fs.writeFileSync(
    path.join(target, "manifest.json"),
    JSON.stringify(
      { format: "metis-backup-v1", created: new Date().toISOString(), files },
      null,
      2,
    ) + "\n",
    { flag: "wx", mode: 0o600 },
  );
  return { directory: target, files: files.length };
}
if (require.main === module) {
  const target = process.argv[2];
  if (!target) {
    console.error("Usage : npm run backup -- <nouveau-dossier>");
    process.exitCode = 1;
  } else
    backup(
      process.env.METIS_DATA_DIR || path.join(__dirname, "../data"),
      target,
    )
      .then((r) => console.log("Sauvegarde vérifiée : " + r.directory))
      .catch((e) => {
        console.error(e.message);
        process.exitCode = 1;
      });
}
module.exports = { backup, digest };
