// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Request, Response } from 'express';
const mocks = vi.hoisted(() => ({ list: vi.fn(), change: vi.fn(), transaction: vi.fn(), pool: {} }));
vi.mock('../db.js', () => ({ pool: mocks.pool }));
vi.mock('../auth.js', () => ({ verifyAccessToken: vi.fn() }));
vi.mock('../utils/transaction.js', () => ({ withTransaction: mocks.transaction }));
vi.mock('../services/projectTrayPurposeService.js', async original => ({ ...await original<typeof import('../services/projectTrayPurposeService.js')>(), listProjectTrayPurposes: mocks.list, changeProjectTrayPurpose: mocks.change }));
import { projectTrayPurposesRouter } from './projectTrayPurposesRoutes.js';
type Handler = (req: Request, res: Response, next: () => void) => Promise<void>;
const layers = projectTrayPurposesRouter.stack as unknown as Array<{ route?: { methods: Record<string, boolean>; stack: Array<{ handle: Handler }> } }>;
const stack = (method: string) => layers.find(v => v.route?.methods[method])!.route!.stack;
function response() { const res = { status: vi.fn(), json: vi.fn() }; res.status.mockReturnValue(res); return res as unknown as Response; }
beforeEach(() => {
  vi.clearAllMocks(); mocks.list.mockResolvedValue({ purposes: [{ name: 'LV', trayCount: 3 }] });
  mocks.change.mockResolvedValue({ purposes: [] }); mocks.transaction.mockImplementation(fn => fn('locked-client'));
});
describe('project tray purpose endpoints', () => {
  it('reads the project catalog without a write transaction', async () => {
    const res = response(); await stack('get')[0].handle({ params: { projectId: 'project' } } as unknown as Request, res, vi.fn());
    expect(mocks.list).toHaveBeenCalledWith(mocks.pool, 'project'); expect(mocks.transaction).not.toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith({ purposes: [{ name: 'LV', trayCount: 3 }] });
  });
  it.each(['post', 'patch', 'delete'])('protects %s with existing project editing authority', async method => {
    const res = response(), next = vi.fn();
    await stack(method)[0].handle({ canEditProject: false } as Request, res, next);
    expect(res.status).toHaveBeenCalledWith(403); expect(next).not.toHaveBeenCalled(); expect(mocks.change).not.toHaveBeenCalled();
    await stack(method)[0].handle({ canEditProject: true } as Request, response(), next); expect(next).toHaveBeenCalledOnce();
  });
  it('renames through one transaction with the authenticated actor and explicit names', async () => {
    await stack('patch').at(-1)!.handle({ params: { projectId: 'project' }, userId: 'engineer', body: { name: ' Power ', nextName: ' LV ' } } as unknown as Request, response(), vi.fn());
    expect(mocks.transaction).toHaveBeenCalledOnce();
    expect(mocks.change).toHaveBeenCalledWith('locked-client', 'project', 'engineer', { operation: 'rename', name: 'Power', nextName: 'LV' });
  });
  it('refuses invalid request fields before any mutation', async () => {
    const res = response(); await stack('post').at(-1)!.handle({ params: { projectId: 'project' }, body: { name: 'LV', projectId: 'other' } } as unknown as Request, res, vi.fn());
    expect(res.status).toHaveBeenCalledWith(400); expect(mocks.transaction).not.toHaveBeenCalled();
  });
});
