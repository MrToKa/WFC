import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validatePrioritySqlFixture } from './priority-sql-qualification.mjs';

const root = path.resolve(fileURLToPath(new URL('../../', import.meta.url)));
const owner = 'ce473847-dd7c-4f58-b70e-ed5e7c3c3d81', suffix = owner.replaceAll('-', '');
const directory = path.join(root, 'pathfinder-engine/.scratch/cable-workflow-u7-' + owner), filename = path.join(directory, 'fixture.private.json');
const fixture = () => ({ schemaVersion: 'wfc.pf.u7-chain-fixture.v1', owner, database: 'wfc_pfu7_' + suffix,
  databaseUrl: 'postgresql://pfu7:synthetic-unused-password@127.0.0.1:65432/wfc_pfu7_' + suffix,
  containerName: 'pfu7-pg-' + suffix.slice(0, 12), compiledRoot: path.join(root, 'server/dist'), storageRoot: path.join(directory, 'storage') });

test('priority qualification accepts only the maintained synthetic U7 identity before any IO', () => {
  assert.equal(validatePrioritySqlFixture(fixture(), filename).directory, directory);
});
for (const kind of ['database', 'host', 'owner', 'container', 'compiled', 'storage', 'options', 'filename'])
  test('priority qualification refuses mismatched ' + kind + ' without any Docker or database operation', () => {
    const value = fixture(); let target = filename;
    if (kind === 'database') value.database = 'wfc_pathfinder_local';
    if (kind === 'host') value.databaseUrl = value.databaseUrl.replace('127.0.0.1', '192.168.0.2');
    if (kind === 'owner') value.owner = '00000000-0000-4000-8000-000000000001';
    if (kind === 'container') value.containerName = 'wfc-app-backend-1';
    if (kind === 'compiled') value.compiledRoot = path.join(root, '../WFC/server/dist');
    if (kind === 'storage') value.storageRoot = path.join(root, 'pathfinder-engine/.scratch/unrelated');
    if (kind === 'options') value.databaseUrl += '?options=-csearch_path=public';
    if (kind === 'filename') target = path.join(directory, 'other.private.json');
    assert.throws(() => validatePrioritySqlFixture(value, target));
  });
