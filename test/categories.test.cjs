"use strict";
const test=require("node:test"), assert=require("node:assert/strict");
const {openStore}=require("../src/store.cjs"), {validateCategories}=require("../src/categories.cjs"), {temp,instance}=require("./helpers.cjs");

test("Renaming a category preserves membership, history and colour across restart",()=>{
  const dir=temp();let store=openStore(dir);
  store.saveDocument({slug:"study",title:"Study",body:"Original",expected_version:0},"test");
  const categories=store.config().categories;categories[0].name="Mes études";
  store.saveCategories(categories,1,"test");
  assert.equal(store.db.prepare("SELECT version FROM documents").get().version,1);
  assert.equal(store.db.prepare("SELECT category_name FROM document_versions").get().category_name,"Recherche");
  assert.equal(store.config().categories[0].color,"#d97757");store.close();store=openStore(dir);
  assert.equal(store.config().categories[0].name,"Mes études");
  const result=store.saveDocument({slug:"study",title:"Study",body:"Revised",expected_version:1},"test");
  assert.equal(result.category,"Mes études");assert.equal(result.category_id,"research");store.close();
});
test("Categories reject ambiguous names and prevent loss of used or last categories",()=>{
  const store=openStore(temp());
  assert.throws(()=>validateCategories([]),{code:"INVALID_ARGUMENT"});
  assert.throws(()=>validateCategories([{id:"a",name:"Études"},{id:"b",name:"ÉTUDES"}]),{code:"INVALID_ARGUMENT"});
  store.saveDocument({slug:"study",title:"Study",body:"",expected_version:0},"test");
  const categories=store.config().categories;
  assert.throws(()=>store.saveCategories(categories.slice(1),1,"test"),{code:"CATEGORY_IN_USE"});
  categories[0].name="Science";store.saveCategories(categories,1,"test");
  assert.throws(()=>store.saveCategories(categories,1,"test"),{code:"REVISION_CONFLICT"});
  assert.equal(store.config().categories.length,5);store.close();
});
test("The beta database migrates without replacing documents or configuration",()=>{
  const dir=temp();let store=openStore(dir);
  store.saveDocument({slug:"study",title:"Legacy",body:"Version one",expected_version:0},"test");
  for(const c of ["category_id","summary","tags","author","created"])store.db.exec("ALTER TABLE documents DROP COLUMN "+c);
  for(const c of ["category_id","category_name","summary","tags"])store.db.exec("ALTER TABLE document_versions DROP COLUMN "+c);
  const config=store.config();delete config.categories;delete config.securityCategories;store.set("config",config);store.close();
  store=openStore(dir);assert.equal(store.config().categories.length,5);assert.equal(store.config().securityCategories.length,3);
  const d=store.db.prepare("SELECT * FROM documents WHERE slug='study'").get();assert.equal(d.body,"Version one");assert.equal(d.category_id,"research");store.close();
});
test("Native pages enforce sessions and CSRF; renamed labels propagate to filters and readers",async(t)=>{
  const x=await instance(t);assert.equal((await x.call('/metis')).status,302);await x.bootstrap();
  x.app.store.saveDocument({slug:"study",title:"A study",body:"## Introduction\n\nResearch",status:"published",expected_version:0},"test");
  x.app.store.saveDocument({slug:"plan",title:"A plan",body:"Plan",category_id:"architecture",status:"published",expected_version:0},"test");
  const page=await x.call('/metis/categories');assert.equal(page.status,200);assert.ok(page.raw.includes('name="_csrf" value="'+x.csrf+'"'));
  const cfg=x.app.store.config();cfg.categories[0].name="Études <locales>";cfg.categories[2].name="Plans de mon équipe";cfg.securityCategories[1].name="Mes applications";
  const form=new URLSearchParams({revision:"1",_csrf:x.csrf});
  for(const c of cfg.categories){form.append('id',c.id);form.append('name',c.name);form.append('color',c.color);}
  for(const c of cfg.securityCategories){form.append('securityId',c.id);form.append('securityName',c.name);}
  const post=()=>fetch(x.base+'/metis/categories',{method:'POST',redirect:'manual',headers:{Cookie:x.cookie,Origin:x.base,'Content-Type':'application/x-www-form-urlencoded'},body:form.toString()});
  form.set('_csrf','bad');assert.equal((await post()).status,403);form.set('_csrf',x.csrf);assert.equal((await post()).status,303);
  const home=await x.call('/metis');assert.equal(home.status,200);assert.ok(home.raw.includes('Études &lt;locales&gt;'));assert.ok(!home.raw.includes('Études <locales>'));
  assert.ok(home.raw.includes('categorie=Plans%20de%20mon%20%C3%A9quipe'));
  const filtered=await x.call('/metis?categorie='+encodeURIComponent(cfg.categories[0].name));assert.ok(filtered.raw.includes('Lire la publication'));
  const article=await x.call('/metis/study');assert.equal(article.status,200);assert.ok(article.raw.includes('class="lecture"'));
  const center=await x.call('/metis/securite');assert.equal(center.status,200);assert.ok(center.raw.includes('Mes applications'));assert.ok(center.raw.includes('id="sc-mur-titre"'));assert.ok(center.raw.includes('/metis/securite.js'));
  assert.match(center.headers.get('content-security-policy'),/style-src 'self' 'nonce-/);
  const nativeStyle=/<style nonce="([^"]+)">/.exec(center.raw);assert.ok(nativeStyle);assert.ok(center.headers.get('content-security-policy').includes(nativeStyle[1]));
  for(const route of ['/metis/glossaire','/metis/experts','/metis/graphiques','/metis/connecteur','/metis/instance'])assert.equal((await x.call(route)).status,200,route);
});
test("MCP uses instance category names and filters before pagination",async(t)=>{
  const x=await instance(t);await x.bootstrap();
  const cfg=x.app.store.config();cfg.categories[0].name="Science";x.app.store.saveCategories(cfg.categories,1,"test");
  const actor={id:'test',role:'admin'};
  for(const [slug,categorie] of [['study','Science'],['note','Note']])await x.app.tools.call('publier_document',{slug,titre:slug,corps:'Body',categorie,chapo:'Summary',idempotency_key:slug},actor);
  const result=await x.app.tools.call('lister_documents',{categorie:'Science',limit:1},actor);
  assert.equal(result.structuredContent.total,1);assert.equal(result.structuredContent.documents[0].category,'Science');
  assert.equal(result.structuredContent.documents[0].summary,'Summary');
  assert.equal(Object.hasOwn(result.structuredContent.documents[0],'body'),false);
  const stats=await x.call('/metis/connecteur/stats.json');assert.equal(stats.value.totals.calls,3);
});
