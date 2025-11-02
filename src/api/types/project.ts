export type Project = {
  id: string;
  projectNumber: string;
  name: string;
  customer: string;
  manager: string | null;
  description: string | null;
  secondaryTrayLength: number | null;
  supportDistance: number | null;
  supportWeight: number | null;
  trayLoadSafetyFactor: number | null;
  supportDistanceOverrides: Record<string, ProjectSupportOverride>;
  cableLayout: ProjectCableLayout;
  createdAt: string;
  updatedAt: string;
};

export type ProjectSupportOverride = {
  distance: number | null;
  supportId: string | null;
  supportType: string | null;
};

export type ProjectSupportOverridePayload = {
  distance: number | null;
  supportId: string | null;
};

export type CableBundleSpacing = '0' | '1D' | '2D';

export type ProjectCableCategorySettings = {
  maxRows: number | null;
  maxColumns: number | null;
  bundleSpacing: CableBundleSpacing | null;
  trefoil: boolean | null;
  trefoilSpacingBetweenBundles: boolean | null;
};

export type ProjectCableLayout = {
  cableSpacing: number | null;
  mv: ProjectCableCategorySettings | null;
  power: ProjectCableCategorySettings | null;
  vfd: ProjectCableCategorySettings | null;
  control: ProjectCableCategorySettings | null;
};

export type ProjectCableCategorySettingsInput =
  | Partial<ProjectCableCategorySettings>
  | null;

export type ProjectCableLayoutInput = {
  cableSpacing?: number | null;
  mv?: ProjectCableCategorySettingsInput;
  power?: ProjectCableCategorySettingsInput;
  vfd?: ProjectCableCategorySettingsInput;
  control?: ProjectCableCategorySettingsInput;
} | null;
