export type MaterialTrayRow = {
  id: string;
  tray_type: string;
  height_mm: string | number | null;
  width_mm: string | number | null;
  weight_kg_per_m: string | number | null;
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

export type PublicMaterialTray = {
  id: string;
  type: string;
  heightMm: number | null;
  widthMm: number | null;
  weightKgPerM: number | null;
  createdAt: string;
  updatedAt: string;
};

export const mapMaterialTrayRow = (row: MaterialTrayRow): PublicMaterialTray => ({
  id: row.id,
  type: row.tray_type,
  heightMm: toNumberOrNull(row.height_mm),
  widthMm: toNumberOrNull(row.width_mm),
  weightKgPerM: toNumberOrNull(row.weight_kg_per_m),
  createdAt: toIsoString(row.created_at),
  updatedAt: toIsoString(row.updated_at)
});
