// Security Center de Métis — interactions de /metis/securite.
// La page est complète sans ce script ; il ajoute les filtres du mur, la fiche au clic,
// la durée de l'audit en cours et le rechargement quand l'état change (toutes les 30 s).
(function () {
  'use strict';
  var racine = document.querySelector('.sc');
  if (!racine) return;

  var LIB = { critique: 'Critique', haute: 'Haute', moyenne: 'Moyenne', basse: 'Basse', saine: 'Saine', jamais: 'Jamais audité',partiel:'Analyse limitée' };
  var tuiles = Array.prototype.slice.call(racine.querySelectorAll('.sc-t'));
  var filtres = Array.prototype.slice.call(racine.querySelectorAll('.sc-filtre'));
  var fiche = racine.querySelector('.sc-fiche');

  function lireEtat() {
    var p = {};
    location.hash.replace(/^#/, '').split('&').forEach(function (x) { var i = x.indexOf('='); if (i > 0) p[x.slice(0, i)] = decodeURIComponent(x.slice(i + 1)); });
    return p;
  }
  function ecrireEtat(cle, valeur) {
    var p = lireEtat(); p[cle] = valeur;
    var h = Object.keys(p).filter(function (k) { return p[k]; }).map(function (k) { return k + '=' + encodeURIComponent(p[k]); }).join('&');
    try { history.replaceState(null, '', h ? '#' + h : location.pathname); } catch (e) { /* */ }
  }

  function garde(t, f) {
    var mort = t.dataset.importance === 'mort';
    if (f === 'tous') return true;
    if (f === 'risque') return ['critique', 'haute', 'moyenne'].indexOf(t.dataset.statut) >= 0;
    if (f === 'publics') return t.dataset.public === '1' && !mort;
    if (f === 'jamais') return t.dataset.statut === 'jamais' && !mort;
    if (f === 'actif' || f === 'faible' || f === 'mort') return t.dataset.importance === f;
    return t.dataset.famille === f;
  }
  var LIB_IMP = { actif: 'Actif', faible: 'Peu important', mort: 'Mort' };
  var LIB_SOURCE = { manuel: 'réglé à la main', base: 'classement de base', auto: 'règle automatique', defaut: 'par défaut' };
  function filtrer(f) {
    filtres.forEach(function (b) { b.setAttribute('aria-pressed', String(b.dataset.filtre === f)); });
    var visibles = 0;
    tuiles.forEach(function (t) { var ok = garde(t, f); t.hidden = !ok; if (ok) visibles++; });
    Array.prototype.forEach.call(racine.querySelectorAll('.sc-groupe'), function (g) {
      var n = g.querySelectorAll('.sc-t:not([hidden])').length;
      g.hidden = n === 0;
      var c = g.querySelector('[data-compte]'); if (c) c.textContent = n;
    });
    var aucun = racine.querySelector('[data-aucun]'); if (aucun) aucun.hidden = visibles > 0;
    ecrireEtat('filtre', f === 'tous' ? '' : f);
  }
  filtres.forEach(function (b) { b.addEventListener('click', function () { filtrer(b.dataset.filtre); }); });

  function remplir(champ, valeur) { var el = fiche && fiche.querySelector('[data-f="' + champ + '"]'); if (el) el.textContent = valeur; }
  function choisir(t) {
    if (!fiche || !t) return;
    tuiles.forEach(function (x) { x.classList.toggle('choisi', x === t); });
    remplir('groupe', t.dataset.groupe); remplir('nom', t.dataset.nom); remplir('visibilite', t.dataset.visibilite);
    remplir('comptes', t.dataset.comptes); remplir('dernier', t.dataset.dernier); remplir('prochain', t.dataset.prochain);
    remplir('n30', t.dataset.n30); remplir('angles', t.dataset.angles || 'aucun pour l’instant');
    var st = fiche.querySelector('[data-f="statut"]');
    if (st) { st.className = 'sc-sev f-' + t.dataset.statut; st.textContent = LIB[t.dataset.statut] || t.dataset.statut; }
    var imp = t.dataset.importance || 'actif';
    var bi = fiche.querySelector('[data-f="importance"]');
    if (bi) { bi.className = 'sc-imp ' + imp; bi.textContent = LIB_IMP[imp]; }
    remplir('imp-libelle', LIB_IMP[imp]); remplir('imp-source', LIB_SOURCE[t.dataset.impSource] || ''); remplir('imp-raison', t.dataset.impRaison || '');
    var champ = fiche.querySelector('[data-f-champ="depot"]'); if (champ) champ.value = t.dataset.nom;
    var choix = fiche.querySelector('[data-f-champ="importance"]'); if (choix) choix.value = t.dataset.impSource === 'manuel' ? imp : (imp === 'actif' ? 'faible' : 'actif');
    ecrireEtat('depot', t.dataset.nom);
  }
  tuiles.forEach(function (t) { t.addEventListener('click', function () { choisir(t); }); });

  // État conservé d'un rechargement à l'autre.
  var depart = lireEtat();
  if (depart.filtre) filtrer(depart.filtre);
  if (depart.depot) { var t0 = tuiles.filter(function (t) { return t.dataset.nom === depart.depot; })[0]; if (t0) choisir(t0); }

  // Durée de l'audit en cours.
  var depuis = racine.querySelector('time[data-depuis]');
  function duree() {
    if (!depuis) return;
    var min = Math.max(0, Math.round((Date.now() - Date.parse(depuis.dataset.depuis)) / 60000));
    depuis.textContent = min < 60 ? min + ' min' : Math.floor(min / 60) + ' h ' + String(min % 60).padStart(2, '0');
  }
  duree(); setInterval(duree, 30000);

  // Rechargement quand l'état change (et seulement alors), onglet visible.
  var version = racine.dataset.version;
  setInterval(function () {
    if (document.hidden) return;
    fetch('/metis/securite/etat.json?version=1', { credentials: 'same-origin', cache: 'no-store' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (j) { if (j && j.version && j.version !== version) location.reload(); })
      .catch(function () { /* réseau coupé : on réessaie au prochain tour */ });
  }, 30000);
})();

