"use strict";
const {object,text,int,fail,hash}=require('./util.cjs');
const {createProviders}=require('./providers.cjs');
const {limits,DEFAULT_LIMITS}=require('./scheduler.cjs');
const ROLES=[{id:'auditeur',kind:'audit',name:'Auditeur',description:'Recherche de vulnérabilités à partir du code et de preuves précises.'},{id:'gestionnaire',kind:'followup',name:'Gestionnaire',description:'Lecture des PR et proposition des prochaines actions, sans fusion ni revalidation automatique.'}];
function providerConfig(value){
  object(value,['kind','model','baseUrl']);
  if(!['openai','anthropic','compatible'].includes(value.kind))fail('INVALID_ARGUMENT','Fournisseur inconnu.');
  const next={kind:value.kind,model:text(value.model||'','Modèle',160,0),baseUrl:''};
  if(value.kind==='compatible'){
    let u;try{u=new URL(value.baseUrl);}catch{fail('INVALID_ARGUMENT','Adresse de l’API compatible requise.');}
    const local=['localhost','127.0.0.1','[::1]','host.docker.internal'].includes(u.hostname);
    if((u.protocol!=='https:'&&!(local&&u.protocol==='http:'))||u.username||u.password||u.search||u.hash)fail('INVALID_ARGUMENT','API : HTTPS requis ou adresse locale explicite.');
    next.baseUrl=u.href.replace(/\/$/,'');
  }
  return next;
}
function createAgentConfig(store,fetchImpl,github){
  const defaults=()=>ROLES.map((r,i)=>({id:r.id,name:r.name,enabled:true,provider:{...store.config().provider},credential:store.config().provider.model?'shared':'dedicated',instructions:'',hour:9,minute:i?35:0,timezone:store.config().timezone,limits:{...DEFAULT_LIMITS}}));
  if(!store.get('securityAgents')){
    store.transaction(()=>{store.set('securityAgents',{profiles:defaults(),completedAt:null,revision:1});store.db.prepare('UPDATE routines SET enabled=0,revision=revision+1 WHERE enabled=1').run();});
  }
  const settings=()=>store.get('securityAgents',{profiles:defaults(),completedAt:null,revision:1});
  const profile=id=>{const p=settings().profiles.find(p=>p.id===id);if(!p)fail('NOT_FOUND','Agent inconnu.',404);return p;};
  const key=id=>profile(id).credential==='shared'?store.secret('provider'):store.secret('agent:'+id);
  const adapters=new Map(ROLES.map(r=>[r.id,createProviders(store,fetchImpl,{config:()=>profile(r.id).provider,key:()=>key(r.id),testKey:'agentTest:'+r.id})]));
  for(const [id,a] of adapters){const ownVerified=a.verified;a.verified=()=>ownVerified()||(profile(id).credential==='shared'&&store.get('providerTest')?.fingerprint===a.fingerprint());}
  const adapter=id=>{profile(id);return adapters.get(id);};
  const repositoryFingerprint=()=>hash(JSON.stringify({repositories:store.config().repositories.map(r=>r.toLowerCase()).sort(),github:store.config().github})+store.secret('github')+store.secret('githubAppKey'));
  const repositoriesVerified=()=>store.get('securityRepositoryTest')?.fingerprint===repositoryFingerprint();
  function reasons(){
    const value=settings(),issues=[];
    if(!value.profiles.some(p=>p.enabled))issues.push('Activez au moins un agent.');
    for(const p of value.profiles.filter(p=>p.enabled)){
      if(!p.provider.model)issues.push(p.name+' : choisissez un modèle.');
      else if(!adapter(p.id).verified())issues.push(p.name+' : testez le modèle et ses appels d’outils.');
    }
    if(!store.config().repositories.length)issues.push('Choisissez au moins un dépôt.');
    else if(!repositoriesVerified())issues.push('Vérifiez l’accès aux dépôts sélectionnés.');
    return issues;
  }
  const ready=()=>!!settings().completedAt && reasons().length===0;
  function report(){
    const value=settings();return {...value,ready:ready(),issues:reasons(),repositoriesVerified:repositoriesVerified(),repositories:store.config().repositories,
      profiles:value.profiles.map(p=>({...p,...ROLES.find(r=>r.id===p.id),name:p.name,verified:adapter(p.id).verified(),hasKey:!!key(p.id),testedAt:store.get('agentTest:'+p.id)?.at||null}))};
  }
  function save(input,actor){
    object(input,['profiles','expected_revision','keys']);
    if(!Array.isArray(input.profiles)||input.profiles.length!==ROLES.length)fail('INVALID_ARGUMENT','Configurez les deux rôles du Security Center.');
    const ids=new Set();
    const profiles=input.profiles.map(p=>{
      object(p,['id','name','enabled','provider','credential','instructions','hour','minute','timezone','limits']);
      if(!ROLES.some(r=>r.id===p.id)||ids.has(p.id)||typeof p.enabled!=='boolean')fail('INVALID_ARGUMENT','Rôle ou activation invalide.');
      ids.add(p.id);
      if(!['shared','dedicated'].includes(p.credential))fail('INVALID_ARGUMENT','Source de clé invalide.');
      const provider=providerConfig(p.provider),shared=store.config().provider;
      if(p.credential==='shared'&&(provider.kind!==shared.kind||provider.baseUrl!==shared.baseUrl))fail('INVALID_ARGUMENT','La clé partagée doit utiliser le même fournisseur et la même adresse que la configuration générale.');
      const zone=text(p.timezone,'Fuseau',80);try{new Intl.DateTimeFormat('fr',{timeZone:zone});}catch{fail('INVALID_ARGUMENT','Fuseau horaire invalide.');}
      return {id:p.id,name:text(p.name,'Nom de l’agent',64),enabled:p.enabled,provider,credential:p.credential,instructions:text(p.instructions||'','Consignes',2000,0),hour:int(p.hour,'Heure',0,23),minute:int(p.minute,'Minute',0,59),timezone:zone,limits:limits(p.limits)};
    });
    object(input.keys||{},ROLES.map(r=>r.id));
    store.transaction(()=>{
      const prior=settings();if(prior.revision!==input.expected_revision)fail('REVISION_CONFLICT','La configuration des agents a changé. Rechargez-la.',409);
      for(const p of profiles){
        const previous=prior.profiles.find(old=>old.id===p.id);
        if(previous.provider.kind!==p.provider.kind||previous.provider.baseUrl!==p.provider.baseUrl)store.secret('agent:'+p.id,'');
        if(Object.hasOwn(input.keys||{},p.id))store.secret('agent:'+p.id,text(input.keys[p.id],'Clé API',10000,0));
      }
      for(const p of profiles.filter(p=>!p.enabled))store.db.prepare('UPDATE routines SET enabled=0,revision=revision+1 WHERE kind=? AND enabled=1').run(p.id==='auditeur'?'audit':'followup');
      store.set('securityAgents',{profiles,completedAt:null,revision:prior.revision+1});store.log(actor,'security.agents.save');
    });
    return report();
  }
  async function testRepositories(signal){
    const fingerprint=repositoryFingerprint(),repositories=[...store.config().repositories];
    if(!repositories.length)fail('FAILED_PRECONDITION','Sélectionnez des dépôts avant le test.');
    store.set('securityRepositoryTest',null);
    for(const repository of repositories){signal.throwIfAborted();await github.describe(repository,signal);}
    if(fingerprint!==repositoryFingerprint())fail('REVISION_CONFLICT','La sélection ou la clé GitHub a changé pendant le test.',409);
    store.set('securityRepositoryTest',{fingerprint,at:new Date().toISOString()});return {ok:true,count:repositories.length};
  }
  function requireAgent(kind){
    if(!settings().completedAt)fail('SECURITY_SETUP_REQUIRED','Terminez la configuration initiale du Security Center.',409);
    const role=ROLES.find(r=>r.kind===kind),p=role&&profile(role.id);
    if(!p?.enabled)fail('AGENT_DISABLED','Cet agent est désactivé.',409);
    if(!adapter(p.id).verified())fail('PROVIDER_NOT_VERIFIED','Testez le fournisseur IA de '+p.name+' avant le lancement.',409);
    if(!repositoriesVerified())fail('GITHUB_NOT_VERIFIED','Vérifiez l’accès aux dépôts sélectionnés.',409);
    return {profile:p,provider:adapter(p.id),fingerprint:adapter(p.id).fingerprint()};
  }
  function complete(revision,actor){
    const prior=settings();if(prior.revision!==revision)fail('REVISION_CONFLICT','La configuration des agents a changé.',409);
    const issues=reasons();if(issues.length)fail('SETUP_INCOMPLETE',issues.join(' '),409);
    store.set('securityAgents',{...prior,completedAt:new Date().toISOString(),revision:prior.revision+1});store.log(actor,'security.setup.complete');return report();
  }
  return {settings,profile,adapter,key,report,save,ready,requireAgent,testRepositories,complete,repositoriesVerified,repositoryFingerprint};
}
module.exports={createAgentConfig,providerConfig,ROLES};
