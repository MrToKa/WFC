import assert from 'node:assert/strict';
import { createReadStream } from 'node:fs';
import http from 'node:http';
import { randomBytes, randomUUID } from 'node:crypto';
import pg from 'pg';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { assertFixtureEnvironment } from '../model-registry/integration.mjs';

export const ROUTES = [
  '/DFB018-1/DFB011/DFB012/DFB013/B002/B107-1/B107-2/B107-3/BC025/BC022-2/SECONDARY',
  '/DFBC002-2/DFC001/DFC002/DFC003/C002/C107-1/C107-2/C107-3/BC025/BC023-4/SECONDARY',
];
export const TRAY_NAMES = [...new Set(ROUTES.flatMap(value => value.split('/').filter(value => value && value !== 'SECONDARY')))];
export const PINNED_MODEL = Object.freeze({ bytes: 439112829, sha256: '8e11874a91215a7a35131dfcfb736a7ce43d801264525f8fd714cb364b9301d5', fingerprint: 'b5bb4fbe666b440c73bb1ffd2ee0db01be66146f8002e4a9df8dce8521db1d34', resourceCount: 342, totalBytes: 439007803 });
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
export function fixturePool() {
  assertFixtureEnvironment();
  assert.match(process.env.STAGE7_RUN_ID ?? '', UUID);
  return new pg.Pool({ connectionString: process.env.DATABASE_URL });
}
export const origin = () => (process.env.WFC_VIEWER_ALLOWED_ORIGINS ?? '').split(',')[0];
export const projectPath = projectId => `/api/projects/${projectId}`;
export async function call(route, { token, cookie, method = 'GET', body, worker = 'http://proxy', timeout = 600_000 } = {}) {
  assert.ok(['http://proxy', 'http://api:4000', 'http://api2:4000'].includes(worker));
  return new Promise((resolve, reject) => {
    const target = new URL(worker), encoded = body === undefined ? null : Buffer.from(JSON.stringify(body));
    const request = http.request({ hostname: target.hostname, port: target.port, path: route, method, headers: {
      Host: new URL(origin()).host, Origin: origin(), 'Sec-Fetch-Site': 'same-origin',
      ...(token ? { Authorization: 'Bearer ' + token } : {}), ...(cookie ? { Cookie: cookie } : {}),
      ...(encoded ? { 'Content-Type': 'application/json', 'Content-Length': String(encoded.length) } : {}),
    } }, response => {
      const chunks = []; let size = 0;
      response.on('data', chunk => { size += chunk.length; if (size > 8 * 1024 ** 2) request.destroy(Error('FIXTURE_RESPONSE_LIMIT')); else chunks.push(chunk); });
      response.once('error', reject); response.once('end', () => {
        const bytes = Buffer.concat(chunks); let value = null;
        try { value = bytes.length ? JSON.parse(bytes.toString('utf8')) : null; } catch { /* The resource positive control is raw SVF. */ }
        resolve({ status: response.statusCode, headers: response.headers, value, bytes });
      });
    });
    request.setTimeout(timeout, () => request.destroy(Error('FIXTURE_HTTP_TIMEOUT')));
    request.once('error', reject); request.end(encoded);
  });
}
export async function requireFixtureProject(pool, projectId) {
  assert.match(projectId, UUID);
  const row = (await pool.query('SELECT project_number FROM projects WHERE id=$1', [projectId])).rows[0];
  assert.equal(row?.project_number, `STAGE7-${process.env.STAGE7_RUN_ID}-${projectId}`, 'Refuse a non-owned fixture project.');
}
export async function emptyProject(pool, title = 'Stage7 manual routing isolated project with a deliberately long project title') {
  const id = randomUUID();
  await pool.query('INSERT INTO projects(id,project_number,name,customer) VALUES($1,$2,$3,$4)', [id, `STAGE7-${process.env.STAGE7_RUN_ID}-${id}`, title, 'Isolated Stage7 fixture']);
  return id;
}
export async function actor(pool, projectId, { role = 'engineer', assigned = true, email = `stage7-${randomUUID()}@fixture.invalid`, password = randomBytes(32).toString('base64url') } = {}) {
  await requireFixtureProject(pool, projectId);
  assert.ok(['admin', 'engineer', 'basic', 'technician'].includes(role));
  const userId = randomUUID();
  await pool.query('INSERT INTO users(id,email,password_hash,first_name,last_name,is_admin,role) VALUES($1,$2,$3,$4,$5,$6,$7)', [userId, email, await bcrypt.hash(password, 4), 'Stage7', 'Manual routing fixture', role === 'admin', role]);
  if (assigned) await pool.query('INSERT INTO user_project_access(user_id,project_id) VALUES($1,$2)', [userId, projectId]);
  const login = await call('/api/auth/login', { method: 'POST', body: { email, password } });
  assert.equal(login.status, 200);
  return { userId, email, password, token: login.value.token,
    legacyToken: jwt.sign({ sub: userId, email, isAdmin: role === 'admin' }, process.env.JWT_SECRET, { expiresIn: 3600 }),
    expiredToken: jwt.sign({ sub: userId, email, isAdmin: role === 'admin', jti: randomUUID() }, process.env.JWT_SECRET, { expiresIn: -1 }) };
}
export async function list(projectId, token) {
  const response = await call(projectPath(projectId) + '/model-versions', { token }); assert.equal(response.status, 200); return response.value;
}
export const select = (projectId, token, modelVersionId, expectedSelectionRevision, worker) => call(projectPath(projectId) + '/active-model', { token, worker, method: 'PATCH', body: { modelVersionId, expectedSelectionRevision } });
export async function upload(projectId, token) {
  const response = await fetch('http://proxy' + projectPath(projectId) + '/model-imports', { method: 'POST', headers: {
    Authorization: 'Bearer ' + token, 'Content-Type': 'application/zip', 'Content-Length': String(PINNED_MODEL.bytes),
    'Idempotency-Key': randomUUID(), 'X-Package-SHA256': PINNED_MODEL.sha256,
  }, body: createReadStream('/packages/aalborg-svf-stage3.zip'), duplex: 'half', signal: AbortSignal.timeout(900_000) });
  assert.equal(response.status, 202); const { importId } = await response.json(), deadline = Date.now() + 900_000;
  for (;;) {
    const result = await call(projectPath(projectId) + '/model-imports/' + importId, { token }); assert.equal(result.status, 200);
    if (result.value.job.state === 'failed') throw Error('FIXTURE_IMPORT_FAILED_' + result.value.job.failure.code);
    if (result.value.job.state === 'complete') return result.value.job.modelVersionId;
    assert.ok(Date.now() < deadline, 'FIXTURE_IMPORT_TIMEOUT'); await new Promise(resolve => setTimeout(resolve, 250));
  }
}
export async function seedTrays(pool, projectId) {
  await requireFixtureProject(pool, projectId);
  const names = [...TRAY_NAMES, 'STAGE7_DB_ONLY', ...Array.from({ length: 65 }, (_, i) => `AAA-STAGE7-FILLER-${String(i).padStart(3, '0')}`)];
  for (const name of names) await pool.query('INSERT INTO trays(id,project_id,name) VALUES($1,$2,$3) ON CONFLICT(project_id,lower(name)) DO NOTHING', [randomUUID(), projectId, name]);
  return names.length;
}
export async function prepareModel(pool, credentials = {}) {
  const projectId = credentials.projectId ?? await emptyProject(pool); await requireFixtureProject(pool, projectId);
  const editor = await actor(pool, projectId, credentials); let current = await list(projectId, editor.token);
  if (!current.versions.length) { await upload(projectId, editor.token); current = await list(projectId, editor.token); }
  assert.equal(current.versions.length, 1); const model = current.versions[0];
  assert.equal(model.contentFingerprint, PINNED_MODEL.fingerprint); assert.equal(model.resourceCount, 342); assert.equal(model.totalBytes, PINNED_MODEL.totalBytes);
  if (current.selection.activeModelVersionId !== model.id) { const saved = await select(projectId, editor.token, model.id, current.selection.selectionRevision); assert.equal(saved.status, 200); }
  const trayCount = await seedTrays(pool, projectId); current = await list(projectId, editor.token);
  return { projectId, editor, model, selection: current.selection, trayCount };
}
export function safeFacts({ projectId, model, selection, trayCount }) {
  return { projectId, model: { id: model.id, label: model.label, contentFingerprint: model.contentFingerprint, resourceCount: model.resourceCount, totalBytes: model.totalBytes }, selection, trayCount };
}
export async function changeTray(pool, projectId, action) {
  await requireFixtureProject(pool, projectId);
  if (action === 'remove-model-tray') { const result = await pool.query("DELETE FROM trays WHERE project_id=$1 AND name='DFC003' RETURNING id", [projectId]); assert.equal(result.rowCount, 1); }
  else if (action === 'restore-model-tray') await pool.query("INSERT INTO trays(id,project_id,name) VALUES($1,$2,'DFC003') ON CONFLICT(project_id,lower(name)) DO NOTHING", [randomUUID(), projectId]);
  else if (action === 'add-collision') await pool.query("INSERT INTO trays(id,project_id,name) VALUES($1,$2,'ＢＣ０２５') ON CONFLICT(project_id,lower(name)) DO NOTHING", [randomUUID(), projectId]);
  else if (action === 'remove-collision') await pool.query("DELETE FROM trays WHERE project_id=$1 AND name='ＢＣ０２５'", [projectId]);
  else throw Error('UNKNOWN_FIXTURE_TRAY_ACTION');
  return { projectId, action, affectedIdentifier: action.includes('collision') ? 'BC025' : 'DFC003' };
}
export async function viewerSession(projectId, versionId, token) {
  const base = `${projectPath(projectId)}/model-versions/${versionId}/viewer-sessions`;
  const created = await call(base, { token, method: 'POST', body: { loadId: randomUUID() } }); assert.equal(created.status, 201);
  const cookie = created.headers['set-cookie']?.[0]?.split(';')[0]; assert.ok(cookie);
  return { path: base + '/' + created.value.sessionId + '/', cookie, sessionId: created.value.sessionId };
}
