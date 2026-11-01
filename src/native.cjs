"use strict";
// Instance adapters for the original Métis server-rendered interface.
const path = require("node:path"), fs = require("node:fs"), crypto = require("node:crypto");
const express = require("express");
const { esc, equal, fail, text } = require("./util.cjs");
const { validateCategories } = require("./categories.cjs");
const {createSecurityPages}=require('./security-pages.cjs');

function createNative({ store, auth, security, tools, origin, sameOrigin,agents,appearance,scheduler }) {
  const { db } = store, cache = new Map(), started = new Date().toISOString();
  const pages=createSecurityPages({store,agents,scheduler,appearance});
  const securityView={...security,etat:(...args)=>pages.state(security.etat(...args))};
  for(const d of db.prepare("SELECT nom_complet,proprietaire,nom FROM securite_depots WHERE famille='depots'").all())
    db.prepare("UPDATE securite_depots SET famille=? WHERE nom_complet=?").run(security.familleDe(d.proprietaire,d.nom),d.nom_complet);
  // One source of truth: the existing document store, exposed in the native shape.
  db.exec(`
    CREATE VIEW IF NOT EXISTS metis_docs AS SELECT d.rowid AS id, d.slug,
      d.title AS titre, d.summary AS chapo,
      COALESCE((SELECT json_extract(j.value,'$.name') FROM settings s,
        json_each(s.value,'$.categories') j WHERE s.key='config'
        AND json_extract(j.value,'$.id')=d.category_id), d.category_id) AS categorie,
      d.body AS corps, d.author AS auteur,
      CASE d.status WHEN 'published' THEN 'publie' WHEN 'archived' THEN 'archive' ELSE 'brouillon' END AS statut,
      d.version, CASE WHEN d.created='' THEN d.updated ELSE d.created END AS cree_le,
      d.updated AS maj_le, d.tags AS etiquettes FROM documents d;
    CREATE VIEW IF NOT EXISTS metis_versions AS SELECT d.rowid AS doc, v.version,
      v.title AS titre, v.summary AS chapo, v.category_name AS categorie,
      v.body AS corps, v.actor AS auteur, v.at AS le
      FROM document_versions v JOIN documents d ON d.slug=v.slug;
  `);
  const localAccount = id => Number(id) === 1 && auth.initialized()
    ? { id:1, pseudo:db.prepare("SELECT username FROM admin WHERE id=1").get().username, active:1 } : null;
  const account = req => auth.identify(req, { bearer:false }) ? localAccount(1) : null;
  const disabled = { enabled:()=>false, mount:()=>{} };
  const special = {
    "core/db": { db }, "core/logger": { error:()=>{} },
    "modules/players": { getRow:localAccount, isMaster:a=>a?.id===1 },
    "modules/contacts": { compteParPseudo:()=>null },
    "modules/oauth-clients": { resolve:id=>{
      const row=db.prepare("SELECT data FROM oauth_clients WHERE id=?").get(id);
      return row ? { name:JSON.parse(row.data).client_name } : null;
    } },
    "modules/metis-research-journal": { install:()=>{}, bindWriters:()=>{} },
    "modules/metis-securite": securityView,
    "modules/metis-web-pages": disabled,
    "modules/metisarchitecture": { audit:()=>null },
    "web/metis-lab-gateway": { snapshot:async()=>({enabled:false,available:false}) },
    "web/metis-connector-details": { snapshot:()=>connector(), shadow:()=>null },
    "web/metis-usage-live": { stream:(req,res,{authorized})=>{
      res.set({"Content-Type":"text/event-stream","Connection":"keep-alive"});
      res.flushHeaders();
      const send=()=>{
        if(!authorized()) {res.write('event: access-revoked\ndata: {}\n\n');res.end();return;}
        const stats=load('modules/metisusage').stats(1,{days:Number(req.query.days||7)});
        stats.lab={enabled:false,available:false};stats.connector=connector();
        const update={at:new Date().toISOString(),parts:load('web/metis-usage-dashboard').renderStats(stats)};
        res.write('event: stats\ndata: '+JSON.stringify(update)+'\n\n');
      };
      const unsubscribe=load('modules/metisusage').subscribe(send), timer=setInterval(()=>{if(!authorized())res.end();else res.write(': heartbeat\n\n');},15000);
      req.on('close',()=>{clearInterval(timer);unsubscribe();});
      send();
    } },
    instance: { account, appearance:appearance.get,securityPages:pages,securitySetup:agents,timezone:()=>store.config().timezone,
      color:name=>store.config().categories.find(c=>c.name===name)?.color,
      architecture:()=>store.config().categories.find(c=>c.id==='architecture')?.name || '__no_architecture__', mount },
  };
  for (const name of ['center','sources','timeline','observatory','experiments','agents','studio','security','history','neural','workflows','live']) special['web/metis-command-'+name]=disabled;
  special['web/metis-improvement-board']=disabled;
  function load(key) {
    if (Object.hasOwn(special,key)) return special[key];
    if (cache.has(key)) return cache.get(key).exports;
    const file = path.join(__dirname,'native',key+'.cjs');
    if (!fs.existsSync(file)) throw Error('Unknown native dependency: '+key);
    const module = { exports:{} }; cache.set(key,module);
    const localRequire = name => {
      if (!name.startsWith('.')) return require(name);
      return load(path.posix.normalize(path.posix.join(path.posix.dirname(key),name)));
    };
    require(file)(localRequire,module,path.dirname(file));
    return module.exports;
  }
  const M=load('modules/metisdocs'); M.init();
  load('modules/metisexperts').init();
  const usage=load('modules/metisusage'); usage.init();
  const web=express(); web.disable('x-powered-by');
  web.use((req,res,next)=>{
    // Native POST forms need their same-origin Origin header. External navigation
    // still receives no referrer; CSRF tokens and exact origin checks both apply.
    res.set('Referrer-Policy','same-origin');
    M.CATEGORIES.splice(0,M.CATEGORIES.length,...store.config().categories.map(c=>c.name));
    const nonce=crypto.randomBytes(18).toString('base64');
    res.set('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self' 'nonce-"+nonce+"' https://fonts.googleapis.com; style-src-attr 'unsafe-inline'; font-src 'self' https://fonts.gstatic.com; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'; object-src 'none'");
    const send=res.send.bind(res);
    res.send=value=>{
      if(typeof value==='string' && value.includes('<html')) {
        const actor=auth.identify(req,{bearer:false});
        value=value.replaceAll('<style>','<style nonce="'+nonce+'">')
          .replaceAll('__INSTANCE_MCP__',esc(origin()+'/mcp'))
          .replace('action="/metis/securite/lancer">','action="/metis/securite/lancer"><input type="hidden" name="requestKey" value="'+crypto.randomUUID()+'">')
          .replace(/(<form\b[^>]*\bmethod=["']post["'][^>]*>)/gi,'$1<input type="hidden" name="_csrf" value="'+esc(actor?.csrf||'')+'">');
      }
      return send(value);
    };
    next();
  });
  web.use(express.urlencoded({extended:false,limit:'520kb'}));
  web.use((req,res,next)=>{
    if(req.method==='POST') {
      try {const actor=auth.requireAdmin(req);sameOrigin(req);if(!equal(req.body?._csrf||'',actor.csrf))fail('CSRF_DENIED','Jeton de formulaire incorrect.',403);} catch(e){return next(e);}
    }
    next();
  });
  web.get('/icon.svg',(req,res)=>res.type('svg').sendFile(path.join(__dirname,'native/web/public/icon.svg')));
  web.use('/metis',load('web/metis-pages').metisPages());
  web.use((error,req,res,next)=>{
    if(res.headersSent) return next(error);
    res.status(error.status||400).type('html').send(load('web/metis-pages').page('Opération refusée',
      '<div class="vide"><h1>Opération refusée</h1><p>'+esc(error.code?error.message:'Impossible de charger cette page.')+'</p><p><a href="/metis">Revenir aux publications</a></p></div>'));
  });
  function connector() {
    const cfg=store.config();
    return { generated_at:new Date().toISOString(),endpoint:origin()+'/mcp',transport:'Streamable HTTP',
      contract_revision:1,features:Object.entries(cfg.modules).map(([name,enabled])=>({name,enabled})),
      tools:tools.list({role:'admin'}).map(t=>({...t,group:t.name.startsWith('securite_')?'Sécurité':'Métis',read_only:t.annotations.readOnlyHint,input_schema:t.inputSchema,metrics:{samples:0}})),
      coordination:{available:false,agents:[],handoffs:[],works:[],profiles:[]},
      deployment:{commit:null,last_deploy:null,blocked:null,backup:null,supervisor_outdated:false},
      lab_contract:{version:null,tools:[]},observed_since:started,recent_errors:[],selftest:null };
  }
  function mount(router,{garde,envoyer}) {
    const sendSettings=(req,res,title,body)=>{const moi=garde(req,res);if(!moi)return;envoyer(res,moi,title+' — Métis',body(),{actif:'securite',fil:[['Recherche Métis','/metis'],[title,null]]});};
    router.get('/securite/configuration',(req,res)=>sendSettings(req,res,'Agents et modèles',pages.setup));
    router.get('/apparence',(req,res)=>sendSettings(req,res,'Personnaliser l’interface',pages.appearanceForm));
    router.get('/securite',(req,res,next)=>{
      const moi=garde(req,res);if(!moi)return;
      if(!agents.ready())return res.redirect(303,'/metis/securite/configuration');next();
    });
    router.get('/securite/etat.json',(req,res,next)=>{
      const moi=garde(req,res);if(!moi)return;
      if(!agents.ready())return res.status(409).json({setupRequired:true,url:'/metis/securite/configuration'});next();
    });
    router.post('/securite/lancer',(req,res)=>{
      const moi=garde(req,res);if(!moi)return;
      const input={repository:String(req.body.repository||''),kind:String(req.body.kind||'audit')},key='form:'+text(req.body.requestKey,'Clé de lancement',80);
      const result=store.mutation(String(moi.id),key,input,()=>scheduler.manual(input,key));
      res.redirect(303,'/metis/securite/travaux/'+result.id);
    });
    router.get('/securite/travaux/:id',(req,res)=>sendSettings(req,res,'Journal du travail',()=>{
      const job=scheduler.getJob(req.params.id),version=JSON.stringify([job.state,job.usage.calls||0,job.usage.tokens||0,job.events.length]);
      return '<div data-security-job="'+esc(job.id)+'" data-state="'+esc(job.state)+'" data-version="'+esc(version)+'">'+pages.jobDetail(job.id)+'</div><script src="/security-job.js" defer></script>';
    }));
    for(const action of ['cancel','resume'])router.post('/securite/travaux/:id/'+action,(req,res)=>{
      if(!garde(req,res))return;scheduler[action](req.params.id);res.redirect(303,'/metis/securite/travaux/'+req.params.id);
    });
    router.get('/instance',(req,res)=>{
      const moi=garde(req,res);if(!moi)return;
      envoyer(res,moi,'Réglages de l’instance — Métis','<link rel="stylesheet" href="/instance.css"><div id="app"></div><dialog id="dialog"></dialog><div id="notice" role="status"></div><script src="/app.js" defer></script>',{fil:[['Recherche Métis','/metis'],['Votre instance',null]]});
    });
    router.get('/categories',(req,res)=>{
      const moi=garde(req,res);if(!moi)return;
      const counts=new Map(db.prepare('SELECT category_id,COUNT(*) n FROM documents GROUP BY category_id').all().map(c=>[c.category_id,c.n]));
      const cfg=store.config(), message=req.query.enregistre==='1'?'<p class="categorie-message" role="status">Catégories enregistrées.</p>':'';
      const row=(c)=>'<div class="categorie-ligne" data-category-row><input type="hidden" name="id" value="'+esc(c.id)+'"><input type="hidden" name="color" value="'+esc(c.color)+'"><span class="pastille" style="--c:'+c.color+'"></span><label>Nom de la catégorie<input name="name" value="'+esc(c.name)+'" maxlength="80" required></label><span class="categorie-compte">'+(counts.get(c.id)||0)+' document'+((counts.get(c.id)||0)>1?'s':'')+'</span><button type="button" data-remove-category '+(counts.get(c.id)?'disabled title="Cette catégorie contient des documents"':'')+'>Retirer</button></div>';
      const securityRows=cfg.securityCategories.map(c=>'<div class="categorie-ligne"><input type="hidden" name="securityId" value="'+c.id+'"><label>Nom du groupe<input name="securityName" value="'+esc(c.name)+'" maxlength="80" required></label></div>').join('');
      envoyer(res,moi,'Personnaliser les catégories — Métis','<section class="bandeau"><div><p class="sur">Vos publications</p><h1>Personnaliser les catégories</h1><p class="intro">Choisissez les noms qui correspondent à votre organisation. Les documents restent associés à leur catégorie lorsque vous la renommez.</p></div></section>'+message+
        '<form method="post" action="/metis/categories" class="categories-form"><input type="hidden" name="revision" value="'+store.get('configRevision',1)+'"><h2>Catégories des publications</h2><div data-category-list>'+cfg.categories.map(row).join('')+'</div><div class="categorie-actions"><button type="button" data-add-category>Ajouter une catégorie</button></div><p class="categorie-note">Pour retirer une catégorie utilisée, déplacez d’abord ses documents dans une autre catégorie. Au moins une catégorie doit être conservée.</p><h2>Groupes du Security Center</h2>'+securityRows+'<div class="categorie-actions"><button type="submit">Enregistrer les catégories</button></div></form><style>.categories-form{max-width:900px}.categorie-ligne{display:flex;align-items:center;gap:18px;border-bottom:1px solid var(--ligne);padding:18px 0}.categorie-ligne label{display:grid;gap:4px;flex:1;font-size:12px;color:var(--texte2)}.categorie-ligne input:not([type=hidden]){font:inherit;font-size:16px;color:var(--texte);background:var(--carte);border:1px solid var(--ligne);border-radius:6px;padding:9px 12px;width:100%}.categories-form button{font:inherit;font-size:13px;padding:9px 14px;border:1px solid var(--ligne);border-radius:6px;color:var(--texte);background:var(--carte);cursor:pointer}.categories-form button[type=submit]{background:var(--acc);border-color:var(--acc);color:#fff}.categories-form button:disabled{opacity:.4;cursor:default}.categorie-compte,.categorie-note{font-size:13px;color:var(--texte2)}.categorie-actions{display:flex;gap:12px;margin-top:24px}.categorie-message{color:var(--texte);padding:12px;border-left:3px solid var(--acc)}@media(max-width:650px){.categorie-ligne{flex-wrap:wrap;gap:10px}.categorie-ligne label{min-width:70%}}</style><script src="/metis/categories.js" defer></script>',
        {fil:[['Recherche Métis','/metis'],['Catégories',null]]});
    });
    router.get('/categories.js',(req,res)=>res.type('js').sendFile(path.join(__dirname,'../public/categories.js')));
    router.post('/categories',(req,res)=>{
      const moi=garde(req,res);if(!moi)return;
      const array=v=>v===undefined?[]:Array.isArray(v)?v:[v];
      const ids=array(req.body.id), names=array(req.body.name), colors=array(req.body.color);
      const categories=validateCategories(ids.map((id,i)=>({id,name:names[i],color:colors[i]})));
      const securityIds=array(req.body.securityId),securityNames=array(req.body.securityName);
      const securityCategories=store.config().securityCategories.map(c=>({...c,name:securityNames[securityIds.indexOf(c.id)]}));
      store.saveCategories(categories,Number(req.body.revision),moi.pseudo,securityCategories);
      res.redirect(303,'/metis/categories?enregistre=1');
    });
  }
  return { handle:web, docs:M, record:event=>usage.record(event) };
}
module.exports={createNative};
