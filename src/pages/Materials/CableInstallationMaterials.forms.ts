import type {
  ApiErrorPayload,
  MaterialCableInstallationMaterial,
  MaterialCableInstallationMaterialInput,
} from '@/api/client';
import { toNullableString } from '../ProjectDetails.utils';
import { parseNumberInput } from './Materials.utils';

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
  minimumOrderQuantity: string;
  orderMeasurement: 'pcs' | 'pack' | 'meters';
  packaging: 'm' | 'Package' | 'Box' | 'Drum' | 'pcs';
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
  minimumOrderQuantity: '1',
  orderMeasurement: 'pcs',
  packaging: 'pcs',
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
  minimumOrderQuantity: String(material.minimumOrderQuantity),
  orderMeasurement: material.orderMeasurement,
  packaging: material.packaging,
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
  const minimumOrderResult = parseNumberInput(values.minimumOrderQuantity);
  if (
    minimumOrderResult.error ||
    minimumOrderResult.numeric === null ||
    minimumOrderResult.numeric <= 0
  ) {
    errors.minimumOrderQuantity = 'Minimum order quantity must be greater than zero';
  }

  return {
    input: {
      type,
      purpose: toNullableString(values.purpose),
      material: toNullableString(values.material),
      description: toNullableString(values.description),
      manufacturer: toNullableString(values.manufacturer),
      partNo: toNullableString(values.partNo),
      minimumOrderQuantity: minimumOrderResult.numeric ?? 1,
      orderMeasurement: values.orderMeasurement,
      packaging: values.packaging,
    },
    errors,
  };
};
