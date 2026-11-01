"use strict";
const test=require('node:test'),assert=require('node:assert/strict');
const {instance,fakeUpstreams,response}=require('./helpers.cjs');
const {createApp}=require('../src/app.cjs');
async function prepare(x,activate=false){
  await x.bootstrap();const config=x.app.store.config();config.repositories=['Example/project'];
  assert.equal((await x.call('/api/config','POST',{config,expected_revision:1})).status,200);
  const profiles=x.app.agents.settings().profiles.map((p,i)=>({...p,credential:'dedicated',provider:{kind:'openai',model:i?'triage-model':'audit-model',baseUrl:''}}));
  assert.equal((await x.call('/api/security/setup','POST',{profiles,expected_revision:1,keys:{auditeur:'fixture-audit-private-key',gestionnaire:'fixture-triage-private-key'}})).status,200);
  for(const id of ['auditeur','gestionnaire'])assert.equal((await x.call('/api/security/agents/'+id+'/test','POST',{})).status,200);
  assert.equal((await x.call('/api/security/repositories/test','POST',{})).status,200);
  const complete=await x.call('/api/security/complete','POST',{expected_revision:x.app.agents.settings().revision,activate});assert.equal(complete.status,200,complete.raw);
  return x.app.agents.report();
}
test('Security Center requires explicit initial configuration and performs no provider call at startup',async t=>{
  const upstream=fakeUpstreams(),x=await instance(t,{fetchImpl:upstream.fetchImpl});await x.bootstrap();
  const page=await x.call('/metis/securite');assert.equal(page.status,303);assert.equal(page.headers.get('location'),'/metis/securite/configuration');
  assert.equal((await x.call('/metis/securite/configuration')).status,200);
  assert.throws(()=>x.app.scheduler.manual({repository:'Example/project'},'unconfigured'));
  const complete=await x.call('/api/security/complete','POST',{expected_revision:1,activate:false});assert.equal(complete.status,409);
  assert.equal(x.app.agents.ready(),false);assert.equal(x.app.scheduler.listJobs().length,0);assert.equal(upstream.seen.length,0);
});
test('Validated agents create paused routines by default and never return raw credentials',async t=>{
  const upstream=fakeUpstreams(),x=await instance(t,{fetchImpl:upstream.fetchImpl});await prepare(x);
  assert.equal(x.app.agents.ready(),true);assert.equal(x.app.scheduler.routines().length,2);assert.ok(x.app.scheduler.routines().every(r=>!r.enabled));
  const state=await x.call('/api/state');assert.ok(!state.raw.includes('fixture-audit-private-key'));assert.ok(!state.raw.includes('fixture-triage-private-key'));
  const stored=x.app.store.db.prepare('SELECT value FROM secrets').all();assert.ok(!JSON.stringify(stored).includes('fixture-audit-private-key'));
  assert.equal((await x.call('/metis/securite')).status,200);assert.ok((await x.call('/metis/securite')).raw.includes('audit-model'));
});
test('Audit and triage use their assigned models and keys; advisory triage cannot confirm a finding',async t=>{
  const upstream=fakeUpstreams(),seen=[];
  const fetchImpl=async(url,init={})=>{
    const body=init.body?JSON.parse(init.body):null;if(body)seen.push({body,headers:init.headers});
    if(body?.tools?.some(tool=>tool.name==='finish_triage')){
      const input=JSON.parse(body.input.find(item=>item.role==='user').content);
      return response({status:'completed',output:[{type:'function_call',call_id:'triage-result',name:'finish_triage',arguments:JSON.stringify({summary:'Review the recorded candidate and its evidence.',actions:input.findings.slice(0,1).map(f=>({finding_id:f.id,action:'review_evidence',reason:'Candidate evidence requires human review.'}))})}],usage:{total_tokens:180}});
    }
    return upstream.fetchImpl(url,init);
  };
  const x=await instance(t,{fetchImpl});await prepare(x);
  const audit=x.app.scheduler.manual({repository:'Example/project'},'assigned-audit');await x.app.scheduler.tick();
  assert.equal(x.app.scheduler.getJob(audit.id).state,'completed');assert.equal(x.app.scheduler.getJob(audit.id).result.model,'audit-model');
  const triage=x.app.scheduler.manual({repository:'Example/project',kind:'followup'},'assigned-triage');await x.app.scheduler.tick();
  const job=x.app.scheduler.getJob(triage.id);assert.equal(job.state,'completed',job.error);assert.equal(job.result.model,'triage-model');assert.equal(job.usage.calls,1);assert.equal(job.result.changes_applied,false);
  assert.equal(x.app.security.listerFailles('test',{}).failles[0].statut,'nouvelle');
  assert.ok(seen.some(r=>r.body.model==='audit-model'&&r.headers.Authorization==='Bearer fixture-audit-private-key'));
  assert.ok(seen.some(r=>r.body.model==='triage-model'&&r.headers.Authorization==='Bearer fixture-triage-private-key'));
  const page=await x.call('/metis/securite/travaux/'+triage.id);assert.equal(page.status,200);assert.ok(page.raw.includes('triage-model'));assert.ok(page.raw.includes('data-security-job='));assert.ok(page.raw.includes('/security-job.js'));assert.ok(page.raw.includes('Actions proposées'));
  const exported=await x.call('/metis/securite/etat.json');assert.ok(exported.value.depots[0].dernier_audit);assert.equal(exported.value.resume.jamais_audites,0);
});
test('Changing a queued job model invalidates its admission and preserves the original provenance',async t=>{
  const upstream=fakeUpstreams(),x=await instance(t,{fetchImpl:upstream.fetchImpl});await prepare(x);
  const queued=x.app.scheduler.manual({repository:'Example/project'},'before-change');const settings=x.app.agents.settings();settings.profiles[0].provider.model='replacement-model';
  x.app.agents.save({profiles:settings.profiles,expected_revision:settings.revision},'test');
  assert.equal(x.app.agents.ready(),false);assert.equal(x.app.agents.adapter('auditeur').verified(),false);
  await x.app.agents.adapter('auditeur').test(AbortSignal.timeout(5000));x.app.agents.complete(x.app.agents.settings().revision,'test');
  const before=upstream.seen.length;await x.app.scheduler.tick();const job=x.app.scheduler.getJob(queued.id);
  assert.equal(job.state,'failed');assert.equal(upstream.seen.length,before);assert.equal(job.agent.provider.model,'audit-model');assert.equal(job.usage.calls||0,0);
});
test('Profile budgets cap requests and disabling an agent pauses its routines',async t=>{
  const upstream=fakeUpstreams(),x=await instance(t,{fetchImpl:upstream.fetchImpl});await prepare(x,true);
  const settings=x.app.agents.settings();settings.profiles[0].limits.maxCalls=1;settings.profiles[1].enabled=false;
  x.app.agents.save({profiles:settings.profiles,expected_revision:settings.revision},'test');x.app.agents.complete(x.app.agents.settings().revision,'test');
  assert.ok(x.app.scheduler.routines().filter(r=>r.kind==='followup').every(r=>!r.enabled));
  assert.throws(()=>x.app.scheduler.manual({repository:'Example/project',kind:'followup'},'disabled'),{code:'AGENT_DISABLED'});
  const job=x.app.scheduler.manual({repository:'Example/project',limits:{maxCalls:30}},'bounded');assert.equal(x.app.scheduler.getJob(job.id).limits.maxCalls,1);
});
test('A model connection test cannot validate credentials changed while the response is pending',async t=>{
  const upstream=fakeUpstreams();let release,started;
  const entered=new Promise(resolve=>started=resolve);const wait=new Promise(resolve=>release=resolve);
  let hold=false;const fetchImpl=async(url,init)=>{if(hold&&String(url).includes('/responses')){started();await wait;}return upstream.fetchImpl(url,init);};
  const x=await instance(t,{fetchImpl});await prepare(x);hold=true;
  const pending=x.app.agents.adapter('auditeur').test(AbortSignal.timeout(5000));await entered;x.app.store.secret('agent:auditeur','rotated-fixture-key');release();
  await assert.rejects(pending,{code:'REVISION_CONFLICT'});assert.equal(x.app.agents.adapter('auditeur').verified(),false);
});
test('Existing automatic routines are paused once when upgrading to agent onboarding',async t=>{
  const upstream=fakeUpstreams(),x=await instance(t,{fetchImpl:upstream.fetchImpl});await prepare(x,true);
  x.app.store.db.prepare("DELETE FROM settings WHERE key='securityAgents'").run();
  const second=createApp({dataDir:x.app.store.dir,fetchImpl:upstream.fetchImpl,scheduler:false});
  assert.equal(second.agents.ready(),false);assert.ok(second.scheduler.routines().every(r=>!r.enabled));second.store.close();
});
test('A shared credential cannot be sent to an old provider after the general endpoint changes',async t=>{
  const upstream=fakeUpstreams(),x=await instance(t,{fetchImpl:upstream.fetchImpl});await prepare(x);
  x.app.store.secret('provider','shared-fixture-key');const settings=x.app.agents.settings();settings.profiles[0].credential='shared';
  x.app.agents.save({profiles:settings.profiles,expected_revision:settings.revision},'test');await x.app.agents.adapter('auditeur').test(AbortSignal.timeout(5000));
  const config=x.app.store.config();config.provider={kind:'compatible',model:'new-global-model',baseUrl:'https://different.example/v1'};
  x.app.store.set('config',config);x.app.store.secret('provider','new-provider-fixture-key');
  const before=upstream.seen.length;await assert.rejects(x.app.agents.adapter('auditeur').test(AbortSignal.timeout(5000)),{code:'PROVIDER_NOT_CONFIGURED'});
  assert.equal(upstream.seen.length,before);assert.equal(x.app.agents.adapter('auditeur').verified(),false);
});
test('State exports preserve HTML source excerpts as JSON data',async t=>{
  const x=await instance(t,{fetchImpl:fakeUpstreams().fetchImpl});await prepare(x);
  const source='<html><style>.example{color:red}</style><body>Source excerpt</body></html>';
  x.app.security.declarerFaille('test',{depot:'Example/project',faille:{titre:'Synthetic HTML source candidate',gravite:'moyenne',emplacement:'index.html:1',description:source,preuves:[{type:'extrait',contenu:source,ref:'index.html:1'}]}},'test');
  const state=await x.call('/metis/securite/etat.json');assert.equal(state.status,200);assert.equal(typeof state.value,'object');assert.equal(state.value.failles[0].description,source);assert.ok(!state.raw.includes('nonce='));
});
