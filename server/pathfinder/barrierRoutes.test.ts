// @vitest-environment node
import { EventEmitter } from 'node:events';
import { Readable } from 'node:stream';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Pool } from 'pg';
import { BARRIER_LIMITS, barrierCanonicalJson, barrierCaptureCommandSchema, barrierRegistryCommandSchema, type BarrierCapture } from '../../shared/pathfinderBarriers.js';
import { PathFinderError } from './errors.js';
const mocks = vi.hoisted(() => ({ verify: vi.fn(), authorize: vi.fn(), get: vi.fn(), list: vi.fn(), getSnapshot: vi.fn(), readCaptureOutcome: vi.fn(), begin: vi.fn(), publish: vi.fn(), command: vi.fn(), adapters: vi.fn(), repository: vi.fn() }));
vi.mock('../auth.js', () => ({ verifyAccessToken: mocks.verify }));
vi.mock('./barrierCaptureAuthority.js', () => ({ barrierCaptureAdapters: mocks.adapters }));
vi.mock('./barrierRegistryRepository.js', () => ({ createBarrierRegistryRepository: mocks.repository }));
vi.mock('../viewerSessions/http.js', async importOriginal => ({ ...await importOriginal<typeof import('../viewerSessions/http.js')>(), viewerHttpPolicy: () => ({ origins: ['http://127.0.0.1:5191'], allowHttpLoopback: true, trustProxy: false }) }));
import { createBarrierRouter } from './barrierRoutes.js';
const id = (n: number) => `10000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const identity = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
const scope = () => ({ projectId: id(1), modelVersionId: id(2), contentFingerprint: 'a'.repeat(64), selectionRevision: '1', captureFrameId: id(3), captureFrameSha256: 'b'.repeat(64), coordinateFrame: 'canonical-world-metres' as const });
const parents = () => [{ selectionId: id(7), kind: 'wall' as const, objectId: 'dbid:10', dbId: 10, externalId: null, name: 'Selected parent', identityBasis: 'version-local-only' as const, inclusion: 'own-and-all-descendant-fragments' as const }];
const command = () => ({ schemaVersion: 'wfc.pf.barrier-capture-command.v1', scope: scope(), expectedRegistryRevision: '0', idempotencyKey: id(6), selectedParents: parents() });
function upload() {
  const capture: BarrierCapture = { schemaVersion: 'wfc.pf.barrier-capture.v1', captureId: id(9), scope: scope(), selectedParents: parents(), fragments: [{
    source: { fragmentId: 15, ownerObjectId: 'dbid:11', parentSelectionIds: [id(7)], sourceUnits: 'm', metresPerSourceUnit: 1, sourceToWorldMetres: identity, transformSha256: 'c'.repeat(64) },
    bounds: { minimum: [0, 0, 0], maximum: [1, 1, 1] }, verticesMetres: [[0, 0, 0], [1, 0, 0], [0, 1, 0], [0, 0, 1]], triangleIndices: [0, 2, 1, 0, 1, 3, 0, 3, 2, 1, 2, 3],
  }], observation: { state: 'reported-complete', verification: 'unverified', enumeratedFragmentIds: [15], unavailableFragmentIds: [], enumerationSha256: 'd'.repeat(64) } };
  return { capture, frameObservation: { schemaVersion: 'wfc.pf.barrier-frame-observation.v1', projectId: id(1), modelVersionId: id(2), contentFingerprint: 'a'.repeat(64), loadId: id(10), sdkVersion: '7.130.0', matrixPrecision: 'binary64', coordinateFrame: 'canonical-world-metres', sourceUnits: 'm', metresPerDisplayUnit: 1,
    upVector: [0, 0, 1], globalOffsetDisplayUnits: [0, 0, 0], globalOffsetMetres: [0, 0, 0], displayToWorldMetres: identity, modelTransform: null, placementTransform: null, contentSha256: 'e'.repeat(64) } };
}
beforeEach(() => {
  vi.resetAllMocks(); mocks.verify.mockReturnValue({ sub: id(4), jti: id(5), exp: Math.floor(Date.now() / 1000) + 3600 });
  mocks.repository.mockReturnValue(mocks); mocks.adapters.mockImplementation(context => ({ syntheticContext: context }));
  for (const name of ['authorize', 'get', 'list', 'getSnapshot', 'publish'] as const) mocks[name].mockResolvedValue({ synthetic: name });
  mocks.readCaptureOutcome.mockResolvedValue(null);
  // These mirror the mandatory production repository parsing. Route tests do not
  // pretend that a deliberately permissive mock proves repository validation.
  mocks.begin.mockImplementation(async (_project, _who, value) => ({ command: barrierCaptureCommandSchema.parse(value) }));
  mocks.command.mockImplementation(async (_project, _who, value) => ({ command: barrierRegistryCommandSchema.parse(value) }));
});
type Options = { url?: string; mode?: 'admin' | 'viewer'; method?: string; token?: string | null; length?: string; type?: string; encoding?: string; body?: string; bytes?: Buffer; query?: Record<string, unknown>; origin?: string | null; cookie?: string | null; site?: string; params?: Record<string, string> };
function request({ url = '/barriers', mode = 'admin', method = 'GET', token = 'Bearer synthetic', length, type = 'application/json', encoding, body, bytes, query = {}, origin = 'http://127.0.0.1:5191', cookie = 'wfc_viewer_session=' + 's'.repeat(43), site, params = {} }: Options = {}) {
  const data = bytes ?? (body === undefined ? null : Buffer.from(body));
  const headers: Record<string, string> = { 'content-type': type, host: '127.0.0.1:5191' };
  if (token !== null) headers.authorization = token; if (origin !== null) headers.origin = origin; if (cookie !== null) headers.cookie = cookie;
  if (site !== undefined) headers['sec-fetch-site'] = site; if (encoding !== undefined) headers['content-encoding'] = encoding;
  if (length !== undefined) headers['content-length'] = length; else if (data) headers['content-length'] = String(data.length);
  const req = Object.assign(data ? Readable.from([data]) : { on: vi.fn(), once: vi.fn(), read: vi.fn(() => { throw Error('Body must remain unread'); }) }, {
    url, originalUrl: url, baseUrl: '', path: url, method, socket: { encrypted: false }, params: { projectId: id(1), modelVersionId: id(2), sessionId: id(8), ...params }, query, headers, header: (key: string) => headers[key.toLowerCase()],
  });
  const res = Object.assign(new EventEmitter(), { locals: {}, statusCode: 200, writableEnded: false, destroyed: false, setHeader: vi.fn(), status(code: number) { this.statusCode = code; return this; }, json: vi.fn(), end: vi.fn() });
  const router = createBarrierRouter({} as Pool, mode);
  const run = () => new Promise<void>((resolve, reject) => {
    res.once('close', () => resolve()); res.json.mockImplementation(() => { res.writableEnded = true; resolve(); return res; });
    (router as unknown as { handle: (req: unknown, res: unknown, done: (error: unknown) => void) => void }).handle(req, res, error => error ? reject(error) : resolve());
  });
  return { req, res, run };
}

describe('barrier HTTP admission through in-memory Express router, no listener', () => {
  it('reads only an exact historical outcome with current admin login and no Viewer cookie/current-frame adapter', async () => {
    const hashes = { commandSha256: 'a'.repeat(64), captureSha256: 'b'.repeat(64), frameSha256: 'c'.repeat(64) };
    const r = request({ url: `/barriers/intents/${id(9)}/outcome`, query: hashes, params: { intentId: id(9) }, cookie: null, origin: null });
    await r.run(); expect(r.res.statusCode).toBe(200); expect(r.res.json).toHaveBeenCalledWith(null);
    expect(mocks.readCaptureOutcome).toHaveBeenCalledExactlyOnceWith(id(1), expect.objectContaining({ userId: id(4), loginId: id(5) }), id(9), hashes);
    expect(mocks.adapters.mock.calls.every(call => call[0] === undefined)).toBe(true); expect(mocks.publish).not.toHaveBeenCalled();
  });
  it.each(['extra', 'missing', 'array', 'uppercase'] as const)('refuses %s exact-outcome query without invoking historical read', async kind => {
    const hashes: Record<string, unknown> = { commandSha256: 'a'.repeat(64), captureSha256: 'b'.repeat(64), frameSha256: 'c'.repeat(64) };
    if (kind === 'extra') hashes.ready = true; if (kind === 'missing') delete hashes.frameSha256;
    if (kind === 'array') hashes.captureSha256 = [hashes.captureSha256]; if (kind === 'uppercase') hashes.commandSha256 = 'A'.repeat(64);
    const r = request({ url: `/barriers/intents/${id(9)}/outcome`, query: hashes, params: { intentId: id(9) } });
    await r.run(); expect(r.res.statusCode).toBe(400); expect(mocks.readCaptureOutcome).not.toHaveBeenCalled();
  });
  it('returns a terminal refusal as an exact successful outcome body rather than disguising it as operational503', async () => {
    const value = upload(), refusal = { schemaVersion: 'wfc.pf.barrier-publication-refusal.v1', outcome: 'not-published', intentId: id(9),
      commandSha256: '1'.repeat(64), captureSha256: '2'.repeat(64), frameSha256: '3'.repeat(64), implementationSha256: '4'.repeat(64),
      reasonCode: 'BARRIER_GEOMETRY_REFUSED', duplicate: false };
    mocks.publish.mockResolvedValueOnce(refusal);
    const r = request({ mode: 'viewer', url: `/captures/${id(9)}`, method: 'PUT', body: JSON.stringify(value) });
    await r.run(); expect(r.res.statusCode).toBe(200); expect(r.res.json).toHaveBeenCalledExactlyOnceWith(refusal);
  });
  it('keeps an operational verifier failure as an uncertain error without fabricating a terminal receipt', async () => {
    mocks.publish.mockRejectedValueOnce(new PathFinderError('BARRIER_VERIFIER_TIMEOUT', 503));
    const r = request({ mode: 'viewer', url: `/captures/${id(9)}`, method: 'PUT', body: JSON.stringify(upload()) });
    await r.run(); expect(r.res.statusCode).toBe(503); expect(r.res.json).toHaveBeenCalledWith(expect.objectContaining({ code: 'BARRIER_VERIFIER_TIMEOUT' }));
    expect(r.res.json.mock.calls[0][0]).not.toHaveProperty('outcome');
  });
  it('requires current database authority and sends private no-store registry reads', async () => {
    const r = request(); await r.run(); expect(mocks.authorize).toHaveBeenCalledExactlyOnceWith(id(1), expect.objectContaining({ userId: id(4), loginId: id(5) }));
    expect(mocks.get).toHaveBeenCalledWith(id(1), expect.any(Object)); expect(r.res.setHeader).toHaveBeenCalledWith('Cache-Control', 'private, no-store'); expect(r.res.setHeader).toHaveBeenCalledWith('X-Content-Type-Options', 'nosniff');
  });
  it('passes unrelated protected PF prefixes through without exposing a registry', async () => {
    const r = request({ url: '/preparations/context' }); await r.run(); expect(mocks.authorize).not.toHaveBeenCalled(); expect(r.res.json).not.toHaveBeenCalled();
  });
  it.each([null, 'Bearer broken'] as const)('rejects missing/invalid JWT before reading an oversize body (%s)', async token => {
    if (token) mocks.verify.mockImplementation(() => { throw Error('invalidJWTprivate'); });
    const r = request({ url: '/barriers/intents', method: 'POST', token, length: String(BARRIER_LIMITS.controlBytes + 1) }); await r.run();
    expect(r.res.statusCode).toBe(401); expect(mocks.authorize).not.toHaveBeenCalled(); expect(r.req.on).not.toHaveBeenCalled(); expect(JSON.stringify(r.res.json.mock.calls)).not.toContain('invalidJWTprivate');
  });
  it.each([{ sub: 'invalid', jti: id(5), exp: 123 }, { sub: id(4), jti: 'invalid', exp: 123 }, { sub: id(4), jti: id(5), exp: 1.5 }])('rejects malformed verified identity claims as authentication failures %j', async token => {
    mocks.verify.mockReturnValue(token); const r = request(); await r.run(); expect(r.res.statusCode).toBe(401); expect(mocks.authorize).not.toHaveBeenCalled();
  });
  it('current role loss takes precedence over buffering or declared-length disclosure', async () => {
    mocks.authorize.mockRejectedValue(new PathFinderError('ADMIN_REQUIRED', 403)); const r = request({ url: '/barriers/intents', method: 'POST', length: '99999999' }); await r.run();
    expect(r.res.statusCode).toBe(403); expect(r.req.on).not.toHaveBeenCalled(); expect(mocks.begin).not.toHaveBeenCalled();
  });
  it.each(['01', '-1', '10\n', String(BARRIER_LIMITS.controlBytes + 1)])('rejects malformed/oversize declared control length %s', async length => {
    const r = request({ url: '/barriers/intents', method: 'POST', length }); await r.run(); expect(r.res.statusCode).toBe(413); expect(r.req.on).not.toHaveBeenCalled(); expect(mocks.begin).not.toHaveBeenCalled();
  });
  it.each([{ type: 'text/plain' }, { encoding: 'gzip' }])('refuses unsupported transport before body parsing %j', async options => {
    const r = request({ url: '/barriers/intents', method: 'POST', ...options }); await r.run(); expect(r.res.statusCode).toBe(415); expect(r.req.on).not.toHaveBeenCalled();
  });
  it('passes a strict capture admission command with only authenticated actor identity', async () => {
    const input = command(), r = request({ url: '/barriers/intents', method: 'POST', body: JSON.stringify(input) }); await r.run();
    expect(r.res.statusCode).toBe(200); expect(mocks.begin).toHaveBeenCalledWith(id(1), expect.objectContaining({ userId: id(4), loginId: id(5) }), input);
  });
  it.each(['actorId', 'path', 'ready', 'producerVersion'] as const)('rejects caller %s claims with the strict repository boundary', async field => {
    const r = request({ url: '/barriers/intents', method: 'POST', body: JSON.stringify({ ...command(), [field]: 'caller-value' }) }); await r.run(); expect(r.res.statusCode).toBe(400);
  });
  it('rejects escaped duplicate JSON members before invoking admission', async () => {
    const body = JSON.stringify(command()).replace('{', '{"\\u0073chemaVersion":"wfc.pf.barrier-capture-command.v1",');
    const r = request({ url: '/barriers/intents', method: 'POST', body }); await r.run(); expect(r.res.statusCode).toBe(400); expect(mocks.begin).not.toHaveBeenCalled();
  });
  it.each([{ actor: 'caller' }, { limit: '101' }, { offset: '-1' }, { offset: '0\n' }, { limit: '1e2' }, { offset: ['0'] }, { limit: ['2'] }])('rejects unsupported, noncanonical or out-of-range list queries %j', async query => {
    const r = request({ url: '/barriers/snapshots', query }); await r.run(); expect(r.res.statusCode).toBe(400); expect(mocks.list).not.toHaveBeenCalled();
  });
  it('reads exact tenant snapshot paths and refuses unknown query members', async () => {
    const good = request({ url: `/barriers/snapshots/${id(11)}` }); await good.run(); expect(mocks.getSnapshot).toHaveBeenCalledWith(id(1), expect.any(Object), id(11));
    const bad = request({ url: `/barriers/snapshots/${id(11)}`, query: { actorId: id(99) } }); await bad.run(); expect(bad.res.statusCode).toBe(400);
  });
  it('keeps command declarations strict and does not expose internal error details', async () => {
    const bad = request({ url: '/barriers/commands', method: 'POST', body: JSON.stringify({ action: 'declare-empty', actorId: id(99) }) }); await bad.run(); expect(bad.res.statusCode).toBe(400);
    mocks.get.mockRejectedValue(Error('private SQL password path')); const r = request(); await r.run(); expect(r.res.statusCode).toBe(500); expect(JSON.stringify(r.res.json.mock.calls)).not.toContain('private SQL password path');
  });
});

describe('barrier capture upload bound to the protected viewer session path', () => {
  it('uses current admin, exact session/cookie/frame and canonical original capture bytes', async () => {
    const value = upload(), r = request({ mode: 'viewer', url: `/captures/${id(9)}`, method: 'PUT', body: JSON.stringify(value) }); await r.run();
    expect(r.res.statusCode).toBe(200); expect(mocks.adapters).toHaveBeenCalledWith(expect.objectContaining({ sessionId: id(8), cookieSecret: 's'.repeat(43), who: expect.objectContaining({ userId: id(4), loginId: id(5) }), frame: value.frameObservation }));
    expect(mocks.publish).toHaveBeenCalledExactlyOnceWith(id(1), expect.any(Object), id(9), Buffer.from(barrierCanonicalJson(value.capture)), expect.any(AbortSignal));
  });
  it.each([{ cookie: null }, { cookie: 'wfc_viewer_session=bad' }, { cookie: 'wfc_viewer_session=' + 's'.repeat(43) + '; wfc_viewer_session=' + 't'.repeat(43) }])('requires one exact viewer cookie before upload body reads %j', async options => {
    const r = request({ mode: 'viewer', url: `/captures/${id(9)}`, method: 'PUT', ...options }); await r.run(); expect(r.res.statusCode).toBe(401); expect(r.req.on).not.toHaveBeenCalled(); expect(mocks.publish).not.toHaveBeenCalled();
  });
  it.each([{ origin: null }, { origin: 'http://foreign.test' }, { site: 'cross-site' }])('requires the exact allowed same-origin context before body reads %j', async options => {
    const r = request({ mode: 'viewer', url: `/captures/${id(9)}`, method: 'PUT', ...options }); await r.run(); expect(r.res.statusCode).toBe(403); expect(r.req.on).not.toHaveBeenCalled(); expect(mocks.publish).not.toHaveBeenCalled();
  });
  it.each<Record<string, string>>([{ modelVersionId: 'invalid' }, { sessionId: 'invalid' }])('rejects noncanonical protected session parameters %j', async params => {
    const r = request({ mode: 'viewer', url: `/captures/${id(9)}`, method: 'PUT', params }); await r.run(); expect(r.res.statusCode).toBe(400); expect(mocks.publish).not.toHaveBeenCalled();
  });
  it.each(['project', 'model'] as const)('rejects %s mismatch against the upload URL before calling publication', async kind => {
    const value = upload(); if (kind === 'project') value.capture.scope.projectId = id(90); else value.capture.scope.modelVersionId = id(90);
    const r = request({ mode: 'viewer', url: `/captures/${id(9)}`, method: 'PUT', body: JSON.stringify(value) }); await r.run(); expect(r.res.statusCode).toBe(409); expect(mocks.publish).not.toHaveBeenCalled();
  });
  it.each(['unknown', 'duplicate', 'frame', 'finite'] as const)('rejects %s upload mutations without trusting producer assertions', async kind => {
    const value = upload(); let body = JSON.stringify(value);
    if (kind === 'unknown') body = JSON.stringify({ ...value, actorId: id(99), ready: true, path: '/foreign' });
    if (kind === 'duplicate') body = body.replace('{', '{"\\u0063apture":{},');
    if (kind === 'frame') body = JSON.stringify({ ...value, frameObservation: { ...value.frameObservation, sdkVersion: 'unqualified' } });
    if (kind === 'finite') body = body.replace('[[0,0,0]', '[[1e999,0,0]');
    const r = request({ mode: 'viewer', url: `/captures/${id(9)}`, method: 'PUT', body }); await r.run(); expect(r.res.statusCode).toBe(400); expect(mocks.publish).not.toHaveBeenCalled();
  });
  it('enforces the separate upload transport byte ceiling before buffering', async () => {
    const r = request({ mode: 'viewer', url: `/captures/${id(9)}`, method: 'PUT', length: String(BARRIER_LIMITS.captureBytes + 16 * 1024 + 1) }); await r.run(); expect(r.res.statusCode).toBe(413); expect(r.req.on).not.toHaveBeenCalled();
  });
  it('aborts the exact publication signal when the client disconnects and removes its listener', async () => {
    const r = request({ mode: 'viewer', url: `/captures/${id(9)}`, method: 'PUT', body: JSON.stringify(upload()) });
    let signal: AbortSignal | undefined;
    mocks.publish.mockImplementation(async (_project, _who, _intent, _bytes, active: AbortSignal) => {
      signal = active; return await new Promise((_, reject) => {
        active.addEventListener('abort', () => reject(new DOMException('Disconnected', 'AbortError')), { once: true });
        r.res.destroyed = true; r.res.emit('close');
      });
    });
    await r.run(); await Promise.resolve(); await Promise.resolve();
    expect(signal?.aborted).toBe(true); expect(r.res.json).not.toHaveBeenCalled(); expect(r.res.listenerCount('close')).toBe(0);
  });
});
