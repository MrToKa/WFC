export const STANDARD_MATERIAL_OWNER_CATEGORIES = [
  'cable-type',
  'cable-installation-material',
  'tray-installation-material',
  'tray',
  'support',
] as const;

export const STANDARD_MATERIAL_UNITS = ['pcs', 'meters', 'pcs/m'] as const;

export type StandardMaterialOwnerCategory =
  (typeof STANDARD_MATERIAL_OWNER_CATEGORIES)[number];

export const STANDARD_MATERIAL_REFERENCE_CATEGORIES = [
  'cable-installation-material',
  'tray-installation-material',
] as const;

export type StandardMaterialReferenceCategory =
  (typeof STANDARD_MATERIAL_REFERENCE_CATEGORIES)[number];

export type StandardMaterialUnit = (typeof STANDARD_MATERIAL_UNITS)[number];

export type StandardMaterialAssignmentRow = {
  id: string;
  owner_id: string;
  owner_category: StandardMaterialOwnerCategory;
  referenced_material_id: string;
  referenced_material_category: StandardMaterialReferenceCategory;
  referenced_material_name: string;
  referenced_material_purpose: string | null;
  referenced_material_material: string | null;
  referenced_material_description: string | null;
  referenced_material_manufacturer: string | null;
  referenced_material_part_no: string | null;
  referenced_material_minimum_order_quantity: string | number;
  referenced_material_order_measurement: 'pcs' | 'pack' | 'meters';
  referenced_material_packaging: 'm' | 'Package' | 'Box' | 'Drum' | 'pcs';
  quantity: string | number;
  unit: StandardMaterialUnit;
  remarks: string | null;
  created_at: Date | string;
  updated_at: Date | string;
};

export type StandardMaterialAssignment = {
  id: string;
  ownerId: string;
  ownerCategory: StandardMaterialOwnerCategory;
  referencedMaterialId: string;
  referencedMaterialCategory: StandardMaterialReferenceCategory;
  referencedMaterial: {
    id: string;
    type: string;
    purpose: string | null;
    material: string | null;
    description: string | null;
    manufacturer: string | null;
    partNo: string | null;
    minimumOrderQuantity: number;
    orderMeasurement: 'pcs' | 'pack' | 'meters';
    packaging: 'm' | 'Package' | 'Box' | 'Drum' | 'pcs';
  };
  quantity: number;
  unit: StandardMaterialUnit;
  remarks: string | null;
  createdAt: string;
  updatedAt: string;
};

const toIsoString = (value: Date | string): string =>
  typeof value === 'string' ? value : value.toISOString();

export const mapStandardMaterialAssignmentRow = (
  row: StandardMaterialAssignmentRow,
): StandardMaterialAssignment => ({
  id: row.id,
  ownerId: row.owner_id,
  ownerCategory: row.owner_category,
  referencedMaterialId: row.referenced_material_id,
  referencedMaterialCategory: row.referenced_material_category,
  referencedMaterial: {
    id: row.referenced_material_id,
    type: row.referenced_material_name,
    purpose: row.referenced_material_purpose ?? null,
    material: row.referenced_material_material ?? null,
    description: row.referenced_material_description ?? null,
    manufacturer: row.referenced_material_manufacturer ?? null,
    partNo: row.referenced_material_part_no ?? null,
    minimumOrderQuantity: Number(row.referenced_material_minimum_order_quantity),
    orderMeasurement: row.referenced_material_order_measurement,
    packaging: row.referenced_material_packaging,
  },
  quantity: Number(row.quantity),
  unit: row.unit,
  remarks: row.remarks ?? null,
  createdAt: toIsoString(row.created_at),
  updatedAt: toIsoString(row.updated_at),
});

export type ExpandedStandardMaterial = {
  referencedMaterialId: string;
  referencedMaterialCategory: StandardMaterialReferenceCategory;
  name: string;
  purpose: string | null;
  material: string | null;
  description: string | null;
  manufacturer: string | null;
  partNo: string | null;
  minimumOrderQuantity: number;
  orderMeasurement: 'pcs' | 'pack' | 'meters';
  packaging: 'm' | 'Package' | 'Box' | 'Drum' | 'pcs';
  quantity: number;
  unit: StandardMaterialUnit;
  remarks: string | null;
  sourceAssignmentIds: string[];
  depth: number;
};
