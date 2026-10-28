// @vitest-environment node
import { EventEmitter } from 'node:events';
import { Readable } from 'node:stream';
import { createHash } from 'node:crypto';
import type { Pool } from 'pg';
import type { Request } from 'express';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BARRIER_MULTIPART_PROFILE, barrierMultipartCanonicalJson } from '../../shared/pathfinderBarrierMultipart.js';
import { BARRIER_MULTIPART_PRODUCER_PROFILE } from '../../viewer-runtime/barrier-multipart-protocol.mjs';
import { barrierCanonicalJson } from '../../shared/pathfinderBarriers.js';
import { createProtectedBarrierMultipartRepository, resolveBarrierMultipartViewerPrincipal } from './barrierMultipartContext.js';
import { BARRIER_MULTIPART_HTTP_LIMITS, createBarrierMultipartRouter, parseBarrierMultipartCommandHeader } from './barrierMultipartRoutes.js';
import { PathFinderError } from './errors.js';

const id = (n: number) => `bc140000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const sha = (text: string) => createHash('sha256').update(text).digest('hex');
const prefix = `/api/projects/${id(1)}/model-versions/${id(2)}/viewer-sessions/${id(3)}/barrier-multipart`;
const mutation = () => ({ intentId: id(10), expectedSessionRevision: '0', idempotencyKey: id(11), scopeSha256: 'a'.repeat(64), profileSha256: 'b'.repeat(64) });
const part = () => ({ schemaVersion: 'wfc.pf.barrier-multipart-stage-part.v2', ...mutation(), partIndex: 0, planSealSha256: 'c'.repeat(64), payload: { bytes: 3, sha256: sha('raw') } });
const completion = () => ({ schemaVersion: 'wfc.pf.barrier-multipart-complete-producer.v2', ...mutation(), contextSha256: 'c'.repeat(64), frameSha256: 'd'.repeat(64),
  roots: { nodes: '1'.repeat(64), fragments: '2'.repeat(64), 'geometry-ranges': '3'.repeat(64), plan: '4'.repeat(64) }, partCount: 1,
  partsSha256: 'e'.repeat(64), bookendProfile: 'sdk7130-after-final-part-ack-hierarchy-frame-v1' });
const page = () => ({ schemaVersion: 'wfc.pf.barrier-multipart-page.v2', kind: 'nodes', scopeSha256: 'a'.repeat(64), profileSha256: 'b'.repeat(64), index: 0,
  firstOrdinal: 0, previousPageSha256: null, records: [{ dbId: 3, membershipMask: '0'.repeat(31) + '1' }], pageSha256: 'c'.repeat(64) });
function admission() {
  const modelScope = { projectId: id(1), modelVersionId: id(2), contentFingerprint: 'a'.repeat(64), selectionRevision: '1', captureFrameId: id(6), captureFrameSha256: 'b'.repeat(64), coordinateFrame: 'canonical-world-metres' };
  const command = { schemaVersion: 'wfc.pf.barrier-multipart-admit.v2', idempotencyKey: id(9), scope: { schemaVersion: 'wfc.pf.barrier-multipart-scope.v2', modelScope, modelLoadId: id(7),
    selectedParents: [{ selectionId: id(8), dbId: 3, kind: 'wall' }], geometryPolicy: 'original-triangles-structural-only.v2' }, profile: BARRIER_MULTIPART_PROFILE,
    expectedRegistryRevision: '0', selectedParentLabels: [{ selectionId: id(8), name: 'Synthetic wall' }], reservation: { bytes: 1048576, files: 100 } };
  const body = { schemaVersion: 'wfc.pf.barrier-frame-observation.v1', projectId: id(1), modelVersionId: id(2), contentFingerprint: modelScope.contentFingerprint, loadId: id(7), sdkVersion: '7.130.0',
    matrixPrecision: 'binary64', coordinateFrame: 'canonical-world-metres', sourceUnits: 'm', metresPerDisplayUnit: 1, upVector: [0, 0, 1], globalOffsetDisplayUnits: [0, 0, 0], globalOffsetMetres: [0, 0, 0],
    displayToWorldMetres: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1], modelTransform: null, placementTransform: null };
  return { command, frameObservation: { ...body, contentSha256: sha(barrierCanonicalJson(body)) }, producerProfile: BARRIER_MULTIPART_PRODUCER_PROFILE };
}
function fixture() {
  const who = { userId: id(4), loginId: id(5), loginExpiresAt: Date.now() + 3600000 }, result = { authority: 'none', synthetic: true };
  const repository = { admit: vi.fn(async () => result), stagePage: vi.fn(async () => result), stageSeal: vi.fn(async () => result), stagePart: vi.fn(async () => result),
    completeProducer: vi.fn(async () => result), readCompletion: vi.fn(async (): Promise<unknown> => null),
    cancel: vi.fn(async () => result), reconcile: vi.fn(async () => result), readPage: vi.fn(async () => page()) };
  const context = vi.fn(async () => ({ schemaVersion: 'wfc.pf.barrier-multipart-context.v2', session: result, context: { synthetic: true } }));
  const principal = vi.fn<typeof resolveBarrierMultipartViewerPrincipal>(async () => who);
  const factory = vi.fn(async (_pool: Pool, _input: Parameters<typeof createProtectedBarrierMultipartRepository>[1]) => ({ repository, context }));
  const router = createBarrierMultipartRouter({} as Pool, { storage: { store: vi.fn(), read: vi.fn() }, policy: { origins: ['http://127.0.0.1:5191'], allowHttpLoopback: true, trustProxy: false },
    resolvePrincipal: principal, createContext: factory as unknown as typeof createProtectedBarrierMultipartRepository });
  return { who, result, repository, context, principal, factory, router };
}
type Options = { method?: string; path?: string; original?: string; body?: string | Buffer; type?: string; cookie?: string | null; origin?: string | null; length?: string; encoding?: string; extra?: string[] };
function request(f: ReturnType<typeof fixture>, { method = 'GET', path = `/${id(10)}/context`, original, body, type = 'application/json', cookie = 'wfc_viewer_session=' + 's'.repeat(43), origin = 'http://127.0.0.1:5191', length, encoding, extra = [] }: Options = {}) {
  const data = body === undefined ? Buffer.alloc(0) : Buffer.isBuffer(body) ? body : Buffer.from(body);
  const headers: Record<string, string> = { host: '127.0.0.1:5191', ...(origin ? { origin } : {}) };
  const req = Object.assign(Readable.from([data]), { method, url: path, path, originalUrl: original ?? prefix + path, baseUrl: prefix, params: { projectId: id(1), modelVersionId: id(2), sessionId: id(3) },
    socket: { encrypted: false }, headers, rawHeaders: ['Host', '127.0.0.1:5191', 'Content-Type', type,
      ...(cookie === null ? [] : ['Cookie', cookie]), ...(origin === null ? [] : ['Origin', origin]), ...(length === undefined ? [] : ['Content-Length', length]), ...(encoding ? ['Content-Encoding', encoding] : []), ...extra],
    header(name: string) { return headers[name.toLowerCase()]; } });
  const iterator = vi.spyOn(req, Symbol.asyncIterator);
  const res = Object.assign(new EventEmitter(), { locals: {}, statusCode: 200, writableEnded: false, destroyed: false, headersSent: false, setHeader: vi.fn(), status(code: number) { this.statusCode = code; return this; }, json: vi.fn() });
  const run = () => new Promise<void>((resolve, reject) => {
    res.json.mockImplementation(() => { res.writableEnded = true; resolve(); return res; });
    (f.router as unknown as { handle(req: unknown, res: unknown, next: (error?: unknown) => void): void }).handle(req, res, error => error ? reject(error) : resolve());
  });
  return { req, res, iterator, run };
}
afterEach(() => vi.restoreAllMocks());

describe('cookie-only multipart transport through in-memory Express, no listener', () => {
  it('derives the principal before reading a closed admission body and forwards no Bearer or caller identity', async () => {
    const f = fixture(), value = admission(), r = request(f, { method: 'POST', path: '/sessions', body: JSON.stringify(value) }); await r.run();
    expect(r.res.statusCode).toBe(200); expect(f.principal).toHaveBeenCalledWith(expect.anything(), { projectId: id(1), modelVersionId: id(2), viewerSessionId: id(3), cookieSecret: 's'.repeat(43) }, expect.any(AbortSignal));
    expect(f.repository.admit).toHaveBeenCalledWith(id(1), f.who, value.command, expect.any(AbortSignal));
    expect(f.factory.mock.calls[0][1]).toMatchObject({ admission: value, who: f.who }); expect(r.res.setHeader).toHaveBeenCalledWith('Cache-Control', 'private, no-store');
    await f.router.close();
  });
  it('current-role refusal precedes buffering and declared body limits', async () => {
    const f = fixture(); f.principal.mockRejectedValue(new PathFinderError('ADMIN_REQUIRED', 403));
    const r = request(f, { method: 'POST', path: '/sessions', length: '999999999', body: 'private unread' }); await r.run();
    expect(r.res.statusCode).toBe(403); expect(r.iterator).not.toHaveBeenCalled(); expect(f.factory).not.toHaveBeenCalled(); await f.router.close();
  });
  it.each([{ cookie: null }, { cookie: 'wfc_viewer_session=bad' }, { cookie: 'wfc_viewer_session=' + 's'.repeat(43) + '; wfc_viewer_session=' + 't'.repeat(43) },
    { origin: null }, { origin: 'http://foreign.test' }])('refuses missing/ambiguous cookie or foreign origin before body reads %j', async options => {
    const f = fixture(), r = request(f, { ...options, method: 'POST', path: '/sessions', body: '{}' }); await r.run();
    expect([400, 401, 403]).toContain(r.res.statusCode); expect(r.iterator).not.toHaveBeenCalled(); expect(f.principal).not.toHaveBeenCalled(); await f.router.close();
  });
  it.each([{ length: '01' }, { length: '65537' }, { type: 'text/plain' }, { encoding: 'gzip' }])('refuses oversize/noncanonical transport %j', async options => {
    const f = fixture(), r = request(f, { ...options, method: 'POST', path: '/sessions', body: '{}' }); await r.run();
    expect([413, 415]).toContain(r.res.statusCode); expect(r.iterator).not.toHaveBeenCalled(); expect(f.repository.admit).not.toHaveBeenCalled(); await f.router.close();
  });
  it('rejects escaped duplicate fields and caller-chosen authority/URL additions', async () => {
    const f = fixture(), value = admission();
    for (const body of [JSON.stringify(value).replace('{', '{"\\u0063ommand":{},'), JSON.stringify({ ...value, uploadUrl: '/elsewhere', actorId: id(99) })]) {
      const r = request(f, { method: 'POST', path: '/sessions', body }); await r.run(); expect(r.res.statusCode).toBe(400);
    }
    expect(f.repository.admit).not.toHaveBeenCalled(); await f.router.close();
  });
  it('reads one page only through the exact immutable intent/kind/index and never accepts query aliases', async () => {
    const f = fixture(), r = request(f, { path: `/${id(10)}/pages/nodes/0` }); await r.run();
    expect(f.repository.readPage).toHaveBeenCalledWith(id(1), f.who, id(10), 'nodes', 0, expect.any(AbortSignal));
    const invalid = request(f, { original: prefix + `/${id(10)}/pages/nodes/0?actorId=${id(99)}`, path: `/${id(10)}/pages/nodes/0` }); await invalid.run(); expect(invalid.res.statusCode).toBe(400);
    const alias = request(f, { path: `/${id(10)}/context/nodes/0` }); await alias.run(); expect(alias.res.statusCode).toBe(405); expect(f.repository.readPage).toHaveBeenCalledTimes(1); await f.router.close();
  });
  it('forwards an exact page command but rejects a different URL intent', async () => {
    const f = fixture(), command = { schemaVersion: 'wfc.pf.barrier-multipart-stage-page.v2', ...mutation(), page: page() };
    const good = request(f, { method: 'POST', path: `/${id(10)}/pages`, body: JSON.stringify(command) }); await good.run();
    expect(f.repository.stagePage).toHaveBeenCalledWith(id(1), f.who, command, expect.any(AbortSignal));
    const bad = request(f, { method: 'POST', path: `/${id(99)}/pages`, body: JSON.stringify(command) }); await bad.run(); expect(bad.res.statusCode).toBe(409); expect(f.repository.stagePage).toHaveBeenCalledTimes(1); await f.router.close();
  });
  it('accepts raw opaque bytes only with one canonical ASCII metadata header', async () => {
    const f = fixture(), command = part(), r = request(f, { method: 'PUT', path: `/${id(10)}/parts`, type: 'application/octet-stream', length: '3', body: Buffer.from('raw'), extra: ['x-wfc-barrier-command', barrierMultipartCanonicalJson(command)] }); await r.run();
    expect(f.repository.stagePart).toHaveBeenCalledWith(id(1), f.who, command, Buffer.from('raw'), expect.any(AbortSignal)); await f.router.close();
  });
  it('forwards one exact completion command and reads absence without synthesizing completion from status', async () => {
    const f = fixture(), command = completion();
    const absent = request(f, { path: `/${id(10)}/producer-completion` }); await absent.run();
    expect(absent.res.json).toHaveBeenCalledWith(null);
    expect(f.repository.readCompletion).toHaveBeenCalledWith(id(1), f.who, id(10), expect.any(AbortSignal));
    const good = request(f, { method: 'POST', path: `/${id(10)}/producer-completion`, body: JSON.stringify(command) }); await good.run();
    expect(good.res.statusCode).toBe(200); expect(f.repository.completeProducer).toHaveBeenCalledWith(id(1), f.who, command, expect.any(AbortSignal));
    expect(f.repository.stagePart).not.toHaveBeenCalled(); await f.router.close();
  });
  it('refuses foreign completion identity, unrecognized authority and ambiguous route aliases', async () => {
    const f = fixture(), command = completion();
    const foreign = request(f, { method: 'POST', path: `/${id(99)}/producer-completion`, body: JSON.stringify(command) }); await foreign.run();
    expect(foreign.res.statusCode).toBe(409);
    const added = request(f, { method: 'POST', path: `/${id(10)}/producer-completion`, body: JSON.stringify({ ...command, authority: 'ready' }) }); await added.run();
    expect(added.res.statusCode).toBe(400);
    const alias = request(f, { path: `/${id(10)}/producer-completion/nodes/0` }); await alias.run(); expect(alias.res.statusCode).toBe(405);
    const query = request(f, { path: `/${id(10)}/producer-completion`, original: prefix + `/${id(10)}/producer-completion?ready=true` }); await query.run();
    expect(query.res.statusCode).toBe(400); expect(f.repository.completeProducer).not.toHaveBeenCalled(); expect(f.repository.readCompletion).not.toHaveBeenCalled(); await f.router.close();
  });
  it('fences completion authority before body buffering and applies the existing control byte bound', async () => {
    const f = fixture(); f.principal.mockRejectedValueOnce(new PathFinderError('ADMIN_REQUIRED', 403));
    const denied = request(f, { method: 'POST', path: `/${id(10)}/producer-completion`, body: 'unread' }); await denied.run();
    expect(denied.res.statusCode).toBe(403); expect(denied.iterator).not.toHaveBeenCalled();
    const huge = request(f, { method: 'POST', path: `/${id(10)}/producer-completion`, length: '65537', body: '{}' }); await huge.run();
    expect(huge.res.statusCode).toBe(413); expect(huge.iterator).not.toHaveBeenCalled(); expect(f.repository.completeProducer).not.toHaveBeenCalled(); await f.router.close();
  });
  it.each(['duplicate', 'whitespace', 'non-ascii', 'oversize', 'duplicate-json'] as const)('refuses %s command headers before reading opaque bytes', async kind => {
    const f = fixture(), canonical = barrierMultipartCanonicalJson(part()); let header = canonical, extra: string[] = [];
    if (kind === 'duplicate') extra = ['X-WFC-Barrier-Command', canonical]; if (kind === 'whitespace') header = ' ' + canonical;
    if (kind === 'non-ascii') header += 'é'; if (kind === 'oversize') header = 'x'.repeat(4097); if (kind === 'duplicate-json') header = canonical.replace('{', '{"\\u0069ntentId":"' + id(10) + '",');
    const r = request(f, { method: 'PUT', path: `/${id(10)}/parts`, type: 'application/octet-stream', body: 'raw', extra: ['x-wfc-barrier-command', header, ...extra] }); await r.run();
    expect(r.res.statusCode).toBe(400); expect(r.iterator).not.toHaveBeenCalled(); expect(f.repository.stagePart).not.toHaveBeenCalled(); await f.router.close();
  });
  it('rejects a shorter actual part and preserves a safe unknown/commit-unknown response', async () => {
    const f = fixture(), short = request(f, { method: 'PUT', path: `/${id(10)}/parts`, type: 'application/octet-stream', body: 'ra', extra: ['x-wfc-barrier-command', barrierMultipartCanonicalJson(part())] });
    await short.run(); expect(short.res.statusCode).toBe(413); expect(f.repository.stagePart).not.toHaveBeenCalled();
    f.context.mockRejectedValueOnce(Error('private credentials SQL path')); const unknown = request(f); await unknown.run(); expect(unknown.res.statusCode).toBe(500); expect(JSON.stringify(unknown.res.json.mock.calls)).not.toContain('private credentials');
    f.context.mockRejectedValueOnce(new PathFinderError('BARRIER_COMMIT_OUTCOME_UNKNOWN', 503)); const commit = request(f); await commit.run(); expect(commit.res.json).toHaveBeenCalledWith(expect.objectContaining({ code: 'BARRIER_COMMIT_OUTCOME_UNKNOWN' })); await f.router.close();
  });
  it('holds the single-part permit until the actual handler joins, including an aborted response', async () => {
    const f = fixture(); let release!: () => void, entered!: () => void;
    const started = new Promise<void>(resolve => { entered = resolve; }), pending = new Promise<void>(resolve => { release = resolve; });
    f.repository.stagePart.mockImplementation(async () => { entered(); await pending; return f.result; });
    const first = request(f, { method: 'PUT', path: `/${id(10)}/parts`, type: 'application/octet-stream', body: 'raw', extra: ['x-wfc-barrier-command', barrierMultipartCanonicalJson(part())] }), firstDone = first.run(); await started;
    const second = request(f, { method: 'PUT', path: `/${id(10)}/parts`, type: 'application/octet-stream', body: 'raw' }); await second.run(); expect(second.res.statusCode).toBe(503); expect(second.iterator).not.toHaveBeenCalled();
    let joined = false; const close = f.router.close().then(() => { joined = true; }); await Promise.resolve(); expect(joined).toBe(false);
    release(); await Promise.all([firstDone, close]); expect(joined).toBe(true);
    const stopped = request(f); await stopped.run(); expect(stopped.res.statusCode).toBe(503); expect(f.repository.stagePart).toHaveBeenCalledTimes(1);
  });
  it('closes even after an immediately rejected route; partial diagnostics cannot keep an orphan gate', async () => {
    const f = fixture(), r = request(f, { path: '/unsupported' }); await r.run(); expect(r.res.statusCode).toBe(405); await f.router.close();
  });
  it('keeps raw-header validation reusable without accepting native normalized duplicates', () => {
    const command = part(), req = { rawHeaders: ['x-wfc-barrier-command', barrierMultipartCanonicalJson(command)] } as Request;
    expect(parseBarrierMultipartCommandHeader(req)).toEqual(command); expect(BARRIER_MULTIPART_HTTP_LIMITS.activeParts).toBe(1);
  });
});
