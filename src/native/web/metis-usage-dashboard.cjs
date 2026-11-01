// Adapted from Plagni/atlas 227e897b68fbbaf2d6436084526519bf28ededf8. AGPL-3.0-only.
module.exports = function nativeModule(require, module, __dirname) {
'use strict';
const panels = require('./metis-connector-panels');
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const number = n => Number(n || 0).toLocaleString('fr-FR', { maximumFractionDigits: 1 });
const bytes = n => n >= 1024 ** 3 ? number(n / 1024 ** 3) + ' Gio' : n >= 1024 ** 2 ? number(n / 1024 ** 2) + ' Mio' : n >= 1024 ? number(n / 1024) + ' Kio' : number(n) + ' o';
const time = s => new Date(s).toLocaleString('fr-FR', { timeZone: 'Europe/Paris', dateStyle: 'short', timeStyle: 'short' });
const AUDIT_LABELS = { untyped: 'Type architectural absent', missing_owner: 'Responsable absent', missing_canonical_subject: 'Sujet canonique absent', missing_benchmark: 'Benchmark absent', unmeasured_expert: 'Expert sans mesure', competing_authorities: 'Autorités concurrentes', alias_collision: 'Alias en collision', runtime_not_implemented: 'Runtime non implémenté', implementation_without_evidence: 'Implémentation sans preuve', measurement_without_evidence: 'Mesure sans preuve', deprecated_reference: 'Référence dépréciée', dangling_reference: 'Référence absente', dependency_cycle: 'Cycle de dépendance', orphan: 'Objet sans lien' };
function renderLab(lab) {
  if (!lab || !lab.enabled) return '<section class="usage-panel"><h2>Metis Lab</h2><p>Aucun laboratoire connecté à cette instance.</p></section>';
  if (!lab.available) return '<section class="usage-panel"><h2>Metis Lab · indisponible</h2><p>' + esc(lab.reason || 'Connexion au laboratoire indisponible') + '</p></section>';
  const status = lab.status || {}, m = status.metrics || {}, guard = status.resource_guard || {}, limits = guard.limits || {};
  const measured = (n, unit = '') => n == null || !Number.isFinite(Number(n)) ? 'Non mesuré' : number(n) + unit;
  const measuredBytes = n => n == null ? 'Non mesuré' : bytes(n);
  const temperatures = Object.values(m.temperature || {}).flat().map(v => v.celsius).filter(v => v != null && Number.isFinite(Number(v)));
  const cells = [
    ['CPU', measured(m.cpu?.percent, ' %')], ['RAM', measured(m.ram?.percent, ' %') + ' · ' + measuredBytes(m.ram?.available_bytes) + ' disponibles'],
    ['Swap', measured(m.swap?.percent, ' %')], ['Température', temperatures.length ? number(Math.max(...temperatures)) + ' °C' : 'Non mesurée'],
    ['Disque', measured(m.disk?.percent, ' %') + ' · ' + measuredBytes(m.disk?.free_bytes) + ' libres'],
    ['Réseau cumulé depuis démarrage', '↑ ' + measuredBytes(m.network?.sent_bytes) + ' · ↓ ' + measuredBytes(m.network?.received_bytes)],
    ['Charge 1 / 5 / 15 min', Array.isArray(m.load) ? m.load.map(v => measured(v)).join(' / ') : 'Non mesurée'], ['Processus', measured(m.processes?.count)],
    ['Jobs', measured(status.jobs?.running) + ' actifs · ' + measured(status.jobs?.queued) + ' en attente'],
  ];
  const history = [...(lab.history?.items || [])].reverse();
  let trend = '';
  if (history.length > 1) {
    trend = '<svg viewBox="0 0 900 150" role="img" aria-label="Historique CPU RAM disque, pourcentages de 0 à 100" style="width:100%;max-height:180px"><line x1="25" y1="125" x2="880" y2="125" stroke="var(--ligne)"/>';
    for (const [group, color] of [['cpu', '#d97757'], ['ram', '#6a9bcc'], ['disk', '#788c5d']]) {
      let points = [];
      for (const [i,s] of history.entries()) {
        const n = s.data?.[group]?.percent;
        if (n == null || !Number.isFinite(Number(n))) { if(points.length) trend += '<polyline fill="none" stroke="'+color+'" stroke-width="2" points="'+points.join(' ')+'"/>'; points=[]; }
        else points.push((25 + i * 855 / (history.length - 1)) + ',' + (125 - Math.max(0, Math.min(100, Number(n)))));
      }
      if(points.length) trend += '<polyline fill="none" stroke="'+color+'" stroke-width="2" points="'+points.join(' ')+'"/>';
    }
    trend += '</svg><p>CPU (orange), RAM (bleu), disque (vert), échelle 0–100 %. ' + esc(time(history[0].timestamp)) + ' → ' + esc(time(history.at(-1).timestamp)) + '. Historique complet via metrics_history.</p>';
  }
  const jobs = (lab.jobs?.items || []).map(j => '<tr><td>' + esc(j.id) + '</td><td>' + esc(j.kind) + '</td><td>' + esc(j.state) + '</td><td>' + esc(j.experiment_id || '—') + '</td></tr>').join('');
  return '<section class="usage-panel" id="laboratoire"><h2>' + esc(status.name || 'Metis Lab') + '</h2><p>Mesures du ' + esc(time(status.timestamp)) + '. Resource Guard : ' + (guard.ready ? 'prêt' : esc(guard.reason || 'non prêt')) + '.</p><div class="usage-audit">' + cells.map(([label, value]) => '<span>' + esc(label) + ' <strong>' + esc(value) + '</strong></span>').join('') + '</div>' + trend
    + '<p>Limites par job : ' + measured(limits.memory_mb,' Mio') + ', CPU ' + measured(limits.cpu_percent,' %') + ', ' + measured(limits.timeout_seconds,' s') + ' · réserve disque ' + measured(limits.minimum_free_mb,' Mio') + '. Arrêt thermique à ' + measured(limits.maximum_temperature_c,' °C') + '.</p>'
    + '<h3>Derniers jobs</h3><div class="usage-scroll"><table><thead><tr><th>Identifiant</th><th>Type</th><th>État</th><th>Expérience</th></tr></thead><tbody>' + (jobs || '<tr><td colspan="4">Aucun job enregistré.</td></tr>') + '</tbody></table></div>'
    + '<h3>Dernières expériences</h3><p>' + ((lab.experiments?.items || []).map(e => esc(e.name) + ' · ' + esc(e.state) + ' · ' + esc(e.id)).join('<br>') || 'Aucune expérience enregistrée.') + '</p></section>';
}
function chart(stats) {
  const buckets = new Map();
  for (const h of stats.hours) { const key = stats.days === 1 ? h.hour : h.hour.slice(0, 10); const b = buckets.get(key) || { calls: 0, errors: 0, output: 0 }; b.calls += h.calls; b.errors += h.errors; b.output += h.output_bytes; buckets.set(key, b); }
  if (!buckets.size) return '<div class="usage-empty">Les premiers appels apparaîtront ici après activation de la mesure.</div>';
  const values = [...buckets], max = Math.max(...values.map(([, b]) => b.calls), 1), width = 900, height = 190, step = width / values.length;
  let svg = '<svg viewBox="0 0 960 250" role="img" aria-label="Nombre d’appels MCP par période" style="width:100%;height:auto;max-height:270px"><line x1="40" y1="210" x2="940" y2="210" stroke="var(--ligne)"/>';
  for (const [i, [key, b]] of values.entries()) {
    const x = 40 + i * step + step * .15, h = b.calls / max * height, eh = b.errors / max * height;
    svg += '<g><title>' + esc(key + ' : ' + b.calls + ' appels, ' + b.errors + ' erreurs, ' + bytes(b.output) + ' sortants') + '</title><rect x="' + x + '" y="' + (210 - h) + '" width="' + Math.max(step * .7, 1) + '" height="' + h + '" rx="3" fill="#788c5d"/><rect x="' + x + '" y="' + (210 - eh) + '" width="' + Math.max(step * .7, 1) + '" height="' + eh + '" fill="#d97757"/></g>';
    if (i % Math.max(1, Math.ceil(values.length / 8)) === 0) svg += '<text x="' + x + '" y="235" fill="currentColor" font-size="12">' + esc(stats.days === 1 ? time(key).slice(-5) : key.slice(5)) + '</text>';
  }
  return svg + '<text x="5" y="20" fill="currentColor" font-size="12">' + max + '</text></svg>';
}
function renderStats(stats) {
  const t = stats.totals;
  const lab = renderLab(stats.lab);
  const labActivity = (stats.lab_activity || []).map(r => '<tr><td>' + esc(time(r.le)) + '</td><td>' + esc(r.account_name) + '</td><td>' + esc(r.client_name) + '</td><td>' + esc(r.tool) + '</td><td>' + (r.mutation ? 'Mutation' : 'Lecture') + '</td><td>' + esc(r.result_code) + '</td><td>' + esc(r.audit_id || '—') + '</td><td>' + esc(Object.entries(r.resources || {}).map(([k, v]) => k + ': ' + v).join(' · ')) + '</td></tr>').join('');
  const table = (headers, rows) => '<div class="usage-scroll"><table><thead><tr>' + headers.map(h => '<th>' + esc(h) + '</th>').join('') + '</tr></thead><tbody>' + (rows.length ? rows.map(row => '<tr>' + row.map(cell => '<td>' + esc(cell) + '</td>').join('') + '</tr>').join('') : '<tr><td colspan="' + headers.length + '">Aucun appel sur cette période.</td></tr>') + '</tbody></table></div>';
  const card = (label, value, note) => '<div class="usage-card"><span>' + label + '</span><b>' + value + '</b><small>' + note + '</small></div>';
  return { overview: `  <div class="usage-cards">${card('Appels MCP', number(t.calls), 'Depuis ' + esc(time(stats.since)))}${card('Erreurs ou refus', number(t.errors), number(t.calls ? t.errors / t.calls * 100 : 0) + ' % des appels')}${card('Données reçues', bytes(t.input_bytes), 'Requêtes vers Métis')}${card('Données envoyées', bytes(t.output_bytes), 'Réponses vers les connecteurs')}</div>
  ${panels.deployment(stats.connector?.deployment)}${panels.runtime(stats.connector)}${panels.coordination(stats.connector?.coordination)}${lab}${panels.diagnostics(stats.connector)}<section class="usage-panel" id="activite"><h2>Activité sur la période</h2><p>Appels en vert, erreurs en orange. Survolez les barres pour le détail. Latence moyenne : <strong>${t.calls ? number(t.avg_ms) + ' ms' : 'Non mesurée'}</strong> · maximum : <strong>${t.calls ? number(t.max_ms) + ' ms' : 'Non mesuré'}</strong>.</p>${chart(stats)}</section>
  <div class="usage-two"><section class="usage-panel"><h2>Outils et méthodes</h2>${table(['Outil / méthode', 'Appels', 'Erreurs', 'Reçu', 'Envoyé', 'Moy. ms'], stats.tools.map(r => [r.tool || r.method, number(r.calls), number(r.errors), bytes(r.input_bytes), bytes(r.output_bytes), number(r.avg_ms)]))}</section>
  <section class="usage-panel"><h2>Accès par compte et application OAuth</h2>${table(['Compte Atlas', 'Client OAuth', 'Appels', 'Erreurs', 'Transferts'], stats.clients.map(r => [r.account_name, r.client_name, number(r.calls), number(r.errors), bytes(r.input_bytes + r.output_bytes)]))}</section></div>
`, recent: `  <section class="usage-panel"><h2>Derniers appels</h2>${table(['Date (Paris)', 'Compte', 'Client OAuth', 'Outil / méthode', 'HTTP', 'Résultat', 'Reçu', 'Envoyé', 'ms'], stats.recent.map(r => [time(r.le), r.account_name, r.client_name, r.tool || r.method, r.status, r.failed ? 'Erreur / refus' : 'OK', bytes(r.input_bytes), bytes(r.output_bytes), number(r.duration_ms)]))}</section>
  <section class="usage-panel"><h2>Actions Metis Lab</h2><div class="usage-scroll"><table><thead><tr><th>Date</th><th>Compte</th><th>Client</th><th>Outil</th><th>Action</th><th>Résultat</th><th>Audit Lab</th><th>Ressources</th></tr></thead><tbody>${labActivity || '<tr><td colspan="8">Aucune action du laboratoire enregistrée.</td></tr>'}</tbody></table></div></section>
` };
}
function render(stats, audit) {
  const parts = renderStats(stats);
  return `<style>
    ${panels.CSS}
    .mcp-dashboard{max-width:1300px;margin:0 auto;padding:36px clamp(18px,4vw,64px);color:var(--texte)}
    .mcp-dashboard h1{font-family:var(--serif);font-size:clamp(32px,4vw,52px);font-weight:500;margin:6px 0 12px}.mcp-dashboard h2{font-size:21px;font-weight:500;margin:0 0 18px}
    .usage-top{display:flex;gap:20px;align-items:start;justify-content:space-between;flex-wrap:wrap}.usage-eyebrow{font-size:12px;text-transform:uppercase;letter-spacing:.13em;color:var(--texte2)}
    .usage-intro{max-width:750px;line-height:1.65;color:var(--texte2)}.usage-controls{display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin:22px 0}.usage-controls a{border:1px solid var(--ligne);padding:8px 13px;border-radius:7px;font-size:13px;text-decoration:none;color:inherit}.usage-controls a[aria-current]{background:var(--texte);color:var(--fond)}
    .usage-cards{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:14px;margin:25px 0}.usage-card,.usage-panel{border:1px solid var(--ligne);border-radius:12px;padding:23px}.usage-card span,.usage-card small{display:block;color:var(--texte2);font-size:12px}.usage-card b{display:block;font-size:32px;font-weight:500;margin:12px 0}.usage-card small{line-height:1.5}
    .usage-panel{margin:18px 0;min-width:0}.usage-panel p,.usage-note{font-size:13px;color:var(--texte2);line-height:1.7}.usage-scroll{overflow:auto}.mcp-dashboard table{width:100%;border-collapse:collapse;font-size:13px;white-space:nowrap}.mcp-dashboard th{text-align:left;color:var(--texte2);font-weight:500}.mcp-dashboard th,.mcp-dashboard td{padding:12px;border-bottom:1px solid var(--ligne)}.usage-empty{padding:35px;text-align:center;color:var(--texte2)}.usage-two{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:18px}.usage-audit{display:flex;flex-wrap:wrap;gap:10px}.usage-audit span{border:1px solid var(--ligne);border-radius:6px;padding:8px;font-size:12px}
    @media(max-width:1000px){.usage-cards{grid-template-columns:repeat(2,minmax(0,1fr))}.usage-two{grid-template-columns:1fr}}@media(max-width:500px){.usage-card{padding:16px}.usage-card b{font-size:25px}.usage-panel{padding:16px}}
  </style><div class="mcp-dashboard" data-days="${stats.days}"><div class="usage-top"><div><p class="usage-eyebrow">Métis · connecteur MCP · Master</p><h1>Activité du connecteur</h1><p class="usage-intro">Les accès, les outils utilisés et les volumes échangés avec ChatGPT et Claude. Les mesures commencent à l’activation de cette version.</p></div><a class="bouton-fin" href="/metis">Retour aux publications</a></div>
  <nav class="usage-controls" aria-label="Période">${[1, 7, 30, 90].map(d => '<a href="?days=' + d + '"' + (stats.days === d ? ' aria-current="page"' : '') + '>' + d + (d === 1 ? ' jour' : ' jours') + '</a>').join('')}<a href="?days=${stats.days}">Actualiser</a><a href="/metis/connecteur/stats.json?days=${stats.days}">Exporter JSON</a></nav>
  <nav class="connector-jump" aria-label="Sections du connecteur"><a href="#capacites">Capacités</a><a href="#coordination">Agents</a><a href="#activite">Activité</a><a href="#catalogue">Outils et schémas</a><a href="#shadow">Shadow Lab</a><a href="#diagnostics">Diagnostics</a></nav>
  <p class="usage-note" data-live-status role="status" aria-live="polite">Suivi en direct en cours de connexion…</p><noscript><p class="usage-note">Activez JavaScript pour le suivi en direct et les filtres ; tous les détails restent lisibles et le lien Actualiser reste disponible.</p></noscript>
<div data-live-part="overview">${parts.overview}</div>
  ${panels.catalogue(stats.connector)}${panels.shadow(require('./metis-connector-details').shadow())}
  <section class="usage-panel usage-audit-panel"><h2>Qualité du registre</h2><p>${audit ? audit.entries : "Nombre d’objets non mesuré — registre architectural non activé sur cette instance ;"} objets visibles. Les anomalies signalent des déclarations manquantes ou incohérentes ; elles ne prouvent pas à elles seules qu’un composant est inutile.</p><div class="usage-audit">${Object.entries(audit?.counts || {}).map(([k, n]) => '<span>' + esc(AUDIT_LABELS[k] || k) + ' <strong>' + number(n) + '</strong></span>').join('')}</div></section>
<div data-live-part="recent">${parts.recent}</div>
  <p class="usage-note">${esc(stats.byte_scope)} Les requêtes rejetées avant lecture du corps peuvent afficher 0 octet reçu. Historique détaillé : 30 jours, au plus 10 000 appels ; agrégats : 90 jours. Aucun jeton, argument d’outil, contenu de document ni adresse IP n’est enregistré. Accès au dashboard et à l’export réservé à Master.</p></div><script src="/metis/connecteur/live.js" defer></script>`;
}
module.exports = { render, renderStats, renderLab, bytes };


};
