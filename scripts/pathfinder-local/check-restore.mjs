import fs from 'node:fs/promises';
import path from 'node:path';
import { load, readSettings, ownership, start, retire, ROOT, fail } from './runtime-lib.mjs';

// Authentication values stay in this process; this writes public outcomes only.
const targetPath = process.argv[2];
if (!targetPath || process.argv.length !== 3) fail('PF_RESTORE_CHECK_ARGUMENT_REQUIRED');
const source = await load(), target = await load(targetPath);
if (!target.restore?.inventoriesEqual || target.restore.backupId === undefined) fail('PF_VERIFIED_RESTORE_REQUIRED');
await ownership(source); await ownership(target);
const sourceSettings = await readSettings(source), targetSettings = await readSettings(target);
if (sourceSettings.jwtSecret === targetSettings.jwtSecret) fail('PF_RESTORE_SIGNING_KEY_NOT_ROTATED');
const credentials = JSON.parse(await fs.readFile(path.join(source.runtime, 'demo.private.json'), 'utf8'));
async function login(state) {
  const response = await fetch(`http://127.0.0.1:${state.port}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(credentials), signal: AbortSignal.timeout(30000) });
  const result = await response.json(); if (response.status !== 200 || !result.user?.isAdmin || result.user.id !== source.demo.adminUserId) fail('PF_RESTORE_FRESH_LOGIN_FAILED'); return result.token;
}
const sourceToken = await login(source), targetToken = await login(target);
const stale = await fetch(`http://127.0.0.1:${target.port}/api/users/me`, { headers: { Authorization: 'Bearer ' + sourceToken }, signal: AbortSignal.timeout(30000) });
const fresh = await fetch(`http://127.0.0.1:${target.port}/api/users/me`, { headers: { Authorization: 'Bearer ' + targetToken }, signal: AbortSignal.timeout(30000) });
if (stale.status !== 401 || fresh.status !== 200) fail('PF_RESTORE_TOKEN_BOUNDARY_FAILED');
const versions = await fetch(`http://127.0.0.1:${target.port}/api/projects/${source.demo.projectId}/model-versions`, { headers: { Authorization: 'Bearer ' + targetToken }, signal: AbortSignal.timeout(30000) });
const value = await versions.json();
if (versions.status !== 200 || value.selection?.activeModelVersionId !== source.demo.model.versionId || value.versions?.find(item => item.id === source.demo.model.versionId)?.contentFingerprint !== source.demo.model.contentFingerprint) fail('PF_RESTORE_MODEL_SELECTION_CHANGED');
let quarantineRefused = false, primaryRetireRefused = false;
try { await start({ ...target, status: 'failed-quarantine' }); } catch (error) { quarantineRefused = error.code === 'PF_RESTORE_QUARANTINED'; }
try { await retire(source); } catch (error) { primaryRetireRefused = error.code === 'PF_VERIFIED_RESTORE_FIXTURE_REQUIRED'; }
if (!quarantineRefused || !primaryRetireRefused) fail('PF_RESTORE_NEGATIVE_CONTROL_FAILED');
const result = { schemaVersion: 1, status: 'PASS', checkedAt: new Date().toISOString(), source: { project: source.project, port: source.port }, target: { project: target.project, port: target.port, runtime: target.runtime }, restore: target.restore, checks: { signingKeyDifferent: true, sourceBearerRejectedByTarget: stale.status, targetFreshBearerAccepted: fresh.status, fullReadyResourceAuditPassed: true, databaseInventoryEqual: true, pathfinderArtifactInventoryEqual: true, modelSelectionPreserved: true, failedQuarantineStartRefused: quarantineRefused, primaryDemoRetirementRefused: primaryRetireRefused }, limits: ['Initial PF3 runtime/schema only; later jobs/UI integrations require a final rebuilt drill.', 'Resource-session fencing operation passed, but this initial source had no pre-backup Viewer cookie positive control.', 'Same host/platform; human UI acceptance and cross-computer restore are separate.'] };
const output = path.join(ROOT, 'docs/pathfinder/runtime/restore-check-' + Date.now() + '.json');
await fs.writeFile(output, JSON.stringify(result, null, 2) + '\n', { flag: 'wx' });
console.log(JSON.stringify({ status: 'PASS', output, checks: result.checks }));
