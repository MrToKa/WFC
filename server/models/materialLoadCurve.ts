export type MaterialLoadCurveRow = {
  id: string;
  name: string;
  description: string | null;
  tray_id: string | null;
  tray_type?: string | null;
  assigned_tray_count?: number | string | null;
  assigned_tray_types?: (string | null)[] | null;
  created_at: Date | string;
  updated_at: Date | string;
};

export type MaterialLoadCurvePointRow = {
  id: string;
  load_curve_id: string;
  point_order: number | string;
  span_m: number | string;
  load_kn_per_m: number | string;
  created_at: Date | string;
  updated_at: Date | string;
};

const toNumber = (value: number | string): number => {
  const numericValue = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(numericValue) ? numericValue : 0;
};

const toIsoString = (value: Date | string): string =>
  typeof value === 'string' ? value : value.toISOString();

export type PublicMaterialLoadCurvePoint = {
  id: string;
  order: number;
  spanM: number;
  loadKnPerM: number;
  createdAt: string;
  updatedAt: string;
};

export type PublicMaterialLoadCurveSummary = {
  id: string;
  name: string;
  trayId: string | null;
  trayType: string | null;
  assignedTrayCount: number;
  assignedTrayTypes: string[];
};

export type PublicMaterialLoadCurve = {
  id: string;
  name: string;
  description: string | null;
  trayId: string | null;
  trayType: string | null;
  assignedTrayCount: number;
  assignedTrayTypes: string[];
  createdAt: string;
  updatedAt: string;
  points: PublicMaterialLoadCurvePoint[];
};

export const mapMaterialLoadCurvePointRow = (
  row: MaterialLoadCurvePointRow
): PublicMaterialLoadCurvePoint => ({
  id: row.id,
  order: Number(toNumber(row.point_order)),
  spanM: toNumber(row.span_m),
  loadKnPerM: toNumber(row.load_kn_per_m),
  createdAt: toIsoString(row.created_at),
  updatedAt: toIsoString(row.updated_at)
});

export const mapMaterialLoadCurveSummary = (
  row: MaterialLoadCurveRow
): PublicMaterialLoadCurveSummary => ({
  id: row.id,
  name: row.name,
  trayId: row.tray_id ?? null,
  trayType: row.tray_type ?? null,
  assignedTrayCount: Number(row.assigned_tray_count ?? 0),
  assignedTrayTypes: Array.isArray(row.assigned_tray_types)
    ? row.assigned_tray_types.filter((type): type is string => Boolean(type))
    : []
});

export const mapMaterialLoadCurveRow = (
  row: MaterialLoadCurveRow,
  points: PublicMaterialLoadCurvePoint[]
): PublicMaterialLoadCurve => ({
  id: row.id,
  name: row.name,
  description: row.description ?? null,
  trayId: row.tray_id ?? null,
  trayType: row.tray_type ?? null,
  assignedTrayCount: Number(row.assigned_tray_count ?? 0),
  assignedTrayTypes: Array.isArray(row.assigned_tray_types)
    ? row.assigned_tray_types.filter((type): type is string => Boolean(type))
    : [],
  createdAt: toIsoString(row.created_at),
  updatedAt: toIsoString(row.updated_at),
  points
});
