import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { login, api, json, origin, repository, statePath, saveState } from './poc-client.mjs';

const state = JSON.parse(await fs.readFile(statePath, 'utf8'));
const { token } = await login();
const root = `/api/projects/${state.projectId}/cad-design`;
const read = async route => (await api(token, route)).json();
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const { designs } = await read(root + '/designs');
const design = designs.find(item => item.modelVersionId === state.modelVersionId && item.activeModel);
assert(design && design.status === 'proposed', 'A saved proposal on the active model is required.');
const { instances } = await read(`${root}/designs/${design.id}/instances`);
const { connections } = await read(`${root}/designs/${design.id}/connections`);
const { items } = await read(root + '/catalog');
assert.equal(instances.length, 2, 'Acceptance design must contain exactly the two supplied sample parts.');
assert.equal(connections.length, 1, 'Acceptance design must retain one verified connector relationship.');
assert.equal(new Set(instances.map(item => item.partNumber)).size, 2, 'Straight and bend must retain independent SKUs.');
assert(instances.every(item => item.materialAssetId && item.cadRevision === 1));
const unauth = await fetch(origin + '/api/materials/components');
assert.equal(unauth.status, 401);
const invalid = await fetch(origin + root + '/catalog', { ...json('POST', { assetId: instances[0].materialAssetId, partNumber: 'spoof' }), headers: {
  Authorization: 'Bearer ' + token, 'Content-Type': 'application/json',
} });
assert.equal(invalid.status, 400);
const instance = instances[0];
const transform = { positionMm: { x: instance.xMm, y: instance.yMm, z: instance.zMm },
  rotation: { x: instance.qx, y: instance.qy, z: instance.qz, w: instance.qw } };
const conflict = await fetch(origin + `${root}/designs/${design.id}/instances/${instance.id}`, {
  ...json('PATCH', { expectedRevision: instance.revision, transform: {
    ...transform, positionMm: { ...transform.positionMm, x: transform.positionMm.x + 50 },
  } }), headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
});
assert.equal(conflict.status, 409, 'Connected instances must refuse motion until disconnected.');

const directory = path.join(repository, '.data', 'poc-deliverables');
await fs.mkdir(directory, { recursive: true });
const manifest = { schemaVersion: 1, projectId: state.projectId, modelVersionId: state.modelVersionId,
  modelFingerprint: state.fingerprint, designId: design.id, designRevision: design.revision,
  instances: [], connections, checks: { unauthenticated: 401, metadataOverride: 400, connectedMove: 409 } };
for (const placed of instances) {
  const catalogue = items.find(item => item.id === placed.catalogItemId);
  assert(catalogue && catalogue.materialAssetId === placed.materialAssetId);
  const response = await api(token, `/api/materials/components/${placed.componentId}/cad-assets/${placed.materialAssetId}/download`);
  const bytes = Buffer.from(await response.arrayBuffer());
  assert.equal(sha(bytes), catalogue.sourceSha256);
  const history = await read(`/api/materials/components/${placed.componentId}/cad-assets`);
  assert(history.assets.some(asset => asset.id === placed.materialAssetId && asset.revision === placed.cadRevision));
  if (history.assets.length > 1) {
    assert(history.assets.some(asset => asset.active && asset.sourceSha256 === catalogue.sourceSha256));
    manifest.checks.revisionPinRetained = true;
  }
  const filename = placed.id + '.step';
  await fs.writeFile(path.join(directory, filename), bytes);
  manifest.instances.push({ ...placed, sourceFile: filename, sourceSha256: catalogue.sourceSha256 });
}

if (process.argv.includes('--exercise-revisions')) {
  const placed = instances.find(item => item.partNumber === 'KL 60.303 F');
  assert(placed, 'The known straight catalogue part is required for revision acceptance.');
  const catalogue = items.find(item => item.id === placed.catalogItemId);
  const original = await fs.readFile(path.join(directory, placed.id + '.step'));
  const upload = async bytes => {
    const form = new FormData(); form.set('file', new Blob([bytes], { type: 'application/step' }), catalogue.originalFilename);
    return (await api(token, `/api/materials/components/${placed.componentId}/cad-assets`, { method: 'POST', body: form })).json();
  };
  const repeated = await upload(original);
  assert(repeated.reused, 'Repeated current bytes must reuse the active asset.');
  const variant = Buffer.from(original.toString('utf8').replace('HEADER;', 'HEADER;\n/* WFC isolated PoC revision retention check: geometry unchanged. */'));
  assert.notEqual(sha(variant), sha(original));
  let revised;
  try {
    revised = await upload(variant);
    assert(!revised.reused && revised.id !== placed.materialAssetId);
    const after = await read(`${root}/designs/${design.id}/instances`);
    assert.equal(after.instances.find(item => item.id === placed.id).materialAssetId, placed.materialAssetId);
    const historical = await api(token, `/api/materials/components/${placed.componentId}/cad-assets/${placed.materialAssetId}/download`);
    assert.equal(sha(Buffer.from(await historical.arrayBuffer())), sha(original));
  } finally {
    // Retain the test revision, but publish original manufacturer bytes again as current.
    await upload(original);
  }
  manifest.checks.revisionPinRetained = true;
}

const assembly = await api(token, `${root}/designs/${design.id}/assembly.step`);
assert.equal(assembly.headers.get('x-wfc-source-model-version'), state.modelVersionId);
assert.equal(Number(assembly.headers.get('x-wfc-design-revision')), design.revision);
const assemblyBytes = Buffer.from(await assembly.arrayBuffer());
assert(assemblyBytes.toString('ascii', 0, 100).includes('ISO-10303-21;'));
await fs.writeFile(path.join(directory, 'Aalborg-Proposed-Cable-Trays.step'), assemblyBytes);
const mto = await (await api(token, `${root}/designs/${design.id}/materials.csv`)).text();
const rows = mto.trim().split(/\r?\n/);
assert.equal(rows.length, 3);
for (const placed of instances) {
  const row = rows.find(line => line.includes(placed.materialAssetId));
  assert(row && row.includes(placed.partNumber) && /,\s*"?1"?$/.test(row));
}
await fs.writeFile(path.join(directory, 'Aalborg-Proposed-Cable-Trays-MTO.csv'), mto);
manifest.exports = { assemblyBytes: assemblyBytes.length, assemblySha256: sha(assemblyBytes), mtoRows: rows.length - 1 };
await fs.writeFile(path.join(directory, 'acceptance-manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
await saveState({ ...state, designId: design.id });
console.log(JSON.stringify({ status: 'PASS', directory, instances: instances.length, connections: connections.length,
  checks: manifest.checks, exports: manifest.exports }));
