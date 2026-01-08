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
  trayPurposeTemplates: Record<string, ProjectTrayPurposeTemplate>;
  cableLayout: ProjectCableLayout;
  createdAt: string;
  updatedAt: string;
};

export type ProjectSupportOverride = {
  distance: number | null;
  supportId: string | null;
  supportType: string | null;
};

export type ProjectTrayPurposeTemplate = {
  fileId: string;
  fileName: string | null;
  contentType: string | null;
};

export type ProjectTrayPurposeTemplateSelection =
  | {
      fileId: string;
    }
  | string
  | null;

export type ProjectSupportOverridePayload = {
  distance: number | null;
  supportId: string | null;
};

export type CableBundleSpacing = '0' | '1D' | '2D';

/**
 * Custom bundle size range for cable diameter grouping.
 * Used to override the default bundle size ranges.
 */
export type CustomBundleRange = {
  id: string;
  min: number;
  max: number;
};

export type CableCategoryKey = 'mv' | 'power' | 'vfd' | 'control';

export type ProjectCableCategorySettings = {
  maxRows: number | null;
  maxColumns: number | null;
  bundleSpacing: CableBundleSpacing | null;
  trefoil: boolean | null;
  trefoilSpacingBetweenBundles: boolean | null;
  applyPhaseRotation: boolean | null;
};

export type ProjectCableLayout = {
  cableSpacing: number | null;
  considerBundleSpacingAsFree: boolean | null;
  minFreeSpacePercent: number | null;
  maxFreeSpacePercent: number | null;
  mv: ProjectCableCategorySettings | null;
  power: ProjectCableCategorySettings | null;
  vfd: ProjectCableCategorySettings | null;
  control: ProjectCableCategorySettings | null;
  /**
   * Custom bundle size ranges per cable category.
   * When defined, cables are grouped by these ranges instead of default ranges.
   */
  customBundleRanges: Partial<Record<CableCategoryKey, CustomBundleRange[]>> | null;
};

export type ProjectCableCategorySettingsInput =
  | Partial<ProjectCableCategorySettings>
  | null;

export type ProjectCableLayoutInput = {
  cableSpacing?: number | null;
  considerBundleSpacingAsFree?: boolean | null;
  minFreeSpacePercent?: number | null;
  maxFreeSpacePercent?: number | null;
  mv?: ProjectCableCategorySettingsInput;
  power?: ProjectCableCategorySettingsInput;
  vfd?: ProjectCableCategorySettingsInput;
  control?: ProjectCableCategorySettingsInput;
  customBundleRanges?: Partial<Record<CableCategoryKey, CustomBundleRange[]>> | null;
} | null;
