import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { randomBytes, randomUUID } from 'node:crypto';
import pg from 'pg';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { Client } from 'minio';
import { assertFixtureEnvironment, makeSyntheticPackage } from '../model-registry/integration.mjs';

export function fixturePool() {
  assertFixtureEnvironment();
  assert.match(process.env.STAGE6_RUN_ID ?? '', /^[a-f0-9-]{36}$/);
  return new pg.Pool({ connectionString: process.env.DATABASE_URL });
}
export const origin = () => (process.env.WFC_VIEWER_ALLOWED_ORIGINS ?? '').split(',')[0];
export const modelPath = projectId => `/api/projects/${projectId}`;
export async function call(route, { token, cookie, method = 'GET', body, worker = 'http://proxy', timeout = 600_000 } = {}) {
  return new Promise((resolve, reject) => {
    const target = new URL(worker), encoded = body === undefined ? null : Buffer.from(JSON.stringify(body));
    const request = http.request({ hostname: target.hostname, port: target.port, path: route, method, headers: {
      Host: new URL(origin()).host, Origin: origin(), 'Sec-Fetch-Site': 'same-origin',
      ...(token ? { Authorization: 'Bearer ' + token } : {}), ...(cookie ? { Cookie: cookie } : {}),
      ...(encoded ? { 'Content-Type': 'application/json', 'Content-Length': String(encoded.length) } : {}),
    } }, response => {
      const chunks = []; let size = 0;
      response.on('data', chunk => { size += chunk.length; if (size > 4 * 1024 ** 2) request.destroy(Error('FIXTURE_RESPONSE_LIMIT')); else chunks.push(chunk); });
      response.once('error', reject); response.once('end', () => {
        const bytes = Buffer.concat(chunks); let value = null;
        try { value = bytes.length ? JSON.parse(bytes.toString('utf8')) : null; } catch { /* Verified resource bytes are not JSON. */ }
        resolve({ status: response.statusCode, headers: response.headers, value, bytes });
      });
    });
    request.setTimeout(timeout, () => request.destroy(Error('FIXTURE_HTTP_TIMEOUT')));
    request.once('error', reject); request.end(encoded);
  });
}
export function privateMetadata(response) {
  assert.match(response.headers['cache-control'] ?? '', /private/);
  assert.match(response.headers['cache-control'] ?? '', /no-store/);
}
export async function actor(pool, projectId, { role = 'engineer', email = `stage6-${randomUUID()}@fixture.invalid`, password = randomBytes(32).toString('base64url') } = {}) {
  assert.ok(['admin', 'engineer', 'basic', 'technician'].includes(role));
  const userId = randomUUID();
  await pool.query('INSERT INTO users(id,email,password_hash,first_name,last_name,is_admin,role) VALUES($1,$2,$3,$4,$5,$6,$7)', [userId, email, await bcrypt.hash(password, 4), 'Stage6', 'Selection fixture', role === 'admin', role]);
  await pool.query('INSERT INTO user_project_access(user_id,project_id) VALUES($1,$2)', [userId, projectId]);
  const login = await call('/api/auth/login', { method: 'POST', body: { email, password } });
  assert.equal(login.status, 200);
  return { userId, email, password, token: login.value.token, legacyToken: jwt.sign({ sub: userId, email, isAdmin: role === 'admin' }, process.env.JWT_SECRET, { expiresIn: 3600 }) };
}
export async function emptyProject(pool, title = 'Stage6 model selection') {
  const projectId = randomUUID();
  await pool.query('INSERT INTO projects(id,project_number,name,customer) VALUES($1,$2,$3,$4)', [projectId, 'STAGE6-' + projectId, title, 'Isolated fixture']);
  return projectId;
}
export async function list(projectId, token, worker) {
  const response = await call(modelPath(projectId) + '/model-versions', { token, worker });
  assert.equal(response.status, 200); privateMetadata(response);
  return response.value;
}
export async function select(projectId, token, modelVersionId, expectedSelectionRevision, worker) {
  return call(modelPath(projectId) + '/active-model', { token, worker, method: 'PATCH', body: { modelVersionId, expectedSelectionRevision } });
}
export async function upload(projectId, token, filename, bytes, sha256) {
  const response = await fetch('http://proxy' + modelPath(projectId) + '/model-imports', { method: 'POST', headers: {
    Authorization: 'Bearer ' + token, 'Content-Type': 'application/zip', 'Content-Length': String(bytes),
    'Idempotency-Key': randomUUID(), 'X-Package-SHA256': sha256,
  }, body: createReadStream(filename), duplex: 'half', signal: AbortSignal.timeout(900_000) });
  assert.equal(response.status, 202);
  const { importId } = await response.json(), deadline = Date.now() + 900_000;
  for (;;) {
    const observed = await call(modelPath(projectId) + '/model-imports/' + importId, { token });
    assert.equal(observed.status, 200);
    if (observed.value.job.state === 'failed') throw Error('FIXTURE_IMPORT_FAILED_' + observed.value.job.failure.code);
    if (observed.value.job.state === 'complete') return { importId, versionId: observed.value.job.modelVersionId };
    assert.ok(Date.now() < deadline, 'FIXTURE_IMPORT_DEADLINE');
    await new Promise(resolve => setTimeout(resolve, 250));
  }
}
export async function prepareModels(pool, { email, password, projectId: requested } = {}) {
  const projectId = requested ?? await emptyProject(pool);
  const editor = await actor(pool, projectId, { email, password });
  let versions = (await list(projectId, editor.token)).versions;
  if (!versions.length) {
    await upload(projectId, editor.token, '/packages/aalborg-svf-stage3.zip', 439112829, '8e11874a91215a7a35131dfcfb736a7ce43d801264525f8fd714cb364b9301d5');
    versions = (await list(projectId, editor.token)).versions;
    assert.equal(versions.length, 1);
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'stage6-variant-'));
    try {
      const variant = await makeSyntheticPackage(root, { label: versions[0].label, propertyText: 'Stage6 explicitly different model property content.' });
      await upload(projectId, editor.token, variant.filename, variant.report.package.bytes, variant.report.package.sha256);
    } finally { await fs.rm(root, { recursive: true, force: true }); }
  }
  const current = await list(projectId, editor.token);
  const a = current.versions.find(v => v.contentFingerprint === 'b5bb4fbe666b440c73bb1ffd2ee0db01be66146f8002e4a9df8dce8521db1d34');
  const b = current.versions.find(v => v.id !== a?.id);
  assert.ok(a && b); assert.equal(a.label, b.label); assert.notEqual(a.contentFingerprint, b.contentFingerprint);
  assert.equal(a.resourceCount, 342); assert.equal(a.totalBytes, 439007803);
  return { projectId, editor, a, b, selection: current.selection };
}
export function safeFacts({ projectId, a, b, selection }) {
  return { projectId, modelA: { id: a.id, label: a.label, sourceName: a.source.name, contentFingerprint: a.contentFingerprint, resourceCount: a.resourceCount },
    modelB: { id: b.id, label: b.label, sourceName: b.source.name, contentFingerprint: b.contentFingerprint, resourceCount: b.resourceCount,
      basis: 'Publicly packed/verified synthetic model with distinct actual property-resource bytes; not a second transport alias of Aalborg.' }, selection };
}
export async function makeVariantUnavailable(pool, projectId, versionId) {
  const row = (await pool.query('SELECT v.*,p.project_number FROM model_versions v JOIN projects p ON p.id=v.project_id WHERE v.project_id=$1 AND v.id=$2', [projectId, versionId])).rows[0];
  assert.ok(row && row.project_number.startsWith('STAGE6-'));
  assert.equal(row.source.name, 'synthetic.nwd'); assert.equal(row.resource_count, 3);
  assert.equal(row.storage_prefix, `projects/${projectId}/versions/${versionId}/`);
  const resource = row.manifest.resources.find(r => r.path === 'resources/output/0/properties.db'); assert.ok(resource);
  const client = new Client({ endPoint: 'minio', port: 9000, useSSL: false, accessKey: process.env.MINIO_ACCESS_KEY, secretKey: process.env.MINIO_SECRET_KEY });
  await client.removeObject('stage4-models', row.storage_prefix + resource.path);
  return { projectId, modelVersionId: versionId, removedOwnedSyntheticResources: 1 };
}
export async function viewerSession(projectId, versionId, token) {
  const base = `${modelPath(projectId)}/model-versions/${versionId}/viewer-sessions`;
  const created = await call(base, { token, method: 'POST', body: { loadId: randomUUID() } });
  assert.equal(created.status, 201);
  const cookie = created.headers['set-cookie']?.[0]?.split(';')[0]; assert.ok(cookie);
  return { path: base + '/' + created.value.sessionId + '/', cookie, sessionId: created.value.sessionId };
}
