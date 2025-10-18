import type { ApiErrorPayload } from '@/api/client';

export const USERS_PER_PAGE = 10;
export const PROJECTS_PER_PAGE = 10;

export type UserFormState = {
  email: string;
  firstName: string;
  lastName: string;
  password: string;
};

export type UserFormErrors = Partial<Record<keyof UserFormState, string>> & {
  general?: string;
};

export type ProjectFormState = {
  projectNumber: string;
  name: string;
  customer: string;
  description: string;
};

export type ProjectFormErrors = Partial<Record<keyof ProjectFormState, string>> & {
  general?: string;
};

export const emptyUserForm: UserFormState = {
  email: '',
  firstName: '',
  lastName: '',
  password: ''
};

export const emptyProjectForm: ProjectFormState = {
  projectNumber: '',
  name: '',
  customer: '',
  description: ''
};

export const formatDateTime = (value: string): string =>
  new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short'
  }).format(new Date(value));

export const parseUserApiErrors = (payload: ApiErrorPayload): UserFormErrors => {
  if (typeof payload === 'string') {
    return { general: payload };
  }

  const fieldErrors = Object.entries(payload.fieldErrors ?? {}).reduce<UserFormErrors>(
    (acc, [field, messages]) => {
      if (messages.length > 0) {
        acc[field as keyof UserFormState] = messages[0];
      }
      return acc;
    },
    {}
  );

  const formError = payload.formErrors?.[0];
  return formError
    ? { ...fieldErrors, general: formError }
    : Object.keys(fieldErrors).length > 0
      ? fieldErrors
      : { general: 'Request failed' };
};

export const parseProjectApiErrors = (payload: ApiErrorPayload): ProjectFormErrors => {
  if (typeof payload === 'string') {
    return { general: payload };
  }

  const fieldErrors = Object.entries(payload.fieldErrors ?? {}).reduce<ProjectFormErrors>(
    (acc, [field, messages]) => {
      if (messages.length > 0) {
        acc[field as keyof ProjectFormState] = messages[0];
      }
      return acc;
    },
    {}
  );

  const formError = payload.formErrors?.[0];
  return formError
    ? { ...fieldErrors, general: formError }
    : Object.keys(fieldErrors).length > 0
      ? fieldErrors
      : { general: 'Request failed' };
};

