import type { ApiErrorPayload } from '@/api/client';

export type FormErrors<Field extends string> = Partial<Record<Field | 'general', string>>;

export const parseFormErrors = <Field extends string>(
  payload: ApiErrorPayload,
  fields: readonly Field[],
  fallback = 'Request failed. Please try again.',
): FormErrors<Field> => {
  if (typeof payload === 'string') {
    return { general: payload.trim() ? payload : fallback } as FormErrors<Field>;
  }

  const errors = {} as FormErrors<Field>;
  const generalMessages = payload.formErrors?.filter((message) => message.trim()) ?? [];
  for (const [field, messages] of Object.entries(payload.fieldErrors ?? {})) {
    const message = messages.find((value) => value.trim());
    if (!message) continue;
    if (fields.includes(field as Field)) {
      errors[field as Field] = message;
    } else {
      generalMessages.push(message);
    }
  }
  if (generalMessages.length > 0) {
    errors.general = generalMessages[0];
  } else if (Object.keys(errors).length === 0) {
    errors.general = fallback;
  }
  return errors;
};
