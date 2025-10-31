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
