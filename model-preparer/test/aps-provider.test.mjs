import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { Readable } from 'node:stream';
import { createAPSProvider } from '../lib/aps-provider.mjs';
import { isAPSProvider } from '../lib/aps-capabilities.mjs';
import { isFakeProvider } from '../lib/providers.mjs';
import { contextFromSpec, CoreError, PROFILE } from '../lib/contracts.mjs';
import { tinyModel } from './fixtures/model-fixture.mjs';
import * as packageApi from '../../routings-model-package/index.mjs';

const hash = (value, algorithm = 'sha256') => createHash(algorithm).update(value).digest('hex');
const json = (value, headers = {}, statusCode = 200) => ({ statusCode, headers, body: Buffer.from(JSON.stringify(value)) });
async function fixture(t, overrides = {}) {
  const base = await fs.realpath(os.tmpdir()), root = await fs.mkdtemp(path.join(base, 'aps-provider-fixture-'));
  t.after(async () => { assert.equal(path.dirname(root), base); await fs.rm(root, { recursive: true, force: true }); });
  const source = Buffer.from('controlled NWD fixture bytes'), sourcePath = path.join(root, 'TestModel.nwd'); await fs.writeFile(sourcePath, source);
  const clientId = 'fixture-client-123456', clientSecret = 'fixture-secret', bucket = 'fixture-aps-bucket';
  const namespace = { account: 'team-' + hash('fixture-team'), application: 'app-' + hash(clientId) };
  const context = contextFromSpec({ namespace, region: 'EMEA', destination: { bucket: 'target-' + hash(bucket), objectKey: 'TestModel.nwd' }, conversion: { format: 'svf', views: ['3d'], xAdsForce: false }, supportProfile: PROFILE, label: 'Fixture', output: path.join(root, 'model.zip') },
    { name: 'TestModel.nwd', bytes: source.length, sha256: hash(source), snapshotPath: sourcePath, capturedAt: new Date().toISOString() });
  const key = overrides.mappedKey ?? context.destination.objectKey;
  const objectId = `urn:adsk.objects:os.object:${bucket}/${key}`, urn = Buffer.from(objectId).toString('base64url');
  const derivative = filename => `urn:adsk.viewing:fs.file:${urn}/output/0/${filename}`;
  const { data } = tinyModel(), calls = [], readCalls = [], control = { now: Date.now(), forbiddenRaw: false, short: false };
  const manifest = () => ({ urn, status: 'success', derivatives: [{ outputType: 'svf', status: 'success', children: [{ type: 'geometry', role: '3d', status: 'success', children: [
    { mime: 'application/autodesk-svf', role: 'graphics', status: 'success', urn: derivative('0.svf') },
    { mime: 'application/autodesk-db', role: 'Autodesk.CloudPlatform.PropertyDatabase', status: 'success', urn: derivative('properties.db') },
  ] }] }] });
  const receipt = () => ({ bucketKey: bucket, objectId, objectKey: key, size: source.length, sha1: hash(source, 'sha1') });
  async function defaultReply(input) {
    const url = new URL(input.url);
    if (url.pathname === '/authentication/v2/token') return json({ access_token: 'fixture-token', expires_in: 3600 });
    if (url.pathname.endsWith('/details') && url.pathname.includes('/objects/')) return json(receipt());
    if (url.pathname.endsWith('/details')) return json({ bucketKey: bucket, bucketOwner: clientId, permissions: [{ authId: clientId, access: 'full' }] });
    if (url.pathname === '/oss/v2/buckets' && input.method === 'POST') return json({ bucketKey: bucket, bucketOwner: clientId });
    if (url.pathname.endsWith('/signeds3upload') && input.method === 'GET') return json({ uploadKey: 'fixture-upload', urls: Array.from({ length: Number(url.searchParams.get('parts')) }, (_, i) => `https://com-autodesk-oss-direct-upload.s3-accelerate.amazonaws.com/fixture-${i}`) });
    if (url.pathname.endsWith('/signeds3upload') && input.method === 'POST') return json(receipt());
    if (input.method === 'PUT') return { statusCode: 200, headers: {}, body: Buffer.alloc(0) };
    if (url.pathname === '/modelderivative/v2/designdata/job') return json({ result: 'success', urn, acceptedJobs: { output: { formats: [{ type: 'svf', views: ['3d'] }] } } });
    if (url.pathname.endsWith('/signedcookies')) {
      const rawUrn = decodeURIComponent(url.pathname.split('/manifest/')[1].slice(0, -'/signedcookies'.length));
      const filename = rawUrn.slice(rawUrn.lastIndexOf('/') + 1), raw = data.get('output/0/' + filename);
      assert.ok(raw, 'Only declared fixture resources may be signed');
      return json({ url: `https://cdn.derivative.autodesk.com/${urn}/output/0/${filename}`, size: raw.length, etag: 'fixture-etag', expiration: control.now + 5000 },
        { 'set-cookie': ['CloudFront-Policy=fixture-policy; Path=/', 'CloudFront-Signature=fixture-signature; Path=/', 'CloudFront-Key-Pair-Id=fixture-key; Path=/'] });
    }
    if (url.hostname === 'cdn.derivative.autodesk.com') {
      const filename = path.posix.basename(url.pathname), raw = data.get('output/0/' + filename);
      if (control.forbiddenRaw && filename === '0.pf') { control.forbiddenRaw = false; return json({}, {}, 403); }
      return { statusCode: 200, headers: { 'content-length': String(raw.length), ...(filename === '0.pf' ? { 'content-encoding': 'gzip' } : {}) }, body: control.short && filename === '0.pf' ? raw.subarray(0, raw.length - 1) : raw };
    }
    if (url.pathname.includes('/manifest/')) return json(manifest());
    if (url.pathname.endsWith('/manifest')) return json(manifest());
    throw new Error('Unexpected fixture route');
  }
  const options = { clientId, clientSecret, bucket, region: 'EMEA', namespace, packageApi, clock: { now: () => control.now },
    authorizeRead: async (ctx, opts) => { readCalls.push(ctx.submissionIdentity); assert.equal(ctx.submissionIdentity, context.submissionIdentity); if (opts.signal?.aborted) throw new CoreError('LOCAL_ABORTED'); await overrides.authorizeRead?.(ctx, opts); },
    testTransport: { request: async input => { calls.push(input); return overrides.reply ? overrides.reply(input, { defaultReply, control, manifest, receipt, derivative, urn, objectId }) : defaultReply(input); } },
    ...(overrides.mappedKey ? { objectKeysBySource: { [context.source.sha256]: overrides.mappedKey } } : {}), ...overrides.providerOptions };
  const provider = createAPSProvider(options);
  return { provider, context, calls, readCalls, control, data, source, root, options, defaultReply, manifest, receipt, urn, objectId };
}
const rejects = (promise, code) => assert.rejects(promise, error => error instanceof CoreError && error.code === code);
async function readAll(provider, context, resourceId, options) { const chunks = []; for await (const chunk of provider.readResource(context, { resourceId, ...options })) chunks.push(chunk); return Buffer.concat(chunks); }

test('factory is distinctly APS branded and makes no startup requests', async t => {
  const f = await fixture(t); assert.ok(isAPSProvider(f.provider)); assert.equal(isFakeProvider(f.provider), false); assert.equal(f.calls.length, 0);
  assert.equal(f.provider.calls.length, 0); assert.equal(f.provider.counts.totalRequests, 0);
  assert.ok(!JSON.stringify(f.provider).includes(f.options.clientSecret));
  await rejects(f.provider.upload(f.context), 'CLOUD_CLOSED'); await rejects(f.provider.submit(f.context), 'CLOUD_CLOSED'); assert.equal(f.calls.length, 0);
});
test('owned storage and exact SHA1/source bytes are verified before alias receipts', async t => {
  const f = await fixture(t), storage = await f.provider.getStorage(f.context), receipt = await f.provider.getObject(f.context);
  assert.equal(storage.bucket, f.context.destination.bucket); assert.equal(receipt.objectId, f.context.objectId);
  assert.equal(receipt.identityBasis, 'aps-sha1-and-local-sha256'); assert.equal(receipt.sha256, hash(f.source));
  assert.equal(receipt.remoteSha1, hash(f.source, 'sha1')); assert.equal(receipt.localSha1, receipt.remoteSha1); assert.equal(receipt.remoteObjectIdHash, hash(f.objectId));
  assert.ok(!JSON.stringify(receipt).includes(f.options.bucket)); assert.ok(!JSON.stringify(receipt).includes(f.options.clientSecret));
});
test('explicit source-key mapping reuses the existing legacy OSS object', async t => {
  const f = await fixture(t, { mappedKey: 'aalborg-existing.nwd' }); await f.provider.getObject(f.context);
  assert.ok(f.calls.some(call => new URL(call.url).pathname.includes('/aalborg-existing.nwd/details')));
  assert.equal(f.calls.filter(call => call.method === 'PUT').length, 0);
});
test('storage ownership and remote hash mismatches fail closed', async t => {
  const f = await fixture(t, { reply: async (input, helpers) => input.url.endsWith('/details') && !input.url.includes('/objects/') ? json({ bucketKey: 'foreign', bucketOwner: 'foreign', permissions: [] }) : helpers.defaultReply(input) });
  await rejects(f.provider.getStorage(f.context), 'IDENTITY_MISMATCH');
  const g = await fixture(t, { reply: async (input, helpers) => input.url.includes('/objects/') && input.url.endsWith('/details') ? json({ ...helpers.receipt(), sha1: '0'.repeat(40) }) : helpers.defaultReply(input) });
  await rejects(g.provider.getObject(g.context), 'IDENTITY_MISMATCH');
});
test('changed snapshot and foreign logical context never become valid receipts', async t => {
  const f = await fixture(t); await fs.appendFile(f.context.source.snapshotPath, 'changed'); await rejects(f.provider.getObject(f.context), 'SNAPSHOT_CHANGED');
  await rejects(f.provider.getManifest({ ...f.context, namespace: { ...f.context.namespace, account: 'foreign' } }), 'IDENTITY_MISMATCH');
});
test('download plan contains only SVF declarations and mandatory property DB', async t => {
  const f = await fixture(t, { reply: async (input, h) => {
    if (input.url.endsWith('/manifest')) { const value = h.manifest(); value.derivatives[0].children[0].children.push({ mime: 'image/png', urn: h.derivative('thumbnail.png'), status: 'success' }); return json(value); }
    return h.defaultReply(input);
  } }), plan = await f.provider.getDownloadPlan(f.context);
  assert.deepEqual(plan.resources.map(item => item.path), ['output/0/0.pf', 'output/0/0.svf', 'output/0/properties.db']);
  assert.ok(plan.resources.every(item => !JSON.stringify(item).includes('https:') && !JSON.stringify(item).includes('CloudFront')));
  assert.equal(plan.resources.find(item => item.path.endsWith('0.pf')).sha256, undefined);
  const data = new Map(); for (const resource of plan.resources) data.set('resources/' + resource.path, await readAll(f.provider, f.context, resource.resourceId));
  const report = await packageApi.validateProfile({ resources: plan.resources.map(item => ({ ...item, path: 'resources/' + item.path })), read: async resourcePath => data.get(resourcePath), stream: resourcePath => Readable.from([data.get(resourcePath)]) });
  assert.equal(report.status, 'PASS'); assert.deepEqual(data.get('resources/output/0/0.pf'), f.data.get('output/0/0.pf'));
  assert.ok(f.calls.filter(call => new URL(call.url).hostname === 'cdn.derivative.autodesk.com').every(call => call.headers['Accept-Encoding'] === 'identity' && !call.headers.Authorization));
});
test('multiple roots and property databases require explicit unambiguous choices', async t => {
  const f = await fixture(t, { reply: async (input, h) => { if (input.url.endsWith('/manifest')) { const value = h.manifest(); value.derivatives[0].children.push({ type: 'geometry', role: '3d', status: 'success', children: [{ mime: 'application/autodesk-svf', urn: h.derivative('second.svf'), status: 'success' }] }); return json(value); } return h.defaultReply(input); } });
  const manifest = await f.provider.getManifest(f.context); assert.equal(manifest.roots.length, 2); await rejects(f.provider.getDownloadPlan(f.context), 'DERIVATIVE_AMBIGUOUS');
  const g = await fixture(t, { reply: async (input, h) => { if (input.url.endsWith('/manifest')) { const value = h.manifest(); value.derivatives[0].children[0].children.push({ mime: 'application/autodesk-db', role: 'Autodesk.CloudPlatform.PropertyDatabase', status: 'success', urn: h.derivative('another.db') }); return json(value); } return h.defaultReply(input); } });
  await rejects(g.provider.getDownloadPlan(g.context), 'DERIVATIVE_AMBIGUOUS');
});
test('existing SVF2 manifest uses only explicit legacy SVF reads without conversion', async t => {
  const f = await fixture(t, { reply: async (input, h) => input.url.includes('/modelderivative/') && input.url.endsWith('/manifest') ? json({ urn: h.urn, status: 'success', derivatives: [{ outputType: 'svf2', status: 'success', children: [] }] }) : h.defaultReply(input) });
  assert.equal((await f.provider.getDownloadPlan(f.context)).resources.length, 3);
  assert.ok(f.calls.some(call => call.url.includes('/derivativeservice/v2/regions/eu/manifest/')));
  assert.equal(f.calls.filter(call => call.method !== 'GET' && !call.url.endsWith('/authentication/v2/token')).length, 0);
});
function legacyBranches(h, { foreignSecondRoot = false } = {}) {
  const branch = foreign => ({ type: 'folder', role: 'viewable', children: [{ type: 'folder', role: 'viewable', children: [{
    type: 'geometry', role: '3d', children: [
      { type: 'resource', mime: 'application/autodesk-svf', role: 'graphics', size: 234000200, urn: foreign ? 'urn:adsk.viewing:fs.file:foreign/output/0/0.svf' : h.derivative('0.svf') },
      { type: 'resource', mime: 'application/autodesk-db', role: 'Autodesk.CloudPlatform.PropertyDatabase', size: 233991168, urn: h.derivative('properties.db') },
    ],
  }] }] });
  return { urn: h.urn, type: 'design', status: 'success', children: [branch(false), branch(foreignSecondRoot)] };
}

test('legacy viewable branches sharing exact SVF and property DB pointers describe one resource set', async t => {
  const f = await fixture(t, { reply: async (input, h) => {
    if (input.url.includes('/modelderivative/') && input.url.endsWith('/manifest')) return json({ urn: h.urn, status: 'success', derivatives: [{ outputType: 'svf2', status: 'success', children: [] }] });
    if (input.url.includes('/derivativeservice/') && input.url.includes('/manifest/')) return json(legacyBranches(h));
    return h.defaultReply(input);
  } });
  const observation = await f.provider.getManifest(f.context);
  assert.equal(observation.roots.length, 1);
  const plan = await f.provider.getDownloadPlan(f.context, { rootId: observation.roots[0].rootId });
  assert.deepEqual(plan.resources.map(item => item.path), ['output/0/0.pf', 'output/0/0.svf', 'output/0/properties.db']);
  assert.equal(plan.rootId, observation.roots[0].rootId);
  assert.equal(f.provider.counts.cloudDataMutations, 0);
  assert.equal(f.calls.filter(call => call.url.includes('/signedcookies')).length, 3);
});

test('deduplicating legacy pointers still rejects a foreign SVF in another branch', async t => {
  const f = await fixture(t, { reply: async (input, h) => {
    if (input.url.includes('/modelderivative/') && input.url.endsWith('/manifest')) return json({ urn: h.urn, status: 'success', derivatives: [{ outputType: 'svf2', status: 'success', children: [] }] });
    if (input.url.includes('/derivativeservice/') && input.url.includes('/manifest/')) return json(legacyBranches(h, { foreignSecondRoot: true }));
    return h.defaultReply(input);
  } });
  await rejects(f.provider.getManifest(f.context), 'PROVIDER_RESPONSE_INVALID');
  assert.equal(f.provider.counts.cloudDataMutations, 0);
  assert.equal(f.calls.some(call => call.url.includes('/signedcookies')), false);
});

test('expired signed addresses and a 403 are refreshed through bounded read calls', async t => {
  const f = await fixture(t), plan = await f.provider.getDownloadPlan(f.context), resource = plan.resources.find(item => item.path.endsWith('0.pf'));
  const before = f.calls.filter(call => call.url.includes('/signedcookies')).length; f.control.now += 10000; f.control.forbiddenRaw = true;
  assert.deepEqual(await readAll(f.provider, f.context, resource.resourceId), f.data.get('output/0/0.pf'));
  assert.equal(f.calls.filter(call => call.url.includes('/signedcookies')).length, before + 2);
});
test('read budget denial and raw length mismatch stop transfer', async t => {
  const f = await fixture(t, { authorizeRead: async () => { throw new CoreError('READ_LIMIT'); } }); await rejects(f.provider.getManifest(f.context), 'READ_LIMIT'); assert.equal(f.calls.length, 0);
  const g = await fixture(t), plan = await g.provider.getDownloadPlan(g.context); g.control.short = true;
  await rejects(readAll(g.provider, g.context, plan.resources.find(item => item.path.endsWith('0.pf')).resourceId), 'DOWNLOAD_INCOMPLETE');
});
test('abort terminates a stalled raw iterator without waiting for foreign cleanup', async t => {
  const f = await fixture(t, { reply: async (input, h) => { if (new URL(input.url).hostname === 'cdn.derivative.autodesk.com' && input.url.endsWith('/0.pf')) return { statusCode: 200, headers: {}, body: { [Symbol.asyncIterator]() { return { next: () => new Promise(() => {}), return: () => new Promise(() => {}) }; } } }; return h.defaultReply(input); } });
  const plan = await f.provider.getDownloadPlan(f.context), controller = new AbortController(), pending = readAll(f.provider, f.context, plan.resources.find(item => item.path.endsWith('0.pf')).resourceId, { signal: controller.signal });
  setTimeout(() => controller.abort(), 10); await rejects(pending, 'LOCAL_ABORTED');
});
test('live upload checks guards after awaits and preserves real receipt digest semantics', async t => {
  const f = await fixture(t, { providerOptions: { reuseOnly: false } }); let guards = 0;
  const receipt = await f.provider.upload(f.context, { retries: 0, assertMutationAllowed: () => { guards++; } });
  assert.equal(receipt.sha256, hash(f.source)); assert.equal(receipt.remoteSha1, hash(f.source, 'sha1')); assert.equal(guards, 3);
  assert.equal(f.calls.filter(call => call.method === 'PUT').length, 1); assert.equal(f.calls.filter(call => call.method === 'POST' && call.url.includes('/signeds3upload')).length, 1);
});
test('mutation guard can expire during signing and prevents every subsequent PUT', async t => {
  let expired = false;
  const f = await fixture(t, { providerOptions: { reuseOnly: false }, reply: async (input, h) => { const result = await h.defaultReply(input); if (input.url.includes('/signeds3upload')) expired = true; return result; } });
  await rejects(f.provider.upload(f.context, { retries: 0, assertMutationAllowed: () => { if (expired) throw new CoreError('COST_EXPIRED'); } }), 'COST_EXPIRED');
  assert.equal(f.calls.filter(call => call.method === 'PUT').length, 0);
});
test('mutation guards are mandatory and synchronous; failed PUT is never retried', async t => {
  const f = await fixture(t, { providerOptions: { reuseOnly: false } }); await rejects(f.provider.createStorage(f.context, { retries: 0 }), 'COST_BLOCKED');
  await rejects(f.provider.createStorage(f.context, { retries: 0, assertMutationAllowed: async () => {} }), 'COST_BLOCKED');
  const g = await fixture(t, { providerOptions: { reuseOnly: false }, reply: async (input, h) => input.method === 'PUT' ? json({}, {}, 503) : h.defaultReply(input) });
  await rejects(g.provider.upload(g.context, { retries: 0, assertMutationAllowed() {} }), 'PROVIDER_FAILURE'); assert.equal(g.calls.filter(call => call.method === 'PUT').length, 1);
});
test('translation acknowledgement contains actual observed response proof, no invented job ID', async t => {
  const f = await fixture(t, { providerOptions: { reuseOnly: false }, reply: async (input, h) => input.url.endsWith('/job') ? json({ urn: h.urn, acceptedJobs: { output: { formats: [{ views: ['3d'], type: 'svf' }], destination: { region: 'EMEA' } } }, result: 'success' }) : h.defaultReply(input) }); let guards = 0;
  const result = await f.provider.submit(f.context, { attemptId: 'abc', retries: 0, xAdsForce: false, assertMutationAllowed: () => { guards++; } });
  assert.equal(guards, 1); assert.equal(result.providerJobId, undefined); assert.equal(result.providerReceipt.kind, 'aps-job-response'); assert.equal(result.providerReceipt.remoteUrnHash, hash(f.urn));
  const request = f.calls.find(call => call.url.endsWith('/job')); assert.equal(request.headers['x-ads-force'], 'false'); assert.equal(JSON.parse(request.body).input.urn, f.urn);
});
test('API foreign errors and signed-host injection do not expose credentials or URLs', async t => {
  const f = await fixture(t, { reply: async () => { throw new Error('Bearer fixture-secret https://bad.example/?Signature=secret'); } });
  await assert.rejects(f.provider.getStorage(f.context), error => error instanceof CoreError && !error.message.includes('fixture-secret') && !error.message.includes('https:'));
  const g = await fixture(t, { reply: async (input, h) => input.url.endsWith('/signedcookies') ? json({ size: 1, expiration: h.control.now + 5000, url: 'https://bad.example/private?Signature=secret' }) : h.defaultReply(input) });
  await rejects(g.provider.getDownloadPlan(g.context), 'PROVIDER_RESPONSE_INVALID');
});
test('OAuth refresh is single-flight and scoped; raw resources have no bearer token', async t => {
  const f = await fixture(t); await Promise.all([f.provider.getManifest(f.context), f.provider.getStorage(f.context)]);
  assert.equal(f.calls.filter(call => call.url.endsWith('/authentication/v2/token')).length, 1);
  f.control.now += 3600000; await f.provider.getStorage(f.context); assert.equal(f.calls.filter(call => call.url.endsWith('/authentication/v2/token')).length, 2);
  const auth = f.calls.find(call => call.url.endsWith('/authentication/v2/token')); assert.ok(auth.headers.Authorization.startsWith('Basic '));
  assert.deepEqual(new URLSearchParams(auth.body).get('scope').split(' ').sort(), ['bucket:read', 'data:read', 'viewables:read']);
  const g = await fixture(t, { providerOptions: { reuseOnly: false } }); await g.provider.getStorage(g.context);
  assert.ok(new URLSearchParams(g.calls.find(call => call.url.endsWith('/authentication/v2/token')).body).get('scope').includes('data:write'));
});
test('read-lock recovery is explicit and forwarded without automatic takeover', async t => {
  const received = [], f = await fixture(t, { authorizeRead: async (context, options) => { received.push(options.recoverDead); } });
  await f.provider.getStorage(f.context, { recoverDead: true }); await f.provider.getStorage(f.context);
  assert.deepEqual(received, [true, true, undefined]);
});
test('missing database and disabled legacy discovery are explicit failures', async t => {
  const f = await fixture(t, { reply: async (input, h) => { if (input.url.endsWith('/manifest')) { const value = h.manifest(); value.derivatives[0].children[0].children.pop(); return json(value); } return h.defaultReply(input); } });
  await rejects(f.provider.getDownloadPlan(f.context), 'DOWNLOAD_INCOMPLETE');
  const g = await fixture(t, { providerOptions: { allowLegacyExistingSVF: false }, reply: async (input, h) => input.url.endsWith('/manifest') ? json({ urn: h.urn, status: 'success', derivatives: [{ outputType: 'svf2', children: [] }] }) : h.defaultReply(input) });
  await rejects(g.provider.getManifest(g.context), 'UNSUPPORTED_PROFILE');
  assert.equal(g.calls.filter(call => call.url.includes('/derivativeservice/')).length, 0);
});
test('job POST is never replayed after a failed acknowledgement', async t => {
  const f = await fixture(t, { providerOptions: { reuseOnly: false }, reply: async (input, h) => input.url.endsWith('/job') ? json({}, {}, 503) : h.defaultReply(input) });
  await rejects(f.provider.submit(f.context, { attemptId: 'abc', retries: 0, xAdsForce: false, assertMutationAllowed() {} }), 'PROVIDER_FAILURE');
  assert.equal(f.calls.filter(call => call.url.endsWith('/job')).length, 1);
});
test('network audit is detached, counts real requests, and never retains private data', async t => {
  const f = await fixture(t); await f.provider.getStorage(f.context); const plan = await f.provider.getDownloadPlan(f.context);
  await readAll(f.provider, f.context, plan.resources.find(item => item.path.endsWith('0.pf')).resourceId);
  const audit = f.provider.calls;
  assert.equal(audit.length, f.calls.length); assert.equal(f.provider.counts.cloudDataMutations, 0); assert.equal(f.provider.counts.auth, 1);
  assert.ok(audit.every(item => item.status === 200 && item.outcome === 'response'));
  for (const forbidden of [f.options.clientId, f.options.clientSecret, f.options.bucket, 'https:', 'CloudFront', 'Bearer', 'fixture-token']) assert.ok(!JSON.stringify(audit).includes(forbidden));
  audit[0].status = 599; audit.push({ operation: 'fake' }); assert.equal(f.provider.calls[0].status, 200); assert.equal(f.provider.calls.length, f.calls.length);
});
for (const [name, format] of [['SVF2', { type: 'svf2', views: ['3d'] }], ['2D', { type: 'svf', views: ['2d'] }], ['unrequested advanced settings', { type: 'svf', views: ['3d'], advanced: { force: true } }]]) {
  test(`translation acknowledgement rejects ${name} without inventing an identifier`, async t => {
    const f = await fixture(t, { providerOptions: { reuseOnly: false }, reply: async (input, h) => input.url.endsWith('/job') ? json({ result: 'success', urn: h.urn, acceptedJobs: { output: { formats: [format] } } }) : h.defaultReply(input) });
    await rejects(f.provider.submit(f.context, { attemptId: 'abc', retries: 0, xAdsForce: false, assertMutationAllowed() {} }), 'PROVIDER_RESPONSE_INVALID');
    assert.equal(f.calls.filter(call => call.url.endsWith('/job')).length, 1);
  });
}
