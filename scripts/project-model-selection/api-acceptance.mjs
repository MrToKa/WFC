import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { fixturePool, actor, emptyProject, call, list, select, prepareModels, safeFacts, privateMetadata, viewerSession, modelPath, makeVariantUnavailable } from './fixture-helpers.mjs';

const pool = fixturePool();
const report = { startedAt: new Date().toISOString(), status: 'RUNNING', cases: [] };
const target = process.env.MODEL_REGISTRY_EVIDENCE ?? `/evidence/selection-contracts-${Date.now()}.json`;
const step = async (name, work) => { const startedAt = new Date().toISOString(); await work(); report.cases.push({ name, status: 'PASS', startedAt, finishedAt: new Date().toISOString() }); };
try {
  if (process.argv.includes('--verify-restart')) {
    const prior = JSON.parse(await fs.readFile(process.env.MODEL_REGISTRY_MAIN_EVIDENCE, 'utf8'));
    const editor = await actor(pool, prior.facts.projectId), current = await list(prior.facts.projectId, editor.token);
    assert.deepEqual(current.selection, prior.facts.selection);
    assert.equal(current.versions.find(v => v.id === prior.facts.modelA.id)?.health, 'healthy');
    const session = await viewerSession(prior.facts.projectId, prior.facts.modelA.id, editor.token);
    const descriptor = await call(session.path + 'descriptor', { cookie: session.cookie, worker: 'http://api2:4000' });
    assert.equal(descriptor.status, 200); assert.equal(descriptor.value.modelVersionId, prior.facts.modelA.id);
    report.facts = prior.facts; report.cases.push({ name: 'Actual two-worker restart preserves selection/revision and permits a fresh resource session', status: 'PASS' });
  } else if (process.argv.includes('--contracts-only')) {
    const id = await emptyProject(pool), editor = await actor(pool, id), reader = await actor(pool, id, { role: 'basic' });
    await step('Registry GET/HEAD are private no-store and legacy JWT remains accepted', async () => {
      const value = await list(id, editor.legacyToken); assert.equal(value.selection.activeModelVersionId, null);
      const head = await call(modelPath(id) + '/model-versions', { token: editor.legacyToken, method: 'HEAD' }); assert.equal(head.status, 200); privateMetadata(head);
      assert.equal((await list(id, reader.token)).versions.length, 0);
    });
    await step('Legacy editor PATCH uses exact CAS with private success and controlled business errors', async () => {
      const saved = await select(id, editor.legacyToken, null, 0); assert.equal(saved.status, 200); privateMetadata(saved); assert.equal(saved.value.selection.selectionRevision, 1);
      const stale = await select(id, editor.token, null, 0); assert.equal(stale.status, 409); assert.equal(stale.value.code, 'SELECTION_CONFLICT'); privateMetadata(stale);
      const invalid = await call(modelPath(id) + '/active-model', { token: editor.token, method: 'PATCH', body: { modelVersionId: null, expectedSelectionRevision: 1, extra: true } }); assert.equal(invalid.status, 400); privateMetadata(invalid);
      assert.equal((await select(id, reader.token, null, 1)).status, 403);
      const session = await call(`${modelPath(id)}/model-versions/${randomUUID()}/viewer-sessions`, { token: editor.legacyToken, method: 'POST', body: { loadId: randomUUID() } }); assert.equal(session.status, 401); assert.equal(session.value.code, 'LOGIN_REFRESH_REQUIRED');
    });
    report.projectId = id;
  } else {
    const fixture = await prepareModels(pool), { projectId, editor, a, b } = fixture;
    assert.equal(fixture.selection.activeModelVersionId, null); assert.equal(fixture.selection.selectionRevision, 0);
    const reader = await actor(pool, projectId, { role: 'basic' }); let revision = 0, oldSession;
    await step('Actual Aalborg ZIP imports with no automatic selection; equal labels have distinct version/content identities', async () => {
      assert.equal((await list(projectId, reader.token)).versions.length, 2);
      for (const v of (await list(projectId, editor.token)).versions) for (const forbidden of ['manifest', 'storagePrefix', 'ownerImportId']) assert.equal(forbidden in v, false);
    });
    await step('Explicit real-Aalborg selection and actual cookie resource descriptor across workers', async () => {
      const saved = await select(projectId, editor.token, a.id, revision); assert.equal(saved.status, 200); privateMetadata(saved); revision++;
      oldSession = await viewerSession(projectId, a.id, editor.token); assert.equal((await call(oldSession.path + 'descriptor', { cookie: oldSession.cookie, worker: 'http://api2:4000' })).status, 200);
    });
    await step('Explicit null fences the old resource session and stale cross-worker revision returns409', async () => {
      const cleared = await select(projectId, editor.token, null, revision, 'http://api2:4000'); assert.equal(cleared.status, 200); revision++;
      const stale = await select(projectId, editor.token, b.id, revision - 1); assert.equal(stale.status, 409); assert.equal(stale.value.code, 'SELECTION_CONFLICT'); privateMetadata(stale);
      assert.equal((await call(oldSession.path + 'resources/output/0/0.svf', { cookie: oldSession.cookie })).status, 409);
    });
    await step('Distinct-content B then explicit Aalborg reselect cannot revive the old A session', async () => {
      for (const versionId of [b.id, a.id]) { const saved = await select(projectId, editor.token, versionId, revision); assert.equal(saved.status, 200); revision++; }
      assert.equal((await call(oldSession.path + 'descriptor', { cookie: oldSession.cookie })).status, 409);
      const fresh = await viewerSession(projectId, a.id, editor.token); assert.equal((await call(fresh.path + 'descriptor', { cookie: fresh.cookie })).status, 200);
    });
    await step('Read-only and legacy JWT registry policies remain separate from resource login binding', async () => {
      assert.equal((await list(projectId, reader.token)).selection.activeModelVersionId, a.id);
      assert.equal((await select(projectId, reader.token, null, revision)).status, 403);
      assert.equal((await list(projectId, editor.legacyToken)).selection.selectionRevision, revision);
    });
    await step('Actual unavailable candidate returns503 without replacing the authoritative active model', async () => {
      await makeVariantUnavailable(pool, projectId, b.id);
      const failed = await select(projectId, editor.token, b.id, revision); assert.equal(failed.status, 503); assert.equal(failed.value.code, 'MODEL_UNAVAILABLE'); privateMetadata(failed);
      const current = await list(projectId, editor.token); assert.equal(current.selection.activeModelVersionId, a.id); assert.equal(current.selection.selectionRevision, revision);
      assert.equal(current.versions.find(v => v.id === b.id).health, 'unavailable');
    });
    fixture.selection = (await list(projectId, editor.token)).selection; assert.equal(fixture.selection.selectionRevision, revision);
    report.facts = safeFacts(fixture);
  }
  report.status = 'PASS';
} catch (error) { report.status = 'FAIL'; report.failure = { name: error.name, message: String(error.message).slice(0, 1000) }; throw error; }
finally { report.finishedAt = new Date().toISOString(); await fs.writeFile(target, JSON.stringify(report, null, 2) + '\n', { flag: 'wx' }); await pool.end(); }
console.log(JSON.stringify({ status: report.status, cases: report.cases.length, evidence: target }));
