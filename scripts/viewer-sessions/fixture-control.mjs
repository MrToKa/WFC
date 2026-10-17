import assert from 'node:assert/strict';
import { createReadStream } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import pg from 'pg';
import bcrypt from 'bcryptjs';
import { assertFixtureEnvironment } from '../model-registry/integration.mjs';

// Trusted isolated test driver, never mounted as an HTTP route. Credentials arrive
// on stdin, stay in memory and are excluded from stdout and evidence.
assertFixtureEnvironment();
let input = '';
for await (const chunk of process.stdin) { input += chunk; assert.ok(input.length < 16_384); }
const spec = JSON.parse(input);
assert.match(spec.email, /^stage5-[a-f0-9-]+@fixture\.invalid$/);
assert.equal(typeof spec.password, 'string'); assert.ok(spec.password.length >= 24);
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const base = 'http://proxy';
const json = async (route, { token, method = 'GET', body } = {}) => {
  const response = await fetch(new URL(route, base), { method, headers: { ...(token ? { Authorization: 'Bearer ' + token } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(30_000) });
  const value = await response.json(); assert.ok(response.ok, 'Isolated fixture request failed: ' + response.status); return value;
};
try {
  const userId = randomUUID(), projectId = spec.projectId ?? randomUUID();
  await pool.query('INSERT INTO users(id,email,password_hash,first_name,last_name,is_admin,role) VALUES($1,$2,$3,$4,$5,false,$6)', [userId, spec.email, await bcrypt.hash(spec.password, 4), 'Stage5', 'Browser fixture', 'engineer']);
  if (!spec.projectId) await pool.query('INSERT INTO projects(id,project_number,name,customer) VALUES($1,$2,$3,$4)', [projectId, 'STAGE5-' + projectId, 'Protected Viewer acceptance', 'Isolated fixture']);
  await pool.query('INSERT INTO user_project_access(user_id,project_id) VALUES($1,$2)', [userId, projectId]);
  const { token } = await json('/api/auth/login', { method: 'POST', body: { email: spec.email, password: spec.password } });
  let importId = null;
  if (!spec.projectId) {
    const response = await fetch(new URL(`/api/projects/${projectId}/model-imports`, base), { method: 'POST', headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/zip', 'Content-Length': '439112829', 'Idempotency-Key': randomUUID(), 'X-Package-SHA256': '8e11874a91215a7a35131dfcfb736a7ce43d801264525f8fd714cb364b9301d5' }, body: createReadStream('/packages/aalborg-svf-stage3.zip'), duplex: 'half', signal: AbortSignal.timeout(900_000) });
    assert.equal(response.status, 202); importId = (await response.json()).importId;
    const deadline = Date.now() + 900_000;
    for (;;) {
      const { job } = await json(`/api/projects/${projectId}/model-imports/${importId}`, { token });
      if (job.state === 'failed') throw Error('Real package import failed: ' + job.failure?.code);
      if (job.state === 'complete') break;
      assert.ok(Date.now() < deadline, 'Real package import timed out'); await delay(250);
    }
  }
  const list = await json(`/api/projects/${projectId}/model-versions`, { token });
  assert.equal(list.versions.length, 1); const version = list.versions[0];
  assert.equal(version.resourceCount, 342); assert.equal(version.totalBytes, 439007803);
  let selection = list.selection;
  if (!selection.activeModelVersionId) ({ selection } = await json(`/api/projects/${projectId}/active-model`, { token, method: 'PATCH', body: { modelVersionId: version.id, expectedSelectionRevision: selection.selectionRevision } }));
  assert.equal(selection.activeModelVersionId, version.id);
  console.log(JSON.stringify({ projectId, userId, modelVersionId: version.id, contentFingerprint: version.contentFingerprint, resourceCount: version.resourceCount, totalBytes: version.totalBytes, selectionRevision: selection.selectionRevision, importId }));
} finally { await pool.end(); }
