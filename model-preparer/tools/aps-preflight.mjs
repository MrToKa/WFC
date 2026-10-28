// Explicit operator preflight. Never called by service startup or refresh.
import fs from 'node:fs/promises';
import { createHash } from 'node:crypto';

const [envPath, reportPath, updateFlag] = process.argv.slice(2);
if (!envPath || !reportPath) throw new Error('PREFLIGHT_PATHS_REQUIRED');
const digest = data => createHash('sha256').update(data).digest('hex');
const original = await fs.readFile(envPath);
const source = original.toString('utf8');
const fields = Object.fromEntries(source.split(/\r?\n/).flatMap(line => {
  const m = /^\s*([A-Z][A-Z0-9_]*)\s*=\s*(.*?)\s*$/.exec(line);
  if (!m) return [];
  let value = m[2];
  if (/^(['"]).*\1$/.test(value)) value = value.slice(1, -1);
  else value = value.replace(/\s+#.*$/, '').trim();
  return [[m[1], value]];
}));
const report = {schemaVersion:1,checkedAt:new Date().toISOString(),authorization:'explicit-user-2026-10-16',
  envBeforeSha256:digest(original),requests:[],credentialsAccepted:false,existingBucketVerified:false,
  envBucketUpdated:false,otherConfigurationBytesUnchanged:true,cloudMutations:0,
  zeroCostProof:{status:'BLOCKED',userDeclaration:'Free access with quota suspension',accountOfferingVerified:false,remainingAllowanceVerified:false,
    officialSource:'https://www.autodesk.com/company/terms-of-use/en/offering-types-and-benefits'}};
let token;
async function request(name, path, options={}) {
  const response = await fetch('https://developer.api.autodesk.com' + path, {...options, redirect:'error', signal:AbortSignal.timeout(30000)});
  report.requests.push({operation:name,status:response.status});
  if (!response.ok) throw new Error('APS_' + name.toUpperCase() + '_' + response.status);
  return response.json();
}
try {
  if (!fields.APS_CLIENT_ID || !fields.APS_CLIENT_SECRET || !['US','EMEA'].includes(fields.APS_REGION?.toUpperCase())) throw new Error('APS_CONFIGURATION_INVALID');
  const auth = await request('authentication', '/authentication/v2/token', {method:'POST',headers:{
    authorization:'Basic ' + Buffer.from(fields.APS_CLIENT_ID + ':' + fields.APS_CLIENT_SECRET).toString('base64'),
    'content-type':'application/x-www-form-urlencoded',accept:'application/json'},body:new URLSearchParams({grant_type:'client_credentials',scope:'bucket:read data:read'}).toString()});
  if (typeof auth.access_token !== 'string' || !auth.access_token) throw new Error('APS_TOKEN_INVALID');
  token = auth.access_token; report.credentialsAccepted = true;
  const region = fields.APS_REGION.toUpperCase();
  let path = '/oss/v2/buckets?' + new URLSearchParams({region,limit:'100'});
  const buckets=[];
  for(let page=0;page<3 && path;page++) {
    const result = await request('list-buckets', path, {headers:{authorization:'Bearer '+token,accept:'application/json'}});
    if (!Array.isArray(result.items)) throw new Error('APS_BUCKET_LIST_INVALID');
    buckets.push(...result.items.filter(x=>typeof x.bucketKey==='string'));
    path=null;
    if (result.next) {
      const next=new URL(result.next);
      if (next.origin!=='https://developer.api.autodesk.com'||next.pathname!=='/oss/v2/buckets') throw new Error('APS_PAGINATION_INVALID');
      path=next.pathname+next.search;
      if(page===2) throw new Error('APS_BUCKET_DISCOVERY_LIMIT');
    }
  }
  report.existingBucketCount=buckets.length;
  const expected='aalborg-viewer-'+digest(fields.APS_CLIENT_ID).slice(0,24)+'-'+region.toLowerCase();
  const selected = fields.APS_BUCKET ? buckets.find(x=>x.bucketKey===fields.APS_BUCKET) : buckets.find(x=>x.bucketKey===expected) ?? (buckets.length===1 ? buckets[0] : undefined);
  if (!selected) throw new Error(buckets.length ? 'APS_BUCKET_SELECTION_AMBIGUOUS' : 'APS_NO_EXISTING_BUCKET');
  if (!/^[-_.a-z0-9]{3,128}$/.test(selected.bucketKey)) throw new Error('APS_BUCKET_INVALID');
  const details = await request('bucket-details','/oss/v2/buckets/'+encodeURIComponent(selected.bucketKey)+'/details',{headers:{authorization:'Bearer '+token,accept:'application/json'}});
  if(details.bucketKey!==selected.bucketKey || details.bucketOwner!==fields.APS_CLIENT_ID) throw new Error('APS_BUCKET_OWNER_MISMATCH');
  report.existingBucketVerified=true; report.selectionBasis=selected.bucketKey===expected?'existing-PoC-deterministic-identity':'only-existing-owned-bucket';
  if(updateFlag==='--update-bucket' && !fields.APS_BUCKET) {
    const line=/^(\s*APS_BUCKET\s*=)[^\r\n]*/m;
    if(!line.test(source)) throw new Error('APS_BUCKET_LINE_MISSING');
    const updated=source.replace(line,(_,prefix)=>prefix+selected.bucketKey);
    const unchangedBefore=source.replace(line,'APS_BUCKET=<redacted>');
    const unchangedAfter=updated.replace(line,'APS_BUCKET=<redacted>');
    if(unchangedBefore!==unchangedAfter) throw new Error('ENV_UNEXPECTED_CHANGE');
    if(!original.equals(await fs.readFile(envPath))) throw new Error('ENV_CONCURRENT_CHANGE');
    await fs.writeFile(envPath,Buffer.from(updated));
    report.envBucketUpdated=true;
  }
  report.status='PASS';
} catch(error) {
  report.status='BLOCKED';
  report.error={code:/^[A-Z0-9_-]+$/.test(error?.message ?? '') ? error.message : 'APS_PREFLIGHT_FAILED'};
} finally { token=undefined; }
report.envAfterSha256=digest(await fs.readFile(envPath));
report.secretValuesDisclosed=false;
await fs.writeFile(reportPath,JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify(report));
