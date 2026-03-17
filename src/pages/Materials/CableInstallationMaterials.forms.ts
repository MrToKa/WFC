import type {
  ApiErrorPayload,
  MaterialCableInstallationMaterial,
  MaterialCableInstallationMaterialInput,
} from '@/api/client';
import { toNullableString } from '../ProjectDetails.utils';

export type CableInstallationMaterialSearchCriteria =
  | 'all'
  | 'type'
  | 'purpose'
  | 'material'
  | 'description'
  | 'manufacturer'
  | 'partNo';

export type CableInstallationMaterialFormState = {
  type: string;
  purpose: string;
  material: string;
  description: string;
  manufacturer: string;
  partNo: string;
};

export type CableInstallationMaterialFormErrors = Partial<
  Record<keyof CableInstallationMaterialFormState, string>
> & {
  general?: string;
};

export const emptyCableInstallationMaterialForm: CableInstallationMaterialFormState = {
  type: '',
  purpose: '',
  material: '',
  description: '',
  manufacturer: '',
  partNo: '',
};

export const toCableInstallationMaterialFormState = (
  material: MaterialCableInstallationMaterial,
): CableInstallationMaterialFormState => ({
  type: material.type,
  purpose: material.purpose ?? '',
  material: material.material ?? '',
  description: material.description ?? '',
  manufacturer: material.manufacturer ?? '',
  partNo: material.partNo ?? '',
});

export const parseCableInstallationMaterialApiErrors = (
  payload: ApiErrorPayload,
): CableInstallationMaterialFormErrors => {
  if (typeof payload === 'string') {
    return { general: payload };
  }

  const fieldErrors = Object.entries(
    payload.fieldErrors ?? {},
  ).reduce<CableInstallationMaterialFormErrors>((acc, [field, messages]) => {
    if (messages.length > 0 && field in emptyCableInstallationMaterialForm) {
      acc[field as keyof CableInstallationMaterialFormState] = messages[0];
    }
    return acc;
  }, {});

  const generalMessage = payload.formErrors?.[0];
  if (generalMessage) {
    fieldErrors.general = generalMessage;
  }

  return fieldErrors;
};

export const buildMaterialCableInstallationMaterialInput = (
  values: CableInstallationMaterialFormState,
): {
  input: MaterialCableInstallationMaterialInput;
  errors: CableInstallationMaterialFormErrors;
} => {
  const errors: CableInstallationMaterialFormErrors = {};
  const type = values.type.trim();

  if (type === '') {
    errors.type = 'Type is required';
  }

  return {
    input: {
      type,
      purpose: toNullableString(values.purpose),
      material: toNullableString(values.material),
      description: toNullableString(values.description),
      manufacturer: toNullableString(values.manufacturer),
      partNo: toNullableString(values.partNo),
    },
    errors,
  };
};
