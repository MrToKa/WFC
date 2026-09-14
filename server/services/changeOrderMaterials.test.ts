// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChangeOrderItemRow, ChangeOrderRow } from '../models/changeOrder.js';
import { mapChangeOrderItemRow } from '../models/changeOrder.js';

const database = vi.hoisted(() => ({ connect: vi.fn(), query: vi.fn() }));
vi.mock('../db.js', () => ({ pool: database }));
vi.mock('./standardMaterialService.js', () => ({ expandStandardMaterials: vi.fn(async () => []) }));
vi.mock('./changeOrderCatalogService.js', () => ({
  resolveChangeOrderCatalogSnapshot: vi.fn(async () => ({
    sourceCatalog: 'support',
    sourceMaterialId: 'source',
    unit: 'pcs',
    descriptionEn: 'New support',
    unitPrice: 3,
    minimumOrderQuantity: null,
  })),
}));

import {
  applyChangeOrderMaterials,
  ChangeOrderConflictError,
  describeMaterialChanges,
  nextChangeOrderRevision,
  updateChangeOrder,
} from './changeOrderService.js';

const timestamp = '2026-09-14T10:00:00.000Z';
const originalHeader = {
  id: 'document',
  project_id: 'project',
  document_type: 'change-order',
  title: 'Order',
  project_reference: null,
  created_by: null,
  prepared_by: 'Original Author',
  report_date: '2026-09-14',
  revision: '00',
  created_at: timestamp,
  updated_at: timestamp,
  change_log: [],
} as ChangeOrderRow;
const originalItem = {
  id: 'material',
  change_order_id: 'document',
  sort_order: 1,
  source_catalog: 'support',
  source_material_id: 'source',
  design_quantity: 2,
  order_quantity: 2,
  description_en: 'Bracket',
  unit_price: 3,
  line_kind: 'manual',
  revision_number: '00',
  created_at: timestamp,
  updated_at: timestamp,
} as ChangeOrderItemRow;
let header: ChangeOrderRow;
let items: ChangeOrderItemRow[];
let inheritedUpdates: Array<Partial<ChangeOrderItemRow> & { id: string }>;
const query = vi.fn();
const release = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  header = structuredClone(originalHeader);
  items = [structuredClone(originalItem)];
  inheritedUpdates = [];
  let initialHeader: ChangeOrderRow;
  let initialItems: ChangeOrderItemRow[];
  database.connect.mockResolvedValue({ query, release });
  query.mockImplementation(async (sql: string, values: unknown[] = []) => {
    if (sql === 'BEGIN') {
      initialHeader = structuredClone(header);
      initialItems = structuredClone(items);
    } else if (sql === 'ROLLBACK') {
      header = initialHeader;
      items = initialItems;
    } else if (
      sql.includes('SELECT * FROM project_change_orders') ||
      sql.includes('SELECT id FROM project_change_orders') ||
      sql.includes('SELECT id, revision FROM project_change_orders')
    ) {
      return {
        rows:
          values[0] === 'document' && values[1] === 'project' && values[2] === header.document_type
            ? [structuredClone(header)]
            : [],
      };
    } else if (sql.includes('co.*')) {
      return { rows: [structuredClone(header)] };
    } else if (sql.includes('AS name')) {
      return { rows: [{ name: 'Latest Editor' }] };
    } else if (sql.includes('change_log = change_log ||')) {
      header.prepared_by = values[1] as string;
      header.revision = values[2] as string;
      header.change_log = [...header.change_log!, ...JSON.parse(values[3] as string)];
      header.updated_at = '2026-09-14T11:00:00.000Z';
    } else if (sql.includes('SET revision_number = $2')) {
      for (const item of items) {
        if ((values[2] as string[]).includes(item.id)) item.revision_number = values[1] as string;
      }
    } else if (sql.includes('WITH required AS')) {
      // Quantity calculation is covered separately; supply its resulting rows
      // here to exercise revision tracking of derived material changes.
      for (const update of inheritedUpdates) {
        const item = items.find((row) => row.id === update.id);
        if (item) Object.assign(item, update);
      }
    } else if (sql.includes('SET revision = $2')) {
      header.revision = values[1] as string;
    } else if (sql.includes('UPDATE project_change_order_items i')) {
      const itemId = values.at(-4);
      const item = items.find((row) => row.id === itemId);
      if (!item) return { rows: [] };
      for (const [index, assignment] of sql
        .split('SET ')[1]
        .split(', updated_at')[0]
        .split(', ')
        .entries()) {
        Object.assign(item, { [assignment.split(' = ')[0]]: values[index] });
      }
      return { rows: [structuredClone(item)] };
    } else if (sql.includes('INSERT INTO project_change_order_items')) {
      const columnList = sql
        .split('INSERT INTO project_change_order_items (')[1]
        .split(') VALUES')[0];
      const row = Object.fromEntries(
        columnList.split(',').map((column, index) => [column.trim(), values[index]]),
      ) as ChangeOrderItemRow;
      row.created_at = timestamp;
      row.updated_at = timestamp;
      items.push(row);
      return { rows: [structuredClone(row)] };
    } else if (sql.includes('AS next_order')) {
      return { rows: [{ next_order: items.length + 1 }] };
    } else if (
      sql.includes('FROM project_change_order_items item') &&
      sql.trim().startsWith('SELECT')
    ) {
      return { rows: structuredClone(items) };
    }
    return { rows: [], rowCount: 1 };
  });
});

const update = { type: 'update' as const, itemId: 'material', input: { orderQuantity: 7 } };
const input = { expectedUpdatedAt: timestamp, newRevision: false, operations: [update] };

describe('material editing transaction', () => {
  it.each(['change-order', 'internal-ncr'] as const)(
    'updates a 100m cable and only its changed inherited materials to revision 01 in %s',
    async (documentType) => {
      header.document_type = documentType;
      items[0] = {
        ...items[0],
        source_catalog: 'cable-type',
        description_en: 'Cable',
        design_quantity: 100,
        order_quantity: 100,
        unit: 'meters',
      };
      items.push(
        {
          ...originalItem,
          id: 'per-meter',
          parent_item_id: 'material',
          line_kind: 'inherited',
          description_en: 'Cable ties',
          unit: 'pcs/m',
          quantity_per_parent: 2,
          design_quantity: 200,
          order_quantity: 200,
        },
        {
          ...originalItem,
          id: 'fixed',
          parent_item_id: 'material',
          line_kind: 'inherited',
          description_en: 'Cable glands',
          unit: 'pcs',
          quantity_per_parent: 2,
        },
      );
      inheritedUpdates = [{ id: 'per-meter', design_quantity: 400, order_quantity: 400 }];
      const changes = {
        ...input,
        newRevision: true,
        operations: [{ ...update, input: { designQuantity: 200, orderQuantity: 200 } }],
      };
      const preview = await applyChangeOrderMaterials(
        'project',
        documentType,
        'document',
        'editor',
        changes,
        true,
      );
      expect(preview?.items.map((row) => [row.id, row.revisionNumber])).toEqual([
        ['material', '01'],
        ['per-meter', '01'],
        ['fixed', '00'],
      ]);
      expect(items.map((row) => row.revision_number)).toEqual(['00', '00', '00']);
      const saved = await applyChangeOrderMaterials(
        'project',
        documentType,
        'document',
        'editor',
        changes,
      );
      expect(saved?.items[0]).toMatchObject({
        designQuantity: 200,
        orderQuantity: 200,
        revisionNumber: '01',
      });
      expect(saved?.items[1]).toMatchObject({ orderQuantity: 400, revisionNumber: '01' });
      expect(saved?.items[2]).toMatchObject({ orderQuantity: 2, revisionNumber: '00' });
      const childUpdate = query.mock.calls.find(([sql]) =>
        String(sql).includes('WITH required AS'),
      )!;
      expect(childUpdate[0]).not.toContain('revision_number');
      expect(childUpdate[1][4]).toBe('document');
      expect(saved?.changeLog?.[0].changes.join(' ')).toContain('Revision Number: 00 → 01');
    },
  );

  it('revises a directly edited inherited material independently of its parent and siblings', async () => {
    header.revision = '02';
    items.push({
      ...originalItem,
      id: 'inherited',
      parent_item_id: 'material',
      line_kind: 'inherited',
    });
    const result = await applyChangeOrderMaterials(
      'project',
      'change-order',
      'document',
      'editor',
      {
        ...input,
        operations: [{ type: 'update', itemId: 'inherited', input: { unitPrice: 12 } }],
      },
    );
    expect(result?.items[0].revisionNumber).toBe('00');
    expect(result?.items[1]).toMatchObject({ unitPrice: 12, revisionNumber: '02' });
  });

  it('preserves a newer inherited revision when only its parent remarks change', async () => {
    header.revision = '01';
    items.push({
      ...originalItem,
      id: 'inherited',
      parent_item_id: 'material',
      line_kind: 'inherited',
      revision_number: '01',
    });
    const result = await applyChangeOrderMaterials(
      'project',
      'change-order',
      'document',
      'editor',
      {
        ...input,
        newRevision: true,
        operations: [{ ...update, input: { remarks: 'Checked' } }],
      },
    );
    expect(result?.items[0].revisionNumber).toBe('02');
    expect(result?.items[1].revisionNumber).toBe('01');
  });

  it.each([
    { operations: [] },
    { operations: [{ ...update, input: { orderQuantity: 2 } }] },
    { operations: [update, { ...update, input: { orderQuantity: 2 } }] },
  ])(
    'preserves material revisions when a new document revision has no net material change (%j)',
    async ({ operations }) => {
      const result = await applyChangeOrderMaterials(
        'project',
        'change-order',
        'document',
        'editor',
        {
          ...input,
          newRevision: true,
          operations,
        },
      );
      expect(result?.revision).toBe('01');
      expect(result?.items[0].revisionNumber).toBe('00');
      expect(result?.changeLog?.[0].changes).toEqual(['Revision: 00 → 01.']);
    },
  );

  it('assigns the active revision to newly added materials', async () => {
    header.revision = '05';
    const result = await applyChangeOrderMaterials(
      'project',
      'change-order',
      'document',
      'editor',
      {
        ...input,
        operations: [
          { type: 'add', id: 'addition', sourceCatalog: 'support', sourceMaterialId: 'source' },
        ],
      },
    );
    expect(result?.items[0].revisionNumber).toBe('00');
    expect(result?.items[1].revisionNumber).toBe('05');
  });

  it.each(['change-order', 'internal-ncr'] as const)(
    'previews %s changes without saving rows, revision, author, or history',
    async (documentType) => {
      header.document_type = documentType;
      const result = await applyChangeOrderMaterials(
        'project',
        documentType,
        'document',
        'editor',
        { ...input, newRevision: true },
        true,
      );
      expect(result?.items[0].orderQuantity).toBe(7);
      expect(result?.revision).toBe('01');
      expect(result?.items[0].revisionNumber).toBe('01');
      expect(result?.updatedAt).toBe(timestamp);
      expect(items[0].order_quantity).toBe(2);
      expect(items[0].revision_number).toBe('00');
      expect(header.revision).toBe('00');
      expect(header.prepared_by).toBe('Original Author');
      expect(header.change_log).toEqual([]);
      expect(query).not.toHaveBeenCalledWith('COMMIT');
      expect(release).toHaveBeenCalledOnce();
    },
  );

  it.each([false, true])(
    'saves all changes with the authenticated author and optional revision (%s)',
    async (newRevision) => {
      const result = await applyChangeOrderMaterials(
        'project',
        'change-order',
        'document',
        'editor',
        { ...input, newRevision },
      );
      expect(result?.items[0].orderQuantity).toBe(7);
      expect(result?.revision).toBe(newRevision ? '01' : '00');
      expect(result?.items[0].revisionNumber).toBe(newRevision ? '01' : '00');
      expect(result?.preparedBy).toBe('Latest Editor');
      expect(header.change_log).toHaveLength(1);
      expect(header.change_log?.[0]).toMatchObject({
        userId: 'editor',
        userName: 'Latest Editor',
        revision: newRevision ? '01' : '00',
      });
      expect(header.change_log?.[0].changedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
      expect(header.change_log?.[0].changes.join(' ')).toContain('Order Quantity: 2 → 7');
      expect(query).toHaveBeenCalledWith('COMMIT');
      expect(query).not.toHaveBeenCalledWith('ROLLBACK');
    },
  );

  it('keeps added material IDs stable across previews and saving, including subsequent edits', async () => {
    const addition = {
      type: 'add' as const,
      id: 'draft-operation',
      sourceCatalog: 'support' as const,
      sourceMaterialId: 'source',
    };
    const draft = { ...input, operations: [addition] };
    const first = await applyChangeOrderMaterials(
      'project',
      'change-order',
      'document',
      'editor',
      draft,
      true,
    );
    const itemId = first!.items[1].id;
    const edited = { ...input, operations: [addition, { ...update, itemId }] };
    const second = await applyChangeOrderMaterials(
      'project',
      'change-order',
      'document',
      'editor',
      edited,
      true,
    );
    const saved = await applyChangeOrderMaterials(
      'project',
      'change-order',
      'document',
      'editor',
      edited,
    );
    expect(second?.items[1].id).toBe(itemId);
    expect(saved?.items[1]).toMatchObject({ id: itemId, orderQuantity: 7 });
    expect(items).toHaveLength(2);
  });

  it('rolls back the entire save if a later operation fails', async () => {
    await expect(
      applyChangeOrderMaterials('project', 'change-order', 'document', 'editor', {
        ...input,
        newRevision: true,
        operations: [update, { ...update, itemId: 'missing' }],
      }),
    ).rejects.toThrow('A material could not be changed');
    expect(items[0].order_quantity).toBe(2);
    expect(header.revision).toBe('00');
    expect(header.change_log).toEqual([]);
    expect(query).not.toHaveBeenCalledWith('COMMIT');
  });

  it('rejects stale drafts before any material mutation', async () => {
    header.updated_at = '2026-09-14T12:00:00.000Z';
    await expect(
      applyChangeOrderMaterials('project', 'change-order', 'document', 'editor', input),
    ).rejects.toBeInstanceOf(ChangeOrderConflictError);
    expect(items[0].order_quantity).toBe(2);
    expect(query).not.toHaveBeenCalledWith('COMMIT');
  });

  it('does not change the last editor or log when a save has no actual changes', async () => {
    await applyChangeOrderMaterials('project', 'change-order', 'document', 'editor', {
      ...input,
      operations: [],
    });
    expect(header).toEqual(originalHeader);
    expect(query).not.toHaveBeenCalledWith('COMMIT');
  });

  it('ignores manually supplied Prepared by and Revision header changes', async () => {
    const result = await updateChangeOrder(
      'project',
      'change-order',
      'document',
      { preparedBy: 'Forged author', revision: '99' },
      'editor',
    );
    expect(result?.preparedBy).toBe('Original Author');
    expect(result?.revision).toBe('00');
    expect(header.change_log).toEqual([]);
  });

  it('does not edit a document from another collection', async () => {
    expect(
      await applyChangeOrderMaterials('project', 'internal-ncr', 'document', 'editor', input),
    ).toBeNull();
    expect(header).toEqual(originalHeader);
  });
});

describe('revision numbers and readable material history', () => {
  it.each([
    ['00', '01'],
    ['09', '10'],
    ['99', '100'],
  ])('increments %s to %s', (before, after) => {
    expect(nextChangeOrderRevision(before)).toBe(after);
  });
  it('describes additions, removals, and reordering without recording timestamp noise', () => {
    const item = mapChangeOrderItemRow(originalItem);
    const changes = describeMaterialChanges(
      [item, { ...item, id: 'removed', descriptionEn: 'Old bracket' }],
      [
        { ...item, sortOrder: 2, updatedAt: 'later' },
        { ...item, id: 'new', descriptionEn: 'New bracket' },
      ],
    ).join(' ');
    expect(changes).toContain('Removed material "Old bracket"');
    expect(changes).toContain('Added material "New bracket"');
    expect(changes).toContain('Sort Order: 1 → 2');
    expect(changes).not.toContain('Updated At');
  });
});
