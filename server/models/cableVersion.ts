import type { CableMtoValue } from './cable.js';

export type CableVersionChangeType = 'create' | 'update';
export type CableVersionChangeSource = 'manual' | 'import';

export type CableVersionRow = {
  id: string;
  cable_id: string;
  version_number: number;
  change_type: CableVersionChangeType;
  change_source: CableVersionChangeSource;
  cable_number: number | string;
  revision: string | null;
  mto: CableMtoValue | null;
  tag: string | null;
  cable_type_id: string;
  cable_type_name: string;
  from_location: string | null;
  to_location: string | null;
  routing: string | null;
  design_length: number | string | null;
  install_length: number | string | null;
  pull_date: Date | string | null;
  connected_from: Date | string | null;
  connected_to: Date | string | null;
  tested: Date | string | null;
  changed_by: string | null;
  created_at: Date | string;
  changed_by_first_name: string | null;
  changed_by_last_name: string | null;
  changed_by_email: string | null;
};

export type PublicCableVersion = {
  id: string;
  cableRecordId: string;
  versionNumber: number;
  changeType: CableVersionChangeType;
  changeSource: CableVersionChangeSource;
  cableId: number;
  revision: string | null;
  mto: CableMtoValue | null;
  tag: string | null;
  cableTypeId: string;
  typeName: string;
  fromLocation: string | null;
  toLocation: string | null;
  routing: string | null;
  designLength: number | null;
  installLength: number | null;
  pullDate: string | null;
  connectedFrom: string | null;
  connectedTo: string | null;
  tested: string | null;
  changedAt: string;
  changedBy: {
    id: string;
    firstName: string | null;
    lastName: string | null;
    email: string | null;
  } | null;
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

export const mapCableVersionRow = (row: CableVersionRow): PublicCableVersion => ({
  id: row.id,
  cableRecordId: row.cable_id,
  versionNumber: row.version_number,
  changeType: row.change_type,
  changeSource: row.change_source,
  cableId: Number(row.cable_number),
  revision: row.revision ?? null,
  mto: row.mto ?? null,
  tag: row.tag ?? null,
  cableTypeId: row.cable_type_id,
  typeName: row.cable_type_name,
  fromLocation: row.from_location ?? null,
  toLocation: row.to_location ?? null,
  routing: row.routing ?? null,
  designLength: toIntegerOrNull(row.design_length),
  installLength: toIntegerOrNull(row.install_length),
  pullDate: row.pull_date ? toDateOnlyString(row.pull_date) : null,
  connectedFrom: row.connected_from ? toDateOnlyString(row.connected_from) : null,
  connectedTo: row.connected_to ? toDateOnlyString(row.connected_to) : null,
  tested: row.tested ? toDateOnlyString(row.tested) : null,
  changedAt: toIsoString(row.created_at),
  changedBy: row.changed_by
    ? {
        id: row.changed_by,
        firstName: row.changed_by_first_name,
        lastName: row.changed_by_last_name,
        email: row.changed_by_email,
      }
    : null,
});
