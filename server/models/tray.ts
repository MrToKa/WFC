import type { ProjectChangeLogEntry } from './project.js';
import { trayLengthCalculationSchema, type TrayLengthCalculation, type TrayLengthSource } from '../../shared/trayAutoLength.js';

export type TrayRow = {
  change_log?: ProjectChangeLogEntry[];
  id: string;
  project_id: string;
  name: string;
  tray_type: string | null;
  purpose: string | null;
  width_mm: string | number | null;
  height_mm: string | number | null;
  length_mm: string | number | null;
  length_source?: TrayLengthSource;
  length_calculation?: unknown;
  include_grounding_cable: boolean | null;
  grounding_cable_type_id: string | null;
  use_trefoil_clamps?: boolean | null;
  trefoil_clamp_spacing_mm?: string | number | null;
  created_at: Date | string;
  updated_at: Date | string;
};

const toNumberOrNull = (value: string | number | null): number | null => {
  if (value === null || value === undefined) {
    return null;
  }

  const numericValue = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(numericValue) ? numericValue : null;
};

const toIsoString = (value: Date | string): string =>
  typeof value === 'string' ? value : value.toISOString();

export type PublicTray = {
  changeLog?: ProjectChangeLogEntry[];
  id: string;
  projectId: string;
  name: string;
  type: string | null;
  purpose: string | null;
  widthMm: number | null;
  heightMm: number | null;
  lengthMm: number | null;
  lengthSource: TrayLengthSource;
  lengthCalculation: TrayLengthCalculation | null;
  includeGroundingCable: boolean;
  groundingCableTypeId: string | null;
  useTrefoilClamps: boolean;
  trefoilClampSpacingMm: number;
  createdAt: string;
  updatedAt: string;
};

export const mapTrayRow = (row: TrayRow): PublicTray => {
  const lengthMm = toNumberOrNull(row.length_mm);
  const calculation = trayLengthCalculationSchema.safeParse(row.length_calculation);
  const automatic = row.length_source === 'auto' && calculation.success && calculation.data.lengthMm === lengthMm;
  return {
    changeLog: row.change_log ?? [],
    id: row.id,
    projectId: row.project_id,
    name: row.name,
    type: row.tray_type ?? null,
    purpose: row.purpose ?? null,
    widthMm: toNumberOrNull(row.width_mm),
    heightMm: toNumberOrNull(row.height_mm),
    lengthMm,
    lengthSource: automatic ? 'auto' : 'manual',
    lengthCalculation: automatic ? calculation.data : null,
    includeGroundingCable: Boolean(row.include_grounding_cable),
    groundingCableTypeId: row.grounding_cable_type_id ?? null,
    useTrefoilClamps: Boolean(row.use_trefoil_clamps),
    trefoilClampSpacingMm: toNumberOrNull(row.trefoil_clamp_spacing_mm ?? null) ?? 600,
    createdAt: toIsoString(row.created_at),
    updatedAt: toIsoString(row.updated_at),
  };
};
