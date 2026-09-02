import type { QueryResultRow } from 'pg';
import type { ChangeOrderSourceCatalog } from '../models/changeOrder.js';

type Queryable = {
  query: <Row extends QueryResultRow = QueryResultRow>(
    text: string,
    values?: unknown[],
  ) => Promise<{ rows: Row[] }>;
};

export type ChangeOrderItemSnapshot = {
  sourceCatalog: ChangeOrderSourceCatalog;
  sourceMaterialId: string;
  unit: string;
  descriptionEn: string;
  clearDescription: string | null;
  dimensionMm: string | null;
  material: string | null;
  weightKg: number | null;
  manufacturer: string | null;
  manufacturerPartNo: string | null;
  minimumOrderQuantity: number;
  orderMeasurement: 'pcs' | 'pack' | 'meters';
  packaging: 'm' | 'Package' | 'Box' | 'Drum' | 'pcs';
};

export type CableTypeCatalogRecord = {
  id: string;
  name: string;
  purpose: string | null;
  material: string | null;
  description: string | null;
  manufacturer: string | null;
  part_no: string | null;
  diameter_mm: string | number | null;
  weight_kg_per_m: string | number | null;
  minimum_order_quantity: string | number;
  order_measurement: 'pcs' | 'pack' | 'meters';
  packaging: 'm' | 'Package' | 'Box' | 'Drum' | 'pcs';
};

export type CableInstallationMaterialCatalogRecord = {
  id: string;
  type: string;
  purpose: string | null;
  material: string | null;
  description: string | null;
  manufacturer: string | null;
  part_no: string | null;
  dimension_mm: string | null;
  weight_kg: string | number | null;
  minimum_order_quantity: string | number;
  order_measurement: 'pcs' | 'pack' | 'meters';
  packaging: 'm' | 'Package' | 'Box' | 'Drum' | 'pcs';
};

export type TrayInstallationMaterialCatalogRecord = CableInstallationMaterialCatalogRecord;

export type TrayCatalogRecord = {
  id: string;
  tray_type: string;
  manufacturer: string | null;
  height_mm: string | number | null;
  rung_height_mm: string | number | null;
  width_mm: string | number | null;
  weight_kg_per_m: string | number | null;
  minimum_order_quantity: string | number;
  order_measurement: 'pcs' | 'pack' | 'meters';
  packaging: 'm' | 'Package' | 'Box' | 'Drum' | 'pcs';
};

export type SupportCatalogRecord = {
  id: string;
  support_type: string;
  manufacturer: string | null;
  height_mm: string | number | null;
  width_mm: string | number | null;
  length_mm: string | number | null;
  weight_kg: string | number | null;
  minimum_order_quantity: string | number;
  order_measurement: 'pcs' | 'pack' | 'meters';
  packaging: 'm' | 'Package' | 'Box' | 'Drum' | 'pcs';
};

const toNumberOrNull = (value: string | number | null): number | null => {
  if (value === null) {
    return null;
  }
  const numeric = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(numeric) ? numeric : null;
};

const firstText = (...values: Array<string | null>): string | null => {
  for (const value of values) {
    const trimmed = value?.trim();
    if (trimmed) {
      return trimmed;
    }
  }
  return null;
};

const formatDimensions = (
  dimensions: Array<{ label: string; value: string | number | null }>,
): string | null => {
  const populated = dimensions
    .filter((dimension) => dimension.value !== null && String(dimension.value).trim() !== '')
    .map((dimension) => `${dimension.label} ${dimension.value}`);
  return populated.length > 0 ? populated.join(' × ') : null;
};

export const snapshotCableType = (record: CableTypeCatalogRecord): ChangeOrderItemSnapshot => ({
  sourceCatalog: 'cable-type',
  sourceMaterialId: record.id,
  unit: record.order_measurement,
  descriptionEn: record.name.trim(),
  clearDescription: firstText(record.description, record.purpose),
  dimensionMm:
    record.diameter_mm === null || String(record.diameter_mm).trim() === ''
      ? null
      : String(record.diameter_mm),
  material: firstText(record.material),
  weightKg: toNumberOrNull(record.weight_kg_per_m),
  manufacturer: firstText(record.manufacturer),
  manufacturerPartNo: firstText(record.part_no),
  minimumOrderQuantity: Number(record.minimum_order_quantity),
  orderMeasurement: record.order_measurement,
  packaging: record.packaging,
});

export const snapshotCableInstallationMaterial = (
  record: CableInstallationMaterialCatalogRecord,
): ChangeOrderItemSnapshot => ({
  sourceCatalog: 'cable-installation-material',
  sourceMaterialId: record.id,
  unit: record.order_measurement,
  descriptionEn: record.type.trim(),
  clearDescription: firstText(record.description, record.purpose),
  dimensionMm: firstText(record.dimension_mm),
  material: firstText(record.material),
  weightKg: toNumberOrNull(record.weight_kg),
  manufacturer: firstText(record.manufacturer),
  manufacturerPartNo: firstText(record.part_no),
  minimumOrderQuantity: Number(record.minimum_order_quantity),
  orderMeasurement: record.order_measurement,
  packaging: record.packaging,
});

export const snapshotTrayInstallationMaterial = (
  record: TrayInstallationMaterialCatalogRecord,
): ChangeOrderItemSnapshot => ({
  sourceCatalog: 'tray-installation-material',
  sourceMaterialId: record.id,
  unit: record.order_measurement,
  descriptionEn: record.type.trim(),
  clearDescription: firstText(record.description, record.purpose),
  dimensionMm: firstText(record.dimension_mm),
  material: firstText(record.material),
  weightKg: toNumberOrNull(record.weight_kg),
  manufacturer: firstText(record.manufacturer),
  manufacturerPartNo: firstText(record.part_no),
  minimumOrderQuantity: Number(record.minimum_order_quantity),
  orderMeasurement: record.order_measurement,
  packaging: record.packaging,
});

export const snapshotTray = (record: TrayCatalogRecord): ChangeOrderItemSnapshot => ({
  sourceCatalog: 'tray',
  sourceMaterialId: record.id,
  unit: record.order_measurement,
  descriptionEn: record.tray_type.trim(),
  clearDescription: null,
  dimensionMm: formatDimensions([
    { label: 'H', value: record.height_mm },
    { label: 'RH', value: record.rung_height_mm },
    { label: 'W', value: record.width_mm },
  ]),
  material: null,
  weightKg: toNumberOrNull(record.weight_kg_per_m),
  manufacturer: firstText(record.manufacturer),
  manufacturerPartNo: null,
  minimumOrderQuantity: Number(record.minimum_order_quantity),
  orderMeasurement: record.order_measurement,
  packaging: record.packaging,
});

export const snapshotSupport = (record: SupportCatalogRecord): ChangeOrderItemSnapshot => ({
  sourceCatalog: 'support',
  sourceMaterialId: record.id,
  unit: record.order_measurement,
  descriptionEn: record.support_type.trim(),
  clearDescription: null,
  dimensionMm: formatDimensions([
    { label: 'H', value: record.height_mm },
    { label: 'W', value: record.width_mm },
    { label: 'L', value: record.length_mm },
  ]),
  material: null,
  weightKg: toNumberOrNull(record.weight_kg),
  manufacturer: firstText(record.manufacturer),
  manufacturerPartNo: null,
  minimumOrderQuantity: Number(record.minimum_order_quantity),
  orderMeasurement: record.order_measurement,
  packaging: record.packaging,
});

export class CatalogMaterialNotFoundError extends Error {
  constructor() {
    super('Source material not found');
  }
}

export const resolveChangeOrderCatalogSnapshot = async (
  queryable: Queryable,
  sourceCatalog: ChangeOrderSourceCatalog,
  sourceMaterialId: string,
): Promise<ChangeOrderItemSnapshot> => {
  switch (sourceCatalog) {
    case 'cable-type': {
      const result = await queryable.query<CableTypeCatalogRecord>(
        `SELECT
           id, name, purpose, material, description, manufacturer, part_no,
           diameter_mm, weight_kg_per_m, minimum_order_quantity, order_measurement, packaging
         FROM material_cable_types WHERE id = $1 LIMIT 1`,
        [sourceMaterialId],
      );
      if (!result.rows[0]) throw new CatalogMaterialNotFoundError();
      return snapshotCableType(result.rows[0]);
    }
    case 'cable-installation-material': {
      const result = await queryable.query<CableInstallationMaterialCatalogRecord>(
        `SELECT id, type, purpose, material, description, manufacturer, part_no,
                dimension_mm, weight_kg,
                minimum_order_quantity, order_measurement, packaging
         FROM material_cable_installation_materials WHERE id = $1 LIMIT 1`,
        [sourceMaterialId],
      );
      if (!result.rows[0]) throw new CatalogMaterialNotFoundError();
      return snapshotCableInstallationMaterial(result.rows[0]);
    }
    case 'tray-installation-material': {
      const result = await queryable.query<TrayInstallationMaterialCatalogRecord>(
        `SELECT id, type, purpose, material, description, manufacturer, part_no,
                dimension_mm, weight_kg,
                minimum_order_quantity, order_measurement, packaging
         FROM material_tray_installation_materials WHERE id = $1 LIMIT 1`,
        [sourceMaterialId],
      );
      if (!result.rows[0]) throw new CatalogMaterialNotFoundError();
      return snapshotTrayInstallationMaterial(result.rows[0]);
    }
    case 'tray': {
      const result = await queryable.query<TrayCatalogRecord>(
        `SELECT id, tray_type, manufacturer, height_mm, rung_height_mm, width_mm,
                weight_kg_per_m, minimum_order_quantity, order_measurement, packaging
         FROM material_trays WHERE id = $1 LIMIT 1`,
        [sourceMaterialId],
      );
      if (!result.rows[0]) throw new CatalogMaterialNotFoundError();
      return snapshotTray(result.rows[0]);
    }
    case 'support': {
      const result = await queryable.query<SupportCatalogRecord>(
        `SELECT id, support_type, manufacturer, height_mm, width_mm, length_mm,
                weight_kg, minimum_order_quantity, order_measurement, packaging
         FROM material_supports WHERE id = $1 LIMIT 1`,
        [sourceMaterialId],
      );
      if (!result.rows[0]) throw new CatalogMaterialNotFoundError();
      return snapshotSupport(result.rows[0]);
    }
  }
};
