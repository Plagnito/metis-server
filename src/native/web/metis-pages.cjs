// Adapted from Plagni/atlas 227e897b68fbbaf2d6436084526519bf28ededf8. AGPL-3.0-only.
module.exports = function nativeModule(require, module, __dirname) {
'use strict';

const express = require('express');

// =============================================================================
//  /metis — les publications de recherche Métis, rendues CÔTÉ SERVEUR
// -----------------------------------------------------------------------------
//  Mise en page inspirée des pages de recherche d'Anthropic : fond ivoire, titres
//  à empattements, figures légendées. Refonte du 26/09/2026 : l'interface occupe
//  TOUT l'écran — barre latérale de navigation (catégories, familles de sigles,
//  recherche), article en trois colonnes (sommaire, texte, fiche du document), et
//  une page par sigle (/metis/glossaire/<sigle>) qui dit où il est employé.
//  Tout est dans le HTML servi — graphiques compris (SVG), bulles de définition en
//  CSS seul : la page se lit sans JavaScript, hors ligne, et s'imprime.
//
//  Réservé : sans session Atlas → page de connexion ; avec une session sans accès
//  → 404, exactement comme une page qui n'existe pas. `noindex` partout, et AUCUN
//  `Disallow` dans robots.txt (un Disallow empêche le robot de LIRE le noindex).
// =============================================================================

const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const date = (iso) => { const d = new Date(iso); return isNaN(d) ? '' : d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' }); };
const plat = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
const ancreDe = (s) => plat(s).replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'autres';
const pluriel = (n, un, plusieurs) => n + ' ' + (n > 1 ? plusieurs || un + 's' : un);
const lienSigle = (s) => '/metis/glossaire/' + encodeURIComponent(s);
const majuscule = (s) => String(s || '').charAt(0).toUpperCase() + String(s || '').slice(1);

// Une teinte par catégorie de document ; les familles de sigles prennent la leur dans
// la même palette, par empreinte de leur nom (stable d'une page à l'autre).
const PALETTE = ['#d97757', '#6a9bcc', '#788c5d', '#c2983a', '#9b87c4', '#cc7a9a', '#4f9d98', '#b5754a'];
const TEINTES = { Recherche: '#d97757', 'Modification proposée': '#6a9bcc', Architecture: '#788c5d', Note: '#c2983a', 'Compte rendu': '#9b87c4' };
function teinte(nom) { const custom = require('../instance').color(nom); if(custom) return custom;
  if (TEINTES[nom]) return TEINTES[nom];
  let h = 7; for (const c of String(nom || '')) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return PALETTE[h % PALETTE.length];
}

function compteDe(req) { return require('../instance').account(req); }

const CSS = `
:root{--fond:#f0eee6;--cote:#e8e5da;--carte:#faf9f5;--texte:#141413;--texte2:#5e5d59;--pale:#87867f;--ligne:rgba(20,20,19,.12);--survol:rgba(20,20,19,.06);--acc:#d97757;--acc2:#c6613f;--ombre:0 1px 2px rgba(20,20,19,.05),0 8px 28px rgba(20,20,19,.07);
  --serif:'Source Serif 4',Georgia,'Times New Roman',serif;--police:'Inter',system-ui,-apple-system,'Segoe UI',sans-serif;--cote-l:284px;--barre-h:58px}
@media (prefers-color-scheme:dark){:root:not([data-theme="light"]){--fond:#1f1e1d;--cote:#191918;--carte:#262624;--texte:#f0eee6;--texte2:#bfbdb4;--pale:#8f8d85;--ligne:rgba(240,238,230,.12);--survol:rgba(240,238,230,.06);--ombre:0 1px 2px rgba(0,0,0,.3),0 8px 28px rgba(0,0,0,.25)}}
:root[data-theme="dark"]{--fond:#1f1e1d;--cote:#191918;--carte:#262624;--texte:#f0eee6;--texte2:#bfbdb4;--pale:#8f8d85;--ligne:rgba(240,238,230,.12);--survol:rgba(240,238,230,.06);--ombre:0 1px 2px rgba(0,0,0,.3),0 8px 28px rgba(0,0,0,.25)}
*{box-sizing:border-box}html{-webkit-text-size-adjust:100%;scroll-padding-top:calc(var(--barre-h) + 18px)}
body{margin:0;background:var(--fond);color:var(--texte);font-family:var(--police);font-size:17px;line-height:1.6;-webkit-font-smoothing:antialiased}
a{color:inherit}
.hors-champ{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}

/* ── Coquille : barre latérale + scène ─────────────────────────────────────── */
.appli{display:grid;grid-template-columns:var(--cote-l) minmax(0,1fr);min-height:100vh}
.cote{position:sticky;top:0;height:100vh;overflow-y:auto;background:var(--cote);border-right:1px solid var(--ligne);padding:22px 16px 18px;display:flex;flex-direction:column;gap:22px;scrollbar-width:thin}
.cote .marque{font-family:var(--serif);font-size:23px;font-weight:600;text-decoration:none;letter-spacing:-.01em;padding:0 10px;display:block}
.cote .marque span{color:var(--acc)}.cote .marque small{display:block;font-family:var(--police);font-size:12.5px;font-weight:500;color:var(--pale);letter-spacing:.02em;margin-top:2px}
.cherche{position:relative;margin:0 4px}
.cherche input{width:100%;font:inherit;font-size:14.5px;padding:10px 12px 10px 36px;border-radius:11px;border:1px solid var(--ligne);background:var(--carte);color:var(--texte)}
.cherche input:focus{outline:2px solid var(--acc);outline-offset:1px}
.cherche svg{position:absolute;left:12px;top:50%;transform:translateY(-50%);color:var(--pale)}
.groupe b{display:block;font-size:11.5px;text-transform:uppercase;letter-spacing:.08em;color:var(--pale);font-weight:600;padding:0 10px;margin:0 0 6px}
.groupe a{display:flex;align-items:center;gap:10px;padding:7px 10px;border-radius:9px;text-decoration:none;font-size:14.5px;color:var(--texte2);line-height:1.3}
.groupe a:hover{background:var(--survol);color:var(--texte)}
.groupe a.on{background:var(--carte);color:var(--texte);font-weight:600;box-shadow:0 1px 2px rgba(20,20,19,.06)}
.groupe a i{font-style:normal;margin-left:auto;font-size:12px;color:var(--pale);font-variant-numeric:tabular-nums}
.groupe a svg{flex-shrink:0;opacity:.75}
.pastille{width:9px;height:9px;border-radius:3px;flex-shrink:0;background:var(--c,var(--acc))}
.cote .bas{margin-top:auto;border-top:1px solid var(--ligne);padding:14px 10px 0;font-size:13px;color:var(--pale);display:flex;flex-direction:column;gap:6px}
.cote .bas a{color:var(--texte2);text-decoration:none}.cote .bas a:hover{color:var(--texte)}
.scene{min-width:0;display:flex;flex-direction:column}
.barre{position:sticky;top:0;z-index:30;height:var(--barre-h);display:flex;align-items:center;gap:14px;padding:0 clamp(20px,3.2vw,56px);background:color-mix(in srgb,var(--fond) 86%,transparent);backdrop-filter:blur(12px);-webkit-backdrop-filter:blur(12px);border-bottom:1px solid var(--ligne)}
.barre .fil{display:flex;align-items:center;gap:8px;font-size:14px;color:var(--pale);min-width:0;white-space:nowrap;overflow:hidden}
.barre .fil a{text-decoration:none;color:var(--texte2)}.barre .fil a:hover{color:var(--texte)}
.barre .fil span.sep{opacity:.5}.barre .fil strong{color:var(--texte);font-weight:600;overflow:hidden;text-overflow:ellipsis}
.barre .actions{margin-left:auto;display:flex;gap:8px;align-items:center}
.barre .marque-mobile,.menu-bouton{display:none}
.bouton-fin{font-size:13.5px;padding:7px 12px;border-radius:9px;border:1px solid var(--ligne);text-decoration:none;color:var(--texte2);background:var(--carte);white-space:nowrap}
.bouton-fin:hover{color:var(--texte);border-color:var(--pale)}
main{padding:30px clamp(20px,3.2vw,56px) 90px;width:100%;max-width:2100px;margin:0 auto;flex:1}
.pied{padding:22px clamp(20px,3.2vw,56px);border-top:1px solid var(--ligne);font-size:13px;color:var(--pale);display:flex;gap:16px;flex-wrap:wrap}
.pied a{color:var(--texte2);text-decoration:none}
#menu{position:absolute;opacity:0;pointer-events:none}
.voile{display:none}

/* ── Bandeau d'en-tête de page ─────────────────────────────────────────────── */
.bandeau{display:grid;grid-template-columns:minmax(0,1.35fr) minmax(0,1fr);gap:clamp(24px,4vw,64px);align-items:end;padding:22px 0 34px;border-bottom:1px solid var(--ligne);margin-bottom:30px}
.sur{font-size:13px;text-transform:uppercase;letter-spacing:.09em;color:var(--acc2);font-weight:600;margin:0 0 12px}
.bandeau h1{font-family:var(--serif);font-weight:500;font-size:clamp(40px,4.6vw,76px);line-height:1.02;letter-spacing:-.025em;margin:0 0 16px}
.bandeau p.intro{font-size:19px;color:var(--texte2);max-width:760px;margin:0}
.chiffres{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}
.chiffre{background:var(--carte);border:1px solid var(--ligne);border-radius:16px;padding:16px 18px;text-decoration:none;display:block;transition:border-color .15s,transform .15s}
a.chiffre:hover{border-color:var(--pale);transform:translateY(-1px)}
.chiffre b{display:block;font-family:var(--serif);font-size:38px;font-weight:500;line-height:1;letter-spacing:-.02em;font-variant-numeric:tabular-nums}
.chiffre span{display:block;font-size:13.5px;color:var(--texte2);margin-top:8px}
.chiffre small{display:block;font-size:12px;color:var(--pale);margin-top:2px}

/* ── Filtres et puces ──────────────────────────────────────────────────────── */
.puces{display:flex;gap:8px;flex-wrap:wrap;margin:0 0 28px;align-items:center}
.puces a{border:1px solid var(--ligne);border-radius:999px;padding:6px 14px;font-size:14px;text-decoration:none;color:var(--texte2);background:transparent;display:inline-flex;align-items:center;gap:7px}
.puces a:hover{border-color:var(--pale);color:var(--texte)}
.puces a.on{background:var(--texte);color:var(--fond);border-color:var(--texte)}
.puces .pastille{width:8px;height:8px}
.puces.etiquettes a{font-size:13px;padding:4px 11px}.puces.etiquettes small{color:var(--pale)}
.puces .sep-puces{width:1px;height:22px;background:var(--ligne);margin:0 6px}

/* ── Liste des publications ────────────────────────────────────────────────── */
.une{display:grid;grid-template-columns:minmax(0,1.25fr) minmax(0,1fr);gap:clamp(24px,3vw,52px);align-items:center;background:var(--carte);border:1px solid var(--ligne);border-radius:24px;padding:clamp(18px,2vw,30px);text-decoration:none;margin-bottom:34px;transition:border-color .15s;box-shadow:var(--ombre)}
.une:hover{border-color:var(--pale)}
.une .illu{aspect-ratio:16/9;border-radius:16px;overflow:hidden}
.une h2{font-family:var(--serif);font-weight:500;font-size:clamp(30px,2.9vw,50px);line-height:1.08;margin:12px 0 14px;letter-spacing:-.02em}
.une p{color:var(--texte2);margin:0 0 18px;font-size:18px}
.lire{font-size:14px;font-weight:600;color:var(--acc2)}
.meta{font-size:13.5px;color:var(--pale);display:flex;gap:10px;flex-wrap:wrap;align-items:center}
.meta .cat{color:var(--c,var(--acc2));font-weight:600;display:inline-flex;align-items:center;gap:7px}
.grille{display:grid;grid-template-columns:repeat(auto-fill,minmax(330px,1fr));gap:22px}
.carte{display:flex;flex-direction:column;background:var(--carte);border:1px solid var(--ligne);border-radius:18px;overflow:hidden;text-decoration:none;transition:transform .15s,border-color .15s,box-shadow .15s}
.carte:hover{transform:translateY(-2px);border-color:var(--pale);box-shadow:var(--ombre)}
.carte .vignette{height:128px;overflow:hidden}
.carte .dedans{padding:18px 22px 20px;display:flex;flex-direction:column;flex:1}
.carte h3{font-family:var(--serif);font-weight:500;font-size:23px;line-height:1.2;margin:10px 0 10px;letter-spacing:-.01em}
.carte p{color:var(--texte2);font-size:15.5px;margin:0 0 14px;display:-webkit-box;-webkit-line-clamp:4;-webkit-box-orient:vertical;overflow:hidden}
.carte .etq,.carte .dedans>.lire{font-size:12.5px;color:var(--pale);margin-top:auto}
.carte .dedans>.lire{color:var(--acc2)}
.vide{padding:60px 0;text-align:center;color:var(--texte2)}
.statut{font-size:12px;border:1px solid var(--ligne);border-radius:6px;padding:1px 7px}
.titre-section{display:flex;align-items:baseline;gap:16px;margin:54px 0 18px}
.titre-section h2{font-family:var(--serif);font-weight:500;font-size:32px;margin:0;letter-spacing:-.015em}
.titre-section a{margin-left:auto;font-size:14.5px;color:var(--acc2);text-decoration:none;font-weight:600;white-space:nowrap}
.mini-sigles{display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:12px}
.mini-sigles a{display:block;background:var(--carte);border:1px solid var(--ligne);border-left:4px solid var(--c);border-radius:12px;padding:12px 14px;text-decoration:none;transition:border-color .15s}
.mini-sigles a:hover{border-color:var(--pale);border-left-color:var(--c)}
.mini-sigles b{font-size:17px;display:block}.mini-sigles span{font-size:13.5px;color:var(--texte2);display:block;line-height:1.35;margin-top:2px}.mini-sigles small{font-size:12px;color:var(--pale);display:block;margin-top:6px}

/* ── Article : en-tête large, puis sommaire | texte | fiche ────────────────── */
.tete-article{display:grid;grid-template-columns:minmax(0,1fr) minmax(260px,.42fr);gap:clamp(24px,4vw,64px);align-items:center;padding:14px 0 36px;border-bottom:1px solid var(--ligne);margin-bottom:36px}
.tete-article h1{font-family:var(--serif);font-weight:500;font-size:clamp(38px,4.2vw,68px);line-height:1.05;letter-spacing:-.025em;margin:14px 0 18px}
.chapo{font-size:21px;line-height:1.5;color:var(--texte2);margin:0 0 20px;font-family:var(--serif);max-width:980px}
.tete-article .illu{aspect-ratio:4/3;border-radius:20px;overflow:hidden;box-shadow:var(--ombre)}
.lecture{display:grid;grid-template-columns:minmax(190px,250px) minmax(0,880px) minmax(290px,370px);gap:clamp(32px,3vw,56px);justify-content:center;align-items:start}
.lecture>.sommaire{grid-column:1;grid-row:1}.lecture>.texte{grid-column:2;grid-row:1;min-width:0}.lecture>.rail{grid-column:3;grid-row:1}
.sommaire,.rail{position:sticky;top:calc(var(--barre-h) + 20px);max-height:calc(100vh - var(--barre-h) - 40px);overflow-y:auto;scrollbar-width:thin;z-index:1;transition:opacity .18s,visibility .18s}
.sommaire.sous-figure,.rail.sous-figure{opacity:0;visibility:hidden}
.sommaire{font-size:14px;padding-right:4px}.sommaire:empty{display:none}
.sommaire b,.rail h2,.rail .titre-bloc{display:block;font-size:11.5px;text-transform:uppercase;letter-spacing:.08em;color:var(--pale);font-weight:600;margin:0 0 10px;font-family:var(--police)}
.sommaire a{display:block;text-decoration:none;color:var(--texte2);padding:5px 0 5px 12px;border-left:2px solid var(--ligne);line-height:1.35}
.sommaire a:hover{color:var(--texte);border-left-color:var(--acc)}
.sommaire a.n3{padding-left:24px;font-size:13.5px}
.sommaire a.on{color:var(--texte);border-left-color:var(--acc);font-weight:600}
.rail{display:flex;flex-direction:column;gap:16px}
.bloc{background:var(--carte);border:1px solid var(--ligne);border-radius:16px;padding:16px 18px}
.infos{display:grid;grid-template-columns:auto 1fr;gap:6px 14px;font-size:14px;margin:0}
.infos dt{color:var(--pale)}.infos dd{margin:0;text-align:right;font-weight:500}
.rail .sigles{margin:0;border:0;padding:16px 18px}
.rail .sigles dl{display:block;margin:0}
.rail .sigles div{display:flex;gap:10px;padding:6px 0;border-bottom:1px solid var(--ligne);font-size:13.5px;line-height:1.35}
.rail .sigles div:last-child{border-bottom:0}
.rail .sigles dt{min-width:62px;font-weight:700}.rail .sigles dt a{text-decoration:none;color:var(--acc2)}.rail .sigles dt a:hover{text-decoration:underline}
.rail .sigles dd{margin:0;color:var(--texte2)}
.corps{font-size:18px}
.corps h2{font-family:var(--serif);font-weight:500;font-size:32px;line-height:1.2;margin:52px 0 14px;letter-spacing:-.015em}
.corps>h2:first-child{margin-top:0}
.corps h3{font-size:20px;margin:34px 0 10px}.corps h4{font-size:17px;margin:26px 0 8px}
.corps p{margin:0 0 20px}.corps ul,.corps ol{padding-left:24px;margin:0 0 20px}.corps li{margin:6px 0}
.corps a{color:var(--acc2);text-underline-offset:3px}
.corps code{font-size:.88em;background:rgba(127,127,127,.14);padding:.1em .35em;border-radius:5px}
.corps pre.code{background:#141413;color:#f0eee6;border-radius:12px;padding:16px 18px;overflow-x:auto;font-size:14px;line-height:1.5}
.corps pre.code code{background:none;padding:0}
.corps .table-wrap{overflow-x:auto;margin:0 0 22px;border:1px solid var(--ligne);border-radius:14px;background:var(--carte)}.corps table{border-collapse:collapse;width:100%;font-size:15.5px}
.corps th,.corps td{border-bottom:1px solid var(--ligne);padding:10px 14px;text-align:left;vertical-align:top}.corps th{font-weight:600;font-size:13.5px;text-transform:uppercase;letter-spacing:.04em;color:var(--texte2)}
.corps tr:last-child td{border-bottom:0}
.corps blockquote{margin:0 0 22px;padding:14px 18px;border-left:3px solid var(--acc);background:var(--carte);border-radius:0 12px 12px 0}
.corps .lien-ancre{opacity:0;text-decoration:none;color:var(--pale);font-size:.7em}.corps h2:hover .lien-ancre,.corps h3:hover .lien-ancre{opacity:1}
.corps hr{border:0;border-top:1px solid var(--ligne);margin:36px 0}
.figure{margin:30px -32px;background:var(--carte);border:1px solid var(--ligne);border-radius:18px;padding:22px 24px 16px;overflow-x:auto;position:relative;z-index:2}
.figure figcaption{font-size:13.5px;color:var(--pale);margin-top:8px}
.figure.large{padding:18px;margin-left:calc(-1 * (clamp(190px,13vw,250px) + clamp(32px,3vw,56px)));margin-right:calc(-1 * (clamp(290px,19vw,370px) + clamp(32px,3vw,56px)));box-shadow:var(--ombre)}
.figure.large figcaption a,.figure .glossaire-fig a{color:var(--acc2)}
.figure .glossaire-fig a{text-decoration:none}
.suite-docs{display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-top:54px}
.suite-docs a{display:block;background:var(--carte);border:1px solid var(--ligne);border-radius:16px;padding:16px 20px;text-decoration:none;transition:border-color .15s}
.suite-docs a:hover{border-color:var(--pale)}.suite-docs a.suiv{text-align:right;grid-column:2}
.suite-docs small{display:block;font-size:12.5px;color:var(--pale);text-transform:uppercase;letter-spacing:.06em}
.suite-docs b{font-family:var(--serif);font-weight:500;font-size:19px;line-height:1.25;display:block;margin-top:4px}

/* ── Sigles dans le texte : lien + bulle de définition (CSS seul) ──────────── */
abbr.sigle{text-decoration:underline dotted;text-underline-offset:3px;cursor:help}
a.sigle{position:relative;color:inherit!important;text-decoration:none}
a.sigle abbr.sigle{cursor:pointer;text-decoration:underline dotted var(--acc);text-decoration-thickness:1.5px}
a.sigle:hover abbr.sigle{text-decoration-style:solid}
a.sigle .bulle{position:absolute;left:50%;bottom:calc(100% + 10px);transform:translate(-50%,4px);width:max-content;max-width:330px;background:var(--texte);color:var(--fond);border-radius:12px;padding:11px 14px 10px;font:400 14px/1.45 var(--police);text-align:left;white-space:normal;opacity:0;visibility:hidden;transition:opacity .14s,transform .14s,visibility .14s;z-index:40;pointer-events:none;box-shadow:0 10px 30px rgba(0,0,0,.25)}
a.sigle .bulle::after{content:'';position:absolute;top:100%;left:50%;margin-left:-6px;border:6px solid transparent;border-top-color:var(--texte)}
a.sigle:hover .bulle,a.sigle:focus-visible .bulle{opacity:1;visibility:visible;transform:translate(-50%,0)}
.bulle b{display:block;font-size:15px}.bulle span{display:block;font-weight:600}.bulle small{display:block;opacity:.78;margin-top:4px;font-size:13px}.bulle em{display:block;margin-top:7px;font-style:normal;font-size:12.5px;color:var(--acc)}
.sigles{margin-top:46px;border-top:1px solid var(--ligne);padding-top:6px}
.sigles dl{display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:0 26px;font-size:15.5px;line-height:1.5;margin:0}
.sigles dl div{display:flex;gap:14px;padding:9px 0;border-bottom:1px solid var(--ligne)}
.sigles dt{font-weight:700;min-width:64px}.sigles dd{margin:0;color:var(--texte2)}.sigles dd b{color:var(--texte);font-weight:600}

/* ── Glossaire : fiches en grille, index alphabétique ─────────────────────── */
.recherche-grande{display:flex;gap:8px;margin:0 0 14px}
.recherche-grande input{flex:1;min-width:0;font:inherit;font-size:17px;padding:14px 16px;border-radius:14px;border:1px solid var(--ligne);background:var(--carte);color:var(--texte)}
.recherche-grande input:focus{outline:2px solid var(--acc);outline-offset:1px}
.alphabet{position:sticky;top:var(--barre-h);z-index:5;display:flex;flex-wrap:wrap;gap:4px;align-items:center;padding:10px 0;margin:0 0 10px;background:var(--fond);border-bottom:1px solid var(--ligne)}
.alphabet a,.alphabet span{width:32px;height:32px;display:grid;place-items:center;border-radius:8px;font-size:14px;font-weight:600;text-decoration:none}
.alphabet a:hover{background:var(--texte);color:var(--fond)}.alphabet span{color:var(--pale);opacity:.45;font-weight:500}
.alphabet .vues{margin-left:auto;display:flex;gap:6px}
.alphabet .vues a{width:auto;padding:0 12px;border:1px solid var(--ligne);font-weight:500;font-size:13.5px;color:var(--texte2)}
.alphabet .vues a.on{background:var(--texte);color:var(--fond);border-color:var(--texte)}
h2.famille{font-family:var(--serif);font-weight:500;font-size:30px;margin:42px 0 16px;display:flex;align-items:center;gap:12px;letter-spacing:-.01em}
h2.famille small{font-family:var(--police);font-size:13px;color:var(--pale);font-weight:500}
h2.famille .pastille{width:12px;height:12px;border-radius:4px}
.fiches{display:grid;grid-template-columns:repeat(auto-fill,minmax(290px,1fr));gap:14px}
.fiche{display:flex;flex-direction:column;background:var(--carte);border:1px solid var(--ligne);border-radius:16px;padding:16px 18px 14px;text-decoration:none;position:relative;overflow:hidden;transition:transform .15s,border-color .15s,box-shadow .15s}
.fiche::before{content:'';position:absolute;inset:0 auto 0 0;width:4px;background:var(--c)}
.fiche:hover{transform:translateY(-2px);border-color:var(--pale);box-shadow:var(--ombre)}
.fiche .s{font-family:var(--serif);font-size:30px;font-weight:600;line-height:1.05;letter-spacing:-.01em;color:var(--texte)}
.fiche .sens{font-weight:600;font-size:15px;line-height:1.35;margin-top:6px}
.fiche .detail{font-size:14px;color:var(--texte2);line-height:1.45;margin:6px 0 auto;display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden}
.fiche .pied-fiche{display:flex;gap:8px;align-items:center;font-size:12.5px;color:var(--pale);margin-top:12px}
.fiche .pied-fiche i{font-style:normal;margin-left:auto;color:var(--c);font-weight:600}

/* ── La page d'un sigle ────────────────────────────────────────────────────── */
.tete-sigle{position:relative;display:grid;grid-template-columns:minmax(0,1fr) minmax(300px,440px);gap:clamp(24px,4vw,70px);align-items:end;padding:34px clamp(22px,3vw,48px) 36px;border-radius:26px;background:var(--carte);border:1px solid var(--ligne);overflow:hidden;margin-bottom:34px;box-shadow:var(--ombre)}
.tete-sigle::before{content:'';position:absolute;inset:0;background:radial-gradient(circle at 12% 0%,color-mix(in srgb,var(--c) 22%,transparent),transparent 55%),radial-gradient(circle at 100% 100%,color-mix(in srgb,var(--c) 14%,transparent),transparent 50%);pointer-events:none}
.tete-sigle>*{position:relative}
.puce-famille{display:inline-flex;align-items:center;gap:8px;font-size:13.5px;font-weight:600;text-decoration:none;color:var(--c);border:1px solid color-mix(in srgb,var(--c) 45%,transparent);background:color-mix(in srgb,var(--c) 10%,transparent);padding:5px 12px;border-radius:999px}
.puces-sigle{display:flex;gap:8px;flex-wrap:wrap;align-items:center}
.puce-nature{color:var(--texte2);border-color:var(--ligne);background:var(--carte)}
.puce-page{font-size:12.5px;font-weight:600;color:var(--pale);padding:5px 4px}
.titre-bloc{display:block;font-size:11.5px;text-transform:uppercase;letter-spacing:.08em;color:var(--pale);font-weight:600;margin:0 0 8px}
.fiche-texte>h2{font-family:var(--serif);font-weight:500;font-size:32px;line-height:1.2;margin:52px 0 14px;letter-spacing:-.015em}
.fiche-texte>h2:first-child,.fiche-texte>.avis+h2{margin-top:0}
.fiche-texte .definition{padding:0 0 26px;border-bottom:1px solid var(--ligne);margin-bottom:34px}
.a-rediger{margin:22px 0 0;padding:14px 18px;border:1px dashed var(--ligne);border-radius:14px;color:var(--texte2);font-size:15px}
.fiche .badge-page{font-style:normal;font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:.05em;color:var(--c);border:1px solid color-mix(in srgb,var(--c) 45%,transparent);border-radius:6px;padding:1px 6px;margin-left:6px;vertical-align:middle}
.sigle-geant{font-family:var(--serif);font-weight:600;font-size:clamp(72px,10vw,168px);line-height:.9;letter-spacing:-.04em;margin:22px 0 14px;word-break:break-word;color:var(--texte)}
.tete-sigle .sens{font-family:var(--serif);font-size:clamp(22px,2.2vw,34px);line-height:1.2;margin:0;color:var(--texte2)}
.tete-sigle .chiffres{align-self:stretch;align-content:end}
.corps-sigle{display:grid;grid-template-columns:minmax(0,1fr) minmax(300px,400px);gap:clamp(28px,3vw,56px);align-items:start}
.definition{font-family:var(--serif);font-size:clamp(20px,1.5vw,24px);line-height:1.55;margin:0 0 8px;max-width:1000px}
.definition a.sigle .bulle{font-family:var(--police)}
.corps-sigle h2{font-family:var(--serif);font-weight:500;font-size:28px;margin:40px 0 16px;letter-spacing:-.01em}
.corps-sigle>div>h2:first-child{margin-top:0}
.emploi{background:var(--carte);border:1px solid var(--ligne);border-radius:18px;padding:18px 22px;margin:0 0 14px}
.emploi header{display:flex;align-items:baseline;gap:14px;flex-wrap:wrap}
.emploi h3{font-family:var(--serif);font-weight:500;font-size:22px;margin:0;line-height:1.25}
.emploi h3 a{text-decoration:none}.emploi h3 a:hover{text-decoration:underline;text-underline-offset:4px}
.emploi header .compte{margin-left:auto;font-size:13px;color:var(--pale);white-space:nowrap}
.passages{list-style:none;padding:0;margin:14px 0 0;display:grid;gap:10px}
.passages li{border-left:3px solid color-mix(in srgb,var(--c) 55%,transparent);padding:4px 0 4px 14px;font-size:15.5px;color:var(--texte2);line-height:1.5}
.passages li a.ou{display:inline-block;font-size:12.5px;font-weight:600;color:var(--acc2);text-decoration:none;margin-bottom:2px}
.passages li a.ou:hover{text-decoration:underline}
.passages mark{background:color-mix(in srgb,var(--c) 26%,transparent);color:var(--texte);border-radius:4px;padding:0 3px;font-weight:600}
.dans-figures{margin-top:10px;font-size:13.5px;color:var(--pale)}.dans-figures a{color:var(--acc2)}
.cote-sigle{position:sticky;top:calc(var(--barre-h) + 20px);display:flex;flex-direction:column;gap:16px}
.liste-sigles{list-style:none;padding:0;margin:0}
.liste-sigles li a{display:flex;gap:10px;padding:7px 0;border-bottom:1px solid var(--ligne);text-decoration:none;font-size:14px;line-height:1.35}
.liste-sigles li:last-child a{border-bottom:0}
.liste-sigles li a:hover b{color:var(--acc2)}
.liste-sigles b{min-width:64px;font-weight:700}.liste-sigles span{color:var(--texte2)}
.precsuiv{display:grid;grid-template-columns:1fr auto 1fr;gap:14px;align-items:center;margin-top:48px;padding-top:22px;border-top:1px solid var(--ligne)}
.precsuiv a{text-decoration:none;display:block;padding:12px 16px;border-radius:14px;border:1px solid var(--ligne);background:var(--carte)}
.precsuiv a:hover{border-color:var(--pale)}
.precsuiv a small{display:block;font-size:12px;color:var(--pale)}.precsuiv a b{font-size:18px}
.precsuiv .suiv{text-align:right}.precsuiv .centre{border:0;background:none;font-size:14px;color:var(--texte2)}

/* ── Galerie des graphiques, accès, divers ────────────────────────────────── */
.galerie{display:grid;grid-template-columns:repeat(auto-fill,minmax(560px,1fr));gap:26px}.galerie .figure{margin:14px 0;position:static}.exemple.pleine{grid-column:1/-1}.exemple h3{margin:0 0 6px;font-size:19px}.exemple p{color:var(--texte2);font-size:15px;margin:0}.exemple details{font-size:14px}.exemple summary{cursor:pointer;color:var(--texte2)}
.exemple pre.code{background:#141413;color:#f0eee6;border-radius:12px;padding:12px 14px;overflow-x:auto;font-size:12.5px;line-height:1.45;max-height:320px}
.etroit{max-width:820px}
.etroit h1{font-family:var(--serif);font-weight:500;font-size:clamp(36px,4vw,56px);line-height:1.08;letter-spacing:-.02em;margin:14px 0 18px}
.notes{margin-top:44px;border-top:1px solid var(--ligne);padding-top:8px}
.notes h2{font-family:var(--serif);font-weight:500;font-size:26px}
.note{background:var(--carte);border:1px solid var(--ligne);border-radius:12px;padding:12px 16px;margin:0 0 12px}
.note p{margin:6px 0 0;font-size:15.5px;white-space:pre-wrap}
.figure-erreur{border:1px dashed var(--acc);border-radius:12px;padding:12px 14px;color:var(--acc2);font-size:14.5px;margin:0 0 20px}
.versions{font-size:14px;color:var(--texte2);border-top:1px solid var(--ligne);margin-top:50px;padding-top:18px}
.versions a{color:var(--texte2)}
.avis{background:var(--carte);border:1px solid var(--ligne);border-radius:12px;padding:10px 14px;font-size:14.5px;margin-bottom:20px}
form.acces{display:flex;gap:8px;flex-wrap:wrap;margin:10px 0 24px}
form.acces select{padding:10px 12px;border:1px solid var(--ligne);border-radius:10px;background:var(--carte);color:var(--texte);font:inherit}
form.acces input{flex:1;min-width:180px;padding:10px 12px;border:1px solid var(--ligne);border-radius:10px;background:var(--carte);color:var(--texte);font:inherit}
button,.bouton{font:inherit;font-size:15px;padding:10px 16px;border-radius:10px;border:0;background:var(--texte);color:var(--fond);cursor:pointer;text-decoration:none}
button.discret{background:transparent;color:var(--texte2);border:1px solid var(--ligne);padding:6px 12px;font-size:13.5px}
.liste-acces{list-style:none;padding:0;margin:0}.liste-acces li{display:flex;align-items:center;gap:12px;padding:10px 0;border-bottom:1px solid var(--ligne)}
.liste-acces span{flex:1}
.resultats{display:grid;grid-template-columns:minmax(0,1.4fr) minmax(0,1fr);gap:clamp(24px,3vw,48px);align-items:start}
.resultats h2{font-family:var(--serif);font-weight:500;font-size:26px;margin:0 0 14px}
.resultat{display:block;background:var(--carte);border:1px solid var(--ligne);border-radius:14px;padding:14px 18px;margin:0 0 10px;text-decoration:none}
.resultat:hover{border-color:var(--pale)}.resultat b{font-family:var(--serif);font-weight:500;font-size:20px;display:block;margin:4px 0}.resultat span{font-size:14.5px;color:var(--texte2)}

/* ── Écrans moyens : le sommaire rejoint la fiche du document ─────────────── */
@media (min-width:981px){.corps .table-wrap{overflow:visible}}
@media (max-width:1560px){
  .lecture{grid-template-columns:minmax(0,880px) minmax(280px,340px);grid-template-rows:auto 1fr}
  .lecture>.texte{grid-column:1;grid-row:1 / span 2}
  .lecture>.sommaire{grid-column:2;grid-row:1;position:static;max-height:none}
  .lecture>.rail{grid-column:2;grid-row:2}
  .figure.large{margin-left:-18px;margin-right:calc(-1 * (clamp(280px,22vw,340px) + clamp(32px,3vw,56px)))}
}
@media (max-width:1240px){
  .lecture{grid-template-columns:minmax(0,1fr);grid-template-rows:none}
  .lecture>.texte,.lecture>.sommaire,.lecture>.rail{grid-column:1;grid-row:auto;position:static;max-height:none}
  .lecture>.sommaire{order:-1;border-bottom:1px solid var(--ligne);padding:0 0 18px}
  .tete-article{margin-bottom:24px}
  .rail{display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr))}
  .figure.large{margin-left:0;margin-right:0}
  .tete-article{grid-template-columns:1fr}.tete-article .illu{display:none}
  .corps-sigle{grid-template-columns:1fr}.cote-sigle{position:static}
  .bandeau,.tete-sigle{grid-template-columns:1fr;align-items:start}
  .chiffres{grid-template-columns:repeat(4,minmax(0,1fr))}
}
/* ── Téléphone et tablette : la barre latérale devient un tiroir ──────────── */
@media (max-width:980px){
  .appli{grid-template-columns:1fr}
  .cote{position:fixed;inset:0 auto 0 0;width:min(300px,86vw);z-index:60;transform:translateX(-102%);transition:transform .2s,box-shadow .2s}
  #menu:checked~.appli .cote{transform:none;box-shadow:0 0 40px rgba(0,0,0,.25)}
  #menu:checked~.appli .voile{display:block;position:fixed;inset:0;background:rgba(0,0,0,.35);z-index:50}
  .menu-bouton{display:grid;place-items:center;width:38px;height:38px;border-radius:10px;border:1px solid var(--ligne);background:var(--carte);cursor:pointer;flex-shrink:0}
  #menu:focus-visible~.appli .menu-bouton{outline:2px solid var(--acc)}
  .barre .marque-mobile{display:block;font-family:var(--serif);font-weight:600;font-size:19px;text-decoration:none;white-space:nowrap}
  .barre .marque-mobile span{color:var(--acc)}
  .barre .fil{display:none}
  .une{grid-template-columns:1fr}
  .figure{margin:26px 0;padding:14px}
  .galerie{grid-template-columns:1fr}
  .resultats{grid-template-columns:1fr}
  .chiffres{grid-template-columns:repeat(2,minmax(0,1fr))}
  .suite-docs{grid-template-columns:1fr}.suite-docs a.suiv{grid-column:1}
  .precsuiv{grid-template-columns:1fr 1fr}.precsuiv .centre{display:none}
}
/* Sans survol (téléphone) : pas de bulle — le toucher ouvre la fiche. Cachée mais présente,
   elle élargissait la page au-delà de l'écran (défilement horizontal). */
@media (max-width:980px),(hover:none){a.sigle .bulle{display:none}}
@media (max-width:560px){.barre .actions .bouton-fin{display:none}.alphabet a,.alphabet span{width:28px;height:28px;font-size:13px}.chiffre b{font-size:30px}.sigle-geant{margin-top:16px}}
@media print{.cote,.barre,.rail,.sommaire,.pied,.alphabet{display:none!important}.appli{display:block}.lecture{display:block}.figure.large{margin:20px 0}}
`;

const ICONES = {
  publications: '<path d="M4 5.5A1.5 1.5 0 0 1 5.5 4h9A1.5 1.5 0 0 1 16 5.5v9a1.5 1.5 0 0 1-1.5 1.5h-9A1.5 1.5 0 0 1 4 14.5z"/><path d="M7 8h6M7 11h6M7 14h3"/>',
  architecture: '<path d="M3 16h14M5 16V9l5-4 5 4v7"/><path d="M8.5 16v-4h3v4"/>',
  glossaire: '<path d="M5 4h8.5A1.5 1.5 0 0 1 15 5.5V16H6.5A1.5 1.5 0 0 1 5 14.5z"/><path d="M5 14.5A1.5 1.5 0 0 1 6.5 13H15"/><path d="M8 7.5h4"/>',
  graphiques: '<path d="M4 16V4M4 16h12"/><path d="M7 13l3-4 2.5 2L16 6"/>',
  acces: '<circle cx="10" cy="7.5" r="3"/><path d="M4.5 16a5.5 5.5 0 0 1 11 0"/>',
  recherche: '<circle cx="9" cy="9" r="5"/><path d="M13 13l3.5 3.5"/>',
  experts: '<rect x="3" y="3" width="6" height="6" rx="1.5"/><rect x="11" y="3" width="6" height="6" rx="1.5"/><rect x="3" y="11" width="6" height="6" rx="1.5"/><circle cx="14" cy="14" r="3"/>',
  protocole: '<path d="M4 6h8M4 10h12M4 14h8"/><path d="M13 4l3 2-3 2M13 12l3 2-3 2"/>',
};
const icone = (n, t = 16) => '<svg width="' + t + '" height="' + t + '" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + ICONES[n] + '</svg>';

/**
 * Une page complète. Sans `nav` : page nue (404, refus) — on ne montre la navigation,
 * et ce qu'elle compte, qu'à un lecteur autorisé.
 */
function page(titre, corps, { description = '', nav = '', fil = null } = {}) {
  const G = require('../modules/graphiques');
  const ui=require('../instance').appearance();
  const marque=esc(ui.brand)+'<span>.</span>'+(ui.workspace?' '+esc(ui.workspace):'');
  const tete = '<!DOCTYPE html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">'
    + '<title>' + esc(titre) + '</title><meta name="robots" content="noindex, nofollow">'
    + (description ? '<meta name="description" content="' + esc(description) + '">' : '')
    + '<link rel="icon" href="/icon.svg"><link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>'
    + '<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Source+Serif+4:opsz,wght@8..60,400;8..60,500;8..60,600&display=swap" rel="stylesheet">'
    + '<style>' + CSS + G.CSS + require('./metis-experts-pages').CSS + '</style></head><body>';
  const filHtml = fil && fil.length ? '<nav class="fil" aria-label="Fil d’Ariane">' + fil.map(([t, h], i) => (i ? '<span class="sep">/</span>' : '') + (h ? '<a href="' + esc(h) + '">' + esc(t) + '</a>' : '<strong>' + esc(t) + '</strong>')).join('') + '</nav>' : '';
  if (!nav) {
    return tete + '<div class="appli" style="grid-template-columns:1fr"><div class="scene"><header class="barre"><a class="marque-mobile" style="display:block" href="/metis">'+marque+'</a></header>'
      + '<main>' + corps + '</main></div></div></body></html>';
  }
  return tete + '<input type="checkbox" id="menu" aria-label="Ouvrir le menu"><div class="appli">' + nav + '<label for="menu" class="voile" aria-hidden="true"></label>'
    + '<div class="scene"><header class="barre"><label for="menu" class="menu-bouton" title="Menu"><svg width="18" height="18" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><path d="M3 6h14M3 10h14M3 14h14"/></svg><span class="hors-champ">Menu</span></label>'
    + '<a class="marque-mobile" href="/metis">'+marque+'</a>' + filHtml
    + '<div class="actions">'+['experts','glossaire','graphiques'].map(id=>{const item=ui.navigation.find(n=>n.id===id);return item.visible?'<a class="bouton-fin" href="/metis/'+id+'">'+esc(item.label)+'</a>':'';}).join('')+'</div></header>'
    + '<main>' + corps + '</main><script src="/metis/metis.js" defer></script><footer class="pied"><span>Recherche Métis · pages réservées, non indexées</span><a href="/">plagnito.com</a><a href="https://docu.plagnito.com/metis-mcp">Connecteur MCP</a></footer></div></div></body></html>';
}

// Un motif SVG dessiné depuis un texte (pas d'image à héberger), sur la teinte donnée.
function motif(graineTexte, couleur = '#d97757') {
  let h = 2166136261; for (const c of String(graineTexte)) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); }
  const r = () => { h ^= h << 13; h ^= h >>> 17; h ^= h << 5; return ((h >>> 0) % 1000) / 1000; };
  let s = '<svg viewBox="0 0 400 300" width="100%" height="100%" preserveAspectRatio="xMidYMid slice" aria-hidden="true"><rect width="400" height="300" fill="' + couleur + '"/>';
  for (let i = 0; i < 7; i++) s += '<circle cx="' + Math.round(r() * 400) + '" cy="' + Math.round(r() * 300) + '" r="' + Math.round(30 + r() * 110) + '" fill="#141413" opacity="' + (0.05 + r() * 0.12).toFixed(2) + '"/>';
  s += '<path d="M40 220 C 120 ' + Math.round(80 + r() * 80) + ', 220 ' + Math.round(180 + r() * 60) + ', 360 ' + Math.round(60 + r() * 60) + '" fill="none" stroke="#faf9f5" stroke-width="3" stroke-linecap="round"/>';
  for (let i = 0; i < 5; i++) s += '<circle cx="' + Math.round(40 + i * 80) + '" cy="' + Math.round(80 + r() * 150) + '" r="6" fill="#faf9f5"/>';
  return s + '</svg>';
}

// Un SVG autonome (servi seul) : il porte ses styles et son fond, en clair ou en sombre.
function svgSeul(G, spec, sombre) {
  const css = G.CSS.replace(/@media[^{]*\{:root[^{]*\{[^}]*\}\}/, '').replace(/:root\[data-theme="dark"\]\{[^}]*\}/, '').replace(':root{', 'svg{')
    + (sombre ? 'svg{' + G.COUL_SOMBRE + '}' : '');
  // Servi seul, le SVG est lu comme du XML STRICT : un second attribut style sur la
  // balise racine (la planche porte déjà style="min-width:…") rend la page illisible
  // (« Attribute style redefined »). On fusionne donc dans l'attribut existant — et la
  // largeur minimale, utile dans un article, n'a pas de sens pour une figure seule.
  const fond = 'background:' + (sombre ? '#262624' : '#faf9f5') + ';font-family:Inter,system-ui,sans-serif';
  const svg = G.rendre(spec, { id: 'apercu' });
  const fin = svg.indexOf('>');
  let racine = svg.slice(0, fin);
  racine = / style="[^"]*"/.test(racine)
    ? racine.replace(/ style="([^"]*)"/, (m, s) => ' style="' + fond + ';' + s.replace(/(^|;)\s*min-width:[^;]*/g, '').replace(/^;+|;+$/g, '') + '"').replace(/;"/, '"')
    : racine.replace('<svg ', '<svg style="' + fond + '" ');
  return (racine + svg.slice(fin)).replace('</title>', '</title><style>' + css + '</style>');
}

const SCRIPT = `(function () {
  // Tiroir du téléphone : un lien vers une ancre de la même page doit aussi le refermer.
  var menu = document.getElementById('menu');
  if (menu) [].forEach.call(document.querySelectorAll('.cote a'), function (a) { a.addEventListener('click', function () { menu.checked = false; }); });
  var figs = [].slice.call(document.querySelectorAll('.lecture .figure.large'));
  var cotes = [].slice.call(document.querySelectorAll('.lecture > .sommaire, .lecture > .rail'));
  // Le sommaire suit la lecture : la section en cours y est marquée.
  var liens = [].slice.call(document.querySelectorAll('.sommaire a[href^="#"]'));
  var titres = liens.map(function (a) { return document.getElementById(decodeURIComponent(a.getAttribute('href').slice(1))); });
  if (!cotes.length) return;
  var prevu = false;
  function croise(a, b) { return a.bottom > b.top && a.top < b.bottom && a.right > b.left && a.left < b.right; }
  function maj() {
    prevu = false;
    var k = -1;
    titres.forEach(function (t, i) { if (t && t.getBoundingClientRect().top < 140) k = i; });
    liens.forEach(function (a, i) { a.classList.toggle('on', i === k); });
    var zones = figs.map(function (f) { return f.getBoundingClientRect(); });
    cotes.forEach(function (c) {
      var r = c.getBoundingClientRect();
      c.classList.toggle('sous-figure', zones.some(function (z) { return croise(z, r); }));
    });
  }
  function demander() { if (!prevu) { prevu = true; requestAnimationFrame(maj); } }
  addEventListener('scroll', demander, { passive: true });
  addEventListener('resize', demander);
  maj();
})();
`;

// Un extrait de emploisSigle : \u0001…\u0002 marque le sigle, le reste est du texte brut.
const surligner = (t) => esc(t).replace(/\u0001/g, '<mark>').replace(/\u0002/g, '</mark>');

function metisPages() {
  const router = express.Router();
  const M = require('../modules/metisdocs');

  // La barre latérale : ce que le lecteur peut ouvrir, avec les comptes.
  function navigation(moi, actif, { categorie = null, famille = null, pool = null } = {}) {
    const X = require('../modules/metisexperts');
    const docs = M.lister(moi.id) || [];
    const sigles = M.glossaire(moi.id) || [];
    const parCat = {}; for (const d of docs) parCat[d.categorie] = (parCat[d.categorie] || 0) + 1;
    const parFam = {}; for (const g of sigles) { const f = g.categorie || 'Autres'; parFam[f] = (parFam[f] || 0) + 1; }
    const lien = (href, texte, n, on, avant = '') => '<a href="' + esc(href) + '"' + (on ? ' class="on" aria-current="page"' : '') + '>' + avant + '<span>' + esc(texte) + '</span>' + (n != null ? '<i>' + n + '</i>' : '') + '</a>';
    const ui=require('../instance').appearance();
    const entries={publications:['/metis',docs.length,'publications'],architecture:['/metis?categorie='+encodeURIComponent(require('../instance').architecture()),parCat[require('../instance').architecture()]||0,'architecture'],glossaire:['/metis/glossaire',sigles.length,'glossaire'],experts:['/metis/experts',X.statistiques(moi.id).experts,'experts'],graphiques:['/metis/graphiques',require('../modules/graphiques').CATALOGUE.length,'graphiques'],connecteur:['/metis/connecteur',null,'architecture'],securite:['/metis/securite',null,'architecture']};
    let h='<aside class="cote" aria-label="Navigation"><a class="marque" href="/metis">'+esc(ui.brand)+'<span>.</span>'+(ui.workspace?' '+esc(ui.workspace):'')+'<small>'+esc(ui.subtitle)+'</small></a>'
      +'<form class="cherche" method="get" action="/metis/recherche" role="search">'+icone('recherche',15)+'<input name="q" placeholder="'+esc(ui.search)+'" aria-label="Chercher dans Recherche Métis"></form>'
      +'<nav class="groupe"><b>'+esc(ui.section)+'</b>'+ui.navigation.filter(n=>n.visible).map(n=>{const [href,count,icon]=entries[n.id];return lien(href,n.label,ui.showCounts?count:null,actif===n.id,icone(icon));}).join('')+'</nav>';
    // Sur les pages du registre : les pools, comme les catégories des publications.
    if (actif === 'experts') { const ps = X.pools(moi.id) || []; if (ps.length) h += '<nav class="groupe"><b>Pools d’experts</b>' + ps.map((p) => lien('/metis/experts/pool/' + p.id, p.nom, p.experts, pool === p.id, '<span class="pastille" style="--c:' + (p.type === 'principal' ? 'var(--texte2)' : PALETTE[((p.couleur || 1) - 1) % PALETTE.length]) + '"></span>')).join('') + '</nav>'; }
    const cats = M.CATEGORIES.filter((c) => parCat[c]);
    if (cats.length) h += '<nav class="groupe"><b>Catégories</b>' + cats.map((c) => lien('/metis?categorie=' + encodeURIComponent(c), c, parCat[c], categorie === c, '<span class="pastille" style="--c:' + teinte(c) + '"></span>')).join('') + '</nav>';
    const fams = Object.keys(parFam).sort((a, b) => a.localeCompare(b, 'fr'));
    if (fams.length) h += '<nav class="groupe"><b>Familles de sigles</b>' + fams.map((f) => lien('/metis/glossaire#famille-' + ancreDe(f), f, parFam[f], famille === f, '<span class="pastille" style="--c:' + teinte(f) + '"></span>')).join('') + '</nav>';
    h += '<div class="bas"><span>Connecté : <b style="color:var(--texte2)">' + esc(moi.pseudo) + '</b></span>'
      + (M.estMaster(moi.id) ? '<a href="/metis/apparence">Personnaliser l’interface</a><a href="/metis/categories">Personnaliser les catégories</a><a href="/metis/securite/configuration">Agents et modèles</a><a href="/metis/instance#settings">Réglages de l’instance</a><a href="/metis/instance#connectors">Gérer les accès</a>' : '') + '<a href="/">← Accueil</a></div></aside>';
    return h;
  }
  const envoyer = (res, moi, titre, h, { actif, fil, description, categorie, famille, pool } = {}) =>
    res.send(page(titre, h, { description, fil, nav: navigation(moi, actif, { categorie, famille, pool }) }));

  const pasTrouve = (res, moi) => {
    const h = '<div class="vide"><h1 style="font-family:var(--serif);font-weight:500;font-size:44px;margin:0 0 10px">Page introuvable</h1><p><a href="' + (moi ? '/metis' : '/') + '">' + (moi ? 'Revenir aux publications' : 'Revenir à plagnito.com') + '</a></p></div>';
    res.status(404).set('X-Robots-Tag', 'noindex').send(moi ? page('Page introuvable', h, { nav: navigation(moi, null) }) : page('Page introuvable', h));
  };
  const garde = (req, res) => {
    res.set('X-Robots-Tag', 'noindex, nofollow');
    res.set('Cache-Control', 'no-store');
    const moi = compteDe(req);
    if (!moi) { res.redirect('/?return=' + encodeURIComponent(req.originalUrl)); return null; }
    if (!M.peutLire(moi.id)) { pasTrouve(res); return null; }
    return moi;
  };
  const metaDoc = (d) => '<div class="meta" style="--c:' + teinte(d.categorie) + '"><span class="cat"><span class="pastille"></span>' + esc(d.categorie) + '</span><span>' + esc(date(d.majLe)) + '</span>'
    + (d.statut && d.statut !== 'publie' ? '<span class="statut">' + (d.statut === 'brouillon' ? 'Brouillon' : 'Archivé') + '</span>' : '') + '</div>';

  require('../instance').mount(router, { garde, envoyer, pasTrouve, compteDe });
  require('./metis-command-center').mount(router, { garde, envoyer, pasTrouve, compteDe });
  require('./metis-securite-page').mount(router, { garde, envoyer, pasTrouve, compteDe });
  require('./metis-improvement-board').mount(router, { garde, envoyer, pasTrouve, compteDe });
  require('./metis-command-timeline').mount(router, { garde, envoyer, pasTrouve, compteDe });
  require('./metis-command-observatory').mount(router, { garde, envoyer, pasTrouve, compteDe });
  for(const name of ['experiments','agents','studio','security','history','neural','workflows','live'])require('./metis-command-'+name).mount(router,{garde,envoyer,pasTrouve,compteDe});

  router.get('/connecteur/stats.json', async (req, res, next) => {
    try {
    const moi = garde(req, res); if (!moi) return;
    if (!M.estMaster(moi.id)) return pasTrouve(res, moi);
    const stats = require('../modules/metisusage').stats(moi.id, { days: Number(req.query.days || 7) });
    stats.lab = await require('./metis-lab-gateway').snapshot(moi.id);
    const current = compteDe(req);
    if (!current || current.id !== moi.id || !M.estMaster(current.id)) return pasTrouve(res, moi);
    stats.connector = require('./metis-connector-details').snapshot(moi.id);
    stats.shadow = require('./metis-connector-details').shadow();
    res.json(stats);
    } catch (error) { next(error); }
  });
  router.get('/connecteur/events', (req, res) => {
    const moi = garde(req, res); if (!moi) return;
    if (!M.estMaster(moi.id)) return pasTrouve(res, moi);
    require('./metis-usage-live').stream(req, res, { account: moi.id, authorized: () => {
      const current = compteDe(req);
      return current && current.id === moi.id && M.estMaster(current.id);
    } });
  });
  router.get('/connecteur/live.js', (req, res) => {
    res.set('Cache-Control', 'no-cache').sendFile(require('node:path').join(__dirname, 'public', 'metis-usage.js'));
  });
  router.get('/connecteur', async (req, res, next) => {
    try {
    const moi = garde(req, res); if (!moi) return;
    if (!M.estMaster(moi.id)) return pasTrouve(res, moi);
    const stats = require('../modules/metisusage').stats(moi.id, { days: Number(req.query.days || 7) });
    stats.lab = await require('./metis-lab-gateway').snapshot(moi.id);
    const current = compteDe(req);
    if (!current || current.id !== moi.id || !M.estMaster(current.id)) return pasTrouve(res, moi);
    const audit = require('../modules/metisarchitecture').audit(moi.id, { limit: 1 });
    stats.connector = require('./metis-connector-details').snapshot(moi.id);
    envoyer(res, moi, 'Activité du connecteur — Métis', require('./metis-usage-dashboard').render(stats, audit), { actif: 'connecteur', fil: [['Recherche Métis', '/metis'], ['Connecteur', null]] });
    } catch (error) { next(error); }
  });

  router.get('/', (req, res) => {
    const moi = garde(req, res); if (!moi) return;
    const cat = M.CATEGORIES.includes(req.query.categorie) ? req.query.categorie : null;
    const etq = req.query.etiquette ? String(req.query.etiquette).slice(0, 30) : null;
    const docs = M.lister(moi.id, { categorie: cat, etiquette: etq }) || [];
    const tous = M.lister(moi.id) || [];
    const sigles = M.glossaire(moi.id) || [];
    const st = M.statistiques(moi.id) || {};
    const nbGraph = Object.values(st.graphiquesParType || {}).reduce((a, b) => a + b, 0);
    let h = '<section class="bandeau"><div><p class="sur">' + (cat ? 'Catégorie' : etq ? 'Étiquette' : 'Recherche Métis') + '</p><h1>' + esc(cat || (etq ? '#' + etq : 'Travaux, plans et propositions')) + '</h1>'
      + '<p class="intro">' + (cat || etq ? pluriel(docs.length, 'publication') + (cat === require('../instance').architecture() ? ' qui décrivent le système partie par partie : chaque plan situe ses blocs, leur état et leurs sigles.' : '.') : 'Travaux de recherche et propositions de modification sur le système Métis, publiés par ChatGPT et relus avec Claude. Chaque sigle a sa fiche ; chaque schéma est dessiné par le serveur.') + '</p></div>'
      + '<div class="chiffres">'
      + '<a class="chiffre" href="/metis"><b>' + tous.length + '</b><span>Publications</span><small>' + pluriel(st.versions || 0, 'version') + ' conservées</small></a>'
      + '<a class="chiffre" href="/metis?categorie=' + encodeURIComponent(require('../instance').architecture()) + '"><b>' + tous.filter((d) => d.categorie === require('../instance').architecture()).length + '</b><span>Plans d’architecture</span><small>le système, bloc par bloc</small></a>'
      + '<a class="chiffre" href="/metis/glossaire"><b>' + sigles.length + '</b><span>Sigles au glossaire</span><small>chacun sur sa propre page</small></a>'
      + '<a class="chiffre" href="/metis/graphiques"><b>' + nbGraph + '</b><span>Figures dessinées</span><small>' + pluriel(st.notesOuvertes || 0, 'note') + ' de relecture ouverte' + ((st.notesOuvertes || 0) > 1 ? 's' : '') + '</small></a>'
      + '</div></section>';
    h += '<div class="puces"><a href="/metis"' + (!cat && !etq ? ' class="on"' : '') + '>Tout</a>' + M.CATEGORIES.map((c) => '<a href="/metis?categorie=' + encodeURIComponent(c) + '"' + (cat === c ? ' class="on"' : '') + '><span class="pastille" style="--c:' + teinte(c) + '"></span>' + esc(c) + '</a>').join('');
    const toutes = M.etiquettes(moi.id);
    if (toutes.length) h += '<span class="sep-puces"></span>' + (etq ? '<a href="/metis' + (cat ? '?categorie=' + encodeURIComponent(cat) : '') + '" class="on">× ' + esc(etq) + '</a>' : '') + toutes.filter((t) => t.nom !== etq).slice(0, 18).map((t) => '<a href="/metis?etiquette=' + encodeURIComponent(t.nom) + (cat ? '&categorie=' + encodeURIComponent(cat) : '') + '" style="font-size:13px;padding:4px 11px">#' + esc(t.nom) + ' <small style="color:var(--pale)">' + t.documents + '</small></a>').join('');
    h += '</div>';
    if (!docs.length) h += '<div class="vide">Aucune publication ici pour l’instant. ChatGPT peut en publier par le connecteur MCP <code>__INSTANCE_MCP__</code>.</div>';
    else {
      const [une, ...reste] = docs;
      h += '<a class="une" href="/metis/' + esc(une.slug) + '"><div class="illu">' + motif(une.titre, teinte(une.categorie)) + '</div><div>' + metaDoc(une) + '<h2>' + esc(une.titre) + '</h2><p>' + esc(une.chapo) + '</p><span class="lire">Lire la publication →</span></div></a>';
      if (reste.length) h += '<div class="grille">' + reste.map((d) => '<a class="carte" href="/metis/' + esc(d.slug) + '"><div class="vignette">' + motif(d.titre, teinte(d.categorie)) + '</div><div class="dedans">' + metaDoc(d) + '<h3>' + esc(d.titre) + '</h3><p>' + esc(d.chapo) + '</p>'
        + (d.etiquettes && d.etiquettes.length ? '<span class="etq">' + d.etiquettes.slice(0, 4).map((t) => '#' + esc(t)).join(' ') + '</span>' : '<span class="lire">Lire →</span>') + '</div></a>').join('') + '</div>';
    }
    // Les sigles les plus employés : une porte d'entrée vers leurs fiches.
    if (!cat && !etq && sigles.length) {
      const u = M.usagesSigles(moi.id) || new Map();
      const top = sigles.map((g) => ({ g, u: u.get(g.sigle) || { documents: 0, occurrences: 0 } })).sort((a, b) => b.u.documents - a.u.documents || b.u.occurrences - a.u.occurrences).slice(0, 16);
      h += '<div class="titre-section"><h2>Les sigles les plus employés</h2><a href="/metis/glossaire">Tout le glossaire →</a></div><div class="mini-sigles">'
        + top.map(({ g, u: x }) => '<a href="' + lienSigle(g.sigle) + '" style="--c:' + teinte(g.categorie || 'Autres') + '"><b>' + esc(g.sigle) + '</b><span>' + esc(g.sens) + '</span><small>' + (x.documents ? 'dans ' + pluriel(x.documents, 'document') : 'défini au glossaire') + '</small></a>').join('') + '</div>';
    }
    envoyer(res, moi, cat ? cat + ' — Recherche Métis' : 'Recherche Métis', h, { actif: cat === require('../instance').architecture() ? 'architecture' : cat ? null : 'publications', categorie: cat, description: 'Publications de recherche Métis', fil: [['Recherche Métis', cat || etq ? '/metis' : null], ...(cat ? [[cat, null]] : etq ? [['#' + etq, null]] : [])] });
  });

  // Recherche globale : documents (titre, chapô, texte, étiquettes) et sigles.
  router.get('/recherche', (req, res) => {
    const moi = garde(req, res); if (!moi) return;
    const q = req.query.q ? String(req.query.q).slice(0, 80).trim() : '';
    const docs = q ? M.lister(moi.id, { recherche: q }) || [] : [];
    const sigles = q ? M.glossaire(moi.id, { recherche: q }) || [] : [];
    const exact = q && (M.glossaire(moi.id) || []).find((g) => g.sigle.toLowerCase() === q.toLowerCase());
    let h = '<section class="bandeau" style="grid-template-columns:1fr"><div><p class="sur">Recherche</p><h1>' + (q ? '« ' + esc(q) + ' »' : 'Chercher') + '</h1>'
      + '<form class="recherche-grande" method="get" action="/metis/recherche" role="search"><input name="q" value="' + esc(q) + '" placeholder="Un mot, un sigle, un titre" aria-label="Chercher" autofocus><button type="submit">Chercher</button></form>'
      + (q ? '<p class="intro">' + pluriel(docs.length, 'document') + ' et ' + pluriel(sigles.length, 'sigle') + '.</p>' : '') + '</div></section>';
    if (exact) h += '<a class="une" href="' + lienSigle(exact.sigle) + '" style="grid-template-columns:auto 1fr;--c:' + teinte(exact.categorie) + '"><div class="sigle-geant" style="margin:0;font-size:clamp(56px,6vw,96px)">' + esc(exact.sigle) + '</div><div><div class="meta"><span class="cat" style="color:' + teinte(exact.categorie) + '">' + esc(exact.categorie || 'Sigle') + '</span></div><h2 style="margin-top:6px">' + esc(exact.sens) + '</h2><p>' + esc(exact.detail) + '</p><span class="lire">Ouvrir la fiche du sigle →</span></div></a>';
    if (q) {
      h += '<div class="resultats"><section><h2>Documents</h2>' + (docs.length ? docs.map((d) => '<a class="resultat" href="/metis/' + esc(d.slug) + '">' + metaDoc(d) + '<b>' + esc(d.titre) + '</b><span>' + esc(d.chapo) + '</span></a>').join('') : '<p style="color:var(--texte2)">Aucun document.</p>') + '</section>'
        + '<section><h2>Sigles</h2>' + (sigles.length ? '<div class="fiches" style="grid-template-columns:1fr">' + sigles.slice(0, 40).map((g) => carteSigle(g)).join('') + '</div>' : '<p style="color:var(--texte2)">Aucun sigle.</p>') + '</section></div>';
    }
    envoyer(res, moi, (q ? q + ' — ' : '') + 'Recherche — Recherche Métis', h, { actif: 'recherche', fil: [['Recherche Métis', '/metis'], ['Recherche', null]] });
  });

  // Le seul script des pages, et il est facultatif : une figure en pleine largeur passe
  // PAR-DESSUS le sommaire et la fiche du document ; il les efface le temps qu'elle les
  // croise, au lieu de les laisser coupés à moitié. Sans lui, la figure les recouvre.
  router.get('/metis.js', (req, res) => {
    res.set('Cache-Control', 'public, max-age=3600').type('application/javascript').send(SCRIPT);
  });

  // Aperçu d'un graphique enregistré (lien rendu par l'outil creer_graphique).
  router.get('/graphique/:id([a-f0-9]{16}).svg', (req, res) => {
    const moi = garde(req, res); if (!moi) return;
    const spec = M.graphique(req.params.id);
    if (!spec) return pasTrouve(res, moi);
    res.type('image/svg+xml').send(svgSeul(require('../modules/graphiques'), spec, req.query.theme === 'sombre'));
  });

  // La galerie des types de graphiques : un exemple dessiné de chacun, avec sa spécification.
  // C'est le catalogue que l'outil MCP types_graphiques rend à ChatGPT, vu par un humain.
  router.get('/graphiques', (req, res) => {
    const moi = garde(req, res); if (!moi) return;
    const G = require('../modules/graphiques');
    const familles = [...new Set(G.CATALOGUE.map((c) => c.famille))];
    let h = '<section class="bandeau"><div><p class="sur">Catalogue</p><h1>Graphiques et schémas</h1><p class="intro">Les ' + G.CATALOGUE.length + ' types que le serveur sait dessiner, chacun avec un exemple et la spécification JSON qui le produit. Un bloc <code>```graphique</code> dans un document, ou l’outil <code>creer_graphique</code>, suffit.</p></div>'
      + '<div class="chiffres">' + familles.slice(0, 4).map((f) => '<a class="chiffre" href="#' + ancreDe(f) + '"><b>' + G.CATALOGUE.filter((c) => c.famille === f).length + '</b><span>' + esc(f) + '</span></a>').join('') + '</div></section>';
    h += '<div class="puces">' + familles.map((f) => '<a href="#' + ancreDe(f) + '">' + esc(f) + '</a>').join('') + '</div>';
    for (const f of familles) {
      h += '<h2 class="famille" id="' + ancreDe(f) + '">' + esc(f) + ' <small>' + G.CATALOGUE.filter((c) => c.famille === f).length + '</small></h2><div class="galerie">';
      for (const c of G.CATALOGUE.filter((x) => x.famille === f)) {
        const r = G.graphique(c.exemple, { id: 'ex-' + c.type });
        h += '<section class="exemple' + (c.type === 'planche' ? ' pleine' : '') + '" id="type-' + esc(c.type) + '"><h3><code>' + esc(c.type) + '</code></h3><p>' + esc(c.usage) + '</p>'
          + '<figure class="figure">' + (r.ok ? r.svg + G.glossaireHtml(r.spec) : '') + '</figure>'
          + '<details><summary>Spécification JSON</summary><pre class="code"><code>' + esc(JSON.stringify(c.exemple, null, 1)) + '</code></pre></details></section>';
      }
      h += '</div>';
    }
    envoyer(res, moi, 'Graphiques — Recherche Métis', h, { actif: 'graphiques', fil: [['Recherche Métis', '/metis'], ['Graphiques', null]] });
  });

  // Une fiche de sigle dans une grille (glossaire, recherche).
  function carteSigle(g, u) {
    const fam = g.categorie || 'Autres';
    return '<a class="fiche" id="sigle-' + esc(g.sigle) + '" href="' + lienSigle(g.sigle) + '" style="--c:' + teinte(fam) + '"><span class="s">' + esc(g.sigle) + (g.fiche ? '<i class="badge-page">Page</i>' : '') + '</span><span class="sens">' + esc(g.sens) + '</span>'
      + (g.detail ? '<span class="detail">' + esc(g.detail) + '</span>' : '<span class="detail"></span>')
      + '<span class="pied-fiche"><span>' + (g.nature ? esc(majuscule(g.nature)) + ' · ' : '') + esc(fam) + '</span>' + (u ? '<i>' + (u.documents ? pluriel(u.documents, 'document') : '—') + '</i>' : '') + '</span></a>';
  }

  // Le glossaire commun : chaque sigle employé dans les publications, sur sa fiche.
  router.get('/glossaire', (req, res) => {
    const moi = garde(req, res); if (!moi) return;
    const q = req.query.q ? String(req.query.q).slice(0, 60) : '';
    const alpha = req.query.vue === 'alpha';
    const nature = M.NATURES.includes(req.query.nature) ? req.query.nature : null;
    const l = M.glossaire(moi.id, { recherche: q, nature }) || [];
    const tous = q || nature ? M.glossaire(moi.id) || [] : l;
    const natures = M.NATURES.filter((n) => tous.some((g) => g.nature === n));
    const pages = tous.filter((g) => g.fiche).length;
    const u = M.usagesSigles(moi.id) || new Map();
    const cats = [...new Set(l.map((g) => g.categorie || 'Autres'))].sort((x, y) => x.localeCompare(y, 'fr'));
    const lettre = (s) => { const c = plat(s)[0] || '#'; return /[a-z]/.test(c) ? c.toUpperCase() : '#'; };
    const employes = tous.filter((g) => (u.get(g.sigle) || {}).documents).length;
    let h = '<section class="bandeau"><div><p class="sur">Glossaire</p><h1>' + (nature === 'protocole' ? 'Les protocoles de Métis' : nature ? esc(majuscule(nature)) + ' — sigles de Métis' : 'Les sigles de Métis') + '</h1><p class="intro">Chaque sigle et abréviation du système, développé et expliqué, avec sa propre page : ce qu’il désigne, les documents qui l’emploient, et les sigles voisins. Dans les publications, un sigle se survole pour sa définition et se clique pour sa fiche.</p></div>'
      + '<div><form class="recherche-grande" method="get" action="/metis/glossaire" role="search"><input name="q" value="' + esc(q) + '" placeholder="Chercher un sigle ou un mot" aria-label="Chercher dans le glossaire">' + (alpha ? '<input type="hidden" name="vue" value="alpha">' : '') + '<button type="submit">Chercher</button></form>'
      + '<div class="chiffres"><div class="chiffre"><b>' + tous.length + '</b><span>Sigles définis</span></div><div class="chiffre"><b>' + employes + '</b><span>Employés dans les documents</span></div>'
      + '<div class="chiffre"><b>' + pages + '</b><span>Pages rédigées</span><small>fonctionnement, schémas</small></div><div class="chiffre"><b>' + tous.filter((g) => g.nature === 'protocole').length + '</b><span>Protocoles</span></div></div></div></section>';
    // Filtrer par nature (protocole, composant…), quand au moins un terme en porte une.
    if (natures.length) h += '<div class="puces"><a href="/metis/glossaire' + (q ? '?q=' + encodeURIComponent(q) : '') + '"' + (!nature ? ' class="on"' : '') + '>Tous</a>' + natures.map((n) => '<a href="/metis/glossaire?nature=' + encodeURIComponent(n) + (q ? '&q=' + encodeURIComponent(q) : '') + '"' + (nature === n ? ' class="on"' : '') + '>' + esc(majuscule(n)) + ' <small style="color:var(--pale)">' + tous.filter((g) => g.nature === n).length + '</small></a>').join('') + '</div>';
    const lettres = new Set(l.map((g) => lettre(g.sigle)));
    const vue = (v) => '/metis/glossaire?' + (q ? 'q=' + encodeURIComponent(q) + '&' : '') + (nature ? 'nature=' + encodeURIComponent(nature) + '&' : '') + (v ? 'vue=alpha' : '');
    h += '<nav class="alphabet" aria-label="Index alphabétique">' + ['#', ...'ABCDEFGHIJKLMNOPQRSTUVWXYZ'].map((c) => (lettres.has(c) ? '<a href="' + (alpha ? '' : vue(true)) + '#lettre-' + (c === '#' ? 'chiffres' : c) + '">' + c + '</a>' : '<span>' + c + '</span>')).join('')
      + '<span class="vues" style="width:auto;height:auto;opacity:1"><a href="' + vue(false).replace(/[?&]$/, '') + '"' + (!alpha ? ' class="on"' : '') + '>Par famille</a><a href="' + vue(true) + '"' + (alpha ? ' class="on"' : '') + '>De A à Z</a></span></nav>';
    if (!l.length) h += '<div class="vide">Aucun sigle' + (q ? ' ne correspond à « ' + esc(q) + ' »' : ' pour l’instant') + '.</div>';
    if (alpha) {
      for (const c of ['#', ...'ABCDEFGHIJKLMNOPQRSTUVWXYZ'].filter((x) => lettres.has(x))) {
        const du = l.filter((g) => lettre(g.sigle) === c);
        h += '<h2 class="famille" id="lettre-' + (c === '#' ? 'chiffres' : c) + '">' + c + ' <small>' + du.length + '</small></h2><div class="fiches">' + du.map((g) => carteSigle(g, u.get(g.sigle))).join('') + '</div>';
      }
    } else {
      for (const c of cats) {
        const du = l.filter((g) => (g.categorie || 'Autres') === c);
        h += '<h2 class="famille" id="famille-' + ancreDe(c) + '"><span class="pastille" style="--c:' + teinte(c) + '"></span>' + esc(c) + ' <small>' + pluriel(du.length, 'sigle') + '</small></h2><div class="fiches">' + du.map((g) => carteSigle(g, u.get(g.sigle))).join('') + '</div>';
      }
    }
    envoyer(res, moi, (nature === 'protocole' ? 'Protocoles' : 'Glossaire') + ' — Recherche Métis', h, { actif: nature === 'protocole' ? 'protocoles' : 'glossaire', fil: [['Recherche Métis', '/metis'], ['Glossaire', nature ? '/metis/glossaire' : null], ...(nature ? [[majuscule(nature), null]] : [])] });
  });

  // La page d'un sigle : sa définition, où il est employé (passages et sections), les
  // sigles qu'il mentionne, ceux qui le citent, et sa famille.
  router.get('/glossaire/:sigle', (req, res) => {
    const moi = garde(req, res); if (!moi) return;
    const tous = M.glossaire(moi.id) || [];
    const demande = String(req.params.sigle || '').slice(0, 40);
    let g = tous.find((x) => x.sigle === demande);
    if (!g) {
      // Une casse différente mène à la bonne fiche, à son adresse canonique.
      const proche = tous.find((x) => x.sigle.toLowerCase() === demande.toLowerCase());
      if (proche) return res.redirect(301, lienSigle(proche.sigle));
      return pasTrouve(res, moi);
    }
    // La page détaillée (rédigée par ChatGPT avec rediger_fiche), éventuellement dans une
    // version antérieure : une version inconnue est une page qui n'existe pas.
    const f = M.lireFiche(moi.id, g.sigle, { version: req.query.version });
    if (!f || !f.ok) return pasTrouve(res, moi);
    const aPage = !!String(f.corps || '').trim();
    const fam = f.categorie || 'Autres';
    const c = teinte(fam);
    const table = new Map(tous.map((x) => [x.sigle, x]));
    const emplois = M.emploisSigle(moi.id, g.sigle) || [];
    const v = M.voisinsSigle(g.sigle) || { mentionne: [], citePar: [], famille: [] };
    const occurrences = emplois.reduce((a, e) => a + e.occurrences, 0);
    const nbFig = emplois.reduce((a, e) => a + e.figures.length, 0);
    const definition = f.detail ? M.annoterSigles('<p class="definition">' + esc(f.detail) + '</p>', table, { lien: lienSigle, sauf: g.sigle }).html : '<p class="definition" style="color:var(--texte2)">Pas encore d’explication au-delà de la forme développée.</p>';
    const page_ = aPage ? M.rendreCorps(f.corps, { figures: lienSigle(g.sigle), lien: lienSigle, sigles: false, sauf: g.sigle }) : null;

    let h = '<header class="tete-sigle" style="--c:' + c + '"><div><div class="puces-sigle"><a class="puce-famille" href="/metis/glossaire#famille-' + ancreDe(fam) + '"><span class="pastille"></span>' + esc(fam) + '</a>'
      + (f.nature ? '<a class="puce-famille puce-nature" href="/metis/glossaire?nature=' + encodeURIComponent(f.nature) + '">' + esc(majuscule(f.nature)) + '</a>' : '')
      + (aPage ? '<span class="puce-page">Page rédigée · v' + f.version + '</span>' : '') + '</div>'
      + '<h1 class="sigle-geant">' + esc(g.sigle) + '</h1><p class="sens">' + esc(f.sens) + '</p></div>'
      + '<div class="chiffres"><div class="chiffre"><b>' + emplois.length + '</b><span>' + (emplois.length > 1 ? 'Documents qui l’emploient' : 'Document qui l’emploie') + '</span></div>'
      + '<div class="chiffre"><b>' + occurrences + '</b><span>Occurrence' + (occurrences > 1 ? 's' : '') + '</span>' + (nbFig ? '<small>dont ' + pluriel(nbFig, 'figure') + '</small>' : '') + '</div>'
      + '<div class="chiffre"><b>' + v.citePar.length + '</b><span>Cité par d’autres sigles</span></div>'
      + '<div class="chiffre"><b>' + (v.famille.length + 1) + '</b><span>Sigles dans la famille</span></div></div></header>';

    // Où il est employé : les documents, leurs passages et un lien vers leur section.
    let emploisHtml = '<h2 id="sigle-emplois">' + (emplois.length ? 'Employé dans ' + pluriel(emplois.length, 'document') : 'Où il est employé') + '</h2>';
    if (!emplois.length) emploisHtml += '<p style="color:var(--texte2)">Aucune publication ne l’emploie encore' + (v.citePar.length ? ' : il sert à expliquer d’autres sigles.' : '.') + '</p>';
    for (const e of emplois) {
      emploisHtml += '<article class="emploi"><header>' + metaDoc(e) + '<span class="compte">' + pluriel(e.occurrences, 'occurrence') + '</span></header><h3><a href="/metis/' + esc(e.slug) + '">' + esc(e.titre) + '</a></h3>';
      if (e.passages.length) emploisHtml += '<ul class="passages">' + e.passages.map((p) => '<li>' + (p.section ? '<a class="ou" href="/metis/' + esc(e.slug) + '#' + esc(p.section.ancre) + '">§ ' + esc(p.section.titre) + '</a><br>' : '<a class="ou" href="/metis/' + esc(e.slug) + '">En-tête</a><br>') + surligner(p.texte) + '</li>').join('') + '</ul>';
      if (e.figures.length) emploisHtml += '<div class="dans-figures">Aussi dans ' + (e.figures.length > 1 ? 'les figures ' : 'la figure ') + e.figures.map((n) => '<a href="/metis/' + esc(e.slug) + '/figure/' + n + '.svg">n° ' + n + '</a>').join(', ') + '.</div>';
      emploisHtml += '</article>';
    }
    const liste = (titre, l) => (l.length ? '<section class="bloc"><span class="titre-bloc">' + titre + '</span><ul class="liste-sigles">' + l.map((s) => { const x = table.get(s); return '<li><a href="' + lienSigle(s) + '"><b>' + esc(s) + '</b><span>' + esc(x ? x.sens : '') + '</span></a></li>'; }).join('') + '</ul></section>' : '');
    const mots = aPage ? String(f.corps).replace(/```[\s\S]*?```/g, ' ').split(/\s+/).filter(Boolean).length : 0;
    const nbFigPage = aPage ? M.graphiquesDuCorps(f.corps).filter((x) => x.spec).length : 0;
    const infos = '<section class="bloc"><dl class="infos"><dt>Sigle</dt><dd>' + esc(g.sigle) + '</dd>' + (f.nature ? '<dt>Nature</dt><dd>' + esc(majuscule(f.nature)) + '</dd>' : '') + '<dt>Famille</dt><dd style="color:' + c + '">' + esc(fam) + '</dd>'
      + (aPage ? '<dt>Version</dt><dd>v' + f.version + '</dd><dt>Lecture</dt><dd>' + Math.max(1, Math.round(mots / 230)) + ' min</dd>' + (nbFigPage ? '<dt>Figures</dt><dd>' + nbFigPage + '</dd>' : '') : '')
      + (f.majLe ? '<dt>Mis à jour</dt><dd>' + esc(date(f.majLe)) + '</dd>' : '') + (f.auteur ? '<dt>Par</dt><dd>' + esc(f.auteur) + '</dd>' : '') + '</dl></section>';
    const voisins = liste('Sa définition mentionne', v.mentionne) + liste('Cité dans la définition de', v.citePar) + liste('Même famille · ' + esc(fam), v.famille);

    if (aPage) {
      // Une page rédigée se lit comme un article : sommaire, texte, colonne.
      const som = [{ niveau: 2, texte: 'Définition', ancre: 'sigle-definition' }, ...page_.sommaire.filter((x) => x.niveau <= 3), { niveau: 2, texte: 'Où il est employé', ancre: 'sigle-emplois' }];
      h += '<div class="lecture" style="--c:' + c + '"><nav class="sommaire" aria-label="Sommaire"><b>Sommaire</b>' + som.map((x) => '<a class="n' + x.niveau + '" href="#' + esc(x.ancre) + '">' + esc(x.texte) + '</a>').join('') + '</nav>'
        + '<div class="texte fiche-texte">'
        + (f.ancienne ? '<div class="avis">Version ' + f.version + ' de cette page, antérieure à la version en ligne. <a href="' + lienSigle(g.sigle) + '">Lire la version actuelle</a></div>' : '')
        + '<h2 id="sigle-definition">Définition</h2>' + definition
        + '<div class="corps">' + page_.html + '</div>' + emploisHtml
        + (f.versions.length > 1 ? '<div class="versions">Versions de cette page : ' + f.versions.map((x) => '<a href="' + lienSigle(g.sigle) + '?version=' + x.version + '">v' + x.version + '</a> (' + esc(date(x.le)) + ')').join(' · ') + '</div>' : '')
        + '</div><aside class="rail">' + infos + voisins + '</aside></div>';
    } else {
      h += '<div class="corps-sigle" style="--c:' + c + '"><div><h2 id="sigle-definition">Définition</h2>' + definition
        + (M.peutEcrire(moi.id) ? '<p class="a-rediger">Pas encore de page détaillée pour ce terme. ChatGPT peut l’écrire par le connecteur MCP, avec l’outil <code>rediger_fiche</code> : fonctionnement, étapes, schémas et graphiques.</p>' : '')
        + emploisHtml + '</div><aside class="cote-sigle">' + voisins + infos + '</aside></div>';
    }
    const i = tous.indexOf(g), prec = tous[i - 1], suiv = tous[i + 1];
    h += '<nav class="precsuiv" aria-label="Sigles voisins">' + (prec ? '<a href="' + lienSigle(prec.sigle) + '"><small>← Précédent</small><b>' + esc(prec.sigle) + '</b></a>' : '<span></span>')
      + '<a class="centre" href="/metis/glossaire">Tout le glossaire</a>' + (suiv ? '<a class="suiv" href="' + lienSigle(suiv.sigle) + '"><small>Suivant →</small><b>' + esc(suiv.sigle) + '</b></a>' : '<span></span>') + '</nav>';
    envoyer(res, moi, g.sigle + ' — ' + f.sens + ' — Recherche Métis', h, { actif: 'glossaire', famille: fam, description: g.sigle + ' : ' + f.sens, fil: [['Recherche Métis', '/metis'], ['Glossaire', '/metis/glossaire'], [fam, '/metis/glossaire#famille-' + ancreDe(fam)], [g.sigle, null]] });
  });

  // Une figure de la page d'un sigle, seule et en grand.
  router.get('/glossaire/:sigle/figure/:n(\\d{1,3}).svg', (req, res) => {
    const moi = garde(req, res); if (!moi) return;
    const f = M.lireFiche(moi.id, String(req.params.sigle || ''), { version: req.query.version });
    if (!f || !f.ok) return pasTrouve(res, moi);
    const g = M.graphiquesDuCorps(f.corps).find((x) => x.n === Number(req.params.n));
    if (!g || !g.spec) return pasTrouve(res, moi);
    res.type('image/svg+xml').send(svgSeul(require('../modules/graphiques'), g.spec, req.query.theme === 'sombre'));
  });

  // Une figure d'un document, seule et en grand (une planche se lit mieux à pleine largeur).
  router.get('/:slug([a-z0-9][a-z0-9-]{1,79})/figure/:n(\\d{1,3}).svg', (req, res) => {
    const moi = garde(req, res); if (!moi) return;
    const d = M.lire(moi.id, req.params.slug, { version: req.query.version });
    if (!d) return pasTrouve(res, moi);
    const g = M.graphiquesDuCorps(d.corps).find((x) => x.n === Number(req.params.n));
    if (!g || !g.spec) return pasTrouve(res, moi);
    res.type('image/svg+xml').send(svgSeul(require('../modules/graphiques'), g.spec, req.query.theme === 'sombre'));
  });

  // Le registre des experts : monté AVANT /:slug, qui capterait sinon /metis/experts.
  require('./metis-experts-pages').monter(router, { garde, envoyer, pasTrouve, teinte, lienSigle, PALETTE });

  router.get('/acces', (req, res) => {
    const moi = garde(req, res); if (!moi) return;
    if (!M.estMaster(moi.id)) return pasTrouve(res, moi);
    const avis = req.query.ok ? '<div class="avis">' + esc(req.query.ok) + '</div>' : req.query.err ? '<div class="avis" style="border-color:var(--acc)">' + esc(req.query.err) + '</div>' : '';
    const l = M.lecteurs();
    const LIB = { lecteur: 'Lecteur', editeur: 'Éditeur' };
    const h = '<article class="etroit"><header><div class="meta"><span class="cat">Réglages</span></div><h1>Qui a accès</h1><p class="chapo">Le compte Master lit, modifie et gère les accès. Un <b>lecteur</b> lit les publications, le glossaire et le registre des experts ; un <b>éditeur</b> peut aussi publier, modifier, définir des sigles et tenir le registre des experts. Les deux peuvent brancher ChatGPT ou Claude avec leur propre compte Atlas.</p></header>'
      + avis + '<form class="acces" method="post" action="/metis/acces"><input name="pseudo" placeholder="Pseudo Atlas" maxlength="40" required aria-label="Pseudo Atlas">'
      + '<select name="role" aria-label="Rôle"><option value="lecteur">Lecteur — lit seulement</option><option value="editeur">Éditeur — lit et modifie</option></select><button type="submit">Donner l’accès</button></form>'
      + (l.length ? '<ul class="liste-acces">' + l.map((x) => {
        const autre = x.role === 'editeur' ? 'lecteur' : 'editeur';
        return '<li><span><b>' + esc(x.pseudo) + '</b> <span class="statut">' + LIB[x.role] + '</span><br><small style="color:var(--pale)">depuis le ' + esc(date(x.le)) + '</small></span>'
          + '<form method="post" action="/metis/acces/role"><input type="hidden" name="id" value="' + Number(x.id) + '"><input type="hidden" name="role" value="' + autre + '"><button class="discret" type="submit">' + (autre === 'editeur' ? 'Autoriser à modifier' : 'Lecture seule') + '</button></form>'
          + '<form method="post" action="/metis/acces/retirer"><input type="hidden" name="id" value="' + Number(x.id) + '"><button class="discret" type="submit">Retirer</button></form></li>';
      }).join('') + '</ul>' : '<p style="color:var(--texte2)">Personne d’autre que Master pour l’instant.</p>')
      + '<p style="color:var(--texte2);font-size:15px;margin-top:26px">Pour brancher ChatGPT : la procédure est sur <a href="https://docu.plagnito.com/metis-mcp">docu.plagnito.com/metis-mcp</a>. Retirer un accès ou repasser en lecture seule s’applique aussitôt, connecteurs compris.</p>'
      + '</article>';
    envoyer(res, moi, 'Accès — Recherche Métis', h, { actif: 'acces', fil: [['Recherche Métis', '/metis'], ['Accès', null]] });
  });
  // Formulaires HTML (sans JavaScript) : même origine exigée — un formulaire d'un
  // autre site ne déclenche pas de pré-vol CORS, c'est donc ICI qu'on le refuse.
  const formulaire = express.urlencoded({ extended: false, limit: '4kb' });
  const origineSure = (req) => {
    const o = req.headers.origin || req.headers.referer || '';
    if (!o) return false;
    try { const h = new URL(o).hostname; return h === 'plagnito.com' || h.endsWith('.plagnito.com') || h === 'localhost' || h === '127.0.0.1'; } catch { return false; }
  };
  router.post('/acces', formulaire, (req, res) => {
    const moi = garde(req, res); if (!moi) return;
    if (!M.estMaster(moi.id) || !origineSure(req)) return pasTrouve(res, moi);
    const r = M.accorder(moi.id, String((req.body && req.body.pseudo) || ''), req.body && req.body.role === 'editeur' ? 'editeur' : 'lecteur');
    res.redirect('/metis/acces?' + (r.ok ? 'ok=' + encodeURIComponent(r.compte.pseudo + (r.role === 'editeur' ? ' peut maintenant lire et modifier.' : ' peut maintenant lire les publications.')) : 'err=' + encodeURIComponent(r.error)));
  });
  router.post('/acces/role', formulaire, (req, res) => {
    const moi = garde(req, res); if (!moi) return;
    if (!M.estMaster(moi.id) || !origineSure(req)) return pasTrouve(res, moi);
    const r = M.changerRole(moi.id, Number(req.body && req.body.id), String((req.body && req.body.role) || ''));
    res.redirect('/metis/acces?' + (r.ok ? 'ok=' + encodeURIComponent(r.role === 'editeur' ? 'Ce compte peut maintenant modifier.' : 'Ce compte est repassé en lecture seule.') : 'err=' + encodeURIComponent(r.error)));
  });
  router.post('/acces/retirer', formulaire, (req, res) => {
    const moi = garde(req, res); if (!moi) return;
    if (!M.estMaster(moi.id) || !origineSure(req)) return pasTrouve(res, moi);
    M.retirer(moi.id, Number(req.body && req.body.id));
    res.redirect('/metis/acces?ok=' + encodeURIComponent('Accès retiré.'));
  });

  router.get('/:slug([a-z0-9][a-z0-9-]{1,79})', (req, res) => {
    const moi = garde(req, res); if (!moi) return;
    const d = M.lire(moi.id, req.params.slug, { version: req.query.version });
    if (!d) return pasTrouve(res, moi);
    const r = M.rendreCorps(d.corps, { slug: d.slug, lien: lienSigle, sigles: false });
    const sommaire = r.sommaire.filter((s) => s.niveau <= 3);
    const c = teinte(d.categorie);
    let h = '<header class="tete-article"><div>' + metaDoc(d).replace('</div>', '<span>· ' + esc(d.auteur) + '</span></div>')
      + '<h1>' + esc(d.titre) + '</h1>' + (d.chapo ? '<p class="chapo">' + esc(d.chapo) + '</p>' : '')
      + (d.etiquettes && d.etiquettes.length ? '<div class="puces etiquettes" style="margin:0">' + d.etiquettes.map((t) => '<a href="/metis?etiquette=' + encodeURIComponent(t) + '">#' + esc(t) + '</a>').join('') + '</div>' : '') + '</div>'
      + '<div class="illu">' + motif(d.titre, c) + '</div></header>';
    if (d.ancienne) h += '<div class="avis">Version ' + d.version + ', antérieure à la version en ligne. <a href="/metis/' + esc(d.slug) + '">Lire la version actuelle</a></div>';

    h += '<div class="lecture">';
    h += sommaire.length ? '<nav class="sommaire" aria-label="Sommaire"><b>Sommaire</b>' + sommaire.map((s) => '<a class="n' + s.niveau + '" href="#' + esc(s.ancre) + '">' + esc(s.texte) + '</a>').join('') + '</nav>' : '<div class="sommaire" aria-hidden="true"></div>';

    h += '<div class="texte"><div class="corps">' + r.html + '</div>';
    const ns = M.notes(moi.id, d.slug) || [];
    if (ns.length) h += '<aside class="notes" id="notes"><h2>Notes de relecture</h2>' + ns.map((n) => '<div class="note"><div class="meta"><span class="cat">' + esc(n.auteur) + '</span><span>' + esc(date(n.le)) + '</span>' + (n.section ? '<span>· ' + esc(n.section) + '</span>' : '') + '<span>· n° ' + n.id + '</span></div><p>' + esc(n.texte) + '</p></div>').join('') + '</aside>';
    if (d.versions && d.versions.length > 1) h += '<div class="versions">Versions : ' + d.versions.map((v) => '<a href="/metis/' + esc(d.slug) + '?version=' + v.version + '">v' + v.version + '</a> (' + esc(date(v.le)) + ')').join(' · ') + '</div>';
    // Précédent / suivant dans la même catégorie (les plans se lisent dans l'ordre).
    const meme = (M.lister(moi.id, { categorie: d.categorie }) || []).sort((a, b) => a.slug.localeCompare(b.slug));
    const k = meme.findIndex((x) => x.slug === d.slug);
    if (k > -1 && meme.length > 1) {
      const p = meme[k - 1], s = meme[k + 1];
      h += '<nav class="suite-docs" aria-label="Dans la même catégorie">' + (p ? '<a href="/metis/' + esc(p.slug) + '"><small>← Précédent</small><b>' + esc(p.titre) + '</b></a>' : '')
        + (s ? '<a class="suiv" href="/metis/' + esc(s.slug) + '"><small>Suivant →</small><b>' + esc(s.titre) + '</b></a>' : '') + '</nav>';
    }
    h += '</div>';

    // La fiche du document : repères, sigles employés (chacun vers sa page).
    const mots = String(d.corps).replace(/```[\s\S]*?```/g, ' ').split(/\s+/).filter(Boolean).length;
    const nbFig = M.graphiquesDuCorps(d.corps).filter((x) => x.spec).length;
    const table = new Map((M.glossaire(moi.id) || []).map((x) => [x.sigle, x]));
    const sigles = r.sigles.filter((s) => table.has(s)).sort((x, y) => x.localeCompare(y, 'fr', { sensitivity: 'base' }));
    h += '<aside class="rail"><section class="bloc"><dl class="infos"><dt>Catégorie</dt><dd style="color:' + c + '">' + esc(d.categorie) + '</dd><dt>Version</dt><dd>v' + d.version + '</dd><dt>Mis à jour</dt><dd>' + esc(date(d.majLe)) + '</dd><dt>Auteur</dt><dd>' + esc(d.auteur) + '</dd>'
      + '<dt>Lecture</dt><dd>' + Math.max(1, Math.round(mots / 230)) + ' min</dd>' + (nbFig ? '<dt>Figures</dt><dd>' + nbFig + '</dd>' : '') + (ns.length ? '<dt>Notes</dt><dd><a href="#notes">' + ns.length + '</a></dd>' : '') + '</dl></section>';
    if (sigles.length) h += '<section class="sigles bloc"><h2 id="sigles-employes">Sigles employés · ' + sigles.length + '</h2><dl>' + sigles.map((s) => '<div><dt><a href="' + lienSigle(s) + '">' + esc(s) + '</a></dt><dd>' + esc(table.get(s).sens) + '</dd></div>').join('') + '</dl></section>';
    h += '</aside></div>';
    envoyer(res, moi, d.titre + ' — Recherche Métis', h, { actif: d.categorie === require('../instance').architecture() ? 'architecture' : 'publications', categorie: d.categorie, description: d.chapo, fil: [['Recherche Métis', '/metis'], [d.categorie, '/metis?categorie=' + encodeURIComponent(d.categorie)], [d.titre, null]] });
  });
  return router;
}

module.exports = { metisPages, CSS, page, svgSeul };


};
