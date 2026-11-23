// node scripts/gvl-stage5-generate.mjs <poc-gvl244 directory> [--baseline-only]
import assert from 'node:assert/strict';
import {createHash,randomUUID} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {mkdir,readFile,rename,writeFile,rm} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {projectId,buildReport} from './gvl-stage5-report.mjs';

export function compactEvidence(row) {
  const docRefs=new Map(),candidateRefs=new Map();
  const addDocument=d=>{
    if(!d.documentId)return;
    const doc={source:d.documentId,page:d.page??null};
    docRefs.set(JSON.stringify(doc),doc);
  };
  for(const d of [...row.documentEvidence??[],...row.ownTagEvidence??[],...(row.documentParents??[]).flatMap(parent=>parent.evidence??[])])addDocument(d);
  function addCandidate(tag,ids){
    if(!tag)return;
    const objects=candidateRefs.get(tag)??new Set();
    for(const id of ids)if(Number.isSafeInteger(id)&&id>0)objects.add(id);
    candidateRefs.set(tag,objects);
  }
  for(const parent of row.documentParents??[])addCandidate(parent.tag,[]);
  for(const parent of row.parentSearch??[])addCandidate(parent.tag,(parent.objectHits??[]).map(hit=>hit.dbId));
  for(const hit of [...row.ownHits??[],...row.questionMarkedHits??[]])
    for(const match of hit.matched??[])addCandidate(match.tag,[hit.dbId]);
  const documents=[...docRefs.values()];
  if(row.method==='user-cabinet')documents.push({source:'cabinet-reference.png',page:null});
  return {locationId:row.locationId,name:row.name,status:row.status,method:row.method,reason:row.reason,
    objectIds:row.objectIds,equipmentTag:row.equipmentTag,documents,conflictingCableLoops:row.conflictingCableLoops??[],
    candidates:[...candidateRefs].map(([tag,ids])=>({tag,objectIds:[...ids]}))};
}

export async function prepareBaseline(dir) {
  const load=async file=>JSON.parse(await readFile(join(dir,file),'utf8'));
  const bytes=await readFile(join(dir,'stage3/results.json'));
  const stage3=JSON.parse(bytes), resultsSha256=createHash('sha256').update(bytes).digest('hex');
  const [before,after,reconcile,pilot]=await Promise.all([
    load('stage4/cache/before-facts.json'),load('stage4/cache/after-facts.json'),load('stage4/cache/final-reconcile.json'),load('stage4/final-report.json')]);
  assert.equal(resultsSha256,pilot.resultsSha256);
  for(const item of [stage3,before,after,pilot])assert.equal(item.projectId,projectId);
  assert.equal(reconcile.project,projectId);
  assert.deepEqual(before.current,stage3.current); assert.deepEqual(after.current,stage3.current);
  const impacts=new Map(reconcile.locations.map(r=>[r.location,r]));
  const saved=new Map(after.locations.map(r=>[r.id,r.binding?.id]));
  const evidence=stage3.rows.map(row=>{
    const compact=compactEvidence(row),impact=impacts.get(row.locationId);
    if (row.status==='ready') {
      assert.ok(impact?.current&&saved.get(row.locationId),'Missing audited stage 4 binding '+row.name);
      compact.impactId=impact.impact;compact.bindingId=saved.get(row.locationId);
    }
    return compact;
  });
  return {schemaVersion:'wfc.gvl244.stage5-baseline.v1',projectId,modelLabel:stage3.modelLabel,current:stage3.current,
    capturedAt:before.capturedAt,resultsSha256,cables:before.cables.map(({id,tag,from,to})=>({id,tag,from,to})),
    locations:before.locations.filter(r=>r.calculationReady).map(r=>({id:r.id,bindingId:r.binding.id})),evidence};
}

async function writeAtomic(path,data) {
  const tmp=path+'.'+randomUUID()+'.tmp';
  try {await writeFile(tmp,JSON.stringify(data)+'\n',{flag:'wx'});await rename(tmp,path);}
  finally {await rm(tmp,{force:true});}
}
async function main(dir,baselineOnly){
  const directory=resolve(dir),out=join(directory,'stage5'),baseline=await prepareBaseline(directory);
  await mkdir(out,{recursive:true});await writeAtomic(join(out,'baseline.json'),baseline);
  if(baselineOnly)return;
  const source=await readFile(new URL('./gvl-stage5-report.mjs',import.meta.url),'utf8');
  const runner=source+`
    import pg from 'pg';
    import * as repository from './server/dist/server/pathfinder/endpointBindingRepository.js';
    const pool=new pg.Pool({connectionString:process.env.DATABASE_URL,max:1,connectionTimeoutMillis:5000});
    try {console.log(JSON.stringify(await captureSnapshot(pool,projectId,repository)));}finally{await pool.end();}
  `;
  const snapshot=JSON.parse(execFileSync('docker',['exec','-i','-w','/app','wfc-test-app-api-1','node','--input-type=module','-'],
    {input:runner,encoding:'utf8',timeout:60000,maxBuffer:32*1024*1024}));
  const report=buildReport(baseline,snapshot);
  await writeAtomic(join(out,'report.json'),report);
  console.log(JSON.stringify({capturedAt:report.capturedAt,scopeStatus:report.scopeStatus,summary:report.summary}));
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  if(!process.argv[2])throw Error('Provide the local poc-gvl244 folder.');
  await main(process.argv[2],process.argv.includes('--baseline-only'));
}
