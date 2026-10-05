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
import { ChangeOrderConflictError, getChangeOrder } from '../services/changeOrderService.js';
import {
  generateChangeOrderWorkbook,
  sanitizeChangeOrderFileName,
} from '../services/changeOrderExcelExportService.js';

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

describe('document revision read and export routes', () => {
  it.each(['change-order', 'internal-ncr'] as const)(
    'compares the selected %s export with its immediately preceding saved revision',
    async (documentType) => {
      const selected = {
        id: changeOrderId,
        revision: '01',
        latestRevision: '03',
        revisions: ['03', '02', '01', '00'],
        title: 'Selected title',
      };
      const previous = { ...selected, revision: '00' };
      vi.mocked(getChangeOrder)
        .mockResolvedValueOnce(selected as never)
        .mockResolvedValueOnce(previous as never);
      vi.mocked(generateChangeOrderWorkbook).mockResolvedValue(Buffer.from('highlighted-workbook'));
      vi.mocked(sanitizeChangeOrderFileName).mockReturnValue('Selected title.xlsx');
      const router = createChangeOrdersRouter(documentType) as unknown as { stack: Layer[] };
      const handler = router.stack.find((layer) => layer.route?.path === '/:changeOrderId/export')!
        .route!.stack[0].handle;
      const req = {
        params: { projectId, changeOrderId },
        query: { revision: '01' },
      } as unknown as Request;
      const res = { status: vi.fn(), json: vi.fn(), setHeader: vi.fn(), send: vi.fn() };
      res.status.mockReturnValue(res);
      await handler(req, res as unknown as Response);
      expect(getChangeOrder).toHaveBeenNthCalledWith(
        1,
        projectId,
        documentType,
        changeOrderId,
        undefined,
        '01',
      );
      expect(getChangeOrder).toHaveBeenNthCalledWith(
        2,
        projectId,
        documentType,
        changeOrderId,
        undefined,
        '00',
      );
      expect(generateChangeOrderWorkbook).toHaveBeenCalledWith(
        selected,
        undefined,
        documentType,
        previous,
      );
      expect(res.send).toHaveBeenCalledWith(Buffer.from('highlighted-workbook'));
    },
  );

  it.each(['change-order', 'internal-ncr'] as const)(
    'loads and exports the requested frozen revision for %s',
    async (documentType) => {
      const frozen = {
        id: changeOrderId,
        revision: '00',
        latestRevision: '02',
        title: 'Original title',
      };
      vi.mocked(getChangeOrder).mockResolvedValue(frozen as never);
      vi.mocked(generateChangeOrderWorkbook).mockResolvedValue(Buffer.from('frozen-workbook'));
      vi.mocked(sanitizeChangeOrderFileName).mockReturnValue('Original title.xlsx');
      const router = createChangeOrdersRouter(documentType) as unknown as { stack: Layer[] };
      const req = {
        params: { projectId, changeOrderId },
        query: { revision: '00' },
      } as unknown as Request;
      const res = { status: vi.fn(), json: vi.fn(), setHeader: vi.fn(), send: vi.fn() };
      res.status.mockReturnValue(res);
      for (const path of ['/:changeOrderId', '/:changeOrderId/export']) {
        const handler = router.stack.find((layer) => layer.route?.path === path)!.route!.stack[0]
          .handle;
        await handler(req, res as unknown as Response);
        expect(getChangeOrder).toHaveBeenLastCalledWith(
          projectId,
          documentType,
          changeOrderId,
          undefined,
          '00',
        );
      }
      expect(res.json).toHaveBeenCalledWith({ changeOrder: frozen });
      expect(generateChangeOrderWorkbook).toHaveBeenCalledWith(frozen, undefined, documentType);
      expect(res.send).toHaveBeenCalledWith(Buffer.from('frozen-workbook'));
    },
  );

  it.each(['/:changeOrderId', '/:changeOrderId/export'])(
    'returns 404 for an unavailable revision and 400 for invalid revision queries at %s',
    async (path) => {
      const router = createChangeOrdersRouter('change-order') as unknown as { stack: Layer[] };
      const handler = router.stack.find((layer) => layer.route?.path === path)!.route!.stack[0]
        .handle;
      const req = {
        params: { projectId, changeOrderId },
        query: { revision: '99' },
      } as unknown as Request;
      const res = { status: vi.fn(), json: vi.fn() };
      res.status.mockReturnValue(res);
      vi.mocked(getChangeOrder).mockResolvedValueOnce(null);
      await handler(req, res as unknown as Response);
      expect(res.status).toHaveBeenLastCalledWith(404);
      expect(generateChangeOrderWorkbook).not.toHaveBeenCalled();

      vi.mocked(getChangeOrder).mockClear();
      for (const revision of ['', ['00', '01'], { key: '00' }, 'x'.repeat(51)]) {
        req.query = { revision } as never;
        await handler(req, res as unknown as Response);
        expect(res.status).toHaveBeenLastCalledWith(400);
      }
      expect(getChangeOrder).not.toHaveBeenCalled();
    },
  );
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
