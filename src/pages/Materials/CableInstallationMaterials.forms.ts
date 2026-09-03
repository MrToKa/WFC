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
  dimensionMm: string;
  weightKg: string;
  minimumOrderQuantity: string;
  orderMeasurement: 'pcs' | 'pack' | 'meters';
  packaging: 'm' | 'Package' | 'Box' | 'Drum' | 'pcs';
  unitPrice: string;
  source: string;
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
  dimensionMm: '',
  weightKg: '',
  minimumOrderQuantity: '1',
  orderMeasurement: 'pcs',
  packaging: 'pcs',
  unitPrice: '0',
  source: '',
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
  dimensionMm: material.dimensionMm ?? '',
  weightKg: material.weightKg === null ? '' : String(material.weightKg),
  minimumOrderQuantity: String(material.minimumOrderQuantity),
  orderMeasurement: material.orderMeasurement,
  packaging: material.packaging,
  unitPrice: String(material.unitPrice),
  source: material.source ?? '',
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
  const weightResult = parseNumberInput(values.weightKg);
  const unitPriceResult = parseNumberInput(values.unitPrice);
  if (weightResult.error || (weightResult.numeric !== null && weightResult.numeric < 0)) {
    errors.weightKg = 'Weight must be a non-negative number';
  }
  if (
    minimumOrderResult.error ||
    minimumOrderResult.numeric === null ||
    minimumOrderResult.numeric <= 0
  ) {
    errors.minimumOrderQuantity = 'Minimum order quantity must be greater than zero';
  }
  if (unitPriceResult.error || unitPriceResult.numeric === null) {
    errors.unitPrice = 'Price must be a non-negative number';
  }

  return {
    input: {
      type,
      purpose: toNullableString(values.purpose),
      material: toNullableString(values.material),
      description: toNullableString(values.description),
      manufacturer: toNullableString(values.manufacturer),
      partNo: toNullableString(values.partNo),
      dimensionMm: toNullableString(values.dimensionMm),
      weightKg: weightResult.numeric,
      minimumOrderQuantity: minimumOrderResult.numeric ?? 1,
      orderMeasurement: values.orderMeasurement,
      packaging: values.packaging,
      unitPrice: unitPriceResult.numeric ?? 0,
      source: toNullableString(values.source),
    },
    errors,
  };
};
