// End-to-end registry checks against the owned loopback candidate only.
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const origin = 'http://127.0.0.1:5190';
const runtime = JSON.parse(await fs.readFile(path.join(root, 'pathfinder-engine/.scratch/pathfinder-local/runtime-state.json'), 'utf8'));
assert.equal(runtime.project, 'wfc-pathfinder-local'); assert.equal(Number(runtime.port), 5190);
const credentials = JSON.parse(await fs.readFile(path.join(root, 'pathfinder-engine/.scratch/pathfinder-local/demo.private.json'), 'utf8'));
const checks = [], stamp = new Date().toISOString().replaceAll(/[:.]/g, '-');
let token, projectId, userId;
async function request(route, method = 'GET', body, bearer = token) {
  const response = await fetch(origin + route, { method, signal: AbortSignal.timeout(30000), headers: {
    ...(bearer ? { authorization: 'Bearer ' + bearer } : {}), ...(body === undefined ? {} : { 'content-type': 'application/json' })
  }, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await response.text(); return { status: response.status, body: text ? JSON.parse(text) : null };
}
async function test(name, action) {
  try { await action(); checks.push({ name, status: 'PASS' }); }
  catch (error) { checks.push({ name, status: 'FAIL', message: error.message }); }
}
try {
  const login = await request('/api/auth/login', 'POST', credentials, null); assert.equal(login.status, 200, 'Own demo admin login failed'); token = login.body.token;
  const created = await request('/api/projects', 'POST', { projectNumber: 'PF3-HTTP-' + crypto.randomUUID(), name: 'Disposable PF3 HTTP fixture', customer: 'Isolated test', secondaryTrayLength: 3, endConnectionLength: 5, additionalBendingPercent: 10 });
  assert.equal(created.status, 201, 'Own HTTP fixture project failed'); projectId = created.body.project.id;
  const endpoint = `/api/projects/${projectId}/pathfinder`;
  await test('unauthenticated-read-denied', async () => assert.equal((await request(endpoint + '/state', 'GET', undefined, null)).status, 401));
  await test('admin-state-with-authoritative-details-and-empty-own-registry', async () => {
    const response = await request(endpoint + '/state'); assert.equal(response.status, 200); assert.equal(response.body.projectId, projectId);
    assert.deepEqual(response.body.locations, []); assert.equal(Number(response.body.settings.secondaryTrayLength), 3); assert.equal(Number(response.body.settings.endConnectionLength), 5);
  });
  let registry = '0', location;
  await test('project-location-and-alias-created-once', async () => {
    const response = await request(endpoint + '/locations', 'POST', { name: '=A001', aliases: ['=Common'], expectedRegistryRevision: registry });
    assert.equal(response.status, 201); location = response.body.locationId; registry = response.body.registryRevision; assert.equal(registry, '1');
  });
  await test('alias-collision-denied', async () => assert.equal((await request(endpoint + '/locations', 'POST', { name: '=B001', aliases: [' =common '], expectedRegistryRevision: registry })).status, 409));
  await test('stale-registry-write-denied', async () => assert.equal((await request(endpoint + '/locations', 'POST', { name: '=C001', aliases: [], expectedRegistryRevision: '0' })).status, 409));
  await test('location-rename-alias-cas-persists', async () => {
    const response = await request(endpoint + '/locations/' + location, 'PUT', { name: '=A001', aliases: ['=Common', '=Reusable'], expectedRegistryRevision: registry });
    assert.equal(response.status, 200); registry = response.body.registryRevision;
    const state = (await request(endpoint + '/state')).body; assert.equal(state.registryRevision, registry); assert.equal(state.locations[0].id, location); assert.ok(state.locations[0].aliases.includes('=Reusable'));
  });
  await test('binding-to-nonselected-model-denied', async () => assert.equal((await request(endpoint + '/locations/' + location + '/binding', 'PUT', {
    modelVersionId: crypto.randomUUID(), expectedSelectionRevision: '0', expectedRegistryRevision: registry, point: [1, 2, 3], objectId: null, externalId: null
  })).status, 409));
  await test('nonfinite-manual-coordinates-denied', async () => assert.equal((await request(endpoint + '/locations/' + location + '/binding', 'PUT', {
    modelVersionId: crypto.randomUUID(), expectedSelectionRevision: '0', expectedRegistryRevision: registry, point: [null, 2, 3], objectId: null, externalId: null
  })).status, 400));
  await test('unknown-proof-request-field-denied', async () => assert.equal((await request(endpoint + '/locations', 'POST', { name: '=D001', aliases: [], expectedRegistryRevision: registry, engineeringAccepted: true })).status, 400));
  await test('another-project-registry-not-leaked', async () => {
    const response = await request(`/api/projects/${runtime.demo.projectId}/pathfinder/state`); assert.equal(response.status, 200); assert.ok(!response.body.locations.some(value => value.id === location));
  });
  const registered = await request('/api/auth/register', 'POST', { email: `pf3-${crypto.randomUUID()}@example.invalid`, password: crypto.randomBytes(24).toString('hex') }, null);
  assert.equal(registered.status, 201, 'Own test user registration failed'); userId = registered.body.user.id; const engineerToken = registered.body.token;
  await test('engineer-role-and-project-read-do-not-grant-pathfinder', async () => {
    assert.equal((await request(`/api/admin/users/${userId}/role`, 'PUT', { role: 'engineer' })).status, 200);
    assert.equal((await request(`/api/projects/${projectId}`, 'GET', undefined, engineerToken)).status, 200);
    assert.equal((await request(endpoint + '/state', 'GET', undefined, engineerToken)).status, 403);
    assert.equal((await request(endpoint + '/locations', 'POST', { name: '=Forbidden', aliases: [], expectedRegistryRevision: registry }, engineerToken)).status, 403);
  });
} catch (error) { checks.push({ name: 'test-setup-or-flow', status: 'FAIL', message: error.message }); }
finally {
  if (projectId) await test('own-fixture-project-removed', async () => assert.equal((await request('/api/projects/' + projectId, 'DELETE')).status, 204));
  if (userId) await test('own-fixture-user-removed', async () => assert.equal((await request('/api/admin/users/' + userId, 'DELETE')).status, 204));
}
const output = path.join(root, 'docs/pathfinder/evidence/pf3/registry-http-' + stamp + '.json'); await fs.mkdir(path.dirname(output), { recursive: true });
const result = { schemaVersion: 'pathfinder.registry.http-tests.v1', observedAtUtc: new Date().toISOString(), origin, scope: 'isolated-owned-runtime-current-admin-registry-cas-and-project-boundary',
  status: checks.every(value => value.status === 'PASS') ? 'PASS' : 'FAIL', passed: checks.filter(value => value.status === 'PASS').length, total: checks.length, checks,
  credentialsRecorded: false, originalRuntimeAccessed: false, realNativeParity: 'BLOCKED; not exercised by these tests', sourceSha256: crypto.createHash('sha256').update(await fs.readFile(fileURLToPath(import.meta.url))).digest('hex') };
await fs.writeFile(output, JSON.stringify(result, null, 2), { flag: 'wx' });
console.log(JSON.stringify({ status: result.status, passed: result.passed, total: result.total, output, failures: checks.filter(value => value.status === 'FAIL') }));
process.exitCode = result.status === 'PASS' ? 0 : 1;
