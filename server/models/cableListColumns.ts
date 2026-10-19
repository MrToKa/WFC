export const CABLE_LIST_COLUMN_IDS = [
  'cableId',
  'revision',
  'mto',
  'tag',
  'typeName',
  'diameterMm',
  'weightKgPerM',
  'fromLocation',
  'toLocation',
  'routing',
  'delivery',
  'designLength',
  'actions',
] as const;

export type CableListColumnId = (typeof CABLE_LIST_COLUMN_IDS)[number];
