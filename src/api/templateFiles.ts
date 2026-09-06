import { request, uploadFile, downloadFile } from './http';
import type { TemplateFile, TemplateFileVersion } from './types';

export async function fetchTemplateFiles(token: string): Promise<{ files: TemplateFile[] }> {
  return request<{ files: TemplateFile[] }>('/api/templates', { token });
}

export async function uploadTemplateFile(
  token: string,
  file: File,
  options?: { replaceTemplateId?: string },
): Promise<{ file: TemplateFile }> {
  const query = options?.replaceTemplateId
    ? `?replaceId=${encodeURIComponent(options.replaceTemplateId)}`
    : '';
  return uploadFile<{ file: TemplateFile }>(
    `/api/templates${query}`,
    token,
    file,
    'Failed to upload template file',
  );
}

export async function deleteTemplateFile(token: string, templateId: string): Promise<void> {
  await request<null>(`/api/templates/${templateId}`, { method: 'DELETE', token });
}

export async function fetchTemplateVersions(
  token: string,
  templateId: string,
): Promise<{ versions: TemplateFileVersion[] }> {
  return request<{ versions: TemplateFileVersion[] }>(`/api/templates/${templateId}/versions`, {
    token,
  });
}

export async function deleteTemplateVersion(
  token: string,
  templateId: string,
  versionId: string,
): Promise<void> {
  await request<null>(`/api/templates/${templateId}/versions/${versionId}`, {
    method: 'DELETE',
    token,
  });
}

export async function downloadTemplateVersion(
  token: string,
  templateId: string,
  versionId: string,
): Promise<{ blob: Blob; contentType: string }> {
  return downloadFile(
    `/api/templates/${templateId}/versions/${versionId}/download`,
    token,
    'Failed to download template version',
  );
}

export async function downloadTemplateFile(
  token: string,
  templateId: string,
): Promise<{ blob: Blob; contentType: string }> {
  return downloadFile(
    `/api/templates/${templateId}/download`,
    token,
    'Failed to download template file',
  );
}
