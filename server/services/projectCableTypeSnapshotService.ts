import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import { expandStandardMaterials } from './standardMaterialService.js';
import { captureInstallationMaterial } from './cableMaterialSnapshotService.js';
import { MutationError } from './mutationService.js';

export const snapshotStandardMaterialsToProjectCableType = async (
  client: PoolClient,
  cableTypeId: string,
  sourceMaterialCableTypeId: string,
  options: { replaceInherited: boolean },
): Promise<number> => {
  let overrideAssignmentSets: string[] = [];
  if (options.replaceInherited) {
    const overrides = await client.query<{ source_standard_material_assignment_ids: string[] | null }>(
      "SELECT source_standard_material_assignment_ids FROM cable_type_default_materials WHERE cable_type_id = $1 AND source_kind = 'standard-material' AND inherited_override = TRUE FOR UPDATE",
      [cableTypeId],
    );
    overrideAssignmentSets = overrides.rows
      .map((row) => row.source_standard_material_assignment_ids ?? [])
      .filter((ids) => ids.length > 0)
      .map((ids) => JSON.stringify([...ids].sort()));
    await client.query(
      `DELETE FROM cable_type_default_materials
       WHERE cable_type_id = $1 AND source_kind = 'standard-material' AND inherited_override = FALSE`,
      [cableTypeId],
    );
  }

  const expanded = (await expandStandardMaterials(client, 'cable-type', sourceMaterialCableTypeId))
    .filter((material) => !overrideAssignmentSets.includes(JSON.stringify([...material.sourceAssignmentIds].sort())));
  const ids = [...new Set(expanded.map((material) => material.referencedMaterialId))];
  const catalogRows = ids.length
    ? await client.query<Record<string, unknown>>(
        'SELECT * FROM material_cable_installation_materials WHERE id = ANY($1::uuid[]) AND obsolete_at IS NULL',
        [ids],
      )
    : { rows: [] };
  const catalogById = new Map(catalogRows.rows.map((row) => [row.id, row]));
  for (const material of expanded) {
    const catalog = catalogById.get(material.referencedMaterialId);
    if (!catalog)
      throw new MutationError(
        409,
        'CATALOG_CAPTURE_CONFLICT',
        'A referenced catalog material is no longer available. Reload before adding this cable type.',
      );
    await client.query(
      `INSERT INTO cable_type_default_materials (
         id, cable_type_id, name, quantity, unit, remarks, source_kind,
         source_master_material_id, source_standard_material_assignment_ids,
         current_material_id, material_snapshot
       ) VALUES ($1, $2, $3, $4, $5, $6, 'standard-material', $7, $8::uuid[], $7, $9::jsonb)`,
      [
        randomUUID(),
        cableTypeId,
        material.name,
        material.quantity,
        material.unit,
        material.remarks,
        material.referencedMaterialId,
        material.sourceAssignmentIds,
        JSON.stringify(captureInstallationMaterial(catalog)),
      ],
    );
  }
  return expanded.length;
};
