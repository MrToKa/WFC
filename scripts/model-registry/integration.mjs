import fs from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import { createHash, randomUUID, randomBytes } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import pg from 'pg';
import bcrypt from 'bcryptjs';
import { Client } from 'minio';
import { packModel } from '../../server/dist/server/vendor/routings-model-package/index.mjs';

// Synthetic data only; no SDK, cloud request, real NWD or Preparer dependency.
const SYNTHETIC_SVF = 'UEsDBBQAAAAAAE1iUF3ceDb+9gEAAPYBAAANAAAAbWFuaWZlc3QuanNvbnsiYWRza0lEIjp7InZlcnNpb24iOiIiLCJpZCI6IiIsInR5cGUiOiIiLCJzb3VyY2VTeXN0ZW0iOiIifSwibmFtZSI6IkxNViBNYW5pZmVzdCIsImFzc2V0cyI6W3sidHlwZXNldCI6IjIiLCJVUkkiOiIwLnBmIiwiaWQiOiIwLnBmIiwidHlwZSI6IkF1dG9kZXNrLkNsb3VkUGxhdGZvcm0uUGFja0ZpbGUiLCJzaXplIjo0MSwidXNpemUiOjIxfSx7IlVSSSI6ImVtYmVkOi9tZXRhZGF0YS5qc29uIiwiaWQiOiJtZXRhZGF0YS5qc29uIiwidHlwZSI6IkF1dG9kZXNrLkNsb3VkUGxhdGZvcm0uVmlld2luZ01ldGFkYXRhIiwic2l6ZSI6NjcsInVzaXplIjo2N31dLCJ0eXBlc2V0cyI6W3sidHlwZXMiOlt7ImNsYXNzIjoiQXV0b2Rlc2suQ2xvdWRQbGF0Zm9ybS5HZW9tZXRyeSIsInZlcnNpb24iOjEsInR5cGUiOiJBdXRvZGVzay5DbG91ZFBsYXRmb3JtLk9wZW5DVE0ifV0sImlkIjoiMiJ9XSwidG9vbGtpdHZlcnNpb24iOiJMTVZUSyA1LjAuMjYuMCIsIm1hbmlmZXN0dmVyc2lvbiI6Mn1QSwMEFAAAAAAATWJQXZmneoRDAAAAQwAAAA0AAABtZXRhZGF0YS5qc29ueyJ2ZXJzaW9uIjoiMS4wIiwibWV0YWRhdGEiOnsiZGVmYXVsdCBkaXNwbGF5IHVuaXQiOnsidmFsdWUiOiJtIn19fVBLAQIUABQAAAAAAE1iUF3ceDb+9gEAAPYBAAANAAAAAAAAAAAAAAAAAAAAAABtYW5pZmVzdC5qc29uUEsBAhQAFAAAAAAATWJQXZmneoRDAAAAQwAAAA0AAAAAAAAAAAAAAAAAIQIAAG1ldGFkYXRhLmpzb25QSwUGAAAAAAIAAgB2AAAAjwIAAAAA';
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');

export async function makeSyntheticPackage(root, { name = randomUUID(), sourceText = 'Explicit synthetic source fixture.', propertyText = 'synthetic-property-fixture', packageId = randomUUID(), label = 'Synthetic registry fixture' } = {}) {
  const input = path.join(root, name), modelDir = path.join(input, 'model'), sourceDir = path.join(input, 'source'), outputDir = path.join(input, 'packages');
  await fs.mkdir(path.join(modelDir, 'output', '0'), { recursive: true });
  await fs.mkdir(sourceDir); await fs.mkdir(outputDir);
  const source = path.join(sourceDir, 'synthetic.nwd'), sourceBytes = Buffer.from(sourceText);
  await fs.writeFile(source, sourceBytes);
  const resources = new Map([
    ['output/0/0.svf', Buffer.from(SYNTHETIC_SVF, 'base64')],
    ['output/0/0.pf', Buffer.from('H4sIAAAAAAAACgtITM52y8xJVUjLrCgpLUpVSEksSQQA8RQI6hUAAAA=', 'base64')],
    ['output/0/properties.db', Buffer.from('SQLite format 3\0' + propertyText, 'ascii')],
  ]);
  for (const [filename, bytes] of resources) await fs.writeFile(path.join(modelDir, ...filename.split('/')), bytes);
  await fs.writeFile(path.join(modelDir, 'model.json'), JSON.stringify({ name: 'synthetic.nwd', format: 'svf', entrypoint: '/model/output/0/0.svf', viewerVersion: '7.130.0', preparedAt: '2026-10-16T00:00:00.000Z', sourceBytes: sourceBytes.length, resourceCount: resources.size, totalBytes: [...resources.values()].reduce((sum, bytes) => sum + bytes.length, 0) }));
  await fs.writeFile(path.join(modelDir, 'integrity.json'), JSON.stringify(Object.fromEntries([...resources].map(([filename, bytes]) => [filename, { bytes: bytes.length, sha256: sha256(bytes), transport: 'raw-http-v1' }]))));
  const filename = path.join(outputDir, 'fixture.zip');
  const report = await packModel({ modelDir, source, output: filename, packageId, label, preparedAt: '2026-10-16T00:00:00.000Z' });
  return { filename, report };
}

export async function hashFile(filename) {
  const hash = createHash('sha256'); let bytes = 0;
  for await (const chunk of createReadStream(filename)) { bytes += chunk.length; assert.ok(bytes <= 2147483648); hash.update(chunk); }
  return { bytes, sha256: hash.digest('hex') };
}

export function assertFixtureEnvironment() {
  const db = new URL(process.env.DATABASE_URL || 'file:///missing');
  assert.equal(Number(process.versions.node.split('.')[0]), 24);
  assert.equal(process.env.MODEL_REGISTRY_FIXTURE, 'isolated-stage4');
  assert.equal(db.hostname, 'postgres'); assert.equal(db.pathname, '/wfc_model_registry_stage4');
  assert.equal(process.env.MINIO_ENDPOINT, 'minio');
  assert.equal(process.env.WFC_MODEL_BUCKET, 'stage4-models');
  assert.equal(process.env.WFC_MODEL_IMPORT_ROOT, '/var/lib/wfc/model-imports');
}

async function jsonRequest(base, route, { token, method = 'GET', body } = {}) {
  const response = await fetch(new URL(route, base), { method, headers: { ...(token ? { Authorization: 'Bearer ' + token } : {}), ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(30000) });
  const bytes = Buffer.from(await response.arrayBuffer()); assert.ok(bytes.length < 4 * 1024 ** 2);
  return { status: response.status, value: bytes.length ? JSON.parse(bytes.toString()) : null };
}

async function upload(base, projectId, fixture, token, { idempotencyKey = randomUUID(), expectedBytes = fixture.report.package.bytes, declaredSha = fixture.report.package.sha256, expectContinue = true, sendBody = true, timeoutMs = 600000, pathname = `/api/projects/${projectId}/model-imports` } = {}) {
  return await new Promise((resolve, reject) => {
    let source, sentBytes = 0, continued = false;
    const request = http.request(new URL(pathname, base), { method: 'POST', headers: { ...(token ? { Authorization: 'Bearer ' + token } : {}), 'Content-Type': 'application/zip', 'Content-Length': String(expectedBytes), 'Idempotency-Key': idempotencyKey, 'X-Package-SHA256': declaredSha, ...(expectContinue ? { Expect: '100-continue' } : {}) } });
    request.setTimeout(timeoutMs, () => request.destroy(new Error('FIXTURE_UPLOAD_TIMEOUT')));
    request.once('error', reject);
    const send = () => { if (source || !sendBody) return; source = createReadStream(fixture.filename); source.on('data', chunk => { sentBytes += chunk.length; }); source.once('error', reject); source.pipe(request); };
    request.on('continue', () => { continued = true; send(); });
    request.once('response', response => {
      const chunks = []; let count = 0;
      response.on('data', chunk => { count += chunk.length; if (count > 4 * 1024 ** 2) request.destroy(new Error('FIXTURE_RESPONSE_LIMIT')); else chunks.push(chunk); });
      response.once('error', reject);
      response.once('end', () => {
        source?.destroy(); request.destroy();
        let value;
        try { value = JSON.parse(Buffer.concat(chunks).toString()); }
        catch { if (![401, 403, 404].includes(response.statusCode)) { reject(new Error('FIXTURE_RESPONSE_INVALID')); return; } value = null; }
        resolve({ status: response.statusCode, value, sentBytes, continued, idempotencyKey });
      });
    });
    request.flushHeaders(); if (!expectContinue) send();
  });
}

async function waitForImport(base, projectId, importId, token, pool) {
  const deadline = Date.now() + 900000;
  for (;;) {
    const response = await jsonRequest(base, `/api/projects/${projectId}/model-imports/${importId}`, { token });
    if (response.status === 409) {
      assert.ok(['PACKAGE_ID_CONFLICT', 'PROVENANCE_CONFLICT'].includes(response.value.code));
      assert.equal(response.value.job?.state, 'failed');
      assert.equal(response.value.job.failure.code, response.value.code);
    } else assert.equal(response.status, 200);
    const job = response.value.job;
    if (['complete', 'failed'].includes(job.state)) {
      const cleanup = await pool.query('SELECT staging_cleaned_at FROM model_import_jobs WHERE id=$1', [importId]);
      if (cleanup.rows[0]?.staging_cleaned_at) return job;
    }
    if (Date.now() >= deadline) throw new Error('FIXTURE_IMPORT_TIMEOUT');
    await delay(250);
  }
}

async function seed(pool, base) {
  const password = randomBytes(24).toString('base64url'), passwordHash = await bcrypt.hash(password, 10), users = {};
  for (const role of ['engineer', 'basic', 'technician', 'outsider', 'outsideBasic', 'admin']) {
    const id = randomUUID(), email = `stage4-${id}@fixture.invalid`;
    await pool.query('INSERT INTO users(id,email,password_hash,first_name,last_name,is_admin,role) VALUES($1,$2,$3,$4,$5,$6,$7)', [id, email, passwordHash, 'Stage4', 'Fixture', role === 'admin', role === 'outsider' ? 'engineer' : role === 'outsideBasic' ? 'basic' : role]);
    const login = await jsonRequest(base, '/api/auth/login', { method: 'POST', body: { email, password } });
    assert.equal(login.status, 200); assert.equal(typeof login.value.token, 'string');
    users[role] = { id, token: login.value.token };
  }
  const projects = {};
  for (const name of ['a', 'b', 'c', 'real', 'admin']) {
    const id = randomUUID(); await pool.query('INSERT INTO projects(id,project_number,name,customer) VALUES($1,$2,$3,$4)', [id, `STAGE4-${id}`, 'Isolated Stage4 ' + name, 'Synthetic fixture']);
    for (const role of ['engineer', 'basic', 'technician']) await pool.query('INSERT INTO user_project_access(user_id,project_id) VALUES($1,$2)', [users[role].id, id]);
    projects[name] = id;
  }
  return { users, projects };
}

async function compareStored(pool, client, versionId) {
  const result = await pool.query('SELECT manifest,storage_prefix FROM model_versions WHERE id=$1 AND state=$2', [versionId, 'ready']);
  assert.equal(result.rowCount, 1);
  const { manifest, storage_prefix: prefix } = result.rows[0]; let totalBytes = 0; const inventory = [];
  for (const resource of manifest.resources) {
    const stream = await client.getObject('stage4-models', prefix + resource.path), hash = createHash('sha256'); let bytes = 0;
    for await (const chunk of stream) { bytes += chunk.length; assert.ok(bytes <= resource.bytes); hash.update(chunk); }
    const actualSha256 = hash.digest('hex');
    assert.equal(bytes, resource.bytes); assert.equal(actualSha256, resource.sha256); totalBytes += bytes;
    inventory.push({ path: resource.path, expectedBytes: resource.bytes, actualBytes: bytes, expectedSha256: resource.sha256, actualSha256 });
  }
  return { resources: manifest.resources.length, bytes: totalBytes, firstKey: prefix + manifest.entrypoint, inventory };
}

async function main() {
  assertFixtureEnvironment();
  const startedAt = new Date().toISOString(), observations = [], report = { schemaVersion: 1, startedAt, nodeVersion: process.version, scope: 'Isolated production Node24 WFC, two API workers, real PostgreSQL and private MinIO; synthetic fault fixtures and two real portable ZIP transports.', status: 'RUNNING', cases: observations };
  const evidence = process.env.MODEL_REGISTRY_EVIDENCE || '/evidence/model-registry-integration.json';
  assert.ok(path.isAbsolute(evidence) && path.dirname(evidence) === '/evidence');
  const root = await fs.mkdtemp(path.join(await fs.realpath(os.tmpdir()), 'wfc-model-registry-integration-'));
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
  const client = new Client({ endPoint: 'minio', port: 9000, useSSL: false, accessKey: process.env.MINIO_ACCESS_KEY, secretKey: process.env.MINIO_SECRET_KEY });
  const proxy = 'http://proxy:80', workerA = 'http://api:4000', workerB = 'http://api2:4000';
  async function step(name, fn) {
    const start = Date.now();
    try { const facts = await fn(); observations.push({ name, status: 'PASS', elapsedMs: Date.now() - start, ...(facts ? { facts } : {}) }); }
    catch (error) { observations.push({ name, status: 'FAIL', elapsedMs: Date.now() - start, code: /^[A-Z][A-Z0-9_]{1,80}$/.test(error?.code || '') ? error.code : 'ASSERTION_FAILED' }); throw error; }
  }
  try {
    const { users, projects } = await seed(pool, proxy), token = users.engineer.token;
    const first = await makeSyntheticPackage(root), alias = await makeSyntheticPackage(root, { label: 'Synthetic cosmetic alias' });
    let versionId;
    await step('authorization rejects before accepting a raw request body', async () => {
      for (const base of [workerA, proxy]) for (const deniedToken of [undefined, users.basic.token, users.technician.token, users.outsider.token, users.outsideBasic.token]) {
        const result = await upload(base, projects.a, first, deniedToken, { expectedBytes: 2147483648, sendBody: false, timeoutMs: 10000 });
        assert.equal(result.status, deniedToken ? 403 : 401); assert.equal(result.sentBytes, 0); assert.equal(result.continued, false);
      }
      const encodedProject = '%' + projects.a.charCodeAt(0).toString(16) + projects.a.slice(1);
      const aliases = [`/api/projects/${encodedProject}/model-imports`, `/api/projects/${projects.a}/model-imports/`, `/API/PROJECTS/${projects.a}/MODEL-IMPORTS`];
      for (const base of [workerA, proxy]) for (const pathname of aliases) {
        const result = await upload(base, projects.a, first, undefined, { pathname, expectedBytes: 2147483648, sendBody: false, timeoutMs: 10000 });
        assert.equal(result.status, 401); assert.equal(result.continued, false); assert.equal(result.sentBytes, 0);
      }
      const missingProject = randomUUID();
      for (const [base, status] of [[workerA, 404], [proxy, 403]]) {
        const result = await upload(base, missingProject, first, users.admin.token, { expectedBytes: 2147483648, sendBody: false, timeoutMs: 10000 });
        assert.equal(result.status, status); assert.equal(result.continued, false); assert.equal(result.sentBytes, 0);
      }
      for (const role of ['basic', 'technician', 'outsider', 'admin']) assert.equal((await jsonRequest(proxy, `/api/projects/${projects.a}/model-versions`, { token: users[role].token })).status, 200);
      assert.equal((await jsonRequest(proxy, `/api/projects/${projects.a}/model-versions`, { token: users.outsideBasic.token })).status, 403);
      for (const role of ['basic', 'technician', 'outsider']) assert.equal((await jsonRequest(proxy, `/api/projects/${projects.a}/active-model`, { token: users[role].token, method: 'PATCH', body: { modelVersionId: null, expectedSelectionRevision: 0 } })).status, 403);
      await pool.query('UPDATE users SET role=$2 WHERE id=$1', [users.engineer.id, 'basic']);
      try {
        const changed = await upload(proxy, projects.a, first, token, { expectedBytes: 2147483648, sendBody: false, timeoutMs: 10000 }); assert.equal(changed.status, 403); assert.equal(changed.continued, false); assert.equal(changed.sentBytes, 0);
      } finally { await pool.query('UPDATE users SET role=$2 WHERE id=$1', [users.engineer.id, 'engineer']); }
      const admin = await upload(proxy, projects.admin, first, users.admin.token); assert.equal(admin.status, 202);
      assert.equal((await waitForImport(proxy, projects.admin, admin.value.importId, users.admin.token, pool)).state, 'complete');
      return { deniedRequests: 19, aliasRequests: 6, missingProjectRequests: 2, bodyBytesSent: 0, declaredDeniedBytes: 2147483648, testedThroughProxy: true, adminImport: true, currentRoleAfterJWT: true };
    });
    await step('two workers converge identical content and retain cosmetic package aliases', async () => {
      const accepted = await Promise.all([upload(workerA, projects.a, first, token), upload(workerB, projects.a, alias, token)]);
      for (const value of accepted) assert.equal(value.status, 202);
      const done = await Promise.all(accepted.map(value => waitForImport(proxy, projects.a, value.value.importId, token, pool)));
      assert.ok(done.every(job => job.state === 'complete')); assert.equal(new Set(done.map(job => job.modelVersionId)).size, 1); assert.equal(done.filter(job => job.duplicate).length, 1);
      versionId = done[0].modelVersionId;
      const listed = await jsonRequest(proxy, `/api/projects/${projects.a}/model-versions`, { token }); assert.equal(listed.value.versions.length, 1); assert.equal(listed.value.selection.activeModelVersionId, null);
      const aliases = await pool.query('SELECT count(*) AS n FROM model_package_aliases WHERE project_id=$1 AND model_version_id=$2', [projects.a, versionId]); assert.equal(Number(aliases.rows[0].n), 2);
      const replay = await upload(workerB, projects.a, first, token, { idempotencyKey: accepted[0].idempotencyKey, sendBody: false, timeoutMs: 10000 });
      assert.equal(replay.status, 200); assert.equal(replay.value.importId, accepted[0].value.importId); assert.equal(replay.sentBytes, 0); assert.equal(replay.continued, false);
      const changedIdentity = await upload(workerA, projects.a, first, token, { idempotencyKey: accepted[0].idempotencyKey, declaredSha: '0'.repeat(64), sendBody: false, timeoutMs: 10000 });
      assert.equal(changedIdentity.status, 409); assert.equal(changedIdentity.value.code, 'IDEMPOTENCY_CONFLICT'); assert.equal(changedIdentity.sentBytes, 0); assert.equal(changedIdentity.continued, false);
      assert.equal((await jsonRequest(proxy, `/api/projects/${projects.b}/model-imports/${accepted[0].value.importId}`, { token })).status, 404);
      assert.doesNotMatch(JSON.stringify(listed.value), /storagePrefix|storage_prefix|ownerToken|owner_token|verificationReport|verifiedSha256|\.zip|\/var\/lib\/|stage4-models/);
      const stored = await compareStored(pool, client, versionId);
      return { workers: 2, readyVersions: 1, aliases: 2, resourcesReadback: stored.resources, bytesReadback: stored.bytes };
    });
    await step('different projects receive distinct private versions for the same portable package', async () => {
      const accepted = await Promise.all([upload(workerA, projects.b, first, token), upload(workerB, projects.c, first, token)]);
      for (const value of accepted) assert.equal(value.status, 202);
      const done = await Promise.all(accepted.map((value, index) => waitForImport(proxy, index ? projects.c : projects.b, value.value.importId, token, pool)));
      assert.ok(done.every(job => job.state === 'complete')); assert.equal(new Set([versionId, ...done.map(job => job.modelVersionId)]).size, 3);
      const row = await pool.query('SELECT count(DISTINCT storage_prefix) AS n FROM model_versions WHERE id=ANY($1::uuid[])', [[versionId, ...done.map(job => job.modelVersionId)]]); assert.equal(Number(row.rows[0].n), 3);
      return { workers: 2, concurrentProjects: 2, privatePrefixes: 3 };
    });
    await step('selection uses revision CAS, explicit null and same-project membership', async () => {
      const selected = await jsonRequest(proxy, `/api/projects/${projects.a}/active-model`, { token, method: 'PATCH', body: { modelVersionId: versionId, expectedSelectionRevision: 0 } }); assert.equal(selected.status, 200);
      assert.equal((await jsonRequest(proxy, `/api/projects/${projects.a}/active-model`, { token, method: 'PATCH', body: { modelVersionId: null, expectedSelectionRevision: 0 } })).status, 409);
      assert.equal((await jsonRequest(proxy, `/api/projects/${projects.b}/active-model`, { token, method: 'PATCH', body: { modelVersionId: versionId, expectedSelectionRevision: 0 } })).status, 404);
      const cleared = await jsonRequest(proxy, `/api/projects/${projects.a}/active-model`, { token, method: 'PATCH', body: { modelVersionId: null, expectedSelectionRevision: selected.value.selection.selectionRevision } }); assert.equal(cleared.status, 200); assert.equal(cleared.value.selection.activeModelVersionId, null);
      const restored = await jsonRequest(proxy, `/api/projects/${projects.a}/active-model`, { token, method: 'PATCH', body: { modelVersionId: versionId, expectedSelectionRevision: cleared.value.selection.selectionRevision } }); assert.equal(restored.status, 200);
    });
    await step('package/provenance contradictions fail without replacing ready selection', async () => {
      const conflict = await makeSyntheticPackage(root, { packageId: first.report.manifest.packageId, propertyText: 'changed synthetic content' });
      const provenance = await makeSyntheticPackage(root, { sourceText: 'Different synthetic source reference.' });
      for (const [fixture, code] of [[conflict, 'PACKAGE_ID_CONFLICT'], [provenance, 'PROVENANCE_CONFLICT']]) {
        const accepted = await upload(proxy, projects.a, fixture, token); assert.equal(accepted.status, 202);
        const done = await waitForImport(proxy, projects.a, accepted.value.importId, token, pool); assert.equal(done.state, 'failed'); assert.equal(done.failure.code, code);
      }
      const listed = await jsonRequest(proxy, `/api/projects/${projects.a}/model-versions`, { token }); assert.equal(listed.value.versions.length, 1); assert.equal(listed.value.selection.activeModelVersionId, versionId);
    });
    await step('both real 342-resource ZIP transports import through the proxy and deduplicate by content', async () => {
      const inputs = [
        { filename: '/packages/aalborg-svf-stage3.zip', bytes: 439112829, sha256: '8e11874a91215a7a35131dfcfb736a7ce43d801264525f8fd714cb364b9301d5', packageId: 'ba1d44aa-9062-4c7f-9c84-895245bc0630' },
        { filename: '/packages/aalborg-svf-v1.zip', bytes: 439112840, sha256: 'e3056f28efaa57eef65f81dbdfe41396d9e010bdc975738d1259c58af6c3a922', packageId: 'cc477b02-e0f9-47bc-b965-7064e93404fe' },
      ];
      const results = [];
      for (const input of inputs) {
        assert.deepEqual(await hashFile(input.filename), { bytes: input.bytes, sha256: input.sha256 });
        const accepted = await upload(proxy, projects.real, { filename: input.filename, report: { package: input } }, token, { expectContinue: false }); assert.equal(accepted.status, 202); assert.equal(accepted.sentBytes, input.bytes);
        const done = await waitForImport(proxy, projects.real, accepted.value.importId, token, pool); assert.equal(done.state, 'complete'); results.push(done);
      }
      assert.equal(results[0].modelVersionId, results[1].modelVersionId); assert.equal(results[1].duplicate, true);
      const stored = await compareStored(pool, client, results[0].modelVersionId); assert.equal(stored.resources, 342); assert.equal(stored.bytes, 439007803);
      const anonymousObject = await fetch('http://minio:9000/stage4-models/' + stored.firstKey); assert.equal(anonymousObject.status, 403); await anonymousObject.body?.cancel();
      const anonymousList = await fetch('http://minio:9000/stage4-models?list-type=2'); assert.equal(anonymousList.status, 403); await anonymousList.body?.cancel();
      const listed = await jsonRequest(proxy, `/api/projects/${projects.real}/model-versions`, { token }); assert.equal(listed.value.versions.length, 1); assert.equal(listed.value.selection.activeModelVersionId, null);
      assert.equal(listed.value.versions[0].contentFingerprint, 'b5bb4fbe666b440c73bb1ffd2ee0db01be66146f8002e4a9df8dce8521db1d34');
      const selected = await jsonRequest(proxy, `/api/projects/${projects.real}/active-model`, { token, method: 'PATCH', body: { modelVersionId: results[0].modelVersionId, expectedSelectionRevision: 0 } });
      assert.equal(selected.status, 200); assert.equal(selected.value.selection.activeModelVersionId, results[0].modelVersionId);
      const jobs = (await pool.query('SELECT id,project_id,requested_by,archive_sha256,expected_bytes,received_bytes,state,model_version_id,duplicate,verification_report,created_at,updated_at FROM model_import_jobs WHERE id=ANY($1::uuid[]) ORDER BY array_position($1::uuid[],id)', [results.map(value => value.id)])).rows;
      assert.equal(jobs.length, 2);
      for (let index = 0; index < jobs.length; index++) {
        const job = jobs[index], input = inputs[index];
        assert.equal(job.requested_by, users.engineer.id);
        assert.equal(job.verification_report.status, 'PASS'); assert.equal(job.verification_report.package.packageId, input.packageId);
        assert.equal(job.verification_report.package.sha256, input.sha256); assert.equal(job.verification_report.package.bytes, input.bytes);
        assert.equal(job.archive_sha256, input.sha256); assert.equal(Number(job.received_bytes), input.bytes); assert.equal(job.state, 'complete');
      }
      const aliases = (await pool.query('SELECT package_id,model_version_id FROM model_package_aliases WHERE project_id=$1 ORDER BY package_id', [projects.real])).rows;
      assert.deepEqual(aliases.map(value => value.package_id).sort(), inputs.map(value => value.packageId).sort());
      assert.ok(aliases.every(value => value.model_version_id === results[0].modelVersionId));
      const version = (await pool.query('SELECT id,project_id,package_id,content_fingerprint,label,source,schema_version,support_profile,format,sdk_version,entrypoint,prepared_at,imported_at,imported_by,state,health,resource_count,total_bytes,validation_report_id,manifest,storage_prefix FROM model_versions WHERE id=$1 AND project_id=$2', [results[0].modelVersionId, projects.real])).rows[0];
      assert.equal(version.imported_by, users.engineer.id); assert.equal(listed.value.versions[0].importedBy, users.engineer.id);
      assert.equal(version.package_id, inputs[0].packageId); assert.equal(version.source.sha256, '11b2739d92020ee58a52a4e793cf8fd538fb30758eb42176aba93ac7319b048a');
      assert.equal(version.source.bytes, 155285346); assert.equal(version.source.identityBasis, 'observed-local-file');
      const validation = (await pool.query('SELECT id,report,storage_readback,created_at FROM model_validation_reports WHERE id=$1', [version.validation_report_id])).rows[0];
      assert.equal(validation.storage_readback.status, 'PASS'); assert.equal(validation.storage_readback.resourceCount, 342); assert.equal(validation.storage_readback.totalBytes, 439007803);
      const selection = (await pool.query('SELECT project_id,active_model_version_id,selection_revision,updated_at FROM project_model_selections WHERE project_id=$1', [projects.real])).rows[0];
      assert.equal(selection.active_model_version_id, version.id); assert.equal(selection.selection_revision, selected.value.selection.selectionRevision);
      const physicalObjects = []; let physicalBytes = 0;
      for await (const object of client.listObjectsV2('stage4-models', `projects/${projects.real}/`, true)) {
        assert.ok(object.name?.startsWith(version.storage_prefix)); physicalObjects.push({ key: object.name, bytes: object.size }); physicalBytes += object.size;
      }
      assert.equal(physicalObjects.length, 342); assert.equal(physicalBytes, 439007803);
      assert.deepEqual(physicalObjects.map(value => value.key).sort(), stored.inventory.map(value => version.storage_prefix + value.path).sort());
      const proofBasename = path.parse(path.basename(evidence)).name + '-real-proof.json';
      const proofBytes = Buffer.from(JSON.stringify({ schemaVersion: 1, capturedAt: new Date().toISOString(), scope: 'Private isolated-fixture proof; explicit DB columns and observed raw hashes, without authentication credentials or ownership tokens.', expectedAuthenticatedUserId: users.engineer.id, inputs, jobs, aliases, version, validation, selection, observedInventory: stored.inventory, physicalStorage: { resourceCount: physicalObjects.length, totalBytes: physicalBytes, objects: physicalObjects } }, null, 2) + '\n');
      await fs.writeFile(path.join(path.dirname(evidence), proofBasename), proofBytes, { flag: 'wx' });
      return { projectId: projects.real, modelVersionId: results[0].modelVersionId, primaryImportId: results[0].id, selectionRevision: selected.value.selection.selectionRevision, transports: inputs.map(({ bytes, sha256, packageId }) => ({ bytes, sha256, packageId })), resourcesReadback: stored.resources, rawBytesReadback: stored.bytes, contentFingerprint: listed.value.versions[0].contentFingerprint, anonymousListStatus: 403, anonymousObjectStatus: 403, realProof: { file: proofBasename, bytes: proofBytes.length, sha256: sha256(proofBytes) }, physicalResourceCount: physicalObjects.length, physicalRawBytes: physicalBytes };
    });
    report.status = 'PASS';
  } catch { report.status = 'FAIL'; process.exitCode = 1; }
  finally {
    await pool.end();
    const relative = path.relative(await fs.realpath(os.tmpdir()), root); assert.ok(relative.startsWith('wfc-model-registry-integration-') && !relative.includes(path.sep));
    await fs.rm(root, { recursive: true, force: true });
    report.finishedAt = new Date().toISOString(); report.passed = observations.filter(value => value.status === 'PASS').length; report.failed = observations.filter(value => value.status === 'FAIL').length;
    await fs.writeFile(evidence, JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
    console.log(JSON.stringify({ status: report.status, passed: report.passed, failed: report.failed }));
  }
}

async function verifyRestart() {
  assertFixtureEnvironment();
  const startedAt = new Date().toISOString(), input = process.env.MODEL_REGISTRY_MAIN_EVIDENCE || '/evidence/model-registry-integration.json';
  const evidence = process.env.MODEL_REGISTRY_EVIDENCE || '/evidence/model-registry-restart.json';
  assert.ok(path.isAbsolute(evidence) && path.dirname(evidence) === '/evidence' && evidence !== input);
  const previous = JSON.parse(await fs.readFile(input, 'utf8'));
  assert.equal(previous.status, 'PASS');
  const facts = previous.cases.find(value => value.name === 'both real 342-resource ZIP transports import through the proxy and deduplicate by content')?.facts;
  assert.ok(facts && /^[0-9a-f-]{36}$/.test(facts.projectId) && /^[0-9a-f-]{36}$/.test(facts.modelVersionId));
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
  const client = new Client({ endPoint: 'minio', port: 9000, useSSL: false, accessKey: process.env.MINIO_ACCESS_KEY, secretKey: process.env.MINIO_SECRET_KEY });
  const report = { schemaVersion: 1, startedAt, nodeVersion: process.version, status: 'RUNNING', scope: 'Post-runner-restart verification; no upload or package creation is repeated.', cases: [] };
  try {
    const id = randomUUID(), email = `stage4-restart-${id}@fixture.invalid`, password = randomBytes(24).toString('base64url');
    await pool.query('INSERT INTO users(id,email,password_hash,is_admin,role) VALUES($1,$2,$3,false,$4)', [id, email, await bcrypt.hash(password, 10), 'engineer']);
    await pool.query('INSERT INTO user_project_access(user_id,project_id) VALUES($1,$2)', [id, facts.projectId]);
    const login = await jsonRequest('http://proxy:80', '/api/auth/login', { method: 'POST', body: { email, password } }); assert.equal(login.status, 200);
    for (const base of ['http://api:4000', 'http://api2:4000', 'http://proxy:80']) {
      const listed = await jsonRequest(base, `/api/projects/${facts.projectId}/model-versions`, { token: login.value.token }); assert.equal(listed.status, 200);
      assert.equal(listed.value.versions.length, 1); assert.equal(listed.value.versions[0].id, facts.modelVersionId); assert.equal(listed.value.versions[0].state, 'ready'); assert.equal(listed.value.versions[0].health, 'healthy');
      assert.equal(listed.value.versions[0].contentFingerprint, facts.contentFingerprint); assert.equal(listed.value.selection.activeModelVersionId, facts.modelVersionId); assert.equal(listed.value.selection.selectionRevision, facts.selectionRevision);
      const job = await jsonRequest(base, `/api/projects/${facts.projectId}/model-imports/${facts.primaryImportId}`, { token: login.value.token }); assert.equal(job.status, 200); assert.equal(job.value.job.state, 'complete'); assert.equal(job.value.job.modelVersionId, facts.modelVersionId);
    }
    const readback = await compareStored(pool, client, facts.modelVersionId); assert.equal(readback.resources, 342); assert.equal(readback.bytes, 439007803);
    report.cases.push({ name: 'both restarted API workers and proxy preserve ready version, explicit selection and all 342 resource hashes', status: 'PASS', projectId: facts.projectId, modelVersionId: facts.modelVersionId, selectionRevision: facts.selectionRevision, resourcesReadback: readback.resources, rawBytesReadback: readback.bytes });
    report.status = 'PASS';
  } catch { report.status = 'FAIL'; process.exitCode = 1; report.cases.push({ name: 'post-restart persisted model verification', status: 'FAIL', code: 'ASSERTION_FAILED' }); }
  finally { await pool.end(); report.finishedAt = new Date().toISOString(); await fs.writeFile(evidence, JSON.stringify(report, null, 2) + '\n', { flag: 'wx' }); console.log(JSON.stringify({ status: report.status, cases: report.cases.length })); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const run = process.argv.includes('--verify-restart') ? verifyRestart : main;
  run().catch(() => { console.error(JSON.stringify({ error: { code: 'ISOLATED_FIXTURE_DRIVER_FAILED' } })); process.exitCode = 1; });
}
