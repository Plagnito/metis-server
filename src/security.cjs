"use strict";
// Extracted from the owner's Atlas Security Center, commit 227e897b68fbbaf2d6436084526519bf28ededf8.
// Standalone storage, repository selection, credentials and clock configuration.
const crypto = require("node:crypto");
function createSecurity({ db, config, githubToken, githubFetch = fetch }) {
  const GRAVITES = ["critique", "haute", "moyenne", "basse"];
  const POIDS = { critique: 4, haute: 3, moyenne: 2, basse: 1 };
  // Le chemin d'une correction : nouvelle → confirmée → PR ouverte → corrigée (PR fusionnée)
  // → revalidée (un audit ULTÉRIEUR a constaté sa disparition). « revalidee » ne se pose
  // que par securite_revalider_faille ; une revalidation ratée rouvre la faille.
  const STATUTS = [
    "nouvelle",
    "confirmee",
    "pr_ouverte",
    "corrigee",
    "revalidee",
    "faux_positif",
    "acceptee",
  ];
  const OUVERTS = ["nouvelle", "confirmee", "pr_ouverte"];
  const TYPES_PREUVE = [
    "extrait",
    "commande",
    "test",
    "job",
    "lien",
    "observation",
  ];
  const ETATS = ["prevu", "en_cours", "termine", "reporte", "echec"];
  const ETAPES = ["plan", "lecture", "tests", "rapport"];
  const RESULTATS = ["rien", "failles", "echec"];
  const SILENCE_MIN = 70;
  const selected = (name) =>
    config().repositories.some((r) => r.toLowerCase() === name.toLowerCase());

  // L'horloge est remplaçable pour les tests (jamais ailleurs).
  let horloge = () => new Date();
  function _fixerHorloge(f) {
    horloge = f || (() => new Date());
  }
  const maintenant = () => horloge();
  const iso = (d = maintenant()) => d.toISOString();

  class ErreurSecurite extends Error {
    constructor(code, message, statut = 400) {
      super(message);
      this.code = code;
      this.statut = statut;
    }
  }
  const refuser = (code, message, statut) => {
    throw new ErreurSecurite(code, message, statut);
  };

  // ── Heure de Paris ───────────────────────────────────────────────────────────
  let formatter, formatterZone;
  function paris(d = maintenant()) {
    const zone = config().timezone;
    if (formatterZone !== zone) {
      formatterZone = zone;
      formatter = new Intl.DateTimeFormat("en-CA", {
        timeZone: zone,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        hourCycle: "h23",
      });
    }
    const p = {};
    for (const x of formatter.formatToParts(d)) p[x.type] = x.value;
    return {
      jour: p.year + "-" + p.month + "-" + p.day,
      heure: Number(p.hour),
      minute: Number(p.minute),
    };
  }
  function jourValide(j) {
    if (typeof j !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(j)) return false;
    const d = new Date(j + "T12:00:00Z");
    return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === j;
  }
  function decalerJour(j, n) {
    const d = new Date(j + "T12:00:00Z");
    d.setUTCDate(d.getUTCDate() + n);
    return d.toISOString().slice(0, 10);
  }

  // ── Schéma ───────────────────────────────────────────────────────────────────
  let pret = false;
  function init() {
    if (pret) return;
    db.exec(`
    CREATE TABLE IF NOT EXISTS securite_depots (
      nom_complet  TEXT PRIMARY KEY,
      proprietaire TEXT NOT NULL,
      nom          TEXT NOT NULL,
      famille      TEXT NOT NULL,
      public       INTEGER NOT NULL DEFAULT 0,
      langage      TEXT,
      archive      INTEGER NOT NULL DEFAULT 0,
      pousse_le    TEXT,
      vu_le        TEXT NOT NULL,
      source       TEXT NOT NULL DEFAULT 'github'
    );
    CREATE INDEX IF NOT EXISTS securite_depots_nom ON securite_depots(nom);
    CREATE TABLE IF NOT EXISTS securite_plans (
      jour       TEXT PRIMARY KEY,
      etabli_le  TEXT NOT NULL,
      priorites  TEXT NOT NULL DEFAULT '',
      auteur     TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS securite_creneaux (
      id                INTEGER PRIMARY KEY AUTOINCREMENT,
      jour              TEXT NOT NULL,
      heure             INTEGER NOT NULL,
      depot             TEXT NOT NULL,
      angle             TEXT NOT NULL,
      raison            TEXT NOT NULL DEFAULT '',
      etat              TEXT NOT NULL DEFAULT 'prevu',
      debut_le          TEXT,
      fin_le            TEXT,
      derniere_activite TEXT,
      etape             TEXT,
      journal           TEXT NOT NULL DEFAULT '[]',
      resume            TEXT,
      resultat          TEXT,
      fichiers_lus      INTEGER,
      job_ref           TEXT,
      UNIQUE (jour, heure)
    );
    CREATE INDEX IF NOT EXISTS securite_creneaux_depot ON securite_creneaux(depot);
    CREATE TABLE IF NOT EXISTS securite_failles (
      id           TEXT PRIMARY KEY,
      depot        TEXT NOT NULL,
      titre        TEXT NOT NULL,
      gravite      TEXT NOT NULL,
      cwe          TEXT,
      emplacement  TEXT,
      description  TEXT NOT NULL DEFAULT '',
      statut       TEXT NOT NULL DEFAULT 'nouvelle',
      pr_url       TEXT,
      empreinte    TEXT NOT NULL,
      creneau_id   INTEGER,
      trouvee_le   TEXT NOT NULL,
      maj_le       TEXT NOT NULL,
      pr_le        TEXT,
      corrigee_le  TEXT,
      revalidee_le TEXT,
      recidive_de  TEXT,
      preuves      TEXT NOT NULL DEFAULT '[]',
      auteur       TEXT NOT NULL,
      historique   TEXT NOT NULL DEFAULT '[]'
    );
    CREATE INDEX IF NOT EXISTS securite_failles_depot ON securite_failles(depot, statut);
    -- Les passages du GESTIONNAIRE (triage et corrections, chaque heure à :35).
    -- L'auditeur, lui, a ses créneaux : les deux agents se suivent séparément.
    CREATE TABLE IF NOT EXISTS securite_passages (
      id                INTEGER PRIMARY KEY AUTOINCREMENT,
      agent             TEXT NOT NULL DEFAULT 'gestionnaire',
      debut_le          TEXT NOT NULL,
      fin_le            TEXT,
      derniere_activite TEXT NOT NULL,
      etat              TEXT NOT NULL DEFAULT 'en_cours',
      resultat          TEXT,
      resume            TEXT,
      erreur            TEXT,
      operations        INTEGER NOT NULL DEFAULT 0
    );
    -- Le journal d'activité des deux agents : heure, action, résultat, erreur éventuelle.
    CREATE TABLE IF NOT EXISTS securite_operations (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      le          TEXT NOT NULL,
      agent       TEXT NOT NULL,
      passage_id  INTEGER,
      creneau_id  INTEGER,
      action      TEXT NOT NULL,
      cible       TEXT,
      resultat    TEXT,
      erreur      TEXT
    );
    CREATE INDEX IF NOT EXISTS securite_operations_agent ON securite_operations(agent, id);
  `);
    // Importance réglée À LA MAIN (01/11/2026). Colonnes ajoutées sans valeur par défaut :
    // NULL = « pas de réglage manuel », le classement de base s'applique.
    const colonnes = db
      .prepare("PRAGMA table_info(securite_depots)")
      .all()
      .map((c) => c.name);
    for (const [nom, type] of [
      ["importance", "TEXT"],
      ["importance_raison", "TEXT"],
      ["importance_le", "TEXT"],
      ["importance_par", "TEXT"],
    ]) {
      if (!colonnes.includes(nom))
        db.exec("ALTER TABLE securite_depots ADD COLUMN " + nom + " " + type);
    }
    pret = true;
  }

  // ── Importance des dépôts ────────────────────────────────────────────────────
  //   actif  : audité normalement ;
  //   faible : au plus un audit tous les 30 jours, deux par plan au maximum, après les actifs ;
  //   mort   : jamais audité, hors indicateurs (couverture, négligés, candidats).
  // Ordre de résolution : réglage manuel > classement de base (JSON versionné) > motif >
  // règle automatique (aucun push depuis un an → faible) > actif.
  const IMPORTANCES = ["actif", "faible", "mort"];
  const FAIBLE_JOURS = 30;
  const FAIBLE_PAR_PLAN = 2;
  let base = null;
  function classementDeBase() {
    return { exact: {}, motifs: [] };
  }
  function importanceDe(d) {
    if (d.importance && IMPORTANCES.includes(d.importance))
      return {
        niveau: d.importance,
        raison: d.importance_raison || "",
        source: "manuel",
        le: d.importance_le,
        par: d.importance_par,
      };
    const b = classementDeBase();
    const e = b.exact[String(d.nom_complet).toLowerCase()];
    if (e && IMPORTANCES.includes(e.niveau))
      return { niveau: e.niveau, raison: e.raison, source: "base" };
    const m = b.motifs.find((x) => x.re.test(d.nom_complet));
    if (m && IMPORTANCES.includes(m.niveau))
      return { niveau: m.niveau, raison: m.raison, source: "base" };
    if (
      d.pousse_le &&
      maintenant().getTime() - Date.parse(d.pousse_le) > 365 * 86400e3
    )
      return {
        niveau: "faible",
        raison: "Aucune modification depuis plus d’un an.",
        source: "auto",
      };
    return { niveau: "actif", raison: "", source: "defaut" };
  }

  // ── Validation ───────────────────────────────────────────────────────────────
  function cles(objet, permises, ou) {
    if (!objet || typeof objet !== "object" || Array.isArray(objet))
      refuser("INVALID_ARGUMENT", ou + " : objet attendu.");
    const inconnues = Object.keys(objet).filter((k) => !permises.includes(k));
    if (inconnues.length)
      refuser(
        "INVALID_ARGUMENT",
        ou +
          " : champ(s) inconnu(s) " +
          inconnues.join(", ") +
          ". Champs admis : " +
          permises.join(", ") +
          ".",
      );
  }
  function texteBorne(
    v,
    champ,
    { min = 1, max = 300, facultatif = false } = {},
  ) {
    if (v == null || v === "") {
      if (facultatif) return null;
      refuser("INVALID_ARGUMENT", champ + " est requis.");
    }
    if (typeof v !== "string")
      refuser("INVALID_ARGUMENT", champ + " doit être un texte.");
    const t = v.replace(/[\u0000-\u0008\u000b-\u001f]/g, "").trim();
    if (t.length < min || t.length > max)
      refuser(
        "INVALID_ARGUMENT",
        champ + " : entre " + min + " et " + max + " caractères.",
      );
    return t;
  }
  function entier(v, champ, min, max, facultatif = false) {
    if (v == null) {
      if (facultatif) return null;
      refuser("INVALID_ARGUMENT", champ + " est requis.");
    }
    if (!Number.isInteger(v) || v < min || v > max)
      refuser(
        "INVALID_ARGUMENT",
        champ + " : entier de " + min + " à " + max + ".",
      );
    return v;
  }
  function parmi(v, liste, champ) {
    if (!liste.includes(v))
      refuser(
        "INVALID_ARGUMENT",
        champ + " : une valeur parmi " + liste.join(", ") + ".",
      );
    return v;
  }
  function urlPr(v) {
    const t = texteBorne(v, "pr_url", { max: 300, facultatif: true });
    if (
      t &&
      !/^https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\/pull\/\d+$/.test(
        t,
      )
    )
      refuser(
        "INVALID_ARGUMENT",
        "pr_url : adresse d’une pull request GitHub attendue (https://github.com/<compte>/<dépôt>/pull/<n>).",
      );
    return t;
  }

  // ── Inventaire des dépôts ────────────────────────────────────────────────────
  function familleDe() {
    return "depots";
  }
  const LIBELLE_FAMILLE = { depots: "Dépôts sélectionnés" };

  /** Retrouve un dépôt par « nom » ou « Compte/nom ». Refuse une ambiguïté. */
  function resoudreDepot(saisie) {
    init();
    const s = texteBorne(saisie, "depot", { max: 140 });
    if (s.includes("/")) {
      const d = db
        .prepare(
          "SELECT * FROM securite_depots WHERE lower(nom_complet) = lower(?)",
        )
        .get(s);
      if (!d)
        refuser(
          "NOT_FOUND",
          "Dépôt inconnu de l’inventaire : " +
            s +
            ". securite_inventaire liste les dépôts ; securite_declarer_depots en ajoute un.",
          404,
        );
      return d;
    }
    const l = db
      .prepare(
        "SELECT * FROM securite_depots WHERE lower(nom) = lower(?) AND archive = 0",
      )
      .all(s);
    if (!l.length)
      refuser(
        "NOT_FOUND",
        "Dépôt inconnu de l’inventaire : " +
          s +
          ". securite_inventaire liste les dépôts ; securite_declarer_depots en ajoute un.",
        404,
      );
    if (l.length > 1)
      refuser(
        "AMBIGUOUS",
        "Plusieurs dépôts s’appellent " +
          s +
          " : " +
          l.map((d) => d.nom_complet).join(", ") +
          ". Donnez le nom complet.",
        409,
      );
    return l[0];
  }

  function enregistrerDepot(r, source) {
    const t = iso();
    db.prepare(
      `INSERT INTO securite_depots (nom_complet, proprietaire, nom, famille, public, langage, archive, pousse_le, vu_le, source)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
              ON CONFLICT(nom_complet) DO UPDATE SET public = excluded.public, langage = excluded.langage,
                archive = excluded.archive, pousse_le = COALESCE(excluded.pousse_le, securite_depots.pousse_le),
                vu_le = excluded.vu_le, famille = excluded.famille,
                source = CASE WHEN securite_depots.source = 'github' THEN 'github' ELSE excluded.source END`,
    ).run(
      r.proprietaire + "/" + r.nom,
      r.proprietaire,
      r.nom,
      familleDe(r.proprietaire, r.nom),
      r.public ? 1 : 0,
      r.langage || null,
      r.archive ? 1 : 0,
      r.pousse_le || null,
      t,
      source,
    );
  }

  let derniereSynchro = {
    le: null,
    ok: null,
    message: "jamais lancée",
    nombre: 0,
  };
  let synchroEnCours = null;

  function jetonGithub() {
    return githubToken();
  }

  /**
   * Synchronise l'inventaire depuis GitHub. Avec un jeton : /user/repos (privés compris,
   * comptes propres ET organisations dont le titulaire est membre). Sans jeton, ou si le
   * listing authentifié échoue : les dépôts PUBLICS de chaque compte — et la vue est dite
   * INCOMPLÈTE, pour ne jamais faire croire que les dépôts privés ont disparu.
   */
  async function synchroniserDepots() {
    init();
    if (synchroEnCours) return synchroEnCours;
    synchroEnCours = (async () => {
      let nombre = 0;
      const errors = [];
      for (const name of config().repositories) {
        try {
          const token = jetonGithub();
          const r = await githubFetch("https://api.github.com/repos/" + name, {
            headers: {
              Accept: "application/vnd.github+json",
              "User-Agent": "metis-server",
              ...(token ? { Authorization: "Bearer " + token } : {}),
            },
            signal: AbortSignal.timeout(20000),
            redirect: "error",
          });
          if (!r.ok) throw new Error("HTTP " + r.status);
          const row = await r.json();
          if (
            !row.full_name ||
            row.full_name.toLowerCase() !== name.toLowerCase()
          )
            throw new Error("Dépôt distant inattendu");
          enregistrerDepot(
            {
              proprietaire: row.owner.login,
              nom: row.name,
              public: !row.private,
              langage: row.language,
              archive: !!row.archived,
              pousse_le: row.pushed_at,
            },
            "github",
          );
          nombre++;
        } catch {
          errors.push(name);
        }
      }
      derniereSynchro = {
        le: iso(),
        ok: errors.length === 0,
        nombre,
        message: errors.length
          ? "Synchronisation partielle : " + errors.join(", ")
          : "Dépôts sélectionnés synchronisés.",
      };
      return derniereSynchro;
    })().finally(() => {
      synchroEnCours = null;
    });
    return synchroEnCours;
  }

  /** Lance une synchronisation en arrière-plan si la dernière date de plus de 6 h. */
  function synchroniserSiAncienne() {
    const vieux =
      !derniereSynchro.le ||
      Date.now() - Date.parse(derniereSynchro.le) > 6 * 3600e3;
    if (vieux && !synchroEnCours)
      synchroniserDepots().catch(() => {
        /* consigné dans derniereSynchro */
      });
  }

  function declarerDepots(moi, args) {
    init();
    cles(args, ["depots"], "securite_declarer_depots");
    if (
      !Array.isArray(args.depots) ||
      !args.depots.length ||
      args.depots.length > 50
    )
      refuser("INVALID_ARGUMENT", "depots : liste de 1 à 50 dépôts.");
    const faits = [];
    for (const d of args.depots) {
      cles(d, ["nom_complet", "public", "langage"], "depot");
      const nc = texteBorne(d.nom_complet, "nom_complet", { max: 140 });
      const m = /^([A-Za-z0-9-]+)\/([A-Za-z0-9_.-]+)$/.exec(nc);
      if (!m || !selected(nc))
        refuser(
          "INVALID_ARGUMENT",
          "Sélectionnez d’abord ce dépôt dans la configuration de l’instance.",
        );
      enregistrerDepot(
        {
          proprietaire: m[1],
          nom: m[2],
          public: d.public === true,
          langage: texteBorne(d.langage, "langage", {
            max: 40,
            facultatif: true,
          }),
        },
        "declare",
      );
      faits.push(nc);
    }
    return { ok: true, declares: faits };
  }

  // ── Créneaux : état réel (le silence se lit comme « reporté ») ────────────────
  function enRetard(c, ici = paris()) {
    if (c.etat === "prevu") {
      if (ici.jour > c.jour) return true;
      return (
        ici.jour === c.jour &&
        ici.heure * 60 + ici.minute >= c.heure * 60 + SILENCE_MIN
      );
    }
    if (c.etat === "en_cours") {
      const t = Date.parse(c.derniere_activite || c.debut_le || "");
      return (
        !Number.isFinite(t) || maintenant().getTime() - t > SILENCE_MIN * 60e3
      );
    }
    return false;
  }
  /** Passe en « reporté » les créneaux restés silencieux. Rend le nombre de créneaux touchés. */
  function marquerSilences() {
    init();
    const ici = paris();
    const l = db
      .prepare(
        "SELECT * FROM securite_creneaux WHERE etat IN ('prevu','en_cours') AND jour <= ?",
      )
      .all(ici.jour);
    let n = 0;
    for (const c of l) {
      if (!enRetard(c, ici)) continue;
      const motif =
        c.etat === "prevu"
          ? "aucun démarrage " + SILENCE_MIN + " min après l’heure prévue"
          : "aucune activité depuis " + SILENCE_MIN + " min";
      const r = db
        .prepare(
          "UPDATE securite_creneaux SET etat = 'reporte', resume = COALESCE(resume, ?), fin_le = ? WHERE id = ? AND etat = ?",
        )
        .run("Reporté : " + motif + ".", iso(), c.id, c.etat);
      if (r.changes)
        consigner({
          agent: "auditeur",
          creneau_id: c.id,
          action: "Créneau reporté",
          cible: c.depot + " · " + String(c.heure).padStart(2, "0") + " h",
          erreur: motif,
        });
      n++;
    }
    // Un passage du gestionnaire sans activité pendant GESTION_SILENCE_MIN est INTERROMPU,
    // jamais « terminé » : un horaire tenu ne se présente pas comme un succès.
    const limite = iso(
      new Date(maintenant().getTime() - GESTION_SILENCE_MIN * 60e3),
    );
    for (const p of db
      .prepare(
        "SELECT * FROM securite_passages WHERE etat = 'en_cours' AND derniere_activite < ?",
      )
      .all(limite)) {
      const motif = "aucune activité depuis " + GESTION_SILENCE_MIN + " min";
      const r = db
        .prepare(
          "UPDATE securite_passages SET etat = 'interrompu', fin_le = ?, erreur = ? WHERE id = ? AND etat = 'en_cours'",
        )
        .run(iso(), motif, p.id);
      if (r.changes)
        consigner({
          agent: "gestionnaire",
          passage_id: p.id,
          action: "Passage interrompu",
          erreur: motif,
        });
      n++;
    }
    return n;
  }

  // ── Journal d'activité des deux agents ───────────────────────────────────────
  const AGENTS = ["auditeur", "gestionnaire"];
  const GESTION_MINUTE = 35; // le gestionnaire passe chaque heure à :35
  const GESTION_RETARD_MIN = 25; // passage manqué s'il n'a pas commencé 25 min après
  const GESTION_SILENCE_MIN = 30; // passage interrompu après 30 min sans activité
  const RESULTATS_GESTION = ["rien", "fait", "echec"];
  const coupe = (v, n) => (v == null ? null : String(v).slice(0, n));

  /** Ajoute une ligne au journal d'activité. `agent` : auditeur, gestionnaire ou hors_routine. */
  function consigner({
    agent,
    action,
    cible = null,
    resultat = null,
    erreur = null,
    passage_id = null,
    creneau_id = null,
  }) {
    init();
    const t = iso();
    const r = db
      .prepare(
        "INSERT INTO securite_operations (le, agent, passage_id, creneau_id, action, cible, resultat, erreur) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
      )
      .run(
        t,
        agent,
        passage_id,
        creneau_id,
        coupe(action, 120),
        coupe(cible, 200),
        coupe(resultat, 300),
        coupe(erreur, 300),
      );
    if (passage_id)
      db.prepare(
        "UPDATE securite_passages SET derniere_activite = ?, operations = operations + 1 WHERE id = ? AND etat = 'en_cours'",
      ).run(t, passage_id);
    const id = Number(r.lastInsertRowid);
    if (id % 200 === 0)
      db.prepare("DELETE FROM securite_operations WHERE id <= ?").run(
        id - 5000,
      );
  }

  /** Qui agit maintenant ? Le gestionnaire s'il a un passage ouvert, l'auditeur s'il audite, sinon personne. */
  function agentCourant() {
    const p = db
      .prepare(
        "SELECT id FROM securite_passages WHERE etat = 'en_cours' ORDER BY id DESC LIMIT 1",
      )
      .get();
    if (p) return { agent: "gestionnaire", passage_id: p.id };
    const c = db
      .prepare(
        "SELECT id FROM securite_creneaux WHERE etat = 'en_cours' ORDER BY id DESC LIMIT 1",
      )
      .get();
    if (c) return { agent: "auditeur", creneau_id: c.id };
    return { agent: "hors_routine" };
  }

  const OUTIL_AGENT = {
    securite_planifier_journee: "auditeur",
    securite_demarrer_audit: "auditeur",
    securite_journaliser_audit: "auditeur",
    securite_terminer_audit: "auditeur",
    securite_demarrer_gestion: "gestionnaire",
    securite_journaliser_gestion: "gestionnaire",
    securite_terminer_gestion: "gestionnaire",
  };
  const OUTILS_TRIAGE = [
    "securite_declarer_faille",
    "securite_maj_faille",
    "securite_revalider_faille",
    "securite_suivi_corrections",
  ];

  /** Un appel REFUSÉ d'un agent est consigné aussi : c'est l'« éventuelle erreur » du journal. */
  function consignerErreur(outil, e) {
    try {
      let qui;
      if (OUTIL_AGENT[outil]) {
        const c = agentCourant();
        qui =
          c.agent === OUTIL_AGENT[outil] ? c : { agent: OUTIL_AGENT[outil] };
      } else if (OUTILS_TRIAGE.includes(outil)) qui = agentCourant();
      else return;
      consigner({
        ...qui,
        action: "Appel refusé : " + outil,
        erreur:
          (e && e.code ? e.code + " — " : "") +
          (e && e.message ? e.message : String(e)),
      });
    } catch {
      /* le journal ne doit jamais faire échouer l'appel */
    }
  }

  function lireOperations(agent, limit = 15) {
    init();
    const quoi =
      agent === "gestionnaire"
        ? "agent IN ('gestionnaire','hors_routine')"
        : "agent = 'auditeur'";
    return db
      .prepare(
        "SELECT * FROM securite_operations WHERE " +
          quoi +
          " ORDER BY le DESC, id DESC LIMIT ?",
      )
      .all(limit)
      .map((o) => ({
        id: o.id,
        le: o.le,
        agent: o.agent,
        action: o.action,
        cible: o.cible,
        resultat: o.resultat,
        erreur: o.erreur,
        passage_id: o.passage_id,
        creneau_id: o.creneau_id,
      }));
  }

  function journalAgents(moi, args = {}) {
    init();
    cles(args, ["agent", "limit"], "securite_journal");
    marquerSilences();
    const agent = parmi(args.agent, AGENTS, "agent");
    const limit = args.limit == null ? 50 : entier(args.limit, "limit", 1, 200);
    return {
      ok: true,
      agent,
      operations: lireOperations(agent, limit),
      note:
        agent === "gestionnaire"
          ? "Les opérations de triage faites hors d’un passage ouvert sont marquées « hors_routine »."
          : "Démarrages, fins, reports et appels refusés des audits.",
    };
  }

  function lireJournal(c) {
    try {
      const j = JSON.parse(c.journal || "[]");
      return Array.isArray(j) ? j : [];
    } catch {
      return [];
    }
  }
  function vueCreneau(c) {
    return {
      id: c.id,
      jour: c.jour,
      heure: c.heure,
      depot: c.depot,
      angle: c.angle,
      raison: c.raison,
      etat: c.etat,
      debut_le: c.debut_le,
      fin_le: c.fin_le,
      derniere_activite: c.derniere_activite,
      etape: c.etape,
      resume: c.resume,
      resultat: c.resultat,
      fichiers_lus: c.fichiers_lus,
      job_ref: c.job_ref,
      journal: lireJournal(c),
    };
  }

  // ── Plan du jour ─────────────────────────────────────────────────────────────
  function planifierJournee(moi, args, auteur = "assistant") {
    init();
    cles(args, ["jour", "priorites", "creneaux"], "securite_planifier_journee");
    const ici = paris();
    const jour = args.jour == null ? ici.jour : args.jour;
    if (!jourValide(jour))
      refuser("INVALID_ARGUMENT", "jour : date AAAA-MM-JJ.");
    if (jour < ici.jour || jour > decalerJour(ici.jour, 1))
      refuser(
        "INVALID_ARGUMENT",
        "jour : aujourd’hui (" +
          ici.jour +
          ") ou demain seulement, à l’heure locale de l’instance.",
      );
    const priorites = texteBorne(args.priorites, "priorites", { max: 1200 });
    if (
      !Array.isArray(args.creneaux) ||
      !args.creneaux.length ||
      args.creneaux.length > 23
    )
      refuser("INVALID_ARGUMENT", "creneaux : de 1 à 23 créneaux.");
    const vus = new Set();
    const lignes = args.creneaux.map((c, i) => {
      cles(c, ["heure", "depot", "angle", "raison"], "creneaux[" + i + "]");
      const heure = entier(c.heure, "creneaux[" + i + "].heure", 1, 23);
      if (vus.has(heure))
        refuser(
          "INVALID_ARGUMENT",
          "Deux créneaux à " + heure + " h : une heure, un seul audit.",
        );
      vus.add(heure);
      const d = resoudreDepot(c.depot);
      const imp = importanceDe(d);
      if (imp.niveau === "mort")
        refuser(
          "FAILED_PRECONDITION",
          d.nom_complet +
            " est classé « mort » (" +
            imp.raison +
            ") : il n’est plus audité. securite_classer_depots le réactive si besoin.",
          409,
        );
      return {
        heure,
        depot: d.nom_complet,
        niveau: imp.niveau,
        angle: texteBorne(c.angle, "creneaux[" + i + "].angle", {
          min: 3,
          max: 120,
        }),
        raison:
          texteBorne(c.raison, "creneaux[" + i + "].raison", {
            max: 300,
            facultatif: true,
          }) || "",
      };
    });
    // Un dépôt peu important : au plus FAIBLE_PAR_PLAN créneaux, et pas s'il a été audité
    // depuis moins de FAIBLE_JOURS jours (sauf faille encore ouverte à suivre).
    const faibles = lignes.filter((l) => l.niveau === "faible");
    if (faibles.length > FAIBLE_PAR_PLAN)
      refuser(
        "INVALID_ARGUMENT",
        "Au plus " +
          FAIBLE_PAR_PLAN +
          " créneaux par jour pour des dépôts peu importants (" +
          faibles.length +
          " demandés : " +
          [...new Set(faibles.map((l) => l.depot))].join(", ") +
          ").",
      );
    const limite = iso(
      new Date(maintenant().getTime() - FAIBLE_JOURS * 86400e3),
    );
    for (const l of faibles) {
      const recent = db
        .prepare(
          "SELECT MAX(fin_le) AS fin FROM securite_creneaux WHERE depot = ? AND etat = 'termine'",
        )
        .get(l.depot).fin;
      const ouvertes = db
        .prepare(
          "SELECT COUNT(*) AS n FROM securite_failles WHERE depot = ? AND statut IN ('nouvelle','confirmee','pr_ouverte')",
        )
        .get(l.depot).n;
      if (recent && recent > limite && !ouvertes)
        refuser(
          "FAILED_PRECONDITION",
          l.depot +
            " est peu important et a été audité le " +
            recent.slice(0, 10) +
            " : prochain audit au plus tôt " +
            FAIBLE_JOURS +
            " jours après.",
          409,
        );
    }
    // Un créneau déjà commencé ou passé est gardé tel quel ; on ne remplace que l'avenir.
    const passe = (h) => jour === ici.jour && h <= ici.heure;
    const gardes = db
      .prepare(
        "SELECT heure FROM securite_creneaux WHERE jour = ? AND etat <> 'prevu'",
      )
      .all(jour)
      .map((r) => r.heure);
    const ignores = lignes
      .filter((l) => passe(l.heure) || gardes.includes(l.heure))
      .map((l) => l.heure);
    db.exec("BEGIN IMMEDIATE");
    try {
      db.prepare(
        "INSERT INTO securite_plans (jour, etabli_le, priorites, auteur) VALUES (?, ?, ?, ?) ON CONFLICT(jour) DO UPDATE SET etabli_le = excluded.etabli_le, priorites = excluded.priorites, auteur = excluded.auteur",
      ).run(jour, iso(), priorites, auteur);
      db.prepare(
        "DELETE FROM securite_creneaux WHERE jour = ? AND etat = 'prevu' AND heure > ?",
      ).run(jour, jour === ici.jour ? ici.heure : 0);
      const ins = db.prepare(
        "INSERT INTO securite_creneaux (jour, heure, depot, angle, raison) VALUES (?, ?, ?, ?, ?) ON CONFLICT(jour, heure) DO NOTHING",
      );
      for (const l of lignes)
        if (!ignores.includes(l.heure))
          ins.run(jour, l.heure, l.depot, l.angle, l.raison);
      db.exec("COMMIT");
    } catch (e) {
      db.exec("ROLLBACK");
      throw e;
    }
    consigner({
      agent: "auditeur",
      action: "Plan de la journée établi",
      cible: jour,
      resultat:
        lignes.length -
        ignores.length +
        " créneau(x) planifié(s)" +
        (ignores.length ? ", " + ignores.length + " ignoré(s)" : ""),
    });
    return {
      ok: true,
      jour,
      creneaux: lignes.length - ignores.length,
      ignores,
      page: "/#security",
    };
  }

  // ── Déroulé d'un audit ───────────────────────────────────────────────────────
  function creneauDe(args, permises, outil) {
    cles(args, permises, outil);
    init();
    marquerSilences();
    let c;
    if (args.creneau_id != null)
      c = db
        .prepare("SELECT * FROM securite_creneaux WHERE id = ?")
        .get(entier(args.creneau_id, "creneau_id", 1, 1e9));
    else {
      const ici = paris();
      c = db
        .prepare("SELECT * FROM securite_creneaux WHERE jour = ? AND heure = ?")
        .get(
          ici.jour,
          args.heure == null ? ici.heure : entier(args.heure, "heure", 1, 23),
        );
    }
    if (!c)
      refuser(
        "NOT_FOUND",
        "Aucun créneau planifié ici. securite_etat donne le plan du jour ; securite_planifier_journee le crée.",
        404,
      );
    return c;
  }

  const json = (v, defaut) => {
    try {
      const x = JSON.parse(v);
      return x == null ? defaut : x;
    } catch {
      return defaut;
    }
  };
  function failleVue(f) {
    return {
      id: f.id,
      depot: f.depot,
      titre: f.titre,
      gravite: f.gravite,
      cwe: f.cwe,
      emplacement: f.emplacement,
      description: f.description,
      statut: f.statut,
      pr_url: f.pr_url,
      trouvee_le: f.trouvee_le,
      maj_le: f.maj_le,
      creneau_id: f.creneau_id,
      recidive_de: f.recidive_de || null,
      preuves: json(f.preuves, []).length,
    };
  }
  function failleComplete(f) {
    return {
      ...failleVue(f),
      preuves: json(f.preuves, []),
      historique: json(f.historique, []),
      pr_le: f.pr_le,
      corrigee_le: f.corrigee_le,
      revalidee_le: f.revalidee_le,
      auteur: f.auteur,
    };
  }
  function lirePreuves(liste, ou, auteur) {
    if (liste == null) return [];
    if (!Array.isArray(liste) || liste.length > 10)
      refuser("INVALID_ARGUMENT", ou + " : liste de 0 à 10 preuves.");
    return liste.map((p, i) => {
      cles(p, ["type", "contenu", "ref"], ou + "[" + i + "]");
      return {
        type: parmi(p.type, TYPES_PREUVE, ou + "[" + i + "].type"),
        contenu: texteBorne(p.contenu, ou + "[" + i + "].contenu", {
          max: 2000,
        }),
        ref: texteBorne(p.ref, ou + "[" + i + "].ref", {
          max: 240,
          facultatif: true,
        }),
        le: iso(),
        par: auteur,
      };
    });
  }

  function demarrerAudit(moi, args) {
    let c;
    try {
      c = creneauDe(args, ["creneau_id", "heure"], "securite_demarrer_audit");
    } catch (e) {
      // Heure sans créneau : la tâche horaire s'arrête là, sans erreur ni dépense inutile.
      if (
        e instanceof ErreurSecurite &&
        e.code === "NOT_FOUND" &&
        args &&
        args.creneau_id == null
      ) {
        consigner({
          agent: "auditeur",
          action: "Passage sans audit",
          resultat: "aucun créneau à cette heure : rien à faire",
        });
        return {
          ok: true,
          rien_a_faire: true,
          message:
            "Aucun audit planifié à cette heure : rien à faire, terminez la tâche ici.",
        };
      }
      throw e;
    }
    if (c.etat === "en_cours")
      return { ok: true, deja: true, creneau: vueCreneau(c) };
    if (c.etat !== "prevu")
      refuser(
        "FAILED_PRECONDITION",
        "Ce créneau est « " + c.etat + " » : il ne peut plus démarrer.",
        409,
      );
    const autre = db
      .prepare(
        "SELECT id, depot FROM securite_creneaux WHERE etat = 'en_cours' AND id <> ?",
      )
      .get(c.id);
    if (autre)
      refuser(
        "FAILED_PRECONDITION",
        "Un audit est déjà en cours (créneau " +
          autre.id +
          ", " +
          autre.depot +
          ") : terminez-le d’abord.",
        409,
      );
    const t = iso();
    const journal = [
      { le: t, message: "Audit démarré : " + c.depot + " — " + c.angle },
    ];
    db.prepare(
      "UPDATE securite_creneaux SET etat = 'en_cours', debut_le = ?, derniere_activite = ?, etape = 'plan', journal = ? WHERE id = ?",
    ).run(t, t, JSON.stringify(journal), c.id);
    consigner({
      agent: "auditeur",
      creneau_id: c.id,
      action: "Audit démarré",
      cible: c.depot + " — " + c.angle,
    });
    const ouvertes = db
      .prepare(
        `SELECT * FROM securite_failles WHERE depot = ? AND statut IN ('nouvelle','confirmee','pr_ouverte') ORDER BY trouvee_le DESC LIMIT 50`,
      )
      .all(c.depot)
      .map(failleVue);
    const angles = db
      .prepare(
        "SELECT DISTINCT angle FROM securite_creneaux WHERE depot = ? AND etat = 'termine' ORDER BY fin_le DESC LIMIT 20",
      )
      .all(c.depot)
      .map((r) => r.angle);
    return {
      ok: true,
      creneau: vueCreneau(
        db.prepare("SELECT * FROM securite_creneaux WHERE id = ?").get(c.id),
      ),
      failles_deja_ouvertes: ouvertes,
      angles_deja_couverts: angles,
      regles:
        "Un seul dépôt : " +
        c.depot +
        ". Ne redéclarez pas une faille déjà ouverte. Analyse statique : aucun code du dépôt n’est exécuté par ce serveur. Une faille devient au mieux une PR en brouillon.",
    };
  }

  function journaliserAudit(moi, args) {
    const c = creneauDe(
      args,
      ["creneau_id", "heure", "message", "etape", "fichiers_lus", "job_ref"],
      "securite_journaliser_audit",
    );
    if (c.etat !== "en_cours")
      refuser(
        "FAILED_PRECONDITION",
        "Ce créneau n’est pas en cours (« " + c.etat + " »).",
        409,
      );
    const message = texteBorne(args.message, "message", { max: 300 });
    const etape =
      args.etape == null ? c.etape : parmi(args.etape, ETAPES, "etape");
    const fichiers =
      args.fichiers_lus == null
        ? c.fichiers_lus
        : entier(args.fichiers_lus, "fichiers_lus", 0, 100000);
    const job =
      args.job_ref == null
        ? c.job_ref
        : texteBorne(args.job_ref, "job_ref", { max: 80 });
    const journal = lireJournal(c);
    const t = iso();
    journal.push({ le: t, message });
    db.prepare(
      "UPDATE securite_creneaux SET journal = ?, etape = ?, fichiers_lus = ?, job_ref = ?, derniere_activite = ? WHERE id = ?",
    ).run(JSON.stringify(journal.slice(-200)), etape, fichiers, job, t, c.id);
    return {
      ok: true,
      creneau_id: c.id,
      lignes: Math.min(journal.length, 200),
    };
  }

  function empreinteDe(depot, titre, emplacement) {
    const base =
      depot.toLowerCase() +
      "|" +
      titre.toLowerCase().replace(/\s+/g, " ").trim() +
      "|" +
      String(emplacement || "")
        .split(":")[0]
        .toLowerCase();
    return crypto.createHash("sha256").update(base).digest("hex").slice(0, 24);
  }

  function enregistrerFaille(depot, f, creneauId, auteur, i = null) {
    const ou = i == null ? "faille" : "failles[" + i + "]";
    cles(
      f,
      [
        "titre",
        "gravite",
        "cwe",
        "emplacement",
        "description",
        "empreinte",
        "pr_url",
        "preuves",
      ],
      ou,
    );
    const titre = texteBorne(f.titre, ou + ".titre", { min: 6, max: 160 });
    const gravite = parmi(f.gravite, GRAVITES, ou + ".gravite");
    const cwe = texteBorne(f.cwe, ou + ".cwe", { max: 20, facultatif: true });
    if (cwe && !/^CWE-\d{1,5}$/.test(cwe))
      refuser("INVALID_ARGUMENT", ou + ".cwe : forme CWE-<numéro>.");
    const emplacement = texteBorne(f.emplacement, ou + ".emplacement", {
      max: 240,
      facultatif: true,
    });
    const description =
      texteBorne(f.description, ou + ".description", {
        max: 4000,
        facultatif: true,
      }) || "";
    const pr = urlPr(f.pr_url);
    const empreinte =
      f.empreinte == null
        ? empreinteDe(depot, titre, emplacement)
        : texteBorne(f.empreinte, ou + ".empreinte", { min: 6, max: 64 });
    const preuves = lirePreuves(f.preuves, ou + ".preuves", auteur);
    const existante = db
      .prepare(
        `SELECT * FROM securite_failles WHERE depot = ? AND empreinte = ? AND statut IN ('nouvelle','confirmee','pr_ouverte')`,
      )
      .get(depot, empreinte);
    const t = iso();
    if (existante) {
      const h = json(existante.historique, []);
      h.push({
        le: t,
        par: auteur,
        quoi:
          "revue lors d’un nouvel audit" +
          (creneauId ? " (créneau " + creneauId + ")" : ""),
      });
      const p = json(existante.preuves, []).concat(preuves).slice(-30);
      db.prepare(
        "UPDATE securite_failles SET historique = ?, preuves = ?, maj_le = ? WHERE id = ?",
      ).run(JSON.stringify(h.slice(-100)), JSON.stringify(p), t, existante.id);
      return { id: existante.id, doublon: true };
    }
    // Une faille déjà corrigée qui réapparaît est une RÉCIDIVE : nouvelle fiche, liée à l'ancienne.
    const ancienne = db
      .prepare(
        `SELECT id FROM securite_failles WHERE depot = ? AND empreinte = ? AND statut IN ('corrigee','revalidee') ORDER BY trouvee_le DESC LIMIT 1`,
      )
      .get(depot, empreinte);
    const id = "F-" + crypto.randomBytes(3).toString("hex").toUpperCase();
    db.prepare(
      `INSERT INTO securite_failles (id, depot, titre, gravite, cwe, emplacement, description, statut, pr_url, empreinte, creneau_id, trouvee_le, maj_le, pr_le, recidive_de, preuves, auteur, historique)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      id,
      depot,
      titre,
      gravite,
      cwe,
      emplacement,
      description,
      pr ? "pr_ouverte" : "nouvelle",
      pr,
      empreinte,
      creneauId,
      t,
      t,
      pr ? t : null,
      ancienne ? ancienne.id : null,
      JSON.stringify(preuves),
      auteur,
      JSON.stringify([
        {
          le: t,
          par: auteur,
          quoi:
            "déclarée (" +
            gravite +
            ")" +
            (ancienne ? " — récidive de " + ancienne.id : ""),
        },
      ]),
    );
    if (ancienne) {
      const a = db
        .prepare("SELECT historique FROM securite_failles WHERE id = ?")
        .get(ancienne.id);
      const h = json(a.historique, []);
      h.push({ le: t, par: auteur, quoi: "réapparue : récidive " + id });
      db.prepare("UPDATE securite_failles SET historique = ? WHERE id = ?").run(
        JSON.stringify(h.slice(-100)),
        ancienne.id,
      );
    }
    return { id, doublon: false, recidive_de: ancienne ? ancienne.id : null };
  }

  function terminerAudit(moi, args, auteur = "assistant") {
    const c = creneauDe(
      args,
      ["creneau_id", "heure", "resultat", "resume", "failles", "fichiers_lus"],
      "securite_terminer_audit",
    );
    if (c.etat !== "en_cours")
      refuser(
        "FAILED_PRECONDITION",
        "Ce créneau n’est pas en cours (« " +
          c.etat +
          " ») : securite_demarrer_audit d’abord.",
        409,
      );
    const resultat = parmi(args.resultat, RESULTATS, "resultat");
    const resume = texteBorne(args.resume, "resume", { min: 10, max: 2000 });
    const failles = args.failles == null ? [] : args.failles;
    if (!Array.isArray(failles) || failles.length > 20)
      refuser("INVALID_ARGUMENT", "failles : liste de 0 à 20 failles.");
    if (resultat === "failles" && !failles.length)
      refuser(
        "INVALID_ARGUMENT",
        "resultat « failles » : déclarez au moins une faille.",
      );
    if (resultat !== "failles" && failles.length)
      refuser(
        "INVALID_ARGUMENT",
        "Des failles sont déclarées : resultat doit valoir « failles ».",
      );
    const fichiers =
      args.fichiers_lus == null
        ? c.fichiers_lus
        : entier(args.fichiers_lus, "fichiers_lus", 0, 100000);
    const t = iso();
    db.exec("BEGIN IMMEDIATE");
    let rendues;
    try {
      rendues = failles.map((f, i) =>
        enregistrerFaille(c.depot, f, c.id, auteur, i),
      );
      const journal = lireJournal(c);
      journal.push({
        le: t,
        message:
          "Audit terminé : " +
          (resultat === "rien"
            ? "rien de déclaré"
            : resultat === "echec"
              ? "échec"
              : failles.length + " faille(s) déclarée(s)"),
      });
      db.prepare(
        "UPDATE securite_creneaux SET etat = ?, resultat = ?, resume = ?, fin_le = ?, derniere_activite = ?, etape = 'rapport', fichiers_lus = ?, journal = ? WHERE id = ?",
      ).run(
        resultat === "echec" ? "echec" : "termine",
        resultat,
        resume,
        t,
        t,
        fichiers,
        JSON.stringify(journal.slice(-200)),
        c.id,
      );
      db.exec("COMMIT");
    } catch (e) {
      db.exec("ROLLBACK");
      throw e;
    }
    const nouvelles = rendues.filter((r) => !r.doublon).length;
    consigner({
      agent: "auditeur",
      creneau_id: c.id,
      action: resultat === "echec" ? "Audit en échec" : "Audit terminé",
      cible: c.depot + " — " + c.angle,
      resultat:
        resultat === "rien"
          ? "rien de déclaré"
          : resultat === "echec"
            ? "échec"
            : rendues.length + " faille(s), " + nouvelles + " nouvelle(s)",
      erreur: resultat === "echec" ? resume : null,
    });
    return { ok: true, creneau_id: c.id, failles: rendues, nouvelles };
  }

  function declarerFaille(moi, args, auteur = "assistant") {
    init();
    cles(args, ["depot", "faille"], "securite_declarer_faille");
    const d = resoudreDepot(args.depot);
    const r = enregistrerFaille(d.nom_complet, args.faille, null, auteur);
    consigner({
      ...agentCourant(),
      action: "Faille déclarée",
      cible: r.id + " · " + d.nom_complet,
      resultat: r.doublon
        ? "déjà ouverte : revue ajoutée"
        : r.recidive_de
          ? "récidive de " + r.recidive_de
          : "nouvelle",
    });
    return { ok: true, ...r };
  }

  function mettreAJourFaille(moi, args, auteur = "assistant") {
    init();
    cles(
      args,
      ["id", "statut", "pr_url", "gravite", "note", "preuves"],
      "securite_maj_faille",
    );
    const id = texteBorne(args.id, "id", { max: 12 });
    const f = db.prepare("SELECT * FROM securite_failles WHERE id = ?").get(id);
    if (!f) refuser("NOT_FOUND", "Faille inconnue : " + id + ".", 404);
    const statut =
      args.statut == null ? f.statut : parmi(args.statut, STATUTS, "statut");
    if (statut === "revalidee" && f.statut !== "revalidee")
      refuser(
        "INVALID_ARGUMENT",
        "La revalidation passe par securite_revalider_faille, avec ses preuves.",
      );
    const nouvellesPreuves = lirePreuves(args.preuves, "preuves", auteur);
    const gravite =
      args.gravite == null
        ? f.gravite
        : parmi(args.gravite, GRAVITES, "gravite");
    const pr = args.pr_url == null ? f.pr_url : urlPr(args.pr_url);
    const note = texteBorne(args.note, "note", { max: 500, facultatif: true });
    if (statut === "pr_ouverte" && !pr)
      refuser("INVALID_ARGUMENT", "statut « pr_ouverte » : pr_url est requis.");
    if (["faux_positif", "acceptee"].includes(statut) && !note)
      refuser(
        "INVALID_ARGUMENT",
        "statut « " + statut + " » : une note doit dire pourquoi.",
      );
    const t = iso();
    const h = JSON.parse(f.historique || "[]");
    const changes = [];
    if (statut !== f.statut)
      changes.push("statut " + f.statut + " → " + statut);
    if (gravite !== f.gravite)
      changes.push("gravité " + f.gravite + " → " + gravite);
    if (pr !== f.pr_url) changes.push("PR " + pr);
    if (nouvellesPreuves.length)
      changes.push(nouvellesPreuves.length + " preuve(s) ajoutée(s)");
    if (!changes.length && !note)
      refuser("INVALID_ARGUMENT", "Rien à changer.");
    h.push({
      le: t,
      par: auteur,
      quoi: changes.join(", ") || "note",
      note: note || undefined,
    });
    const prLe =
      f.pr_le ||
      ((statut === "pr_ouverte" || statut === "corrigee") && pr ? t : null);
    const corrigeeLe =
      statut === "corrigee" ? f.corrigee_le || t : f.corrigee_le;
    const preuves = json(f.preuves, []).concat(nouvellesPreuves).slice(-30);
    db.prepare(
      "UPDATE securite_failles SET statut = ?, gravite = ?, pr_url = ?, pr_le = ?, corrigee_le = ?, preuves = ?, maj_le = ?, historique = ? WHERE id = ?",
    ).run(
      statut,
      gravite,
      pr,
      prLe,
      corrigeeLe,
      JSON.stringify(preuves),
      t,
      JSON.stringify(h.slice(-100)),
      id,
    );
    consigner({
      ...agentCourant(),
      action: "Faille mise à jour",
      cible: id + " · " + f.depot,
      resultat: changes.join(", ") || "note ajoutée",
    });
    return {
      ok: true,
      faille: failleVue(
        db.prepare("SELECT * FROM securite_failles WHERE id = ?").get(id),
      ),
    };
  }

  /**
   * Revalidation : un audit ULTÉRIEUR vérifie qu'une faille corrigée a bien disparu.
   * « corrigee » → revalidee (preuves exigées) ; « presente » → la faille est ROUVERTE.
   */
  function revaliderFaille(moi, args, auteur = "assistant") {
    init();
    cles(
      args,
      ["id", "resultat", "preuves", "creneau_id", "note"],
      "securite_revalider_faille",
    );
    const id = texteBorne(args.id, "id", { max: 12 });
    const f = db.prepare("SELECT * FROM securite_failles WHERE id = ?").get(id);
    if (!f) refuser("NOT_FOUND", "Faille inconnue : " + id + ".", 404);
    if (f.statut !== "corrigee")
      refuser(
        "FAILED_PRECONDITION",
        "Seule une faille « corrigee » (PR fusionnée) se revalide ; celle-ci est « " +
          f.statut +
          " ».",
        409,
      );
    const resultat = parmi(args.resultat, ["corrigee", "presente"], "resultat");
    const preuves = lirePreuves(args.preuves, "preuves", auteur);
    if (!preuves.length)
      refuser(
        "INVALID_ARGUMENT",
        "preuves : au moins une preuve (test rejoué, extrait du code corrigé, job…).",
      );
    const creneau =
      args.creneau_id == null
        ? null
        : entier(args.creneau_id, "creneau_id", 1, 1e9);
    if (
      creneau &&
      !db.prepare("SELECT 1 FROM securite_creneaux WHERE id = ?").get(creneau)
    )
      refuser("NOT_FOUND", "Créneau inconnu : " + creneau + ".", 404);
    const note = texteBorne(args.note, "note", { max: 500, facultatif: true });
    const t = iso();
    const h = json(f.historique, []);
    h.push({
      le: t,
      par: auteur,
      quoi:
        resultat === "corrigee"
          ? "revalidée : la faille a disparu"
          : "revalidation ÉCHOUÉE : toujours présente, faille rouverte",
      note: note || undefined,
      creneau: creneau || undefined,
    });
    db.prepare(
      "UPDATE securite_failles SET statut = ?, revalidee_le = ?, preuves = ?, historique = ?, maj_le = ? WHERE id = ?",
    ).run(
      resultat === "corrigee" ? "revalidee" : "confirmee",
      resultat === "corrigee" ? t : null,
      JSON.stringify(json(f.preuves, []).concat(preuves).slice(-30)),
      JSON.stringify(h.slice(-100)),
      t,
      id,
    );
    consigner({
      ...agentCourant(),
      action: "Revalidation",
      cible: id + " · " + f.depot,
      resultat:
        resultat === "corrigee"
          ? "revalidée : la faille a disparu"
          : "toujours présente : faille rouverte",
    });
    return {
      ok: true,
      faille: failleVue(
        db.prepare("SELECT * FROM securite_failles WHERE id = ?").get(id),
      ),
    };
  }

  // ── Consultation détaillée (demande de Silly, 01/11/2026) ─────────────────────
  function lireFaille(moi, args) {
    init();
    cles(args, ["id"], "securite_lire_faille");
    const f = db
      .prepare("SELECT * FROM securite_failles WHERE id = ?")
      .get(texteBorne(args.id, "id", { max: 12 }));
    if (!f) refuser("NOT_FOUND", "Faille inconnue : " + args.id + ".", 404);
    const recidives = db
      .prepare(
        "SELECT id, statut, trouvee_le FROM securite_failles WHERE recidive_de = ?",
      )
      .all(f.id);
    const audit = f.creneau_id
      ? db
          .prepare(
            "SELECT id, jour, heure, angle, etat FROM securite_creneaux WHERE id = ?",
          )
          .get(f.creneau_id)
      : null;
    return {
      ok: true,
      faille: failleComplete(f),
      audit_d_origine: audit || null,
      recidives,
    };
  }

  function listerFailles(moi, args = {}) {
    init();
    cles(
      args,
      ["depot", "gravite", "statut", "ouvertes", "cwe", "limit", "offset"],
      "securite_lister_failles",
    );
    const ou = [],
      p = [];
    if (args.depot != null) {
      ou.push("depot = ?");
      p.push(resoudreDepot(args.depot).nom_complet);
    }
    if (args.gravite != null) {
      ou.push("gravite = ?");
      p.push(parmi(args.gravite, GRAVITES, "gravite"));
    }
    if (args.statut != null) {
      ou.push("statut = ?");
      p.push(parmi(args.statut, STATUTS, "statut"));
    }
    if (args.cwe != null) {
      ou.push("cwe = ?");
      p.push(texteBorne(args.cwe, "cwe", { max: 20 }));
    }
    if (args.ouvertes === true)
      ou.push("statut IN ('nouvelle','confirmee','pr_ouverte')");
    const limit = args.limit == null ? 50 : entier(args.limit, "limit", 1, 100);
    const offset =
      args.offset == null ? 0 : entier(args.offset, "offset", 0, 100000);
    const where = ou.length ? " WHERE " + ou.join(" AND ") : "";
    const total = db
      .prepare("SELECT COUNT(*) AS n FROM securite_failles" + where)
      .get(...p).n;
    const l = db
      .prepare(
        "SELECT * FROM securite_failles" +
          where +
          " ORDER BY trouvee_le DESC LIMIT ? OFFSET ?",
      )
      .all(...p, limit, offset)
      .map(failleVue);
    return {
      ok: true,
      total,
      failles: l,
      next_offset: offset + limit < total ? offset + limit : null,
    };
  }

  function listerAudits(moi, args = {}) {
    init();
    marquerSilences();
    cles(
      args,
      ["jour", "depot", "etat", "limit", "offset"],
      "securite_lister_audits",
    );
    const ou = [],
      p = [];
    if (args.jour != null) {
      if (!jourValide(args.jour))
        refuser("INVALID_ARGUMENT", "jour : date AAAA-MM-JJ.");
      ou.push("jour = ?");
      p.push(args.jour);
    }
    if (args.depot != null) {
      ou.push("depot = ?");
      p.push(resoudreDepot(args.depot).nom_complet);
    }
    if (args.etat != null) {
      ou.push("etat = ?");
      p.push(parmi(args.etat, ETATS, "etat"));
    }
    const limit = args.limit == null ? 50 : entier(args.limit, "limit", 1, 100);
    const offset =
      args.offset == null ? 0 : entier(args.offset, "offset", 0, 100000);
    const where = ou.length ? " WHERE " + ou.join(" AND ") : "";
    const total = db
      .prepare("SELECT COUNT(*) AS n FROM securite_creneaux" + where)
      .get(...p).n;
    const l = db
      .prepare(
        "SELECT * FROM securite_creneaux" +
          where +
          " ORDER BY jour DESC, heure DESC LIMIT ? OFFSET ?",
      )
      .all(...p, limit, offset)
      .map((c) => {
        const { journal, ...v } = vueCreneau(c);
        return { ...v, lignes_de_journal: journal.length };
      });
    return {
      ok: true,
      total,
      audits: l,
      next_offset: offset + limit < total ? offset + limit : null,
    };
  }

  function lireAudit(moi, args) {
    init();
    marquerSilences();
    cles(args, ["creneau_id"], "securite_lire_audit");
    const c = db
      .prepare("SELECT * FROM securite_creneaux WHERE id = ?")
      .get(entier(args.creneau_id, "creneau_id", 1, 1e9));
    if (!c)
      refuser("NOT_FOUND", "Audit inconnu : " + args.creneau_id + ".", 404);
    const failles = db
      .prepare("SELECT * FROM securite_failles WHERE creneau_id = ?")
      .all(c.id)
      .map(failleVue);
    const duree = c.debut_le
      ? Math.round(
          ((c.fin_le ? Date.parse(c.fin_le) : maintenant().getTime()) -
            Date.parse(c.debut_le)) /
            60000,
        )
      : null;
    return {
      ok: true,
      audit: { ...vueCreneau(c), duree_minutes: duree },
      failles,
    };
  }

  /**
   * Suivi des corrections : chaque faille engagée sur le chemin PR → fusion → revalidation.
   * Avec `actualiser: true`, l'état des PR est lu sur GitHub ; une PR FUSIONNÉE fait passer
   * la faille en « corrigee » (constat GitHub, consigné dans l'historique).
   */
  async function suiviCorrections(
    moi,
    args = {},
    { fetchImpl = githubFetch } = {},
  ) {
    init();
    cles(args, ["actualiser", "depot"], "securite_suivi_corrections");
    const depot =
      args.depot == null ? null : resoudreDepot(args.depot).nom_complet;
    const l = db
      .prepare(
        `SELECT * FROM securite_failles WHERE statut IN ('nouvelle','confirmee','pr_ouverte','corrigee','revalidee')` +
          (depot ? " AND depot = ?" : "") +
          " ORDER BY trouvee_le DESC LIMIT 200",
      )
      .all(...(depot ? [depot] : []));
    const constats = [];
    if (args.actualiser === true) {
      const jeton = jetonGithub();
      const entetes = {
        Accept: "application/vnd.github+json",
        "User-Agent": "metis-server",
      };
      if (jeton) entetes.Authorization = "Bearer " + jeton;
      for (const f of l
        .filter((x) => x.statut === "pr_ouverte" && x.pr_url)
        .slice(0, 30)) {
        const m = /^https:\/\/github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)$/.exec(
          f.pr_url,
        );
        if (!m) continue;
        try {
          const r = await fetchImpl(
            "https://api.github.com/repos/" +
              m[1] +
              "/" +
              m[2] +
              "/pulls/" +
              m[3],
            { headers: entetes, signal: AbortSignal.timeout(15000) },
          );
          if (!r.ok) {
            constats.push({
              id: f.id,
              pr: f.pr_url,
              erreur: "HTTP " + r.status,
            });
            continue;
          }
          const pr = await r.json();
          const etatPr = pr.merged_at
            ? "fusionnee"
            : pr.state === "closed"
              ? "fermee_sans_fusion"
              : pr.draft
                ? "brouillon"
                : "ouverte";
          constats.push({ id: f.id, pr: f.pr_url, etat: etatPr });
          if (pr.merged_at) {
            const t = iso();
            const h = json(f.historique, []);
            h.push({
              le: t,
              par: "GitHub",
              quoi:
                "PR fusionnée le " + pr.merged_at + " : corrigée, à revalider",
            });
            db.prepare(
              "UPDATE securite_failles SET statut = 'corrigee', corrigee_le = ?, historique = ?, maj_le = ? WHERE id = ? AND statut = 'pr_ouverte'",
            ).run(pr.merged_at, JSON.stringify(h.slice(-100)), t, f.id);
            f.statut = "corrigee";
            f.corrigee_le = pr.merged_at;
          }
        } catch (e) {
          constats.push({ id: f.id, pr: f.pr_url, erreur: e.message });
        }
      }
      const erreurs = constats.filter((c) => c.erreur);
      consigner({
        ...agentCourant(),
        action: "PR vérifiées sur GitHub",
        cible: depot || "tout le parc",
        resultat:
          constats.length +
          " PR lue(s), " +
          constats.filter((c) => c.etat === "fusionnee").length +
          " fusionnée(s)",
        erreur: erreurs.length
          ? erreurs.map((c) => c.id + " : " + c.erreur).join(" ; ")
          : null,
      });
    }
    const age = (d) =>
      d ? Math.round((maintenant().getTime() - Date.parse(d)) / 86400e3) : null;
    const etapes = {
      sans_pr: [],
      pr_ouverte: [],
      a_revalider: [],
      revalidee: [],
    };
    for (const f of l) {
      const v = {
        id: f.id,
        depot: f.depot,
        titre: f.titre,
        gravite: f.gravite,
        pr_url: f.pr_url,
        trouvee_le: f.trouvee_le,
        age_jours: age(f.trouvee_le),
      };
      if (f.statut === "nouvelle" || f.statut === "confirmee")
        etapes.sans_pr.push(v);
      else if (f.statut === "pr_ouverte")
        etapes.pr_ouverte.push({ ...v, pr_depuis_jours: age(f.pr_le) });
      else if (f.statut === "corrigee")
        etapes.a_revalider.push({
          ...v,
          corrigee_depuis_jours: age(f.corrigee_le),
        });
      else etapes.revalidee.push({ ...v, revalidee_le: f.revalidee_le });
    }
    return {
      ok: true,
      etapes: Object.fromEntries(
        Object.entries(etapes).map(([k, v]) => [
          k,
          { nombre: v.length, failles: v.slice(0, 40) },
        ]),
      ),
      constats_github: constats,
    };
  }

  /** Tendances : faiblesses récurrentes, récidives, dépôts négligés, rythme. */
  function tendances(moi, args = {}) {
    init();
    cles(args, ["jours"], "securite_tendances");
    const jours = args.jours == null ? 90 : entier(args.jours, "jours", 7, 365);
    const depuis = iso(new Date(maintenant().getTime() - jours * 86400e3));
    const failles = db
      .prepare("SELECT * FROM securite_failles WHERE trouvee_le >= ?")
      .all(depuis);
    const parCwe = {};
    for (const f of failles) {
      if (!f.cwe) continue;
      const c =
        parCwe[f.cwe] ||
        (parCwe[f.cwe] = { cwe: f.cwe, failles: 0, depots: new Set() });
      c.failles++;
      c.depots.add(f.depot);
    }
    const recurrentes = Object.values(parCwe)
      .filter((c) => c.failles > 1)
      .sort((a, b) => b.failles - a.failles)
      .slice(0, 15)
      .map((c) => ({ cwe: c.cwe, failles: c.failles, depots: [...c.depots] }));
    const recidives = failles
      .filter((f) => f.recidive_de)
      .map((f) => ({
        id: f.id,
        depot: f.depot,
        titre: f.titre,
        recidive_de: f.recidive_de,
        trouvee_le: f.trouvee_le,
      }));
    const rouvertes = failles
      .filter((f) =>
        json(f.historique, []).some((h) =>
          /revalidation ÉCHOUÉE/.test(h.quoi || ""),
        ),
      )
      .map((f) => ({ id: f.id, depot: f.depot, titre: f.titre }));
    const parDepot = {};
    for (const f of failles) parDepot[f.depot] = (parDepot[f.depot] || 0) + 1;
    const depots = etatDepots();
    const negliges = depots
      .filter(
        (d) =>
          d.importance.niveau !== "mort" &&
          (!d.dernier_audit || (d.pousse_le && d.pousse_le > d.dernier_audit)),
      )
      .map((d) => ({
        depot: d.nom_complet,
        public: d.public,
        famille: d.famille,
        importance: d.importance.niveau,
        dernier_audit: d.dernier_audit,
        pousse_le: d.pousse_le,
        raison: !d.dernier_audit
          ? "jamais audité"
          : "modifié depuis son dernier audit",
      }))
      .sort(
        (a, b) =>
          b.public - a.public ||
          (a.dernier_audit ? 1 : 0) - (b.dernier_audit ? 1 : 0) ||
          String(b.pousse_le || "").localeCompare(String(a.pousse_le || "")),
      )
      .slice(0, 30);
    const semaines = {};
    for (const f of failles) {
      const d = new Date(f.trouvee_le);
      const lundi = new Date(
        Date.UTC(
          d.getUTCFullYear(),
          d.getUTCMonth(),
          d.getUTCDate() - ((d.getUTCDay() + 6) % 7),
        ),
      );
      const k = lundi.toISOString().slice(0, 10);
      semaines[k] = (semaines[k] || 0) + 1;
    }
    const audits = db
      .prepare(
        "SELECT etat, COUNT(*) AS n FROM securite_creneaux WHERE jour >= ? GROUP BY etat",
      )
      .all(paris(new Date(Date.parse(depuis))).jour);
    return {
      ok: true,
      periode_jours: jours,
      failles_declarees: failles.length,
      faiblesses_recurrentes: recurrentes,
      recidives,
      rouvertes_apres_revalidation: rouvertes,
      depots_les_plus_touches: Object.entries(parDepot)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 10)
        .map(([depot, n]) => ({ depot, failles: n })),
      depots_negliges: negliges,
      failles_par_semaine: Object.entries(semaines)
        .sort()
        .map(([semaine, n]) => ({ semaine, failles: n })),
      audits_par_etat: Object.fromEntries(audits.map((a) => [a.etat, a.n])),
      avertissement:
        "Tendances calculées sur des failles DÉCLARÉES par les audits : une absence ne prouve pas l’absence de faille.",
    };
  }

  // ── Lecture ──────────────────────────────────────────────────────────────────
  function inventaire(moi, args = {}) {
    init();
    cles(
      args,
      [
        "famille",
        "importance",
        "jamais_audite",
        "recherche",
        "limit",
        "offset",
      ],
      "securite_inventaire",
    );
    const limit = args.limit == null ? 50 : entier(args.limit, "limit", 1, 100);
    const offset =
      args.offset == null ? 0 : entier(args.offset, "offset", 0, 100000);
    if (args.famille != null)
      parmi(args.famille, Object.keys(LIBELLE_FAMILLE), "famille");
    if (args.importance != null)
      parmi(args.importance, IMPORTANCES, "importance");
    const rech = texteBorne(args.recherche, "recherche", {
      max: 80,
      facultatif: true,
    });
    const tous = etatDepots().filter(
      (d) =>
        (args.famille == null || d.famille === args.famille) &&
        (args.importance == null || d.importance.niveau === args.importance) &&
        (args.jamais_audite !== true || !d.dernier_audit) &&
        (!rech || d.nom_complet.toLowerCase().includes(rech.toLowerCase())),
    );
    const page = tous.slice(offset, offset + limit);
    return {
      ok: true,
      total: tous.length,
      depots: page,
      next_offset: offset + limit < tous.length ? offset + limit : null,
      synchro: derniereSynchro,
    };
  }

  /** Chaque dépôt avec son dernier audit, ses failles ouvertes et son statut. */
  function etatDepots() {
    init();
    const derniers = {};
    for (const r of db
      .prepare(
        "SELECT depot, MAX(fin_le) AS fin, COUNT(*) AS n FROM securite_creneaux WHERE etat = 'termine' GROUP BY depot",
      )
      .all())
      derniers[r.depot] = r;
    const trente = iso(new Date(maintenant().getTime() - 30 * 86400e3));
    const n30 = {};
    for (const r of db
      .prepare(
        "SELECT depot, COUNT(*) AS n FROM securite_creneaux WHERE etat = 'termine' AND fin_le >= ? GROUP BY depot",
      )
      .all(trente))
      n30[r.depot] = r.n;
    const comptes = {};
    for (const r of db
      .prepare(
        "SELECT depot, gravite, COUNT(*) AS n, SUM(pr_url IS NOT NULL) AS pr FROM securite_failles WHERE statut IN ('nouvelle','confirmee','pr_ouverte') GROUP BY depot, gravite",
      )
      .all()) {
      const c =
        comptes[r.depot] ||
        (comptes[r.depot] = {
          critique: 0,
          haute: 0,
          moyenne: 0,
          basse: 0,
          pr: 0,
        });
      c[r.gravite] = r.n;
      c.pr += r.pr || 0;
    }
    const angles = {};
    for (const r of db
      .prepare(
        "SELECT depot, angle FROM securite_creneaux WHERE etat = 'termine' ORDER BY fin_le DESC",
      )
      .all()) {
      const a = angles[r.depot] || (angles[r.depot] = []);
      if (a.length < 8 && !a.includes(r.angle)) a.push(r.angle);
    }
    return db
      .prepare(
        "SELECT * FROM securite_depots WHERE archive = 0 ORDER BY famille, lower(nom)",
      )
      .all()
      .map((d) => {
        const c = comptes[d.nom_complet] || {
          critique: 0,
          haute: 0,
          moyenne: 0,
          basse: 0,
          pr: 0,
        };
        const pire = GRAVITES.find((g) => c[g] > 0) || null;
        const dernier = derniers[d.nom_complet];
        return {
          nom_complet: d.nom_complet,
          nom: d.nom,
          proprietaire: d.proprietaire,
          famille: d.famille,
          public: !!d.public,
          langage: d.langage,
          pousse_le: d.pousse_le,
          source: d.source,
          dernier_audit: dernier ? dernier.fin : null,
          audits_30j: n30[d.nom_complet] || 0,
          failles: {
            critique: c.critique,
            haute: c.haute,
            moyenne: c.moyenne,
            basse: c.basse,
          },
          pr_ouvertes: c.pr,
          statut: pire || (dernier ? "saine" : "jamais"),
          angles: angles[d.nom_complet] || [],
          importance: importanceDe(d),
        };
      });
  }

  /** L'état complet, pour la page et pour la routine (securite_etat). */
  function etat(moi, { jour = null } = {}) {
    init();
    marquerSilences();
    const ici = paris();
    const j = jour && jourValide(jour) ? jour : ici.jour;
    const plan =
      db.prepare("SELECT * FROM securite_plans WHERE jour = ?").get(j) || null;
    const creneaux = db
      .prepare("SELECT * FROM securite_creneaux WHERE jour = ? ORDER BY heure")
      .all(j)
      .map(vueCreneau);
    const enCours = db
      .prepare(
        "SELECT * FROM securite_creneaux WHERE etat = 'en_cours' ORDER BY debut_le DESC LIMIT 1",
      )
      .get();
    const depots = etatDepots();
    const failles = db
      .prepare(
        `SELECT * FROM securite_failles WHERE statut IN ('nouvelle','confirmee','pr_ouverte')`,
      )
      .all()
      .map(failleVue)
      .sort(
        (a, b) =>
          POIDS[b.gravite] - POIDS[a.gravite] ||
          b.trouvee_le.localeCompare(a.trouvee_le),
      );
    // Failles déclarées par jour, sur 14 jours (heure locale de l’instance).
    const debut = decalerJour(j, -13);
    const parJour = {};
    for (const r of db
      .prepare("SELECT trouvee_le FROM securite_failles WHERE trouvee_le >= ?")
      .all(debut + "T00:00:00Z")) {
      const k = paris(new Date(r.trouvee_le)).jour;
      parJour[k] = (parJour[k] || 0) + 1;
    }
    const histogramme = [];
    for (let i = 13; i >= 0; i--) {
      const k = decalerJour(j, -i);
      histogramme.push({ jour: k, failles: parJour[k] || 0 });
    }
    // Délai médian entre la découverte et la PR.
    const delais = db
      .prepare(
        "SELECT trouvee_le, pr_le FROM securite_failles WHERE pr_le IS NOT NULL",
      )
      .all()
      .map((r) => (Date.parse(r.pr_le) - Date.parse(r.trouvee_le)) / 86400e3)
      .filter((x) => x >= 0)
      .sort((a, b) => a - b);
    const mediane = delais.length
      ? delais.length % 2
        ? delais[(delais.length - 1) / 2]
        : (delais[delais.length / 2 - 1] + delais[delais.length / 2]) / 2
      : null;
    // Les dépôts « morts » sortent des indicateurs : ils ne sont plus suivis.
    const suivis = depots.filter((d) => d.importance.niveau !== "mort");
    const total = suivis.length;
    const vus = suivis.filter((d) => d.audits_30j > 0).length;
    const niveaux = { actif: 0, faible: 0, mort: 0 };
    for (const d of depots) niveaux[d.importance.niveau]++;
    const dus = depots.filter(aAuditer);
    const utiles = Math.min(
      23,
      dus.filter((d) => d.importance.niveau === "actif").length +
        Math.min(
          FAIBLE_PAR_PLAN,
          dus.filter((d) => d.importance.niveau === "faible").length,
        ),
    );
    const sev = { critique: 0, haute: 0, moyenne: 0, basse: 0 };
    for (const f of failles) sev[f.gravite]++;
    const derniereActivite =
      db
        .prepare("SELECT MAX(derniere_activite) AS t FROM securite_creneaux")
        .get().t || null;
    const chemin = {
      nouvelle: 0,
      confirmee: 0,
      pr_ouverte: 0,
      corrigee: 0,
      revalidee: 0,
    };
    for (const r of db
      .prepare(
        "SELECT statut, COUNT(*) AS n FROM securite_failles WHERE statut IN ('nouvelle','confirmee','pr_ouverte','corrigee','revalidee') GROUP BY statut",
      )
      .all())
      chemin[r.statut] = r.n;
    const recidives = db
      .prepare(
        "SELECT COUNT(*) AS n FROM securite_failles WHERE recidive_de IS NOT NULL",
      )
      .get().n;
    const negliges = depots
      .filter(
        (d) =>
          d.importance.niveau === "actif" &&
          (!d.dernier_audit || (d.pousse_le && d.pousse_le > d.dernier_audit)),
      )
      .sort(
        (a, b) =>
          b.public - a.public ||
          (a.dernier_audit ? 1 : 0) - (b.dernier_audit ? 1 : 0) ||
          String(b.pousse_le || "").localeCompare(String(a.pousse_le || "")),
      )
      .slice(0, 6)
      .map((d) => ({
        depot: d.nom_complet,
        nom: d.nom,
        public: d.public,
        raison: d.dernier_audit
          ? "modifié depuis son dernier audit"
          : "jamais audité",
        pousse_le: d.pousse_le,
      }));
    const cwes = {};
    for (const f of db
      .prepare(
        "SELECT cwe FROM securite_failles WHERE cwe IS NOT NULL AND trouvee_le >= ?",
      )
      .all(iso(new Date(maintenant().getTime() - 90 * 86400e3))))
      cwes[f.cwe] = (cwes[f.cwe] || 0) + 1;
    const recurrentes = Object.entries(cwes)
      .filter(([, n]) => n > 1)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([cwe, n]) => ({ cwe, failles: n }));
    return {
      ok: true,
      maintenant: iso(),
      paris: ici,
      jour: j,
      plan,
      creneaux,
      en_cours: enCours ? vueCreneau(enCours) : null,
      resume: {
        depots: total,
        inventaire: depots.length,
        importance: niveaux,
        creneaux_utiles: utiles,
        publics: suivis.filter((d) => d.public).length,
        jamais_audites: suivis.filter((d) => !d.dernier_audit).length,
        couverture_30j: total ? Math.round((vus / total) * 100) : 0,
        depots_vus_30j: vus,
        cycle_jours: niveaux.actif ? Math.ceil(niveaux.actif / 23) : 0,
        failles_ouvertes: failles.length,
        par_gravite: sev,
        prs_a_relire: failles.filter((f) => f.statut === "pr_ouverte").length,
        delai_median_jours: mediane,
        derniere_activite: derniereActivite,
        creneaux: {
          termines: creneaux.filter((c) => c.etat === "termine").length,
          en_cours: creneaux.filter((c) => c.etat === "en_cours").length,
          prevus: creneaux.filter((c) => c.etat === "prevu").length,
          reportes: creneaux.filter((c) => c.etat === "reporte").length,
          echecs: creneaux.filter((c) => c.etat === "echec").length,
        },
      },
      depots,
      failles,
      histogramme,
      synchro: derniereSynchro,
      corrections: chemin,
      tendances: { recidives, negliges, recurrentes },
      agents: {
        auditeur: statutAuditeur(),
        gestionnaire: statutGestionnaire(),
      },
      journaux: {
        audits: lireOperations("auditeur", 15),
        gestion: lireOperations("gestionnaire", 15),
      },
      gestion: tableauGestion(),
    };
  }

  /** Résumé compact pour la routine (le planificateur de minuit lit ceci). */
  function etatPourRoutine(moi, args = {}) {
    cles(args, ["jour"], "securite_etat");
    if (args.jour != null && !jourValide(args.jour))
      refuser("INVALID_ARGUMENT", "jour : date AAAA-MM-JJ.");
    const e = etat(moi, { jour: args.jour || null });
    // Candidats : seulement les dépôts qui ont BESOIN d'un audit ; les actifs d'abord,
    // les peu importants ensuite ; les morts jamais.
    const rang = { actif: 0, faible: 1 };
    const prioritaires = e.depots
      .filter(aAuditer)
      .sort(
        (a, b) =>
          rang[a.importance.niveau] - rang[b.importance.niveau] ||
          (POIDS[b.statut] || 0) - (POIDS[a.statut] || 0) ||
          b.public - a.public ||
          (a.dernier_audit ? 1 : 0) - (b.dernier_audit ? 1 : 0) ||
          String(b.pousse_le || "").localeCompare(String(a.pousse_le || "")),
      )
      .slice(0, 40)
      .map((d) => ({
        depot: d.nom_complet,
        famille: d.famille,
        importance: d.importance.niveau,
        public: d.public,
        statut: d.statut,
        dernier_audit: d.dernier_audit,
        pousse_le: d.pousse_le,
        failles: d.failles,
        angles: d.angles,
      }));
    return {
      ok: true,
      jour: e.jour,
      heure_locale: e.paris.heure,
      plan: e.plan,
      creneaux: e.creneaux.map(({ journal, ...c }) => c),
      en_cours: e.en_cours && {
        id: e.en_cours.id,
        depot: e.en_cours.depot,
        angle: e.en_cours.angle,
      },
      resume: e.resume,
      failles_ouvertes: e.failles.slice(0, 40),
      candidats: prioritaires,
      synchro: e.synchro,
      agents: e.agents,
      regles:
        "Minuit : planifier AU PLUS resume.creneaux_utiles créneaux (heures 01–23), pas forcément 23 : chaque audit coûte. Un dépôt par créneau, un dépôt peut revenir. " +
        "Ne planifier que des « candidats » : un dépôt « mort » est refusé ; un dépôt « faible » (peu important) au plus " +
        FAIBLE_PAR_PLAN +
        " fois par jour et une fois par " +
        FAIBLE_JOURS +
        " jours, après les actifs. " +
        "Chaque heure : securite_demarrer_audit — s’il répond rien_a_faire, s’arrêter aussitôt — puis securite_journaliser_audit et securite_terminer_audit. Un créneau silencieux 70 min est marqué reporté. " +
        "securite_classer_depots classe un dépôt actif, faible ou mort quand son usage change. " +
        "Le GESTIONNAIRE est une autre tâche, chaque heure à :" +
        GESTION_MINUTE +
        " : securite_demarrer_gestion (rend ce qu’il y a à trier), les opérations de triage, puis securite_terminer_gestion.",
    };
  }

  /**
   * Un dépôt a-t-il BESOIN d'un audit ? Jamais s'il est mort. Actif : jamais audité,
   * modifié depuis, faille ouverte, ou dernier audit de plus de 30 jours. Faible : faille
   * ouverte, ou pas d'audit depuis 30 jours.
   */
  function aAuditer(d) {
    const n = d.importance.niveau;
    if (n === "mort") return false;
    const ouvertes =
      d.failles.critique +
        d.failles.haute +
        d.failles.moyenne +
        d.failles.basse >
      0;
    const vieux =
      !d.dernier_audit ||
      maintenant().getTime() - Date.parse(d.dernier_audit) >
        FAIBLE_JOURS * 86400e3;
    if (n === "faible") return ouvertes || vieux;
    return ouvertes || vieux || (d.pousse_le && d.pousse_le > d.dernier_audit);
  }

  /** Classe des dépôts : actif, faible (peu important), mort — ou « auto » pour revenir au classement de base. */
  function classerDepots(moi, args, auteur = "assistant") {
    init();
    cles(args, ["depots"], "securite_classer_depots");
    if (
      !Array.isArray(args.depots) ||
      !args.depots.length ||
      args.depots.length > 100
    )
      refuser("INVALID_ARGUMENT", "depots : liste de 1 à 100 classements.");
    const faits = [];
    const lignes = args.depots.map((x, i) => {
      cles(x, ["depot", "importance", "raison"], "depots[" + i + "]");
      const d = resoudreDepot(x.depot);
      const niveau = parmi(
        x.importance,
        IMPORTANCES.concat("auto"),
        "depots[" + i + "].importance",
      );
      const raison = texteBorne(x.raison, "depots[" + i + "].raison", {
        min: 3,
        max: 300,
        facultatif: niveau === "auto" || niveau === "actif",
      });
      if ((niveau === "mort" || niveau === "faible") && !raison)
        refuser(
          "INVALID_ARGUMENT",
          "depots[" +
            i +
            "].raison : dites pourquoi " +
            d.nom_complet +
            " devient « " +
            niveau +
            " ».",
        );
      return { d, niveau, raison };
    });
    const t = iso();
    for (const { d, niveau, raison } of lignes) {
      if (niveau === "auto")
        db.prepare(
          "UPDATE securite_depots SET importance = NULL, importance_raison = NULL, importance_le = ?, importance_par = ? WHERE nom_complet = ?",
        ).run(t, auteur, d.nom_complet);
      else
        db.prepare(
          "UPDATE securite_depots SET importance = ?, importance_raison = ?, importance_le = ?, importance_par = ? WHERE nom_complet = ?",
        ).run(niveau, raison || "", t, auteur, d.nom_complet);
      // Un dépôt mort n'a plus de créneau à venir : on retire ceux qui étaient prévus.
      const retires =
        niveau === "mort"
          ? db
              .prepare(
                "DELETE FROM securite_creneaux WHERE depot = ? AND etat = 'prevu'",
              )
              .run(d.nom_complet).changes
          : 0;
      const apres = importanceDe(
        db
          .prepare("SELECT * FROM securite_depots WHERE nom_complet = ?")
          .get(d.nom_complet),
      );
      faits.push({
        depot: d.nom_complet,
        importance: apres.niveau,
        source: apres.source,
        creneaux_retires: retires,
      });
    }
    return { ok: true, classes: faits };
  }

  // ── Le gestionnaire : triage et corrections, chaque heure à :35 ──────────────
  const ageJours = (d) =>
    d ? Math.floor((maintenant().getTime() - Date.parse(d)) / 86400e3) : null;
  function vueTri(f) {
    return {
      id: f.id,
      depot: f.depot,
      titre: f.titre,
      gravite: f.gravite,
      statut: f.statut,
      pr_url: f.pr_url,
      trouvee_le: f.trouvee_le,
      age_jours: ageJours(f.trouvee_le),
    };
  }
  /** Ce que le gestionnaire a à traiter, classé par nature. */
  function aTraiter() {
    const q = (sql, ...p) =>
      db
        .prepare(sql)
        .all(...p)
        .map(vueTri);
    return {
      a_trier: {
        consigne:
          "Confirmer (statut confirmee) ou écarter (faux_positif, avec une note) chaque faille nouvelle.",
        failles: q(
          "SELECT * FROM securite_failles WHERE statut = 'nouvelle' ORDER BY trouvee_le LIMIT 20",
        ),
      },
      prs_ouvertes: {
        consigne:
          "securite_suivi_corrections avec actualiser:true lit l’état des PR ; une PR fusionnée passe la faille en « corrigee ».",
        failles: q(
          "SELECT * FROM securite_failles WHERE statut = 'pr_ouverte' ORDER BY pr_le LIMIT 20",
        ),
      },
      a_revalider: {
        consigne:
          "Une faille « corrigee » attend une revalidation : securite_revalider_faille avec preuves, ou un créneau d’audit la nuit suivante.",
        failles: q(
          "SELECT * FROM securite_failles WHERE statut = 'corrigee' ORDER BY corrigee_le LIMIT 20",
        ),
      },
      sans_pr: {
        consigne:
          "Failles confirmées depuis plus de 7 jours sans PR : proposer un correctif en brouillon ou accepter le risque (note).",
        failles: q(
          "SELECT * FROM securite_failles WHERE statut = 'confirmee' AND trouvee_le < ? ORDER BY trouvee_le LIMIT 20",
          iso(new Date(maintenant().getTime() - 7 * 86400e3)),
        ),
      },
      recidives: {
        consigne:
          "Récidives encore ouvertes : vérifier pourquoi le correctif précédent n’a pas tenu.",
        failles: q(
          "SELECT * FROM securite_failles WHERE recidive_de IS NOT NULL AND statut IN ('nouvelle','confirmee','pr_ouverte') ORDER BY trouvee_le DESC LIMIT 20",
        ),
      },
    };
  }
  function passageOuvert(id) {
    const p =
      id == null
        ? db
            .prepare(
              "SELECT * FROM securite_passages WHERE etat = 'en_cours' ORDER BY id DESC LIMIT 1",
            )
            .get()
        : db
            .prepare("SELECT * FROM securite_passages WHERE id = ?")
            .get(entier(id, "passage_id", 1, 1e9));
    if (!p)
      refuser(
        "FAILED_PRECONDITION",
        id == null
          ? "Aucun passage du gestionnaire en cours : securite_demarrer_gestion d’abord."
          : "Passage inconnu : " + id + ".",
        id == null ? 409 : 404,
      );
    if (p.etat !== "en_cours")
      refuser(
        "FAILED_PRECONDITION",
        "Ce passage est « " + p.etat + " » : il ne reçoit plus d’opérations.",
        409,
      );
    return p;
  }
  function vuePassage(p) {
    return (
      p && {
        id: p.id,
        debut_le: p.debut_le,
        fin_le: p.fin_le,
        derniere_activite: p.derniere_activite,
        etat: p.etat,
        resultat: p.resultat,
        resume: p.resume,
        erreur: p.erreur,
        operations: p.operations,
      }
    );
  }

  function demarrerGestion(moi, args = {}) {
    init();
    cles(args, [], "securite_demarrer_gestion");
    marquerSilences();
    const ouvert = db
      .prepare(
        "SELECT * FROM securite_passages WHERE etat = 'en_cours' ORDER BY id DESC LIMIT 1",
      )
      .get();
    let id = ouvert && ouvert.id;
    if (!ouvert) {
      const t = iso();
      id = Number(
        db
          .prepare(
            "INSERT INTO securite_passages (agent, debut_le, derniere_activite) VALUES ('gestionnaire', ?, ?)",
          )
          .run(t, t).lastInsertRowid,
      );
      consigner({
        agent: "gestionnaire",
        passage_id: id,
        action: "Passage démarré",
      });
    }
    const travail = aTraiter();
    const total = Object.values(travail).reduce(
      (n, x) => n + x.failles.length,
      0,
    );
    return {
      ok: true,
      passage_id: id,
      deja: !!ouvert,
      rien_a_traiter: total === 0,
      a_traiter: travail,
      regles:
        "Toutes les opérations faites pendant ce passage (securite_maj_faille, securite_revalider_faille, securite_suivi_corrections, securite_declarer_faille) sont consignées au journal du gestionnaire. " +
        "securite_journaliser_gestion note ce qui n’est pas un appel d’outil. Clore TOUJOURS par securite_terminer_gestion : resultat « rien » (rien à traiter), « fait » ou « echec » (avec l’erreur). " +
        "Sans activité pendant " +
        GESTION_SILENCE_MIN +
        " min, le passage est marqué interrompu. Aucune fusion de PR : elle reste humaine.",
    };
  }

  function journaliserGestion(moi, args) {
    init();
    cles(
      args,
      ["passage_id", "action", "cible", "resultat", "erreur"],
      "securite_journaliser_gestion",
    );
    marquerSilences();
    const p = passageOuvert(args.passage_id);
    const action = texteBorne(args.action, "action", { min: 3, max: 120 });
    consigner({
      agent: "gestionnaire",
      passage_id: p.id,
      action,
      cible: texteBorne(args.cible, "cible", { max: 200, facultatif: true }),
      resultat: texteBorne(args.resultat, "resultat", {
        max: 300,
        facultatif: true,
      }),
      erreur: texteBorne(args.erreur, "erreur", { max: 300, facultatif: true }),
    });
    return { ok: true, passage_id: p.id };
  }

  function terminerGestion(moi, args) {
    init();
    cles(
      args,
      ["passage_id", "resultat", "resume", "erreur"],
      "securite_terminer_gestion",
    );
    marquerSilences();
    const p = passageOuvert(args.passage_id);
    const resultat = parmi(args.resultat, RESULTATS_GESTION, "resultat");
    const resume = texteBorne(args.resume, "resume", { min: 10, max: 2000 });
    const erreur = texteBorne(args.erreur, "erreur", {
      max: 300,
      facultatif: true,
    });
    if (resultat === "echec" && !erreur)
      refuser(
        "INVALID_ARGUMENT",
        "resultat « echec » : erreur doit dire ce qui a empêché le passage.",
      );
    const t = iso();
    db.prepare(
      "UPDATE securite_passages SET etat = ?, resultat = ?, resume = ?, erreur = ?, fin_le = ?, derniere_activite = ? WHERE id = ?",
    ).run(
      resultat === "echec" ? "echec" : "termine",
      resultat,
      resume,
      erreur,
      t,
      t,
      p.id,
    );
    consigner({
      agent: "gestionnaire",
      passage_id: p.id,
      action: resultat === "echec" ? "Passage en échec" : "Passage terminé",
      resultat:
        resultat === "rien"
          ? "rien à traiter"
          : resultat === "fait"
            ? p.operations + " opération(s)"
            : "échec",
      erreur,
    });
    return {
      ok: true,
      passage: vuePassage(
        db.prepare("SELECT * FROM securite_passages WHERE id = ?").get(p.id),
      ),
    };
  }

  /** Le tableau du gestionnaire : corrections, PR fusionnées, revalidations en attente, récidives. */
  function tableauGestion() {
    init();
    const n = (sql, ...p) => db.prepare(sql).get(...p).n;
    const trente = iso(new Date(maintenant().getTime() - 30 * 86400e3));
    const lignes = [];
    for (const f of db
      .prepare(
        "SELECT * FROM securite_failles WHERE statut = 'corrigee' ORDER BY CASE gravite WHEN 'critique' THEN 0 WHEN 'haute' THEN 1 WHEN 'moyenne' THEN 2 ELSE 3 END, corrigee_le LIMIT 8",
      )
      .all())
      lignes.push({
        ...vueTri(f),
        etape: "a_revalider",
        depuis_jours: ageJours(f.corrigee_le),
      });
    for (const f of db
      .prepare(
        "SELECT * FROM securite_failles WHERE statut = 'pr_ouverte' ORDER BY CASE gravite WHEN 'critique' THEN 0 WHEN 'haute' THEN 1 WHEN 'moyenne' THEN 2 ELSE 3 END, pr_le LIMIT 8",
      )
      .all())
      lignes.push({
        ...vueTri(f),
        etape: "pr_ouverte",
        depuis_jours: ageJours(f.pr_le),
      });
    for (const f of db
      .prepare(
        "SELECT * FROM securite_failles WHERE statut = 'nouvelle' ORDER BY CASE gravite WHEN 'critique' THEN 0 WHEN 'haute' THEN 1 WHEN 'moyenne' THEN 2 ELSE 3 END, trouvee_le LIMIT 8",
      )
      .all())
      lignes.push({
        ...vueTri(f),
        etape: "a_trier",
        depuis_jours: ageJours(f.trouvee_le),
      });
    const attente = db
      .prepare(
        "SELECT MIN(corrigee_le) AS t FROM securite_failles WHERE statut = 'corrigee'",
      )
      .get().t;
    return {
      failles_total: n("SELECT COUNT(*) AS n FROM securite_failles"),
      a_trier: n(
        "SELECT COUNT(*) AS n FROM securite_failles WHERE statut = 'nouvelle'",
      ),
      corrections_en_cours: n(
        "SELECT COUNT(*) AS n FROM securite_failles WHERE statut = 'pr_ouverte'",
      ),
      prs_fusionnees_30j: n(
        "SELECT COUNT(*) AS n FROM securite_failles WHERE corrigee_le IS NOT NULL AND corrigee_le >= ?",
        trente,
      ),
      revalidations_en_attente: n(
        "SELECT COUNT(*) AS n FROM securite_failles WHERE statut = 'corrigee'",
      ),
      attente_la_plus_longue_jours: ageJours(attente),
      revalidees_30j: n(
        "SELECT COUNT(*) AS n FROM securite_failles WHERE revalidee_le IS NOT NULL AND revalidee_le >= ?",
        trente,
      ),
      recidives: n(
        "SELECT COUNT(*) AS n FROM securite_failles WHERE recidive_de IS NOT NULL",
      ),
      recidives_ouvertes: n(
        "SELECT COUNT(*) AS n FROM securite_failles WHERE recidive_de IS NOT NULL AND statut IN ('nouvelle','confirmee','pr_ouverte')",
      ),
      lignes: lignes.slice(0, 12),
    };
  }

  // ── État réel de chaque agent ────────────────────────────────────────────────
  const LIB_ETAT_AGENT = {
    en_cours: "en cours",
    a_l_heure: "à l’heure",
    en_retard: "en retard",
    echec: "en échec",
    interrompu: "interrompu",
    jamais: "aucun passage enregistré",
  };
  const hm = (d) => {
    const p = paris(new Date(d));
    return (
      String(p.heure).padStart(2, "0") + ":" + String(p.minute).padStart(2, "0")
    );
  };
  const h2a = (n) => String(n).padStart(2, "0");

  function statutAuditeur() {
    const ici = paris();
    const plan = db
      .prepare("SELECT * FROM securite_plans WHERE jour = ?")
      .get(ici.jour);
    const enCours = db
      .prepare(
        "SELECT * FROM securite_creneaux WHERE etat = 'en_cours' ORDER BY debut_le DESC LIMIT 1",
      )
      .get();
    // Le dernier passage ACHEVÉ (terminé, reporté ou échoué) : l'audit en cours a sa propre ligne.
    const dernier = db
      .prepare(
        "SELECT * FROM securite_creneaux WHERE etat NOT IN ('prevu','en_cours') ORDER BY jour DESC, heure DESC LIMIT 1",
      )
      .get();
    const prochain = db
      .prepare(
        "SELECT * FROM securite_creneaux WHERE etat = 'prevu' AND jour = ? ORDER BY heure LIMIT 1",
      )
      .get(ici.jour);
    const jamaisPlan = !db
      .prepare("SELECT 1 FROM securite_plans LIMIT 1")
      .get();
    const prevus = db
      .prepare("SELECT COUNT(*) AS n FROM securite_creneaux WHERE jour = ?")
      .get(ici.jour).n;
    const recent = dernier && dernier.jour >= decalerJour(ici.jour, -1);
    let etat,
      message,
      blocage = null;
    if (enCours) {
      etat = "en_cours";
      message =
        "Audit de " +
        enCours.depot +
        " en cours depuis " +
        hm(enCours.debut_le) +
        ".";
    } else if (jamaisPlan && !dernier) {
      etat = "jamais";
      message =
        "Aucun passage enregistré : la planification de minuit n’a encore jamais eu lieu.";
    } else if (!plan && ici.heure * 60 + ici.minute >= SILENCE_MIN) {
      etat = "en_retard";
      message = "Aucun plan pour aujourd’hui.";
      blocage =
        "La planification de minuit n’a pas été reçue : aucun audit ne partira tant qu’elle manque.";
    } else if (recent && dernier.etat === "reporte") {
      etat = "en_retard";
      message = "Dernier créneau reporté.";
      blocage =
        "Créneau de " +
        h2a(dernier.heure) +
        " h (" +
        dernier.depot +
        ") reporté : " +
        String(dernier.resume || "").replace(/^Reporté : /, "");
    } else if (recent && dernier.etat === "echec") {
      etat = "echec";
      message = "Dernier audit en échec.";
      blocage =
        "Créneau de " +
        h2a(dernier.heure) +
        " h (" +
        dernier.depot +
        ") : " +
        (dernier.resume || "échec sans détail");
    } else {
      etat = "a_l_heure";
      message =
        dernier && dernier.fin_le
          ? "Dernier audit à " +
            h2a(dernier.heure) +
            " h : " +
            dernier.depot +
            " — " +
            (dernier.resultat === "failles"
              ? "failles déclarées"
              : "rien de déclaré") +
            "."
          : plan
            ? "Plan reçu à " +
              hm(plan.etabli_le) +
              (prochain
                ? " ; premier audit à " + h2a(prochain.heure) + " h."
                : ".")
            : "En attente de la planification de minuit.";
    }
    return {
      agent: "auditeur",
      nom: "Auditeur",
      role: "Recherche de vulnérabilités",
      horaire: "01 h – 23 h",
      description: "Planification à minuit, puis un dépôt par audit",
      etat,
      libelle_etat: LIB_ETAT_AGENT[etat],
      message,
      blocage,
      planification: plan ? { le: plan.etabli_le, auteur: plan.auteur } : null,
      dernier_passage: dernier
        ? {
            creneau_id: dernier.id,
            jour: dernier.jour,
            heure: dernier.heure,
            depot: dernier.depot,
            etat: dernier.etat,
            resultat: dernier.resultat,
            debut_le: dernier.debut_le,
            fin_le: dernier.fin_le,
          }
        : null,
      prochain_passage: prochain
        ? {
            libelle: "aujourd’hui " + h2a(prochain.heure) + ":00",
            depot: prochain.depot,
            angle: prochain.angle,
          }
        : {
            libelle: "demain 00:00",
            depot: null,
            angle: "planification de la journée",
          },
      planifies_aujourdhui: prevus,
    };
  }

  function statutGestionnaire() {
    const ici = paris();
    const now = maintenant().getTime();
    const dernier = db
      .prepare("SELECT * FROM securite_passages ORDER BY id DESC LIMIT 1")
      .get();
    // Le dernier horaire attendu (hh:35) et le temps écoulé depuis.
    const depuis =
      ici.minute >= GESTION_MINUTE
        ? ici.minute - GESTION_MINUTE
        : ici.minute + 60 - GESTION_MINUTE;
    const creneau = now - depuis * 60e3;
    const heureAttendue =
      ici.minute >= GESTION_MINUTE ? ici.heure : (ici.heure + 23) % 24;
    const servi = db
      .prepare("SELECT 1 FROM securite_passages WHERE debut_le >= ? LIMIT 1")
      .get(iso(new Date(creneau - 20 * 60e3)));
    const manque = !servi && depuis >= GESTION_RETARD_MIN;
    const prochaineHeure =
      ici.minute < GESTION_MINUTE ? ici.heure : (ici.heure + 1) % 24;
    const prochain =
      (ici.minute >= GESTION_MINUTE && ici.heure === 23
        ? "demain "
        : "aujourd’hui ") +
      h2a(prochaineHeure) +
      ":" +
      GESTION_MINUTE;
    let etat,
      message,
      blocage = null;
    if (!dernier) {
      etat = "jamais";
      message =
        "Aucun passage enregistré : la tâche horaire du gestionnaire n’a encore rien signalé.";
    } else if (dernier.etat === "en_cours") {
      etat = "en_cours";
      message =
        "Passage en cours depuis " +
        hm(dernier.debut_le) +
        " · " +
        dernier.operations +
        " opération(s).";
    } else if (manque) {
      etat = "en_retard";
      message = "Dernier passage à " + hm(dernier.debut_le) + ".";
      blocage =
        "Passage de " +
        h2a(heureAttendue) +
        ":" +
        GESTION_MINUTE +
        " manqué : aucun démarrage " +
        depuis +
        " min après.";
    } else if (dernier.etat === "echec") {
      etat = "echec";
      message = "Dernier passage en échec.";
      blocage = dernier.erreur || "échec sans détail";
    } else if (dernier.etat === "interrompu") {
      etat = "interrompu";
      message = "Dernier passage interrompu.";
      blocage =
        "Passage de " +
        hm(dernier.debut_le) +
        " : " +
        (dernier.erreur || "interrompu");
    } else {
      etat = "a_l_heure";
      message =
        "Dernier passage à " +
        hm(dernier.debut_le) +
        " : " +
        (dernier.resultat === "rien"
          ? "rien à traiter"
          : dernier.operations + " opération(s)") +
        ".";
    }
    const jour = db
      .prepare(
        "SELECT etat, COUNT(*) AS n FROM securite_passages WHERE debut_le >= ? GROUP BY etat",
      )
      .all(iso(new Date(now - (ici.heure * 60 + ici.minute) * 60e3)));
    const parEtat = Object.fromEntries(jour.map((r) => [r.etat, r.n]));
    return {
      agent: "gestionnaire",
      nom: "Gestionnaire",
      role: "Triage et corrections",
      horaire: "Chaque heure · :" + GESTION_MINUTE,
      description: "Suivi des failles, PR, correctifs et régressions",
      etat,
      libelle_etat: LIB_ETAT_AGENT[etat],
      message,
      blocage,
      dernier_passage: vuePassage(dernier) || null,
      prochain_passage: etat === "en_cours" ? null : { libelle: prochain },
      aujourdhui: {
        attendus: ici.minute >= GESTION_MINUTE ? ici.heure + 1 : ici.heure,
        termines: parEtat.termine || 0,
        echecs: parEtat.echec || 0,
        interrompus: parEtat.interrompu || 0,
        en_cours: parEtat.en_cours || 0,
      },
    };
  }

  function statutAgents() {
    init();
    marquerSilences();
    return { auditeur: statutAuditeur(), gestionnaire: statutGestionnaire() };
  }

  return {
    AGENTS,
    GESTION_MINUTE,
    GESTION_SILENCE_MIN,
    RESULTATS_GESTION,
    consigner,
    consignerErreur,
    agentCourant,
    journalAgents,
    lireOperations,
    demarrerGestion,
    journaliserGestion,
    terminerGestion,
    tableauGestion,
    statutAgents,
    GRAVITES,
    STATUTS,
    OUVERTS,
    ETATS,
    ETAPES,
    TYPES_PREUVE,
    LIBELLE_FAMILLE,
    SILENCE_MIN,
    ErreurSecurite,
    IMPORTANCES,
    FAIBLE_JOURS,
    FAIBLE_PAR_PLAN,
    importanceDe,
    classerDepots,
    aAuditer,
    init,
    paris,
    familleDe,
    resoudreDepot,
    synchroniserDepots,
    synchroniserSiAncienne,
    declarerDepots,
    planifierJournee,
    demarrerAudit,
    journaliserAudit,
    terminerAudit,
    declarerFaille,
    mettreAJourFaille,
    revaliderFaille,
    lireFaille,
    listerFailles,
    listerAudits,
    lireAudit,
    suiviCorrections,
    tendances,
    inventaire,
    etatDepots,
    etat,
    etatPourRoutine,
    marquerSilences,
    _fixerHorloge,
    _derniereSynchro: () => derniereSynchro,
  };
}
module.exports = { createSecurity };
