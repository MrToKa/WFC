import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import type { CableTypeRow } from '../models/cableType.js';
import type { CableTypeDefaultMaterialRow } from '../models/cableTypeDefaultMaterial.js';
import type { ProjectChangeLogEntry } from '../models/project.js';

export type CableTypeSnapshot = {
  cableType: CableTypeRow;
  materials: CableTypeDefaultMaterialRow[];
};

// Serialize changes to a cable type and its materials using the same parent lock.
export const readCableTypeSnapshot = async (
  client: PoolClient,
  projectId: string,
  cableTypeId: string,
): Promise<CableTypeSnapshot | null> => {
  const result = await client.query<CableTypeRow>(
    'SELECT * FROM cable_types WHERE project_id = $1 AND id = $2 FOR UPDATE',
    [projectId, cableTypeId],
  );
  if (!result.rows[0]) return null;
  const materials = await client.query<CableTypeDefaultMaterialRow>(
    'SELECT * FROM cable_type_default_materials WHERE cable_type_id = $1',
    [cableTypeId],
  );
  return { cableType: result.rows[0], materials: materials.rows };
};

const fields = {
  name: 'Type',
  purpose: 'Purpose',
  material: 'Material',
  description: 'Description',
  manufacturer: 'Manufacturer',
  part_no: 'Part No.',
  remarks: 'Remarks',
  diameter_mm: 'Diameter [mm]',
  weight_kg_per_m: 'Weight [kg/m]',
  source_material_cable_type_id: 'Materials source ID',
} as const;
const format = (value: unknown) =>
  value == null || value === '' ? 'Not specified' : String(value);
const describeMaterial = (material: CableTypeDefaultMaterialRow) =>
  `"${material.name}" (Quantity: ${format(material.quantity == null ? null : Number(material.quantity))}; Unit: ${format(material.unit)}; Remarks: ${format(material.remarks)}; Source: ${material.source_kind === 'standard-material' ? 'Inherited from Materials' : 'Project default'})`;

export const describeCableTypeChanges = (
  before: CableTypeSnapshot | null,
  after: CableTypeSnapshot,
): string[] => {
  const changes: string[] = before ? [] : ['Cable type created.'];
  for (const [key, label] of Object.entries(fields)) {
    const field = key as keyof typeof fields;
    const normalize = (value: unknown) =>
      (field === 'diameter_mm' || field === 'weight_kg_per_m') && value != null
        ? Number(value)
        : value;
    const oldValue = format(normalize(before?.cableType[field]));
    const newValue = format(normalize(after.cableType[field]));
    if (oldValue !== newValue) changes.push(`${label}: ${oldValue} → ${newValue}`);
  }
  // Compare values, not row IDs: Excel imports and inherited snapshots recreate rows.
  const remaining = after.materials.map(describeMaterial);
  for (const material of before?.materials ?? []) {
    const description = describeMaterial(material);
    const index = remaining.indexOf(description);
    if (index >= 0) remaining.splice(index, 1);
    else changes.push(`Removed default material ${description}`);
  }
  for (const description of remaining) changes.push(`Added default material ${description}`);
  return changes;
};

export const recordCableTypeChanges = async (
  client: PoolClient,
  projectId: string,
  cableTypeId: string,
  userId: string,
  before: CableTypeSnapshot | null,
): Promise<ProjectChangeLogEntry | null> => {
  const after = await readCableTypeSnapshot(client, projectId, cableTypeId);
  if (!after) throw new Error('Cable type not found');
  const changes = describeCableTypeChanges(before, after);
  if (!changes.length) return null;
  const actor = await client.query<{ name: string }>(
    `SELECT COALESCE(NULLIF(btrim(concat_ws(' ', first_name, last_name)), ''), email) AS name
     FROM users WHERE id = $1`,
    [userId],
  );
  if (!actor.rows[0]) throw new Error('Current user not found');
  const entry = {
    id: randomUUID(),
    userId,
    userName: actor.rows[0].name,
    changedAt: new Date().toISOString(),
    changes,
  };
  await client.query('UPDATE cable_types SET change_log = change_log || $2::jsonb WHERE id = $1', [
    cableTypeId,
    JSON.stringify([entry]),
  ]);
  return entry;
};
