// Adapted from Plagni/atlas 227e897b68fbbaf2d6436084526519bf28ededf8. AGPL-3.0-only.
module.exports = function nativeModule(require, module, __dirname) {
'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const logger = require('../core/logger');
let db = null; try { ({ db } = require('../core/db')); } catch { /* */ }

// =============================================================================
//  metisexperts — le registre des experts de l'architecture Métis
// -----------------------------------------------------------------------------
//  Demandé le 26/09/2026 : chaque expert de l'architecture est une entité décrite
//  une à une, rattachée à UN pool de capacité, et garde l'accès au POOL PRINCIPAL
//  partagé (communication entre experts, connaissances communes). Le registre sert
//  de socle au routage dynamique (MORPH), au chargement dynamique des experts, au
//  PCO, au DMA et, plus tard, à l'entraînement et à l'évaluation automatiques.
//  Il est lu et écrit par le MCP (/mcp) et parcouru sur /metis/experts.
//
//  ── LE MODÈLE (extensible) ───────────────────────────────────────────────────
//  • pools          : un seul « principal » (partagé, porte des RESSOURCES : canaux
//                     de communication, connaissances, mémoire) ; les autres sont des
//                     pools de CAPACITÉ, les seuls auxquels un expert appartient.
//  • competences    : entités à part. Un expert en a plusieurs, une compétence est
//                     partagée par plusieurs experts (table de liaison
//                     metis_expert_competences : rang, niveau DÉCLARÉ, niveau MESURÉ).
//  • benchmarks     : ce qui mesure une compétence (métrique, unité, sens).
//  • mesures        : l'historique de chaque mesure. Seule une mesure qui porte un
//                     niveau (0-100) met à jour le niveau mesuré — une valeur brute
//                     n'est pas convertie en niveau à la place de l'évaluateur.
//  • relations      : typées (depend_de, appelle, alimente, verifie…), orientées.
//  • experts        : les champs décrits sont VALIDÉS (un champ inconnu est refusé,
//                     c'est ainsi qu'on attrape une faute de frappe) ; ce qui n'a pas
//                     encore de champ va dans `extensions` (JSON libre) — c'est la
//                     porte d'entrée des mécanismes futurs sans migration.
//
//  ── RIEN NE SE PERD ──────────────────────────────────────────────────────────
//  Chaque changement d'un expert crée une RÉVISION (instantané gardé). Modifier ses
//  champs exige `revision_attendue` : si quelqu'un est passé entre-temps, c'est
//  refusé au lieu d'écraser. Mêmes droits que les publications : lire = lecteurs
//  Métis, écrire = Master seul (metisdocs.peutLire / peutEcrire).
//
//  ── HONNÊTETÉ DES NIVEAUX ────────────────────────────────────────────────────
//  Un niveau inconnu vaut null, JAMAIS 0 : « non mesuré » n'est pas « nul ». Le
//  registre semé (metis-plans/experts.json) ne porte AUCUN niveau mesuré : aucun
//  benchmark n'a encore été passé sur ces experts.
// =============================================================================

const STATUTS = ['experimental', 'stable', 'deprecie'];
const LIB_STATUT = { experimental: 'Expérimental', stable: 'Stable', deprecie: 'Déprécié' };
const RANGS = ['principale', 'secondaire'];
const RELATIONS = ['depend_de', 'appelle', 'alimente', 'verifie', 'supervise', 'complete', 'alternative_a', 'remplace', 'descend_de', 'transition_vers', 'partage_avec'];
const LIB_RELATION = { depend_de: 'dépend de', appelle: 'appelle', alimente: 'alimente', verifie: 'vérifie', supervise: 'supervise', complete: 'complète', alternative_a: 'alternative à', remplace: 'remplace', descend_de: 'descend de', transition_vers: 'transition vers', partage_avec: 'partage avec' };
// La nature d'un expert. « specialiste » = Specialist Delta Module (Plan 9) greffé sur le SPP.
const TYPES = ['backbone', 'specialiste', 'adapter', 'tete', 'juge', 'modele_externe', 'autre'];
const LIB_TYPE = { backbone: 'Backbone / cœur', specialiste: 'Spécialiste (SDM)', adapter: 'Adapter', tete: 'Tête', juge: 'Juge consultatif', modele_externe: 'Modèle externe', autre: 'Autre' };
// Les quatre axes des Specialist Delta Modules (Plan 9, § 11).
const AXES = ['langage', 'role', 'framework', 'depot'];
const LIB_AXE = { langage: 'Langage', role: 'Rôle', framework: 'Framework', depot: 'Dépôt' };
// Ω.13 § 21 : ce qui est livré se distingue de ce qui est conçu.
const MATURITES = ['implemente', 'prototype', 'concu', 'experimental', 'rejete'];
const LIB_MATURITE = { implemente: 'Implémenté', prototype: 'Prototype', concu: 'Conçu', experimental: 'Expérimental', rejete: 'Rejeté' };
// MACE (Plan 9, § 1) : comment un module s'assemble au cœur partagé.
const STRATEGIES_COMPOSITION = ['reuse', 'sum_fuse', 'gated', 'isolate'];
const SOUS_ESPACES = ['partage', 'prive', 'dual'];
// Subsystem Value Audit (Ω.13, § 12).
const CLASSES_AUDIT = ['essentiel', 'utile', 'conditionnel', 'redondant', 'nuisible'];
// SPCR — Shadow → Prove → Canary → Release (Plan 9, internes MELO).
const PROMOTIONS = ['aucune', 'shadow', 'prove', 'canary', 'release'];
const PERIPHERIQUES = ['gpu', 'cpu', 'gpu_ou_cpu', 'npu', 'distant', 'aucun'];
const LIB_PERIPH = { gpu: 'GPU', cpu: 'CPU', gpu_ou_cpu: 'GPU ou CPU', npu: 'NPU', distant: 'Distant', aucun: 'Aucun' };
// Les niveaux de DEL (Plan 9, § 2) : L0 VRAM locale → L1 VRAM d'un autre GPU → L2 RAM épinglée → L3 NVMe.
const CHARGEMENTS = ['sans_objet', 'non_charge', 'l0_vram', 'l1_vram_distante', 'l2_ram_epinglee', 'l3_nvme', 'residant'];
const LIB_CHARGEMENT = { sans_objet: 'Sans objet', non_charge: 'Non chargé', l0_vram: 'L0 · VRAM (chaud)', l1_vram_distante: 'L1 · VRAM d’un autre GPU', l2_ram_epinglee: 'L2 · RAM épinglée (tiède)', l3_nvme: 'L3 · NVMe (froid)', residant: 'Résidant (épinglé)' };
const ENTRAINEMENTS = ['sans_objet', 'non_entraine', 'en_cours', 'entraine', 'pre_entraine_externe', 'a_reevaluer', 'gele'];
const LIB_ENTRAINEMENT = { sans_objet: 'Sans objet (déterministe)', non_entraine: 'Non entraîné', en_cours: 'Entraînement en cours', entraine: 'Entraîné', pre_entraine_externe: 'Pré-entraîné (externe)', a_reevaluer: 'À réévaluer', gele: 'Gelé' };
const STRATEGIES = ['exclusif', 'parallele', 'cascade', 'consultatif'];
const COUTS = ['tres_faible', 'faible', 'moyen', 'eleve', 'tres_eleve'];
const LIB_COUT = { tres_faible: 'Très faible', faible: 'Faible', moyen: 'Moyen', eleve: 'Élevé', tres_eleve: 'Très élevé' };
const ROLES_DATASET = ['pre_entrainement', 'entrainement', 'reglage', 'validation', 'evaluation', 'inconnu'];
const TYPES_RESSOURCE = ['communication', 'connaissance', 'memoire'];
const ETATS_RESSOURCE = ['en_service', 'propose'];
const SENS_BENCH = ['plus_haut', 'plus_bas'];
// Métriques qui, mesurées, mettent aussi à jour la fiche technique de l'expert.
const METRIQUES_FICHE = { latence_p50_ms: ['latence', 'p50_ms'], latence_p95_ms: ['latence', 'p95_ms'], debit_jetons_s: ['latence', 'debit_jetons_s'], vram_mo: ['memoire', 'vram_mo'], ram_mo: ['memoire', 'ram_mo'], cout: ['cout', 'valeur'] };

const ID_RE = /^[a-z0-9][a-z0-9-]{1,59}$/;
const DOSSIER_PLANS = process.env.METIS_PLANS_DIR || path.join(__dirname, 'metis-plans');
const AUTEUR_GRAINE = 'Claude';
const maintenant = () => new Date().toISOString();
const sha = (s) => crypto.createHash('sha256').update(String(s)).digest('hex');
const propre = (v, max) => String(v == null ? '' : v).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f‪-‮⁦-⁩]/g, '').trim().slice(0, max);
const plat = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
const json = (s, def) => { try { const v = JSON.parse(s); return v == null ? def : v; } catch { return def; } };
const docs = () => require('./metisdocs');
const peutLire = (id) => docs().peutLire(id);
const peutEcrire = (id) => docs().peutEcrire(id);
const REFUS = { ok: false, error: 'Réservé au compte Master.' };

let pret = false;
function init() {
  if (pret || !db) return;
  db.exec(`
    CREATE TABLE IF NOT EXISTS metis_pools (
      id TEXT PRIMARY KEY, nom TEXT NOT NULL, type TEXT NOT NULL, role TEXT NOT NULL DEFAULT '',
      description TEXT NOT NULL DEFAULT '', couleur INTEGER, icone TEXT NOT NULL DEFAULT '',
      ressources TEXT NOT NULL DEFAULT '[]', ordre INTEGER NOT NULL DEFAULT 100,
      source TEXT NOT NULL, auteur TEXT NOT NULL, maj_le TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS metis_competences (
      id TEXT PRIMARY KEY, nom TEXT NOT NULL, domaine TEXT NOT NULL DEFAULT '', description TEXT NOT NULL DEFAULT '',
      source TEXT NOT NULL, auteur TEXT NOT NULL, maj_le TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS metis_benchmarks (
      id TEXT PRIMARY KEY, nom TEXT NOT NULL, description TEXT NOT NULL DEFAULT '', competence TEXT,
      metrique TEXT NOT NULL DEFAULT '', unite TEXT NOT NULL DEFAULT '', sens TEXT NOT NULL DEFAULT 'plus_haut',
      url TEXT NOT NULL DEFAULT '', source TEXT NOT NULL, auteur TEXT NOT NULL, maj_le TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS metis_experts (
      id TEXT PRIMARY KEY, pool TEXT NOT NULL, nom TEXT NOT NULL, statut TEXT NOT NULL,
      revision INTEGER NOT NULL DEFAULT 1, donnees TEXT NOT NULL, source TEXT NOT NULL,
      auteur TEXT NOT NULL, cree_le TEXT NOT NULL, maj_le TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS metis_experts_revisions (
      expert TEXT NOT NULL, revision INTEGER NOT NULL, donnees TEXT NOT NULL, competences TEXT NOT NULL DEFAULT '[]',
      motif TEXT NOT NULL DEFAULT '', auteur TEXT NOT NULL, le TEXT NOT NULL, PRIMARY KEY (expert, revision));
    CREATE TABLE IF NOT EXISTS metis_expert_competences (
      expert TEXT NOT NULL, competence TEXT NOT NULL, rang TEXT NOT NULL, niveau_declare INTEGER, niveau_mesure INTEGER,
      mesure_le TEXT, benchmark TEXT, note TEXT NOT NULL DEFAULT '', maj_le TEXT NOT NULL, PRIMARY KEY (expert, competence));
    CREATE TABLE IF NOT EXISTS metis_expert_mesures (
      id INTEGER PRIMARY KEY AUTOINCREMENT, expert TEXT NOT NULL, competence TEXT, benchmark TEXT,
      metrique TEXT NOT NULL, valeur REAL NOT NULL, niveau INTEGER, detail TEXT NOT NULL DEFAULT '',
      source TEXT NOT NULL, auteur TEXT NOT NULL, le TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS metis_expert_relations (
      de TEXT NOT NULL, vers TEXT NOT NULL, type TEXT NOT NULL, detail TEXT NOT NULL DEFAULT '',
      source TEXT NOT NULL, auteur TEXT NOT NULL, le TEXT NOT NULL, PRIMARY KEY (de, vers, type));
    CREATE TABLE IF NOT EXISTS metis_experts_graines (cle TEXT PRIMARY KEY, empreinte TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS idx_mec_competence ON metis_expert_competences (competence);
    CREATE INDEX IF NOT EXISTS idx_mem_expert ON metis_expert_mesures (expert, le);
  `);
  require('./metis-research-journal').install(db);
  pret = true;
  try { semer(); } catch (e) { logger.error('metis', 'graines des experts : ' + (e.stack || e.message)); }
}

// ── Validation ───────────────────────────────────────────────────────────────

function texte(v, max, champ, e, { requis = false } = {}) {
  if (v === undefined || v === null) { if (requis) e.push(champ + ' est obligatoire.'); return v === null ? '' : undefined; }
  if (typeof v !== 'string' && typeof v !== 'number') { e.push(champ + ' doit être un texte.'); return undefined; }
  const t = propre(v, max);
  if (requis && !t) e.push(champ + ' est obligatoire.');
  return t;
}
function liste(v, max, maxTexte, champ, e) {
  if (v === undefined) return undefined;
  if (v === null) return [];
  const l = Array.isArray(v) ? v : typeof v === 'string' ? v.split(',') : null;
  if (!l) { e.push(champ + ' doit être une liste de textes.'); return undefined; }
  const out = [], vus = new Set();
  for (const x of l) {
    if (typeof x !== 'string' && typeof x !== 'number') { e.push(champ + ' doit être une liste de textes (reçu ' + JSON.stringify(x) + ').'); return undefined; }
    const t = propre(x, maxTexte);
    if (t && !vus.has(plat(t))) { vus.add(plat(t)); out.push(t); }
  }
  if (out.length > max) { e.push(champ + ' : au plus ' + max + ' éléments (reçu ' + out.length + ').'); return undefined; }
  return out;
}
function nombre(v, champ, e, { min = 0, max = Infinity, entier = false } = {}) {
  if (v === undefined) return undefined;
  if (v === null || v === '') return null;
  const n = Number(v);
  if (!Number.isFinite(n) || n < min || n > max || (entier && !Number.isInteger(n))) { e.push(champ + ' doit être un nombre' + (entier ? ' entier' : '') + ' de ' + min + ' à ' + (max === Infinity ? '∞' : max) + ' (ou null si inconnu), reçu ' + JSON.stringify(v) + '.'); return undefined; }
  return n;
}
function choix(v, valeurs, champ, e) {
  if (v === undefined) return undefined;
  if (v === null || v === '') return null;
  if (!valeurs.includes(v)) { e.push(champ + ' doit valoir l’un de : ' + valeurs.join(', ') + ' (reçu ' + JSON.stringify(v) + ').'); return undefined; }
  return v;
}
function booleen(v, champ, e) {
  if (v === undefined) return undefined;
  if (v === null) return null;
  if (typeof v !== 'boolean') { e.push(champ + ' doit valoir true ou false.'); return undefined; }
  return v;
}
function objet(v, champ, e) {
  if (v === undefined) return undefined;
  if (v === null) return null;
  if (typeof v !== 'object' || Array.isArray(v)) { e.push(champ + ' doit être un objet.'); return undefined; }
  return v;
}
const niveau = (v, champ, e) => nombre(v, champ, e, { min: 0, max: 100, entier: true });
const sansVides = (o) => { const r = {}; for (const [k, v] of Object.entries(o)) if (v !== undefined) r[k] = v; return r; };
// Un sous-objet décrit : chaque clé a son vérificateur ; une clé inconnue est une faute.
function sousObjet(v, champ, e, schema) {
  const o = objet(v, champ, e);
  if (o === undefined || o === null) return o;
  const r = {};
  for (const k of Object.keys(o)) {
    if (!schema[k]) { e.push(champ + '.' + k + ' : champ inconnu (champs : ' + Object.keys(schema).join(', ') + ').'); continue; }
    const x = schema[k](o[k], champ + '.' + k, e);
    if (x !== undefined) r[k] = x;
  }
  return r;
}

const ICONES_PERMISES = () => Object.keys(require('./graphiques-planche').ICONES);

const SCHEMA_ROUTAGE = {
  intentions: (v, c, e) => liste(v, 20, 60, c, e),
  declencheurs: (v, c, e) => liste(v, 30, 80, c, e),
  priorite: (v, c, e) => nombre(v, c, e, { min: 0, max: 100, entier: true }),
  poids: (v, c, e) => nombre(v, c, e, { min: 0, max: 100 }),
  seuil_confiance: (v, c, e) => nombre(v, c, e, { min: 0, max: 1 }),
  strategie: (v, c, e) => choix(v, STRATEGIES, c, e),
  repli: (v, c, e) => { const t = texte(v, 60, c, e); if (t && !ID_RE.test(t)) { e.push(c + ' doit être l’identifiant d’un expert.'); return undefined; } return t; },
  profils: (v, c, e) => liste(v, 20, 60, c, e),
  conditions: (v, c, e) => texte(v, 800, c, e),
};
const SCHEMA_COUT = {
  valeur: (v, c, e) => nombre(v, c, e), unite: (v, c, e) => texte(v, 40, c, e),
  relatif: (v, c, e) => choix(v, COUTS, c, e), detail: (v, c, e) => texte(v, 400, c, e),
};
const SCHEMA_LATENCE = {
  p50_ms: (v, c, e) => nombre(v, c, e), p95_ms: (v, c, e) => nombre(v, c, e), debit_jetons_s: (v, c, e) => nombre(v, c, e),
  mesuree: (v, c, e) => booleen(v, c, e), detail: (v, c, e) => texte(v, 400, c, e),
};
const SCHEMA_MEMOIRE = {
  ram_mo: (v, c, e) => nombre(v, c, e), vram_mo: (v, c, e) => nombre(v, c, e), disque_mo: (v, c, e) => nombre(v, c, e),
  mesuree: (v, c, e) => booleen(v, c, e), detail: (v, c, e) => texte(v, 400, c, e),
};
const SCHEMA_CHARGEMENT = {
  etat: (v, c, e) => choix(v, CHARGEMENTS, c, e), cache: (v, c, e) => booleen(v, c, e), epingle: (v, c, e) => booleen(v, c, e),
  temps_chargement_ms: (v, c, e) => nombre(v, c, e),
  prechargement: (v, c, e) => booleen(v, c, e), emplacement: (v, c, e) => texte(v, 200, c, e), detail: (v, c, e) => texte(v, 400, c, e),
};
function evenements(v, c, e) {
  if (v === undefined) return undefined;
  if (v === null) return [];
  if (!Array.isArray(v) || v.length > 300) { e.push(c + ' doit être une liste (au plus 300) de { le?, evenement, detail? }.'); return undefined; }
  const out = [];
  for (const [k, x] of v.entries()) {
    const o = sousObjet(x, c + '[' + k + ']', e, { le: (w, cc, ee) => texte(w, 40, cc, ee), evenement: (w, cc, ee) => texte(w, 200, cc, ee, { requis: true }), detail: (w, cc, ee) => texte(w, 1000, cc, ee), checkpoint: (w, cc, ee) => texte(w, 200, cc, ee) });
    if (o) out.push(o);
  }
  return out;
}
const SCHEMA_ENTRAINEMENT = {
  etat: (v, c, e) => choix(v, ENTRAINEMENTS, c, e), checkpoint: (v, c, e) => texte(v, 200, c, e),
  recette: (v, c, e) => texte(v, 200, c, e), detail: (v, c, e) => texte(v, 1200, c, e), historique: evenements,
  etape_promotion: (v, c, e) => choix(v, PROMOTIONS, c, e),
};
const idExpert = (v, c, e) => { const t = texte(v, 60, c, e); if (t && !ID_RE.test(t)) { e.push(c + ' doit être l’identifiant d’un expert.'); return undefined; } return t; };
const SCHEMA_COMPOSITION = {
  base: idExpert, strategie: (v, c, e) => choix(v, STRATEGIES_COMPOSITION, c, e), rang: (v, c, e) => nombre(v, c, e, { min: 0, max: 65536, entier: true }),
  sous_espace: (v, c, e) => choix(v, SOUS_ESPACES, c, e), couches: (v, c, e) => texte(v, 120, c, e), detail: (v, c, e) => texte(v, 600, c, e),
};
// Component Tombstone (Ω.13, § 25) : retirer n'efface pas — on garde pourquoi, par quoi, et comment revenir.
const SCHEMA_RETRAIT = { raison: (v, c, e) => texte(v, 600, c, e), remplace_par: idExpert, restauration: (v, c, e) => texte(v, 600, c, e), le: (v, c, e) => texte(v, 40, c, e) };
const SCHEMA_AUDIT = { classe: (v, c, e) => choix(v, CLASSES_AUDIT, c, e), le: (v, c, e) => texte(v, 40, c, e), detail: (v, c, e) => texte(v, 600, c, e) };
function datasets(v, c, e) {
  if (v === undefined) return undefined;
  if (v === null) return [];
  if (!Array.isArray(v) || v.length > 40) { e.push(c + ' doit être une liste (au plus 40) de { nom, role?, version?, taille?, detail? } ou de noms.'); return undefined; }
  const out = [];
  for (const [k, x] of v.entries()) {
    if (typeof x === 'string') { const t = propre(x, 160); if (t) out.push({ nom: t, role: 'inconnu' }); continue; }
    const o = sousObjet(x, c + '[' + k + ']', e, { nom: (w, cc, ee) => texte(w, 160, cc, ee, { requis: true }), role: (w, cc, ee) => choix(w, ROLES_DATASET, cc, ee), version: (w, cc, ee) => texte(w, 60, cc, ee), taille: (w, cc, ee) => texte(w, 60, cc, ee), detail: (w, cc, ee) => texte(w, 500, cc, ee) });
    if (o) out.push({ role: 'inconnu', ...o });
  }
  return out;
}
const SCHEMA_ACCES = { lit: (v, c, e) => liste(v, 20, 60, c, e), ecrit: (v, c, e) => liste(v, 20, 60, c, e), detail: (v, c, e) => texte(v, 400, c, e) };

// Les champs d'un expert, dans l'ordre où la fiche les présente.
const CHAMPS = {
  nom: (v, c, e) => texte(v, 80, c, e),
  pool: (v, c, e) => texte(v, 60, c, e),
  role: (v, c, e) => texte(v, 300, c, e),
  description: (v, c, e) => texte(v, 3000, c, e),
  statut: (v, c, e) => choix(v, STATUTS, c, e),
  type: (v, c, e) => choix(v, TYPES, c, e),
  axe: (v, c, e) => choix(v, AXES, c, e),
  maturite: (v, c, e) => choix(v, MATURITES, c, e),
  version: (v, c, e) => texte(v, 60, c, e),
  icone: (v, c, e) => { const t = texte(v, 30, c, e); if (t && !ICONES_PERMISES().includes(t)) { e.push(c + ' doit être une icône des planches : ' + ICONES_PERMISES().join(', ') + '.'); return undefined; } return t; },
  specialisations: (v, c, e) => liste(v, 20, 100, c, e),
  entrees: (v, c, e) => liste(v, 20, 140, c, e),
  sorties: (v, c, e) => liste(v, 20, 140, c, e),
  outils: (v, c, e) => liste(v, 30, 100, c, e),
  routage: (v, c, e) => sousObjet(v, c, e, SCHEMA_ROUTAGE),
  cout: (v, c, e) => sousObjet(v, c, e, SCHEMA_COUT),
  latence: (v, c, e) => sousObjet(v, c, e, SCHEMA_LATENCE),
  memoire: (v, c, e) => sousObjet(v, c, e, SCHEMA_MEMOIRE),
  peripherique: (v, c, e) => choix(v, PERIPHERIQUES, c, e),
  chargement: (v, c, e) => sousObjet(v, c, e, SCHEMA_CHARGEMENT),
  entrainement: (v, c, e) => sousObjet(v, c, e, SCHEMA_ENTRAINEMENT),
  composition: (v, c, e) => sousObjet(v, c, e, SCHEMA_COMPOSITION),
  datasets,
  limitations: (v, c, e) => liste(v, 25, 400, c, e),
  acces_principal: (v, c, e) => sousObjet(v, c, e, SCHEMA_ACCES),
  audit: (v, c, e) => sousObjet(v, c, e, SCHEMA_AUDIT),
  retrait: (v, c, e) => sousObjet(v, c, e, SCHEMA_RETRAIT),
  etiquettes: (v, c, e) => liste(v, 10, 30, c, e),
  notes: (v, c, e) => texte(v, 3000, c, e),
  extensions: (v, c, e) => {
    const o = objet(v, c, e);
    if (o && JSON.stringify(o).length > 16 * 1024) { e.push(c + ' dépasse 16 Ko.'); return undefined; }
    return o;
  },
};
const OBJETS_FUSIONNES = ['routage', 'cout', 'latence', 'memoire', 'chargement', 'entrainement', 'composition', 'acces_principal', 'audit', 'retrait', 'extensions'];
// Hors des champs : ce qu'un appel peut joindre sans que ce soit un champ de la fiche.
const HORS_CHAMPS = new Set(['id', 'competences', 'revision_attendue', 'motif']);

/** Valide les champs fournis ; rend { champs, erreurs }. Un champ absent reste absent. */
function validerChamps(b, e) {
  const r = {};
  for (const k of Object.keys(b || {})) {
    if (HORS_CHAMPS.has(k)) continue;
    if (!CHAMPS[k]) { e.push('Champ inconnu : ' + k + '. Champs d’un expert : ' + Object.keys(CHAMPS).join(', ') + ' (ce qui n’a pas de champ va dans extensions).'); continue; }
    const v = CHAMPS[k](b[k], k, e);
    if (v !== undefined) r[k] = v;
  }
  return r;
}

// ── Lecture ──────────────────────────────────────────────────────────────────

const ligneExpert = (id) => db.prepare('SELECT * FROM metis_experts WHERE id = ?').get(String(id || ''));
const lignePool = (id) => db.prepare('SELECT * FROM metis_pools WHERE id = ?').get(String(id || ''));
const poolPrincipal = () => db.prepare("SELECT * FROM metis_pools WHERE type = 'principal' ORDER BY ordre LIMIT 1").get();

function poolPublic(p, avecNombre = true) {
  if (!p) return null;
  const o = { id: p.id, nom: p.nom, type: p.type, role: p.role, description: p.description, couleur: p.couleur, icone: p.icone, ordre: p.ordre, majLe: p.maj_le, auteur: p.auteur, url: 'https://plagnito.com/metis/experts/pool/' + p.id };
  if (p.type === 'principal') o.ressources = json(p.ressources, []);
  if (avecNombre) o.experts = p.type === 'principal' ? db.prepare('SELECT COUNT(*) n FROM metis_experts').get().n : db.prepare('SELECT COUNT(*) n FROM metis_experts WHERE pool = ?').get(p.id).n;
  return o;
}
function competencesDe(expertId) {
  return db.prepare(`SELECT ec.*, c.nom, c.domaine FROM metis_expert_competences ec LEFT JOIN metis_competences c ON c.id = ec.competence
    WHERE ec.expert = ? ORDER BY CASE ec.rang WHEN 'principale' THEN 0 ELSE 1 END, COALESCE(ec.niveau_mesure, ec.niveau_declare, -1) DESC, ec.competence`).all(expertId)
    .map((x) => ({ competence: x.competence, nom: x.nom || x.competence, domaine: x.domaine || '', rang: x.rang, niveau_declare: x.niveau_declare, niveau_mesure: x.niveau_mesure,
      niveau_effectif: x.niveau_mesure != null ? x.niveau_mesure : x.niveau_declare, source_niveau: x.niveau_mesure != null ? 'mesure' : x.niveau_declare != null ? 'declare' : 'inconnu',
      mesure_le: x.mesure_le, benchmark: x.benchmark, note: x.note }));
}
function resume(r) {
  const d = json(r.donnees, {});
  const comps = competencesDe(r.id);
  const mesures = comps.filter((c) => c.niveau_mesure != null);
  return {
    id: r.id, nom: r.nom, pool: r.pool, statut: r.statut, type: d.type || null, axe: d.axe || null, maturite: d.maturite || null, version: d.version || '', role: d.role || '', icone: d.icone || '',
    peripherique: d.peripherique || null, chargement: d.chargement ? d.chargement.etat || null : null,
    entrainement: d.entrainement ? d.entrainement.etat || null : null,
    vram_mo: d.memoire && d.memoire.vram_mo != null ? d.memoire.vram_mo : null, ram_mo: d.memoire && d.memoire.ram_mo != null ? d.memoire.ram_mo : null,
    latence_p50_ms: d.latence && d.latence.p50_ms != null ? d.latence.p50_ms : null, debit_jetons_s: d.latence && d.latence.debit_jetons_s != null ? d.latence.debit_jetons_s : null,
    cout: d.cout ? (d.cout.relatif || null) : null,
    competences: comps.map((c) => ({ competence: c.competence, rang: c.rang, niveau_declare: c.niveau_declare, niveau_mesure: c.niveau_mesure })),
    niveau_mesure_moyen: mesures.length ? Math.round(mesures.reduce((a, c) => a + c.niveau_mesure, 0) / mesures.length) : null,
    revision: r.revision, majLe: r.maj_le, url: 'https://plagnito.com/metis/experts/' + r.id,
  };
}

/** Liste résumée. Filtres : pool, statut, competence, peripherique, recherche. null sans accès. */
function lister(lecteurId, { pool, statut, competence, peripherique, recherche, inclure_deprecies = true } = {}) {
  init();
  if (!peutLire(lecteurId)) return null;
  let l = db.prepare('SELECT * FROM metis_experts ORDER BY pool, nom').all();
  if (pool) l = l.filter((r) => r.pool === String(pool));
  if (statut) l = l.filter((r) => r.statut === String(statut));
  if (!inclure_deprecies) l = l.filter((r) => r.statut !== 'deprecie');
  if (competence) { const c = resoudreCompetence(competence); const avec = new Set(c ? db.prepare('SELECT expert FROM metis_expert_competences WHERE competence = ?').all(c.id).map((x) => x.expert) : []); l = l.filter((r) => avec.has(r.id)); }
  if (peripherique) l = l.filter((r) => json(r.donnees, {}).peripherique === peripherique);
  if (recherche) { const q = plat(recherche); l = l.filter((r) => plat(r.id + ' ' + r.nom + ' ' + r.donnees + ' ' + competencesDe(r.id).map((c) => c.nom).join(' ')).includes(q)); }
  const ordre = new Map(db.prepare('SELECT id, ordre FROM metis_pools').all().map((p) => [p.id, p.ordre]));
  // Par pool, puis les dépréciés en dernier dans leur pool, puis par nom.
  const rangPool = (p) => (ordre.has(p) ? ordre.get(p) : 999);
  return l.sort((a, b) => rangPool(a.pool) - rangPool(b.pool) || (a.statut === 'deprecie') - (b.statut === 'deprecie') || a.nom.localeCompare(b.nom, 'fr')).map(resume);
}

function relationsDe(id) {
  const noms = new Map(db.prepare('SELECT id, nom FROM metis_experts').all().map((x) => [x.id, x.nom]));
  const f = (x, autre) => ({ de: x.de, vers: x.vers, type: x.type, libelle: LIB_RELATION[x.type] || x.type, detail: x.detail, autre, autreNom: noms.get(autre) || autre, existe: noms.has(autre) });
  return {
    sortantes: db.prepare('SELECT * FROM metis_expert_relations WHERE de = ? ORDER BY type, vers').all(id).map((x) => f(x, x.vers)),
    entrantes: db.prepare('SELECT * FROM metis_expert_relations WHERE vers = ? ORDER BY type, de').all(id).map((x) => f(x, x.de)),
  };
}

/** L'expert complet : fiche, compétences, relations, mesures, révisions. null sans accès. */
function lire(lecteurId, id, { revision } = {}) {
  init();
  if (!peutLire(lecteurId)) return null;
  const r = ligneExpert(id);
  if (!r) return { ok: false, error: 'Expert introuvable : ' + id + '. lister_experts donne les identifiants.' };
  let d = json(r.donnees, {}), comps = competencesDe(r.id), ancienne = false, rev = r.revision;
  if (revision && Number(revision) !== r.revision) {
    const v = db.prepare('SELECT * FROM metis_experts_revisions WHERE expert = ? AND revision = ?').get(r.id, Number(revision));
    if (!v) return { ok: false, error: 'Révision inconnue : ' + revision + ' (courante : ' + r.revision + ').' };
    d = json(v.donnees, {}); comps = json(v.competences, []); ancienne = true; rev = v.revision;
  }
  const benchIds = [...new Set(comps.map((c) => c.benchmark).filter(Boolean))];
  return {
    ok: true, id: r.id, nom: r.nom, pool: r.pool, statut: r.statut, revision: rev, ancienne, ...d,
    // Le pool principal reste accessible à tout expert : ce qu'il y lit et y écrit est dit ici.
    pool_principal: (poolPrincipal() || {}).id || null,
    acces_principal: { lit: [], ecrit: [], ...(d.acces_principal || {}) },
    competences: comps,
    benchmarks: benchIds.map((b) => benchmarkPublic(db.prepare('SELECT * FROM metis_benchmarks WHERE id = ?').get(b)) || { id: b, inconnu: true }),
    relations: relationsDe(r.id),
    mesures: db.prepare('SELECT * FROM metis_expert_mesures WHERE expert = ? ORDER BY le DESC, id DESC LIMIT 50').all(r.id).map(mesurePublique),
    revisions: db.prepare('SELECT revision, motif, auteur, le FROM metis_experts_revisions WHERE expert = ? ORDER BY revision').all(r.id),
    source: r.source, auteur: r.auteur, creeLe: r.cree_le, majLe: r.maj_le, url: 'https://plagnito.com/metis/experts/' + r.id,
  };
}
const mesurePublique = (m) => ({ id: m.id, competence: m.competence, benchmark: m.benchmark, metrique: m.metrique, valeur: m.valeur, niveau: m.niveau, detail: m.detail, source: m.source, auteur: m.auteur, le: m.le });
const benchmarkPublic = (b) => (b ? { id: b.id, nom: b.nom, description: b.description, competence: b.competence, metrique: b.metrique, unite: b.unite, sens: b.sens, url: b.url } : null);

function resoudreCompetence(c) {
  const k = String(c || '').trim();
  if (!k) return null;
  return db.prepare('SELECT * FROM metis_competences WHERE id = ?').get(k)
    || db.prepare('SELECT * FROM metis_competences').all().find((x) => plat(x.nom) === plat(k) || plat(x.id) === plat(k)) || null;
}

/** Toutes les compétences, avec les experts qui les portent. Filtres : domaine, recherche. */
function competences(lecteurId, { domaine, recherche } = {}) {
  init();
  if (!peutLire(lecteurId)) return null;
  let l = db.prepare('SELECT * FROM metis_competences ORDER BY domaine, nom').all();
  if (domaine) l = l.filter((c) => plat(c.domaine) === plat(domaine));
  if (recherche) { const q = plat(recherche); l = l.filter((c) => plat(c.id + ' ' + c.nom + ' ' + c.description + ' ' + c.domaine).includes(q)); }
  const liens = db.prepare('SELECT ec.*, e.nom AS expertNom, e.statut FROM metis_expert_competences ec JOIN metis_experts e ON e.id = ec.expert').all();
  return l.map((c) => {
    const ex = liens.filter((x) => x.competence === c.id);
    return { id: c.id, nom: c.nom, domaine: c.domaine, description: c.description, url: 'https://plagnito.com/metis/experts/competence/' + c.id,
      experts: ex.length, mesures: ex.filter((x) => x.niveau_mesure != null).length,
      benchmarks: db.prepare('SELECT id FROM metis_benchmarks WHERE competence = ?').all(c.id).map((b) => b.id) };
  });
}

/**
 * Les experts capables d'une compétence (ou de TOUTES celles d'une liste), classés pour
 * le routage : niveau effectif (mesuré s'il existe, sinon déclaré), mesuré avant déclaré,
 * priorité de routage, dépréciés en dernier. Chaque résultat dit D'OÙ vient son niveau.
 */
function chercherParCompetence(lecteurId, { competence, competences: plusieurs, niveau_min, mesure_seulement = false, pool, statut, inclure_deprecies = false } = {}) {
  init();
  if (!peutLire(lecteurId)) return null;
  const demandees = (plusieurs && plusieurs.length ? plusieurs : [competence]).filter(Boolean);
  if (!demandees.length) return { ok: false, error: 'competence (ou competences : une liste) est obligatoire. lister_competences donne les identifiants.' };
  const cs = [];
  for (const d of demandees) { const c = resoudreCompetence(d); if (!c) return { ok: false, error: 'Compétence inconnue : ' + d + '. lister_competences donne les identifiants.' }; cs.push(c); }
  const min = niveau_min == null ? null : Number(niveau_min);
  const res = [];
  for (const r of db.prepare('SELECT * FROM metis_experts').all()) {
    if (pool && r.pool !== pool) continue;
    if (statut && r.statut !== statut) continue;
    if (!inclure_deprecies && !statut && r.statut === 'deprecie') continue;
    const comps = competencesDe(r.id);
    const couvre = cs.map((c) => comps.find((x) => x.competence === c.id));
    if (couvre.some((x) => !x)) continue;
    const niveaux = couvre.map((x) => (mesure_seulement ? x.niveau_mesure : x.niveau_effectif));
    if (mesure_seulement && niveaux.some((n) => n == null)) continue;
    const connu = niveaux.every((n) => n != null);
    const effectif = connu ? Math.min(...niveaux) : null;
    if (min != null && (effectif == null || effectif < min)) continue;
    const d = json(r.donnees, {});
    res.push({ id: r.id, nom: r.nom, pool: r.pool, statut: r.statut, niveau: effectif,
      source_niveau: couvre.every((x) => x.niveau_mesure != null) ? 'mesure' : couvre.some((x) => x.niveau_effectif != null) ? 'declare' : 'inconnu',
      detail: couvre.map((x) => ({ competence: x.competence, rang: x.rang, niveau_declare: x.niveau_declare, niveau_mesure: x.niveau_mesure, benchmark: x.benchmark })),
      routage: d.routage || null, peripherique: d.peripherique || null, chargement: d.chargement ? d.chargement.etat || null : null,
      latence: d.latence || null, memoire: d.memoire || null, cout: d.cout || null, url: 'https://plagnito.com/metis/experts/' + r.id });
  }
  const poidsSource = { mesure: 0, declare: 1, inconnu: 2 };
  res.sort((a, b) => (a.statut === 'deprecie') - (b.statut === 'deprecie') || (b.niveau == null ? -1 : b.niveau) - (a.niveau == null ? -1 : a.niveau)
    || poidsSource[a.source_niveau] - poidsSource[b.source_niveau] || ((b.routage && b.routage.priorite) || 0) - ((a.routage && a.routage.priorite) || 0) || a.nom.localeCompare(b.nom, 'fr'));
  return { ok: true, competences: cs.map((c) => ({ id: c.id, nom: c.nom })), experts: res,
    note: 'niveau = le plus faible des compétences demandées ; mesuré s’il existe, sinon déclaré. null = inconnu, pas nul.' };
}

function pools(lecteurId) {
  init();
  if (!peutLire(lecteurId)) return null;
  return db.prepare('SELECT * FROM metis_pools ORDER BY ordre, nom').all().map((p) => poolPublic(p));
}
/** Un pool et ses experts (le pool principal : ses ressources et TOUS les experts, qui y ont accès). */
function pool(lecteurId, id) {
  init();
  if (!peutLire(lecteurId)) return null;
  const p = lignePool(id);
  if (!p) return { ok: false, error: 'Pool introuvable : ' + id + '. lister_pools donne les identifiants.' };
  const experts = lister(lecteurId, p.type === 'principal' ? {} : { pool: p.id });
  const couvre = {};
  for (const x of experts) for (const c of x.competences) couvre[c.competence] = (couvre[c.competence] || 0) + 1;
  return { ok: true, ...poolPublic(p), experts, competences: Object.entries(couvre).map(([competence, n]) => ({ competence, experts: n })).sort((a, b) => b.experts - a.experts) };
}
function benchmarks(lecteurId, { competence } = {}) {
  init();
  if (!peutLire(lecteurId)) return null;
  return db.prepare('SELECT * FROM metis_benchmarks ORDER BY nom').all().filter((b) => !competence || b.competence === competence).map(benchmarkPublic);
}
function historiqueMesures(lecteurId, id, { competence, metrique, limite = 200 } = {}) {
  init();
  if (!peutLire(lecteurId)) return null;
  let l = db.prepare('SELECT * FROM metis_expert_mesures WHERE expert = ? ORDER BY le, id').all(String(id));
  if (competence) l = l.filter((m) => m.competence === competence);
  if (metrique) l = l.filter((m) => m.metrique === metrique);
  return l.slice(-Math.min(Number(limite) || 200, 1000)).map(mesurePublique);
}

// ── Écriture ─────────────────────────────────────────────────────────────────

function instantane(id, motif, auteur) {
  const r = ligneExpert(id);
  db.prepare('INSERT OR REPLACE INTO metis_experts_revisions (expert, revision, donnees, competences, motif, auteur, le) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(r.id, r.revision, r.donnees, JSON.stringify(competencesDe(r.id)), propre(motif, 300), propre(auteur, 60), maintenant());
}
function reviser(id, donnees, { motif, auteur, source }) {
  const r = ligneExpert(id);
  const rev = r.revision + 1;
  db.prepare('UPDATE metis_experts SET donnees = ?, nom = ?, pool = ?, statut = ?, revision = ?, maj_le = ?, auteur = ?, source = ? WHERE id = ?')
    .run(JSON.stringify(donnees), donnees.nom, donnees.pool, donnees.statut, rev, maintenant(), propre(auteur, 60), source || 'en_ligne', id);
  // Toute écriture hors graine (mesure, compétences, entraînement) détache l'expert du fichier :
  // une mise à jour de experts.json ne doit pas effacer une mesure faite en ligne.
  instantane(id, motif, auteur);
  return rev;
}
function verifierPool(p, e) {
  if (p === undefined) return;
  const l = lignePool(p);
  if (!l) e.push('pool « ' + p + ' » n’existe pas. lister_pools donne les pools ; definir_pool en crée un.');
  else if (l.type === 'principal') e.push('pool : un expert appartient à un pool de CAPACITÉ ; le pool principal (« ' + p + ' ») est partagé par tous et accessible sans y être rattaché.');
}
function verifierAcces(a, e) {
  if (!a) return;
  const p = poolPrincipal();
  const noms = new Set(p ? json(p.ressources, []).map((r) => plat(r.nom)) : []);
  for (const k of ['lit', 'ecrit']) for (const n of a[k] || []) if (!noms.has(plat(n))) e.push('acces_principal.' + k + ' : « ' + n + ' » n’est pas une ressource du pool principal (' + [...(p ? json(p.ressources, []) : [])].map((r) => r.nom).join(', ') + ').');
}

// Un expert nommé ailleurs dans la fiche doit exister (ou être l'expert lui-même).
function verifierReferences(ch, id, e) {
  for (const [c, v] of [['routage.repli', ch.routage && ch.routage.repli], ['composition.base', ch.composition && ch.composition.base], ['retrait.remplace_par', ch.retrait && ch.retrait.remplace_par]]) {
    if (!v) continue;
    if (v === id) { e.push(c + ' : un expert ne se désigne pas lui-même.'); continue; }
    if (!ligneExpert(v)) e.push(c + ' : aucun expert « ' + v + ' » (crée-le d’abord).');
  }
}

/** Crée un expert. id (kebab-case), nom, pool, role obligatoires ; competences facultatives. */
function creerExpert(auteurId, b, { auteur = 'ChatGPT', source = 'chatgpt', forcer = false } = {}) {
  init();
  if (!forcer && !peutEcrire(auteurId)) return REFUS;
  b = b || {};
  const e = [];
  const id = String(b.id || '').trim();
  if (!ID_RE.test(id)) e.push('id : minuscules, chiffres et tirets (2 à 60 caractères), reçu ' + JSON.stringify(b.id) + '.');
  else if (ligneExpert(id)) e.push('Un expert porte déjà l’id « ' + id + ' » : modifier_expert le modifie.');
  const ch = validerChamps(b, e);
  for (const k of ['nom', 'pool', 'role']) if (!ch[k]) e.push(k + ' est obligatoire.');
  verifierPool(ch.pool, e);
  verifierAcces(ch.acces_principal, e);
  verifierReferences(ch, id, e);
  const comps = b.competences !== undefined ? validerCompetences(b.competences, e) : [];
  if (e.length) return { ok: false, error: e.join(' '), erreurs: e };
  const d = { statut: 'experimental', ...ch };
  const t = maintenant();
  db.exec('BEGIN');
  try {
    db.prepare('INSERT INTO metis_experts (id, pool, nom, statut, revision, donnees, source, auteur, cree_le, maj_le) VALUES (?, ?, ?, ?, 1, ?, ?, ?, ?, ?)')
      .run(id, d.pool, d.nom, d.statut, JSON.stringify(d), source, propre(auteur, 60), t, t);
    ecrireCompetences(id, comps, []);
    instantane(id, b.motif || 'création', auteur);
    db.exec('COMMIT');
  } catch (err) { db.exec('ROLLBACK'); throw err; }
  logger.info('metis', 'expert créé : ' + id);
  return { ok: true, expert: resume(ligneExpert(id)) };
}

/**
 * Modifie les champs d'un expert. revision_attendue OBLIGATOIRE. Les sous-objets (routage,
 * latence…) sont FUSIONNÉS clé par clé ; null efface un champ ou une clé.
 */
function modifierExpert(auteurId, id, b, { auteur = 'ChatGPT', source = 'chatgpt', forcer = false } = {}) {
  init();
  if (!forcer && !peutEcrire(auteurId)) return REFUS;
  b = b || {};
  const r = ligneExpert(id);
  if (!r) return { ok: false, error: 'Expert introuvable : ' + id + '.' };
  if (!Number.isInteger(Number(b.revision_attendue)) || b.revision_attendue === undefined || b.revision_attendue === null) return { ok: false, error: 'revision_attendue est obligatoire (lire_expert la donne : révision courante ' + r.revision + ').' };
  if (Number(b.revision_attendue) !== r.revision) return { ok: false, conflit: true, revisionEnLigne: r.revision, error: 'L’expert a changé depuis ta lecture (révision ' + r.revision + ', tu annonces ' + b.revision_attendue + '). Relis-le avec lire_expert, puis refais la modification.' };
  const e = [];
  if (b.id !== undefined && b.id !== id) e.push('id ne se modifie pas (crée un nouvel expert et déclare une relation « remplace »).');
  const ch = validerChamps(b, e);
  for (const k of ['nom', 'pool', 'role']) if (ch[k] === '') e.push(k + ' ne peut pas être vidé.');
  verifierPool(ch.pool, e);
  verifierAcces(ch.acces_principal, e);
  verifierReferences(ch, id, e);
  const comps = b.competences !== undefined ? validerCompetences(b.competences, e) : null;
  if (e.length) return { ok: false, error: e.join(' '), erreurs: e };
  const d = json(r.donnees, {});
  for (const [k, v] of Object.entries(ch)) {
    if (v === null || v === '') { delete d[k]; continue; }
    if (OBJETS_FUSIONNES.includes(k) && d[k] && typeof d[k] === 'object') { d[k] = { ...d[k], ...v }; for (const [kk, vv] of Object.entries(v)) if (vv === null) delete d[k][kk]; } else d[k] = v;
  }
  db.exec('BEGIN');
  try {
    if (comps) ecrireCompetences(id, comps, []);
    reviser(id, d, { motif: b.motif || 'modification : ' + Object.keys(ch).concat(comps ? ['competences'] : []).join(', '), auteur, source });
    db.exec('COMMIT');
  } catch (err) { db.exec('ROLLBACK'); throw err; }
  return { ok: true, expert: resume(ligneExpert(id)) };
}

function validerCompetences(l, e) {
  if (!Array.isArray(l) || l.length > 40) { e.push('competences doit être une liste (au plus 40) de { competence, rang?, niveau_declare?, niveau_mesure?, benchmark?, note? }.'); return []; }
  const out = [];
  for (const [k, x] of l.entries()) {
    const c = `competences[${k}]`;
    const o = typeof x === 'string' ? { competence: x } : x;
    if (!o || typeof o !== 'object') { e.push(c + ' doit être un objet.'); continue; }
    const inconnus = Object.keys(o).filter((kk) => !['competence', 'rang', 'niveau_declare', 'niveau_mesure', 'benchmark', 'note'].includes(kk));
    if (inconnus.length) e.push(c + ' : champ inconnu ' + inconnus.join(', ') + '.');
    const comp = resoudreCompetence(o.competence);
    if (!comp) { e.push(c + '.competence « ' + o.competence + ' » n’existe pas : definir_competence la crée (lister_competences les donne).'); continue; }
    const rang = o.rang === undefined ? undefined : choix(o.rang, RANGS, c + '.rang', e);
    const nd = niveau(o.niveau_declare, c + '.niveau_declare', e);
    const nm = niveau(o.niveau_mesure, c + '.niveau_mesure', e);
    if (o.benchmark != null && !db.prepare('SELECT 1 FROM metis_benchmarks WHERE id = ?').get(String(o.benchmark))) e.push(c + '.benchmark « ' + o.benchmark + ' » n’existe pas : definir_benchmark le crée.');
    out.push(sansVides({ competence: comp.id, rang, niveau_declare: nd, niveau_mesure: nm, benchmark: o.benchmark === undefined ? undefined : o.benchmark, note: o.note === undefined ? undefined : propre(o.note, 500) }));
  }
  return out;
}
function ecrireCompetences(id, liste_, retirer) {
  const t = maintenant();
  for (const c of liste_) {
    const ex = db.prepare('SELECT * FROM metis_expert_competences WHERE expert = ? AND competence = ?').get(id, c.competence);
    const val = (k, def) => (c[k] !== undefined ? c[k] : ex ? ex[k] : def);
    const nm = val('niveau_mesure', null);
    db.prepare(`INSERT INTO metis_expert_competences (expert, competence, rang, niveau_declare, niveau_mesure, mesure_le, benchmark, note, maj_le) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(expert, competence) DO UPDATE SET rang=excluded.rang, niveau_declare=excluded.niveau_declare, niveau_mesure=excluded.niveau_mesure, mesure_le=excluded.mesure_le, benchmark=excluded.benchmark, note=excluded.note, maj_le=excluded.maj_le`)
      .run(id, c.competence, val('rang', 'secondaire'), val('niveau_declare', null), nm,
        c.niveau_mesure !== undefined ? (nm == null ? null : t) : ex ? ex.mesure_le : null, val('benchmark', null), val('note', ''), t);
  }
  for (const c of retirer) db.prepare('DELETE FROM metis_expert_competences WHERE expert = ? AND competence = ?').run(id, c);
}

/** Ajoute, modifie ou retire des compétences d'un expert (niveaux compris) — une nouvelle révision. */
function majCompetences(auteurId, id, b, { auteur = 'ChatGPT' } = {}) {
  init();
  if (!peutEcrire(auteurId)) return REFUS;
  b = b || {};
  const r = ligneExpert(id);
  if (!r) return { ok: false, error: 'Expert introuvable : ' + id + '.' };
  const e = [];
  const l = b.competences === undefined ? [] : validerCompetences(b.competences, e);
  const retirer = [];
  for (const x of b.retirer || []) { const c = resoudreCompetence(x); if (!c) e.push('retirer : compétence inconnue « ' + x + ' ».'); else retirer.push(c.id); }
  if (!l.length && !retirer.length && !e.length) e.push('Rien à faire : donne competences (à ajouter ou modifier) et/ou retirer (identifiants).');
  if (e.length) return { ok: false, error: e.join(' '), erreurs: e };
  db.exec('BEGIN');
  try {
    ecrireCompetences(id, l, retirer);
    reviser(id, json(r.donnees, {}), { motif: b.motif || 'compétences : ' + l.map((c) => c.competence).concat(retirer.map((c) => '−' + c)).join(', '), auteur });
    db.exec('COMMIT');
  } catch (err) { db.exec('ROLLBACK'); throw err; }
  return { ok: true, expert: resume(ligneExpert(id)), competences: competencesDe(id) };
}

/**
 * Enregistre des mesures (historique gardé). Une mesure avec competence + niveau met à jour
 * le niveau MESURÉ ; latence_p50_ms, latence_p95_ms, debit_jetons_s, vram_mo, ram_mo et cout
 * mettent à jour la fiche technique (marquée « mesurée »).
 */
function enregistrerMesures(auteurId, id, b, { auteur = 'ChatGPT' } = {}) {
  init();
  if (!peutEcrire(auteurId)) return REFUS;
  b = b || {};
  const r = ligneExpert(id);
  if (!r) return { ok: false, error: 'Expert introuvable : ' + id + '.' };
  const e = [];
  const l = Array.isArray(b.mesures) ? b.mesures : null;
  if (!l || !l.length || l.length > 100) return { ok: false, error: 'mesures doit être une liste (1 à 100) de { metrique, valeur, competence?, benchmark?, niveau? (0-100), detail?, le? }.' };
  const propres = [];
  for (const [k, m] of l.entries()) {
    const c = 'mesures[' + k + ']';
    if (!m || typeof m !== 'object') { e.push(c + ' doit être un objet.'); continue; }
    const metrique = propre(m.metrique || (m.niveau != null ? 'niveau' : ''), 60);
    if (!metrique) e.push(c + '.metrique est obligatoire (ex. niveau, exactitude, latence_p50_ms, vram_mo).');
    const valeur = nombre(m.valeur !== undefined ? m.valeur : m.niveau, c + '.valeur', e, { min: -Infinity });
    const niv = niveau(m.niveau, c + '.niveau', e) ?? null;
    let comp = null;
    if (m.competence != null) { comp = resoudreCompetence(m.competence); if (!comp) e.push(c + '.competence « ' + m.competence + ' » inconnue.'); }
    if (m.benchmark != null && !db.prepare('SELECT 1 FROM metis_benchmarks WHERE id = ?').get(String(m.benchmark))) e.push(c + '.benchmark « ' + m.benchmark + ' » inconnu : definir_benchmark le crée.');
    if (niv != null && !comp) e.push(c + ' : un niveau (0-100) se rapporte à une compétence — donne competence.');
    if (comp && niv != null && !db.prepare('SELECT 1 FROM metis_expert_competences WHERE expert = ? AND competence = ?').get(id, comp.id)) e.push(c + ' : l’expert n’a pas la compétence « ' + comp.id + ' » (mettre_a_jour_competences l’ajoute).');
    const le = m.le ? new Date(m.le) : new Date();
    if (isNaN(le)) e.push(c + '.le : date ISO attendue.');
    if (valeur == null && valeur !== 0) e.push(c + '.valeur est obligatoire.');
    propres.push({ metrique, valeur, niveau: niv, competence: comp ? comp.id : null, benchmark: m.benchmark != null ? String(m.benchmark) : null, detail: propre(m.detail, 500), le: isNaN(le) ? '' : le.toISOString() });
  }
  if (e.length) return { ok: false, error: e.join(' '), erreurs: e };
  const source = propre(b.source, 80) || 'mesure';
  const d = json(r.donnees, {});
  let fiche = false;
  db.exec('BEGIN');
  try {
    for (const m of propres) {
      db.prepare('INSERT INTO metis_expert_mesures (expert, competence, benchmark, metrique, valeur, niveau, detail, source, auteur, le) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
        .run(id, m.competence, m.benchmark, m.metrique, m.valeur, m.niveau, m.detail, source, propre(auteur, 60), m.le);
      if (m.competence && m.niveau != null) {
        // La plus RÉCENTE mesure fait foi (une mesure rétrodatée ne remplace pas une plus fraîche).
        const ex = db.prepare('SELECT mesure_le FROM metis_expert_competences WHERE expert = ? AND competence = ?').get(id, m.competence);
        if (!ex.mesure_le || ex.mesure_le <= m.le) db.prepare('UPDATE metis_expert_competences SET niveau_mesure = ?, mesure_le = ?, benchmark = COALESCE(?, benchmark), maj_le = ? WHERE expert = ? AND competence = ?').run(m.niveau, m.le, m.benchmark, maintenant(), id, m.competence);
      }
      const cible = METRIQUES_FICHE[m.metrique];
      if (cible) {
        d[cible[0]] = { ...(d[cible[0]] || {}), [cible[1]]: m.valeur };
        if (cible[0] !== 'cout') d[cible[0]].mesuree = true;
        fiche = true;
      }
    }
    // Les niveaux mesurés changent ce que dit la fiche : une révision les garde.
    reviser(id, fiche ? d : json(r.donnees, {}), { motif: b.motif || 'mesures : ' + propres.map((m) => m.metrique + (m.competence ? ' (' + m.competence + ')' : '')).join(', '), auteur });
    db.exec('COMMIT');
  } catch (err) { db.exec('ROLLBACK'); throw err; }
  return { ok: true, enregistrees: propres.length, expert: resume(ligneExpert(id)) };
}

/** Ajoute un événement à l'historique d'entraînement ; peut changer l'état, le checkpoint, les datasets. */
function journaliserEntrainement(auteurId, id, b, { auteur = 'ChatGPT' } = {}) {
  init();
  if (!peutEcrire(auteurId)) return REFUS;
  b = b || {};
  const r = ligneExpert(id);
  if (!r) return { ok: false, error: 'Expert introuvable : ' + id + '.' };
  const e = [];
  const ev = propre(b.evenement, 200);
  if (!ev) e.push('evenement est obligatoire (ex. « run alpha_31m_fused terminé, 48 000 pas »).');
  const etat = choix(b.etat, ENTRAINEMENTS, 'etat', e);
  const ds = b.datasets !== undefined ? datasets(b.datasets, 'datasets', e) : undefined;
  if (e.length) return { ok: false, error: e.join(' '), erreurs: e };
  const d = json(r.donnees, {});
  const en = { ...(d.entrainement || {}) };
  en.historique = [...(en.historique || []), sansVides({ le: b.le ? propre(b.le, 40) : maintenant(), evenement: ev, detail: b.detail ? propre(b.detail, 1000) : undefined, checkpoint: b.checkpoint ? propre(b.checkpoint, 200) : undefined })].slice(-300);
  if (etat) en.etat = etat;
  if (b.checkpoint) en.checkpoint = propre(b.checkpoint, 200);
  if (b.recette) en.recette = propre(b.recette, 200);
  d.entrainement = en;
  if (ds) { const noms = new Set((d.datasets || []).map((x) => plat(x.nom))); d.datasets = [...(d.datasets || []), ...ds.filter((x) => !noms.has(plat(x.nom)))].slice(0, 40); }
  const rev = reviser(id, d, { motif: 'entraînement : ' + ev, auteur });
  return { ok: true, revision: rev, entrainement: en };
}

/** Déclare (ou retire, avec retirer: true) une relation orientée entre deux experts. */
function declarerRelation(auteurId, b, { auteur = 'ChatGPT', source = 'chatgpt', forcer = false } = {}) {
  init();
  if (!forcer && !peutEcrire(auteurId)) return REFUS;
  b = b || {};
  const e = [];
  const de = String(b.de || ''), vers = String(b.vers || '');
  if (!ligneExpert(de)) e.push('de : aucun expert « ' + de + ' ».');
  if (!ligneExpert(vers)) e.push('vers : aucun expert « ' + vers + ' ».');
  if (de && de === vers) e.push('Une relation relie deux experts DIFFÉRENTS.');
  if (!RELATIONS.includes(b.type)) e.push('type doit valoir l’un de : ' + RELATIONS.join(', ') + ' (reçu ' + JSON.stringify(b.type) + ').');
  if (e.length) return { ok: false, error: e.join(' '), erreurs: e };
  if (b.retirer === true) {
    const x = db.prepare('DELETE FROM metis_expert_relations WHERE de = ? AND vers = ? AND type = ?').run(de, vers, b.type);
    return x.changes ? { ok: true, retiree: true } : { ok: false, error: 'Aucune relation « ' + de + ' ' + b.type + ' ' + vers + ' ».' };
  }
  // Un cycle de dépendances rendrait impossible l'ordre de chargement : refusé.
  if (b.type === 'depend_de' && dependDe(vers, de)) return { ok: false, error: 'Cycle : « ' + vers + ' » dépend déjà (directement ou non) de « ' + de + ' ».' };
  db.prepare(`INSERT INTO metis_expert_relations (de, vers, type, detail, source, auteur, le) VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(de, vers, type) DO UPDATE SET detail=excluded.detail, source=excluded.source, auteur=excluded.auteur, le=excluded.le`)
    .run(de, vers, b.type, propre(b.detail, 400), source, propre(auteur, 60), maintenant());
  return { ok: true, relation: { de, vers, type: b.type, libelle: LIB_RELATION[b.type], detail: propre(b.detail, 400) } };
}
function dependDe(a, b, vus = new Set()) {
  if (a === b) return true;
  if (vus.has(a)) return false;
  vus.add(a);
  return db.prepare("SELECT vers FROM metis_expert_relations WHERE de = ? AND type = 'depend_de'").all(a).some((x) => dependDe(x.vers, b, vus));
}
/** L'ordre de chargement qui respecte depend_de (dépendances d'abord) — pour le chargement dynamique. */
function ordreDeChargement(ids) {
  const vus = new Set(), ordre = [];
  const visiter = (id) => { if (vus.has(id)) return; vus.add(id); for (const x of db.prepare("SELECT vers FROM metis_expert_relations WHERE de = ? AND type = 'depend_de'").all(id)) visiter(x.vers); ordre.push(id); };
  for (const id of ids) visiter(id);
  return ordre;
}

function definirCompetence(auteurId, b, { auteur = 'ChatGPT', source = 'chatgpt', forcer = false } = {}) {
  init();
  if (!forcer && !peutEcrire(auteurId)) return REFUS;
  b = b || {};
  const e = [];
  const id = String(b.id || '').trim();
  if (!ID_RE.test(id)) e.push('id : minuscules, chiffres et tirets (2 à 60 caractères).');
  const ex = ID_RE.test(id) ? db.prepare('SELECT * FROM metis_competences WHERE id = ?').get(id) : null;
  const nom = b.nom !== undefined ? propre(b.nom, 100) : ex ? ex.nom : '';
  if (!nom) e.push('nom est obligatoire.');
  if (e.length) return { ok: false, error: e.join(' '), erreurs: e };
  db.prepare(`INSERT INTO metis_competences (id, nom, domaine, description, source, auteur, maj_le) VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET nom=excluded.nom, domaine=excluded.domaine, description=excluded.description, source=excluded.source, auteur=excluded.auteur, maj_le=excluded.maj_le`)
    .run(id, nom, b.domaine !== undefined ? propre(b.domaine, 60) : ex ? ex.domaine : '', b.description !== undefined ? propre(b.description, 1500) : ex ? ex.description : '', source, propre(auteur, 60), maintenant());
  return { ok: true, cree: !ex, competence: { id, nom } };
}
function definirBenchmark(auteurId, b, { auteur = 'ChatGPT', source = 'chatgpt', forcer = false } = {}) {
  init();
  if (!forcer && !peutEcrire(auteurId)) return REFUS;
  b = b || {};
  const e = [];
  const id = String(b.id || '').trim();
  if (!ID_RE.test(id)) e.push('id : minuscules, chiffres et tirets (2 à 60 caractères).');
  const ex = ID_RE.test(id) ? db.prepare('SELECT * FROM metis_benchmarks WHERE id = ?').get(id) : null;
  const v = (k, max) => (b[k] !== undefined ? propre(b[k], max) : ex ? ex[k] : '');
  if (!v('nom', 120)) e.push('nom est obligatoire.');
  if (b.competence != null && !resoudreCompetence(b.competence)) e.push('competence « ' + b.competence + ' » inconnue.');
  const sens = b.sens !== undefined ? choix(b.sens, SENS_BENCH, 'sens', e) : ex ? ex.sens : 'plus_haut';
  if (e.length) return { ok: false, error: e.join(' '), erreurs: e };
  const comp = b.competence !== undefined ? (b.competence == null ? null : resoudreCompetence(b.competence).id) : ex ? ex.competence : null;
  db.prepare(`INSERT INTO metis_benchmarks (id, nom, description, competence, metrique, unite, sens, url, source, auteur, maj_le) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET nom=excluded.nom, description=excluded.description, competence=excluded.competence, metrique=excluded.metrique, unite=excluded.unite, sens=excluded.sens, url=excluded.url, source=excluded.source, auteur=excluded.auteur, maj_le=excluded.maj_le`)
    .run(id, v('nom', 120), v('description', 1500), comp, v('metrique', 80), v('unite', 30), sens || 'plus_haut', v('url', 300), source, propre(auteur, 60), maintenant());
  return { ok: true, cree: !ex, benchmark: benchmarkPublic(db.prepare('SELECT * FROM metis_benchmarks WHERE id = ?').get(id)) };
}
function definirPool(auteurId, b, { auteur = 'ChatGPT', source = 'chatgpt', forcer = false } = {}) {
  init();
  if (!forcer && !peutEcrire(auteurId)) return REFUS;
  b = b || {};
  const e = [];
  const id = String(b.id || '').trim();
  if (!ID_RE.test(id)) e.push('id : minuscules, chiffres et tirets (2 à 60 caractères).');
  const ex = ID_RE.test(id) ? lignePool(id) : null;
  const type = b.type !== undefined ? choix(b.type, ['principal', 'capacite'], 'type', e) : ex ? ex.type : 'capacite';
  const principal = poolPrincipal();
  if (type === 'principal' && principal && principal.id !== id) e.push('Il n’y a qu’UN pool principal (« ' + principal.id + ' ») : modifie-le plutôt.');
  if (ex && type !== ex.type && ex.type === 'capacite' && db.prepare('SELECT 1 FROM metis_experts WHERE pool = ?').get(id)) e.push('Ce pool a des experts : il reste un pool de capacité.');
  const nom = b.nom !== undefined ? propre(b.nom, 80) : ex ? ex.nom : '';
  if (!nom) e.push('nom est obligatoire.');
  const couleur = b.couleur !== undefined ? nombre(b.couleur, 'couleur', e, { min: 1, max: 8, entier: true }) : ex ? ex.couleur : null;
  if (b.icone != null && !ICONES_PERMISES().includes(b.icone)) e.push('icone doit être une icône des planches.');
  let ressources = ex ? json(ex.ressources, []) : [];
  if (b.ressources !== undefined) {
    if (type !== 'principal') e.push('ressources : seul le pool principal en porte (communication, connaissances communes).');
    else if (!Array.isArray(b.ressources) || b.ressources.length > 40) e.push('ressources doit être une liste (au plus 40) de { nom, type (communication|connaissance|memoire), etat? (en_service|propose), detail? }.');
    else {
      ressources = [];
      for (const [k, x] of b.ressources.entries()) {
        const o = sousObjet(x, 'ressources[' + k + ']', e, { nom: (v, c, ee) => texte(v, 60, c, ee, { requis: true }), type: (v, c, ee) => choix(v, TYPES_RESSOURCE, c, ee), etat: (v, c, ee) => choix(v, ETATS_RESSOURCE, c, ee), detail: (v, c, ee) => texte(v, 400, c, ee) });
        if (o) ressources.push({ type: 'connaissance', etat: 'propose', ...o });
      }
    }
  }
  if (e.length) return { ok: false, error: e.join(' '), erreurs: e };
  const v = (k, max) => (b[k] !== undefined ? propre(b[k], max) : ex ? ex[k] : '');
  db.prepare(`INSERT INTO metis_pools (id, nom, type, role, description, couleur, icone, ressources, ordre, source, auteur, maj_le) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET nom=excluded.nom, type=excluded.type, role=excluded.role, description=excluded.description, couleur=excluded.couleur, icone=excluded.icone, ressources=excluded.ressources, ordre=excluded.ordre, source=excluded.source, auteur=excluded.auteur, maj_le=excluded.maj_le`)
    .run(id, nom, type, v('role', 300), v('description', 2000), couleur, v('icone', 30), JSON.stringify(ressources), b.ordre !== undefined && Number.isFinite(Number(b.ordre)) ? Math.round(Number(b.ordre)) : ex ? ex.ordre : 100, source, propre(auteur, 60), maintenant());
  return { ok: true, cree: !ex, pool: poolPublic(lignePool(id)) };
}

// ── Données pour les schémas de l'architecture ───────────────────────────────

/**
 * Tout ce qu'il faut pour dessiner l'architecture : pools, experts, relations, compétences,
 * ressources partagées — et deux spécifications PRÊTES (et validées) pour graphiques.js :
 * un schéma (experts reliés, groupés par pool) et une planche (un bloc par pool).
 */
function donneesArchitecture(lecteurId, { pool: filtrePool, inclure_deprecies = true } = {}) {
  init();
  if (!peutLire(lecteurId)) return null;
  const G = require('./graphiques');
  const ps = pools(lecteurId);
  const principal = ps.find((p) => p.type === 'principal') || null;
  let experts = lister(lecteurId, { inclure_deprecies });
  if (filtrePool) experts = experts.filter((x) => x.pool === filtrePool);
  const ids = new Set(experts.map((x) => x.id));
  const relations = db.prepare('SELECT * FROM metis_expert_relations ORDER BY de, vers').all().filter((r) => ids.has(r.de) && ids.has(r.vers))
    .map((r) => ({ de: r.de, vers: r.vers, type: r.type, libelle: LIB_RELATION[r.type], detail: r.detail }));
  const capacites = ps.filter((p) => p.type === 'capacite' && (!filtrePool || p.id === filtrePool));
  const nomComp = new Map(db.prepare('SELECT id, nom FROM metis_competences').all().map((c) => [c.id, c.nom]));

  const couleurDe = (p, i) => p.couleur || (i % 8) + 1;
  const schema = { type: 'schema', titre: 'Registre des experts Métis' + (filtrePool ? ' — ' + (capacites[0] || {}).nom : ''), sousTitre: experts.length + ' experts, ' + relations.length + ' relations', sens: 'droite',
    groupes: capacites.map((p, i) => ({ id: 'pool-' + p.id, texte: p.nom, couleur: couleurDe(p, i) })),
    noeuds: experts.map((x) => ({ id: x.id, texte: x.nom, groupe: 'pool-' + x.pool, detail: x.role + (x.statut !== 'stable' ? ' (' + LIB_STATUT[x.statut].toLowerCase() + ')' : ''), forme: x.statut === 'deprecie' ? 'note' : x.peripherique === 'distant' ? 'externe' : 'boite' })),
    liens: relations.map((r) => ({ de: r.de, vers: r.vers, texte: r.libelle, style: ['verifie', 'supervise', 'complete'].includes(r.type) ? 'pointille' : r.type === 'depend_de' ? 'epais' : 'plein' })) };
  // La planche : un bloc par pool de capacité (au plus 10 experts par bloc), le pool principal en socle.
  const blocs = [], categories = capacites.slice(0, 9).map((p, i) => ({ id: 'c-' + p.id, nom: p.nom, couleur: couleurDe(p, i) }));
  let col = 1;
  for (const p of capacites) {
    const du = experts.filter((x) => x.pool === p.id);
    for (let k = 0; k < Math.max(1, Math.ceil(du.length / 10)); k++) {
      if (col > 10) col = 1;
      blocs.push({ id: 'b-' + p.id + (k ? '-' + k : ''), titre: p.nom + (k ? ' (suite)' : ''), icone: p.icone || undefined, categorie: categories.some((c) => c.id === 'c-' + p.id) ? 'c-' + p.id : undefined, col, largeur: 3,
        ...(du.length ? { elements: du.slice(k * 10, k * 10 + 10).map((x) => ({ titre: x.nom, icone: x.icone || undefined, texte: [LIB_STATUT[x.statut], x.peripherique ? LIB_PERIPH[x.peripherique] : null, x.version || null].filter(Boolean).join(' · ') })) } : { texte: 'Aucun expert pour l’instant.' }) });
      col += 3;
    }
  }
  if (principal && !filtrePool) blocs.push({ id: 'b-principal', titre: principal.nom, sousTitre: 'accessible à tous les experts', icone: principal.icone || 'reseau', col: 1, largeur: 12, disposition: 'ligne', style: 'tirets',
    elements: (principal.ressources || []).slice(0, 10).map((r) => ({ titre: r.nom, texte: (r.type ? r.type : '') + (r.etat === 'propose' ? ' · proposé' : '') })) });
  const liensPools = new Map();
  for (const r of relations) {
    const a = experts.find((x) => x.id === r.de).pool, b2 = experts.find((x) => x.id === r.vers).pool;
    if (a !== b2) { const k = a + '>' + b2; liensPools.set(k, (liensPools.get(k) || 0) + 1); }
  }
  const planche = { type: 'planche', titre: 'Architecture des experts Métis', sousTitre: 'Pools de capacité et pool principal partagé', colonnes: 12, largeur: 1320, categories, blocs,
    liens: [...liensPools.entries()].filter(([k]) => blocs.some((b) => b.id === 'b-' + k.split('>')[0]) && blocs.some((b) => b.id === 'b-' + k.split('>')[1])).slice(0, 80)
      .map(([k, n]) => ({ de: 'b-' + k.split('>')[0], vers: 'b-' + k.split('>')[1], texte: n > 1 ? n + ' relations' : undefined })) };
  const pret_ = (spec) => { const v = G.valider(spec); return v.ok ? v.spec : { erreurs: v.erreurs, spec }; };
  return {
    ok: true,
    pools: ps, pool_principal: principal ? { id: principal.id, nom: principal.nom, ressources: principal.ressources } : null,
    experts: experts.map((x) => ({ id: x.id, nom: x.nom, pool: x.pool, statut: x.statut, role: x.role, peripherique: x.peripherique, chargement: x.chargement, icone: x.icone,
      acces_principal: (json(ligneExpert(x.id).donnees, {}).acces_principal) || { lit: [], ecrit: [] }, competences: x.competences.map((c) => c.competence) })),
    relations,
    competences: [...new Set(experts.flatMap((x) => x.competences.map((c) => c.competence)))].map((c) => ({ id: c, nom: nomComp.get(c) || c, experts: experts.filter((x) => x.competences.some((y) => y.competence === c)).map((x) => x.id) })),
    ordre_de_chargement: ordreDeChargement(experts.map((x) => x.id)),
    graphiques: { schema: pret_(schema), planche: pret_(planche) },
    conseil: 'Les deux spécifications de graphiques sont prêtes : place-les dans un bloc ```graphique ou passe-les à creer_graphique, en les adaptant si besoin (valider_graphique vérifie).',
  };
}

function statistiques(lecteurId) {
  init();
  if (!peutLire(lecteurId)) return null;
  const n = (sql) => db.prepare(sql).get().n;
  return {
    experts: n('SELECT COUNT(*) n FROM metis_experts'), pools: n("SELECT COUNT(*) n FROM metis_pools WHERE type = 'capacite'"),
    competences: n('SELECT COUNT(*) n FROM metis_competences'), liens: n('SELECT COUNT(*) n FROM metis_expert_competences'),
    niveaux_mesures: n('SELECT COUNT(*) n FROM metis_expert_competences WHERE niveau_mesure IS NOT NULL'),
    niveaux_declares: n('SELECT COUNT(*) n FROM metis_expert_competences WHERE niveau_declare IS NOT NULL'),
    relations: n('SELECT COUNT(*) n FROM metis_expert_relations'), mesures: n('SELECT COUNT(*) n FROM metis_expert_mesures'),
    benchmarks: n('SELECT COUNT(*) n FROM metis_benchmarks'),
    parStatut: Object.fromEntries(db.prepare('SELECT statut, COUNT(*) n FROM metis_experts GROUP BY statut').all().map((x) => [x.statut, x.n])),
  };
}

// ── Graines : metis-plans/experts.json ───────────────────────────────────────
//  Comme les plans : une entité semée suit son fichier, SAUF si elle a été modifiée en
//  ligne (source ≠ graine) — on ne réécrit pas le travail de ChatGPT ou de Nolan.

function semer() { /* Each instance starts empty. No Atlas corpus. */ }

module.exports = {
  id: 'metisexperts', init,
  lister, lire, chercherParCompetence, competences, pools, pool, benchmarks, historiqueMesures,
  creerExpert, modifierExpert, majCompetences, enregistrerMesures, journaliserEntrainement,
  declarerRelation, definirCompetence, definirBenchmark, definirPool,
  donneesArchitecture, ordreDeChargement, statistiques, semer, resoudreCompetence,
  CHAMPS: Object.keys(CHAMPS), STATUTS, LIB_STATUT, RANGS, RELATIONS, LIB_RELATION, PERIPHERIQUES, LIB_PERIPH,
  TYPES, LIB_TYPE, AXES, LIB_AXE, MATURITES, LIB_MATURITE, STRATEGIES_COMPOSITION, SOUS_ESPACES, CLASSES_AUDIT, PROMOTIONS,
  CHARGEMENTS, LIB_CHARGEMENT, ENTRAINEMENTS, LIB_ENTRAINEMENT, STRATEGIES, COUTS, LIB_COUT, ROLES_DATASET, TYPES_RESSOURCE, SENS_BENCH,
};
require('./metis-research-journal').bindWriters(module.exports, ['creerExpert', 'modifierExpert', 'majCompetences', 'enregistrerMesures', 'journaliserEntrainement', 'declarerRelation', 'definirCompetence', 'definirBenchmark', 'definirPool']);


};
