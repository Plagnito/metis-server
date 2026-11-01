"use strict";
const root = document.querySelector("#app"),
  dialog = document.querySelector("#dialog");
let state = null,
  status = null,
  csrf = "",
  page = "overview",
  noticeTimer;
const E = (s) =>
  String(s ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
const date = (s) =>
  s
    ? new Date(s).toLocaleString("fr-FR", {
        dateStyle: "short",
        timeStyle: "short",
      })
    : "—";
const N = (n) => Number(n || 0).toLocaleString("fr-FR");
const labels = {
  queued: "En attente",
  running: "En cours",
  completed: "Terminé",
  failed: "Échec",
  interrupted: "Interrompu",
  cancelled: "Arrêté",
  nouvelle: "À examiner",
  confirmee: "Confirmée",
  pr_ouverte: "PR ouverte",
  corrigee: "À revalider",
  revalidee: "Revalidée",
  faux_positif: "Faux positif",
  acceptee: "Acceptée",
  draft: "Brouillon",
  published: "Publié",
  archived: "Archivé",
  open: "À faire",
  active: "En cours",
};
const badge = (value) =>
  '<span class="badge ' +
  (["failed", "critique", "haute"].includes(value)
    ? "bad"
    : ["interrupted", "nouvelle", "corrigee"].includes(value)
      ? "warn"
      : ["queued", "cancelled", "draft"].includes(value)
        ? "neutral"
        : "") +
  '">' +
  E(labels[value] || value) +
  "</span>";
const action = (name, label, id = "", secondary = true) =>
  '<button class="' +
  (secondary ? "secondary " : "") +
  'small" data-action="' +
  name +
  '" data-id="' +
  E(id) +
  '">' +
  label +
  "</button>";
const empty = (title, body) =>
  '<div class="empty"><strong>' + E(title) + "</strong>" + E(body) + "</div>";
async function request(url, method = "GET", data, idem) {
  const headers = {};
  if (method !== "GET") {
    headers["Content-Type"] = "application/json";
    headers["X-Metis-Request"] = "1";
    if (csrf) headers["X-CSRF-Token"] = csrf;
    if (idem) headers["Idempotency-Key"] = idem;
  }
  const r = await fetch(url, {
    method,
    headers,
    body: data === undefined ? undefined : JSON.stringify(data),
    credentials: "same-origin",
  });
  let result;
  try {
    result = await r.json();
  } catch {
    throw new Error("Réponse du serveur illisible.");
  }
  if (!r.ok) {
    const e = new Error(result.error?.message || "Requête refusée.");
    e.status = r.status;
    throw e;
  }
  return result;
}
function notify(message, error = false) {
  const n = document.querySelector("#notice");
  n.textContent = message;
  n.className = "show" + (error ? " error" : "");
  clearTimeout(noticeTimer);
  noticeTimer = setTimeout(() => (n.className = ""), 9000);
}
function modal(title, html) {
  dialog.innerHTML =
    '<div class="dialog-head"><h2>' +
    E(title) +
    '</h2><button class="close-dialog" data-action="close-dialog" aria-label="Fermer">×</button></div>' +
    html;
  dialog.showModal();
}
function heading(kicker, title, subtitle, buttons = "") {
  return (
    '<div class="page-heading"><div><div class="eyebrow">' +
    E(kicker) +
    "</div><h1>" +
    E(title) +
    '</h1><p class="muted">' +
    E(subtitle) +
    '</p></div><div class="actions">' +
    buttons +
    "</div></div>"
  );
}
function authView() {
  const setup = !status.initialized;
  root.innerHTML =
    '<main class="auth-shell"><section class="card auth-card"><div class="auth-brand"><img src="/favicon.svg" alt="">Métis</div><div class="eyebrow">' +
    (setup ? "VOTRE INSTANCE, VOS DONNÉES" : "VOTRE ESPACE AUTONOME") +
    "</div><h1>" +
    (setup ? "Bienvenue chez vous." : "Retrouvez votre espace.") +
    '</h1><p class="muted">' +
    (setup
      ? "Créez votre administrateur. Vous pourrez ensuite connecter vos dépôts, choisir votre IA et programmer votre première routine."
      : "Connectez-vous à " +
        E(status.name) +
        " pour suivre vos recherches et vos audits.") +
    "</p>" +
    (setup
      ? '<div class="hint">Le code d’installation est affiché dans le terminal du serveur.<code class="code">docker compose logs metis</code></div>'
      : "") +
    '<form id="auth-form">' +
    (setup
      ? '<label>Code d’installation<input name="code" autocomplete="off" required></label>'
      : "") +
    '<label>Identifiant<input name="username" autocomplete="username" maxlength="80" required></label><label>Mot de passe<input name="password" type="password" minlength="' +
    (setup ? "12" : "1") +
    '" maxlength="256" autocomplete="' +
    (setup ? "new-password" : "current-password") +
    '" required></label><button>' +
    (setup ? "Créer mon espace" : "Se connecter") +
    '</button></form><div class="fineprint">Auto-hébergé · aucune routine active par défaut · v' +
    E(status.version) +
    "</div></section></main>";
}
const nav = [
  ["overview", "◫", "Vue d’ensemble"],
  ["security", "◇", "Security Center"],
  ["documents", "▤", "Documents"],
  ["work", "↗", "Travaux"],
  ["routines", "◷", "Routines"],
  ["connectors", "⌘", "Connecteurs"],
  ["settings", "⚙", "Configuration"],
];
function render() {
  if (!state) return;
  page = location.hash.slice(1) || "overview";
  if (!nav.some((x) => x[0] === page)) page = "overview";
  const title = nav.find((x) => x[0] === page)[2];
  root.innerHTML =
    '<div class="layout"><aside class="sidebar"><div class="brand"><img src="/favicon.svg" alt="">Métis<span></span></div><div class="eyebrow">ESPACE DE TRAVAIL</div><nav aria-label="Navigation principale">' +
    nav
      .filter(
        ([p]) =>
          !(
            ["documents", "work"].includes(p) && !state.config.modules.research
          ) && !(p === "security" && !state.config.modules.security),
      )
      .map(
        ([p, icon, label]) =>
          '<a href="#' +
          p +
          '" class="' +
          (page === p ? "active" : "") +
          '" ' +
          (page === p ? 'aria-current="page"' : "") +
          '><span class="nav-icon" aria-hidden="true">' +
          icon +
          "</span>" +
          label +
          "</a>",
      )
      .join("") +
    '</nav><div class="sidebar-footer"><strong><span class="live-dot"></span>Instance autonome</strong>' +
    E(state.config.name) +
    "<br>v" +
    E(state.version) +
    " · " +
    E(state.config.timezone) +
    '</div></aside><main class="main"><header class="topbar"><span>' +
    E(state.config.name) +
    ' <span aria-hidden="true">/</span> ' +
    E(title) +
    '</span><div class="identity"><span><span class="live-dot"></span>Votre serveur</span><button class="secondary" data-action="logout">Déconnexion</button></div></header>' +
    (
      { overview, security, documents, work, routines, connectors, settings }[
        page
      ] || overview
    )() +
    '<footer class="endnote">Métis conserve les observations et leurs preuves. Une analyse sans signalement ne garantit pas l’absence de vulnérabilité.</footer></main></div>';
}
function overview() {
  const jobs = state.jobs,
    active = jobs.find((j) => j.state === "running"),
    count = state.security?.resume?.failles_ouvertes || 0,
    enabled = state.routines.filter((r) => r.enabled).length,
    configured = state.config.repositories.length && state.providerVerified;
  return (
    heading(
      "VOTRE OBSERVATOIRE",
      "L’essentiel, à portée de vue.",
      "Recherches, routines et audits : un espace pour garder le fil.",
    ) +
    '<section class="hero"><div><div class="eyebrow">' +
    (active
      ? "UNE ANALYSE EST EN COURS"
      : configured
        ? "PRÊT POUR VOTRE PROCHAIN AUDIT"
        : "COMMENCEZ EN QUELQUES ÉTAPES") +
    "</div><h2>" +
    (active
      ? E(active.repository)
      : configured
        ? "Votre veille peut prendre le relais."
        : "Un point de départ pour vos projets.") +
    "</h2><p>" +
    (active
      ? "Suivez les fichiers lus, les observations et la consommation dans le journal du travail."
      : configured
        ? "Programmez une routine ou lancez une analyse sur l’un de vos dépôts sélectionnés."
        : "Connectez un dépôt et votre fournisseur IA, puis définissez une routine à votre rythme.") +
    '</p></div><span class="hero-symbol" aria-hidden="true">✳</span></section><div class="grid four">' +
    metric(
      "Dépôts sélectionnés",
      state.config.repositories.length,
      "Votre périmètre, explicitement choisi",
    ) +
    metric(
      "Audits terminés",
      jobs.filter((j) => j.kind === "audit" && j.state === "completed").length,
      "Parmi les 100 derniers travaux",
    ) +
    metric("Signalements ouverts", count, "À examiner, avec leurs preuves") +
    metric("Routines actives", enabled, "Un seul travail à la fois") +
    '</div><div class="split section"><section class="card"><div class="section-head"><h2>Derniers travaux</h2><a href="#security">Tout voir →</a></div>' +
    jobTable(jobs.slice(0, 5)) +
    '</section><section class="card"><div class="eyebrow">VOTRE PROCHAINE ÉTAPE</div><h2>' +
    (!configured ? "Préparer votre espace" : "Gardez votre rythme") +
    "</h2>" +
    step(
      "01",
      "Vos dépôts",
      state.config.repositories.length
        ? state.config.repositories.length + " dépôt(s) sélectionné(s)."
        : "Choisissez les dépôts que Métis pourra lire.",
      "settings",
    ) +
    step(
      "02",
      "Votre fournisseur IA",
      state.providerVerified
        ? "Connexion et appels d’outils vérifiés."
        : "Renseignez votre modèle et testez sa connexion.",
      "settings",
    ) +
    step(
      "03",
      "Votre première routine",
      enabled
        ? enabled + " routine(s) active(s)."
        : "Choisissez un horaire et un budget explicite.",
      "routines",
    ) +
    "</section></div>"
  );
}
function metric(label, value, sub) {
  return (
    '<div class="card metric"><div class="label">' +
    E(label) +
    '</div><div class="value">' +
    N(value) +
    '</div><div class="sub">' +
    E(sub) +
    "</div></div>"
  );
}
function step(n, title, body, href) {
  return (
    '<div class="step"><span class="number">' +
    n +
    "</span><div><h3>" +
    E(title) +
    "</h3><p>" +
    E(body) +
    '</p><a href="#' +
    href +
    '">Ouvrir →</a></div></div>'
  );
}
function jobTable(jobs) {
  if (!jobs.length)
    return empty(
      "Tout commence ici.",
      "Vos premiers travaux apparaîtront avec leur journal et leur résultat.",
    );
  return (
    '<div class="table-wrap"><table><thead><tr><th>Dépôt</th><th>État</th><th>Consommation</th><th></th></tr></thead><tbody>' +
    jobs
      .map(
        (j) =>
          '<tr><td><button class="link-button" data-action="job" data-id="' +
          E(j.id) +
          '">' +
          E(j.repository) +
          '</button><span class="table-sub">' +
          (j.kind === "followup"
            ? "Suivi des corrections"
            : "Analyse statique") +
          " · " +
          date(j.created) +
          "</span></td><td>" +
          badge(j.state) +
          "</td><td>" +
          N(j.usage.tokens) +
          ' <span class="muted">jetons</span><span class="table-sub">' +
          N(j.usage.calls) +
          " appel(s) IA</span></td><td>" +
          (["running", "queued"].includes(j.state)
            ? action("cancel", "Arrêter", j.id)
            : ["failed", "interrupted"].includes(j.state)
              ? action("resume", "Reprendre", j.id)
              : action("job", "Lire", j.id)) +
          "</td></tr>",
      )
      .join("") +
    "</tbody></table></div>"
  );
}
function security() {
  const findings = state.security?.failles || [];
  return (
    heading(
      "SECURITY CENTER",
      "Des observations traçables.",
      "Analyse statique, signalements et suivi des corrections.",
      action("new-job", "Lancer un travail", "", false),
    ) +
    (!state.providerVerified
      ? '<div class="hint">Configurez et testez votre fournisseur IA avant le premier audit. Le suivi des PR peut fonctionner sans modèle. <a href="#settings">Ouvrir la configuration →</a></div>'
      : "") +
    '<div class="card"><div class="section-head"><h2>Travaux récents</h2>' +
    badge("Analyse statique") +
    "</div>" +
    jobTable(state.jobs) +
    '</div><section class="card section"><h2>Signalements à examiner</h2>' +
    (findings.length
      ? findings
          .map(
            (f) =>
              '<div class="row"><div class="text"><h3><button class="link-button" data-action="finding" data-id="' +
              E(f.id) +
              '">' +
              E(f.titre) +
              "</button></h3><p>" +
              E(f.depot) +
              " · " +
              E(f.emplacement || "Emplacement non renseigné") +
              '</p></div><div class="actions">' +
              badge(f.gravite) +
              badge(f.statut) +
              "</div></div>",
          )
          .join("")
      : empty(
          "Aucun signalement ouvert.",
          "Les conclusions et limites de couverture restent dans chaque rapport.",
        )) +
    "</section>"
  );
}
function documents() {
  return (
    heading(
      "MÉTIS · DOCUMENTS",
      "Une mémoire que vous maîtrisez.",
      "Documents Markdown et versions conservées sur votre instance.",
      action("new-document", "Nouveau document", "", false),
    ) +
    '<section class="card">' +
    (state.documents.length
      ? state.documents
          .map(
            (d) =>
              '<div class="row"><div class="text"><h3><button class="link-button" data-action="document" data-id="' +
              E(d.slug) +
              '">' +
              E(d.title) +
              "</button></h3><p>" +
              E(d.slug) +
              " · version " +
              d.version +
              " · " +
              date(d.updated) +
              "</p></div>" +
              badge(d.status) +
              "</div>",
          )
          .join("")
      : empty(
          "Votre bibliothèque vous attend.",
          "Rédigez un document ou utilisez le connecteur MCP pour l’enregistrer.",
        )) +
    "</section>"
  );
}
function work() {
  return (
    heading(
      "MÉTIS · TRAVAUX",
      "Gardez une prochaine action.",
      "Des travaux et des notes persistants, accessibles aussi par MCP.",
      action("new-work", "Nouveau travail", "", false),
    ) +
    '<section class="card">' +
    (state.workItems.length
      ? state.workItems
          .map(
            (w) =>
              '<div class="row"><div class="text"><h3><button class="link-button" data-action="work" data-id="' +
              E(w.id) +
              '">' +
              E(w.title) +
              "</button></h3><p>" +
              E(w.description.slice(0, 180)) +
              "</p></div>" +
              badge(w.status) +
              "</div>",
          )
          .join("")
      : empty(
          "Une question, une recherche, une prochaine étape.",
          "Créez un travail pour lui donner un fil durable.",
        )) +
    "</section>"
  );
}
function routines() {
  return (
    heading(
      "AUTONOMIE",
      "Votre rythme, vos limites.",
      "Les routines s’exécutent sur le serveur, même sans conversation ouverte.",
      action("new-routine", "Nouvelle routine", "", false),
    ) +
    '<div class="hint">Chaque routine vise un dépôt et un passage quotidien. Les horaires suivent son fuseau, y compris aux changements d’heure. Une occurrence manquée dans la journée est rattrapée au retour du serveur.</div><section class="card">' +
    (state.routines.length
      ? state.routines
          .map(
            (r) =>
              '<div class="row"><div class="text"><h3>' +
              E(r.title) +
              "</h3><p>" +
              E(r.repository) +
              " · " +
              (r.kind === "audit" ? "Analyse statique" : "Suivi des PR") +
              " · " +
              String(r.hour).padStart(2, "0") +
              ":" +
              String(r.minute).padStart(2, "0") +
              " · " +
              E(r.timezone) +
              "</p><p>" +
              (r.enabled
                ? "Prochain passage : " + date(r.next)
                : "Routine en pause") +
              " · " +
              r.limits.maxCalls +
              " appels maximum · " +
              N(r.limits.maxTokens) +
              ' jetons maximum</p></div><div class="actions">' +
              badge(r.enabled ? "Active" : "En pause") +
              action("routine", "Modifier", r.id) +
              "</div></div>",
          )
          .join("")
      : empty(
          "Aucune routine active par défaut.",
          "Choisissez vos dépôts, un fournisseur et un budget avant de commencer.",
        )) +
    "</section>"
  );
}
function settings() {
  const c = state.config;
  return (
    heading(
      "CONFIGURATION",
      "Chez vous, selon vos choix.",
      "Les clés enregistrées ne sont jamais renvoyées à votre navigateur.",
    ) +
    '<form id="settings-form" class="form-width"><section class="card"><h2>Votre instance</h2><div class="form-row"><label>Nom<input name="name" value="' +
    E(c.name) +
    '" maxlength="80" required></label><label>Fuseau horaire<input name="timezone" value="' +
    E(c.timezone) +
    '" list="timezones" required></label></div><datalist id="timezones"><option>Europe/Paris</option><option>UTC</option><option>America/Montreal</option><option>America/New_York</option><option>Asia/Tokyo</option></datalist><label>Adresse publique HTTPS <span class="muted">(facultative)</span><input name="baseUrl" type="url" value="' +
    E(c.baseUrl) +
    '" placeholder="https://metis.example.com"><small>À renseigner après la configuration de votre proxy ou tunnel HTTPS.</small></label><div class="checks"><label><input type="checkbox" name="research" ' +
    (c.modules.research ? "checked" : "") +
    '>Documents et recherche</label><label><input type="checkbox" name="security" ' +
    (c.modules.security ? "checked" : "") +
    '>Security Center</label></div></section><section class="card section"><h2>Vos dépôts GitHub</h2><label>Dépôts autorisés<textarea name="repositories" rows="4" placeholder="organisation/depot">' +
    E(c.repositories.join("\n")) +
    '</textarea><small>Un dépôt par ligne. Seuls les dépôts sélectionnés pourront être analysés.</small></label><label>Authentification GitHub<select name="githubMode"><option value="token" ' +
    ((c.github?.mode || "token") === "token" ? "selected" : "") +
    '>Jeton personnel ou dépôts publics</option><option value="app" ' +
    (c.github?.mode === "app" ? "selected" : "") +
    '>GitHub App de votre instance</option></select></label><details><summary class="muted">Configurer une GitHub App</summary><p class="fineprint">Créez une application GitHub, accordez Contents et Pull requests en lecture, puis installez-la sur les seuls dépôts choisis. Renseignez ici ses identifiants et sa clé privée.</p><div class="form-row"><label>App ID<input name="githubAppId" value="' +
    E(c.github?.appId || "") +
    '" inputmode="numeric"></label><label>Installation ID<input name="githubInstallationId" value="' +
    E(c.github?.installationId || "") +
    '" inputmode="numeric"></label></div><label>Clé privée PEM<textarea name="githubAppKey" rows="3" autocomplete="off" placeholder="' +
    (state.secrets.githubAppKey
      ? "Clé enregistrée — laisser vide pour la conserver"
      : "-----BEGIN RSA PRIVATE KEY-----") +
    '"></textarea></label></details><label class="section">Jeton GitHub à permissions fines<input name="githubKey" type="password" autocomplete="new-password" placeholder="' +
    (state.secrets.github
      ? "Clé enregistrée — laisser vide pour la conserver"
      : "Facultatif pour les dépôts publics") +
    '"><small>Pour les dépôts privés : accès en lecture au contenu et aux pull requests sélectionnées.</small></label><div class="actions">' +
    action("github-test", "Tester le premier dépôt") +
    action("github-sync", "Actualiser l’inventaire") +
    '</div></section><section class="card section"><h2>Votre fournisseur IA</h2><div class="form-row"><label>Fournisseur<select name="providerKind"><option value="openai" ' +
    (c.provider.kind === "openai" ? "selected" : "") +
    '>OpenAI · Responses API</option><option value="anthropic" ' +
    (c.provider.kind === "anthropic" ? "selected" : "") +
    '>Anthropic · Messages API</option><option value="compatible" ' +
    (c.provider.kind === "compatible" ? "selected" : "") +
    '>Serveur local / API compatible</option></select></label><label>Modèle<input name="model" value="' +
    E(c.provider.model) +
    '" placeholder="Identifiant du modèle de votre compte" maxlength="160"></label></div><label>Adresse de l’API compatible<input name="providerUrl" type="url" value="' +
    E(c.provider.baseUrl) +
    '" placeholder="http://host.docker.internal:11434/v1"><small>Utilisée uniquement pour le fournisseur compatible. L’appel d’outils sera vérifié.</small></label><label>Clé du fournisseur<input type="password" name="providerKey" autocomplete="new-password" placeholder="' +
    (state.secrets.provider
      ? "Clé enregistrée — laisser vide pour la conserver"
      : "Votre clé API") +
    '"></label><div class="hint">Les extraits de code lus pendant une analyse sont transmis au fournisseur choisi. Aucun code du dépôt n’est exécuté. Vous fixez un budget pour chaque routine.</div><div class="actions">' +
    action("provider-test", "Tester la connexion") +
    badge(
      state.providerVerified ? "Connexion vérifiée" : "Connexion à tester",
    ) +
    '</div><p class="fineprint">Le test effectue un petit appel au fournisseur. Enregistrez les modifications avant de tester.</p></section><div class="actions section"><button>Enregistrer la configuration</button></div></form>'
  );
}
function connectors() {
  return (
    heading(
      "CONNECTEURS",
      "Votre espace, depuis vos outils.",
      "Accès MCP authentifié, avec des droits et une révocation propres à chaque application.",
    ) +
    '<div class="split"><section class="card"><h2>Adresse de votre connecteur</h2><code class="code">' +
    E(state.origin) +
    '/mcp</code><p class="muted section">Ajoutez cette adresse dans votre client MCP. Une connexion OAuth affichera le nom de l’application et les droits demandés avant autorisation.</p>' +
    (!state.config.baseUrl
      ? '<div class="hint">Pour un client hébergé à distance, configurez d’abord une adresse HTTPS accessible depuis Internet. Votre tableau de bord reste utilisable localement.</div>'
      : "") +
    '<h3>Clients avec jeton Bearer</h3><p class="muted">Créez une clé limitée pour les clients qui acceptent un en-tête Authorization.</p>' +
    action("new-token", "Créer une clé") +
    '</section><section class="card"><h2>Clés et applications</h2>' +
    (state.tokens.length
      ? state.tokens
          .map(
            (t) =>
              '<div class="row"><div class="text"><h3>' +
              E(t.label) +
              "</h3><p>" +
              E(t.scopes.join(" · ")) +
              "<br>Expire le " +
              date(t.expires) +
              "</p></div>" +
              action("revoke-token", "Révoquer", t.id) +
              "</div>",
          )
          .join("")
      : empty(
          "Aucune clé enregistrée.",
          "Créez une clé ou autorisez une application par OAuth.",
        )) +
    (state.clients.length
      ? '<h3 class="section">Applications OAuth enregistrées</h3>' +
        state.clients
          .map(
            (c) =>
              '<div class="row"><span>' +
              E(c.name) +
              "</span>" +
              action("revoke-client", "Retirer", c.id) +
              "</div>",
          )
          .join("")
      : "") +
    "</section></div>"
  );
}
function jobForm() {
  if (!state.config.repositories.length) {
    notify("Sélectionnez d’abord un dépôt dans la configuration.", true);
    location.hash = "settings";
    return;
  }
  modal(
    "Lancer un travail",
    '<form id="job-form"><label>Dépôt<select name="repository">' +
      repoOptions() +
      '</select></label><label>Travail<select name="kind"><option value="audit">Analyse statique avec votre IA</option><option value="followup">Suivi des PR · sans appel IA</option></select></label>' +
      budgetFields() +
      '<div class="hint">L’analyse transmet les extraits lus au fournisseur configuré. Le journal affiche les lectures, les appels et leurs limites.</div><button>Lancer le travail</button></form>',
  );
}
function repoOptions(selected) {
  return state.config.repositories
    .map(
      (r) =>
        "<option " +
        (r === selected ? "selected" : "") +
        ">" +
        E(r) +
        "</option>",
    )
    .join("");
}
function budgetFields(
  l = {
    maxCalls: 8,
    maxTokens: 120000,
    maxOutputTokens: 1800,
    maxFiles: 18,
    maxSourceBytes: 24000,
    timeoutSeconds: 600,
  },
) {
  return (
    '<div class="form-row three"><label>Appels IA maximum<input name="maxCalls" type="number" min="1" max="30" value="' +
    l.maxCalls +
    '" required></label><label>Jetons maximum<input name="maxTokens" type="number" min="4000" max="1000000" value="' +
    l.maxTokens +
    '" required></label><label>Durée maximum (s)<input name="timeoutSeconds" type="number" min="30" max="1800" value="' +
    l.timeoutSeconds +
    '" required></label></div><details><summary class="muted">Limites de lecture et de réponse</summary><div class="form-row three section"><label>Lectures maximum<input name="maxFiles" type="number" min="1" max="80" value="' +
    l.maxFiles +
    '" required></label><label>Code source (octets)<input name="maxSourceBytes" type="number" min="2000" max="120000" value="' +
    l.maxSourceBytes +
    '" required></label><label>Réponse (jetons)<input name="maxOutputTokens" type="number" min="256" max="8000" value="' +
    l.maxOutputTokens +
    '" required></label></div></details><p class="fineprint">Les jetons sont déclarés par le fournisseur, ou comptés par borne conservatrice lorsqu’il ne fournit pas de mesure.</p>'
  );
}
function readLimits(f) {
  return Object.fromEntries(
    [
      "maxCalls",
      "maxTokens",
      "maxOutputTokens",
      "maxFiles",
      "maxSourceBytes",
      "timeoutSeconds",
    ].map((k) => [k, Number(f.get(k))]),
  );
}
function routineForm(r) {
  if (!state.config.repositories.length) {
    notify("Sélectionnez un dépôt dans la configuration.", true);
    location.hash = "settings";
    return;
  }
  modal(
    r ? "Modifier la routine" : "Nouvelle routine",
    '<form id="routine-form" data-id="' +
      E(r?.id || "") +
      '" data-version="' +
      (r?.revision || 0) +
      '"><label>Nom<input name="title" value="' +
      E(r?.title || "Audit quotidien") +
      '" required maxlength="120"></label><div class="form-row"><label>Dépôt<select name="repository">' +
      repoOptions(r?.repository) +
      '</select></label><label>Travail<select name="kind"><option value="audit">Analyse statique</option><option value="followup" ' +
      (r?.kind === "followup" ? "selected" : "") +
      '>Suivi des PR</option></select></label></div><div class="form-row"><label>Horaire quotidien<input type="time" name="time" value="' +
      String(r?.hour ?? 9).padStart(2, "0") +
      ":" +
      String(r?.minute ?? 0).padStart(2, "0") +
      '" required></label><label>Fuseau<input name="timezone" value="' +
      E(r?.timezone || state.config.timezone) +
      '" required></label></div>' +
      budgetFields(r?.limits) +
      '<label class="check-line section"><input type="checkbox" name="enabled" ' +
      (r?.enabled ? "checked" : "") +
      ">Activer cette routine</label><button>Enregistrer la routine</button></form>",
  );
}
function documentForm(d) {
  modal(
    d ? "Modifier le document" : "Nouveau document",
    '<form id="document-form" data-version="' +
      (d?.version || 0) +
      '"><div class="form-row"><label>Identifiant<input name="slug" value="' +
      E(d?.slug || "") +
      '" pattern="[a-z0-9][a-z0-9-]*" ' +
      (d ? "readonly" : "") +
      ' placeholder="ma-recherche" required></label><label>Statut<select name="status">' +
      ["draft", "published", "archived"]
        .map(
          (s) =>
            '<option value="' +
            s +
            '" ' +
            (s === (d?.status || "draft") ? "selected" : "") +
            ">" +
            labels[s] +
            "</option>",
        )
        .join("") +
      '</select></label></div><label>Titre<input name="title" value="' +
      E(d?.title || "") +
      '" maxlength="160" required></label><label>Document Markdown<textarea class="doc-body" name="body" maxlength="400000">' +
      E(d?.body || "") +
      '</textarea></label><p class="fineprint">Chaque enregistrement crée une nouvelle version. Le texte est conservé sans exécuter son HTML.</p><button>Enregistrer</button></form>',
  );
}
function workForm(w) {
  modal(
    w ? "Modifier le travail" : "Nouveau travail",
    '<form id="work-form" data-id="' +
      E(w?.id || "") +
      '" data-version="' +
      (w?.version || 0) +
      '"><label>Titre<input name="title" value="' +
      E(w?.title || "") +
      '" maxlength="160" required></label><label>Description<textarea name="description" rows="7">' +
      E(w?.description || "") +
      '</textarea></label><label>État<select name="status">' +
      ["open", "active", "completed", "cancelled"]
        .map(
          (s) =>
            '<option value="' +
            s +
            '" ' +
            (s === (w?.status || "open") ? "selected" : "") +
            ">" +
            labels[s] +
            "</option>",
        )
        .join("") +
      "</select></label><button>Enregistrer</button></form>",
  );
}
async function refresh(force = false) {
  const next = await request("/api/state");
  state = next;
  csrf = next.csrf;
  if (force || (!dialog.open && !document.activeElement?.closest("form")))
    render();
}
root.addEventListener("submit", submit);
dialog.addEventListener("submit", submit);
async function submit(e) {
  e.preventDefault();
  const form = e.target,
    f = new FormData(form),
    button = form.querySelector("button[type=submit],button:not([type])");
  if (form.dataset.busy) return;
  form.dataset.busy = "1";
  if (button) button.disabled = true;
  try {
    const id = form.id;
    if (id === "auth-form") {
      const s = await request(
        status.initialized ? "/api/login" : "/api/bootstrap",
        "POST",
        Object.fromEntries(f),
      );
      csrf = s.csrf;
      const back = new URLSearchParams(location.search).get("return");
      if (back?.startsWith("/oauth/authorize?")) {
        location.href = back;
        return;
      }
      history.replaceState(null, "", location.pathname + location.hash);
      await refresh(true);
      return;
    }
    if (id === "settings-form") {
      const config = {
        name: f.get("name"),
        timezone: f.get("timezone"),
        baseUrl: f.get("baseUrl"),
        modules: { research: f.has("research"), security: f.has("security") },
        repositories: f
          .get("repositories")
          .split(/[\n,]/)
          .map((s) => s.trim())
          .filter(Boolean),
        github: {
          mode: f.get("githubMode"),
          appId: f.get("githubAppId"),
          installationId: f.get("githubInstallationId"),
        },
        provider: {
          kind: f.get("providerKind"),
          model: f.get("model"),
          baseUrl: f.get("providerUrl"),
        },
      };
      await request("/api/config", "POST", {
        config,
        expected_revision: state.configRevision,
      });
      const secrets = {};
      if (f.get("githubKey")) secrets.github = f.get("githubKey");
      if (f.get("githubAppKey")) secrets.githubAppKey = f.get("githubAppKey");
      if (f.get("providerKey")) secrets.provider = f.get("providerKey");
      if (Object.keys(secrets).length)
        await request("/api/secrets", "POST", secrets);
      notify("Configuration enregistrée.");
      await refresh(true);
      return;
    }
    if (id === "job-form") {
      const r = await request(
        "/api/jobs",
        "POST",
        {
          repository: f.get("repository"),
          kind: f.get("kind"),
          limits: readLimits(f),
        },
        crypto.randomUUID(),
      );
      notify("Travail mis en attente.");
    } else if (id === "routine-form") {
      const [hour, minute] = f.get("time").split(":").map(Number);
      await request("/api/routines", "POST", {
        ...(form.dataset.id ? { id: form.dataset.id } : {}),
        title: f.get("title"),
        repository: f.get("repository"),
        kind: f.get("kind"),
        hour,
        minute,
        timezone: f.get("timezone"),
        enabled: f.has("enabled"),
        limits: readLimits(f),
        expected_revision: Number(form.dataset.version),
      });
      notify("Routine enregistrée.");
    } else if (id === "document-form") {
      await request(
        "/api/documents",
        "POST",
        {
          ...Object.fromEntries(f),
          expected_version: Number(form.dataset.version),
        },
        crypto.randomUUID(),
      );
      notify("Nouvelle version enregistrée.");
    } else if (id === "work-form") {
      await request(
        "/api/work-items",
        "POST",
        {
          ...(form.dataset.id ? { id: form.dataset.id } : {}),
          ...Object.fromEntries(f),
          expected_version: Number(form.dataset.version),
        },
        crypto.randomUUID(),
      );
      notify("Travail enregistré.");
    } else if (id === "token-form") {
      const r = await request("/api/tokens", "POST", {
        label: f.get("label"),
        days: Number(f.get("days")),
        scopes: f.getAll("scopes"),
      });
      await refresh();
      modal(
        "Votre clé de connexion",
        '<p>Copiez cette clé maintenant. Elle ne sera plus affichée ensuite.</p><textarea rows="3" readonly aria-label="Clé de connexion">' +
          E(r.token) +
          '</textarea><p class="fineprint">En-tête : Authorization: Bearer &lt;votre clé&gt;<br>Expire le ' +
          date(r.expires) +
          "</p>",
      );
      return;
    } else if (id === "finding-form") {
      const args = {
        id: form.dataset.id,
        statut: f.get("statut"),
        note: f.get("note"),
      };
      if (f.get("pr_url")) args.pr_url = f.get("pr_url");
      const r = await request("/api/security/tool", "POST", {
        name: "securite_maj_faille",
        arguments: args,
      });
      if (r.isError)
        throw new Error(
          r.structuredContent?.error?.message || "Modification refusée.",
        );
      notify("Signalement mis à jour.");
    }
    dialog.close();
    await refresh(true);
  } catch (error) {
    notify(error.message, true);
  } finally {
    delete form.dataset.busy;
    if (button) button.disabled = false;
  }
}
document.addEventListener("click", async (e) => {
  const b = e.target.closest("[data-action]");
  if (!b) return;
  e.preventDefault();
  const a = b.dataset.action,
    id = b.dataset.id;
  if (b.dataset.busy) return;
  try {
    if (a === "close-dialog") {
      dialog.close();
      return;
    }
    if (a === "new-job") {
      jobForm();
      return;
    }
    if (a === "new-routine" || a === "routine") {
      routineForm(state.routines.find((r) => r.id === id));
      return;
    }
    if (a === "new-document") {
      documentForm();
      return;
    }
    if (a === "document") {
      documentForm(await request("/api/documents/" + encodeURIComponent(id)));
      return;
    }
    if (a === "new-work" || a === "work") {
      workForm(state.workItems.find((w) => w.id === id));
      return;
    }
    if (a === "new-token") {
      modal(
        "Créer une clé",
        '<form id="token-form"><label>Nom de l’application<input name="label" maxlength="100" required></label><label>Durée (jours)<input name="days" type="number" min="1" max="365" value="30" required></label><div class="checks">' +
          ["metis:read", "metis:write", "security:read", "security:write"]
            .map(
              (s) =>
                '<label><input type="checkbox" name="scopes" value="' +
                s +
                '" ' +
                (s.endsWith(":read") ? "checked" : "") +
                ">" +
                E(s) +
                "</label>",
            )
            .join("") +
          "</div><button>Créer la clé</button></form>",
      );
      return;
    }
    b.dataset.busy = "1";
    b.disabled = true;
    if (a === "logout") {
      await request("/api/logout", "POST", {});
      state = null;
      csrf = "";
      status = await request("/api/status");
      authView();
      return;
    }
    if (a === "provider-test") {
      const r = await request("/api/provider/test", "POST", {});
      notify(
        "Connexion et appels d’outils vérifiés · " + N(r.tokens) + " jetons.",
      );
    } else if (a === "github-test") {
      if (!state.config.repositories.length)
        throw new Error("Enregistrez d’abord un dépôt.");
      const r = await request("/api/github/test", "POST", {
        repository: state.config.repositories[0],
      });
      notify("Accès confirmé : " + r.repository);
    } else if (a === "github-sync") {
      const r = await request("/api/github/sync", "POST", {});
      if (!r.ok) throw new Error(r.message);
      notify(r.message);
    } else if (a === "cancel" || a === "resume") {
      await request("/api/jobs/" + id + "/" + a, "POST", {});
      notify(a === "cancel" ? "Arrêt demandé." : "Reprise mise en attente.");
    } else if (a === "revoke-token" || a === "revoke-client") {
      await request(
        a === "revoke-token" ? "/api/tokens/revoke" : "/api/clients/revoke",
        "POST",
        { id },
      );
      notify("Accès révoqué.");
    } else if (a === "job") {
      const j = await request("/api/jobs/" + id);
      modal(
        "Journal du travail",
        '<div class="actions">' +
          badge(j.state) +
          badge(j.kind === "audit" ? "Analyse statique" : "Suivi des PR") +
          '</div><h3 class="section">' +
          E(j.repository) +
          '</h3><p class="muted break">' +
          E(j.commit_sha || "Révision non encore lue") +
          "</p>" +
          (j.error ? '<div class="hint warn">' + E(j.error) + "</div>" : "") +
          (j.result
            ? "<h3>Résultat</h3><p>" +
              E(j.result.summary || "Pull requests relues.").replace(
                /\n/g,
                "<br>",
              ) +
              '</p><p class="muted">' +
              E(j.result.limitations || "") +
              "</p>"
            : "") +
          '<p class="fineprint">' +
          N(j.usage.calls) +
          " appel(s) · " +
          N(j.usage.tokens) +
          " jetons · " +
          N(j.usage.files) +
          " lecture(s)<br>Budget : " +
          j.limits.maxCalls +
          " appels, " +
          N(j.limits.maxTokens) +
          ' jetons. Aucune exécution de code.</p><h3 class="section">Activité</h3>' +
          j.events
            .map(
              (ev) =>
                '<div class="row"><p>' +
                E(ev.message) +
                '</p><span class="fineprint">' +
                date(ev.at) +
                "</span></div>",
            )
            .join(""),
      );
      return;
    } else if (a === "finding") {
      const r = await request("/api/security/tool", "POST", {
        name: "securite_lire_faille",
        arguments: { id },
      });
      const f = r.structuredContent?.faille;
      if (!f) throw new Error("Signalement introuvable.");
      modal(
        f.titre,
        '<div class="actions">' +
          badge(f.gravite) +
          badge(f.statut) +
          '</div><p class="muted section">' +
          E(f.depot) +
          " · " +
          E(f.emplacement) +
          "</p><p>" +
          E(f.description) +
          "</p><h3>Preuves déclarées</h3>" +
          (f.preuves || [])
            .map(
              (p) =>
                '<p class="fineprint">' +
                E(p.ref || p.type) +
                '</p><pre class="code">' +
                E(p.contenu) +
                "</pre>",
            )
            .join("") +
          '<hr><form id="finding-form" data-id="' +
          E(f.id) +
          '"><label>État<select name="statut">' +
          [
            "nouvelle",
            "confirmee",
            "pr_ouverte",
            "corrigee",
            "faux_positif",
            "acceptee",
          ]
            .map(
              (s) =>
                '<option value="' +
                s +
                '" ' +
                (s === f.statut ? "selected" : "") +
                ">" +
                labels[s] +
                "</option>",
            )
            .join("") +
          '</select></label><label>PR de correction<input type="url" name="pr_url" value="' +
          E(f.pr_url || "") +
          '" placeholder="https://github.com/organisation/depot/pull/1"></label><label>Note de décision<textarea name="note" maxlength="500" rows="3"></textarea></label><button>Mettre à jour</button></form>',
      );
      return;
    }
    await refresh(true);
  } catch (error) {
    notify(error.message, true);
  } finally {
    delete b.dataset.busy;
    b.disabled = false;
  }
});
window.addEventListener("hashchange", render);
(async () => {
  try {
    status = await request("/api/status");
    try {
      await refresh(true);
    } catch (e) {
      if (e.status === 401) authView();
      else throw e;
    }
  } catch (e) {
    root.textContent = "Impossible d’ouvrir Métis : " + e.message;
  }
})();
setInterval(() => {
  if (state && !document.hidden)
    refresh().catch((e) => {
      if (e.status === 401) {
        state = null;
        authView();
      }
    });
}, 10000);
