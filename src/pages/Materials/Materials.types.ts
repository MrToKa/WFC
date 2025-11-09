export type MaterialsTab = 'trays' | 'supports' | 'loadCurves';

export type TrayFormState = {
  type: string;
  manufacturer: string;
  heightMm: string;
  rungHeightMm: string;
  widthMm: string;
  weightKgPerM: string;
  imageTemplateId: string | null;
};

export type SupportFormState = {
  type: string;
  heightMm: string;
  widthMm: string;
  lengthMm: string;
  weightKg: string;
  imageTemplateId: string | null;
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
  imageTemplateId: null
};

export const initialSupportForm: SupportFormState = {
  type: '',
  heightMm: '',
  widthMm: '',
  lengthMm: '',
  weightKg: '',
  imageTemplateId: null
};

export const initialLoadCurveForm: LoadCurveFormState = {
  name: '',
  description: ''
};

export const PAGE_SIZE = 10;
