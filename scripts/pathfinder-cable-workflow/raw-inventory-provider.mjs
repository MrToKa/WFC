// Trusted local cold-backup adapter. Large business rows retain their raw SQL
// hash; only the three bounded fencing tables use the historical receipt hash.
import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash, randomUUID} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import * as runtime from '../pathfinder-local/runtime-lib.mjs';
import {assertCanonicalPath, hashFile} from '../operations/archives.mjs';
import {writePrivateJson} from '../operations/docker.mjs';

export function buildRawInventorySummary(manifest, legacyFenceRows, moduleSha256) {
  const fail=()=>{throw Object.assign(Error('RAW_INVENTORY_SUMMARY_INVALID'),{code:'RAW_INVENTORY_SUMMARY_INVALID'});};
  const canonical=value=>value===null||typeof value!=='object'?JSON.stringify(value):Array.isArray(value)
    ?'['+value.map(canonical).join(',')+']':'{'+Object.keys(value).sort().map(key=>JSON.stringify(key)+':'+canonical(value[key])).join(',')+'}';
  const hash=value=>createHash('sha256').update(canonical(value)).digest('hex');
  const sha=/^[a-f0-9]{64}$(?![\s\S])/, fences=['pf_installation_state','viewer_login_bindings','viewer_resource_sessions'];
  if(manifest?.schemaVersion!=='wfc.operations.lossless-inventory.v1'||manifest.status!=='PASS'||manifest.scope!=='public'
    ||manifest.projection!=='postgresql-jsonb-text.v1'||!sha.test(moduleSha256)||!Array.isArray(manifest.tables)||manifest.tables.length>500
    ||!legacyFenceRows||typeof legacyFenceRows!=='object'||Object.keys(legacyFenceRows).some(key=>!fences.includes(key)))fail();
  let previous='',total=0,legacyBytes=0;
  const tables=manifest.tables.map(table=>{
    if(typeof table.table!=='string'||Buffer.byteLength(table.table)>63||!/^[a-z0-9_]+$(?![\s\S])/.test(table.table)||table.table<=previous||!sha.test(table.rowSha256)
      ||typeof table.rows!=='string'||!/^(?:0|[1-9][0-9]{0,6})$(?![\s\S])/.test(table.rows)||BigInt(table.rows)>1000000n)fail();
    previous=table.table;const rows=Number(table.rows);if((total+=rows)>2000000)fail();
    const legacy=fences.includes(table.table);let digest=table.rowSha256;
    if(legacy){const raw=legacyFenceRows[table.table];if(!Array.isArray(raw)||raw.length!==rows)fail();
      const values=raw.map(text=>{if(typeof text!=='string'||(legacyBytes+=Buffer.byteLength(text))>16*1024**2)fail();
        let value;try{value=JSON.parse(text);}catch{fail();}if(value===null||typeof value!=='object'||Array.isArray(value))fail();return canonical(value);});
      digest=hash(values.sort());
    }else if(Object.hasOwn(legacyFenceRows,table.table))fail();
    return {table:table.table,rows,sha256:digest,transientSessions:['viewer_login_bindings','viewer_resource_sessions'].includes(table.table),
      hashBasis:legacy?'legacy-canonical-json-array.v1':'postgresql-jsonb-text-framed.v1'};
  });
  if(!tables.some(t=>t.table==='viewer_login_bindings')||!tables.some(t=>t.table==='viewer_resource_sessions')
    ||Object.keys(legacyFenceRows).some(key=>!tables.some(t=>t.table===key)))fail();
  return {schemaVersion:2,command:'inventory',status:'PASS',algorithm:'wfc.pf.raw-table-legacy-fence.v1',moduleSha256,tables,
    businessSha256:hash(tables.filter(table=>!table.transientSessions)),
    registrySha256:hash(tables.filter(table=>table.table.startsWith('model_')||table.table==='project_model_selections'))};
}

/** Only fixed diagnostic codes may cross a failed helper boundary. */
export function safeLosslessCaptureFailure(value,fallback='B9_CAPTURE_FAILED'){
  const allowed=new Set(['LOSSLESS_OWNER','LOSSLESS_INVENTORY_LIMIT','LOSSLESS_INVENTORY_SCHEMA','LOSSLESS_DESTINATION',
    'LOSSLESS_DESTINATION_CHANGED','LOSSLESS_INVENTORY_ROW','LOSSLESS_INVENTORY_ABORTED','LOSSLESS_INVENTORY_DEADLINE',
    'LOSSLESS_INVENTORY_ACQUIRE_TIMEOUT','LOSSLESS_DATABASE_IDENTITY','LOSSLESS_INVENTORY_TABLES','LOSSLESS_FENCE_SCHEMA',
    'LOSSLESS_INVENTORY_ROW_COUNT','LOSSLESS_INVENTORY_ROW_ORDER']);
  let code,name;try{code=value?.code;name=value?.name;}catch{/* Unreadable diagnostics are not authority. */}
  return{status:'FAIL',code:allowed.has(code)?code:name==='TimeoutError'?'LOSSLESS_INVENTORY_DEADLINE'
    :fallback==='RAW_INVENTORY_CAPTURE_FAILED'?fallback:'B9_CAPTURE_FAILED'};
}
export const RAW_INVENTORY_HELPER = `
import fs from 'node:fs/promises';import path from 'node:path';import {createHash} from 'node:crypto';
import {createReadStream} from 'node:fs';import {createInterface} from 'node:readline';import {createRequire} from 'node:module';
const require=createRequire('/app/node_modules/pg/lib/index.js'),{Pool}=require('/app/node_modules/pg/lib/index.js');
const modulePath='/qualified/losslessInventory.mjs';
if(createHash('sha256').update(await fs.readFile(modulePath)).digest('hex')!==process.env.INVENTORY_SHA)throw Error('RAW_HELPER_HASH');
const {captureLosslessInventory}=await import(modulePath),pool=new Pool({connectionString:process.env.DATABASE_URL,max:1,connectionTimeoutMillis:5000,statement_timeout:15000,query_timeout:20000});
const buildSummary=${buildRawInventorySummary.toString()};
const safeFailure=${safeLosslessCaptureFailure.toString()};
const isolated=async()=>{const r=await pool.query("SELECT count(*)::text count FROM pg_stat_activity WHERE datname=current_database() AND backend_type='client backend' AND pid<>pg_backend_pid()");if(r.rows[0].count!=='0')throw Error('RAW_INVENTORY_EXTERNAL_CLIENT');};
try{await isolated();const directory='/private/'+process.env.CAPTURE_NAME;
const manifest=await captureLosslessInventory(pool,{allowedRoot:'/private',directory,ownerId:process.env.OWNER_ID,signal:AbortSignal.timeout(180000)});
const legacy={};let legacyBytes=0;
for(const table of manifest.tables.filter(t=>['pf_installation_state','viewer_login_bindings','viewer_resource_sessions'].includes(t.table))){
 if(!/^[a-z0-9_.-]+$(?![\\s\\S])/.test(table.file.path))throw Error('RAW_FILE_PATH');legacy[table.table]=[];
 const input=createReadStream(path.join(directory,table.file.path)),lines=createInterface({input,crlfDelay:Infinity});
 try{for await(const line of lines){if((legacyBytes+=Buffer.byteLength(line))>32*1024**2)throw Error('RAW_LEGACY_LIMIT');
 const value=JSON.parse(line);if(typeof value.rowText!=='string')throw Error('RAW_LEGACY_ROW');legacy[table.table].push(value.rowText);}}
 finally{lines.close();input.destroy();}
}
await isolated();const inventory=buildSummary(manifest,legacy,process.env.INVENTORY_SHA);
console.log(JSON.stringify({status:'PASS',inventory,rawManifestSha256:createHash('sha256').update(await fs.readFile(path.join(directory,'manifest.json'))).digest('hex'),rawContentSha256:manifest.contentSha256}));
}catch(error){console.log(JSON.stringify(safeFailure(error,'RAW_INVENTORY_CAPTURE_FAILED')));process.exitCode=1;}finally{await pool.end();}
`;

export function createRawInventoryProvider(config) {
  const source=config.source, UUID=/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$(?![\s\S])/;
  if(!source||source.port!==5191||!UUID.test(source.owner)||!path.isAbsolute(source.runtime)||!path.isAbsolute(config.targetRuntime)
    ||!path.isAbsolute(config.outputRoot)||!path.isAbsolute(config.modulePath)||!/^[a-f0-9]{64}$(?![\s\S])/.test(config.sha256)
    ||!/^sha256:[a-f0-9]{64}$(?![\s\S])/.test(config.apiImage)||config.postUpdateApiImage!==undefined&&!/^sha256:[a-f0-9]{64}$(?![\s\S])/.test(config.postUpdateApiImage))throw Object.assign(Error('RAW_PROVIDER_CONFIG'),{code:'RAW_PROVIDER_CONFIG'});
  return {modulePath:config.modulePath,sha256:config.sha256,capture:async observation=>{
    const fail=code=>{throw Object.assign(Error(code),{code});};
    const postUpdate=['post-update-before-audit','post-update-after-audit'].includes(observation.phase);
    const apiImage=postUpdate?config.postUpdateApiImage:config.apiImage;
    if(!['backup-before-audit','backup-after-audit','restore-before-fence','restore-after-fence','post-update-before-audit','post-update-after-audit'].includes(observation.phase)
      ||!UUID.test(observation.backupId)||observation.moduleSha256!==config.sha256||!apiImage||observation.apiImage!==apiImage)fail('RAW_OBSERVATION');
    const sourceCapture=postUpdate||observation.phase.startsWith('backup-');
    if(sourceCapture?(observation.runtime!==source.runtime||observation.owner!==source.owner||observation.project!==source.project||observation.port!==5191)
      :(observation.runtime!==config.targetRuntime||observation.owner===source.owner||!UUID.test(observation.owner)||observation.port!==5192
        ||observation.project===source.project))fail('RAW_RUNTIME_IDENTITY');
    await assertCanonicalPath(config.modulePath);if((await hashFile(config.modulePath)).sha256!==config.sha256)fail('RAW_MODULE_CHANGED');
    await assertCanonicalPath(config.outputRoot,{directory:true});
    const state=await runtime.load(observation.runtime);
    if(state.owner!==observation.owner||state.project!==observation.project||state.port!==observation.port||state.images.api!==apiImage)fail('RAW_STATE_CHANGED');
    await runtime.configuration(state);const owned=await runtime.ownership(state);
    if(!owned.containers.find(item=>item.role==='postgres')?.running||owned.containers.some(item=>['api','web'].includes(item.role)&&item.running))fail('RAW_NOT_COLD');
    const settings=await runtime.readSettings(state),captureName=observation.phase+'-'+randomUUID();
    const result=await runtime.helper(state,['node','--input-type=module','-e',RAW_INVENTORY_HELPER],{network:state.project+'_backend',
      mounts:[{Type:'bind',Source:config.modulePath,Target:'/qualified/losslessInventory.mjs',ReadOnly:true},
        {Type:'bind',Source:config.outputRoot,Target:'/private',ReadOnly:false}],
      env:['DATABASE_URL=postgresql://pf_local:'+settings.databasePassword+'@postgres:5432/wfc_pathfinder_local',
        'INVENTORY_SHA='+config.sha256,'CAPTURE_NAME='+captureName,'OWNER_ID='+state.owner]});
    if(result.status==='FAIL')fail(safeLosslessCaptureFailure(result,'RAW_INVENTORY_CAPTURE_FAILED').code);
    if(result.status!=='PASS'||result.inventory?.schemaVersion!==2||result.inventory.moduleSha256!==config.sha256)fail('RAW_CAPTURE_FAILED');
    const manifestPath=path.join(config.outputRoot,captureName,'manifest.json');await assertCanonicalPath(manifestPath);
    if((await hashFile(manifestPath)).sha256!==result.rawManifestSha256)fail('RAW_MANIFEST_CHANGED');
    await writePrivateJson(path.join(config.outputRoot,captureName+'.receipt.private.json'),{observation,result,captureDirectory:path.dirname(manifestPath)});
    return result.inventory;
  }};
}

export const RAW_PROVIDER_SOURCE = fileURLToPath(import.meta.url);
