import type { ProjectChangeLogEntry } from '../models/project.js';

type Values = Record<string, unknown>;
export type MaterialChangeEvent = {
  kind: 'material' | 'standard-material' | 'point';
  key: string;
  label: string | null;
  before: Values | null;
  after: Values | null;
};
export type MaterialChangeLogRow = {
  id: string;
  user_id: string | null;
  user_name: string;
  changed_at: Date | string;
  events: MaterialChangeEvent[];
};

const labels: Record<string, string> = {
  name: 'Name',
  type: 'Type',
  tray_type: 'Type',
  support_type: 'Type',
  purpose: 'Purpose',
  material: 'Material',
  description: 'Description',
  manufacturer: 'Manufacturer',
  part_no: 'Part No.',
  remarks: 'Remarks',
  diameter_mm: 'Diameter [mm]',
  dimension_mm: 'Dimension [mm]',
  height_mm: 'Height [mm]',
  rung_height_mm: 'Rung height [mm]',
  width_mm: 'Width [mm]',
  length_mm: 'Length [mm]',
  weight_kg: 'Weight [kg]',
  weight_kg_per_m: 'Weight [kg/m]',
  unit_price: 'Price',
  minimum_order_quantity: 'Minimum order quantity',
  order_measurement: 'Order measurement',
  packaging: 'Packaging',
  source: 'Source',
  load_curve_id: 'Load curve',
  image_template_id: 'Image template',
  tray_id: 'Tray',
  referenced_material_id: 'Material ID',
  quantity: 'Quantity',
  unit: 'Unit',
  span_m: 'Span [m]',
  load_kn_per_m: 'Load [kN/m]',
  point_order: 'Point order',
};
const format = (value: unknown): string =>
  value == null || value === '' ? 'Not specified' : String(value);

export const describeMaterialEvents = (events: MaterialChangeEvent[]): string[] => {
  // Imports replace curve points with fresh IDs. Compare their final values by
  // point order and collapse changes in one transaction into a single edit.
  const merged = new Map<string, MaterialChangeEvent>();
  for (const event of events) {
    const key = `${event.kind}:${event.key}`;
    const first = merged.get(key);
    merged.set(key, first ? { ...event, before: first.before } : { ...event });
  }
  const changes: string[] = [];
  for (const event of merged.values()) {
    if (!event.before && !event.after) continue;
    const prefix =
      event.kind === 'standard-material'
        ? `Standard Material "${event.label ?? event.key}"`
        : event.kind === 'point'
          ? `Point ${event.key}`
          : 'Material';
    const operation = !event.before ? 'created' : !event.after ? 'deleted' : null;
    if (operation) changes.push(`${prefix} ${operation}.`);
    const keys = new Set([...Object.keys(event.before ?? {}), ...Object.keys(event.after ?? {})]);
    for (const key of keys) {
      if (key === 'id' || key === 'created_at' || key === 'updated_at') continue;
      // Owner foreign keys identify the parent and are not editable child values.
      if (
        event.kind === 'standard-material' &&
        key.endsWith('_id') &&
        key !== 'referenced_material_id'
      )
        continue;
      if (event.kind === 'point' && (key === 'load_curve_id' || key === 'point_order')) continue;
      const before = format(event.before?.[key]);
      const after = format(event.after?.[key]);
      if (before === after) continue;
      const label = labels[key] ?? key.replaceAll('_', ' ');
      changes.push(
        `${event.kind === 'material' ? '' : `${prefix} / `}${label}: ${before} → ${after}`,
      );
    }
  }
  return changes;
};

export const mapMaterialChangeLogRow = (row: MaterialChangeLogRow): ProjectChangeLogEntry => ({
  id: String(row.id),
  userId: row.user_id ?? '',
  userName: row.user_name,
  changedAt: typeof row.changed_at === 'string' ? row.changed_at : row.changed_at.toISOString(),
  changes: describeMaterialEvents(row.events),
});
