// @vitest-environment node
import { EventEmitter } from 'node:events';
import type { Request } from 'express';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createProducerResourceRouter, type ProducerResourceRuntime } from './producerResourceRoutes.js';
import { PathFinderError } from './errors.js';
import { ModelStorageError } from '../modelRegistry/storage.js';
import { ViewerSessionError } from '../viewerSessions/errors.js';
import { PRODUCER_RESOURCE_LIMITS } from '../../shared/pathfinderProducerResource.js';
vi.mock('../db.js', () => ({ pool: {} }));
vi.mock('../config.js', () => ({ config: { objectStorage: {} } }));
const id = (n: number) => `b8000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const prefix = `/api/projects/${id(1)}/model-versions/${id(2)}/producer-sessions/${id(3)}`;
const policy = { origins: ['http://127.0.0.1:5191'], allowHttpLoopback: true, trustProxy: false };
function fixture() {
  const resource = { path: 'resources/output/0/0.svf', bytes: 4, sha256: 'a'.repeat(64) };
  const authorized = { session: { sessionId: id(3), projectId: id(1), modelVersionId: id(2), loadId: id(4), expiresAt: new Date(Date.now() + 300000).toISOString(), absoluteExpiresAt: new Date(Date.now() + 300000).toISOString() }, version: { id: id(2), projectId: id(1), contentFingerprint: 'b'.repeat(64), supportProfile: 'svf-local-7.130.0-v1', format: 'svf', sdkVersion: '7.130.0', entrypoint: resource.path, resourceCount: 1, totalBytes: 4, storagePrefix: 'synthetic-private-prefix', manifest: { resources: [resource] } } };
  const close = vi.fn(async () => undefined), service = { authorizeResource: vi.fn(async () => authorized), authorizePathFinder: vi.fn(async () => ({ authorized: true, loadId: id(4) })), reserveRequest: vi.fn(), reserveResponse: vi.fn() };
  const storage = { readVerifiedResource: vi.fn(async () => ({ handle: { createReadStream: vi.fn() }, bytes: 4, close })) };
  const runtime = { service, storage, run: async (work: (signal: AbortSignal) => Promise<unknown>) => work(new AbortController().signal), resource: vi.fn(async (_bytes: number, work: () => Promise<unknown>) => work()) } as unknown as ProducerResourceRuntime;
  const router = createProducerResourceRouter({ runtime, policy });
  function request({ path = prefix + '/descriptor', method = 'GET', extraHeaders = {}, duplicate = false }: { path?: string; method?: string; extraHeaders?: Record<string, string | undefined>; duplicate?: boolean } = {}) {
    const h: Record<string, string | undefined> = { host: '127.0.0.1:5191', 'x-wfc-pf-producer-capability': 'A'.repeat(43), ...extraHeaders };
    const rawHeaders = Object.entries(h).filter(([, value]) => value !== undefined).flatMap(([key, value]) => [key, value!]); if (duplicate) rawHeaders.push('X-WFC-PF-Producer-Capability', 'A'.repeat(43));
    const req = { url: path, originalUrl: path, method, rawHeaders, socket: {}, header: (name: string) => h[name.toLowerCase()], on: vi.fn(), once: vi.fn(), read: vi.fn(() => { throw new Error('Request bodies remain unread'); }) } as unknown as Request;
    const res = Object.assign(new EventEmitter(), { statusCode: 200, headersSent: false, destroyed: false, writableFinished: false, setHeader: vi.fn(), status(n: number) { this.statusCode = n; return this; }, end: vi.fn(), json: vi.fn(), destroy: vi.fn() });
    const run = () => new Promise<void>((resolve, reject) => {
      res.end.mockImplementation(() => { res.writableFinished = true; resolve(); return res; }); res.json.mockImplementation(() => { res.writableFinished = true; resolve(); return res; });
      (router as unknown as { handle(req: unknown, res: unknown, next: (error?: unknown) => void): void }).handle(req, res, error => error ? reject(error) : resolve());
    }); return { req, res, run };
  }
  return { request, service, storage, close, resource, authorized, runtime };
}
beforeEach(() => vi.clearAllMocks());
describe('producer resource family without a listener or human authentication', () => {
  it('permits an internal broker with absent Origin only at the exact configured host and returns a credential-free descriptor', async () => {
    const f = fixture(), r = f.request(); await r.run(); expect(r.res.statusCode).toBe(200); expect(f.service.authorizeResource).toHaveBeenCalledTimes(2);
    const body = JSON.parse(String(r.res.end.mock.calls[0][0])); expect(body).toMatchObject({ loadId: id(4), sdkVersion: '7.130.0', resourceCount: 1 }); expect(body).not.toHaveProperty('capability'); expect(r.res.setHeader).not.toHaveBeenCalledWith('Set-Cookie', expect.anything()); expect(f.service.reserveRequest).toHaveBeenCalledOnce();
  });
  it.each(['GET', 'HEAD'])('serves %s authority pings with two narrow fences and no manifest/storage reads', async method => {
    const f = fixture(), r = f.request({ path: prefix + '/pathfinder-authorization', method });
    f.service.authorizeResource.mockImplementation(async () => { throw new Error('Authority pings must not load model manifests'); });
    await r.run(); expect(r.res.statusCode).toBe(200); expect(f.service.authorizePathFinder).toHaveBeenCalledTimes(2); expect(f.service.authorizeResource).not.toHaveBeenCalled();
    expect(f.storage.readVerifiedResource).not.toHaveBeenCalled(); expect(f.runtime.resource).not.toHaveBeenCalled(); expect(f.service.reserveRequest).toHaveBeenCalledOnce();
    const body = { authorized: true, loadId: id(4) }; expect(f.service.reserveResponse).toHaveBeenCalledWith(expect.any(Object), method === 'HEAD' ? 0 : Buffer.byteLength(JSON.stringify(body)));
    if (method === 'HEAD') expect(r.res.end).toHaveBeenCalledWith(undefined); else expect(JSON.parse(String(r.res.end.mock.calls[0][0]))).toEqual(body);
  });
  it('refuses authorization revoked after ping encoding before exposing any response bytes', async () => {
    const f = fixture(); f.service.authorizePathFinder.mockResolvedValueOnce({ authorized: true, loadId: id(4) }).mockRejectedValueOnce(new PathFinderError('CALCULATION_GRANT_REVOKED', 409));
    const r = f.request({ path: prefix + '/pathfinder-authorization' }); await r.run();
    expect(r.res.statusCode).toBe(409); expect(f.service.reserveResponse).not.toHaveBeenCalled(); expect(r.res.end).not.toHaveBeenCalled(); expect(f.service.authorizeResource).not.toHaveBeenCalled();
  });
  it('refuses changed ping load pins and exhausted admission without falling back to manifest reads', async () => {
    const f = fixture(); f.service.authorizePathFinder.mockResolvedValueOnce({ authorized: true, loadId: id(4) }).mockResolvedValueOnce({ authorized: true, loadId: id(99) });
    const changed = f.request({ path: prefix + '/pathfinder-authorization' }); await changed.run(); expect(changed.res.statusCode).toBe(410); expect(f.service.reserveResponse).not.toHaveBeenCalled();
    const before = f.service.authorizePathFinder.mock.calls.length; f.service.reserveRequest.mockImplementationOnce(() => { throw new ViewerSessionError('PRODUCER_RESOURCE_BUDGET', 429); });
    const exhausted = f.request({ path: prefix + '/pathfinder-authorization' }); await exhausted.run(); expect(exhausted.res.statusCode).toBe(429); expect(f.service.authorizePathFinder.mock.calls.length).toBe(before);
    expect(f.service.authorizeResource).not.toHaveBeenCalled();
  });
  it.each([{ 'x-wfc-pf-producer-capability': undefined }, { authorization: 'Bearer cannot-substitute' }, { cookie: 'wfc_viewer_session=cannot-substitute' }])('requires the exact capability header without human credential substitution: %j', async extraHeaders => {
    const f = fixture(), r = f.request({ extraHeaders }); await r.run(); expect(r.res.statusCode).toBe(401); expect(f.service.authorizeResource).not.toHaveBeenCalled(); expect(f.service.reserveRequest).not.toHaveBeenCalled(); expect(r.req.read).not.toHaveBeenCalled();
  });
  it('rejects duplicated capability, wrong port, foreign Origin and cross-site fetch metadata', async () => {
    for (const options of [{ duplicate: true }, { extraHeaders: { host: '127.0.0.1:5190' } }, { extraHeaders: { origin: 'http://localhost:5191' } }, { extraHeaders: { 'sec-fetch-site': 'cross-site' } }]) { const f = fixture(), r = f.request(options); await r.run(); expect([401, 403]).toContain(r.res.statusCode); expect(f.service.authorizeResource).not.toHaveBeenCalled(); }
  });
  it('claims and refuses aliases and all mutation/create methods while leaving normal viewer routes alone', async () => {
    const f = fixture(), alias = f.request({ path: prefix.replace('/api/', '/API/') + '/descriptor' }); await alias.run(); expect(alias.res.statusCode).toBe(404);
    for (const method of ['POST', 'PUT', 'DELETE', 'OPTIONS']) { const r = f.request({ path: prefix, method }); await r.run(); expect(r.res.statusCode).toBe(405); expect(r.req.read).not.toHaveBeenCalled(); }
    const ordinary = f.request({ path: prefix.replace('producer-sessions', 'viewer-sessions') + '/descriptor' }); await ordinary.run(); expect(ordinary.res.end).not.toHaveBeenCalled();
  });
  it('uses manifest-only verified raw reads for HEAD/range and reauthorizes after I/O', async () => {
    const f = fixture(), r = f.request({ path: prefix + '/resources/output/0/0.svf?domain=' + encodeURIComponent(policy.origins[0]), method: 'HEAD', extraHeaders: { range: 'bytes=1-2' } }); await r.run();
    expect(r.res.statusCode).toBe(206); expect(f.storage.readVerifiedResource).toHaveBeenCalledWith('synthetic-private-prefix', f.resource, expect.any(AbortSignal)); expect(f.service.authorizeResource).toHaveBeenCalledTimes(2); expect(f.close).toHaveBeenCalledOnce(); expect(r.res.setHeader).toHaveBeenCalledWith('Content-Length', 2); expect(f.service.reserveResponse).toHaveBeenCalledWith(expect.any(Object), 0);
  });
  it('fences grant revocation after verified I/O and closes the pinned handle before exposing resource bytes', async () => {
    const f = fixture(); f.service.authorizeResource.mockRejectedValueOnce(new PathFinderError('CALCULATION_GRANT_REVOKED', 409));
    const before = f.request({ path: prefix + '/resources/output/0/0.svf', method: 'HEAD' }); await before.run(); expect(before.res.statusCode).toBe(409); expect(f.storage.readVerifiedResource).not.toHaveBeenCalled();
    f.service.authorizeResource.mockResolvedValueOnce(f.authorized).mockRejectedValueOnce(new PathFinderError('CALCULATION_GRANT_REVOKED', 409));
    const after = f.request({ path: prefix + '/resources/output/0/0.svf', method: 'HEAD' }); await after.run(); expect(after.res.statusCode).toBe(409); expect(f.close).toHaveBeenCalledOnce(); expect(f.service.reserveResponse).not.toHaveBeenCalled();
  });
  it('refuses traversal, query overrides and unsatisfiable ranges without unverified storage reads', async () => {
    for (const path of ['/resources/output/%2e%2e/private', '/resources/output%2f0/0.svf', '/resources/output/0/0.svf?domain=https%3A%2F%2Fforeign.invalid', '/descriptor?access_token=forbidden', '/unknown-action']) { const f = fixture(), r = f.request({ path: prefix + path, method: 'HEAD' }); await r.run(); expect([400, 404]).toContain(r.res.statusCode); expect(f.storage.readVerifiedResource).not.toHaveBeenCalled(); expect(f.service.reserveRequest).toHaveBeenCalledOnce(); }
    const f = fixture(), range = f.request({ path: prefix + '/resources/output/0/0.svf', extraHeaders: { range: 'bytes=9-' } }); await range.run(); expect(range.res.statusCode).toBe(416); expect(f.storage.readVerifiedResource).not.toHaveBeenCalled(); expect(f.service.reserveRequest).toHaveBeenCalledOnce();
  });
  it('rejects full raw integrity failure and never calls human model mutation APIs', async () => {
    const f = fixture(); f.storage.readVerifiedResource.mockRejectedValueOnce(new ModelStorageError('STORAGE_INTEGRITY_FAILED', 'Synthetic raw digest mismatch'));
    const r = f.request({ path: prefix + '/resources/output/0/0.svf', method: 'HEAD' }); await r.run(); expect(r.res.statusCode).toBe(409); expect(f.service.reserveResponse).not.toHaveBeenCalled(); expect(f.service.reserveRequest).toHaveBeenCalledOnce();
  });
  it('exhausts one shared admission allowance across successful, missing and failed-integrity reads before further work', async () => {
    const f = fixture(); let admitted = PRODUCER_RESOURCE_LIMITS.requests - 3;
    f.service.reserveRequest.mockImplementation(() => { if (admitted >= PRODUCER_RESOURCE_LIMITS.requests) throw new ViewerSessionError('PRODUCER_RESOURCE_BUDGET', 429); admitted++; });
    const success = f.request(); await success.run(); expect(success.res.statusCode).toBe(200);
    const missing = f.request({ path: prefix + '/resources/missing.svf', method: 'HEAD' }); await missing.run(); expect(missing.res.statusCode).toBe(404);
    f.storage.readVerifiedResource.mockRejectedValueOnce(new ModelStorageError('STORAGE_INTEGRITY_FAILED', 'Synthetic raw digest mismatch'));
    const failed = f.request({ path: prefix + '/resources/output/0/0.svf', method: 'HEAD' }); await failed.run(); expect(failed.res.statusCode).toBe(409);
    const before = f.service.authorizeResource.mock.calls.length, exhausted = f.request(); await exhausted.run();
    expect(exhausted.res.statusCode).toBe(429); expect(admitted).toBe(PRODUCER_RESOURCE_LIMITS.requests); expect(f.service.authorizeResource.mock.calls.length).toBe(before); expect(f.service.reserveResponse).toHaveBeenCalledOnce();
  });
});
