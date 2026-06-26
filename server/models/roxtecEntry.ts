export type RoxtecEntryRow = {
  project_id: string;
  id: number;
  revision: string;
  tag: string;
  type: string;
  description: string | null;
  created_at: Date | string;
  updated_at: Date | string;
};

export type PublicRoxtecEntry = {
  projectId: string;
  id: number;
  revision: string;
  tag: string;
  type: string;
  description: string | null;
  createdAt: string;
  updatedAt: string;
};

const toIsoString = (value: Date | string): string =>
  typeof value === 'string' ? value : value.toISOString();

export const mapRoxtecEntryRow = (
  row: RoxtecEntryRow
): PublicRoxtecEntry => ({
  projectId: row.project_id,
  id: row.id,
  revision: row.revision,
  tag: row.tag,
  type: row.type,
  description: row.description,
  createdAt: toIsoString(row.created_at),
  updatedAt: toIsoString(row.updated_at)
});