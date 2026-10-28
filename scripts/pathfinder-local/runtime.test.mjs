import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { ROOT, contained, validProject, validateState, load, configuration, claimsProject, start, retire, backup, restore, observeColdRuntime } from './runtime-lib.mjs';
import { artifactInventory } from './container-ops.mjs';
import { assertBackupRetirementIdentity, planBackupPayloadRetirement } from './cleanup-obsolete.mjs';
import { validatePreviewRecoveryTarget, assertPreviewNoWorkflowWrites } from './preview-recovery.mjs';

const runtime = path.join(ROOT, 'pathfinder-engine/.scratch/pathfinder-local');
const state = await load(runtime);

test('candidate Compose resolves only own loopback port/private services', async () => {
  const result = await configuration(state);
  assert.equal(result.privateBackend, true); assert.deepEqual(result.publishedPorts, [5190]);
});
test('original Compose project and invalid resource identities are refused', () => {
  for (const value of ['wfc', 'wfc-app', 'wfc-pathfinder-local;docker', '../wfc']) assert.throws(() => validProject(value));
  assert.equal(validProject('wfc-pathfinder-local-abcdef123456'), 'wfc-pathfinder-local-abcdef123456');
});
test('owned state refuses original checkout, original ports and original image tags', () => {
  assert.throws(() => validateState({ ...state, root: 'C:/Users/todor.chankov/source/WFC' }, runtime));
  assert.throws(() => validateState({ ...state, port: 5180 }, runtime));
  assert.throws(() => validateState({ ...state, tags: { ...state.tags, api: 'wfc/backend:local' } }, runtime));
});
test('path containment rejects sibling prefix and traversal', () => {
  assert.equal(contained(runtime, runtime + '-other'), false);
  assert.equal(contained(runtime, path.join(runtime, '..', 'other')), false);
  assert.equal(contained(runtime, path.join(runtime, 'backup-1')), true);
});
test('a restore with a shared project-name prefix is never selected as the source project', () => {
  assert.equal(claimsProject({ Name: '/wfc-pathfinder-local-abcdef123456-api-1', Config: { Labels: { 'com.docker.compose.project': 'wfc-pathfinder-local-abcdef123456' } } }, state), false);
  assert.equal(claimsProject({ Name: '/wfc-pathfinder-local-api-1', Config: { Labels: {} } }, state), true);
});
test('failed quarantine and retired targets cannot be exposed by start', async () => {
  await assert.rejects(() => start({ ...state, status: 'failed-quarantine' }), /PF_RESTORE_QUARANTINED/);
  await assert.rejects(() => start({ ...state, status: 'retired' }), /PF_RETIRED_RUNTIME/);
});
test('retirement refuses the primary demonstration before changing Docker state', async () => {
  await assert.rejects(() => retire(state), /PF_VERIFIED_RESTORE_FIXTURE_REQUIRED/);
});

const coldState = () => ({ ...state, images: { api: 'sha256:' + 'a'.repeat(64), web: 'sha256:' + 'b'.repeat(64) },
  settings: { databasePassword: 'synthetic-secret', jwtSecret: 'synthetic-secret' }, credentials: { password: 'synthetic-secret' } });
for (const phase of ['backup-before-dump', 'restore-before-fence', 'restore-after-fence']) {
  test(`cold observation ${phase} awaits one frozen identity-only descriptor and discards callback output`, async () => {
    const candidate = coldState(), backupId = randomUUID(), calls = [];
    let completed = false;
    const result = await observeColdRuntime(async observation => {
      await Promise.resolve(); calls.push(observation); completed = true;
      assert.ok(Object.isFrozen(observation));
      assert.deepEqual(Object.keys(observation).sort(), ['schemaVersion', 'phase', 'backupId', 'runtime', 'owner', 'project', 'port', 'apiImage'].sort());
      assert.throws(() => { observation.owner = randomUUID(); }, TypeError);
      return { credentials: 'synthetic-secret-that-must-not-be-returned' };
    }, phase, candidate, backupId);
    assert.equal(result, undefined); assert.equal(completed, true); assert.equal(calls.length, 1);
    assert.deepEqual(calls[0], { schemaVersion: 'wfc.pf.cold-observation.v1', phase, backupId, runtime: candidate.runtime,
      owner: candidate.owner, project: candidate.project, port: candidate.port, apiImage: candidate.images.api });
    assert.equal(JSON.stringify(calls[0]).includes('synthetic-secret'), false);
  });
}
test('an omitted cold observer preserves prior callers without reading any supplied state', async () => {
  assert.equal(await observeColdRuntime(undefined, 'backup-before-dump', null, null), undefined);
});
test('backup and restore reject malformed cold callbacks before any resource or path operation', async () => {
  for (const observer of [null, false, 1, {}, 'not-a-function']) {
    await assert.rejects(() => backup(null, null, null, { observeCold: observer }), /PF_COLD_OBSERVER_INVALID/);
    await assert.rejects(() => restore({ observeCold: observer }), /PF_COLD_OBSERVER_INVALID/);
    await assert.rejects(() => observeColdRuntime(observer, 'backup-before-dump', null, null), /PF_COLD_OBSERVER_INVALID/);
  }
});
test('cold observation refuses a forged phase, archive identity, runtime scope or image before invoking code', async () => {
  const observer = () => { throw Error('Must not invoke an invalid observation'); }, backupId = randomUUID(), candidate = coldState();
  for (const phase of ['after-start', 'restore', '', null])
    await assert.rejects(() => observeColdRuntime(observer, phase, candidate, backupId), /PF_COLD_OBSERVATION_INVALID/);
  await assert.rejects(() => observeColdRuntime(observer, 'backup-before-dump', candidate, 'not-an-id'), /PF_COLD_OBSERVATION_INVALID/);
  await assert.rejects(() => observeColdRuntime(observer, 'backup-before-dump', { ...candidate, owner: 'not-an-id' }, backupId), /PF_OWNED_RUNTIME_REQUIRED/);
  for (const image of ['wfc/backend:local', 'a'.repeat(64), 'sha256:' + 'A'.repeat(64), 'sha256:' + 'a'.repeat(64) + '\n'])
    await assert.rejects(() => observeColdRuntime(observer, 'backup-before-dump', { ...candidate, images: { api: image } }, backupId), /PF_COLD_OBSERVATION_IMAGE_INVALID/);
});
test('cold observer synchronous and asynchronous refusals propagate unchanged without a success value', async () => {
  const refusal = Object.assign(Error('Explicit observation refusal'), { code: 'OWNED_COLD_OBSERVATION_REFUSED' });
  for (const observer of [() => { throw refusal; }, async () => { await Promise.resolve(); throw refusal; }])
    await assert.rejects(() => observeColdRuntime(observer, 'restore-before-fence', coldState(), randomUUID()), error => error === refusal);
});

test('preview process interruption refuses primary, unverified, invalid and source-origin targets before runtime access', () => {
  const extra = { project: 'wfc-pathfinder-local-abcdef123456', port: 5191, restore: { inventoriesEqual: true }, status: 'running', syntheticDemo: { projectId: randomUUID(), actorId: randomUUID() } };
  validatePreviewRecoveryTarget(extra, 'http://127.0.0.1:5190');
  for (const patch of [{ project: 'wfc-pathfinder-local' }, { port: 5190 }, { project: 'wfc-app' }, { restore: {} }, { status: 'failed-quarantine' }, { syntheticDemo: { projectId: 'bad', actorId: randomUUID() } }])
    assert.throws(() => validatePreviewRecoveryTarget({ ...extra, ...patch }, 'http://127.0.0.1:5190'), /PF_PREVIEW_CRASH_EXTRA_VERIFIED_TARGET_REQUIRED/);
  for (const origin of ['http://127.0.0.1:5191', 'http://127.0.0.1:5180', 'https://example.invalid'])
    assert.throws(() => validatePreviewRecoveryTarget(extra, origin), /PF_PREVIEW_CRASH_EXTRA_VERIFIED_TARGET_REQUIRED/);
});

test('preview closure refuses cable edits, new workflow/registry rows and malformed baselines', () => {
  const baseline = { cables: 66, cableSha256: 'a'.repeat(64), proposals: 64, reviews: 2, applyReceipts: 0, jobItems: 64, locations: 2, bindings: 2, aliases: 2 };
  assertPreviewNoWorkflowWrites(baseline, { ...baseline });
  for (const key of Object.keys(baseline)) {
    const changed = { ...baseline, [key]: key === 'cableSha256' ? 'b'.repeat(64) : baseline[key] + 1 };
    assert.throws(() => assertPreviewNoWorkflowWrites(baseline, changed), /PF_PREVIEW_CRASH_WORKFLOW_CHANGED/);
  }
  assert.throws(() => assertPreviewNoWorkflowWrites({ ...baseline, cableSha256: 'invalid' }, baseline), /PF_PREVIEW_CRASH_BASELINE_INVALID/);
  assert.throws(() => assertPreviewNoWorkflowWrites(baseline, { ...baseline, cables: -1 }), /PF_PREVIEW_CRASH_BASELINE_INVALID/);
});
test('PF artifact inventory hashes all exact bytes and observes changes', async () => {
  const directory = path.join(ROOT, 'pathfinder-engine/.scratch/runtime-test-' + randomUUID());
  await fs.mkdir(directory); await fs.mkdir(path.join(directory, 'snapshots'));
  await fs.writeFile(path.join(directory, 'snapshots', 'example.json'), '{"synthetic":true}\n', { flag: 'wx' });
  const first = await artifactInventory(directory), repeat = await artifactInventory(directory);
  assert.deepEqual(first, repeat); assert.equal(first.files.length, 1);
  await fs.writeFile(path.join(directory, 'snapshots', 'example.json'), '{"synthetic":false}\n');
  const changed = await artifactInventory(directory); assert.notEqual(changed.sha256, first.sha256);
});
test('PF artifact inventory refuses a junction instead of traversing outside its root', async () => {
  const directory = path.join(ROOT, 'pathfinder-engine/.scratch/runtime-link-test-' + randomUUID());
  await fs.mkdir(directory); await fs.mkdir(path.join(directory, 'root')); await fs.mkdir(path.join(directory, 'outside'));
  await fs.writeFile(path.join(directory, 'outside', 'data.txt'), 'Synthetic reference only.');
  await fs.symlink(path.join(directory, 'outside'), path.join(directory, 'root', 'foreign'), process.platform === 'win32' ? 'junction' : 'dir');
  await assert.rejects(() => artifactInventory(path.join(directory, 'root')), /PF_ARTIFACT_LINK_REFUSED/);
});

function backupRecord(name, date = '2026-10-18T04:00:00.000Z', id = randomUUID()) {
  return { status: 'PASS', directory: path.join(ROOT, 'pathfinder-engine/.scratch', name), manifest: {
    format: 'WFC-PF-LOCAL-BACKUP', schemaVersion: 1, profile: 'cold-pg-minio-staging-pathfinder-v1', backupId: id,
    createdAt: date, sourceProject: state.project, sourceOwner: state.owner,
  } };
}
test('backup retirement policy accepts only a distinct older owned backup without deleting anything', () => {
  const retained = backupRecord('runtime-policy-retained'), old = backupRecord('runtime-policy-old', '2026-10-18T03:00:00.000Z');
  assert.equal(assertBackupRetirementIdentity(state, retained, old), old.directory);
});
test('backup retirement rejects another owner or project', () => {
  const retained = backupRecord('runtime-policy-retained'), old = backupRecord('runtime-policy-old', '2026-10-18T03:00:00.000Z');
  assert.throws(() => assertBackupRetirementIdentity(state, retained, { ...old, manifest: { ...old.manifest, sourceOwner: randomUUID() } }), /PF_CLEANUP_BACKUP_OWNERSHIP_REQUIRED/);
  assert.throws(() => assertBackupRetirementIdentity(state, retained, { ...old, manifest: { ...old.manifest, sourceProject: 'wfc-app' } }), /PF_CLEANUP_BACKUP_OWNERSHIP_REQUIRED/);
});
test('backup retirement rejects self and another path carrying the retained backup identity', () => {
  const retained = backupRecord('runtime-policy-retained'), old = backupRecord('runtime-policy-old', '2026-10-18T03:00:00.000Z');
  assert.throws(() => assertBackupRetirementIdentity(state, retained, { ...old, directory: retained.directory }), /PF_CLEANUP_OLD_BACKUP_OUTSIDE_SCOPE/);
  assert.throws(() => assertBackupRetirementIdentity(state, retained, { ...old, manifest: { ...old.manifest, backupId: retained.manifest.backupId } }), /PF_CLEANUP_OLDER_DISTINCT_BACKUP_REQUIRED/);
});
test('backup retirement rejects equal/newer timestamps and invalid dates', () => {
  const retained = backupRecord('runtime-policy-retained');
  for (const date of [retained.manifest.createdAt, '2026-10-18T05:00:00.000Z', 'invalid']) {
    assert.throws(() => assertBackupRetirementIdentity(state, retained, backupRecord('runtime-policy-old', date)), /PF_CLEANUP_OLDER_DISTINCT_BACKUP_REQUIRED/);
  }
});
test('backup retirement rejects scratch root, outside paths and sibling prefixes', () => {
  const retained = backupRecord('runtime-policy-retained'), old = backupRecord('runtime-policy-old', '2026-10-18T03:00:00.000Z');
  for (const directory of [path.join(ROOT, 'pathfinder-engine/.scratch'), path.join(ROOT, 'docs'), path.join(ROOT, 'pathfinder-engine/.scratch-other', 'backup')]) {
    assert.throws(() => assertBackupRetirementIdentity(state, retained, { ...old, directory }), /PF_CLEANUP_OLD_BACKUP_OUTSIDE_SCOPE/);
    assert.throws(() => assertBackupRetirementIdentity(state, { ...retained, directory }, old), /PF_CLEANUP_OLD_BACKUP_OUTSIDE_SCOPE/);
  }
});
const payloadNames = ['database.dump', 'minio.wfcops', 'staging.wfcops', 'pathfinder.wfcops', 'api-image.tar', 'web-image.tar', 'postgres-image.tar', 'minio-image.tar'];
async function smallPayloadFixture() {
  const directory = path.join(ROOT, 'pathfinder-engine/.scratch/runtime-retirement-test-' + randomUUID()); await fs.mkdir(directory);
  const files = [];
  for (const name of payloadNames) {
    const bytes = Buffer.from('Explicit synthetic payload planner test: ' + name + '\n'); await fs.writeFile(path.join(directory, name), bytes, { flag: 'wx' });
    files.push({ path: name, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') });
  }
  await fs.writeFile(path.join(directory, 'manifest.json'), 'Historical metadata must remain.\n', { flag: 'wx' });
  return { directory, files };
}
test('payload retirement planning retains metadata and selects exactly eight unchanged regular payloads', async () => {
  const fixture = await smallPayloadFixture(), plan = await planBackupPayloadRetirement(fixture.directory, fixture.files);
  assert.equal(plan.length, 8); assert.ok(plan.every(item => path.dirname(item.absolute) === fixture.directory));
  assert.equal((await fs.readdir(fixture.directory)).length, 9);
  assert.equal(await fs.readFile(path.join(fixture.directory, 'manifest.json'), 'utf8'), 'Historical metadata must remain.\n');
});
test('payload retirement rejects an altered hash or escaped/unlisted member before deletion', async () => {
  const fixture = await smallPayloadFixture();
  await fs.writeFile(path.join(fixture.directory, 'database.dump'), 'Changed synthetic content.\n');
  await assert.rejects(() => planBackupPayloadRetirement(fixture.directory, fixture.files), /PF_CLEANUP_BACKUP_FILE_CHANGED/);
  await assert.rejects(() => planBackupPayloadRetirement(fixture.directory, [{ ...fixture.files[0], path: '../database.dump' }, ...fixture.files.slice(1)]), /PF_CLEANUP_PAYLOAD_ALLOWLIST_REQUIRED/);
  assert.equal((await fs.readdir(fixture.directory)).length, 9);
});
test('payload retirement refuses a junction and leaves all target files intact', async () => {
  const fixture = await smallPayloadFixture(), link = fixture.directory + '-junction';
  await fs.symlink(fixture.directory, link, process.platform === 'win32' ? 'junction' : 'dir');
  await assert.rejects(() => planBackupPayloadRetirement(link, fixture.files), /ARCHIVE_LINK_REJECTED/);
  assert.equal((await fs.readdir(fixture.directory)).length, 9);
});
