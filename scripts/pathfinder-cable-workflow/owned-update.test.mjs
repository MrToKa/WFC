import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { SOURCE, assertSource, assertTarget, assertOperation, outsideIdentity, main } from './owned-update.mjs';
import { ROOT } from '../pathfinder-local/runtime-lib.mjs';

const operationId = '93000000-0000-4000-8000-000000000001', targetOwner = '93000000-0000-4000-8000-000000000002';
const scratch = path.join(ROOT, 'pathfinder-engine/.scratch');
function source() { return { format: 'WFC-PF-LOCAL', schemaVersion: 1, root: ROOT, ...SOURCE,
  tags: { api: 'wfc-pathfinder-api:8fffd6b8c896-initial', web: 'wfc-pathfinder-web:8fffd6b8c896-initial' }, envSha256: 'a'.repeat(64) }; }
function config() { const directory = path.join(scratch, 'cable-workflow-u8-' + operationId); return {
  schemaVersion: 'wfc.pf.owned-update.v1', operationId, source: SOURCE, directory,
  targetRuntime: path.join(directory, 'restore-5192'), backup: path.join(directory, 'backup'), companion: path.join(directory, 'backup-companion.private.json'),
  inventory: { sha256: 'a'.repeat(64) }, operatorSha256: 'b'.repeat(64) }; }
function target() { return { ...source(), owner: targetOwner, project: 'wfc-pathfinder-local-123456789abc', runtime: config().targetRuntime, port: 5192,
  tags: { api: 'wfc-pathfinder-api:930000000000-initial', web: 'wfc-pathfinder-web:930000000000-initial' } }; }

test('only the exact owned 5191 source is accepted without any runtime execution', () => assert.equal(assertSource(source()).port, 5191));
for (const [kind, value] of [['owner', targetOwner], ['project', 'wfc-app'], ['runtime', path.join(scratch, 'pathfinder-local')], ['port', 5190], ['port', 5180]])
  test('source refuses changed ' + kind + '=' + value, () => assert.throws(() => assertSource({ ...source(), [kind]: value })));
test('only a fresh separate exact 5192 target is accepted', () => assert.equal(assertTarget(config(), target()).owner, targetOwner));
for (const [kind, value] of [['owner', SOURCE.owner], ['project', SOURCE.project], ['project', 'wfc-pathfinder-local'],
  ['runtime', SOURCE.runtime], ['runtime', path.join(config().directory, 'restore-51920')], ['port', 5191], ['port', 5190]])
  test('target refuses protected or swapped ' + kind + '=' + value, () => assert.throws(() => assertTarget(config(), { ...target(), [kind]: value })));
test('operation binds every output below its own UUID directory', () => assert.equal(assertOperation(config(), config().directory).operationId, operationId));
for (const kind of ['directory', 'backup', 'companion', 'targetRuntime', 'source', 'operatorSha256', 'inventory'])
  test('operation refuses changed ' + kind, () => { const value = config();
    value[kind] = kind === 'source' ? { ...SOURCE, port: 5190 } : kind === 'inventory' ? { sha256: 'not-sha' } : SOURCE.runtime;
    assert.throws(() => assertOperation(value, config().directory)); });
test('outside process restart and endpoint IP observations do not alter preserved identity', () => {
  const before = { id: 'container1', name: 'original', image: 'image1', config: { Labels: { owner: 'original' } }, host: { RestartPolicy: { Name: 'always' } },
    mounts: [{ Name: 'original-db', Destination: '/data', RW: true }], running: true, startedAt: 'before', networks: [['original', { NetworkID: 'net1', IPAddress: 'one', EndpointID: 'e1' }]] };
  const after = { ...before, running: false, startedAt: 'after', networks: [['original', { NetworkID: 'net1', IPAddress: 'two', EndpointID: 'e2' }]] };
  assert.deepEqual(outsideIdentity(before), outsideIdentity(after));
  for (const change of [{ image: 'other' }, { id: 'replaced' }, { mounts: [] }, { host: {} }, { config: {} }, { networks: [['original', { NetworkID: 'foreign' }]] }])
    assert.notDeepEqual(outsideIdentity(before), outsideIdentity({ ...after, ...change }));
});
test('CLI refuses implicit/default runtime and unknown flags before operations', async () => {
  for (const args of [['backup'], ['restore', '--operation', 'relative'], ['init', '--operation'], ['backup', '--secret', 'never']]) await assert.rejects(main(args));
});
