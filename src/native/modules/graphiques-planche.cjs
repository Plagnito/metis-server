// Adapted from Plagni/atlas 227e897b68fbbaf2d6436084526519bf28ededf8. AGPL-3.0-only.
module.exports = function nativeModule(require, module, __dirname) {
'use strict';

// =============================================================================
//  graphiques-planche — la PLANCHE D'ARCHITECTURE : une affiche technique
// -----------------------------------------------------------------------------
//  Demandée le 26/09/2026 à partir d'une affiche « MÉTIS-FORGE Ω.2 — Architecture
//  système » : des blocs numérotés, colorés par catégorie, avec icône, sous-titre,
//  puces, étiquettes, sous-cartes, cases, pastilles, reliés par des flèches
//  annotées, une légende et un pied. ChatGPT la DÉCRIT en JSON ; le serveur la
//  DESSINE (SVG, lisible sans JavaScript, clair ET sombre).
//
//  La mise en page tient en deux idées, pour que le modèle garde la main sans avoir
//  à calculer des pixels :
//  • une GRILLE de colonnes (12 par défaut) : chaque bloc dit où il commence (col)
//    et combien de colonnes il couvre (largeur) ;
//  • un EMPILEMENT : un bloc se pose sous le plus bas des blocs déjà placés dans
//    ses colonnes, dans l'ordre d'écriture. Sa hauteur suit son contenu.
//  Les flèches sont orthogonales, sortent du côté le plus direct (ou de celui
//  qu'on leur impose) et se répartissent le long d'un côté partagé.
//
//  Module PUR, appelé par graphiques.js (validerPlanche, planche). Les messages
//  d'erreur nomment le champ fautif : c'est un modèle de langue qui les lit.
// =============================================================================

const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const court = (s, n) => { const t = String(s == null ? '' : s).replace(/[\u0000-\u001f]/g, ' ').trim(); return t.length > n ? t.slice(0, n - 1) + '…' : t; };
const f1 = (v) => (Math.round(v * 10) / 10).toString();
const rang8 = (i) => ((((i | 0) % 8) + 8) % 8) + 1;
const couleur = (i) => 'var(--g-' + rang8(i) + ')';
const fonce = (i) => 'var(--g-' + rang8(i) + 'f)';
const fleche = (id, i) => 'url(#' + id + '-pf' + rang8(i) + ')';
const largeurTexte = (s, t) => String(s).length * t * 0.55;

/** Coupe un texte pour tenir dans `px` pixels à la taille `t` (au plus `max` lignes). */
function couper(texte, px, t, max = 6) {
  const n = Math.max(4, Math.floor(px / (t * 0.55)));
  const out = [];
  let cur = '';
  for (const m of String(texte || '').split(/\s+/).filter(Boolean)) {
    if (!cur) cur = m;
    else if ((cur + ' ' + m).length <= n) cur += ' ' + m;
    else { out.push(cur); cur = m; }
  }
  if (cur) out.push(cur);
  const r = out.map((l) => court(l, n));
  if (r.length > max) { r.length = max; r[max - 1] = court(r[max - 1] + ' …', n); }
  return r.length ? r : [''];
}

// ── Icônes (24 × 24, trait) ───────────────────────────────────────────────────
const ICONES = {
  utilisateur: '<circle cx="12" cy="8" r="4"/><path d="M4 21c0-4.4 3.6-7 8-7s8 2.6 8 7"/>',
  equipe: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c0-3.6 2.9-6 6.5-6s6.5 2.4 6.5 6M16 4.5a3.5 3.5 0 0 1 0 7M18 14c2.2.6 3.5 2.8 3.5 6"/>',
  document: '<path d="M6 2.5h8l4.5 4.5v14.5h-12.5z"/><path d="M14 2.5V7h4.5M9 12h6.5M9 16h6.5"/>',
  presse: '<rect x="5" y="4" width="14" height="17.5" rx="2"/><path d="M9 2.5h6v3H9zM8.5 13l2.5 2.5 4.5-4.5"/>',
  base: '<ellipse cx="12" cy="5.5" rx="8" ry="3"/><path d="M4 5.5v13c0 1.7 3.6 3 8 3s8-1.3 8-3v-13M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3"/>',
  engrenage: '<circle cx="12" cy="12" r="3.2"/><circle cx="12" cy="12" r="6.5"/><path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M5.3 5.3l2.1 2.1M16.6 16.6l2.1 2.1M5.3 18.7l2.1-2.1M16.6 7.4l2.1-2.1"/>',
  reseau: '<circle cx="12" cy="5" r="2.5"/><circle cx="5" cy="18.5" r="2.5"/><circle cx="19" cy="18.5" r="2.5"/><path d="M10.8 7.2 6.2 16.3M13.2 7.2l4.6 9.1M7.5 18.5h9"/>',
  couches: '<path d="M12 3 2.5 8 12 13l9.5-5z"/><path d="m2.5 12.5 9.5 5 9.5-5M2.5 17 12 22l9.5-5"/>',
  filtre: '<path d="M3 4h18l-7 8.5V19l-4 2v-8.5z"/>',
  cerveau: '<path d="M9.5 3.5A3 3 0 0 0 6.5 6.5a3 3 0 0 0-2 5.2 3 3 0 0 0 2 5.3 3 3 0 0 0 3 3 2.5 2.5 0 0 0 2.5-2.5v-11a2.5 2.5 0 0 0-2.5-3zM14.5 3.5a3 3 0 0 1 3 3 3 3 0 0 1 2 5.2 3 3 0 0 1-2 5.3 3 3 0 0 1-3 3A2.5 2.5 0 0 1 12 17.5"/>',
  puce: '<rect x="6" y="6" width="12" height="12" rx="2"/><rect x="9.5" y="9.5" width="5" height="5"/><path d="M9 2.5V6M15 2.5V6M9 18v3.5M15 18v3.5M2.5 9H6M2.5 15H6M18 9h3.5M18 15h3.5"/>',
  globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c2.5 2.7 3.8 5.7 3.8 9s-1.3 6.3-3.8 9c-2.5-2.7-3.8-5.7-3.8-9S9.5 5.7 12 3z"/>',
  bouclier: '<path d="M12 2.5 4 5.5v6c0 5 3.4 8.6 8 10 4.6-1.4 8-5 8-10v-6z"/><path d="m8.5 12 2.5 2.5 4.5-5"/>',
  cle: '<path d="M15 3.5a5 5 0 0 0-4.6 6.9l-6.9 6.9a2.3 2.3 0 0 0 3.2 3.2l6.9-6.9A5 5 0 0 0 20.5 9l-3 3-3-.5-.5-3 3-3A5 5 0 0 0 15 3.5z"/>',
  cible: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5.5"/><circle cx="12" cy="12" r="2"/>',
  eclair: '<path d="M13 2.5 4.5 13.5H12l-1 8 8.5-11H12z"/>',
  horloge: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3.5 2"/>',
  loupe: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="m15.5 15.5 5 5"/>',
  code: '<path d="m8 7-5 5 5 5M16 7l5 5-5 5M14 4l-4 16"/>',
  fiole: '<path d="M9 2.5h6M10 2.5v6L4.5 19a1.8 1.8 0 0 0 1.6 2.5h11.8a1.8 1.8 0 0 0 1.6-2.5L14 8.5v-6M7 15h10"/>',
  serveur: '<rect x="3" y="3.5" width="18" height="7" rx="2"/><rect x="3" y="13.5" width="18" height="7" rx="2"/><path d="M7 7h.01M7 17h.01"/>',
  nuage: '<path d="M7 19a4.5 4.5 0 0 1-.5-9A6 6 0 0 1 18 9a4.5 4.5 0 0 1 0 10z"/>',
  cadenas: '<rect x="4.5" y="10.5" width="15" height="11" rx="2"/><path d="M8 10.5V7a4 4 0 0 1 8 0v3.5"/>',
  valide: '<circle cx="12" cy="12" r="9"/><path d="m8 12 3 3 5-6"/>',
  alerte: '<path d="M12 3 2 20.5h20z"/><path d="M12 9.5v5M12 17.5h.01"/>',
  graphique: '<path d="M3.5 20.5h17M7 17v-6M12 17V6M17 17V9"/>',
  courbe: '<path d="M3.5 3.5v17h17"/><path d="m6.5 15 4-5 3.5 3 5.5-7"/>',
  dossier: '<path d="M3 6.5a2 2 0 0 1 2-2h4l2 2.5h8a2 2 0 0 1 2 2V18a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
  branche: '<circle cx="6" cy="5" r="2.5"/><circle cx="6" cy="19" r="2.5"/><circle cx="18" cy="8" r="2.5"/><path d="M6 7.5v9M18 10.5c0 4-4 4.5-9.5 7"/>',
  boucle: '<path d="M20 11a8 8 0 0 0-14.5-4.5M4 13a8 8 0 0 0 14.5 4.5"/><path d="M5 3v4h4M19 21v-4h-4"/>',
  balance: '<path d="M12 3v18M7 21h10M5 7h14M5 7l-3 7a3.5 3.5 0 0 0 6 0zM19 7l-3 7a3.5 3.5 0 0 0 6 0z"/>',
  terminal: '<rect x="2.5" y="4" width="19" height="16" rx="2"/><path d="m6.5 9 3 3-3 3M12 15h5"/>',
  memoire: '<rect x="3" y="6.5" width="18" height="10" rx="1.5"/><path d="M7 9.5v4M11 9.5v4M15 9.5v4M6 16.5v3M10 16.5v3M14 16.5v3M18 16.5v3"/>',
  livre: '<path d="M4 4.5a2 2 0 0 1 2-2h13v16H6a2 2 0 0 0-2 2zM4 20.5a2 2 0 0 0 2 1.5h13v-3.5"/>',
  ampoule: '<path d="M9 18h6M10 21.5h4M12 2.5a6.5 6.5 0 0 0-4 11.6c.7.6 1 1.3 1 2.2V17h6v-.7c0-.9.3-1.6 1-2.2A6.5 6.5 0 0 0 12 2.5z"/>',
  drapeau: '<path d="M5 21.5v-18M5 4h12l-2.5 4.5L17 13H5"/>',
  liste: '<path d="M9 6h11M9 12h11M9 18h11M4 6h.01M4 12h.01M4 18h.01"/>',
  cube: '<path d="M12 2.5 3.5 7v10l8.5 4.5 8.5-4.5V7z"/><path d="M3.5 7 12 11.5 20.5 7M12 11.5v10"/>',
  fleche: '<path d="M4 12h16M14 6l6 6-6 6"/>',
  etoile: '<path d="m12 2.8 2.8 5.8 6.3.9-4.6 4.4 1.1 6.3-5.6-3-5.6 3 1.1-6.3-4.6-4.4 6.3-.9z"/>',
  robot: '<rect x="4.5" y="8" width="15" height="11" rx="2.5"/><circle cx="12" cy="3.5" r="1"/><path d="M12 4.5V8M9 13h.01M15 13h.01M9.5 16h5M2.5 12v3M21.5 12v3"/>',
  oeil: '<path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
  melange: '<path d="M3 7h3.5c4 0 5 10 9 10H21M3 17h3.5c1.6 0 2.7-1.6 3.6-3.5M14 9.5c.9-1.4 1.9-2.5 3.5-2.5H21M18 4l3 3-3 3M18 14l3 3-3 3"/>',
  bouche: '<path d="M4 5.5h16a1.5 1.5 0 0 1 1.5 1.5v9a1.5 1.5 0 0 1-1.5 1.5H10l-5 4v-4H4A1.5 1.5 0 0 1 2.5 16V7A1.5 1.5 0 0 1 4 5.5z"/>',
  maison: '<path d="M3 11 12 3.5l9 7.5M5.5 9v11.5h13V9"/><path d="M10 20.5v-6h4v6"/>',
};

const SIDES = ['haut', 'bas', 'gauche', 'droite'];
const lim = { blocs: 48, puces: 14, etiquettes: 18, elements: 10, cases: 8, pastilles: 10, liens: 90, categories: 10 };

function tableauTextes(v, chemin, e, max, n) {
  if (v === undefined) return [];
  if (!Array.isArray(v) || v.length > max || v.some((x) => typeof x !== 'string' && typeof x !== 'number')) { e.push(chemin + ' doit être une liste (au plus ' + max + ') de textes.'); return null; }
  return v.map((x) => court(x, n));
}
function icone(v, chemin, e) {
  if (v == null || v === '') return null;
  if (!ICONES[v]) { e.push(chemin + ' « ' + v + ' » n’existe pas. Icônes : ' + Object.keys(ICONES).join(', ') + '.'); return undefined; }
  return v;
}
const numCouleur = (c) => (Number.isInteger(c) && c >= 1 && c <= 8 ? c - 1 : null);

/** Valide une planche. Rend l'objet normalisé (sans les champs communs) ou null avec des erreurs dans `e`. */
function valider(entree, e) {
  const C = entree.colonnes == null ? 12 : entree.colonnes;
  if (!Number.isInteger(C) || C < 2 || C > 24) { e.push('colonnes doit être un entier de 2 à 24 (12 par défaut).'); return null; }
  const W = entree.largeur == null ? 1200 : entree.largeur;
  if (!Number.isFinite(W) || W < 700 || W > 1800) { e.push('largeur (en pixels) doit être comprise entre 700 et 1800 (1200 par défaut).'); return null; }
  const categories = [];
  if (entree.categories !== undefined) {
    if (!Array.isArray(entree.categories) || entree.categories.length > lim.categories) { e.push('categories doit être une liste (au plus ' + lim.categories + ') de { id, nom, couleur? (1 à 8) }.'); return null; }
    for (const [k, c] of entree.categories.entries()) {
      if (!c || !c.id || !c.nom) { e.push('categories[' + k + '] doit donner id et nom.'); return null; }
      categories.push({ id: String(c.id).slice(0, 40), nom: court(c.nom, 40), couleur: numCouleur(c.couleur) != null ? numCouleur(c.couleur) : categories.length });
    }
  }
  const B = Array.isArray(entree.blocs) ? entree.blocs : null;
  if (!B || !B.length) { e.push('blocs doit être une liste de { id, titre, col?, largeur?, categorie?, icone?, puces?, … }. L’outil types_graphiques donne un exemple complet.'); return null; }
  if (B.length > lim.blocs) { e.push('Au plus ' + lim.blocs + ' blocs (reçu : ' + B.length + ').'); return null; }
  const ids = new Set(), blocs = [];
  let curseur = 1;
  for (const [k, b] of B.entries()) {
    const ch = 'blocs[' + k + ']';
    if (!b || typeof b !== 'object') { e.push(ch + ' doit être un objet.'); return null; }
    const id = String(b.id == null ? 'b' + (k + 1) : b.id);
    if (!/^[A-Za-z0-9_.:-]{1,40}$/.test(id)) { e.push(ch + '.id : lettres, chiffres, tirets (1 à 40 caractères).'); return null; }
    if (ids.has(id)) { e.push(ch + '.id « ' + id + ' » est en double.'); return null; }
    ids.add(id);
    if (!b.titre) { e.push(ch + '.titre est obligatoire.'); return null; }
    const largeur = b.largeur == null ? Math.min(C, Math.max(1, Math.round(C / 3))) : b.largeur;
    if (!Number.isInteger(largeur) || largeur < 1 || largeur > C) { e.push(ch + '.largeur doit être un nombre de colonnes de 1 à ' + C + '.'); return null; }
    let col = b.col;
    if (col == null) { if (curseur + largeur - 1 > C) curseur = 1; col = curseur; }
    if (!Number.isInteger(col) || col < 1 || col + largeur - 1 > C) { e.push(ch + ' : col (' + col + ') + largeur (' + largeur + ') dépasse les ' + C + ' colonnes (col va de 1 à ' + C + ').'); return null; }
    curseur = col + largeur; if (curseur > C) curseur = 1;
    let categorie = b.categorie == null ? null : String(b.categorie);
    if (categorie != null && !categories.some((c) => c.id === categorie)) {
      if (entree.categories === undefined) categories.push({ id: categorie, nom: court(categorie, 40), couleur: categories.length });
      else { e.push(ch + '.categorie « ' + categorie + ' » n’existe pas dans categories.'); return null; }
    }
    const ic = icone(b.icone, ch + '.icone', e); if (ic === undefined) return null;
    const puces = tableauTextes(b.puces, ch + '.puces', e, lim.puces, 140); if (!puces) return null;
    const etiquettes = tableauTextes(b.etiquettes, ch + '.etiquettes', e, lim.etiquettes, 40); if (!etiquettes) return null;
    const cases = [];
    if (b.cases !== undefined) {
      if (!Array.isArray(b.cases) || b.cases.length > lim.cases) { e.push(ch + '.cases doit être une liste (au plus ' + lim.cases + ') de textes ou de { titre, texte? }.'); return null; }
      for (const c of b.cases) cases.push(typeof c === 'object' && c ? { titre: court(c.titre || '', 30), texte: court(c.texte || '', 60) } : { titre: court(c, 30), texte: '' });
    }
    const pastilles = [];
    if (b.pastilles !== undefined) {
      if (!Array.isArray(b.pastilles) || b.pastilles.length > lim.pastilles) { e.push(ch + '.pastilles doit être une liste (au plus ' + lim.pastilles + ') de textes ou de { texte, couleur? }.'); return null; }
      for (const p of b.pastilles) pastilles.push(typeof p === 'object' && p ? { texte: court(p.texte || '', 20), couleur: numCouleur(p.couleur) } : { texte: court(p, 20), couleur: null });
    }
    const elements = [];
    if (b.elements !== undefined) {
      if (!Array.isArray(b.elements) || b.elements.length > lim.elements) { e.push(ch + '.elements doit être une liste (au plus ' + lim.elements + ') de { titre, texte?, icone?, puces? }.'); return null; }
      for (const [j, x] of b.elements.entries()) {
        if (!x || (!x.titre && !x.texte)) { e.push(ch + '.elements[' + j + '] doit avoir un titre ou un texte.'); return null; }
        const ie = icone(x.icone, ch + '.elements[' + j + '].icone', e); if (ie === undefined) return null;
        const pe = tableauTextes(x.puces, ch + '.elements[' + j + '].puces', e, 8, 120); if (!pe) return null;
        elements.push({ titre: court(x.titre || '', 60), texte: court(x.texte || '', 200), icone: ie, puces: pe, couleur: numCouleur(x.couleur) });
      }
    }
    if (b.disposition != null && !['colonne', 'ligne'].includes(b.disposition)) { e.push(ch + '.disposition doit valoir colonne ou ligne.'); return null; }
    let chaine = null;
    if (b.chaine === true) chaine = elements.map(() => '');
    else if (Array.isArray(b.chaine)) chaine = b.chaine.map((x) => court(x, 30));
    if (b.aligner != null && !B.slice(0, k).some((o) => String(o.id) === String(b.aligner))) { e.push(ch + '.aligner doit nommer un bloc écrit AVANT lui.'); return null; }
    blocs.push({
      id, col, largeur, categorie, icone: ic, puces, etiquettes, cases, pastilles, elements,
      numero: b.numero == null ? null : court(b.numero, 6), titre: court(b.titre, 80), sousTitre: court(b.sousTitre || '', 140), texte: court(b.texte || '', 400),
      badge: b.badge ? court(b.badge, 40) : null, disposition: b.disposition || 'colonne', chaine,
      style: b.style === 'tirets' ? 'tirets' : 'plein', aligner: b.aligner != null ? String(b.aligner) : null,
      hauteurMin: Number.isFinite(b.hauteurMin) ? Math.max(0, Math.min(900, b.hauteurMin)) : 0, espaceAvant: Number.isFinite(b.espaceAvant) ? Math.max(0, Math.min(300, b.espaceAvant)) : 0,
      couleur: numCouleur(b.couleur),
    });
  }
  const liens = [];
  const L = entree.liens === undefined ? [] : entree.liens;
  if (!Array.isArray(L) || L.length > lim.liens) { e.push('liens doit être une liste (au plus ' + lim.liens + ') de { de, vers, texte?, style?, depart?, arrivee? }.'); return null; }
  for (const [k, l] of L.entries()) {
    if (!l || !ids.has(String(l.de)) || !ids.has(String(l.vers))) { e.push('liens[' + k + '] : de et vers doivent être des id de blocs (reçu ' + JSON.stringify(l && l.de) + ' → ' + JSON.stringify(l && l.vers) + ').'); return null; }
    if (String(l.de) === String(l.vers)) { e.push('liens[' + k + '] relie un bloc à lui-même.'); return null; }
    for (const s of ['depart', 'arrivee']) if (l[s] != null && !SIDES.includes(l[s])) { e.push('liens[' + k + '].' + s + ' doit valoir ' + SIDES.join(', ') + '.'); return null; }
    if (l.style != null && !['plein', 'pointille', 'epais'].includes(l.style)) { e.push('liens[' + k + '].style doit valoir plein, pointille ou epais.'); return null; }
    liens.push({ de: String(l.de), vers: String(l.vers), texte: l.texte ? court(l.texte, 60) : null, style: l.style || 'plein', depart: l.depart || null, arrivee: l.arrivee || null, double: l.double === true });
  }
  const mots = tableauTextes(entree.mots, 'mots', e, 8, 24); if (!mots) return null;
  let gouttiere = null;
  if (entree.gouttiere != null) {
    if (!Number.isFinite(entree.gouttiere) || entree.gouttiere < 12 || entree.gouttiere > 120) { e.push('gouttiere (espace entre colonnes, en pixels) doit être comprise entre 12 et 120.'); return null; }
    gouttiere = entree.gouttiere;
  } else {
    // Des flèches ANNOTÉES entre blocs voisins d'une même rangée ont besoin de place
    // pour leur libellé : la gouttière s'élargit d'elle-même (plafonnée), sauf réglage explicite.
    const pos = new Map(blocs.map((b) => [b.id, b]));
    const besoin = liens.filter((l) => l.texte).map((l) => { const a = pos.get(l.de), b = pos.get(l.vers); return (a.col + a.largeur === b.col || b.col + b.largeur === a.col) ? largeurTexte(l.texte, 11.5) + 18 : 0; });
    gouttiere = Math.max(22, Math.min(90, Math.max(0, ...besoin)));
  }
  return { colonnes: C, largeur: W, categories, blocs, liens, mots, gouttiere, pied: court(entree.pied || '', 160), series: [] };
}

// ── Mise en page d'un bloc : on mesure puis on dessine ───────────────────────
const P = 14; // marge intérieure
function mesurerBloc(b, w) {
  const iw = w - 2 * P;
  const aIcone = !!b.icone;
  const tx = aIcone ? 46 : 0;
  const titre = couper((b.numero ? b.numero + '. ' : '') + b.titre, iw - tx, 15.5, 3);
  const sous = b.sousTitre ? couper(b.sousTitre, iw - tx, 12.5, 3) : [];
  let y = P + 2;
  const tete = Math.max(aIcone ? 36 : 0, titre.length * 19 + sous.length * 16);
  const o = { titre, sous, tx, tete, parts: [] };
  y += tete + 8;
  if (b.texte) { const l = couper(b.texte, iw, 12.5, 8); o.parts.push({ k: 'texte', y, l }); y += l.length * 16 + 6; }
  if (b.etiquettes.length) {
    // Des pastilles de texte qui passent à la ligne quand la largeur est pleine.
    let x = 0, r = 0; const pos = [];
    for (const t of b.etiquettes) { const lw = largeurTexte(t, 11.5) + 18; if (x && x + lw > iw) { x = 0; r++; } pos.push({ t, x, r, lw }); x += lw + 6; }
    o.parts.push({ k: 'etiquettes', y, pos }); y += (r + 1) * 26 + 4;
  }
  if (b.puces.length) {
    const l = b.puces.map((p) => couper(p, iw - 14, 12, 4));
    o.parts.push({ k: 'puces', y, l }); y += l.reduce((a, x) => a + x.length * 16 + 3, 0) + 4;
  }
  if (b.cases.length) {
    const n = b.cases.length, cw = (iw - (n - 1) * 6) / n;
    const c = b.cases.map((x) => ({ t: couper(x.titre, cw - 10, 11.5, 2), s: x.texte ? couper(x.texte, cw - 10, 10.5, 3) : [] }));
    const hh = Math.max(...c.map((x) => x.t.length * 14 + x.s.length * 13)) + 14;
    o.parts.push({ k: 'cases', y, c, cw, hh }); y += hh + 8;
  }
  if (b.elements.length) {
    if (b.disposition === 'ligne') {
      const n = b.elements.length, gap = b.chaine ? Math.max(36, Math.min(110, Math.max(0, ...b.chaine.map((t) => largeurTexte(t, 11.5))) + 14)) : 8, ew = (iw - (n - 1) * gap) / n;
      const els = b.elements.map((x) => mesurerElement(x, ew));
      const hh = Math.max(...els.map((x) => x.h));
      o.parts.push({ k: 'elements-ligne', y, els, ew, gap, hh }); y += hh + (b.chaine && b.chaine.some(Boolean) ? 8 : 8);
    } else {
      const els = b.elements.map((x) => mesurerElement(x, iw));
      o.parts.push({ k: 'elements', y, els }); y += els.reduce((a, x) => a + x.h + 8, 0);
    }
  }
  if (b.pastilles.length) {
    const n = b.pastilles.length, pw = (iw - (n - 1) * 6) / n;
    o.parts.push({ k: 'pastilles', y, pw }); y += 32;
  }
  o.h = Math.max(b.hauteurMin, y + P - 4);
  return o;
}
function mesurerElement(x, w) {
  const tx = x.icone ? 34 : 10;
  const t = x.titre ? couper(x.titre, w - tx - 10, 12.5, 2) : [];
  const s = x.texte ? couper(x.texte, w - tx - 10, 11, 4) : [];
  const p = x.puces.map((q) => couper(q, w - tx - 22, 11, 2));
  const h = Math.max(x.icone ? 36 : 0, 12 + t.length * 16 + s.length * 14 + p.reduce((a, l) => a + l.length * 14 + 1, 0)) + 4;
  return { x, tx, t, s, p, h };
}

function dessinerIcone(nom, x, y, taille, c) {
  return '<g transform="translate(' + f1(x) + ',' + f1(y) + ') scale(' + (taille / 24).toFixed(3) + ')" fill="none" stroke="' + c + '" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">' + ICONES[nom] + '</g>';
}

function dessinerElement(m, x, y, w, ci) {
  const c = m.x.couleur != null ? m.x.couleur : ci;
  let h = '<rect x="' + f1(x) + '" y="' + f1(y) + '" width="' + f1(w) + '" height="' + f1(m.h) + '" rx="8" class="p-sous" stroke="' + couleur(c) + '"/>';
  if (m.x.icone) h += dessinerIcone(m.x.icone, x + 8, y + Math.min(10, (m.h - 22) / 2), 22, couleur(c));
  let yy = y + 18;
  for (const l of m.t) { h += '<text x="' + f1(x + m.tx) + '" y="' + f1(yy) + '" class="p-el-titre" fill="' + fonce(c) + '">' + esc(l) + '</text>'; yy += 16; }
  for (const l of m.s) { h += '<text x="' + f1(x + m.tx) + '" y="' + f1(yy) + '" class="p-el-texte">' + esc(l) + '</text>'; yy += 14; }
  for (const lignes of m.p) { lignes.forEach((l, i) => { if (!i) h += '<circle cx="' + f1(x + m.tx + 3) + '" cy="' + f1(yy - 4) + '" r="2" fill="' + couleur(c) + '"/>'; h += '<text x="' + f1(x + m.tx + 11) + '" y="' + f1(yy) + '" class="p-el-texte">' + esc(l) + '</text>'; yy += 14; }); yy += 1; }
  return h;
}

function dessinerBloc(b, m, x, y, w, ci, id) {
  const c = couleur(ci), cf = fonce(ci);
  let h = '<g class="p-bloc"><title>' + esc((b.numero ? b.numero + '. ' : '') + b.titre + (b.sousTitre ? ' — ' + b.sousTitre : '')) + '</title>';
  h += '<rect x="' + f1(x) + '" y="' + f1(y) + '" width="' + f1(w) + '" height="' + f1(m.h) + '" rx="12" class="p-cadre' + (b.style === 'tirets' ? ' p-tirets' : '') + '" stroke="' + c + '"/>';
  h += '<rect x="' + f1(x) + '" y="' + f1(y) + '" width="' + f1(w) + '" height="' + f1(m.h) + '" rx="12" fill="' + c + '" fill-opacity=".07"/>';
  if (b.icone) h += dessinerIcone(b.icone, x + P, y + P + 2, 32, c);
  let yy = y + P + 16;
  m.titre.forEach((l, i) => {
    if (!i && b.numero) { const n = b.numero + '. '; h += '<text x="' + f1(x + P + m.tx) + '" y="' + f1(yy) + '" class="p-titre"><tspan fill="' + c + '">' + esc(n) + '</tspan><tspan fill="' + cf + '">' + esc(l.slice(n.length)) + '</tspan></text>'; }
    else h += '<text x="' + f1(x + P + m.tx) + '" y="' + f1(yy) + '" class="p-titre" fill="' + cf + '">' + esc(l) + '</text>';
    yy += 19;
  });
  for (const l of m.sous) { h += '<text x="' + f1(x + P + m.tx) + '" y="' + f1(yy - 2) + '" class="p-sous-titre">' + esc(l) + '</text>'; yy += 16; }
  const ix = x + P, iw = w - 2 * P;
  for (const part of m.parts) {
    const py = y + part.y;
    if (part.k === 'texte') part.l.forEach((l, i) => { h += '<text x="' + f1(ix) + '" y="' + f1(py + 12 + i * 16) + '" class="p-texte">' + esc(l) + '</text>'; });
    else if (part.k === 'etiquettes') for (const p of part.pos) h += '<rect x="' + f1(ix + p.x) + '" y="' + f1(py + p.r * 26) + '" width="' + f1(p.lw) + '" height="21" rx="10.5" fill="' + c + '" fill-opacity=".13"/><text x="' + f1(ix + p.x + p.lw / 2) + '" y="' + f1(py + p.r * 26 + 14.5) + '" class="p-etiquette" text-anchor="middle">' + esc(p.t) + '</text>';
    else if (part.k === 'puces') {
      let z = py + 11;
      for (const lignes of part.l) { lignes.forEach((l, i) => { if (!i) h += '<circle cx="' + f1(ix + 4) + '" cy="' + f1(z - 4) + '" r="2.4" fill="' + c + '"/>'; h += '<text x="' + f1(ix + 14) + '" y="' + f1(z) + '" class="p-puce">' + esc(l) + '</text>'; z += 16; }); z += 3; }
    } else if (part.k === 'cases') part.c.forEach((q, i) => {
      const cx = ix + i * (part.cw + 6);
      h += '<rect x="' + f1(cx) + '" y="' + f1(py) + '" width="' + f1(part.cw) + '" height="' + f1(part.hh) + '" rx="6" class="p-sous" stroke="' + c + '"/>';
      let z = py + part.hh / 2 - ((q.t.length * 14 + q.s.length * 13) / 2) + 11;
      for (const l of q.t) { h += '<text x="' + f1(cx + part.cw / 2) + '" y="' + f1(z) + '" class="p-case" text-anchor="middle">' + esc(l) + '</text>'; z += 14; }
      for (const l of q.s) { h += '<text x="' + f1(cx + part.cw / 2) + '" y="' + f1(z) + '" class="p-el-texte" text-anchor="middle">' + esc(l) + '</text>'; z += 13; }
    });
    else if (part.k === 'elements') { let z = py; for (const e of part.els) { h += dessinerElement(e, ix, z, iw, ci); z += e.h + 8; } }
    else if (part.k === 'elements-ligne') part.els.forEach((e, i) => {
      const ex = ix + i * (part.ew + part.gap);
      h += dessinerElement({ ...e, h: part.hh }, ex, py, part.ew, ci);
      if (b.chaine && i < part.els.length - 1) {
        const ax = ex + part.ew + 4, bx = ex + part.ew + part.gap - 4, ay = py + part.hh / 2;
        h += '<line x1="' + f1(ax) + '" y1="' + f1(ay) + '" x2="' + f1(bx) + '" y2="' + f1(ay) + '" class="p-lien" stroke="' + c + '" marker-end="' + fleche(id, ci) + '" marker-start="' + fleche(id, ci) + '"/>';
        if (b.chaine[i]) h += '<text x="' + f1((ax + bx) / 2) + '" y="' + f1(ay - 8) + '" class="p-lien-texte" text-anchor="middle">' + esc(court(b.chaine[i], Math.max(6, Math.floor((part.gap - 6) / 6)))) + '<title>' + esc(b.chaine[i]) + '</title></text>';
      }
    });
    else if (part.k === 'pastilles') b.pastilles.forEach((p, i) => {
      const px = ix + i * (part.pw + 6), pc = p.couleur != null ? p.couleur : (ci + i) % 8;
      const taille = Math.max(7.5, Math.min(11, (part.pw - 8) / (p.texte.length * 0.66)));
      h += '<rect x="' + f1(px) + '" y="' + f1(py) + '" width="' + f1(part.pw) + '" height="24" rx="6" fill="' + couleur(pc) + '"/><text x="' + f1(px + part.pw / 2) + '" y="' + f1(py + 12 + taille * 0.36) + '" class="p-pastille" style="font-size:' + taille.toFixed(1) + 'px" text-anchor="middle">' + esc(p.texte) + '</text>';
    });
  }
  if (b.badge) {
    const bw = Math.min(w - 40, largeurTexte(b.badge, 12) + 28), bx = x + (w - bw) / 2;
    h += '<rect x="' + f1(bx) + '" y="' + f1(y + m.h - 11) + '" width="' + f1(bw) + '" height="22" rx="6" class="p-badge" stroke="' + c + '"/><text x="' + f1(bx + bw / 2) + '" y="' + f1(y + m.h + 4) + '" class="p-badge-texte" fill="' + cf + '" text-anchor="middle">' + esc(b.badge) + '</text>';
  }
  return h + '</g>';
}

// ── Flèches orthogonales entre blocs ──────────────────────────────────────────
const DIR = { haut: [0, -1], bas: [0, 1], gauche: [-1, 0], droite: [1, 0] };
function cotes(a, b) {
  const gap = 6;
  if (b.x >= a.x + a.w - gap) return ['droite', 'gauche'];
  if (b.x + b.w <= a.x + gap) return ['gauche', 'droite'];
  if (b.y >= a.y + a.h) return ['bas', 'haut'];
  return ['haut', 'bas'];
}

function planche(spec, haut, id) {
  const W = spec.largeur, C = spec.colonnes, marge = 24, gap = spec.gouttiere || 22;
  const colW = (W - 2 * marge - (C - 1) * gap) / C;
  let h = '';
  // En-tête
  let y0 = 18;
  if (spec.titre) { h += '<text x="' + W / 2 + '" y="' + (y0 + 26) + '" class="p-grand-titre" text-anchor="middle">' + esc(spec.titre) + '</text>'; y0 += 40; }
  if (spec.sousTitre) { h += '<text x="' + W / 2 + '" y="' + (y0 + 14) + '" class="p-grand-sous" text-anchor="middle">' + esc(spec.sousTitre) + '</text>'; y0 += 24; }
  if (spec.mots.length) { h += '<text x="' + (W - marge) + '" y="' + (y0 + 14) + '" class="p-mots" text-anchor="end">' + spec.mots.map(esc).join('  ·  ') + '</text>'; y0 += 22; }
  y0 += 14;
  const cat = new Map(spec.categories.map((c) => [c.id, c]));
  const fond = new Array(C).fill(y0);
  const R = new Map();
  for (const b of spec.blocs) {
    const x = marge + (b.col - 1) * (colW + gap), w = b.largeur * colW + (b.largeur - 1) * gap;
    const m = mesurerBloc(b, w);
    let y = Math.max(...fond.slice(b.col - 1, b.col - 1 + b.largeur)) + b.espaceAvant;
    if (b.aligner && R.has(b.aligner)) y = Math.max(y, R.get(b.aligner).y);
    const ci = b.couleur != null ? b.couleur : b.categorie && cat.has(b.categorie) ? cat.get(b.categorie).couleur : 1;
    R.set(b.id, { b, m, x, y, w, h: m.h + (b.badge ? 12 : 0), ci });
    for (let k = b.col - 1; k < b.col - 1 + b.largeur; k++) fond[k] = y + m.h + (b.badge ? 12 : 0) + gap;
  }
  let bas = Math.max(...fond) - gap;
  // Flèches : côtés choisis, puis ancres réparties le long de chaque côté partagé.
  const L = spec.liens.map((l) => {
    const a = R.get(l.de), b = R.get(l.vers), auto = cotes(a, b);
    return { l, a, b, s1: l.depart || auto[0], s2: l.arrivee || auto[1] };
  });
  const parCote = new Map();
  const noter = (r, s, lien, cle) => { const k = r.b.id + ':' + s; if (!parCote.has(k)) parCote.set(k, []); parCote.get(k).push({ lien, cle }); };
  L.forEach((x) => { noter(x.a, x.s1, x, 'p0'); noter(x.b, x.s2, x, 'q0'); });
  for (const [k, liste] of parCote) {
    const [bid, s] = k.split(':'); const r = R.get(bid);
    const horizontal = s === 'haut' || s === 'bas';
    // Ordonner par position de l'autre extrémité, pour que les flèches ne se croisent pas au départ.
    liste.sort((u, v) => { const o = (z) => (z.cle === 'p0' ? z.lien.b : z.lien.a); return horizontal ? (o(u).x + o(u).w / 2) - (o(v).x + o(v).w / 2) : (o(u).y + o(u).h / 2) - (o(v).y + o(v).h / 2); });
    liste.forEach((z, i) => {
      const t = (i + 1) / (liste.length + 1);
      const pt = s === 'haut' ? [r.x + r.w * t, r.y] : s === 'bas' ? [r.x + r.w * t, r.y + r.h] : s === 'gauche' ? [r.x, r.y + Math.min(r.h * t, 40 + i * 22)] : [r.x + r.w, r.y + Math.min(r.h * t, 40 + i * 22)];
      z.lien[z.cle] = pt;
    });
  }
  // Deux blocs qui se font face : la flèche reste droite quand c'est possible.
  for (const x of L) {
    const hz = (s) => s === 'gauche' || s === 'droite';
    if (hz(x.s1) && hz(x.s2) && parCote.get(x.a.b.id + ':' + x.s1).length === 1 && parCote.get(x.b.b.id + ':' + x.s2).length === 1) {
      const y0b = Math.max(x.a.y, x.b.y) + 16, y1b = Math.min(x.a.y + x.a.h, x.b.y + x.b.h) - 16;
      if (y1b > y0b) { const yy = Math.min(y1b, Math.max(y0b, x.p0[1])); x.p0 = [x.p0[0], yy]; x.q0 = [x.q0[0], yy]; }
    }
    if (!hz(x.s1) && !hz(x.s2) && parCote.get(x.a.b.id + ':' + x.s1).length === 1 && parCote.get(x.b.b.id + ':' + x.s2).length === 1) {
      const x0b = Math.max(x.a.x, x.b.x) + 16, x1b = Math.min(x.a.x + x.a.w, x.b.x + x.b.w) - 16;
      if (x1b > x0b) { const xx = Math.min(x1b, Math.max(x0b, x.p0[0])); x.p0 = [xx, x.p0[1]]; x.q0 = [xx, x.q0[1]]; }
    }
  }
  let fleches = '', etiquettes = '';
  const styles = new Set();
  // 1. Le tracé de chaque flèche (points orthogonaux).
  for (const x of L) {
    const d1 = DIR[x.s1], d2 = DIR[x.s2], sortie = 16;
    const p1 = [x.p0[0] + d1[0] * sortie, x.p0[1] + d1[1] * sortie], q1 = [x.q0[0] + d2[0] * sortie, x.q0[1] + d2[1] * sortie];
    const h1 = d1[0] !== 0, h2 = d2[0] !== 0;
    let pts, canal = null;
    if (h1 && h2) {
      const mx = (p1[0] + q1[0]) / 2;
      if (Math.abs(x.p0[1] - x.q0[1]) < 0.5) pts = [x.p0, x.q0];
      else if ((q1[0] - p1[0]) * d1[0] < 0) {
        // Les deux côtés se tournent le dos : on contourne par le dehors.
        const cx = d1[0] > 0 ? Math.max(p1[0], q1[0]) : Math.min(p1[0], q1[0]);
        pts = [x.p0, [cx, x.p0[1]], [cx, x.q0[1]], x.q0]; canal = { axe: 'x', i: 1 };
      } else { pts = [x.p0, [mx, x.p0[1]], [mx, x.q0[1]], x.q0]; canal = { axe: 'x', i: 1 }; }
    } else if (!h1 && !h2) {
      const my = (p1[1] + q1[1]) / 2;
      if (Math.abs(x.p0[0] - x.q0[0]) < 0.5) pts = [x.p0, x.q0];
      else if ((q1[1] - p1[1]) * d1[1] < 0) {
        const cy = d1[1] > 0 ? Math.max(p1[1], q1[1]) : Math.min(p1[1], q1[1]);
        pts = [x.p0, [x.p0[0], cy], [x.q0[0], cy], x.q0]; canal = { axe: 'y', i: 1 };
      } else { pts = [x.p0, [x.p0[0], my], [x.q0[0], my], x.q0]; canal = { axe: 'y', i: 1 }; }
    } else if (h1) pts = [x.p0, [x.q0[0], x.p0[1]], x.q0];
    else pts = [x.p0, [x.p0[0], x.q0[1]], x.q0];
    x.pts = pts; x.canal = canal;
  }
  // 2. Des flèches qui empruntent le même couloir sont écartées l'une de l'autre,
  //    sinon deux trajets distincts se confondent en un seul trait.
  for (const axe of ['x', 'y']) {
    const k = axe === 'x' ? 0 : 1;
    const avec = L.filter((x) => x.canal && x.canal.axe === axe).sort((a, b) => a.pts[1][k] - b.pts[1][k]);
    const paquets = [];
    for (const x of avec) { const d = paquets[paquets.length - 1]; if (d && Math.abs(d[0].pts[1][k] - x.pts[1][k]) < 8) d.push(x); else paquets.push([x]); }
    for (const p of paquets) {
      if (p.length < 2) continue;
      p.sort((a, b) => (axe === 'x' ? a.pts[0][1] - b.pts[0][1] : a.pts[0][0] - b.pts[0][0]));
      p.forEach((x, i) => { const dv = (i - (p.length - 1) / 2) * 7; x.pts[1][k] += dv; x.pts[2][k] += dv; });
    }
  }
  // 3. Le dessin, et l'étiquette sur le segment où elle tient.
  for (const x of L) {
    const pts = x.pts, ci = x.a.ci;
    styles.add(x.l.style === 'pointille' ? 'pointille' : 'plein');
    fleches += '<path d="M' + pts.map((p) => f1(p[0]) + ' ' + f1(p[1])).join(' L') + '" class="p-lien' + (x.l.style === 'pointille' ? ' p-lien-tirets' : '') + (x.l.style === 'epais' ? ' p-lien-epais' : '') + '" stroke="' + couleur(ci) + '" marker-end="' + fleche(id, ci) + '"' + (x.l.double ? ' marker-start="' + fleche(id, ci) + '"' : '') + '><title>' + esc(x.a.b.titre + ' → ' + x.b.b.titre + (x.l.texte ? ' : ' + x.l.texte : '')) + '</title></path>';
    if (!x.l.texte) continue;
    // Un segment horizontal assez long reçoit le texte au-dessus ; sinon un segment
    // vertical assez long le reçoit couché le long du trait (il tient dans une gouttière) ;
    // sinon le plus long segment.
    const tw = largeurTexte(x.l.texte, 11.5) + 12;
    const segs = [];
    for (let i = 0; i < pts.length - 1; i++) { const v = Math.abs(pts[i + 1][0] - pts[i][0]) < 1; segs.push({ i, v, len: Math.abs(pts[i + 1][0] - pts[i][0]) + Math.abs(pts[i + 1][1] - pts[i][1]) }); }
    const tenant = (v) => segs.filter((s) => s.v === v && s.len >= tw).sort((a, b) => b.len - a.len)[0];
    const s = tenant(false) || tenant(true) || segs.slice().sort((a, b) => b.len - a.len)[0];
    const a = pts[s.i], b = pts[s.i + 1], mx = (a[0] + b[0]) / 2, my = (a[1] + b[1]) / 2;
    if (s.v && s.len < tw) { etiquettes += '<text x="' + f1(mx + 7) + '" y="' + f1(my + 4) + '" class="p-lien-texte">' + esc(x.l.texte) + '</text>'; continue; }
    // Un segment horizontal trop court pour son libellé (gouttière étroite) : le libellé
    // passe sur une pastille de fond, lisible même s'il déborde sur le cadre d'un bloc.
    if (!s.v && s.len < tw) { const w = tw - 4; etiquettes += '<rect x="' + f1(mx - w / 2) + '" y="' + f1(my - 22) + '" width="' + f1(w) + '" height="16" rx="8" class="p-pastille-lien"/><text x="' + f1(mx) + '" y="' + f1(my - 10.5) + '" class="p-lien-texte" text-anchor="middle">' + esc(x.l.texte) + '</text>'; continue; }
    etiquettes += s.v
      ? '<text transform="translate(' + f1(mx + 4) + ',' + f1(my) + ') rotate(-90)" class="p-lien-texte" text-anchor="middle">' + esc(x.l.texte) + '</text>'
      : '<text x="' + f1(mx) + '" y="' + f1(my - 6) + '" class="p-lien-texte" text-anchor="middle">' + esc(x.l.texte) + '</text>';
  }
  // Blocs par-dessus les flèches ; les étiquettes au-dessus de tout.
  let blocs = '';
  for (const r of R.values()) blocs += dessinerBloc(r.b, r.m, r.x, r.y, r.w, r.ci, id);
  h += '<defs>' + [1, 2, 3, 4, 5, 6, 7, 8, 'n'].map((k) => '<marker id="' + id + '-pf' + k + '" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6.5" markerHeight="6.5" orient="auto-start-reverse"><path d="M0 0L10 5L0 10z" fill="' + (k === 'n' ? 'var(--g-texte)' : 'var(--g-' + k + ')') + '"/></marker>').join('') + '</defs>';
  h += fleches + blocs + etiquettes;
  // Légende et pied
  bas += 26;
  const items = spec.categories.filter((c) => spec.blocs.some((b) => b.categorie === c.id));
  if (items.length || styles.size) {
    let x = marge;
    h += '<text x="' + x + '" y="' + (bas + 12) + '" class="p-legende-titre">Légende :</text>'; x += 76;
    for (const c of items) {
      const w = largeurTexte(c.nom, 11.5) + 30;
      if (x + w > W - marge) { x = marge + 76; bas += 22; }
      h += '<rect x="' + x + '" y="' + (bas + 1) + '" width="20" height="13" rx="3" fill="' + couleur(c.couleur) + '" fill-opacity=".35" stroke="' + couleur(c.couleur) + '"/><text x="' + (x + 26) + '" y="' + (bas + 12) + '" class="p-legende">' + esc(c.nom) + '</text>';
      x += w + 10;
    }
    for (const s of ['plein', 'pointille']) if (styles.has(s) && styles.size > 1) {
      const nom = s === 'plein' ? 'Flux principal' : 'Boucle de retour', w = largeurTexte(nom, 11.5) + 42;
      if (x + w > W - marge) { x = marge + 76; bas += 22; }
      h += '<line x1="' + x + '" y1="' + (bas + 8) + '" x2="' + (x + 28) + '" y2="' + (bas + 8) + '" class="p-lien' + (s === 'pointille' ? ' p-lien-tirets' : '') + '" stroke="var(--g-texte)" marker-end="url(#' + id + '-pfn)"/><text x="' + (x + 36) + '" y="' + (bas + 12) + '" class="p-legende">' + nom + '</text>';
      x += w + 10;
    }
    bas += 24;
  }
  if (spec.pied) { h += '<text x="' + (W - marge) + '" y="' + (bas + 10) + '" class="p-pied" text-anchor="end">' + esc(spec.pied) + '</text>'; bas += 22; }
  return { corps: h, h: bas + 8, w: W };
}

const CSS = `
.graphique .p-grand-titre{font:800 30px var(--police,system-ui);fill:var(--g-texte);letter-spacing:-.01em}
.graphique .p-grand-sous{font:15px var(--police,system-ui);fill:var(--g-pale)}
.graphique .p-mots{font:12.5px var(--police,system-ui);fill:var(--g-2f)}
.graphique .p-cadre{fill:var(--g-fond);stroke-width:1.6}
.graphique .p-tirets{stroke-dasharray:7 5}
.graphique .p-titre{font:700 15.5px var(--police,system-ui)}
.graphique .p-sous-titre{font:italic 12.5px var(--police,system-ui);fill:var(--g-texte)}
.graphique .p-texte{font:12.5px var(--police,system-ui);fill:var(--g-texte)}
.graphique .p-puce{font:12px var(--police,system-ui);fill:var(--g-texte)}
.graphique .p-etiquette{font:500 11.5px var(--police,system-ui);fill:var(--g-texte)}
.graphique .p-sous{fill:var(--g-fond);stroke-width:1;stroke-opacity:.8}
.graphique .p-el-titre{font:700 12.5px var(--police,system-ui)}
.graphique .p-el-texte{font:11px var(--police,system-ui);fill:var(--g-pale)}
.graphique .p-case{font:600 11.5px var(--police,system-ui);fill:var(--g-texte)}
.graphique .p-pastille{font:700 11px var(--police,system-ui);fill:var(--g-sur)}
.graphique .p-badge{fill:var(--g-fond);stroke-width:1.3}
.graphique .p-badge-texte{font:600 12px var(--police,system-ui)}
.graphique .p-lien{fill:none;stroke-width:1.8;stroke-linejoin:round;stroke-opacity:.85}
.graphique .p-lien-tirets{stroke-dasharray:6 5}
.graphique .p-lien-epais{stroke-width:3}
.graphique .p-lien-texte{font:italic 11.5px var(--police,system-ui);fill:var(--g-pale);paint-order:stroke;stroke:var(--g-fond-page,var(--g-fond));stroke-width:4px;stroke-linejoin:round}
.graphique .p-pastille-lien{fill:var(--g-fond);stroke:var(--g-grille-fort)}
.graphique .p-legende-titre{font:700 12px var(--police,system-ui);fill:var(--g-texte)}
.graphique .p-legende{font:11.5px var(--police,system-ui);fill:var(--g-texte)}
.graphique .p-pied{font:italic 12px var(--police,system-ui);fill:var(--g-2f)}
`;

module.exports = { valider, planche, ICONES, CSS };


};
