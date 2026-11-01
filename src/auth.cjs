"use strict";
const crypto = require("node:crypto"),
  fs = require("node:fs"),
  path = require("node:path"),
  { promisify } = require("node:util");
const scrypt = promisify(crypto.scrypt);
const { fail, object, text, int, token, hash, equal } = require("./util.cjs");
const SCOPES = ["metis:read", "metis:write", "security:read", "security:write"];
function createAuth(store, audience = () => "local:" + store.dir) {
  const { db } = store,
    attempts = new Map();
  const initialized = () => !!db.prepare("SELECT 1 FROM admin").get();
  function limit(key, maximum = 10, window = 60000) {
    const now = Date.now(),
      prior = attempts.get(key);
    if (!prior || prior.until < now)
      attempts.set(key, { n: 1, until: now + window });
    else {
      prior.n++;
      if (prior.n > maximum)
        fail("RATE_LIMITED", "Trop de tentatives. Réessayez plus tard.", 429);
    }
    if (attempts.size > 5000) {
      for (const [k, v] of attempts) if (v.until < now) attempts.delete(k);
      if (attempts.size > 5000) attempts.delete(attempts.keys().next().value);
    }
  }
  async function passwordHash(password, salt = token()) {
    const key = await scrypt(password, salt, 64, {
      N: 32768,
      r: 8,
      p: 1,
      maxmem: 64 * 1024 * 1024,
    });
    return salt + ":" + key.toString("hex");
  }
  async function bootstrap(input, ip) {
    limit("bootstrap:" + ip, 5, 15 * 60000);
    object(input, ["code", "username", "password"]);
    if (initialized())
      fail(
        "ALREADY_INITIALIZED",
        "Cette instance possède déjà un administrateur.",
        409,
      );
    const code = fs
      .readFileSync(path.join(store.dir, ".bootstrap_token"), "utf8")
      .trim();
    if (!equal(text(input.code, "Code", 100), code))
      fail("INVALID_BOOTSTRAP", "Code d’installation incorrect.", 403);
    const username = text(input.username, "Identifiant", 80),
      password = text(input.password, "Mot de passe", 256, 12);
    const encoded = await passwordHash(password);
    store.transaction(() => {
      if (initialized())
        fail("ALREADY_INITIALIZED", "Instance déjà initialisée.", 409);
      db.prepare("INSERT INTO admin VALUES(1,?,?)").run(username, encoded);
      store.log("admin", "instance.bootstrap");
    });
    fs.unlinkSync(path.join(store.dir, ".bootstrap_token"));
    return session();
  }
  async function login(input, ip) {
    limit("login:" + ip, 8, 15 * 60000);
    object(input, ["username", "password"]);
    const username = text(input.username, "Identifiant", 80),
      password = text(input.password, "Mot de passe", 256);
    const row = db.prepare("SELECT * FROM admin").get(),
      salt = row?.password.split(":")[0] || "invalid-user-constant-salt";
    const actual = await passwordHash(password, salt);
    if (!row || !equal(row.username, username) || !equal(row.password, actual))
      fail("INVALID_LOGIN", "Identifiant ou mot de passe incorrect.", 401);
    attempts.delete("login:" + ip);
    return session();
  }
  function session() {
    db.prepare("DELETE FROM sessions WHERE expires<?").run(Date.now());
    const value = token(),
      csrf = token();
    db.prepare("INSERT INTO sessions VALUES(?,?,?)").run(
      hash(value),
      csrf,
      Date.now() + 12 * 3600000,
    );
    return { value, csrf };
  }
  function identify(req, { bearer = true } = {}) {
    if (bearer && req.headers.authorization) {
      const match = /^Bearer ([A-Za-z0-9_-]{30,100})$/.exec(
        req.headers.authorization,
      );
      if (!match) return null;
      const r = db
        .prepare("SELECT * FROM tokens WHERE hash=? AND expires>?")
        .get(hash(match[1]), Date.now());
      return r && r.audience === audience()
        ? {
            id: r.id,
            role: "integration",
            scopes: JSON.parse(r.scopes),
            client: r.client,
          }
        : null;
    }
    const v = /(?:^|;\s*)metis_session=([A-Za-z0-9_-]+)/.exec(
      req.headers.cookie || "",
    )?.[1];
    const s =
      v &&
      db
        .prepare("SELECT * FROM sessions WHERE hash=? AND expires>?")
        .get(hash(v), Date.now());
    return s
      ? {
          id: "admin",
          role: "admin",
          scopes: SCOPES,
          csrf: s.csrf,
          sessionHash: hash(v),
        }
      : null;
  }
  function requireAdmin(req) {
    const actor = identify(req, { bearer: false });
    if (actor?.role !== "admin")
      fail("AUTH_REQUIRED", "Connexion administrateur requise.", 401);
    return actor;
  }
  function createToken(input, actor = "admin", client = null) {
    object(input, ["label", "scopes", "days"]);
    if (
      !Array.isArray(input.scopes) ||
      !input.scopes.length ||
      input.scopes.some((x) => !SCOPES.includes(x))
    )
      fail("INVALID_ARGUMENT", "Portées invalides.");
    const value = token(),
      id = crypto.randomUUID(),
      expires = Date.now() + int(input.days ?? 30, "Durée", 1, 365) * 86400000;
    db.prepare("INSERT INTO tokens VALUES(?,?,?,?,?,?,?)").run(
      id,
      hash(value),
      text(input.label, "Nom", 100),
      JSON.stringify([...new Set(input.scopes)]),
      expires,
      client,
      audience(),
    );
    store.log(actor, "token.create", id);
    return { id, token: value, expires, scopes: input.scopes };
  }
  return {
    SCOPES,
    initialized,
    limit,
    bootstrap,
    login,
    identify,
    requireAdmin,
    createToken,
  };
}
function redirectURI(value) {
  let u;
  try {
    u = new URL(text(value, "Adresse de retour", 2000));
  } catch {
    fail("INVALID_REDIRECT", "Adresse de retour invalide.");
  }
  const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(u.hostname);
  if (
    u.username ||
    u.password ||
    u.hash ||
    (u.protocol !== "https:" && !(u.protocol === "http:" && loopback))
  )
    fail("INVALID_REDIRECT", "Retour HTTPS ou boucle locale HTTP requis.");
  return u.href;
}
function createOAuth(store, auth, origin) {
  const { db } = store;
  function register(input, ip) {
    auth.limit("register:" + ip, 5, 3600000);
    object(input, [
      "client_name",
      "redirect_uris",
      "grant_types",
      "response_types",
      "token_endpoint_auth_method",
      "scope",
      "client_uri",
      "logo_uri",
      "contacts",
    ]);
    if (
      !Array.isArray(input.redirect_uris) ||
      !input.redirect_uris.length ||
      input.redirect_uris.length > 5
    )
      fail("INVALID_ARGUMENT", "Une à cinq adresses de retour requises.");
    if (
      input.token_endpoint_auth_method &&
      input.token_endpoint_auth_method !== "none"
    )
      fail("INVALID_ARGUMENT", "Ce serveur utilise des clients publics PKCE.");
    if (
      input.grant_types &&
      JSON.stringify(input.grant_types) !== '["authorization_code"]'
    )
      fail("INVALID_ARGUMENT", "Seul authorization_code est disponible.");
    if (
      input.response_types &&
      JSON.stringify(input.response_types) !== '["code"]'
    )
      fail("INVALID_ARGUMENT", "Seul response_type=code est disponible.");
    const count = db.prepare("SELECT COUNT(*) n FROM oauth_clients").get().n;
    if (count >= 500)
      fail(
        "REGISTRATION_FULL",
        "Supprimez des clients OAuth inutilisés depuis l’administration.",
        429,
      );
    const id = crypto.randomUUID(),
      data = {
        client_id: id,
        client_name: text(
          input.client_name || "Client MCP",
          "Application",
          120,
        ),
        redirect_uris: input.redirect_uris.map(redirectURI),
        grant_types: ["authorization_code"],
        response_types: ["code"],
        token_endpoint_auth_method: "none",
      };
    db.prepare("INSERT INTO oauth_clients VALUES(?,?,?)").run(
      id,
      JSON.stringify(data),
      Date.now(),
    );
    return data;
  }
  function request(params) {
    const id = text(params.client_id, "client_id", 100),
      row = db.prepare("SELECT data FROM oauth_clients WHERE id=?").get(id);
    if (!row) fail("INVALID_CLIENT", "Client OAuth inconnu.");
    const client = JSON.parse(row.data),
      redirect = redirectURI(params.redirect_uri);
    if (!client.redirect_uris.includes(redirect))
      fail("INVALID_REDIRECT", "Adresse de retour non enregistrée.");
    if (
      params.response_type !== "code" ||
      params.code_challenge_method !== "S256" ||
      !/^[A-Za-z0-9_-]{43}$/.test(params.code_challenge || "")
    )
      fail("INVALID_REQUEST", "Authorization code et PKCE S256 requis.");
    const scopes = String(params.scope || "metis:read")
      .split(" ")
      .filter(Boolean);
    if (!scopes.length || scopes.some((s) => !auth.SCOPES.includes(s)))
      fail("INVALID_SCOPE", "Portée non disponible.");
    const resource = params.resource || origin() + "/mcp";
    if (resource !== origin() + "/mcp")
      fail("INVALID_TARGET", "Audience MCP incorrecte.");
    const state =
      params.state === undefined ? "" : text(params.state, "state", 2000, 0);
    return {
      client,
      redirect,
      scopes,
      resource,
      state,
      challenge: params.code_challenge,
    };
  }
  function consent(params, actor) {
    const r = request(params),
      code = token();
    if (params.decision !== "allow") {
      const u = new URL(r.redirect);
      u.searchParams.set("error", "access_denied");
      if (r.state) u.searchParams.set("state", r.state);
      return u.href;
    }
    db.prepare("DELETE FROM oauth_codes WHERE expires<?").run(Date.now());
    db.prepare("INSERT INTO oauth_codes VALUES(?,?,?,?,?,?,?)").run(
      hash(code),
      r.client.client_id,
      r.redirect,
      r.challenge,
      JSON.stringify(r.scopes),
      r.resource,
      Date.now() + 120000,
    );
    store.log(actor.id, "oauth.consent", r.client.client_id);
    const u = new URL(r.redirect);
    u.searchParams.set("code", code);
    if (r.state) u.searchParams.set("state", r.state);
    return u.href;
  }
  function exchange(input) {
    if (input.grant_type !== "authorization_code")
      fail("UNSUPPORTED_GRANT", "authorization_code requis.");
    const code = text(input.code, "code", 100),
      row = db
        .prepare("SELECT * FROM oauth_codes WHERE hash=?")
        .get(hash(code));
    const verifier = text(input.code_verifier, "code_verifier", 128, 43);
    if (
      !/^[A-Za-z0-9._~-]+$/.test(verifier) ||
      !row ||
      row.expires < Date.now() ||
      row.client !== input.client_id ||
      row.redirect !== input.redirect_uri ||
      row.resource !== (input.resource || origin() + "/mcp") ||
      row.challenge !==
        crypto.createHash("sha256").update(verifier).digest("base64url")
    )
      fail(
        "INVALID_GRANT",
        "Code expiré, audience ou preuve PKCE incorrecte.",
        400,
      );
    return store.transaction(() => {
      if (
        !db.prepare("DELETE FROM oauth_codes WHERE hash=?").run(hash(code))
          .changes
      )
        fail("INVALID_GRANT", "Code déjà utilisé.");
      const issued = auth.createToken(
        {
          label: "OAuth " + row.client,
          scopes: JSON.parse(row.scopes),
          days: 1,
        },
        "admin",
        row.client,
      );
      db.prepare("UPDATE tokens SET expires=? WHERE id=?").run(
        Date.now() + 3600000,
        issued.id,
      );
      return {
        access_token: issued.token,
        token_type: "Bearer",
        expires_in: 3600,
        scope: JSON.parse(row.scopes).join(" "),
      };
    });
  }
  return { register, request, consent, exchange };
}
module.exports = { createAuth, createOAuth, SCOPES };
