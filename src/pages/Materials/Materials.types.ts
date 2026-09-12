export type MaterialsTab =
  | 'obsolete'
  | 'trays'
  | 'supports'
  | 'loadCurves'
  | 'cableTypes'
  | 'cableInstallationMaterials'
  | 'trayInstallationMaterials'
  | 'instruments'
  | 'instrumentInstallationMaterials';

export const MATERIAL_TABS: MaterialsTab[] = [
  'cableTypes',
  'cableInstallationMaterials',
  'trays',
  'trayInstallationMaterials',
  'instruments',
  'instrumentInstallationMaterials',
  'supports',
  'loadCurves',
  'obsolete',
];

export const parseMaterialsTab = (value: string | null): MaterialsTab =>
  MATERIAL_TABS.includes(value as MaterialsTab) ? (value as MaterialsTab) : 'cableTypes';

export type TrayFormState = {
  type: string;
  manufacturer: string;
  heightMm: string;
  rungHeightMm: string;
  widthMm: string;
  weightKgPerM: string;
  minimumOrderQuantity: string;
  orderMeasurement: 'pcs' | 'pack' | 'meters';
  packaging: 'm' | 'Package' | 'Box' | 'Drum' | 'pcs';
  unitPrice: string;
  imageTemplateId: string | null;
  source: string;
};

export type SupportFormState = {
  type: string;
  manufacturer: string;
  heightMm: string;
  widthMm: string;
  lengthMm: string;
  weightKg: string;
  minimumOrderQuantity: string;
  orderMeasurement: 'pcs' | 'pack' | 'meters';
  packaging: 'm' | 'Package' | 'Box' | 'Drum' | 'pcs';
  unitPrice: string;
  imageTemplateId: string | null;
  source: string;
};

export type TrayFormErrors = Partial<Record<keyof TrayFormState, string>>;
export type SupportFormErrors = Partial<Record<keyof SupportFormState, string>>;
export type LoadCurveFormState = {
  name: string;
  description: string;
};

export type LoadCurveFormErrors = Partial<Record<keyof LoadCurveFormState, string>>;

export const initialTrayForm: TrayFormState = {
  type: '',
  manufacturer: '',
  heightMm: '',
  rungHeightMm: '',
  widthMm: '',
  weightKgPerM: '',
  minimumOrderQuantity: '1',
  orderMeasurement: 'pcs',
  packaging: 'pcs',
  unitPrice: '0',
  imageTemplateId: null,
  source: '',
};

export const initialSupportForm: SupportFormState = {
  type: '',
  manufacturer: '',
  heightMm: '',
  widthMm: '',
  lengthMm: '',
  weightKg: '',
  minimumOrderQuantity: '1',
  orderMeasurement: 'pcs',
  packaging: 'pcs',
  unitPrice: '0',
  imageTemplateId: null,
  source: '',
};

export const initialLoadCurveForm: LoadCurveFormState = {
  name: '',
  description: '',
};

export const PAGE_SIZE = 10;
