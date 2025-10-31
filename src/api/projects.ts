import { request } from './http';
import type { Project, ProjectSupportOverridePayload } from './types';

export async function fetchProjects(): Promise<{ projects: Project[] }> {
  return request<{ projects: Project[] }>('/api/projects', { method: 'GET' });
}

export async function fetchProject(
  projectId: string
): Promise<{ project: Project }> {
  return request<{ project: Project }>(`/api/projects/${projectId}`, {
    method: 'GET'
  });
}

export async function createProject(
  token: string,
  data: {
    projectNumber: string;
    name: string;
    customer: string;
    manager?: string | null;
    description?: string;
    secondaryTrayLength?: number | null;
    supportDistance?: number | null;
    supportWeight?: number | null;
    trayLoadSafetyFactor?: number | null;
    supportDistances?: Record<string, ProjectSupportOverridePayload>;
  }
): Promise<{ project: Project }> {
  return request<{ project: Project }>('/api/projects', {
    method: 'POST',
    token,
    body: data
  });
}

export async function updateProject(
  token: string,
  projectId: string,
  data: {
    projectNumber?: string;
    name?: string;
    customer?: string;
    manager?: string | null;
    description?: string;
    secondaryTrayLength?: number | null;
    supportDistance?: number | null;
    supportWeight?: number | null;
    trayLoadSafetyFactor?: number | null;
    supportDistances?: Record<string, ProjectSupportOverridePayload>;
  }
): Promise<{ project: Project }> {
  return request<{ project: Project }>(`/api/projects/${projectId}`, {
    method: 'PATCH',
    token,
    body: data
  });
}

export async function deleteProject(
  token: string,
  projectId: string
): Promise<void> {
  await request<void>(`/api/projects/${projectId}`, {
    method: 'DELETE',
    token
  });
}
