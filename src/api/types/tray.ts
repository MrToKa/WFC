import type { MaterialTray, MaterialLoadCurve } from './material';

export type TrayMaterialSnapshot = {
  schemaVersion: 1;
  capturedAt: string;
  material: MaterialTray;
  loadCurve: MaterialLoadCurve | null;
  imageAvailable: boolean;
};

export type Tray = {
  id: string;
  projectId: string;
  name: string;
  type: string | null;
  purpose: string | null;
  widthMm: number | null;
  heightMm: number | null;
  lengthMm: number | null;
  includeGroundingCable: boolean;
  groundingCableTypeId: string | null;
  materialSnapshot?: TrayMaterialSnapshot | null;
  materialSnapshotStatus?: 'captured' | 'unknown';
  createdAt: string;
  updatedAt: string;
};

export type TrayInput = {
  name: string;
  type?: string | null;
  purpose?: string | null;
  widthMm?: number | null;
  heightMm?: number | null;
  lengthMm?: number | null;
  includeGroundingCable?: boolean;
  groundingCableTypeId?: string | null;
};
