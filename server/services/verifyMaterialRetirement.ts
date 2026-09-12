/** Opt-in schema-4 integration. Uses only wfc_verify_* databases; retired fixture rows intentionally remain. */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { parse } from 'dotenv';
import { MATERIAL_CAPABILITIES } from './materialCapabilities.js';
import type { StandardMaterialOwnerCategory } from '../models/standardMaterial.js';

const database = process.argv[2];
if (!database || !/^wfc_verify_[a-z0-9_]+$/.test(database)) throw new Error('An isolated wfc_verify_* database is required');
const url = new URL(parse(readFileSync('server/.env')).DATABASE_URL);
url.pathname = `/${database}`; process.env.DATABASE_URL = url.toString();
const { pool } = await import('../db.js');
const { createApp } = await import('../app.js');
const { signAccessToken } = await import('../auth.js');
const { assertDatabaseCompatible } = await import('../migrations/runner.js');
const { getMutationRevision } = await import('./mutationService.js');
const { STANDARD_MATERIAL_MUTATION_SCOPE: scope } = await import('./standardMaterialService.js');
const { createChangeOrder, addChangeOrderItem, getChangeOrder, calculateMinimumOrder } = await import('./changeOrderService.js');
const { CatalogMaterialNotFoundError } = await import('./changeOrderCatalogService.js');
const { withTransaction } = await import('../utils/transaction.js');
const admin = randomUUID(), engineer = randomUUID(), ordinary = randomUUID();
const project = randomUUID(), otherProject = randomUUID();
const fixtures: Array<{ category: StandardMaterialOwnerCategory; id: string; edge: string }> = [];
const paths: Record<StandardMaterialOwnerCategory, string> = {
  'cable-type': 'cable-types', 'cable-installation-material': 'cable-installation-materials',
  'tray-installation-material': 'tray-installation-materials', instrument: 'instruments',
  'instrument-installation-material': 'instrument-installation-materials', tray: 'trays', support: 'supports',
};
const server = createApp().listen(0, '127.0.0.1');
await new Promise<void>((resolve) => server.once('listening', resolve));
const address = server.address(); assert(address && typeof address !== 'string');
const base = `http://127.0.0.1:${address.port}`;
const token = (id: string) => signAccessToken(id, `${id}@example.invalid`, id === admin).token;
const call = async (path: string, actor: string, method = 'GET', body?: unknown, revision?: number, key = randomUUID()) => {
  const response = await fetch(base + path, { method, headers: {
    Authorization: `Bearer ${token(actor)}`, 'Content-Type': 'application/json', 'Idempotency-Key': key,
    ...(revision === undefined ? {} : { 'If-Match': String(revision) }),
  }, body: body === undefined ? undefined : JSON.stringify(body) });
  const data = response.headers.get('content-type')?.includes('application/json') ? await response.json() as Record<string, unknown> : null;
  return { status: response.status, data };
};
try {
  assert.equal((await pool.query('SELECT current_database() AS name')).rows[0].name, database);
  await assertDatabaseCompatible(pool);
  for (const id of [admin, engineer, ordinary]) await pool.query(
    'INSERT INTO users(id,email,password_hash,is_admin) VALUES ($1,$2,$3,$4)', [id, `${id}@example.invalid`, 'not-a-login-hash', id === admin]);
  for (const id of [project, otherProject]) await pool.query(
    'INSERT INTO projects(id,project_number,name,customer) VALUES ($1,$2,$3,$4)', [id, `Verify ${id}`, 'Verification', 'Synthetic']);
  assert.equal((await call(`/api/admin/users/${engineer}/project-access`, ordinary, 'PUT', { projectIds: [project] })).status, 403);
  assert.equal((await call(`/api/admin/users/${engineer}/project-access`, admin, 'PUT', { projectIds: [project] })).status, 200);
  const profile = await call('/api/users/me', engineer);
  assert.deepEqual((profile.data?.user as { engineerProjectIds: string[] }).engineerProjectIds, [project]);
  assert.equal((await call(`/api/projects/${project}`, engineer, 'PATCH', { name: 'Forbidden' })).status, 403);
  assert.equal((await call(`/api/projects/${otherProject}/support-distances`, engineer, 'PUT', { supportDistances: {} })).status, 403);
  assert.equal((await call(`/api/projects/${project}/support-distances`, engineer, 'PUT', { supportDistances: {}, name: 'Forbidden' })).status, 400);
  assert.equal((await call(`/api/projects/${project}/support-distances`, engineer, 'PUT', { supportDistances: {} })).status, 200);
  assert.equal((await call('/api/materials/cable-types', engineer, 'POST', { name: 'Forbidden' })).status, 403);
  assert.equal((await call('/api/materials/cable-types/export', ordinary)).status, 403);
  assert.equal((await call('/API/Materials/Cable-Types/EXPORT', ordinary)).status, 403);
  assert.equal((await call('/api/materials/cable-types/export', engineer)).status, 200);
  assert.equal((await call(`/api/projects/${project}/trays/export`, ordinary, 'POST', {})).status, 200);
  for (const collection of ['change-orders', 'internal-ncrs']) {
    const revision = await getMutationRevision(pool, 'change-order-collection', project);
    const created = await call(`/api/projects/${project}/${collection}`, engineer, 'POST', {
      title: 'Engineer document', preparedBy: 'Verifier', reportDate: '2026-09-12', revision: '01',
    }, revision);
    assert.equal(created.status, 201, JSON.stringify(created.data));
    assert.equal((await call(`/api/projects/${otherProject}/${collection}`, engineer, 'POST', {})).status, 403);
    assert.equal((await call(`/api/projects/${project}/${collection}`, ordinary, 'POST', {})).status, 403);
  }
  assert.equal((await call(`/api/admin/users/${engineer}/project-access`, admin, 'PUT', { projectIds: [] })).status, 200);
  assert.equal((await call(`/api/projects/${project}/support-distances`, engineer, 'PUT', { supportDistances: {} })).status, 403);
  const children = new Map<string, string>();
  for (const category of ['cable-installation-material', 'tray-installation-material', 'instrument-installation-material'] as const) {
    const capability = MATERIAL_CAPABILITIES[category], id = randomUUID();
    children.set(capability.ownerTable, id);
    await pool.query(`INSERT INTO ${capability.ownerTable}(id,type) VALUES ($1,$2)`, [id, `Verification child ${id}`]);
  }
  for (const category of Object.keys(MATERIAL_CAPABILITIES) as StandardMaterialOwnerCategory[]) {
    const capability = MATERIAL_CAPABILITIES[category], id = randomUUID(), edge = randomUUID();
    await pool.query(`INSERT INTO ${capability.ownerTable}(id,${capability.ownerNameColumn}) VALUES ($1,$2)`, [id, `Verification ${id}`]);
    await pool.query(`INSERT INTO ${capability.assignmentTable}(id,${capability.assignmentOwnerColumn},referenced_material_id,quantity,unit) VALUES($1,$2,$3,1,'pcs')`, [edge,id,children.get(capability.referencedMaterialTable)]);
    fixtures.push({ category, id, edge });
    const order = await withTransaction(async (client) => {
      const order = await createChangeOrder(project, 'change-order', admin, { title: 'Retirement snapshot', preparedBy: 'Verifier', reportDate: '2026-09-12', revision: '01' }, client);
      await addChangeOrderItem(project, 'change-order', order.id, category, id, client);
      return order;
    });
    const before = await getChangeOrder(project, 'change-order', order.id);
    const initial = await getMutationRevision(pool, scope.resourceType, scope.resourceId), key = randomUUID();
    const path = `/api/materials/${paths[category]}/${id}`;
    assert.equal((await call(path, engineer, 'DELETE', undefined, initial)).status, 403);
    const retired = await call(path, admin, 'DELETE', undefined, initial, key);
    assert.equal(retired.status, 200, JSON.stringify(retired.data)); assert.equal(retired.data?.obsolete, true);
    assert.deepEqual((await call(path, admin, 'DELETE', undefined, initial, key)).data, retired.data);
    const history = (await pool.query('SELECT snapshot FROM mutation_history WHERE resource_type=$1 AND resource_id=$2 AND revision=$3',
      [scope.resourceType, scope.resourceId, retired.data?.mutationRevision])).rows[0].snapshot;
    const beforeCategory = history.before.categories.find((item: { category: string }) => item.category === category);
    const afterCategory = history.after.categories.find((item: { category: string }) => item.category === category);
    assert.equal(beforeCategory.owners.find((item: { id: string }) => item.id === id).obsolete_at, null);
    assert(afterCategory.owners.find((item: { id: string }) => item.id === id).obsolete_at);
    assert.deepEqual(afterCategory.assignments, beforeCategory.assignments);
    assert.equal((await pool.query(`SELECT obsolete_at FROM ${capability.ownerTable} WHERE id=$1`, [id])).rows.length, 1);
    assert((await pool.query(`SELECT obsolete_at FROM ${capability.ownerTable} WHERE id=$1`, [id])).rows[0].obsolete_at);
    assert.equal((await pool.query(`SELECT id FROM ${capability.assignmentTable} WHERE id=$1`, [edge])).rows.length, 1);
    assert.equal((await call(path, ordinary)).status, 200);
    const list = await call(`/api/materials/${paths[category]}${category === 'tray' || category === 'support' ? '/all' : ''}`, ordinary);
    assert.equal(list.status, 200);
    assert(!Object.values(list.data ?? {}).some((value) => Array.isArray(value) && value.some((row: { id: string }) => row.id === id)));
    assert.deepEqual((await getChangeOrder(project, 'change-order', order.id))?.items, before?.items);
    await assert.rejects(pool.query(`DELETE FROM ${capability.ownerTable} WHERE id=$1`, [id]), (error: unknown) => (error as { code: string }).code === '23514');
    await assert.rejects(withTransaction((client) => addChangeOrderItem(project, 'change-order', order.id, category, id, client)), CatalogMaterialNotFoundError);
  }
  const archive = await call('/api/materials/obsolete', ordinary);
  assert.equal(archive.status, 200);
  assert(fixtures.every((fixture) => (archive.data?.materials as Array<{ id: string }>).some((row) => row.id === fixture.id)));
  const raceRevision = await getMutationRevision(pool, scope.resourceType, scope.resourceId);
  const race = await Promise.all(fixtures.slice(0, 2).map(({ category, id }) =>
    call(`/api/materials/${paths[category]}/${id}`, admin, 'DELETE', undefined, raceRevision)));
  assert.deepEqual(race.map((result) => result.status).sort(), [200, 409]);
  const incoming = [...children.entries()][0];
  await pool.query(`UPDATE ${incoming[0]} SET obsolete_at=NOW() WHERE id=$1`, [incoming[1]]);
  assert.equal((await pool.query('SELECT count(*)::int AS count FROM material_cable_type_standard_materials WHERE referenced_material_id=$1', [incoming[1]])).rows[0].count, 1);
  assert.deepEqual(calculateMinimumOrder(102, 102, 100), { orderQuantity: 102, packageCount: 2, spareQuantity: 98 });
  console.log(JSON.stringify({ database, passed: ['assigned-project-only engineer access', 'CO and Internal NCR engineer writes', 'strict main-settings separation', 'ordinary-user write denial', 'revocation with existing token', 'all seven catalog retirements', 'retained rows and composition edges', 'direct physical deletion denied', 'retained Change Order values', 'active lists and obsolete archive', 'new obsolete selection denied', 'exact retirement replay', '102 units / 2 packages / 98 spare'] }));
} finally {
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  await pool.end();
}
