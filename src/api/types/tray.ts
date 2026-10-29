import type { ProjectChangeLogEntry } from './project';
import type { TrayAutoLengthReference, TrayLengthCalculation, TrayLengthSource } from '../../../shared/trayAutoLength';

export type { TrayAutoLengthMeasurement, TrayAutoLengthReference, TrayLengthCalculation, TrayLengthSource } from '../../../shared/trayAutoLength';

export type Tray = {
  changeLog?: ProjectChangeLogEntry[];
  id: string;
  projectId: string;
  name: string;
  type: string | null;
  purpose: string | null;
  widthMm: number | null;
  heightMm: number | null;
  lengthMm: number | null;
  lengthSource?: TrayLengthSource;
  lengthCalculation?: TrayLengthCalculation | null;
  includeGroundingCable: boolean;
  groundingCableTypeId: string | null;
  useTrefoilClamps?: boolean;
  trefoilClampSpacingMm?: number;
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
  lengthSource?: TrayLengthSource;
  autoLengthReference?: TrayAutoLengthReference;
  approvedManualLengthMm?: number;
  includeGroundingCable?: boolean;
  groundingCableTypeId?: string | null;
  useTrefoilClamps?: boolean;
  trefoilClampSpacingMm?: number;
};
