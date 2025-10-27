export type MaterialsTab = 'trays' | 'supports';

export type TrayFormState = {
  type: string;
  heightMm: string;
  widthMm: string;
  weightKgPerM: string;
};

export type SupportFormState = {
  type: string;
  heightMm: string;
  widthMm: string;
  lengthMm: string;
  weightKg: string;
};

export type TrayFormErrors = Partial<Record<keyof TrayFormState, string>>;
export type SupportFormErrors = Partial<Record<keyof SupportFormState, string>>;

export const initialTrayForm: TrayFormState = {
  type: '',
  heightMm: '',
  widthMm: '',
  weightKgPerM: ''
};

export const initialSupportForm: SupportFormState = {
  type: '',
  heightMm: '',
  widthMm: '',
  lengthMm: '',
  weightKg: ''
};

export const PAGE_SIZE = 10;
