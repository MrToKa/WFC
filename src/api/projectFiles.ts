import { request, uploadFile, downloadFile } from './http';
import type { ProjectFile, ProjectFileVersion } from './types';
import { PROJECT_FILE_MAX_BYTES, PROJECT_FILE_SIZE_ERROR } from '../../shared/projectFileSize';

export async function fetchProjectFiles(
  projectId: string,
  token: string,
): Promise<{ files: ProjectFile[] }> {
  return request<{ files: ProjectFile[] }>(`/api/projects/${projectId}/files`, { token });
}

export async function uploadProjectFile(
  token: string,
  projectId: string,
  file: File,
  options?: { replaceFileId?: string },
): Promise<{ file: ProjectFile }> {
  if (file.size > PROJECT_FILE_MAX_BYTES) throw new Error(PROJECT_FILE_SIZE_ERROR);
  const query = options?.replaceFileId
    ? `?replaceId=${encodeURIComponent(options.replaceFileId)}`
    : '';
  return uploadFile<{ file: ProjectFile }>(
    `/api/projects/${projectId}/files${query}`,
    token,
    file,
    'Failed to upload project file',
  );
}

export async function deleteProjectFile(
  token: string,
  projectId: string,
  fileId: string,
): Promise<void> {
  await request<null>(`/api/projects/${projectId}/files/${fileId}`, {
    method: 'DELETE',
    token,
  });
}

export async function downloadProjectFile(
  token: string,
  projectId: string,
  fileId: string,
): Promise<{ blob: Blob; contentType: string }> {
  return downloadFile(
    `/api/projects/${projectId}/files/${fileId}/download`,
    token,
    'Failed to download project file',
  );
}

export async function fetchProjectFileVersions(
  token: string,
  projectId: string,
  fileId: string,
): Promise<{ versions: ProjectFileVersion[] }> {
  return request<{ versions: ProjectFileVersion[] }>(
    `/api/projects/${projectId}/files/${fileId}/versions`,
    { token },
  );
}

export async function deleteProjectFileVersion(
  token: string,
  projectId: string,
  fileId: string,
  versionId: string,
): Promise<void> {
  await request<null>(`/api/projects/${projectId}/files/${fileId}/versions/${versionId}`, {
    method: 'DELETE',
    token,
  });
}

export async function downloadProjectFileVersion(
  token: string,
  projectId: string,
  fileId: string,
  versionId: string,
): Promise<{ blob: Blob; contentType: string }> {
  return downloadFile(
    `/api/projects/${projectId}/files/${fileId}/versions/${versionId}/download`,
    token,
    'Failed to download project file version',
  );
}
