import { request, ApiError, getApiBaseUrl } from './http';
import type { ProjectFile, ProjectFileVersion } from './types';

export async function fetchProjectFiles(
  projectId: string,
  token: string
): Promise<{ files: ProjectFile[] }> {
  return request<{ files: ProjectFile[] }>(
    `/api/projects/${projectId}/files`,
    { method: 'GET', token }
  );
}

export async function uploadProjectFile(
  token: string,
  projectId: string,
  file: File,
  options?: { replaceFileId?: string }
): Promise<{ file: ProjectFile }> {
  const formData = new FormData();
  formData.append('file', file);

  const endpoint = options?.replaceFileId
    ? `${getApiBaseUrl()}/api/projects/${projectId}/files?replaceId=${encodeURIComponent(
        options.replaceFileId
      )}`
    : `${getApiBaseUrl()}/api/projects/${projectId}/files`;

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`
    },
    body: formData
  });

  let payload: unknown = null;

  try {
    payload = await response.json();
  } catch {
    if (response.ok) {
      throw new Error(
        'Received unexpected response from project file upload endpoint'
      );
    }
  }

  if (!response.ok) {
    const errorPayload =
      payload &&
      typeof payload === 'object' &&
      'error' in payload &&
      typeof (payload as { error: unknown }).error === 'string'
        ? (payload as { error: string }).error
        : 'Failed to upload project file';

    let fileId: string | undefined;

    if (
      payload &&
      typeof payload === 'object' &&
      'fileId' in payload &&
      typeof (payload as { fileId?: unknown }).fileId === 'string'
    ) {
      fileId = (payload as { fileId: string }).fileId;
    }

    const apiError = new ApiError(response.status, errorPayload);

    if (fileId) {
      apiError.fileId = fileId;
    }

    throw apiError;
  }

  return payload as { file: ProjectFile };
}

export async function deleteProjectFile(
  token: string,
  projectId: string,
  fileId: string
): Promise<void> {
  await request<null>(`/api/projects/${projectId}/files/${fileId}`, {
    method: 'DELETE',
    token
  });
}

export async function downloadProjectFile(
  token: string,
  projectId: string,
  fileId: string
): Promise<{ blob: Blob; contentType: string }> {
  const response = await fetch(
    `${getApiBaseUrl()}/api/projects/${projectId}/files/${fileId}/download`,
    {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${token}`
      }
    }
  );

  if (!response.ok) {
    let payload: unknown = null;
    try {
      payload = await response.json();
    } catch {
      // Ignore parse errors for non-JSON responses
    }

    const errorPayload =
      payload &&
      typeof payload === 'object' &&
      'error' in payload &&
      typeof (payload as { error: unknown }).error === 'string'
        ? (payload as { error: string }).error
        : 'Failed to download project file';

    throw new ApiError(response.status, errorPayload);
  }

  const blob = await response.blob();
  return {
    blob,
    contentType:
      response.headers.get('content-type') ?? 'application/octet-stream'
  };
}

export async function fetchProjectFileVersions(
  token: string,
  projectId: string,
  fileId: string
): Promise<{ versions: ProjectFileVersion[] }> {
  return request<{ versions: ProjectFileVersion[] }>(
    `/api/projects/${projectId}/files/${fileId}/versions`,
    {
      method: 'GET',
      token
    }
  );
}

export async function deleteProjectFileVersion(
  token: string,
  projectId: string,
  fileId: string,
  versionId: string
): Promise<void> {
  await request<null>(
    `/api/projects/${projectId}/files/${fileId}/versions/${versionId}`,
    {
      method: 'DELETE',
      token
    }
  );
}

export async function downloadProjectFileVersion(
  token: string,
  projectId: string,
  fileId: string,
  versionId: string
): Promise<{ blob: Blob; contentType: string }> {
  const response = await fetch(
    `${getApiBaseUrl()}/api/projects/${projectId}/files/${fileId}/versions/${versionId}/download`,
    {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${token}`
      }
    }
  );

  if (!response.ok) {
    throw new ApiError(
      response.status,
      'Failed to download project file version'
    );
  }

  const blob = await response.blob();
  return {
    blob,
    contentType:
      response.headers.get('content-type') ?? 'application/octet-stream'
  };
}
