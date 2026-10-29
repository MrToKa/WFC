import fs from 'node:fs/promises';
import path from 'node:path';
import {parseArgs} from 'node:util';
import {load,ownership,retire,ROOT,contained} from '../pathfinder-local/runtime-lib.mjs';
import {assertCanonicalPath} from '../operations/archives.mjs';
import {targetGuard,retirementGuard,bytesHash,exclusive,fail} from './lib.mjs';
const {values}=parseArgs({strict:true,options:{runtime:{type:'string'},disposition:{type:'string'},'evidence-root':{type:'string'}}});
if(!values.runtime||!values.disposition||!values['evidence-root'])fail('UI_RETIRE_ARGUMENT');
const target=await load(values.runtime);targetGuard(target);const directory=path.resolve(values['evidence-root']);
if(!contained(path.join(ROOT,'pathfinder-engine/.scratch'),directory))fail('UI_RETIRE_EVIDENCE_PATH');await assertCanonicalPath(directory,{directory:true});await assertCanonicalPath(values.disposition);
const marker=JSON.parse(await fs.readFile(path.join(directory,'owner.json'),'utf8'));if(marker.owner!==target.owner||marker.runtime!==target.runtime)fail('UI_RETIRE_OWNER');
const disposition=JSON.parse(await fs.readFile(values.disposition,'utf8')),receipts=[];
for(const file of (await fs.readdir(directory)).filter(file=>/\.receipt\.json$/.test(file)))receipts.push(JSON.parse(await fs.readFile(path.join(directory,file),'utf8')));
const accepted=[];for(const phase of ['A0','A1','A2','A3']){
  const candidates=receipts.filter(receipt=>receipt.phase===phase);if(candidates.length!==1)fail('UI_RETIRE_EXACT_PHASE_EVIDENCE_REQUIRED');const receipt=candidates[0];
  if(receipt.status!=='PASS'||!receipt.durable||receipt.target.owner!==target.owner)fail('UI_RETIRE_FAILED_PHASE');
  for(const record of [receipt.raw,...['fromA0','fromPrevious'].flatMap(key=>receipt[key]?[receipt[key].difference]:[])]){
    await assertCanonicalPath(record.file);if(!contained(directory,path.resolve(record.file)))fail('UI_RETIRE_FOREIGN_EVIDENCE');
    const bytes=await fs.readFile(record.file);if(bytes.length!==record.bytes||bytesHash(bytes)!==record.sha256)fail('UI_RETIRE_EVIDENCE_CHANGED');
  }accepted.push({phase,rawSha256:receipt.raw.sha256});
}
retirementGuard(disposition,{target:{owner:target.owner},status:'PASS',durable:true,phases:accepted.map(receipt=>receipt.phase)});
await ownership(target);const result=await retire(target);
const receipt={schemaVersion:'pathfinder.ui-preservation.retirement.v1',status:'PASS',recordedAt:new Date().toISOString(),target:{owner:target.owner,project:target.project},dispositionSha256:bytesHash(await fs.readFile(values.disposition)),phases:accepted,result};
const file=path.join(ROOT,'docs/pathfinder/evidence/ui-preservation','retirement-'+Date.now()+'.json');await exclusive(file,JSON.stringify(receipt,null,2));console.log(JSON.stringify({status:'PASS',receipt:file}));
