import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs/promises';
import os from 'node:os';
import { ROOT } from '../pathfinder-local/runtime-lib.mjs';
import { SOURCE, PHASES, assertSource, assertTarget, assertOperation, assertCandidate, assertTransition, main, executePhase, pin, claimBuildChild, assertConservationPolicy, assertPhasePolicyBinding } from './owned-update-v3.mjs';
const id = '93000000-0000-4000-8000-000000000009', owner = '93000000-0000-4000-8000-000000000010';
const candidate = { api: 'sha256:' + 'a'.repeat(64), web: 'sha256:' + 'b'.repeat(64) };
function config() { const directory = path.join(ROOT, 'pathfinder-engine/.scratch/barrier-delivery-' + id); return {
  schemaVersion: 'wfc.pf.owned-update.v3', operationId: id, source: SOURCE, directory, targetRuntime: path.join(directory, 'restore-5192'),
  backup: path.join(directory, 'backup'), companion: path.join(directory, 'backup-companion.private.json'), operatorSha256: 'a'.repeat(64), sourceClosure: [{ path: 'fixture' }] }; }
function source() { return { format: 'WFC-PF-LOCAL', schemaVersion: 1, root: ROOT, ...SOURCE,
  tags: { api: 'wfc-pathfinder-api:8fffd6b8c896-initial', web: 'wfc-pathfinder-web:8fffd6b8c896-initial' }, envSha256: 'a'.repeat(64) }; }
function target() { return { ...source(), owner, project: 'wfc-pathfinder-local-123456789abc', runtime: config().targetRuntime, port: 5192,
  tags: { api: 'wfc-pathfinder-api:930000000000-initial', web: 'wfc-pathfinder-web:930000000000-initial' } }; }
function passes() { return Object.fromEntries(['init', ...PHASES].map(phase => [phase, { status: 'PASS', result: { candidate } }])); }
test('candidate build precedes every migration/runtime/source gate', () => {
  for (const gate of ['target-migration', 'target-runtime', 'update-source', 'source-runtime']) assert.ok(PHASES.indexOf('candidate-build') < PHASES.indexOf(gate));
  assert.ok(PHASES.indexOf('target-runtime') < PHASES.indexOf('update-source'));
  assert.ok(PHASES.indexOf('source-runtime') < PHASES.indexOf('retire-target'));
});
test('exact source and fresh contained target pass pure ownership guards', () => { assertSource(source()); assertTarget(config(), target()); });
for (const [key, value] of [['owner', owner], ['project', 'wfc-pathfinder-local'], ['runtime', config().targetRuntime], ['port', 5190], ['port', 5180]])
  test('source refuses swapped ' + key + value, () => assert.throws(() => assertSource({ ...source(), [key]: value })));
for (const [key, value] of [['owner', SOURCE.owner], ['project', SOURCE.project], ['runtime', SOURCE.runtime], ['runtime', config().targetRuntime + '0'], ['port', 5191], ['port', 5190]])
  test('target refuses source/default/sibling ' + key + value, () => assert.throws(() => assertTarget(config(), { ...target(), [key]: value })));
for (const key of ['directory', 'backup', 'companion', 'targetRuntime', 'operatorSha256', 'sourceClosure'])
  test('operation refuses changed ' + key, () => assert.throws(() => assertOperation({ ...config(), [key]: SOURCE.runtime }, config().directory)));
test('missing prerequisite and begun/uncertain phase refuse without runtime calls', () => {
  assert.throws(() => assertTransition('update-source', {}, false), /B9_PREREQUISITE_REQUIRED/);
  assert.throws(() => assertTransition('backup', passes(), true), /B9_PHASE_ALREADY_BEGUN/);
});
test('a rebuilt candidate cannot inherit earlier target qualifications', () => {
  const records = passes(); records['candidate-build'].result = { candidate: { ...candidate, api: 'sha256:' + 'c'.repeat(64) } };
  assert.throws(() => assertTransition('update-source', records, false), /B9_QUALIFIED_CANDIDATE_CHANGED/);
});
test('candidate requires complete immutable image IDs', () => {
  assertCandidate(candidate); for (const value of [{ api: 'tag:latest', web: candidate.web }, { ...candidate, extra: true }, { api: candidate.api }]) assert.throws(() => assertCandidate(value));
});
test('implicit/default CLI and unknown flags refuse before runtime adapter creation', async () => {
  let calls = 0; const runtime = { initialize() { calls++; } };
  for (const args of [['backup'], ['backup', '--operation', 'relative'], ['init', '--operation'], ['backup', '--secret', 'x']]) await assert.rejects(main(args, runtime));
  assert.equal(calls, 0);
});

function policyConfig(version='v4') {
  const value = config(), record = filename => ({ path: path.join(ROOT, 'scripts/pathfinder-barriers', filename), bytes: 123, sha256: 'c'.repeat(64) });
  value.qualificationPolicy = { schemaVersion: 'wfc.pf.owned-update-policy-binding.v1',
    selection: { schemaVersion: 'wfc.pf.delivery-policy-selection.v1', profile: version==='v6'?'post-b27-automatic-pair-additive-v6':version==='v5'?'post-b20-terminal-closure-additive-v5':'post-b9-no-ddl-conservation-v4' },
    selector: record('delivery-policy-selector-'+version+'.mjs'), qualifier: record('migration-conservation-'+version+'.mjs') };
  value.sourceClosure = [value.qualificationPolicy.selector, value.qualificationPolicy.qualifier];
  if(version==='v6')value.sourceClosure.push({path:path.join(ROOT,'server/pathfinder/automaticPairSchema.ts'),bytes:123,sha256:'c'.repeat(64)});
  return value;
}
test('old B9 config and receipt remain unchanged when no policy is selected', () => {
  const value = config(); assert.equal(assertConservationPolicy(value), null);
  assertPhasePolicyBinding(value, { status: 'PASS' }); assertOperation(value, value.directory);
  assert.throws(() => assertPhasePolicyBinding(value, { status: 'PASS', qualificationPolicy: policyConfig().qualificationPolicy }), /B9_PHASE_POLICY_BINDING_CHANGED/);
});
test('explicit v4 config binds exact selector and qualifier members of the source closure', () => {
  const value = policyConfig(); assert.equal(assertConservationPolicy(value), value.qualificationPolicy); assertOperation(value, value.directory);
  assertPhasePolicyBinding(value, { status: 'PASS', qualificationPolicy: structuredClone(value.qualificationPolicy) });
});
test('explicit v5 binds its own fixed selector/qualifier and every later phase receipt',()=>{
 const value=policyConfig('v5');assert.equal(assertConservationPolicy(value),value.qualificationPolicy);assertOperation(value,value.directory);
 assertPhasePolicyBinding(value,{status:'PASS',qualificationPolicy:structuredClone(value.qualificationPolicy)});
 for(const wrong of [undefined,policyConfig().qualificationPolicy])assert.throws(()=>assertPhasePolicyBinding(value,{status:'PASS',qualificationPolicy:wrong}),/B9_PHASE_POLICY_BINDING_CHANGED/);
});
test('v5 cannot reuse v4 source pins, change profile after init, or omit its protected closure member',()=>{
 for(const mutate of [value=>{value.qualificationPolicy.selection.profile='post-b9-no-ddl-conservation-v4';},value=>{value.qualificationPolicy.selector=policyConfig().qualificationPolicy.selector;value.sourceClosure=[value.qualificationPolicy.selector,value.qualificationPolicy.qualifier];},value=>{value.sourceClosure.pop();}]){
  const value=policyConfig('v5');mutate(value);assert.throws(()=>assertConservationPolicy(value),/B9_CONSERVATION_POLICY_CLOSURE_REQUIRED/);
 }
});
test('v5 is forwarded only as an explicit init option',async()=>{
 const calls=[],adapter={initialize(...args){calls.push(args);return{status:'SYNTHETIC'};}};
 const args=['init','--operation',config().directory,'--qualified-inventory',path.join(ROOT,'inventory.mjs'),'--inventory-sha','a'.repeat(64),'--conservation-policy','post-b20-terminal-closure-additive-v5'];
 await main(args,adapter);assert.equal(calls.length,1);assert.equal(calls[0][3],'post-b20-terminal-closure-additive-v5');
 await assert.rejects(main(['backup','--operation',config().directory,'--conservation-policy','post-b20-terminal-closure-additive-v5'],adapter),/B9_ARGUMENTS/);assert.equal(calls.length,1);
});

test('explicit v6 binds its own qualifier, isolated DDL anchor and every phase receipt',()=>{
 const value=policyConfig('v6');assert.equal(assertConservationPolicy(value),value.qualificationPolicy);assertOperation(value,value.directory);
 assertPhasePolicyBinding(value,{status:'PASS',qualificationPolicy:structuredClone(value.qualificationPolicy)});
 for(const wrong of [undefined,policyConfig('v5').qualificationPolicy,policyConfig().qualificationPolicy])
  assert.throws(()=>assertPhasePolicyBinding(value,{status:'PASS',qualificationPolicy:wrong}),/B9_PHASE_POLICY_BINDING_CHANGED/);
});
test('v6 cannot reuse older profile pins, omit or duplicate its exact DDL source anchor',()=>{
 for(const mutate of [v=>{v.qualificationPolicy.selection.profile='post-b20-terminal-closure-additive-v5';},v=>{v.qualificationPolicy.selector=policyConfig('v5').qualificationPolicy.selector;v.sourceClosure[0]=v.qualificationPolicy.selector;}]){
  const value=policyConfig('v6');mutate(value);assert.throws(()=>assertConservationPolicy(value),/B9_CONSERVATION_POLICY_CLOSURE_REQUIRED/);
 }
 for(const mutate of [v=>v.sourceClosure.pop(),v=>v.sourceClosure.push(v.sourceClosure.at(-1)),v=>{v.sourceClosure.at(-1).path+='-foreign';},v=>{v.sourceClosure.at(-1).sha256='invalid';}]){
  const value=policyConfig('v6');mutate(value);assert.throws(()=>assertConservationPolicy(value),/V6_AUTOMATIC_PAIR_SCHEMA_CLOSURE_REQUIRED/);
 }
});
test('v6 forwards only as an explicit init choice and cannot be attached to later commands',async()=>{
 const calls=[],adapter={initialize(...args){calls.push(args);return{status:'SYNTHETIC'};}};
 await main(['init','--operation',config().directory,'--qualified-inventory',path.join(ROOT,'inventory.mjs'),'--inventory-sha','a'.repeat(64),
  '--conservation-policy','post-b27-automatic-pair-additive-v6'],adapter);
 assert.equal(calls.length,1);assert.equal(calls[0][3],'post-b27-automatic-pair-additive-v6');
 await assert.rejects(main(['backup','--operation',config().directory,'--conservation-policy','post-b27-automatic-pair-additive-v6'],adapter),/B9_ARGUMENTS/);assert.equal(calls.length,1);
});
test('a present invalid policy never falls back to B9', () => {
  for (const binding of [undefined, null, {}, { ...policyConfig().qualificationPolicy, extra: true },
    { ...policyConfig().qualificationPolicy, selection: { schemaVersion: 'wfc.pf.delivery-policy-selection.v1', profile: 'b9' } }]) {
    const value = config(); value.qualificationPolicy = binding; assert.throws(() => assertConservationPolicy(value), /B9_CONSERVATION_POLICY_INVALID/);
  }
});
test('missing, duplicated, changed or foreign selector pins are refused', () => {
  for (const mutate of [v => { v.sourceClosure.pop(); }, v => { v.sourceClosure.push(v.qualificationPolicy.selector); },
    v => { v.sourceClosure = v.sourceClosure.map((row, i) => i ? row : { ...row, sha256: 'd'.repeat(64) }); },
    v => { v.qualificationPolicy.selector = { ...v.qualificationPolicy.selector, path: SOURCE.runtime + '/foreign.mjs' }; }]) {
    const value = policyConfig(); mutate(value); assert.throws(() => assertConservationPolicy(value), /B9_CONSERVATION_POLICY_CLOSURE_REQUIRED/);
  }
});
test('policy receipts cannot omit or exchange the immutable selected policy', () => {
  const value = policyConfig();
  for (const result of [{ status: 'PASS' }, { status: 'PASS', qualificationPolicy: null },
    { status: 'PASS', qualificationPolicy: { ...value.qualificationPolicy, qualifier: { ...value.qualificationPolicy.qualifier, sha256: 'd'.repeat(64) } } }])
    assert.throws(() => assertPhasePolicyBinding(value, result), /B9_PHASE_POLICY_BINDING_CHANGED/);
});
test('explicit v4 cannot relabel an old dated operation directory', () => {
  const value = policyConfig(); value.directory = value.directory.replace('barrier-delivery-', 'barrier-delivery-20261021-');
  assert.throws(() => assertConservationPolicy(value), /B9_CONSERVATION_POLICY_OPERATION_REQUIRED/);
});
test('CLI preserves the old init arguments and forwards v4 only when explicitly selected', async () => {
  const calls = [], adapter = { initialize(...args) { calls.push(args); return { status: 'SYNTHETIC' }; } };
  const args = ['init', '--operation', config().directory, '--qualified-inventory', path.join(ROOT, 'inventory.mjs'), '--inventory-sha', 'a'.repeat(64)];
  await main(args, adapter); assert.equal(calls[0].length, 3);
  await main([...args, '--conservation-policy', 'post-b9-no-ddl-conservation-v4'], adapter); assert.equal(calls[1].length, 4); assert.equal(calls[1][3], 'post-b9-no-ddl-conservation-v4');
  await assert.rejects(main([...args, '--conservation-policy', 'unknown'], adapter), /B9_CONSERVATION_POLICY_INVALID/);
  await assert.rejects(main(['backup', '--operation', config().directory, '--conservation-policy', 'post-b9-no-ddl-conservation-v4'], adapter), /B9_ARGUMENTS/);
  assert.equal(calls.length, 2);
});
async function withJournal(run) {
  // This injected orchestration fixture has no concrete Docker/SQL adapter.
  const temporaryRoot = await fs.realpath(os.tmpdir());
  const directory = await fs.mkdtemp(path.join(temporaryRoot, 'pf-b9-v3-journal-'));
  const fixture = {...config(), directory, sourceClosure: []};
  try {
    await fs.writeFile(path.join(directory, 'init.pass.private.json'), JSON.stringify({schemaVersion: 'wfc.pf.owned-update-phase.v3',
      operationId: fixture.operationId, phase: 'init', status: 'PASS', prerequisites: [], result: {status: 'PASS', evidence: []}}));
    await run(fixture);
  } finally {
    assert.equal(path.dirname(directory), temporaryRoot); assert.ok(path.basename(directory).startsWith('pf-b9-v3-journal-'));
    await fs.rm(directory, {recursive: true, force: true});
  }
}
test('an unknown adapter outcome leaves immutable begin/failure/lock and cannot retry', async () => withJournal(async fixture => {
  let called = 0; const adapter = {async execute() {called++; throw Error('lost acknowledgement');}};
  await assert.rejects(executePhase(fixture, 'backup', adapter), /lost acknowledgement/);
  const failed = JSON.parse(await fs.readFile(path.join(fixture.directory, 'backup.failed.private.json')));
  assert.equal(failed.uncertain, true); assert.equal(failed.automaticRetry, false);
  await assert.rejects(executePhase(fixture, 'backup', adapter), /B9_FAILED_OPERATION_INSPECT_REQUIRED/); assert.equal(called, 1);
  await fs.access(path.join(fixture.directory, 'phase.lock')); await fs.access(path.join(fixture.directory, 'backup.begin.private.json'));
  await assert.rejects(fs.access(path.join(fixture.directory, 'backup.pass.private.json')));
}));
test('tampered immutable evidence refuses PASS after adapter and retains uncertainty', async () => withJournal(async fixture => {
  const filename = path.join(fixture.directory, 'receipt.private.json'); await fs.writeFile(filename, 'original'); const evidence = await pin(filename);
  await assert.rejects(executePhase(fixture, 'backup', {async execute() {await fs.writeFile(filename, 'changed!'); return {status: 'PASS', evidence: [evidence]};}}), /B9_PIN_CHANGED/);
  await assert.rejects(fs.access(path.join(fixture.directory, 'backup.pass.private.json')));
  await fs.access(path.join(fixture.directory, 'phase.lock'));
}));
test('successful adapter journals prerequisite pins before permitting its next phase', async () => withJournal(async fixture => {
  const result = await executePhase(fixture, 'backup', {async execute(phase, cfg, previous) {
    assert.equal(phase, 'backup'); assert.equal(cfg, fixture); assert.equal(previous.init.status, 'PASS');
    await fs.access(path.join(fixture.directory, 'backup.begin.private.json')); return {status: 'PASS', evidence: [], backupId: id};
  }});
  assert.equal(result.next, 'restore-quarantine'); await assert.rejects(fs.access(path.join(fixture.directory, 'phase.lock')));
  const before = await pin(path.join(fixture.directory, 'init.pass.private.json'));
  const receipt = JSON.parse(await fs.readFile(path.join(fixture.directory, 'backup.pass.private.json'))); assert.deepEqual(receipt.prerequisites, [before]);
  await fs.appendFile(before.path, ' '); let called = false;
  await assert.rejects(executePhase(fixture, 'restore-quarantine', {async execute() {called = true;}}), /B9_PIN_CHANGED/); assert.equal(called, false);
}));
test('lost child acknowledgement cannot authorize another candidate build', async () => withJournal(async fixture => {
  for (const phase of ['backup', 'restore-quarantine']) await fs.writeFile(path.join(fixture.directory, phase + '.pass.private.json'), JSON.stringify({
    schemaVersion: 'wfc.pf.owned-update-phase.v3', operationId: fixture.operationId, phase, status: 'PASS', prerequisites: [], result: {status: 'PASS', evidence: []}}));
  const prerequisites = await Promise.all(['init', 'backup', 'restore-quarantine'].map(name => pin(path.join(fixture.directory, name + '.pass.private.json'))));
  const lock = {schemaVersion: 'wfc.pf.owned-update-lock.v3', operationId: fixture.operationId, phase: 'candidate-build', nonce: owner, pid: process.pid};
  await fs.writeFile(path.join(fixture.directory, 'phase.lock'), JSON.stringify(lock));
  await fs.writeFile(path.join(fixture.directory, 'candidate-build.begin.private.json'), JSON.stringify({...lock, status: 'BEGIN', prerequisites, at: new Date().toISOString()}));
  await claimBuildChild(fixture); await assert.rejects(claimBuildChild(fixture), error => error.code === 'EEXIST');
  await assert.rejects(fs.access(path.join(fixture.directory, 'candidate-build.result.private.json')));
  const child = JSON.parse(await fs.readFile(path.join(fixture.directory, 'candidate-build.child.begin.private.json')));
  assert.equal(child.status, 'BEGIN'); assert.deepEqual(child.parentLock, lock);
  await fs.writeFile(path.join(fixture.directory, 'candidate-build.failed.private.json'), '{}');
  await assert.rejects(claimBuildChild(fixture), /B9_FAILED_OPERATION_INSPECT_REQUIRED/);
}));
