import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadComparison } from './compare-lib.mjs';
import { encode } from './normalize-lib.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../../..');
const [native,converted,pairs,evaluation]=process.argv.slice(2);
if(!native||!converted){console.error('Usage: node compare.mjs <native-capture.json> <converted-mesh-receipt.json> [reviewed-pairs.json] [converted-engine-evaluation.json]');process.exitCode=2;}
else{
  try{
    const result=await loadComparison(native,converted,pairs,evaluation);result.observedAt=new Date().toISOString();
    const directory=path.join(root,'pathfinder-engine/.scratch/pf2-converted/comparisons');await fs.mkdir(directory,{recursive:true});
    const output=path.join(directory,`${Date.now()}-${crypto.randomUUID()}.json`);await fs.writeFile(output,encode(result),{flag:'wx'});
    console.log(JSON.stringify({status:result.status,scope:result.scope,checks:result.checks.length,blockers:result.blockers,output}));
    process.exitCode=result.status==='PASS'?0:result.status==='BLOCKED'?3:1;
  }catch(error){console.error(JSON.stringify({status:'FAIL',message:error.message}));process.exitCode=1;}
}
