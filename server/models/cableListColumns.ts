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
  'autoCalculatedLength',
  'designLength',
  'installLength',
  'pullDate',
  'connectedFrom',
  'connectedTo',
  'tested',
  'actions',
] as const;

export type CableListColumnId = (typeof CABLE_LIST_COLUMN_IDS)[number];
const executionColumns = new Set<CableListColumnId>([
  'installLength',
  'pullDate',
  'connectedFrom',
  'connectedTo',
  'tested',
]);
export const DEFAULT_CABLE_LIST_COLUMN_IDS = CABLE_LIST_COLUMN_IDS.filter(
  (id) => !executionColumns.has(id),
);
