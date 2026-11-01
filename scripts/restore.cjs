"use strict";
const fs = require("node:fs"),
  path = require("node:path");
const { DatabaseSync } = require("node:sqlite");
const { digest } = require("./backup.cjs");
async function restore(source, target) {
  source = path.resolve(source);
  target = path.resolve(target);
  if (fs.existsSync(target))
    throw new Error(
      "Le dossier cible doit être nouveau. Aucune donnée existante ne sera remplacée.",
    );
  const stat = fs.lstatSync(source);
  if (!stat.isDirectory() || stat.isSymbolicLink())
    throw new Error("Dossier de sauvegarde invalide.");
  const names = fs.readdirSync(source).sort();
  if (
    JSON.stringify(names) !==
    JSON.stringify(["instance.key", "manifest.json", "metis.db"])
  )
    throw new Error(
      "La sauvegarde contient des fichiers absents du format autorisé.",
    );
  for (const name of names) {
    const info = fs.lstatSync(path.join(source, name));
    if (!info.isFile() || info.isSymbolicLink())
      throw new Error("Lien ou fichier spécial refusé.");
  }
  if (fs.statSync(path.join(source, "manifest.json")).size > 16000)
    throw new Error("Manifeste trop volumineux.");
  const m = JSON.parse(
    fs.readFileSync(path.join(source, "manifest.json"), "utf8"),
  );
  if (
    m.format !== "metis-backup-v1" ||
    !Array.isArray(m.files) ||
    m.files.length !== 2 ||
    new Set(m.files.map((f) => f.name)).size !== 2 ||
    m.files.some((f) => !["metis.db", "instance.key"].includes(f.name))
  )
    throw new Error("Manifeste invalide.");
  for (const f of m.files) {
    const file = path.join(source, f.name);
    if (fs.statSync(file).size !== f.bytes || (await digest(file)) !== f.sha256)
      throw new Error("Empreinte incorrecte : " + f.name);
  }
  if (fs.statSync(path.join(source, "instance.key")).size !== 32)
    throw new Error("Clé d’instance invalide.");
  fs.mkdirSync(target, { mode: 0o700 });
  for (const name of ["metis.db", "instance.key"])
    fs.copyFileSync(
      path.join(source, name),
      path.join(target, name),
      fs.constants.COPYFILE_EXCL,
    );
  fs.chmodSync(path.join(target, "instance.key"), 0o600);
  const db = new DatabaseSync(path.join(target, "metis.db"));
  try {
    if (db.prepare("PRAGMA quick_check").get().quick_check !== "ok")
      throw new Error("Contrôle SQLite échoué.");
    db.exec(
      "BEGIN IMMEDIATE; DELETE FROM sessions; DELETE FROM tokens; DELETE FROM oauth_codes; COMMIT;",
    );
    db.prepare(
      "UPDATE jobs SET state='interrupted',lease=NULL,error='Travail interrompu par une restauration.' WHERE state='running'",
    ).run();
  } finally {
    db.close();
  }
  return { directory: target };
}
if (require.main === module) {
  const [source, target] = process.argv.slice(2);
  if (!source || !target) {
    console.error(
      "Usage : npm run restore -- <sauvegarde> <nouveau-dossier-donnees>",
    );
    process.exitCode = 1;
  } else
    restore(source, target)
      .then((r) =>
        console.log(
          "Restauré dans : " +
            r.directory +
            "\nLes sessions et clés de connexion ont été révoquées.",
        ),
      )
      .catch((e) => {
        console.error(e.message);
        process.exitCode = 1;
      });
}
module.exports = { restore };
