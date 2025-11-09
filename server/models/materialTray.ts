export type MaterialTrayRow = {
  id: string;
  tray_type: string;
  manufacturer: string | null;
  height_mm: string | number | null;
  rung_height_mm: string | number | null;
  width_mm: string | number | null;
  weight_kg_per_m: string | number | null;
  load_curve_id: string | null;
  image_template_id: string | null;
  image_template_file_name: string | null;
  image_template_content_type: string | null;
  load_curve_name?: string | null;
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
  manufacturer: string | null;
  heightMm: number | null;
  rungHeightMm: number | null;
  widthMm: number | null;
  weightKgPerM: number | null;
  loadCurveId: string | null;
  loadCurveName: string | null;
  imageTemplateId: string | null;
  imageTemplateFileName: string | null;
  imageTemplateContentType: string | null;
  createdAt: string;
  updatedAt: string;
};

export const mapMaterialTrayRow = (row: MaterialTrayRow): PublicMaterialTray => ({
  id: row.id,
  type: row.tray_type,
  manufacturer: row.manufacturer ?? null,
  heightMm: toNumberOrNull(row.height_mm),
  rungHeightMm: toNumberOrNull(row.rung_height_mm),
  widthMm: toNumberOrNull(row.width_mm),
  weightKgPerM: toNumberOrNull(row.weight_kg_per_m),
  loadCurveId: row.load_curve_id ?? null,
  loadCurveName: row.load_curve_name ?? null,
  imageTemplateId: row.image_template_id ?? null,
  imageTemplateFileName: row.image_template_file_name ?? null,
  imageTemplateContentType: row.image_template_content_type ?? null,
  createdAt: toIsoString(row.created_at),
  updatedAt: toIsoString(row.updated_at)
});
