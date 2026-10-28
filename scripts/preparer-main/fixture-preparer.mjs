/** Explicit synthetic fixture command. Never imported by the production entry. */
import fs from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
import { createHash, randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

const need = (value, code) => { if (!value) throw Object.assign(Error(code), { code }); };
const hash = (value, algorithm = 'sha256') => createHash(algorithm).update(value).digest('hex');
const UUID = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;
export const SYNTHETIC_NWD = Buffer.from('WFC Simplified Preparer isolated synthetic NWD fixture; not an engineering model.\n');
// Exact tiny synthetic SVF envelope from model-preparer/test/fixtures/model-fixture.mjs.
const SVF = 'UEsDBBQAAAAAAE1iUF3ceDb+9gEAAPYBAAANAAAAbWFuaWZlc3QuanNvbnsiYWRza0lEIjp7InZlcnNpb24iOiIiLCJpZCI6IiIsInR5cGUiOiIiLCJzb3VyY2VTeXN0ZW0iOiIifSwibmFtZSI6IkxNViBNYW5pZmVzdCIsImFzc2V0cyI6W3sidHlwZXNldCI6IjIiLCJVUkkiOiIwLnBmIiwiaWQiOiIwLnBmIiwidHlwZSI6IkF1dG9kZXNrLkNsb3VkUGxhdGZvcm0uUGFja0ZpbGUiLCJzaXplIjo0MSwidXNpemUiOjIxfSx7IlVSSSI6ImVtYmVkOi9tZXRhZGF0YS5qc29uIiwiaWQiOiJtZXRhZGF0YS5qc29uIiwidHlwZSI6IkF1dG9kZXNrLkNsb3VkUGxhdGZvcm0uVmlld2luZ01ldGFkYXRhIiwic2l6ZSI6NjcsInVzaXplIjo2N31dLCJ0eXBlc2V0cyI6W3sidHlwZXMiOlt7ImNsYXNzIjoiQXV0b2Rlc2suQ2xvdWRQbGF0Zm9ybS5HZW9tZXRyeSIsInZlcnNpb24iOjEsInR5cGUiOiJBdXRvZGVzay5DbG91ZFBsYXRmb3JtLk9wZW5DVE0ifV0sImlkIjoiMiJ9XSwidG9vbGtpdHZlcnNpb24iOiJMTVZUSyA1LjAuMjYuMCIsIm1hbmlmZXN0dmVyc2lvbiI6Mn1QSwMEFAAAAAAATWJQXZmneoRDAAAAQwAAAA0AAABtZXRhZGF0YS5qc29ueyJ2ZXJzaW9uIjoiMS4wIiwibWV0YWRhdGEiOnsiZGVmYXVsdCBkaXNwbGF5IHVuaXQiOnsidmFsdWUiOiJtIn19fVBLAQIUABQAAAAAAE1iUF3ceDb+9gEAAPYBAAANAAAAAAAAAAAAAAAAAAAAAABtYW5pZmVzdC5qc29uUEsBAhQAFAAAAAAATWJQXZmneoRDAAAAQwAAAA0AAAAAAAAAAAAAAAAAIQIAAG1ldGFkYXRhLmpzb25QSwUGAAAAAAIAAgB2AAAAjwIAAAAA';
export function syntheticConvertedFiles() { return new Map([['output/0/0.svf', Buffer.from(SVF, 'base64')], ['output/0/0.pf', Buffer.from('H4sIAAAAAAAACgtITM52y8xJVUjLrCgpLUpVSEksSQQA8RQI6hUAAAA=', 'base64')], ['output/0/properties.db', Buffer.from('SQLite format 3\0fixture-data', 'ascii')]]); }
export function validateFixturePrivate(value) {
  need(value?.schemaVersion === 'wfc.preparer.synthetic-integration-private.v1' && UUID.test(value.operationId ?? '') && UUID.test(value.projectId ?? '')
    && value.database?.host === 'wfc-sp-fixture-' + value.operationId + '-postgres' && value.database.name === 'sp_fixture_' + value.operationId.replaceAll('-', '')
    && value.database.port === 5432 && value.database.user === 'sp_fixture' && typeof value.database.password === 'string' && value.database.password.length >= 32
    && value.names?.minio === 'wfc-sp-fixture-' + value.operationId + '-minio'
    && typeof value.minio?.user === 'string' && /^fixture_[a-f0-9]{12}$/.test(value.minio.user) && typeof value.minio.password === 'string' && value.minio.password.length >= 32 && typeof value.jwtSecret === 'string' && value.jwtSecret.length >= 32
    && value.origins?.wfc === 'http://127.0.0.1:5194' && value.origins.preparer === 'http://127.0.0.1:5193'
    && Array.isArray(value.admins) && value.admins.length === 2 && Array.isArray(value.apsApplications) && value.apsApplications.length === 2, 'SP5_FIXTURE_PRIVATE_INVALID');
  for (const admin of value.admins) need(UUID.test(admin.id ?? '') && typeof admin.email === 'string' && /^[a-z0-9.-]+@fixture\.invalid$/.test(admin.email) && typeof admin.password === 'string' && admin.password.length >= 32, 'SP5_FIXTURE_PRIVATE_INVALID');
  for (const app of value.apsApplications) need(typeof app.clientId === 'string' && /^fixture_[a-f0-9]{32}$/.test(app.clientId) && typeof app.clientSecret === 'string' && /^[A-Za-z0-9_-]{43}$/.test(app.clientSecret), 'SP5_FIXTURE_PRIVATE_INVALID');
  need(new Set(value.admins.map(item => item.id)).size === 2 && new Set(value.admins.map(item => item.email)).size === 2 && new Set(value.apsApplications.map(item => item.clientId)).size === 2, 'SP5_FIXTURE_PRIVATE_INVALID'); return value;
}
const json = (value, statusCode = 200, headers = {}) => ({ statusCode, headers, body: Buffer.from(JSON.stringify(value)) });
const asResponse = value => new Response(new Uint8Array(value.body), { status: value.statusCode, headers: value.headers });
export function createSyntheticAPS(configuration, { now = () => Date.now(), onAudit = async () => {} } = {}) {
  const config = validateFixturePrivate(configuration), files = syntheticConvertedFiles(), apps = new Map(config.apsApplications.map(app => [app.clientId, app])), tokens = new Map(config.apsApplications.map(app => ['fixture-' + hash(app.clientId + ':' + app.clientSecret), app.clientId]));
  const buckets = new Map(), objects = new Map(), counts = { oauth: 0, bucket: 0, object: 0, uploadPart: 0, syntheticSubmit: 0, manifest: 0, signedResource: 0, download: 0, unexpected: 0 };
  const audit = async operation => { counts[operation]++; await onAudit({ schemaVersion: 'wfc.preparer.synthetic-aps-audit.v1', operationId: config.operationId, realAutodeskRequests: 0, scope: 'in-process synthetic transport; not real conversion acceptance', counts: { ...counts } }); };
  const fail = async () => { await audit('unexpected'); need(false, 'SP5_UNEXPECTED_SYNTHETIC_NETWORK'); };
  const principal = headers => { const value = new Headers(headers).get('authorization') ?? ''; return tokens.get(value.startsWith('Bearer ') ? value.slice(7) : '') ?? null; };
  const tokenFor = id => [...tokens].find(([, owner]) => owner === id)[0];
  async function bodyBytes(body) { if (body === undefined || body === null) return Buffer.alloc(0); if (typeof body === 'string' || Buffer.isBuffer(body) || body instanceof Uint8Array) return Buffer.from(body); const parts = []; let bytes = 0; for await (const part of body) { bytes += part.length; need(bytes <= 65536, 'SP5_SYNTHETIC_INPUT_ONLY'); parts.push(Buffer.from(part)); } return Buffer.concat(parts); }
  const object = (bucket, key) => { need(key === hash(SYNTHETIC_NWD) + '.nwd', 'SP5_SYNTHETIC_INPUT_ONLY'); const identity = bucket + '/' + key; let value = objects.get(identity); if (!value) { const objectId = 'urn:adsk.objects:os.object:' + identity; value = { bucket, key, objectId, urn: Buffer.from(objectId).toString('base64url'), uploaded: false, submitted: false, part: false }; objects.set(identity, value); } return value; };
  const receipt = value => ({ bucketKey: value.bucket, objectKey: value.key, objectId: value.objectId, size: SYNTHETIC_NWD.length, sha1: hash(SYNTHETIC_NWD, 'sha1') });
  async function request(input) {
    input.signal?.throwIfAborted(); const url = new URL(input.url), method = input.method ?? 'GET', route = url.pathname;
    if (url.protocol !== 'https:') return fail();
    if (url.origin === 'https://developer.api.autodesk.com' && route === '/authentication/v2/token' && method === 'POST') {
      const header = new Headers(input.headers).get('authorization') ?? '', basic = header.startsWith('Basic ') ? Buffer.from(header.slice(6), 'base64').toString('utf8') : '', index = basic.indexOf(':'), id = basic.slice(0, index), app = apps.get(id);
      if (index < 1 || !app || basic.slice(index + 1) !== app.clientSecret) return json({ error: 'Synthetic credentials rejected' }, 401);
      await audit('oauth'); return json({ access_token: tokenFor(id), expires_in: 3600 });
    }
    if (url.hostname === 'com-autodesk-oss-direct-upload.s3-accelerate.amazonaws.com' && method === 'PUT') {
      const value = [...objects.values()].find(item => url.pathname === '/fixture-' + hash(item.bucket + '/' + item.key));
      if (!value) return fail(); need((await bodyBytes(input.body)).equals(SYNTHETIC_NWD), 'SP5_SYNTHETIC_INPUT_ONLY'); value.part = true; await audit('uploadPart'); return json({});
    }
    if (url.hostname === 'cdn.derivative.autodesk.com' && method === 'GET') {
      const value = [...objects.values()].find(item => url.pathname.startsWith('/' + item.urn + '/output/0/')), raw = files.get('output/0/' + path.posix.basename(url.pathname));
      if (!value?.submitted || !raw) return fail(); await audit('download'); return { statusCode: 200, headers: { 'content-length': String(raw.length) }, body: raw };
    }
    if (url.origin !== 'https://developer.api.autodesk.com') return fail();
    const owner = principal(input.headers); if (!owner) return json({ error: 'Synthetic token rejected' }, 401);
    const bucketMatch = /^\/oss\/v2\/buckets\/([a-z0-9._-]+)\/details$/.exec(route);
    if (bucketMatch && method === 'GET') { const bucket = bucketMatch[1]; if (buckets.has(bucket) && buckets.get(bucket) !== owner) return json({}, 403); buckets.set(bucket, owner); await audit('bucket'); return json({ bucketKey: bucket, bucketOwner: owner, permissions: [{ authId: owner, access: 'full' }] }); }
    const objectMatch = /^\/oss\/v2\/buckets\/([a-z0-9._-]+)\/objects\/([^/]+)\/(details|signeds3upload)$/.exec(route);
    if (objectMatch) {
      const [, bucket, encoded, operation] = objectMatch; need(buckets.get(bucket) === owner, 'SP5_SYNTHETIC_OWNER_MISMATCH'); const value = object(bucket, decodeURIComponent(encoded));
      if (operation === 'details' && method === 'GET') { await audit('object'); return value.uploaded ? json(receipt(value)) : json({}, 404); }
      if (operation === 'signeds3upload' && method === 'GET') return json({ uploadKey: 'fixture-' + hash(bucket + '/' + value.key), urls: ['https://com-autodesk-oss-direct-upload.s3-accelerate.amazonaws.com/fixture-' + hash(bucket + '/' + value.key)] });
      if (operation === 'signeds3upload' && method === 'POST') { need(value.part, 'SP5_SYNTHETIC_INPUT_ONLY'); value.uploaded = true; return json(receipt(value)); }
    }
    if (route === '/modelderivative/v2/designdata/job' && method === 'POST') {
      const body = JSON.parse((await bodyBytes(input.body)).toString('utf8')), value = [...objects.values()].find(item => item.urn === body.input?.urn && buckets.get(item.bucket) === owner);
      need(value?.uploaded && !value.submitted, 'SP5_SYNTHETIC_SUBMISSION_INVALID'); value.submitted = true; await audit('syntheticSubmit'); return json({ result: 'success', urn: value.urn, acceptedJobs: { output: { destination: { region: 'EMEA' }, formats: [{ type: 'svf', views: ['3d'] }] } } });
    }
    const manifestMatch = /^\/modelderivative\/v2\/designdata\/([^/]+)\/manifest$/.exec(route);
    if (manifestMatch && method === 'GET') {
      const value = [...objects.values()].find(item => item.urn === manifestMatch[1] && buckets.get(item.bucket) === owner); await audit('manifest');
      if (!value?.submitted) return json({}, 404); const derivative = name => 'urn:adsk.viewing:fs.file:' + value.urn + '/output/0/' + name;
      return json({ urn: value.urn, status: 'success', derivatives: [{ outputType: 'svf', status: 'success', children: [{ type: 'geometry', role: '3d', status: 'success', children: [{ mime: 'application/autodesk-svf', role: 'graphics', status: 'success', urn: derivative('0.svf') }, { mime: 'application/autodesk-db', role: 'Autodesk.CloudPlatform.PropertyDatabase', status: 'success', urn: derivative('properties.db') }] }] }] });
    }
    if (route.endsWith('/signedcookies') && method === 'GET') {
      const encoded = route.split('/manifest/')[1]; if (!encoded) return fail(); const rawUrn = decodeURIComponent(encoded.slice(0, -'/signedcookies'.length)), name = path.posix.basename(rawUrn), raw = files.get('output/0/' + name), value = [...objects.values()].find(item => rawUrn.startsWith('urn:adsk.viewing:fs.file:' + item.urn + '/') && buckets.get(item.bucket) === owner);
      if (!value?.submitted || !raw) return fail(); await audit('signedResource'); return json({ url: 'https://cdn.derivative.autodesk.com/' + value.urn + '/output/0/' + name, size: raw.length, etag: 'fixture', expiration: now() + 300000 }, 200, { 'set-cookie': ['CloudFront-Policy=fixture; Path=/', 'CloudFront-Signature=fixture; Path=/', 'CloudFront-Key-Pair-Id=fixture; Path=/'] });
    }
    return fail();
  }
  return Object.freeze({ apsFetch: async (url, options = {}) => asResponse(await request({ ...options, url })), testTransport: Object.freeze({ request }), snapshot: () => ({ ...counts, realAutodeskRequests: 0 }) });
}
async function privateConfiguration(filename) { need(path.isAbsolute(filename ?? ''), 'SP5_FIXTURE_CONFIG_PATH'); const stat = await fs.lstat(filename); need(stat.isFile() && !stat.isSymbolicLink() && stat.nlink === 1 && stat.size <= 32768, 'SP5_FIXTURE_CONFIG_PATH'); return validateFixturePrivate(JSON.parse(await fs.readFile(filename, 'utf8'))); }
async function initializeVolumes(filename) {
  const config = await privateConfiguration(filename);
  for (const [directory, uid] of [['/fixture-config', 1000], ['/fixture-postgres', 999]]) { const stat = await fs.lstat(directory); need(stat.isDirectory() && !stat.isSymbolicLink() && (await fs.readdir(directory)).length === 0, 'SP5_FIXTURE_VOLUME_NOT_FRESH'); await fs.chown(directory, uid, uid); await fs.chmod(directory, 0o700); }
  const output = '/fixture-config/accounts.private.json'; const handle = await fs.open(output, 'wx', 0o600); try { await handle.writeFile(JSON.stringify(config)); await handle.sync(); } finally { await handle.close(); } await fs.chown(output, 1000, 1000);
  return { status: 'PASS', operationId: config.operationId, configuredOwnerUid: 1000, postgresOwnerUid: 999 };
}
async function seedFixture(config) {
  const require = createRequire('/app/package.json'), { Pool } = require('pg'), bcrypt = require('bcryptjs'), pool = new Pool({ ...config.database, database: config.database.name, max: 1, connectionTimeoutMillis: 10000 }); pool.on('error', () => {}); const client = await pool.connect(); let begun = false;
  try {
    await client.query('BEGIN'); begun = true;
    const current = await client.query('SELECT current_database() name,(SELECT count(*)::text FROM users) users,(SELECT count(*)::text FROM projects) projects'); need(current.rows[0]?.name === config.database.name && current.rows[0].users === '0' && current.rows[0].projects === '0', 'SP5_FIXTURE_DATABASE_NOT_FRESH');
    for (const [index, admin] of config.admins.entries()) await client.query('INSERT INTO users(id,email,password_hash,first_name,last_name,is_admin,role) VALUES($1,$2,$3,$4,$5,true,\'admin\')', [admin.id, admin.email, await bcrypt.hash(admin.password, 10), 'Synthetic', 'Administrator ' + (index + 1)]);
    await client.query('INSERT INTO projects(id,project_number,name,customer) VALUES($1,$2,$3,$4)', [config.projectId, 'SP5-' + config.operationId.slice(0, 8), 'Synthetic Preparer integration fixture', 'Synthetic fixture only']);
    await client.query('COMMIT'); begun = false; return { status: 'PASS', operationId: config.operationId, administrators: 2, projects: 1, realBusinessRows: 0 };
  } finally { if (begun) await client.query('ROLLBACK').catch(() => {}); client.release(); await pool.end(); }
}
async function probe(config, role) {
  const targets = { minio: { host: config.names.minio, port: 9000, path: '/minio/health/ready' }, api: { host: 'api', port: 4000, path: '/health' }, preparer: { host: 'preparer', port: 8080, path: '/health', headers: { Host: '127.0.0.1:5193' } }, web: { host: 'edge', port: 80, path: '/health' } };
  const started = Date.now();
  while (Date.now() - started < 120000) {
    try {
      if (role === 'postgres') { const { Pool } = createRequire('/app/package.json')('pg'), pool = new Pool({ ...config.database, database: config.database.name, max: 1, connectionTimeoutMillis: 3000 }); try { const result = await pool.query('SELECT current_database() name'); need(result.rows[0]?.name === config.database.name, 'SP5_FIXTURE_DATABASE_SCOPE'); } finally { await pool.end(); } }
      else { need(targets[role], 'SP5_FIXTURE_ROLE'); await new Promise((resolve, reject) => { const request = http.get({ ...targets[role], timeout: 3000 }, response => { response.resume(); response.once('end', () => response.complete && response.statusCode === 200 ? resolve() : reject(Error('health'))); }); request.once('timeout', () => request.destroy()); request.once('error', reject); }); }
      return { status: 'PASS', operationId: config.operationId, role };
    } catch { await new Promise(resolve => setTimeout(resolve, 500)); }
  }
  need(false, 'SP5_FIXTURE_HEALTH_TIMEOUT');
}
async function serve(config) {
  const { readConfiguration } = await import('/opt/preparer/app/config.mjs'), { createWorkspaceService } = await import('/opt/preparer/app/workspace-service.mjs'), runtime = readConfiguration();
  need(runtime.wfcOrigin === 'http://api:4000' && runtime.publicOrigin === config.origins.preparer && runtime.port === 8080 && runtime.instanceId === config.operationId, 'SP5_FIXTURE_RUNTIME_SCOPE');
  let serial = Promise.resolve(); const auditPath = path.join(runtime.dataDirectory, 'fixture-audit.private.json');
  const writeAudit = value => { const bytes = JSON.stringify(value); const next = serial.then(async () => { const temporary = auditPath + '.' + randomUUID() + '.tmp'; const handle = await fs.open(temporary, 'wx', 0o600); try { await handle.writeFile(bytes); await handle.sync(); } finally { await handle.close(); } await fs.rename(temporary, auditPath); }); serial = next.catch(() => {}); return next; };
  const fake = createSyntheticAPS(config, { onAudit: writeAudit }), originalFetch = globalThis.fetch;
  globalThis.fetch = (input, options) => { const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url); need(url.protocol === 'http:' && url.hostname === '127.0.0.1' && !!url.port, 'SP5_FIXTURE_EXTERNAL_FETCH_REFUSED'); return originalFetch(input, options); };
  const wfcFetch = (input, options) => { const url = new URL(input); need(url.origin === 'http://api:4000' && url.pathname.startsWith('/api/'), 'SP5_FIXTURE_WFC_ORIGIN_REFUSED'); return originalFetch(input, { ...options, redirect: 'manual' }); };
  await writeAudit({ schemaVersion: 'wfc.preparer.synthetic-aps-audit.v1', operationId: config.operationId, realAutodeskRequests: 0, scope: 'fresh fixture boot; no startup conversion', counts: fake.snapshot() });
  const service = await createWorkspaceService({ config: runtime, wfcFetch, apsFetch: fake.apsFetch, apsTestTransport: fake.testTransport, operationPollMs: 100, derivativePollMs: 100, importPollMs: 100 }); await service.listen();
  let closing = false; for (const event of ['SIGTERM', 'SIGINT']) process.on(event, async () => { if (closing) return; closing = true; try { await service.close(); await serial; process.exitCode = 0; } catch { process.exitCode = 1; } });
  return { status: 'PASS', operationId: config.operationId, syntheticOnly: true, realAutodeskRequests: 0 };
}
export async function main(args) {
  need([3, 5].includes(args.length) && ['init', 'seed', 'serve', 'probe'].includes(args[0]) && args[1] === '--config', 'SP5_FIXTURE_ARGUMENT_INVALID');
  let result;
  if (args[0] === 'init' && args.length === 3) result = await initializeVolumes(args[2]);
  else { const config = await privateConfiguration(args[2]); if (args[0] === 'seed' && args.length === 3) result = await seedFixture(config); else if (args[0] === 'serve' && args.length === 3) result = await serve(config); else { need(args[0] === 'probe' && args.length === 5 && args[3] === '--role', 'SP5_FIXTURE_ARGUMENT_INVALID'); result = await probe(config, args[4]); } }
  console.log(JSON.stringify(result));
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main(process.argv.slice(2)).catch(error => { console.log(JSON.stringify({ status: 'FAIL', code: /^[A-Z0-9_]{3,80}$/.test(error?.code ?? '') ? error.code : 'SP5_FIXTURE_FAILED' })); process.exitCode = 1; });
