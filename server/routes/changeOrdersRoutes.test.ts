// @vitest-environment node
import type { Request, Response } from 'express';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const applyMaterials = vi.hoisted(() => vi.fn());
vi.mock('../middleware.js', () => ({ authenticate: vi.fn() }));
vi.mock('../services/projectService.js', () => ({ ensureProjectExists: vi.fn() }));
vi.mock('../services/changeOrderExcelExportService.js', () => ({
  ChangeOrderTemplateError: class extends Error {},
  EmptyChangeOrderError: class extends Error {},
  generateChangeOrderWorkbook: vi.fn(),
  sanitizeChangeOrderFileName: vi.fn(),
}));
vi.mock('../services/changeOrderCatalogService.js', () => ({
  CatalogMaterialNotFoundError: class extends Error {},
}));
vi.mock('../services/changeOrderService.js', () => ({
  applyChangeOrderMaterials: applyMaterials,
  ChangeOrderConflictError: class extends Error {},
  InvalidChangeOrderMaterialError: class extends Error {},
  InvalidChangeOrderOrderError: class extends Error {},
  createChangeOrder: vi.fn(),
  deleteChangeOrder: vi.fn(),
  getChangeOrder: vi.fn(),
  listChangeOrders: vi.fn(),
  updateChangeOrder: vi.fn(),
}));
import { createChangeOrdersRouter } from './changeOrdersRoutes.js';
import { ChangeOrderConflictError } from '../services/changeOrderService.js';

const projectId = '11111111-1111-4111-8111-111111111111';
const changeOrderId = '22222222-2222-4222-8222-222222222222';
const userId = '33333333-3333-4333-8333-333333333333';
const body = { expectedUpdatedAt: '2026-09-14T12:00:00.000Z', newRevision: true, operations: [] };
type Layer = {
  route?: { path: string; stack: { handle: (req: Request, res: Response) => Promise<void> }[] };
};

beforeEach(() => {
  vi.clearAllMocks();
  applyMaterials.mockResolvedValue({ id: changeOrderId });
});

describe('materials save routes', () => {
  it.each(['change-order', 'internal-ncr'] as const)(
    'validates and passes the authenticated actor to %s preview and save',
    async (documentType) => {
      const router = createChangeOrdersRouter(documentType) as unknown as { stack: Layer[] };
      for (const preview of [true, false]) {
        const path = preview ? '/:changeOrderId/materials/preview' : '/:changeOrderId/materials';
        const handler = router.stack.find((layer) => layer.route?.path === path)!.route!.stack[0]
          .handle;
        const req = { params: { projectId, changeOrderId }, userId, body } as unknown as Request;
        const res = { status: vi.fn(), json: vi.fn() };
        res.status.mockReturnValue(res);
        await handler(req, res as unknown as Response);
        expect(applyMaterials).toHaveBeenLastCalledWith(
          projectId,
          documentType,
          changeOrderId,
          userId,
          body,
          preview,
        );
        expect(res.json).toHaveBeenCalledWith({ changeOrder: { id: changeOrderId } });

        applyMaterials.mockClear();
        req.body = {
          ...body,
          operations: [{ type: 'update', itemId: changeOrderId, input: { orderQuantity: -1 } }],
        };
        await handler(req, res as unknown as Response);
        expect(res.status).toHaveBeenLastCalledWith(400);
        expect(applyMaterials).not.toHaveBeenCalled();
      }
    },
  );

  it('returns 409 for a stale draft and 404 for a missing document', async () => {
    const router = createChangeOrdersRouter('change-order') as unknown as { stack: Layer[] };
    const handler = router.stack.find((layer) => layer.route?.path === '/:changeOrderId/materials')!
      .route!.stack[0].handle;
    const req = { params: { projectId, changeOrderId }, userId, body } as unknown as Request;
    const res = { status: vi.fn(), json: vi.fn() };
    res.status.mockReturnValue(res);
    applyMaterials.mockRejectedValueOnce(new ChangeOrderConflictError('Reload the latest changes'));
    await handler(req, res as unknown as Response);
    expect(res.status).toHaveBeenLastCalledWith(409);
    expect(res.json).toHaveBeenLastCalledWith({ error: 'Reload the latest changes' });
    applyMaterials.mockResolvedValueOnce(null);
    await handler(req, res as unknown as Response);
    expect(res.status).toHaveBeenLastCalledWith(404);
  });
});
