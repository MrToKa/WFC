export type MaterialTrayInstallationMaterialRow = {
  id: string;
  type: string;
  purpose: string | null;
  material: string | null;
  description: string | null;
  manufacturer: string | null;
  part_no: string | null;
  dimension_mm: string | null;
  weight_kg: string | number | null;
  unit_price: string | number;
  minimum_order_quantity: string | number;
  order_measurement: 'pcs' | 'pack' | 'meters';
  packaging: 'm' | 'Package' | 'Box' | 'Drum' | 'pcs';
  source: string | null;
  created_at: Date | string;
  updated_at: Date | string;
};

const toIsoString = (value: Date | string): string =>
  typeof value === 'string' ? value : value.toISOString();

export type PublicMaterialTrayInstallationMaterial = {
  id: string;
  type: string;
  purpose: string | null;
  material: string | null;
  description: string | null;
  manufacturer: string | null;
  partNo: string | null;
  dimensionMm: string | null;
  weightKg: number | null;
  unitPrice: number;
  minimumOrderQuantity: number;
  orderMeasurement: 'pcs' | 'pack' | 'meters';
  packaging: 'm' | 'Package' | 'Box' | 'Drum' | 'pcs';
  source: string | null;
  createdAt: string;
  updatedAt: string;
};

export const mapMaterialTrayInstallationMaterialRow = (
  row: MaterialTrayInstallationMaterialRow,
): PublicMaterialTrayInstallationMaterial => ({
  id: row.id,
  type: row.type,
  purpose: row.purpose ?? null,
  material: row.material ?? null,
  description: row.description ?? null,
  manufacturer: row.manufacturer ?? null,
  partNo: row.part_no ?? null,
  dimensionMm: row.dimension_mm ?? null,
  weightKg: row.weight_kg === null ? null : Number(row.weight_kg),
  unitPrice: Number(row.unit_price),
  minimumOrderQuantity: Number(row.minimum_order_quantity),
  orderMeasurement: row.order_measurement,
  packaging: row.packaging,
  source: row.source ?? null,
  createdAt: toIsoString(row.created_at),
  updatedAt: toIsoString(row.updated_at),
});
