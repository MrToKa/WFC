import type {
  StandardMaterialOwnerCategory,
  StandardMaterialReferenceCategory,
} from '../models/standardMaterial.js';

type MaterialCapability = {
  category: StandardMaterialOwnerCategory;
  label: string;
  ownerTable: string;
  ownerIdColumn: string;
  ownerNameColumn: string;
  assignmentTable: string;
  assignmentOwnerColumn: string;
  referencedMaterialCategory: StandardMaterialReferenceCategory;
  referencedMaterialTable: string;
  referencedMaterialLabel: string;
};

export const MATERIAL_CAPABILITIES: Record<StandardMaterialOwnerCategory, MaterialCapability> = {
  'cable-type': {
    category: 'cable-type',
    label: 'Cable type',
    ownerTable: 'material_cable_types',
    ownerIdColumn: 'id',
    ownerNameColumn: 'name',
    assignmentTable: 'material_cable_type_standard_materials',
    assignmentOwnerColumn: 'cable_type_id',
    referencedMaterialCategory: 'cable-installation-material',
    referencedMaterialTable: 'material_cable_installation_materials',
    referencedMaterialLabel: 'Cable Installation Material',
  },
  'cable-installation-material': {
    category: 'cable-installation-material',
    label: 'Cable installation material',
    ownerTable: 'material_cable_installation_materials',
    ownerIdColumn: 'id',
    ownerNameColumn: 'type',
    assignmentTable: 'material_cable_installation_standard_materials',
    assignmentOwnerColumn: 'cable_installation_material_id',
    referencedMaterialCategory: 'cable-installation-material',
    referencedMaterialTable: 'material_cable_installation_materials',
    referencedMaterialLabel: 'Cable Installation Material',
  },
  'tray-installation-material': {
    category: 'tray-installation-material',
    label: 'Tray installation material',
    ownerTable: 'material_tray_installation_materials',
    ownerIdColumn: 'id',
    ownerNameColumn: 'type',
    assignmentTable: 'material_tray_installation_standard_materials',
    assignmentOwnerColumn: 'tray_installation_material_id',
    referencedMaterialCategory: 'tray-installation-material',
    referencedMaterialTable: 'material_tray_installation_materials',
    referencedMaterialLabel: 'Tray Installation Material',
  },
  instrument: {
    category: 'instrument',
    label: 'Instrument',
    ownerTable: 'material_instruments',
    ownerIdColumn: 'id',
    ownerNameColumn: 'type',
    assignmentTable: 'material_instrument_standard_materials',
    assignmentOwnerColumn: 'instrument_id',
    referencedMaterialCategory: 'instrument-installation-material',
    referencedMaterialTable: 'material_instrument_installation_materials',
    referencedMaterialLabel: 'Instrument Installation Material',
  },
  'instrument-installation-material': {
    category: 'instrument-installation-material',
    label: 'Instrument installation material',
    ownerTable: 'material_instrument_installation_materials',
    ownerIdColumn: 'id',
    ownerNameColumn: 'type',
    assignmentTable: 'material_instrument_installation_standard_materials',
    assignmentOwnerColumn: 'instrument_installation_material_id',
    referencedMaterialCategory: 'instrument-installation-material',
    referencedMaterialTable: 'material_instrument_installation_materials',
    referencedMaterialLabel: 'Instrument Installation Material',
  },
  tray: {
    category: 'tray',
    label: 'Tray',
    ownerTable: 'material_trays',
    ownerIdColumn: 'id',
    ownerNameColumn: 'tray_type',
    assignmentTable: 'material_tray_standard_materials',
    assignmentOwnerColumn: 'tray_id',
    referencedMaterialCategory: 'cable-installation-material',
    referencedMaterialTable: 'material_cable_installation_materials',
    referencedMaterialLabel: 'Cable Installation Material',
  },
  support: {
    category: 'support',
    label: 'Support',
    ownerTable: 'material_supports',
    ownerIdColumn: 'id',
    ownerNameColumn: 'support_type',
    assignmentTable: 'material_support_standard_materials',
    assignmentOwnerColumn: 'support_id',
    referencedMaterialCategory: 'cable-installation-material',
    referencedMaterialTable: 'material_cable_installation_materials',
    referencedMaterialLabel: 'Cable Installation Material',
  },
};

export const getMaterialCapability = (
  category: StandardMaterialOwnerCategory,
): MaterialCapability => MATERIAL_CAPABILITIES[category];
