"use strict";
const { fail, object, text } = require("./util.cjs");
const DEFAULT_CATEGORIES = [
  { id: "research", name: "Recherche", color: "#d97757" },
  { id: "proposal", name: "Modification proposée", color: "#6a9bcc" },
  { id: "architecture", name: "Architecture", color: "#788c5d" },
  { id: "note", name: "Note", color: "#c2983a" },
  { id: "report", name: "Compte rendu", color: "#9b87c4" },
];
const PALETTE = DEFAULT_CATEGORIES.map(c => c.color).concat("#cc7a9a", "#4f9d98", "#b5754a");
const DEFAULT_SECURITY_CATEGORIES = [
  {id:"ecosysteme",name:"Écosystème Atlas",color:"#d97757"},
  {id:"apps",name:"Apps et outils",color:"#788c5d"},
  {id:"random",name:"Collection random",color:"#6a9bcc"},
];
function validateSecurityCategories(value) {
  const next=validateCategories(value);
  if(next.length!==3 || DEFAULT_SECURITY_CATEGORIES.some(c=>!next.find(n=>n.id===c.id)))fail("INVALID_ARGUMENT","Conservez les trois groupes du Security Center ; leurs noms sont personnalisables.");
  return next;
}
function validateCategories(value) {
  if (!Array.isArray(value) || value.length < 1 || value.length > 50)
    fail("INVALID_ARGUMENT", "Choisissez entre une et cinquante catégories.");
  const ids = new Set(), names = new Set();
  return value.map((c, i) => {
    object(c, ["id", "name", "color"]);
    const id = text(c.id, "Identifiant de catégorie", 80), name = text(c.name, "Nom de catégorie", 80);
    if (!/^[a-z0-9][a-z0-9_-]*$/.test(id)) fail("INVALID_ARGUMENT", "Identifiant de catégorie invalide.");
    const normalized = name.normalize("NFKC").replace(/\s+/g, " ").toLocaleLowerCase("fr");
    if (ids.has(id) || names.has(normalized)) fail("INVALID_ARGUMENT", "Chaque catégorie doit avoir un nom et un identifiant uniques.");
    ids.add(id); names.add(normalized);
    const color = c.color || PALETTE[i % PALETTE.length];
    if (!/^#[a-fA-F0-9]{6}$/.test(color)) fail("INVALID_ARGUMENT", "Couleur de catégorie invalide.");
    return { id, name, color };
  });
}
function categories(config) { return config.categories || structuredClone(DEFAULT_CATEGORIES); }
function resolveCategory(config, value) {
  const list = categories(config);
  if (!value) return list[0];
  const found = list.find(c => c.id === value || c.name === value);
  if (!found) fail("INVALID_ARGUMENT", "Catégorie inconnue. Choisissez une catégorie de cette instance.");
  return found;
}
module.exports = { DEFAULT_CATEGORIES, DEFAULT_SECURITY_CATEGORIES, validateCategories, validateSecurityCategories, categories, resolveCategory };
