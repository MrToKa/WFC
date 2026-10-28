// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Pool } from 'pg';
import type { Request, Response } from 'express';
import { createPurposePolicyRouter, sendPurposePolicyError } from './purposePolicyRoutes.js';
import { PurposePolicyError } from './purposePolicy.js';

const mocks = vi.hoisted(() => ({ authorize: vi.fn(), get: vi.fn(), save: vi.fn(), history: vi.fn(), verify: vi.fn() }));
vi.mock('../auth.js', () => ({ verifyAccessToken: mocks.verify }));
vi.mock('./purposePolicy.js', async original => ({ ...await original<object>(), createPurposePolicyRepository: () => mocks }));
const projectId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', actorId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', loginId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const current = { catalogRevision: '2', routingPolicyRevision: '1', drawingPolicyRevision: '0' };
beforeEach(() => { vi.clearAllMocks(); mocks.verify.mockReturnValue({ sub: actorId, jti: loginId, exp: Math.floor(Date.now() / 1000) + 3600, email: 'synthetic@example.test', isAdmin: true }); mocks.authorize.mockResolvedValue(current); mocks.get.mockResolvedValue({ synthetic: true }); });
function request({ path = '/routing-permissions', method = 'PUT', authorization = 'Bearer synthetic', length = '1048577' }: { path?: string; method?: string; authorization?: string | null; length?: string | null } = {}) {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (authorization !== null) headers.authorization = authorization; if (length !== null) headers['content-length'] = length;
  const req = { url: path, originalUrl: path, baseUrl: '', path, method, params: { projectId }, query: {}, headers, header: (key: string) => headers[key.toLowerCase()], on: vi.fn(), once: vi.fn(), read: vi.fn(() => { throw new Error('Body must not be read'); }) };
  const res: any = { locals: {}, statusCode: 200, setHeader: vi.fn(), status(code: number) { this.statusCode = code; return this; }, json: vi.fn(), end: vi.fn() };
  const router = createPurposePolicyRouter({} as Pool);
  const run = () => new Promise<void>((resolve, reject) => { res.json.mockImplementation(() => { resolve(); return res; }); (router as any).handle(req, res, (error: unknown) => error ? reject(error) : resolve()); });
  return { req, res, run };
}
describe('early policy router exact authorization and transport boundary', () => {
  it('rejects authenticated declared oversize immediately without consuming a missing body', async () => {
    const x = request(); await x.run(); expect(x.res.statusCode).toBe(413); expect(x.req.read).not.toHaveBeenCalled(); expect(x.req.on).not.toHaveBeenCalled();
    expect(x.res.json).toHaveBeenCalledWith({ schemaVersion: 'pathfinder.policy-error.v1', code: 'POLICY_BODY_TOO_LARGE', message: 'Routing permissions exceed the request limit.', currentRevisions: current }); expect(mocks.authorize).toHaveBeenCalledOnce(); expect(mocks.save).not.toHaveBeenCalled();
  });
  it('unauthenticated oversize refuses 401 before role lookup or body buffering', async () => { const x = request({ authorization: null }); await x.run(); expect(x.res.statusCode).toBe(401); expect(x.res.json.mock.calls[0][0].currentRevisions).toBe(null); expect(mocks.authorize).not.toHaveBeenCalled(); expect(x.req.read).not.toHaveBeenCalled(); });
  it('current nonadmin is denied before declared-length handling despite admin JWT', async () => { mocks.authorize.mockRejectedValue(new PurposePolicyError('ADMIN_REQUIRED', 403, 'Administrator access is required.')); const x = request(); await x.run(); expect(x.res.statusCode).toBe(403); expect(x.res.json.mock.calls[0][0].currentRevisions).toBe(null); expect(x.req.read).not.toHaveBeenCalled(); });
  it('expired or invalid JWT is adapted to exact policy error before role lookup', async () => { mocks.verify.mockImplementation(() => { throw new Error('synthetic-secret'); }); const x = request(); await x.run(); expect(x.res.statusCode).toBe(401); expect(x.res.json.mock.calls[0][0]).toMatchObject({ schemaVersion: 'pathfinder.policy-error.v1', currentRevisions: null }); expect(JSON.stringify(x.res.json.mock.calls)).not.toContain('synthetic-secret'); });
  it('checks current authority for GET before current policy response', async () => { const x = request({ method: 'GET', length: null }); await x.run(); expect(x.res.statusCode).toBe(200); expect(mocks.authorize).toHaveBeenCalledOnce(); expect(mocks.get).toHaveBeenCalledWith(projectId, expect.objectContaining({ userId: actorId, loginId })); });
  it('does not intercept unrelated protected Viewer/Path Finder routes', async () => { const x = request({ path: '/lookups', authorization: null, method: 'POST' }); await x.run(); expect(mocks.verify).not.toHaveBeenCalled(); expect(mocks.authorize).not.toHaveBeenCalled(); expect(x.res.json).not.toHaveBeenCalled(); });
  it('adapts body-parser oversize and unsupported encoding without raw parser details', () => {
    for (const [error, status] of [[{ status: 413, type: 'entity.too.large', message: 'synthetic-secret' }, 413], [{ status: 415 }, 415], [{ status: 400 }, 400]] as const) {
      const x = request(); x.res.locals.currentPolicyRevisions = current; sendPurposePolicyError(x.res as Response, error); expect(x.res.statusCode).toBe(status); expect(x.res.json.mock.calls[0][0].currentRevisions).toEqual(current); expect(JSON.stringify(x.res.json.mock.calls)).not.toContain('synthetic-secret');
    }
  });
  it('keeps unauthorized revisions null even if preflight locals contain a stale scope', () => { const x = request(); x.res.locals.currentPolicyRevisions = current; sendPurposePolicyError(x.res as Response, new PurposePolicyError('LOGIN_REVOKED', 401)); expect(x.res.json.mock.calls[0][0].currentRevisions).toBe(null); });
});
