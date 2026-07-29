import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import { pool } from '../db.js';
import {
  calculateChangeOrderTotal,
  mapChangeOrderItemRow,
  mapChangeOrderSummaryRow,
  type ChangeOrderDetails,
  type ChangeOrderItem,
  type ChangeOrderItemRow,
  type ChangeOrderRow,
  type ChangeOrderSourceCatalog,
  type ChangeOrderSummary,
} from '../models/changeOrder.js';
import {
  resolveChangeOrderCatalogSnapshot,
  type ChangeOrderItemSnapshot,
} from './changeOrderCatalogService.js';
import { expandStandardMaterials } from './standardMaterialService.js';

export type ChangeOrderHeaderInput = {
  title: string;
  projectReference?: string | null;
  preparedBy: string;
  reportDate: string;
  revision: string;
};

export type ChangeOrderHeaderUpdate = Partial<ChangeOrderHeaderInput>;

export type ChangeOrderItemUpdate = {
  designQuantity?: number;
  orderQuantity?: number;
  unit?: string | null;
  packaging?: string | null;
  packagingQuantity?: number | null;
  packagingUnit?: string | null;
  orderedQuantity?: number | null;
  orderedUnit?: string | null;
  sapNumber?: string | null;
  descriptionEn?: string;
  descriptionDe?: string | null;
  dimensionMm?: string | null;
  material?: string | null;
  weightKg?: number | null;
  clearDescription?: string | null;
  unitPrice?: number;
  countryOfOrigin?: string | null;
  hsCode?: string | null;
  tagNo?: string | null;
  drawingNo?: string | null;
  shippingList?: string | null;
  revisionNumber?: string | null;
  clientBarcode?: string | null;
  manufacturer?: string | null;
  manufacturerPartNo?: string | null;
  acsBarcode?: string | null;
  remarks?: string | null;
};

export const calculateInheritedChangeOrderQuantities = (
  designQuantity: number,
  orderQuantity: number,
  quantityPerParent: number,
): { designQuantity: number; orderQuantity: number } => ({
  designQuantity: designQuantity * quantityPerParent,
  orderQuantity: orderQuantity * quantityPerParent,
});

const ITEM_COLUMNS = `
  id, change_order_id, sort_order, source_catalog, source_material_id,
  design_quantity, order_quantity, unit, packaging, packaging_quantity,
  packaging_unit, ordered_quantity, ordered_unit, sap_number, description_en,
  description_de, dimension_mm, material, weight_kg, clear_description, unit_price,
  country_of_origin, hs_code, tag_no, drawing_no, shipping_list, revision_number,
  client_barcode, manufacturer, manufacturer_part_no, acs_barcode, remarks,
  line_kind, parent_item_id, quantity_per_parent, source_standard_material_assignment_ids,
  created_at, updated_at
`;

const normalizeText = (value: string | null | undefined): string | null => {
  if (value === null || value === undefined) return null;
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
};

export const listChangeOrders = async (projectId: string): Promise<ChangeOrderSummary[]> => {
  const result = await pool.query<ChangeOrderRow>(
    `
      SELECT
        co.*,
        COUNT(i.id)::int AS item_count,
        COALESCE(SUM(i.order_quantity * i.unit_price), 0) AS total_price
      FROM project_change_orders co
      LEFT JOIN project_change_order_items i ON i.change_order_id = co.id
      WHERE co.project_id = $1
      GROUP BY co.id
      ORDER BY co.updated_at DESC, co.created_at DESC
    `,
    [projectId],
  );
  return result.rows.map(mapChangeOrderSummaryRow);
};

export const getChangeOrder = async (
  projectId: string,
  changeOrderId: string,
  queryable: Pick<PoolClient, 'query'> | typeof pool = pool,
): Promise<ChangeOrderDetails | null> => {
  const headerResult = await queryable.query<ChangeOrderRow>(
    `
      SELECT
        co.*,
        p.name AS project_name,
        p.customer AS project_customer,
        COUNT(i.id)::int AS item_count,
        COALESCE(SUM(i.order_quantity * i.unit_price), 0) AS total_price
      FROM project_change_orders co
      JOIN projects p ON p.id = co.project_id
      LEFT JOIN project_change_order_items i ON i.change_order_id = co.id
      WHERE co.project_id = $1 AND co.id = $2
      GROUP BY co.id, p.name, p.customer
    `,
    [projectId, changeOrderId],
  );
  const row = headerResult.rows[0];
  if (!row) return null;

  const itemResult = await queryable.query<ChangeOrderItemRow>(
    `SELECT ${ITEM_COLUMNS}
     FROM project_change_order_items
     WHERE change_order_id = $1
     ORDER BY sort_order ASC, created_at ASC`,
    [changeOrderId],
  );
  const summary = mapChangeOrderSummaryRow(row);
  const items = itemResult.rows.map(mapChangeOrderItemRow);

  return {
    ...summary,
    projectName: row.project_name ?? '',
    projectCustomer: row.project_customer ?? '',
    createdBy: row.created_by ?? null,
    totalPrice: calculateChangeOrderTotal(items),
    items,
  };
};

export const createChangeOrder = async (
  projectId: string,
  createdBy: string,
  input: ChangeOrderHeaderInput,
): Promise<ChangeOrderDetails> => {
  const id = randomUUID();
  await pool.query(
    `
      INSERT INTO project_change_orders (
        id, project_id, title, project_reference, prepared_by, report_date, revision, created_by
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
    `,
    [
      id,
      projectId,
      input.title.trim(),
      normalizeText(input.projectReference),
      input.preparedBy.trim(),
      input.reportDate,
      input.revision.trim(),
      createdBy,
    ],
  );
  const created = await getChangeOrder(projectId, id);
  if (!created) throw new Error('Created Change Order could not be loaded');
  return created;
};

const HEADER_COLUMN_MAP: Record<keyof ChangeOrderHeaderInput, string> = {
  title: 'title',
  projectReference: 'project_reference',
  preparedBy: 'prepared_by',
  reportDate: 'report_date',
  revision: 'revision',
};

export const updateChangeOrder = async (
  projectId: string,
  changeOrderId: string,
  input: ChangeOrderHeaderUpdate,
): Promise<ChangeOrderDetails | null> => {
  const assignments: string[] = [];
  const values: unknown[] = [];
  for (const key of Object.keys(input) as Array<keyof ChangeOrderHeaderInput>) {
    values.push(key === 'projectReference' ? normalizeText(input[key]) : input[key]);
    assignments.push(`${HEADER_COLUMN_MAP[key]} = $${values.length}`);
  }
  values.push(changeOrderId, projectId);
  const result = await pool.query(
    `UPDATE project_change_orders
     SET ${assignments.join(', ')}, updated_at = NOW()
     WHERE id = $${values.length - 1} AND project_id = $${values.length}`,
    values,
  );
  if (result.rowCount === 0) return null;
  return getChangeOrder(projectId, changeOrderId);
};

export const deleteChangeOrder = async (
  projectId: string,
  changeOrderId: string,
): Promise<boolean> => {
  const result = await pool.query(
    'DELETE FROM project_change_orders WHERE id = $1 AND project_id = $2',
    [changeOrderId, projectId],
  );
  return (result.rowCount ?? 0) > 0;
};

const insertSnapshot = async (
  client: PoolClient,
  changeOrderId: string,
  sortOrder: number,
  snapshot: ChangeOrderItemSnapshot,
  provenance?: {
    lineKind: 'manual' | 'inherited';
    parentItemId?: string | null;
    quantityPerParent?: number | null;
    sourceAssignmentIds?: string[];
    designQuantity?: number;
    orderQuantity?: number;
  },
): Promise<ChangeOrderItem> => {
  const result = await client.query<ChangeOrderItemRow>(
    `
      INSERT INTO project_change_order_items (
        id, change_order_id, sort_order, source_catalog, source_material_id,
        unit, description_en, clear_description, dimension_mm, material, weight_kg,
        manufacturer, manufacturer_part_no, line_kind, parent_item_id, quantity_per_parent,
        source_standard_material_assignment_ids, design_quantity, order_quantity
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13,
        $14, $15, $16, $17::uuid[], $18, $19
      )
      RETURNING ${ITEM_COLUMNS}
    `,
    [
      randomUUID(),
      changeOrderId,
      sortOrder,
      snapshot.sourceCatalog,
      snapshot.sourceMaterialId,
      snapshot.unit,
      snapshot.descriptionEn,
      snapshot.clearDescription,
      snapshot.dimensionMm,
      snapshot.material,
      snapshot.weightKg,
      snapshot.manufacturer,
      snapshot.manufacturerPartNo,
      provenance?.lineKind ?? 'manual',
      provenance?.parentItemId ?? null,
      provenance?.quantityPerParent ?? null,
      provenance?.sourceAssignmentIds ?? [],
      provenance?.designQuantity ?? 0,
      provenance?.orderQuantity ?? 0,
    ],
  );
  return mapChangeOrderItemRow(result.rows[0]);
};

export const addChangeOrderItem = async (
  projectId: string,
  changeOrderId: string,
  sourceCatalog: ChangeOrderSourceCatalog,
  sourceMaterialId: string,
): Promise<ChangeOrderItem | null> => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const owner = await client.query<{ id: string }>(
      `SELECT id FROM project_change_orders
       WHERE id = $1 AND project_id = $2 FOR UPDATE`,
      [changeOrderId, projectId],
    );
    if (!owner.rows[0]) {
      await client.query('ROLLBACK');
      return null;
    }
    const snapshot = await resolveChangeOrderCatalogSnapshot(
      client,
      sourceCatalog,
      sourceMaterialId,
    );
    const orderResult = await client.query<{ next_order: number }>(
      `SELECT COALESCE(MAX(sort_order), 0)::int + 1 AS next_order
       FROM project_change_order_items WHERE change_order_id = $1`,
      [changeOrderId],
    );
    const item = await insertSnapshot(
      client,
      changeOrderId,
      orderResult.rows[0]?.next_order ?? 1,
      snapshot,
    );
    const expanded = await expandStandardMaterials(client, sourceCatalog, sourceMaterialId);
    let nextSortOrder = (orderResult.rows[0]?.next_order ?? 1) + 1;
    for (const material of expanded) {
      await insertSnapshot(
        client,
        changeOrderId,
        nextSortOrder,
        {
          sourceCatalog: 'cable-installation-material',
          sourceMaterialId: material.referencedMaterialId,
          unit: material.unit,
          descriptionEn: material.name,
          clearDescription: material.description,
          dimensionMm: null,
          material: material.material,
          weightKg: null,
          manufacturer: material.manufacturer,
          manufacturerPartNo: material.partNo,
        },
        {
          lineKind: 'inherited',
          parentItemId: item.id,
          quantityPerParent: material.quantity,
          sourceAssignmentIds: material.sourceAssignmentIds,
        },
      );
      nextSortOrder += 1;
    }
    await client.query('UPDATE project_change_orders SET updated_at = NOW() WHERE id = $1', [
      changeOrderId,
    ]);
    await client.query('COMMIT');
    return item;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
};

const ITEM_COLUMN_MAP: Record<keyof ChangeOrderItemUpdate, string> = {
  designQuantity: 'design_quantity',
  orderQuantity: 'order_quantity',
  unit: 'unit',
  packaging: 'packaging',
  packagingQuantity: 'packaging_quantity',
  packagingUnit: 'packaging_unit',
  orderedQuantity: 'ordered_quantity',
  orderedUnit: 'ordered_unit',
  sapNumber: 'sap_number',
  descriptionEn: 'description_en',
  descriptionDe: 'description_de',
  dimensionMm: 'dimension_mm',
  material: 'material',
  weightKg: 'weight_kg',
  clearDescription: 'clear_description',
  unitPrice: 'unit_price',
  countryOfOrigin: 'country_of_origin',
  hsCode: 'hs_code',
  tagNo: 'tag_no',
  drawingNo: 'drawing_no',
  shippingList: 'shipping_list',
  revisionNumber: 'revision_number',
  clientBarcode: 'client_barcode',
  manufacturer: 'manufacturer',
  manufacturerPartNo: 'manufacturer_part_no',
  acsBarcode: 'acs_barcode',
  remarks: 'remarks',
};

const NULLABLE_TEXT_ITEM_KEYS = new Set<keyof ChangeOrderItemUpdate>([
  'unit',
  'packaging',
  'packagingUnit',
  'orderedUnit',
  'sapNumber',
  'descriptionDe',
  'dimensionMm',
  'material',
  'clearDescription',
  'countryOfOrigin',
  'hsCode',
  'tagNo',
  'drawingNo',
  'shippingList',
  'revisionNumber',
  'clientBarcode',
  'manufacturer',
  'manufacturerPartNo',
  'acsBarcode',
  'remarks',
]);

export const updateChangeOrderItem = async (
  projectId: string,
  changeOrderId: string,
  itemId: string,
  input: ChangeOrderItemUpdate,
): Promise<ChangeOrderItem | null> => {
  const assignments: string[] = [];
  const values: unknown[] = [];
  const updatesSystemManagedFields =
    input.designQuantity !== undefined ||
    input.orderQuantity !== undefined ||
    input.unit !== undefined;
  for (const key of Object.keys(input) as Array<keyof ChangeOrderItemUpdate>) {
    const rawValue = input[key];
    values.push(
      NULLABLE_TEXT_ITEM_KEYS.has(key) && typeof rawValue === 'string'
        ? normalizeText(rawValue)
        : rawValue,
    );
    assignments.push(`${ITEM_COLUMN_MAP[key]} = $${values.length}`);
  }
  values.push(itemId, changeOrderId, projectId);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await client.query<ChangeOrderItemRow>(
      `
        UPDATE project_change_order_items i
        SET ${assignments.join(', ')}, updated_at = NOW()
        FROM project_change_orders co
        WHERE i.id = $${values.length - 2}
          AND i.change_order_id = $${values.length - 1}
          ${updatesSystemManagedFields ? "AND i.line_kind = 'manual'" : ''}
          AND co.id = i.change_order_id
          AND co.project_id = $${values.length}
        RETURNING ${ITEM_COLUMNS.split(',')
          .map((column) => `i.${column.trim()}`)
          .join(', ')}
      `,
      values,
    );
    const updated = result.rows[0];
    if (!updated) {
      await client.query('ROLLBACK');
      return null;
    }
    await client.query(
      `UPDATE project_change_order_items
       SET
         design_quantity = $2 * quantity_per_parent,
         order_quantity = $3 * quantity_per_parent,
         updated_at = NOW()
       WHERE parent_item_id = $1 AND line_kind = 'inherited'`,
      [itemId, updated.design_quantity, updated.order_quantity],
    );
    await client.query('UPDATE project_change_orders SET updated_at = NOW() WHERE id = $1', [
      changeOrderId,
    ]);
    await client.query('COMMIT');
    return mapChangeOrderItemRow(updated);
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
};

export const deleteChangeOrderItem = async (
  projectId: string,
  changeOrderId: string,
  itemId: string,
): Promise<boolean> => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const deleted = await client.query(
      `
        DELETE FROM project_change_order_items i
        USING project_change_orders co
        WHERE i.id = $1 AND i.change_order_id = $2
          AND i.line_kind = 'manual'
          AND co.id = i.change_order_id AND co.project_id = $3
      `,
      [itemId, changeOrderId, projectId],
    );
    if (deleted.rowCount === 0) {
      await client.query('ROLLBACK');
      return false;
    }
    await client.query(
      `
        WITH ordered AS (
          SELECT id, ROW_NUMBER() OVER (ORDER BY sort_order, created_at, id)::int AS new_order
          FROM project_change_order_items WHERE change_order_id = $1
        )
        UPDATE project_change_order_items i
        SET sort_order = ordered.new_order, updated_at = NOW()
        FROM ordered WHERE i.id = ordered.id
      `,
      [changeOrderId],
    );
    await client.query('UPDATE project_change_orders SET updated_at = NOW() WHERE id = $1', [
      changeOrderId,
    ]);
    await client.query('COMMIT');
    return true;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
};

export class InvalidChangeOrderOrderError extends Error {}

export const reorderChangeOrderItems = async (
  projectId: string,
  changeOrderId: string,
  orderedItemIds: string[],
): Promise<ChangeOrderItem[] | null> => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const owner = await client.query<{ id: string }>(
      'SELECT id FROM project_change_orders WHERE id = $1 AND project_id = $2 FOR UPDATE',
      [changeOrderId, projectId],
    );
    if (!owner.rows[0]) {
      await client.query('ROLLBACK');
      return null;
    }
    const current = await client.query<{ id: string }>(
      'SELECT id FROM project_change_order_items WHERE change_order_id = $1 ORDER BY sort_order',
      [changeOrderId],
    );
    const currentIds = current.rows.map((row) => row.id);
    if (
      currentIds.length !== orderedItemIds.length ||
      currentIds.some((id) => !orderedItemIds.includes(id))
    ) {
      throw new InvalidChangeOrderOrderError('Every item must appear exactly once');
    }
    for (let index = 0; index < orderedItemIds.length; index += 1) {
      await client.query(
        `UPDATE project_change_order_items
         SET sort_order = $1, updated_at = NOW()
         WHERE id = $2 AND change_order_id = $3`,
        [index + 1, orderedItemIds[index], changeOrderId],
      );
    }
    await client.query('UPDATE project_change_orders SET updated_at = NOW() WHERE id = $1', [
      changeOrderId,
    ]);
    const reordered = await client.query<ChangeOrderItemRow>(
      `SELECT ${ITEM_COLUMNS} FROM project_change_order_items
       WHERE change_order_id = $1 ORDER BY sort_order`,
      [changeOrderId],
    );
    await client.query('COMMIT');
    return reordered.rows.map(mapChangeOrderItemRow);
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
};
