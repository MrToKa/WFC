import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validatePairSqlFixture } from './pair-sql-qualification.mjs';

const root = path.resolve(fileURLToPath(new URL('../../', import.meta.url)));
const owner = 'ce473847-dd7c-4f58-b70e-ed5e7c3c3d81', suffix = owner.replaceAll('-', '');
const directory = path.join(root, 'pathfinder-engine/.scratch/cable-workflow-u7-' + owner);
const filename = path.join(directory, 'fixture.private.json');
function fixture() { return { schemaVersion: 'wfc.pf.u7-chain-fixture.v1', owner, database: 'wfc_pfu7_' + suffix,
  databaseUrl: 'postgresql://pfu7:synthetic-unused-password@127.0.0.1:65432/wfc_pfu7_' + suffix,
  containerName: 'pfu7-pg-' + suffix.slice(0, 12), compiledRoot: path.join(root, 'server/dist'), storageRoot: path.join(directory, 'storage') }; }

test('pure configuration validator accepts the synthetic identity without any SQL/Docker/file operation', () => {
  assert.equal(validatePairSqlFixture(fixture(), filename).directory, directory);
});
for (const kind of ['owner', 'database', 'original-checkout', 'storage', 'container', 'remote-host', 'url-database', 'url-options', 'url-user', 'url-protocol', 'filename'])
  test('refuses ' + kind + ' before opening a database', () => {
    const value = fixture(); let target = filename;
    if (kind === 'owner') value.owner = '00000000-0000-4000-8000-000000000001';
    if (kind === 'database') value.database = 'wfc';
    if (kind === 'original-checkout') value.compiledRoot = path.resolve(root, '../WFC/server/dist');
    if (kind === 'storage') value.storageRoot = path.resolve(directory, '../storage');
    if (kind === 'container') value.containerName = 'wfc-app-backend-1';
    if (kind === 'remote-host') value.databaseUrl = value.databaseUrl.replace('127.0.0.1', '192.168.0.2');
    if (kind === 'url-database') value.databaseUrl = value.databaseUrl.replace('/wfc_pfu7_' + suffix, '/wfc');
    if (kind === 'url-options') value.databaseUrl += '?options=-csearch_path=public';
    if (kind === 'url-user') value.databaseUrl = value.databaseUrl.replace('pfu7:', 'postgres:');
    if (kind === 'url-protocol') value.databaseUrl = value.databaseUrl.replace('postgresql:', 'http:');
    if (kind === 'filename') target = path.join(directory, 'other.private.json');
    assert.throws(() => validatePairSqlFixture(value, target));
  });
