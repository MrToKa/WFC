import type { FileUploader } from './user';

export type ProjectFile = {
  id: string;
  projectId: string;
  fileName: string;
  contentType: string | null;
  sizeBytes: number;
  uploadedAt: string;
  uploadedBy: FileUploader | null;
  canDelete: boolean;
};

export type ProjectFileVersion = {
  id: string;
  projectFileId: string;
  versionNumber: number;
  fileName: string;
  contentType: string | null;
  sizeBytes: number;
  uploadedAt: string;
  uploadedBy: FileUploader | null;
};

export type TemplateFile = {
  id: string;
  fileName: string;
  contentType: string | null;
  sizeBytes: number;
  uploadedAt: string;
  uploadedBy: FileUploader | null;
  canDelete: boolean;
};

export type TemplateFileVersion = {
  id: string;
  templateId: string;
  versionNumber: number;
  fileName: string;
  contentType: string | null;
  sizeBytes: number;
  uploadedAt: string;
  uploadedBy: FileUploader | null;
};
