import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import { mapTrayRow, type TrayRow } from '../models/tray.js';
import type { ProjectChangeLogEntry } from '../models/project.js';

const fields = {
  name: 'Name',
  type: 'Type',
  purpose: 'Purpose',
  widthMm: 'Width [mm]',
  heightMm: 'Height [mm]',
  lengthMm: 'Length [mm]',
  includeGroundingCable: 'Include grounding cable',
  groundingCableTypeId: 'Grounding cable type ID',
} as const;

const format = (value: unknown): string => {
  if (value == null || value === '') return 'Not specified';
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  return String(value);
};

export const describeTrayChanges = (before: TrayRow | null, after: TrayRow): string[] => {
  const previous = before ? mapTrayRow(before) : null;
  const current = mapTrayRow(after);
  const changes: string[] = before ? [] : ['Tray created.'];
  for (const [key, label] of Object.entries(fields)) {
    const field = key as keyof typeof fields;
    const oldValue = format(previous?.[field]);
    const newValue = format(current[field]);
    if (oldValue !== newValue) changes.push(`${label}: ${oldValue} → ${newValue}`);
  }
  return changes;
};

// Call inside the tray mutation transaction, with the previous row locked FOR UPDATE.
export const recordTrayChanges = async (
  client: PoolClient,
  userId: string,
  before: TrayRow | null,
  after: TrayRow,
): Promise<ProjectChangeLogEntry | null> => {
  const changes = describeTrayChanges(before, after);
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
  await client.query(
    'UPDATE trays SET change_log = change_log || $3::jsonb WHERE project_id = $1 AND id = $2',
    [after.project_id, after.id, JSON.stringify([entry])],
  );
  after.change_log = [...(after.change_log ?? []), entry];
  return entry;
};
