// Adapted from Plagni/atlas 227e897b68fbbaf2d6436084526519bf28ededf8. AGPL-3.0-only.
module.exports = function nativeModule(require, module, __dirname) {
'use strict';

// =============================================================================
//  /metis/experts — le registre des experts de l'architecture Métis, à l'écran
// -----------------------------------------------------------------------------
//  Demandé le 26/09/2026 : une page à part qui montre TOUS les experts, leurs
//  caractéristiques techniques et leurs capacités, et une vue détaillée par expert.
//  Même coquille que les publications (barre latérale, fil d'Ariane), même rendu
//  CÔTÉ SERVEUR : tout se lit sans JavaScript, graphiques compris.
//
//    /metis/experts                     index — vues : pools, technique, compétences, architecture
//    /metis/experts/<id>                la fiche complète d'un expert (?revision=n : une révision)
//    /metis/experts/pool/<id>           un pool (le principal : ses ressources partagées)
//    /metis/experts/competence/<id>     une compétence : qui la porte, classé comme pour le routage
//
//  Les données viennent de modules/metisexperts.js (le même que le MCP) : ce qu'on
//  voit ici est exactement ce que ChatGPT lit et écrit.
// =============================================================================

const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const date = (iso) => { const d = new Date(iso); return isNaN(d) ? '' : d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' }); };
const dateCourte = (iso) => { const d = new Date(iso); return isNaN(d) ? '' : d.toLocaleDateString('fr-FR'); };
const pluriel = (n, un, plusieurs) => n + ' ' + (n > 1 ? plusieurs || un + 's' : un);
const nf = (n, dec = 0) => Number(n).toLocaleString('fr-FR', { maximumFractionDigits: dec });
const mo = (v) => (v == null ? null : v >= 1024 ? nf(v / 1024, 1) + ' Go' : nf(v) + ' Mo');
const ms = (v) => (v == null ? null : v >= 1000 ? nf(v / 1000, 2) + ' s' : nf(v) + ' ms');

const CSS = `
/* ── Registre des experts ─────────────────────────────────────────────────── */
.vues{display:flex;gap:6px;flex-wrap:wrap;align-items:center;margin:0 0 18px}
.vues a{display:inline-flex;align-items:center;gap:8px;padding:8px 14px;border-radius:11px;border:1px solid var(--ligne);text-decoration:none;font-size:14.5px;color:var(--texte2);background:var(--carte)}
.vues a:hover{border-color:var(--pale);color:var(--texte)}
.vues a.on{background:var(--texte);color:var(--fond);border-color:var(--texte);font-weight:600}
.vues form{margin-left:auto;display:flex;gap:6px}
.vues input{font:inherit;font-size:14.5px;padding:8px 12px;border-radius:11px;border:1px solid var(--ligne);background:var(--carte);color:var(--texte);min-width:200px}
.b-statut{display:inline-flex;align-items:center;gap:6px;font-size:12px;font-weight:600;border-radius:999px;padding:2px 9px;border:1px solid var(--ligne);white-space:nowrap;color:var(--texte2);background:var(--carte)}
.b-statut::before{content:'';width:7px;height:7px;border-radius:50%;background:var(--pale)}
.b-statut.stable{color:#5f7347;border-color:rgba(120,140,93,.45)}.b-statut.stable::before{background:#788c5d}
.b-statut.experimental{color:#9c7a26;border-color:rgba(194,152,58,.5)}.b-statut.experimental::before{background:#c2983a}
.b-statut.deprecie{color:var(--pale);text-decoration:line-through}.b-statut.deprecie::before{background:var(--pale)}
.b-neutre{font-size:12px;border:1px solid var(--ligne);border-radius:6px;padding:1px 7px;color:var(--texte2);white-space:nowrap}
.socle{position:relative;background:var(--carte);border:1px dashed color-mix(in srgb,var(--texte2) 45%,transparent);border-radius:22px;padding:22px 26px;margin:0 0 34px;overflow:hidden}
.socle::before{content:'';position:absolute;inset:0;background:radial-gradient(circle at 0 0,color-mix(in srgb,var(--acc) 10%,transparent),transparent 45%);pointer-events:none}
.socle>*{position:relative}
.socle header{display:flex;align-items:baseline;gap:14px;flex-wrap:wrap;margin-bottom:6px}
.socle h2{font-family:var(--serif);font-weight:500;font-size:28px;margin:0;letter-spacing:-.01em}
.socle h2 a{text-decoration:none}.socle h2 a:hover{text-decoration:underline;text-underline-offset:4px}
.socle p{color:var(--texte2);margin:0 0 16px;max-width:1000px}
.ressources{display:grid;grid-template-columns:repeat(auto-fill,minmax(250px,1fr));gap:10px}
.ressource{border:1px solid var(--ligne);border-radius:13px;padding:10px 13px;background:var(--fond);font-size:14px;line-height:1.4}
.ressource b{display:flex;align-items:center;gap:8px;font-size:15px}.ressource span{color:var(--texte2);display:block;margin-top:3px}
.ressource i{font-style:normal;margin-left:auto;font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:.05em;color:var(--pale)}
.ressource i.en_service{color:#5f7347}
/* Une bulle de sigle centrée sur un mot de la dernière carte sortait de l'écran (+19 px de défilement horizontal) : ancrée à droite. */
.ressource a.sigle .bulle{left:auto;right:-8px;transform:translate(0,4px)}
.ressource a.sigle:hover .bulle,.ressource a.sigle:focus-visible .bulle{transform:translate(0,0)}
.ressource a.sigle .bulle::after{left:auto;right:14px}
.type-res{font-size:11px;text-transform:uppercase;letter-spacing:.06em;color:var(--pale);font-weight:600}
.pool-tete{display:flex;align-items:baseline;gap:12px;flex-wrap:wrap;margin:40px 0 4px}
.pool-tete h2{font-family:var(--serif);font-weight:500;font-size:30px;margin:0;display:flex;align-items:center;gap:12px;letter-spacing:-.01em}
.pool-tete h2 a{text-decoration:none}.pool-tete h2 a:hover{text-decoration:underline;text-underline-offset:4px}
.pool-tete h2 .pastille{width:12px;height:12px;border-radius:4px}
.pool-tete small{font-size:13px;color:var(--pale)}
.pool-role{color:var(--texte2);margin:0 0 16px;font-size:15.5px}
.experts{display:grid;grid-template-columns:repeat(auto-fill,minmax(360px,1fr));gap:16px}
.xp{display:flex;flex-direction:column;gap:12px;background:var(--carte);border:1px solid var(--ligne);border-radius:18px;padding:18px 20px;text-decoration:none;position:relative;transition:transform .15s,border-color .15s,box-shadow .15s}
.xp:hover{transform:translateY(-2px);border-color:var(--pale);box-shadow:var(--ombre)}
.xp.deprecie{opacity:.72}
.xp .haut{display:flex;gap:12px;align-items:flex-start}
.ico{flex-shrink:0;width:42px;height:42px;border-radius:12px;display:grid;place-items:center;background:color-mix(in srgb,var(--c) 16%,transparent);color:var(--c)}
.ico svg{width:22px;height:22px}
.xp h3{font-family:var(--serif);font-weight:500;font-size:21px;line-height:1.2;margin:0}
.xp code.id{font-size:12px;color:var(--pale)}
.xp .badges{display:flex;gap:6px;flex-wrap:wrap;margin-top:6px}
.xp p{margin:0;color:var(--texte2);font-size:14.5px;line-height:1.45;display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden}
.tech{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:1px;background:var(--ligne);border:1px solid var(--ligne);border-radius:12px;overflow:hidden;margin:0}
.tech div{background:var(--carte);padding:7px 10px;min-width:0}
.tech dt{font-size:10.5px;text-transform:uppercase;letter-spacing:.06em;color:var(--pale);font-weight:600}
.tech dd{margin:1px 0 0;font-size:13.5px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.tech dd.inconnu{color:var(--pale);font-weight:400}
.comps{display:flex;flex-direction:column;gap:7px}
.comp{display:grid;grid-template-columns:minmax(0,1fr) 110px;gap:10px;align-items:center;font-size:13.5px}
.comp .nom{white-space:nowrap;overflow:hidden;text-overflow:ellipsis;color:var(--texte)}
.comp .nom small{color:var(--pale);margin-left:4px}
.jauge-niv{position:relative;height:8px;border-radius:99px;background:var(--survol);overflow:hidden}
.jauge-niv .d{position:absolute;inset:0 auto 0 0;border-radius:99px;background:repeating-linear-gradient(135deg,color-mix(in srgb,var(--c) 45%,transparent) 0 3px,transparent 3px 6px);border:1px solid color-mix(in srgb,var(--c) 55%,transparent)}
.jauge-niv .m{position:absolute;inset:1px auto 1px 0;border-radius:99px;background:var(--c)}
.xp .pied-xp{display:flex;gap:10px;font-size:12.5px;color:var(--pale);margin-top:auto;padding-top:4px;border-top:1px solid var(--ligne)}
.xp .pied-xp span:last-child{margin-left:auto}
.pool-vide{border:1px dashed var(--ligne);border-radius:16px;padding:18px 20px;color:var(--texte2);font-size:14.5px}
.legende-niv{display:flex;gap:18px;flex-wrap:wrap;align-items:center;font-size:13px;color:var(--texte2);margin:0 0 22px}
.legende-niv span{display:inline-flex;align-items:center;gap:7px}
.legende-niv .jauge-niv{width:46px;--c:var(--acc)}
.table-tech{overflow-x:auto;border:1px solid var(--ligne);border-radius:16px;background:var(--carte)}
.table-tech table{border-collapse:separate;border-spacing:0;width:100%;font-size:14px;min-width:1500px}
.table-tech th,.table-tech td{padding:10px 12px;border-bottom:1px solid var(--ligne);text-align:left;vertical-align:top;white-space:nowrap}
.table-tech th{font-size:11.5px;text-transform:uppercase;letter-spacing:.05em;color:var(--texte2);font-weight:600;position:sticky;top:0;background:var(--carte);z-index:1}
.table-tech tr:last-child td{border-bottom:0}
.table-tech td:first-child,.table-tech th:first-child{position:sticky;left:0;background:var(--carte);z-index:2;border-right:1px solid var(--ligne)}
.table-tech td:first-child a{font-weight:600;text-decoration:none}.table-tech td:first-child a:hover{text-decoration:underline}
.table-tech td.num{text-align:right;font-variant-numeric:tabular-nums}
.table-tech .inconnu{color:var(--pale)}
.table-tech tr.deprecie td{color:var(--pale)}
.matrice td.cel{text-align:center;min-width:92px}
.niv{display:inline-flex;align-items:center;justify-content:center;min-width:38px;height:26px;border-radius:7px;font-size:13px;font-weight:700;font-variant-numeric:tabular-nums}
.niv.m{background:color-mix(in srgb,var(--acc) calc(var(--n) * 1%),var(--survol));color:var(--texte)}
.niv.d{border:1.5px dashed color-mix(in srgb,var(--acc) 60%,transparent);color:var(--texte2);font-weight:600}
.niv.x{color:var(--pale);font-weight:500}
.matrice th.dom{font-family:var(--serif);font-size:17px;text-transform:none;letter-spacing:0;color:var(--texte);padding-top:18px;background:var(--fond)}
.matrice th.col a{text-decoration:none;color:var(--texte)}
.tete-expert{position:relative;display:grid;grid-template-columns:minmax(0,1fr) minmax(300px,460px);gap:clamp(24px,4vw,70px);align-items:end;padding:30px clamp(22px,3vw,48px) 32px;border-radius:26px;background:var(--carte);border:1px solid var(--ligne);overflow:hidden;margin-bottom:34px;box-shadow:var(--ombre)}
.tete-expert::before{content:'';position:absolute;inset:0;background:radial-gradient(circle at 10% 0%,color-mix(in srgb,var(--c) 20%,transparent),transparent 55%),radial-gradient(circle at 100% 100%,color-mix(in srgb,var(--c) 12%,transparent),transparent 50%);pointer-events:none}
.tete-expert>*{position:relative}
.tete-expert .ico{width:64px;height:64px;border-radius:18px}.tete-expert .ico svg{width:34px;height:34px}
.tete-expert h1{font-family:var(--serif);font-weight:500;font-size:clamp(38px,4.4vw,70px);line-height:1.03;letter-spacing:-.025em;margin:18px 0 10px}
.tete-expert .role{font-family:var(--serif);font-size:clamp(19px,1.6vw,24px);line-height:1.4;color:var(--texte2);margin:0;max-width:900px}
.tete-expert .ident{font-size:14px;color:var(--pale);margin:0 0 8px}
.tete-expert .puces-sigle{margin-top:4px}
.tombe{border:1px solid var(--ligne);border-left:4px solid var(--pale);background:var(--carte);border-radius:0 14px 14px 0;padding:14px 18px;margin:0 0 26px;font-size:15.5px}
.tombe b{display:block;font-size:12px;text-transform:uppercase;letter-spacing:.07em;color:var(--pale);margin-bottom:4px}
.fiche-x h2{font-family:var(--serif);font-weight:500;font-size:30px;line-height:1.2;margin:48px 0 14px;letter-spacing:-.015em}
.fiche-x>h2:first-child,.fiche-x>.tombe+h2,.fiche-x>.avis+h2{margin-top:0}
.fiche-x p{margin:0 0 16px}
.dl-x{display:grid;grid-template-columns:repeat(auto-fill,minmax(210px,1fr));gap:0;background:var(--carte);border:1px solid var(--ligne);border-radius:14px;overflow:hidden;margin:0 0 18px}
.dl-x div{padding:11px 14px;box-shadow:inset -1px -1px 0 var(--ligne)}
.dl-x dt{font-size:11px;text-transform:uppercase;letter-spacing:.06em;color:var(--pale);font-weight:600}
.dl-x dd{margin:3px 0 0;font-size:15.5px;font-weight:600}
.dl-x dd small{display:block;font-weight:400;color:var(--texte2);font-size:13px;margin-top:2px}
.dl-x dd.inconnu{color:var(--pale);font-weight:400}
.puces-x{display:flex;gap:7px;flex-wrap:wrap;margin:0 0 16px;padding:0;list-style:none}
.puces-x li{border:1px solid var(--ligne);background:var(--carte);border-radius:999px;padding:4px 12px;font-size:14px}
.deux{display:grid;grid-template-columns:1fr 1fr;gap:18px}
.deux h3{font-size:13px;text-transform:uppercase;letter-spacing:.06em;color:var(--pale);margin:0 0 8px}
.echelle{display:flex;gap:4px;margin:0 0 18px;flex-wrap:wrap}
.echelle span{flex:1;min-width:110px;text-align:center;padding:9px 6px;border-radius:10px;border:1px solid var(--ligne);font-size:13px;color:var(--pale);background:var(--carte)}
.echelle span.on{background:var(--c);border-color:var(--c);color:#fff;font-weight:700}
.table-x{overflow-x:auto;border:1px solid var(--ligne);border-radius:14px;background:var(--carte);margin:0 0 18px}
.table-x table{border-collapse:collapse;width:100%;font-size:14.5px}
.table-x th,.table-x td{padding:10px 13px;border-bottom:1px solid var(--ligne);text-align:left;vertical-align:top}
.table-x th{font-size:11.5px;text-transform:uppercase;letter-spacing:.05em;color:var(--texte2);font-weight:600}
.table-x tr:last-child td{border-bottom:0}
.table-x td .jauge-niv{width:120px;display:inline-block;vertical-align:middle;margin-right:8px}
.table-x a{color:var(--acc2)}
.table-x small.sous{display:block;color:var(--texte2);font-size:13px;line-height:1.4;margin-top:3px}
.comps-x td.n{white-space:nowrap}
.chrono{list-style:none;padding:0;margin:0 0 18px;border-left:2px solid var(--ligne)}
.chrono li{position:relative;padding:0 0 14px 20px}
.chrono li::before{content:'';position:absolute;left:-6px;top:6px;width:10px;height:10px;border-radius:50%;background:var(--c);border:2px solid var(--fond)}
.chrono small{display:block;color:var(--pale);font-size:12.5px}.chrono span{display:block;color:var(--texte2);font-size:14.5px}
.rel{list-style:none;padding:0;margin:0 0 18px;display:grid;gap:8px}
.rel li{display:flex;gap:12px;align-items:baseline;background:var(--carte);border:1px solid var(--ligne);border-radius:12px;padding:10px 14px;font-size:15px}
.rel li em{font-style:normal;font-size:12px;font-weight:600;text-transform:uppercase;letter-spacing:.05em;color:var(--acc2);min-width:118px}
.rel li a{font-weight:600;text-decoration:none}.rel li a:hover{text-decoration:underline}
.rel li small{color:var(--texte2);margin-left:auto;text-align:right}
pre.ext{background:#141413;color:#f0eee6;border-radius:12px;padding:14px 16px;overflow-x:auto;font-size:13px;line-height:1.5}
.classement td:first-child{font-variant-numeric:tabular-nums;color:var(--pale);width:34px}
@media (max-width:1240px){.tete-expert{grid-template-columns:1fr;align-items:start}}
@media (max-width:980px){.experts{grid-template-columns:1fr}.deux{grid-template-columns:1fr}.vues form{margin-left:0;width:100%}.vues input{flex:1;min-width:0}.tech{grid-template-columns:repeat(2,minmax(0,1fr))}}
`;

function monter(router, { garde, envoyer, pasTrouve, lienSigle, PALETTE }) {
  const X = require('../modules/metisexperts');
  const M = require('../modules/metisdocs');
  const G = require('../modules/graphiques');
  const ICONES = require('../modules/graphiques-planche').ICONES;

  const couleurPool = (p) => (!p ? 'var(--acc)' : p.type === 'principal' ? 'var(--texte2)' : PALETTE[((p.couleur || 1) - 1) % PALETTE.length]);
  const ico = (nom, c) => '<span class="ico" style="--c:' + c + '"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + (ICONES[nom] || ICONES.cube) + '</svg></span>';
  const bStatut = (s) => '<span class="b-statut ' + esc(s) + '">' + esc(X.LIB_STATUT[s] || s) + '</span>';
  const inconnu = '<span class="inconnu">—</span>';
  // Un niveau inconnu n'est pas un zéro : pas de barre, un tiret.
  const jauge = (d, m) => '<span class="jauge-niv" role="img" aria-label="' + esc('déclaré ' + (d == null ? 'inconnu' : d) + ', mesuré ' + (m == null ? 'inconnu' : m)) + '">'
    + (d != null ? '<span class="d" style="width:' + d + '%"></span>' : '') + (m != null ? '<span class="m" style="width:' + m + '%"></span>' : '') + '</span>';
  const niveauTexte = (d, m) => (m != null ? 'mesuré ' + m : '') + (m != null && d != null ? ' · ' : '') + (d != null ? 'déclaré ' + d : '') || 'niveau inconnu';
  const glossaire = (moi) => new Map((M.glossaire(moi.id) || []).map((x) => [x.sigle, x]));
  // Les sigles connus du glossaire deviennent des liens vers leur page, comme dans les publications.
  const annoter = (html, table) => { try { return M.annoterSigles(html, table, { lien: lienSigle }).html; } catch { return html; } };
  const para = (t, table) => (t ? annoter('<p>' + esc(t) + '</p>', table) : '');
  const periph = (e) => (e.peripherique ? X.LIB_PERIPH[e.peripherique] : null);
  const latenceCourte = (e) => (e.latence_p50_ms != null ? 'p50 ' + ms(e.latence_p50_ms) : e.debit_jetons_s != null ? nf(e.debit_jetons_s) + ' j/s' : null);
  const cell = (v, cls = '') => (v == null || v === '' ? '<dd class="inconnu">—</dd>' : '<dd' + (cls ? ' class="' + cls + '"' : '') + '>' + esc(v) + '</dd>');
  const nomsComp = (moi) => new Map((X.competences(moi.id) || []).map((c) => [c.id, c.nom]));

  function carteExpert(e, pools, noms) {
    const p = pools.find((x) => x.id === e.pool);
    const c = couleurPool(p);
    const comps = e.competences.slice(0, 4).map((k) => '<div class="comp"><span class="nom">' + esc(noms.get(k.competence) || k.competence) + (k.rang === 'principale' ? '' : '<small>secondaire</small>') + '</span>' + jauge(k.niveau_declare, k.niveau_mesure) + '</div>').join('');
    return '<a class="xp ' + esc(e.statut) + '" href="/metis/experts/' + esc(e.id) + '" style="--c:' + c + '">'
      + '<div class="haut">' + ico(e.icone, c) + '<div style="min-width:0"><h3>' + esc(e.nom) + '</h3><code class="id">' + esc(e.id) + (e.version ? ' · ' + esc(e.version) : '') + '</code>'
      + '<div class="badges">' + bStatut(e.statut) + (e.maturite ? '<span class="b-neutre">' + esc(X.LIB_MATURITE[e.maturite]) + '</span>' : '') + (e.type ? '<span class="b-neutre">' + esc(X.LIB_TYPE[e.type]) + (e.axe ? ' · ' + esc(X.LIB_AXE[e.axe]) : '') + '</span>' : '') + '</div></div></div>'
      + (e.role ? '<p>' + esc(e.role) + '</p>' : '')
      + '<dl class="tech">'
      + '<div><dt>Périphérique</dt>' + cell(periph(e)) + '</div>'
      + '<div><dt>VRAM</dt>' + cell(mo(e.vram_mo)) + '</div>'
      + '<div><dt>Latence</dt>' + cell(latenceCourte(e)) + '</div>'
      + '<div><dt>Chargement</dt>' + cell(e.chargement ? X.LIB_CHARGEMENT[e.chargement] : null) + '</div>'
      + '<div><dt>Coût</dt>' + cell(e.cout ? X.LIB_COUT[e.cout] : null) + '</div>'
      + '<div><dt>Entraînement</dt>' + cell(e.entrainement ? X.LIB_ENTRAINEMENT[e.entrainement] : null) + '</div></dl>'
      + (comps ? '<div class="comps">' + comps + '</div>' : '<div class="comps"><span style="color:var(--pale);font-size:13.5px">Aucune compétence déclarée.</span></div>')
      + '<div class="pied-xp"><span>' + pluriel(e.competences.length, 'compétence') + '</span><span>' + (e.niveau_mesure_moyen != null ? 'mesuré en moyenne ' + e.niveau_mesure_moyen : 'aucune mesure') + '</span><span>rév. ' + e.revision + '</span></div></a>';
  }
  const legende = '<div class="legende-niv"><span><span class="jauge-niv"><span class="d" style="width:70%"></span></span> niveau déclaré</span><span><span class="jauge-niv"><span class="m" style="width:55%"></span></span> niveau mesuré (benchmark)</span><span>Échelle 0 à 100 · pas de barre = inconnu, pas nul</span></div>';

  function socle(p, table) {
    if (!p) return '';
    const res = (p.ressources || []).map((r) => '<div class="ressource"><b>' + annoter(esc(r.nom), table) + '<i class="' + esc(r.etat) + '">' + (r.etat === 'en_service' ? 'en service' : 'proposé') + '</i></b><span class="type-res">' + esc(r.type) + '</span><span>' + annoter(esc(r.detail || ''), table) + '</span></div>').join('');
    return '<section class="socle"><header><h2><a href="/metis/experts/pool/' + esc(p.id) + '">' + esc(p.nom) + '</a></h2><span class="b-neutre">accessible à tous les experts</span></header>'
      + '<p>' + annoter(esc(p.role + (p.description ? ' ' + p.description : '')), table) + '</p>' + (res ? '<div class="ressources">' + res + '</div>' : '') + '</section>';
  }

  // ── L'index ────────────────────────────────────────────────────────────────
  router.get('/experts', (req, res) => {
    const moi = garde(req, res); if (!moi) return;
    const VUES = { pools: 'Par pool', technique: 'Fiche technique', competences: 'Compétences', architecture: 'Architecture' };
    const vue = VUES[req.query.vue] ? req.query.vue : 'pools';
    const statut = X.STATUTS.includes(req.query.statut) ? req.query.statut : null;
    const q = req.query.q ? String(req.query.q).slice(0, 60).trim() : '';
    const pools = X.pools(moi.id) || [];
    const tous = X.lister(moi.id) || [];
    const experts = X.lister(moi.id, { statut, recherche: q || undefined }) || [];
    const st = X.statistiques(moi.id);
    const noms = nomsComp(moi);
    const table = glossaire(moi);
    const principal = pools.find((p) => p.type === 'principal');
    const capacites = pools.filter((p) => p.type === 'capacite');
    // Une valeur vide retire le paramètre : « Tous statuts » et « × recherche » n'emportent pas de statut= ou q= vides.
    const lienVue = (v, extra = {}) => { const o = { vue: v !== 'pools' ? v : '', statut: statut || '', q, ...extra }; const s = new URLSearchParams(Object.entries(o).filter(([, x]) => x)).toString(); return '/metis/experts' + (s ? '?' + s : ''); };

    let h = '<section class="bandeau"><div><p class="sur">Registre des experts</p><h1>Les experts de Métis</h1><p class="intro">Chaque expert de l’architecture, rattaché à un pool de capacité, avec ses compétences — niveau déclaré et niveau mesuré —, son coût, sa mémoire, son chargement, son entraînement et ses relations. Tous gardent l’accès au pool principal partagé. C’est la base que lisent le routage (MORPH, MARS), le chargement dynamique (DEL, DMA, PCO) et, demain, l’évaluation automatique.</p></div>'
      + '<div class="chiffres">'
      + '<a class="chiffre" href="' + lienVue('technique') + '"><b>' + st.experts + '</b><span>Experts</span><small>' + [st.parStatut.stable ? st.parStatut.stable + ' stable' + (st.parStatut.stable > 1 ? 's' : '') : null, st.parStatut.experimental ? st.parStatut.experimental + (st.parStatut.experimental > 1 ? ' expérimentaux' : ' expérimental') : null, st.parStatut.deprecie ? st.parStatut.deprecie + ' déprécié' + (st.parStatut.deprecie > 1 ? 's' : '') : null].filter(Boolean).join(' · ') + '</small></a>'
      + '<a class="chiffre" href="' + lienVue('pools') + '"><b>' + st.pools + '</b><span>Pools de capacité</span><small>+ le pool principal partagé</small></a>'
      + '<a class="chiffre" href="' + lienVue('competences') + '"><b>' + st.competences + '</b><span>Compétences</span><small>' + pluriel(st.liens, 'lien expert-compétence', 'liens expert-compétence') + '</small></a>'
      + '<a class="chiffre" href="' + lienVue('competences') + '"><b>' + st.niveaux_mesures + '</b><span>Niveaux mesurés</span><small>' + st.niveaux_declares + ' déclarés · ' + pluriel(st.benchmarks, 'benchmark') + '</small></a>'
      + '</div></section>';

    h += '<nav class="vues" aria-label="Vues">' + Object.entries(VUES).map(([k, t]) => '<a href="' + lienVue(k) + '"' + (vue === k ? ' class="on" aria-current="page"' : '') + '>' + t + '</a>').join('')
      + '<form method="get" action="/metis/experts" role="search">' + (vue !== 'pools' ? '<input type="hidden" name="vue" value="' + vue + '">' : '') + (statut ? '<input type="hidden" name="statut" value="' + statut + '">' : '') + '<input name="q" value="' + esc(q) + '" placeholder="Chercher un expert, une compétence…" aria-label="Chercher un expert"></form></nav>';
    h += '<div class="puces"><a href="' + lienVue(vue, { statut: '' }) + '"' + (!statut ? ' class="on"' : '') + '>Tous statuts</a>'
      + X.STATUTS.map((s) => '<a href="' + lienVue(vue, { statut: s }) + '"' + (statut === s ? ' class="on"' : '') + '>' + esc(X.LIB_STATUT[s]) + ' <small style="color:var(--pale)">' + (st.parStatut[s] || 0) + '</small></a>').join('')
      + (q ? '<span class="sep-puces"></span><a class="on" href="' + lienVue(vue, { q: '' }) + '">× « ' + esc(q) + ' »</a>' : '') + '</div>';

    if (!tous.length) h += '<div class="vide">Aucun expert au registre pour l’instant. ChatGPT peut en déclarer par le connecteur MCP (outil <code>creer_expert</code>).</div>';
    else if (vue === 'pools') {
      h += socle(principal, table) + legende;
      for (const p of capacites) {
        const du = experts.filter((e) => e.pool === p.id);
        if (!du.length && (statut || q)) continue;
        h += '<div class="pool-tete"><h2><span class="pastille" style="--c:' + couleurPool(p) + '"></span><a href="/metis/experts/pool/' + esc(p.id) + '">' + esc(p.nom) + '</a></h2><small>' + pluriel(du.length, 'expert') + '</small></div>'
          + (p.role ? '<p class="pool-role">' + annoter(esc(p.role), table) + '</p>' : '')
          + (du.length ? '<div class="experts">' + du.map((e) => carteExpert(e, pools, noms)).join('') + '</div>' : '<div class="pool-vide">Aucun expert déclaré dans ce pool. ' + annoter(esc(p.description || ''), table) + '</div>');
      }
      if (!experts.length) h += '<div class="vide">Aucun expert ne correspond à ces filtres.</div>';
    } else if (vue === 'technique') {
      const col = ['Expert', 'Pool', 'Statut', 'Maturité', 'Type', 'Version', 'Périphérique', 'VRAM', 'RAM', 'Latence p50', 'Latence p95', 'Débit', 'Chargement', 'Coût', 'Entraînement', 'Promotion', 'Compétences', 'Niveau mesuré moyen'];
      h += '<div class="table-tech"><table><thead><tr>' + col.map((c) => '<th scope="col">' + c + '</th>').join('') + '</tr></thead><tbody>';
      for (const e of experts) {
        const d = X.lire(moi.id, e.id);
        const p = pools.find((x) => x.id === e.pool);
        const td = (v, num) => '<td' + (num ? ' class="num"' : '') + '>' + (v == null || v === '' ? inconnu : esc(v)) + '</td>';
        h += '<tr class="' + esc(e.statut) + '"><td><a href="/metis/experts/' + esc(e.id) + '">' + esc(e.nom) + '</a></td>'
          + '<td><span class="pastille" style="--c:' + couleurPool(p) + ';display:inline-block;margin-right:6px"></span>' + esc(p ? p.nom : e.pool) + '</td><td>' + bStatut(e.statut) + '</td>'
          + td(e.maturite && X.LIB_MATURITE[e.maturite]) + td(e.type && X.LIB_TYPE[e.type] + (e.axe ? ' · ' + X.LIB_AXE[e.axe] : '')) + td(e.version) + td(periph(e))
          + td(mo(d.memoire && d.memoire.vram_mo), 1) + td(mo(d.memoire && d.memoire.ram_mo), 1)
          + td(ms(d.latence && d.latence.p50_ms), 1) + td(ms(d.latence && d.latence.p95_ms), 1) + td(d.latence && d.latence.debit_jetons_s != null ? nf(d.latence.debit_jetons_s) + ' j/s' : null, 1)
          + td(e.chargement && X.LIB_CHARGEMENT[e.chargement]) + td(e.cout && X.LIB_COUT[e.cout]) + td(e.entrainement && X.LIB_ENTRAINEMENT[e.entrainement])
          + td(d.entrainement && d.entrainement.etape_promotion) + td(e.competences.length, 1) + td(e.niveau_mesure_moyen, 1) + '</tr>';
      }
      h += '</tbody></table></div><p style="color:var(--pale);font-size:13.5px;margin-top:12px">— : inconnu (jamais mesuré ni déclaré). Une valeur mesurée l’est par benchmark ou télémétrie ; la fiche de chaque expert dit laquelle.</p>';
    } else if (vue === 'competences') {
      const comps = X.competences(moi.id) || [];
      const liens = new Map();
      for (const e of experts) for (const k of e.competences) liens.set(e.id + '|' + k.competence, k);
      const doms = [...new Set(comps.map((c) => c.domaine || 'Autres'))].sort((a, b) => a.localeCompare(b, 'fr'));
      h += '<div class="legende-niv"><span><span class="niv m" style="--n:60">60</span> mesuré</span><span><span class="niv d">60</span> déclaré seulement</span><span><span class="niv x">?</span> compétence portée, niveau inconnu</span><span>Case vide : l’expert ne la porte pas</span></div>';
      h += '<div class="table-tech matrice"><table style="min-width:' + (320 + experts.length * 110) + 'px"><thead><tr><th scope="col">Compétence</th>' + experts.map((e) => '<th scope="col" class="col"><a href="/metis/experts/' + esc(e.id) + '">' + esc(e.nom) + '</a></th>').join('') + '</tr></thead><tbody>';
      for (const dom of doms) {
        h += '<tr><th colspan="' + (experts.length + 1) + '" class="dom">' + esc(dom) + '</th></tr>';
        for (const c of comps.filter((x) => (x.domaine || 'Autres') === dom)) {
          h += '<tr><td><a href="/metis/experts/competence/' + esc(c.id) + '">' + esc(c.nom) + '</a></td>' + experts.map((e) => {
            const k = liens.get(e.id + '|' + c.id);
            if (!k) return '<td class="cel"></td>';
            const titre = esc(e.nom + ' — ' + c.nom + ' : ' + niveauTexte(k.niveau_declare, k.niveau_mesure) + (k.rang === 'principale' ? ' (principale)' : ' (secondaire)'));
            if (k.niveau_mesure != null) return '<td class="cel"><span class="niv m" style="--n:' + k.niveau_mesure + '" title="' + titre + '">' + k.niveau_mesure + '</span></td>';
            if (k.niveau_declare != null) return '<td class="cel"><span class="niv d" title="' + titre + '">' + k.niveau_declare + '</span></td>';
            return '<td class="cel"><span class="niv x" title="' + titre + '">?</span></td>';
          }).join('') + '</tr>';
        }
      }
      h += '</tbody></table></div>';
    } else {
      const a = X.donneesArchitecture(moi.id);
      for (const [cle, lib] of [['planche', 'Vue d’ensemble : pools et pool principal'], ['schema', 'Experts et relations']]) {
        const s = a.graphiques[cle];
        if (s.erreurs) { h += '<div class="figure-erreur">' + esc(lib) + ' : ' + esc(s.erreurs.join(' ')) + '</div>'; continue; }
        const r = G.graphique(s, { id: 'arch-' + cle });
        h += '<h2 class="famille">' + esc(lib) + '</h2><figure class="figure" style="margin:0 0 20px">' + (r.ok ? r.svg + G.glossaireHtml(r.spec) : '') + '</figure>';
      }
      h += '<h2 class="famille">Ordre de chargement <small>dépendances d’abord</small></h2><ol class="rel" style="list-style:decimal inside">'
        + a.ordre_de_chargement.map((id) => { const e = tous.find((x) => x.id === id); return '<li><a href="/metis/experts/' + esc(id) + '">' + esc(e ? e.nom : id) + '</a><small>' + (e ? esc(X.LIB_STATUT[e.statut]) : '') + '</small></li>'; }).join('') + '</ol>'
        + '<p style="color:var(--pale);font-size:13.5px">Les mêmes données — et ces deux spécifications de graphiques — sont rendues au MCP par l’outil <code>donnees_architecture</code>.</p>';
    }
    envoyer(res, moi, 'Experts — Recherche Métis', h, { actif: 'experts', description: 'Registre des experts de l’architecture Métis', fil: [['Recherche Métis', '/metis'], ['Experts', vue === 'pools' && !statut && !q ? null : '/metis/experts'], ...(vue !== 'pools' ? [[VUES[vue], null]] : [])] });
  });

  // ── Une compétence : qui la porte, classé comme pour le routage ────────────
  router.get('/experts/competence/:id([a-z0-9][a-z0-9-]{1,59})', (req, res) => {
    const moi = garde(req, res); if (!moi) return;
    const c = (X.competences(moi.id) || []).find((x) => x.id === req.params.id);
    if (!c) return pasTrouve(res, moi);
    const r = X.chercherParCompetence(moi.id, { competence: c.id, inclure_deprecies: true });
    const benchs = (X.benchmarks(moi.id, { competence: c.id }) || []);
    const table = glossaire(moi);
    let h = '<header class="tete-expert" style="--c:var(--acc)"><div><div class="puces-sigle"><span class="puce-famille"><span class="pastille"></span>' + esc(c.domaine || 'Compétence') + '</span></div><h1>' + esc(c.nom) + '</h1><p class="ident"><code>' + esc(c.id) + '</code></p>'
      + (c.description ? '<p class="role">' + annoter(esc(c.description), table) + '</p>' : '') + '</div>'
      + '<div class="chiffres"><div class="chiffre"><b>' + c.experts + '</b><span>Experts qui la portent</span></div><div class="chiffre"><b>' + c.mesures + '</b><span>Niveaux mesurés</span></div><div class="chiffre"><b>' + benchs.length + '</b><span>Benchmarks</span></div></div></header>';
    h += '<div class="fiche-x"><h2>Classement pour le routage</h2><p style="color:var(--texte2)">L’ordre que rend l’outil MCP <code>chercher_experts</code> : niveau mesuré s’il existe, sinon déclaré ; à niveau égal, le mesuré passe devant, puis la priorité de routage ; les experts dépréciés en dernier.</p>';
    h += r.experts.length ? '<div class="table-x classement"><table><thead><tr><th>#</th><th>Expert</th><th>Niveau</th><th>Source</th><th>Rang</th><th>Statut</th><th>Périphérique</th><th>Chargement</th><th>Stratégie</th></tr></thead><tbody>'
      + r.experts.map((e, i) => { const d = e.detail[0]; return '<tr><td>' + (i + 1) + '</td><td><a href="/metis/experts/' + esc(e.id) + '">' + esc(e.nom) + '</a></td><td>' + jauge(d.niveau_declare, d.niveau_mesure) + (e.niveau != null ? e.niveau : inconnu) + '</td><td>' + ({ mesure: 'mesuré', declare: 'déclaré', inconnu: 'inconnu' }[e.source_niveau]) + '</td><td>' + esc(d.rang) + '</td><td>' + bStatut(e.statut) + '</td><td>' + (e.peripherique ? esc(X.LIB_PERIPH[e.peripherique]) : inconnu) + '</td><td>' + (e.chargement ? esc(X.LIB_CHARGEMENT[e.chargement]) : inconnu) + '</td><td>' + (e.routage && e.routage.strategie ? esc(e.routage.strategie) : inconnu) + '</td></tr>'; }).join('') + '</tbody></table></div>'
      : '<p class="pool-vide">Aucun expert ne porte encore cette compétence.</p>';
    if (benchs.length) h += '<h2>Benchmarks</h2><div class="table-x"><table><thead><tr><th>Benchmark</th><th>Métrique</th><th>Unité</th><th>Meilleur</th><th>Description</th></tr></thead><tbody>' + benchs.map((b) => '<tr><td><b>' + esc(b.nom) + '</b><br><code style="font-size:12px;color:var(--pale)">' + esc(b.id) + '</code></td><td>' + esc(b.metrique) + '</td><td>' + esc(b.unite) + '</td><td>' + (b.sens === 'plus_bas' ? 'plus bas' : 'plus haut') + '</td><td>' + annoter(esc(b.description), table) + '</td></tr>').join('') + '</tbody></table></div>';
    h += '</div>';
    envoyer(res, moi, c.nom + ' — Experts — Recherche Métis', h, { actif: 'experts', fil: [['Recherche Métis', '/metis'], ['Experts', '/metis/experts'], ['Compétences', '/metis/experts?vue=competences'], [c.nom, null]] });
  });

  // ── Un pool ────────────────────────────────────────────────────────────────
  router.get('/experts/pool/:id([a-z0-9][a-z0-9-]{1,59})', (req, res) => {
    const moi = garde(req, res); if (!moi) return;
    const p = X.pool(moi.id, req.params.id);
    if (!p || !p.ok) return pasTrouve(res, moi);
    const pools = X.pools(moi.id) || [];
    const noms = nomsComp(moi);
    const table = glossaire(moi);
    const c = couleurPool(p);
    const mesures = p.experts.reduce((a, e) => a + e.competences.filter((k) => k.niveau_mesure != null).length, 0);
    let h = '<header class="tete-expert" style="--c:' + c + '"><div>' + ico(p.icone || (p.type === 'principal' ? 'reseau' : 'cube'), c)
      + '<div class="puces-sigle" style="margin-top:14px"><span class="puce-famille"><span class="pastille"></span>' + (p.type === 'principal' ? 'Pool principal partagé' : 'Pool de capacité') + '</span></div>'
      + '<h1>' + esc(p.nom) + '</h1>' + (p.role ? '<p class="role">' + annoter(esc(p.role), table) + '</p>' : '') + '</div>'
      + '<div class="chiffres"><div class="chiffre"><b>' + p.experts.length + '</b><span>' + (p.type === 'principal' ? 'Experts qui y ont accès' : 'Experts') + '</span></div>'
      + (p.type === 'principal' ? '<div class="chiffre"><b>' + (p.ressources || []).length + '</b><span>Ressources partagées</span><small>' + (p.ressources || []).filter((r) => r.etat === 'en_service').length + ' en service</small></div>' : '<div class="chiffre"><b>' + p.competences.length + '</b><span>Compétences couvertes</span></div>')
      + '<div class="chiffre"><b>' + mesures + '</b><span>Niveaux mesurés</span></div></div></header>';
    h += '<div class="fiche-x">' + (p.description ? para(p.description, table) : '');
    if (p.type === 'principal') {
      h += '<h2>Ressources partagées</h2><div class="ressources" style="margin-bottom:18px">' + (p.ressources || []).map((r) => '<div class="ressource"><b>' + annoter(esc(r.nom), table) + '<i class="' + esc(r.etat) + '">' + (r.etat === 'en_service' ? 'en service' : 'proposé') + '</i></b><span class="type-res">' + esc(r.type) + '</span><span>' + annoter(esc(r.detail || ''), table) + '</span></div>').join('') + '</div>';
      h += '<h2>Ce que chaque expert y lit et y écrit</h2><div class="table-x"><table><thead><tr><th>Expert</th><th>Pool</th><th>Lit</th><th>Écrit</th></tr></thead><tbody>'
        + p.experts.map((e) => { const d = X.lire(moi.id, e.id); const a = d.acces_principal || {}; const q = pools.find((x) => x.id === e.pool); return '<tr><td><a href="/metis/experts/' + esc(e.id) + '">' + esc(e.nom) + '</a></td><td>' + esc(q ? q.nom : e.pool) + '</td><td>' + ((a.lit || []).map(esc).join(', ') || '<span style="color:var(--pale)">accès, sans usage déclaré</span>') + '</td><td>' + ((a.ecrit || []).map(esc).join(', ') || '<span style="color:var(--pale)">—</span>') + '</td></tr>'; }).join('') + '</tbody></table></div>';
    } else {
      h += '<h2>Experts</h2>' + legende + (p.experts.length ? '<div class="experts">' + p.experts.map((e) => carteExpert(e, pools, noms)).join('') + '</div>' : '<p class="pool-vide">Aucun expert déclaré dans ce pool.</p>');
      if (p.competences.length) h += '<h2>Compétences couvertes</h2><ul class="puces-x">' + p.competences.map((k) => '<li><a href="/metis/experts/competence/' + esc(k.competence) + '" style="text-decoration:none">' + esc(noms.get(k.competence) || k.competence) + '</a> <small style="color:var(--pale)">' + k.experts + '</small></li>').join('') + '</ul>';
    }
    h += '</div>';
    envoyer(res, moi, p.nom + ' — Experts — Recherche Métis', h, { actif: 'experts', pool: p.id, fil: [['Recherche Métis', '/metis'], ['Experts', '/metis/experts'], [p.nom, null]] });
  });

  // ── La fiche d'un expert ───────────────────────────────────────────────────
  router.get('/experts/:id([a-z0-9][a-z0-9-]{1,59})', (req, res) => {
    const moi = garde(req, res); if (!moi) return;
    const e = X.lire(moi.id, req.params.id, { revision: req.query.revision });
    if (!e || !e.ok) return pasTrouve(res, moi);
    const pools = X.pools(moi.id) || [];
    const p = pools.find((x) => x.id === e.pool);
    const c = couleurPool(p);
    const table = glossaire(moi);
    const tous = X.lister(moi.id) || [];
    const nomDe = (id) => { const x = tous.find((y) => y.id === id); return x ? x.nom : id; };
    const lienX = (id) => '<a href="/metis/experts/' + esc(id) + '">' + esc(nomDe(id)) + '</a>';
    const mesurees = e.competences.filter((k) => k.niveau_mesure != null);
    const moy = mesurees.length ? Math.round(mesurees.reduce((a, k) => a + k.niveau_mesure, 0) / mesurees.length) : null;
    const dd = (v, sous) => (v == null || v === '' ? '<dd class="inconnu">inconnu</dd>' : '<dd>' + esc(v) + (sous ? '<small>' + esc(sous) + '</small>' : '') + '</dd>');
    const lat = e.latence || {}, mem = e.memoire || {}, ch = e.chargement || {}, en = e.entrainement || {}, ro = e.routage || {}, co = e.cout || {}, cp = e.composition || null;

    let h = '<header class="tete-expert" style="--c:' + c + '"><div>' + ico(e.icone, c)
      + '<div class="puces-sigle" style="margin-top:14px"><a class="puce-famille" href="/metis/experts/pool/' + esc(e.pool) + '"><span class="pastille"></span>' + esc(p ? p.nom : e.pool) + '</a>' + bStatut(e.statut)
      + (e.maturite ? '<span class="puce-famille puce-nature">' + esc(X.LIB_MATURITE[e.maturite]) + '</span>' : '') + (e.type ? '<span class="puce-famille puce-nature">' + esc(X.LIB_TYPE[e.type]) + (e.axe ? ' · ' + esc(X.LIB_AXE[e.axe]) : '') + '</span>' : '') + '</div>'
      + '<h1>' + esc(e.nom) + '</h1><p class="ident"><code>' + esc(e.id) + '</code>' + (e.version ? ' · version ' + esc(e.version) : '') + ' · révision ' + e.revision + '</p>'
      + (e.role ? '<p class="role">' + annoter(esc(e.role), table) + '</p>' : '') + '</div>'
      + '<div class="chiffres"><div class="chiffre"><b>' + e.competences.length + '</b><span>Compétences</span><small>' + e.competences.filter((k) => k.rang === 'principale').length + ' principale(s)</small></div>'
      + '<div class="chiffre"><b>' + (moy != null ? moy : '—') + '</b><span>Niveau mesuré moyen</span><small>' + (mesurees.length ? pluriel(mesurees.length, 'compétence mesurée', 'compétences mesurées') : 'aucune mesure encore') + '</small></div>'
      + '<div class="chiffre"><b>' + (mo(mem.vram_mo) || '—') + '</b><span>VRAM</span><small>' + (mem.vram_mo != null ? (mem.mesuree ? 'mesurée' : 'estimée') : 'inconnue') + '</small></div>'
      + '<div class="chiffre"><b>' + (lat.p50_ms != null ? ms(lat.p50_ms) : lat.debit_jetons_s != null ? nf(lat.debit_jetons_s) : '—') + '</b><span>' + (lat.p50_ms != null ? 'Latence p50' : lat.debit_jetons_s != null ? 'Jetons / s' : 'Latence') + '</span><small>' + (lat.p50_ms != null || lat.debit_jetons_s != null ? (lat.mesuree ? 'mesurée' : 'estimée') : 'inconnue') + '</small></div></div></header>';

    const S = []; // sommaire
    const sec = (id, titre) => { S.push([id, titre]); return '<h2 id="' + id + '">' + titre + '</h2>'; };
    let t = '';
    if (e.ancienne) t += '<div class="avis">Révision ' + e.revision + ', antérieure à la fiche en ligne. <a href="/metis/experts/' + esc(e.id) + '">Lire la version actuelle</a></div>';
    if (e.statut === 'deprecie' || e.retrait) {
      const r = e.retrait || {};
      t += '<div class="tombe"><b>Retiré' + (r.le ? ' le ' + esc(date(r.le) || r.le) : '') + '</b>' + (r.raison ? annoter(esc(r.raison), table) : 'Expert déprécié.') + (r.remplace_par ? '<br>Remplacé par ' + lienX(r.remplace_par) + '.' : '') + (r.restauration ? '<br><span style="color:var(--texte2)">Pour revenir : ' + esc(r.restauration) + '</span>' : '') + '</div>';
    }
    t += sec('x-role', 'Rôle') + para(e.role, table) + para(e.description, table);
    if ((e.specialisations || []).length) t += '<ul class="puces-x">' + e.specialisations.map((s) => '<li>' + annoter(esc(s), table) + '</li>').join('') + '</ul>';

    t += sec('x-competences', 'Compétences');
    if (e.competences.length) {
      // La note et le benchmark vont SOUS le nom : en colonnes, ils écrasaient le tableau dans la colonne de lecture.
      t += legende + '<div class="table-x comps-x"><table><thead><tr><th>Compétence</th><th>Rang</th><th>Déclaré</th><th>Mesuré</th></tr></thead><tbody>'
        + e.competences.map((k) => '<tr style="--c:' + c + '"><td><a href="/metis/experts/competence/' + esc(k.competence) + '"><b>' + esc(k.nom) + '</b></a> <small style="color:var(--pale)">· ' + esc(k.domaine) + '</small>'
          + (k.benchmark ? '<small class="sous">Benchmark : ' + esc((e.benchmarks.find((b) => b.id === k.benchmark) || {}).nom || k.benchmark) + '</small>' : '') + (k.note ? '<small class="sous">' + esc(k.note) + '</small>' : '') + '</td><td>' + esc(k.rang) + '</td>'
          + '<td class="n">' + (k.niveau_declare != null ? jauge(k.niveau_declare, null) + k.niveau_declare : inconnu) + '</td><td class="n">' + (k.niveau_mesure != null ? jauge(null, k.niveau_mesure) + k.niveau_mesure + (k.mesure_le ? '<small class="sous">' + esc(dateCourte(k.mesure_le)) + '</small>' : '') : '<span style="color:var(--pale)">non mesuré</span>') + '</td></tr>').join('') + '</tbody></table></div>';
      if (e.competences.length >= 2) {
        const r = G.graphique({ type: 'barres-h', titre: 'Niveaux par compétence', unite: '/ 100', yMin: 0, yMax: 100, x: e.competences.map((k) => k.nom), series: [{ nom: 'Déclaré', valeurs: e.competences.map((k) => k.niveau_declare) }, { nom: 'Mesuré', valeurs: e.competences.map((k) => k.niveau_mesure) }], source: 'Registre des experts — un niveau absent est inconnu, pas nul.' }, { id: 'niv-' + e.id });
        if (r.ok) t += '<figure class="figure">' + r.svg + '</figure>';
      }
    } else t += '<p style="color:var(--texte2)">Aucune compétence déclarée.</p>';

    if ((e.entrees || []).length || (e.sorties || []).length || (e.outils || []).length) {
      t += sec('x-es', 'Entrées, sorties et outils') + '<div class="deux"><div><h3>Entrées</h3>' + ((e.entrees || []).length ? '<ul class="puces-x">' + e.entrees.map((x) => '<li>' + annoter(esc(x), table) + '</li>').join('') + '</ul>' : '<p style="color:var(--pale)">—</p>') + '</div>'
        + '<div><h3>Sorties</h3>' + ((e.sorties || []).length ? '<ul class="puces-x">' + e.sorties.map((x) => '<li>' + annoter(esc(x), table) + '</li>').join('') + '</ul>' : '<p style="color:var(--pale)">—</p>') + '</div></div>'
        + '<h3 style="font-size:13px;text-transform:uppercase;letter-spacing:.06em;color:var(--pale);margin:6px 0 8px">Outils disponibles</h3>' + ((e.outils || []).length ? '<ul class="puces-x">' + e.outils.map((x) => '<li>' + esc(x) + '</li>').join('') + '</ul>' : '<p style="color:var(--texte2)">Aucun : il est appelé, il n’appelle pas d’outil.</p>');
    }

    t += sec('x-execution', 'Exécution et ressources') + '<dl class="dl-x">'
      + '<div><dt>Périphérique privilégié</dt>' + dd(e.peripherique && X.LIB_PERIPH[e.peripherique]) + '</div>'
      + '<div><dt>VRAM</dt>' + dd(mo(mem.vram_mo), mem.vram_mo != null ? (mem.mesuree ? 'mesurée' : 'estimée') : null) + '</div>'
      + '<div><dt>RAM</dt>' + dd(mo(mem.ram_mo)) + '</div>'
      + '<div><dt>Disque</dt>' + dd(mo(mem.disque_mo)) + '</div>'
      + '<div><dt>Latence p50</dt>' + dd(ms(lat.p50_ms)) + '</div>'
      + '<div><dt>Latence p95</dt>' + dd(ms(lat.p95_ms)) + '</div>'
      + '<div><dt>Débit</dt>' + dd(lat.debit_jetons_s != null ? nf(lat.debit_jetons_s) + ' jetons/s' : null, lat.debit_jetons_s != null ? (lat.mesuree ? 'mesuré' : 'estimé') : null) + '</div>'
      + '<div><dt>Coût estimé</dt>' + dd(co.valeur != null ? nf(co.valeur, 4) + ' ' + (co.unite || '') : co.relatif && X.LIB_COUT[co.relatif], co.valeur != null && co.relatif ? X.LIB_COUT[co.relatif] : null) + '</div>'
      + '<div><dt>Temps de chargement</dt>' + dd(ms(ch.temps_chargement_ms)) + '</div></dl>'
      + [lat.detail, mem.detail, co.detail].filter(Boolean).map((x) => para(x, table)).join('');
    const niveaux = ['l0_vram', 'l1_vram_distante', 'l2_ram_epinglee', 'l3_nvme'];
    t += '<h3 style="font-size:13px;text-transform:uppercase;letter-spacing:.06em;color:var(--pale);margin:18px 0 8px">Chargement et cache (niveaux de DEL)</h3><div class="echelle" style="--c:' + c + '">'
      + ['residant', ...niveaux, 'non_charge'].map((k) => '<span' + (ch.etat === k ? ' class="on"' : '') + '>' + esc(X.LIB_CHARGEMENT[k]) + '</span>').join('') + '</div>'
      + '<dl class="dl-x"><div><dt>Cache</dt>' + dd(ch.cache == null ? null : ch.cache ? 'oui' : 'non') + '</div><div><dt>Préchargement</dt>' + dd(ch.prechargement == null ? null : ch.prechargement ? 'oui' : 'non') + '</div><div><dt>Épinglé</dt>' + dd(ch.epingle == null ? null : ch.epingle ? 'oui' : 'non') + '</div><div><dt>Emplacement</dt>' + dd(ch.emplacement) + '</div></dl>' + para(ch.detail, table);

    t += sec('x-routage', 'Routage') + '<dl class="dl-x"><div><dt>Stratégie</dt>' + dd(ro.strategie) + '</div><div><dt>Priorité</dt>' + dd(ro.priorite) + '</div><div><dt>Poids</dt>' + dd(ro.poids) + '</div><div><dt>Seuil de confiance</dt>' + dd(ro.seuil_confiance) + '</div><div><dt>Repli</dt>' + (ro.repli ? '<dd>' + lienX(ro.repli) + '</dd>' : '<dd class="inconnu">aucun</dd>') + '</div></dl>'
      + ((ro.intentions || []).length ? '<p><b>Intentions :</b> ' + ro.intentions.map(esc).join(', ') + '</p>' : '') + ((ro.declencheurs || []).length ? '<p><b>Déclencheurs :</b> ' + ro.declencheurs.map(esc).join(', ') + '</p>' : '')
      + ((ro.profils || []).length ? '<p><b>Profils :</b> ' + ro.profils.map(esc).join(' · ') + '</p>' : '') + para(ro.conditions, table);

    if (cp) t += sec('x-composition', 'Composition (MACE)') + '<dl class="dl-x"><div><dt>Base</dt>' + (cp.base ? '<dd>' + lienX(cp.base) + '</dd>' : '<dd class="inconnu">—</dd>') + '</div><div><dt>Stratégie</dt>' + dd(cp.strategie && cp.strategie.toUpperCase().replace('_', '/')) + '</div><div><dt>Rang</dt>' + dd(cp.rang) + '</div><div><dt>Sous-espace</dt>' + dd(cp.sous_espace) + '</div><div><dt>Couches</dt>' + dd(cp.couches) + '</div></dl>' + para(cp.detail, table);

    t += sec('x-entrainement', 'Entraînement') + '<dl class="dl-x"><div><dt>État</dt>' + dd(en.etat && X.LIB_ENTRAINEMENT[en.etat]) + '</div><div><dt>Checkpoint</dt>' + dd(en.checkpoint) + '</div><div><dt>Recette</dt>' + dd(en.recette) + '</div></dl>'
      + '<h3 style="font-size:13px;text-transform:uppercase;letter-spacing:.06em;color:var(--pale);margin:6px 0 8px">Promotion (Shadow → Prove → Canary → Release)</h3><div class="echelle" style="--c:' + c + '">' + ['shadow', 'prove', 'canary', 'release'].map((k) => '<span' + (en.etape_promotion === k ? ' class="on"' : '') + '>' + k + '</span>').join('') + '</div>'
      + para(en.detail, table);
    if ((en.historique || []).length) t += '<ol class="chrono" style="--c:' + c + '">' + en.historique.slice().reverse().map((x) => '<li>' + (x.le ? '<small>' + esc(date(x.le) || x.le) + '</small>' : '') + '<b>' + esc(x.evenement) + '</b>' + (x.detail ? '<span>' + esc(x.detail) + '</span>' : '') + (x.checkpoint ? '<span><code>' + esc(x.checkpoint) + '</code></span>' : '') + '</li>').join('') + '</ol>';
    if ((e.datasets || []).length) t += '<h3 style="font-size:13px;text-transform:uppercase;letter-spacing:.06em;color:var(--pale);margin:6px 0 8px">Datasets</h3><div class="table-x"><table><thead><tr><th>Dataset</th><th>Rôle</th><th>Version</th><th>Taille</th><th>Détail</th></tr></thead><tbody>' + e.datasets.map((x) => '<tr><td><b>' + esc(x.nom) + '</b></td><td>' + esc((x.role || '').replace('_', '-')) + '</td><td>' + (x.version ? esc(x.version) : inconnu) + '</td><td>' + (x.taille ? esc(x.taille) : inconnu) + '</td><td style="color:var(--texte2)">' + esc(x.detail || '') + '</td></tr>').join('') + '</tbody></table></div>';

    t += sec('x-relations', 'Relations');
    const rel = (l, sens) => l.map((r) => '<li><em>' + esc(sens === 'sortante' ? r.libelle : r.libelle + ' ←') + '</em>' + (r.existe ? lienX(r.autre) : esc(r.autre)) + (r.detail ? '<small>' + esc(r.detail) + '</small>' : '') + '</li>').join('');
    t += (e.relations.sortantes.length || e.relations.entrantes.length) ? '<ul class="rel">' + rel(e.relations.sortantes, 'sortante') + e.relations.entrantes.map((r) => '<li><em>' + esc(r.libelle) + ' ←</em>' + lienX(r.de) + '<small>' + esc(nomDe(r.de) + ' ' + r.libelle + ' ' + e.nom + (r.detail ? ' — ' + r.detail : '')) + '</small></li>').join('') + '</ul>' : '<p style="color:var(--texte2)">Aucune relation déclarée.</p>';

    const a = e.acces_principal || {};
    const pp = pools.find((x) => x.type === 'principal');
    t += sec('x-principal', 'Accès au pool principal') + '<p>' + (pp ? 'Cet expert garde l’accès à <a href="/metis/experts/pool/' + esc(pp.id) + '">' + esc(pp.nom) + '</a>, comme tous les experts.' : 'Aucun pool principal n’est défini.') + '</p>'
      + '<div class="deux"><div><h3>Lit</h3>' + ((a.lit || []).length ? '<ul class="puces-x">' + a.lit.map((x) => '<li>' + annoter(esc(x), table) + '</li>').join('') + '</ul>' : '<p style="color:var(--pale)">aucun usage déclaré</p>') + '</div><div><h3>Écrit</h3>' + ((a.ecrit || []).length ? '<ul class="puces-x">' + a.ecrit.map((x) => '<li>' + annoter(esc(x), table) + '</li>').join('') + '</ul>' : '<p style="color:var(--pale)">rien</p>') + '</div></div>' + para(a.detail, table);

    if (e.mesures.length) t += sec('x-mesures', 'Mesures') + '<div class="table-x"><table><thead><tr><th>Date</th><th>Métrique</th><th>Valeur</th><th>Niveau</th><th>Compétence</th><th>Benchmark</th><th>Source</th></tr></thead><tbody>' + e.mesures.map((m) => '<tr><td style="white-space:nowrap">' + esc(dateCourte(m.le)) + '</td><td><code>' + esc(m.metrique) + '</code></td><td style="font-variant-numeric:tabular-nums">' + nf(m.valeur, 4) + '</td><td>' + (m.niveau != null ? m.niveau : inconnu) + '</td><td>' + esc(m.competence || '') + '</td><td>' + esc(m.benchmark || '') + '</td><td style="color:var(--texte2)">' + esc(m.source) + (m.detail ? ' — ' + esc(m.detail) : '') + '</td></tr>').join('') + '</tbody></table></div>';
    if ((e.limitations || []).length) t += sec('x-limites', 'Limitations connues') + '<ul>' + e.limitations.map((x) => '<li>' + annoter(esc(x), table) + '</li>').join('') + '</ul>';
    if (e.audit) t += sec('x-audit', 'Audit de valeur') + '<dl class="dl-x"><div><dt>Classe</dt>' + dd(e.audit.classe) + '</div><div><dt>Le</dt>' + dd(e.audit.le) + '</div></dl>' + para(e.audit.detail, table);
    if (e.notes) t += sec('x-notes', 'Notes') + para(e.notes, table);
    if (e.extensions && Object.keys(e.extensions).length) t += sec('x-extensions', 'Extensions') + '<p style="color:var(--texte2)">Données qui n’ont pas encore de champ dédié.</p><pre class="ext"><code>' + esc(JSON.stringify(e.extensions, null, 2)) + '</code></pre>';
    if (e.revisions.length > 1) t += '<div class="versions">Révisions : ' + e.revisions.map((v) => '<a href="/metis/experts/' + esc(e.id) + '?revision=' + v.revision + '" title="' + esc(v.motif) + '">r' + v.revision + '</a> (' + esc(date(v.le)) + ')').join(' · ') + '</div>';

    const memePool = tous.filter((x) => x.pool === e.pool && x.id !== e.id);
    const rail = '<aside class="rail"><section class="bloc"><dl class="infos"><dt>Identifiant</dt><dd><code>' + esc(e.id) + '</code></dd><dt>Pool</dt><dd style="color:' + c + '">' + esc(p ? p.nom : e.pool) + '</dd><dt>Statut</dt><dd>' + esc(X.LIB_STATUT[e.statut]) + '</dd>'
      + (e.maturite ? '<dt>Maturité</dt><dd>' + esc(X.LIB_MATURITE[e.maturite]) + '</dd>' : '') + (e.type ? '<dt>Type</dt><dd>' + esc(X.LIB_TYPE[e.type]) + '</dd>' : '') + (e.version ? '<dt>Version</dt><dd>' + esc(e.version) + '</dd>' : '')
      + '<dt>Révision</dt><dd>r' + e.revision + '</dd><dt>Mis à jour</dt><dd>' + esc(date(e.majLe)) + '</dd><dt>Par</dt><dd>' + esc(e.auteur) + '</dd></dl></section>'
      + (memePool.length ? '<section class="bloc"><span class="titre-bloc">Même pool</span><ul class="liste-sigles">' + memePool.map((x) => '<li><a href="/metis/experts/' + esc(x.id) + '"><b style="min-width:0">' + esc(x.nom) + '</b></a></li>').join('') + '</ul></section>' : '')
      + '<section class="bloc"><span class="titre-bloc">Par le connecteur MCP</span><p style="font-size:13.5px;color:var(--texte2);margin:0">ChatGPT relit cette fiche avec <code>lire_expert</code> et la met à jour avec <code>modifier_expert</code> (révision ' + e.revision + '), <code>mettre_a_jour_competences</code> ou <code>enregistrer_mesures</code>.</p></section></aside>';
    h += '<div class="lecture" style="--c:' + c + '"><nav class="sommaire" aria-label="Sommaire"><b>Sommaire</b>' + S.map(([id, ti]) => '<a class="n2" href="#' + id + '">' + ti + '</a>').join('') + '</nav><div class="texte fiche-x">' + t + '</div>' + rail + '</div>';
    envoyer(res, moi, e.nom + ' — Experts — Recherche Métis', h, { actif: 'experts', pool: e.pool, description: e.nom + ' : ' + (e.role || ''), fil: [['Recherche Métis', '/metis'], ['Experts', '/metis/experts'], [p ? p.nom : e.pool, '/metis/experts/pool/' + e.pool], [e.nom, null]] });
  });
}

module.exports = { monter, CSS };


};
