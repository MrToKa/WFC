export const TRAY_PURPOSE_OPTIONS = [
  'Medium voltage cable tray',
  'Low voltage cable tray',
  'EMC cable tray',
  'Instrumentation and control cables tray',
  'LV and I and C cable tray'
] as const;

export type TrayPurposeOption = (typeof TRAY_PURPOSE_OPTIONS)[number];
