import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import path from 'node:path';
import vm from 'node:vm';
import {ROOT} from '../pathfinder-local/runtime-lib.mjs';
import {SOURCE, pin} from './owned-update-v3.mjs';
import {BOUNDS, pristineDatabase, collectSourceClosure, classifyQuiescence, classifyV6Quiescence, assertQuiescenceScope, SCHEMA_HELPER, CAPTURE_HELPER, QUIESCENCE_HELPER, V6_QUIESCENCE_HELPER, qualificationModule} from './owned-update-v3-runtime.mjs';
import * as legacyQualifier from './migration-qualification.mjs';
import {selectDeliveryPolicy} from './delivery-policy-selector-v4.mjs';
import {selectDeliveryPolicy as selectV5DeliveryPolicy} from './delivery-policy-selector-v5.mjs';
import {selectDeliveryPolicy as selectV6DeliveryPolicy} from './delivery-policy-selector-v6.mjs';
import {safeLosslessCaptureFailure} from '../pathfinder-cable-workflow/raw-inventory-provider.mjs';

for (const [name, body] of Object.entries({SCHEMA_HELPER, CAPTURE_HELPER, QUIESCENCE_HELPER}))
  test(name + ' generated standalone module parses without runtime execution', () => {
    const checked = spawnSync(process.execPath, ['--check', '--input-type=module'], {input: body, encoding: 'utf8', timeout: 10000, maxBuffer: 1024 * 1024, windowsHide: true});
    assert.ifError(checked.error); assert.equal(checked.status, 0, checked.stderr); assert.equal(checked.signal, null);
  });
test('capture helper emits a bounded safe FAIL for inventory rejection and always joins its pool', async () => {
  for (const error of [Object.assign(Error('private credentials'), {code:'LOSSLESS_INVENTORY_DEADLINE'}), Error('private stack')]) {
    const output=[],process={env:{EXPECTED_DATABASE:'synthetic',OWNER_ID:'synthetic',CAPTURE_NAME:'synthetic'},exitCode:0};let ended=0;
    const body=CAPTURE_HELPER.slice(CAPTURE_HELPER.indexOf('try{\nconst identity='));
    await new vm.Script('(async()=>{const safeFailure='+safeLosslessCaptureFailure.toString()+';'+body+'})()').runInNewContext({
      process,AbortSignal,console:{log:raw=>output.push(JSON.parse(raw))},
      pool:{query:async()=>({rows:[{name:'synthetic',others:'0'}]}),end:async()=>{ended++;}},
      captureLosslessInventory:async()=>{throw error;}
    });
    assert.equal(process.exitCode,1);assert.equal(ended,1);assert.equal(output.length,1);
    assert.deepEqual(output[0],{status:'FAIL',code:error.code??'B9_CAPTURE_FAILED'});
    assert.equal(JSON.stringify(output).includes('private'),false);
  }
});
test('pristine database identity cannot target the ordinary/source database', () => {
  assert.equal(pristineDatabase('93000000-0000-4000-8000-000000000009'), 'wfc_pfb9_pristine_93000000000040008000000000000009');
  for (const id of ['wfc_pathfinder_local', '../postgres', '93000000-0000-4000-8000-000000000009\n', '']) assert.throws(() => pristineDatabase(id));
});
test('frozen operator import closure includes late-install foundation and inventory verifier', async () => {
  const closure = await collectSourceClosure([path.join(ROOT, 'scripts/pathfinder-barriers/owned-update-v3.mjs'),
    path.join(ROOT, 'scripts/pathfinder-barriers/owned-update-v3-runtime.mjs'),
    // Mounted generated-body imports are explicit seeds, as in concrete init.
    path.join(ROOT, 'scripts/pathfinder-barriers/global-sql-v2.mjs')]);
  const names = closure.map(row => path.relative(ROOT, row.path).replaceAll('\\', '/'));
  for (const required of ['scripts/pathfinder-local/runtime-image-install.mjs', 'scripts/pathfinder-copied-recovery/current-inventory-lib.mjs',
    'scripts/pathfinder-barriers/migration-qualification.mjs', 'scripts/pathfinder-barriers/global-sql-v2.mjs',
    'scripts/pathfinder-barriers/delivery-policy-selector-v4.mjs', 'scripts/pathfinder-barriers/migration-conservation-v4.mjs',
    'scripts/pathfinder-barriers/delivery-policy-selector-v5.mjs', 'scripts/pathfinder-barriers/migration-conservation-v5.mjs',
    'scripts/pathfinder-barriers/delivery-policy-selector-v6.mjs', 'scripts/pathfinder-barriers/migration-conservation-v6.mjs']) assert.ok(names.includes(required), required);
  assert.equal(new Set(closure.map(row => row.path)).size, closure.length);
  assert.ok(closure.every(row => row.bytes > 0 && /^[a-f0-9]{64}$/.test(row.sha256)));
  await assert.rejects(collectSourceClosure([path.join(ROOT, '..', 'outside.mjs')]), /B9_SOURCE_IMPORT_BOUNDARY/);
});

async function selectedConfig(version='v4') {
  const operationId = '93000000-0000-4000-8000-000000000009';
  const selector = await pin(path.join(ROOT, 'scripts/pathfinder-barriers/delivery-policy-selector-'+version+'.mjs'));
  const qualifier = await pin(path.join(ROOT, 'scripts/pathfinder-barriers/migration-conservation-'+version+'.mjs'));
  return { operationId, directory: path.join(ROOT, 'pathfinder-engine/.scratch/barrier-delivery-' + operationId), sourceClosure: [selector, qualifier,
      ...(version==='v6'?[await pin(path.join(ROOT,'server/pathfinder/automaticPairSchema.ts'))]:[])],
    qualificationPolicy: { schemaVersion: 'wfc.pf.owned-update-policy-binding.v1',
      selection: { schemaVersion: 'wfc.pf.delivery-policy-selection.v1', profile: version==='v6'?'post-b27-automatic-pair-additive-v6':version==='v5'?'post-b20-terminal-closure-additive-v5':'post-b9-no-ddl-conservation-v4' }, selector, qualifier } };
}
test('default qualification retains the original B9 module and exact current source hash', async () => {
  const selected = await qualificationModule({});
  assert.equal(selected.module, legacyQualifier);
  assert.equal(selected.qualifierSha256, (await pin(path.join(ROOT, 'scripts/pathfinder-barriers/migration-qualification.mjs'))).sha256);
});
test('explicit v4 uses exactly the selected bound qualifier for first and later qualification', async () => {
  const config = await selectedConfig(), first = await qualificationModule(config), later = await qualificationModule(config);
  const selected = selectDeliveryPolicy(config.qualificationPolicy.selection);
  assert.equal(first.module, selected.qualifier); assert.equal(later.module, selected.qualifier);
  assert.equal(first.qualifierSha256, config.qualificationPolicy.qualifier.sha256);
  assert.deepEqual(later, first);
});
test('explicit v5 first/recheck uses its exact source-pinned qualifier without B9/v4 fallback',async()=>{
 const config=await selectedConfig('v5'),first=await qualificationModule(config),later=await qualificationModule(config),selected=selectV5DeliveryPolicy(config.qualificationPolicy.selection);
 assert.equal(first.module,selected.qualifier);assert.deepEqual(later,first);assert.equal(first.qualifierSha256,config.qualificationPolicy.qualifier.sha256);
});
test('v5 changed source hashes or profile exchange refuses before qualification',async()=>{
 for(const key of ['selector','qualifier']){const config=await selectedConfig('v5');config.qualificationPolicy[key]={...config.qualificationPolicy[key],sha256:'f'.repeat(64)};
  config.sourceClosure=[config.qualificationPolicy.selector,config.qualificationPolicy.qualifier];await assert.rejects(qualificationModule(config),/B9_CONSERVATION_POLICY_SOURCE_CHANGED/);}
 const config=await selectedConfig('v5');config.qualificationPolicy.selection.profile='post-b9-no-ddl-conservation-v4';await assert.rejects(qualificationModule(config),/B9_CONSERVATION_POLICY_CLOSURE_REQUIRED/);
});

test('explicit v6 first and repeated qualification select only the exact source-pinned qualifier',async()=>{
 const config=await selectedConfig('v6'),first=await qualificationModule(config),later=await qualificationModule(config),selected=selectV6DeliveryPolicy(config.qualificationPolicy.selection);
 assert.equal(first.module,selected.qualifier);assert.deepEqual(later,first);assert.equal(first.qualifierSha256,config.qualificationPolicy.qualifier.sha256);
});
test('v6 refuses exchanged selectors, qualifier source hashes and altered isolated DDL pins before qualification',async()=>{
 for(const key of ['selector','qualifier']){const config=await selectedConfig('v6'),original=config.qualificationPolicy[key];
  config.qualificationPolicy[key]={...original,sha256:'f'.repeat(64)};config.sourceClosure=config.sourceClosure.map(row=>row.path===original.path?config.qualificationPolicy[key]:row);
  await assert.rejects(qualificationModule(config),/B9_CONSERVATION_POLICY_SOURCE_CHANGED/);
 }
 const exchanged=await selectedConfig('v6');exchanged.qualificationPolicy.selection.profile='post-b20-terminal-closure-additive-v5';
 await assert.rejects(qualificationModule(exchanged),/B9_CONSERVATION_POLICY_CLOSURE_REQUIRED/);
 const schemaChanged=await selectedConfig('v6');schemaChanged.sourceClosure.at(-1).sha256='f'.repeat(64);
 await assert.rejects(qualificationModule(schemaChanged),/V6_AUTOMATIC_PAIR_SCHEMA_SOURCE_CHANGED/);
});
test('v6 source collection explicitly includes the new DDL anchor without executing or importing server modules',async()=>{
 const closure=await collectSourceClosure([path.join(ROOT,'scripts/pathfinder-barriers/owned-update-v3-runtime.mjs'),path.join(ROOT,'server/pathfinder/automaticPairSchema.ts')]);
 const schema=closure.filter(row=>row.path===path.join(ROOT,'server/pathfinder/automaticPairSchema.ts'));
 assert.equal(schema.length,1);assert.deepEqual(schema[0],await pin(schema[0].path));
 assert.equal(closure.some(row=>row.path===path.join(ROOT,'server/db.ts')),false);
});
test('a changed selected source pin is refused without importing a fallback qualifier', async () => {
  for (const key of ['selector', 'qualifier']) {
    const config = await selectedConfig();
    config.qualificationPolicy[key] = { ...config.qualificationPolicy[key], sha256: 'f'.repeat(64) };
    config.sourceClosure = [config.qualificationPolicy.selector, config.qualificationPolicy.qualifier];
    await assert.rejects(qualificationModule(config), /B9_CONSERVATION_POLICY_SOURCE_CHANGED/);
  }
});
test('present empty or unknown mode cannot inherit B9 qualification', async () => {
  for (const binding of [null, undefined, {}]) await assert.rejects(qualificationModule({ qualificationPolicy: binding }), /B9_CONSERVATION_POLICY_INVALID/);
});
test('bounded helpers have finite CPU, PID, memory, command and archive ceilings', () => {
  assert.equal(BOUNDS.helperMemoryBytes, 1024 ** 3); assert.equal(BOUNDS.pidsLimit, 128); assert.equal(BOUNDS.nanoCpus, 2000000000);
  assert.ok(BOUNDS.commandTimeoutMs <= BOUNDS.operationTimeoutMs && BOUNDS.helperTimeoutMs <= BOUNDS.operationTimeoutMs);
  assert.equal(BOUNDS.archiveOwnership, 'preserve-posix');
});
const quietCounts = () => ({jobs:'0',imports:'0',orphanImports:'0',preparations:'0',passivePreparations:'0',impacts:'0',initialFill:'0',recalculation:'0',grants:'0',leases:'0'});
test('cold backup retains a persistent grant without authorizing protected runtime', () => {
  const counts = {...quietCounts(), grants:'1', passivePreparations:'8'};
  const backup = classifyQuiescence(counts, 'cold-backup'), protectedRuntime = classifyQuiescence(counts, 'protected-runtime');
  assert.equal(backup.status, 'PASS'); assert.equal(backup.retained.persistentGrants, '1'); assert.equal(backup.sourceUpgradeAuthorized, false);
  assert.equal(protectedRuntime.status, 'FAIL'); assert.equal(protectedRuntime.retained.persistentGrants, '0');
  assert.equal(protectedRuntime.grantPolicy, 'enabled-current-grants-refused');
});
test('only preclassified expired human preparation rows are retained in either mode', () => {
  for (const mode of ['cold-backup','protected-runtime']) {
    assert.equal(classifyQuiescence({...quietCounts(),passivePreparations:'8'}, mode).status,'PASS');
    assert.equal(classifyQuiescence({...quietCounts(),preparations:'1',passivePreparations:'8'}, mode).status,'FAIL');
  }
});
test('backup retention cannot exempt jobs, leases, imports, dispatch or active recalculation', () => {
  for (const key of ['jobs','imports','orphanImports','preparations','impacts','initialFill','recalculation','leases'])
    for (const mode of ['cold-backup','protected-runtime']) assert.equal(classifyQuiescence({...quietCounts(),[key]:'1'},mode).status,'FAIL',key+':'+mode);
});
test('quiescence scope and bounded response are closed sets', () => {
  for (const mode of [undefined,'backup','runtime','cold-backup\n']) assert.throws(() => classifyQuiescence(quietCounts(),mode));
  for (const counts of [{...quietCounts(),extra:'0'},{...quietCounts(),grants:0},{...quietCounts(),grants:'-1'}, {...quietCounts(),grants:'10000000'}])
    assert.throws(() => classifyQuiescence(counts,'cold-backup'));
});
test('V6 quiescence extends the closed legacy contract and blocks pair dispatch or held lease observations',()=>{
 for(const mode of ['cold-backup','protected-runtime']){
  const empty={...quietCounts(),automaticPair:'0'},pass=classifyV6Quiescence(empty,mode);assert.equal(pass.status,'PASS');assert.equal(pass.schemaVersion,'wfc.pf.conservation-v6.quiescence.v1');
  assert.equal(classifyV6Quiescence({...empty,automaticPair:'1'},mode).status,'FAIL');assert.equal(classifyV6Quiescence({...empty,jobs:'1'},mode).status,'FAIL');
 }
 for(const bad of [quietCounts(),{...quietCounts(),automaticPair:0},{...quietCounts(),automaticPair:'0',extra:'0'},{...quietCounts(),automaticPair:'-1'}])assert.throws(()=>classifyV6Quiescence(bad,'protected-runtime'));
 assert.throws(()=>classifyQuiescence({...quietCounts(),automaticPair:'0'},'protected-runtime'),/B9_QUIESCENCE_RESPONSE/);
});
test('V6 helper parses without execution and observes an absent table without DDL or a legacy helper change',()=>{
 const checked=spawnSync(process.execPath,['--check','--input-type=module'],{input:V6_QUIESCENCE_HELPER,encoding:'utf8',timeout:10000,maxBuffer:1024*1024,windowsHide:true});
 assert.ifError(checked.error);assert.equal(checked.status,0,checked.stderr);assert.equal(checked.signal,null);
 assert.ok(V6_QUIESCENCE_HELPER.includes("to_regclass('public.pf_automatic_pair_dispatch')"));
 assert.ok(V6_QUIESCENCE_HELPER.includes("status IN('pending','running','unknown') OR owner_token IS NOT NULL OR lease_until IS NOT NULL"));
 assert.ok(V6_QUIESCENCE_HELPER.includes("if(pairTable[0].name===null)counts.automaticPair='0'"));
 assert.equal(QUIESCENCE_HELPER.includes('pf_automatic_pair_dispatch'),false);assert.doesNotMatch(V6_QUIESCENCE_HELPER,/CREATE TABLE|ALTER TABLE|INSERT INTO|UPDATE pf_automatic_pair/);
});
test('backup exemption is unavailable to any runtime/source-update gate or target', () => {
  for (const label of ['source-backup','source-backup-cold']) assert.equal(assertQuiescenceScope('cold-backup',label,SOURCE),'cold-backup');
  for (const label of ['target-migration','target-runtime','source-before-update','source-runtime'])
    assert.throws(() => assertQuiescenceScope('cold-backup',label,SOURCE), /B9_QUIESCENCE_SCOPE/);
  for (const changed of [{...SOURCE,port:5192},{...SOURCE,owner:'93000000-0000-4000-8000-000000000010'},{...SOURCE,runtime:SOURCE.runtime+'-copy'}])
    assert.throws(() => assertQuiescenceScope('cold-backup','source-backup',changed), /B9_QUIESCENCE_SCOPE/);
  assert.equal(assertQuiescenceScope('protected-runtime','source-before-update',SOURCE),'protected-runtime');
});
