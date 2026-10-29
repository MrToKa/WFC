import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { spawn, execFile } from 'node:child_process';
import { parseArgs, promisify } from 'node:util';
import { ROOT, contained } from '../pathfinder-local/runtime-lib.mjs';
import { assertCanonicalPath, hashFile } from '../operations/archives.mjs';
import { writePrivateJson } from '../operations/docker.mjs';
import { SOURCE, bind, refuse, assertRetirementTarget } from './binding.mjs';

const scratch = path.join(ROOT, 'pathfinder-engine/.scratch'), evidence = path.join(ROOT, 'docs/pathfinder/evidence/copied-recovery');
const digest = b => createHash('sha256').update(b).digest('hex');
const requireThat = (ok, code) => { if (!ok) refuse(code); };
const { values, positionals } = parseArgs({ strict: true, allowPositionals: true, options: { work: { type: 'string' }, proof: { type: 'string' }, 'proof-sha256': { type: 'string' } } });
const action = positionals[0], startedAt = new Date().toISOString();
const receipt = { schemaVersion: 'pathfinder.copied-recovery.drill-receipt.v1', status: 'FAIL', action, startedAt };
let work, record, lock, lockBytes, operationDir;
const relative = f => path.relative(ROOT, f).replaceAll('\\', '/');
const identity = bound => ({ apiId: bound.api.id, pgId: bound.pg.id, webId: bound.web.id, minioId: bound.minio.id, containers: bound.resources.containers.map(({ role, id, image }) => ({ role, id, image })).sort((a, b) => a.role.localeCompare(b.role)) });
async function boundedRead(file, limit = 4 * 1024 ** 2) { await assertCanonicalPath(file); const st = await fs.stat(file); requireThat(st.isFile() && st.nlink === 1 && st.size > 0 && st.size <= limit, 'DRILL_FILE_BOUND'); const bytes = await fs.readFile(file); requireThat(bytes.length === st.size, 'DRILL_FILE_CHANGED'); return bytes; }
async function checkpoint() {
  const file = path.join(work, 'drill.private.json'), temporary = path.join(work, 'record-' + randomUUID() + '.private.json');
  await writePrivateJson(temporary, record); await fs.rename(temporary, file);
}
async function proof() {
  const file = path.resolve(values.proof ?? ''); requireThat(contained(evidence, file) && /^[a-f0-9]{64}$/.test(values['proof-sha256'] ?? ''), 'DRILL_PROOF_REFERENCE');
  const bytes = await boundedRead(file); requireThat(digest(bytes) === values['proof-sha256'], 'DRILL_PROOF_HASH');
  const value = JSON.parse(bytes); requireThat(value.schemaVersion === 'pathfinder.copied-recovery.phase-proof.v1' && value.status === 'PASS' && value.drillId === record.id && value.sourceOwner === SOURCE.owner, 'DRILL_PROOF_AUTHORITY');
  requireThat(Array.isArray(value.receipts) && value.receipts.length > 0 && value.receipts.length <= 16, 'DRILL_PROOF_RECEIPTS');
  const roles = new Map();
  for (const ref of value.receipts) {
    const filename = path.resolve(ROOT, ref.path); requireThat(contained(evidence, filename) && /^[a-f0-9]{64}$/.test(ref.sha256) && typeof ref.role === 'string' && !roles.has(ref.role), 'DRILL_PROOF_CHILD');
    const raw = await boundedRead(filename), child = JSON.parse(raw); requireThat(digest(raw) === ref.sha256 && child.status === 'PASS', 'DRILL_PROOF_CHILD_STATUS'); roles.set(ref.role, child);
    if (['source-audit', 'target-fence', 'owned-auth', 'target-ui-business'].includes(ref.role)) {
      const expected = ref.role === 'source-audit' ? record.source : record.target;
      requireThat(child.schemaVersion === 'pathfinder.copied-recovery.audit.v1' && child.target?.owner === expected.owner && child.target.kind === (ref.role === 'source-audit' ? 'source' : 'target') && child.target.project === expected.project && path.resolve(ROOT, child.target.runtime) === path.resolve(expected.runtime), 'DRILL_AUDIT_SCOPE');
      if (ref.role !== 'source-audit') requireThat(child.target.backupId === record.backupId && expected.identity && ['apiId', 'pgId', 'webId', 'minioId'].every(k => child.target[k] === expected.identity[k]), 'DRILL_AUDIT_TARGET_IDENTITY');
      if (ref.role === 'source-audit') requireThat(Date.now() - Date.parse(child.finishedAt) >= 0 && Date.now() - Date.parse(child.finishedAt) < 60000 && child.summary.quiescence.before.activePathfinderJobs === '0' && child.summary.quiescence.after.activePathfinderJobs === '0', 'DRILL_AUDIT_FRESHNESS');
      else { const diffPath = path.resolve(ROOT, child.difference?.path ?? ''); requireThat(contained(scratch, diffPath), 'DRILL_AUDIT_DIFF_PATH'); const diffBytes = await boundedRead(diffPath, 64 * 1024 ** 2), diff = JSON.parse(diffBytes); requireThat(digest(diffBytes) === child.difference.sha256 && diff.status === 'PASS' && diff.comparison === ({ 'target-fence': 'restore-fence', 'owned-auth': 'owned-auth', 'target-ui-business': 'business-only' })[ref.role], 'DRILL_AUDIT_COMPARISON'); }
    } else if (['source-auth', 'source-auth-check', 'target-auth'].includes(ref.role)) requireThat(child.schemaVersion === 'pathfinder.copied-recovery.auth-receipt.v1' && child.mode === ({ 'source-auth': 'prepare-source', 'source-auth-check': 'check-source', 'target-auth': 'check-target' })[ref.role] && child.binding?.owner === (ref.role === 'target-auth' ? record.target.owner : SOURCE.owner) && child.projectId === SOURCE.projectId && child.modelVersionId === SOURCE.modelVersionId, 'DRILL_AUTH_SCOPE');
    else if (ref.role === 'backup' || ref.role === 'model-audit') requireThat(child.schemaVersion === receipt.schemaVersion && child.drillId === record.id && child.action === (ref.role === 'backup' ? 'backup' : 'audit-models') && child.backupId === record.backupId, 'DRILL_CORE_PROOF_SCOPE');
    else if (ref.role === 'adjunct') requireThat(child.schemaVersion === 'pathfinder.copied-recovery.provenance-receipt.v1' && child.drillId === record.id && child.backupId === record.backupId && child.coreManifest?.sha256 === record.manifest?.sha256, 'DRILL_ADJUNCT_PROOF');
    else if (ref.role === 'browser') requireThat(child.schemaVersion === 'pathfinder.copied-recovery.browser.v1' && child.targetOwner === record.target.owner && child.projectId === SOURCE.projectId && child.modelVersionId === SOURCE.modelVersionId && child.backupId === record.backupId && child.ownTabClosed === true, 'DRILL_BROWSER_SCOPE');
    else refuse('DRILL_PROOF_ROLE');
  }
  const required = { 'source-ready': ['source-audit', 'source-auth'], 'backup-qualified': ['backup', 'source-auth-check', 'adjunct'], 'target-qualified': ['target-fence', 'owned-auth', 'target-ui-business', 'target-auth', 'model-audit', 'browser'] }[value.phase];
  requireThat(required && required.every(role => roles.has(role)), 'DRILL_PROOF_ROLES_MISSING');
  return { ...value, checked: roles };
}
// Actual core operations run in a bounded child. Once begun, failure/timeout is
// uncertain until inspected; this tool never retries or regenerates a path.
async function core(mode) {
  const program = `const watchdog=setTimeout(()=>process.exit(2),12*60*1000);let text='';for await(const chunk of process.stdin){text+=chunk;if(Buffer.byteLength(text)>1048576)throw Error('INPUT_BOUND');}const c=JSON.parse(text);const r=await import('./scripts/pathfinder-local/runtime-lib.mjs');const {hashFile}=await import('./scripts/operations/archives.mjs');let value;try{
if(c.mode==='backup'){const state=await r.load(c.sourceRuntime);const {bind}=await import('./scripts/pathfinder-copied-recovery/binding.mjs');await bind({runtime:c.sourceRuntime,kind:'source',owner:c.sourceOwner});const v=await r.backup(state,c.backup,c.privateConfig);value={status:'PASS',backupId:v.manifest.backupId,manifest:await hashFile(c.backup+'/manifest.json'),modelAudit:v.manifest.modelAudit,artifacts:v.manifest.artifacts};}
else if(c.mode==='restore'){const v=await r.restore({backup:c.backup,privateConfig:c.privateConfig,runtime:c.targetRuntime,port:5192});const state=await r.load(v.runtime);value={status:'PASS',runtime:state.runtime,owner:state.owner,project:state.project,port:state.port,restore:state.restore};}
else if(c.mode==='audit-models'){const state=await r.load(c.targetRuntime);const {bind}=await import('./scripts/pathfinder-copied-recovery/binding.mjs');await bind({runtime:c.targetRuntime,kind:'target',owner:c.targetOwner,backupId:c.backupId});const s=await r.readSettings(state);value=await r.helper(state,['node','server/dist/server/operations/cli.js','audit-models'],{network:state.project+'_backend',env:['DATABASE_URL=postgresql://pf_local:'+s.databasePassword+'@postgres:5432/wfc_pathfinder_local','JWT_SECRET='+s.jwtSecret,'MINIO_ENDPOINT=minio','MINIO_PORT=9000','MINIO_USE_SSL=false','MINIO_ACCESS_KEY=pf_local_storage','MINIO_SECRET_KEY='+s.storagePassword,'MINIO_BUCKET_PROJECTS=pf-local-project-files','MINIO_BUCKET_TEMPLATES=pf-local-template-files','WFC_MODEL_BUCKET=pf-local-models','WFC_MODEL_IMPORT_ROOT=/var/lib/wfc/model-imports']});}
else if(c.mode==='retire'){const state=await r.load(c.targetRuntime);const {bind,assertRetirementTarget}=await import('./scripts/pathfinder-copied-recovery/binding.mjs');await bind({runtime:c.targetRuntime,kind:'target',owner:c.targetOwner,backupId:c.backupId});assertRetirementTarget(state,c.record);value=await r.retire(state);}
else throw Error('MODE');await new Promise((resolve,reject)=>process.stdout.write(JSON.stringify(value)+'\\n',e=>e?reject(e):resolve()));}catch(error){await new Promise(resolve=>process.stdout.write(JSON.stringify({status:'FAIL',error:/^[A-Z0-9_]+$/.test(error.code??'')?error.code:'CORE_OPERATION_FAILED'})+'\\n',resolve));process.exitCode=1;}finally{clearTimeout(watchdog);}`;
  const input = JSON.stringify({ mode, sourceRuntime: record.source.runtime, sourceOwner: record.source.owner, backup: record.backup, privateConfig: record.privateConfig, targetRuntime: record.target.runtime, targetOwner: record.target.owner, backupId: record.backupId, record });
  const result = await new Promise(resolve => {
    const child = spawn(process.execPath, ['--input-type=module', '-e', program], { cwd: ROOT, windowsHide: true, env: { ...process.env, PF_ENGINE_MODE: 'oneshot' }, stdio: ['pipe', 'pipe', 'pipe'] });
    const output = [], errors = []; let outBytes = 0, errBytes = 0, overflow = false, timedOut = false, stdinError = false, spawnError = false;
    const timer = setTimeout(() => { timedOut = true; child.kill(); }, 13 * 60 * 1000);
    child.on('error', () => { spawnError = true; }); child.stdin.on('error', () => { stdinError = true; });
    child.stdout.on('data', b => { outBytes += b.length; if (outBytes <= 4 * 1024 ** 2) output.push(b); else { overflow = true; child.kill(); } });
    child.stderr.on('data', b => { errBytes += b.length; if (errBytes <= 32768) errors.push(b); else { overflow = true; child.kill(); } });
    child.on('close', (code, signal) => { clearTimeout(timer); resolve({ code, signal, overflow, timedOut, stdinError, spawnError, stdout: Buffer.concat(output), stderr: Buffer.concat(errors) }); }); child.stdin.end(input);
  });
  const stdout = path.join(operationDir, 'stdout.private.json'), stderr = path.join(operationDir, 'stderr.private.txt');
  await fs.writeFile(stdout, result.stdout, { flag: 'wx', mode: 0o600 }); await fs.writeFile(stderr, result.stderr, { flag: 'wx', mode: 0o600 });
  receipt.transport = { code: result.code, signal: result.signal, overflow: result.overflow, timedOut: result.timedOut, stdinError: result.stdinError, spawnError: result.spawnError, stdout: { path: relative(stdout), bytes: result.stdout.length, sha256: digest(result.stdout) }, stderr: { path: relative(stderr), bytes: result.stderr.length, sha256: digest(result.stderr) } };
  await writePrivateJson(path.join(operationDir, 'transport.private.json'), receipt.transport);
  requireThat(result.code === 0 && !result.overflow && !result.timedOut && !result.stdinError && !result.spawnError, 'DRILL_CORE_TRANSPORT');
  const value = JSON.parse(result.stdout); receipt.coreResult = value; requireThat(value.status === 'PASS', 'DRILL_CORE_FAILED'); return value;
}
try {
  requireThat(positionals.length === 1 && ['init', 'backup', 'restore', 'audit-models', 'approve-target', 'retire-target', 'info'].includes(action), 'DRILL_MODE');
  work = path.resolve(ROOT, values.work ?? ''); requireThat(contained(scratch, work) && /^copied-recovery-[a-f0-9-]{36}$/.test(path.basename(work)), 'DRILL_WORK');
  if (action === 'init') {
    await assertCanonicalPath(work, { directory: true, allowMissing: true }); await fs.mkdir(work, { mode: 0o700 });
    if (process.platform === 'win32') await promisify(execFile)('icacls', [work, '/inheritance:r', '/grant:r', process.env.USERDOMAIN + '\\' + process.env.USERNAME + ':(OI)(CI)(F)'], { windowsHide: true, timeout: 5000, maxBuffer: 8192 });
    record = { schemaVersion: 'pathfinder.copied-recovery.drill-private.v1', id: randomUUID(), createdAt: startedAt, phase: 'planned', source: { runtime: path.join(ROOT, SOURCE.runtime), owner: SOURCE.owner, project: SOURCE.project, port: SOURCE.port }, backup: path.join(work, 'backup'), privateConfig: path.join(work, 'runtime.private.json'), target: { runtime: path.join(scratch, 'copied-recovery-target-' + randomUUID()), port: 5192, verified: false } };
    await writePrivateJson(path.join(work, 'owner.json'), { format: 'PF-COPIED-RECOVERY', id: record.id, work, sourceOwner: SOURCE.owner }); await writePrivateJson(path.join(work, 'drill.private.json'), record);
  } else {
    record = JSON.parse(await boundedRead(path.join(work, 'drill.private.json'))); const owner = JSON.parse(await boundedRead(path.join(work, 'owner.json')));
    requireThat(record.schemaVersion === 'pathfinder.copied-recovery.drill-private.v1' && owner.format === 'PF-COPIED-RECOVERY' && owner.id === record.id && owner.work === work && owner.sourceOwner === SOURCE.owner && record.source.owner === SOURCE.owner && path.resolve(record.source.runtime) === path.join(ROOT, SOURCE.runtime) && record.backup === path.join(work, 'backup') && record.privateConfig === path.join(work, 'runtime.private.json') && contained(scratch, record.target.runtime) && /^copied-recovery-target-[a-f0-9-]{36}$/.test(path.basename(record.target.runtime)), 'DRILL_PRIVATE_RECORD');
  }
  lock = path.join(work, 'run.lock'); lockBytes = Buffer.from(JSON.stringify({ drillId: record.id, pid: process.pid, at: startedAt })); await fs.writeFile(lock, lockBytes, { flag: 'wx', mode: 0o600 });
  operationDir = path.join(work, 'step-' + randomUUID()); await fs.mkdir(operationDir);
  if (action === 'backup') {
    requireThat(record.phase === 'planned', 'DRILL_BACKUP_ALREADY_BEGUN'); const p = await proof(); requireThat(p.phase === 'source-ready' && p.quiescent === true && p.provenancePrepared === true && Date.now() - Date.parse(p.recordedAt) >= 0 && Date.now() - Date.parse(p.recordedAt) < 60000, 'DRILL_SOURCE_NOT_READY');
    const bound = await bind({ runtime: record.source.runtime, kind: 'source', owner: SOURCE.owner }); record.source.identity = identity(bound); requireThat(['apiId', 'pgId', 'webId', 'minioId'].every(k => p.checked.get('source-audit').target[k] === record.source.identity[k]), 'DRILL_SOURCE_AUDIT_IDENTITY'); record.phase = 'backup_started'; await checkpoint();
    const value = await core('backup'); record.backupId = value.backupId; record.manifest = value.manifest; record.phase = 'backup_complete'; await checkpoint();
    await bind({ runtime: record.source.runtime, kind: 'source', owner: SOURCE.owner }); receipt.sourceMetadataHealthyAfterBackup = true;
  } else if (action === 'restore') {
    requireThat(record.phase === 'backup_complete', 'DRILL_RESTORE_ALREADY_BEGUN'); const p = await proof(); requireThat(p.phase === 'backup-qualified' && p.backupId === record.backupId && p.adjunctVerified === true && p.sourceHealthy === true, 'DRILL_BACKUP_NOT_QUALIFIED');
    await bind({ runtime: record.source.runtime, kind: 'source', owner: SOURCE.owner }); await assertCanonicalPath(record.target.runtime, { directory: true, allowMissing: true }); record.phase = 'restore_started'; await checkpoint();
    const value = await core('restore'); requireThat(value.restore?.backupId === record.backupId && value.port === 5192 && value.owner !== SOURCE.owner, 'DRILL_RESTORE_RESULT'); record.target = { ...value, verified: false }; record.phase = 'restore_returned'; await checkpoint();
    const bound = await bind({ runtime: record.target.runtime, kind: 'target', owner: record.target.owner, backupId: record.backupId }); record.target.identity = identity(bound); record.phase = 'restored'; await checkpoint();
  } else if (action === 'audit-models') {
    requireThat(record.phase === 'restored', 'DRILL_TARGET_NOT_RESTORED'); await bind({ runtime: record.target.runtime, kind: 'target', owner: record.target.owner, backupId: record.backupId }); await core('audit-models');
  } else if (action === 'approve-target') {
    requireThat(record.phase === 'restored', 'DRILL_TARGET_NOT_RESTORED'); const p = await proof(); requireThat(p.phase === 'target-qualified' && p.backupId === record.backupId && p.targetOwner === record.target.owner && p.losslessFence === true && p.ownedAuth === true && p.businessAfterUi === true && p.fullModelAudit === true && p.browserVerified === true, 'DRILL_TARGET_NOT_QUALIFIED');
    await bind({ runtime: record.target.runtime, kind: 'target', owner: record.target.owner, backupId: record.backupId }); record.target.verified = true; record.phase = 'qualified'; await checkpoint();
  } else if (action === 'retire-target') {
    requireThat(record.phase === 'qualified', 'DRILL_RETIRE_NOT_QUALIFIED'); const bound = await bind({ runtime: record.target.runtime, kind: 'target', owner: record.target.owner, backupId: record.backupId }); assertRetirementTarget(bound.state, record); receipt.retirementResources = bound.resources;
    record.phase = 'retirement_started'; await checkpoint(); receipt.retirement = await core('retire'); record.phase = 'retired'; await checkpoint();
    await bind({ runtime: record.source.runtime, kind: 'source', owner: SOURCE.owner }); receipt.sourceMetadataHealthyAfterRetirement = true;
  }
  receipt.status = 'PASS';
} catch (error) {
  receipt.error = /^[A-Z0-9_]+$/.test(error?.code ?? '') ? error.code : 'DRILL_FAILED';
  receipt.recovery = 'Keep partial archive/private companion/record/raw transport. Never repeat a begun backup/restore/retirement. Inspect accepted state and source health before explicit reconciliation.';
} finally {
  if (lock && lockBytes) { try { if (Buffer.compare(await fs.readFile(lock), lockBytes) === 0) await fs.unlink(lock); } catch { receipt.lockCleanup = 'NOT_CONFIRMED'; } }
}
if (record) { receipt.drillId = record.id; receipt.phase = record.phase; receipt.source = record.source; receipt.target = record.target; receipt.backupId = record.backupId; receipt.privateWork = relative(work); receipt.backupManifest = record.manifest; }
receipt.finishedAt = new Date().toISOString(); await fs.mkdir(evidence, { recursive: true }); const file = path.join(evidence, 'drill-' + Date.now() + '-' + randomUUID().slice(0, 8) + '.json'); await fs.writeFile(file, JSON.stringify(receipt, null, 2) + '\n', { flag: 'wx' }); console.log(JSON.stringify({ status: receipt.status, action, phase: receipt.phase, file: relative(file), drillId: receipt.drillId, target: receipt.target, backupId: receipt.backupId, error: receipt.error })); process.exitCode = receipt.status === 'PASS' ? 0 : 1;
