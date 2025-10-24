import { toNumberOrNull } from './cableType.js';

export type CableRow = {
  id: string;
  project_id: string;
  cable_id: string;
  tag: string | null;
  cable_type_id: string;
  from_location: string | null;
  to_location: string | null;
  routing: string | null;
  design_length: number | string | null;
  install_length: number | string | null;
  pull_date: Date | string | null;
  connected_from: Date | string | null;
  connected_to: Date | string | null;
  tested: Date | string | null;
  created_at: Date | string;
  updated_at: Date | string;
};

export type CableWithTypeRow = CableRow & {
  type_name: string;
  type_purpose: string | null;
  type_diameter_mm: string | number | null;
  type_weight_kg_per_m: string | number | null;
};

export type PublicCable = {
  id: string;
  projectId: string;
  cableId: string;
  tag: string | null;
  cableTypeId: string;
  typeName: string;
  purpose: string | null;
  diameterMm: number | null;
  weightKgPerM: number | null;
  fromLocation: string | null;
  toLocation: string | null;
  routing: string | null;
  designLength: number | null;
  installLength: number | null;
  pullDate: string | null;
  connectedFrom: string | null;
  connectedTo: string | null;
  tested: string | null;
  createdAt: string;
  updatedAt: string;
};

const toIsoString = (value: Date | string): string =>
  typeof value === 'string' ? value : value.toISOString();

const toDateOnlyString = (value: Date | string): string => {
  if (typeof value === 'string') {
    const match = /^(\d{4}-\d{2}-\d{2})/.exec(value);
    return match ? match[1] : value.slice(0, 10);
  }

  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, '0');
  const day = String(value.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

const toIntegerOrNull = (value: string | number | null): number | null => {
  if (value === null || value === undefined) {
    return null;
  }

  const numericValue = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(numericValue) ? Math.trunc(numericValue) : null;
};

export const mapCableRow = (row: CableWithTypeRow): PublicCable => ({
  id: row.id,
  projectId: row.project_id,
  cableId: row.cable_id,
  tag: row.tag ?? null,
  cableTypeId: row.cable_type_id,
  typeName: row.type_name,
  purpose: row.type_purpose ?? null,
  diameterMm: toNumberOrNull(row.type_diameter_mm),
  weightKgPerM: toNumberOrNull(row.type_weight_kg_per_m),
  fromLocation: row.from_location ?? null,
  toLocation: row.to_location ?? null,
  routing: row.routing ?? null,
  designLength: toIntegerOrNull(row.design_length),
  installLength: toIntegerOrNull(row.install_length),
  pullDate: row.pull_date ? toDateOnlyString(row.pull_date) : null,
  connectedFrom: row.connected_from ? toDateOnlyString(row.connected_from) : null,
  connectedTo: row.connected_to ? toDateOnlyString(row.connected_to) : null,
  tested: row.tested ? toDateOnlyString(row.tested) : null,
  createdAt: toIsoString(row.created_at),
  updatedAt: toIsoString(row.updated_at)
});
