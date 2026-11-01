"use strict";
const test=require('node:test'),assert=require('node:assert/strict');
const {instance}=require('./helpers.cjs');
test('Branding, menu labels, order, visibility and counts are personalized safely',async t=>{
  const x=await instance(t);assert.equal((await x.call('/api/appearance')).status,401);await x.bootstrap();
  const ui=x.app.appearance.get();ui.brand='Équipe <locale>';ui.workspace='Laboratoire';ui.subtitle='Nos recherches';ui.section='Nos espaces';ui.search='Rechercher ici';ui.showCounts=false;
  ui.navigation.find(n=>n.id==='publications').label='Cahiers';ui.navigation.find(n=>n.id==='experts').visible=false;ui.navigation.find(n=>n.id==='securite').visible=false;
  ui.navigation.reverse();const result=await x.call('/api/appearance','POST',{appearance:ui,expected_revision:1});assert.equal(result.status,200);assert.equal(result.value.appearance.navigation.find(n=>n.id==='securite').visible,true);
  const page=await x.call('/metis');assert.equal(page.status,200);assert.ok(page.raw.includes('Équipe &lt;locale&gt;'));assert.ok(!page.raw.includes('Équipe <locale>'));assert.ok(page.raw.includes('Cahiers'));assert.ok(page.raw.includes('Nos espaces'));assert.ok(!page.raw.includes('href="/metis/experts"'));assert.ok(!page.raw.includes('<i>0</i>'));
  assert.ok(page.raw.indexOf('href="/metis/securite"')<page.raw.indexOf('>Cahiers</span>'));
  assert.equal((await x.call('/metis/apparence')).status,200);
  assert.equal((await x.call('/api/appearance','POST',{appearance:ui,expected_revision:1})).status,409);
  assert.equal((await x.call('/api/appearance','POST',{appearance:{...ui,navigation:[{id:'javascript:invalid',label:'Bad',visible:true}]},expected_revision:2})).status,400);
});
