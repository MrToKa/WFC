export type CableType = {
  id: string;
  projectId: string;
  name: string;
  tag: string | null;
  purpose: string | null;
  diameterMm: number | null;
  weightKgPerM: number | null;
  fromLocation: string | null;
  toLocation: string | null;
  routing: string | null;
  createdAt: string;
  updatedAt: string;
};

export type Cable = {
  id: string;
  projectId: string;
  cableId: number;
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

export type CableTypeInput = {
  name: string;
  tag?: string | null;
  purpose?: string | null;
  diameterMm?: number | null;
  weightKgPerM?: number | null;
  fromLocation?: string | null;
  toLocation?: string | null;
  routing?: string | null;
};

export type CableInput = {
  cableId: number;
  tag?: string | null;
  cableTypeId: string;
  fromLocation?: string | null;
  toLocation?: string | null;
  routing?: string | null;
  designLength?: number | null;
  installLength?: number | null;
  pullDate?: string | null;
  connectedFrom?: string | null;
  connectedTo?: string | null;
  tested?: string | null;
};

export type CableImportSummary = {
  inserted: number;
  updated: number;
  skipped: number;
};

export type CableSortColumn =
  | 'tag'
  | 'typeName'
  | 'fromLocation'
  | 'toLocation'
  | 'routing';

export type CableSortDirection = 'asc' | 'desc';
