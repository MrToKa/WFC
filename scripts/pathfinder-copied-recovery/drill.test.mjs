import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const run = promisify(execFile), sha = b => createHash('sha256').update(b).digest('hex');
const sourceOwner = '8fffd6b8-c896-4bb0-ad92-b6c82f5a7d46';
const group = randomUUID(), scratch = path.join(ROOT, 'pathfinder-engine/.scratch');
const controls = path.join(scratch, 'recovery-drill-controls-' + group);
const fixtures = path.join(ROOT, 'docs/pathfinder/evidence/copied-recovery', 'control-fixtures-' + group);
await fs.mkdir(controls); await fs.mkdir(fixtures);
const sentinel = path.join(controls, 'external-attempts.private.txt'), preload = path.join(controls, 'guard.mjs');
await fs.writeFile(sentinel, '', { flag: 'wx' });
// This test-only preload refuses every spawn/core call and Docker exec before
// dispatch. Local Windows ACL initialization remains the real CLI operation.
await fs.writeFile(preload, `import cp from 'node:child_process';import fs from 'node:fs';import path from 'node:path';import{syncBuiltinESMExports}from'node:module';const original=cp.execFile,spawn=cp.spawn;const denied=(kind,cmd)=>{fs.appendFileSync(${JSON.stringify(sentinel)},kind+':'+String(cmd)+'\\n');throw Object.assign(Error('TEST_EXTERNAL_FORBIDDEN'),{code:'TEST_EXTERNAL_FORBIDDEN'});};cp.spawn=function(cmd,...args){if(path.basename(String(cmd)).toLowerCase()!=='icacls')return denied('spawn',cmd);return spawn.call(this,cmd,...args);};cp.execFile=function(cmd,...args){if(path.basename(String(cmd)).toLowerCase()!=='icacls')return denied('execFile',cmd);return original.call(this,cmd,...args);};syncBuiltinESMExports();`, { flag: 'wx' });
const results = [], cliReceipts = [];
async function cli(work, action, extra = []) {
  let result, exitCode = 0;
  try { result = await run(process.execPath, ['scripts/pathfinder-copied-recovery/drill.mjs', action, '--work', path.relative(ROOT, work), ...extra], { cwd: ROOT, env: { ...process.env, NODE_OPTIONS: '--import=' + pathToFileURL(preload).href }, timeout: 15000, maxBuffer: 1024 * 1024, windowsHide: true }); }
  catch (error) { assert.equal(typeof error.code, 'number', 'CLI must close normally within bounded deadline'); exitCode = error.code; result = error; }
  const value = JSON.parse(result.stdout.trim()); const receipt = await fs.readFile(path.join(ROOT, value.file));
  cliReceipts.push({ path: value.file, bytes: receipt.length, sha256: sha(receipt), action, exitCode, status: value.status, error: value.error ?? null });
  assert.equal(await fs.readFile(sentinel, 'utf8'), '', 'no Docker, process core, SQL, HTTP or runtime operation may be dispatched');
  return { value, exitCode, receipt: JSON.parse(receipt) };
}
async function setup(change) {
  const work = path.join(scratch, 'copied-recovery-' + randomUUID()); const init = await cli(work, 'init'); assert.equal(init.exitCode, 0); assert.equal(init.value.status, 'PASS');
  const recordPath = path.join(work, 'drill.private.json'), record = JSON.parse(await fs.readFile(recordPath));
  if (change) { change(record); await fs.writeFile(recordPath, JSON.stringify(record, null, 2) + '\n'); }
  return { work, record, recordPath };
}
async function proof(context, value, { child, role, wrongHash = false } = {}) {
  const receipts = [];
  if (child) { const file = path.join(fixtures, randomUUID() + '.json'); const bytes = Buffer.from(JSON.stringify(child)); await fs.writeFile(file, bytes, { flag: 'wx' }); receipts.push({ role, path: path.relative(ROOT, file).replaceAll('\\', '/'), sha256: sha(bytes) }); }
  const file = path.join(fixtures, randomUUID() + '.json'), bytes = Buffer.from(JSON.stringify({ schemaVersion: 'pathfinder.copied-recovery.phase-proof.v1', status: 'PASS', drillId: context.record.id, sourceOwner, phase: 'source-ready', receipts, ...value }));
  await fs.writeFile(file, bytes, { flag: 'wx' }); return ['--proof', file, '--proof-sha256', wrongHash ? '0'.repeat(64) : sha(bytes)];
}
async function refusal(context, action, expected, args = []) {
  const before = await fs.readFile(context.recordPath), r = await cli(context.work, action, args);
  assert.equal(r.exitCode, 1); assert.equal(r.value.status, 'FAIL'); assert.equal(r.value.error, expected); assert.equal(sha(await fs.readFile(context.recordPath)), sha(before), 'failure must not transition state or dispatch core');
  results.push({ action, expected, actual: r.value.error, status: 'PASS', work: path.relative(ROOT, context.work).replaceAll('\\', '/') });
}
test('real CLI init and info create only new owned plan and preserve its source binding', async () => {
  const c = await setup(), before = await fs.readFile(c.recordPath), r = await cli(c.work, 'info');
  assert.equal(r.exitCode, 0); assert.equal(r.value.phase, 'planned'); assert.equal(r.receipt.source.owner, sourceOwner); assert.equal(r.receipt.source.port, 5191); assert.equal(r.receipt.target.port, 5192); assert.equal(r.receipt.target.verified, false); assert.equal(sha(await fs.readFile(c.recordPath)), sha(before));
  results.push({ action: 'init/info', status: 'PASS', work: path.relative(ROOT, c.work).replaceAll('\\', '/') });
});
test('begun backup cannot repeat or reach core', async () => { const c = await setup(r => { r.phase = 'backup_started'; }); await refusal(c, 'backup', 'DRILL_BACKUP_ALREADY_BEGUN'); });
test('restore cannot begin before a completed qualified backup', async () => { const c = await setup(); await refusal(c, 'restore', 'DRILL_RESTORE_ALREADY_BEGUN'); });
test('qualified-looking record cannot retire the real source path', async () => { const c = await setup(r => { r.phase = 'qualified'; r.target = { ...r.source, verified: true }; }); await refusal(c, 'retire-target', 'DRILL_PRIVATE_RECORD'); });
test('wrong proof SHA refuses before binding source or backup mutation', async () => { const c = await setup(); await refusal(c, 'backup', 'DRILL_PROOF_HASH', await proof(c, {}, { wrongHash: true })); });
test('proof from another drill cannot authorize this plan', async () => { const c = await setup(); await refusal(c, 'backup', 'DRILL_PROOF_AUTHORITY', await proof(c, { drillId: randomUUID() })); });
test('source auth child from another project is rejected before backup bind', async () => {
  const c = await setup(); const child = { schemaVersion: 'pathfinder.copied-recovery.auth-receipt.v1', status: 'PASS', mode: 'prepare-source', binding: { owner: sourceOwner }, projectId: randomUUID(), modelVersionId: 'a613151e-c370-45c5-80f3-42ae58603b9a', testFixture: true };
  await refusal(c, 'backup', 'DRILL_AUTH_SCOPE', await proof(c, {}, { child, role: 'source-auth' }));
});
test('a valid auth child alone cannot replace required fresh quiescent source audit', async () => {
  const c = await setup(); const child = { schemaVersion: 'pathfinder.copied-recovery.auth-receipt.v1', status: 'PASS', mode: 'prepare-source', binding: { owner: sourceOwner }, projectId: '1af0f807-7653-40ea-8391-7eea6c54e7d4', modelVersionId: 'a613151e-c370-45c5-80f3-42ae58603b9a', testFixture: true };
  await refusal(c, 'backup', 'DRILL_PROOF_ROLES_MISSING', await proof(c, {}, { child, role: 'source-auth' }));
});
test.after(async () => {
  const sources = await Promise.all(['drill.test.mjs','drill.mjs','binding.mjs'].map(async name => { const file = path.join(ROOT, 'scripts/pathfinder-copied-recovery', name), bytes = await fs.readFile(file); return { path: path.relative(ROOT, file).replaceAll('\\', '/'), bytes: bytes.length, sha256: sha(bytes) }; }));
  const value = { schemaVersion: 'pathfinder.copied-recovery.drill-controls.v1', status: results.length === 8 && (await fs.readFile(sentinel, 'utf8')) === '' ? 'PASS' : 'FAIL', recordedAt: new Date().toISOString(), controls: results, cliReceipts, sources, sentinel: { path: path.relative(ROOT, sentinel).replaceAll('\\', '/'), bytes: (await fs.stat(sentinel)).size, sha256: sha(await fs.readFile(sentinel)) }, scope: { realCli: true, dockerDispatches: 0, coreDispatches: 0, databaseQueries: 0, httpRequests: 0, actualRuntimeMutations: 0, ownedFileFixturesOnly: true, actualRecovery: 'NOT_RUN_PARENT_ONLY' }, limitations: ['Rejection controls stop before real binding/core. They do not prove actual backup, restore, resource audit or retirement success.','Private record tampering affects only newly generated test work; active drill c8f5c134 and live source remain untouched.'], retainedFixtureDirectory: path.relative(ROOT, fixtures).replaceAll('\\', '/') };
  await fs.writeFile(path.join(controls, 'receipt.json'), JSON.stringify(value, null, 2) + '\n', { flag: 'wx' });
  console.log('DRILL_CONTROL_RECEIPT=' + path.relative(ROOT, path.join(controls, 'receipt.json')).replaceAll('\\', '/'));
});
