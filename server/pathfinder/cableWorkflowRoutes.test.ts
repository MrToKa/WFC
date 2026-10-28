// @vitest-environment node
import { EventEmitter } from 'node:events';
import type { Request, Response } from 'express';
import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { createCableWorkflowReadHandlers } from './cableWorkflowRoutes.js';
import type { CableWorkflowRepository } from './cableWorkflowRepository.js';
import { PathFinderError } from './errors.js';

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
function fixture() {
  const page = vi.fn(async () => ({ observed: 'owned synthetic read only' })), detail = vi.fn(async () => ({ observed: 'owned synthetic detail' }));
  const handlers = createCableWorkflowReadHandlers({ page, detail } as unknown as CableWorkflowRepository);
  const req = Object.assign(new EventEmitter(), { params: { projectId: id(1), cableId: id(4) }, query: { search: '%_\\' },
    userId: id(2), loginId: id(3), loginExpiresAt: Date.now() + 100000 });
  const res = Object.assign(new EventEmitter(), { writableEnded: false, destroyed: false, setHeader: vi.fn(), status: vi.fn(), json: vi.fn() });
  res.status.mockReturnValue(res); res.json.mockImplementation(() => { res.writableEnded = true; return res; });
  return { page, detail, handlers, req, res, run: (kind: 'page' | 'detail' = 'page') => handlers[kind](req as unknown as Request, res as unknown as Response) };
}
describe('protected read-only workflow handlers', () => {
  it('passes raw HTTP query only to the exact authorized repository page boundary', async () => {
    const f = fixture(); await f.run();
    expect(f.page).toHaveBeenCalledExactlyOnceWith(id(1), { userId: id(2), loginId: id(3), loginExpiresAt: f.req.loginExpiresAt }, f.req.query, expect.any(AbortSignal), true);
    expect(f.detail).not.toHaveBeenCalled(); expect(f.res.setHeader).toHaveBeenCalledWith('Cache-Control', 'private, no-store');
    expect(f.req.listenerCount('aborted')).toBe(0); expect(f.res.listenerCount('close')).toBe(0);
  });
  it('keeps detail inside the same current principal and exact project/cable path', async () => {
    const f = fixture(); await f.run('detail');
    expect(f.detail).toHaveBeenCalledWith(id(1), expect.objectContaining({ userId: id(2), loginId: id(3) }), id(4), f.req.query, expect.any(AbortSignal), true);
    expect(f.page).not.toHaveBeenCalled();
  });
  it.each([401, 403] as const)('preserves current authority refusal %s without leaking errors or rows', async status => {
    const f = fixture(); f.page.mockRejectedValue(new PathFinderError(status === 401 ? 'LOGIN_REVOKED' : 'ADMIN_REQUIRED', status, 'private business details'));
    await f.run(); expect(f.res.status).toHaveBeenCalledWith(status); expect(JSON.stringify(f.res.json.mock.calls)).not.toContain('private');
  });
  it('requires an authenticated current principal before dispatch and sanitizes unexpected errors', async () => {
    const missing = fixture(); missing.req.loginId = ''; await missing.run(); expect(missing.page).not.toHaveBeenCalled(); expect(missing.res.status).toHaveBeenCalledWith(401);
    const f = fixture(); f.page.mockRejectedValue(new Error('private SQL row socket detail')); await f.run();
    expect(f.res.status).toHaveBeenCalledWith(503); expect(f.res.json).toHaveBeenCalledWith({ code: 'WORKFLOW_READ_UNAVAILABLE', error: 'Cable diagnostics are unavailable. Refresh the current project.' });
  });
  it('returns safe query/cursor/capacity errors without any supplied business message', async () => {
    for (const error of [new z.ZodError([]), new PathFinderError('WORKFLOW_CURSOR_INVALID', 409, 'private cursor'), new PathFinderError('WORKFLOW_ADMISSION_LIMIT', 413, 'private history')]) {
      const f = fixture(); f.page.mockRejectedValue(error); await f.run(); expect(JSON.stringify(f.res.json.mock.calls)).not.toContain('private');
    }
  });
  it('aborts disconnected reads and never sends a late response to another context', async () => {
    const f = fixture(); let finish!: (value: { observed: string }) => void;
    f.page.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    const run = f.run(); const signal = (f.page.mock.calls as unknown[][])[0][3] as AbortSignal;
    f.req.emit('aborted'); expect(signal.aborted).toBe(true); finish({ observed: 'late' }); await run; expect(f.res.json).not.toHaveBeenCalled();
    expect(f.req.listenerCount('aborted')).toBe(0); expect(f.res.listenerCount('close')).toBe(0);
  });
});
