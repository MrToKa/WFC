import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createHash, randomUUID } from 'node:crypto';
import { PassThrough } from 'node:stream';
import type { IncomingMessage } from 'node:http';
import { setTimeout as delay } from 'node:timers/promises';
import pg from 'pg';
import { createModelRegistryRepository } from '../modelRegistry/repository.js';
import { createModelStorage } from '../modelRegistry/storage.js';
import { createModelImportService } from '../modelRegistry/importService.js';
import { createViewerSessionService } from '../viewerSessions/service.js';
import { initializeViewerSessions } from '../viewerSessions/schema.js';
import type { ViewerPrincipal } from '../viewerSessions/types.js';
import { signAccessToken } from '../auth.js';
import { Client } from 'minio';
import http from 'node:http';
import jwt from 'jsonwebtoken';

const helpers = await import(new URL('../../../../scripts/model-registry/integration.mjs', import.meta.url).href) as {
  assertFixtureEnvironment(): void;
  makeSyntheticPackage(root: string, options?: { propertyText?: string }): Promise<{ filename: string }>;
};

async function fixture(t: TestContext, role = 'engineer') {
  helpers.assertFixtureEnvironment();
  const tempBase = await fs.realpath(os.tmpdir()), root = await fs.mkdtemp(path.join(tempBase, 'wfc-viewer-sessions-'));
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 10 });
  const repository = createModelRegistryRepository(pool), storage = createModelStorage({ bucket: 'stage4-models' });
  const imports = createModelImportService({ repository, storage });
  t.after(async () => { await imports.close(); await pool.end(); assert.equal(path.dirname(root), tempBase); assert.ok(path.basename(root).startsWith('wfc-viewer-sessions-')); await fs.rm(root, { recursive: true, force: true }); });
  await imports.initialize(); await initializeViewerSessions(pool);
  const projectId = randomUUID(), userId = randomUUID();
  await pool.query('INSERT INTO users(id,email,password_hash,is_admin,role) VALUES($1,$2,$3,$4,$5)', [userId, 'stage5-' + userId + '@fixture.invalid', 'Synthetic direct-service fixture; not a login password.', role === 'admin', 'engineer']);
  await pool.query('INSERT INTO projects(id,project_number,name,customer) VALUES($1,$2,$3,$4)', [projectId, 'STAGE5-' + projectId, 'Viewer resource session fixture', 'Isolated test']);
  await pool.query('INSERT INTO user_project_access(user_id,project_id) VALUES($1,$2)', [userId, projectId]);
  let clock = Date.now();
  const a = createViewerSessionService({ pool, clock: () => clock }), b = createViewerSessionService({ pool, clock: () => clock });
  const principal: ViewerPrincipal = { userId, loginId: randomUUID(), loginExpiresAt: clock + 60 * 60_000 };
  async function importVersion(propertyText = 'viewer session fixture') {
    const candidate = await helpers.makeSyntheticPackage(root, { propertyText }), bytes = await fs.readFile(candidate.filename);
    const request = Object.assign(new PassThrough(), { complete: true }); request.end(bytes);
    const accepted = await imports.receive(request as unknown as IncomingMessage, { projectId, requestedBy: userId, idempotencyKey: randomUUID(), archiveSha256: createHash('sha256').update(bytes).digest('hex'), expectedBytes: bytes.length });
    const deadline = Date.now() + 30_000;
    for (;;) {
      const job = await imports.getImport(projectId, accepted.job.id);
      if (job.state === 'failed') throw Error('Synthetic ready fixture failed: ' + job.failure?.code);
      if (job.state === 'complete') { assert.ok(job.modelVersionId); return job.modelVersionId; }
      assert.ok(Date.now() < deadline); await delay(20);
    }
  }
  const versionId = await importVersion(); await imports.selectModel(projectId, versionId, 0, userId);
  await pool.query('UPDATE users SET role=$2 WHERE id=$1', [userId, role]);
  const create = () => a.create({ principal, projectId, modelVersionId: versionId, loadId: randomUUID() });
  const identity = (created: Awaited<ReturnType<typeof create>>) => ({ projectId, modelVersionId: versionId, sessionId: created.session.sessionId, cookieSecret: created.cookieSecret });
  return { root, pool, imports, repository, storage, projectId, userId, versionId, principal, a, b, create, identity, importVersion, now: () => clock, advance: (ms: number) => { clock += ms; } };
}

test('real shared PG session stores only a hash, exact DTO and rejects copied identity without secret', async t => {
  const s = await fixture(t), created = await s.create(), identity = s.identity(created);
  assert.deepEqual(Object.keys(created.session).sort(), ['absoluteExpiresAt','expiresAt','loadId','modelVersionId','projectId','sessionId'].sort());
  assert.equal(new Date(created.session.expiresAt).getTime() - s.now(), 300_000);
  assert.equal(new Date(created.session.absoluteExpiresAt).getTime() - s.now(), 1_800_000);
  const row = (await s.pool.query('SELECT secret_hash,selection_revision FROM viewer_resource_sessions WHERE id=$1', [created.session.sessionId])).rows[0];
  assert.equal(row.secret_hash, createHash('sha256').update(created.cookieSecret).digest('hex')); assert.equal(row.selection_revision, 1);
  assert.equal(JSON.stringify(row).includes(created.cookieSecret), false);
  assert.equal((await s.b.authorizeResource(identity)).session.loadId, created.session.loadId);
  await assert.rejects(s.b.authorizeResource({ ...identity, cookieSecret: '' }));
  await assert.rejects(s.b.authorizeResource({ ...identity, cookieSecret: 'a'.repeat(43) }));
  await assert.rejects(s.b.authorizeResource({ ...identity, projectId: randomUUID() }));
  await assert.rejects(s.b.authorizeResource({ ...identity, modelVersionId: randomUUID() }));
  await assert.rejects(s.b.authorizeResource({ ...identity, sessionId: randomUUID() }));
});

test('real PG sliding renewal crosses workers but never absolute expiry or expired session', async t => {
  const s = await fixture(t), created = await s.create(), identity = s.identity(created);
  for (let i = 0; i < 7; i++) { s.advance(240_000); const renewed = await s.b.renew({ ...identity, principal: s.principal }); assert.equal(renewed.absoluteExpiresAt, created.session.absoluteExpiresAt); assert.ok(new Date(renewed.expiresAt).getTime() <= new Date(renewed.absoluteExpiresAt).getTime()); }
  s.advance(120_000);
  await assert.rejects(s.a.authorizeResource(identity), { code: 'SESSION_EXPIRED' });
  await assert.rejects(s.b.renew({ ...identity, principal: s.principal }), { code: 'SESSION_EXPIRED' });
  const fresh = await s.create(); s.advance(300_000);
  await assert.rejects(s.b.authorizeResource(s.identity(fresh)), { code: 'SESSION_EXPIRED' });
});

test('real login tombstone separates same-user logins and fences concurrent first create/logout', async t => {
  const s = await fixture(t), first = await s.create(), otherPrincipal = { ...s.principal, loginId: randomUUID() };
  const other = await s.b.create({ principal: otherPrincipal, projectId: s.projectId, modelVersionId: s.versionId, loadId: randomUUID() });
  await s.b.revokeLogin(s.principal);
  await assert.rejects(s.a.authorizeResource(s.identity(first)), { code: 'SESSION_REVOKED' });
  await assert.rejects(s.create(), { code: 'SESSION_REVOKED' });
  await s.a.authorizeResource(s.identity(other));
  const racingPrincipal = { ...s.principal, loginId: randomUUID() };
  const outcomes = await Promise.allSettled([s.a.create({ principal: racingPrincipal, projectId: s.projectId, modelVersionId: s.versionId, loadId: randomUUID() }), s.b.revokeLogin(racingPrincipal)]);
  assert.equal(outcomes[1].status, 'fulfilled');
  if (outcomes[0].status === 'fulfilled') await assert.rejects(s.b.authorizeResource(s.identity(outcomes[0].value)), { code: 'SESSION_REVOKED' });
  else assert.equal((outcomes[0].reason as { code: string }).code, 'SESSION_REVOKED');
});

test('real selection fence survives away/back, create/select and renew/select races', async t => {
  const s = await fixture(t), first = await s.create(), identity = s.identity(first);
  await s.imports.selectModel(s.projectId, null, 1, s.userId); await s.imports.selectModel(s.projectId, s.versionId, 2, s.userId);
  await assert.rejects(s.b.authorizeResource(identity), { code: 'MODEL_SELECTION_CHANGED' });
  await assert.rejects(s.a.renew({ ...identity, principal: s.principal }), { code: 'MODEL_SELECTION_CHANGED' });
  const fresh = await s.create();
  const outcomes = await Promise.allSettled([s.a.renew({ ...s.identity(fresh), principal: s.principal }), s.imports.selectModel(s.projectId, null, 3, s.userId)]);
  assert.equal(outcomes[1].status, 'fulfilled'); await assert.rejects(s.b.authorizeResource(s.identity(fresh)), { code: 'MODEL_SELECTION_CHANGED' });
  await s.imports.selectModel(s.projectId, s.versionId, 4, s.userId);
  const race = await Promise.allSettled([s.create(), s.imports.selectModel(s.projectId, null, 5, s.userId)]);
  assert.equal(race[1].status, 'fulfilled');
  if (race[0].status === 'fulfilled') await assert.rejects(s.b.authorizeResource(s.identity(race[0].value)), { code: 'MODEL_SELECTION_CHANGED' });
});

test('real current grant/role, user deletion and project deletion deny subsequent access', async t => {
  const s = await fixture(t, 'basic'), first = await s.create();
  await s.pool.query('DELETE FROM user_project_access WHERE user_id=$1 AND project_id=$2', [s.userId, s.projectId]);
  await assert.rejects(s.b.authorizeResource(s.identity(first)), { code: 'ACCESS_REVOKED' });
  await assert.rejects(s.create(), { code: 'ACCESS_REVOKED' });
  await s.pool.query("UPDATE users SET role='engineer' WHERE id=$1", [s.userId]);
  const second = await s.create(); await s.pool.query("UPDATE users SET role='basic' WHERE id=$1", [s.userId]);
  await assert.rejects(s.a.authorizeResource(s.identity(second)), { code: 'ACCESS_REVOKED' });
  await s.pool.query("UPDATE users SET role='engineer' WHERE id=$1", [s.userId]);
  const third = await s.create(); await s.pool.query('DELETE FROM users WHERE id=$1', [s.userId]); await assert.rejects(s.b.authorizeResource(s.identity(third)));
  await s.pool.query('DELETE FROM projects WHERE id=$1', [s.projectId]); await assert.rejects(s.a.authorizeResource(s.identity(third)));
});

test('real model availability revocation persists across service instances', async t => {
  const s = await fixture(t), created = await s.create();
  await s.b.markUnavailable(s.projectId, s.versionId);
  await assert.rejects(s.a.authorizeResource(s.identity(created)), { code: 'MODEL_UNAVAILABLE' });
  await assert.rejects(s.create(), { code: 'MODEL_UNAVAILABLE' });
  assert.equal((await s.repository.getVersion(s.projectId, s.versionId))?.health, 'unavailable');
});

test('real project-row lock orders corruption marking before a concurrently queued create', async t => {
  const s=await fixture(t),first=await s.create(),applicationName='viewer-health-'+randomUUID();
  const markingPool=new pg.Pool({ connectionString:process.env.DATABASE_URL,application_name:applicationName,max:1 });
  const marker=createViewerSessionService({ pool:markingPool,clock:s.now }),blocker=await s.pool.connect();
  let marking:Promise<void>|undefined,creating:ReturnType<typeof s.create>|undefined;
  try {
    await blocker.query('BEGIN'); await blocker.query('SELECT id FROM projects WHERE id=$1 FOR UPDATE',[s.projectId]);
    marking=marker.markUnavailable(s.projectId,s.versionId);
    const deadline=Date.now()+5000;
    for(;;) {
      const waiting=await s.pool.query("SELECT 1 FROM pg_stat_activity WHERE application_name=$1 AND wait_event_type='Lock'",[applicationName]);
      if(waiting.rows.length) break;
      assert.ok(Date.now()<deadline,'Actual health marker did not wait on project lock'); await delay(10);
    }
    creating=s.create(); await blocker.query('COMMIT');
    await marking; await assert.rejects(creating,{ code:'MODEL_UNAVAILABLE' });
    await assert.rejects(s.b.authorizeResource(s.identity(first)),{ code:'MODEL_UNAVAILABLE' });
  } finally {
    await blocker.query('ROLLBACK').catch(()=>{}); blocker.release();
    await Promise.allSettled([marking,creating]); await markingPool.end();
  }
});

const publicOrigin = (process.env.WFC_VIEWER_ALLOWED_ORIGINS ?? 'http://127.0.0.1:18085').split(',')[0];
const workerA = 'http://api:4000', workerB = 'http://api2:4000';
async function httpCall(worker: string, route: string, options: { token?: string; cookie?: string; method?: string; body?: object; headers?: Record<string,string> } = {}) {
  return await new Promise<{ status: number; headers: http.IncomingHttpHeaders; bytes: Buffer; value: Record<string,any> | null }>((resolve,reject) => {
    const target = new URL(worker), encoded = options.body ? Buffer.from(JSON.stringify(options.body)) : null;
    const request = http.request({ hostname: target.hostname,port: target.port,path: route,method: options.method ?? 'GET',headers: {
      Host: new URL(publicOrigin).host,Origin: publicOrigin,'Sec-Fetch-Site': 'same-origin',
      ...(options.token ? { Authorization: 'Bearer ' + options.token } : {}),...(options.cookie ? { Cookie: options.cookie } : {}),
      ...(encoded ? { 'Content-Type': 'application/json','Content-Length': String(encoded.length) } : {}),...options.headers,
    } },response => { const chunks: Buffer[] = []; response.on('data',chunk => chunks.push(chunk)); response.once('error',reject); response.once('end',() => {
      const bytes = Buffer.concat(chunks); let value = null; try { value = JSON.parse(bytes.toString()); } catch { /* Raw model bytes are intentionally not JSON. */ }
      resolve({ status: response.statusCode!,headers: response.headers,bytes,value });
    }); });
    request.setTimeout(30_000,() => request.destroy(Error('Isolated viewer HTTP timeout'))); request.once('error',reject); request.end(encoded);
  });
}
const baseFor = (s: { projectId: string; versionId: string }) => `/api/projects/${s.projectId}/model-versions/${s.versionId}/viewer-sessions`;
const tokenFor = (s: { userId: string }, admin = false) => signAccessToken(s.userId,'stage5-fixture@fixture.invalid',admin).token;
function privateResponse(response: Awaited<ReturnType<typeof httpCall>>) {
  assert.match(String(response.headers['cache-control']),/private/); assert.match(String(response.headers['cache-control']),/no-store/);
  assert.equal(response.headers['x-content-type-options'],'nosniff'); assert.equal(response.headers['access-control-allow-origin'],undefined);
}
async function httpSession(s: { projectId: string; versionId: string; userId: string }, token = tokenFor(s)) {
  const loadId = randomUUID(), created = await httpCall(workerA,baseFor(s),{ token,method: 'POST',body: { loadId } });
  assert.equal(created.status,201); privateResponse(created); assert.ok(created.value);
  const header = created.headers['set-cookie']; assert.ok(header?.length === 1);
  const cookie = header[0].split(';')[0], base = baseFor(s) + '/' + created.value.sessionId + '/';
  assert.ok(header[0].includes('Path=' + base)); assert.match(header[0],/HttpOnly/); assert.match(header[0],/SameSite=Strict/);
  assert.equal(/;\s*Secure(?:;|$)/.test(header[0]),false);
  assert.deepEqual(Object.keys(created.value).sort(),['absoluteExpiresAt','expiresAt','loadId','modelVersionId','projectId','sessionId'].sort());
  assert.equal(created.value.loadId,loadId);
  return { base,cookie,token,session: created.value };
}

test('real two-worker HTTP cookie descriptor, raw gzip, GET/HEAD/ranges/methods and private denials', async t => {
  const s = await fixture(t), session = await httpSession(s), descriptor = await httpCall(workerB,session.base + 'descriptor',{ cookie: session.cookie });
  assert.equal(descriptor.status,200); privateResponse(descriptor);
  assert.deepEqual(Object.keys(descriptor.value!).sort(),['projectId','modelVersionId','loadId','contentFingerprint','supportProfile','format','sdkVersion','entrypoint','resourceCount','totalBytes'].sort());
  assert.equal(descriptor.value!.entrypoint,'resources/output/0/0.svf'); assert.equal(descriptor.value!.loadId,session.session.loadId);
  const version = await s.repository.getVersion(s.projectId,s.versionId); assert.ok(version);
  const resource = version.manifest.resources.find(value => value.path === 'resources/output/0/0.pf'); assert.ok(resource);
  const route = session.base + 'resources/output/0/0.pf', full = await httpCall('http://proxy',route,{ cookie: session.cookie });
  assert.equal(full.status,200); privateResponse(full); assert.equal(full.bytes.length,resource.bytes); assert.equal(full.bytes[0],0x1f); assert.equal(full.bytes[1],0x8b);
  assert.equal(createHash('sha256').update(full.bytes).digest('hex'),resource.sha256); assert.equal(full.headers['content-encoding'],undefined);
  assert.equal(Number(full.headers['content-length']),full.bytes.length);
  const sdkQuery='?domain='+encodeURIComponent(publicOrigin);
  const sdkRead=await httpCall('http://proxy',route+sdkQuery,{ cookie:session.cookie }); assert.equal(sdkRead.status,200); privateResponse(sdkRead); assert.deepEqual(sdkRead.bytes,full.bytes);
  const sdkHead=await httpCall(workerB,route+sdkQuery,{ cookie:session.cookie,method:'HEAD' }); assert.equal(sdkHead.status,200); assert.equal(sdkHead.bytes.length,0); privateResponse(sdkHead);
  for(const query of ['?domain=','?domain='+encodeURIComponent(publicOrigin+'/'),'?domain='+encodeURIComponent('https://foreign.invalid'),sdkQuery+'&domain='+encodeURIComponent(publicOrigin),sdkQuery+'&token=synthetic-not-a-credential','?acmsession=synthetic-not-a-credential','?v=1']) {
    const denied=await httpCall('http://proxy',route+query,{ cookie:session.cookie }); assert.equal(denied.status,400); privateResponse(denied);
  }
  assert.equal((await httpCall(workerA,session.base+'descriptor'+sdkQuery,{ cookie:session.cookie })).status,400);
  assert.equal((await httpCall(workerA,baseFor(s)+sdkQuery,{ token:session.token,method:'POST',body:{ loadId:randomUUID() } })).status,400);
  assert.equal((await httpCall(workerB,session.base+'renew'+sdkQuery,{ token:session.token,cookie:session.cookie,method:'POST',body:{} })).status,400);
  const head = await httpCall(workerA,route,{ cookie: session.cookie,method: 'HEAD' }); assert.equal(head.status,200); privateResponse(head); assert.equal(head.bytes.length,0); assert.equal(head.headers['content-length'],String(resource.bytes));
  for (const [range,start,end] of [['bytes=0-3',0,3],['bytes=4-',4,resource.bytes-1],['bytes=-4',resource.bytes-4,resource.bytes-1]] as const) {
    const result = await httpCall(workerB,route,{ cookie: session.cookie,headers: { Range: range } }); assert.equal(result.status,206); privateResponse(result);
    assert.equal(result.headers['content-range'],`bytes ${start}-${end}/${resource.bytes}`); assert.deepEqual(result.bytes,full.bytes.subarray(start,end+1)); assert.equal(Number(result.headers['content-length']),end-start+1);
  }
  for (const range of ['bytes=0-1,3-4','bytes=999999-','bytes=4-3','bytes=-0','invalid']) {
    const result = await httpCall(workerA,route,{ cookie: session.cookie,headers: { Range: range } }); assert.equal(result.status,416); privateResponse(result); assert.equal(result.headers['content-range'],`bytes */${resource.bytes}`);
  }
  const conditional = await httpCall(workerB,route,{ cookie: session.cookie,headers: { 'If-None-Match': '*' } }); assert.equal(conditional.status,200); assert.deepEqual(conditional.bytes,full.bytes);
  assert.equal((await httpCall(workerA,route,{ cookie: session.cookie,method: 'POST' })).status,405);
  for (const tail of ['resources/not-in-manifest.pf','resources/resources/output/0/0.pf','resources/%2e%2e/0.pf','resources/%252e%252e/0.pf','resources/output%2f0/0.pf','resources/output%5c0/0.pf']) {
    const result = await httpCall(workerB,session.base + tail,{ cookie: session.cookie }); assert.equal(result.status,404); privateResponse(result); assert.equal(result.headers['content-type']?.includes('text/html'),false);
  }
  const deniedRequests: { cookie?: string; headers?: Record<string,string> }[] = [{},{ cookie: session.cookie,headers: { Origin: 'https://foreign.invalid' } },{ cookie: session.cookie,headers: { 'Sec-Fetch-Site': 'cross-site' } }];
  for (const options of deniedRequests) {
    const result = await httpCall(workerA,route,options); assert.ok([401,403].includes(result.status)); privateResponse(result);
  }
  const renewed = await httpCall(workerB,session.base + 'renew',{ token: session.token,cookie: session.cookie,method: 'POST',body: {} }); assert.equal(renewed.status,200);
  assert.equal((await httpCall(workerA,'/api/viewer-sessions/revoke-login',{ token: session.token,method: 'POST' })).status,204);
  assert.equal((await httpCall(workerB,route,{ cookie: session.cookie })).status,410);
});

test('real HTTP all WFC roles keep read-session exceptions narrow and login-specific', async t => {
  const s = await fixture(t);
  for (const item of [{ role:'admin',admin:true,assigned:false,allowed:true },{ role:'admin',admin:false,assigned:false,allowed:false },{ role:'engineer',admin:false,assigned:false,allowed:true },{ role:'basic',admin:false,assigned:true,allowed:true },{ role:'technician',admin:false,assigned:true,allowed:true },{ role:'basic',admin:false,assigned:false,allowed:false },{ role:'technician',admin:false,assigned:false,allowed:false }]) {
    const userId = randomUUID(); await s.pool.query('INSERT INTO users(id,email,password_hash,is_admin,role) VALUES($1,$2,$3,$4,$5)',[userId,'stage5-'+userId+'@fixture.invalid','Synthetic no-login fixture',item.admin,item.role]);
    if (item.assigned) await s.pool.query('INSERT INTO user_project_access(user_id,project_id) VALUES($1,$2)',[userId,s.projectId]);
    const token = tokenFor({ userId },item.admin), result = await httpCall(workerA,baseFor(s),{ token,method:'POST',body:{ loadId:randomUUID() } });
    assert.equal(result.status,item.allowed ? 201 : 403,JSON.stringify(item)); privateResponse(result);
    if (item.allowed && item.role !== 'admin' && item.role !== 'engineer') {
      assert.equal((await httpCall(workerB,`/api/projects/${s.projectId}/active-model`,{ token,method:'PATCH',body:{ modelVersionId:null,expectedSelectionRevision:1 } })).status,403);
      assert.equal((await httpCall(workerB,`/api/projects/${s.projectId}/future-mutation`,{ token,method:'POST',body:{} })).status,403);
    }
  }
  const first = await httpSession(s), second = await httpSession(s);
  assert.notEqual(first.token,second.token);
  assert.equal((await httpCall(workerA,'/api/viewer-sessions/revoke-login',{ token:first.token,method:'POST' })).status,204);
  assert.equal((await httpCall(workerB,first.base+'descriptor',{ cookie:first.cookie })).status,410);
  assert.equal((await httpCall(workerB,second.base+'descriptor',{ cookie:second.cookie })).status,200);
});

test('real MinIO missing/corrupt full and ranged reads mark unavailable before success headers', async t => {
  const client = new Client({ endPoint:'minio',port:9000,useSSL:false,accessKey:process.env.MINIO_ACCESS_KEY,secretKey:process.env.MINIO_SECRET_KEY,retryOptions:{ disableRetry:true } });
  for (const mode of ['missing','corrupt','truncated'] as const) {
    const s = await fixture(t), session = await httpSession(s), version = await s.repository.getVersion(s.projectId,s.versionId); assert.ok(version);
    const resource = version.manifest.resources.find(value => value.path.endsWith('/0.pf')); assert.ok(resource); const key = version.storagePrefix+resource.path;
    if (mode === 'missing') await client.removeObject('stage4-models',key);
    else await client.putObject('stage4-models',key,Buffer.alloc(mode === 'truncated' ? resource.bytes-1 : resource.bytes,0xa5));
    const result = await httpCall(workerB,session.base+'resources/output/0/0.pf',{ cookie:session.cookie,headers:{ Range:'bytes=0-0' } });
    assert.equal(result.status,409,mode); privateResponse(result); assert.equal(result.value!.code,'MODEL_UNAVAILABLE'); assert.notEqual(result.headers['content-type'],'application/octet-stream');
    assert.equal((await s.repository.getVersion(s.projectId,s.versionId))?.health,'unavailable');
    assert.equal((await httpCall(workerA,session.base+'descriptor',{ cookie:session.cookie })).status,409);
  }
});

test('real independent project cookies, ownership close and legacy login policy across workers', async t => {
  const a = await fixture(t), b = await fixture(t), token = tokenFor(a);
  const first = await httpSession(a,token), second = await httpSession(b,token);
  assert.notEqual(first.session.sessionId,second.session.sessionId); assert.notEqual(first.cookie,second.cookie);
  assert.notEqual(first.base,second.base);
  assert.equal((await httpCall(workerB,first.base+'descriptor',{ cookie:first.cookie })).status,200);
  assert.equal((await httpCall(workerA,second.base+'descriptor',{ cookie:second.cookie })).status,200);
  assert.equal((await httpCall(workerB,first.base+'descriptor',{ cookie:second.cookie })).status,401);
  assert.equal((await httpCall(workerA,second.base+'descriptor',{ cookie:first.cookie })).status,401);
  // A different login for the same user cannot close the session owned by token.
  assert.equal((await httpCall(workerB,first.base.slice(0,-1),{ token:tokenFor(a),method:'DELETE' })).status,204);
  assert.equal((await httpCall(workerA,first.base+'descriptor',{ cookie:first.cookie })).status,200);
  assert.equal((await httpCall(workerB,first.base.slice(0,-1),{ token,method:'DELETE' })).status,204);
  assert.equal((await httpCall(workerA,first.base+'descriptor',{ cookie:first.cookie })).status,410);
  assert.equal((await httpCall(workerB,second.base+'descriptor',{ cookie:second.cookie })).status,200);
  const legacy = jwt.sign({ sub:a.userId,email:'stage5@fixture.invalid',isAdmin:false },process.env.JWT_SECRET!,{ expiresIn:3600 });
  const rejected = await httpCall(workerA,baseFor(a),{ token:legacy,method:'POST',body:{ loadId:randomUUID() } });
  assert.equal(rejected.status,401); assert.equal(rejected.value!.code,'LOGIN_REFRESH_REQUIRED'); privateResponse(rejected);
  assert.equal((await httpCall(workerB,`/api/projects/${a.projectId}/model-versions`,{ token:legacy })).status,200);
});
