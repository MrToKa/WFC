// Disposable own engineer for computer-use access checks; credentials stay private.
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const directory = path.join(root, 'pathfinder-engine/.scratch/pathfinder-local');
const runtime = JSON.parse(await fs.readFile(path.join(directory, 'runtime-state.json'), 'utf8'));
assert.equal(runtime.project, 'wfc-pathfinder-local'); assert.equal(Number(runtime.port), 5190);
const credentials = JSON.parse(await fs.readFile(path.join(directory, 'demo.private.json'), 'utf8'));
const target = path.join(directory, 'ui-role.private.json');
async function request(route, method, body, token) {
  const response = await fetch('http://127.0.0.1:5190' + route, { method, headers: { ...(token ? { authorization: 'Bearer ' + token } : {}), ...(body ? { 'content-type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { status: response.status, body: response.status === 204 ? null : await response.json() };
}
const login = await request('/api/auth/login', 'POST', credentials); assert.equal(login.status, 200); const token = login.body.token;
if (process.argv[2] === 'create') {
  const existing = await fs.stat(target).then(() => true, () => false); assert.equal(existing, false, 'Reuse or clean the existing own fixture explicitly.');
  const input = { email: `pf-ui-${crypto.randomUUID()}@example.invalid`, password: crypto.randomBytes(24).toString('hex') };
  const result = await request('/api/auth/register', 'POST', input); assert.equal(result.status, 201);
  const role = await request(`/api/admin/users/${result.body.user.id}/role`, 'PUT', { role: 'engineer' }, token); assert.equal(role.status, 200);
  await fs.writeFile(target, JSON.stringify({ ...input, userId: result.body.user.id, fixture: 'disposable-pf-ui-engineer' }), { flag: 'wx', mode: 0o600 });
  console.log(JSON.stringify({ status: 'PASS', fixture: 'created-own-disposable-engineer', credentialsPrinted: false }));
} else if (process.argv[2] === 'cleanup') {
  const fixture = JSON.parse(await fs.readFile(target, 'utf8')); assert.equal(fixture.fixture, 'disposable-pf-ui-engineer'); assert.match(fixture.email, /^pf-ui-[a-f0-9-]{36}@example\.invalid$/);
  const result = await request(`/api/admin/users/${fixture.userId}`, 'DELETE', undefined, token); assert.equal(result.status, 204);
  await fs.writeFile(target, JSON.stringify({ userId: fixture.userId, fixture: fixture.fixture, status: 'retired' }));
  console.log(JSON.stringify({ status: 'PASS', fixture: 'own-engineer-removed-credentials-cleared' }));
} else throw Error('Use create or cleanup.');
