// @vitest-environment node
import type { PoolClient } from 'pg';
import type { Request, Response } from 'express';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  createChangeOrder: vi.fn(),
  updateChangeOrder: vi.fn(),
  deleteChangeOrder: vi.fn(),
  addChangeOrderItem: vi.fn(),
  updateChangeOrderItem: vi.fn(),
  duplicateChangeOrderItem: vi.fn(),
  deleteChangeOrderItem: vi.fn(),
  reorderChangeOrderItems: vi.fn(),
  getChangeOrder: vi.fn(),
  withVersionedMutation: vi.fn(),
}));
vi.mock('../db.js', () => ({ pool: { query: vi.fn(), connect: vi.fn() } }));
vi.mock('../services/changeOrderService.js', async (original) => ({
  ...(await original<typeof import('../services/changeOrderService.js')>()),
  ...Object.fromEntries(Object.entries(mocks).filter(([name]) => name !== 'withVersionedMutation')),
}));
vi.mock('../services/mutationService.js', async (original) => ({
  ...(await original<typeof import('../services/mutationService.js')>()),
  withVersionedMutation: mocks.withVersionedMutation,
}));

import { createChangeOrdersRouter } from './changeOrdersRoutes.js';
import { MutationError } from '../services/mutationService.js';

const projectId = '10000000-0000-4000-8000-000000000001';
const changeOrderId = '20000000-0000-4000-8000-000000000002';
const itemId = '30000000-0000-4000-8000-000000000003';
const actorId = '40000000-0000-4000-8000-000000000004';
const details = {
  id: changeOrderId,
  projectId,
  mutationRevision: 2,
  title: 'Captured order',
  items: [{ id: itemId, unitPrice: 17, manufacturer: 'Local maker' }],
};
const client = { query: vi.fn() } as unknown as PoolClient;
const snapshots: unknown[] = [];

beforeEach(() => {
  vi.clearAllMocks();
  snapshots.length = 0;
  mocks.getChangeOrder.mockImplementation(async () => structuredClone(details));
  mocks.createChangeOrder.mockResolvedValue(details);
  mocks.updateChangeOrder.mockResolvedValue(details);
  mocks.deleteChangeOrder.mockResolvedValue(true);
  mocks.addChangeOrderItem.mockResolvedValue(details.items[0]);
  mocks.updateChangeOrderItem.mockResolvedValue(details.items[0]);
  mocks.duplicateChangeOrderItem.mockResolvedValue(details.items[0]);
  mocks.deleteChangeOrderItem.mockResolvedValue(true);
  mocks.reorderChangeOrderItems.mockResolvedValue(details.items);
  mocks.withVersionedMutation.mockImplementation(async (parameters, action, snapshot) => {
    const value = await action(client);
    snapshots.push(await snapshot(client, value));
    return { value, revision: parameters.expectedRevision + 1, replayed: false };
  });
});

type Handler = (request: Request, response: Response) => Promise<void>;
const invoke = async (
  documentType: 'change-order' | 'internal-ncr',
  method: string,
  path: string,
  body: unknown,
  headers: Record<string, string> = { 'If-Match': '"2"', 'Idempotency-Key': 'operation-1' },
) => {
  const router = createChangeOrdersRouter(documentType);
  const layers = (
    router as unknown as {
      stack: Array<{
        route?: {
          path: string;
          methods: Record<string, boolean>;
          stack: Array<{ handle: Handler }>;
        };
      }>;
    }
  ).stack;
  const handler = layers
    .find((layer) => layer.route?.path === path && layer.route.methods[method])
    ?.route?.stack.at(-1)?.handle;
  if (!handler) throw new Error('Missing route handler');
  const req = {
    params: {
      projectId,
      ...(path.includes(':changeOrderId') ? { changeOrderId } : {}),
      ...(path.includes(':itemId') ? { itemId } : {}),
    },
    body,
    userId: actorId,
    header: (name: string) => headers[name],
  } as unknown as Request;
  const res = { status: vi.fn(), json: vi.fn(), send: vi.fn() };
  res.status.mockReturnValue(res);
  await handler(req, res as unknown as Response);
  return res;
};

const cases = [
  {
    method: 'post',
    path: '/',
    operation: 'create',
    fn: 'createChangeOrder',
    body: { title: 'Order', preparedBy: 'Reviewer', reportDate: '2026-09-12', revision: '01' },
  },
  {
    method: 'patch',
    path: '/:changeOrderId',
    operation: 'update',
    fn: 'updateChangeOrder',
    body: { title: 'Changed' },
  },
  {
    method: 'delete',
    path: '/:changeOrderId',
    operation: 'delete',
    fn: 'deleteChangeOrder',
    body: undefined,
  },
  {
    method: 'post',
    path: '/:changeOrderId/items',
    operation: 'add-item',
    fn: 'addChangeOrderItem',
    body: { sourceCatalog: 'support', sourceMaterialId: itemId },
  },
  {
    method: 'patch',
    path: '/:changeOrderId/items/:itemId',
    operation: 'update-item',
    fn: 'updateChangeOrderItem',
    body: { unitPrice: 17 },
  },
  {
    method: 'post',
    path: '/:changeOrderId/items/:itemId/duplicate',
    operation: 'duplicate-item',
    fn: 'duplicateChangeOrderItem',
    body: undefined,
  },
  {
    method: 'delete',
    path: '/:changeOrderId/items/:itemId',
    operation: 'delete-item',
    fn: 'deleteChangeOrderItem',
    body: undefined,
  },
  {
    method: 'put',
    path: '/:changeOrderId/items/order',
    operation: 'reorder-items',
    fn: 'reorderChangeOrderItems',
    body: { orderedItemIds: [itemId] },
  },
] as const;

describe.each(['change-order', 'internal-ncr'] as const)(
  '%s mutation boundaries',
  (documentType) => {
    it.each(cases)(
      '$operation joins revision, receipt, mutation and full history on one client',
      async (entry) => {
        const res = await invoke(documentType, entry.method, entry.path, entry.body);
        expect(mocks.withVersionedMutation).toHaveBeenCalledWith(
          expect.objectContaining({
            actorId,
            expectedRevision: 2,
            idempotencyKey: 'operation-1',
            resourceType: entry.operation === 'create' ? 'change-order-collection' : 'change-order',
            resourceId: entry.operation === 'create' ? projectId : changeOrderId,
            request: expect.objectContaining({
              operation: entry.operation,
              documentType,
              projectId,
            }),
          }),
          expect.any(Function),
          expect.any(Function),
          entry.operation === 'create' ? undefined : expect.any(Function),
        );
        expect(mocks[entry.fn]).toHaveBeenCalledOnce();
        expect(mocks[entry.fn].mock.calls[0].at(-1)).toBe(client);
        if (entry.operation === 'delete') {
          expect(snapshots[0]).toEqual({ deleted: true, previous: details });
          expect(res.status).toHaveBeenCalledWith(204);
        } else {
          expect(snapshots[0]).toMatchObject({
            id: changeOrderId,
            mutationRevision: entry.operation === 'create' ? 0 : 3,
            items: [{ unitPrice: 17, manufacturer: 'Local maker' }],
          });
        }
      },
    );

    it('rejects a request missing the edited revision before entering any mutation', async () => {
      const res = await invoke(
        documentType,
        'patch',
        '/:changeOrderId/items/:itemId',
        { unitPrice: 9 },
        {},
      );
      expect(res.status).toHaveBeenCalledWith(428);
      expect(mocks.withVersionedMutation).not.toHaveBeenCalled();
      expect(mocks.updateChangeOrderItem).not.toHaveBeenCalled();
    });

    it('returns a stale revision conflict without editing the item', async () => {
      mocks.withVersionedMutation.mockRejectedValueOnce(
        new MutationError(409, 'REVISION_CONFLICT', 'Reload before saving'),
      );
      const res = await invoke(documentType, 'patch', '/:changeOrderId/items/:itemId', {
        unitPrice: 9,
      });
      expect(res.status).toHaveBeenCalledWith(409);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ code: 'REVISION_CONFLICT' }));
      expect(mocks.updateChangeOrderItem).not.toHaveBeenCalled();
    });

    it('replays the stored response without reading or mutating the current document', async () => {
      mocks.withVersionedMutation.mockResolvedValueOnce({
        value: { body: { item: details.items[0], mutationRevision: 3 }, snapshot: details },
        revision: 3,
        replayed: true,
      });
      const res = await invoke(documentType, 'patch', '/:changeOrderId/items/:itemId', {
        unitPrice: 17,
      });
      expect(res.json).toHaveBeenCalledWith({ item: details.items[0], mutationRevision: 3 });
      expect(mocks.updateChangeOrderItem).not.toHaveBeenCalled();
      expect(mocks.getChangeOrder).not.toHaveBeenCalled();
    });

    it('throws not found within the transaction instead of committing a success receipt', async () => {
      mocks.updateChangeOrderItem.mockResolvedValueOnce(null);
      const res = await invoke(documentType, 'patch', '/:changeOrderId/items/:itemId', {
        unitPrice: 9,
      });
      expect(res.status).toHaveBeenCalledWith(404);
      expect(snapshots).toEqual([]);
    });
  },
);
