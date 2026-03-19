import type { MaterialCableType } from './material';

export const CABLE_MTO_OPTIONS = ['MV', 'LV', 'Instrumentation', 'Control'] as const;

export type CableMtoOption = (typeof CABLE_MTO_OPTIONS)[number];

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
  revision: string | null;
  mto: CableMtoOption | null;
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
  revision?: string | null;
  mto?: CableMtoOption | null;
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

export type CableSortColumn = 'tag' | 'typeName' | 'fromLocation' | 'toLocation' | 'routing';

export type CableSortDirection = 'asc' | 'desc';

export type CableTypeDefaultMaterial = {
  id: string;
  cableTypeId: string;
  name: string;
  quantity: number | null;
  unit: string | null;
  remarks: string | null;
  createdAt: string;
  updatedAt: string;
};

export type CableTypeDefaultMaterialInput = {
  name: string;
  quantity?: number | null;
  unit?: string | null;
  remarks?: string | null;
};

export type CableMaterialSource = 'default' | 'manual';

export type CableMaterial = {
  id: string;
  cableId: string;
  name: string;
  quantity: number | null;
  unit: string | null;
  remarks: string | null;
  source: CableMaterialSource | null;
  cableTypeDefaultMaterialId: string | null;
  createdAt: string;
  updatedAt: string;
};

export type CableMaterialInput = {
  name: string;
  quantity?: number | null;
  unit?: string | null;
  remarks?: string | null;
};

export type CableTypeDetails = {
  cableType: CableType;
  materialCableType: MaterialCableType | null;
  defaultMaterials: CableTypeDefaultMaterial[];
  cableCount: number;
};

export type CableDetails = {
  cable: Cable;
  materialCableType: MaterialCableType | null;
  cableTypeDefaultMaterials: CableTypeDefaultMaterial[];
  cableMaterials: CableMaterial[];
};

export type CableMaterialSyncSummary = {
  added: number;
  updated: number;
  removed: number;
  hasChanges: boolean;
};

export type CableReportMaterialSummary = {
  name: string;
  unit: string;
  totalQuantity: number;
  cableCount: number;
  missingDesignLengthCount: number;
};

export type CableReportCableTypeSummary = {
  cableTypeId: string;
  typeName: string;
  cableCount: number;
  totalDesignLength: number;
  materials: CableReportMaterialSummary[];
};

export type CableReportSummary = {
  cableCount: number;
  cableTypeCount: number;
  totalDesignLength: number;
  omittedMaterialCount: number;
  missingDesignLengthMaterialCount: number;
  cableTypeSummaries: CableReportCableTypeSummary[];
};
