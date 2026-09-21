import { randomUUID } from 'crypto';
import type { PoolClient } from 'pg';
import type { PublicProject, ProjectChangeLogEntry } from '../models/project.js';

const labels: Record<string, string> = {
  projectNumber: 'Project number',
  name: 'Name',
  customer: 'Customer',
  manager: 'Project manager',
  description: 'Description',
  secondaryTrayLength: 'Secondary tray length',
  supportDistance: 'Distance between supports',
  supportWeight: 'Support weight',
  additionalBendingPercent: 'Additional % for bending',
  endConnectionLength: 'For end connection',
  trayLoadSafetyFactor: 'Tray load safety factor',
  supportDistanceOverrides: 'Support overrides',
  trayPurposeTemplates: 'Tray report templates',
  cableLayout: 'Bundles configuration',
  cableSpacing: 'Cable spacing',
  considerBundleSpacingAsFree: 'Consider space between bundles as free',
  minFreeSpacePercent: 'Minimum free space (%)',
  maxFreeSpacePercent: 'Maximum free space (%)',
  mv: 'MV',
  power: 'Power',
  vfd: 'VFD',
  control: 'Control',
  maxRows: 'Max rows',
  maxColumns: 'Max columns',
  bundleSpacing: 'Space between bundles',
  trefoil: 'Trefoil',
  trefoilSpacingBetweenBundles: 'Space between trefoil bundles',
  applyPhaseRotation: 'Phase rotation',
  customBundleRanges: 'Custom bundle size ranges',
  distance: 'Distance (m)',
  supportId: 'Support ID',
  supportType: 'Support',
  fileId: 'File ID',
  fileName: 'File',
  contentType: 'Content type',
};
const object = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
const format = (value: unknown): string => {
  if (value == null) return 'Not specified';
  if (typeof value === 'boolean') return value ? 'Enabled' : 'Disabled';
  if (Array.isArray(value))
    return value.map((range) => `${range.min}–${range.max} mm`).join(', ') || 'Not specified';
  return String(value);
};

export const describeProjectChanges = (before: PublicProject, after: PublicProject): string[] => {
  const changes: string[] = [];
  const visit = (oldValue: unknown, newValue: unknown, path: string) => {
    if (Array.isArray(oldValue) || Array.isArray(newValue)) {
      if (format(oldValue) !== format(newValue))
        changes.push(`${path}: ${format(oldValue)} → ${format(newValue)}`);
    } else if (
      (typeof oldValue === 'object' && oldValue !== null) ||
      (typeof newValue === 'object' && newValue !== null)
    ) {
      const oldObject = object(oldValue),
        newObject = object(newValue);
      for (const key of new Set([...Object.keys(oldObject), ...Object.keys(newObject)])) {
        visit(oldObject[key], newObject[key], `${path} / ${labels[key] ?? key}`);
      }
    } else if ((oldValue ?? null) !== (newValue ?? null)) {
      changes.push(`${path}: ${format(oldValue)} → ${format(newValue)}`);
    }
  };
  for (const key of Object.keys(before) as (keyof PublicProject)[]) {
    if (['id', 'createdAt', 'updatedAt', 'changeLog'].includes(key)) continue;
    visit(before[key], after[key], labels[key] ?? key);
  }
  return changes;
};

export const recordProjectChanges = async (
  client: PoolClient,
  projectId: string,
  userId: string,
  before: PublicProject,
  after: PublicProject,
): Promise<ProjectChangeLogEntry | null> => {
  const changes = describeProjectChanges(before, after);
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
  await client.query(`UPDATE projects SET change_log = change_log || $2::jsonb WHERE id = $1`, [
    projectId,
    JSON.stringify([entry]),
  ]);
  return entry;
};
