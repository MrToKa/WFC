export const CABLE_LIST_COLUMN_IDS = [
  'cableId',
  'revision',
  'mto',
  'tag',
  'typeName',
  'fromLocation',
  'toLocation',
  'routing',
  'autoCalculatedLength',
  'designLength',
  'actions',
] as const;

export type CableListColumnId = (typeof CABLE_LIST_COLUMN_IDS)[number];
