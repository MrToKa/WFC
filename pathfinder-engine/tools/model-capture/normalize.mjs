import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readCapture,normalizeCapture,encode,hash } from './normalize-lib.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../../..');
const [receipt,projectId,modelVersionId,inventory]=process.argv.slice(2);
if(!receipt||!projectId||!modelVersionId){console.error('Usage: node normalize.mjs <mesh-capture-receipt.json> <project-id> <model-version-id> [complete-inventory-receipt.json]');process.exitCode=2;}
else {
  const output=path.join(root,'pathfinder-engine/.scratch/pf2-converted/normalized',`${Date.now()}-${crypto.randomUUID()}`);
  try {
    await fs.mkdir(output,{recursive:true});
    const loaded=await readCapture(path.resolve(receipt),inventory?path.resolve(inventory):undefined);
    const result=normalizeCapture(loaded,{projectId,modelVersionId});
    const snapshot=encode(result.snapshot); result.report.snapshotSha256=hash(snapshot);result.report.observedAt=new Date().toISOString();
    await fs.writeFile(path.join(output,'snapshot.json'),snapshot,{flag:'wx'});
    await fs.writeFile(path.join(output,'normalization.json'),encode(result.report),{flag:'wx'});
    console.log(JSON.stringify({status:'PASS',engineeringReadiness:'needs_review',snapshotSha256:result.report.snapshotSha256,output}));
  } catch(error){
    await fs.writeFile(path.join(output,'normalization.json'),encode({schemaVersion:'pathfinder.converted.normalization.v1',status:'FAIL',scope:'capture-normalization-failed',observedAt:new Date().toISOString(),inputReceipt:path.resolve(receipt),inventoryReceipt:inventory?path.resolve(inventory):null,message:error.message}),{flag:'wx'});
    console.error(JSON.stringify({status:'FAIL',message:error.message,output}));process.exitCode=1;
  }
}
