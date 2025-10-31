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
