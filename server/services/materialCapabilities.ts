import type { StandardMaterialOwnerCategory } from '../models/standardMaterial.js';

type MaterialCapability = {
  category: StandardMaterialOwnerCategory;
  label: string;
  ownerTable: string;
  ownerIdColumn: string;
  ownerNameColumn: string;
  assignmentTable: string;
  assignmentOwnerColumn: string;
};

export const MATERIAL_CAPABILITIES: Record<
  StandardMaterialOwnerCategory,
  MaterialCapability
> = {
  'cable-type': {
    category: 'cable-type',
    label: 'Cable type',
    ownerTable: 'material_cable_types',
    ownerIdColumn: 'id',
    ownerNameColumn: 'name',
    assignmentTable: 'material_cable_type_standard_materials',
    assignmentOwnerColumn: 'cable_type_id',
  },
  'cable-installation-material': {
    category: 'cable-installation-material',
    label: 'Cable installation material',
    ownerTable: 'material_cable_installation_materials',
    ownerIdColumn: 'id',
    ownerNameColumn: 'type',
    assignmentTable: 'material_cable_installation_standard_materials',
    assignmentOwnerColumn: 'cable_installation_material_id',
  },
  tray: {
    category: 'tray',
    label: 'Tray',
    ownerTable: 'material_trays',
    ownerIdColumn: 'id',
    ownerNameColumn: 'tray_type',
    assignmentTable: 'material_tray_standard_materials',
    assignmentOwnerColumn: 'tray_id',
  },
  support: {
    category: 'support',
    label: 'Support',
    ownerTable: 'material_supports',
    ownerIdColumn: 'id',
    ownerNameColumn: 'support_type',
    assignmentTable: 'material_support_standard_materials',
    assignmentOwnerColumn: 'support_id',
  },
};

export const getMaterialCapability = (
  category: StandardMaterialOwnerCategory,
): MaterialCapability => MATERIAL_CAPABILITIES[category];
