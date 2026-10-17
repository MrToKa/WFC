import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { fixturePool,actor,emptyProject,call,list,prepareModel,safeFacts,viewerSession,projectPath,seedCables,changeCable,CABLE_DEFS } from './fixture-helpers.mjs';
const pool=fixturePool(),target=process.env.MODEL_REGISTRY_EVIDENCE??`/evidence/information-contracts-${Date.now()}.json`;
const report={schemaVersion:1,startedAt:new Date().toISOString(),status:'RUNNING',cases:[]};
const cables=(id,token,suffix='')=>call(projectPath(id)+'/cables'+suffix,{token});
const snapshot=rows=>rows.map(({id,cableId,tag,routing,fromLocation,toLocation,connectedFrom,connectedTo})=>({id,cableId,tag,routing,fromLocation,toLocation,connectedFrom,connectedTo}));
const step=async(name,work)=>{const startedAt=new Date().toISOString(),facts=await work();report.cases.push({name,status:'PASS',startedAt,finishedAt:new Date().toISOString(),...facts});};
try{
 if(process.argv.includes('--verify-restart')){
  const prior=JSON.parse(await fs.readFile(process.env.MODEL_REGISTRY_MAIN_EVIDENCE,'utf8')),editor=await actor(pool,prior.facts.projectId);
  await step('Actual two-worker restart preserves exact cable information and selected Aalborg',async()=>{
   assert.deepEqual((await list(prior.facts.projectId,editor.token)).selection,prior.facts.selection);const response=await cables(prior.facts.projectId,editor.token);assert.equal(response.status,200);assert.deepEqual(snapshot(response.value.cables),prior.cableSnapshot);
   const session=await viewerSession(prior.facts.projectId,prior.facts.model.id,editor.token);try{assert.equal((await call(session.path+'descriptor',{cookie:session.cookie,worker:'http://api2:4000'})).status,200);}finally{await call(session.path.slice(0,-1),{token:editor.token,method:'DELETE'});}return{cableCount:response.value.cables.length};
  });report.facts=prior.facts;
 }else if(process.argv.includes('--contracts-only')){
  const id=await emptyProject(pool),editor=await actor(pool,id),seeded=await seedCables(pool,id);
  await step('Actual full cable API preserves original nullable Unicode whitespace multiline markup and distinct connection dates',async()=>{
   for(const token of[editor.token,editor.legacyToken]){const response=await cables(id,token,'?limit=1&page=999&search=no-match');assert.equal(response.status,200);const rows=response.value.cables;assert.equal(rows.length,CABLE_DEFS.length);
    for(const def of CABLE_DEFS){const row=rows.find(value=>value.id===seeded[def.key].id);assert.equal(row.fromLocation,def.fromLocation);assert.equal(row.toLocation,def.toLocation);assert.equal(row.routing,def.routing);assert.equal(row.connectedFrom,'2026-01-03');assert.equal(row.connectedTo,'2026-02-04');}
    assert.equal(rows.filter(row=>row.tag==='S9-DUPLICATE').length,2);assert.notEqual(seeded.duplicateA.fromLocation,seeded.duplicateB.fromLocation);assert.equal(rows.find(row=>row.id===seeded.nullRouting.id).fromLocation,null);
   }return{cableCount:CABLE_DEFS.length,nullableAndOriginalValues:true,connectedDatesDistinct:true,legacyJwtWithoutJtiAccepted:true};
  });
  await step('All actual project read roles can read information; expired401 revoked403 and project404 remain terminal',async()=>{
   for(const[role,assigned]of[['basic',true],['technician',true],['engineer',false]]){const reader=await actor(pool,id,{role,assigned});assert.equal((await cables(id,reader.token)).status,200);}
   const reader=await actor(pool,id,{role:'basic'});assert.equal((await cables(id,reader.expiredToken)).status,401);await pool.query('DELETE FROM user_project_access WHERE user_id=$1 AND project_id=$2',[reader.userId,id]);assert.equal((await cables(id,reader.token)).status,403);assert.equal((await cables(randomUUID(),editor.token)).status,404);return{roles:['basic','technician','read-only engineer'],expired:401,revoked:403,missing:404};
  });report.projectId=id;
 }else{
  const fixture=await prepareModel(pool),{projectId,editor,model,cables:seeded}=fixture;
  await step('Pinned actual342-resource Aalborg imports and is explicitly selected in the independent information fixture',async()=>{assert.equal(fixture.selection.activeModelVersionId,model.id);assert.equal(fixture.selection.selectionRevision,1);assert.equal(model.resourceCount,342);return{modelVersionId:model.id,resourceCount:model.resourceCount,cableCount:CABLE_DEFS.length};});
  const session=await viewerSession(projectId,model.id,editor.token);
  try{
   await step('Real protected model and actual information fields are independent positive controls',async()=>{const raw=await call(session.path+'resources/output/0/0.svf',{cookie:session.cookie});assert.equal(raw.status,200);assert.ok(raw.bytes.length>1000);const response=await cables(projectId,editor.token);assert.equal(response.status,200);for(const key of['routeA','routeB','nullRouting','missing']){const row=response.value.cables.find(value=>value.id===seeded[key].id);for(const field of['fromLocation','toLocation','routing'])assert.equal(row[field],seeded[key][field]);}return{rawSvfBytes:raw.bytes.length,originalInformationFields:true};});
   await step('True updates and deletion of unselected UUID preserve original routing, selected model and published resources',async()=>{
    const control={key:'routeB',id:seeded.routeB.id};try{
     for(const action of['from-only','fields','retag']){await changeCable(pool,projectId,{...control,action});const row=(await cables(projectId,editor.token)).value.cables.find(value=>value.id===control.id);assert.equal(row.routing,seeded.routeB.routing);assert.deepEqual((await list(projectId,editor.token)).selection,fixture.selection);}
     await changeCable(pool,projectId,{...control,action:'delete'});assert.equal((await cables(projectId,editor.token)).value.cables.some(value=>value.id===control.id),false);assert.equal((await call(session.path+'descriptor',{cookie:session.cookie})).status,200);
    }finally{await changeCable(pool,projectId,{...control,action:'restore'});}
    report.cableSnapshot=snapshot((await cables(projectId,editor.token)).value.cables);return{updatedAndDeletedCableId:control.id,selectionUnchanged:true,modelHealthy:true};
   });
  }finally{await call(session.path.slice(0,-1),{token:editor.token,method:'DELETE'});}report.facts=safeFacts(fixture);
 }
 report.status='PASS';
}catch(error){report.status='FAIL';report.failure={name:error.name,message:String(error.message).slice(0,1000)};throw error;}
finally{report.finishedAt=new Date().toISOString();await fs.writeFile(target,JSON.stringify(report,null,2)+'\n',{flag:'wx'});await pool.end();}
console.log(JSON.stringify({status:report.status,cases:report.cases.length,evidence:target}));
