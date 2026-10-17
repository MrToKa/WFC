import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { fixturePool, actor, emptyProject, call, list, select, prepareModel, safeFacts, viewerSession, projectPath, seedCables, changeCable, changeTray, CABLE_DEFS, ROUTES } from './fixture-helpers.mjs';
const pool=fixturePool(), target=process.env.MODEL_REGISTRY_EVIDENCE??`/evidence/cable-contracts-${Date.now()}.json`;
const report={schemaVersion:1,startedAt:new Date().toISOString(),status:'RUNNING',cases:[]};
const cables=(id,token,suffix='')=>call(projectPath(id)+'/cables'+suffix,{token});
const step=async(name,work)=>{const startedAt=new Date().toISOString(), facts=await work();report.cases.push({name,status:'PASS',startedAt,finishedAt:new Date().toISOString(),...facts});};
try {
 if(process.argv.includes('--verify-restart')){
  const prior=JSON.parse(await fs.readFile(process.env.MODEL_REGISTRY_MAIN_EVIDENCE,'utf8')), editor=await actor(pool,prior.facts.projectId);
  await step('Two-worker restart preserves full cable identities and selected Aalborg',async()=>{
   assert.deepEqual((await list(prior.facts.projectId,editor.token)).selection,prior.facts.selection);
   const r=await cables(prior.facts.projectId,editor.token); assert.equal(r.status,200);
   assert.deepEqual(r.value.cables.map(({id,cableId,tag,routing})=>({id,cableId,tag,routing})),prior.cableSnapshot);
   const s=await viewerSession(prior.facts.projectId,prior.facts.model.id,editor.token);
   try{assert.equal((await call(s.path+'descriptor',{cookie:s.cookie,worker:'http://api2:4000'})).status,200);}finally{await call(s.path.slice(0,-1),{token:editor.token,method:'DELETE'});}
   return {cableCount:r.value.cables.length};
  }); report.facts=prior.facts;
 }else if(process.argv.includes('--contracts-only')){
  const id=await emptyProject(pool),editor=await actor(pool,id),seeded=await seedCables(pool,id);
  await step('Full PublicCable GET ignores table paging/search and preserves nullable originals and duplicate tags',async()=>{
   for(const token of [editor.token,editor.legacyToken]){
    const r=await cables(id,token,'?limit=1&page=999&search=no-match');assert.equal(r.status,200);const rows=r.value.cables;
    assert.equal(rows.length,CABLE_DEFS.length);assert.equal(new Set(rows.map(v=>v.id)).size,rows.length);assert.ok(rows.every(v=>v.projectId===id&&Number.isInteger(v.cableId)));
    assert.deepEqual(Object.keys(rows[0]).sort(),['id','projectId','cableId','revision','mto','tag','cableTypeId','typeName','purpose','diameterMm','weightKgPerM','fromLocation','toLocation','routing','delivery','designLength','installLength','pullDate','connectedFrom','connectedTo','tested','createdAt','updatedAt'].sort());
    for(const def of CABLE_DEFS){const actual=rows.find(v=>v.id===seeded[def.key].id);assert.equal(actual.tag,def.tag);assert.equal(actual.routing,def.routing);}
    assert.equal(rows.filter(v=>v.tag==='S8-DUPLICATE').length,2);assert.equal(rows.filter(v=>!v.tag?.trim()).length,3);assert.ok(rows.findIndex(v=>v.id===seeded.outsideFirstPage.id)>10);
   }return{cableCount:CABLE_DEFS.length,omitted:3,pagingSearchIgnored:true,legacyJwtWithoutJtiAccepted:true};
  });
  await step('All read roles use actual cable API; expired401, revoked403, missing404 stay distinct',async()=>{
   for(const [role,assigned]of[['basic',true],['technician',true],['engineer',false]]){const reader=await actor(pool,id,{role,assigned});assert.equal((await cables(id,reader.token)).status,200);}
   const reader=await actor(pool,id,{role:'basic'});assert.equal((await cables(id,reader.expiredToken)).status,401);
   await pool.query('DELETE FROM user_project_access WHERE user_id=$1 AND project_id=$2',[reader.userId,id]);assert.equal((await cables(id,reader.token)).status,403);assert.equal((await cables(randomUUID(),editor.token)).status,404);
   return{roles:['basic','technician','read-only engineer'],expired:401,revoked:403,missing:404};
  });report.projectId=id;
 }else{
  const fixture=await prepareModel(pool),{projectId,editor,model,cables:seeded}=fixture;let session;
  await step('Actual pinned342-resource import and explicit selection coexist with independent87-cable collection',async()=>{
   assert.equal(fixture.selection.activeModelVersionId,model.id);assert.equal(fixture.selection.selectionRevision,1);const r=await cables(projectId,editor.token);assert.equal(r.status,200);assert.equal(r.value.cables.length,CABLE_DEFS.length);return{resourceCount:model.resourceCount,cableCount:r.value.cables.length};
  });
  await step('Protected SVF and original nullable Cable.routing remain independent of cable type defaults and tray data',async()=>{
   session=await viewerSession(projectId,model.id,editor.token);const resource=await call(session.path+'resources/output/0/0.svf',{cookie:session.cookie});assert.equal(resource.status,200);assert.ok(resource.bytes.length>1000);
   const row=(await cables(projectId,editor.token)).value.cables.find(v=>v.id===seeded.nullRouting.id);assert.equal(row.routing,null);
   assert.equal((await pool.query('SELECT routing FROM cable_types WHERE id=$1',[row.cableTypeId])).rows[0].routing,ROUTES[1]);
   const trays=await call(projectPath(projectId)+'/trays',{token:editor.token});assert.equal(trays.status,200);assert.equal(trays.value.trays.length,fixture.trayCount);return{rawSvfBytes:resource.bytes.length,nullRoutingPreserved:true};
  });
  await step('True cable reroute/retag preserve exact UUID and do not change model selection',async()=>{
   try{for(const action of['reroute','retag'])await changeCable(pool,projectId,{key:'routeA',id:seeded.routeA.id,action});const row=(await cables(projectId,editor.token)).value.cables.find(v=>v.id===seeded.routeA.id);assert.equal(row.routing,ROUTES[1]);assert.equal(row.tag,'S8-RENAMED-ORIGINAL');assert.deepEqual((await list(projectId,editor.token)).selection,fixture.selection);return{sameUuid:row.id};}
   finally{await changeCable(pool,projectId,{key:'routeA',id:seeded.routeA.id,action:'restore'});}
  });
  await step('True cable deletion and blank tag remain distinct, without deleting model objects',async()=>{
   try{await changeCable(pool,projectId,{key:'routeA',id:seeded.routeA.id,action:'delete'});assert.equal((await cables(projectId,editor.token)).value.cables.some(v=>v.id===seeded.routeA.id),false);await changeCable(pool,projectId,{key:'routeA',id:seeded.routeA.id,action:'restore'});await changeCable(pool,projectId,{key:'routeA',id:seeded.routeA.id,action:'blank-tag'});assert.equal((await cables(projectId,editor.token)).value.cables.find(v=>v.id===seeded.routeA.id).tag,'   ');assert.equal((await call(session.path+'descriptor',{cookie:session.cookie})).status,200);}
   finally{await changeCable(pool,projectId,{key:'routeA',id:seeded.routeA.id,action:'restore'});}
  });
  await step('True DB tray removal changes only project half of unchanged cable/model route',async()=>{
   await changeTray(pool,projectId,'remove-model-tray');try{const r=await call(projectPath(projectId)+'/trays',{token:editor.token});assert.equal(r.value.trays.some(v=>v.name==='DFC003'),false);assert.equal((await cables(projectId,editor.token)).value.cables.find(v=>v.id===seeded.routeB.id).routing,ROUTES[1]);assert.equal((await call(session.path+'descriptor',{cookie:session.cookie})).status,200);}finally{await changeTray(pool,projectId,'restore-model-tray');}
  });
  await step('Null/same-model revision fences old session without cable mutation; snapshot ready for real restart',async()=>{
   let revision=fixture.selection.selectionRevision;for(const value of[null,model.id])assert.equal((await select(projectId,editor.token,value,revision++,'http://api2:4000')).status,200);
   assert.equal((await call(session.path+'descriptor',{cookie:session.cookie})).status,409);await call(session.path.slice(0,-1),{token:editor.token,method:'DELETE'});
   fixture.selection=(await list(projectId,editor.token)).selection;report.cableSnapshot=(await cables(projectId,editor.token)).value.cables.map(({id,cableId,tag,routing})=>({id,cableId,tag,routing}));return{selectionRevision:fixture.selection.selectionRevision,cableCount:report.cableSnapshot.length};
  });report.facts=safeFacts(fixture);
 }
 report.status='PASS';
}catch(error){report.status='FAIL';report.failure={name:error.name,message:String(error.message).slice(0,1000)};throw error;}
finally{report.finishedAt=new Date().toISOString();await fs.writeFile(target,JSON.stringify(report,null,2)+'\n',{flag:'wx'});await pool.end();}
console.log(JSON.stringify({status:report.status,cases:report.cases.length,evidence:target}));
