import fs from 'node:fs/promises';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { randomUUID } from 'node:crypto';
import { load, ownership, demoLogin, backup, restore, retire, request, ROOT, fail } from './runtime-lib.mjs';
import { crashRecovery } from './crash-recovery.mjs';

const { values } = parseArgs({ strict: true, options: { backup: { type: 'string' }, 'private-config': { type: 'string' }, 'restore-port': { type: 'string', default: '5191' }, 'keep-restore': { type: 'boolean', default: false }, 'skip-crash-recovery': { type: 'boolean', default: false } } });
let source, sourceToken, sourceSession, target, targetToken, targetSession;
let phase = 'preflight';
const stage = value => { phase = value; console.log(JSON.stringify({ status: 'RUNNING', phase })); };
const origin = state => 'http://127.0.0.1:' + state.port;
async function session(state, token) {
  const base = `/api/projects/${state.demo.projectId}/model-versions/${state.demo.model.versionId}/viewer-sessions`;
  const response = await fetch(origin(state) + base, { method: 'POST', headers: { Authorization: 'Bearer ' + token, Origin: origin(state), 'Sec-Fetch-Site': 'same-origin', 'Content-Type': 'application/json' }, body: JSON.stringify({ loadId: randomUUID() }), signal: AbortSignal.timeout(30000) });
  const value = await response.json(), cookie = response.headers.get('set-cookie')?.split(';')[0];
  if (response.status !== 201 || !cookie || !value.sessionId) fail('PF_DRILL_SESSION_CREATE_FAILED'); return { path: base + '/' + value.sessionId + '/', cookie, id: value.sessionId };
}
async function descriptor(state, value) { const response = await fetch(origin(state) + value.path + 'descriptor', { headers: { Cookie: value.cookie, Origin: origin(state), 'Sec-Fetch-Site': 'same-origin' }, signal: AbortSignal.timeout(30000) }); return { status: response.status, value: await response.json() }; }
async function revoke(state, token, value) { if (!state || !token || !value) return; const response = await fetch(origin(state) + value.path, { method: 'DELETE', headers: { Authorization: 'Bearer ' + token, Origin: origin(state), 'Sec-Fetch-Site': 'same-origin' }, signal: AbortSignal.timeout(30000) }); if (response.status !== 204) fail('PF_DRILL_SESSION_CLEANUP_FAILED'); }
try {
  if (!values.backup || !values['private-config']) fail('PF_DRILL_FRESH_PATHS_REQUIRED');
  source = await load(); await ownership(source); sourceToken = await demoLogin(source); sourceSession = await session(source, sourceToken);
  const positiveBefore = await descriptor(source, sourceSession); if (positiveBefore.status !== 200) fail('PF_DRILL_SOURCE_COOKIE_NOT_VALID');
  stage('cold-backup'); const captured = await backup(source, values.backup, values['private-config']);
  const resumed = await descriptor(source, sourceSession); if (resumed.status !== 200) fail('PF_DRILL_SOURCE_COOKIE_DID_NOT_SURVIVE_OWN_BACKUP');
  stage('isolated-restore'); const restored = await restore({ backup: values.backup, privateConfig: values['private-config'], port: Number(values['restore-port']) }); target = await load(restored.runtime);
  stage('restored-session-fences');
  const oldCookie = await descriptor(target, sourceSession); if (oldCookie.status !== 410 || oldCookie.value.code !== 'SESSION_REVOKED') fail('PF_DRILL_COPIED_COOKIE_NOT_FENCED');
  const oldBearer = await request(target, '/api/users/me', { token: sourceToken }); if (oldBearer.status !== 401) fail('PF_DRILL_SOURCE_BEARER_ACCEPTED');
  targetToken = await demoLogin(target); targetSession = await session(target, targetToken); const freshCookie = await descriptor(target, targetSession); if (freshCookie.status !== 200) fail('PF_DRILL_FRESH_TARGET_COOKIE_FAILED');
  const selected = await request(target, `/api/projects/${source.demo.projectId}/model-versions`, { token: targetToken }); if (selected.status !== 200 || selected.value.selection.activeModelVersionId !== source.demo.model.versionId) fail('PF_DRILL_SELECTION_CHANGED');
  stage('actual-restored-worker-crash'); const crash = values['skip-crash-recovery'] ? { status: 'NOT_RUN', reason: 'Explicitly omitted by operator.' } : target.syntheticDemo ? await crashRecovery(target, targetToken, origin(source)) : { status: 'NOT_RUN', reason: 'No separate restored synthetic fixture is available.' };
  const sourceAfterRestore = await descriptor(source, sourceSession); if (sourceAfterRestore.status !== 200) fail('PF_DRILL_SOURCE_SESSION_CHANGED_BY_EXTRA_RESTORE');
  await revoke(source, sourceToken, sourceSession); sourceSession = undefined;
  await revoke(target, targetToken, targetSession); targetSession = undefined;
  const receipt = { schemaVersion: 1, status: 'PASS', checkedAt: new Date().toISOString(), scope: 'Same-host cold isolated PF database/MinIO/staging/artifact/images restore with actual Viewer cookie and JWT positive/negative controls.', backupId: captured.manifest.backupId, backup: path.resolve(values.backup), sourceProject: source.project, targetProject: target.project, targetRuntime: target.runtime, sourceImages: source.images, targetImages: target.images, restore: target.restore, crashRecovery: crash, checks: { sourceCookieBefore: positiveBefore.status, sourceCookieAfterSourceResume: resumed.status, sourceCookieAfterExtraRestoreAndCrash: sourceAfterRestore.status, copiedCookieOnTarget: oldCookie.status, copiedCookieFailure: oldCookie.value.code, oldBearerOnTarget: oldBearer.status, freshTargetCookie: freshCookie.status, activeModelSelectionPreserved: true, realModelReadback: captured.manifest.modelAudit.totals, pathfinderArtifacts: { files: captured.manifest.artifacts.files.length, bytes: captured.manifest.artifacts.totalBytes, sha256: captured.manifest.artifacts.sha256 } }, limits: ['Same host/platform; cross-computer restore is NOT_RUN.', 'Native/converted engineering parity remains unaccepted.', 'No original application/database/storage/container writes.'] };
  stage('extra-target-retirement');
  if (!values['keep-restore']) receipt.retirement = await retire(target);
  const output = path.join(ROOT, 'docs/pathfinder/runtime/final-drill-' + Date.now() + '.json'); await fs.writeFile(output, JSON.stringify(receipt, null, 2) + '\n', { flag: 'wx' });
  console.log(JSON.stringify({ status: 'PASS', evidence: output, backupId: receipt.backupId, targetRetained: values['keep-restore'], targetRuntime: target.runtime }));
} catch (error) {
  const failure = { schemaVersion: 1, status: 'FAIL', checkedAt: new Date().toISOString(), phase, code: /^PF_[A-Z_]+$/.test(error.code ?? error.message) ? error.code ?? error.message : 'PF_DRILL_FAILED', ...(target ? { retainedTargetRuntime: target.runtime, targetProject: target.project } : {}), limits: ['No passing crash/recovery or restore result is inferred from an incomplete drill.'] };
  const evidence = path.join(ROOT, 'docs/pathfinder/runtime/final-drill-failed-' + Date.now() + '.json');
  try { await fs.writeFile(evidence, JSON.stringify(failure, null, 2) + '\n', { flag: 'wx' }); console.error(JSON.stringify({ ...failure, evidence })); }
  catch { console.error(JSON.stringify(failure)); }
  process.exitCode = 1;
}
finally {
  try { await revoke(source, sourceToken, sourceSession); await revoke(target, targetToken, targetSession); }
  catch { console.error(JSON.stringify({ status: 'FAIL', code: 'PF_DRILL_SESSION_CLEANUP_FAILED' })); process.exitCode = 1; }
}
