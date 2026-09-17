import { request } from './http';
import type { ProjectChangeLogEntry, RoxtecEntry } from './types';

export async function fetchRoxtecEntries(
  projectId: string
): Promise<{ entries: RoxtecEntry[]; changeLog: ProjectChangeLogEntry[] }> {
  return request<{ entries: RoxtecEntry[]; changeLog: ProjectChangeLogEntry[] }>(`/api/projects/${projectId}/roxtec`, {
    method: 'GET'
  });
}

export async function fetchRoxtecEntry(
  projectId: string,
  roxtecId: number
): Promise<{ entry: RoxtecEntry }> {
  return request<{ entry: RoxtecEntry }>(
    `/api/projects/${projectId}/roxtec/${roxtecId}`,
    {
      method: 'GET'
    }
  );
}

export async function createRoxtecEntry(
  token: string,
  projectId: string,
  data: {
    revision: string;
    tag: string;
    type: string;
    description?: string | null;
  }
): Promise<{ entry: RoxtecEntry }> {
  return request<{ entry: RoxtecEntry }>(`/api/projects/${projectId}/roxtec`, {
    method: 'POST',
    token,
    body: data
  });
}

export async function updateRoxtecEntry(
  token: string,
  projectId: string,
  roxtecId: number,
  data: {
    revision: string;
    tag: string;
    type: string;
    description?: string | null;
  }
): Promise<{ entry: RoxtecEntry }> {
  return request<{ entry: RoxtecEntry }>(
    `/api/projects/${projectId}/roxtec/${roxtecId}`,
    {
      method: 'PATCH',
      token,
      body: data
    }
  );
}

export async function deleteRoxtecEntry(
  token: string,
  projectId: string,
  roxtecId: number
): Promise<void> {
  await request<void>(`/api/projects/${projectId}/roxtec/${roxtecId}`, {
    method: 'DELETE',
    token
  });
}