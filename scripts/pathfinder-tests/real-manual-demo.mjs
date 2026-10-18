// Seed one clearly labelled QA cable against the retained, actual converted selected network.
// Only the already-owned localhost5190 demonstration is allowed. No original data access.
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { load } from '../pathfinder-local/runtime-lib.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const runtime = await load();
assert.equal(runtime.project, 'wfc-pathfinder-local');
assert.equal(runtime.port, 5190);
const projectId = '105913f0-7ee4-45f2-bfd8-2c01f9be9f2a';
const modelId = '925c0fc0-6e36-4d47-b1ce-38b0beff5953';
const tag = 'PF-MANUAL-DEMO', fromName = '=PF-DEMO-NETWORK-START', toName = '=PF-DEMO-NETWORK-END';
const origin = 'http://127.0.0.1:5190', base = '/api/projects/' + projectId;
const captured = JSON.parse(await fs.readFile(path.join(root, 'docs/pathfinder/evidence/pf7/actual-capture-1792289114650.json'), 'utf8'));
assert.equal(captured.projectId, projectId);
assert.equal(captured.modelVersionId, modelId);
const endpoints = [captured.forward.route.pathPoints[0], captured.forward.route.pathPoints.at(-1)].map(p => [p.x, p.y, p.z]);
assert.ok(endpoints.every(point => point.every(Number.isFinite)));
const credentials = JSON.parse(await fs.readFile(path.join(runtime.runtime, 'demo.private.json'), 'utf8'));
const login = await fetch(origin + '/api/auth/login', {method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(credentials)});
assert.equal(login.status, 200);
const token = (await login.json()).token;
const api = async (method, suffix, body) => {
  const response = await fetch(origin + suffix, {method,headers:{authorization:'Bearer ' + token,...(body ? {'content-type':'application/json'} : {})},...(body ? {body:JSON.stringify(body)} : {})});
  const value = response.status === 204 ? null : await response.json();
  assert.ok(response.ok, method + ' ' + suffix + ' failed (' + response.status + '): ' + String(value?.code ?? value?.message ?? 'request rejected'));
  return value;
};
const getState = () => api('GET', base + '/pathfinder/state');
let state = await getState();
assert.equal(state.activeModel.modelVersionId, modelId);
assert.equal(state.artifacts[0]?.snapshotSha256, captured.snapshotSha256, 'Retained exact captured artifact required.');
const settingsBefore = state.settings;
const types = (await api('GET', base + '/cable-types')).cableTypes;
let type = types.find(item => item.name === 'PF Manual converted-network demo');
if (!type) type = (await api('POST', base + '/cable-types', {name:'PF Manual converted-network demo',purpose:'Explicit local QA fixture; not a business cable or an engineering acceptance claim.'})).cableType;
const locationIds = [];
for (const [index, name] of [fromName, toName].entries()) {
  state = await getState();
  let location = state.locations.find(item => item.name === name);
  if (!location) {
    const created = await api('POST', base + '/pathfinder/locations', {name,aliases:[],expectedRegistryRevision:state.registryRevision});
    state = await getState(); location = state.locations.find(item => item.id === created.locationId);
  }
  assert.ok(location);
  if (location.binding?.status === 'confirmed') {
    assert.deepEqual(location.binding.point, endpoints[index], 'Existing demo location changed; preserve manual edits.');
  } else {
    await api('PUT', base + '/pathfinder/locations/' + location.id + '/binding', {modelVersionId:modelId,
      expectedSelectionRevision:state.activeModel.selectionRevision,expectedRegistryRevision:state.registryRevision,
      point:endpoints[index],objectId:null,externalId:null,derivation:'manual-world-point'});
  }
  locationIds.push(location.id);
}
state = await getState();
let cable = state.cables.find(item => item.tag === tag);
if (!cable) cable = (await api('POST', base + '/cables', {cableId:2147483600,tag,cableTypeId:type.id,mto:'Control',
  fromLocation:fromName,toLocation:toName,designLength:null,installLength:null})).cable;
assert.equal(cable.fromLocation, fromName);
assert.equal(cable.toLocation, toName);
state = await getState();
const job = await api('POST', base + '/pathfinder/jobs', {cableIds:[cable.id],expectedRegistryRevision:state.registryRevision,force:true});
let proposal;
const deadline = Date.now() + 125000;
while (Date.now() < deadline) {
  const current = await api('GET', base + '/pathfinder/jobs/' + job.jobId);
  if (current.status === 'failed' || current.status === 'cancelled') throw Error('Demo job did not complete: ' + current.status);
  state = await getState();
  proposal = state.proposals.find(item => item.jobId === job.jobId && item.cableId === cable.id);
  if (proposal) break;
  if (current.status === 'complete') throw Error('Demo calculation blocked: ' + String(current.items?.[0]?.message ?? 'no proposal'));
  await delay(500);
}
assert.ok(proposal, 'A current proposal or controlled calculation status is required.');
assert.equal(proposal.synthetic, false);
assert.equal(proposal.engineeringAccepted, false);
assert.equal(proposal.acceptanceScope, 'manual-review');
const detail = await api('GET', base + '/pathfinder/proposals/' + proposal.id);
const settingsAfter = (await getState()).settings;
assert.deepEqual(settingsAfter, settingsBefore, 'Demo seeding must not change Project Details allowances/gap.');
const receipt = {schemaVersion:'pathfinder.real-converted-demo.v1',observedAtUtc:new Date().toISOString(),status:proposal.status === 'calculated' ? 'PASS' : 'NEEDS_REVIEW',
  projectId,modelVersionId:modelId,cableId:cable.id,tag,locationIds,endpoints,
  endpointSource:'Exact first/last canonical points from recorded actual converted ordered lookup; QA names are not business equipment identities.',
  sourceReceipt:'../pf7/actual-capture-1792289114650.json',snapshotSha256:captured.snapshotSha256,
  settings:settingsAfter,jobId:job.jobId,proposalId:proposal.id,
  proposal:{status:proposal.status,message:proposal.message,calculationMode:proposal.calculationMode,design:proposal.design,route:detail.proposal?.route ?? detail.route ?? proposal.route},
  validation:'manual-review; user engineering acceptance pending; native parity not performed',
  cableApplyPerformed:false,projectSettingsChanged:false,originalApplicationOrDataAccessed:false,credentialsRecorded:false};
const output = path.join(root, 'docs/pathfinder/evidence/manual-settings', 'real-demo-' + Date.now() + '.json');
await fs.mkdir(path.dirname(output), {recursive:true});
const revoke = await fetch(origin + '/api/viewer-sessions/revoke-login', {method:'POST',headers:{authorization:'Bearer ' + token,origin}});
assert.equal(revoke.status, 204, 'Revoke only this seeding login; keep the browser login separate.');
receipt.seedingLoginRevoked = true;
await fs.writeFile(output, JSON.stringify(receipt,null,2) + '\n', {flag:'wx'});
console.log(JSON.stringify({status:receipt.status,output,projectId,cableId:cable.id,proposalId:proposal.id,calculationStatus:proposal.status,applyPerformed:false,settingsChanged:false}));
