export type MaterialSupportRow = {
  id: string;
  support_type: string;
  height_mm: string | number | null;
  width_mm: string | number | null;
  length_mm: string | number | null;
  weight_kg: string | number | null;
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

export type PublicMaterialSupport = {
  id: string;
  type: string;
  heightMm: number | null;
  widthMm: number | null;
  lengthMm: number | null;
  weightKg: number | null;
  createdAt: string;
  updatedAt: string;
};

export const mapMaterialSupportRow = (
  row: MaterialSupportRow
): PublicMaterialSupport => ({
  id: row.id,
  type: row.support_type,
  heightMm: toNumberOrNull(row.height_mm),
  widthMm: toNumberOrNull(row.width_mm),
  lengthMm: toNumberOrNull(row.length_mm),
  weightKg: toNumberOrNull(row.weight_kg),
  createdAt: toIsoString(row.created_at),
  updatedAt: toIsoString(row.updated_at)
});
