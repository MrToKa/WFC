import type { ApiErrorPayload } from '@/api/client';
import { parseFormErrors } from '../formErrors';

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
  manager: string;
  description: string;
};

export type ProjectFormErrors = Partial<Record<keyof ProjectFormState, string>> & {
  general?: string;
};

export const emptyUserForm: UserFormState = {
  email: '',
  firstName: '',
  lastName: '',
  password: '',
};

export const emptyProjectForm: ProjectFormState = {
  projectNumber: '',
  name: '',
  customer: '',
  manager: '',
  description: '',
};

export const formatDateTime = (value: string): string =>
  new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value));

export const parseUserApiErrors = (payload: ApiErrorPayload): UserFormErrors =>
  parseFormErrors(payload, ['email', 'firstName', 'lastName', 'password']);

export const parseProjectApiErrors = (payload: ApiErrorPayload): ProjectFormErrors =>
  parseFormErrors(payload, ['projectNumber', 'name', 'customer', 'manager', 'description']);
