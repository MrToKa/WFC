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

  it('copies the current header revision when adding a material', async () => {
    clientQuery.mockImplementation(async (sql: string) => {
      if (sql.includes('SELECT id, revision FROM project_change_orders')) {
        return { rows: [{ id: 'document-id', revision: '07' }] };
      }
      if (sql.includes('FROM material_supports WHERE id = $1')) {
        return {
          rows: [
            {
              id: 'material-id',
              support_type: 'Support',
              manufacturer: null,
              height_mm: null,
              width_mm: null,
              length_mm: null,
              weight_kg: null,
              minimum_order_quantity: 1,
              order_measurement: 'pcs',
              packaging: 'pcs',
            },
          ],
        };
      }
      if (sql.includes('SELECT COALESCE(MAX(sort_order)')) {
        return { rows: [{ next_order: 1 }] };
      }
      if (sql.includes('INSERT INTO project_change_order_items')) {
        return {
          rows: [
            {
              id: 'item-id',
              change_order_id: 'document-id',
              sort_order: 1,
              source_catalog: 'support',
              source_material_id: 'material-id',
              design_quantity: 0,
              order_quantity: 0,
              unit: 'pcs',
              packaging: 'pcs',
              packaging_quantity: 1,
              packaging_unit: 'pcs',
              ordered_quantity: 0,
              ordered_unit: 'pcs',
              description_en: 'Support',
              unit_price: 0,
              revision_number: '07',
              created_at: '2026-09-02T00:00:00.000Z',
              updated_at: '2026-09-02T00:00:00.000Z',
            },
          ],
        };
      }
      return { rows: [] };
    });

    await expect(
      addChangeOrderItem('project-id', 'change-order', 'document-id', 'support', 'material-id'),
    ).resolves.toMatchObject({ revisionNumber: '07' });

    const insertCall = clientQuery.mock.calls.find(([sql]) =>
      String(sql).includes('INSERT INTO project_change_order_items'),
    ) as [string, unknown[]] | undefined;
    expect(insertCall).toBeDefined();
    expect(insertCall?.[0]).toContain('revision_number');
    expect(insertCall?.[1][26]).toBe('07');
  });

  it.each(['change-order', 'internal-ncr'] as const)(
    'inherits Standard Material dimensions and weight for %s documents',
    async (documentType) => {
      clientQuery.mockImplementation(async (sql: string, values?: unknown[]) => {
        if (sql.includes('SELECT id, revision FROM project_change_orders')) {
          return { rows: [{ id: 'document-id', revision: '02' }] };
        }
        if (sql.includes('FROM material_supports WHERE id = $1')) {
          return {
            rows: [
              {
                id: 'support-id',
                support_type: 'Support',
                manufacturer: null,
                height_mm: null,
                width_mm: null,
                length_mm: null,
                weight_kg: null,
                minimum_order_quantity: 1,
                order_measurement: 'pcs',
                packaging: 'pcs',
              },
            ],
          };
        }
        if (sql.includes('SELECT COALESCE(MAX(sort_order)')) {
          return { rows: [{ next_order: 1 }] };
        }
        if (sql.includes('UNION ALL')) {
          expect(sql).toContain('child.dimension_mm AS referenced_material_dimension_mm');
          expect(sql).toContain('child.weight_kg AS referenced_material_weight_kg');
          return {
            rows: [
              {
                id: '00000000-0000-4000-8000-000000000010',
                owner_id: 'support-id',
                owner_category: 'support',
                referenced_material_id: '00000000-0000-4000-8000-000000000030',
                referenced_material_category: 'cable-installation-material',
                referenced_material_name: 'Cable gland M32',
                referenced_material_purpose: null,
                referenced_material_material: 'Brass',
                referenced_material_description: 'Cable gland',
                referenced_material_dimension_mm: '32 x 45',
                referenced_material_weight_kg: '0.18',
                referenced_material_manufacturer: 'Maker',
                referenced_material_part_no: 'M32',
                referenced_material_minimum_order_quantity: '1',
                referenced_material_order_measurement: 'pcs',
                referenced_material_packaging: 'pcs',
                quantity: '2',
                unit: 'pcs',
                remarks: null,
                created_at: '2026-01-01T00:00:00.000Z',
                updated_at: '2026-01-01T00:00:00.000Z',
              },
            ],
          };
        }
        if (sql.includes('INSERT INTO project_change_order_items')) {
          const input = values ?? [];
          return {
            rows: [
              {
                id: input[0],
                change_order_id: input[1],
                sort_order: input[2],
                source_catalog: input[3],
                source_material_id: input[4],
                unit: input[5],
                description_en: input[6],
                clear_description: input[7],
                dimension_mm: input[8],
                material: input[9],
                weight_kg: input[10],
                manufacturer: input[11],
                manufacturer_part_no: input[12],
                line_kind: input[13],
                parent_item_id: input[14],
                quantity_per_parent: input[15],
                source_standard_material_assignment_ids: input[16],
                design_quantity: input[17],
                order_quantity: input[18],
                minimum_order_quantity: input[19],
                order_measurement: input[20],
                packaging: input[21],
                packaging_quantity: input[22],
                packaging_unit: input[23],
                ordered_quantity: input[24],
                ordered_unit: input[25],
                revision_number: input[26],
                unit_price: 0,
                created_at: '2026-09-02T00:00:00.000Z',
                updated_at: '2026-09-02T00:00:00.000Z',
              },
            ],
          };
        }
        return { rows: [] };
      });

      await expect(
        addChangeOrderItem('project-id', documentType, 'document-id', 'support', 'support-id'),
      ).resolves.toMatchObject({ descriptionEn: 'Support' });

      const itemInserts = clientQuery.mock.calls.filter(([sql]) =>
        String(sql).includes('INSERT INTO project_change_order_items'),
      ) as [string, unknown[]][];
      expect(itemInserts).toHaveLength(2);
      expect(itemInserts[1][1]).toMatchObject({
        3: 'cable-installation-material',
        6: 'Cable gland M32',
        8: '32 x 45',
        10: 0.18,
        13: 'inherited',
      });
      expect(
        clientQuery.mock.calls.some(
          ([sql, values]) =>
            String(sql).includes('SELECT id, revision FROM project_change_orders') &&
            (values as unknown[])?.[2] === documentType,
        ),
      ).toBe(true);
    },
  );

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
