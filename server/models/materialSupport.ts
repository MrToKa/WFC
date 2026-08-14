export type MaterialSupportRow = {
  id: string;
  support_type: string;
  manufacturer: string | null;
  height_mm: string | number | null;
  width_mm: string | number | null;
  length_mm: string | number | null;
  weight_kg: string | number | null;
  minimum_order_quantity: string | number;
  order_measurement: 'pcs' | 'pack' | 'meters';
  packaging: 'm' | 'Package' | 'Box' | 'Drum' | 'pcs';
  source: string | null;
  image_template_id: string | null;
  image_template_file_name: string | null;
  image_template_content_type: string | null;
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
  manufacturer: string | null;
  heightMm: number | null;
  widthMm: number | null;
  lengthMm: number | null;
  weightKg: number | null;
  minimumOrderQuantity: number;
  orderMeasurement: 'pcs' | 'pack' | 'meters';
  packaging: 'm' | 'Package' | 'Box' | 'Drum' | 'pcs';
  source: string | null;
  imageTemplateId: string | null;
  imageTemplateFileName: string | null;
  imageTemplateContentType: string | null;
  createdAt: string;
  updatedAt: string;
};

export const mapMaterialSupportRow = (row: MaterialSupportRow): PublicMaterialSupport => ({
  id: row.id,
  type: row.support_type,
  manufacturer: row.manufacturer ?? null,
  heightMm: toNumberOrNull(row.height_mm),
  widthMm: toNumberOrNull(row.width_mm),
  lengthMm: toNumberOrNull(row.length_mm),
  weightKg: toNumberOrNull(row.weight_kg),
  minimumOrderQuantity: toNumberOrNull(row.minimum_order_quantity) ?? 1,
  orderMeasurement: row.order_measurement,
  packaging: row.packaging,
  source: row.source ?? null,
  imageTemplateId: row.image_template_id ?? null,
  imageTemplateFileName: row.image_template_file_name ?? null,
  imageTemplateContentType: row.image_template_content_type ?? null,
  createdAt: toIsoString(row.created_at),
  updatedAt: toIsoString(row.updated_at),
});
