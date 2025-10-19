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
  install_length: number | string | null;
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
  installLength: number | null;
  connectedFrom: string | null;
  connectedTo: string | null;
  tested: string | null;
  createdAt: string;
  updatedAt: string;
};

const toIsoString = (value: Date | string): string =>
  typeof value === 'string' ? value : value.toISOString();

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
  installLength: toIntegerOrNull(row.install_length),
  connectedFrom: row.connected_from
    ? toIsoString(row.connected_from).slice(0, 10)
    : null,
  connectedTo: row.connected_to ? toIsoString(row.connected_to).slice(0, 10) : null,
  tested: row.tested ? toIsoString(row.tested).slice(0, 10) : null,
  createdAt: toIsoString(row.created_at),
  updatedAt: toIsoString(row.updated_at)
});
