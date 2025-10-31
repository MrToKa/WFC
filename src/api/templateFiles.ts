import { request, ApiError, getApiBaseUrl } from './http';
import type { TemplateFile, TemplateFileVersion } from './types';

export async function fetchTemplateFiles(
  token: string
): Promise<{ files: TemplateFile[] }> {
  return request<{ files: TemplateFile[] }>('/api/templates', {
    method: 'GET',
    token
  });
}

export async function uploadTemplateFile(
  token: string,
  file: File,
  options?: { replaceTemplateId?: string }
): Promise<{ file: TemplateFile }> {
  const formData = new FormData();
  formData.append('file', file);

  const endpoint = options?.replaceTemplateId
    ? `${getApiBaseUrl()}/api/templates?replaceId=${encodeURIComponent(
        options.replaceTemplateId
      )}`
    : `${getApiBaseUrl()}/api/templates`;

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
        'Received unexpected response from template upload endpoint'
      );
    }
  }

  if (!response.ok) {
    let templateId: string | undefined;
    if (
      payload &&
      typeof payload === 'object' &&
      'templateId' in payload &&
      typeof (payload as { templateId?: unknown }).templateId === 'string'
    ) {
      templateId = (payload as { templateId: string }).templateId;
    }

    const errorPayload =
      payload &&
      typeof payload === 'object' &&
      'error' in payload &&
      typeof (payload as { error: unknown }).error === 'string'
        ? (payload as { error: string }).error
        : 'Failed to upload template file';

    const apiError = new ApiError(response.status, errorPayload);

    if (templateId) {
      apiError.templateId = templateId;
    }

    throw apiError;
  }

  return payload as { file: TemplateFile };
}

export async function deleteTemplateFile(
  token: string,
  templateId: string
): Promise<void> {
  await request<null>(`/api/templates/${templateId}`, {
    method: 'DELETE',
    token
  });
}

export async function fetchTemplateVersions(
  token: string,
  templateId: string
): Promise<{ versions: TemplateFileVersion[] }> {
  return request<{ versions: TemplateFileVersion[] }>(
    `/api/templates/${templateId}/versions`,
    {
      method: 'GET',
      token
    }
  );
}

export async function deleteTemplateVersion(
  token: string,
  templateId: string,
  versionId: string
): Promise<void> {
  await request<null>(`/api/templates/${templateId}/versions/${versionId}`, {
    method: 'DELETE',
    token
  });
}

export async function downloadTemplateVersion(
  token: string,
  templateId: string,
  versionId: string
): Promise<{ blob: Blob; contentType: string }> {
  const response = await fetch(
    `${getApiBaseUrl()}/api/templates/${templateId}/versions/${versionId}/download`,
    {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${token}`
      }
    }
  );

  if (!response.ok) {
    throw new ApiError(response.status, 'Failed to download template version');
  }

  const blob = await response.blob();
  return {
    blob,
    contentType:
      response.headers.get('content-type') ?? 'application/octet-stream'
  };
}

export async function downloadTemplateFile(
  token: string,
  templateId: string
): Promise<{ blob: Blob; contentType: string }> {
  const response = await fetch(
    `${getApiBaseUrl()}/api/templates/${templateId}/download`,
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
        : 'Failed to download template file';

    throw new ApiError(response.status, errorPayload);
  }

  const blob = await response.blob();
  return {
    blob,
    contentType:
      response.headers.get('content-type') ?? 'application/octet-stream'
  };
}
