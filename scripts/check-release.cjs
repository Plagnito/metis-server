"use strict";
const fs = require("node:fs"),
  path = require("node:path"),
  crypto = require("node:crypto");
const root = path.resolve(__dirname, "..");
const topFiles = new Set([
  "package.json",
  "package-lock.json",
  "README.md",
  "README.fr.md",
  "LICENSE",
  "NOTICE",
  "SECURITY.md",
  "Dockerfile",
  "docker-compose.yml",
  "Start-Metis.cmd",
  ".gitignore",
  ".gitattributes",
  ".dockerignore",
  "release-manifest.json",
]);
const directories = new Set([
  "src",
  "public",
  "scripts",
  "test",
  "docs",
  ".github",
]);
const files = [];
function walk(dir, relative = "") {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const name = relative ? relative + "/" + e.name : e.name;
    if (!relative && [".git","node_modules"].includes(e.name)) continue;
    if (!relative && !topFiles.has(e.name) && !directories.has(e.name))
      throw new Error(
        "Fichier ou dossier non prévu dans la distribution : " + name,
      );
    const full = path.join(dir, e.name),
      stat = fs.lstatSync(full);
    if (stat.isSymbolicLink())
      throw new Error(
        "Lien symbolique interdit dans la distribution : " + name,
      );
    if (e.isDirectory()) {
      walk(full, name);
      continue;
    }
    if (
      !stat.isFile() ||
      /(?:^|\/)(?:\.env(?:\..*)?|instance\.key|\.bootstrap_token|server\.pid)|\.(?:db|sqlite)(?:-|$)|\.log$/.test(
        name,
      )
    )
      throw new Error(
        "Donnée locale ou type de fichier non publiable : " + name,
      );
    const buffer = fs.readFileSync(full);
    if (!/\.(jpg|png|svg)$/.test(name)) {
      const content = buffer.toString("utf8");
      if (/(?:C:\\Users\\|D:\\Claude\\|\/srv\/metis-lab\/)/.test(content))
        throw new Error("Chemin d’installation personnel : " + name);
      if (
        /(?:ghp_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{40,}|sk-[A-Za-z0-9_-]{35,})/.test(
          content,
        )
      )
        throw new Error("Jeton potentiel : " + name);
      if (
        /-----BEGIN (?:RSA )?PRIVATE KEY-----\r?\n[A-Za-z0-9+/=\r\n]{100,}-----END/.test(
          content,
        )
      )
        throw new Error("Clé privée potentielle : " + name);
    }
    if (name !== "release-manifest.json")
      files.push({
        path: name,
        bytes: buffer.length,
        sha256: crypto.createHash("sha256").update(buffer).digest("hex"),
      });
  }
}
walk(root);
files.sort((a, b) => a.path.localeCompare(b.path, "en"));
const manifest = {
  format: "metis-source-release-v1",
  version: require("../package.json").version,
  files,
};
const manifestPath = path.join(root, "release-manifest.json");
if (process.argv.includes("--manifest"))
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n");
else if (fs.existsSync(manifestPath)) {
  const recorded = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  if (JSON.stringify(recorded) !== JSON.stringify(manifest))
    throw new Error(
      "Le manifeste de publication ne correspond plus aux fichiers. Régénérez-le après validation.",
    );
}
console.log(
  "Distribution vérifiée : " +
    files.length +
    " fichiers explicitement bornés ; aucune base, clé ou configuration personnelle détectée.",
);
