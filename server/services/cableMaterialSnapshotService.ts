import { createHash } from 'node:crypto';
import type { PoolClient } from 'pg';
import type { CableMaterialRow } from '../models/cableMaterial.js';
import type { CableTypeDefaultMaterialRow } from '../models/cableTypeDefaultMaterial.js';

export type InstallationMaterialSnapshot = {
  schemaVersion: 1;
  originMaterialId: string | null;
  capturedAt: string;
  values: Record<string, unknown>;
};

export const captureInstallationMaterial = (
  material: Record<string, unknown>,
  previous?: InstallationMaterialSnapshot | null,
): InstallationMaterialSnapshot => ({
  schemaVersion: 1,
  originMaterialId: previous === undefined
    ? (typeof material.id === 'string' ? material.id : null)
    : (previous?.originMaterialId ?? null),
  capturedAt: new Date().toISOString(),
  values: { ...material },
});

// A virtual row has the same UUID when explicitly materialized. Opening a detail
// page can therefore remain a pure read, including before editing that row.
export const inheritedCableMaterialId = (cableId: string, defaultId: string): string => {
  const bytes = createHash('sha256').update(`wfc:cable-material:${cableId}:${defaultId}`).digest();
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.subarray(0, 16).toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
};

export const projectDefaultOrigin = (
  material: CableTypeDefaultMaterialRow,
): CableMaterialRow['origin_kind'] =>
  material.source_kind === 'standard-material'
    ? 'catalog-inherited'
    : material.source_kind === 'manual'
      ? 'project-added'
      : null;

export const projectDefaultToCableMaterial = (
  cableId: string,
  material: CableTypeDefaultMaterialRow,
): CableMaterialRow => ({
  id: inheritedCableMaterialId(cableId, material.id),
  cable_id: cableId,
  name: material.name,
  quantity: material.quantity,
  unit: material.unit,
  remarks: material.remarks,
  source: 'default',
  cable_type_default_material_id: material.id,
  current_material_id: material.current_material_id ?? null,
  material_snapshot: material.material_snapshot ?? null,
  origin_kind: projectDefaultOrigin(material),
  inherited_override: material.inherited_override ?? false,
  created_at: material.created_at,
  updated_at: material.updated_at,
  is_virtual: true,
});

export const effectiveCableMaterials = (
  cableId: string,
  existing: CableMaterialRow[],
  defaults: CableTypeDefaultMaterialRow[],
  initialized: boolean,
  customized: boolean,
): CableMaterialRow[] => {
  if (initialized && (customized || existing.length > 0)) return existing;
  const linked = new Set(existing.map((row) => row.cable_type_default_material_id).filter(Boolean));
  return [
    ...existing,
    ...defaults
      .filter((row) => !linked.has(row.id))
      .map((row) => projectDefaultToCableMaterial(cableId, row)),
  ];
};

export const retainedCableLocalMaterial = (row: CableMaterialRow): boolean =>
  row.inherited_override === true ||
  row.source === 'manual' ||
  row.origin_kind === 'project-added' ||
  row.origin_kind === 'cable-added';

export const materializeCableDefaultRows = async (
  queryable: Pick<PoolClient, 'query'>,
  cableId: string,
  defaults: CableTypeDefaultMaterialRow[],
  existing: CableMaterialRow[],
): Promise<void> => {
  const linked = new Set(existing.map((row) => row.cable_type_default_material_id).filter(Boolean));
  for (const item of defaults) {
    if (linked.has(item.id)) continue;
    const row = projectDefaultToCableMaterial(cableId, item);
    await queryable.query(
      `INSERT INTO cable_materials (
        id, cable_id, name, quantity, unit, remarks, source, cable_type_default_material_id,
        current_material_id, material_snapshot, origin_kind, inherited_override
      ) VALUES ($1,$2,$3,$4,$5,$6,'default',$7,$8,$9::jsonb,$10,$11)
      ON CONFLICT (id) DO NOTHING`,
      [
        row.id,
        cableId,
        row.name,
        row.quantity,
        row.unit,
        row.remarks,
        row.cable_type_default_material_id,
        row.current_material_id,
        JSON.stringify(row.material_snapshot),
        row.origin_kind,
        row.inherited_override,
      ],
    );
  }
};

/** Caller owns the project transaction/lock; never use during a read. */
export const replaceInheritedCableMaterials = async (
  queryable: Pick<PoolClient, 'query'>,
  cableId: string,
  defaults: CableTypeDefaultMaterialRow[],
): Promise<void> => {
  const result = await queryable.query<CableMaterialRow>(
    'SELECT * FROM cable_materials WHERE cable_id = $1 FOR UPDATE',
    [cableId],
  );
  const retained = result.rows.filter(
    (row) => retainedCableLocalMaterial(row) || row.origin_kind == null,
  );
  const removed = result.rows.filter((row) => !retained.includes(row));
  if (removed.length > 0) {
    await queryable.query(
      'DELETE FROM cable_materials WHERE cable_id = $1 AND id = ANY($2::uuid[])',
      [cableId, removed.map((row) => row.id)],
    );
  }
  await materializeCableDefaultRows(queryable, cableId, defaults, retained);
  await queryable.query(
    'UPDATE cables SET materials_initialized = TRUE, materials_customized = $2, updated_at = NOW() WHERE id = $1',
    [cableId, retained.length > 0],
  );
};
