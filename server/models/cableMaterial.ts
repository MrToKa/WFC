import { toNumberOrNull } from './cableType.js';

export type CableMaterialRow = {
  id: string;
  cable_id: string;
  name: string;
  quantity: string | number | null;
  unit: string | null;
  remarks: string | null;
  source: 'default' | 'manual' | null;
  cable_type_default_material_id: string | null;
  created_at: Date | string;
  updated_at: Date | string;
};

const toIsoString = (value: Date | string): string =>
  typeof value === 'string' ? value : value.toISOString();

export type PublicCableMaterial = {
  id: string;
  cableId: string;
  name: string;
  quantity: number | null;
  unit: string | null;
  remarks: string | null;
  source: 'default' | 'manual' | null;
  cableTypeDefaultMaterialId: string | null;
  createdAt: string;
  updatedAt: string;
};

export const mapCableMaterialRow = (row: CableMaterialRow): PublicCableMaterial => ({
  id: row.id,
  cableId: row.cable_id,
  name: row.name,
  quantity: toNumberOrNull(row.quantity),
  unit: row.unit ?? null,
  remarks: row.remarks ?? null,
  source: row.source ?? null,
  cableTypeDefaultMaterialId: row.cable_type_default_material_id ?? null,
  createdAt: toIsoString(row.created_at),
  updatedAt: toIsoString(row.updated_at),
});
