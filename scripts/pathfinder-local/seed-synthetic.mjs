import fs from 'node:fs/promises';
import path from 'node:path';
import { createReadStream } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { load, save, ownership, request, demoLogin, fail, ROOT } from './runtime-lib.mjs';
import { createDocker, command } from '../operations/docker.mjs';
import { hashFile } from '../operations/archives.mjs';

try {
  const state = await load(), resources = await ownership(state), api = resources.containers.find(item => item.role === 'api' && item.running);
  if (!api || !state.demo?.model) fail('PF_DEMO_MODEL_REQUIRED');
  const current = await (await createDocker()).inspect(api.id);
  if (!current.Config.Env.includes('PF_LOCAL_DEMO=true')) fail('PF_EXPLICIT_LOCAL_DEMO_RUNTIME_REQUIRED');
  const token = await demoLogin(state), copy = path.join(state.runtime, 'aalborg-portable.zip'), identity = await hashFile(copy);
  if (identity.bytes !== 439112840 || identity.sha256 !== 'e3056f28efaa57eef65f81dbdfe41396d9e010bdc975738d1259c58af6c3a922') fail('PF_DEMO_PACKAGE_IDENTITY_CHANGED');
  if (!state.syntheticDemo) {
    const id = randomUUID(), created = await request(state, '/api/projects', { token, method: 'POST', body: { projectNumber: 'PF-SYNTHETIC-' + id.slice(0, 8), name: 'Synthetic PathFinder local acceptance', customer: 'Explicit synthetic acceptance fixture', description: 'Synthetic geometry/locations/cables and trusted fixture hash only. The copied real Viewer model does not gain engineering acceptance. Separate from real Aalborg project.', secondaryTrayLength: 5, endConnectionLength: 6, additionalBendingPercent: 10 } });
    if (created.status !== 201 || !created.value.project?.id) fail('PF_SYNTHETIC_PROJECT_CREATE_FAILED');
    state.syntheticDemo = { projectId: created.value.project.id, actorId: state.demo.adminUserId, idempotencyKey: randomUUID(), status: 'project-created', createdAt: new Date().toISOString() }; await save(state);
  }
  const fixture = state.syntheticDemo, base = `/api/projects/${fixture.projectId}`;
  if (!fixture.modelVersionId) {
    if (!fixture.importId) {
      const response = await fetch(`http://127.0.0.1:${state.port}${base}/model-imports`, { method: 'POST', redirect: 'error', headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/zip', 'Content-Length': String(identity.bytes), 'Idempotency-Key': fixture.idempotencyKey, 'X-Package-SHA256': identity.sha256 }, body: createReadStream(copy), duplex: 'half', signal: AbortSignal.timeout(900000) });
      if (response.status !== 202) fail('PF_SYNTHETIC_MODEL_UPLOAD_FAILED'); fixture.importId = (await response.json()).importId; fixture.status = 'model-importing'; await save(state);
    }
    const deadline = Date.now() + 900000;
    while (Date.now() < deadline) { const progress = await request(state, `${base}/model-imports/${fixture.importId}`, { token }); if (progress.status !== 200 || progress.value.job?.state === 'failed') fail('PF_SYNTHETIC_MODEL_IMPORT_FAILED'); if (progress.value.job.state === 'complete') { fixture.modelVersionId = progress.value.job.modelVersionId; break; } await new Promise(resolve => setTimeout(resolve, 500)); }
    if (!fixture.modelVersionId) fail('PF_SYNTHETIC_MODEL_IMPORT_TIMEOUT'); await save(state);
    const listed = await request(state, base + '/model-versions', { token }), model = listed.value.versions?.find(item => item.id === fixture.modelVersionId);
    if (listed.status !== 200 || model?.contentFingerprint !== state.demo.model.contentFingerprint) fail('PF_SYNTHETIC_MODEL_IDENTITY_FAILED');
    const selected = await request(state, base + '/active-model', { token, method: 'PATCH', body: { modelVersionId: fixture.modelVersionId, expectedSelectionRevision: listed.value.selection.selectionRevision } }); if (selected.status !== 200) fail('PF_SYNTHETIC_SELECTION_FAILED'); fixture.status = 'model-selected'; await save(state);
  }
  if (fixture.status !== 'seeded') {
    const output = await command(['exec', api.id, 'node', 'server/dist/server/pathfinder/demoSeed.js', fixture.projectId, fixture.modelVersionId, fixture.actorId], { maxBytes: 1024 ** 2 });
    let seeded; try { seeded = JSON.parse(output.toString().trim()); } catch { fail('PF_SYNTHETIC_SEED_RESPONSE_INVALID'); }
    if (seeded.scope !== 'local-synthetic-fixture' || seeded.projectId !== fixture.projectId || seeded.modelVersionId !== fixture.modelVersionId || !Array.isArray(seeded.cableIds) || seeded.cableIds.length !== 2 || !/^[a-f0-9]{64}$/.test(seeded.snapshotSha256 ?? '')) fail('PF_SYNTHETIC_SEED_FAILED'); fixture.status = 'seeded'; fixture.seed = seeded; fixture.seededAt = new Date().toISOString(); await save(state);
  }
  const receipt = { schemaVersion: 1, status: 'PASS', scope: 'Explicit separate synthetic geometry/cable acceptance fixture only.', recordedAt: new Date().toISOString(), project: state.project, syntheticFixture: fixture, realModelEngineeringAccepted: false, originalAppWritesByThisTool: 0 };
  const evidence = path.join(ROOT, 'docs/pathfinder/runtime/synthetic-seed-' + Date.now() + '.json'); await fs.writeFile(evidence, JSON.stringify(receipt, null, 2) + '\n', { flag: 'wx' });
  console.log(JSON.stringify({ status: 'PASS', evidence, projectId: fixture.projectId, modelVersionId: fixture.modelVersionId, actorId: fixture.actorId }));
} catch (error) { console.error(JSON.stringify({ status: 'FAIL', code: /^PF_[A-Z_]+$/.test(error.code ?? error.message) ? error.code ?? error.message : 'PF_SYNTHETIC_SEED_FAILED' })); process.exitCode = 1; }
