import { beforeEach, describe, expect, it, vi } from 'vitest';

const databaseMocks = vi.hoisted(() => ({
  query: vi.fn(),
  connect: vi.fn(),
}));

vi.mock('../db.js', () => ({ pool: databaseMocks }));

import {
  addChangeOrderItem,
  createChangeOrder,
  deleteChangeOrder,
  deleteChangeOrderItem,
  duplicateChangeOrderItem,
  getChangeOrder,
  listChangeOrders,
  reorderChangeOrderItems,
  updateChangeOrder,
  updateChangeOrderItem,
} from './changeOrderService.js';

const clientQuery = vi.fn();
const release = vi.fn();

const queryCall = (mock: typeof databaseMocks.query | typeof clientQuery, index: number) =>
  mock.mock.calls[index] as unknown as [string, unknown[]];

beforeEach(() => {
  databaseMocks.query.mockReset();
  databaseMocks.connect.mockReset();
  clientQuery.mockReset();
  release.mockReset();
  databaseMocks.connect.mockResolvedValue({ query: clientQuery, release });
});

describe('Change Order document type scoping', () => {
  it('scopes list, get, update, delete, and create header operations', async () => {
    databaseMocks.query.mockResolvedValueOnce({ rows: [] });
    await listChangeOrders('project-id', 'internal-ncr');
    expect(queryCall(databaseMocks.query, 0)[0]).toContain('co.document_type = $2');
    expect(queryCall(databaseMocks.query, 0)[1]).toEqual(['project-id', 'internal-ncr']);

    databaseMocks.query.mockResolvedValueOnce({ rows: [] });
    await expect(getChangeOrder('project-id', 'internal-ncr', 'document-id')).resolves.toBeNull();
    expect(queryCall(databaseMocks.query, 1)[0]).toContain('co.document_type = $2');
    expect(queryCall(databaseMocks.query, 1)[1]).toEqual([
      'project-id',
      'internal-ncr',
      'document-id',
    ]);

    databaseMocks.query.mockResolvedValueOnce({ rowCount: 0 });
    await expect(
      updateChangeOrder('project-id', 'internal-ncr', 'document-id', { title: 'Updated' }),
    ).resolves.toBeNull();
    expect(queryCall(databaseMocks.query, 2)[0]).toContain('document_type = $4');
    expect(queryCall(databaseMocks.query, 2)[1]).toEqual([
      'Updated',
      'document-id',
      'project-id',
      'internal-ncr',
    ]);

    databaseMocks.query.mockResolvedValueOnce({ rowCount: 0 });
    await expect(
      deleteChangeOrder('project-id', 'internal-ncr', 'document-id'),
    ).resolves.toBe(false);
    expect(queryCall(databaseMocks.query, 3)[0]).toContain('document_type = $3');
    expect(queryCall(databaseMocks.query, 3)[1]).toEqual([
      'document-id',
      'project-id',
      'internal-ncr',
    ]);

    databaseMocks.query
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });
    await expect(
      createChangeOrder('project-id', 'internal-ncr', 'user-id', {
        title: 'NCR 1',
        preparedBy: 'Test User',
        reportDate: '2026-08-31',
        revision: '00',
      }),
    ).rejects.toThrow('Created Internal NCR could not be loaded');
    const [createSql, createValues] = queryCall(databaseMocks.query, 4);
    expect(createSql).toContain('id, project_id, document_type');
    expect(createValues[1]).toBe('project-id');
    expect(createValues[2]).toBe('internal-ncr');
  });

  it('rejects add-item access when the typed header ownership check fails', async () => {
    clientQuery
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({});

    await expect(
      addChangeOrderItem(
        'project-id',
        'internal-ncr',
        'document-id',
        'support',
        'material-id',
      ),
    ).resolves.toBeNull();

    expect(queryCall(clientQuery, 1)[0]).toContain('document_type = $3');
    expect(queryCall(clientQuery, 1)[1]).toEqual([
      'document-id',
      'project-id',
      'internal-ncr',
    ]);
  });

  it('rejects duplicate-item access when the item belongs to another document type', async () => {
    clientQuery
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({});

    await expect(
      duplicateChangeOrderItem('project-id', 'internal-ncr', 'document-id', 'item-id'),
    ).resolves.toBeNull();

    expect(queryCall(clientQuery, 1)[0]).toContain('change_order.document_type = $4');
    expect(queryCall(clientQuery, 1)[1]).toEqual([
      'item-id',
      'document-id',
      'project-id',
      'internal-ncr',
    ]);
  });

  it('rejects update-item access when the item belongs to another document type', async () => {
    clientQuery
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({});

    await expect(
      updateChangeOrderItem('project-id', 'internal-ncr', 'document-id', 'item-id', {
        remarks: 'Updated',
      }),
    ).resolves.toBeNull();

    expect(queryCall(clientQuery, 1)[0]).toContain('co.document_type = $5');
    expect(queryCall(clientQuery, 1)[1]).toEqual([
      'Updated',
      'item-id',
      'document-id',
      'project-id',
      'internal-ncr',
    ]);
  });

  it('rejects delete-item access when the item belongs to another document type', async () => {
    clientQuery
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({ rowCount: 0 })
      .mockResolvedValueOnce({});

    await expect(
      deleteChangeOrderItem('project-id', 'internal-ncr', 'document-id', 'item-id'),
    ).resolves.toBe(false);

    expect(queryCall(clientQuery, 1)[0]).toContain('co.document_type = $4');
    expect(queryCall(clientQuery, 1)[1]).toEqual([
      'item-id',
      'document-id',
      'project-id',
      'internal-ncr',
    ]);
  });

  it('rejects reorder access when the header belongs to another document type', async () => {
    clientQuery
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({});

    await expect(
      reorderChangeOrderItems('project-id', 'internal-ncr', 'document-id', ['item-id']),
    ).resolves.toBeNull();

    expect(queryCall(clientQuery, 1)[0]).toContain('document_type = $3');
    expect(queryCall(clientQuery, 1)[1]).toEqual([
      'document-id',
      'project-id',
      'internal-ncr',
    ]);
  });
});
