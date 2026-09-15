import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import type { CableMaterialRow } from '../models/cableMaterial.js';
import type { ProjectChangeLogEntry } from '../models/project.js';

const format = (value: unknown): string =>
  value == null || value === '' ? 'Not specified' : String(value);

const materialValues = (material: CableMaterialRow) => ({
  Name: material.name,
  Quantity: material.quantity == null ? null : Number(material.quantity),
  Unit: material.unit,
  Remarks: material.remarks,
  Source: material.source === 'default' ? 'Default' : 'Manual',
});

const describeMaterial = (material: CableMaterialRow): string => {
  const values = materialValues(material);
  return `"${material.name}" (Quantity: ${format(values.Quantity)}; Unit: ${format(values.Unit)}; Remarks: ${format(values.Remarks)}; Source: ${values.Source})`;
};

export const describeCableMaterialChanges = (
  before: CableMaterialRow[],
  after: CableMaterialRow[],
): string[] => {
  const changes: string[] = [];
  const remaining = [...after];
  const unmatched: CableMaterialRow[] = [];
  for (const material of before) {
    const index = remaining.findIndex((candidate) => candidate.id === material.id);
    if (index < 0) {
      unmatched.push(material);
      continue;
    }
    const [updated] = remaining.splice(index, 1);
    const oldValues = materialValues(material);
    const newValues = materialValues(updated);
    for (const key of Object.keys(oldValues) as (keyof typeof oldValues)[]) {
      if (format(oldValues[key]) !== format(newValues[key])) {
        changes.push(
          `Material "${material.name}" / ${key}: ${format(oldValues[key])} → ${format(newValues[key])}`,
        );
      }
    }
  }
  // Reloading defaults can replace rows without changing their actual values.
  for (const material of unmatched) {
    const description = describeMaterial(material);
    const index = remaining.findIndex((candidate) => describeMaterial(candidate) === description);
    if (index >= 0) remaining.splice(index, 1);
    else changes.push(`Removed material ${description}`);
  }
  for (const material of remaining) changes.push(`Added material ${describeMaterial(material)}`);
  return changes;
};

// The caller holds the cable row lock and commits the material change and its history together.
export const recordCableMaterialChanges = async (
  client: PoolClient,
  cableId: string,
  userId: string,
  before: CableMaterialRow[],
  after: CableMaterialRow[],
): Promise<ProjectChangeLogEntry | null> => {
  const changes = describeCableMaterialChanges(before, after);
  if (!changes.length) return null;
  const actor = await client.query<{ name: string }>(
    `SELECT COALESCE(NULLIF(btrim(concat_ws(' ', first_name, last_name)), ''), email) AS name
     FROM users WHERE id = $1`,
    [userId],
  );
  if (!actor.rows[0]) throw new Error('Current user not found');
  const entry: ProjectChangeLogEntry = {
    id: randomUUID(),
    userId,
    userName: actor.rows[0].name,
    changedAt: new Date().toISOString(),
    changes,
  };
  await client.query('UPDATE cables SET change_log = change_log || $2::jsonb WHERE id = $1', [
    cableId,
    JSON.stringify([entry]),
  ]);
  return entry;
};
