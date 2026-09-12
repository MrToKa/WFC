// @vitest-environment node
import path from 'node:path';
import ExcelJS from 'exceljs';
import type { PoolClient } from 'pg';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../db.js', () => ({ pool: { query: vi.fn(), connect: vi.fn() } }));
import { addChangeOrderItem, getChangeOrder, updateChangeOrderItem } from './changeOrderService.js';
import { generateChangeOrderWorkbook } from './changeOrderExcelExportService.js';
import type { ChangeOrderDocumentType, ChangeOrderItemRow } from '../models/changeOrder.js';

const timestamp = '2026-09-12T12:00:00.000Z';
const templatePath = path.resolve(
  'Template files',
  'Change order - Change order - Trafo interface and Sampling pumps cables.xlsx',
);

// A strict in-memory query adapter exercises the public service flow. Any
// unexpected query (especially catalog writes/refreshes) fails the test.
const fixture = (documentType: ChangeOrderDocumentType) => {
  const catalog = {
    id: 'shared-material',
    support_type: 'Captured support',
    manufacturer: 'Original maker',
    height_mm: 20,
    width_mm: 30,
    length_mm: 40,
    weight_kg: 0.4,
    unit_price: 10,
    minimum_order_quantity: 5,
    order_measurement: 'pcs',
    packaging: 'Box',
  };
  const items = new Map<string, ChangeOrderItemRow>();
  const query = vi.fn(async (sql: string, parameters: unknown[] = []) => {
    const statement = sql.trim();
    if (statement.includes('SELECT id, revision FROM project_change_orders')) {
      return { rows: [{ id: parameters[0], revision: '01' }] };
    }
    if (statement.includes('FROM material_supports WHERE id = $1')) {
      return { rows: [{ ...catalog }] };
    }
    if (statement.includes('UNION ALL')) return { rows: [] }; // No standard composition in this fixture.
    if (statement.startsWith('SELECT COALESCE(MAX(sort_order)'))
      return { rows: [{ next_order: 1 }] };
    if (statement.startsWith('INSERT INTO project_change_order_items')) {
      const columns = /INSERT INTO project_change_order_items\s*\(([^)]+)\)/
        .exec(sql)?.[1]
        .split(',')
        .map((value) => value.trim());
      if (!columns) throw new Error('Missing snapshot columns');
      const row = {
        created_at: timestamp,
        updated_at: timestamp,
        ...Object.fromEntries(columns.map((column, index) => [column, parameters[index]])),
      } as ChangeOrderItemRow;
      items.set(row.id, row);
      return { rows: [{ ...row }] };
    }
    if (statement.startsWith('UPDATE project_change_order_items i')) {
      const row = items.get(String(parameters.at(-4)));
      if (!row || row.change_order_id !== parameters.at(-3)) return { rows: [] };
      const assignments = /SET ([\s\S]+?), updated_at = NOW\(\)/.exec(sql)?.[1];
      for (const match of assignments?.matchAll(/(\w+) = \$(\d+)/g) ?? []) {
        (row as unknown as Record<string, unknown>)[match[1]] = parameters[Number(match[2]) - 1];
      }
      return { rows: [{ ...row }] };
    }
    if (
      statement.startsWith('UPDATE project_change_order_items') &&
      statement.includes('ordered_quantity = $3')
    ) {
      const row = items.get(String(parameters[0]));
      if (!row || row.change_order_id !== parameters[3]) return { rows: [] };
      row.order_quantity = parameters[1] as number;
      row.ordered_quantity = parameters[2] as number;
      return { rows: [{ ...row }] };
    }
    if (statement.startsWith('WITH required AS')) return { rows: [] };
    if (statement.startsWith('UPDATE project_change_orders')) return { rows: [] };
    if (statement.startsWith('SELECT') && statement.includes('items_snapshot')) {
      const rows = [...items.values()].filter((row) => row.change_order_id === parameters[2]);
      return {
        rows: [
          {
            id: parameters[2],
            project_id: parameters[0],
            document_type: documentType,
            title: String(parameters[2]),
            project_reference: 'P-1',
            prepared_by: 'Engineer',
            report_date: '2026-09-12',
            revision: '01',
            created_by: null,
            created_at: timestamp,
            updated_at: timestamp,
            project_name: 'Project',
            project_customer: 'Customer',
            item_count: rows.length,
            items_snapshot: rows.map((row) => ({ ...row })),
            mutation_revision: 4,
          },
        ],
      };
    }
    throw new Error(`Unexpected query: ${statement.slice(0, 100)}`);
  });
  return { catalog, items, query, client: { query } as unknown as PoolClient };
};

describe('Change Order snapshot isolation', () => {
  it.each(['change-order', 'internal-ncr'] as const)(
    '%s keeps two independent captures and local edits through catalog changes, reads, recalculation and workbook export',
    async (documentType) => {
      const { client, query, catalog, items } = fixture(documentType);
      const first = await addChangeOrderItem(
        'project',
        documentType,
        'order-A',
        'support',
        catalog.id,
        client,
      );
      const second = await addChangeOrderItem(
        'project',
        documentType,
        'order-B',
        'support',
        catalog.id,
        client,
      );
      expect(first?.unitPrice).toBe(10);
      expect(second?.unitPrice).toBe(10);
      await updateChangeOrderItem(
        'project',
        documentType,
        'order-A',
        first!.id,
        {
          unitPrice: 12,
          manufacturer: 'Local A',
          packaging: 'Local box',
          packagingQuantity: 4,
          packagingUnit: 'local pcs',
          orderedUnit: 'local boxes',
          designQuantity: 8,
          orderQuantity: 8,
        },
        client,
      );
      await updateChangeOrderItem(
        'project',
        documentType,
        'order-B',
        second!.id,
        {
          unitPrice: 23,
          manufacturer: 'Local B',
          designQuantity: 10,
          orderQuantity: 10,
        },
        client,
      );
      expect(catalog.unit_price).toBe(10);
      expect(catalog.manufacturer).toBe('Original maker');
      Object.assign(catalog, {
        unit_price: 999,
        manufacturer: 'Changed catalog',
        minimum_order_quantity: 100,
        packaging: 'Drum',
        order_measurement: 'meters',
      });

      // Recalculation must use locally edited package size 4, not origin 5 or current catalog 100.
      const updated = await updateChangeOrderItem(
        'project',
        documentType,
        'order-A',
        first!.id,
        {
          orderQuantity: 12,
        },
        client,
      );
      expect(updated).toMatchObject({
        unitPrice: 12,
        orderedQuantity: 3,
        packagingQuantity: 4,
        packaging: 'Local box',
        packagingUnit: 'local pcs',
        orderedUnit: 'local boxes',
      });
      const beforeRead = structuredClone([...items.values()]);
      query.mockClear();
      for (const [id, price, maker, packageSize] of [
        ['order-A', 12, 'Local A', 4],
        ['order-B', 23, 'Local B', 5],
      ] as const) {
        const details = await getChangeOrder('project', documentType, id, client);
        const reopened = await getChangeOrder('project', documentType, id, client);
        expect(reopened).toEqual(details);
        expect(details).toMatchObject({
          mutationRevision: 4,
          items: [
            { unitPrice: price, manufacturer: maker, packagingQuantity: packageSize, unit: 'pcs' },
          ],
        });
        const buffer = await generateChangeOrderWorkbook(details!, templatePath, documentType);
        const workbook = new ExcelJS.Workbook();
        await workbook.xlsx.load(Uint8Array.from(buffer).buffer);
        const sheet = workbook.worksheets[0];
        expect(sheet.getCell('P6').value).toBe(price);
        expect(sheet.getCell('G6').value).toBe(packageSize);
        expect(sheet.getCell('W6').value).toBe(maker);
      }
      expect([...items.values()]).toEqual(beforeRead);
      expect(query).toHaveBeenCalledTimes(4);
      expect(query.mock.calls.every(([sql]) => sql.trim().startsWith('SELECT'))).toBe(true);
      expect(query.mock.calls.every(([sql]) => !/FROM material_(?:supports|cable)/.test(sql))).toBe(
        true,
      );
      expect(catalog.unit_price).toBe(999);
      expect(catalog.manufacturer).toBe('Changed catalog');
    },
  );

  it('does not recalculate or replace local ordering fields during an unrelated price edit', async () => {
    const { client, query, catalog } = fixture('change-order');
    const item = await addChangeOrderItem(
      'project',
      'change-order',
      'order-A',
      'support',
      catalog.id,
      client,
    );
    await updateChangeOrderItem(
      'project',
      'change-order',
      'order-A',
      item!.id,
      {
        packagingQuantity: 7,
        packagingUnit: 'custom pieces',
        orderedQuantity: 9,
        orderedUnit: 'custom packs',
      },
      client,
    );
    query.mockClear();
    const updated = await updateChangeOrderItem(
      'project',
      'change-order',
      'order-A',
      item!.id,
      { unitPrice: 15 },
      client,
    );
    expect(updated).toMatchObject({
      unitPrice: 15,
      packagingQuantity: 7,
      packagingUnit: 'custom pieces',
      orderedQuantity: 9,
      orderedUnit: 'custom packs',
    });
    expect(query.mock.calls.some(([sql]) => sql.includes('WITH required AS'))).toBe(false);
    expect(query.mock.calls.some(([sql]) => sql.includes('ordered_quantity = $3'))).toBe(false);
  });
});
