import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { ROOT, contained, validProject, validateState, load, configuration, claimsProject, start, retire } from './runtime-lib.mjs';
import { artifactInventory } from './container-ops.mjs';

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
