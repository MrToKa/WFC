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
  tray_purpose_templates: Record<string, unknown> | null;
  cable_layout_settings: Record<string, unknown> | null;
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
  trayPurposeTemplates: Record<string, PublicTrayPurposeTemplate>;
  cableLayout: PublicCableLayout;
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

export type PublicTrayPurposeTemplate = {
  fileId: string;
  fileName: string | null;
  contentType: string | null;
};

export type CableBundleSpacing = '0' | '1D' | '2D';

export type PublicCableCategorySettings = {
  maxRows: number | null;
  maxColumns: number | null;
  bundleSpacing: CableBundleSpacing | null;
  trefoil: boolean | null;
  trefoilSpacingBetweenBundles: boolean | null;
  applyPhaseRotation: boolean | null;
};

export type PublicCableLayout = {
  cableSpacing: number | null;
  considerBundleSpacingAsFree: boolean | null;
  minFreeSpacePercent: number | null;
  maxFreeSpacePercent: number | null;
  mv: PublicCableCategorySettings | null;
  power: PublicCableCategorySettings | null;
  vfd: PublicCableCategorySettings | null;
  control: PublicCableCategorySettings | null;
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

const toTrayPurposeTemplates = (
  value: Record<string, unknown> | null
): Record<string, PublicTrayPurposeTemplate> => {
  if (!value) {
    return {};
  }

  return Object.entries(value).reduce<Record<string, PublicTrayPurposeTemplate>>(
    (acc, [purpose, raw]) => {
      const trimmedPurpose = purpose.trim();
      if (!trimmedPurpose || !raw || typeof raw !== 'object') {
        return acc;
      }

      const record = raw as Record<string, unknown>;
      const fileId =
        typeof record.fileId === 'string' && record.fileId.trim() !== ''
          ? record.fileId.trim()
          : null;

      if (!fileId) {
        return acc;
      }

      const fileName =
        typeof record.fileName === 'string' && record.fileName.trim() !== ''
          ? record.fileName.trim()
          : null;
      const contentType =
        typeof record.contentType === 'string' && record.contentType.trim() !== ''
          ? record.contentType.trim()
          : null;

      acc[trimmedPurpose] = {
        fileId,
        fileName,
        contentType
      };

      return acc;
    },
    {}
  );
};

const parseIntegerValue = (value: unknown): number | null => {
  if (typeof value === 'number') {
    return Number.isInteger(value) ? value : null;
  }

  if (typeof value === 'string') {
    const normalized = value.trim();
    if (normalized === '') {
      return null;
    }

    const parsed = Number(normalized);
    return Number.isInteger(parsed) ? parsed : null;
  }

  return null;
};

const parseBundleSpacing = (value: unknown): CableBundleSpacing | null => {
  if (value === null || value === undefined) {
    return null;
  }

  if (typeof value !== 'string') {
    return null;
  }

  const normalized = value.trim().toUpperCase();
  return normalized === '0' || normalized === '1D' || normalized === '2D'
    ? (normalized as CableBundleSpacing)
    : null;
};

const parseTrefoil = (value: unknown): boolean | null => {
  if (typeof value === 'boolean') {
    return value;
  }
  return null;
};

const parseTrefoilSpacingBetweenBundles = (value: unknown): boolean | null => {
  if (typeof value === 'boolean') {
    return value;
  }
  return null;
};

const parseApplyPhaseRotation = (value: unknown): boolean | null => {
  if (typeof value === 'boolean') {
    return value;
  }
  return null;
};

const parseConsiderBundleSpacingAsFree = (value: unknown): boolean | null => {
  if (typeof value === 'boolean') {
    return value;
  }
  return null;
};

const parseCableSpacing = (value: unknown): number | null => {
  const numeric = parseNumericValue(value);
  if (numeric === null) {
    return null;
  }

  if (numeric < 1 || numeric > 5) {
    return null;
  }

  return Math.round(numeric * 1000) / 1000;
};

const parseFreeSpacePercent = (value: unknown): number | null => {
  const numeric = parseNumericValue(value);
  if (numeric === null) {
    return null;
  }

  if (!Number.isInteger(numeric)) {
    return null;
  }

  if (numeric < 1 || numeric > 100) {
    return null;
  }

  return numeric;
};

const parseCategorySettings = (
  value: unknown
): PublicCableCategorySettings | null => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }

  const record = value as Record<string, unknown>;
  const parsed: PublicCableCategorySettings = {
    maxRows: parseIntegerValue(record.maxRows),
    maxColumns: parseIntegerValue(record.maxColumns),
    bundleSpacing: parseBundleSpacing(record.bundleSpacing),
    trefoil: parseTrefoil(record.trefoil),
    trefoilSpacingBetweenBundles: parseTrefoilSpacingBetweenBundles(
      record.trefoilSpacingBetweenBundles
    ),
    applyPhaseRotation: parseApplyPhaseRotation(record.applyPhaseRotation)
  };

  if (
    parsed.maxRows === null &&
    parsed.maxColumns === null &&
    parsed.bundleSpacing === null &&
    parsed.trefoil === null &&
    parsed.trefoilSpacingBetweenBundles === null &&
    parsed.applyPhaseRotation === null
  ) {
    return null;
  }

  return parsed;
};

const toCableLayoutSettings = (value: unknown): PublicCableLayout => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {
      cableSpacing: null,
      considerBundleSpacingAsFree: null,
      minFreeSpacePercent: null,
      maxFreeSpacePercent: null,
      mv: null,
      power: null,
      vfd: null,
      control: null
    };
  }

  const record = value as Record<string, unknown>;

  return {
    cableSpacing: parseCableSpacing(record.cableSpacing),
    considerBundleSpacingAsFree: parseConsiderBundleSpacingAsFree(
      record.considerBundleSpacingAsFree
    ),
    minFreeSpacePercent: parseFreeSpacePercent(record.minFreeSpacePercent),
    maxFreeSpacePercent: parseFreeSpacePercent(record.maxFreeSpacePercent),
    mv: parseCategorySettings(record.mv),
    power: parseCategorySettings(record.power),
    vfd: parseCategorySettings(record.vfd),
    control: parseCategorySettings(record.control)
  };
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
  trayPurposeTemplates: toTrayPurposeTemplates(row.tray_purpose_templates),
  cableLayout: toCableLayoutSettings(row.cable_layout_settings),
  createdAt:
    typeof row.created_at === 'string'
      ? row.created_at
      : row.created_at.toISOString(),
  updatedAt:
    typeof row.updated_at === 'string'
      ? row.updated_at
      : row.updated_at.toISOString()
});
