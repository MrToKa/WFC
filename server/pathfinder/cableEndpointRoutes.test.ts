// @vitest-environment node
import { EventEmitter } from 'node:events';
import { Readable } from 'node:stream';
import type { Pool } from 'pg';
import type { Response } from 'express';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createCableEndpointRouter, sendCableEndpointError } from './cableEndpointRoutes.js';
import type { CableEndpointCommands } from './cableEndpointCommands.js';
import { CABLE_ENDPOINT_LIMITS } from '../../shared/pathfinderCableEndpoints.js';
import { CABLE_ENDPOINT_PAIR_LIMITS } from '../../shared/pathfinderCableEndpointPair.js';
import { PathFinderError } from './errors.js';
const mocks = vi.hoisted(() => ({ verify: vi.fn(), authorize: vi.fn(), context: vi.fn(), selection: vi.fn(), save: vi.fn(), close: vi.fn(), savePair: vi.fn(), closePair: vi.fn() }));
vi.mock('../auth.js', () => ({ verifyAccessToken: mocks.verify }));
const id = (n: number) => `f2000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const command = () => ({ schemaVersion: 'wfc.pf.cable-endpoint-command.v1', idempotencyKey: id(8), expectedContextSha256: 'a'.repeat(64), expectedCableWriteRevision: '7',
  expectedLogicalName: 'Equipment', expectedRegistryRevision: '4', expectedLocationId: null, expectedLocationRevision: null, expectedHeadId: null,
  expectedCurrent: { modelVersionId: id(3), selectionRevision: '1', contentFingerprint: 'b'.repeat(64), aggregateId: id(4), artifactId: id(5), projectionSha256: 'c'.repeat(64),
    captureFrameId: id(6), geometryRevision: '2', traceId: id(7) }, reason: 'Explicit synthetic endpoint selection',
  selection: { mode: 'fixed-world', pointProjectMetres: [1, 2, 3], derivation: 'manual-world-point', displaySdkObjectId: null } });
beforeEach(() => { vi.resetAllMocks(); mocks.verify.mockReturnValue({ sub: id(1), jti: id(2), exp: Math.floor(Date.now() / 1000) + 3600 });
  for (const key of ['authorize', 'context', 'selection', 'save', 'close', 'savePair', 'closePair'] as const) mocks[key].mockResolvedValue({ synthetic: key }); });
afterEach(() => vi.useRealTimers());
function request({ url = `/cable-endpoints/${id(9)}/from`, method = 'GET', token = 'Bearer synthetic', length, type = 'application/json', encoding, body, query = {}, stall = false }:
  { url?: string; method?: string; token?: string | null; length?: string; type?: string; encoding?: string; body?: string; query?: Record<string, string>; stall?: boolean } = {}) {
  const bytes = body === undefined ? null : Buffer.from(body), headers: Record<string, string> = { 'content-type': type };
  if (token !== null) headers.authorization = token; if (encoding) headers['content-encoding'] = encoding; if (length !== undefined) headers['content-length'] = length; else if (bytes) headers['content-length'] = String(bytes.length);
  const stream = stall ? new Readable({ read() {} }) : null;
  const req = Object.assign(stream ?? (bytes ? Readable.from([bytes]) : { on: vi.fn(), once: vi.fn(), removeListener: vi.fn(), read: vi.fn(() => { throw Error('The body must remain unread'); }) }),
    { url, originalUrl: url, baseUrl: '', path: url, method, params: { projectId: id(1) }, query, headers, header: (key: string) => headers[key.toLowerCase()] });
  const res = Object.assign(new EventEmitter(), { locals: {}, statusCode: 200, writableEnded: false, destroyed: false, setHeader: vi.fn(),
    status(value: number) { this.statusCode = value; return this; }, json: vi.fn(), end: vi.fn() });
  const router = createCableEndpointRouter({} as Pool, mocks as unknown as CableEndpointCommands);
  const run = () => new Promise<void>((resolve, reject) => { res.json.mockImplementation(() => { res.writableEnded = true; resolve(); return res; });
    (router as unknown as { handle: (req: unknown, res: unknown, done: (error: unknown) => void) => void }).handle(req, res, error => error ? reject(error) : resolve()); });
  return { req, res, run, stream };
}
describe('cable endpoint router via in-memory Express; no HTTP listener', () => {
  it('reads private cable context through existing authority and passes unrelated PF paths through', async () => {
    const r = request(); await r.run(); expect(mocks.authorize).toHaveBeenCalledExactlyOnceWith(id(1), expect.objectContaining({ userId: id(1), loginId: id(2) }), expect.any(AbortSignal));
    expect(mocks.context).toHaveBeenCalledExactlyOnceWith(id(1), expect.any(Object), id(9), 'from', expect.any(AbortSignal));
    expect(r.res.setHeader).toHaveBeenCalledWith('Cache-Control', 'private, no-store'); const other = request({ url: '/jobs' }); await other.run(); expect(other.res.json).not.toHaveBeenCalled();
  });
  it.each([null, 'Bearer broken'] as const)('denies missing/bad token before parsing or revealing body limits (%s)', async token => {
    if (token) mocks.verify.mockImplementation(() => { throw Error('signature'); }); const r = request({ method: 'PUT', token, length: '9999999' }); await r.run();
    expect(r.res.statusCode).toBe(401); expect(r.req.on).not.toHaveBeenCalled(); expect(mocks.authorize).not.toHaveBeenCalled();
  });
  it('checks current admin before parsing a deliberately oversized write', async () => {
    mocks.authorize.mockRejectedValue(new PathFinderError('ADMIN_REQUIRED', 403)); const r = request({ method: 'PUT', length: '9999999' }); await r.run(); expect(r.res.statusCode).toBe(403); expect(r.req.on).not.toHaveBeenCalled();
  });
  it.each(['01', '-1', '1\n', String(CABLE_ENDPOINT_LIMITS.controlBytes + 1)])('refuses noncanonical or oversized declared length %j before reading', async length => {
    const r = request({ method: 'PUT', length }); await r.run(); expect(r.res.statusCode).toBe(413); expect(r.req.on).not.toHaveBeenCalled(); expect(r.res.setHeader).toHaveBeenCalledWith('Connection', 'close');
  });
  it.each([{ type: 'text/plain' }, { encoding: 'gzip' }])('rejects unsupported encoding or media %j before body reads', async options => {
    const r = request({ method: 'PUT', ...options }); await r.run(); expect(r.res.statusCode).toBe(415); expect(r.req.on).not.toHaveBeenCalled();
  });
  it('passes exact current SDK id and context hash without accepting SDK bounds or names', async () => {
    const r = request({ url: `/cable-endpoints/${id(9)}/to/selection`, query: { sdkObjectId: '123', contextSha256: 'a'.repeat(64) } }); await r.run();
    expect(mocks.selection).toHaveBeenCalledExactlyOnceWith(id(1), expect.any(Object), id(9), 'to', 123, 'a'.repeat(64), expect.any(AbortSignal));
  });
  it.each([{ sdkObjectId: '0123', contextSha256: 'a'.repeat(64) }, { sdkObjectId: '2147483648', contextSha256: 'a'.repeat(64) },
    { sdkObjectId: '123\n', contextSha256: 'a'.repeat(64) }, { sdkObjectId: '123', contextSha256: 'a'.repeat(64), point: '1,2,3' }] as Record<string, string>[])('refuses malformed selection query %j', async query => {
    const r = request({ url: `/cable-endpoints/${id(9)}/from/selection`, query }); await r.run(); expect(r.res.statusCode).toBe(400); expect(mocks.selection).not.toHaveBeenCalled();
  });
  it('sends one exact atomic command with an abort signal; close uses the same body and separate explicit endpoint', async () => {
    const input = command(), r = request({ method: 'PUT', body: JSON.stringify(input) }); await r.run();
    expect(mocks.save).toHaveBeenCalledExactlyOnceWith(id(1), expect.any(Object), id(9), 'from', input, expect.any(AbortSignal));
    const close = request({ url: `/cable-endpoints/${id(9)}/from/close-pending`, method: 'POST', body: JSON.stringify(input) }); await close.run();
    expect(mocks.close).toHaveBeenCalledExactlyOnceWith(id(1), expect.any(Object), id(9), 'from', input, expect.any(AbortSignal));
  });
  it.each(['duplicate', 'actor', 'finite', 'matrix', 'version'] as const)('refuses %s body before any save/closure call', async kind => {
    let body = JSON.stringify(command()); if (kind === 'duplicate') body = body.replace('{', '{"\\u0072eason":"duplicate",');
    if (kind === 'actor') body = JSON.stringify({ ...command(), actorId: id(99) }); if (kind === 'finite') body = body.replace('[1,2,3]', '[1e999,2,3]');
    if (kind === 'matrix') body = JSON.stringify({ ...command(), bounds: [1, 2, 3] }); if (kind === 'version') body = body.replace('command.v1', 'command.v2');
    const r = request({ method: 'PUT', body }); await r.run(); expect(r.res.statusCode).toBe(400); expect(mocks.save).not.toHaveBeenCalled(); expect(mocks.close).not.toHaveBeenCalled();
  });
  it('rejects unknown queries, invalid ends and case variants without legacy fallthrough', async () => {
    const q = request({ query: { actorId: id(99) } }); await q.run(); expect(q.res.statusCode).toBe(400);
    const end = request({ url: `/cable-endpoints/${id(9)}/source` }); await end.run(); expect(end.res.statusCode).toBe(400);
    const casing = request({ url: `/Cable-Endpoints/${id(9)}/from` }); await casing.run(); expect(casing.res.statusCode).toBe(405); expect(mocks.context).not.toHaveBeenCalled();
  });
  it('sanitizes errors; refusal never claims that an uncertain pending command is safe to discard', () => {
    for (const [error, status, outcome] of [[Error('secret SQL/socket detail'), 503, 'unknown'], [new PathFinderError('ENDPOINT_COMMIT_OUTCOME_UNKNOWN', 503), 503, 'unknown'],
      [new PathFinderError('CABLE_ENDPOINT_CONTEXT_CHANGED', 409), 409, 'refused']] as const) {
      const r = request(); sendCableEndpointError(r.res as unknown as Response, error); expect(r.res.statusCode).toBe(status);
      const body = r.res.json.mock.calls[0][0]; expect(body.outcome).toBe(outcome); expect(body.message).not.toContain('secret SQL'); expect(body.message).not.toMatch(/safe to discard/i);
    }
  });
  it('bounds a slow authenticated body before parsing completes and never dispatches a late save', async () => {
    vi.useFakeTimers(); const input = JSON.stringify(command()), r = request({ method: 'PUT', body: input, stall: true });
    const pending = r.run(); await vi.advanceTimersByTimeAsync(15001); await pending;
    expect(r.res.statusCode).toBe(503); expect(r.res.json.mock.calls[0][0].code).toBe('CABLE_ENDPOINT_DEADLINE_EXCEEDED');
    expect(mocks.save).not.toHaveBeenCalled(); expect(mocks.authorize.mock.calls[0][2].aborted).toBe(true);
    r.stream!.push(Buffer.from(input)); r.stream!.push(null); await vi.advanceTimersByTimeAsync(1); expect(mocks.save).not.toHaveBeenCalled();
  });
  it('dispatches one exact pair save and its explicit same-body recovery through current authority', async () => {
    const child = { ...command(), schemaVersion: 'wfc.pf.cable-endpoint-command.v3', calculation: null, initialFill: { mode: 'when-both-empty' } };
    const input = { schemaVersion: 'wfc.pf.cable-endpoint-pair-command.v1', idempotencyKey: id(30), expectedContexts: { from: child.expectedContextSha256, to: 'b'.repeat(64) }, endpoints: [{ end: 'from', command: child }] };
    const save = request({ url: `/cable-endpoint-pairs/${id(9)}`, method: 'PUT', body: JSON.stringify(input) }); await save.run();
    expect(mocks.savePair).toHaveBeenCalledExactlyOnceWith(id(1), expect.any(Object), id(9), input, expect.any(AbortSignal)); expect(mocks.save).not.toHaveBeenCalled();
    const close = request({ url: `/cable-endpoint-pairs/${id(9)}/close-pending`, method: 'POST', body: JSON.stringify(input) }); await close.run();
    expect(mocks.closePair).toHaveBeenCalledExactlyOnceWith(id(1), expect.any(Object), id(9), input, expect.any(AbortSignal));
  });
  it('keeps pair byte limits isolated and authorizes before disclosing them', async () => {
    const denied = request({ url: `/cable-endpoint-pairs/${id(9)}`, method: 'PUT', length: String(CABLE_ENDPOINT_PAIR_LIMITS.controlBytes + 1) });
    mocks.authorize.mockRejectedValueOnce(new PathFinderError('ADMIN_REQUIRED', 403)); await denied.run(); expect(denied.res.statusCode).toBe(403);
    const large = request({ url: `/cable-endpoint-pairs/${id(9)}`, method: 'PUT', length: String(CABLE_ENDPOINT_PAIR_LIMITS.controlBytes + 1) }); await large.run();
    expect(large.res.statusCode).toBe(413); expect(mocks.savePair).not.toHaveBeenCalled();
  });
  it('rejects malformed pair bodies, duplicate keys, queries and unsupported case variants without old-command fallthrough', async () => {
    const child = { ...command(), schemaVersion: 'wfc.pf.cable-endpoint-command.v3', calculation: null, initialFill: null };
    const input = { schemaVersion: 'wfc.pf.cable-endpoint-pair-command.v1', idempotencyKey: id(30), expectedContexts: { from: child.expectedContextSha256, to: 'b'.repeat(64) }, endpoints: [{ end: 'from', command: child }] };
    for (const body of [JSON.stringify({ ...input, actorId: id(99) }), JSON.stringify(input).replace('{', '{"idempotencyKey":"duplicate",')]) {
      const r = request({ url: `/cable-endpoint-pairs/${id(9)}`, method: 'PUT', body }); await r.run(); expect(r.res.statusCode).toBe(400);
    }
    const query = request({ url: `/cable-endpoint-pairs/${id(9)}`, method: 'PUT', body: JSON.stringify(input), query: { unsafe: 'true' } }); await query.run(); expect(query.res.statusCode).toBe(400);
    const casing = request({ url: `/Cable-Endpoint-Pairs/${id(9)}`, method: 'PUT', body: JSON.stringify(input) }); await casing.run(); expect(casing.res.statusCode).toBe(405);
    expect(mocks.savePair).not.toHaveBeenCalled(); expect(mocks.save).not.toHaveBeenCalled();
  });
});
