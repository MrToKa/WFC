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

export type MaterialSupport = {
  id: string;
  type: string;
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
  heightMm?: number | null;
  widthMm?: number | null;
  lengthMm?: number | null;
  weightKg?: number | null;
  imageTemplateId?: string | null;
};
