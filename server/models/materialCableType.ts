export type MaterialCableTypeRow = {
  id: string;
  name: string;
  purpose: string | null;
  material: string | null;
  description: string | null;
  manufacturer: string | null;
  part_no: string | null;
  remarks: string | null;
  diameter_mm: string | number | null;
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

export type PublicMaterialCableType = {
  id: string;
  name: string;
  purpose: string | null;
  material: string | null;
  description: string | null;
  manufacturer: string | null;
  partNo: string | null;
  remarks: string | null;
  diameterMm: number | null;
  weightKgPerM: number | null;
  createdAt: string;
  updatedAt: string;
};

export const mapMaterialCableTypeRow = (row: MaterialCableTypeRow): PublicMaterialCableType => ({
  id: row.id,
  name: row.name,
  purpose: row.purpose ?? null,
  material: row.material ?? null,
  description: row.description ?? null,
  manufacturer: row.manufacturer ?? null,
  partNo: row.part_no ?? null,
  remarks: row.remarks ?? null,
  diameterMm: toNumberOrNull(row.diameter_mm),
  weightKgPerM: toNumberOrNull(row.weight_kg_per_m),
  createdAt: toIsoString(row.created_at),
  updatedAt: toIsoString(row.updated_at),
});
