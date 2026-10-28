// @vitest-environment node
import { EventEmitter } from 'node:events';
import { Readable } from 'node:stream';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createModelLocationMatchRouter } from './modelLocationMatchRoutes.js';
import type { ModelLocationMatchRepository } from './modelLocationMatch.js';
import { PathFinderError } from './errors.js';
import { MODEL_LOCATION_MATCH_LIMITS } from '../../shared/pathfinderModelLocationMatch.js';
import { modelLocationMatchFixture } from './modelLocationMatchFixtures.js';
const mocks = vi.hoisted(() => ({ verify: vi.fn(), authorize: vi.fn(), context: vi.fn(), assign: vi.fn() }));
vi.mock('../auth.js', () => ({ verifyAccessToken: mocks.verify }));
const id = 'ed000000-0000-4000-8000-000000000001';
beforeEach(() => { vi.resetAllMocks(); mocks.verify.mockReturnValue({ sub: id, jti: id, exp: Math.floor(Date.now() / 1000) + 3600 });
  mocks.authorize.mockResolvedValue(undefined); mocks.context.mockResolvedValue({ synthetic: true }); mocks.assign.mockResolvedValue({ synthetic: true }); });
function request({ url = '/locations/model-match/context', method = 'GET', token = 'Bearer synthetic', length, type = 'application/json', encoding, body, query = {} }:
  { url?: string; method?: string; token?: string | null; length?: string; type?: string; encoding?: string; body?: string; query?: Record<string, string> } = {}) {
  const bytes = body === undefined ? null : Buffer.from(body), headers: Record<string, string> = { 'content-type': type };
  if (token !== null) headers.authorization = token; if (encoding) headers['content-encoding'] = encoding;
  if (length !== undefined) headers['content-length'] = length; else if (bytes) headers['content-length'] = String(bytes.length);
  const req = Object.assign(bytes ? Readable.from([bytes]) : { on: vi.fn(), once: vi.fn(), read: vi.fn(() => { throw Error('No body read before admission'); }) },
    { url, originalUrl: url, baseUrl: '', path: url, method, params: { projectId: id }, query, headers, header: (key: string) => headers[key.toLowerCase()] });
  const res = Object.assign(new EventEmitter(), { locals: {}, statusCode: 200, writableEnded: false, destroyed: false, setHeader: vi.fn(),
    status(value: number) { this.statusCode = value; return this; }, json: vi.fn(), end: vi.fn() });
  const router = createModelLocationMatchRouter(mocks as unknown as ModelLocationMatchRepository);
  const run = () => new Promise<void>((resolve, reject) => { res.json.mockImplementation(() => { res.writableEnded = true; resolve(); return res; });
    (router as unknown as { handle: (r: unknown, s: unknown, done: (e: unknown) => void) => void }).handle(req, res, e => e ? reject(e) : resolve()); });
  return { req, res, run };
}
describe('bounded model location matching admission', () => {
  it('serves only exact current context and passes other feature paths', async () => {
    const r = request(); await r.run(); expect(mocks.context).toHaveBeenCalledWith(id, expect.objectContaining({ userId: id }), expect.any(AbortSignal));
    expect(r.res.setHeader).toHaveBeenCalledWith('Cache-Control', 'private, no-store');
    const other = request({ url: '/locations/elsewhere' }); await other.run(); expect(other.res.json).not.toHaveBeenCalled();
  });
  it('passes one validated assignment and disconnect signal to its atomic repository entrypoint', async () => {
    const f = await modelLocationMatchFixture(), command = f.command();
    const r = request({ url: '/locations/model-match/assign', method: 'POST', body: JSON.stringify(command) }); await r.run();
    expect(r.res.statusCode).toBe(200); expect(mocks.assign).toHaveBeenCalledExactlyOnceWith(id, expect.objectContaining({ userId: id }), command, expect.any(AbortSignal));
  });
  it.each([null, 'Bearer broken'])('refuses absent or invalid authority before a declared large body (%s)', async token => {
    if (token) mocks.verify.mockImplementation(() => { throw Error('signature'); });
    const r = request({ url: '/locations/model-match/assign', method: 'POST', token, length: '99999999' }); await r.run();
    expect(r.res.statusCode).toBe(401); expect(r.req.on).not.toHaveBeenCalled(); expect(mocks.assign).not.toHaveBeenCalled();
  });
  it('current access refusal wins over size parsing', async () => {
    mocks.authorize.mockRejectedValue(new PathFinderError('ADMIN_REQUIRED', 403));
    const r = request({ url: '/locations/model-match/assign', method: 'POST', length: '99999999' }); await r.run();
    expect(r.res.statusCode).toBe(403); expect(r.req.on).not.toHaveBeenCalled();
  });
  it.each(['01', '-1', '10\n', String(MODEL_LOCATION_MATCH_LIMITS.bodyBytes + 1)])('bounds declared body %s before read', async length => {
    const r = request({ url: '/locations/model-match/assign', method: 'POST', length }); await r.run(); expect(r.res.statusCode).toBe(413); expect(r.req.on).not.toHaveBeenCalled();
  });
  it.each([{ type: 'text/plain' }, { encoding: 'gzip' }])('rejects unsupported transport %j', async options => {
    const r = request({ url: '/locations/model-match/assign', method: 'POST', ...options }); await r.run(); expect(r.res.statusCode).toBe(415); expect(r.req.on).not.toHaveBeenCalled();
  });
  it.each(['{"current":{},"current":{}}', '{"actorId":"injected"}'])('strictly refuses malformed commands', async body => {
    const r = request({ url: '/locations/model-match/assign', method: 'POST', body }); await r.run(); expect(r.res.statusCode).toBe(400); expect(mocks.assign).not.toHaveBeenCalled();
  });
  it('owns case variants and refuses extra query authority', async () => {
    const variant = request({ url: '/Locations/Model-Match/context' }); await variant.run(); expect(variant.res.statusCode).toBe(405);
    const extra = request({ query: { actor: id } }); await extra.run(); expect(extra.res.statusCode).toBe(400); expect(mocks.context).not.toHaveBeenCalled();
  });
});
