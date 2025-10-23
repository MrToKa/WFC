import { toNumberOrNull } from './cableType.js';

export type ProjectRow = {
  id: string;
  project_number: string;
  name: string;
  customer: string;
  manager: string | null;
  description: string | null;
  secondary_tray_length: string | number | null;
  support_distance: string | number | null;
  support_weight: string | number | null;
  support_distances: Record<string, unknown> | null;
  created_at: Date | string;
  updated_at: Date | string;
};

export type PublicProject = {
  id: string;
  projectNumber: string;
  name: string;
  customer: string;
  manager: string | null;
  description: string | null;
  secondaryTrayLength: number | null;
  supportDistance: number | null;
  supportWeight: number | null;
  supportDistanceOverrides: Record<string, number>;
  createdAt: string;
  updatedAt: string;
};

const toSupportDistanceOverrides = (
  value: Record<string, unknown> | null
): Record<string, number> => {
  if (!value) {
    return {};
  }

  return Object.entries(value).reduce<Record<string, number>>(
    (acc, [trayType, rawDistance]) => {
      if (typeof rawDistance === 'number' && Number.isFinite(rawDistance)) {
        acc[trayType] = rawDistance;
        return acc;
      }

      if (typeof rawDistance === 'string') {
        const normalized = rawDistance.trim().replace(',', '.');
        if (normalized === '') {
          return acc;
        }
        const parsed = Number(normalized);
        if (Number.isFinite(parsed)) {
          acc[trayType] = parsed;
        }
      }

      return acc;
    },
    {}
  );
};

export const mapProjectRow = (row: ProjectRow): PublicProject => ({
  id: row.id,
  projectNumber: row.project_number,
  name: row.name,
  customer: row.customer,
  manager: row.manager ?? null,
  description: row.description ?? null,
  secondaryTrayLength: toNumberOrNull(row.secondary_tray_length),
  supportDistance: toNumberOrNull(row.support_distance),
  supportWeight: toNumberOrNull(row.support_weight),
  supportDistanceOverrides: toSupportDistanceOverrides(row.support_distances),
  createdAt:
    typeof row.created_at === 'string'
      ? row.created_at
      : row.created_at.toISOString(),
  updatedAt:
    typeof row.updated_at === 'string'
      ? row.updated_at
      : row.updated_at.toISOString()
});
