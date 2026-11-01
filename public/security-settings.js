"use strict";
(() => {
  const setup=document.querySelector('#security-setup-form'),appearance=document.querySelector('#appearance-form');
  if(!setup&&!appearance)return;
  const notice=document.querySelector('#ss-notice');let state,busy=false;
  const message=(text,error=false)=>{notice.textContent=text;notice.dataset.error=String(error);};
  async function request(path,method='GET',value){
    const headers=method==='GET'?{}:{'Content-Type':'application/json','X-Metis-Request':'1','X-CSRF-Token':state.csrf};
    const result=await fetch(path,{method,headers,body:value===undefined?undefined:JSON.stringify(value),credentials:'same-origin'});
    const data=await result.json();if(!result.ok)throw Error(data.error?.message||'Opération refusée.');return data;
  }
  async function operate(action){
    if(busy)return;busy=true;const buttons=[...document.querySelectorAll('.ss-page button')];buttons.forEach(b=>b.disabled=true);
    try{await action();}catch(error){message(error.message,true);}finally{busy=false;buttons.forEach(b=>b.disabled=false);}
  }
  function readProfile(box){
    const data=new FormData();box.querySelectorAll('input,select,textarea').forEach(el=>{if(el.type!=='checkbox'||el.checked)data.append(el.name,el.value);});
    const [hour,minute]=data.get('time').split(':').map(Number);
    return {id:box.dataset.agent,name:data.get('name'),enabled:data.has('enabled'),provider:{kind:data.get('kind'),model:data.get('model'),baseUrl:data.get('baseUrl')},credential:data.get('credential'),instructions:data.get('instructions'),hour,minute,timezone:data.get('timezone'),limits:Object.fromEntries(['maxCalls','maxTokens','maxOutputTokens','maxFiles','maxSourceBytes','timeoutSeconds'].map(key=>[key,Number(data.get(key))]))};
  }
  async function saveSetup(){
    if(!setup.reportValidity())throw Error('Complétez les champs indiqués.');
    const repositories=setup.elements.repositories.value.split(/[\n,]/).map(s=>s.trim()).filter(Boolean);
    const config={...state.config,repositories};
    if(JSON.stringify(repositories)!==JSON.stringify(state.config.repositories))await request('/api/config','POST',{config,expected_revision:state.configRevision});
    if(setup.elements.githubKey.value)await request('/api/secrets','POST',{github:setup.elements.githubKey.value});
    const profiles=[...setup.querySelectorAll('[data-agent]')].map(readProfile),keys={};
    for(const box of setup.querySelectorAll('[data-agent]'))if(box.querySelector('[name=key]').value)keys[box.dataset.agent]=box.querySelector('[name=key]').value;
    await request('/api/security/setup','POST',{profiles,keys,expected_revision:state.revision});
    setup.elements.githubKey.value='';setup.querySelectorAll('[name=key]').forEach(el=>el.value='');
    state=await request('/api/security/setup');updateStatus();
  }
  function updateStatus(){
    for(const profile of state.profiles){const badge=document.querySelector('[data-agent-status="'+profile.id+'"]');badge.textContent=profile.verified?'Connexion vérifiée':'Connexion à tester';badge.className='ss-badge '+(profile.verified?'ss-ok':'');}
    const repository=document.querySelector('[data-repository-status]');repository.textContent=state.repositoriesVerified?'Accès vérifiés':'Accès à vérifier';repository.className='ss-badge '+(state.repositoriesVerified?'ss-ok':'');
    document.querySelector('[data-setup-issues]').textContent=state.issues.join(' ')||'Les connexions sont prêtes. Vous pouvez valider la configuration.';
    const steps=document.querySelectorAll('.ss-steps li');
    steps[0].classList.toggle('done',state.repositoriesVerified);steps[1].classList.toggle('done',state.profiles.some(p=>p.enabled)&&state.profiles.filter(p=>p.enabled).every(p=>p.verified));steps[2].classList.toggle('done',state.ready);
  }
  if(setup){
    request('/api/security/setup').then(value=>{state=value;updateStatus();}).catch(e=>message(e.message,true));
    setup.addEventListener('submit',event=>{event.preventDefault();if(state)void operate(async()=>{await saveSetup();message('Réglages enregistrés. Testez les connexions puis validez la configuration.');});});
    setup.addEventListener('change',event=>{
      if(event.target.name==='kind'){const box=event.target.closest('[data-agent]');if(event.target.value!==state?.config.provider.kind)box.querySelector('[name=credential]').value='dedicated';}
    });
    setup.addEventListener('input',event=>{
      if(['model','baseUrl','key','credential','kind'].includes(event.target.name)){
        const id=event.target.closest('[data-agent]')?.dataset.agent;if(id){const badge=document.querySelector('[data-agent-status="'+id+'"]');badge.textContent='À enregistrer et tester';badge.className='ss-badge';}
      }
      if(['repositories','githubKey'].includes(event.target.name)){const badge=document.querySelector('[data-repository-status]');badge.textContent='À enregistrer et vérifier';badge.className='ss-badge';}
    });
    setup.addEventListener('click',event=>{
      const button=event.target.closest('button');if(!button||!state)return;
      if(button.matches('[data-test-agent]'))void operate(async()=>{await saveSetup();message('Test du modèle en cours…');const result=await request('/api/security/agents/'+button.dataset.testAgent+'/test','POST',{});state=await request('/api/security/setup');updateStatus();message('Connexion et appels d’outils vérifiés · '+result.tokens+' jetons.');});
      else if(button.matches('[data-test-repositories]'))void operate(async()=>{await saveSetup();message('Vérification des dépôts…');const result=await request('/api/security/repositories/test','POST',{});state=await request('/api/security/setup');updateStatus();message(result.count+' dépôt(s) accessible(s).');});
      else if(button.matches('[data-complete-setup]'))void operate(async()=>{await saveSetup();await request('/api/security/complete','POST',{expected_revision:state.revision,activate:setup.elements.activate.checked});location.assign('/metis/securite');});
    });
  }
  if(appearance){
    request('/api/appearance').then(value=>state=value).catch(e=>message(e.message,true));
    const list=appearance.querySelector('[data-navigation-list]');
    appearance.addEventListener('click',event=>{
      const move=event.target.closest('[data-move]');if(move){const row=move.closest('[data-navigation-id]');if(move.dataset.move==='up'&&row.previousElementSibling)list.insertBefore(row,row.previousElementSibling);else if(move.dataset.move==='down'&&row.nextElementSibling)list.insertBefore(row.nextElementSibling,row);}
      if(event.target.closest('[data-reset-appearance]')){appearance.reset();const original=['publications','architecture','glossaire','experts','graphiques','connecteur','securite'];for(const id of original){const row=list.querySelector('[data-navigation-id="'+id+'"]');row.querySelector('[name=label]').value={publications:'Publications',architecture:'Plans d’architecture',glossaire:'Glossaire',experts:'Experts',graphiques:'Graphiques',connecteur:'Activité du connecteur',securite:'Security Center'}[id];row.querySelector('[name=visible]').checked=true;list.append(row);}for(const [k,v] of Object.entries({brand:'Métis',workspace:'Recherche',subtitle:'Publications du système Métis',section:'Explorer',search:'Chercher un document, un sigle…'}))appearance.elements[k].value=v;appearance.elements.showCounts.checked=true;message('Valeurs d’origine chargées. Enregistrez pour les appliquer.');}
    });
    appearance.addEventListener('submit',event=>{event.preventDefault();if(!state)return;void operate(async()=>{
      if(!appearance.reportValidity())return;const data=new FormData(appearance),value=Object.fromEntries(['brand','workspace','subtitle','section','search'].map(k=>[k,data.get(k)]));value.showCounts=data.has('showCounts');
      value.navigation=[...list.children].map(row=>({id:row.dataset.navigationId,label:row.querySelector('[name=label]').value,visible:row.querySelector('[name=visible]').checked}));
      await request('/api/appearance','POST',{appearance:value,expected_revision:state.revision});location.assign('/metis/apparence?enregistre=1');
    });});
    if(new URLSearchParams(location.search).has('enregistre'))message('Présentation enregistrée. Le menu utilise vos nouveaux libellés.');
  }
})();
