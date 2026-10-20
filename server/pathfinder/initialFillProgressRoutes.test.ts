// @vitest-environment node
import { EventEmitter } from 'node:events';
import type { Request, Response } from 'express';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createInitialFillProgressReadHandler } from './initialFillProgressRoutes.js';
import { PathFinderError } from './errors.js';
const id = (n: number) => `f8510000-0000-4000-8000-${String(n).padStart(12, '0')}`;
function fixture() {
  const read = vi.fn().mockResolvedValue({ fixture: 'bounded-metadata' });
  const req = Object.assign(new EventEmitter(), { params: { projectId: id(1), impactId: id(2) }, query: {}, userId: id(3), loginId: id(4), loginExpiresAt: Date.now() + 60000 }) as unknown as Request;
  const res = Object.assign(new EventEmitter(), { setHeader: vi.fn(), status: vi.fn(), json: vi.fn(), destroyed: false, writableEnded: false }) as unknown as Response;
  vi.mocked(res.status).mockReturnValue(res);
  vi.mocked(res.json).mockImplementation(() => { Object.defineProperty(res, 'writableEnded', { value: true, writable: true }); return res; });
  return { read, req, res, handler: createInitialFillProgressReadHandler({ read }) };
}
afterEach(() => vi.useRealTimers());
describe('initial-fill metadata GET boundary (mocked repository, no HTTP listener)', () => {
  it('uses the current authenticated principal and exact optional cable, with no-store', async () => {
    const f = fixture(); f.req.query = { cableId: id(5) }; await f.handler(f.req, f.res);
    expect(f.read).toHaveBeenCalledWith(id(1), { userId: id(3), loginId: id(4), loginExpiresAt: f.req.loginExpiresAt }, { impactId: id(2), cableId: id(5) }, expect.any(AbortSignal));
    expect(f.res.setHeader).toHaveBeenCalledWith('Cache-Control', 'private, no-store');
    expect(f.req.listenerCount('aborted')).toBe(0); expect(f.res.listenerCount('close')).toBe(0);
  });
  it.each([{ actorId: id(8) }, { cableId: 'bad' }, { cableId: [id(5), id(6)] }, { grant: 'yes' }])('refuses unsupported query %j before repository access', async query => {
    const f = fixture(); f.req.query = query as Request['query']; await f.handler(f.req, f.res); expect(f.res.status).toHaveBeenCalledWith(400); expect(f.read).not.toHaveBeenCalled();
  });
  it.each([401, 403, 404, 409])('preserves refusal %s without exposing internal details', async status => {
    const f = fixture(); f.read.mockRejectedValue(new PathFinderError('FIXTURE_REFUSAL', status, 'private internal detail')); await f.handler(f.req, f.res);
    expect(f.res.status).toHaveBeenCalledWith(status); expect(JSON.stringify(vi.mocked(f.res.json).mock.calls)).not.toContain('private internal detail');
  });
  it('caps oversized output', async () => { const f = fixture(); f.read.mockResolvedValue({ fixture: 'x'.repeat(32769) }); await f.handler(f.req, f.res); expect(f.res.status).toHaveBeenCalledWith(413); });
  it('bounds an uncooperative dependency and aborts its signal', async () => {
    vi.useFakeTimers(); const f = fixture(); f.read.mockImplementation(() => new Promise(() => {})); const pending = f.handler(f.req, f.res);
    await vi.advanceTimersByTimeAsync(15000); await pending; expect(f.res.status).toHaveBeenCalledWith(503); expect((f.read.mock.calls[0][3] as AbortSignal).aborted).toBe(true);
  });
});
