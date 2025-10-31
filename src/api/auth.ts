import { request } from './http';
import type { User, AuthSuccess } from './types';

export async function registerUser(data: {
  email: string;
  password: string;
  firstName?: string;
  lastName?: string;
}): Promise<AuthSuccess> {
  return request<AuthSuccess>('/api/auth/register', {
    method: 'POST',
    body: data
  });
}

export async function loginUser(data: {
  email: string;
  password: string;
}): Promise<AuthSuccess> {
  return request<AuthSuccess>('/api/auth/login', {
    method: 'POST',
    body: data
  });
}

export async function fetchCurrentUser(token: string): Promise<{ user: User }> {
  return request<{ user: User }>('/api/users/me', {
    method: 'GET',
    token
  });
}

export async function updateCurrentUser(
  token: string,
  data: {
    email?: string;
    firstName?: string;
    lastName?: string;
    password?: string;
  }
): Promise<{ user: User }> {
  return request<{ user: User }>('/api/users/me', {
    method: 'PATCH',
    token,
    body: data
  });
}

export async function deleteCurrentUser(token: string): Promise<void> {
  await request<void>('/api/users/me', { method: 'DELETE', token });
}

export async function fetchAllUsers(token: string): Promise<{ users: User[] }> {
  return request<{ users: User[] }>('/api/admin/users', {
    method: 'GET',
    token
  });
}

export async function updateUserAsAdmin(
  token: string,
  userId: string,
  data: {
    email?: string;
    firstName?: string;
    lastName?: string;
    password?: string;
  }
): Promise<{ user: User }> {
  return request<{ user: User }>(`/api/admin/users/${userId}`, {
    method: 'PATCH',
    token,
    body: data
  });
}

export async function deleteUserAsAdmin(
  token: string,
  userId: string
): Promise<void> {
  await request<void>(`/api/admin/users/${userId}`, {
    method: 'DELETE',
    token
  });
}

export async function promoteUserAsAdmin(
  token: string,
  userId: string
): Promise<{ user: User }> {
  return request<{ user: User }>(`/api/admin/users/${userId}/promote`, {
    method: 'POST',
    token
  });
}
