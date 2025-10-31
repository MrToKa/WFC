import type { ChangeEvent, RefObject } from 'react';
import { useCallback, useEffect, useRef, useState } from 'react';

import type { ToastIntent } from '@fluentui/react-components';

import {
  ApiError,
  ProjectFile,
  deleteProjectFile,
  downloadProjectFile,
  fetchProjectFiles,
  uploadProjectFile
} from '@/api/client';

type ShowToast = (options: {
  title: string;
  body?: string;
  intent?: ToastIntent;
}) => void;

type UseProjectFilesSectionParams = {
  projectId?: string;
  token: string | null;
  isAdmin: boolean;
  showToast: ShowToast;
};

type UseProjectFilesSectionResult = {
  files: ProjectFile[];
  isLoading: boolean;
  isRefreshing: boolean;
  isUploading: boolean;
  downloadingFileId: string | null;
  pendingFileId: string | null;
  error: string | null;
  fileInputRef: RefObject<HTMLInputElement | null>;
  canUpload: boolean;
  maxFileSizeBytes: number;
  reloadFiles: (options?: { showSpinner?: boolean }) => Promise<void>;
  handleFileInputChange: (event: ChangeEvent<HTMLInputElement>) => Promise<void>;
  handleDeleteFile: (fileId: string) => Promise<void>;
  handleDownloadFile: (file: ProjectFile) => Promise<void>;
};

const MAX_FILE_SIZE_BYTES = 25 * 1024 * 1024;

const formatApiError = (error: unknown, fallback: string): string => {
  if (error instanceof ApiError) {
    return error.message;
  }
  if (error instanceof Error && error.message) {
    return error.message;
  }
  return fallback;
};

const triggerFileDownload = (fileName: string, blob: Blob): void => {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
};

export const useProjectFilesSection = ({
  projectId,
  token,
  isAdmin,
  showToast
}: UseProjectFilesSectionParams): UseProjectFilesSectionResult => {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [files, setFiles] = useState<ProjectFile[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isRefreshing, setIsRefreshing] = useState<boolean>(false);
  const [isUploading, setIsUploading] = useState<boolean>(false);
  const [pendingFileId, setPendingFileId] = useState<string | null>(null);
  const [downloadingFileId, setDownloadingFileId] = useState<string | null>(
    null
  );
  const [error, setError] = useState<string | null>(null);

  const reloadFiles = useCallback(
    async (options?: { showSpinner?: boolean }) => {
      if (!projectId) {
        setFiles([]);
        setIsLoading(false);
        return;
      }

      if (options?.showSpinner ?? true) {
        setIsLoading(true);
      } else {
        setIsRefreshing(true);
      }

      setError(null);

      try {
        const response = await fetchProjectFiles(projectId);
        setFiles(response.files);
      } catch (err) {
        console.error('Failed to load project files', err);
        setError(formatApiError(err, 'Failed to load project files.'));
      } finally {
        setIsLoading(false);
        setIsRefreshing(false);
      }
    },
    [projectId]
  );

  useEffect(() => {
    void reloadFiles({ showSpinner: true });
  }, [reloadFiles]);

  const handleFileInputChange = useCallback(
    async (event: ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];

      if (!file) {
        return;
      }

      if (!token || !projectId) {
        showToast({
          title: 'Upload not allowed',
          body: 'You must be signed in to upload files.',
          intent: 'warning'
        });
        event.target.value = '';
        return;
      }

      if (file.size > MAX_FILE_SIZE_BYTES) {
        showToast({
          title: 'File is too large',
          body: 'Maximum allowed size is 25 MB.',
          intent: 'error'
        });
        event.target.value = '';
        return;
      }

      setIsUploading(true);

      try {
        const response = await uploadProjectFile(token, projectId, file);
        setFiles((prev) => [response.file, ...prev]);
        showToast({
          title: 'File uploaded',
          body: `"${file.name}" uploaded successfully.`,
          intent: 'success'
        });
      } catch (err) {
        console.error('Failed to upload project file', err);
        showToast({
          title: 'Upload failed',
          body: formatApiError(err, 'Unable to upload the selected file.'),
          intent: 'error'
        });
      } finally {
        setIsUploading(false);
        event.target.value = '';
      }
    },
    [projectId, showToast, token]
  );

  const handleDeleteFile = useCallback(
    async (fileId: string) => {
      if (!token || !projectId) {
        showToast({
          title: 'Delete not allowed',
          body: 'You must be signed in to delete files.',
          intent: 'warning'
        });
        return;
      }

      setPendingFileId(fileId);

      try {
        await deleteProjectFile(token, projectId, fileId);
        setFiles((prev) => prev.filter((file) => file.id !== fileId));
        showToast({
          title: 'File deleted',
          intent: 'success'
        });
      } catch (err) {
        console.error('Failed to delete project file', err);
        showToast({
          title: 'Delete failed',
          body: formatApiError(err, 'Unable to delete the selected file.'),
          intent: 'error'
        });
      } finally {
        setPendingFileId(null);
      }
    },
    [projectId, showToast, token]
  );

  const handleDownloadFile = useCallback(
    async (file: ProjectFile) => {
      if (!token || !projectId) {
        showToast({
          title: 'Download not allowed',
          body: 'You must be signed in to download files.',
          intent: 'warning'
        });
        return;
      }

      setDownloadingFileId(file.id);

      try {
        const { blob } = await downloadProjectFile(token, projectId, file.id);
        triggerFileDownload(file.fileName, blob);
      } catch (err) {
        console.error('Failed to download project file', err);
        showToast({
          title: 'Download failed',
          body: formatApiError(err, 'Unable to download the selected file.'),
          intent: 'error'
        });
      } finally {
        setDownloadingFileId(null);
      }
    },
    [projectId, showToast, token]
  );

  return {
    files,
    isLoading,
    isRefreshing,
    isUploading,
    downloadingFileId,
    pendingFileId,
    error,
    fileInputRef,
    canUpload: Boolean(token && projectId && isAdmin),
    maxFileSizeBytes: MAX_FILE_SIZE_BYTES,
    reloadFiles,
    handleFileInputChange,
    handleDeleteFile,
    handleDownloadFile
  };
};
