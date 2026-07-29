import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import { expandStandardMaterials } from './standardMaterialService.js';

export const snapshotStandardMaterialsToProjectCableType = async (
  client: PoolClient,
  cableTypeId: string,
  sourceMaterialCableTypeId: string,
  options: { replaceInherited: boolean },
): Promise<number> => {
  if (options.replaceInherited) {
    await client.query(
      `DELETE FROM cable_type_default_materials
       WHERE cable_type_id = $1 AND source_kind = 'standard-material'`,
      [cableTypeId],
    );
  }

  const expanded = await expandStandardMaterials(
    client,
    'cable-type',
    sourceMaterialCableTypeId,
  );
  for (const material of expanded) {
    await client.query(
      `INSERT INTO cable_type_default_materials (
         id, cable_type_id, name, quantity, unit, remarks, source_kind,
         source_master_material_id, source_standard_material_assignment_ids
       ) VALUES ($1, $2, $3, $4, $5, $6, 'standard-material', $7, $8::uuid[])`,
      [
        randomUUID(),
        cableTypeId,
        material.name,
        material.quantity,
        material.unit,
        material.remarks,
        material.referencedMaterialId,
        material.sourceAssignmentIds,
      ],
    );
  }
  return expanded.length;
};
