"use strict";
const crypto = require("node:crypto");
class AppError extends Error {
  constructor(code, message, status = 400) {
    super(message);
    this.code = code;
    this.status = status;
  }
}
const fail = (code, message, status) => {
  throw new AppError(code, message, status);
};
const token = () => crypto.randomBytes(32).toString("base64url");
const hash = (value) => crypto.createHash("sha256").update(value).digest("hex");
function equal(a, b) {
  const x = Buffer.from(String(a)),
    y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}
function text(value, name, max = 200, min = 1) {
  if (
    typeof value !== "string" ||
    value.trim().length < min ||
    value.length > max ||
    /\u0000/.test(value)
  )
    fail(
      "INVALID_ARGUMENT",
      name + " : texte de " + min + " à " + max + " caractères attendu.",
    );
  return value.trim();
}
function object(value, keys) {
  if (!value || typeof value !== "object" || Array.isArray(value))
    fail("INVALID_ARGUMENT", "Objet JSON attendu.");
  const bad = Object.keys(value).filter((k) => !keys.includes(k));
  if (bad.length)
    fail("INVALID_ARGUMENT", "Champs inconnus : " + bad.join(", "));
}
function int(value, name, min, max) {
  if (!Number.isSafeInteger(value) || value < min || value > max)
    fail(
      "INVALID_ARGUMENT",
      name + " : entier de " + min + " à " + max + " attendu.",
    );
  return value;
}
function repo(value) {
  const s = text(value, "Dépôt", 140);
  if (
    !/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})\/[A-Za-z0-9_.-]{1,100}$/.test(s) ||
    s.endsWith("/.") ||
    s.endsWith("/..")
  )
    fail("INVALID_ARGUMENT", "Format de dépôt attendu : propriétaire/nom.");
  return s;
}
function schemaCheck(value, schema, name = "arguments") {
  if (schema.type === "object") {
    object(value, Object.keys(schema.properties || {}));
    for (const k of schema.required || [])
      if (!Object.hasOwn(value, k))
        fail("INVALID_ARGUMENT", name + "." + k + " requis.");
    for (const [k, v] of Object.entries(value))
      schemaCheck(v, schema.properties[k], name + "." + k);
  } else if (schema.type === "array") {
    if (
      !Array.isArray(value) ||
      value.length < (schema.minItems || 0) ||
      value.length > (schema.maxItems || 1000)
    )
      fail("INVALID_ARGUMENT", name + " : liste invalide.");
    for (const v of value) schemaCheck(v, schema.items, name);
  } else if (schema.type === "string") {
    if (
      typeof value !== "string" ||
      value.length > (schema.maxLength || 1000000)
    )
      fail("INVALID_ARGUMENT", name + " : texte invalide.");
  } else if (schema.type === "integer")
    int(
      value,
      name,
      schema.minimum ?? -Number.MAX_SAFE_INTEGER,
      schema.maximum ?? Number.MAX_SAFE_INTEGER,
    );
  else if (schema.type === "boolean" && typeof value !== "boolean")
    fail("INVALID_ARGUMENT", name + " : booléen attendu.");
  if (schema.enum && !schema.enum.includes(value))
    fail("INVALID_ARGUMENT", name + " : valeur non admise.");
}
function redact(message, secrets = []) {
  let s = String(message || "Erreur").replace(
    /(?:gh[pousr]_[A-Za-z0-9_]+|github_pat_[A-Za-z0-9_]+|sk-[A-Za-z0-9_-]+)/g,
    "[secret]",
  );
  for (const secret of secrets.filter(
    (x) => typeof x === "string" && x.length > 5,
  ))
    s = s.split(secret).join("[secret]");
  return s.slice(0, 600);
}
async function jsonFetch(fetchImpl, url, options = {}, maxBytes = 2000000) {
  const response = await fetchImpl(url, { ...options, redirect: "error" });
  if (!response.ok)
    fail(
      "UPSTREAM_ERROR",
      "Service distant : HTTP " + response.status + ".",
      502,
    );
  if (Number(response.headers?.get?.("content-length") || 0) > maxBytes)
    fail("RESPONSE_TOO_LARGE", "Réponse distante trop volumineuse.", 502);
  if (!response.body?.getReader) return response.json();
  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  try {
    while (true) {
      const r = await reader.read();
      if (r.done) break;
      size += r.value.byteLength;
      if (size > maxBytes)
        fail("RESPONSE_TOO_LARGE", "Réponse distante trop volumineuse.", 502);
      chunks.push(Buffer.from(r.value));
    }
  } finally {
    await reader.cancel().catch(() => {});
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    fail("UPSTREAM_ERROR", "Réponse JSON distante invalide.", 502);
  }
}
const esc = (s) =>
  String(s ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
module.exports = {
  AppError,
  fail,
  token,
  hash,
  equal,
  text,
  object,
  int,
  repo,
  schemaCheck,
  redact,
  jsonFetch,
  esc,
};
