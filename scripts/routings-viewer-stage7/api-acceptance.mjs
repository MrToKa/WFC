import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { fixturePool, actor, emptyProject, call, list, select, prepareModel, safeFacts, viewerSession, projectPath, seedTrays, changeTray, TRAY_NAMES } from './fixture-helpers.mjs';

const pool = fixturePool(), target = process.env.MODEL_REGISTRY_EVIDENCE ?? `/evidence/routing-contracts-${Date.now()}.json`;
const report = { schemaVersion: 1, startedAt: new Date().toISOString(), status: 'RUNNING', cases: [] };
const step = async (name, work) => {
  const startedAt = new Date().toISOString(); const facts = await work();
  report.cases.push({ name, status: 'PASS', startedAt, finishedAt: new Date().toISOString(), ...(facts ?? {}) });
};
try {
  if (process.argv.includes('--verify-restart')) {
    const prior = JSON.parse(await fs.readFile(process.env.MODEL_REGISTRY_MAIN_EVIDENCE, 'utf8'));
    const editor = await actor(pool, prior.facts.projectId), current = await list(prior.facts.projectId, editor.token);
    await step('Actual two-worker restart preserves selected Aalborg, tray snapshot and a fresh protected load', async () => {
      assert.deepEqual(current.selection, prior.facts.selection); assert.equal(current.versions[0].health, 'healthy');
      const trays = await call(projectPath(prior.facts.projectId) + '/trays', { token: editor.token }); assert.equal(trays.status, 200); assert.equal(trays.value.trays.length, prior.facts.trayCount);
      const session = await viewerSession(prior.facts.projectId, prior.facts.model.id, editor.token);
      assert.equal((await call(session.path + 'descriptor', { cookie: session.cookie, worker: 'http://api2:4000' })).status, 200);
      await call(session.path.slice(0, -1), { token: editor.token, method: 'DELETE' });
    }); report.facts = prior.facts;
  } else if (process.argv.includes('--contracts-only')) {
    const id = await emptyProject(pool), editor = await actor(pool, id), count = await seedTrays(pool, id);
    await step('Actual tray endpoint returns full unfiltered PublicTray identities for legacy and current logins', async () => {
      for (const token of [editor.token, editor.legacyToken]) {
        const response = await call(projectPath(id) + '/trays?limit=1&search=not-a-real-tray&page=100', { token }); assert.equal(response.status, 200);
        assert.equal(response.value.trays.length, count);
        assert.ok(response.value.trays.every(row => row.projectId === id && typeof row.id === 'string' && typeof row.name === 'string'));
        for (const name of TRAY_NAMES) assert.equal(response.value.trays.filter(row => row.name === name).length, 1);
        const row = response.value.trays[0];
        assert.deepEqual(Object.keys(row).sort(), ['changeLog', 'id', 'projectId', 'name', 'type', 'purpose', 'widthMm', 'heightMm', 'lengthMm', 'includeGroundingCable', 'groundingCableTypeId', 'useTrefoilClamps', 'trefoilClampSpacingMm', 'createdAt', 'updatedAt'].sort());
      }
      return { actualTrayCount: count, queryPagingIgnoredByServer: true };
    });
    await step('Actual basic, technician and read-only engineer reads; expired401, removed access403, missing project404', async () => {
      for (const [role, assigned] of [['basic', true], ['technician', true], ['engineer', false]]) {
        const reader = await actor(pool, id, { role, assigned }); assert.equal((await call(projectPath(id) + '/trays', { token: reader.token })).status, 200);
      }
      const reader = await actor(pool, id, { role: 'basic' });
      assert.equal((await call(projectPath(id) + '/trays', { token: reader.expiredToken })).status, 401);
      await pool.query('DELETE FROM user_project_access WHERE user_id=$1 AND project_id=$2', [reader.userId, id]);
      assert.equal((await call(projectPath(id) + '/trays', { token: reader.token })).status, 403);
      assert.equal((await call(projectPath(randomUUID()) + '/trays', { token: editor.token })).status, 404);
      const legacy = await call(projectPath(id) + `/model-versions/${randomUUID()}/viewer-sessions`, { token: editor.legacyToken, method: 'POST', body: { loadId: randomUUID() } });
      assert.equal(legacy.status, 401); assert.equal(legacy.value.code, 'LOGIN_REFRESH_REQUIRED');
    }); report.projectId = id;
  } else {
    const fixture = await prepareModel(pool), { projectId, editor, model } = fixture; let revision = fixture.selection.selectionRevision;
    await step('Pinned actual342-resource Aalborg imports and is explicitly selected in a fresh Stage7 project', async () => {
      assert.equal(fixture.selection.activeModelVersionId, model.id); assert.equal(revision, 1); assert.equal(fixture.trayCount, 85);
      return { modelVersionId: model.id, contentFingerprint: model.contentFingerprint, resourceCount: model.resourceCount, totalBytes: model.totalBytes };
    });
    let old;
    await step('Protected descriptor/rawSVF and full DB route inventory are independent positive controls', async () => {
      old = await viewerSession(projectId, model.id, editor.token);
      const descriptor = await call(old.path + 'descriptor', { cookie: old.cookie }); assert.equal(descriptor.status, 200); assert.equal(descriptor.value.modelVersionId, model.id);
      const resource = await call(old.path + 'resources/output/0/0.svf', { cookie: old.cookie, worker: 'http://api2:4000' }); assert.equal(resource.status, 200); assert.ok(resource.bytes.length > 1000);
      const trays = await call(projectPath(projectId) + '/trays', { token: editor.token }); assert.equal(trays.status, 200); assert.equal(trays.value.trays.length, fixture.trayCount);
      return { descriptorStatus: descriptor.status, rawSvfStatus: resource.status, rawSvfBytes: resource.bytes.length, trayCount: trays.value.trays.length };
    });
    await step('Actual DB deletion changes only DB inventory while protected model descriptor remains healthy', async () => {
      await changeTray(pool, projectId, 'remove-model-tray');
      try {
        const trays = await call(projectPath(projectId) + '/trays', { token: editor.token }); assert.equal(trays.status, 200); assert.equal(trays.value.trays.some(row => row.name === 'DFC003'), false);
        assert.equal((await call(old.path + 'descriptor', { cookie: old.cookie })).status, 200);
      } finally { await changeTray(pool, projectId, 'restore-model-tray'); }
    });
    await step('Actual SQL lower(name) uniqueness permits normalized ambiguity; public DTO preserves original names', async () => {
      await changeTray(pool, projectId, 'add-collision');
      try {
        const trays = await call(projectPath(projectId) + '/trays', { token: editor.token }); assert.equal(trays.status, 200);
        const collisions = trays.value.trays.filter(row => row.name.normalize('NFKC').trim().toUpperCase() === 'BC025'); assert.equal(collisions.length, 2); assert.notEqual(collisions[0].id, collisions[1].id);
        return { normalizedKey: 'BC025', actualDatabaseMatchCount: collisions.length };
      } finally { await changeTray(pool, projectId, 'remove-collision'); }
    });
    await step('Actual null then same-model reselect increments revision and fences the old session', async () => {
      for (const value of [null, model.id]) { const saved = await select(projectId, editor.token, value, revision, 'http://api2:4000'); assert.equal(saved.status, 200); revision++; }
      assert.equal((await call(old.path + 'descriptor', { cookie: old.cookie })).status, 409);
      const fresh = await viewerSession(projectId, model.id, editor.token); assert.equal((await call(fresh.path + 'descriptor', { cookie: fresh.cookie })).status, 200);
      await call(fresh.path.slice(0, -1), { token: editor.token, method: 'DELETE' });
      return { selectionRevision: revision, staleSessionStatus: 409 };
    });
    await step('Actual durable session expiry denies resource access independently of tray read permission', async () => {
      const session = await viewerSession(projectId, model.id, editor.token);
      const result = await pool.query("UPDATE viewer_resource_sessions SET created_at=NOW()-INTERVAL '10 minutes',expires_at=NOW()-INTERVAL '1 second',absolute_expires_at=NOW()+INTERVAL '10 minutes' WHERE id=$1 AND project_id=$2", [session.sessionId, projectId]); assert.equal(result.rowCount, 1);
      const expired = await call(session.path + 'resources/output/0/0.svf', { cookie: session.cookie }); assert.equal(expired.status, 410); assert.equal(expired.value.code, 'SESSION_EXPIRED');
      assert.equal((await call(projectPath(projectId) + '/trays', { token: editor.token })).status, 200);
      return { basis: 'Trusted disposable-fixture DB timestamps force the real durable expiry predicate; no production clock override or wall-clock waiting claim.', resourceStatus: 410, trayStatus: 200 };
    });
    fixture.selection = (await list(projectId, editor.token)).selection; report.facts = safeFacts(fixture);
  }
  report.status = 'PASS';
} catch (error) { report.status = 'FAIL'; report.failure = { name: error.name, message: String(error.message).slice(0, 1000) }; throw error; }
finally { report.finishedAt = new Date().toISOString(); await fs.writeFile(target, JSON.stringify(report, null, 2) + '\n', { flag: 'wx' }); await pool.end(); }
console.log(JSON.stringify({ status: report.status, cases: report.cases.length, evidence: target }));
