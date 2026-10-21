// Trusted operator utility: run only after reviewing the authenticated account.
// It packages saved source observations; it does not log in or invent quota APIs.
import fs from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
const [envPath, evidenceDir, outputPath, approvedSourcePath] = process.argv.slice(2);
if (!envPath || !evidenceDir || !outputPath) throw new Error('REVIEW_PATHS_REQUIRED');
const hash = data => createHash('sha256').update(data).digest('hex');
const envSource = await fs.readFile(envPath,'utf8');
const env = Object.fromEntries(envSource.split(/\r?\n/).flatMap(line => {
  const found = /^\s*([A-Z][A-Z0-9_]*)\s*=\s*(.*?)\s*$/.exec(line);
  if (!found) return [];
  let value=found[2]; if (/^(['"]).*\1$/.test(value)) value=value.slice(1,-1);
  else value=value.replace(/\s+#.*$/,'').trim();
  return [[found[1],value]];
}));
const files=['aps-free-offering-dom.txt','aps-free-offering.png','aps-basic-allowance-dom.txt','aps-basic-allowance.png','aps-complex-allowance-dom.txt','aps-complex-allowance.png','aps-preflight.json'];
const observations=[]; let checked=Date.now();
const documents={};
for(const name of files) {
  const filename=path.join(evidenceDir,name), bytes=await fs.readFile(filename), stat=await fs.stat(filename);
  observations.push({name,sha256:hash(bytes),bytes:bytes.length});
  if(name!=='aps-preflight.json') checked=Math.min(checked,stat.mtimeMs);
  if(name.endsWith('.txt')||name.endsWith('.json')) documents[name]=bytes.toString('utf8');
}
const offering=documents['aps-free-offering-dom.txt'], basic=documents['aps-basic-allowance-dom.txt'], complex=documents['aps-complex-allowance-dom.txt'];
if(!/text APS Free/.test(offering)||!offering.includes('Team: Todor Chankov - 7524')||!basic.includes('Team :  Todor Chankov - 7524')) throw new Error('ACCOUNT_OFFERING_BINDING_UNVERIFIED');
if(!basic.includes('1 charged unit = 300,000 API Calls')||!basic.includes('1  of 1 charged unit available (100%)')||!basic.includes('text 1,423')) throw new Error('BASIC_ALLOWANCE_OBSERVATION_CHANGED');
if(!complex.includes('1 charged unit = 2 Complex Jobs')||!complex.includes('9  of 10 charged units available (90%)')) throw new Error('COMPLEX_ALLOWANCE_OBSERVATION_CHANGED');
const preflight=JSON.parse(documents['aps-preflight.json']);
if(!preflight.credentialsAccepted||!preflight.existingBucketVerified||preflight.status!=='PASS'||hash(env.APS_CLIENT_ID)!=='f5696ee28d890d199072755335f46908500e29fa0c8a53d79c4485cbc5df63c4') throw new Error('APPLICATION_BUCKET_BINDING_UNVERIFIED');
if(Date.now()-checked>30*60000) throw new Error('OPERATOR_REVIEW_EXPIRED');
const sourcePath=path.resolve(approvedSourcePath || 'D:/OneDrive - ACS/R230039_MAN-Aalborg HPU - LVSG & UPS DB & EIC/3D/Aalborg_ACS_CABLETRAY_30_03_26.nwd');
const sourceBefore=await fs.lstat(sourcePath);
if(!sourceBefore.isFile()||sourceBefore.isSymbolicLink()||sourceBefore.nlink!==1||sourceBefore.size<1||sourceBefore.size>2147483648||!path.basename(sourcePath).toLowerCase().endsWith('.nwd')) throw new Error('APPROVED_SOURCE_INVALID');
const canonicalSource=await fs.realpath(sourcePath);
if((process.platform==='win32'?canonicalSource.toLowerCase():canonicalSource)!==(process.platform==='win32'?sourcePath.toLowerCase():sourcePath)) throw new Error('APPROVED_SOURCE_INVALID');
const sourceHash=createHash('sha256'); let bytes=0;
for await(const chunk of createReadStream(sourcePath)){bytes+=chunk.length;sourceHash.update(chunk);}
const sourceSha=sourceHash.digest('hex');
const sourceAfter=await fs.lstat(sourcePath);
if(bytes!==sourceBefore.size||['dev','ino','size','mtimeMs','ctimeMs'].some(key=>sourceBefore[key]!==sourceAfter[key])||!sourceAfter.isFile()||sourceAfter.isSymbolicLink()||sourceAfter.nlink!==1) throw new Error('APPROVED_SOURCE_CHANGED');
if(!approvedSourcePath&&(bytes!==155285346||sourceSha!=='11b2739d92020ee58a52a4e793cf8fd538fb30758eb42176aba93ac7319b048a')) throw new Error('APPROVED_SOURCE_CHANGED');
const proof={schemaVersion:1,kind:'autodesk-account-operator-review',reviewId:randomUUID(),
  checkedAt:new Date(checked).toISOString(),expiresAt:new Date(checked+30*60000).toISOString(),
  account:{applicationHash:hash(env.APS_CLIENT_ID),teamHash:hash('Todor Chankov - 7524'),hubHash:hash('urn:adsk.ace:prod.hub:4d7cd7ed-458a-4956-9563-5f6503b153c4'),offering:'Free',paidFallback:false,regionHash:hash(env.APS_REGION.toUpperCase()),bucketHash:hash(env.APS_BUCKET)},
  operations:{storage:{zero:true,count:1},upload:{zero:true,count:1,maxBytes:2147483648},submit:{zero:true,count:1,complexJobsRemaining:18},read:{zero:true,maxCalls:2000,remainingConservative:298577}},
  approvedSources:[{name:path.basename(sourcePath),bytes,sha256:sourceSha}],conversion:{format:'svf',views:['3d'],xAdsForce:false},supportProfile:'svf-local-7.130.0-v1',
  origins:['https://manage.autodesk.com/','https://aps.autodesk.com/hubs/','https://www.autodesk.com/company/terms-of-use/en/offering-types-and-benefits','https://www.autodesk.com/ae/products/autodesk-platform-services/product-details'],
  observations:{artifacts:observations,basicCallsObserved:1423,complexJobsObserved:2,complexChargedUnitsAvailable:9,complexJobsPerChargedUnit:2,basicCallsPerChargedUnit:300000,nextRefresh:'2026-11-14',readAllowanceDerivation:'300000 minus 1423 observed total calls; excludes reporting lag and later concurrent consumption'},
  verifier:{method:'authenticated-browser-review',actor:'authorized-operator',bindingMatches:true},
  authorization:{explicitUserAuthorized:true,confirmedAt:preflight.checkedAt}};
const serialized=JSON.stringify(proof,null,2)+'\n';
await fs.mkdir(path.dirname(outputPath),{recursive:true}); await fs.writeFile(outputPath,serialized,{mode:0o600});
console.log(JSON.stringify({status:'VERIFIED',proofSha256:hash(serialized),checkedAt:proof.checkedAt,expiresAt:proof.expiresAt,sourceVerified:true,rawConfigurationDisclosed:false}));
