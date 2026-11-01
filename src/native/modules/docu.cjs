// Adapted from Plagni/atlas 227e897b68fbbaf2d6436084526519bf28ededf8. AGPL-3.0-only.
module.exports = function nativeModule(require, module, __dirname) {
// docu — le site de documentation de l'écosystème, servi sur docu.plagnito.com
// (et sous /docu sur le domaine racine).
//
// POURQUOI UN SITE, ALORS QUE `documentation.html` EXISTE DÉJÀ.
// La page `documentation.html` est un document UNIQUE de 86 Ko à 31 ancres. Pour un
// humain qui fait défiler, c'est utilisable ; pour un moteur de réponse (Gemini/AI
// Search, à qui cette documentation est destinée), c'est une seule URL, un seul
// titre, une seule description pour soixante applications. Rien n'y est citable :
// interrogé sur Atlas Tableur, un assistant ne peut renvoyer que « la page
// documentation », jamais « la page d'Atlas Tableur ».
//   Ici : UNE URL PAR SUJET, servie en HTML complet par le serveur (pas de rendu
// JavaScript — un robot qui ne l'exécute pas verrait une page vide), avec ses
// données structurées, sa version Markdown brute et un index lisible par machine.
//
// OÙ VIT LE CONTENU. Dans `src/web/docu/*.md`, en Markdown à en-tête (frontmatter).
// Le contenu est donc VERSIONNÉ : un `git push` le déploie (Pipeline A), et une
// correction de doc se relit comme une correction de code.
const fs = require('fs');
const path = require('path');

const DOSSIER = path.join(__dirname, '..', 'web', 'docu');
const HOTE = 'https://docu.plagnito.com';

// ── Lecture du contenu ───────────────────────────────────────────────────────
// Cache mémoire invalidé par la date de modification du dossier : en production le
// contenu ne change qu'au déploiement, mais en développement on veut voir sa page
// sans redémarrer le serveur.
let cache = { empreinte: null, pages: [], parSlug: new Map() };

// ⚠️ Le CONTRÔLE de fraîcheur coûte plus cher que le rendu qu'il protège :
// `empreinteDossier()` fait un `readdirSync` + un `statSync` PAR page (67 fichiers
// aujourd'hui), soit ~5 ms de syscalls SYNCHRONES — mesuré — alors que rendre la
// page ne coûte que 0,2 ms. Sur le chemin d'une requête, ces 5 ms bloquent
// l'event-loop pour TOUT le serveur, pas seulement pour la documentation.
//   On garde le contrôle (en développement, on veut voir sa page sans redémarrer),
// mais au plus une fois toutes les `TTL_FRAICHEUR` ms. En production le contenu ne
// change qu'au déploiement, qui redémarre le process de toute façon.
const TTL_FRAICHEUR = 2000;
let controleLe = 0;

// Force le prochain `charger()` à relire le dossier, sans attendre le TTL.
function invalider() { controleLe = 0; cache = { empreinte: null, pages: [], parSlug: new Map() }; }

function empreinteDossier() {
  try {
    const fichiers = fs.readdirSync(DOSSIER).filter((f) => f.endsWith('.md'));
    return fichiers.map((f) => {
      const st = fs.statSync(path.join(DOSSIER, f));
      return f + ':' + st.mtimeMs + ':' + st.size;
    }).join('|');
  } catch { return 'absent'; }
}

// En-tête YAML volontairement minimal : `clé: valeur`, et des listes en `a, b, c`.
// Aucune dépendance à ajouter pour trois types de champs.
function lireEntete(brut) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(brut);
  if (!m) return { meta: {}, corps: brut };
  const meta = {};
  for (const ligne of m[1].split(/\r?\n/)) {
    const mm = /^([a-zA-Z_][\w-]*)\s*:\s*(.*)$/.exec(ligne);
    if (!mm) continue;
    let v = mm[2].trim();
    if (v.startsWith('[') && v.endsWith(']')) v = v.slice(1, -1);
    if (/^(tags|voir|plateformes)$/.test(mm[1])) {
      meta[mm[1]] = v.split(',').map((x) => x.trim().replace(/^["']|["']$/g, '')).filter(Boolean);
    } else {
      meta[mm[1]] = v.replace(/^["']|["']$/g, '');
    }
  }
  return { meta, corps: brut.slice(m[0].length) };
}

function charger() {
  // Cache chaud et contrôlé récemment : on rend sans toucher au disque.
  const t = Date.now();
  if (cache.empreinte !== null && (t - controleLe) < TTL_FRAICHEUR) return cache;
  controleLe = t;
  const emp = empreinteDossier();
  if (cache.empreinte === emp) return cache;
  const pages = [];
  let fichiers = [];
  try { fichiers = fs.readdirSync(DOSSIER).filter((f) => f.endsWith('.md')); } catch { fichiers = []; }
  for (const f of fichiers) {
    const brut = fs.readFileSync(path.join(DOSSIER, f), 'utf8');
    const { meta, corps } = lireEntete(brut);
    const slug = meta.slug || f.replace(/\.md$/, '');
    pages.push({
      slug,
      titre: meta.titre || slug,
      description: meta.description || '',
      categorie: meta.categorie || 'Divers',
      app: meta.app || null,
      icone: meta.icone || '📄',
      ordre: Number(meta.ordre || 500),
      tags: meta.tags || [],
      voir: meta.voir || [],
      maj: meta.maj || '',
      acces: meta.acces || '',
      plateformes: meta.plateformes || [],
      adresse: meta.adresse || '',
      corps,
      meta,
    });
  }
  pages.sort((a, b) => (a.ordre - b.ordre) || a.titre.localeCompare(b.titre, 'fr'));
  cache = { empreinte: emp, pages, parSlug: new Map(pages.map((p) => [p.slug, p])) };
  return cache;
}

// Ordre d'affichage des rubriques. Une catégorie absente d'ici passe à la fin :
// ajouter une page ne doit jamais exiger de modifier ce fichier.
const ORDRE_CATEGORIES = ['Démarrer', 'Compte & identité', 'Bureautique', 'Applications',
  'Entreprise', 'Jeux', 'Outils', 'Développeurs', 'Sécurité & vie privée', 'Divers'];

function parCategorie(pages) {
  const groupes = new Map();
  for (const p of pages) {
    if (!groupes.has(p.categorie)) groupes.set(p.categorie, []);
    groupes.get(p.categorie).push(p);
  }
  return [...groupes.entries()].sort((a, b) => {
    const ia = ORDRE_CATEGORIES.indexOf(a[0]); const ib = ORDRE_CATEGORIES.indexOf(b[0]);
    return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib) || a[0].localeCompare(b[0], 'fr');
  });
}

// ── Markdown → HTML ──────────────────────────────────────────────────────────
// Sous-ensemble suffisant pour de la documentation : titres, listes, tableaux,
// citations, code, liens, gras/italique. Écrit ici plutôt qu'ajouté en dépendance
// (le dépôt en compte six, on n'en ajoute pas une septième pour ça).
function echapper(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function enLigne(src) {
  // Le code littéral est mis de côté AVANT l'échappement : sans ça, `<div>` écrit
  // dans un exemple ressortirait échappé deux fois.
  const codes = [];
  let s = String(src).replace(/`([^`]+)`/g, (m, c) => {
    codes.push(c); return '\u0000C' + (codes.length - 1) + '\u0000';
  });
  s = echapper(s);
  // Images : `![texte de remplacement](/img/schema.svg)`. Traité AVANT les liens,
  // sinon la syntaxe d'image serait lue comme un « ! » suivi d'un lien.
  //
  // ⚠️ SOURCE LOCALE UNIQUEMENT (chemin commençant par « / », ou plagnito.com).
  //  Une image distante n'est pas un ornement : c'est une requête que le
  //  navigateur du lecteur émet vers un tiers, qui apprend au passage son adresse
  //  IP, l'heure et la page lue. C'est exactement le pixel espion que nous
  //  bloquons déjà dans le courrier — il n'entrera pas par la porte des articles.
  //  Une source refusée retombe sur son texte de remplacement, visible : on ne
  //  laisse pas un trou silencieux à la place d'une illustration.
  s = s.replace(/!\[([^\]]*)\]\(([^)\s]+)\)/g, (m, alt, url) => {
    const locale = /^\//.test(url) || /^https?:\/\/([a-z0-9-]+\.)?plagnito\.com\//i.test(url);
    if (!locale) return '<span class="img-refusee">' + (alt || 'image') + ' (source distante refusée)</span>';
    return '<img src="' + url + '" alt="' + alt + '" loading="lazy" decoding="async">';
  });
  s = s.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (m, texte, url) => {
    const externe = /^https?:\/\//i.test(url) && !/^https?:\/\/([a-z0-9-]+\.)?plagnito\.com/i.test(url);
    const attrs = externe ? ' rel="noopener nofollow" target="_blank"' : '';
    return '<a href="' + url + '"' + attrs + '>' + texte + '</a>';
  });
  s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  s = s.replace(/(^|[^*\w])\*([^*\n]+)\*/g, '$1<em>$2</em>');
  s = s.replace(/\u0000C(\d+)\u0000/g, (m, i) => '<code>' + echapper(codes[Number(i)]) + '</code>');
  return s;
}

// Identifiant d'ancre stable, lisible, sans accents : c'est ce qui permet de
// pointer un paragraphe précis depuis une réponse d'assistant.
function ancre(texte) {
  return String(texte).normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'section';
}

function rendre(md) {
  const lignes = String(md).replace(/\r\n/g, '\n').split('\n');
  const out = [];
  const sommaire = [];
  let i = 0;
  const ancresVues = new Set();
  const ancreUnique = (t) => {
    let a = ancre(t); let n = 2;
    while (ancresVues.has(a)) a = ancre(t) + '-' + (n++);
    ancresVues.add(a); return a;
  };

  while (i < lignes.length) {
    const l = lignes[i];

    // Bloc de code clôturé
    if (/^```/.test(l)) {
      const lang = l.slice(3).trim();
      const buf = [];
      i++;
      while (i < lignes.length && !/^```/.test(lignes[i])) buf.push(lignes[i++]);
      i++;
      out.push('<pre class="code"' + (lang ? ' data-lang="' + echapper(lang) + '"' : '') + '><code>'
        + echapper(buf.join('\n')) + '</code></pre>');
      continue;
    }

    // Titres
    const mt = /^(#{2,4})\s+(.*)$/.exec(l);
    if (mt) {
      const niveau = mt[1].length;
      const texte = mt[2].trim();
      const a = ancreUnique(texte);
      if (niveau <= 3) sommaire.push({ niveau, texte, ancre: a });
      out.push('<h' + niveau + ' id="' + a + '">' + enLigne(texte)
        + ' <a class="lien-ancre" href="#' + a + '" aria-label="Lien vers cette section">#</a></h' + niveau + '>');
      i++; continue;
    }

    // Filet
    if (/^---+\s*$/.test(l)) { out.push('<hr>'); i++; continue; }

    // Citation / encadré. `> ⚠️ …` devient un encadré d'avertissement : c'est la
    // convention déjà employée dans les fichiers du dépôt.
    if (/^>\s?/.test(l)) {
      const buf = [];
      while (i < lignes.length && /^>\s?/.test(lignes[i])) buf.push(lignes[i++].replace(/^>\s?/, ''));
      const contenu = buf.join('\n');
      const type = /^\s*(⚠️|❗)/.test(contenu) ? 'attention' : (/^\s*(✅|💡)/.test(contenu) ? 'astuce' : 'note');
      out.push('<blockquote class="enc enc-' + type + '">' + rendre(contenu).html + '</blockquote>');
      continue;
    }

    // Tableau : ligne d'en-tête, ligne de séparation, puis les lignes.
    if (/^\|/.test(l) && i + 1 < lignes.length && /^\|[\s:|-]+\|?\s*$/.test(lignes[i + 1])) {
      const cellules = (ligne) => ligne.replace(/^\||\|$/g, '').split('|').map((c) => c.trim());
      const entete = cellules(l);
      i += 2;
      const corps = [];
      while (i < lignes.length && /^\|/.test(lignes[i])) corps.push(cellules(lignes[i++]));
      out.push('<div class="table-wrap"><table><thead><tr>'
        + entete.map((c) => '<th>' + enLigne(c) + '</th>').join('') + '</tr></thead><tbody>'
        + corps.map((r) => '<tr>' + r.map((c) => '<td>' + enLigne(c) + '</td>').join('') + '</tr>').join('')
        + '</tbody></table></div>');
      continue;
    }

    // Listes (à puces ou numérotées), imbrication à deux niveaux.
    if (/^\s*([-*]|\d+\.)\s+/.test(l)) {
      const numerotee = /^\s*\d+\./.test(l);
      const items = [];
      while (i < lignes.length && /^\s*([-*]|\d+\.)\s+/.test(lignes[i])) {
        const indent = /^(\s*)/.exec(lignes[i])[1].length;
        const texte = lignes[i].replace(/^\s*([-*]|\d+\.)\s+/, '');
        items.push({ indent, texte });
        i++;
      }
      const base = Math.min(...items.map((x) => x.indent));
      const html = [];
      let ouvert = false;
      for (const it of items) {
        if (it.indent > base) {
          if (!ouvert) { html.push('<ul class="imbrique">'); ouvert = true; }
          html.push('<li>' + enLigne(it.texte) + '</li>');
        } else {
          if (ouvert) { html.push('</ul>'); ouvert = false; }
          html.push('<li>' + enLigne(it.texte) + '</li>');
        }
      }
      if (ouvert) html.push('</ul>');
      out.push('<' + (numerotee ? 'ol' : 'ul') + '>' + html.join('') + '</' + (numerotee ? 'ol' : 'ul') + '>');
      continue;
    }

    // Ligne vide
    if (!l.trim()) { i++; continue; }

    // Paragraphe : on agrège jusqu'à la prochaine ligne vide ou au prochain bloc.
    const buf = [];
    while (i < lignes.length && lignes[i].trim()
      && !/^(#{2,4}\s|```|>|\||\s*([-*]|\d+\.)\s|---+\s*$)/.test(lignes[i])) buf.push(lignes[i++]);
    if (buf.length) out.push('<p>' + enLigne(buf.join(' ')) + '</p>');
  }

  return { html: out.join('\n'), sommaire };
}

// ── Questions fréquentes → données structurées ───────────────────────────────
// Convention de rédaction : sous un titre « Questions fréquentes », chaque `###`
// est une question et le texte qui suit sa réponse. On en tire un FAQPage
// schema.org, le format que les moteurs de réponse lisent le plus volontiers.
function extraireFaq(md) {
  const bloc = /\n##\s+Questions fréquentes\s*\n([\s\S]*?)(?=\n##\s|$)/.exec('\n' + md);
  if (!bloc) return [];
  const faq = [];
  const re = /###\s+(.+?)\n([\s\S]*?)(?=\n###\s|$)/g;
  let m;
  while ((m = re.exec(bloc[1]))) {
    const reponse = m[2].replace(/\s+/g, ' ').replace(/[*`>#]/g, '').trim();
    if (reponse.length > 15) faq.push({ question: m[1].trim(), reponse: reponse.slice(0, 1200) });
  }
  return faq;
}

// Texte brut d'une page — sert à la recherche et aux extraits.
function texteBrut(md) {
  return String(md).replace(/```[\s\S]*?```/g, ' ').replace(/[#*`>|-]/g, ' ')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1').replace(/\s+/g, ' ').trim();
}

module.exports = { charger, invalider, rendre, enLigne, echapper, ancre, extraireFaq, texteBrut, parCategorie, DOSSIER, HOTE };


};
