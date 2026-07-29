import { toNumberOrNull } from './cableType.js';

export type CableTypeDefaultMaterialRow = {
  id: string;
  cable_type_id: string;
  name: string;
  quantity: string | number | null;
  unit: string | null;
  remarks: string | null;
  source_kind?: 'manual' | 'standard-material' | null;
  source_master_material_id?: string | null;
  source_standard_material_assignment_ids?: string[] | null;
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
  sourceKind: 'manual' | 'standard-material' | null;
  sourceMasterMaterialId: string | null;
  sourceStandardMaterialAssignmentIds: string[];
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
  sourceKind: row.source_kind ?? null,
  sourceMasterMaterialId: row.source_master_material_id ?? null,
  sourceStandardMaterialAssignmentIds: row.source_standard_material_assignment_ids ?? [],
  createdAt: toIsoString(row.created_at),
  updatedAt: toIsoString(row.updated_at)
});
