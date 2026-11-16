// The catalogue categories that may carry optional STEP files. Never accept a
// caller-supplied table or column name when resolving a material owner.
export const materialCadOwners = {
  support: { table: 'material_supports', column: 'material_support_id', name: 'support_type' },
  instrument: { table: 'material_instruments', column: 'material_instrument_id', name: 'type' },
  'cable-installation-material': { table: 'material_cable_installation_materials', column: 'material_cable_installation_material_id', name: 'type' },
  'tray-installation-material': { table: 'material_tray_installation_materials', column: 'material_tray_installation_material_id', name: 'type' },
  'instrument-installation-material': { table: 'material_instrument_installation_materials', column: 'material_instrument_installation_material_id', name: 'type' },
} as const;

export type MaterialCadOwnerCategory = keyof typeof materialCadOwners;
export const materialCadOwnerCategories = Object.keys(materialCadOwners) as [MaterialCadOwnerCategory, ...MaterialCadOwnerCategory[]];
export const materialCadOwnerColumns = Object.values(materialCadOwners).map(owner => owner.column);
export const ordinaryComponentCondition = materialCadOwnerColumns.map(column => `c.${column} IS NULL`).join(' AND ');
