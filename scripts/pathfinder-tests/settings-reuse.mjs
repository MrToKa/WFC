// Observe server-owned results after the operator changes Details through the UI.
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const projectId = '54cfad40-bd12-41e9-ab24-d90bdaafc993', reserve = process.argv[2];
assert.ok(['6','7'].includes(reserve));
const expectedDesign = reserve === '7' ? '19' : '18';
const credentials = JSON.parse(await fs.readFile(path.join(root, 'pathfinder-engine/.scratch/pathfinder-local/demo.private.json'), 'utf8'));
const login = await fetch('http://127.0.0.1:5190/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(credentials) });
assert.equal(login.status, 200); const token = (await login.json()).token;
const get = async suffix => { const response = await fetch(`http://127.0.0.1:5190/api/projects/${projectId}/pathfinder${suffix}`, { headers: { authorization: 'Bearer ' + token } }); assert.equal(response.status, 200); return response.json(); };
const end = Date.now() + 45000; let state, proposals;
while (Date.now() < end) {
  state = await get('/state');
  assert.equal(Number(state.settings.endConnectionLength), Number(reserve));
  proposals = state.cables.map(cable => state.proposals.find(value => value.cableId === cable.id && !value.stale && value.status === 'calculated'));
  if (proposals.length === 2 && proposals.every(value => value?.design?.designLengthMeters === expectedDesign)) break;
  await delay(250);
}
assert.ok(proposals.length === 2 && proposals.every(Boolean), 'Both independent proposals must finish.');
for (const proposal of proposals) { assert.equal(proposal.design.designLengthMeters, expectedDesign); assert.equal(proposal.calculationMode, 'design'); assert.equal(proposal.route.lengthMeters, 10); }
assert.equal(Number(state.cables.find(value => value.tag === 'SYNTHETIC-1').designLength), 18, 'Automatic recalculation must not overwrite applied cable values.');
const result = { schemaVersion: 'pathfinder.settings-reuse.observation.v1', observedAtUtc: new Date().toISOString(), status: 'PASS', scope: 'actual-details-ui-save-and-server-retained-route-design-recalculation',
  projectId, settings: state.settings, expectedDesign, appliedCableLengthStill: 18, proposals: proposals.map(value => ({ id: value.id, cableId: value.cableId, calculationMode: value.calculationMode, design: value.design, lengthMeters: value.route.lengthMeters })), credentialsRecorded: false };
const output = path.join(root, 'docs/pathfinder/evidence/pf7', `settings-reuse-${Date.now()}.json`); await fs.writeFile(output, JSON.stringify(result, null, 2) + '\n', { flag: 'wx' });
console.log(JSON.stringify({ status: 'PASS', output, reserve, expectedDesign, calculationMode: 'design', proposals: proposals.length, appliedValuesOverwritten: false }));
