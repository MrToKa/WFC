export const EQUIPMENT_NAME_MATCHING_POLICY: 'wfc.pf.equipment-model-leading-slash.v1';
/** Raw SDK and canonical {category,name,value} own readable scalar values only. */
export function humanScalarPropertyValues(properties: readonly unknown[]): string[];
/** Conservative source-object identity; no grouping or candidate exclusion. */
export function equipmentObjectIdentity(properties: readonly unknown[]): { guid: string; sourceFile: string } | null;
/** Model evidence keys only; does not normalize persisted project aliases. */
export function modelEquipmentMatchKeys(value: unknown): string[];
