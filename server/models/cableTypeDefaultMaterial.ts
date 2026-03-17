import { toNumberOrNull } from './cableType.js';

export type CableTypeDefaultMaterialRow = {
  id: string;
  cable_type_id: string;
  name: string;
  quantity: string | number | null;
  unit: string | null;
  remarks: string | null;
  created_at: Date | string;
  updated_at: Date | string;
};

const toIsoString = (value: Date | string): string =>
  typeof value === 'string' ? value : value.toISOString();

export type PublicCableTypeDefaultMaterial = {
  id: string;
  cableTypeId: string;
  name: string;
  quantity: number | null;
  unit: string | null;
  remarks: string | null;
  createdAt: string;
  updatedAt: string;
};

export const mapCableTypeDefaultMaterialRow = (
  row: CableTypeDefaultMaterialRow
): PublicCableTypeDefaultMaterial => ({
  id: row.id,
  cableTypeId: row.cable_type_id,
  name: row.name,
  quantity: toNumberOrNull(row.quantity),
  unit: row.unit ?? null,
  remarks: row.remarks ?? null,
  createdAt: toIsoString(row.created_at),
  updatedAt: toIsoString(row.updated_at)
});
