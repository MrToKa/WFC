export const EQUIPMENT_NAME_MATCHING_POLICY: 'wfc.pf.equipment-model-leading-slash.v1';
/** Raw SDK and canonical {category,name,value} own readable scalar values only. */
export function humanScalarPropertyValues(properties: readonly unknown[]): string[];
/** Model evidence keys only; does not normalize persisted project aliases. */
export function modelEquipmentMatchKeys(value: unknown): string[];
