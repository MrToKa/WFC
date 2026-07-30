export type MaterialCableInstallationMaterialRow = {
  id: string;
  type: string;
  purpose: string | null;
  material: string | null;
  description: string | null;
  manufacturer: string | null;
  part_no: string | null;
  minimum_order_quantity: string | number;
  order_measurement: 'pcs' | 'pack' | 'meters';
  packaging: 'm' | 'Package' | 'Box' | 'Drum' | 'pcs';
  created_at: Date | string;
  updated_at: Date | string;
};

const toIsoString = (value: Date | string): string =>
  typeof value === 'string' ? value : value.toISOString();

export type PublicMaterialCableInstallationMaterial = {
  id: string;
  type: string;
  purpose: string | null;
  material: string | null;
  description: string | null;
  manufacturer: string | null;
  partNo: string | null;
  minimumOrderQuantity: number;
  orderMeasurement: 'pcs' | 'pack' | 'meters';
  packaging: 'm' | 'Package' | 'Box' | 'Drum' | 'pcs';
  createdAt: string;
  updatedAt: string;
};

export const mapMaterialCableInstallationMaterialRow = (
  row: MaterialCableInstallationMaterialRow,
): PublicMaterialCableInstallationMaterial => ({
  id: row.id,
  type: row.type,
  purpose: row.purpose ?? null,
  material: row.material ?? null,
  description: row.description ?? null,
  manufacturer: row.manufacturer ?? null,
  partNo: row.part_no ?? null,
  minimumOrderQuantity: Number(row.minimum_order_quantity),
  orderMeasurement: row.order_measurement,
  packaging: row.packaging,
  createdAt: toIsoString(row.created_at),
  updatedAt: toIsoString(row.updated_at),
});
