// Adapted from Plagni/atlas 227e897b68fbbaf2d6436084526519bf28ededf8. AGPL-3.0-only.
module.exports = function nativeModule(require, module, __dirname) {
'use strict';

// =============================================================================
//  Page /metis/securite — le Security Center (01/11/2026), réservé à Master.
//  Rendu SERVEUR complet (lisible sans JavaScript) ; /metis/securite.js ajoute les
//  filtres du mur, la fiche au clic et le rafraîchissement quand l'état change.
//  Maquette validée par Nolan : palette Métis, pleine largeur, rail « plan du jour ».
// =============================================================================

const crypto = require('node:crypto');
const S = require('../modules/metis-securite');

const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const HEURE = new Intl.DateTimeFormat('fr-FR', { timeZone: 'Europe/Paris', hour: '2-digit', minute: '2-digit' });
const DATE_LONGUE = new Intl.DateTimeFormat('fr-FR', { timeZone: 'Europe/Paris', weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
const DATE_COURTE = new Intl.DateTimeFormat('fr-FR', { timeZone: 'Europe/Paris', day: 'numeric', month: 'short' });
const hh = (iso) => iso ? HEURE.format(new Date(iso)) : '—';
const h2 = (n) => String(n).padStart(2, '0');
const LIB = { critique: 'Critique', haute: 'Haute', moyenne: 'Moyenne', basse: 'Basse', saine: 'Saine', jamais: 'Jamais audité' };
const LIB_STATUT = { nouvelle: 'Nouvelle', confirmee: 'Confirmée', pr_ouverte: 'PR ouverte', corrigee: 'Corrigée, à revalider', revalidee: 'Revalidée', faux_positif: 'Faux positif', acceptee: 'Risque accepté' };
const LIB_ETAT = { prevu: 'à venir', en_cours: 'en cours', termine: 'terminé', reporte: 'reporté', echec: 'échec' };
const LIB_ETAPE = { plan: 'Plan reçu', lecture: 'Code lu', tests: 'Tests', rapport: 'Rapport' };

function ilYa(iso, maintenant) {
  if (!iso) return 'jamais';
  const j = Math.floor((Date.parse(maintenant) - Date.parse(iso)) / 86400e3);
  if (j <= 0) return 'aujourd’hui ' + hh(iso);
  if (j === 1) return 'hier';
  return 'il y a ' + j + ' j';
}
function compte(f) {
  const l = [];
  if (f.critique) l.push(f.critique + ' critique');
  if (f.haute) l.push(f.haute + ' haute' + (f.haute > 1 ? 's' : ''));
  if (f.moyenne) l.push(f.moyenne + ' moyenne' + (f.moyenne > 1 ? 's' : ''));
  if (f.basse) l.push(f.basse + ' basse' + (f.basse > 1 ? 's' : ''));
  return l;
}

const CSS = `
.sc{--sc-crit:#e5484d;--sc-haute:#f08c3a;--sc-moy:#e9c46a;--sc-basse:#7aa7e0;--sc-saine:#9fcbbf;--sc-ok:#2f7d6b;--sc-encre:#141413;--sc-tuile:rgba(20,20,19,.04);--sc-hachure:#c9c6bc;--sc-journal:rgba(20,20,19,.05)}
@media (prefers-color-scheme:dark){:root:not([data-theme="light"]) .sc{--sc-saine:#3f6b62;--sc-ok:#7fc8b4;--sc-tuile:#2d2c2a;--sc-hachure:#5a5955;--sc-journal:#1b1a19}}
:root[data-theme="dark"] .sc{--sc-saine:#3f6b62;--sc-ok:#7fc8b4;--sc-tuile:#2d2c2a;--sc-hachure:#5a5955;--sc-journal:#1b1a19}
.sc{display:flex;flex-direction:column;gap:22px}
.sc h1,.sc h2{font-family:var(--serif);font-weight:500;margin:0}
.sc h1{font-size:44px;line-height:1.1;letter-spacing:-.01em}
.sc h2{font-size:22px}
.sc-mono{font-family:'JetBrains Mono',ui-monospace,SFMono-Regular,Consolas,monospace}
.sc-tete{display:flex;flex-wrap:wrap;gap:18px;align-items:flex-end;justify-content:space-between}
.sc-sur{font-size:12px;letter-spacing:.14em;text-transform:uppercase;color:var(--texte2)}
.sc-meta{color:var(--texte2);font-size:14px}
.sc-actions{display:flex;flex-wrap:wrap;gap:10px;align-items:center}
.sc-pastille{display:inline-flex;align-items:center;gap:8px;padding:8px 12px;border:1px solid var(--ligne);border-radius:999px;font-size:13px;color:var(--texte2)}
.sc-pastille.alerte{border-color:rgba(233,196,106,.6);color:var(--texte)}
.sc-point{width:8px;height:8px;border-radius:50%;background:var(--sc-ok);flex:0 0 auto}
.sc-point.eteint{background:var(--sc-moy)}
.sc-bouton{display:inline-flex;align-items:center;min-height:44px;padding:0 14px;border-radius:10px;border:1px solid var(--ligne);color:var(--texte);text-decoration:none;font-size:13px;background:transparent}
.sc-bouton:hover{background:var(--survol)}
.sc-bouton.plein{background:var(--acc);border-color:var(--acc);color:var(--sc-encre);font-weight:600}
.sc-corps{display:flex;flex-wrap:wrap;gap:22px;align-items:flex-start}
.sc-principal{flex:999 1 720px;min-width:0;display:flex;flex-direction:column;gap:22px}
.sc-rail{flex:1 1 320px;min-width:0;display:flex;flex-direction:column;gap:16px}
.sc-carte{background:var(--carte);border:1px solid var(--ligne);border-radius:14px;padding:20px 22px;display:flex;flex-direction:column;gap:14px;min-width:0}
.sc-carte.vive{border-color:rgba(217,119,87,.45)}
.sc-titre{display:flex;flex-wrap:wrap;justify-content:space-between;align-items:baseline;gap:10px}
.sc-titre small{font-size:12px;color:var(--texte2)}
.sc-kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:16px}
.sc-kpi{gap:10px;padding:18px 20px}
.sc-kpi .lib{font-size:13px;color:var(--texte2)}
.sc-kpi .val{display:flex;align-items:baseline;gap:8px}
.sc-kpi .val b{font-family:var(--serif);font-weight:500;font-size:46px;line-height:1}
.sc-kpi .val span{font-size:20px;color:var(--texte2)}
.sc-kpi .sous{font-size:12px;color:var(--texte2)}
.sc-barre{display:flex;height:8px;border-radius:4px;overflow:hidden;gap:2px;background:var(--survol)}
.sc-barre i{display:block;min-width:4px}
.sc-legende{display:flex;flex-wrap:wrap;gap:4px 14px;font-size:12px;color:var(--texte2)}
.sc-legende span{display:inline-flex;align-items:center;gap:6px}
.sc-legende i{width:12px;height:12px;border-radius:3px;box-sizing:border-box;display:inline-block}
.sc-mini{display:grid;grid-template-columns:repeat(23,minmax(0,1fr));gap:3px}
.sc-mini i{height:18px;border-radius:3px;box-sizing:border-box}
.sc-jauge{height:8px;border-radius:4px;background:var(--survol);overflow:hidden}.sc-jauge i{display:block;height:100%;background:var(--sc-ok);border-radius:4px}
.sc-etiq{display:inline-block;font-size:12px;padding:3px 9px;border-radius:999px;background:var(--survol);color:var(--texte2)}
.sc-etiq.rouge{background:rgba(229,72,77,.16);color:var(--texte)}
.sc-etiq.ambre{background:rgba(233,196,106,.18);color:var(--texte)}
.sc-etiq.vert{background:rgba(63,107,98,.25);color:var(--texte)}
.sc-etiq.terre{background:rgba(217,119,87,.16);color:var(--texte)}
.sc-badge{font-size:12px;padding:3px 9px;border-radius:6px;border:1px solid var(--ligne);color:var(--texte2)}
.sc-deux{display:flex;flex-wrap:wrap;gap:16px}.sc-deux>*{flex:1 1 400px}
.sc-direct{display:flex;align-items:center;gap:8px;font-size:12px;letter-spacing:.12em;text-transform:uppercase;color:var(--acc)}
.sc-direct i{width:9px;height:9px;border-radius:50%;background:var(--acc)}
.sc-depot{display:flex;flex-wrap:wrap;align-items:baseline;gap:10px}
.sc-depot b{font-family:var(--serif);font-weight:500;font-size:32px;line-height:1.1;overflow-wrap:anywhere}
.sc-etapes{list-style:none;margin:0;padding:0;display:grid;grid-template-columns:repeat(auto-fit,minmax(120px,1fr));gap:8px}
.sc-etapes li{display:flex;flex-direction:column;gap:3px;padding:10px 12px;border-radius:10px;background:var(--sc-tuile);border:1px solid transparent;font-size:12px;color:var(--texte2)}
.sc-etapes li b{font-size:13px;color:var(--texte)}
.sc-etapes li.fait .m{color:var(--sc-ok)}.sc-etapes li.ici{border-color:rgba(217,119,87,.5)}.sc-etapes li.ici .m{color:var(--acc)}
.sc-etapes .m{font-weight:700}
.sc-journal{background:var(--sc-journal);border-radius:10px;padding:12px 14px;font-size:12px;line-height:1.7;color:var(--texte2);overflow-x:auto;margin:0}
.sc-journal div{white-space:pre-wrap;overflow-wrap:anywhere}
.sc-journal span{color:var(--pale);margin-right:10px}
.sc-ruban{display:grid;grid-template-columns:repeat(24,minmax(0,1fr));gap:4px}
.sc-ruban div{display:flex;flex-direction:column;gap:6px;min-width:0}
.sc-ruban span{font-size:11px;color:var(--texte2);text-align:center}
.sc-ruban i{display:flex;align-items:flex-end;justify-content:center;height:62px;border-radius:6px;box-sizing:border-box;padding-bottom:6px;font-style:normal;font-size:12px;font-weight:700;color:var(--sc-encre)}
.sc-histo{display:grid;grid-template-columns:repeat(14,minmax(0,1fr));gap:6px;align-items:end;height:72px}
.sc-histo i{display:block;border-radius:3px 3px 0 0;background:var(--ligne);min-height:3px}
.sc-histo i.auj{background:var(--acc)}
.sc-axe{display:flex;justify-content:space-between;font-size:11px;color:var(--texte2)}
.f-critique{background:var(--sc-crit)}.f-haute{background:var(--sc-haute)}.f-moyenne{background:var(--sc-moy)}.f-basse{background:var(--sc-basse)}.f-saine,.f-rien{background:var(--sc-saine)}
.f-plan,.f-en_cours{background:var(--acc)}.f-prevu,.f-jamais{background:transparent;border:1px dashed var(--pale)}
.f-reporte{background:repeating-linear-gradient(135deg,var(--sc-hachure) 0 3px,transparent 3px 6px);border:1px solid var(--ligne)}
.f-echec{background:repeating-linear-gradient(45deg,var(--sc-crit) 0 2px,transparent 2px 6px);border:1px solid var(--sc-crit)}
.sc-puls{animation:sc-puls 1.6s ease-in-out infinite}
@keyframes sc-puls{0%,100%{opacity:1}50%{opacity:.35}}
.sc-filtres{display:flex;flex-wrap:wrap;gap:8px}
.sc-filtre{font:inherit;font-size:13px;min-height:36px;padding:6px 12px;border-radius:999px;border:1px solid var(--ligne);background:transparent;color:var(--texte);cursor:pointer}
.sc-filtre[aria-pressed="true"]{background:var(--texte);color:var(--fond);border-color:var(--texte);font-weight:600}
.sc-filtre span{opacity:.7;margin-left:4px}
.sc-mur{display:flex;flex-wrap:wrap;gap:20px;align-items:flex-start}
.sc-mur-cases{flex:999 1 520px;min-width:0;display:flex;flex-direction:column;gap:18px}
.sc-groupe{display:flex;flex-direction:column;gap:10px}
.sc-groupe>b{font-size:12px;letter-spacing:.1em;text-transform:uppercase;color:var(--texte2);font-weight:500}
.sc-cases{display:grid;gap:5px}
.sc-cases.nommees{grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:8px}
.sc-cases.moyennes{grid-template-columns:repeat(auto-fill,minmax(26px,1fr))}
.sc-cases.petites{grid-template-columns:repeat(auto-fill,minmax(18px,1fr));gap:4px}
.sc-t{font:inherit;cursor:pointer;box-sizing:border-box;border:1px solid transparent;padding:0;border-radius:5px;aspect-ratio:1;transition:transform .12s ease}
.sc-t:hover{transform:translateY(-2px);box-shadow:0 0 0 1px var(--texte)}
.sc-t:focus-visible,.sc-filtre:focus-visible,.sc-bouton:focus-visible{outline:3px solid var(--acc);outline-offset:2px}
.sc-t.vu{box-shadow:0 0 0 2px var(--carte),0 0 0 3px var(--texte)}
.sc-t.f-jamais{border:1px dashed var(--pale)}
.sc-t.choisi{border:2px solid var(--texte)}
.sc-cases.nommees .sc-t{aspect-ratio:auto;min-height:56px;padding:9px 11px;border-radius:10px;background:var(--sc-tuile);border:1px solid var(--ligne);display:flex;flex-direction:column;gap:4px;text-align:left;color:var(--texte)}
.sc-cases.nommees .sc-t.choisi{border-color:var(--texte)}
.sc-cases.nommees .sc-t span{display:flex;align-items:center;gap:8px;min-width:0;font-size:13px;font-weight:600}
.sc-cases.nommees .sc-t span em{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-style:normal}
.sc-cases.nommees .sc-t small{font-size:11px;color:var(--texte2)}
.sc-cases.nommees .sc-t i{width:10px;height:10px;border-radius:3px;flex:0 0 auto;box-sizing:border-box}
.sc-cases.petites .sc-t{border-radius:4px}
.sc [hidden]{display:none!important}
.sc-fiche{flex:1 1 260px;min-width:0;background:var(--fond);border:1px solid var(--ligne);border-radius:12px;padding:18px;display:flex;flex-direction:column;gap:12px}
.sc-fiche .nom{font-family:var(--serif);font-size:26px;line-height:1.15;overflow-wrap:anywhere}
.sc-fiche dl{margin:0;display:grid;grid-template-columns:auto minmax(0,1fr);gap:8px 14px;font-size:13px}
.sc-fiche dt{color:var(--texte2)}.sc-fiche dd{margin:0}
.sc-sev{display:inline-block;font-size:12px;font-weight:700;padding:3px 9px;border-radius:6px;color:var(--sc-encre)}
.sc-sev.f-saine{color:var(--texte)}.sc-sev.f-jamais{color:var(--texte2)}
.sc-chemin{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:8px}
.sc-chemin div{background:var(--sc-tuile);border-radius:10px;padding:12px;display:flex;flex-direction:column;gap:4px;position:relative}
.sc-chemin b{font-family:var(--serif);font-weight:500;font-size:30px;line-height:1}
.sc-chemin span{font-size:12px;color:var(--texte2)}
.sc-liste{display:flex;flex-direction:column}
.sc-faille{border-top:1px solid var(--ligne)}
.sc-faille summary{display:flex;flex-wrap:wrap;align-items:center;gap:10px 16px;padding:12px 6px;cursor:pointer;list-style:none}
.sc-faille summary::-webkit-details-marker{display:none}
.sc-faille summary:hover{background:var(--survol)}
.sc-faille .sc-sev{width:84px;text-align:center;flex:0 0 auto}
.sc-faille .quoi{flex:999 1 300px;min-width:0;display:flex;flex-direction:column;gap:2px}
.sc-faille .quoi b{font-weight:600}
.sc-faille .quoi small{font-size:12px;color:var(--texte2);overflow-wrap:anywhere}
.sc-faille .quand{font-size:12px;color:var(--texte2);width:92px;text-align:right;flex:0 0 auto}
.sc-faille .detail{padding:4px 6px 16px 106px;display:flex;flex-direction:column;gap:10px;font-size:13px;color:var(--texte2)}
.sc-faille .detail h3{font-size:12px;letter-spacing:.08em;text-transform:uppercase;margin:6px 0 0;color:var(--texte2);font-weight:500}
.sc-faille .detail ul{margin:0;padding-left:18px;display:flex;flex-direction:column;gap:4px}
.sc-faille .detail pre{margin:0;white-space:pre-wrap;overflow-wrap:anywhere;background:var(--sc-journal);border-radius:8px;padding:8px 10px;font-size:12px}
.sc-tableau{overflow-x:auto}
.sc-tableau table{width:100%;border-collapse:collapse;font-size:13px;min-width:680px}
.sc-tableau th{text-align:left;font-weight:500;color:var(--texte2);padding:8px}
.sc-tableau td{padding:11px 8px;border-top:1px solid var(--ligne);vertical-align:top}
.sc-plan{list-style:none;margin:0;padding:0;display:flex;flex-direction:column}
.sc-plan li{display:grid;grid-template-columns:44px 14px minmax(0,1fr) auto;gap:10px;align-items:center;padding:8px 0;border-top:1px solid var(--ligne)}
.sc-plan li>span:first-child{font-size:12px;color:var(--texte2)}
.sc-plan li i{width:10px;height:10px;border-radius:50%;justify-self:center;box-sizing:border-box}
.sc-plan li div{display:flex;flex-direction:column;min-width:0}
.sc-plan li div b{font-size:13px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.sc-plan li div small{font-size:12px;color:var(--texte2);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.sc-res{font-size:11px;font-weight:600;padding:3px 8px;border-radius:999px;white-space:nowrap;background:var(--survol);color:var(--texte2)}
.sc-res.f-critique,.sc-res.f-haute,.sc-res.f-moyenne,.sc-res.f-basse{color:var(--sc-encre)}
.sc-res.f-critique{background:var(--sc-crit)}.sc-res.f-haute{background:var(--sc-haute)}.sc-res.f-moyenne{background:var(--sc-moy)}.sc-res.f-basse{background:var(--sc-basse)}
.sc-res.f-en_cours{background:rgba(217,119,87,.18);color:var(--texte)}
.sc-res.f-rien{background:rgba(63,107,98,.25);color:var(--texte)}
.sc-res.f-prevu{background:transparent;border:1px dashed var(--pale)}
.sc-res.f-reporte{background:rgba(233,196,106,.18);color:var(--texte);border:0}
.sc-res.f-echec{background:rgba(229,72,77,.16);color:var(--texte);border:0}
.sc-priorites{background:rgba(217,119,87,.10);border-radius:10px;padding:12px 14px;display:flex;flex-direction:column;gap:4px;font-size:13px}
.sc-priorites span{font-size:12px;color:var(--acc)}
.sc-regles{margin:0;padding-left:18px;color:var(--texte2);font-size:13px;display:flex;flex-direction:column;gap:6px}
.sc-sante{margin:0;display:grid;grid-template-columns:minmax(0,1fr) auto;gap:8px 12px;font-size:13px}
.sc-sante dt{color:var(--texte2)}.sc-sante dd{margin:0;text-align:right}
.sc-vide{color:var(--texte2);font-size:13px;margin:0}
.sc-note{font-size:12px;color:var(--texte2);margin:0}
.sc-t.imp-faible{opacity:.55}
.sc-t.imp-mort{opacity:.22}
.sc-t.imp-faible:hover,.sc-t.imp-mort:hover,.sc-t.imp-faible.choisi,.sc-t.imp-mort.choisi,.sc-t.imp-faible:focus-visible,.sc-t.imp-mort:focus-visible{opacity:1}
.sc-imp{display:inline-block;font-size:12px;padding:3px 9px;border-radius:6px;border:1px solid var(--ligne);color:var(--texte2)}
.sc-imp.mort{text-decoration:line-through;text-decoration-thickness:1px}
.sc-classer{display:flex;flex-direction:column;gap:8px;border-top:1px solid var(--ligne);padding-top:12px}
.sc-classer label{display:flex;flex-direction:column;gap:4px;font-size:12px;color:var(--texte2)}
.sc-classer select,.sc-classer input{font:inherit;font-size:13px;color:var(--texte);background:var(--carte);border:1px solid var(--ligne);border-radius:8px;padding:8px 10px;min-height:40px;box-sizing:border-box;width:100%}
.sc-classer button{font:inherit;font-size:13px;min-height:40px;border-radius:8px;border:1px solid var(--ligne);background:var(--texte);color:var(--fond);font-weight:600;cursor:pointer}
.sc-erreur{border:1px solid rgba(229,72,77,.5);background:rgba(229,72,77,.10);border-radius:10px;padding:10px 14px;font-size:13px}
.sc-vue{gap:18px}
.sc-agents{display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:16px}
.sc-agent{background:var(--sc-tuile);border:1px solid var(--ligne);border-radius:12px;padding:18px 20px;display:flex;flex-direction:column;gap:8px;min-width:0}
.sc-agent-tete{display:flex;align-items:center;gap:10px;flex-wrap:wrap}
.sc-agent-tete b{font-size:16px;font-weight:600;flex:1 1 auto}
.sc-agent-ico{display:inline-flex;width:28px;height:28px;align-items:center;justify-content:center;border-radius:8px;background:var(--survol)}
.sc-agent[data-agent="auditeur"] .sc-agent-ico{color:var(--sc-basse)}.sc-agent[data-agent="gestionnaire"] .sc-agent-ico{color:var(--sc-ok)}
.sc-agent-role{font-size:13px;color:var(--texte2)}
.sc-agent-horaire{font-family:var(--serif);font-weight:500;font-size:34px;line-height:1.1}
.sc-agent-desc{font-size:13px}
.sc-agent-msg{margin:4px 0 0;font-size:13px;color:var(--texte)}
.sc-agent dl{margin:0;display:grid;grid-template-columns:auto minmax(0,1fr);gap:6px 14px;font-size:13px;border-top:1px solid var(--ligne);padding-top:10px}
.sc-agent dt{color:var(--texte2)}.sc-agent dd{margin:0;overflow-wrap:anywhere}
.sc-blocage{margin:0;font-size:13px;border-radius:8px;padding:8px 10px;background:rgba(233,196,106,.16);border:1px solid rgba(233,196,106,.45)}
.sc-blocage.rouge{background:rgba(229,72,77,.10);border-color:rgba(229,72,77,.45)}
.sc-ea{display:inline-flex;align-items:center;gap:6px;font-size:12px;padding:3px 10px;border-radius:999px;background:var(--survol);color:var(--texte2);white-space:nowrap}
.sc-ea i{width:7px;height:7px;border-radius:50%;background:var(--pale)}
.sc-ea.e-a_l_heure i{background:var(--sc-ok)}.sc-ea.e-en_cours i{background:var(--acc)}.sc-ea.e-en_retard i{background:var(--sc-moy)}.sc-ea.e-echec i,.sc-ea.e-interrompu i{background:var(--sc-crit)}
.sc-ea.e-en_cours{color:var(--texte)}.sc-ea.e-en_retard,.sc-ea.e-echec,.sc-ea.e-interrompu{color:var(--texte)}
.sc-cycle{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:22px;border-top:1px solid var(--ligne);padding-top:14px}
.sc-cycle div{position:relative;display:flex;flex-direction:column;align-items:center;gap:4px;text-align:center}
.sc-cycle div+div::before{content:'›';position:absolute;left:-16px;top:6px;font-size:18px;color:var(--pale)}
.sc-cycle b{font-family:var(--serif);font-weight:500;font-size:30px;line-height:1}
.sc-cycle span{font-size:12px;color:var(--texte2)}
.sc-gkpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:8px}
.sc-gkpis div{background:var(--sc-tuile);border-radius:10px;padding:12px;display:flex;flex-direction:column;gap:4px}
.sc-gkpis b{font-family:var(--serif);font-weight:500;font-size:30px;line-height:1}
.sc-gkpis span{font-size:12px;color:var(--texte2)}
.sc-ops{list-style:none;margin:0;padding:0;display:flex;flex-direction:column}
.sc-ops li{display:grid;grid-template-columns:minmax(52px,auto) minmax(0,1fr) auto;gap:10px;align-items:start;padding:9px 4px;border-top:1px solid var(--ligne);font-size:13px}
.sc-ops li>span:first-child{font-size:12px;color:var(--texte2);white-space:nowrap;padding-top:1px}
.sc-ops li div{display:flex;flex-direction:column;gap:2px;min-width:0}
.sc-ops li div small{font-size:12px;color:var(--texte2);overflow-wrap:anywhere}
.sc-ops li div em{font-style:normal;font-size:12px;color:var(--texte);overflow-wrap:anywhere}
.sc-ops li.err{box-shadow:inset 3px 0 0 var(--sc-crit);padding-left:10px}
.sc-ops .sc-res{max-width:180px;overflow:hidden;text-overflow:ellipsis}
@media (prefers-reduced-motion:reduce){.sc-puls{animation:none}.sc-t{transition:none}.sc-t:hover{transform:none}}
@media (max-width:700px){.sc h1{font-size:34px}.sc-chemin{grid-template-columns:repeat(2,minmax(0,1fr))}.sc-cycle{gap:12px}.sc-cycle div+div::before{left:-10px}.sc-cycle b{font-size:24px}.sc-cycle span{font-size:10px}.sc-agent-horaire{font-size:28px}.sc-ops li{grid-template-columns:auto minmax(0,1fr)}.sc-ops .sc-res{grid-column:2;justify-self:start}.sc-faille .detail{padding-left:6px}.sc-ruban span{font-size:9px}}
`;

function versionDe(e) {
  const base = JSON.stringify([e.plan && e.plan.etabli_le, e.creneaux.map((c) => [c.id, c.etat, c.derniere_activite, c.etape]), e.failles.map((f) => [f.id, f.statut, f.maj_le]), e.depots.length, e.corrections, e.depots.map((d) => d.importance.niveau[0]).join(''),
    e.agents.auditeur.etat, e.agents.gestionnaire.etat, e.agents.gestionnaire.prochain_passage, (e.journaux.audits[0] || {}).id, (e.journaux.gestion[0] || {}).id]);
  return crypto.createHash('sha1').update(base).digest('hex').slice(0, 16);
}

function tuile(d, maintenant, prochain, choisi) {
  const c = compte(d.failles);
  const titre = d.nom_complet + ' — ' + LIB[d.statut] + (c.length ? ' (' + c.join(', ') + ')' : '') + ' · dernier audit : ' + ilYa(d.dernier_audit, maintenant);
  const vu = d.dernier_audit && Date.parse(maintenant) - Date.parse(d.dernier_audit) < 86400e3 && ilYa(d.dernier_audit, maintenant).startsWith('aujourd');
  const data = ' data-nom="' + esc(d.nom_complet) + '" data-famille="' + d.famille + '" data-public="' + (d.public ? 1 : 0) + '" data-statut="' + d.statut
    + '" data-comptes="' + esc(c.join(', ') || (d.statut === 'jamais' ? 'aucun audit' : 'aucune déclarée')) + '" data-dernier="' + esc(ilYa(d.dernier_audit, maintenant))
    + '" data-prochain="' + esc(prochain || 'non planifié aujourd’hui') + '" data-n30="' + d.audits_30j + '" data-angles="' + esc(d.angles.join(' · '))
    + '" data-groupe="' + esc(S.LIBELLE_FAMILLE[d.famille] + ' · ' + d.proprietaire) + '" data-visibilite="' + (d.public ? 'Public' : 'Privé')
    + '" data-importance="' + d.importance.niveau + '" data-imp-raison="' + esc(d.importance.raison) + '" data-imp-source="' + d.importance.source + '"';
  const imp = d.importance.niveau;
  const cls = 'sc-t' + (d.famille === 'ecosysteme' ? '' : ' f-' + d.statut) + (imp !== 'actif' ? ' imp-' + imp : '') + (vu ? ' vu' : '') + (choisi ? ' choisi' : '');
  const titreComplet = titre + (imp !== 'actif' ? ' · ' + LIB_IMP[imp].toLowerCase() : '');
  if (d.famille === 'ecosysteme') {
    return '<button type="button" class="' + cls + '" title="' + esc(titreComplet) + '" aria-label="' + esc(titreComplet) + '"' + data + '><span><i class="f-' + d.statut + '"></i><em>' + esc(d.nom) + '</em></span><small>'
      + esc((imp !== 'actif' ? LIB_IMP[imp].toLowerCase() + ' · ' : '') + (d.statut === 'jamais' ? 'jamais audité' : (c.length ? c.join(' · ') : 'saine') + (vu ? ' · vu aujourd’hui' : ''))) + '</small></button>';
  }
  return '<button type="button" class="' + cls + '" title="' + esc(titreComplet) + '" aria-label="' + esc(titreComplet) + '"' + data + '></button>';
}
const LIB_IMP = { actif: 'Actif', faible: 'Peu important', mort: 'Mort' };

// ── Les deux agents (demande de Silly, 01/11/2026) ──
const ICO = {
  auditeur: '<svg viewBox="0 0 20 20" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" aria-hidden="true"><path d="M2 6V3.5A1.5 1.5 0 0 1 3.5 2H6M14 2h2.5A1.5 1.5 0 0 1 18 3.5V6M18 14v2.5a1.5 1.5 0 0 1-1.5 1.5H14M6 18H3.5A1.5 1.5 0 0 1 2 16.5V14"/><circle cx="9.5" cy="9.5" r="3.2"/><path d="m12 12 2.4 2.4"/></svg>',
  gestionnaire: '<svg viewBox="0 0 20 20" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10 2 3.5 4.5v5c0 4 2.8 6.9 6.5 8.5 3.7-1.6 6.5-4.5 6.5-8.5v-5Z"/><path d="m7 10 2.2 2.2L13.5 8"/></svg>',
};
const JOUR_PARIS = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit', day: '2-digit' });
/** « 14:05 » le jour même, « 31 oct. 14:05 » sinon. */
function quand(iso, maintenant) {
  if (!iso) return '—';
  const d = new Date(iso);
  return JOUR_PARIS.format(d) === JOUR_PARIS.format(new Date(maintenant)) ? hh(iso) : DATE_COURTE.format(d) + ' ' + hh(iso);
}
const pluriel = (n, un, plusieurs) => n + ' ' + (n > 1 ? plusieurs : un);
const LIB_PASSAGE = { en_cours: 'en cours', termine: 'terminé', echec: 'en échec', interrompu: 'interrompu' };

function pastilleAgent(a) {
  return '<span class="sc-ea e-' + a.etat + '"><i' + (a.etat === 'en_cours' ? ' class="sc-puls"' : '') + '></i>' + esc(a.nom) + ' · ' + esc(a.libelle_etat) + '</span>';
}
function carteAgent(a, puces, lignes) {
  return '<article class="sc-agent" data-agent="' + a.agent + '" data-etat="' + a.etat + '"><div class="sc-agent-tete"><span class="sc-agent-ico">' + ICO[a.agent] + '</span><b>' + esc(a.nom) + '</b>'
    + '<span class="sc-ea e-' + a.etat + '"><i' + (a.etat === 'en_cours' ? ' class="sc-puls"' : '') + '></i>' + esc(a.libelle_etat) + '</span></div>'
    + '<div class="sc-agent-role">' + esc(a.role) + '</div><div class="sc-agent-horaire">' + esc(a.horaire) + '</div><div class="sc-agent-desc">' + esc(a.description) + '</div>'
    + '<div class="sc-actions" style="gap:6px">' + puces.map((p) => '<span class="sc-etiq">' + esc(p) + '</span>').join('') + '</div>'
    + '<p class="sc-agent-msg">' + esc(a.message) + '</p>'
    + (a.blocage ? '<p class="sc-blocage' + (a.etat === 'echec' || a.etat === 'interrompu' ? ' rouge' : '') + '" role="status"><b>Blocage :</b> ' + esc(a.blocage) + '</p>' : '')
    + '<dl>' + lignes.map(([t, v]) => '<dt>' + esc(t) + '</dt><dd>' + v + '</dd>').join('') + '</dl></article>';
}
function journalAgent(id, titre, sous, ops, m, vide) {
  const lignes = ops.map((o) => '<li' + (o.erreur ? ' class="err"' : '') + '><span class="sc-mono">' + esc(quand(o.le, m)) + '</span><div><b>' + esc(o.action) + '</b>'
    + (o.cible ? '<small class="sc-mono">' + esc(o.cible) + '</small>' : '') + (o.agent === 'hors_routine' ? '<small>hors d’un passage du gestionnaire</small>' : '')
    + (o.erreur ? '<em>Erreur : ' + esc(o.erreur) + '</em>' : '') + '</div>'
    + (o.resultat ? '<span class="sc-res' + (o.erreur ? ' f-echec' : '') + '" title="' + esc(o.resultat) + '">' + esc(o.resultat) + '</span>' : o.erreur ? '<span class="sc-res f-echec">erreur</span>' : '<span></span>') + '</li>').join('');
  return '<section class="sc-carte" id="' + id + '"><div class="sc-titre"><h2>' + titre + '</h2><small>' + sous + '</small></div>'
    + (lignes ? '<ol class="sc-ops">' + lignes + '</ol>' : '<p class="sc-vide">' + vide + '</p>') + '</section>';
}
const LIB_SOURCE = { manuel: 'réglé à la main', base: 'classement de base', auto: 'règle automatique', defaut: 'par défaut' };

function render(e, options = {}) {
  const m = e.maintenant;
  const R = e.resume;
  const parHeure = {}; for (const c of e.creneaux) parHeure[c.heure] = c;
  const prochainDe = {};
  for (const c of e.creneaux) if (c.etat === 'prevu' && !prochainDe[c.depot]) prochainDe[c.depot] = 'aujourd’hui ' + h2(c.heure) + ':00';
  const resultatDe = (c) => {
    if (!c) return { cls: 'prevu', txt: '' };
    if (c.etat === 'termine') {
      if (c.resultat !== 'failles') return { cls: 'rien', txt: 'rien' };
      const fs = e.failles.filter((f) => f.creneau_id === c.id);
      const pire = S.GRAVITES.find((g) => fs.some((f) => f.gravite === g)) || 'basse';
      return { cls: pire, txt: (fs.length || '·') + ' ' + (fs.length > 1 ? 'failles' : 'faille') };
    }
    return { cls: c.etat, txt: LIB_ETAT[c.etat] };
  };

  // ── En-tête : l'état de CHAQUE agent, jamais une « routine » unique ──
  const A = e.agents;
  const G = e.gestion;
  const entete = '<header class="sc-tete"><div><div class="sc-sur">Métis · Security Center</div><h1>Sécurité du parc</h1><div class="sc-meta">'
    + esc(DATE_LONGUE.format(new Date(m)).replace(/^./, (x) => x.toUpperCase())) + ' · '
    + R.depots + ' dépôts suivis' + (R.importance.mort ? ', ' + R.importance.mort + ' morts' : '') + ' · 2 routines automatisées</div></div>'
    + '<div class="sc-actions">' + pastilleAgent(A.auditeur) + pastilleAgent(A.gestionnaire)
    + (e.synchro.ok === false ? '<span class="sc-pastille alerte" title="' + esc(e.synchro.message) + '">Inventaire partiel : dépôts publics seulement</span>' : '')
    + '<a class="sc-bouton" href="#sc-audits">Audits récents</a><a class="sc-bouton plein" href="/metis/securite/etat.json?telecharger=1">Exporter l’état</a></div></header>';

  // ── Indicateurs ──
  const sevs = S.GRAVITES.map((g) => ({ g, n: R.par_gravite[g] }));
  const barre = R.failles_ouvertes ? sevs.filter((s) => s.n).map((s) => '<i class="f-' + s.g + '" style="flex:' + s.n + ' 1 0"></i>').join('') : '';
  const lib = { critique: ['critique', 'critiques'], haute: ['haute', 'hautes'], moyenne: ['moyenne', 'moyennes'], basse: ['basse', 'basses'] };
  const mini = []; for (let h = 1; h <= 23; h++) { const c = parHeure[h]; mini.push('<i class="f-' + (c ? resultatDe(c).cls : 'prevu') + '" title="' + h2(h) + ' h' + (c ? ' · ' + esc(c.depot) : ' · non planifié') + '"></i>'); }
  const C = R.creneaux;
  const fait = C.termines + C.echecs;
  const kpis = '<section class="sc-kpis" aria-label="Indicateurs">'
    + '<div class="sc-carte sc-kpi"><div class="lib">Failles ouvertes</div><div class="val"><b>' + R.failles_ouvertes + '</b><span style="font-size:13px">déclarées</span></div><div class="sc-barre">' + barre + '</div>'
    + '<div class="sc-legende">' + sevs.map((s) => '<span><i class="f-' + s.g + '"></i>' + s.n + ' ' + lib[s.g][s.n > 1 ? 1 : 0] + '</span>').join('') + '</div></div>'
    + '<div class="sc-carte sc-kpi"><div class="lib">Audits du jour</div><div class="val"><b>' + fait + '</b><span>/ ' + (e.creneaux.length || 23) + '</span></div><div class="sc-mini">' + mini.join('') + '</div>'
    + '<div class="sous">' + C.en_cours + ' en cours · ' + C.prevus + ' à venir · ' + C.reportes + ' reporté' + (C.reportes > 1 ? 's' : '') + (C.echecs ? ' · ' + C.echecs + ' échec' + (C.echecs > 1 ? 's' : '') : '') + '</div></div>'
    + '<div class="sc-carte sc-kpi"><div class="lib">Couverture sur 30 jours</div><div class="val"><b>' + R.couverture_30j + '</b><span>%</span></div><div class="sc-jauge"><i style="width:' + R.couverture_30j + '%"></i></div>'
    + '<div class="sous">' + R.depots_vus_30j + ' vus sur ' + R.depots + ' suivis · ' + R.jamais_audites + ' jamais audités · ' + R.importance.actif + ' actifs, ' + R.importance.faible + ' peu importants</div></div>'
    + '<div class="sc-carte sc-kpi"><div class="lib">Correction</div><div class="val"><b>' + (R.delai_median_jours == null ? '—' : String(Math.round(R.delai_median_jours * 10) / 10).replace('.', ',')) + '</b><span>' + (R.delai_median_jours == null ? '' : 'j') + '</span></div>'
    + '<div class="sous">délai médian entre la découverte et la PR</div><div class="sc-actions" style="gap:6px"><span class="sc-etiq terre">' + R.prs_a_relire + ' PR à relire</span><span class="sc-etiq ambre">' + e.corrections.corrigee + ' à revalider</span></div></div>'
    + '</section>';

  // ── Vue globale : les deux agents et le cycle de vie ──
  const au = A.auditeur, ge = A.gestionnaire;
  const dpA = au.dernier_passage;
  const lignesAuditeur = [
    ['Dernier passage', dpA ? esc(quand(dpA.fin_le || dpA.debut_le || dpA.jour + 'T12:00:00Z', m)) + ' · ' + esc(dpA.depot.split('/')[1] || dpA.depot) + ' — ' + esc(LIB_ETAT[dpA.etat]) : 'jamais'],
    ['Prochain passage', au.prochain_passage ? esc(au.prochain_passage.libelle) + (au.prochain_passage.depot ? ' · ' + esc(au.prochain_passage.depot.split('/')[1] || au.prochain_passage.depot) : ' · ' + esc(au.prochain_passage.angle)) : 'audit en cours'],
    ['Planification', au.planification ? 'reçue à ' + hh(au.planification.le) : '<span style="color:var(--sc-moy)">pas encore aujourd’hui</span>'],
  ];
  const dpG = ge.dernier_passage;
  const lignesGestion = [
    ['Dernier passage', dpG ? esc(quand(dpG.debut_le, m)) + ' — ' + esc(LIB_PASSAGE[dpG.etat] || dpG.etat) + ' · ' + pluriel(dpG.operations, 'opération', 'opérations') : 'jamais'],
    ['Prochain passage', ge.prochain_passage ? esc(ge.prochain_passage.libelle) : 'passage en cours'],
    ['Aujourd’hui', ge.aujourdhui.termines + ' terminé' + (ge.aujourdhui.termines > 1 ? 's' : '') + ' sur ' + ge.aujourdhui.attendus + ' attendu' + (ge.aujourdhui.attendus > 1 ? 's' : '')
      + (ge.aujourdhui.interrompus ? ' · ' + ge.aujourdhui.interrompus + ' interrompu' + (ge.aujourdhui.interrompus > 1 ? 's' : '') : '') + (ge.aujourdhui.echecs ? ' · ' + pluriel(ge.aujourdhui.echecs, 'échec', 'échecs') : '')],
  ];
  const aTraiter = G.a_trier + G.corrections_en_cours + G.revalidations_en_attente;
  const K = e.corrections;
  const vue = '<section class="sc-carte sc-vue" aria-labelledby="sc-vue-titre"><div class="sc-titre"><h2 id="sc-vue-titre">Les deux agents</h2><small>chacun suivi séparément · un horaire prévu n’est jamais compté comme un passage réussi</small></div>'
    + '<div class="sc-agents">'
    + carteAgent(au, [pluriel(au.planifies_aujourdhui, 'audit planifié', 'audits planifiés') + ' aujourd’hui'], lignesAuditeur)
    + carteAgent(ge, [pluriel(G.failles_total, 'faille enregistrée', 'failles enregistrées'), aTraiter ? aTraiter + ' à traiter' : 'rien à traiter'], lignesGestion)
    + '</div><div><div style="font-size:13px;font-weight:600;margin-bottom:10px">Cycle de vie des vulnérabilités</div><div class="sc-cycle">'
    + [['nouvelle', 'Nouvelle'], ['confirmee', 'Confirmée'], ['pr_ouverte', 'PR ouverte'], ['corrigee', 'Corrigée'], ['revalidee', 'Revalidée']].map(([k, t]) => '<div><b>' + K[k] + '</b><span>' + t + '</span></div>').join('')
    + '</div></div></section>';

  // ── Audit en cours ──
  let direct;
  const ec = e.en_cours;
  if (ec) {
    const d = e.depots.find((x) => x.nom_complet === ec.depot);
    const idx = S.ETAPES.indexOf(ec.etape || 'plan');
    const etapes = S.ETAPES.map((s, i) => '<li class="' + (i < idx ? 'fait' : i === idx ? 'ici' : '') + '"><span class="m">' + (i < idx ? '✓' : i === idx ? '●' : '○') + '</span><b>' + LIB_ETAPE[s] + '</b>'
      + (s === 'lecture' && ec.fichiers_lus != null ? ec.fichiers_lus + ' fichiers' : s === 'tests' && ec.job_ref ? esc(ec.job_ref) : i === idx ? 'en cours' : i < idx ? 'fait' : 'à venir') + '</li>').join('');
    direct = '<div class="sc-carte vive"><div class="sc-titre"><span class="sc-direct"><i class="sc-puls"></i>Audit en cours · depuis <time data-depuis="' + esc(ec.debut_le) + '">' + hh(ec.debut_le) + '</time></span>'
      + '<span class="sc-mono" style="font-size:12px;color:var(--texte2)">créneau ' + h2(ec.heure) + ' h' + (ec.job_ref ? ' · ' + esc(ec.job_ref) : '') + '</span></div>'
      + '<div class="sc-depot"><b>' + esc(d ? d.nom : ec.depot) + '</b>' + (d ? '<span class="sc-badge">' + esc(d.proprietaire) + ' · ' + (d.public ? 'public' : 'privé') + '</span>' + (d.langage ? '<span class="sc-badge">' + esc(d.langage) + '</span>' : '') : '') + '</div>'
      + '<div style="color:var(--texte2)"><b style="color:var(--texte)">Angle : ' + esc(ec.angle) + '</b>' + (ec.raison ? ' — ' + esc(ec.raison) : '') + '</div>'
      + '<ol class="sc-etapes">' + etapes + '</ol>'
      + '<div class="sc-journal sc-mono">' + (ec.journal.slice(-6).map((l) => '<div><span>' + hh(l.le) + '</span>' + esc(l.message) + '</div>').join('') || '<div>Aucune ligne de journal pour l’instant.</div>') + '</div>'
      + '<div class="sc-legende"><span>Dernier signe ' + hh(ec.derniere_activite) + '</span><span>Reporté sans signe de vie pendant ' + S.SILENCE_MIN + ' min</span><span>Un seul dépôt par audit</span></div></div>';
  } else {
    const suivant = e.creneaux.find((c) => c.etat === 'prevu');
    direct = '<div class="sc-carte"><div class="sc-titre"><h2>Aucun audit en cours</h2></div><p class="sc-vide">'
      + (suivant ? 'Prochain créneau à ' + h2(suivant.heure) + ':00 : <b style="color:var(--texte)">' + esc(suivant.depot) + '</b> — ' + esc(suivant.angle) + '.' : e.plan ? 'Tous les créneaux du jour sont passés.' : 'La routine de minuit n’a pas encore établi le plan de la journée.')
      + '</p><p class="sc-note">La routine ChatGPT démarre chaque audit par le connecteur ; cette carte s’anime dès qu’elle commence.</p></div>';
  }

  // ── Les 24 heures ──
  const ruban = ['<div><span class="sc-mono">00</span><i class="' + (e.plan ? 'f-plan' : 'f-prevu') + '" title="' + (e.plan ? 'Planification à ' + hh(e.plan.etabli_le) : 'Pas de plan') + '">P</i></div>'];
  for (let h = 1; h <= 23; h++) {
    const c = parHeure[h]; const r = resultatDe(c);
    const n = c && c.etat === 'termine' && c.resultat === 'failles' ? parseInt(r.txt, 10) || '' : '';
    ruban.push('<div><span class="sc-mono">' + h2(h) + '</span><i class="f-' + (c ? r.cls : 'prevu') + (c && c.etat === 'en_cours' ? ' sc-puls' : '') + '" title="' + h2(h) + ' h' + (c ? ' · ' + esc(c.depot) + ' — ' + esc(c.angle) + ' · ' + esc(r.txt) : ' · non planifié') + '"' + (c ? '' : ' style="opacity:.45"') + '>' + n + '</i></div>');
  }
  const maxH = Math.max(1, ...e.histogramme.map((x) => x.failles));
  const histo = e.histogramme.map((x, i) => '<i class="' + (i === 13 ? 'auj' : '') + '" style="height:' + Math.max(3, Math.round(x.failles / maxH * 72)) + 'px" title="' + esc(DATE_COURTE.format(new Date(x.jour + 'T12:00:00Z'))) + ' · ' + x.failles + ' faille' + (x.failles > 1 ? 's' : '') + '"></i>').join('');
  const suivant = e.creneaux.find((c) => c.etat === 'prevu');
  const vingtQuatre = '<div class="sc-carte"><div class="sc-titre"><h2>Les 24 heures des audits</h2><small>auditeur seul · une case = un créneau d’une heure</small></div><div class="sc-ruban">' + ruban.join('') + '</div>'
    + '<div class="sc-legende"><span><i class="f-plan"></i>planification</span><span><i class="f-rien"></i>rien trouvé</span><span><i class="f-haute"></i>failles (la plus grave)</span><span><i class="f-prevu"></i>à venir</span><span><i class="f-reporte"></i>reporté</span><span><i class="f-echec"></i>échec</span></div>'
    + '<div style="border-top:1px solid var(--ligne);padding-top:14px;display:flex;flex-direction:column;gap:10px"><div class="sc-titre" style="font-size:13px"><span style="color:var(--texte2)">Failles déclarées par jour · 14 jours</span><span>' + e.histogramme[13].failles + ' aujourd’hui</span></div>'
    + '<div class="sc-histo">' + histo + '</div><div class="sc-axe sc-mono"><span>' + esc(DATE_COURTE.format(new Date(e.histogramme[0].jour + 'T12:00:00Z'))) + '</span><span>' + esc(DATE_COURTE.format(new Date(e.histogramme[13].jour + 'T12:00:00Z'))) + '</span></div></div>'
    + '<div style="font-size:13px;color:var(--texte2)">' + (suivant ? 'Prochain créneau · <b style="color:var(--texte)">' + h2(suivant.heure) + ':00 · ' + esc(suivant.depot) + '</b> — ' + esc(suivant.angle) : 'Aucun créneau à venir aujourd’hui.') + '</div></div>';

  // ── Le mur ──
  const fam = { ecosysteme: [], apps: [], random: [] };
  const risque = (d) => ['critique', 'haute', 'moyenne'].includes(d.statut);
  const ordre = e.depots.slice().sort((a, b) => ({ critique: 4, haute: 3, moyenne: 2, basse: 1 }[b.statut] || 0) - ({ critique: 4, haute: 3, moyenne: 2, basse: 1 }[a.statut] || 0) || (b.public - a.public));
  const choisi = ordre[0] || null;
  for (const d of e.depots) fam[d.famille].push(tuile(d, m, prochainDe[d.nom_complet], choisi && choisi.nom_complet === d.nom_complet));
  const filtres = [['tous', 'Tous', e.depots.length], ['risque', 'À risque', e.depots.filter(risque).length], ['publics', 'Publics', R.publics], ['jamais', 'Jamais audités', R.jamais_audites],
    ['ecosysteme', S.LIBELLE_FAMILLE.ecosysteme, fam.ecosysteme.length], ['apps', S.LIBELLE_FAMILLE.apps, fam.apps.length], ['random', S.LIBELLE_FAMILLE.random, fam.random.length],
    ['actif', 'Actifs', R.importance.actif], ['faible', 'Peu importants', R.importance.faible], ['mort', 'Morts', R.importance.mort]]
    .map(([id, t, n], i) => '<button type="button" class="sc-filtre" data-filtre="' + id + '" aria-pressed="' + (i === 0) + '">' + esc(t) + '<span>' + n + '</span></button>').join('');
  const groupe = (k, cls) => fam[k].length ? '<div class="sc-groupe" data-groupe="' + k + '"><b>' + esc(S.LIBELLE_FAMILLE[k]) + ' · <span data-compte>' + fam[k].length + '</span></b><div class="sc-cases ' + cls + '">' + fam[k].join('') + '</div></div>' : '';
  const fiche = (d) => {
    if (!d) return '<aside class="sc-fiche" aria-label="Fiche du dépôt"><p class="sc-vide">L’inventaire est vide : la synchronisation avec GitHub n’a encore rien rapporté.</p></aside>';
    const c = compte(d.failles);
    return '<aside class="sc-fiche" aria-label="Fiche du dépôt" aria-live="polite"><div style="display:flex;flex-direction:column;gap:6px"><span class="sc-sur" data-f="groupe">' + esc(S.LIBELLE_FAMILLE[d.famille] + ' · ' + d.proprietaire) + '</span><span class="nom" data-f="nom">' + esc(d.nom_complet) + '</span>'
      + '<div class="sc-actions" style="gap:6px"><span class="sc-sev f-' + d.statut + '" data-f="statut">' + LIB[d.statut] + '</span><span class="sc-badge" data-f="visibilite">' + (d.public ? 'Public' : 'Privé') + '</span>'
      + '<span class="sc-imp ' + d.importance.niveau + '" data-f="importance">' + LIB_IMP[d.importance.niveau] + '</span></div></div>'
      + '<dl><dt>Failles ouvertes</dt><dd data-f="comptes">' + esc(c.join(', ') || (d.statut === 'jamais' ? 'aucun audit' : 'aucune déclarée')) + '</dd><dt>Dernier audit</dt><dd data-f="dernier">' + esc(ilYa(d.dernier_audit, m)) + '</dd>'
      + '<dt>Prochain audit</dt><dd data-f="prochain">' + esc(prochainDe[d.nom_complet] || 'non planifié aujourd’hui') + '</dd><dt>Audits 30 j</dt><dd data-f="n30">' + d.audits_30j + '</dd></dl>'
      + '<div style="display:flex;flex-direction:column;gap:6px"><span style="font-size:12px;color:var(--texte2)">Angles déjà couverts</span><span data-f="angles" style="font-size:13px">' + esc(d.angles.join(' · ') || 'aucun pour l’instant') + '</span></div>'
      + '<p class="sc-note">Statut déclaré par le dernier audit ; une faille sort du compte quand sa correction est fusionnée.</p>'
      + '<form class="sc-classer" method="post" action="/metis/securite/importance"><input type="hidden" name="depot" value="' + esc(d.nom_complet) + '" data-f-champ="depot">'
      + '<span style="font-size:12px;color:var(--texte2)">Importance : <b style="color:var(--texte)" data-f="imp-libelle">' + LIB_IMP[d.importance.niveau] + '</b> · <span data-f="imp-source">' + LIB_SOURCE[d.importance.source] + '</span></span>'
      + '<span style="font-size:12px;color:var(--texte2)" data-f="imp-raison">' + esc(d.importance.raison || '') + '</span>'
      + '<label>Nouveau niveau<select name="importance" data-f-champ="importance">'
      + [['actif', 'Actif — audité normalement'], ['faible', 'Peu important — un audit par mois au plus'], ['mort', 'Mort — plus audité'], ['auto', 'Revenir au classement de base']]
        .map(([v, t]) => '<option value="' + v + '"' + (d.importance.source === 'manuel' && v === d.importance.niveau ? ' selected' : '') + '>' + t + '</option>').join('')
      + '</select></label><label>Raison<input name="raison" maxlength="300" placeholder="Ex. : plus utilisé depuis 2025"></label><button type="submit">Enregistrer</button></form></aside>';
  };
  const mur = '<section class="sc-carte" aria-labelledby="sc-mur-titre"><div class="sc-titre"><div><h2 id="sc-mur-titre">Le mur des dépôts</h2><small>Chaque case est un dépôt, colorée par sa faille ouverte la plus grave. Cliquez pour voir sa fiche.</small></div>'
    + '<div class="sc-filtres" role="group" aria-label="Filtrer les dépôts">' + filtres + '</div></div>'
    + '<div class="sc-mur"><div class="sc-mur-cases">' + (e.depots.length ? groupe('ecosysteme', 'nommees') + groupe('apps', 'moyennes') + groupe('random', 'petites')
      + '<p class="sc-vide" data-aucun hidden>Aucun dépôt ne correspond à ce filtre. Une liste vide ne prouve pas l’absence de faille : elle dit seulement qu’aucun audit n’en a déclaré.</p>'
      : '<p class="sc-vide">Inventaire vide. ' + esc(e.synchro.message || '') + '</p>')
    + '<div class="sc-legende">' + ['critique', 'haute', 'moyenne', 'basse', 'saine', 'jamais'].map((k) => '<span><i class="f-' + k + '"></i>' + LIB[k] + '</span>').join('') + '<span><i class="f-saine" style="box-shadow:0 0 0 2px var(--carte),0 0 0 3px var(--texte)"></i>audité aujourd’hui</span><span><i class="f-saine" style="opacity:.55"></i>peu important</span><span><i class="f-saine" style="opacity:.22"></i>mort (plus audité)</span></div></div>'
    + fiche(choisi) + '</div></section>';

  // ── Tableau du gestionnaire ──
  const LIB_ETAPE_G = { a_revalider: ['À revalider', 'ambre'], pr_ouverte: ['PR ouverte', 'terre'], a_trier: ['À trier', ''] };
  const gestion = '<section class="sc-carte" id="sc-gestion"><div class="sc-titre"><h2>Le tableau du gestionnaire</h2><small>corrections, PR fusionnées, revalidations et récidives</small></div><div class="sc-gkpis">'
    + [[G.a_trier, 'Failles à trier'], [G.corrections_en_cours, 'Corrections en cours (PR ouvertes)'], [G.prs_fusionnees_30j, 'PR fusionnées · 30 j'],
      [G.revalidations_en_attente, 'Revalidations en attente' + (G.attente_la_plus_longue_jours ? ' · la plus ancienne ' + G.attente_la_plus_longue_jours + ' j' : '')],
      [G.recidives, 'Récidives' + (G.recidives_ouvertes ? ' · ' + G.recidives_ouvertes + ' encore ouverte' + (G.recidives_ouvertes > 1 ? 's' : '') : '')]]
      .map(([n, t]) => '<div><b>' + n + '</b><span>' + esc(t) + '</span></div>').join('') + '</div>'
    + (G.lignes.length ? '<div class="sc-tableau"><table><thead><tr><th scope="col">Faille</th><th scope="col">Dépôt</th><th scope="col">Étape</th><th scope="col">Depuis</th><th scope="col">PR</th></tr></thead><tbody>'
      + G.lignes.map((l) => '<tr><td><span class="sc-sev f-' + l.gravite + '" style="margin-right:8px">' + LIB[l.gravite] + '</span><b>' + esc(l.titre) + '</b> <span class="sc-mono" style="font-size:12px;color:var(--texte2)">' + esc(l.id) + '</span></td>'
        + '<td class="sc-mono" style="color:var(--texte2)">' + esc(l.depot) + '</td><td><span class="sc-etiq ' + LIB_ETAPE_G[l.etape][1] + '">' + LIB_ETAPE_G[l.etape][0] + '</span></td>'
        + '<td style="color:var(--texte2)">' + (l.depuis_jours == null ? '—' : l.depuis_jours === 0 ? 'aujourd’hui' : l.depuis_jours + ' j') + '</td>'
        + '<td>' + (l.pr_url ? '<a href="' + esc(l.pr_url) + '" rel="noopener">' + esc(l.pr_url.replace(/^https:\/\/github\.com\/[^/]+\//, '')) + '</a>' : '—') + '</td></tr>').join('')
      + '</tbody></table></div>' : '<p class="sc-vide">Rien n’attend le gestionnaire : aucune faille à trier, aucune PR ouverte, aucune revalidation en attente.</p>')
    + '<p class="sc-note">Une faille n’est « revalidée » que lorsqu’un audit ultérieur constate sa disparition, preuves à l’appui ; sinon elle est rouverte. La fusion d’une PR reste humaine.</p></section>';

  // ── Deux journaux d'activité distincts ──
  const journaux = '<div class="sc-deux">'
    + journalAgent('sc-journal-audits', 'Journal des audits', 'auditeur · plans, démarrages, fins, reports, refus', e.journaux.audits, m, 'Aucune opération consignée : le journal commence au prochain plan, démarrage ou report.')
    + journalAgent('sc-journal-gestion', 'Journal du gestionnaire', 'triage · passages, PR, revalidations, refus', e.journaux.gestion, m, 'Aucun passage enregistré : rien n’indique encore que le gestionnaire a travaillé.')
    + '</div>';

  // ── Failles ouvertes (avec preuves et historique) ──
  const ouvertes = e.failles.slice(0, 12).map((f) => {
    let complet = null; try { complet = S.lireFaille(null, { id: f.id }).faille; } catch { /* */ }
    const preuves = complet ? complet.preuves : [];
    const hist = complet ? complet.historique : [];
    const etiq = f.statut === 'pr_ouverte' ? 'terre' : f.statut === 'confirmee' ? 'rouge' : '';
    return '<details class="sc-faille"><summary><span class="sc-sev f-' + f.gravite + '">' + LIB[f.gravite] + '</span><span class="quoi"><b>' + esc(f.titre) + '</b><small class="sc-mono">' + esc(f.depot) + (f.emplacement ? ' · ' + esc(f.emplacement) : '') + (f.cwe ? ' · ' + esc(f.cwe) : '') + ' · ' + esc(f.id) + '</small></span>'
      + '<span class="sc-etiq ' + etiq + '">' + LIB_STATUT[f.statut] + '</span><span class="quand">' + esc(ilYa(f.trouvee_le, m)) + '</span></summary><div class="detail">'
      + (f.description ? '<p style="margin:0;color:var(--texte)">' + esc(f.description) + '</p>' : '')
      + (f.recidive_de ? '<p style="margin:0">Récidive de ' + esc(f.recidive_de) + '.</p>' : '')
      + (f.pr_url ? '<p style="margin:0">Correctif : <a href="' + esc(f.pr_url) + '" rel="noopener">' + esc(f.pr_url.replace('https://github.com/', '')) + '</a></p>' : '')
      + '<h3>Preuves</h3>' + (preuves.length ? preuves.map((p) => '<div><span class="sc-etiq">' + esc(p.type) + '</span>' + (p.ref ? ' <span class="sc-mono" style="font-size:12px">' + esc(p.ref) + '</span>' : '') + '<pre class="sc-mono">' + esc(p.contenu) + '</pre></div>').join('') : '<p class="sc-vide">Aucune preuve jointe.</p>')
      + '<h3>Historique</h3><ul>' + hist.map((h) => '<li><span class="sc-mono">' + esc(DATE_COURTE.format(new Date(h.le))) + ' ' + hh(h.le) + '</span> · ' + esc(h.par) + ' — ' + esc(h.quoi) + (h.note ? ' (« ' + esc(h.note) + ' »)' : '') + '</li>').join('') + '</ul></div></details>';
  }).join('');
  const failles = '<section class="sc-carte"><div class="sc-titre"><h2>Failles ouvertes</h2><small>gravité déclarée par l’audit, non vérifiée automatiquement · cliquez pour les preuves</small></div>'
    + (ouvertes ? '<div class="sc-liste">' + ouvertes + '</div>' + (e.failles.length > 12 ? '<p class="sc-note">Et ' + (e.failles.length - 12) + ' autres : le connecteur les liste toutes (securite_lister_failles).</p>' : '')
      : '<p class="sc-vide">Aucune faille ouverte déclarée. Une liste vide ne prouve pas l’absence de faille : elle dit seulement qu’aucun audit n’en a déclaré.</p>') + '</section>';

  // ── Dépôts à surveiller ──
  const aSurveiller = ordre.filter((d) => d.statut !== 'saine' && d.statut !== 'jamais').slice(0, 8);
  const surveiller = '<section class="sc-carte"><div class="sc-titre"><h2>Dépôts à surveiller</h2><small>classés par gravité puis exposition</small></div>'
    + (aSurveiller.length ? '<div class="sc-tableau"><table><thead><tr><th scope="col">Dépôt</th><th scope="col">Exposition</th><th scope="col">Failles</th><th scope="col">Dernier audit</th><th scope="col">Prochain</th><th scope="col">PR</th></tr></thead><tbody>'
      + aSurveiller.map((d) => '<tr><td><b>' + esc(d.nom_complet) + '</b></td><td style="color:var(--texte2)">' + (d.public ? 'Public' : 'Privé') + ' · ' + esc(S.LIBELLE_FAMILLE[d.famille]) + '</td><td><span class="sc-actions" style="gap:4px">'
        + S.GRAVITES.filter((g) => d.failles[g]).map((g) => '<span class="sc-sev f-' + g + '">' + d.failles[g] + ' ' + g[0].toUpperCase() + '</span>').join('') + '</span></td><td style="color:var(--texte2)">' + esc(ilYa(d.dernier_audit, m)) + '</td><td style="color:var(--texte2)">' + esc(prochainDe[d.nom_complet] || '—') + '</td><td style="color:var(--texte2)">' + (d.pr_ouvertes || '—') + '</td></tr>').join('')
      + '</tbody></table></div>' : '<p class="sc-vide">Aucun dépôt n’a de faille ouverte déclarée.</p>') + '</section>';

  // ── Tendances ──
  const T = e.tendances;
  const tendances = '<section class="sc-carte"><div class="sc-titre"><h2>Tendances</h2><small>90 jours · failles déclarées</small></div><div class="sc-deux">'
    + '<div><div style="font-size:13px;color:var(--texte2);margin-bottom:8px">Faiblesses récurrentes</div>' + (T.recurrentes.length ? '<ul class="sc-regles" style="padding-left:0;list-style:none">' + T.recurrentes.map((r) => '<li><b class="sc-mono" style="color:var(--texte)">' + esc(r.cwe) + '</b> · ' + r.failles + ' failles</li>').join('') + '</ul>' : '<p class="sc-vide">Aucune catégorie CWE n’apparaît encore plusieurs fois.</p>') + '</div>'
    + '<div><div style="font-size:13px;color:var(--texte2);margin-bottom:8px">Dépôts négligés</div>' + (T.negliges.length ? '<ul class="sc-regles" style="padding-left:0;list-style:none">' + T.negliges.map((n) => '<li><b style="color:var(--texte)">' + esc(n.nom) + '</b>' + (n.public ? ' <span class="sc-badge">public</span>' : '') + ' · ' + esc(n.raison) + '</li>').join('') + '</ul>' : '<p class="sc-vide">Tous les dépôts ont été audités depuis leur dernière modification.</p>') + '</div>'
    + '</div></section>';

  // ── Audits récents ──
  const recents = S.listerAudits(null, { limit: 12 }).audits.filter((a) => a.etat !== 'prevu');
  const audits = '<section class="sc-carte" id="sc-audits"><div class="sc-titre"><h2>Audits récents</h2><small>y compris reportés et échoués</small></div>'
    + (recents.length ? '<div class="sc-tableau"><table><thead><tr><th scope="col">Créneau</th><th scope="col">Dépôt</th><th scope="col">Angle</th><th scope="col">État</th><th scope="col">Durée</th><th scope="col">Résumé</th></tr></thead><tbody>'
      + recents.map((a) => { const r = resultatDe(a); const dur = a.debut_le ? Math.round(((a.fin_le ? Date.parse(a.fin_le) : Date.parse(m)) - Date.parse(a.debut_le)) / 60000) + ' min' : '—';
        return '<tr><td class="sc-mono" style="white-space:nowrap">' + esc(DATE_COURTE.format(new Date(a.jour + 'T12:00:00Z'))) + ' ' + h2(a.heure) + ' h</td><td><b>' + esc(a.depot) + '</b></td><td style="color:var(--texte2)">' + esc(a.angle) + '</td><td><span class="sc-res f-' + r.cls + '">' + esc(r.txt) + '</span></td><td style="color:var(--texte2)">' + dur + '</td><td style="color:var(--texte2);max-width:340px">' + esc((a.resume || '').slice(0, 220)) + '</td></tr>'; }).join('')
      + '</tbody></table></div>' : '<p class="sc-vide">Aucun audit n’a encore été mené.</p>') + '</section>';

  // ── Rail : plan du jour ──
  const plan = e.creneaux.map((c) => { const r = resultatDe(c);
    return '<li><span class="sc-mono">' + h2(c.heure) + ':00</span><i class="f-' + r.cls + (c.etat === 'en_cours' ? ' sc-puls' : '') + '"></i><div><b>' + esc(c.depot.split('/')[1] || c.depot) + '</b><small>' + esc(c.angle) + '</small></div><span class="sc-res f-' + r.cls + '">' + esc(r.txt) + '</span></li>'; }).join('');
  const distincts = new Set(e.creneaux.map((c) => c.depot)).size;
  const rail = '<aside class="sc-rail" aria-label="Plan du jour"><div class="sc-carte"><div style="display:flex;flex-direction:column;gap:2px"><h2>Plan du jour</h2><small style="font-size:13px;color:var(--texte2)">'
    + (e.creneaux.length ? e.creneaux.length + ' audits · ' + distincts + ' dépôts distincts' : 'aucun créneau planifié') + ' · ' + R.creneaux_utiles + ' utiles d’après le parc</small></div>'
    + (e.plan ? '<div class="sc-priorites"><span class="sc-mono">' + hh(e.plan.etabli_le) + ' · planification</span>' + esc(e.plan.priorites) + '</div>' : '')
    + (plan ? '<ol class="sc-plan">' + plan + '</ol>' : '<p class="sc-vide">À minuit, la routine lit l’état du parc et ne planifie que les audits utiles : ' + R.creneaux_utiles + ' aujourd’hui.</p>') + '</div>'
    + '<div class="sc-carte"><h2 style="font-size:18px">Règles de la routine</h2><ul class="sc-regles"><li>Minuit : une tâche planifie les audits utiles de la journée, 23 au plus.</li><li>Chaque audit vise un seul dépôt ; un dépôt peut revenir plusieurs fois.</li><li>Un dépôt peu important : un audit par mois au plus. Un dépôt mort : plus jamais.</li><li>Le code s’exécute sur Raspberry2, réseau coupé, sans aucun secret.</li><li>Une faille devient une PR en brouillon ; la fusion reste humaine.</li><li>Chaque heure à :' + S.GESTION_MINUTE + ', le gestionnaire trie les nouvelles failles, suit les PR et lance les revalidations.</li></ul></div>'
    + '<div class="sc-carte"><h2 style="font-size:18px">Santé des agents</h2><dl class="sc-sante">'
    + '<dt style="grid-column:1/-1;color:var(--texte);font-weight:600">Auditeur</dt>'
    + '<dt>Planification de minuit</dt><dd>' + (e.plan ? 'passée à ' + hh(e.plan.etabli_le) : '<span style="color:var(--sc-moy)">pas encore</span>') + '</dd>'
    + '<dt>Créneaux menés</dt><dd>' + fait + ' sur ' + (fait + C.reportes) + '</dd>'
    + '<dt>Reportés</dt><dd' + (C.reportes ? ' style="color:var(--sc-moy)"' : '') + '>' + C.reportes + '</dd>'
    + '<dt>Échecs</dt><dd' + (C.echecs ? ' style="color:var(--sc-crit)"' : '') + '>' + C.echecs + '</dd>'
    + '<dt style="grid-column:1/-1;color:var(--texte);font-weight:600;margin-top:6px">Gestionnaire</dt>'
    + '<dt>Passages terminés</dt><dd>' + ge.aujourdhui.termines + ' sur ' + ge.aujourdhui.attendus + ' attendus</dd>'
    + '<dt>Interrompus</dt><dd' + (ge.aujourdhui.interrompus ? ' style="color:var(--sc-moy)"' : '') + '>' + ge.aujourdhui.interrompus + '</dd>'
    + '<dt>Échecs</dt><dd' + (ge.aujourdhui.echecs ? ' style="color:var(--sc-crit)"' : '') + '>' + ge.aujourdhui.echecs + '</dd>'
    + '<dt style="grid-column:1/-1;color:var(--texte);font-weight:600;margin-top:6px">Parc</dt>'
    + '<dt>Inventaire</dt><dd title="' + esc(e.synchro.message) + '">' + (e.synchro.le ? (e.synchro.ok ? 'complet' : 'partiel') + ' · ' + hh(e.synchro.le) : 'en attente') + '</dd></dl>'
    + '<p class="sc-note">Un créneau d’audit sans signe de vie pendant ' + S.SILENCE_MIN + ' minutes est marqué reporté ; un passage du gestionnaire silencieux ' + S.GESTION_SILENCE_MIN + ' minutes, interrompu. Jamais réussi.</p></div></aside>';

  const bandeau = options.erreur ? '<p class="sc-erreur" role="alert">' + esc(options.erreur) + '</p>' : '';
  return '<style>' + CSS + '</style><div class="sc" data-version="' + versionDe(e) + '">' + bandeau + entete + vue + kpis
    + '<div class="sc-corps"><div class="sc-principal"><div class="sc-deux">' + direct + vingtQuatre + '</div>' + mur + gestion + journaux + failles + surveiller + tendances + audits + '</div>' + rail + '</div></div>'
    + '<script src="/metis/securite.js" defer></script>';
}

function mount(router, { garde, envoyer, pasTrouve }) {
  const M = require('../modules/metisdocs');
  router.get('/securite', (req, res, next) => {
    try {
      const moi = garde(req, res); if (!moi) return;
      if (!M.estMaster(moi.id)) return pasTrouve(res, moi);
      S.synchroniserSiAncienne();
      const erreur = typeof req.query.erreur === 'string' ? req.query.erreur.slice(0, 300) : null;
      envoyer(res, moi, 'Security Center — Métis', render(S.etat(moi.id), { erreur }), { actif: 'securite', fil: [['Recherche Métis', '/metis'], ['Security Center', null]], description: 'Plan du jour, audits et failles du parc de dépôts.' });
    } catch (e) { next(e); }
  });
  router.get('/securite/etat.json', (req, res, next) => {
    try {
      const moi = garde(req, res); if (!moi) return;
      if (!M.estMaster(moi.id)) return pasTrouve(res, moi);
      const e = S.etat(moi.id);
      if (req.query.version === '1') return res.json({ version: versionDe(e) });
      if (req.query.telecharger === '1') res.set('Content-Disposition', 'attachment; filename="security-center-' + e.jour + '.json"');
      res.json({ ...e, version: versionDe(e) });
    } catch (e) { next(e); }
  });
  // Changer l'importance d'un dépôt depuis sa fiche (Master, même origine).
  const formulaire = require('express').urlencoded({ extended: false, limit: '4kb' });
  const origineSure = (req) => {
    const o = req.headers.origin || req.headers.referer || '';
    if (!o) return false;
    try { const h = new URL(o).hostname; return h === 'plagnito.com' || h.endsWith('.plagnito.com') || h === 'localhost' || h === '127.0.0.1'; } catch { return false; }
  };
  router.post('/securite/importance', formulaire, (req, res, next) => {
    try {
      const moi = garde(req, res); if (!moi) return;
      if (!M.estMaster(moi.id) || !origineSure(req)) return pasTrouve(res, moi);
      const b = req.body || {};
      const depot = String(b.depot || '');
      try {
        S.classerDepots(moi.id, { depots: [{ depot, importance: String(b.importance || ''), ...(b.raison ? { raison: String(b.raison) } : {}) }] }, moi.pseudo + ' (page)');
        res.redirect(303, '/metis/securite#depot=' + encodeURIComponent(depot));
      } catch (e) {
        if (!(e instanceof S.ErreurSecurite)) throw e;
        res.redirect(303, '/metis/securite?erreur=' + encodeURIComponent(e.message) + '#depot=' + encodeURIComponent(depot));
      }
    } catch (e) { next(e); }
  });
  router.get('/securite.js', (req, res) => {
    res.type('js').set('Cache-Control', 'no-cache').sendFile(require('node:path').join(__dirname, 'public', 'metis-securite.js'));
  });
}

module.exports = { mount, render, versionDe, CSS };


};
