"use strict";
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { DatabaseSync } = require("node:sqlite");
const { fail, object, text, int, repo, token, hash } = require("./util.cjs");
const { DEFAULT_CATEGORIES, DEFAULT_SECURITY_CATEGORIES, validateCategories, validateSecurityCategories, categories, resolveCategory } = require("./categories.cjs");
const DEFAULTS = {
  categories: DEFAULT_CATEGORIES,
  securityCategories: DEFAULT_SECURITY_CATEGORIES,
  name: "Métis",
  timezone: "Europe/Paris",
  baseUrl: "",
  modules: { research: true, security: true },
  repositories: [],
  github: { mode: "token", appId: "", installationId: "" },
  provider: { kind: "openai", model: "", baseUrl: "" },
};
function validateConfig(input) {
  object(input, [
    "name",
    "timezone",
    "baseUrl",
    "modules",
    "repositories",
    "github",
    "provider", "categories", "securityCategories",
  ]);
  const c = structuredClone(input);
  c.categories = validateCategories(c.categories || DEFAULT_CATEGORIES);
  c.securityCategories = validateSecurityCategories(c.securityCategories || DEFAULT_SECURITY_CATEGORIES);
  c.name = text(c.name, "Nom", 80);
  c.timezone = text(c.timezone, "Fuseau", 80);
  try {
    new Intl.DateTimeFormat("en", { timeZone: c.timezone }).format();
  } catch {
    fail("INVALID_ARGUMENT", "Fuseau horaire inconnu.");
  }
  c.baseUrl = c.baseUrl || "";
  if (c.baseUrl) {
    let u;
    try {
      u = new URL(c.baseUrl);
    } catch {
      fail("INVALID_ARGUMENT", "URL publique invalide.");
    }
    if (
      u.protocol !== "https:" ||
      u.username ||
      u.password ||
      u.search ||
      u.hash ||
      u.pathname !== "/"
    )
      fail(
        "INVALID_ARGUMENT",
        "L’URL publique doit être une origine HTTPS (sans chemin).",
      );
    c.baseUrl = u.origin;
  }
  object(c.modules, ["research", "security"]);
  if (
    typeof c.modules.research !== "boolean" ||
    typeof c.modules.security !== "boolean"
  )
    fail("INVALID_ARGUMENT", "Modules invalides.");
  if (!Array.isArray(c.repositories) || c.repositories.length > 50)
    fail("INVALID_ARGUMENT", "Sélectionnez au plus 50 dépôts.");
  c.repositories = [
    ...new Map(
      c.repositories.map((x) => [repo(x).toLowerCase(), repo(x)]),
    ).values(),
  ];
  c.github = c.github || { mode: "token", appId: "", installationId: "" };
  object(c.github, ["mode", "appId", "installationId"]);
  if (!["token", "app"].includes(c.github.mode))
    fail("INVALID_ARGUMENT", "Mode GitHub invalide.");
  for (const k of ["appId", "installationId"]) {
    c.github[k] = c.github[k] || "";
    if (c.github[k] && !/^\d{1,20}$/.test(c.github[k]))
      fail("INVALID_ARGUMENT", "Identifiant GitHub App invalide.");
  }
  if (c.github.mode === "app" && (!c.github.appId || !c.github.installationId))
    fail(
      "INVALID_ARGUMENT",
      "GitHub App : identifiants d’application et d’installation requis.",
    );
  object(c.provider, ["kind", "model", "baseUrl"]);
  if (!["openai", "anthropic", "compatible"].includes(c.provider.kind))
    fail("INVALID_ARGUMENT", "Fournisseur inconnu.");
  c.provider.model = text(c.provider.model || "", "Modèle", 160, 0);
  c.provider.baseUrl = c.provider.baseUrl || "";
  if (c.provider.kind === "compatible") {
    let u;
    try {
      u = new URL(c.provider.baseUrl);
    } catch {
      fail("INVALID_ARGUMENT", "Adresse du fournisseur local requise.");
    }
    const local = [
      "localhost",
      "127.0.0.1",
      "[::1]",
      "host.docker.internal",
    ].includes(u.hostname);
    if (
      (u.protocol !== "https:" && !(u.protocol === "http:" && local)) ||
      u.username ||
      u.password ||
      u.search ||
      u.hash
    )
      fail(
        "INVALID_ARGUMENT",
        "Fournisseur : HTTPS requis, ou HTTP sur une adresse locale explicite.",
      );
    c.provider.baseUrl = u.href.replace(/\/$/, "");
  } else c.provider.baseUrl = "";
  return c;
}
function openStore(directory) {
  const dir = path.resolve(directory);
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const keyPath = path.join(dir, "instance.key");
  let key;
  try {
    key = fs.readFileSync(keyPath);
  } catch (e) {
    if (e.code !== "ENOENT") throw e;
    if (fs.existsSync(path.join(dir, "metis.db")))
      fail(
        "MISSING_KEY",
        "La clé instance.key manque pour cette base existante. Restaurez sa clé d’origine.",
      );
    key = crypto.randomBytes(32);
    fs.writeFileSync(keyPath, key, { flag: "wx", mode: 0o600 });
  }
  if (key.length !== 32)
    fail(
      "INVALID_KEY",
      "Clé d’instance invalide. Restaurer la clé correspondant à la base.",
    );
  const db = new DatabaseSync(path.join(dir, "metis.db"));
  db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;
    CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY,value TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS secrets(name TEXT PRIMARY KEY,value TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS admin(id INTEGER PRIMARY KEY CHECK(id=1),username TEXT NOT NULL,password TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS sessions(hash TEXT PRIMARY KEY,csrf TEXT NOT NULL,expires INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS tokens(id TEXT PRIMARY KEY,hash TEXT UNIQUE NOT NULL,label TEXT NOT NULL,scopes TEXT NOT NULL,expires INTEGER NOT NULL,client TEXT,audience TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS oauth_clients(id TEXT PRIMARY KEY,data TEXT NOT NULL,created INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS oauth_codes(hash TEXT PRIMARY KEY,client TEXT NOT NULL,redirect TEXT NOT NULL,challenge TEXT NOT NULL,scopes TEXT NOT NULL,resource TEXT NOT NULL,expires INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS documents(slug TEXT PRIMARY KEY,title TEXT NOT NULL,body TEXT NOT NULL,status TEXT NOT NULL,version INTEGER NOT NULL,updated TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS document_versions(slug TEXT NOT NULL,version INTEGER NOT NULL,title TEXT NOT NULL,body TEXT NOT NULL,status TEXT NOT NULL,at TEXT NOT NULL,actor TEXT NOT NULL,PRIMARY KEY(slug,version));
    CREATE TABLE IF NOT EXISTS work_items(id TEXT PRIMARY KEY,title TEXT NOT NULL,description TEXT NOT NULL,status TEXT NOT NULL,version INTEGER NOT NULL,updated TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS work_notes(id INTEGER PRIMARY KEY,item TEXT NOT NULL,body TEXT NOT NULL,actor TEXT NOT NULL,at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS routines(id TEXT PRIMARY KEY,title TEXT NOT NULL,repository TEXT NOT NULL,kind TEXT NOT NULL,timezone TEXT NOT NULL,hour INTEGER NOT NULL,minute INTEGER NOT NULL,enabled INTEGER NOT NULL,limits TEXT NOT NULL,revision INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS jobs(id TEXT PRIMARY KEY,routine TEXT,occurrence TEXT UNIQUE NOT NULL,repository TEXT NOT NULL,kind TEXT NOT NULL,state TEXT NOT NULL,created TEXT NOT NULL,started TEXT,finished TEXT,heartbeat TEXT,lease TEXT,limits TEXT NOT NULL,usage TEXT NOT NULL DEFAULT '{}',result TEXT,error TEXT,commit_sha TEXT,context TEXT NOT NULL DEFAULT '{}');
    CREATE TABLE IF NOT EXISTS job_events(id INTEGER PRIMARY KEY,job TEXT NOT NULL,at TEXT NOT NULL,message TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS audit_log(id INTEGER PRIMARY KEY,at TEXT NOT NULL,actor TEXT NOT NULL,action TEXT NOT NULL,target TEXT);
    CREATE TABLE IF NOT EXISTS mutations(key TEXT PRIMARY KEY,digest TEXT NOT NULL,result TEXT NOT NULL,created INTEGER NOT NULL);
    CREATE INDEX IF NOT EXISTS jobs_state ON jobs(state,created);
    PRAGMA user_version=1;`);
  const docColumns = new Set(db.prepare("PRAGMA table_info(documents)").all().map(c=>c.name));
  for (const [name,definition] of [["category_id","TEXT NOT NULL DEFAULT 'research'"],["summary","TEXT NOT NULL DEFAULT ''"],["tags","TEXT NOT NULL DEFAULT '[]'"],["author","TEXT NOT NULL DEFAULT 'Administrateur'"],["created","TEXT NOT NULL DEFAULT ''"]]) {
    if(!docColumns.has(name)) db.exec("ALTER TABLE documents ADD COLUMN "+name+" "+definition);
  }
  const versionColumns = new Set(db.prepare("PRAGMA table_info(document_versions)").all().map(c=>c.name));
  for (const [name,definition] of [["category_id","TEXT NOT NULL DEFAULT 'research'"],["category_name","TEXT NOT NULL DEFAULT 'Recherche'"],["summary","TEXT NOT NULL DEFAULT ''"],["tags","TEXT NOT NULL DEFAULT '[]'"]]) {
    if(!versionColumns.has(name)) db.exec("ALTER TABLE document_versions ADD COLUMN "+name+" "+definition);
  }
  const get = (k, fallback = null) => {
    const row = db.prepare("SELECT value FROM settings WHERE key=?").get(k);
    return row ? JSON.parse(row.value) : fallback;
  };
  const set = (k, v) =>
    db
      .prepare(
        "INSERT INTO settings VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
      )
      .run(k, JSON.stringify(v));
  if (!get("config")) set("config", DEFAULTS);
  if(!get("config").categories) set("config", {...get("config"),categories:structuredClone(DEFAULT_CATEGORIES)});
  if(!get("config").securityCategories) set("config", {...get("config"),securityCategories:structuredClone(DEFAULT_SECURITY_CATEGORIES)});
  const config = () => ({...get("config"),categories:categories(get("config"))});
  if (
    !db.prepare("SELECT 1 FROM admin").get() &&
    !fs.existsSync(path.join(dir, ".bootstrap_token"))
  )
    fs.writeFileSync(path.join(dir, ".bootstrap_token"), token(), {
      flag: "wx",
      mode: 0o600,
    });
  function secret(name, value) {
    if (value !== undefined) {
      if (typeof value !== "string" || value.length > 10000)
        fail("INVALID_ARGUMENT", "Secret invalide.");
      if (!value) {
        db.prepare("DELETE FROM secrets WHERE name=?").run(name);
        return;
      }
      const iv = crypto.randomBytes(12),
        cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
      cipher.setAAD(Buffer.from(name));
      const data = Buffer.concat([
        cipher.update(value, "utf8"),
        cipher.final(),
      ]);
      db.prepare(
        "INSERT INTO secrets VALUES(?,?) ON CONFLICT(name) DO UPDATE SET value=excluded.value",
      ).run(
        name,
        Buffer.concat([iv, cipher.getAuthTag(), data]).toString("base64"),
      );
      return;
    }
    const row = db.prepare("SELECT value FROM secrets WHERE name=?").get(name);
    if (!row) return "";
    const b = Buffer.from(row.value, "base64"),
      decipher = crypto.createDecipheriv("aes-256-gcm", key, b.subarray(0, 12));
    decipher.setAAD(Buffer.from(name));
    decipher.setAuthTag(b.subarray(12, 28));
    return Buffer.concat([
      decipher.update(b.subarray(28)),
      decipher.final(),
    ]).toString("utf8");
  }
  const log = (actor, action, target = "") =>
    db
      .prepare("INSERT INTO audit_log(at,actor,action,target) VALUES(?,?,?,?)")
      .run(
        new Date().toISOString(),
        String(actor).slice(0, 100),
        action,
        String(target).slice(0, 200),
      );
  function transaction(fn) {
    db.exec("BEGIN IMMEDIATE");
    try {
      const r = fn();
      db.exec("COMMIT");
      return r;
    } catch (e) {
      db.exec("ROLLBACK");
      throw e;
    }
  }
  function mutation(actor, idempotencyKey, payload, fn) {
    if (!idempotencyKey) return fn();
    const k = hash(actor + ":" + text(idempotencyKey, "Clé", 160));
    const digest = hash(JSON.stringify(payload));
    return transaction(() => {
      const prior = db
        .prepare("SELECT digest,result FROM mutations WHERE key=?")
        .get(k);
      if (prior) {
        if (prior.digest !== digest)
          fail(
            "IDEMPOTENCY_CONFLICT",
            "Cette clé correspond à une autre modification.",
            409,
          );
        return JSON.parse(prior.result);
      }
      const result = fn();
      db.prepare("INSERT INTO mutations VALUES(?,?,?,?)").run(
        k,
        digest,
        JSON.stringify(result),
        Date.now(),
      );
      return result;
    });
  }
  function saveDocument(input, actor) {
    object(input, ["slug", "title", "body", "status", "expected_version", "category", "category_id", "summary", "tags"]);
    const slug = text(input.slug, "Identifiant", 80);
    if (!/^[a-z0-9][a-z0-9-]*$/.test(slug))
      fail(
        "INVALID_ARGUMENT",
        "Identifiant : lettres minuscules, chiffres et tirets.",
      );
    const title = text(input.title, "Titre", 160),
      body = text(input.body, "Document", 400000, 0),
      status = input.status || "draft";
    if (!["draft", "published", "archived"].includes(status))
      fail("INVALID_ARGUMENT", "Statut invalide.");
    int(input.expected_version, "Version attendue", 0, 1e9);
    const prior = db
      .prepare("SELECT version,category_id,summary,tags,created FROM documents WHERE slug=?")
      .get(slug);
    if ((prior?.version || 0) !== input.expected_version)
      fail(
        "REVISION_CONFLICT",
        "Le document a changé. Relisez sa version courante.",
        409,
      );
    const version = input.expected_version + 1,
      at = new Date().toISOString();
    const category = resolveCategory(config(), input.category_id || input.category || prior?.category_id);
    const summary = input.summary === undefined ? prior?.summary || "" : text(input.summary,"Résumé",600,0);
    const tags = input.tags === undefined ? JSON.parse(prior?.tags || "[]") : input.tags;
    if(!Array.isArray(tags) || tags.length>8 || tags.some(t=>typeof t!=="string" || t.length>30)) fail("INVALID_ARGUMENT","Étiquettes invalides.");
    db.prepare(
      "INSERT INTO documents(slug,title,body,status,version,updated,category_id,summary,tags,author,created) VALUES(?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(slug) DO UPDATE SET title=excluded.title,body=excluded.body,status=excluded.status,version=excluded.version,updated=excluded.updated,category_id=excluded.category_id,summary=excluded.summary,tags=excluded.tags,author=excluded.author",
    ).run(slug, title, body, status, version, at,category.id,summary,JSON.stringify(tags),String(actor),prior?.created || at);
    db.prepare("INSERT INTO document_versions(slug,version,title,body,status,at,actor,category_id,category_name,summary,tags) VALUES(?,?,?,?,?,?,?,?,?,?,?)").run(
      slug,
      version,
      title,
      body,
      status,
      at,
      actor,
      category.id,category.name,summary,JSON.stringify(tags),
    );
    log(actor, "document.save", slug);
    return { slug, title, body, status, version, updated: at, category_id:category.id,category:category.name,summary,tags };
  }
  function checkCategoryUse(next) {
    const ids = new Set(next.map(c=>c.id));
    for (const row of db.prepare("SELECT DISTINCT category_id FROM documents").all())
      if (!ids.has(row.category_id)) fail("CATEGORY_IN_USE", "Cette catégorie contient des documents. Déplacez-les avant de la retirer.", 409);
  }
  function saveCategories(value, expectedRevision, actor, securityValue = config().securityCategories) {
    const next = validateCategories(value);
    const nextSecurity = validateSecurityCategories(securityValue);
    transaction(()=>{
      if(get("configRevision",1)!==expectedRevision)fail("REVISION_CONFLICT","La configuration a changé. Rechargez la page.",409);
      checkCategoryUse(next);
      set("config",{...config(),categories:next,securityCategories:nextSecurity});
      set("configRevision",expectedRevision+1);
      log(actor,"categories.save");
    });
    return next;
  }
  function saveWork(input, actor) {
    object(input, ["id", "title", "description", "status", "expected_version"]);
    const id = input.id
      ? text(input.id, "Identifiant", 80)
      : "W-" + crypto.randomUUID();
    const prior = db.prepare("SELECT * FROM work_items WHERE id=?").get(id);
    int(input.expected_version, "Version attendue", 0, 1e9);
    if ((prior?.version || 0) !== input.expected_version)
      fail("REVISION_CONFLICT", "Le travail a changé.", 409);
    const status = input.status || "open";
    if (!["open", "active", "completed", "cancelled"].includes(status))
      fail("INVALID_ARGUMENT", "Statut invalide.");
    const title = text(input.title, "Titre", 160),
      description = text(input.description || "", "Description", 12000, 0),
      version = input.expected_version + 1,
      at = new Date().toISOString();
    db.prepare(
      "INSERT INTO work_items VALUES(?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET title=excluded.title,description=excluded.description,status=excluded.status,version=excluded.version,updated=excluded.updated",
    ).run(id, title, description, status, version, at);
    log(actor, "work.save", id);
    return { id, title, description, status, version, updated: at };
  }
  return {
    dir,
    db,
    get,
    set,
    secret,
    log,
    transaction,
    mutation,
    saveDocument,
    saveCategories,
    checkCategoryUse,
    saveWork,
    config,
    close: () => db.close(),
  };
}
module.exports = { openStore, validateConfig, DEFAULTS };
