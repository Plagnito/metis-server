"use strict";
const {object,text,fail}=require('./util.cjs');
const NAVIGATION=[
  {id:'publications',label:'Publications',icon:'publications'},
  {id:'architecture',label:'Plans d’architecture',icon:'architecture'},
  {id:'glossaire',label:'Glossaire',icon:'glossaire'},
  {id:'experts',label:'Experts',icon:'experts'},
  {id:'graphiques',label:'Graphiques',icon:'graphiques'},
  {id:'connecteur',label:'Activité du connecteur',icon:'architecture'},
  {id:'securite',label:'Security Center',icon:'architecture'},
];
const DEFAULT_APPEARANCE={brand:'Métis',workspace:'Recherche',subtitle:'Publications du système Métis',section:'Explorer',search:'Chercher un document, un sigle…',showCounts:true,navigation:NAVIGATION.map(({id,label})=>({id,label,visible:true}))};
function validateAppearance(value){
  object(value,Object.keys(DEFAULT_APPEARANCE));
  const result={};
  for(const [key,max] of [['brand',40],['workspace',40],['subtitle',120],['section',40],['search',120]])result[key]=text(value[key],key,max,key==='workspace'||key==='subtitle'?0:1);
  if(typeof value.showCounts!=='boolean')fail('INVALID_ARGUMENT','Affichage des compteurs invalide.');
  result.showCounts=value.showCounts;
  if(!Array.isArray(value.navigation)||value.navigation.length!==NAVIGATION.length)fail('INVALID_ARGUMENT','Navigation incomplète.');
  const ids=new Set();
  result.navigation=value.navigation.map(item=>{
    object(item,['id','label','visible']);
    if(!NAVIGATION.some(n=>n.id===item.id)||ids.has(item.id)||typeof item.visible!=='boolean')fail('INVALID_ARGUMENT','Rubrique de navigation invalide.');
    ids.add(item.id);return {id:item.id,label:text(item.label,'Libellé',64),visible:item.id==='securite'?true:item.visible};
  });
  return result;
}
function createAppearance(store){
  const get=()=>store.get('appearance',structuredClone(DEFAULT_APPEARANCE));
  function save(value,revision,actor){
    const next=validateAppearance(value);
    store.transaction(()=>{
      if(store.get('appearanceRevision',1)!==revision)fail('REVISION_CONFLICT','La présentation a changé. Rechargez la page.',409);
      store.set('appearance',next);store.set('appearanceRevision',revision+1);store.log(actor,'appearance.save');
    });
    return get();
  }
  return {get,save,revision:()=>store.get('appearanceRevision',1)};
}
module.exports={createAppearance,validateAppearance,DEFAULT_APPEARANCE,NAVIGATION};
