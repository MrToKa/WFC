// Prepare one missing alias in the explicitly synthetic demo for a manual UI check.
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const projectId = '54cfad40-bd12-41e9-ab24-d90bdaafc993';
const credentials = JSON.parse(await fs.readFile(path.join(root, 'pathfinder-engine/.scratch/pathfinder-local/demo.private.json'), 'utf8'));
const login = await fetch('http://127.0.0.1:5190/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(credentials) });
assert.equal(login.status, 200); const token = (await login.json()).token;
const request = async (route, method = 'GET', body) => {
  const response = await fetch('http://127.0.0.1:5190' + route, { method, headers: { authorization: 'Bearer ' + token, ...(body ? { 'content-type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
  assert.ok(response.ok, `Own fixture request failed ${response.status}`); return response.json();
};
const details = await request(`/api/projects/${projectId}`); assert.match(details.project.projectNumber, /^PF-SYNTHETIC-/);
const both = process.argv[2] === 'both';
const state = await request(`/api/projects/${projectId}/pathfinder/state`), cable = state.cables.find(value => value.tag === (both ? 'SYNTHETIC-1' : 'SYNTHETIC-2'));
assert.ok(cable); assert.equal(both ? cable.fromLocation : cable.toLocation, '=PF-SYNTHETIC-FROM');
await request(`/api/projects/${projectId}/cables/${cable.id}`, 'PATCH', { [both ? 'fromLocation' : 'toLocation']: '=PF-REUSABLE-MANUAL-ALIAS' });
console.log(JSON.stringify({ status: 'PASS', projectId, cableId: cable.id, fixture: 'synthetic-missing-alias-ready-for-ui-resolution' }));
