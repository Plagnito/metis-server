// Adapted from Plagni/atlas 227e897b68fbbaf2d6436084526519bf28ededf8. AGPL-3.0-only.
module.exports = function nativeModule(require, module, __dirname) {
'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const logger = require('../core/logger');
let db = null; try { ({ db } = require('../core/db')); } catch { /* */ }

// =============================================================================
//  metisdocs — les publications de recherche Métis (plagnito.com/metis)
// -----------------------------------------------------------------------------
//  Demandé le 24/09/2026 : ChatGPT publie, par un MCP, des documents de recherche
//  ou des propositions de modification sur le système Métis ; Nolan les lit dans
//  son navigateur, Claude les récupère par le même MCP. Pages réservées au compte
//  Master et aux comptes qu'il autorise.
//
//  Élargi le 26/09/2026 : sections modifiables une à une, versions comparées et
//  restaurées, étiquettes, notes de relecture, glossaire COMMUN des sigles (chaque
//  sigle connu est expliqué dans tous les documents), et plans d'architecture
//  VERSIONNÉS (metis-plans/*.md, semés au démarrage).
//
//  ── QUI PEUT QUOI ────────────────────────────────────────────────────────────
//  • LIRE : Master, et les comptes inscrits dans `metis_acces`.
//  • ÉCRIRE (publier, modifier, archiver, définir un sigle, annoter, registre des
//    experts) : Master, et les comptes que Master nomme ÉDITEURS (role = 'editeur').
//    L'accès qu'on donne à quelqu'un pour lire n'est pas une plume : c'est un choix.
//  • GÉRER LES ACCÈS : Master SEUL — un éditeur ne se donne pas de pairs.
//  Tout autre compte ne voit RIEN, pas même que la page existe (404).
//
//  ── RIEN NE SE PERD ──────────────────────────────────────────────────────────
//  Chaque modification garde la version précédente (`metis_versions`), et il n'y a
//  pas de suppression définitive : « archiver » retire un document de la liste
//  sans l'effacer. Une modification doit annoncer la version qu'elle modifie
//  (`version_attendue`) : si quelqu'un est passé entre-temps, elle est refusée au
//  lieu d'écraser son travail sans un mot. Restaurer une ancienne version crée une
//  version NOUVELLE : l'historique ne se réécrit pas.
// =============================================================================

const CATEGORIES = ['Recherche', 'Modification proposée', 'Architecture', 'Note', 'Compte rendu'];
const STATUTS = ['publie', 'brouillon', 'archive'];
const LIMITES = { titre: 160, chapo: 600, corps: 400 * 1024, slug: 80, etiquettes: 8, etiquette: 30, note: 4000, fiche: 200 * 1024 };
// Ce qu'un terme du glossaire désigne : affiché sur sa page, filtrable dans le glossaire.
const NATURES = ['sigle', 'protocole', 'composant', 'concept', 'format', 'métrique', 'outil'];
const AUTEUR_GRAINE = 'Claude';
const ROLES_ACCES = ['lecteur', 'editeur'];
const REFUS_ECRITURE = 'Réservé aux comptes autorisés à modifier (Master ou éditeur).';
// Réglable pour les tests (un dossier vide = aucune graine).
const DOSSIER_PLANS = process.env.METIS_PLANS_DIR || path.join(__dirname, 'metis-plans');
let pret = false;
const maintenant = () => new Date().toISOString();
const sha = (s) => crypto.createHash('sha256').update(String(s)).digest('hex');

function colonnes(table) { return db.prepare('PRAGMA table_info(' + table + ')').all().map((c) => c.name); }

function init() {
  if (pret || !db) return;
  db.exec(`
    CREATE TABLE IF NOT EXISTS metis_docs (
      id        INTEGER PRIMARY KEY AUTOINCREMENT,
      slug      TEXT NOT NULL UNIQUE,
      titre     TEXT NOT NULL,
      chapo     TEXT NOT NULL DEFAULT '',
      categorie TEXT NOT NULL,
      corps     TEXT NOT NULL,
      auteur    TEXT NOT NULL,
      statut    TEXT NOT NULL,
      version   INTEGER NOT NULL DEFAULT 1,
      cree_le   TEXT NOT NULL,
      maj_le    TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS metis_versions (
      doc       INTEGER NOT NULL,
      version   INTEGER NOT NULL,
      titre     TEXT NOT NULL,
      chapo     TEXT NOT NULL,
      categorie TEXT NOT NULL,
      corps     TEXT NOT NULL,
      auteur    TEXT NOT NULL,
      le        TEXT NOT NULL,
      PRIMARY KEY (doc, version)
    );
    CREATE TABLE IF NOT EXISTS metis_graphiques (
      id      TEXT PRIMARY KEY,
      spec    TEXT NOT NULL,
      auteur  TEXT NOT NULL,
      cree_le TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS metis_acces (
      joueur      INTEGER PRIMARY KEY,
      accorde_par INTEGER,
      le          TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS metis_glossaire (
      sigle     TEXT PRIMARY KEY,
      sens      TEXT NOT NULL,
      detail    TEXT NOT NULL DEFAULT '',
      categorie TEXT NOT NULL DEFAULT '',
      source    TEXT NOT NULL,
      auteur    TEXT NOT NULL,
      maj_le    TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS metis_notes (
      id       INTEGER PRIMARY KEY AUTOINCREMENT,
      doc      INTEGER NOT NULL,
      auteur   TEXT NOT NULL,
      section  TEXT NOT NULL DEFAULT '',
      texte    TEXT NOT NULL,
      le       TEXT NOT NULL,
      resolue  INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS metis_graines (
      slug      TEXT PRIMARY KEY,
      empreinte TEXT NOT NULL,
      version   INTEGER NOT NULL
    );
  `);
  // Étiquettes : colonne ajoutée après coup. '[]' par défaut ne ment sur rien — un
  // document publié avant le 26/09 n'avait effectivement aucune étiquette.
  if (!colonnes('metis_docs').includes('etiquettes')) db.exec("ALTER TABLE metis_docs ADD COLUMN etiquettes TEXT NOT NULL DEFAULT '[]'");
  // Page détaillée d'un sigle (27/09/2026). Défauts VIDES qui ne mentent sur rien : aucune
  // page n'existait, et la nature d'un sigle (protocole, composant…) n'était pas connue —
  // un défaut « sigle » l'aurait affirmée pour tous, protocoles compris.
  const cg = colonnes('metis_glossaire');
  if (!cg.includes('corps')) db.exec("ALTER TABLE metis_glossaire ADD COLUMN corps TEXT NOT NULL DEFAULT ''");
  if (!cg.includes('version')) db.exec('ALTER TABLE metis_glossaire ADD COLUMN version INTEGER NOT NULL DEFAULT 0');
  if (!cg.includes('nature')) db.exec("ALTER TABLE metis_glossaire ADD COLUMN nature TEXT NOT NULL DEFAULT ''");
  // Rôle d'accès (26/09/2026). 'lecteur' par défaut ne ment sur rien : jusque-là, tout accès
  // accordé était un accès en lecture.
  if (!colonnes('metis_acces').includes('role')) db.exec("ALTER TABLE metis_acces ADD COLUMN role TEXT NOT NULL DEFAULT 'lecteur'");
  db.exec(`CREATE TABLE IF NOT EXISTS metis_glossaire_versions (
      sigle TEXT NOT NULL, version INTEGER NOT NULL, sens TEXT NOT NULL, detail TEXT NOT NULL, categorie TEXT NOT NULL,
      nature TEXT NOT NULL, corps TEXT NOT NULL, auteur TEXT NOT NULL, le TEXT NOT NULL, PRIMARY KEY (sigle, version))`);
  require('./metis-research-journal').install(db);
  pret = true;
  try { semer(); } catch (e) { logger.error('metis', 'graines : ' + (e.stack || e.message)); }
}

// ── Qui peut quoi ────────────────────────────────────────────────────────────

function compte(id) {
  try { return require('./players').getRow(Number(id)) || null; } catch { return null; }
}
function estMaster(id) {
  const acc = compte(id);
  try { return !!(acc && acc.active !== 0 && require('./players').isMaster(acc)); } catch { return false; }
}
function peutLire(id) {
  init();
  if (!id) return false;
  if (estMaster(id)) return true;
  const acc = compte(id);
  if (!acc || acc.active === 0) return false;
  return !!(db && db.prepare('SELECT 1 FROM metis_acces WHERE joueur = ?').get(Number(id)));
}
/**
 * Écrire (publier, modifier, sigles, registre des experts…) : Master, et les comptes que
 * Master a nommés ÉDITEURS (26/09/2026). Gérer les accès reste à Master seul : un éditeur
 * ne peut pas se donner des pairs.
 */
function peutEcrire(id) {
  init();
  if (!id) return false;
  if (estMaster(id)) return true;
  const acc = compte(id);
  if (!acc || acc.active === 0) return false;
  const r = db && db.prepare('SELECT role FROM metis_acces WHERE joueur = ?').get(Number(id));
  return !!(r && r.role === 'editeur');
}
/** 'master' | 'editeur' | 'lecteur' | null (aucun accès). */
function roleDe(id) {
  if (estMaster(id)) return 'master';
  if (!peutLire(id)) return null;
  return peutEcrire(id) ? 'editeur' : 'lecteur';
}

function accorder(par, pseudo, role = 'lecteur') {
  init();
  if (!estMaster(par)) return { ok: false, error: 'Réservé au compte Master.' };
  if (!ROLES_ACCES.includes(role)) return { ok: false, error: 'role doit valoir « lecteur » ou « editeur ».' };
  let cible = null;
  try { cible = require('./contacts').compteParPseudo(pseudo); } catch { /* */ }
  if (!cible) return { ok: false, error: 'Aucun compte actif ne porte ce pseudo.' };
  if (estMaster(cible.id)) return { ok: false, error: 'Master a déjà tous les droits.' };
  db.prepare('INSERT OR REPLACE INTO metis_acces (joueur, accorde_par, le, role) VALUES (?, ?, ?, ?)').run(cible.id, Number(par), maintenant(), role);
  return { ok: true, compte: cible, role };
}
function changerRole(par, joueur, role) {
  init();
  if (!estMaster(par)) return { ok: false, error: 'Réservé au compte Master.' };
  if (!ROLES_ACCES.includes(role)) return { ok: false, error: 'role doit valoir « lecteur » ou « editeur ».' };
  const r = db.prepare('UPDATE metis_acces SET role = ? WHERE joueur = ?').run(role, Number(joueur));
  return r.changes ? { ok: true, role } : { ok: false, error: 'Ce compte n’a pas d’accès.' };
}
function retirer(par, joueur) {
  init();
  if (!estMaster(par)) return { ok: false, error: 'Réservé au compte Master.' };
  db.prepare('DELETE FROM metis_acces WHERE joueur = ?').run(Number(joueur));
  // Un lecteur retiré ne garde pas ses jetons MCP : le MCP revérifie l'accès à chaque appel.
  return { ok: true };
}
function lecteurs() { return []; }

// ── Documents ────────────────────────────────────────────────────────────────

function slugDe(titre) {
  return String(titre || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'document';
}
const propre = (v, max) => String(v == null ? '' : v).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f‪-‮⁦-⁩]/g, '').trim().slice(0, max);
const plat = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
function etiquettesDe(r) { try { const v = JSON.parse(r.etiquettes || '[]'); return Array.isArray(v) ? v : []; } catch { return []; } }
function publique(r, avecCorps) {
  if (!r) return null;
  const o = { slug: r.slug, titre: r.titre, chapo: r.chapo, categorie: r.categorie, auteur: r.auteur, statut: r.statut,
    version: r.version, creeLe: r.cree_le, majLe: r.maj_le, etiquettes: etiquettesDe(r), url: 'https://plagnito.com/metis/' + r.slug };
  if (avecCorps) o.corps = r.corps;
  return o;
}
/** Étiquettes normalisées : au plus 8, sans doublon (casse et accents ignorés). */
function normaliserEtiquettes(v, e) {
  if (v === undefined) return undefined;
  const l = Array.isArray(v) ? v : typeof v === 'string' ? v.split(',') : null;
  if (!l) { e.push('etiquettes doit être une liste de mots-clés.'); return undefined; }
  const out = [], vus = new Set();
  for (const x of l) { const t = propre(x, LIMITES.etiquette); if (t && !vus.has(plat(t))) { vus.add(plat(t)); out.push(t); } }
  if (out.length > LIMITES.etiquettes) { e.push('Au plus ' + LIMITES.etiquettes + ' étiquettes.'); return undefined; }
  return out;
}

function verifierChamps(b, creation) {
  const e = [];
  if (creation || b.titre !== undefined) { if (!propre(b.titre, LIMITES.titre)) e.push('titre est obligatoire.'); }
  if (creation || b.corps !== undefined) {
    if (!propre(b.corps, LIMITES.corps)) e.push('corps (Markdown) est obligatoire.');
    else if (String(b.corps).length > LIMITES.corps) e.push('corps dépasse ' + Math.round(LIMITES.corps / 1024) + ' Ko.');
  }
  if (b.categorie !== undefined && !CATEGORIES.includes(b.categorie)) e.push('categorie doit valoir l’un de : ' + CATEGORIES.join(', ') + '.');
  if (b.statut !== undefined && !['publie', 'brouillon'].includes(b.statut)) e.push('statut doit valoir « publie » ou « brouillon » (archiver a son propre outil).');
  if (b.slug !== undefined && b.slug !== null && !/^[a-z0-9][a-z0-9-]{1,79}$/.test(String(b.slug))) e.push('slug : lettres minuscules, chiffres et tirets.');
  normaliserEtiquettes(b.etiquettes, e);
  // Les graphiques du corps sont validés AVANT publication : une erreur dit quoi corriger.
  if (b.corps !== undefined) for (const g of graphiquesDuCorps(String(b.corps))) if (g.erreurs) e.push('Graphique n° ' + g.n + ' : ' + g.erreurs.join(' '));
  return e;
}

function publier(auteurId, b, { auteur = 'ChatGPT', forcer = false } = {}) {
  init();
  if (!forcer && !peutEcrire(auteurId)) return { ok: false, error: 'Publier est réservé aux comptes autorisés à modifier (Master ou éditeur).' };
  b = b || {};
  const erreurs = verifierChamps(b, true);
  if (erreurs.length) return { ok: false, error: erreurs.join(' '), erreurs };
  let slug = b.slug ? String(b.slug) : slugDe(b.titre);
  const base = slug; let n = 2;
  while (db.prepare('SELECT 1 FROM metis_docs WHERE slug = ?').get(slug)) slug = (base + '-' + n++).slice(0, LIMITES.slug);
  const t = maintenant();
  const r = {
    slug, titre: propre(b.titre, LIMITES.titre), chapo: propre(b.chapo, LIMITES.chapo),
    categorie: CATEGORIES.includes(b.categorie) ? b.categorie : CATEGORIES[0], corps: String(b.corps),
    auteur: propre(auteur, 60) || 'ChatGPT', statut: b.statut === 'brouillon' ? 'brouillon' : 'publie',
    etiquettes: JSON.stringify(normaliserEtiquettes(b.etiquettes, []) || []),
  };
  const info = db.prepare(`INSERT INTO metis_docs (slug, titre, chapo, categorie, corps, auteur, statut, version, cree_le, maj_le, etiquettes)
    VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?)`).run(r.slug, r.titre, r.chapo, r.categorie, r.corps, r.auteur, r.statut, t, t, r.etiquettes);
  db.prepare('INSERT INTO metis_versions (doc, version, titre, chapo, categorie, corps, auteur, le) VALUES (?, 1, ?, ?, ?, ?, ?, ?)')
    .run(info.lastInsertRowid, r.titre, r.chapo, r.categorie, r.corps, r.auteur, t);
  logger.info('metis', `publié : « ${r.titre} » (${r.slug})`);
  return { ok: true, document: publique(db.prepare('SELECT * FROM metis_docs WHERE id = ?').get(info.lastInsertRowid)) };
}

function modifier(auteurId, slug, b, { auteur = 'ChatGPT', forcer = false } = {}) {
  init();
  if (!forcer && !peutEcrire(auteurId)) return { ok: false, error: 'Modifier est réservé aux comptes autorisés à modifier (Master ou éditeur).' };
  b = b || {};
  const r = db.prepare('SELECT * FROM metis_docs WHERE slug = ?').get(String(slug || ''));
  if (!r) return { ok: false, error: 'Document introuvable : ' + slug };
  if (!Number.isInteger(Number(b.version_attendue))) return { ok: false, error: 'version_attendue est obligatoire (lis le document pour la connaître).' };
  if (Number(b.version_attendue) !== r.version) {
    return { ok: false, conflit: true, versionEnLigne: r.version, error: 'Le document a changé entre-temps : version ' + r.version + ' en ligne, ' + b.version_attendue + ' attendue. Relis-le avant de le modifier.' };
  }
  const erreurs = verifierChamps(b, false);
  if (erreurs.length) return { ok: false, error: erreurs.join(' '), erreurs };
  const n = {
    titre: b.titre !== undefined ? propre(b.titre, LIMITES.titre) : r.titre,
    chapo: b.chapo !== undefined ? propre(b.chapo, LIMITES.chapo) : r.chapo,
    categorie: b.categorie !== undefined ? b.categorie : r.categorie,
    corps: b.corps !== undefined ? String(b.corps) : r.corps,
    statut: b.statut !== undefined ? b.statut : r.statut,
    auteur: propre(auteur, 60) || r.auteur,
    etiquettes: b.etiquettes !== undefined ? JSON.stringify(normaliserEtiquettes(b.etiquettes, [])) : r.etiquettes,
  };
  const t = maintenant(), v = r.version + 1;
  db.prepare('UPDATE metis_docs SET titre=?, chapo=?, categorie=?, corps=?, statut=?, auteur=?, version=?, maj_le=?, etiquettes=? WHERE id=?')
    .run(n.titre, n.chapo, n.categorie, n.corps, n.statut, n.auteur, v, t, n.etiquettes, r.id);
  db.prepare('INSERT INTO metis_versions (doc, version, titre, chapo, categorie, corps, auteur, le) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    .run(r.id, v, n.titre, n.chapo, n.categorie, n.corps, n.auteur, t);
  return { ok: true, document: publique(db.prepare('SELECT * FROM metis_docs WHERE id = ?').get(r.id)) };
}

function archiver(auteurId, slug) {
  init();
  if (!peutEcrire(auteurId)) return { ok: false, error: 'Archiver est réservé aux comptes autorisés à modifier (Master ou éditeur).' };
  const r = db.prepare('SELECT * FROM metis_docs WHERE slug = ?').get(String(slug || ''));
  if (!r) return { ok: false, error: 'Document introuvable : ' + slug };
  db.prepare("UPDATE metis_docs SET statut='archive', maj_le=? WHERE id=?").run(maintenant(), r.id);
  return { ok: true, slug: r.slug };
}
function desarchiver(auteurId, slug) {
  init();
  if (!peutEcrire(auteurId)) return { ok: false, error: REFUS_ECRITURE };
  const r = db.prepare('SELECT * FROM metis_docs WHERE slug = ?').get(String(slug || ''));
  if (!r) return { ok: false, error: 'Document introuvable : ' + slug };
  if (r.statut !== 'archive') return { ok: false, error: 'Ce document n’est pas archivé (statut : ' + r.statut + ').' };
  db.prepare("UPDATE metis_docs SET statut='publie', maj_le=? WHERE id=?").run(maintenant(), r.id);
  return { ok: true, document: publique(db.prepare('SELECT * FROM metis_docs WHERE id = ?').get(r.id)) };
}

function lire(lecteurId, slug, { version } = {}) {
  init();
  if (!peutLire(lecteurId)) return null;
  const r = db.prepare('SELECT * FROM metis_docs WHERE slug = ?').get(String(slug || ''));
  if (!r) return null;
  // Un brouillon ou un document archivé ne se lit que par qui peut écrire.
  if (r.statut !== 'publie' && !peutEcrire(lecteurId)) return null;
  const doc = publique(r, true);
  if (version && Number(version) !== r.version) {
    const v = db.prepare('SELECT * FROM metis_versions WHERE doc = ? AND version = ?').get(r.id, Number(version));
    if (!v) return null;
    Object.assign(doc, { titre: v.titre, chapo: v.chapo, categorie: v.categorie, corps: v.corps, auteur: v.auteur, version: v.version, majLe: v.le, ancienne: true });
  }
  doc.versions = db.prepare('SELECT version, auteur, le FROM metis_versions WHERE doc = ? ORDER BY version DESC').all(r.id);
  return doc;
}

function lister(lecteurId, { categorie, statut, recherche, etiquette } = {}) {
  init();
  if (!peutLire(lecteurId)) return null;
  const ecrivain = peutEcrire(lecteurId);
  let l = db.prepare('SELECT * FROM metis_docs ORDER BY maj_le DESC').all();
  l = l.filter((r) => (statut ? r.statut === statut : r.statut === 'publie' || (ecrivain && r.statut === 'brouillon')));
  if (!ecrivain) l = l.filter((r) => r.statut === 'publie');
  if (categorie) l = l.filter((r) => r.categorie === categorie);
  if (etiquette) l = l.filter((r) => etiquettesDe(r).some((t) => plat(t) === plat(etiquette)));
  if (recherche) {
    const mots = plat(recherche).split(/\s+/).filter(Boolean);
    l = l.filter((r) => { const t = plat(r.titre + ' ' + r.chapo + ' ' + r.corps + ' ' + etiquettesDe(r).join(' ')); return mots.every((m) => t.includes(m)); });
  }
  return l.map((r) => publique(r));
}

/** Toutes les étiquettes employées, avec leur nombre de documents visibles. */
function etiquettes(lecteurId) {
  const l = lister(lecteurId) || [];
  const m = new Map();
  for (const d of l) for (const t of d.etiquettes) m.set(t, (m.get(t) || 0) + 1);
  return [...m].sort((a, b) => b[1] - a[1]).map(([nom, n]) => ({ nom, documents: n }));
}

// ── Sections : lire ou réécrire une partie sans renvoyer tout le document ─────

/** Les titres d'un Markdown (hors blocs de code), avec la plage de lignes de chaque section. */
function sections(md) {
  const lignes = String(md || '').replace(/\r\n/g, '\n').split('\n');
  const out = [];
  let bloc = false;
  lignes.forEach((l, i) => {
    if (/^\s*```/.test(l)) { bloc = !bloc; return; }
    if (bloc) return;
    const m = /^(#{1,6})\s+(.+?)\s*#*\s*$/.exec(l);
    if (m) out.push({ niveau: m[1].length, titre: m[2].trim(), ligne: i });
  });
  out.forEach((s, k) => { const suite = out.slice(k + 1).find((t) => t.niveau <= s.niveau); s.fin = suite ? suite.ligne : lignes.length; });
  return { lignes, sections: out };
}
function trouverSection(liste, cle) {
  if (Number.isInteger(cle)) return liste[cle - 1] ? { s: liste[cle - 1] } : { error: 'Il n’y a pas de section n° ' + cle + ' (le document en a ' + liste.length + ').' };
  const c = plat(cle).replace(/[^a-z0-9]+/g, ' ').trim();
  const norm = (t) => plat(t).replace(/[^a-z0-9]+/g, ' ').trim();
  let r = liste.filter((s) => norm(s.titre) === c);
  if (!r.length) r = liste.filter((s) => norm(s.titre).includes(c));
  const noms = liste.map((s, i) => (i + 1) + '. ' + '#'.repeat(s.niveau) + ' ' + s.titre).join(' | ');
  if (!r.length) return { error: 'Aucune section ne s’appelle « ' + cle + ' ». Sections : ' + (noms || 'aucune (le document n’a pas de titre ##)') + '.' };
  if (r.length > 1) return { error: 'Plusieurs sections correspondent à « ' + cle + ' » : ' + r.map((s) => s.titre).join(', ') + '. Donne le titre exact ou son numéro.' };
  return { s: r[0] };
}
function sommaire(lecteurId, slug) {
  const d = lire(lecteurId, slug);
  if (!d) return null;
  const { lignes, sections: l } = sections(d.corps);
  return { slug: d.slug, titre: d.titre, version: d.version, sections: l.map((s, i) => ({ n: i + 1, niveau: s.niveau, titre: s.titre, lignes: s.fin - s.ligne, caracteres: lignes.slice(s.ligne, s.fin).join('\n').length })) };
}
function lireSection(lecteurId, slug, cle) {
  const d = lire(lecteurId, slug);
  if (!d) return { ok: false, error: 'Document introuvable : ' + slug };
  const { lignes, sections: l } = sections(d.corps);
  const t = trouverSection(l, cle);
  if (t.error) return { ok: false, error: t.error };
  return { ok: true, slug: d.slug, version: d.version, section: t.s.titre, niveau: t.s.niveau, texte: lignes.slice(t.s.ligne, t.s.fin).join('\n') };
}
const MODES_SECTION = ['remplacer', 'ajouter_a_la_fin', 'inserer_apres', 'inserer_avant', 'supprimer', 'ajouter_fin_document'];
/**
 * Réécrit une section. `remplacer` remplace le contenu SOUS le titre (le titre reste,
 * sauf `nouveau_titre`) ; `ajouter_a_la_fin` complète la section ; `inserer_apres` /
 * `inserer_avant` posent un bloc (avec son propre titre) autour d'elle ; `supprimer`
 * l'enlève ; `ajouter_fin_document` n'a pas besoin de section.
 */
function modifierSection(auteurId, slug, b, opts) {
  init();
  if (!peutEcrire(auteurId)) return { ok: false, error: 'Modifier est réservé aux comptes autorisés à modifier (Master ou éditeur).' };
  b = b || {};
  const r = db.prepare('SELECT * FROM metis_docs WHERE slug = ?').get(String(slug || ''));
  if (!r) return { ok: false, error: 'Document introuvable : ' + slug };
  const x = appliquerSection(r.corps, b);
  if (!x.ok) return x;
  return modifier(auteurId, slug, { version_attendue: b.version_attendue, corps: x.corps }, opts);
}
/** Applique une opération de section (voir modifierSection) à un Markdown. Rend { ok, corps }. */
function appliquerSection(corpsActuel, b) {
  const mode = b.mode || 'remplacer';
  if (!MODES_SECTION.includes(mode)) return { ok: false, error: 'mode doit valoir l’un de : ' + MODES_SECTION.join(', ') + '.' };
  const texte = String(b.corps == null ? '' : b.corps).replace(/\r\n/g, '\n').replace(/\n+$/, '');
  if (mode !== 'supprimer' && !texte.trim() && !b.nouveau_titre) return { ok: false, error: 'corps (le Markdown à écrire) est obligatoire pour ce mode.' };
  const { lignes, sections: l } = sections(corpsActuel);
  let nouveau;
  if (mode === 'ajouter_fin_document') nouveau = lignes.join('\n').replace(/\n+$/, '') + '\n\n' + texte + '\n';
  else {
    const t = trouverSection(l, b.section);
    if (t.error) return { ok: false, error: t.error };
    const s = t.s, avant = lignes.slice(0, s.ligne), tete = lignes[s.ligne], dedans = lignes.slice(s.ligne + 1, s.fin), apres = lignes.slice(s.fin);
    const titre = b.nouveau_titre ? '#'.repeat(s.niveau) + ' ' + propre(b.nouveau_titre, 160) : tete;
    const bloc = (x) => ['', ...x.split('\n'), ''];
    if (mode === 'remplacer') nouveau = [...avant, titre, ...(texte ? bloc(texte) : ['']), ...apres];
    else if (mode === 'ajouter_a_la_fin') nouveau = [...avant, titre, ...dedans.join('\n').replace(/\n+$/, '').split('\n'), ...bloc(texte), ...apres];
    else if (mode === 'inserer_apres') nouveau = [...avant, titre, ...dedans, ...bloc(texte), ...apres];
    else if (mode === 'inserer_avant') nouveau = [...avant, ...bloc(texte), tete, ...dedans, ...apres];
    else nouveau = [...avant, ...apres];
    nouveau = nouveau.join('\n').replace(/\n{3,}/g, '\n\n');
  }
  return { ok: true, corps: nouveau };
}

// ── Versions : comparer, restaurer, dupliquer ─────────────────────────────────

/** Différence ligne à ligne (plus longue sous-suite commune), en blocs avec contexte. */
function difference(a, b, contexte = 2) {
  const A = String(a).split('\n'), B = String(b).split('\n');
  let debut = 0; while (debut < A.length && debut < B.length && A[debut] === B[debut]) debut++;
  let fa = A.length, fb = B.length; while (fa > debut && fb > debut && A[fa - 1] === B[fb - 1]) { fa--; fb--; }
  const a2 = A.slice(debut, fa), b2 = B.slice(debut, fb);
  const ops = [];
  if (a2.length * b2.length <= 4e6) {
    const n = a2.length, m = b2.length, T = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
    for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) T[i][j] = a2[i] === b2[j] ? T[i + 1][j + 1] + 1 : Math.max(T[i + 1][j], T[i][j + 1]);
    let i = 0, j = 0;
    while (i < n && j < m) { if (a2[i] === b2[j]) { ops.push([' ', a2[i]]); i++; j++; } else if (T[i + 1][j] >= T[i][j + 1]) ops.push(['-', a2[i++]]); else ops.push(['+', b2[j++]]); }
    while (i < n) ops.push(['-', a2[i++]]); while (j < m) ops.push(['+', b2[j++]]);
  } else { a2.forEach((x) => ops.push(['-', x])); b2.forEach((x) => ops.push(['+', x])); }
  const tout = A.slice(0, debut).map((x) => [' ', x]).concat(ops, A.slice(fa).map((x) => [' ', x]));
  // Blocs : les lignes changées et `contexte` lignes autour.
  const garder = new Array(tout.length).fill(false);
  tout.forEach((o, k) => { if (o[0] !== ' ') for (let d = -contexte; d <= contexte; d++) if (tout[k + d]) garder[k + d] = true; });
  const blocs = []; let cur = null, la = 0, lb = 0;
  tout.forEach((o, k) => {
    if (garder[k]) { if (!cur) { cur = { ligneAvant: la + 1, ligneApres: lb + 1, lignes: [] }; blocs.push(cur); } cur.lignes.push(o[0] + ' ' + o[1]); } else cur = null;
    if (o[0] !== '+') la++; if (o[0] !== '-') lb++;
  });
  return { ajoutees: tout.filter((o) => o[0] === '+').length, retirees: tout.filter((o) => o[0] === '-').length, blocs };
}
function comparer(lecteurId, slug, de, a) {
  const d = lire(lecteurId, slug);
  if (!d) return { ok: false, error: 'Document introuvable : ' + slug };
  const va = Number(de), vb = a == null ? d.version : Number(a);
  const x = lire(lecteurId, slug, { version: va }), y = lire(lecteurId, slug, { version: vb });
  if (!x || !y) return { ok: false, error: 'Version inconnue. Versions : ' + d.versions.map((v) => v.version).join(', ') + '.' };
  const champs = {};
  for (const k of ['titre', 'chapo', 'categorie']) if (x[k] !== y[k]) champs[k] = { avant: x[k], apres: y[k] };
  const diff = difference(x.corps, y.corps);
  const total = diff.blocs.reduce((s, b) => s + b.lignes.length, 0);
  if (total > 1500) { diff.blocs = diff.blocs.slice(0, 40); diff.tronque = true; }
  return { ok: true, slug: d.slug, de: va, a: vb, champs, ...diff };
}
function restaurerVersion(auteurId, slug, b, opts) {
  init();
  if (!peutEcrire(auteurId)) return { ok: false, error: REFUS_ECRITURE };
  const r = db.prepare('SELECT * FROM metis_docs WHERE slug = ?').get(String(slug || ''));
  if (!r) return { ok: false, error: 'Document introuvable : ' + slug };
  const v = db.prepare('SELECT * FROM metis_versions WHERE doc = ? AND version = ?').get(r.id, Number(b && b.version));
  if (!v) return { ok: false, error: 'Version inconnue : ' + (b && b.version) + '.' };
  return modifier(auteurId, slug, { version_attendue: b.version_attendue, titre: v.titre, chapo: v.chapo, categorie: v.categorie, corps: v.corps }, opts);
}
function dupliquer(auteurId, slug, b, opts) {
  init();
  if (!peutEcrire(auteurId)) return { ok: false, error: REFUS_ECRITURE };
  const d = lire(auteurId, slug);
  if (!d) return { ok: false, error: 'Document introuvable : ' + slug };
  return publier(auteurId, { titre: (b && b.titre) || d.titre + ' (copie)', chapo: d.chapo, categorie: d.categorie, corps: d.corps, etiquettes: d.etiquettes, statut: 'brouillon' }, opts);
}

// ── Notes de relecture ────────────────────────────────────────────────────────

function commenter(auteurId, slug, b, { auteur = 'ChatGPT' } = {}) {
  init();
  if (!peutEcrire(auteurId)) return { ok: false, error: 'Annoter est réservé aux comptes autorisés à modifier (Master ou éditeur).' };
  const r = db.prepare('SELECT * FROM metis_docs WHERE slug = ?').get(String(slug || ''));
  if (!r) return { ok: false, error: 'Document introuvable : ' + slug };
  const texte = propre(b && b.texte, LIMITES.note);
  if (!texte) return { ok: false, error: 'texte (la note) est obligatoire.' };
  const info = db.prepare('INSERT INTO metis_notes (doc, auteur, section, texte, le) VALUES (?, ?, ?, ?, ?)').run(r.id, propre(auteur, 60) || 'ChatGPT', propre(b.section, 160), texte, maintenant());
  return { ok: true, note: { id: Number(info.lastInsertRowid), section: propre(b.section, 160), texte } };
}
function notes(lecteurId, slug, { toutes = false } = {}) {
  const d = lire(lecteurId, slug);
  if (!d) return null;
  const r = db.prepare('SELECT id FROM metis_docs WHERE slug = ?').get(d.slug);
  return db.prepare('SELECT id, auteur, section, texte, le, resolue FROM metis_notes WHERE doc = ?' + (toutes ? '' : ' AND resolue = 0') + ' ORDER BY id').all(r.id).map((n) => ({ ...n, resolue: !!n.resolue }));
}
function resoudre(auteurId, id) {
  init();
  if (!peutEcrire(auteurId)) return { ok: false, error: REFUS_ECRITURE };
  const r = db.prepare('UPDATE metis_notes SET resolue = 1 WHERE id = ?').run(Number(id));
  return r.changes ? { ok: true, id: Number(id) } : { ok: false, error: 'Note introuvable : ' + id };
}

// ── Glossaire commun des sigles ───────────────────────────────────────────────
//  Un sigle défini ici est expliqué PARTOUT : première occurrence de chaque document
//  soulignée d'une infobulle, liste « Sigles employés » en fin de document, légende
//  des schémas. Les définitions semées (metis-plans/glossaire.json) suivent le dépôt
//  tant que personne ne les a réécrites.

// Le souligné est permis : « Q8_0 » (format de quantification) était refusé EN SILENCE à la
// graine — definirSigle rendait une erreur que semer() ne lit pas.
const SIGLE_RE = /^[\p{L}\p{N}][\p{L}\p{N}._+/&Ω-]{0,23}$/u;
let carteSigles = null;
function carte() {
  init();
  if (!carteSigles) carteSigles = new Map(db.prepare("SELECT sigle, sens, detail, categorie, nature, version, corps != '' AS fiche, auteur, maj_le AS majLe FROM metis_glossaire").all().map((g) => [g.sigle, { ...g, fiche: !!g.fiche }]));
  return carteSigles;
}
function sigle(s) { return carte().get(String(s)) || null; }
function glossaire(lecteurId, { recherche, categorie, nature } = {}) {
  if (!peutLire(lecteurId)) return null;
  let l = [...carte().values()];
  if (categorie) l = l.filter((g) => plat(g.categorie) === plat(categorie));
  if (nature) l = l.filter((g) => plat(g.nature) === plat(nature));
  if (recherche) {
    const q = plat(recherche);
    // La page détaillée compte aussi : un protocole se retrouve par ce qu'elle en dit.
    const pages = new Set(db.prepare("SELECT sigle, corps FROM metis_glossaire WHERE corps != ''").all().filter((x) => plat(x.corps).includes(q)).map((x) => x.sigle));
    l = l.filter((g) => pages.has(g.sigle) || plat(g.sigle + ' ' + g.sens + ' ' + g.detail + ' ' + (g.nature || '')).includes(q));
  }
  return l.sort((a, b) => a.sigle.localeCompare(b.sigle, 'fr', { sensitivity: 'base' }));
}
function definirSigle(auteurId, b, { auteur = 'ChatGPT', source = 'chatgpt' } = {}) {
  init();
  if (source !== 'graine' && !peutEcrire(auteurId)) return { ok: false, error: REFUS_ECRITURE };
  b = b || {};
  const s = propre(b.sigle, 24), sens = propre(b.sens, 160);
  if (!SIGLE_RE.test(s)) return { ok: false, error: 'sigle : lettres et chiffres (1 à 24 caractères, sans espace), reçu ' + JSON.stringify(b.sigle) + '.' };
  if (!sens) return { ok: false, error: 'sens (la forme développée du sigle) est obligatoire.' };
  const ancien = sigle(s);
  db.prepare(`INSERT INTO metis_glossaire (sigle, sens, detail, categorie, source, auteur, maj_le) VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(sigle) DO UPDATE SET sens=excluded.sens, detail=excluded.detail, categorie=excluded.categorie, source=excluded.source, auteur=excluded.auteur, maj_le=excluded.maj_le`)
    // Un champ non fourni garde sa valeur : corriger le sens n'efface pas l'explication.
    .run(s, sens, b.detail !== undefined ? propre(b.detail, 800) : ancien ? ancien.detail : '', b.categorie !== undefined ? propre(b.categorie, 40) : ancien ? ancien.categorie : '', source, propre(auteur, 60), maintenant());
  carteSigles = null;
  return { ok: true, sigle: s, cree: !ancien };
}
function retirerSigle(auteurId, s) {
  init();
  if (!peutEcrire(auteurId)) return { ok: false, error: REFUS_ECRITURE };
  const r = db.prepare('DELETE FROM metis_glossaire WHERE sigle = ?').run(String(s || ''));
  carteSigles = null;
  return r.changes ? { ok: true } : { ok: false, error: 'Sigle inconnu : ' + s };
}

// ── La page détaillée d'un sigle ou d'un protocole ────────────────────────────
//  Demandé le 27/09/2026 : que ChatGPT puisse rédiger, pour chaque sigle, la page qui
//  explique comment il fonctionne — texte, tableaux, schémas, graphiques. Même Markdown
//  et mêmes blocs ```graphique que les documents, mêmes garanties : chaque version est
//  gardée (retirer le sigle n'efface pas son historique), et une écriture annonce la
//  version qu'elle modifie (`version_attendue`) au lieu d'écraser un travail passé entre-temps.

const urlSigle = (s) => 'https://plagnito.com/metis/glossaire/' + encodeURIComponent(s);
const derniereVersion = (s) => (db.prepare('SELECT MAX(version) v FROM metis_glossaire_versions WHERE sigle = ?').get(String(s)).v || 0);

/** La page d'un sigle : définition, nature, corps Markdown, version, historique. null sans accès. */
function lireFiche(lecteurId, s, { version } = {}) {
  init();
  if (!peutLire(lecteurId)) return null;
  const r = db.prepare('SELECT * FROM metis_glossaire WHERE sigle = ?').get(String(s || ''));
  if (!r) return { ok: false, error: 'Sigle inconnu : ' + s + '. glossaire donne la liste ; rediger_fiche le crée (avec sens).' };
  const f = { ok: true, sigle: r.sigle, sens: r.sens, detail: r.detail, categorie: r.categorie, nature: r.nature, corps: r.corps, version: r.version, auteur: r.auteur, majLe: r.maj_le, url: urlSigle(r.sigle) };
  if (version && Number(version) !== r.version) {
    const v = db.prepare('SELECT * FROM metis_glossaire_versions WHERE sigle = ? AND version = ?').get(r.sigle, Number(version));
    if (!v) return { ok: false, error: 'Version inconnue : ' + version + '.' };
    Object.assign(f, { sens: v.sens, detail: v.detail, categorie: v.categorie, nature: v.nature, corps: v.corps, version: v.version, auteur: v.auteur, majLe: v.le, ancienne: true });
  }
  f.versions = db.prepare('SELECT version, auteur, le FROM metis_glossaire_versions WHERE sigle = ? ORDER BY version DESC').all(r.sigle);
  f.sections = sections(f.corps).sections.map((x, i) => ({ n: i + 1, niveau: x.niveau, titre: x.titre }));
  return f;
}

/**
 * Rédige (ou crée) la page d'un sigle. b : { sigle, sens?, detail?, categorie?, nature?,
 * corps? (page entière) | section + mode (une partie, comme modifier_section),
 * version_attendue (dès que la page a une version) }. Un sigle absent est créé : sens requis.
 */
function redigerFiche(auteurId, b, { auteur = 'ChatGPT', silencieux = false } = {}) {
  init();
  if (!peutEcrire(auteurId)) return { ok: false, error: REFUS_ECRITURE };
  b = b || {};
  const s = propre(b.sigle, 24);
  if (!SIGLE_RE.test(s)) return { ok: false, error: 'sigle : lettres, chiffres, . _ + / & - (1 à 24 caractères, sans espace), reçu ' + JSON.stringify(b.sigle) + '.' };
  let r = db.prepare('SELECT * FROM metis_glossaire WHERE sigle = ?').get(s);
  const e = [];
  if (!r && !propre(b.sens, 160)) e.push('Sigle inconnu : sens (la forme développée) est obligatoire pour le créer.');
  if (b.nature !== undefined && b.nature !== '' && !NATURES.includes(b.nature)) e.push('nature doit valoir l’un de : ' + NATURES.join(', ') + '.');
  if (r && r.version > 0) {
    if (!Number.isInteger(Number(b.version_attendue)) || b.version_attendue === null || b.version_attendue === '') e.push('version_attendue est obligatoire (lire_fiche la donne : version ' + r.version + ').');
    else if (Number(b.version_attendue) !== r.version) return { ok: false, conflit: true, versionEnLigne: r.version, error: 'La page a changé entre-temps : version ' + r.version + ' en ligne, ' + b.version_attendue + ' attendue. Relis-la avec lire_fiche avant de la modifier.' };
  }
  let corps = r ? r.corps : '';
  if (b.section !== undefined || b.mode) {
    if (!corps && b.mode !== 'ajouter_fin_document') e.push('La page est vide : écris-la entière avec corps (sans section ni mode).');
    else if (!e.length) { const x = appliquerSection(corps, b); if (!x.ok) e.push(x.error); else corps = x.corps; }
  } else if (b.corps !== undefined) corps = String(b.corps).replace(/\r\n/g, '\n');
  if (corps.length > LIMITES.fiche) e.push('La page dépasse ' + Math.round(LIMITES.fiche / 1024) + ' Ko.');
  for (const g of graphiquesDuCorps(corps)) if (g.erreurs) e.push('Graphique n° ' + g.n + ' : ' + g.erreurs.join(' '));
  if (e.length) return { ok: false, error: e.join(' '), erreurs: e };

  const t = maintenant(), qui = propre(auteur, 60) || 'ChatGPT';
  const n = {
    sens: b.sens !== undefined && propre(b.sens, 160) ? propre(b.sens, 160) : r ? r.sens : '',
    detail: b.detail !== undefined ? propre(b.detail, 800) : r ? r.detail : '',
    categorie: b.categorie !== undefined ? propre(b.categorie, 40) : r ? r.categorie : '',
    nature: b.nature !== undefined ? String(b.nature || '') : r ? r.nature : '',
  };
  // Après un retrait puis une recréation, la numérotation reprend après l'historique gardé.
  const v = Math.max(r ? r.version : 0, derniereVersion(s)) + 1;
  // Une définition réécrite ici n'est plus celle de la graine : semer() n'y touchera plus.
  const definitionChangee = !r || n.sens !== r.sens || n.detail !== r.detail || n.categorie !== r.categorie;
  if (!r) db.prepare('INSERT INTO metis_glossaire (sigle, sens, detail, categorie, source, auteur, maj_le, corps, version, nature) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run(s, n.sens, n.detail, n.categorie, 'chatgpt', qui, t, corps, v, n.nature);
  else db.prepare('UPDATE metis_glossaire SET sens=?, detail=?, categorie=?, nature=?, corps=?, version=?, auteur=?, maj_le=?' + (definitionChangee ? ", source='chatgpt'" : '') + ' WHERE sigle=?').run(n.sens, n.detail, n.categorie, n.nature, corps, v, qui, t, s);
  db.prepare('INSERT INTO metis_glossaire_versions (sigle, version, sens, detail, categorie, nature, corps, auteur, le) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)').run(s, v, n.sens, n.detail, n.categorie, n.nature, corps, qui, t);
  carteSigles = null;
  if (!silencieux) logger.info('metis', 'page du sigle ' + s + ' : version ' + v);
  return { ok: true, sigle: s, cree: !r, version: v, url: urlSigle(s), sections: sections(corps).sections.map((x) => x.titre), graphiques: graphiquesDuCorps(corps).length };
}

const PROTEGES = new Set(['code', 'pre', 'a', 'abbr', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'svg', 'script', 'style', 'dt']);
/**
 * Pose une infobulle <abbr> sur la PREMIÈRE occurrence de chaque sigle connu, hors
 * code, liens et titres. Rend { html, trouves } — `trouves` : les sigles présents.
 * opts.lien(sigle) → adresse : la première occurrence devient un lien vers la fiche
 * du sigle, avec une bulle de définition (CSS seul, sans JavaScript).
 * opts.sauf : un sigle à ne pas annoter (la fiche d'un sigle ne se cite pas elle-même).
 */
function annoterSigles(html, table, opts = {}) {
  const cles = [...table.keys()].filter(Boolean).sort((a, b) => b.length - a.length);
  if (!cles.length) return { html, trouves: [] };
  const re = new RegExp('(?<![\\p{L}\\p{N}_-])(' + cles.map((c) => c.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')).join('|') + ')(?![\\p{L}\\p{N}_])', 'gu');
  const trouves = new Set(), poses = new Set();
  const pile = [];
  const out = String(html).split(/(<[^>]+>)/g).map((morceau) => {
    if (morceau.startsWith('<')) {
      const m = /^<\/?([a-z0-9]+)/i.exec(morceau);
      if (m) { const t = m[1].toLowerCase(); if (PROTEGES.has(t) && !/\/>$/.test(morceau)) { if (morceau[1] === '/') { const k = pile.lastIndexOf(t); if (k > -1) pile.splice(k, 1); } else pile.push(t); } }
      return morceau;
    }
    return morceau.replace(re, (s) => {
      if (s === opts.sauf) return s;
      trouves.add(s);
      if (pile.length || poses.has(s)) return s;
      poses.add(s);
      const g = table.get(s);
      if (opts.lien) {
        return '<a class="sigle" href="' + escAttr(opts.lien(s)) + '" aria-label="' + escAttr(s + ' : ' + g.sens + ' (fiche du glossaire)') + '"><abbr class="sigle">' + s + '</abbr>'
          + '<span class="bulle" aria-hidden="true"><b>' + s + '</b><span>' + escAttr(g.sens) + '</span>' + (g.detail ? '<small>' + escAttr(g.detail.length > 220 ? g.detail.slice(0, 217) + '…' : g.detail) + '</small>' : '') + '<em>Ouvrir la fiche →</em></span></a>';
      }
      return '<abbr class="sigle" title="' + escAttr(g.sens + (g.detail ? ' — ' + g.detail : '')) + '">' + s + '</abbr>';
    });
  }).join('');
  return { html: out, trouves: [...trouves] };
}
const escAttr = (s) => String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// ── Où chaque sigle est employé ───────────────────────────────────────────────
//  La fiche d'un sigle (/metis/glossaire/<sigle>) montre les documents qui l'emploient,
//  avec les passages et la section où ils se trouvent. Mêmes frontières de mot que
//  l'annotation : « RL » ne se compte pas dans « RLVR ». Les blocs de code ne comptent
//  pas ; un bloc graphique, lui, est une figure affichée : il compte comme « figure ».

const echRe = (s) => String(s).replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
const reSigles = (cles) => new RegExp('(?<![\\p{L}\\p{N}_-])(' + cles.map(echRe).join('|') + ')(?![\\p{L}\\p{N}_])', 'gu');
/** Une ligne de Markdown réduite à son texte lisible (pour un extrait). */
function texteLigne(l) {
  return String(l).replace(/^\s{0,3}(#{1,6}|>|[-*+]|\d+[.)])\s+/, '').replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\*\*|__|`/g, '').replace(/(^|\s)[*_]([^*_]+)[*_]/g, '$1$2').replace(/\s*\|\s*/g, ' · ').replace(/^[\s·]+|[\s·]+$/g, '').replace(/\s+/g, ' ');
}
/**
 * Découpe un corps en morceaux comptables : { texte, section: { titre, ancre }, figure }.
 * Les ancres suivent exactement celles de docu.rendre (titres ## à ####, numérotées si répétées).
 */
function morceaux(md) {
  const docu = require('./docu');
  const vues = new Set();
  const unique = (t) => { let a = docu.ancre(t); let n = 2; while (vues.has(a)) a = docu.ancre(t) + '-' + (n++); vues.add(a); return a; };
  const out = [];
  let section = null, bloc = null, figure = 0;
  for (const l of String(md || '').replace(/\r\n/g, '\n').split('\n')) {
    if (/^```/.test(l)) {
      if (bloc === null) { bloc = /^```graphique/.test(l) ? 'g' : 'c'; if (bloc === 'g') figure++; } else bloc = null;
      continue;
    }
    if (bloc === 'c') continue;
    if (bloc === 'g') { out.push({ texte: l, section, figure, dansFigure: true }); continue; }
    if (/\{\{graphique:[a-f0-9]{16}\}\}/.test(l)) figure++;
    const mt = /^(#{2,4})\s+(.*)$/.exec(l);
    if (mt) { section = { titre: texteLigne(mt[2]), ancre: unique(mt[2].trim()) }; out.push({ texte: mt[2], section, titre: true }); continue; }
    if (l.trim()) out.push({ texte: l, section });
  }
  return out;
}
/** Un extrait centré sur la première occurrence, le sigle entouré de \u0001…\u0002 (à surligner). */
function extrait(texte, re, largeur = 110) {
  re.lastIndex = 0;
  const m = re.exec(texte);
  if (!m) return null;
  let a = Math.max(0, m.index - largeur), b = Math.min(texte.length, m.index + m[0].length + largeur);
  if (a > 0) { const e = texte.lastIndexOf(' ', m.index - largeur + 20); if (e > a && e < m.index) a = e + 1; }
  if (b < texte.length) { const e = texte.indexOf(' ', m.index + m[0].length + largeur - 20); if (e > 0 && e < b) b = e; }
  re.lastIndex = 0;
  return (a > 0 ? '… ' : '') + texte.slice(a, b).replace(re, '\u0001$1\u0002') + (b < texte.length ? ' …' : '');
}

/**
 * Où un sigle est employé, document par document : nombre d'occurrences, figures, et
 * jusqu'à `passages` extraits avec leur section. Trié du document qui l'emploie le plus
 * au moins. null si le lecteur n'a pas accès.
 */
function emploisSigle(lecteurId, s, { passages = 4 } = {}) {
  const docs = lister(lecteurId);
  if (!docs) return null;
  const re = reSigles([String(s)]);
  const out = [];
  for (const d0 of docs) {
    const d = lire(lecteurId, d0.slug);
    if (!d) continue;
    let n = 0; const figures = new Set(); const ex = [];
    const compte = (t) => { re.lastIndex = 0; const k = (String(t).match(re) || []).length; re.lastIndex = 0; return k; };
    const dansTete = compte(d.titre) + compte(d.chapo);
    n += dansTete;
    if (dansTete && d.chapo && compte(d.chapo)) ex.push({ section: null, texte: extrait(d.chapo, re) });
    for (const m of morceaux(d.corps)) {
      const k = compte(m.texte);
      if (!k) continue;
      n += k;
      if (m.dansFigure) { figures.add(m.figure); continue; }
      if (ex.length < passages && !m.titre) {
        const t = extrait(texteLigne(m.texte), re);
        if (t && !ex.some((e) => e.texte === t)) ex.push({ section: m.section, texte: t });
      }
    }
    if (n) out.push({ slug: d.slug, titre: d.titre, categorie: d.categorie, majLe: d.majLe, occurrences: n, figures: [...figures], passages: ex });
  }
  return out.sort((a, b) => b.occurrences - a.occurrences || a.titre.localeCompare(b.titre, 'fr'));
}

/** Pour chaque sigle connu : { documents, occurrences } sur les documents lisibles. */
function usagesSigles(lecteurId) {
  const docs = lister(lecteurId);
  if (!docs) return null;
  const cles = [...carte().keys()].filter(Boolean).sort((a, b) => b.length - a.length);
  const u = new Map(cles.map((c) => [c, { documents: 0, occurrences: 0 }]));
  if (!cles.length) return u;
  const re = reSigles(cles);
  for (const d0 of docs) {
    const d = lire(lecteurId, d0.slug);
    if (!d) continue;
    const vus = new Set();
    const texte = [d.titre, d.chapo, ...morceaux(d.corps).map((m) => m.texte)].join('\n');
    for (const m of texte.matchAll(re)) { const x = u.get(m[1]); if (!x) continue; x.occurrences++; if (!vus.has(m[1])) { vus.add(m[1]); x.documents++; } }
  }
  return u;
}

/**
 * Les liens d'un sigle avec les autres : ceux que sa définition mentionne (`mentionne`),
 * ceux dont la définition le mentionne (`citePar`), et sa famille (même catégorie).
 */
function voisinsSigle(s) {
  const t = carte();
  const g = t.get(String(s));
  if (!g) return null;
  const autres = [...t.keys()].filter((k) => k && k !== g.sigle).sort((a, b) => b.length - a.length);
  const mentionne = autres.length ? [...new Set([...(g.sens + '\n' + g.detail).matchAll(reSigles(autres))].map((m) => m[1]))] : [];
  const reMoi = new RegExp(reSigles([g.sigle]).source, 'u');
  const citePar = [...t.values()].filter((x) => x.sigle !== g.sigle && reMoi.test(x.sens + '\n' + x.detail)).map((x) => x.sigle);
  const famille = [...t.values()].filter((x) => x.sigle !== g.sigle && plat(x.categorie) === plat(g.categorie)).map((x) => x.sigle);
  const tri = (l) => l.sort((a, b) => a.localeCompare(b, 'fr', { sensitivity: 'base' }));
  return { mentionne: tri(mentionne), citePar: tri(citePar), famille: tri(famille) };
}

// ── Graphiques ───────────────────────────────────────────────────────────────

function creerGraphique(auteurId, spec) {
  init();
  if (!peutEcrire(auteurId)) return { ok: false, error: REFUS_ECRITURE };
  const G = require('./graphiques');
  const g = G.valider(spec);
  if (!g.ok) return g;
  const json = JSON.stringify(g.spec);
  const id = crypto.createHash('sha256').update(json).digest('hex').slice(0, 16);
  db.prepare('INSERT OR IGNORE INTO metis_graphiques (id, spec, auteur, cree_le) VALUES (?, ?, ?, ?)').run(id, json, 'ChatGPT', maintenant());
  return { ok: true, id, type: g.spec.type, markdown: '{{graphique:' + id + '}}', apercu: 'https://plagnito.com/metis/graphique/' + id + '.svg', resume: G.resumer(g.spec) };
}
function graphique(id) {
  init();
  const r = /^[a-f0-9]{16}$/.test(String(id || '')) && db.prepare('SELECT spec FROM metis_graphiques WHERE id = ?').get(String(id));
  return r ? JSON.parse(r.spec) : null;
}
/** Les graphiques enregistrés, ou ceux d'un document (dans l'ordre du texte). */
function listerGraphiques(lecteurId, slug) {
  if (!peutLire(lecteurId)) return null;
  const G = require('./graphiques');
  if (slug) {
    const d = lire(lecteurId, slug);
    if (!d) return null;
    return graphiquesDuCorps(d.corps).map((g) => (g.spec ? { n: g.n, repere: g.brut.startsWith('{{') ? g.brut : 'bloc graphique n°' + g.n, titre: g.spec.titre || null, ...G.resumer(g.spec) } : { n: g.n, erreurs: g.erreurs }));
  }
  return db.prepare('SELECT id, spec, cree_le FROM metis_graphiques ORDER BY cree_le DESC LIMIT 100').all()
    .map((r) => { const s = JSON.parse(r.spec); return { id: r.id, markdown: '{{graphique:' + r.id + '}}', type: s.type, titre: s.titre || null, creeLe: r.cree_le }; });
}

/**
 * Les graphiques d'un corps Markdown : blocs ```graphique (JSON) et références
 * {{graphique:<id>}}. Rend [{ n, spec?, erreurs?, brut }] dans l'ordre du texte.
 */
function graphiquesDuCorps(md) {
  const out = [];
  const G = require('./graphiques');
  const re = /```graphique[^\n]*\n([\s\S]*?)```|\{\{graphique:([a-f0-9]{16})\}\}/g;
  let m, n = 0;
  while ((m = re.exec(md))) {
    n++;
    if (m[2]) { const s = graphique(m[2]); out.push(s ? { n, spec: s, brut: m[0] } : { n, erreurs: ['graphique inconnu : ' + m[2] + ' (crée-le d’abord avec creer_graphique).'], brut: m[0] }); continue; }
    let j = null;
    try { j = JSON.parse(m[1]); } catch (e) { out.push({ n, erreurs: ['JSON illisible : ' + e.message], brut: m[0] }); continue; }
    const v = G.valider(j);
    out.push(v.ok ? { n, spec: v.spec, brut: m[0] } : { n, erreurs: v.erreurs, brut: m[0] });
  }
  return out;
}

/**
 * Le HTML d'un corps : Markdown (rendu de docu.plagnito.com) + graphiques dessinés
 * + sigles expliqués. opts.slug : pour le lien « ouvrir en grand » des figures ;
 * opts.lien(sigle) : l'adresse de la fiche d'un sigle (liens et bulles de définition) ;
 * opts.sigles === false : pas de liste « Sigles employés » en fin de texte ;
 * opts.figures : préfixe des liens « ouvrir en grand » (sinon /metis/<slug>) ;
 * opts.sauf : un sigle à ne pas annoter (sa propre page).
 */
function rendreCorps(md, opts = {}) {
  const G = require('./graphiques');
  const docu = require('./docu');
  const figures = [];
  let texte = String(md || '').replace(/\r\n/g, '\n')
    // Un lien javascript:/data: n'a rien à faire dans un article.
    .replace(/\]\(\s*(javascript|data|vbscript):[^)]*\)/gi, '](#)');
  const table = carte();
  const connu = (s) => table.get(s) || null;
  for (const g of graphiquesDuCorps(texte)) {
    const k = figures.length;
    if (g.spec) {
      const svg = G.rendre(g.spec, { id: 'fig' + k });
      const large = g.spec.type === 'planche' || /min-width:/.test(svg.slice(0, 300));
      const base = opts.figures || (opts.slug ? '/metis/' + opts.slug : null);
      const grand = base ? '<a href="' + docu.echapper(base) + '/figure/' + g.n + '.svg">Ouvrir en grand</a>' : '';
      const legende = [g.spec.source ? 'Source : ' + docu.echapper(g.spec.source) : '', large ? grand : ''].filter(Boolean).join(' · ');
      figures.push('<figure class="figure' + (large ? ' large' : '') + '">' + svg + G.glossaireHtml(g.spec, connu, opts.lien) + (legende ? '<figcaption>' + legende + '</figcaption>' : '') + '</figure>');
    } else figures.push('<div class="figure-erreur">Graphique n° ' + g.n + ' non affiché : ' + docu.echapper(g.erreurs.join(' ')) + '</div>');
    texte = texte.replace(g.brut, '\n\n@@FIGURE-' + k + '@@\n\n');
  }
  const r = docu.rendre(texte);
  const a = annoterSigles(r.html, table, { lien: opts.lien, sauf: opts.sauf });
  let html = a.html;
  // Les sigles employés, expliqués en fin de document — sauf si le document a déjà
  // son propre glossaire (une section « Glossaire » ou « Sigles »).
  const dejaGlossaire = (r.sommaire || []).some((s) => /glossaire|sigles|abr[ée]viations/i.test(s.texte));
  if (a.trouves.length && opts.sigles !== false && !dejaGlossaire) {
    const l = a.trouves.sort((x, y) => x.localeCompare(y, 'fr', { sensitivity: 'base' })).map((s) => table.get(s));
    const dt = (s) => (opts.lien ? '<a href="' + docu.echapper(opts.lien(s)) + '">' + docu.echapper(s) + '</a>' : docu.echapper(s));
    html += '<section class="sigles"><h2 id="sigles-employes">Sigles employés</h2><dl>' + l.map((g) => '<div><dt>' + dt(g.sigle) + '</dt><dd><b>' + docu.echapper(g.sens) + '</b>' + (g.detail ? ' — ' + docu.echapper(g.detail) : '') + '</dd></div>').join('') + '</dl></section>';
  }
  // Filet final sur le HTML produit : un lien ne garde que http(s), mailto, une ancre ou un
  // chemin local. Le filtre du Markdown ci-dessus ne suffit pas seul — un navigateur ignore les
  // tabulations et retours DANS un schéma (« java⇥script: ») : on juge l'adresse une fois
  // débarrassée de ces caractères, et tout autre schéma devient « # ».
  html = html.replace(/<p>@@FIGURE-(\d+)@@<\/p>/g, (x, k) => figures[Number(k)] || '')
    .replace(/href="([^"]*)"/g, (m, u) => {
      const n = u.replace(/&#?[a-z0-9]+;/gi, '').replace(/[\s\u0000-\u001f]/g, '').toLowerCase();
      return (!/^[a-z][a-z0-9+.-]*:/.test(n) || /^(https?|mailto):/.test(n)) ? m : 'href="#"';
    });
  return { html, sommaire: r.sommaire || [], sigles: a.trouves };
}

// ── Statistiques ──────────────────────────────────────────────────────────────

function statistiques(lecteurId) {
  if (!peutLire(lecteurId)) return null;
  const docs = lister(lecteurId) || [];
  const parCategorie = {}, types = {};
  for (const d of docs) parCategorie[d.categorie] = (parCategorie[d.categorie] || 0) + 1;
  for (const d of docs) { const x = lire(lecteurId, d.slug); for (const g of graphiquesDuCorps(x.corps)) if (g.spec) types[g.spec.type] = (types[g.spec.type] || 0) + 1; }
  const ecrivain = peutEcrire(lecteurId);
  return {
    documents: docs.length, parCategorie,
    brouillons: ecrivain ? db.prepare("SELECT COUNT(*) n FROM metis_docs WHERE statut='brouillon'").get().n : undefined,
    archives: ecrivain ? db.prepare("SELECT COUNT(*) n FROM metis_docs WHERE statut='archive'").get().n : undefined,
    versions: db.prepare('SELECT COUNT(*) n FROM metis_versions').get().n,
    graphiquesParType: types, sigles: carte().size, etiquettes: etiquettes(lecteurId),
    notesOuvertes: db.prepare('SELECT COUNT(*) n FROM metis_notes WHERE resolue = 0').get().n,
    derniers: docs.slice(0, 5).map((d) => ({ slug: d.slug, titre: d.titre, majLe: d.majLe })),
  };
}

// ── Graines : plans d'architecture et glossaire versionnés dans le dépôt ──────
//  Un plan semé est mis à jour quand son fichier change — SAUF si quelqu'un l'a
//  modifié en ligne depuis la dernière graine : on ne réécrit pas son travail.

function lireGraine(fichier) {
  const brut = fs.readFileSync(fichier, 'utf8').replace(/\r\n/g, '\n');
  const m = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/.exec(brut);
  if (!m) return null;
  const meta = {};
  for (const l of m[1].split('\n')) { const i = l.indexOf(':'); if (i > 0) meta[l.slice(0, i).trim()] = l.slice(i + 1).trim(); }
  return { slug: meta.slug, titre: meta.titre, chapo: meta.chapo || '', categorie: meta.categorie || 'Architecture', etiquettes: (meta.etiquettes || '').split(',').map((x) => x.trim()).filter(Boolean), corps: m[2].trim() + '\n' };
}
function semer() { /* Each instance starts empty. No Atlas corpus. */ }

module.exports = {
  id: 'metisdocs', init,
  peutLire, peutEcrire, estMaster, roleDe, accorder, changerRole, retirer, lecteurs, ROLES_ACCES,
  publier, modifier, archiver, desarchiver, lire, lister, etiquettes,
  sections, sommaire, lireSection, modifierSection, MODES_SECTION,
  difference, comparer, restaurerVersion, dupliquer,
  commenter, notes, resoudre,
  glossaire, sigle, definirSigle, retirerSigle, annoterSigles, emploisSigle, usagesSigles, voisinsSigle,
  lireFiche, redigerFiche, appliquerSection, NATURES, invaliderGlossaire: () => { carteSigles = null; },
  creerGraphique, graphique, listerGraphiques, graphiquesDuCorps, rendreCorps,
  statistiques, semer,
  CATEGORIES, STATUTS, LIMITES,
};
require('./metis-research-journal').bindWriters(module.exports, ['publier', 'modifier', 'archiver', 'desarchiver', 'modifierSection', 'restaurerVersion', 'dupliquer', 'commenter', 'resoudre', 'definirSigle', 'retirerSigle', 'redigerFiche']);


};
