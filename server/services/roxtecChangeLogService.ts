import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import type { RoxtecEntryRow } from '../models/roxtecEntry.js';
import type { ProjectChangeLogEntry } from '../models/project.js';

const fields = { revision: 'Rev.', tag: 'Tag', type: 'Type', description: 'Description' } as const;
const format = (value: string | null) => value || 'Not specified';
export const describeRoxtecChanges = (
  before: RoxtecEntryRow | null,
  after: RoxtecEntryRow | null,
): string[] => {
  const entry = after ?? before;
  if (!entry) return [];
  const label = 'Roxtec ' + entry.id + ' (' + entry.tag + ')';
  if (!before || !after)
    return [
      (after ? 'Added ' : 'Deleted ') +
        label +
        ': ' +
        (Object.keys(fields) as (keyof typeof fields)[])
          .map((key) => fields[key] + ': ' + format(entry[key]))
          .join('; '),
    ];
  return (Object.keys(fields) as (keyof typeof fields)[])
    .filter((key) => format(before[key]) !== format(after[key]))
    .map(
      (key) =>
        label + ' / ' + fields[key] + ': ' + format(before[key]) + ' \u2192 ' + format(after[key]),
    );
};
export const recordRoxtecChanges = async (
  client: PoolClient,
  projectId: string,
  userId: string,
  before: RoxtecEntryRow | null,
  after: RoxtecEntryRow | null,
): Promise<void> => {
  const changes = describeRoxtecChanges(before, after);
  if (!changes.length) return;
  const actor = await client.query<{ name: string }>(
    `SELECT COALESCE(NULLIF(btrim(concat_ws(' ', first_name, last_name)), ''), email) AS name FROM users WHERE id = $1`,
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
  await client.query(
    'UPDATE projects SET roxtec_change_log = roxtec_change_log || $2::jsonb WHERE id = $1',
    [projectId, JSON.stringify([entry])],
  );
};
