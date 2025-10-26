export type TrayRow = {
  id: string;
  project_id: string;
  name: string;
  tray_type: string | null;
  purpose: string | null;
  width_mm: string | number | null;
  height_mm: string | number | null;
  length_mm: string | number | null;
  include_grounding_cable: boolean | null;
  grounding_cable_type_id: string | null;
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
  id: string;
  projectId: string;
  name: string;
  type: string | null;
  purpose: string | null;
  widthMm: number | null;
  heightMm: number | null;
  lengthMm: number | null;
  includeGroundingCable: boolean;
  groundingCableTypeId: string | null;
  createdAt: string;
  updatedAt: string;
};

export const mapTrayRow = (row: TrayRow): PublicTray => ({
  id: row.id,
  projectId: row.project_id,
  name: row.name,
  type: row.tray_type ?? null,
  purpose: row.purpose ?? null,
  widthMm: toNumberOrNull(row.width_mm),
  heightMm: toNumberOrNull(row.height_mm),
  lengthMm: toNumberOrNull(row.length_mm),
  includeGroundingCable: Boolean(row.include_grounding_cable),
  groundingCableTypeId: row.grounding_cable_type_id ?? null,
  createdAt: toIsoString(row.created_at),
  updatedAt: toIsoString(row.updated_at)
});
