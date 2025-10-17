export const toNumberOrNull = (
  value: string | number | null
): number | null => {
  if (value === null || value === undefined) {
    return null;
  }

  const numericValue = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(numericValue) ? numericValue : null;
};

export type CableTypeRow = {
  id: string;
  project_id: string;
  name: string;
  purpose: string | null;
  diameter_mm: string | number | null;
  weight_kg_per_m: string | number | null;
  created_at: Date | string;
  updated_at: Date | string;
};

export type PublicCableType = {
  id: string;
  projectId: string;
  name: string;
  purpose: string | null;
  diameterMm: number | null;
  weightKgPerM: number | null;
  createdAt: string;
  updatedAt: string;
};

export const mapCableTypeRow = (row: CableTypeRow): PublicCableType => ({
  id: row.id,
  projectId: row.project_id,
  name: row.name,
  purpose: row.purpose ?? null,
  diameterMm: toNumberOrNull(row.diameter_mm),
  weightKgPerM: toNumberOrNull(row.weight_kg_per_m),
  createdAt:
    typeof row.created_at === 'string'
      ? row.created_at
      : row.created_at.toISOString(),
  updatedAt:
    typeof row.updated_at === 'string'
      ? row.updated_at
      : row.updated_at.toISOString()
});
