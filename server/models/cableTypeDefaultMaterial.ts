import { toNumberOrNull } from './cableType.js';
import type { InstallationMaterialSnapshot } from '../services/cableMaterialSnapshotService.js';

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
  current_material_id?: string | null;
  material_snapshot?: InstallationMaterialSnapshot | null;
  inherited_override?: boolean;
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
  currentMaterialId: string | null;
  materialSnapshot: InstallationMaterialSnapshot | null;
  inheritedOverride: boolean;
  createdAt: string;
  updatedAt: string;
};

export const mapCableTypeDefaultMaterialRow = (
  row: CableTypeDefaultMaterialRow,
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
  currentMaterialId: row.current_material_id ?? null,
  materialSnapshot: row.material_snapshot ?? null,
  inheritedOverride: row.inherited_override ?? false,
  createdAt: toIsoString(row.created_at),
  updatedAt: toIsoString(row.updated_at),
});
