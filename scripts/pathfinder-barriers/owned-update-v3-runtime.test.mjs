import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import path from 'node:path';
import {ROOT} from '../pathfinder-local/runtime-lib.mjs';
import {SOURCE} from './owned-update-v3.mjs';
import {BOUNDS, pristineDatabase, collectSourceClosure, classifyQuiescence, assertQuiescenceScope, SCHEMA_HELPER, CAPTURE_HELPER, QUIESCENCE_HELPER} from './owned-update-v3-runtime.mjs';

for (const [name, body] of Object.entries({SCHEMA_HELPER, CAPTURE_HELPER, QUIESCENCE_HELPER}))
  test(name + ' generated standalone module parses without runtime execution', () => {
    const checked = spawnSync(process.execPath, ['--check', '--input-type=module'], {input: body, encoding: 'utf8', timeout: 10000, maxBuffer: 1024 * 1024, windowsHide: true});
    assert.ifError(checked.error); assert.equal(checked.status, 0, checked.stderr); assert.equal(checked.signal, null);
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
    'scripts/pathfinder-barriers/migration-qualification.mjs', 'scripts/pathfinder-barriers/global-sql-v2.mjs']) assert.ok(names.includes(required), required);
  assert.equal(new Set(closure.map(row => row.path)).size, closure.length);
  assert.ok(closure.every(row => row.bytes > 0 && /^[a-f0-9]{64}$/.test(row.sha256)));
  await assert.rejects(collectSourceClosure([path.join(ROOT, '..', 'outside.mjs')]), /B9_SOURCE_IMPORT_BOUNDARY/);
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
test('backup exemption is unavailable to any runtime/source-update gate or target', () => {
  for (const label of ['source-backup','source-backup-cold']) assert.equal(assertQuiescenceScope('cold-backup',label,SOURCE),'cold-backup');
  for (const label of ['target-migration','target-runtime','source-before-update','source-runtime'])
    assert.throws(() => assertQuiescenceScope('cold-backup',label,SOURCE), /B9_QUIESCENCE_SCOPE/);
  for (const changed of [{...SOURCE,port:5192},{...SOURCE,owner:'93000000-0000-4000-8000-000000000010'},{...SOURCE,runtime:SOURCE.runtime+'-copy'}])
    assert.throws(() => assertQuiescenceScope('cold-backup','source-backup',changed), /B9_QUIESCENCE_SCOPE/);
  assert.equal(assertQuiescenceScope('protected-runtime','source-before-update',SOURCE),'protected-runtime');
});
