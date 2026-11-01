'use strict';
(() => {
  const root = document.querySelector('.mcp-dashboard[data-days]');
  if (!root) return;
  const status = root.querySelector('[data-live-status]');
  let source = null, revoked = false;
  const label = text => { status.textContent = text; };
  function filterTools() {
    const search=root.querySelector('[data-tool-search]'), mode=root.querySelector('select[data-tool-mode]');
    if (!search || !mode) return;
    const query=search.value.toLocaleLowerCase('fr'), records=[...root.querySelectorAll('[data-tool-record]')];
    let visible=0;
    for (const row of records) { row.hidden=!(row.textContent.toLocaleLowerCase('fr').includes(query) && (mode.value==='all'||row.dataset.toolMode===mode.value)); if(!row.hidden)visible++; }
    root.querySelector('[data-tool-count]').textContent=visible+' outils correspondants (Atlas et contrat potentiel Lab)';
  }
  function filterConversations() {
    const search=root.querySelector('[data-shadow-search]'), thread=root.querySelector('select[data-shadow-thread]');
    if(!search||!thread)return;
    const query=search.value.toLocaleLowerCase('fr');let visible=0;
    for(const row of root.querySelectorAll('[data-shadow-message]')) { row.hidden=!(row.textContent.toLocaleLowerCase('fr').includes(query)&&(thread.value==='all'||row.dataset.shadowThread===thread.value));if(!row.hidden)visible++; }
    root.querySelector('[data-shadow-count]').textContent=visible+' messages correspondants';
  }
  root.addEventListener('input',event=>{if(event.target.matches('[data-tool-search],select[data-tool-mode]'))filterTools();if(event.target.matches('[data-shadow-search],select[data-shadow-thread]'))filterConversations();});
  root.addEventListener('change',event=>{if(event.target.matches('select[data-tool-mode]'))filterTools();if(event.target.matches('select[data-shadow-thread]'))filterConversations();});
  function disconnect() {
    if (source) source.close();
    source = null;
  }
  function connect() {
    if (source || revoked || document.hidden) return;
    if (!window.EventSource) { label('Actualisation manuelle — navigateur incompatible'); return; }
    if (!navigator.onLine) { label('Hors connexion — données conservées'); return; }
    label('Connexion au suivi en direct…');
    const live = source = new EventSource('/metis/connecteur/events?days=' + encodeURIComponent(root.dataset.days));
    live.addEventListener('stats', event => {
      if (source !== live) return;
      try {
        const update = JSON.parse(event.data);
        for (const key of ['overview', 'recent']) {
          const target = root.querySelector('[data-live-part="' + key + '"]');
          // Garder la position dans les tableaux larges pendant les mises à jour.
          const scrolls = [...target.querySelectorAll('.usage-scroll')].map(el => [el.scrollLeft, el.scrollTop]);
          const openSummaries = [...target.querySelectorAll('details[open]')].map(el=>el.querySelector('summary')?.textContent);
          const focusedSummary=target.contains(document.activeElement)&&document.activeElement?.tagName==='SUMMARY'?document.activeElement.textContent:null;
          target.innerHTML = update.parts[key]; // HTML échappé par le rendu serveur authentifié.
          target.querySelectorAll('details').forEach(el=>{if(openSummaries.includes(el.querySelector('summary')?.textContent))el.open=true;});
          if(focusedSummary)[...target.querySelectorAll('summary')].find(el=>el.textContent===focusedSummary)?.focus({preventScroll:true});
          [...target.querySelectorAll('.usage-scroll')].forEach((el, i) => {
            if (scrolls[i]) { el.scrollLeft = scrolls[i][0]; el.scrollTop = scrolls[i][1]; }
          });
        }
        label('En direct · mis à jour à ' + new Date(update.at).toLocaleTimeString('fr-FR', { timeZone: 'Europe/Paris' }));
      } catch { label('Actualisation indisponible — rechargez la page'); }
    });
    live.addEventListener('error', () => {
      if (source === live) label(live.readyState === EventSource.CLOSED
        ? 'Connexion indisponible — rechargez la page'
        : 'Connexion interrompue — reconnexion automatique…');
    });
    live.addEventListener('access-revoked', () => {
      if (source !== live) return;
      revoked = true; disconnect();
      root.querySelectorAll('[data-live-part], .usage-audit-panel, [data-protected-detail]').forEach(el => el.replaceChildren());
      label('Session expirée ou accès retiré — reconnectez-vous');
    });
  }
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) { disconnect(); label('Suivi en pause — onglet masqué'); }
    else connect();
  });
  window.addEventListener('offline', () => { disconnect(); label('Hors connexion — données conservées'); });
  window.addEventListener('online', connect);
  window.addEventListener('pagehide', disconnect);
  window.addEventListener('pageshow', connect);
  connect();
})();

