// Adapted from Plagni/atlas 227e897b68fbbaf2d6436084526519bf28ededf8. AGPL-3.0-only.
module.exports = function nativeModule(require, module, __dirname) {
'use strict';

// =============================================================================
//  graphiques — une spécification JSON devient un graphique SVG, côté serveur
// -----------------------------------------------------------------------------
//  Pour les publications Métis (metisdocs.js) : ChatGPT décrit un graphique en
//  quelques lignes de JSON, le serveur le DESSINE. Trois exigences :
//
//  • VISIBLE SANS JAVASCRIPT : le SVG est dans le HTML servi. Un robot qui
//    n'exécute rien, un lecteur hors ligne, une capture : tout le monde voit le
//    graphique (même principe que docu.plagnito.com).
//  • LISIBLE DANS LES DEUX THÈMES : les couleurs sont des variables CSS
//    (--g-1…--g-8, --g-axe, --g-texte, --g-fond) que la page définit en clair ET
//    en sombre. Aucune couleur n'est écrite en dur dans un tracé.
//  • UNE ERREUR DIT QUOI CORRIGER : la validation rend des messages précis
//    (« series[1].valeurs a 4 nombres, x en a 5 »), parce que celui qui les lit
//    est un modèle de langue qui doit pouvoir se corriger seul, sans humain.
//
//  Module PUR : aucun accès disque ni réseau. Testé par scripts/test-graphiques.js.
//
//  Trois familles de types (le détail et un exemple par type : CATALOGUE) :
//  • CARTÉSIENS — x (étiquettes) + series [{ nom, valeurs }] : ligne, escalier,
//    aire, aire-empilee, barres, barres-h, empile, empile-h, empile-100, combine,
//    pareto, sucettes, haltere, cascade, entonnoir, radar, coordonnees.
//  • DISTRIBUTIONS ET MESURES — nuage, bulles, histogramme, boite, violon,
//    chaleur, jauge, secteurs, anneau, mosaique.
//  • SCHÉMAS — schema (plan d'architecture : blocs, groupes, liens, glossaire des
//    sigles), sequence (échanges entre acteurs), flux (diagramme de Sankey),
//    chronologie (diagramme de Gantt, jalons).
// =============================================================================

const TYPES = [
  'ligne', 'escalier', 'aire', 'aire-empilee', 'barres', 'barres-h', 'empile', 'empile-h', 'empile-100',
  'combine', 'pareto', 'sucettes', 'haltere', 'cascade', 'entonnoir', 'radar', 'coordonnees',
  'nuage', 'bulles', 'histogramme', 'boite', 'violon', 'chaleur', 'jauge', 'secteurs', 'anneau', 'mosaique',
  'schema', 'sequence', 'flux', 'chronologie', 'planche',
];
const ALIAS = {
  line: 'ligne', step: 'escalier', area: 'aire', 'stacked-area': 'aire-empilee', stackedarea: 'aire-empilee',
  bar: 'barres', column: 'barres', colonnes: 'barres', barh: 'barres-h', 'bar-h': 'barres-h', stacked: 'empile',
  'stacked-h': 'empile-h', 'stacked-100': 'empile-100', percent: 'empile-100', combo: 'combine', mixed: 'combine',
  lollipop: 'sucettes', dumbbell: 'haltere', waterfall: 'cascade', funnel: 'entonnoir', spider: 'radar',
  parallel: 'coordonnees', 'parallel-coordinates': 'coordonnees', scatter: 'nuage', bubble: 'bulles',
  histogram: 'histogramme', histo: 'histogramme', boxplot: 'boite', box: 'boite', 'boite-a-moustaches': 'boite',
  violin: 'violon', heatmap: 'chaleur', matrix: 'chaleur', matrice: 'chaleur', gauge: 'jauge', pie: 'secteurs',
  camembert: 'secteurs', donut: 'anneau', treemap: 'mosaique', architecture: 'schema', diagram: 'schema',
  diagramme: 'schema', flowchart: 'schema', organigramme: 'schema', plan: 'schema', sankey: 'flux',
  gantt: 'chronologie', timeline: 'chronologie', calendrier: 'chronologie',
  poster: 'planche', affiche: 'planche', infographie: 'planche', infographic: 'planche', board: 'planche', 'architecture-board': 'planche',
};
const Planche = require('./graphiques-planche');
const MAX_SERIES = 8, MAX_POINTS = 60, MAX_TEXTE = 120;
const L = 720, H = 400;
const M = { g: 60, d: 24, b: 40 };
const MOIS = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];

const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const court = (s, n) => { const t = String(s == null ? '' : s).replace(/[\u0000-\u001f]/g, ' ').trim(); return t.length > n ? t.slice(0, n - 1) + '…' : t; };
const nb = (v) => v !== null && v !== '' && typeof v !== 'boolean' && Number.isFinite(Number(v));
const f1 = (v) => (Math.round(v * 10) / 10).toString();
const couleur = (i) => 'var(--g-' + ((((i % MAX_SERIES) + MAX_SERIES) % MAX_SERIES) + 1) + ')';
const largeurTexte = (s, taille = 12.5) => String(s).length * taille * 0.56;
const somme = (a) => a.reduce((x, y) => x + y, 0);

/** Coupe un texte en lignes d'au plus n caractères (au plus max lignes). */
function lignes(texte, n, max = 3) {
  const mots = String(texte || '').split(/\s+/).filter(Boolean);
  const out = [];
  let cur = '';
  for (const m of mots) {
    if (!cur) cur = m;
    else if ((cur + ' ' + m).length <= n) cur += ' ' + m;
    else { out.push(cur); cur = m; }
  }
  if (cur) out.push(cur);
  const r = out.map((l) => court(l, n));
  if (r.length > max) { r.length = max; r[max - 1] = court(r[max - 1] + ' …', n); }
  return r.length ? r : [''];
}

// ── Échelles ──────────────────────────────────────────────────────────────────
function pasRond(etendue, n) {
  const brut = etendue / Math.max(1, n);
  const p = Math.pow(10, Math.floor(Math.log10(brut || 1)));
  const f = brut / p;
  return (f < 1.5 ? 1 : f < 3 ? 2 : f < 7 ? 5 : 10) * p;
}
function graduations(min, max, n = 5) {
  if (min === max) { min -= 1; max += 1; }
  const pas = pasRond(max - min, n);
  const debut = Math.floor(min / pas) * pas, fin = Math.ceil(max / pas) * pas;
  const t = [];
  for (let v = debut; v <= fin + pas / 2; v += pas) t.push(Number(v.toFixed(10)));
  return { min: debut, max: fin, t };
}
function fmt(v, unite) {
  const a = Math.abs(v);
  let s = a >= 1e9 ? (v / 1e9).toFixed(1) + ' Md' : a >= 1e6 ? (v / 1e6).toFixed(1) + ' M' : a >= 1e4 ? (v / 1e3).toFixed(0) + ' k'
    : Number.isInteger(v) ? String(v) : a > 0 && a < 0.01 ? v.toExponential(1) : String(Math.round(v * 100) / 100);
  s = s.replace('.', ',');
  return unite ? s + (unite === '%' ? ' %' : ' ' + unite) : s;
}
/** Une échelle : linéaire (graduations rondes) ou logarithmique (puissances de 10). */
function echelle(lo, hi, { log = false, min = null, max = null, n = 5 } = {}) {
  if (log) {
    const a = Math.floor(Math.log10(min != null ? min : lo)), b = Math.ceil(Math.log10(max != null ? max : hi));
    const e0 = a, e1 = b === a ? a + 1 : b;
    const t = [];
    for (let e = e0; e <= e1; e++) { t.push(Math.pow(10, e)); if (e1 - e0 <= 2 && e < e1) { t.push(2 * Math.pow(10, e)); t.push(5 * Math.pow(10, e)); } }
    return { lo: Math.pow(10, e0), hi: Math.pow(10, e1), t: t.sort((p, q) => p - q), f: (v) => (Math.log10(Math.max(v, 1e-300)) - e0) / (e1 - e0) };
  }
  const g = graduations(min != null ? min : lo, max != null ? max : hi, n);
  const l = min != null ? min : g.min, h = max != null ? max : g.max;
  return { lo: l, hi: h, t: g.t.filter((v) => v >= l - 1e-9 && v <= h + 1e-9), f: (v) => (h === l ? 0 : (v - l) / (h - l)) };
}

// ── Légende (sur plusieurs lignes si besoin) ──────────────────────────────────
function legendeItems(items, x0, largeur) {
  let x = x0, y = 0, h = '';
  for (const it of items) {
    const w = 26 + largeurTexte(it.nom);
    if (x > x0 && x + w > x0 + largeur) { x = x0; y += 20; }
    const pastille = it.forme === 'trait'
      ? '<line x1="0" y1="6" x2="14" y2="6" stroke="' + it.couleur + '" stroke-width="3" stroke-linecap="round"' + (it.tirets ? ' stroke-dasharray="4 3"' : '') + '/>'
      : '<rect width="12" height="12" rx="3" fill="' + it.couleur + '"' + (it.opacite ? ' fill-opacity="' + it.opacite + '"' : '') + '/>';
    h += '<g transform="translate(' + f1(x) + ',' + y + ')">' + pastille + '<text x="' + (it.forme === 'trait' ? 20 : 18) + '" y="10.5" class="g-leg">' + esc(it.nom) + '</text></g>';
    x += w + 8;
  }
  return { svg: h, h: items.length ? y + 20 : 0 };
}
const legendeSeries = (series, forme) => series.map((s, i) => ({ nom: s.nom, couleur: couleur(s.couleur != null ? s.couleur : i), forme: forme || (s.type === 'ligne' ? 'trait' : undefined) }));

// =============================================================================
//  VALIDATION
// =============================================================================

const CARTESIENS = ['ligne', 'escalier', 'aire', 'aire-empilee', 'barres', 'barres-h', 'empile', 'empile-h', 'empile-100', 'combine', 'pareto', 'sucettes', 'haltere', 'cascade', 'entonnoir', 'radar', 'coordonnees'];
const EMPILES = new Set(['empile', 'empile-h', 'empile-100', 'aire-empilee']);
const HORIZ = new Set(['barres-h', 'empile-h', 'sucettes', 'haltere']);
const LOG_OK = new Set(['ligne', 'escalier', 'nuage', 'bulles']);

function lireX(entree, e, { min = 1, max = MAX_POINTS, nom = 'x' } = {}) {
  const x = Array.isArray(entree[nom]) ? entree[nom].map((v) => court(v, 40)) : null;
  if (!x || x.length < min) { e.push(nom + ' doit être la liste des étiquettes (au moins ' + min + ').'); return null; }
  if (x.length > max) { e.push('Au plus ' + max + ' étiquettes sur ' + nom + ' (reçu : ' + x.length + ').'); return null; }
  return x;
}
function listeNombres(v, chemin, e, { n = null, nuls = true, positifs = false, max = 10000 } = {}) {
  if (!Array.isArray(v)) { e.push(chemin + ' doit être une liste de nombres.'); return null; }
  if (n != null && v.length !== n) { e.push(chemin + ' a ' + v.length + ' nombres, x en a ' + n + '.'); return null; }
  if (v.length > max) { e.push(chemin + ' : au plus ' + max + ' valeurs.'); return null; }
  const bad = v.findIndex((x) => !(nuls && x === null) && !nb(x));
  if (bad > -1) { e.push(chemin + '[' + bad + '] n’est pas un nombre' + (nuls ? ' (null est admis pour une valeur manquante).' : '.')); return null; }
  if (positifs && v.some((x) => x !== null && Number(x) < 0)) { e.push(chemin + ' : ce type de graphique ne prend que des valeurs positives ou nulles.'); return null; }
  return v.map((x) => (x === null ? null : Number(x)));
}
function lireSeries(entree, e, { max = MAX_SERIES, min = 1 } = {}) {
  const s = Array.isArray(entree.series) ? entree.series : null;
  if (!s || s.length < min) { e.push('series doit être une liste non vide de { nom, valeurs }.'); return null; }
  if (s.length > max) { e.push('Au plus ' + max + ' séries (reçu : ' + s.length + ').'); return null; }
  if (s.some((x) => !x || typeof x !== 'object' || Array.isArray(x))) { e.push('Chaque série doit être un objet { nom, valeurs }.'); return null; }
  return s;
}
const nomSerie = (s, i) => court((s && s.nom) || 'Série ' + (i + 1), 40);
const couleurSerie = (s) => (s && Number.isInteger(s.couleur) && s.couleur >= 1 && s.couleur <= MAX_SERIES ? s.couleur - 1 : null);

function validerCartesien(type, entree, e) {
  const x = lireX(entree, e, { min: type === 'radar' ? 3 : type === 'coordonnees' ? 2 : 1, max: type === 'radar' ? 16 : type === 'coordonnees' ? 12 : MAX_POINTS });
  const brut = lireSeries(entree, e, { max: type === 'coordonnees' ? 40 : MAX_SERIES });
  if (!x || !brut) return null;
  const unique = ['pareto', 'cascade', 'entonnoir'].includes(type);
  if (unique && brut.length > 1) { e.push('Un graphique « ' + type + ' » ne prend qu’une série.'); return null; }
  if (type === 'haltere' && brut.length < 2) { e.push('Un haltère compare au moins deux séries (par exemple « avant » et « après »).'); return null; }
  const positifs = EMPILES.has(type) || ['pareto', 'entonnoir'].includes(type);
  const series = [];
  brut.forEach((s, i) => {
    const v = listeNombres(s.valeurs, 'series[' + i + '].valeurs', e, { n: x.length, positifs });
    if (!v) return;
    const out = { nom: nomSerie(s, i), valeurs: v };
    const c = couleurSerie(s); if (c != null) out.couleur = c;
    if (s.erreurs !== undefined) { const r = listeNombres(s.erreurs, 'series[' + i + '].erreurs', e, { n: x.length, positifs: true }); if (r) out.erreurs = r; }
    if (s.bas !== undefined || s.haut !== undefined) {
      const b = listeNombres(s.bas, 'series[' + i + '].bas', e, { n: x.length }), hh = listeNombres(s.haut, 'series[' + i + '].haut', e, { n: x.length });
      if (b && hh) { out.bas = b; out.haut = hh; }
    }
    if (type === 'combine') {
      out.type = s.type === 'ligne' || s.type === 'line' ? 'ligne' : 'barres';
      if (s.axe === 'droite' || s.axe === 'right') out.axe = 'droite';
    }
    series.push(out);
  });
  if (e.length) return null;
  const spec = { x, series };
  if (type === 'cascade') {
    if (entree.totaux !== undefined) {
      if (!Array.isArray(entree.totaux) || entree.totaux.some((k) => !Number.isInteger(k) || k < 0 || k >= x.length)) { e.push('totaux doit être une liste d’indices de x (de 0 à ' + (x.length - 1) + ').'); return null; }
      spec.totaux = entree.totaux.slice();
    }
    const v = series[0].valeurs;
    const bad = v.findIndex((n, k) => n === null && !(spec.totaux || []).includes(k));
    if (bad > -1) { e.push('series[0].valeurs[' + bad + '] est vide : seule une colonne de totaux peut l’être.'); return null; }
    if (entree.total) spec.total = typeof entree.total === 'string' ? court(entree.total, 30) : 'Total';
  }
  if (type === 'radar' && series.some((s) => s.valeurs.some((v) => v !== null && v < 0))) { e.push('Un radar ne prend que des valeurs positives ou nulles.'); return null; }
  return spec;
}

function lirePoints(s, i, e, { taille = false } = {}) {
  const pts = Array.isArray(s.points) ? s.points : null;
  if (!pts || !pts.length) { e.push('series[' + i + '].points doit être une liste de [x, y]' + (taille ? ' ou [x, y, taille]' : '') + '.'); return null; }
  if (pts.length > 2000) { e.push('series[' + i + '].points : au plus 2000 points.'); return null; }
  const out = [];
  for (let k = 0; k < pts.length; k++) {
    const p = pts[k];
    let x, y, t = null, nom = null;
    if (Array.isArray(p)) { [x, y, t] = p; } else if (p && typeof p === 'object') { x = p.x; y = p.y; t = p.taille; nom = p.nom; }
    if (!nb(x) || !nb(y) || (taille && !nb(t)) || (taille && Number(t) < 0)) {
      e.push('series[' + i + '].points[' + k + '] doit être ' + (taille ? '[x, y, taille] (taille ≥ 0)' : '[nombre, nombre]') + '.'); return null;
    }
    out.push({ x: Number(x), y: Number(y), t: taille ? Number(t) : null, nom: nom ? court(nom, 30) : null });
  }
  return out;
}

function validerDistribution(type, entree, e) {
  if (type === 'nuage' || type === 'bulles') {
    const brut = lireSeries(entree, e); if (!brut) return null;
    const series = [];
    brut.forEach((s, i) => { const p = lirePoints(s, i, e, { taille: type === 'bulles' }); if (p) series.push({ nom: nomSerie(s, i), points: p, ...(couleurSerie(s) != null ? { couleur: couleurSerie(s) } : {}) }); });
    if (e.length) return null;
    return { series, tendance: entree.tendance === true, echelleX: entree.echelleX === 'log' ? 'log' : null };
  }
  if (type === 'histogramme' || type === 'boite' || type === 'violon') {
    const brut = lireSeries(entree, e, { max: type === 'histogramme' ? 4 : 12 }); if (!brut) return null;
    const series = [];
    brut.forEach((s, i) => {
      if (type === 'boite' && s.resume && typeof s.resume === 'object') {
        const r = s.resume, cles = ['min', 'q1', 'mediane', 'q3', 'max'];
        const manque = cles.filter((k) => !nb(r[k]));
        if (manque.length) { e.push('series[' + i + '].resume doit donner ' + cles.join(', ') + ' (manque : ' + manque.join(', ') + ').'); return; }
        const v = cles.map((k) => Number(r[k]));
        if (v.some((x, k) => k && x < v[k - 1])) { e.push('series[' + i + '].resume : il faut min ≤ q1 ≤ mediane ≤ q3 ≤ max.'); return; }
        series.push({ nom: nomSerie(s, i), resume: { min: v[0], q1: v[1], mediane: v[2], q3: v[3], max: v[4], moyenne: nb(r.moyenne) ? Number(r.moyenne) : null }, aberrants: [] });
        return;
      }
      const v = listeNombres(s.valeurs, 'series[' + i + '].valeurs', e, { nuls: false, max: 10000 });
      if (!v) return;
      if (v.length < (type === 'histogramme' ? 1 : 3)) { e.push('series[' + i + '].valeurs : au moins ' + (type === 'histogramme' ? 1 : 3) + ' mesures.'); return; }
      series.push({ nom: nomSerie(s, i), valeurs: v, ...(couleurSerie(s) != null ? { couleur: couleurSerie(s) } : {}) });
    });
    if (e.length) return null;
    const out = { series };
    if (type === 'histogramme') {
      if (entree.classes !== undefined && (!Number.isInteger(entree.classes) || entree.classes < 2 || entree.classes > 60)) { e.push('classes doit être un entier de 2 à 60.'); return null; }
      out.classes = entree.classes || null;
      out.densite = entree.densite === true;
    }
    if (type === 'boite') out.points = entree.points === true;
    return out;
  }
  if (type === 'chaleur') {
    const x = lireX(entree, e, { max: 40 }), y = lireX(entree, e, { nom: 'y', max: 40 });
    if (!x || !y) return null;
    const m = entree.valeurs;
    if (!Array.isArray(m) || m.length !== y.length) { e.push('valeurs doit être une matrice de ' + y.length + ' lignes (une par étiquette de y), chacune de ' + x.length + ' nombres.'); return null; }
    const valeurs = [];
    for (let r = 0; r < m.length; r++) { const l = listeNombres(m[r], 'valeurs[' + r + ']', e, { n: x.length }); if (!l) return null; valeurs.push(l); }
    if (!valeurs.some((l) => l.some((v) => v !== null))) { e.push('La matrice ne contient aucune valeur.'); return null; }
    const palette = entree.palette === 'divergente' ? 'divergente' : 'sequentielle';
    return { x, y, valeurs, palette, centre: nb(entree.centre) ? Number(entree.centre) : 0, valeursVisibles: entree.valeursVisibles !== false };
  }
  if (type === 'jauge') {
    if (!nb(entree.valeur)) { e.push('valeur (un nombre) est obligatoire pour une jauge.'); return null; }
    const min = nb(entree.min) ? Number(entree.min) : 0, max = nb(entree.max) ? Number(entree.max) : 100;
    if (!(max > min)) { e.push('max doit être supérieur à min.'); return null; }
    let seuils = [];
    if (entree.seuils !== undefined) {
      if (!Array.isArray(entree.seuils) || entree.seuils.length > 8 || entree.seuils.some((s) => !s || !nb(s.jusqua))) { e.push('seuils doit être une liste (au plus 8) de { jusqua: nombre, nom?, couleur? }.'); return null; }
      seuils = entree.seuils.map((s) => ({ jusqua: Number(s.jusqua), nom: court(s.nom || '', 24), couleur: Number.isInteger(s.couleur) && s.couleur >= 1 && s.couleur <= MAX_SERIES ? s.couleur - 1 : null })).sort((a, b) => a.jusqua - b.jusqua);
    }
    return { valeur: Number(entree.valeur), min, max, seuils, cible: nb(entree.cible) ? Number(entree.cible) : null, series: [] };
  }
  if (type === 'secteurs' || type === 'anneau' || type === 'mosaique') {
    const x = lireX(entree, e, { max: type === 'mosaique' ? 60 : 16 });
    const brut = lireSeries(entree, e, { max: 1 });
    if (!x || !brut) return null;
    const v = listeNombres(brut[0].valeurs, 'series[0].valeurs', e, { n: x.length, nuls: false, positifs: true });
    if (!v) return null;
    if (somme(v) <= 0) { e.push('La somme des parts doit être positive.'); return null; }
    const out = { x, series: [{ nom: nomSerie(brut[0], 0), valeurs: v }] };
    if (type === 'mosaique' && entree.groupes !== undefined) {
      if (!Array.isArray(entree.groupes) || entree.groupes.length !== x.length) { e.push('groupes doit donner un nom de groupe par étiquette de x (' + x.length + ').'); return null; }
      out.groupes = entree.groupes.map((g) => court(g, 30));
    }
    return out;
  }
  return null;
}

// Un identifiant de nœud : lettres, chiffres, tirets, soulignés, points.
const ID_RE = /^[A-Za-z0-9_.:-]{1,40}$/;
const FORMES = ['boite', 'base', 'externe', 'pilule', 'note'];

function validerSchema(type, entree, e) {
  if (type === 'schema') {
    const n = Array.isArray(entree.noeuds) ? entree.noeuds : null;
    if (!n || !n.length) { e.push('noeuds doit être une liste de { id, texte, sigle?, detail?, groupe?, forme? }.'); return null; }
    if (n.length > 60) { e.push('Au plus 60 nœuds (reçu : ' + n.length + ') : découpe le plan en plusieurs schémas.'); return null; }
    const groupes = [];
    if (entree.groupes !== undefined) {
      if (!Array.isArray(entree.groupes) || entree.groupes.length > 12) { e.push('groupes doit être une liste (au plus 12) de { id, texte }.'); return null; }
      for (const [k, g] of entree.groupes.entries()) {
        if (!g || !ID_RE.test(String(g.id || ''))) { e.push('groupes[' + k + '].id : lettres, chiffres, tirets (1 à 40 caractères).'); return null; }
        groupes.push({ id: String(g.id), texte: court(g.texte || g.id, 50), couleur: Number.isInteger(g.couleur) && g.couleur >= 1 && g.couleur <= MAX_SERIES ? g.couleur - 1 : null });
      }
    }
    const ids = new Set(), noeuds = [];
    for (const [k, x] of n.entries()) {
      if (!x || typeof x !== 'object') { e.push('noeuds[' + k + '] doit être un objet.'); return null; }
      const id = String(x.id == null ? '' : x.id);
      if (!ID_RE.test(id)) { e.push('noeuds[' + k + '].id : lettres, chiffres, tirets (1 à 40 caractères), reçu ' + JSON.stringify(x.id) + '.'); return null; }
      if (ids.has(id)) { e.push('noeuds[' + k + '].id « ' + id + ' » est en double.'); return null; }
      ids.add(id);
      if (!x.texte && !x.sigle) { e.push('noeuds[' + k + '] (« ' + id + ' ») doit avoir un texte ou un sigle.'); return null; }
      if (x.groupe != null && !groupes.some((g) => g.id === String(x.groupe))) {
        if (!entree.groupes) groupes.push({ id: String(x.groupe).slice(0, 40), texte: court(x.groupe, 50), couleur: null });
        else { e.push('noeuds[' + k + '].groupe « ' + x.groupe + ' » n’existe pas dans groupes.'); return null; }
      }
      if (x.forme != null && !FORMES.includes(x.forme)) { e.push('noeuds[' + k + '].forme doit valoir l’un de : ' + FORMES.join(', ') + '.'); return null; }
      if (x.rang != null && (!Number.isInteger(x.rang) || x.rang < 0 || x.rang > 30)) { e.push('noeuds[' + k + '].rang doit être un entier de 0 à 30.'); return null; }
      noeuds.push({ id, texte: court(x.texte || '', 70), sigle: x.sigle ? court(x.sigle, 14) : null, detail: x.detail ? court(x.detail, 300) : null,
        groupe: x.groupe != null ? String(x.groupe).slice(0, 40) : null, forme: x.forme || 'boite', rang: x.rang != null ? x.rang : null,
        couleur: Number.isInteger(x.couleur) && x.couleur >= 1 && x.couleur <= MAX_SERIES ? x.couleur - 1 : null });
    }
    const l = entree.liens === undefined ? [] : entree.liens;
    if (!Array.isArray(l) || l.length > 120) { e.push('liens doit être une liste (au plus 120) de { de, vers, texte?, style? }.'); return null; }
    const liens = [];
    for (const [k, x] of l.entries()) {
      if (!x || !ids.has(String(x.de)) || !ids.has(String(x.vers))) { e.push('liens[' + k + '] : de et vers doivent être des id de noeuds (reçu ' + JSON.stringify(x && x.de) + ' → ' + JSON.stringify(x && x.vers) + ').'); return null; }
      if (x.style != null && !['plein', 'pointille', 'epais'].includes(x.style)) { e.push('liens[' + k + '].style doit valoir plein, pointille ou epais.'); return null; }
      liens.push({ de: String(x.de), vers: String(x.vers), texte: x.texte ? court(x.texte, 36) : null, style: x.style || 'plein', double: x.double === true });
    }
    const glossaire = lireGlossaire(entree.glossaire, e);
    if (glossaire === null) return null;
    return { noeuds, liens, groupes, sens: entree.sens === 'droite' ? 'droite' : 'bas', glossaire, series: [] };
  }
  if (type === 'sequence') {
    const a = Array.isArray(entree.acteurs) ? entree.acteurs : null;
    if (!a || a.length < 2 || a.length > 10) { e.push('acteurs doit être une liste de 2 à 10 noms (ou { id, texte }).'); return null; }
    const acteurs = a.map((x) => (x && typeof x === 'object' ? { id: String(x.id || x.texte), texte: court(x.texte || x.id, 24) } : { id: String(x), texte: court(x, 24) }));
    if (new Set(acteurs.map((x) => x.id)).size !== acteurs.length) { e.push('Deux acteurs portent le même nom.'); return null; }
    const m = Array.isArray(entree.messages) ? entree.messages : null;
    if (!m || !m.length || m.length > 60) { e.push('messages doit être une liste (1 à 60) de { de, vers, texte, retour? }.'); return null; }
    const connu = new Set(acteurs.map((x) => x.id));
    const messages = [];
    for (const [k, x] of m.entries()) {
      if (!x || !connu.has(String(x.de)) || !connu.has(String(x.vers))) { e.push('messages[' + k + '] : de et vers doivent être des acteurs (reçu ' + JSON.stringify(x && x.de) + ' → ' + JSON.stringify(x && x.vers) + ').'); return null; }
      messages.push({ de: String(x.de), vers: String(x.vers), texte: court(x.texte || '', 60), retour: x.retour === true });
    }
    return { acteurs, messages, numeroter: entree.numeroter !== false, glossaire: lireGlossaire(entree.glossaire, e) || [], series: [] };
  }
  if (type === 'flux') {
    const l = Array.isArray(entree.liens) ? entree.liens : null;
    if (!l || !l.length || l.length > 80) { e.push('liens doit être une liste (1 à 80) de { de, vers, valeur }.'); return null; }
    const liens = [];
    for (const [k, x] of l.entries()) {
      if (!x || !x.de || !x.vers || !nb(x.valeur) || Number(x.valeur) <= 0) { e.push('liens[' + k + '] doit être { de, vers, valeur > 0 }.'); return null; }
      if (String(x.de) === String(x.vers)) { e.push('liens[' + k + '] va de « ' + x.de + ' » vers lui-même.'); return null; }
      liens.push({ de: court(x.de, 40), vers: court(x.vers, 40), valeur: Number(x.valeur) });
    }
    const noms = [...new Set(liens.flatMap((x) => [x.de, x.vers]))];
    if (noms.length > 40) { e.push('Au plus 40 nœuds dans un flux (reçu : ' + noms.length + ').'); return null; }
    // Un flux ne boucle pas : on cherche un cycle pour le nommer.
    const adj = new Map(noms.map((n) => [n, []])); liens.forEach((x) => adj.get(x.de).push(x.vers));
    const etat = new Map(); let cycle = null;
    const dfs = (u, chemin) => { etat.set(u, 1); for (const v of adj.get(u)) { if (cycle) return; if (etat.get(v) === 1) { cycle = chemin.concat(u, v); return; } if (!etat.get(v)) dfs(v, chemin.concat(u)); } etat.set(u, 2); };
    for (const n of noms) if (!etat.get(n) && !cycle) dfs(n, []);
    if (cycle) { e.push('Un flux ne peut pas boucler : ' + cycle.slice(cycle.indexOf(cycle[cycle.length - 1])).join(' → ') + '.'); return null; }
    return { liens, unite: null, series: [] };
  }
  if (type === 'chronologie') {
    const t = Array.isArray(entree.taches) ? entree.taches : null;
    if (!t || !t.length || t.length > 50) { e.push('taches doit être une liste (1 à 50) de { nom, debut, fin, groupe?, etat?, progression? }.'); return null; }
    const dates = t.some((x) => x && typeof x.debut === 'string');
    const lire = (v, chemin) => {
      if (dates) {
        const m = /^(\d{4})-(\d{2})(?:-(\d{2}))?$/.exec(String(v || ''));
        if (!m) { e.push(chemin + ' doit être une date AAAA-MM-JJ (toutes les dates au même format).'); return null; }
        const d = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3] || 1));
        if (!Number.isFinite(d)) { e.push(chemin + ' : date invalide.'); return null; }
        return d;
      }
      if (!nb(v)) { e.push(chemin + ' doit être un nombre (ou une date AAAA-MM-JJ pour toutes les tâches).'); return null; }
      return Number(v);
    };
    const taches = [];
    for (const [k, x] of t.entries()) {
      if (!x || !x.nom) { e.push('taches[' + k + '].nom est obligatoire.'); return null; }
      const d = lire(x.debut, 'taches[' + k + '].debut'); if (d === null) return null;
      const f = x.fin == null ? d : lire(x.fin, 'taches[' + k + '].fin'); if (f === null) return null;
      if (f < d) { e.push('taches[' + k + '] finit avant de commencer.'); return null; }
      if (x.etat != null && !['fait', 'en-cours', 'prevu'].includes(x.etat)) { e.push('taches[' + k + '].etat doit valoir fait, en-cours ou prevu.'); return null; }
      if (x.progression != null && !(nb(x.progression) && x.progression >= 0 && x.progression <= 100)) { e.push('taches[' + k + '].progression doit être un pourcentage (0 à 100).'); return null; }
      taches.push({ nom: court(x.nom, 44), debut: d, fin: f, groupe: x.groupe ? court(x.groupe, 30) : null, etat: x.etat || null, progression: x.progression != null ? Number(x.progression) : null });
    }
    const jalons = [];
    if (entree.jalons !== undefined) {
      if (!Array.isArray(entree.jalons) || entree.jalons.length > 20) { e.push('jalons doit être une liste (au plus 20) de { nom, date }.'); return null; }
      for (const [k, x] of entree.jalons.entries()) { const d = lire(x && x.date, 'jalons[' + k + '].date'); if (d === null) return null; jalons.push({ nom: court(x.nom || '', 30), date: d }); }
    }
    let repere = null;
    if (entree.aujourdhui != null) { repere = lire(entree.aujourdhui, 'aujourdhui'); if (repere === null) return null; }
    return { taches, jalons, dates, aujourdhui: repere, series: [] };
  }
  return null;
}

function lireGlossaire(g, e) {
  if (g === undefined) return [];
  if (!Array.isArray(g) || g.length > 80) { e.push('glossaire doit être une liste (au plus 80) de { sigle, sens, detail? }.'); return null; }
  const out = [];
  for (const [k, x] of g.entries()) {
    if (!x || !x.sigle || !x.sens) { e.push('glossaire[' + k + '] doit donner sigle et sens (forme développée).'); return null; }
    out.push({ sigle: court(x.sigle, 20), sens: court(x.sens, 120), detail: x.detail ? court(x.detail, 400) : null });
  }
  return out;
}

/** Valide et normalise. Rend { ok, spec } ou { ok:false, erreurs:[...] }. PURE. */
function valider(entree) {
  const e = [];
  if (!entree || typeof entree !== 'object' || Array.isArray(entree)) return { ok: false, erreurs: ['La spécification doit être un objet JSON.'] };
  const brut = String(entree.type == null ? '' : entree.type).trim().toLowerCase();
  const type = ALIAS[brut] || brut;
  if (!TYPES.includes(type)) return { ok: false, erreurs: ['type doit valoir l’un de : ' + TYPES.join(', ') + ' (reçu : ' + JSON.stringify(entree.type) + '). L’outil types_graphiques donne un exemple de chacun.'] };
  let propre = null;
  if (CARTESIENS.includes(type)) propre = validerCartesien(type, entree, e);
  else if (['schema', 'sequence', 'flux', 'chronologie'].includes(type)) propre = validerSchema(type, entree, e);
  else if (type === 'planche') { propre = Planche.valider(entree, e); if (propre) { const g = lireGlossaire(entree.glossaire, e); if (g) propre.glossaire = g; } }
  else propre = validerDistribution(type, entree, e);
  if (e.length || !propre) return { ok: false, erreurs: e.length ? e : ['Spécification incomplète.'] };
  const num = (v) => (v === undefined || v === null || v === '' ? null : (nb(v) ? Number(v) : NaN));
  const yMin = num(entree.yMin), yMax = num(entree.yMax);
  if (Number.isNaN(yMin) || Number.isNaN(yMax)) return { ok: false, erreurs: ['yMin et yMax doivent être des nombres.'] };
  if (yMin != null && yMax != null && yMax <= yMin) return { ok: false, erreurs: ['yMax doit être supérieur à yMin.'] };
  const spec = {
    type, ...propre,
    titre: court(entree.titre, MAX_TEXTE), sousTitre: court(entree.sousTitre, MAX_TEXTE),
    unite: court(entree.unite, 12), source: court(entree.source, 200), yMin, yMax,
  };
  if (type === 'empile-100') spec.unite = '%';
  if (entree.xTitre) spec.xTitre = court(entree.xTitre, 50);
  if (entree.yTitre) spec.yTitre = court(entree.yTitre, 50);
  if (entree.uniteDroite) spec.uniteDroite = court(entree.uniteDroite, 12);
  if (entree.valeursVisibles === true) spec.valeursVisibles = true;
  if (entree.echelle === 'log') {
    if (!LOG_OK.has(type)) return { ok: false, erreurs: ['echelle « log » ne s’applique qu’aux types ' + [...LOG_OK].join(', ') + '.'] };
    const vals = spec.series.flatMap((s) => (s.points ? s.points.map((p) => p.y) : s.valeurs)).filter((v) => v !== null);
    if (vals.some((v) => v <= 0)) return { ok: false, erreurs: ['Une échelle logarithmique ne prend que des valeurs strictement positives.'] };
    spec.echelle = 'log';
  }
  if (spec.echelleX === 'log' && spec.series.some((s) => s.points.some((p) => p.x <= 0))) return { ok: false, erreurs: ['echelleX « log » : toutes les abscisses doivent être strictement positives.'] };
  if (entree.reperes !== undefined) {
    if (!Array.isArray(entree.reperes) || entree.reperes.length > 6 || entree.reperes.some((r) => !r || !nb(r.valeur))) return { ok: false, erreurs: ['reperes doit être une liste (au plus 6) de { valeur, texte? } : des lignes de référence.'] };
    spec.reperes = entree.reperes.map((r) => ({ valeur: Number(r.valeur), texte: court(r.texte || '', 30) }));
  }
  return { ok: true, spec };
}

// =============================================================================
//  RENDU — chaque moteur rend { corps, h, w? } pour une zone commençant à `haut`
// =============================================================================

function axeTitre(texte, x, y, vertical) {
  if (!texte) return '';
  return vertical
    ? '<text transform="translate(' + f1(x) + ',' + f1(y) + ') rotate(-90)" class="g-axe g-axe-titre" text-anchor="middle">' + esc(texte) + '</text>'
    : '<text x="' + f1(x) + '" y="' + f1(y) + '" class="g-axe g-axe-titre" text-anchor="middle">' + esc(texte) + '</text>';
}
const valeurTexte = (x, y, texte, ancre = 'middle') => '<text x="' + f1(x) + '" y="' + f1(y) + '" class="g-val" text-anchor="' + ancre + '">' + esc(texte) + '</text>';

// ── Cartésiens : lignes, barres, empilements, combiné, pareto, sucettes, haltère ──
function cartesien(spec, haut) {
  const t = spec.type;
  const horiz = HORIZ.has(t);
  let x = spec.x.slice(), series = spec.series.map((s) => ({ ...s }));
  const n = x.length;
  // Pareto : catégories triées, cumul en % sur l'axe de droite.
  let droite = null;
  if (t === 'pareto') {
    const ordre = x.map((_, k) => k).sort((a, b) => (series[0].valeurs[b] || 0) - (series[0].valeurs[a] || 0));
    x = ordre.map((k) => x[k]);
    series[0].valeurs = ordre.map((k) => series[0].valeurs[k]);
    const tot = somme(series[0].valeurs.map((v) => v || 0)) || 1;
    let c = 0;
    droite = { nom: 'Cumul', valeurs: series[0].valeurs.map((v) => (c += v || 0) / tot * 100), type: 'ligne', couleur: 1 };
  }
  if (t === 'empile-100') {
    const tot = x.map((_, k) => somme(series.map((s) => s.valeurs[k] || 0)));
    series = series.map((s) => ({ ...s, valeurs: s.valeurs.map((v, k) => (v === null ? null : tot[k] ? v / tot[k] * 100 : 0)) }));
  }
  const gauche = t === 'combine' ? series.filter((s) => s.axe !== 'droite') : series;
  const serieDroite = t === 'combine' ? series.filter((s) => s.axe === 'droite') : droite ? [droite] : [];
  const bande = !['ligne', 'escalier', 'aire', 'aire-empilee'].includes(t);
  const empile = EMPILES.has(t);

  // Légende
  const items = t === 'cascade' ? [{ nom: 'Hausse', couleur: couleur(2) }, { nom: 'Baisse', couleur: couleur(0) }, { nom: 'Total', couleur: couleur(1) }]
    : t === 'pareto' ? [{ nom: series[0].nom, couleur: couleur(0) }, { nom: 'Cumul (%)', couleur: couleur(1), forme: 'trait' }]
    : series.length > 1 ? series.map((s, i) => ({ nom: s.nom, couleur: couleur(s.couleur != null ? s.couleur : i), forme: (t === 'combine' && s.type === 'ligne') || ['ligne', 'escalier'].includes(t) ? 'trait' : undefined })) : [];
  // Marges
  const mg = horiz ? Math.min(190, Math.max(M.g, Math.max(...x.map((l) => largeurTexte(court(l, 24), 11.5))) + 16)) : M.g + (spec.yTitre ? 14 : 0);
  const md = serieDroite.length ? 58 : M.d;
  const leg = legendeItems(items, mg, L - mg - md);
  const pasH = horiz ? Math.max(26, (t === 'barres-h' ? series.length : 1) * 14 + 12) : 0;
  const hauteur = horiz ? haut + n * pasH + 36 + (spec.yTitre ? 16 : 0) + (leg.h ? leg.h + 10 : 0) : H + (leg.h > 20 ? leg.h - 20 : 0) + (spec.xTitre ? 14 : 0);
  const bas = hauteur - 32 - (leg.h ? leg.h + 6 : 0) - (horiz ? (spec.yTitre ? 16 : 0) : (spec.xTitre ? 14 : 0));
  const X0 = mg, X1 = L - md, Y0 = haut, Y1 = bas;
  const lg = horiz ? Y1 - Y0 : X1 - X0;

  // Domaine des valeurs (axe de gauche)
  let vals = [];
  const cumuls = empile ? x.map((_, k) => somme(series.map((s) => s.valeurs[k] || 0))) : null;
  if (empile) vals = cumuls.concat([0]);
  else if (t === 'cascade') {
    let c = 0; vals.push(0);
    series[0].valeurs.forEach((v, k) => { if ((spec.totaux || []).includes(k)) vals.push(c); else { c += v; vals.push(c); } });
  } else gauche.forEach((s) => s.valeurs.forEach((v, k) => {
    if (v === null) return;
    vals.push(v);
    if (s.erreurs && s.erreurs[k] != null) { vals.push(v - s.erreurs[k], v + s.erreurs[k]); }
    if (s.bas) { if (s.bas[k] != null) vals.push(s.bas[k]); if (s.haut[k] != null) vals.push(s.haut[k]); }
  }));
  if (!['ligne', 'escalier', 'haltere'].includes(t) && spec.echelle !== 'log') vals.push(0);
  if (!vals.length) vals = [0, 1];
  (spec.reperes || []).forEach((r) => vals.push(r.valeur));
  const log = spec.echelle === 'log';
  const E = echelle(Math.min(...vals), Math.max(...vals), { log, min: spec.yMin, max: t === 'empile-100' ? 100 : spec.yMax });
  const lo = E.lo, hi = E.hi;
  const val = (v) => Math.max(0, Math.min(1, E.f(v)));
  const pv = horiz ? (v) => X0 + val(v) * (X1 - X0) : (v) => Y1 - val(v) * (Y1 - Y0);
  const bandeLg = lg / n;
  const pc = bande ? (k) => (horiz ? Y0 : X0) + (k + 0.5) * bandeLg : (k) => X0 + (n === 1 ? lg / 2 : k * lg / (n - 1));
  let ER = null;
  if (serieDroite.length) {
    const vd = serieDroite.flatMap((s) => s.valeurs.filter((v) => v !== null)).concat(t === 'pareto' ? [0, 100] : [0]);
    ER = t === 'pareto' ? echelle(0, 100, { min: 0, max: 100 }) : echelle(Math.min(...vd), Math.max(...vd));
  }
  const pvD = ER ? (v) => Y1 - Math.max(0, Math.min(1, ER.f(v))) * (Y1 - Y0) : null;

  let h = '';
  // Grille et graduations
  for (const g of E.t) {
    if (horiz) { const px = pv(g); h += '<line x1="' + f1(px) + '" y1="' + Y0 + '" x2="' + f1(px) + '" y2="' + Y1 + '" class="g-grille"/><text x="' + f1(px) + '" y="' + (Y1 + 17) + '" class="g-axe" text-anchor="middle">' + esc(fmt(g, spec.unite)) + '</text>'; }
    else { const py = pv(g); h += '<line x1="' + X0 + '" y1="' + f1(py) + '" x2="' + X1 + '" y2="' + f1(py) + '" class="g-grille"/><text x="' + (X0 - 8) + '" y="' + f1(py + 4) + '" class="g-axe" text-anchor="end">' + esc(fmt(g, spec.unite)) + '</text>'; }
  }
  if (ER) for (const g of ER.t) h += '<text x="' + (X1 + 8) + '" y="' + f1(pvD(g) + 4) + '" class="g-axe">' + esc(fmt(g, t === 'pareto' ? '%' : spec.uniteDroite)) + '</text>';
  // Étiquettes des catégories (on en saute si elles se chevaucheraient)
  const saut = horiz ? 1 : Math.max(1, Math.ceil(n / Math.max(1, Math.floor(lg / 58))));
  x.forEach((lab, k) => {
    if (k % saut || t === 'cascade') return;
    if (horiz) h += '<text x="' + (X0 - 8) + '" y="' + f1(pc(k) + 4) + '" class="g-axe" text-anchor="end">' + esc(court(lab, 24)) + '</text>';
    else h += '<text x="' + f1(pc(k)) + '" y="' + (Y1 + 17) + '" class="g-axe" text-anchor="middle">' + esc(court(lab, 12)) + '</text>';
  });
  const zero = pv(Math.max(lo, Math.min(hi, 0)));
  const titreVal = (s, k, v, u) => '<title>' + esc(court(s.nom + ' — ' + x[k] + ' : ' + fmt(v, u === undefined ? spec.unite : u), 140)) + '</title>';
  const moustache = (c, v, err, larg) => {
    if (err == null) return '';
    const a = pv(v - err), b = pv(v + err);
    return horiz
      ? '<path d="M' + f1(a) + ' ' + f1(c) + 'H' + f1(b) + 'M' + f1(a) + ' ' + f1(c - larg) + 'v' + f1(2 * larg) + 'M' + f1(b) + ' ' + f1(c - larg) + 'v' + f1(2 * larg) + '" class="g-moustache"/>'
      : '<path d="M' + f1(c) + ' ' + f1(a) + 'V' + f1(b) + 'M' + f1(c - larg) + ' ' + f1(a) + 'h' + f1(2 * larg) + 'M' + f1(c - larg) + ' ' + f1(b) + 'h' + f1(2 * larg) + '" class="g-moustache"/>';
  };
  const montrer = spec.valeursVisibles && n * series.length <= 48;

  if (t === 'cascade') {
    const s = series[0], larg = bandeLg * 0.62;
    let c = 0, prec = null;
    const barres = s.valeurs.map((v, k) => {
      if ((spec.totaux || []).includes(k)) return { a: 0, b: c, total: true, v: c };
      // La première colonne est le point de départ : elle se lit comme un total.
      const a = c; c += v; return { a, b: c, total: k === 0, v };
    });
    if (spec.total) { x.push(spec.total); barres.push({ a: 0, b: c, total: true, v: c }); }
    const m = barres.length, bl = lg / m;
    barres.forEach((r, k) => {
      const cx = X0 + (k + 0.5) * bl, w = bl * 0.62;
      const y1 = pv(Math.max(r.a, r.b)), y2 = pv(Math.min(r.a, r.b));
      const col = r.total ? couleur(1) : r.b >= r.a ? couleur(2) : couleur(0);
      h += '<rect x="' + f1(cx - w / 2) + '" y="' + f1(y1) + '" width="' + f1(w) + '" height="' + f1(Math.max(1, y2 - y1)) + '" rx="3" fill="' + col + '"><title>' + esc(x[k] + ' : ' + (r.total ? '' : r.v >= 0 ? '+' : '') + fmt(r.v, spec.unite)) + '</title></rect>';
      if (prec != null) h += '<line x1="' + f1(cx - bl + w / 2) + '" y1="' + f1(pv(prec)) + '" x2="' + f1(cx - w / 2) + '" y2="' + f1(pv(prec)) + '" class="g-lien-fin"/>';
      prec = r.b;
      if (m <= 24) h += valeurTexte(cx, y1 - 6, (r.total ? '' : r.v >= 0 ? '+' : '') + fmt(r.v, spec.unite));
      if (k % Math.max(1, Math.ceil(m / Math.max(1, Math.floor(lg / 58))))) return;
      h += '<text x="' + f1(cx) + '" y="' + (Y1 + 17) + '" class="g-axe" text-anchor="middle">' + esc(court(x[k], 12)) + '</text>';
    });
  } else if (bande && t !== 'sucettes' && t !== 'haltere') {
    const larg = bandeLg * 0.72;
    const barresSeries = t === 'combine' ? series.filter((s) => s.type !== 'ligne') : t === 'pareto' ? [series[0]] : series;
    x.forEach((lab, k) => {
      let cumul = 0;
      barresSeries.forEach((s, i) => {
        const iC = s.couleur != null ? s.couleur : series.indexOf(s);
        const v = s.valeurs[k]; if (v === null) return;
        let a, b, pos, epais;
        const base = (horiz ? Y0 : X0) + k * bandeLg + (bandeLg - larg) / 2;
        if (empile) { a = pv(cumul); b = pv(cumul + v); cumul += v; pos = base; epais = larg; }
        else { a = zero; b = pv(v); epais = larg / barresSeries.length; pos = base + i * epais; }
        const u = t === 'empile-100' ? '%' : spec.unite;
        if (horiz) h += '<rect x="' + f1(Math.min(a, b)) + '" y="' + f1(pos) + '" width="' + f1(Math.abs(b - a)) + '" height="' + f1(Math.max(1, epais - 2)) + '" rx="3" fill="' + couleur(iC) + '">' + titreVal(s, k, v, u) + '</rect>';
        else h += '<rect x="' + f1(pos) + '" y="' + f1(Math.min(a, b)) + '" width="' + f1(Math.max(1, epais - 2)) + '" height="' + f1(Math.abs(b - a)) + '" rx="3" fill="' + couleur(iC) + '">' + titreVal(s, k, v, u) + '</rect>';
        if (!empile && s.erreurs) h += moustache(pos + (epais - 2) / 2, v, s.erreurs[k], Math.min(6, epais / 4));
        if (montrer && (!empile || Math.abs(b - a) > 16)) {
          const txt = fmt(t === 'empile-100' ? Math.round(v) : v, u);
          if (empile) h += horiz ? valeurTexte((a + b) / 2, pos + epais / 2 + 3, txt) : valeurTexte(pos + epais / 2, (a + b) / 2 + 4, txt);
          else h += horiz ? valeurTexte(Math.max(a, b) + 5, pos + epais / 2 + 3, txt, 'start') : valeurTexte(pos + epais / 2, Math.min(a, b) - 5, txt);
        }
      });
    });
  } else if (t === 'sucettes' || t === 'haltere') {
    x.forEach((lab, k) => {
      const c = pc(k);
      if (t === 'haltere') {
        const vs = series.map((s) => s.valeurs[k]).filter((v) => v !== null);
        if (vs.length > 1) h += '<line x1="' + f1(pv(Math.min(...vs))) + '" y1="' + f1(c) + '" x2="' + f1(pv(Math.max(...vs))) + '" y2="' + f1(c) + '" class="g-haltere"/>';
        series.forEach((s, i) => { const v = s.valeurs[k]; if (v !== null) h += '<circle cx="' + f1(pv(v)) + '" cy="' + f1(c) + '" r="6.5" fill="' + couleur(s.couleur != null ? s.couleur : i) + '">' + titreVal(s, k, v) + '</circle>'; });
        if (montrer && vs.length > 1) h += valeurTexte(pv(Math.max(...vs)) + 12, c + 4, (vs[vs.length - 1] - vs[0] >= 0 ? '+' : '') + fmt(vs[vs.length - 1] - vs[0], spec.unite), 'start');
      } else {
        series.forEach((s, i) => {
          const v = s.valeurs[k]; if (v === null) return;
          const cc = c + (series.length > 1 ? (i - (series.length - 1) / 2) * 10 : 0);
          h += '<line x1="' + f1(zero) + '" y1="' + f1(cc) + '" x2="' + f1(pv(v)) + '" y2="' + f1(cc) + '" stroke="' + couleur(s.couleur != null ? s.couleur : i) + '" stroke-width="2.2"/><circle cx="' + f1(pv(v)) + '" cy="' + f1(cc) + '" r="6" fill="' + couleur(s.couleur != null ? s.couleur : i) + '">' + titreVal(s, k, v) + '</circle>';
          if (montrer) h += valeurTexte(pv(v) + 11, cc + 4, fmt(v, spec.unite), 'start');
        });
      }
    });
  }
  // Lignes, aires, escaliers (et lignes des types combiné / pareto)
  const lignesSeries = ['ligne', 'escalier', 'aire', 'aire-empilee'].includes(t) ? series : t === 'combine' ? series.filter((s) => s.type === 'ligne') : droite ? [droite] : [];
  const cumulPrec = x.map(() => 0);
  lignesSeries.forEach((s) => {
    const i = s === droite ? 1 : s.couleur != null ? s.couleur : series.indexOf(s);
    const surDroite = s === droite || s.axe === 'droite';
    const py = surDroite ? pvD : (v) => pv(v);
    const pts = s.valeurs.map((v, k) => (v === null ? null : [pc(k), py(t === 'aire-empilee' ? cumulPrec[k] + v : v), v, k]));
    if (t === 'aire-empilee') {
      const bas = s.valeurs.map((v, k) => [pc(k), pv(cumulPrec[k])]);
      const d = pts.map((p, k) => (k ? 'L' : 'M') + f1(p ? p[0] : pc(k)) + ' ' + f1(p ? p[1] : bas[k][1])).join(' ') + ' ' + bas.slice().reverse().map((p) => 'L' + f1(p[0]) + ' ' + f1(p[1])).join(' ') + 'Z';
      h += '<path d="' + d + '" fill="' + couleur(i) + '" fill-opacity=".55" stroke="' + couleur(i) + '" stroke-width="1.5"/>';
      s.valeurs.forEach((v, k) => { cumulPrec[k] += v || 0; });
      return;
    }
    // Bande d'incertitude (bas / haut) sous la ligne
    if (s.bas) {
      const haut2 = s.haut.map((v, k) => (v === null || s.bas[k] === null ? null : [pc(k), py(v)])).filter(Boolean);
      const bas2 = s.bas.map((v, k) => (v === null || s.haut[k] === null ? null : [pc(k), py(v)])).filter(Boolean);
      if (haut2.length > 1) h += '<polygon points="' + haut2.concat(bas2.reverse()).map((p) => f1(p[0]) + ',' + f1(p[1])).join(' ') + '" fill="' + couleur(i) + '" fill-opacity=".16"/>';
    }
    // une valeur manquante (null) COUPE la ligne au lieu d'inventer un segment
    const bouts = []; let cur = [];
    pts.forEach((p) => { if (!p) { if (cur.length) bouts.push(cur); cur = []; } else cur.push(p); });
    if (cur.length) bouts.push(cur);
    for (const b of bouts) {
      const d = t === 'escalier'
        ? b.map((p, j) => (j ? 'H' + f1(p[0]) + ' V' + f1(p[1]) : 'M' + f1(p[0]) + ' ' + f1(p[1]))).join(' ')
        : b.map((p, j) => (j ? 'L' : 'M') + f1(p[0]) + ' ' + f1(p[1])).join(' ');
      if (t === 'aire') h += '<path d="' + d + ' L' + f1(b[b.length - 1][0]) + ' ' + f1(zero) + ' L' + f1(b[0][0]) + ' ' + f1(zero) + 'Z" fill="' + couleur(i) + '" opacity=".18"/>';
      h += '<path d="' + d + '" fill="none" stroke="' + couleur(i) + '" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"/>';
      if (b.length <= 30) for (const p of b) h += '<circle cx="' + f1(p[0]) + '" cy="' + f1(p[1]) + '" r="3.5" fill="' + couleur(i) + '"><title>' + esc(s.nom + ' — ' + x[p[3]] + ' : ' + fmt(p[2], s === droite ? '%' : surDroite ? spec.uniteDroite : spec.unite)) + '</title></circle>';
      if (s.erreurs) for (const p of b) h += moustache(p[0], p[2], s.erreurs[p[3]], 5);
      if (montrer && b.length <= 24) for (const p of b) h += valeurTexte(p[0], p[1] - 9, fmt(p[2], s === droite ? '%' : spec.unite));
    }
  });
  // Lignes de référence
  for (const r of spec.reperes || []) {
    if (horiz) { const px = pv(r.valeur); h += '<line x1="' + f1(px) + '" y1="' + Y0 + '" x2="' + f1(px) + '" y2="' + Y1 + '" class="g-repere"/>' + (r.texte ? '<text x="' + f1(px + 4) + '" y="' + (Y0 + 10) + '" class="g-repere-texte">' + esc(r.texte) + '</text>' : ''); }
    else { const py = pv(r.valeur); h += '<line x1="' + X0 + '" y1="' + f1(py) + '" x2="' + X1 + '" y2="' + f1(py) + '" class="g-repere"/>' + (r.texte ? '<text x="' + (X1 - 4) + '" y="' + f1(py - 5) + '" class="g-repere-texte" text-anchor="end">' + esc(r.texte) + '</text>' : ''); }
  }
  if (t === 'pareto') h += '<line x1="' + X0 + '" y1="' + f1(pvD(80)) + '" x2="' + X1 + '" y2="' + f1(pvD(80)) + '" class="g-repere"/><text x="' + (X1 - 4) + '" y="' + f1(pvD(80) - 5) + '" class="g-repere-texte" text-anchor="end">80 %</text>';
  // Axe de base
  h += horiz ? '<line x1="' + f1(zero) + '" y1="' + Y0 + '" x2="' + f1(zero) + '" y2="' + Y1 + '" class="g-trait"/>' : '<line x1="' + X0 + '" y1="' + f1(bande ? zero : Y1) + '" x2="' + X1 + '" y2="' + f1(bande ? zero : Y1) + '" class="g-trait"/>';
  // Titres d'axes
  if (horiz) { h += axeTitre(spec.yTitre, (X0 + X1) / 2, Y1 + 34, false); h += axeTitre(spec.xTitre, 14, (Y0 + Y1) / 2, true); }
  else { h += axeTitre(spec.xTitre, (X0 + X1) / 2, Y1 + 34, false); h += axeTitre(spec.yTitre, 14, (Y0 + Y1) / 2, true); }
  if (leg.h) h += '<g transform="translate(0,' + (hauteur - leg.h - 2) + ')">' + leg.svg + '</g>';
  return { corps: h, h: hauteur };
}

// ── Entonnoir ─────────────────────────────────────────────────────────────────
function entonnoir(spec, haut) {
  const v = spec.series[0].valeurs, x = spec.x, n = x.length;
  const pas = 46, hb = 36, colG = 170, colD = 170;
  const cx = colG + (L - colG - colD) / 2, wMax = L - colG - colD, max = Math.max(...v) || 1;
  let h = '';
  const larg = (k) => Math.max(4, v[k] / max * wMax);
  v.forEach((val, k) => {
    const y = haut + k * pas, w = larg(k);
    if (k) { const wp = larg(k - 1); h += '<polygon points="' + [cx - wp / 2, y - pas + hb, cx + wp / 2, y - pas + hb, cx + w / 2, y, cx - w / 2, y].map(f1).join(' ') + '" fill="' + couleur(0) + '" fill-opacity=".14"/>'; }
    h += '<rect x="' + f1(cx - w / 2) + '" y="' + y + '" width="' + f1(w) + '" height="' + hb + '" rx="4" fill="' + couleur(0) + '" fill-opacity="' + f1(1 - k * 0.5 / n) + '"><title>' + esc(x[k] + ' : ' + fmt(val, spec.unite)) + '</title></rect>';
    h += '<text x="' + (colG - 14) + '" y="' + (y + hb / 2 + 4) + '" class="g-leg" text-anchor="end">' + esc(court(x[k], 26)) + '</text>';
    const pDebut = v[0] ? Math.round(val / v[0] * 1000) / 10 : 0, pPrec = k && v[k - 1] ? Math.round(val / v[k - 1] * 1000) / 10 : null;
    h += '<text x="' + (L - colD + 14) + '" y="' + (y + hb / 2 - 2) + '" class="g-leg"><tspan font-weight="600">' + esc(fmt(val, spec.unite)) + '</tspan></text>'
      + '<text x="' + (L - colD + 14) + '" y="' + (y + hb / 2 + 13) + '" class="g-axe">' + esc(k ? fmt(pDebut, '%') + ' du départ · ' + fmt(pPrec, '%') + ' de l’étape' : 'départ') + '</text>';
  });
  return { corps: h, h: haut + n * pas + 10 };
}

// ── Radar ─────────────────────────────────────────────────────────────────────
function radar(spec, haut) {
  const x = spec.x, n = x.length, series = spec.series;
  const R = 138, cx = L / 2, cy = haut + R + 30;
  const max = spec.yMax != null ? spec.yMax : graduations(0, Math.max(1, ...series.flatMap((s) => s.valeurs.filter((v) => v !== null)))).max;
  const ang = (k) => -Math.PI / 2 + k * 2 * Math.PI / n;
  const pt = (k, r) => [cx + r * Math.cos(ang(k)), cy + r * Math.sin(ang(k))];
  let h = '';
  for (let l = 1; l <= 4; l++) {
    h += '<polygon points="' + x.map((_, k) => pt(k, R * l / 4).map(f1).join(',')).join(' ') + '" class="g-grille-poly"/>';
    h += '<text x="' + f1(cx + 4) + '" y="' + f1(cy - R * l / 4 - 3) + '" class="g-axe">' + esc(fmt(max * l / 4, spec.unite)) + '</text>';
  }
  x.forEach((lab, k) => {
    const [px, py] = pt(k, R);
    h += '<line x1="' + cx + '" y1="' + cy + '" x2="' + f1(px) + '" y2="' + f1(py) + '" class="g-grille"/>';
    const [lx, ly] = pt(k, R + 16), c = Math.cos(ang(k));
    h += '<text x="' + f1(lx) + '" y="' + f1(ly + 4) + '" class="g-leg" text-anchor="' + (Math.abs(c) < 0.2 ? 'middle' : c > 0 ? 'start' : 'end') + '">' + esc(court(lab, 22)) + '</text>';
  });
  series.forEach((s, i) => {
    const c = couleur(s.couleur != null ? s.couleur : i);
    const pts = s.valeurs.map((v, k) => pt(k, R * Math.min(1, (v || 0) / max)));
    h += '<polygon points="' + pts.map((p) => p.map(f1).join(',')).join(' ') + '" fill="' + c + '" fill-opacity=".14" stroke="' + c + '" stroke-width="2.2" stroke-linejoin="round"/>';
    pts.forEach((p, k) => { h += '<circle cx="' + f1(p[0]) + '" cy="' + f1(p[1]) + '" r="3.5" fill="' + c + '"><title>' + esc(s.nom + ' — ' + x[k] + ' : ' + fmt(s.valeurs[k] || 0, spec.unite)) + '</title></circle>'; });
  });
  const leg = series.length > 1 ? legendeItems(legendeSeries(series), M.g, L - 2 * M.g) : { svg: '', h: 0 };
  const hh = cy + R + 44;
  return { corps: h + (leg.h ? '<g transform="translate(0,' + hh + ')">' + leg.svg + '</g>' : ''), h: hh + leg.h + 6 };
}

// ── Coordonnées parallèles ───────────────────────────────────────────────────
function coordonnees(spec, haut) {
  const x = spec.x, n = x.length, series = spec.series;
  const X0 = M.g + 20, X1 = L - M.d - 20, Y0 = haut + 22, Y1 = haut + 260;
  const px = (k) => X0 + (n === 1 ? 0 : k * (X1 - X0) / (n - 1));
  const dom = x.map((_, k) => { const v = series.map((s) => s.valeurs[k]).filter((z) => z !== null); const g = graduations(Math.min(...v), Math.max(...v), 4); return g; });
  const py = (k, v) => Y1 - (v - dom[k].min) / ((dom[k].max - dom[k].min) || 1) * (Y1 - Y0);
  let h = '';
  x.forEach((lab, k) => {
    h += '<line x1="' + f1(px(k)) + '" y1="' + Y0 + '" x2="' + f1(px(k)) + '" y2="' + Y1 + '" class="g-trait"/>';
    h += '<text x="' + f1(px(k)) + '" y="' + (Y0 - 10) + '" class="g-leg" text-anchor="middle" font-weight="600">' + esc(court(lab, 16)) + '</text>';
    for (const g of dom[k].t) h += '<text x="' + f1(px(k) - 5) + '" y="' + f1(py(k, g) + 4) + '" class="g-axe" text-anchor="end">' + esc(fmt(g)) + '</text>';
  });
  series.forEach((s, i) => {
    const c = couleur(s.couleur != null ? s.couleur : i);
    const d = s.valeurs.map((v, k) => (v === null ? null : [px(k), py(k, v)])).reduce((acc, p) => { if (!p) { acc.saut = true; return acc; } acc.d += (acc.d && !acc.saut ? 'L' : 'M') + f1(p[0]) + ' ' + f1(p[1]) + ' '; acc.saut = false; return acc; }, { d: '', saut: false }).d;
    h += '<path d="' + d + '" fill="none" stroke="' + c + '" stroke-width="2" stroke-opacity=".8" stroke-linejoin="round"><title>' + esc(s.nom + ' — ' + s.valeurs.map((v, k) => x[k] + ' ' + (v === null ? '—' : fmt(v))).join(' · ')) + '</title></path>';
  });
  const leg = series.length > 1 && series.length <= MAX_SERIES ? legendeItems(legendeSeries(series, 'trait'), M.g, L - 2 * M.g) : { svg: '', h: 0 };
  return { corps: h + (leg.h ? '<g transform="translate(0,' + (Y1 + 22) + ')">' + leg.svg + '</g>' : ''), h: Y1 + 22 + leg.h + 8 };
}

// ── Nuage et bulles ───────────────────────────────────────────────────────────
function nuage(spec, haut) {
  const bulles = spec.type === 'bulles';
  const leg = spec.series.length > 1 ? legendeItems(legendeSeries(spec.series), M.g, L - M.g - M.d) : { svg: '', h: 0 };
  const mg = M.g + (spec.yTitre ? 14 : 0);
  const hauteur = H + (leg.h > 20 ? leg.h - 20 : 0) + (spec.xTitre ? 14 : 0);
  const X0 = mg, X1 = L - M.d, Y0 = haut, Y1 = hauteur - 34 - (leg.h ? leg.h + 6 : 0) - (spec.xTitre ? 14 : 0);
  const xs = [], ys = [], ts = [];
  spec.series.forEach((s) => s.points.forEach((p) => { xs.push(p.x); ys.push(p.y); if (bulles) ts.push(p.t); }));
  const Ex = echelle(Math.min(...xs), Math.max(...xs), { log: spec.echelleX === 'log' });
  const Ey = echelle(Math.min(...ys), Math.max(...ys), { log: spec.echelle === 'log', min: spec.yMin, max: spec.yMax });
  const X = (v) => X0 + Math.max(0, Math.min(1, Ex.f(v))) * (X1 - X0), Y = (v) => Y1 - Math.max(0, Math.min(1, Ey.f(v))) * (Y1 - Y0);
  const tMax = bulles ? Math.max(...ts) || 1 : 1;
  let h = '';
  for (const t of Ey.t) h += '<line x1="' + X0 + '" y1="' + f1(Y(t)) + '" x2="' + X1 + '" y2="' + f1(Y(t)) + '" class="g-grille"/><text x="' + (X0 - 8) + '" y="' + f1(Y(t) + 4) + '" class="g-axe" text-anchor="end">' + esc(fmt(t, spec.unite)) + '</text>';
  for (const t of Ex.t) h += '<text x="' + f1(X(t)) + '" y="' + (Y1 + 17) + '" class="g-axe" text-anchor="middle">' + esc(fmt(t)) + '</text>';
  const etiquettes = spec.series.reduce((a, s) => a + s.points.filter((p) => p.nom).length, 0) <= 30;
  spec.series.forEach((s, i) => {
    const c = couleur(s.couleur != null ? s.couleur : i);
    const tri = bulles ? s.points.slice().sort((a, b) => b.t - a.t) : s.points;
    tri.forEach((p) => {
      const r = bulles ? 4 + 24 * Math.sqrt(p.t / tMax) : 4;
      h += '<circle cx="' + f1(X(p.x)) + '" cy="' + f1(Y(p.y)) + '" r="' + f1(r) + '" fill="' + c + '" fill-opacity="' + (bulles ? '.45' : '.8') + '"' + (bulles ? ' stroke="' + c + '" stroke-width="1.2"' : '') + '><title>' + esc((p.nom ? p.nom + ' — ' : '') + s.nom + ' : (' + fmt(p.x) + ' ; ' + fmt(p.y, spec.unite) + (bulles ? ' ; taille ' + fmt(p.t) : '') + ')') + '</title></circle>';
      if (p.nom && etiquettes) h += '<text x="' + f1(X(p.x) + r + 4) + '" y="' + f1(Y(p.y) + 4) + '" class="g-axe">' + esc(p.nom) + '</text>';
    });
    if (spec.tendance && s.points.length > 1) {
      // Moindres carrés, dans l'espace affiché (log si l'axe est log).
      const tx = (v) => (spec.echelleX === 'log' ? Math.log10(v) : v), ty = (v) => (spec.echelle === 'log' ? Math.log10(v) : v), iy = (v) => (spec.echelle === 'log' ? Math.pow(10, v) : v), ix = (v) => (spec.echelleX === 'log' ? Math.pow(10, v) : v);
      const P = s.points.map((p) => [tx(p.x), ty(p.y)]), m = P.length;
      const mx = somme(P.map((p) => p[0])) / m, my = somme(P.map((p) => p[1])) / m;
      const sxx = somme(P.map((p) => (p[0] - mx) ** 2)), sxy = somme(P.map((p) => (p[0] - mx) * (p[1] - my)));
      if (sxx > 0) {
        const pente = sxy / sxx, a = Math.min(...P.map((p) => p[0])), b = Math.max(...P.map((p) => p[0]));
        h += '<line x1="' + f1(X(ix(a))) + '" y1="' + f1(Y(iy(my + pente * (a - mx)))) + '" x2="' + f1(X(ix(b))) + '" y2="' + f1(Y(iy(my + pente * (b - mx)))) + '" stroke="' + c + '" stroke-width="2" stroke-dasharray="6 4"><title>' + esc('Tendance ' + s.nom + ' : pente ' + fmt(pente)) + '</title></line>';
      }
    }
  });
  for (const r of spec.reperes || []) h += '<line x1="' + X0 + '" y1="' + f1(Y(r.valeur)) + '" x2="' + X1 + '" y2="' + f1(Y(r.valeur)) + '" class="g-repere"/>' + (r.texte ? '<text x="' + (X1 - 4) + '" y="' + f1(Y(r.valeur) - 5) + '" class="g-repere-texte" text-anchor="end">' + esc(r.texte) + '</text>' : '');
  h += '<line x1="' + X0 + '" y1="' + Y1 + '" x2="' + X1 + '" y2="' + Y1 + '" class="g-trait"/>';
  h += axeTitre(spec.xTitre, (X0 + X1) / 2, Y1 + 34, false) + axeTitre(spec.yTitre, 14, (Y0 + Y1) / 2, true);
  return { corps: h + (leg.h ? '<g transform="translate(0,' + (hauteur - leg.h - 2) + ')">' + leg.svg + '</g>' : ''), h: hauteur };
}

// ── Statistiques descriptives (histogramme, boîte, violon) ────────────────────
function quantile(tri, p) {
  const i = (tri.length - 1) * p, a = Math.floor(i), b = Math.ceil(i);
  return tri[a] + (tri[b] - tri[a]) * (i - a);
}
function resumeDe(v) {
  const t = v.slice().sort((a, b) => a - b);
  const q1 = quantile(t, 0.25), q3 = quantile(t, 0.75), iqr = q3 - q1;
  const bI = q1 - 1.5 * iqr, bS = q3 + 1.5 * iqr;
  const dedans = t.filter((x) => x >= bI && x <= bS);
  return { min: dedans[0], q1, mediane: quantile(t, 0.5), q3, max: dedans[dedans.length - 1], moyenne: somme(t) / t.length, aberrants: t.filter((x) => x < bI || x > bS) };
}

function histogramme(spec, haut) {
  const toutes = spec.series.flatMap((s) => s.valeurs);
  const n = Math.max(...spec.series.map((s) => s.valeurs.length));
  const k = spec.classes || Math.min(40, Math.max(4, Math.ceil(Math.log2(n) + 1)));
  let lo = Math.min(...toutes), hi = Math.max(...toutes);
  if (lo === hi) { lo -= 0.5; hi += 0.5; }
  const pas = (hi - lo) / k;
  const comptes = spec.series.map((s) => { const c = new Array(k).fill(0); s.valeurs.forEach((v) => { c[Math.min(k - 1, Math.floor((v - lo) / pas))]++; }); return spec.densite ? c.map((x) => x / s.valeurs.length * 100) : c; });
  const leg = spec.series.length > 1 ? legendeItems(legendeSeries(spec.series), M.g, L - M.g - M.d) : { svg: '', h: 0 };
  const mg = M.g + (spec.yTitre ? 14 : 0);
  const hauteur = H + (spec.xTitre ? 14 : 0) + (leg.h > 20 ? leg.h - 20 : 0);
  const X0 = mg, X1 = L - M.d, Y0 = haut, Y1 = hauteur - 34 - (leg.h ? leg.h + 6 : 0) - (spec.xTitre ? 14 : 0);
  const Ey = echelle(0, Math.max(...comptes.flat()), { max: spec.yMax });
  const Y = (v) => Y1 - Ey.f(v) * (Y1 - Y0), X = (v) => X0 + (v - lo) / (hi - lo) * (X1 - X0);
  let h = '';
  for (const t of Ey.t) h += '<line x1="' + X0 + '" y1="' + f1(Y(t)) + '" x2="' + X1 + '" y2="' + f1(Y(t)) + '" class="g-grille"/><text x="' + (X0 - 8) + '" y="' + f1(Y(t) + 4) + '" class="g-axe" text-anchor="end">' + esc(fmt(t, spec.densite ? '%' : '')) + '</text>';
  const plusieurs = spec.series.length > 1;
  comptes.forEach((c, i) => {
    const col = couleur(spec.series[i].couleur != null ? spec.series[i].couleur : i);
    c.forEach((v, j) => {
      if (!v) return;
      const a = X(lo + j * pas), b = X(lo + (j + 1) * pas);
      h += '<rect x="' + f1(a + 0.5) + '" y="' + f1(Y(v)) + '" width="' + f1(Math.max(1, b - a - 1)) + '" height="' + f1(Y1 - Y(v)) + '" fill="' + col + '"' + (plusieurs ? ' fill-opacity=".55"' : '') + '><title>' + esc(spec.series[i].nom + ' — [' + fmt(lo + j * pas, spec.unite) + ' ; ' + fmt(lo + (j + 1) * pas, spec.unite) + '[ : ' + (spec.densite ? fmt(v, '%') : v)) + '</title></rect>';
    });
  });
  const ex = echelle(lo, hi);
  for (const t of ex.t) if (t >= lo - 1e-9 && t <= hi + 1e-9) h += '<text x="' + f1(X(t)) + '" y="' + (Y1 + 17) + '" class="g-axe" text-anchor="middle">' + esc(fmt(t, spec.unite)) + '</text>';
  for (const r of spec.reperes || []) if (r.valeur >= lo && r.valeur <= hi) h += '<line x1="' + f1(X(r.valeur)) + '" y1="' + Y0 + '" x2="' + f1(X(r.valeur)) + '" y2="' + Y1 + '" class="g-repere"/>' + (r.texte ? '<text x="' + f1(X(r.valeur) + 4) + '" y="' + (Y0 + 10) + '" class="g-repere-texte">' + esc(r.texte) + '</text>' : '');
  h += '<line x1="' + X0 + '" y1="' + Y1 + '" x2="' + X1 + '" y2="' + Y1 + '" class="g-trait"/>';
  h += axeTitre(spec.xTitre, (X0 + X1) / 2, Y1 + 34, false) + axeTitre(spec.yTitre || (spec.densite ? 'Part des mesures' : 'Effectif'), 14, (Y0 + Y1) / 2, true);
  return { corps: h + (leg.h ? '<g transform="translate(0,' + (hauteur - leg.h - 2) + ')">' + leg.svg + '</g>' : ''), h: hauteur };
}

function boiteOuViolon(spec, haut) {
  const violon = spec.type === 'violon';
  const S = spec.series.map((s) => ({ ...s, r: s.resume || resumeDe(s.valeurs) }));
  if (spec.series.some((s) => s.resume)) S.forEach((s) => { if (s.resume) s.r = { ...s.resume, aberrants: [] }; });
  const vals = S.flatMap((s) => [s.r.min, s.r.max, ...(s.r.aberrants || []), ...(s.valeurs || [])]);
  const mg = M.g + (spec.yTitre ? 14 : 0);
  const X0 = mg, X1 = L - M.d, Y0 = haut, Y1 = H - 44;
  const E = echelle(Math.min(...vals), Math.max(...vals), { min: spec.yMin, max: spec.yMax });
  const Y = (v) => Y1 - Math.max(0, Math.min(1, E.f(v))) * (Y1 - Y0);
  const n = S.length, bl = (X1 - X0) / n, w = Math.min(70, bl * 0.5);
  let h = '';
  for (const t of E.t) h += '<line x1="' + X0 + '" y1="' + f1(Y(t)) + '" x2="' + X1 + '" y2="' + f1(Y(t)) + '" class="g-grille"/><text x="' + (X0 - 8) + '" y="' + f1(Y(t) + 4) + '" class="g-axe" text-anchor="end">' + esc(fmt(t, spec.unite)) + '</text>';
  S.forEach((s, i) => {
    const c = couleur(s.couleur != null ? s.couleur : i), cx = X0 + (i + 0.5) * bl, r = s.r;
    const titre = '<title>' + esc(s.nom + ' — min ' + fmt(r.min, spec.unite) + ' · Q1 ' + fmt(r.q1, spec.unite) + ' · médiane ' + fmt(r.mediane, spec.unite) + ' · Q3 ' + fmt(r.q3, spec.unite) + ' · max ' + fmt(r.max, spec.unite) + (r.moyenne != null ? ' · moyenne ' + fmt(r.moyenne, spec.unite) : '') + (s.valeurs ? ' · ' + s.valeurs.length + ' mesures' : '')) + '</title>';
    if (violon && s.valeurs) {
      // Estimation de densité par noyau gaussien (largeur de Silverman), coupée aux extrêmes observés.
      const v = s.valeurs, m = v.length, moy = somme(v) / m;
      const sd = Math.sqrt(somme(v.map((z) => (z - moy) ** 2)) / Math.max(1, m - 1)) || (Math.abs(moy) * 0.05 || 1);
      const bw = 1.06 * sd * Math.pow(m, -0.2);
      const a = Math.min(...v), b = Math.max(...v), N = 48;
      const dens = [];
      for (let j = 0; j <= N; j++) { const y = a + (b - a) * j / N; let d = 0; for (const z of v) d += Math.exp(-0.5 * ((y - z) / bw) ** 2); dens.push([y, d]); }
      const dm = Math.max(...dens.map((d) => d[1])) || 1, demi = Math.min(bl * 0.44, 60);
      const cote = dens.map((d) => [cx + d[1] / dm * demi, Y(d[0])]), autre = dens.map((d) => [cx - d[1] / dm * demi, Y(d[0])]).reverse();
      h += '<path d="M' + cote.concat(autre).map((p) => f1(p[0]) + ' ' + f1(p[1])).join(' L') + 'Z" fill="' + c + '" fill-opacity=".3" stroke="' + c + '" stroke-width="1.5">' + titre + '</path>';
      h += '<rect x="' + f1(cx - 5) + '" y="' + f1(Y(r.q3)) + '" width="10" height="' + f1(Math.max(1, Y(r.q1) - Y(r.q3))) + '" rx="3" fill="' + c + '"/><circle cx="' + f1(cx) + '" cy="' + f1(Y(r.mediane)) + '" r="3.5" class="g-point-clair"/>';
    } else {
      h += '<line x1="' + f1(cx) + '" y1="' + f1(Y(r.max)) + '" x2="' + f1(cx) + '" y2="' + f1(Y(r.min)) + '" stroke="' + c + '" stroke-width="1.6"/>'
        + '<line x1="' + f1(cx - w / 4) + '" y1="' + f1(Y(r.max)) + '" x2="' + f1(cx + w / 4) + '" y2="' + f1(Y(r.max)) + '" stroke="' + c + '" stroke-width="1.6"/>'
        + '<line x1="' + f1(cx - w / 4) + '" y1="' + f1(Y(r.min)) + '" x2="' + f1(cx + w / 4) + '" y2="' + f1(Y(r.min)) + '" stroke="' + c + '" stroke-width="1.6"/>'
        + '<rect x="' + f1(cx - w / 2) + '" y="' + f1(Y(r.q3)) + '" width="' + f1(w) + '" height="' + f1(Math.max(1, Y(r.q1) - Y(r.q3))) + '" rx="4" fill="' + c + '" fill-opacity=".25" stroke="' + c + '" stroke-width="1.6">' + titre + '</rect>'
        + '<line x1="' + f1(cx - w / 2) + '" y1="' + f1(Y(r.mediane)) + '" x2="' + f1(cx + w / 2) + '" y2="' + f1(Y(r.mediane)) + '" stroke="' + c + '" stroke-width="3"/>';
      if (r.moyenne != null) h += '<path d="M' + f1(cx) + ' ' + f1(Y(r.moyenne) - 5) + 'l5 5-5 5-5-5z" class="g-point-clair" stroke="' + c + '"/>';
      for (const z of r.aberrants || []) h += '<circle cx="' + f1(cx) + '" cy="' + f1(Y(z)) + '" r="3" fill="none" stroke="' + c + '" stroke-width="1.4"><title>' + esc(s.nom + ' — valeur isolée : ' + fmt(z, spec.unite)) + '</title></circle>';
      if (spec.points && s.valeurs && s.valeurs.length <= 300) {
        let g = 7;
        s.valeurs.forEach((z) => { g = (g * 16807) % 2147483647; const dx = ((g / 2147483647) - 0.5) * w * 0.8; h += '<circle cx="' + f1(cx + dx) + '" cy="' + f1(Y(z)) + '" r="2" fill="' + c + '" fill-opacity=".55"/>'; });
      }
    }
    h += '<text x="' + f1(cx) + '" y="' + (Y1 + 17) + '" class="g-axe" text-anchor="middle">' + esc(court(s.nom, 16)) + '</text>';
  });
  for (const rp of spec.reperes || []) h += '<line x1="' + X0 + '" y1="' + f1(Y(rp.valeur)) + '" x2="' + X1 + '" y2="' + f1(Y(rp.valeur)) + '" class="g-repere"/>' + (rp.texte ? '<text x="' + (X1 - 4) + '" y="' + f1(Y(rp.valeur) - 5) + '" class="g-repere-texte" text-anchor="end">' + esc(rp.texte) + '</text>' : '');
  h += '<line x1="' + X0 + '" y1="' + Y1 + '" x2="' + X1 + '" y2="' + Y1 + '" class="g-trait"/>' + axeTitre(spec.yTitre, 14, (Y0 + Y1) / 2, true);
  return { corps: h, h: H };
}

// ── Carte de chaleur ──────────────────────────────────────────────────────────
function chaleur(spec, haut) {
  const { x, y, valeurs } = spec;
  const mg = Math.min(170, Math.max(50, Math.max(...y.map((l) => largeurTexte(court(l, 22), 11.5))) + 14));
  const cols = x.length, rows = y.length;
  const cw = (L - mg - M.d) / cols, ch = Math.max(18, Math.min(40, cw));
  const tete = x.some((l) => l.length * 6.5 > cw) ? 40 : 22;
  const Y0 = haut + tete;
  const plat = valeurs.flat().filter((v) => v !== null);
  const lo = Math.min(...plat), hi = Math.max(...plat);
  const div = spec.palette === 'divergente';
  const amp = div ? Math.max(Math.abs(hi - spec.centre), Math.abs(lo - spec.centre)) || 1 : (hi - lo) || 1;
  const teinte = (v) => (div ? { c: v >= spec.centre ? couleur(0) : couleur(1), o: 0.08 + 0.87 * Math.abs(v - spec.centre) / amp } : { c: couleur(0), o: 0.08 + 0.87 * (v - lo) / amp });
  let h = '';
  x.forEach((lab, j) => {
    const cx = mg + (j + 0.5) * cw;
    h += tete > 22
      ? '<text transform="translate(' + f1(cx + 3) + ',' + (Y0 - 6) + ') rotate(-40)" class="g-axe">' + esc(court(lab, 14)) + '</text>'
      : '<text x="' + f1(cx) + '" y="' + (Y0 - 7) + '" class="g-axe" text-anchor="middle">' + esc(court(lab, 12)) + '</text>';
  });
  const montrer = spec.valeursVisibles && cw >= 30 && rows * cols <= 400;
  valeurs.forEach((ligne, i) => {
    const yy = Y0 + i * ch;
    h += '<text x="' + (mg - 8) + '" y="' + f1(yy + ch / 2 + 4) + '" class="g-axe" text-anchor="end">' + esc(court(y[i], 22)) + '</text>';
    ligne.forEach((v, j) => {
      const xx = mg + j * cw;
      if (v === null) { h += '<rect x="' + f1(xx + 1) + '" y="' + f1(yy + 1) + '" width="' + f1(cw - 2) + '" height="' + f1(ch - 2) + '" rx="3" class="g-case-vide"/>'; return; }
      const t = teinte(v);
      h += '<rect x="' + f1(xx + 1) + '" y="' + f1(yy + 1) + '" width="' + f1(cw - 2) + '" height="' + f1(ch - 2) + '" rx="3" fill="' + t.c + '" fill-opacity="' + t.o.toFixed(2) + '"><title>' + esc(y[i] + ' × ' + x[j] + ' : ' + fmt(v, spec.unite)) + '</title></rect>';
      if (montrer) h += valeurTexte(xx + cw / 2, yy + ch / 2 + 4, fmt(v, spec.unite && spec.unite.length <= 2 ? spec.unite : ''));
    });
  });
  // Échelle de couleurs
  const yb = Y0 + rows * ch + 16, gid = 'deg' + Math.round(lo * 1000 + hi * 7 + rows * 13 + cols);
  const larg = Math.min(260, L - mg - M.d);
  if (div) {
    h += '<defs><linearGradient id="' + gid + '"><stop offset="0" stop-color="' + couleur(1) + '" stop-opacity=".95"/><stop offset=".5" stop-color="' + couleur(1) + '" stop-opacity=".05"/><stop offset=".5" stop-color="' + couleur(0) + '" stop-opacity=".05"/><stop offset="1" stop-color="' + couleur(0) + '" stop-opacity=".95"/></linearGradient></defs>';
    h += '<rect x="' + mg + '" y="' + yb + '" width="' + larg + '" height="10" rx="3" fill="url(#' + gid + ')"/>'
      + '<text x="' + mg + '" y="' + (yb + 24) + '" class="g-axe">' + esc(fmt(spec.centre - amp, spec.unite)) + '</text><text x="' + (mg + larg / 2) + '" y="' + (yb + 24) + '" class="g-axe" text-anchor="middle">' + esc(fmt(spec.centre, spec.unite)) + '</text><text x="' + (mg + larg) + '" y="' + (yb + 24) + '" class="g-axe" text-anchor="end">' + esc(fmt(spec.centre + amp, spec.unite)) + '</text>';
  } else {
    h += '<defs><linearGradient id="' + gid + '"><stop offset="0" stop-color="' + couleur(0) + '" stop-opacity=".08"/><stop offset="1" stop-color="' + couleur(0) + '" stop-opacity=".95"/></linearGradient></defs>';
    h += '<rect x="' + mg + '" y="' + yb + '" width="' + larg + '" height="10" rx="3" fill="url(#' + gid + ')"/>'
      + '<text x="' + mg + '" y="' + (yb + 24) + '" class="g-axe">' + esc(fmt(lo, spec.unite)) + '</text><text x="' + (mg + larg) + '" y="' + (yb + 24) + '" class="g-axe" text-anchor="end">' + esc(fmt(hi, spec.unite)) + '</text>';
  }
  return { corps: h, h: yb + 34 };
}

// ── Jauge ─────────────────────────────────────────────────────────────────────
function jauge(spec, haut) {
  const cx = L / 2, cy = haut + 190, R = 170, r = 118;
  const { min, max } = spec;
  const a = (v) => Math.PI + Math.max(0, Math.min(1, (v - min) / (max - min))) * Math.PI;
  const p = (ang, rr) => f1(cx + rr * Math.cos(ang)) + ' ' + f1(cy + rr * Math.sin(ang));
  const arc = (v1, v2, cl, op) => {
    const a1 = a(v1), a2 = a(v2);
    if (a2 - a1 < 1e-6) return '';
    return '<path d="M' + p(a1, R) + ' A' + R + ' ' + R + ' 0 0 1 ' + p(a2, R) + ' L' + p(a2, r) + ' A' + r + ' ' + r + ' 0 0 0 ' + p(a1, r) + 'Z" fill="' + cl + '"' + (op ? ' fill-opacity="' + op + '"' : '') + '/>';
  };
  let h = '';
  if (spec.seuils.length) {
    let debut = min;
    const defaut = [2, 3, 0, 4, 1, 5, 6, 7];
    spec.seuils.forEach((s, i) => {
      const fin = Math.min(max, s.jusqua);
      h += arc(debut, fin, couleur(s.couleur != null ? s.couleur : defaut[i % 8]), '.85');
      if (s.nom) { const m = a((debut + fin) / 2); h += '<text x="' + f1(cx + (R + 16) * Math.cos(m)) + '" y="' + f1(cy + (R + 16) * Math.sin(m)) + '" class="g-axe" text-anchor="' + (Math.cos(m) > 0.2 ? 'start' : Math.cos(m) < -0.2 ? 'end' : 'middle') + '">' + esc(s.nom) + '</text>'; }
      debut = fin;
    });
    if (debut < max) h += arc(debut, max, 'var(--g-grille-fort)');
  } else { h += arc(min, max, 'var(--g-grille-fort)') + arc(min, spec.valeur, couleur(0)); }
  if (spec.cible != null) { const c = a(spec.cible); h += '<line x1="' + f1(cx + (r - 6) * Math.cos(c)) + '" y1="' + f1(cy + (r - 6) * Math.sin(c)) + '" x2="' + f1(cx + (R + 6) * Math.cos(c)) + '" y2="' + f1(cy + (R + 6) * Math.sin(c)) + '" class="g-cible"><title>' + esc('Cible : ' + fmt(spec.cible, spec.unite)) + '</title></line>'; }
  const av = a(spec.valeur);
  h += '<line x1="' + cx + '" y1="' + cy + '" x2="' + f1(cx + (R - 10) * Math.cos(av)) + '" y2="' + f1(cy + (R - 10) * Math.sin(av)) + '" class="g-aiguille"/><circle cx="' + cx + '" cy="' + cy + '" r="8" class="g-moyeu"/>';
  h += '<text x="' + cx + '" y="' + (cy + 44) + '" text-anchor="middle" class="g-total">' + esc(fmt(spec.valeur, spec.unite)) + '</text>';
  h += '<text x="' + f1(cx - (R + r) / 2) + '" y="' + (cy + 20) + '" class="g-axe" text-anchor="middle">' + esc(fmt(min, spec.unite)) + '</text><text x="' + f1(cx + (R + r) / 2) + '" y="' + (cy + 20) + '" class="g-axe" text-anchor="middle">' + esc(fmt(max, spec.unite)) + '</text>';
  return { corps: h, h: cy + 64 };
}

// ── Secteurs et anneau ────────────────────────────────────────────────────────
function anneau(spec, haut) {
  const v = spec.series[0].valeurs, tot = somme(v);
  const plein = spec.type === 'secteurs';
  const R = 128, r = plein ? 0 : 78, cx = 200, cy = Math.max(haut + R + 10, H / 2 + 14);
  let a = -Math.PI / 2, h = '';
  const ecart = v.filter((n) => n > 0).length > 1 ? 0.012 : 0;
  v.forEach((n, i) => {
    if (n <= 0) return;
    const b = a + (n / tot) * Math.PI * 2 - ecart;
    const grand = b - a > Math.PI ? 1 : 0;
    const p = (ang, rr) => f1(cx + rr * Math.cos(ang)) + ' ' + f1(cy + rr * Math.sin(ang));
    let d;
    if (n === tot) d = plein ? 'M' + (cx - R) + ' ' + cy + ' a' + R + ' ' + R + ' 0 1 0 ' + 2 * R + ' 0 a' + R + ' ' + R + ' 0 1 0 ' + -2 * R + ' 0Z'
      : 'M' + (cx - R) + ' ' + cy + ' a' + R + ' ' + R + ' 0 1 0 ' + 2 * R + ' 0 a' + R + ' ' + R + ' 0 1 0 ' + -2 * R + ' 0 M' + (cx - r) + ' ' + cy + ' a' + r + ' ' + r + ' 0 1 1 ' + 2 * r + ' 0 a' + r + ' ' + r + ' 0 1 1 ' + -2 * r + ' 0Z';
    else d = plein ? 'M' + cx + ' ' + cy + ' L' + p(a, R) + ' A' + R + ' ' + R + ' 0 ' + grand + ' 1 ' + p(b, R) + 'Z'
      : 'M' + p(a, R) + ' A' + R + ' ' + R + ' 0 ' + grand + ' 1 ' + p(b, R) + ' L' + p(b, r) + ' A' + r + ' ' + r + ' 0 ' + grand + ' 0 ' + p(a, r) + 'Z';
    h += '<path d="' + d + '" fill="' + couleur(i) + '" fill-rule="evenodd"' + (plein ? ' class="g-part"' : '') + '><title>' + esc(spec.x[i] + ' : ' + fmt(n, spec.unite) + ' (' + Math.round(100 * n / tot) + ' %)') + '</title></path>';
    a = b + ecart;
  });
  // Des parts déjà exprimées en % : ni total (« 100 % » ne dit rien), ni pourcentage répété.
  const enPourcent = spec.unite === '%';
  if (!enPourcent && !plein) h += '<text x="' + cx + '" y="' + (cy + 6) + '" text-anchor="middle" class="g-total">' + esc(fmt(tot, spec.unite)) + '</text>';
  const y0 = Math.max(haut + 20, cy - v.length * 13);
  spec.x.forEach((lab, i) => {
    const y = y0 + i * 26;
    const valeur = enPourcent ? fmt(Math.round(1000 * v[i] / tot) / 10, '%') : fmt(v[i], spec.unite) + ' (' + Math.round(100 * v[i] / tot) + ' %)';
    h += '<rect x="380" y="' + (y - 11) + '" width="14" height="14" rx="3" fill="' + couleur(i) + '"/><text x="402" y="' + y + '" class="g-leg">' + esc(court(lab, 28)) + ' — ' + esc(valeur) + '</text>';
  });
  return { corps: h, h: Math.max(H, y0 + v.length * 26 + 10, cy + R + 16) };
}

// ── Mosaïque (treemap « squarifié ») ─────────────────────────────────────────
function mosaique(spec, haut) {
  const x = spec.x, v = spec.series[0].valeurs, tot = somme(v);
  const X0 = M.d, Y0 = haut, W = L - 2 * M.d, Ht = H - haut - 16;
  const groupes = spec.groupes ? [...new Set(spec.groupes)] : null;
  const items = x.map((nom, k) => ({ nom, v: v[k], k, g: groupes ? groupes.indexOf(spec.groupes[k]) : k })).filter((it) => it.v > 0).sort((a, b) => b.v - a.v);
  const aire = W * Ht / tot;
  const rects = [];
  let rx = X0, ry = Y0, rw = W, rh = Ht;
  let reste = items.map((it) => ({ ...it, a: it.v * aire }));
  const pire = (ligne, cote) => { const s = somme(ligne.map((z) => z.a)); const mx = Math.max(...ligne.map((z) => z.a)), mn = Math.min(...ligne.map((z) => z.a)); return Math.max(cote * cote * mx / (s * s), s * s / (cote * cote * mn)); };
  while (reste.length) {
    const cote = Math.min(rw, rh);
    const ligne = [reste[0]];
    let j = 1;
    while (j < reste.length && pire(ligne.concat(reste[j]), cote) <= pire(ligne, cote)) { ligne.push(reste[j]); j++; }
    reste = reste.slice(j);
    const s = somme(ligne.map((z) => z.a));
    if (rw >= rh) { const w = s / rh; let yy = ry; for (const z of ligne) { const hh = z.a / w; rects.push({ ...z, x: rx, y: yy, w, h: hh }); yy += hh; } rx += w; rw -= w; }
    else { const hh = s / rw; let xx = rx; for (const z of ligne) { const w = z.a / hh; rects.push({ ...z, x: xx, y: ry, w, h: hh }); xx += w; } ry += hh; rh -= hh; }
  }
  let h = '';
  for (const z of rects) {
    const pct = Math.round(1000 * z.v / tot) / 10;
    h += '<rect x="' + f1(z.x + 1) + '" y="' + f1(z.y + 1) + '" width="' + f1(Math.max(0, z.w - 2)) + '" height="' + f1(Math.max(0, z.h - 2)) + '" rx="4" fill="' + couleur(z.g) + '"><title>' + esc(z.nom + (groupes ? ' (' + spec.groupes[z.k] + ')' : '') + ' : ' + fmt(z.v, spec.unite) + ' — ' + fmt(pct, '%')) + '</title></rect>';
    if (z.w > 60 && z.h > 34) {
      const lg = lignes(z.nom, Math.max(6, Math.floor((z.w - 12) / 7)), z.h > 60 ? 2 : 1);
      lg.forEach((l, i) => { h += '<text x="' + f1(z.x + 8) + '" y="' + f1(z.y + 18 + i * 15) + '" class="g-tuile">' + esc(l) + '</text>'; });
      h += '<text x="' + f1(z.x + 8) + '" y="' + f1(z.y + 18 + lg.length * 15) + '" class="g-tuile g-tuile-v">' + esc(fmt(z.v, spec.unite) + ' · ' + fmt(pct, '%')) + '</text>';
    }
  }
  let hauteur = Y0 + Ht + 8;
  if (groupes) { const leg = legendeItems(groupes.map((g, i) => ({ nom: g, couleur: couleur(i) })), X0, W); h += '<g transform="translate(0,' + (hauteur + 4) + ')">' + leg.svg + '</g>'; hauteur += leg.h + 8; }
  return { corps: h, h: hauteur };
}

// ── Flux (Sankey) ─────────────────────────────────────────────────────────────
function flux(spec, haut) {
  const liens = spec.liens;
  const noms = [...new Set(liens.flatMap((l) => [l.de, l.vers]))];
  const N = noms.map((nom) => ({ nom, ent: [], sor: [] }));
  const idx = new Map(noms.map((n, i) => [n, i]));
  const L2 = liens.map((l) => ({ ...l, a: idx.get(l.de), b: idx.get(l.vers) }));
  L2.forEach((l) => { N[l.a].sor.push(l); N[l.b].ent.push(l); });
  // Rangs : plus long chemin depuis les sources ; les puits vont à la dernière colonne.
  const rang = N.map(() => 0);
  for (let it = 0; it < N.length; it++) for (const l of L2) rang[l.b] = Math.max(rang[l.b], rang[l.a] + 1);
  const R = Math.max(...rang);
  N.forEach((n, i) => { n.v = Math.max(somme(n.ent.map((l) => l.valeur)), somme(n.sor.map((l) => l.valeur))); n.r = rang[i]; });
  const cols = Array.from({ length: R + 1 }, (_, r) => N.filter((n) => n.r === r));
  const Y0 = haut, Ht = Math.max(260, Math.min(520, 60 + 22 * Math.max(...cols.map((c) => c.length)) * 2)), gap = 14, nw = 14;
  const k = Math.min(...cols.map((c) => (Ht - gap * (c.length - 1)) / (somme(c.map((n) => n.v)) || 1)));
  const X0 = 16, X1 = L - 16, pasX = R ? (X1 - X0 - nw) / R : 0;
  // Ordre dans chaque colonne : barycentre des sources, deux passes.
  for (let passe = 0; passe < 2; passe++) {
    cols.forEach((c, r) => {
      if (!r) return;
      c.forEach((n) => { const e = n.ent; n.bar = e.length ? somme(e.map((l) => (N[l.a].y || 0) * l.valeur)) / somme(e.map((l) => l.valeur)) : 0; });
      c.sort((a, b) => a.bar - b.bar);
    });
    cols.forEach((c) => { const t = somme(c.map((n) => n.v * k)) + gap * (c.length - 1); let y = Y0 + (Ht - t) / 2; c.forEach((n) => { n.y = y; n.h = Math.max(2, n.v * k); y += n.h + gap; }); });
  }
  N.forEach((n) => { n.x = X0 + n.r * pasX; });
  let h = '';
  // Bandes : triées par position de l'autre extrémité, pour ne pas se croiser inutilement.
  N.forEach((n) => { let y = n.y; n.sor.slice().sort((a, b) => N[a.b].y - N[b.b].y).forEach((l) => { l.y0 = y; y += l.valeur * k; }); });
  N.forEach((n) => { let y = n.y; n.ent.slice().sort((a, b) => N[a.a].y - N[b.a].y).forEach((l) => { l.y1 = y; y += l.valeur * k; }); });
  const iNoeud = new Map(N.map((n, i) => [n, i]));
  L2.forEach((l) => {
    const a = N[l.a], b = N[l.b], xa = a.x + nw, xb = b.x, xm = (xa + xb) / 2, w = l.valeur * k;
    h += '<path d="M' + f1(xa) + ' ' + f1(l.y0) + ' C' + f1(xm) + ' ' + f1(l.y0) + ' ' + f1(xm) + ' ' + f1(l.y1) + ' ' + f1(xb) + ' ' + f1(l.y1) + ' L' + f1(xb) + ' ' + f1(l.y1 + w) + ' C' + f1(xm) + ' ' + f1(l.y1 + w) + ' ' + f1(xm) + ' ' + f1(l.y0 + w) + ' ' + f1(xa) + ' ' + f1(l.y0 + w) + 'Z" fill="' + couleur(iNoeud.get(a)) + '" fill-opacity=".32"><title>' + esc(l.de + ' → ' + l.vers + ' : ' + fmt(l.valeur, spec.unite)) + '</title></path>';
  });
  N.forEach((n, i) => {
    h += '<rect x="' + f1(n.x) + '" y="' + f1(n.y) + '" width="' + nw + '" height="' + f1(n.h) + '" rx="2" fill="' + couleur(i) + '"><title>' + esc(n.nom + ' : ' + fmt(n.v, spec.unite)) + '</title></rect>';
    const droite = n.r < R;
    h += '<text x="' + f1(droite ? n.x + nw + 6 : n.x - 6) + '" y="' + f1(n.y + n.h / 2 + 4) + '" class="g-leg" text-anchor="' + (droite ? 'start' : 'end') + '">' + esc(court(n.nom, 24)) + ' <tspan class="g-axe">' + esc(fmt(n.v, spec.unite)) + '</tspan></text>';
  });
  return { corps: h, h: Y0 + Ht + 14 };
}

// ── Chronologie (Gantt) ───────────────────────────────────────────────────────
function chronologie(spec, haut) {
  const T = spec.taches, n = T.length;
  const bornes = T.flatMap((t) => [t.debut, t.fin]).concat(spec.jalons.map((j) => j.date), spec.aujourdhui != null ? [spec.aujourdhui] : []);
  let lo = Math.min(...bornes), hi = Math.max(...bornes);
  const jour = 86400000;
  if (spec.dates) { lo -= jour; hi += jour; } else if (lo === hi) { lo -= 1; hi += 1; }
  const mg = Math.min(220, Math.max(90, Math.max(...T.map((t) => largeurTexte(t.nom, 11.5))) + 16));
  const X0 = mg, X1 = L - M.d, pas = 26, Y0 = haut + 22 + (spec.jalons.length ? 16 : 0), Y1 = Y0 + n * pas;
  const X = (v) => X0 + (v - lo) / (hi - lo) * (X1 - X0);
  const groupes = [...new Set(T.map((t) => t.groupe).filter(Boolean))];
  let h = '';
  // Graduations
  let ticks = [];
  if (spec.dates) {
    const span = (hi - lo) / jour;
    const d0 = new Date(lo);
    if (span > 720) { for (let y = d0.getUTCFullYear(); ; y++) { const t = Date.UTC(y, 0, 1); if (t > hi) break; if (t >= lo) ticks.push([t, String(y)]); } }
    else if (span > 75) { const pasM = span > 360 ? 3 : span > 180 ? 2 : 1; for (let y = d0.getUTCFullYear(), m = d0.getUTCMonth(); ; m += pasM) { const t = Date.UTC(y, m, 1); if (t > hi) break; if (t >= lo) { const d = new Date(t); ticks.push([t, MOIS[d.getUTCMonth()] + (d.getUTCMonth() === 0 || !ticks.length ? ' ' + d.getUTCFullYear() : '')]); } } }
    else { const pasJ = span > 28 ? 7 : span > 10 ? 2 : 1; for (let t = Date.UTC(d0.getUTCFullYear(), d0.getUTCMonth(), d0.getUTCDate() + 1); t <= hi; t += pasJ * jour) { const d = new Date(t); ticks.push([t, d.getUTCDate() + ' ' + MOIS[d.getUTCMonth()]]); } }
  } else ticks = echelle(lo, hi).t.filter((t) => t >= lo && t <= hi).map((t) => [t, fmt(t, spec.unite)]);
  const saut = Math.max(1, Math.ceil(ticks.length / Math.max(1, Math.floor((X1 - X0) / 64))));
  ticks.forEach(([t, lab], i) => { h += '<line x1="' + f1(X(t)) + '" y1="' + (Y0 - 6) + '" x2="' + f1(X(t)) + '" y2="' + Y1 + '" class="g-grille"/>' + (i % saut ? '' : '<text x="' + f1(X(t)) + '" y="' + (Y1 + 16) + '" class="g-axe" text-anchor="middle">' + esc(lab) + '</text>'); });
  const dateTexte = (v) => (spec.dates ? new Date(v).toISOString().slice(0, 10) : fmt(v, spec.unite));
  T.forEach((t, i) => {
    const y = Y0 + i * pas, c = couleur(t.groupe ? groupes.indexOf(t.groupe) : 0);
    h += '<text x="' + (X0 - 10) + '" y="' + (y + pas / 2 + 4) + '" class="g-axe" text-anchor="end">' + esc(t.nom) + '</text>';
    const a = X(t.debut), b = Math.max(X(t.fin), a + 3), hb = pas - 8;
    const titre = '<title>' + esc(t.nom + ' : ' + dateTexte(t.debut) + ' → ' + dateTexte(t.fin) + (t.etat ? ' · ' + t.etat : '') + (t.progression != null ? ' · ' + t.progression + ' %' : '')) + '</title>';
    if (t.fin === t.debut) { h += '<path d="M' + f1(a) + ' ' + (y + 5) + 'l7 8-7 8-7-8z" fill="' + c + '">' + titre + '</path>'; return; }
    if (t.etat === 'prevu') h += '<rect x="' + f1(a) + '" y="' + (y + 4) + '" width="' + f1(b - a) + '" height="' + hb + '" rx="4" fill="' + c + '" fill-opacity=".2" stroke="' + c + '" stroke-dasharray="4 3">' + titre + '</rect>';
    else {
      // En cours sans avancement chiffré : une barre atténuée, sans inventer de pourcentage.
      const prog = t.progression;
      h += '<rect x="' + f1(a) + '" y="' + (y + 4) + '" width="' + f1(b - a) + '" height="' + hb + '" rx="4" fill="' + c + '"' + (prog != null ? ' fill-opacity=".35"' : t.etat === 'en-cours' ? ' fill-opacity=".6" stroke="' + c + '"' : '') + '>' + titre + '</rect>';
      if (prog != null) h += '<rect x="' + f1(a) + '" y="' + (y + 4) + '" width="' + f1((b - a) * prog / 100) + '" height="' + hb + '" rx="4" fill="' + c + '"/>';
    }
  });
  spec.jalons.forEach((j) => { const x = X(j.date); h += '<line x1="' + f1(x) + '" y1="' + (Y0 - 14) + '" x2="' + f1(x) + '" y2="' + Y1 + '" class="g-repere"/><path d="M' + f1(x) + ' ' + (Y0 - 24) + 'l6 6-6 6-6-6z" class="g-jalon"><title>' + esc(j.nom + ' : ' + dateTexte(j.date)) + '</title></path><text x="' + f1(x + 9) + '" y="' + (Y0 - 14) + '" class="g-repere-texte">' + esc(j.nom) + '</text>'; });
  if (spec.aujourdhui != null) { const x = X(spec.aujourdhui); h += '<line x1="' + f1(x) + '" y1="' + (Y0 - 6) + '" x2="' + f1(x) + '" y2="' + Y1 + '" class="g-cible"/><text x="' + f1(x) + '" y="' + (Y0 - 9) + '" class="g-repere-texte" text-anchor="middle">aujourd’hui</text>'; }
  let hauteur = Y1 + 26;
  if (groupes.length > 1) { const leg = legendeItems(groupes.map((g, i) => ({ nom: g, couleur: couleur(i) })), X0, X1 - X0); h += '<g transform="translate(0,' + (hauteur + 4) + ')">' + leg.svg + '</g>'; hauteur += leg.h + 8; }
  return { corps: h, h: hauteur };
}

// ── Schéma d'architecture ─────────────────────────────────────────────────────
//  Mise en page automatique en couches (plus long chemin depuis les entrées),
//  chaque groupe occupant sa propre bande : un cadre de groupe ne recouvre jamais
//  un bloc d'un autre groupe, quelle que soit la forme du graphe.
function schema(spec, haut, id) {
  const droite = spec.sens === 'droite';
  const N = spec.noeuds.map((n) => ({ ...n }));
  const idx = new Map(N.map((n, i) => [n.id, i]));
  const E = spec.liens.map((l) => ({ ...l, a: idx.get(l.de), b: idx.get(l.vers) }));
  // Les liens qui remontent (cycles) sont repérés par un parcours en profondeur.
  const adj = N.map(() => []); E.forEach((l, j) => { if (l.a !== l.b) adj[l.a].push(j); });
  const etat = N.map(() => 0), retour = new Set();
  const dfs = (u) => { etat[u] = 1; for (const j of adj[u]) { const v = E[j].b; if (etat[v] === 1) retour.add(j); else if (!etat[v]) dfs(v); } etat[u] = 2; };
  N.forEach((_, i) => { if (!etat[i]) dfs(i); });
  const rang = N.map((n) => (n.rang != null ? n.rang : 0));
  for (let it = 0; it < N.length; it++) E.forEach((l, j) => { if (l.a === l.b || retour.has(j) || N[l.b].rang != null) return; rang[l.b] = Math.max(rang[l.b], rang[l.a] + 1); });
  const rangs = [...new Set(rang)].sort((a, b) => a - b), rMap = new Map(rangs.map((r, i) => [r, i]));
  N.forEach((n, i) => { n.r = rMap.get(rang[i]); });
  const R = rangs.length;
  // Bandes : un groupe = une bande ; les blocs sans groupe forment une bande par suite
  // de rangs contigus. Des bandes dont les rangs ne se chevauchent pas partagent un
  // COULOIR (elles s'empilent) : sinon chaque groupe prendrait sa colonne et le plan
  // descendrait en escalier.
  const gInfo = new Map(spec.groupes.map((g, i) => [g.id, { ...g, i }]));
  const ordreGroupes = [];
  N.forEach((n) => { if (n.groupe && !ordreGroupes.includes(n.groupe)) ordreGroupes.push(n.groupe); });
  const bandes = ordreGroupes.map((g) => ({ groupe: g, noeuds: N.filter((n) => n.groupe === g) }));
  const libres = N.filter((n) => !n.groupe);
  let suite = [];
  const clore = () => { if (suite.length) bandes.push({ groupe: null, noeuds: libres.filter((n) => suite.includes(n.r)) }); suite = []; };
  for (const r of [...new Set(libres.map((n) => n.r))].sort((a, b) => a - b)) { if (suite.length && r !== suite[suite.length - 1] + 1) clore(); suite.push(r); }
  clore();
  bandes.forEach((b) => { b.r0 = Math.min(...b.noeuds.map((n) => n.r)); b.r1 = Math.max(...b.noeuds.map((n) => n.r)); b.premier = Math.min(...b.noeuds.map((n) => N.indexOf(n))); });
  bandes.sort((a, b) => a.premier - b.premier);
  // Dimensions des blocs
  const nw = droite ? 150 : 146, cars = 20;
  N.forEach((n) => { n.lignes = lignes(n.texte, cars, n.sigle ? 2 : 3); });
  const maxL = Math.max(...N.map((n) => n.lignes.length + (n.sigle ? 1 : 0)));
  const nh = Math.max(40, 16 + maxL * 15);
  const gapX = droite ? 64 : 22, gapY = droite ? 18 : 54, padG = 12, titreG = 22;
  const slotL = droite ? nh + gapY : nw + gapX;           // pas le long d'une couche
  const coucheL = droite ? nw + gapX : nh + gapY;         // pas d'une couche à l'autre
  const cell = (r, b) => b.noeuds.filter((n) => n.r === r);
  // Le titre d'un groupe : en bandeau au-dessus (sens droite) ; en colonne à gauche
  // (sens bas), là où aucun lien n'entre — les liens arrivent par le haut des blocs.
  bandes.forEach((b) => {
    b.slots = Math.max(...Array.from({ length: R }, (_, r) => cell(r, b).length));
    if (b.groupe) {
      const g = gInfo.get(b.groupe) || { texte: b.groupe };
      b.titre = droite ? [g.texte] : lignes(String(g.texte).toUpperCase(), 13, 3);
      b.entete = droite ? titreG : Math.max(...b.titre.map((l) => largeurTexte(l, 11.5))) + 12;
    } else b.entete = 0;
    b.larg = b.slots * slotL - (droite ? gapY : gapX) + (b.groupe ? 2 * padG + b.entete : 0);
  });
  const couloirs = [];
  for (const b of bandes) {
    let c = couloirs.find((k) => k.bandes.every((o) => b.r1 < o.r0 || b.r0 > o.r1));
    if (!c) { c = { bandes: [], larg: 0 }; couloirs.push(c); }
    c.bandes.push(b); c.larg = Math.max(c.larg, b.larg); b.couloir = c;
  }
  const marge = 16, entreCouloirs = droite ? 26 : 30;
  const placer = () => {
    let off = marge;
    for (const c of couloirs) { c.off = off; off += c.larg + entreCouloirs; }
    for (const b of bandes) {
      b.u0 = b.couloir.off + (b.couloir.larg - b.larg) / 2;
      const debut = b.u0 + (b.groupe ? padG + b.entete : 0);
      for (let r = b.r0; r <= b.r1; r++) { const cc = cell(r, b); cc.forEach((n) => { n.u = debut + (b.slots - cc.length) * slotL / 2 + n.k * slotL; }); }
    }
    return off - entreCouloirs + marge;
  };
  // Ordre dans chaque cellule : ordre d'écriture, puis barycentre des voisins des rangs précédents.
  bandes.forEach((b) => { for (let r = b.r0; r <= b.r1; r++) cell(r, b).forEach((n, k) => { n.k = k; }); });
  let W = placer();
  for (let passe = 0; passe < 3; passe++) {
    for (let r = 1; r < R; r++) for (const b of bandes) {
      const cc = cell(r, b); if (cc.length < 2) continue;
      cc.forEach((n) => { const i = N.indexOf(n); const v = E.filter((l) => (l.b === i && N[l.a].r < r) || (l.a === i && N[l.b].r < r)).map((l) => N[l.b === i ? l.a : l.b]); n.bar = v.length ? somme(v.map((z) => z.u)) / v.length : n.u; });
      cc.sort((a, z) => a.bar - z.bar).forEach((n, k) => { n.k = k; });
    }
    W = placer();
  }
  const avecCadres = bandes.some((b) => b.groupe);
  const debutCouche = (droite ? marge : haut + 6) + (avecCadres ? padG : 0);
  N.forEach((n) => { const v = debutCouche + n.r * coucheL; if (droite) { n.x = v; n.y = haut + n.u; } else { n.x = n.u; n.y = v; } });
  if (droite) W = Math.max(...N.map((n) => n.x + nw)) + marge + (avecCadres ? padG : 0);
  const Ht = Math.max(...N.map((n) => n.y + nh)) + (avecCadres ? padG : 0) + 16;
  const larg = Math.max(L, W);
  const dx = (larg - W) / 2;
  N.forEach((n) => { n.x += dx; });
  let h = '<defs><marker id="' + esc(id) + '-fl" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0L10 5L0 10z" class="g-fleche"/></marker></defs>';
  const couleurNoeud = (n) => (n.couleur != null ? n.couleur : n.groupe ? (gInfo.get(n.groupe) && gInfo.get(n.groupe).couleur != null ? gInfo.get(n.groupe).couleur : ordreGroupes.indexOf(n.groupe)) : null);
  // Cadres de groupes
  for (const b of bandes) {
    if (!b.groupe) continue;
    const ci = couleurNoeud({ groupe: b.groupe });
    const a0 = debutCouche + b.r0 * coucheL - padG, a1 = debutCouche + b.r1 * coucheL + (droite ? nw : nh) + padG;
    const [x, y, w, hh] = droite ? [a0 + dx, haut + b.u0, a1 - a0, b.larg] : [b.u0 + dx, a0, b.larg, a1 - a0];
    h += '<rect x="' + f1(x) + '" y="' + f1(y) + '" width="' + f1(w) + '" height="' + f1(hh) + '" rx="14" class="g-groupe" stroke="' + couleur(ci) + '" fill="' + couleur(ci) + '" fill-opacity=".04"/>';
    b.titre.forEach((l, i) => { h += '<text x="' + f1(x + 11) + '" y="' + f1(y + 17 + i * 14) + '" class="g-groupe-titre" fill="' + couleur(ci) + '">' + esc(l) + '</text>'; });
  }
  // Liens (sous les blocs)
  const milieuBezier = (p0, p1, p2, p3) => [(p0[0] + 3 * p1[0] + 3 * p2[0] + p3[0]) / 8, (p0[1] + 3 * p1[1] + 3 * p2[1] + p3[1]) / 8];
  let etiquettes = '';
  E.forEach((l, j) => {
    const a = N[l.a], b = N[l.b];
    let p0, p1, p2, p3;
    if (l.a === l.b) { p0 = [a.x + nw, a.y + nh * 0.3]; p1 = [a.x + nw + 40, a.y - 10]; p2 = [a.x + nw + 40, a.y + nh + 10]; p3 = [a.x + nw, a.y + nh * 0.7]; }
    else if (retour.has(j) || b.r === a.r || b.r < a.r) {
      if (droite) { const s = b.y >= a.y ? 1 : -1; p0 = [a.x + nw / 2, s > 0 ? a.y + nh : a.y]; p3 = [b.x + nw / 2, s > 0 ? b.y : b.y + nh]; if (b.r !== a.r) { p0 = [a.x + nw / 2, a.y + nh]; p3 = [b.x + nw / 2, b.y + nh]; } p1 = [p0[0], p0[1] + 36 * (b.r !== a.r ? 1 : s)]; p2 = [p3[0], p3[1] + 36 * (b.r !== a.r ? 1 : -s)]; }
      else { const s = b.x >= a.x ? 1 : -1; if (b.r === a.r) { p0 = [s > 0 ? a.x + nw : a.x, a.y + nh / 2]; p3 = [s > 0 ? b.x : b.x + nw, b.y + nh / 2]; p1 = [p0[0] + 30 * s, p0[1]]; p2 = [p3[0] - 30 * s, p3[1]]; } else { p0 = [a.x + nw, a.y + nh / 2]; p3 = [b.x + nw, b.y + nh / 2]; p1 = [p0[0] + 50, p0[1]]; p2 = [p3[0] + 50, p3[1]]; } }
    } else if (b.r - a.r > 1 && (droite ? Math.abs(a.y - b.y) < nh : Math.abs(a.x - b.x) < nw)) {
      // Un lien qui saute des étages dans la même colonne passerait DERRIÈRE les blocs
      // intermédiaires : il contourne par le côté.
      if (droite) { p0 = [a.x + nw / 2, a.y + nh]; p3 = [b.x + nw / 2, b.y + nh]; p1 = [p0[0], p0[1] + 46]; p2 = [p3[0], p3[1] + 46]; }
      else { p0 = [a.x + nw, a.y + nh / 2]; p3 = [b.x + nw, b.y + nh / 2]; p1 = [p0[0] + 56, p0[1]]; p2 = [p3[0] + 56, p3[1]]; }
    } else if (droite) { p0 = [a.x + nw, a.y + nh / 2]; p3 = [b.x, b.y + nh / 2]; const m = (p3[0] - p0[0]) / 2; p1 = [p0[0] + m, p0[1]]; p2 = [p3[0] - m, p3[1]]; }
    else { p0 = [a.x + nw / 2, a.y + nh]; p3 = [b.x + nw / 2, b.y]; const m = (p3[1] - p0[1]) / 2; p1 = [p0[0], p0[1] + m]; p2 = [p3[0], p3[1] - m]; }
    const cls = 'g-lien' + (l.style === 'pointille' || retour.has(j) ? ' g-lien-tirets' : '') + (l.style === 'epais' ? ' g-lien-epais' : '');
    h += '<path d="M' + p0.map(f1).join(' ') + ' C' + p1.map(f1).join(' ') + ' ' + p2.map(f1).join(' ') + ' ' + p3.map(f1).join(' ') + '" class="' + cls + '" marker-end="url(#' + esc(id) + '-fl)"' + (l.double ? ' marker-start="url(#' + esc(id) + '-fl)"' : '') + '><title>' + esc((a.sigle || a.texte) + ' → ' + (b.sigle || b.texte) + (l.texte ? ' : ' + l.texte : '')) + '</title></path>';
    if (l.texte) {
      const [mx, my] = milieuBezier(p0, p1, p2, p3), w = largeurTexte(l.texte, 11) + 10;
      etiquettes += '<rect x="' + f1(mx - w / 2) + '" y="' + f1(my - 9) + '" width="' + f1(w) + '" height="17" rx="8" class="g-etiquette"/><text x="' + f1(mx) + '" y="' + f1(my + 4) + '" class="g-etiquette-texte" text-anchor="middle">' + esc(l.texte) + '</text>';
    }
  });
  // Blocs
  N.forEach((n) => {
    const ci = couleurNoeud(n), c = ci == null ? 'var(--g-axe)' : couleur(ci);
    const titre = '<title>' + esc((n.sigle ? n.sigle + ' — ' : '') + n.texte + (n.detail ? ' : ' + n.detail : '')) + '</title>';
    let forme;
    if (n.forme === 'base') {
      const e = 7;
      forme = '<path d="M' + f1(n.x) + ' ' + f1(n.y + e) + ' a' + nw / 2 + ' ' + e + ' 0 0 1 ' + nw + ' 0 v' + (nh - 2 * e) + ' a' + nw / 2 + ' ' + e + ' 0 0 1 ' + -nw + ' 0z" class="g-bloc" stroke="' + c + '"/><path d="M' + f1(n.x) + ' ' + f1(n.y + e) + ' a' + nw / 2 + ' ' + e + ' 0 0 0 ' + nw + ' 0" fill="none" stroke="' + c + '" stroke-width="1.4"/>'
        + '<path d="M' + f1(n.x) + ' ' + f1(n.y + e) + ' a' + nw / 2 + ' ' + e + ' 0 0 1 ' + nw + ' 0 v' + (nh - 2 * e) + ' a' + nw / 2 + ' ' + e + ' 0 0 1 ' + -nw + ' 0z" fill="' + c + '" fill-opacity=".12"/>';
    } else {
      const rx = n.forme === 'pilule' ? nh / 2 : n.forme === 'note' ? 3 : 10;
      forme = '<rect x="' + f1(n.x) + '" y="' + f1(n.y) + '" width="' + nw + '" height="' + nh + '" rx="' + rx + '" class="g-bloc' + (n.forme === 'externe' ? ' g-bloc-externe' : '') + '" stroke="' + c + '"/>'
        + (n.forme === 'externe' ? '' : '<rect x="' + f1(n.x) + '" y="' + f1(n.y) + '" width="' + nw + '" height="' + nh + '" rx="' + rx + '" fill="' + c + '" fill-opacity="' + (n.forme === 'note' ? '.22' : '.12') + '"/>');
    }
    const lignesT = n.lignes.filter(Boolean);
    const total = lignesT.length + (n.sigle ? 1 : 0);
    let y = n.y + nh / 2 - (total - 1) * 7.5 + 4;
    let t = '';
    if (n.sigle) { t += '<text x="' + f1(n.x + nw / 2) + '" y="' + f1(y) + '" class="g-bloc-sigle" text-anchor="middle">' + esc(n.sigle) + '</text>'; y += 15; }
    lignesT.forEach((l) => { t += '<text x="' + f1(n.x + nw / 2) + '" y="' + f1(y) + '" class="' + (n.sigle ? 'g-bloc-texte' : 'g-bloc-titre') + '" text-anchor="middle">' + esc(l) + '</text>'; y += 15; });
    h += '<g class="g-noeud">' + titre + forme + t + '</g>';
  });
  return { corps: h + etiquettes, h: Ht, w: larg };
}

// ── Diagramme de séquence ─────────────────────────────────────────────────────
function sequence(spec, haut, id) {
  const A = spec.acteurs, n = A.length;
  const marge = 80, esp = Math.max(130, (L - 2 * marge) / (n - 1));
  const W = Math.max(L, 2 * marge + (n - 1) * esp);
  const x = new Map(A.map((a, i) => [a.id, marge + (W - 2 * marge - (n - 1) * esp) / 2 + i * esp]));
  const tete = haut + 4, hTete = 30, y0 = tete + hTete + 26, pas = 38;
  const y1 = y0 + spec.messages.length * pas;
  let h = '<defs><marker id="' + esc(id) + '-fl" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M0 0L10 5L0 10z" class="g-fleche"/></marker></defs>';
  A.forEach((a, i) => {
    const cx = x.get(a.id), w = Math.max(90, largeurTexte(a.texte, 12.5) + 24);
    h += '<line x1="' + f1(cx) + '" y1="' + (tete + hTete) + '" x2="' + f1(cx) + '" y2="' + (y1 + 4) + '" class="g-vie"/>';
    for (const yy of [tete, y1 + 4]) h += '<rect x="' + f1(cx - w / 2) + '" y="' + yy + '" width="' + f1(w) + '" height="' + hTete + '" rx="8" class="g-bloc" stroke="' + couleur(i) + '"/><rect x="' + f1(cx - w / 2) + '" y="' + yy + '" width="' + f1(w) + '" height="' + hTete + '" rx="8" fill="' + couleur(i) + '" fill-opacity=".14"/><text x="' + f1(cx) + '" y="' + (yy + 19) + '" class="g-bloc-titre" text-anchor="middle">' + esc(a.texte) + '</text>';
  });
  spec.messages.forEach((m, k) => {
    const y = y0 + k * pas + 8, a = x.get(m.de), b = x.get(m.vers);
    const texte = (spec.numeroter ? (k + 1) + '. ' : '') + m.texte;
    if (a === b) {
      h += '<path d="M' + f1(a) + ' ' + (y - 6) + ' h36 v14 h-34" class="g-lien' + (m.retour ? ' g-lien-tirets' : '') + '" marker-end="url(#' + esc(id) + '-fl)"/><text x="' + f1(a + 42) + '" y="' + (y + 4) + '" class="g-etiquette-texte">' + esc(texte) + '</text>';
    } else {
      const dir = b > a ? 1 : -1;
      h += '<line x1="' + f1(a) + '" y1="' + y + '" x2="' + f1(b - dir * 2) + '" y2="' + y + '" class="g-lien' + (m.retour ? ' g-lien-tirets' : '') + '" marker-end="url(#' + esc(id) + '-fl)"/>';
      h += '<text x="' + f1((a + b) / 2) + '" y="' + (y - 7) + '" class="g-etiquette-texte" text-anchor="middle">' + esc(court(texte, Math.max(14, Math.floor(Math.abs(b - a) / 6.2)))) + '<title>' + esc(texte) + '</title></text>';
    }
  });
  return { corps: h, h: y1 + 4 + hTete + 10, w: W };
}

// =============================================================================
//  Assemblage
// =============================================================================

const MOTEURS = {
  entonnoir, radar, coordonnees, nuage, bulles: nuage, histogramme, boite: boiteOuViolon, violon: boiteOuViolon,
  chaleur, jauge, secteurs: anneau, anneau, mosaique, flux, chronologie, schema, sequence, planche: Planche.planche,
};

/**
 * Le SVG d'une spécification DÉJÀ validée. Rend une chaîne sûre à insérer telle
 * quelle dans du HTML (tout texte venu de la spécification est échappé).
 */
function rendre(spec, opts) {
  const id = String((opts && opts.id) || 'g').replace(/[^A-Za-z0-9_-]/g, '') || 'g';
  // Une planche dessine elle-même son grand titre, centré.
  const propreTitre = spec.type === 'planche';
  const haut = propreTitre ? 0 : spec.titre ? (spec.sousTitre ? 64 : 46) : spec.sousTitre ? 36 : 14;
  const moteur = MOTEURS[spec.type] || cartesien;
  const r = moteur(spec, haut, id);
  const w = r.w || L, hh = Math.ceil(r.h);
  const titre = spec.titre && !propreTitre ? '<text x="' + (w > L ? 24 : M.g - 4) + '" y="26" class="g-titre">' + esc(spec.titre) + '</text>' : '';
  const sous = spec.sousTitre && !propreTitre ? '<text x="' + (w > L ? 24 : M.g - 4) + '" y="' + (spec.titre ? 46 : 22) + '" class="g-sous">' + esc(spec.sousTitre) + '</text>' : '';
  const noms = spec.series && spec.series.length ? spec.series.map((s) => s.nom).join(', ') : spec.type === 'schema' ? spec.noeuds.length + ' blocs, ' + spec.liens.length + ' liens' : spec.type === 'planche' ? spec.blocs.length + ' blocs : ' + spec.blocs.map((b) => b.titre).join(', ') : '';
  const desc = (spec.titre || 'Graphique') + ' — ' + spec.type + (noms ? ' — ' + noms : '');
  // Un schéma plus large que la colonne garde une taille lisible : la figure défile.
  const large = w > L + 40 ? ' style="min-width:' + Math.round(w * 0.72) + 'px"' : '';
  return '<svg class="graphique" viewBox="0 0 ' + w + ' ' + hh + '" role="img" aria-labelledby="' + id + '-t"' + large + ' xmlns="http://www.w3.org/2000/svg">'
    + '<title id="' + id + '-t">' + esc(desc) + '</title>' + titre + sous + r.corps + '</svg>';
}

/** Valide puis rend. { ok, svg, spec } ou { ok:false, erreurs }. */
function graphique(entree, opts) {
  const v = valider(entree);
  if (!v.ok) return v;
  return { ok: true, spec: v.spec, svg: rendre(v.spec, opts) };
}

/**
 * La légende HTML d'une figure : le glossaire des sigles d'un schéma (ceux déclarés
 * dans `glossaire`, puis ceux des blocs qui portent un détail). Rendue en HTML et
 * non dans le SVG, pour que le texte se replie à la largeur de l'écran.
 * `connus` (facultatif) : sigle → { sens, detail } du glossaire commun de Métis.
 */
// lien(sigle) → adresse de la fiche : un sigle CONNU du glossaire commun y renvoie.
function glossaireHtml(spec, connus, lien) {
  if (!spec || !['schema', 'sequence', 'planche'].includes(spec.type)) return '';
  const vus = new Map();
  for (const g of spec.glossaire || []) vus.set(g.sigle, { sens: g.sens, detail: g.detail });
  for (const n of spec.noeuds || []) {
    if (!n.sigle || vus.has(n.sigle)) continue;
    const c = connus && connus(n.sigle);
    if (n.detail || c) vus.set(n.sigle, { sens: c ? c.sens : n.texte, detail: n.detail || (c && c.detail) || null });
  }
  if (!vus.size) return '';
  const fiche = (s) => (lien && connus && connus(s) ? '<a href="' + esc(lien(s)) + '">' + esc(s) + '</a>' : esc(s));
  return '<dl class="glossaire-fig">' + [...vus].map(([s, g]) => '<div><dt><abbr title="' + esc(g.sens) + '">' + fiche(s) + '</abbr></dt><dd><b>' + esc(g.sens) + '</b>' + (g.detail ? ' — ' + esc(g.detail) : '') + '</dd></div>').join('') + '</dl>';
}

/** Un résumé textuel d'une spécification : ce qu'un modèle qui ne voit pas l'image doit savoir. */
function resumer(spec) {
  const t = spec.type;
  if (t === 'schema') return { type: t, blocs: spec.noeuds.map((n) => (n.sigle ? n.sigle + ' (' + n.texte + ')' : n.texte)), liens: spec.liens.map((l) => l.de + ' → ' + l.vers + (l.texte ? ' : ' + l.texte : '')), groupes: spec.groupes.map((g) => g.texte) };
  if (t === 'sequence') return { type: t, acteurs: spec.acteurs.map((a) => a.texte), messages: spec.messages.map((m) => m.de + ' → ' + m.vers + ' : ' + m.texte) };
  if (t === 'flux') return { type: t, liens: spec.liens.map((l) => l.de + ' → ' + l.vers + ' : ' + l.valeur) };
  if (t === 'planche') return { type: t, blocs: spec.blocs.map((b) => ({ id: b.id, titre: (b.numero ? b.numero + '. ' : '') + b.titre, categorie: b.categorie, puces: b.puces, elements: b.elements.map((x) => x.titre || x.texte) })), liens: spec.liens.map((l) => l.de + ' → ' + l.vers + (l.texte ? ' : ' + l.texte : '')) };
  if (t === 'chronologie') return { type: t, taches: spec.taches.map((x) => x.nom), jalons: spec.jalons.map((j) => j.nom) };
  if (t === 'jauge') return { type: t, valeur: spec.valeur, min: spec.min, max: spec.max };
  if (t === 'chaleur') return { type: t, lignes: spec.y.length, colonnes: spec.x.length };
  const s = spec.series || [];
  return { type: t, series: s.map((x) => ({ nom: x.nom, n: (x.valeurs || x.points || []).length })) };
}

// =============================================================================
//  CATALOGUE — un exemple valide par type (servi au modèle par l'outil
//  types_graphiques, dessiné par la galerie /metis/graphiques, vérifié par les tests)
// =============================================================================

const CATALOGUE = [
  { type: 'ligne', famille: 'Évolution', usage: 'Une ou plusieurs courbes dans le temps. Options : echelle "log", bas/haut (bande d’incertitude), erreurs, reperes.',
    exemple: { type: 'ligne', titre: 'Perte de validation', x: ['1k', '2k', '4k', '8k', '16k', '32k'], series: [{ nom: 'Alpha 31M', valeurs: [5.9, 4.8, 4.1, 3.6, 3.3, 3.1], bas: [5.8, 4.7, 4.0, 3.5, 3.2, 3.0], haut: [6.0, 4.9, 4.2, 3.7, 3.4, 3.2] }, { nom: 'Alpha 23M', valeurs: [6.0, 5.0, 4.3, 3.8, 3.5, 3.35] }], reperes: [{ valeur: 3.2, texte: 'cible' }], xTitre: 'Pas d’entraînement', yTitre: 'Perte' } },
  { type: 'escalier', famille: 'Évolution', usage: 'Une valeur qui change par paliers (taux d’apprentissage, version, capacité).',
    exemple: { type: 'escalier', titre: 'Taux d’apprentissage par palier', x: ['0', '2k', '20k', '40k', '60k', '80k'], series: [{ nom: 'lr', valeurs: [0.0001, 0.0006, 0.0005, 0.0003, 0.0001, 0.00006] }], echelle: 'log' } },
  { type: 'aire', famille: 'Évolution', usage: 'Une courbe dont la surface compte (volume, mémoire occupée).',
    exemple: { type: 'aire', titre: 'VRAM réservée', x: ['0 s', '30 s', '60 s', '90 s', '120 s'], series: [{ nom: 'VRAM', valeurs: [1.2, 4.8, 5.1, 5.0, 5.2] }], unite: 'Gio', reperes: [{ valeur: 8, texte: 'limite de la carte' }] } },
  { type: 'aire-empilee', famille: 'Composition', usage: 'Des parts qui s’additionnent au fil du temps.',
    exemple: { type: 'aire-empilee', titre: 'Mélange du corpus par étape', x: ['v0', 'v1', 'v2', 'v3'], series: [{ nom: 'Code', valeurs: [40, 55, 60, 62] }, { nom: 'Texte', valeurs: [50, 35, 28, 25] }, { nom: 'Trajectoires', valeurs: [10, 10, 12, 13] }], unite: '%' } },
  { type: 'barres', famille: 'Comparaison', usage: 'Comparer des catégories. Options : erreurs (± par valeur), valeursVisibles, reperes.',
    exemple: { type: 'barres', titre: 'Réussite par variante', x: ['A', 'B', 'C', 'D'], series: [{ nom: 'Moyenne sur 8 graines', valeurs: [23.3, 24.1, 22.8, 25.6], erreurs: [1.2, 1.5, 0.9, 1.8] }], unite: '%', valeursVisibles: true } },
  { type: 'barres-h', famille: 'Comparaison', usage: 'Catégories aux noms longs ou nombreuses : barres horizontales.',
    exemple: { type: 'barres-h', titre: 'Temps par étape d’un update', x: ['Chargement du lot', 'Propagation avant', 'Rétropropagation', 'AdamW', 'Journalisation'], series: [{ nom: 'ms', valeurs: [4, 61, 118, 9, 2] }], unite: 'ms', valeursVisibles: true } },
  { type: 'empile', famille: 'Composition', usage: 'Barres empilées : le total et sa composition.',
    exemple: { type: 'empile', titre: 'Mémoire par composant', x: ['Référence', 'Fused', 'Fused rapide', 'Économe'], series: [{ nom: 'Poids', valeurs: [0.12, 0.12, 0.12, 0.12] }, { nom: 'Optimiseur', valeurs: [0.25, 0.25, 0.25, 0.25] }, { nom: 'Activations', valeurs: [3.1, 2.8, 2.9, 1.9] }], unite: 'Gio' } },
  { type: 'empile-h', famille: 'Composition', usage: 'Barres empilées horizontales.',
    exemple: { type: 'empile-h', titre: 'Budget de contexte (8k jetons)', x: ['Petit dépôt', 'Dépôt moyen', 'Gros dépôt'], series: [{ nom: 'État de travail', valeurs: [1200, 1500, 1800] }, { nom: 'Preuves', valeurs: [2500, 3500, 4200] }, { nom: 'Observations', valeurs: [2000, 2200, 1800] }], valeursVisibles: true } },
  { type: 'empile-100', famille: 'Composition', usage: 'Parts relatives (chaque barre fait 100 %).',
    exemple: { type: 'empile-100', titre: 'Issue des épisodes', x: ['Semaine 1', 'Semaine 2', 'Semaine 3'], series: [{ nom: 'Réussi', valeurs: [12, 20, 31] }, { nom: 'Échoué', valeurs: [30, 25, 18] }, { nom: 'Bloqué', valeurs: [8, 5, 3] }], valeursVisibles: true } },
  { type: 'combine', famille: 'Comparaison', usage: 'Barres et lignes ensemble, avec un second axe : series[i].type "ligne"|"barres", series[i].axe "droite", uniteDroite.',
    exemple: { type: 'combine', titre: 'Débit et latence', x: ['bs 4', 'bs 8', 'bs 16', 'bs 32'], series: [{ nom: 'Jetons/s', valeurs: [9800, 16100, 21400, 22900] }, { nom: 'Latence', valeurs: [41, 50, 76, 142], type: 'ligne', axe: 'droite' }], uniteDroite: 'ms' } },
  { type: 'pareto', famille: 'Comparaison', usage: 'Trier des causes par poids, avec le cumul en % (règle des 80/20).',
    exemple: { type: 'pareto', titre: 'Causes d’échec des épisodes', x: ['Mauvais fichier', 'Import manquant', 'Boucle', 'Test mal lu', 'Autre'], series: [{ nom: 'Épisodes', valeurs: [48, 21, 12, 9, 6] }] } },
  { type: 'sucettes', famille: 'Comparaison', usage: 'Comme des barres horizontales, plus léger quand il y a beaucoup de catégories.',
    exemple: { type: 'sucettes', titre: 'Gain par mécanisme (ablation)', x: ['CEB', 'SkillVM', 'Replay', 'Vérificateur', 'Compression'], series: [{ nom: 'Gain', valeurs: [4.2, 2.8, 3.5, 6.1, -0.8] }], unite: 'pts', valeursVisibles: true } },
  { type: 'haltere', famille: 'Comparaison', usage: 'Avant / après par catégorie : deux points reliés (au moins deux séries).',
    exemple: { type: 'haltere', titre: 'Avant et après le backend fusionné', x: ['Débit court', 'Débit long', 'VRAM réservée'], series: [{ nom: 'Référence', valeurs: [100, 100, 100] }, { nom: 'Fused', valeurs: [109, 106, 94] }], unite: '%', valeursVisibles: true } },
  { type: 'cascade', famille: 'Composition', usage: 'Comment un total se construit : hausses et baisses successives. totaux : indices des colonnes de sous-total ; total : ajoute la colonne finale.',
    exemple: { type: 'cascade', titre: 'D’où vient le gain de débit', x: ['Référence', 'QKV fusionné', 'gate/up fusionné', 'cuDNN SDPA', 'Journalisation'], series: [{ nom: 'Débit', valeurs: [100, 6, 3, 8.6, -1.2] }], total: 'Final', unite: '%' } },
  { type: 'entonnoir', famille: 'Composition', usage: 'Des étapes successives qui perdent des éléments (conversion, filtrage).',
    exemple: { type: 'entonnoir', titre: 'Du dépôt aux données d’entraînement', x: ['Trajectoires collectées', 'Vérifiées', 'Sans régression', 'Admises (TAG)', 'Retenues pour SFT'], series: [{ nom: 'Trajectoires', valeurs: [12000, 7400, 5200, 3100, 2400] }] } },
  { type: 'radar', famille: 'Profil', usage: 'Le profil d’une ou plusieurs options sur 3 à 16 critères.',
    exemple: { type: 'radar', titre: 'Qwen2.5-Coder-1.5B contre Qwen3-1.7B', x: ['Code', 'Raisonnement', 'Outils', 'KV cache léger', 'Latence', 'Licence'], series: [{ nom: 'Qwen2.5-Coder-1.5B', valeurs: [8, 5, 6, 9, 8, 9] }, { nom: 'Qwen3-1.7B', valeurs: [7, 7, 7, 4, 6, 9] }], yMax: 10 } },
  { type: 'coordonnees', famille: 'Profil', usage: 'Coordonnées parallèles : comparer des essais sur plusieurs axes (balayage d’hyperparamètres). Jusqu’à 40 séries.',
    exemple: { type: 'coordonnees', titre: 'Balayage d’hyperparamètres', x: ['lr ×1e-4', 'warmup', 'batch', 'perte finale'], series: [{ nom: 'run 1', valeurs: [6, 2000, 16, 3.1] }, { nom: 'run 2', valeurs: [3, 1000, 16, 3.3] }, { nom: 'run 3', valeurs: [10, 4000, 32, 3.05] }, { nom: 'run 4', valeurs: [6, 500, 8, 3.4] }] } },
  { type: 'nuage', famille: 'Relation', usage: 'Relation entre deux mesures. points : [[x,y],…] ou [{x,y,nom}]. Options : tendance (droite des moindres carrés), echelle/echelleX "log".',
    exemple: { type: 'nuage', titre: 'Paramètres et perte', series: [{ nom: 'Runs', points: [{ x: 23, y: 3.35, nom: '23M' }, { x: 31, y: 3.1, nom: '31M' }, { x: 60, y: 2.9, nom: '60M' }, { x: 114, y: 2.72, nom: '114M' }] }], tendance: true, echelleX: 'log', xTitre: 'Millions de paramètres', yTitre: 'Perte' } },
  { type: 'bulles', famille: 'Relation', usage: 'Un nuage dont chaque point a une taille : points [[x, y, taille],…].',
    exemple: { type: 'bulles', titre: 'Coût, qualité et taille', series: [{ nom: 'Backbones', points: [{ x: 0.9, y: 62, taille: 1.5, nom: 'Qwen2.5-Coder-1.5B' }, { x: 3.5, y: 66, taille: 1.7, nom: 'Qwen3-1.7B' }, { x: 0.1, y: 20, taille: 0.03, nom: 'Alpha 31M' }] }], xTitre: 'KV cache à 32k (Gio)', yTitre: 'Score' } },
  { type: 'histogramme', famille: 'Distribution', usage: 'La distribution de mesures brutes : series[{nom, valeurs:[…]}] (jusqu’à 4). Options : classes, densite.',
    exemple: { type: 'histogramme', titre: 'Longueur des fichiers du corpus', series: [{ nom: 'Fichiers', valeurs: [120, 340, 560, 210, 890, 1500, 430, 380, 610, 720, 260, 950, 1300, 480, 510, 330, 290, 770, 1100, 640, 450, 520, 390, 870] }], classes: 8, unite: 'jetons' } },
  { type: 'boite', famille: 'Distribution', usage: 'Boîte à moustaches par série : médiane, quartiles, valeurs isolées. valeurs brutes ou resume {min,q1,mediane,q3,max}. Option points.',
    exemple: { type: 'boite', titre: 'Exactitude sur 8 graines', series: [{ nom: 'D0', valeurs: [0.23, 0.24, 0.22, 0.25, 0.23, 0.21, 0.24, 0.23] }, { nom: 'D1', valeurs: [0.22, 0.26, 0.2, 0.27, 0.24, 0.25, 0.23, 0.3] }, { nom: 'D2p', resume: { min: 0.15, q1: 0.19, mediane: 0.21, q3: 0.23, max: 0.26 } }], points: true } },
  { type: 'violon', famille: 'Distribution', usage: 'La forme d’une distribution (densité), par série de mesures brutes.',
    exemple: { type: 'violon', titre: 'Temps par step selon le profil', series: [{ nom: 'Déterministe', valeurs: [201, 204, 199, 210, 205, 203, 207, 202, 206, 215] }, { nom: 'Rapide', valeurs: [183, 186, 181, 190, 188, 185, 192, 184, 187, 199] }], unite: 'ms' } },
  { type: 'chaleur', famille: 'Distribution', usage: 'Une matrice colorée : x (colonnes), y (lignes), valeurs [[…],…]. palette "divergente" + centre pour des écarts.',
    exemple: { type: 'chaleur', titre: 'Écart à la référence (points)', x: ['1 saut', '2 sauts', '3 sauts', '4 sauts'], y: ['D0', 'D1', 'D1c', 'D2p'], valeurs: [[0, 0, 0, 0], [1.2, 0.8, 0.3, -0.2], [-2.1, -1.5, -0.9, -0.4], [-4.8, -3.2, -2.5, -1.1]], palette: 'divergente', centre: 0 } },
  { type: 'jauge', famille: 'Mesure', usage: 'Une valeur unique sur une échelle : valeur, min, max, seuils [{jusqua, nom}], cible.',
    exemple: { type: 'jauge', titre: 'VRAM utilisée', valeur: 6.4, min: 0, max: 8, unite: 'Gio', seuils: [{ jusqua: 5, nom: 'confort' }, { jusqua: 7, nom: 'tendu' }, { jusqua: 8, nom: 'saturé' }], cible: 7 } },
  { type: 'secteurs', famille: 'Composition', usage: 'Parts d’un tout (camembert plein), jusqu’à 16 parts.',
    exemple: { type: 'secteurs', titre: 'Paramètres de Metis-Alpha 31M', x: ['Embeddings (liés)', 'Attention', 'MLP SwiGLU', 'Normes'], series: [{ nom: 'Paramètres', valeurs: [8388608, 5242880, 17301504, 8704] }] } },
  { type: 'anneau', famille: 'Composition', usage: 'Parts d’un tout avec le total au centre.',
    exemple: { type: 'anneau', titre: 'Temps d’un run', x: ['Entraînement', 'Évaluation', 'Checkpoints', 'Journal'], series: [{ nom: 'Heures', valeurs: [41, 5, 1.5, 0.5] }], unite: 'h' } },
  { type: 'mosaique', famille: 'Composition', usage: 'Treemap : des parts nombreuses en rectangles proportionnels, groupes facultatifs (groupes : un nom par étiquette).',
    exemple: { type: 'mosaique', titre: 'Où sont les 30,9 M de paramètres', x: ['Embedding', 'Q', 'K', 'V', 'O', 'gate', 'up', 'down', 'RMSNorm'], series: [{ nom: 'Paramètres', valeurs: [8388608, 2097152, 524288, 524288, 2097152, 5767168, 5767168, 5767168, 8704] }], groupes: ['Entrée', 'Attention', 'Attention', 'Attention', 'Attention', 'MLP', 'MLP', 'MLP', 'Normes'] } },
  { type: 'schema', famille: 'Schéma', usage: 'Plan d’architecture : noeuds [{id, texte, sigle?, detail?, groupe?, forme? (boite|base|externe|pilule|note), rang?}], liens [{de, vers, texte?, style? (plein|pointille|epais), double?}], groupes [{id, texte}], sens "bas"|"droite", glossaire [{sigle, sens, detail?}] affiché sous la figure. Mise en page automatique.',
    exemple: { type: 'schema', titre: 'Les trois plans de Metis Forge', sens: 'bas',
      groupes: [{ id: 'ctrl', texte: 'Plan de contrôle' }, { id: 'data', texte: 'Plan des données' }, { id: 'learn', texte: 'Plan d’apprentissage' }],
      noeuds: [
        { id: 'but', texte: 'Contrat d’objectif', sigle: 'GC', forme: 'pilule', detail: 'Critères d’acceptation, contraintes, budget.' },
        { id: 'ledger', texte: 'Registre d’avancement', groupe: 'ctrl' }, { id: 'planner', texte: 'Planificateur', groupe: 'ctrl' },
        { id: 'backbone', texte: 'Backbone Metis', groupe: 'ctrl' },
        { id: 'outils', texte: 'shell, fichiers, git, tests', groupe: 'data' }, { id: 'verif', texte: 'Vérificateur externe', groupe: 'data' },
        { id: 'epo', texte: 'Oracle de progression', sigle: 'EPO', groupe: 'data', detail: 'Juge la progression sur des signaux objectifs.' },
        { id: 'traj', texte: 'ForgeTrajectory', groupe: 'learn', forme: 'base' }, { id: 'tag', texte: 'Porte d’admission', sigle: 'TAG', groupe: 'learn' },
      ],
      liens: [{ de: 'but', vers: 'ledger' }, { de: 'ledger', vers: 'planner' }, { de: 'planner', vers: 'backbone' }, { de: 'backbone', vers: 'outils', texte: 'actions' }, { de: 'outils', vers: 'verif' }, { de: 'verif', vers: 'epo' }, { de: 'epo', vers: 'traj' }, { de: 'traj', vers: 'tag' }, { de: 'epo', vers: 'ledger', texte: 'progrès', style: 'pointille' }],
      glossaire: [{ sigle: 'GC', sens: 'Goal Contract', detail: 'Contrat d’objectif posé avant toute tâche longue.' }, { sigle: 'EPO', sens: 'External Progress Oracle' }, { sigle: 'TAG', sens: 'Training Admission Gate', detail: 'Décide si une trajectoire devient donnée d’entraînement.' }] } },
  { type: 'sequence', famille: 'Schéma', usage: 'Échanges entre acteurs dans le temps : acteurs [noms], messages [{de, vers, texte, retour?}].',
    exemple: { type: 'sequence', titre: 'Connexion de ChatGPT au MCP Métis', acteurs: ['ChatGPT', 'Atlas SSO', 'MCP Métis'], messages: [{ de: 'ChatGPT', vers: 'MCP Métis', texte: 'POST /mcp sans jeton' }, { de: 'MCP Métis', vers: 'ChatGPT', texte: '401 + découverte OAuth', retour: true }, { de: 'ChatGPT', vers: 'Atlas SSO', texte: 'enregistrement puis autorisation (PKCE)' }, { de: 'Atlas SSO', vers: 'ChatGPT', texte: 'jeton portée metis', retour: true }, { de: 'ChatGPT', vers: 'MCP Métis', texte: 'tools/call avec Bearer' }] } },
  { type: 'flux', famille: 'Schéma', usage: 'Diagramme de Sankey : liens [{de, vers, valeur}] ; la largeur des bandes suit la valeur. Pas de boucle.',
    exemple: { type: 'flux', titre: 'Devenir des trajectoires', liens: [{ de: 'Collectées', vers: 'Vérifiées', valeur: 7400 }, { de: 'Collectées', vers: 'Rejetées', valeur: 4600 }, { de: 'Vérifiées', vers: 'SFT', valeur: 2400 }, { de: 'Vérifiées', vers: 'Préférences', valeur: 3100 }, { de: 'Vérifiées', vers: 'Mémoire', valeur: 1900 }] } },
  { type: 'chronologie', famille: 'Schéma', usage: 'Gantt : taches [{nom, debut, fin, groupe?, etat? (fait|en-cours|prevu), progression?}] en dates AAAA-MM-JJ ou en nombres ; jalons [{nom, date}] ; aujourdhui.',
    exemple: { type: 'chronologie', titre: 'Feuille de route Metis-Alpha', taches: [{ nom: 'Baseline + instrumentation', debut: '2026-09-17', fin: '2026-09-20', groupe: 'Socle', etat: 'fait' }, { nom: 'Trainer Alpha 0.3 fused', debut: '2026-09-19', fin: '2026-09-22', groupe: 'Socle', etat: 'fait' }, { nom: 'Observatory', debut: '2026-09-21', fin: '2026-09-23', groupe: 'Outils', etat: 'fait' }, { nom: 'Corpus v2', debut: '2026-09-23', fin: '2026-10-02', groupe: 'Données', etat: 'en-cours', progression: 40 }, { nom: 'Ablations ITL', debut: '2026-10-01', fin: '2026-10-20', groupe: 'Recherche', etat: 'prevu' }], jalons: [{ nom: 'Gel F1', date: '2026-10-10' }], aujourdhui: '2026-09-26' } },
  { type: 'planche', famille: 'Schéma', usage: 'Planche d’architecture (affiche technique) : blocs numérotés colorés par catégorie, placés sur une grille de colonnes (col, largeur) et empilés dans l’ordre d’écriture ; chaque bloc peut porter icone, sousTitre, texte, etiquettes, puces, cases, elements (sous-cartes, disposition "colonne"|"ligne", chaine pour les relier), pastilles, badge. liens orthogonaux annotés (depart/arrivee : haut|bas|gauche|droite pour forcer un côté), categories → légende, mots, pied, glossaire, gouttiere (espace entre colonnes en pixels, élargi tout seul pour les flèches annotées entre blocs voisins ; libellés de flèche courts). La liste des icônes est rendue par types_graphiques.',
    exemple: { type: 'planche', titre: 'MÉTIS-FORGE Ω.2 — Architecture système', sousTitre: 'Un agent de programmation autonome, sûr et vérifiable, du code au patch certifié',
      mots: ['Comprendre', 'Raisonner', 'Agir', 'Vérifier', 'Progresser'], colonnes: 12,
      categories: [{ id: 'entree', nom: 'Entrée / Objectif', couleur: 2 }, { id: 'connaissance', nom: 'Connaissance (code et preuves)', couleur: 6 }, { id: 'coeur', nom: 'Cœur neuronal', couleur: 5 }, { id: 'decision', nom: 'Décision et action', couleur: 4 }, { id: 'securite', nom: 'Sécurité et vérification', couleur: 1 }, { id: 'sortie', nom: 'Sortie / résultat', couleur: 3 }, { id: 'infra', nom: 'Mémoire et infrastructure', couleur: 8 }],
      blocs: [
        { id: 'objectif', numero: '1', titre: 'Utilisateur / Objectif', icone: 'utilisateur', categorie: 'entree', col: 1, largeur: 3, puces: ['Demande en langage naturel', 'Contexte, contraintes', 'Critères de succès'] },
        { id: 'contrat', numero: '2', titre: 'Task Contract Compiler', icone: 'document', categorie: 'entree', col: 4, largeur: 3, puces: ['Analyse de la demande', 'Objectifs et métriques formalisés', 'Contrat de tâche (spécification)'], badge: 'Task Contract' },
        { id: 'coeur', numero: '11', titre: 'MÉTIS Neural Core', sousTitre: 'Cœur cognitif et raisonnement', categorie: 'coeur', col: 7, largeur: 3,
          elements: [{ titre: 'Decision-State Encoder', icone: 'cerveau', puces: ['Fusion : objectif, RSI, preuves, état', 'Représentation d’état décisionnel'] }, { titre: 'Streaming Context Mixer', icone: 'melange', texte: 'Mélange du contexte en flux + attention exacte rare' }, { titre: 'Recurrent Cognitive Core', icone: 'boucle', puces: ['Raisonnement itératif', 'Réflexion et autocritique'] }],
          pastilles: [{ texte: 'ECO', couleur: 3 }, { texte: 'NORMAL', couleur: 2 }, { texte: 'FOCUS', couleur: 4 }, { texte: 'DEEP', couleur: 1 }, { texte: 'AUDIT', couleur: 5 }] },
        { id: 'tetes', numero: '12', titre: 'Têtes cognitives', sousTitre: 'Spécialisation des sorties', categorie: 'decision', col: 10, largeur: 3,
          elements: [{ titre: 'Actor Head', icone: 'code', texte: 'Choix et paramétrage des actions' }, { titre: 'Pointer Head', icone: 'cible', texte: 'Sélection de code, fichiers, outils' }, { titre: 'Risk Head', icone: 'alerte', texte: 'Analyse des risques' }, { titre: 'Halt Head', icone: 'drapeau', texte: 'Décision d’arrêt' }] },
        { id: 'depot', numero: '3', titre: 'Repository Machine', sousTitre: 'Compréhension approfondie du dépôt', icone: 'base', categorie: 'connaissance', col: 1, largeur: 3,
          etiquettes: ['AST', 'Types', 'Call Graph', 'Tests', 'History'], elements: [{ titre: 'Analyse statique', icone: 'loupe' }, { titre: 'Suivi de l’historique', icone: 'horloge' }, { titre: 'Carte des dépendances', icone: 'reseau' }] },
        { id: 'rsi', numero: '4', titre: 'Repository State Image (RSI)', icone: 'presse', categorie: 'connaissance', col: 4, largeur: 3, texte: 'Instantané structuré du dépôt', puces: ['Code normalisé', 'Index sémantiques', 'État des tests'] },
        { id: 'preuves', numero: '8', titre: 'Evidence Records', icone: 'document', categorie: 'connaissance', col: 1, largeur: 3, puces: ['Résultats d’outils', 'Logs d’exécution', 'Tests et métriques'] },
        { id: 'hypergraphe', numero: '9', titre: 'Evidence Hypergraph', icone: 'reseau', categorie: 'connaissance', col: 4, largeur: 3, etiquettes: ['Hypothèses', 'Preuves', 'Contraintes', 'Actions'], puces: ['Liens causaux et temporels'] },
        { id: 'verif', numero: '19', titre: 'Verifier Ladder', sousTitre: 'Validation progressive des correctifs', icone: 'liste', categorie: 'securite', col: 7, largeur: 6, cases: ['Syntaxe', 'Types', 'Contrat', 'Tests ciblés', 'Régressions', { titre: 'Propriétés', texte: 'Fuzz / SMT' }] },
        { id: 'securite', numero: '20', titre: 'Chaîne de sécurité d’exécution', icone: 'bouclier', categorie: 'securite', col: 7, largeur: 6, style: 'tirets', disposition: 'ligne', chaine: true,
          elements: [{ titre: 'Policy Engine', icone: 'bouclier', texte: 'Règles et garde-fous' }, { titre: 'Juge consultatif', icone: 'balance', texte: 'Avis non contraignant' }, { titre: 'Sandbox jetable', icone: 'cube', texte: 'Exécution isolée' }] },
        { id: 'compression', numero: '10', titre: 'Decision-Sufficient Compression', icone: 'filtre', categorie: 'coeur', col: 1, largeur: 6, texte: 'logs bruts → résumé latent + référence blob', puces: ['Compression orientée décision', 'Conservation des références (blob store)'] },
        { id: 'patch', numero: '21', titre: 'Patch certifié / Réponse', icone: 'valide', categorie: 'sortie', col: 7, largeur: 6, puces: ['Correctif prêt à merger', 'Preuves et rapports', 'Traçabilité complète'] },
        { id: 'memoire', numero: '22', titre: 'Hiérarchie mémoire et infrastructure d’exécution', icone: 'serveur', categorie: 'infra', col: 1, largeur: 9, disposition: 'ligne', chaine: ['prefetch', 'prefetch', 'archivage'],
          elements: [{ titre: 'VRAM', texte: 'poids actifs, workspace' }, { titre: 'RAM épinglée', texte: 'prefetch asynchrone' }, { titre: 'RAM', texte: 'RSI, graphe, épisodes' }, { titre: 'NVMe', texte: 'archives, index' }] },
        { id: 'but', numero: '23', titre: 'Objectif du système', icone: 'cible', categorie: 'sortie', col: 10, largeur: 3, puces: ['Agent autonome', 'Sûr et vérifiable', 'Calcul adaptatif'] },
      ],
      liens: [
        { de: 'objectif', vers: 'contrat' }, { de: 'objectif', vers: 'depot' }, { de: 'contrat', vers: 'rsi' }, { de: 'depot', vers: 'rsi', texte: 'snapshot' },
        { de: 'rsi', vers: 'coeur', texte: 'état du dépôt' }, { de: 'depot', vers: 'preuves' }, { de: 'preuves', vers: 'hypergraphe' }, { de: 'hypergraphe', vers: 'coeur', texte: 'preuves' },
        { de: 'coeur', vers: 'tetes' }, { de: 'tetes', vers: 'verif', texte: 'actions proposées' }, { de: 'securite', vers: 'verif', texte: 'vérifie avant exécution', style: 'pointille' },
        { de: 'verif', vers: 'patch', depart: 'gauche', arrivee: 'gauche', texte: 'correctif validé' }, { de: 'compression', vers: 'coeur', texte: 'contexte compressé' },
      ],
      pied: 'Du code à la connaissance, de la connaissance à l’impact.',
      glossaire: [{ sigle: 'RSI', sens: 'Repository State Image', detail: 'Instantané structuré du dépôt que le cœur reçoit.' }, { sigle: 'SMT', sens: 'Satisfiability Modulo Theories', detail: 'Solveurs qui prouvent des propriétés.' }] } },
];

// Les styles que la page doit porter (clair ET sombre). Exportés pour qu'une page
// qui affiche des graphiques n'ait pas à les recopier.
const COUL_CLAIR = '--g-1f:#a4492c;--g-2f:#2f6399;--g-3f:#4d6135;--g-4f:#86691c;--g-5f:#6a4a95;--g-6f:#2f6f71;--g-7f:#94395d;--g-8f:#4f4d47;--g-sur:#fff;--g-1:#d97757;--g-2:#6a9bcc;--g-3:#788c5d;--g-4:#c2a14a;--g-5:#9b7cc2;--g-6:#5f9ea0;--g-7:#c46a8e;--g-8:#7d7b74;--g-texte:#191919;--g-pale:#6b6a66;--g-fond:#faf9f5;--g-grille:rgba(0,0,0,.08);--g-grille-fort:rgba(0,0,0,.1);--g-axe:rgba(0,0,0,.4)';
const COUL_SOMBRE = '--g-1f:#f2b39b;--g-2f:#b3d0ef;--g-3f:#bfd3a5;--g-4f:#ecd592;--g-5f:#d2bff0;--g-6f:#a8dadb;--g-7f:#efb5ca;--g-8f:#cfcdc6;--g-sur:#1f1e1d;--g-1:#e8906f;--g-2:#8ab4e0;--g-3:#9cb57d;--g-4:#dcbc62;--g-5:#b79be0;--g-6:#7fbfc1;--g-7:#dc8eab;--g-8:#a8a69e;--g-texte:#ececea;--g-pale:#a3a29c;--g-fond:#262624;--g-grille:rgba(255,255,255,.09);--g-grille-fort:rgba(255,255,255,.12);--g-axe:rgba(255,255,255,.4)';
const CSS = `
.graphique{width:100%;height:auto;display:block}
.graphique .g-titre{font:600 16px var(--police,system-ui);fill:var(--g-texte)}
.graphique .g-sous{font:13px var(--police,system-ui);fill:var(--g-pale)}
.graphique .g-axe{font:11.5px var(--police,system-ui);fill:var(--g-pale)}
.graphique .g-axe-titre{font-weight:600}
.graphique .g-leg{font:12.5px var(--police,system-ui);fill:var(--g-texte)}
.graphique .g-val{font:600 11px var(--police,system-ui);fill:var(--g-texte);paint-order:stroke;stroke:var(--g-fond);stroke-width:3px;stroke-linejoin:round}
.graphique .g-total{font:600 26px var(--police,system-ui);fill:var(--g-texte)}
.graphique .g-grille{stroke:var(--g-grille);stroke-width:1}
.graphique .g-grille-poly{fill:none;stroke:var(--g-grille-fort);stroke-width:1}
.graphique .g-trait{stroke:var(--g-axe);stroke-width:1.2}
.graphique .g-repere{stroke:var(--g-pale);stroke-width:1.2;stroke-dasharray:5 4}
.graphique .g-repere-texte{font:600 11px var(--police,system-ui);fill:var(--g-pale);paint-order:stroke;stroke:var(--g-fond);stroke-width:3px}
.graphique .g-moustache{fill:none;stroke:var(--g-texte);stroke-width:1.3;opacity:.7}
.graphique .g-haltere{stroke:var(--g-axe);stroke-width:3;stroke-linecap:round}
.graphique .g-lien-fin{stroke:var(--g-axe);stroke-width:1;stroke-dasharray:3 3}
.graphique .g-case-vide{fill:none;stroke:var(--g-grille-fort);stroke-dasharray:3 3}
.graphique .g-point-clair{fill:var(--g-fond)}
.graphique .g-aiguille{stroke:var(--g-texte);stroke-width:4;stroke-linecap:round}
.graphique .g-moyeu{fill:var(--g-texte)}
.graphique .g-cible{stroke:var(--g-texte);stroke-width:2.2;stroke-dasharray:4 3}
.graphique .g-jalon{fill:var(--g-texte)}
.graphique .g-tuile{font:600 12px var(--police,system-ui);fill:var(--g-sur)}
.graphique .g-tuile-v{font-weight:400;font-size:11px}
.graphique .g-part{stroke:var(--g-fond);stroke-width:1.5}
.graphique .g-bloc{fill:var(--g-fond);stroke-width:1.5}
.graphique .g-bloc-externe{stroke-dasharray:6 4}
.graphique .g-bloc-titre{font:600 12.5px var(--police,system-ui);fill:var(--g-texte)}
.graphique .g-bloc-sigle{font:700 13px var(--police,system-ui);fill:var(--g-texte);letter-spacing:.02em}
.graphique .g-bloc-texte{font:11.5px var(--police,system-ui);fill:var(--g-texte)}
.graphique .g-groupe{stroke-width:1.3;stroke-opacity:.75}
.graphique .g-groupe-titre{font:700 11.5px var(--police,system-ui);letter-spacing:.03em}
.graphique .g-lien{fill:none;stroke:var(--g-axe);stroke-width:1.5}
.graphique .g-lien-tirets{stroke-dasharray:6 4}
.graphique .g-lien-epais{stroke-width:2.8}
.graphique .g-fleche{fill:var(--g-axe)}
.graphique .g-vie{stroke:var(--g-axe);stroke-width:1;stroke-dasharray:4 4}
.graphique .g-etiquette{fill:var(--g-fond);stroke:var(--g-grille-fort)}
.graphique .g-etiquette-texte{font:11px var(--police,system-ui);fill:var(--g-texte)}
${Planche.CSS}
.glossaire-fig{margin:10px 0 0;padding:10px 0 0;border-top:1px solid var(--g-grille-fort);display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:6px 18px;font-size:13.5px;line-height:1.45}
.glossaire-fig div{display:flex;gap:10px}.glossaire-fig dt{font-weight:700;min-width:44px;white-space:nowrap;flex-shrink:0}.glossaire-fig dd{margin:0;color:var(--g-pale)}.glossaire-fig dd b{color:var(--g-texte);font-weight:600}
.glossaire-fig abbr{text-decoration:none}
:root{${COUL_CLAIR}}
@media (prefers-color-scheme:dark){:root:not([data-theme="light"]){${COUL_SOMBRE}}}
:root[data-theme="dark"]{${COUL_SOMBRE}}
`;

module.exports = { valider, rendre, graphique, glossaireHtml, resumer, graduations, fmt, TYPES, ALIAS, CATALOGUE, CSS, COUL_CLAIR, COUL_SOMBRE, MAX_SERIES, MAX_POINTS };


};
