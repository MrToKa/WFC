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
  tray_load_safety_factor: string | number | null;
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
  trayLoadSafetyFactor: number | null;
  supportDistanceOverrides: Record<string, PublicTraySupportOverride>;
  createdAt: string;
  updatedAt: string;
};

const parseNumericValue = (value: unknown): number | null => {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null;
  }

  if (typeof value === 'string') {
    const normalized = value.trim().replace(',', '.');
    if (normalized === '') {
      return null;
    }
    const parsed = Number(normalized);
    return Number.isFinite(parsed) ? parsed : null;
  }

  return null;
};

export type PublicTraySupportOverride = {
  distance: number | null;
  supportId: string | null;
  supportType: string | null;
};

const toSupportDistanceOverrides = (
  value: Record<string, unknown> | null
): Record<string, PublicTraySupportOverride> => {
  if (!value) {
    return {};
  }

  return Object.entries(value).reduce<Record<string, PublicTraySupportOverride>>(
    (acc, [trayType, raw]) => {
      if (raw === null || raw === undefined) {
        return acc;
      }

      if (typeof raw === 'number' || typeof raw === 'string') {
        const parsed = parseNumericValue(raw);
        if (parsed !== null) {
          acc[trayType] = {
            distance: parsed,
            supportId: null,
            supportType: null
          };
        }
        return acc;
      }

      if (typeof raw === 'object') {
        const rawRecord = raw as Record<string, unknown>;
        const distance = parseNumericValue(rawRecord.distance);
        const supportId =
          typeof rawRecord.supportId === 'string' && rawRecord.supportId.trim() !== ''
            ? rawRecord.supportId.trim()
            : null;
        const supportType =
          typeof rawRecord.supportType === 'string' && rawRecord.supportType.trim() !== ''
            ? rawRecord.supportType.trim()
            : null;

        if (distance !== null || supportId !== null || supportType !== null) {
          acc[trayType] = {
            distance,
            supportId,
            supportType
          };
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
  trayLoadSafetyFactor: toNumberOrNull(row.tray_load_safety_factor),
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
