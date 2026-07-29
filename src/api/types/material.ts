export type MaterialTray = {
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

export type MaterialCableType = {
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

export type MaterialCableInstallationMaterial = {
  id: string;
  type: string;
  purpose: string | null;
  material: string | null;
  description: string | null;
  manufacturer: string | null;
  partNo: string | null;
  createdAt: string;
  updatedAt: string;
};

export type MaterialSupport = {
  id: string;
  type: string;
  manufacturer: string | null;
  heightMm: number | null;
  widthMm: number | null;
  lengthMm: number | null;
  weightKg: number | null;
  imageTemplateId: string | null;
  imageTemplateFileName: string | null;
  imageTemplateContentType: string | null;
  createdAt: string;
  updatedAt: string;
};

export type MaterialLoadCurvePoint = {
  id: string;
  order: number;
  spanM: number;
  loadKnPerM: number;
  createdAt: string;
  updatedAt: string;
};

export type MaterialLoadCurve = {
  id: string;
  name: string;
  description: string | null;
  trayId: string | null;
  trayType: string | null;
  assignedTrayCount: number;
  assignedTrayTypes: string[];
  createdAt: string;
  updatedAt: string;
  points: MaterialLoadCurvePoint[];
};

export type MaterialLoadCurvePointInput = {
  spanM: number;
  loadKnPerM: number;
};

export type MaterialLoadCurveInput = {
  name: string;
  description?: string | null;
  trayId?: string | null;
  points?: MaterialLoadCurvePointInput[];
};

export type MaterialLoadCurveUpdateInput = {
  name?: string;
  description?: string | null;
  trayId?: string | null;
  points?: MaterialLoadCurvePointInput[];
};

export type MaterialLoadCurveSummary = {
  id: string;
  name: string;
  trayId: string | null;
  trayType: string | null;
  assignedTrayCount: number;
  assignedTrayTypes: string[];
};

export type MaterialImportSummary = {
  totalRows: number;
  created: number;
  updated: number;
  skipped: number;
};

export type MaterialLoadCurveImportSummary = {
  importedPoints: number;
};

export type MaterialCableTypeImportSummary = {
  inserted: number;
  updated: number;
  skipped: number;
};

export type MaterialCableInstallationMaterialImportSummary = {
  inserted: number;
  updated: number;
  skipped: number;
};

export type MaterialCableTypeInput = {
  name: string;
  purpose?: string | null;
  material?: string | null;
  description?: string | null;
  manufacturer?: string | null;
  partNo?: string | null;
  remarks?: string | null;
  diameterMm?: number | null;
  weightKgPerM?: number | null;
};

export type MaterialCableInstallationMaterialInput = {
  type: string;
  purpose?: string | null;
  material?: string | null;
  description?: string | null;
  manufacturer?: string | null;
  partNo?: string | null;
};

export type MaterialTrayInput = {
  type: string;
  manufacturer?: string | null;
  heightMm?: number | null;
  rungHeightMm?: number | null;
  widthMm?: number | null;
  weightKgPerM?: number | null;
  loadCurveId?: string | null;
  imageTemplateId?: string | null;
};

export type MaterialSupportInput = {
  type: string;
  manufacturer?: string | null;
  heightMm?: number | null;
  widthMm?: number | null;
  lengthMm?: number | null;
  weightKg?: number | null;
  imageTemplateId?: string | null;
};

export const STANDARD_MATERIAL_OWNER_CATEGORIES = [
  'cable-type',
  'cable-installation-material',
  'tray',
  'support',
] as const;

export type StandardMaterialOwnerCategory =
  (typeof STANDARD_MATERIAL_OWNER_CATEGORIES)[number];
export type MaterialDetailsCategory = StandardMaterialOwnerCategory | 'load-curve';
export type StandardMaterialUnit = 'pcs' | 'meters' | 'pcs/m';

export type MaterialCategoryMetadata = {
  key: MaterialDetailsCategory;
  label: string;
  supportsStandardMaterials: boolean;
};

export type StandardMaterialAssignment = {
  id: string;
  ownerId: string;
  ownerCategory: StandardMaterialOwnerCategory;
  referencedMaterialId: string;
  referencedMaterial: {
    id: string;
    type: string;
    purpose: string | null;
    material: string | null;
    description: string | null;
    manufacturer: string | null;
    partNo: string | null;
  };
  quantity: number;
  unit: StandardMaterialUnit;
  remarks: string | null;
  createdAt: string;
  updatedAt: string;
};

export type StandardMaterialInput = {
  referencedMaterialId: string;
  quantity: number;
  unit: StandardMaterialUnit;
  remarks?: string | null;
};

export type StandardMaterialOwner =
  | MaterialCableType
  | MaterialCableInstallationMaterial
  | MaterialTray
  | MaterialSupport;

export type MaterialDetailsResponse<T extends StandardMaterialOwner = StandardMaterialOwner> = {
  category: MaterialCategoryMetadata;
  material: T;
  standardMaterials: StandardMaterialAssignment[];
};
