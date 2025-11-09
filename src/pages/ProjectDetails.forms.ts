import type {
  ApiErrorPayload,
  Cable,
  CableInput,
  CableType,
  CableTypeInput,
  Tray,
  TrayInput
} from '@/api/client';

import {
  isIsoDateString,
  parseNumberInput,
  toNullableString
} from './ProjectDetails.utils';

export const CABLE_TYPES_PER_PAGE = 10;
export const CABLE_LIST_PER_PAGE = 10;
export const TRAYS_PER_PAGE = 10;

export type ProjectDetailsTab =
  | 'details'
  | 'cables'
  | 'cable-list'
  | 'trays'
  | 'files'
  | 'cable-report'
  | 'variables-api';

export type CableTypeFormState = {
  name: string;
  purpose: string;
  diameterMm: string;
  weightKgPerM: string;
};

export type CableTypeFormErrors = Partial<
  Record<keyof CableTypeFormState, string>
> & {
  general?: string;
};

export const emptyCableTypeForm: CableTypeFormState = {
  name: '',
  purpose: '',
  diameterMm: '',
  weightKgPerM: ''
};

export const toCableTypeFormState = (
  cableType: CableType
): CableTypeFormState => ({
  name: cableType.name,
  purpose: cableType.purpose ?? '',
  diameterMm:
    cableType.diameterMm !== null ? String(cableType.diameterMm) : '',
  weightKgPerM:
    cableType.weightKgPerM !== null ? String(cableType.weightKgPerM) : ''
});

export const parseCableTypeApiErrors = (
  payload: ApiErrorPayload
): CableTypeFormErrors => {
  if (typeof payload === 'string') {
    return { general: payload };
  }

  const fieldErrors = Object.entries(payload.fieldErrors ?? {}).reduce<
    CableTypeFormErrors
  >((acc, [field, messages]) => {
    if (messages.length > 0 && field in emptyCableTypeForm) {
      acc[field as keyof CableTypeFormState] = messages[0];
    }
    return acc;
  }, {});

  const generalMessage = payload.formErrors?.[0];
  if (generalMessage) {
    fieldErrors.general = generalMessage;
  }

  return fieldErrors;
};

export const buildCableTypeInput = (
  values: CableTypeFormState
): {
  input: CableTypeInput;
  errors: CableTypeFormErrors;
} => {
  const errors: CableTypeFormErrors = {};

  const name = values.name.trim();
  if (name === '') {
    errors.name = 'Name is required';
  }

  const diameterResult = parseNumberInput(values.diameterMm);
  if (diameterResult.error) {
    errors.diameterMm = diameterResult.error;
  }

  const weightResult = parseNumberInput(values.weightKgPerM);
  if (weightResult.error) {
    errors.weightKgPerM = weightResult.error;
  }

  const input: CableTypeInput = {
    name,
    purpose: (() => {
      const trimmed = values.purpose.trim();
      return trimmed === '' ? null : trimmed;
    })(),
    diameterMm: diameterResult.numeric,
    weightKgPerM: weightResult.numeric
  };

  return { input, errors };
};

export type TrayFormState = {
  name: string;
  type: string;
  purpose: string;
  widthMm: string;
  heightMm: string;
  lengthMm: string;
};

export type TrayFormErrors = Partial<Record<keyof TrayFormState, string>> & {
  general?: string;
};

export const emptyTrayForm: TrayFormState = {
  name: '',
  type: '',
  purpose: '',
  widthMm: '',
  heightMm: '',
  lengthMm: ''
};

export const toTrayFormState = (tray: Tray): TrayFormState => ({
  name: tray.name,
  type: tray.type ?? '',
  purpose: tray.purpose ?? '',
  widthMm: tray.widthMm !== null ? String(tray.widthMm) : '',
  heightMm: tray.heightMm !== null ? String(tray.heightMm) : '',
  lengthMm: tray.lengthMm !== null ? String(tray.lengthMm) : ''
});

export const parseTrayApiErrors = (
  payload: ApiErrorPayload
): TrayFormErrors => {
  if (typeof payload === 'string') {
    return { general: payload };
  }

  const fieldErrors: TrayFormErrors = {};

  for (const [field, messages] of Object.entries(
    payload.fieldErrors ?? {}
  )) {
    if (messages.length === 0) {
      continue;
    }
    if (field in emptyTrayForm) {
      fieldErrors[field as keyof TrayFormState] = messages[0];
    }
  }

  const generalMessage = payload.formErrors?.[0];
  if (generalMessage) {
    fieldErrors.general = generalMessage;
  }

  return fieldErrors;
};

export const buildTrayInput = (
  values: TrayFormState
): {
  input: TrayInput;
  errors: TrayFormErrors;
} => {
  const errors: TrayFormErrors = {};

  const name = values.name.trim();
  if (name === '') {
    errors.name = 'Name is required';
  }

  const typeValue = values.type.trim();
  if (typeValue === '') {
    errors.type = 'Type is required';
  }
  const type = typeValue === '' ? null : typeValue;
  const purpose = toNullableString(values.purpose);
  const widthResult = parseNumberInput(values.widthMm);
  if (widthResult.error) {
    errors.widthMm = widthResult.error;
  }
  const heightResult = parseNumberInput(values.heightMm);
  if (heightResult.error) {
    errors.heightMm = heightResult.error;
  }
  const lengthResult = parseNumberInput(values.lengthMm);
  if (lengthResult.error) {
    errors.lengthMm = lengthResult.error;
  }

  const input: TrayInput = {
    name,
    type,
    purpose,
    widthMm: widthResult.numeric,
    heightMm: heightResult.numeric,
    lengthMm: lengthResult.numeric
  };

  return { input, errors };
};

export type CableFormState = {
  cableId: string;
  tag: string;
  cableTypeId: string;
  fromLocation: string;
  toLocation: string;
  routing: string;
  designLength: string;
  installLength: string;
  pullDate: string;
  connectedFrom: string;
  connectedTo: string;
  tested: string;
};

export type CableFormErrors = Partial<Record<keyof CableFormState, string>> & {
  general?: string;
};

export const emptyCableForm: CableFormState = {
  cableId: '',
  tag: '',
  cableTypeId: '',
  fromLocation: '',
  toLocation: '',
  routing: '',
  designLength: '',
  installLength: '',
  pullDate: '',
  connectedFrom: '',
  connectedTo: '',
  tested: ''
};

export const toCableFormState = (cable: Cable): CableFormState => ({
  cableId: cable.cableId,
  tag: cable.tag ?? '',
  cableTypeId: cable.cableTypeId,
  fromLocation: cable.fromLocation ?? '',
  toLocation: cable.toLocation ?? '',
  routing: cable.routing ?? '',
  designLength:
    cable.designLength !== null ? String(cable.designLength) : '',
  installLength:
    cable.installLength !== null ? String(cable.installLength) : '',
  pullDate: cable.pullDate ?? '',
  connectedFrom: cable.connectedFrom ?? '',
  connectedTo: cable.connectedTo ?? '',
  tested: cable.tested ?? ''
});

export const parseCableFormErrors = (
  payload: ApiErrorPayload
): CableFormErrors => {
  if (typeof payload === 'string') {
    return { general: payload };
  }

  const fieldErrors: CableFormErrors = {};

  for (const [field, messages] of Object.entries(payload.fieldErrors ?? {})) {
    if (messages.length === 0) {
      continue;
    }
    if (field in emptyCableForm) {
      fieldErrors[field as keyof CableFormState] = messages[0];
    }
  }

  const generalMessage = payload.formErrors?.[0];
  if (generalMessage) {
    fieldErrors.general = generalMessage;
  }

  return fieldErrors;
};

export const buildCableInput = (
  values: CableFormState
): {
  input: CableInput;
  errors: CableFormErrors;
} => {
  const errors: CableFormErrors = {};

  const cableId = values.cableId.trim();
  if (cableId === '') {
    errors.cableId = 'Cable ID is required';
  }

  const tag = values.tag.trim();
  if (tag === '') {
    errors.tag = 'Tag is required';
  }

  const cableTypeId = values.cableTypeId.trim();
  if (cableTypeId === '') {
    errors.cableTypeId = 'Cable type is required';
  }

  const normalize = (text: string): string => {
    const trimmed = text.trim();
    return trimmed === '' ? '' : trimmed;
  };

  const input: CableInput = {
    cableId,
    cableTypeId,
    tag,
    fromLocation: normalize(values.fromLocation),
    toLocation: normalize(values.toLocation),
    routing: normalize(values.routing)
  };

  const designLengthValue = values.designLength.trim();
  if (designLengthValue !== '') {
    const parsed = Number(designLengthValue);
    if (!Number.isFinite(parsed) || !Number.isInteger(parsed) || parsed < 0) {
      errors.designLength = 'Design length must be a non-negative integer';
    } else {
      input.designLength = parsed;
    }
  } else {
    input.designLength = null;
  }

  const installLengthValue = values.installLength.trim();
  if (installLengthValue !== '') {
    const parsed = Number(installLengthValue);
    if (!Number.isFinite(parsed) || !Number.isInteger(parsed) || parsed < 0) {
      errors.installLength = 'Install length must be a non-negative integer';
    } else {
      input.installLength = parsed;
    }
  } else {
    input.installLength = null;
  }

  const parseDate = (value: string, field: keyof CableFormState) => {
    const trimmed = value.trim();
    if (trimmed === '') {
      return null;
    }

    const normalized = trimmed.slice(0, 10);

    if (!isIsoDateString(normalized)) {
      errors[field] = 'Enter a valid date (YYYY-MM-DD)';
      return null;
    }

    return normalized;
  };

  input.connectedFrom = parseDate(values.connectedFrom, 'connectedFrom');
  input.connectedTo = parseDate(values.connectedTo, 'connectedTo');
  input.pullDate = parseDate(values.pullDate, 'pullDate');
  input.tested = parseDate(values.tested, 'tested');

  return { input, errors };
};
