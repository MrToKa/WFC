import type { ChangeEvent, RefObject } from 'react';
import { useCallback, useEffect, useRef, useState } from 'react';

import type { ToastIntent } from '@fluentui/react-components';

import {
  ApiError,
  ProjectFile,
  ProjectFileVersion,
  deleteProjectFile,
  deleteProjectFileVersion,
  downloadProjectFile,
  downloadProjectFileVersion,
  fetchProjectFileVersions,
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

type VersionsDialogState = {
  open: boolean;
  file: ProjectFile | null;
  versions: ProjectFileVersion[];
  loading: boolean;
  error: string | null;
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
  replaceDialog: {
    open: boolean;
    target: ProjectFile | null;
    pendingFileName: string | null;
    isReplacing: boolean;
  };
  handleReplaceConfirm: () => Promise<void>;
  handleReplaceCancel: () => void;
  openVersionsDialog: (file: ProjectFile) => void;
  closeVersionsDialog: () => void;
  versionsDialog: VersionsDialogState;
  handleDownloadVersion: (version: ProjectFileVersion) => Promise<void>;
  handleDeleteVersion: (version: ProjectFileVersion) => Promise<void>;
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

const getFileExtension = (fileName: string): string => {
  const lastDot = fileName.lastIndexOf('.');
  if (lastDot === -1) {
    return '';
  }
  return fileName.slice(lastDot).toLowerCase();
};

const normalizeFileName = (fileName: string): string => {
  const extension = getFileExtension(fileName);
  const baseName = fileName.slice(0, fileName.length - extension.length).trim();
  const normalizedBase = baseName
    ? baseName
        .normalize('NFKD')
        .replace(/[\u0000-\u001f\u007f]/g, '')
        .replace(/\s+/g, ' ')
        .slice(0, 200)
    : 'file';
  return `${normalizedBase}${extension}`;
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

  const [pendingUploadFile, setPendingUploadFile] = useState<File | null>(null);
  const [replaceTarget, setReplaceTarget] = useState<ProjectFile | null>(null);
  const [replaceDialogOpen, setReplaceDialogOpen] = useState<boolean>(false);
  const [isReplacing, setIsReplacing] = useState<boolean>(false);

  const [versionsDialog, setVersionsDialog] = useState<VersionsDialogState>({
    open: false,
    file: null,
    versions: [],
    loading: false,
    error: null
  });

  const upsertFile = useCallback((nextFile: ProjectFile) => {
    setFiles((previous) => {
      const others = previous.filter((item) => item.id !== nextFile.id);
      const merged = [nextFile, ...others];
      merged.sort(
        (a, b) =>
          new Date(b.uploadedAt).getTime() - new Date(a.uploadedAt).getTime()
      );
      return merged;
    });
  }, []);

  const reloadFiles = useCallback(
    async (options?: { showSpinner?: boolean }) => {
      if (!projectId || !token) {
        setFiles([]);
        setIsLoading(false);
        setIsRefreshing(false);
        return;
      }

      if (options?.showSpinner ?? true) {
        setIsLoading(true);
      } else {
        setIsRefreshing(true);
      }

      setError(null);

      try {
        const response = await fetchProjectFiles(projectId, token);
        setFiles(response.files);
      } catch (err) {
        console.error('Failed to load project files', err);
        setError(formatApiError(err, 'Failed to load project files.'));
      } finally {
        setIsLoading(false);
        setIsRefreshing(false);
      }
    },
    [projectId, token]
  );

  useEffect(() => {
    void reloadFiles({ showSpinner: true });
  }, [reloadFiles]);

  const resetReplaceState = useCallback(() => {
    setPendingUploadFile(null);
    setReplaceTarget(null);
    setReplaceDialogOpen(false);
    setIsReplacing(false);
  }, []);

  const loadFileVersions = useCallback(
    async (fileId: string) => {
      if (!projectId || !token) {
        return;
      }

      setVersionsDialog((previous) =>
        previous.file && previous.file.id === fileId
          ? { ...previous, loading: true, error: null }
          : previous
      );

      try {
        const response = await fetchProjectFileVersions(token, projectId, fileId);
        setVersionsDialog((previous) =>
          previous.file && previous.file.id === fileId
            ? {
                ...previous,
                versions: response.versions,
                loading: false,
                error: null
              }
            : previous
        );
      } catch (err) {
        console.error('Failed to load project file versions', err);
        const message = formatApiError(
          err,
          'Failed to load project file versions.'
        );
        setVersionsDialog((previous) =>
          previous.file && previous.file.id === fileId
            ? { ...previous, error: message, loading: false }
            : previous
        );
      }
    },
    [projectId, token]
  );

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

      if (!isAdmin) {
        showToast({
          title: 'Insufficient permissions',
          body: 'Only administrators can upload project files.',
          intent: 'error'
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

      const normalizedFileName = normalizeFileName(file.name);
      const existingFile = files.find(
        (current) =>
          current.fileName.toLowerCase() === normalizedFileName.toLowerCase()
      );

      if (existingFile) {
        setPendingUploadFile(file);
        setReplaceTarget(existingFile);
        setReplaceDialogOpen(true);
        event.target.value = '';
        return;
      }

      setIsUploading(true);

      try {
        const response = await uploadProjectFile(token, projectId, file);
        upsertFile(response.file);
        showToast({
          title: 'File uploaded',
          body: `"${file.name}" uploaded successfully.`,
          intent: 'success'
        });
      } catch (err) {
        console.error('Failed to upload project file', err);

        if (err instanceof ApiError && err.status === 409) {
          const conflictFileId =
            typeof err.fileId === 'string' ? err.fileId : undefined;
          const normalizedLower = normalizedFileName.toLowerCase();
          const matchingFile =
            (conflictFileId
              ? files.find((item) => item.id === conflictFileId)
              : undefined) ??
            files.find(
              (item) => item.fileName.toLowerCase() === normalizedLower
            );

          if (matchingFile) {
            setPendingUploadFile(file);
            setReplaceTarget(matchingFile);
            setReplaceDialogOpen(true);
            return;
          }

          showToast({
            title: 'File already exists',
            body:
              'A file with this name already exists for this project. Refresh the list to get the latest files and try again.',
            intent: 'error'
          });
          await reloadFiles({ showSpinner: false });
          return;
        }

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
    [files, isAdmin, projectId, reloadFiles, showToast, token, upsertFile]
  );

  const handleReplaceConfirm = useCallback(async () => {
    if (!pendingUploadFile || !replaceTarget || !projectId || !token) {
      resetReplaceState();
      return;
    }

    setIsReplacing(true);

    try {
      const response = await uploadProjectFile(token, projectId, pendingUploadFile, {
        replaceFileId: replaceTarget.id
      });

      upsertFile(response.file);

      showToast({
        title: 'File replaced',
        body: `"${response.file.fileName}" updated successfully.`,
        intent: 'success'
      });

      if (
        versionsDialog.open &&
        versionsDialog.file &&
        versionsDialog.file.id === replaceTarget.id
      ) {
        await loadFileVersions(replaceTarget.id);
      }

      resetReplaceState();
    } catch (err) {
      console.error('Failed to replace project file', err);

      if (err instanceof ApiError && err.status === 409) {
        showToast({
          title: 'File already exists',
          body:
            'A file with this name already exists for this project. Refresh the list to get the latest files and try again.',
          intent: 'error'
        });
        await reloadFiles({ showSpinner: false });
        resetReplaceState();
        return;
      }

      showToast({
        title: 'Replace failed',
        body: formatApiError(err, 'Unable to replace the selected file.'),
        intent: 'error'
      });
      setIsReplacing(false);
    }
  }, [
    loadFileVersions,
    pendingUploadFile,
    projectId,
    reloadFiles,
    replaceTarget,
    resetReplaceState,
    showToast,
    token,
    upsertFile,
    versionsDialog.file,
    versionsDialog.open
  ]);

  const handleReplaceCancel = useCallback(() => {
    resetReplaceState();
  }, [resetReplaceState]);

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
        setFiles((previous) => previous.filter((file) => file.id !== fileId));
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

  const openVersionsDialog = useCallback(
    (file: ProjectFile) => {
      if (!projectId || !token) {
        showToast({
          title: 'Versions unavailable',
          body: 'You must be signed in to view file versions.',
          intent: 'warning'
        });
        return;
      }

      setVersionsDialog({
        open: true,
        file,
        versions: [],
        loading: true,
        error: null
      });

      void loadFileVersions(file.id);
    },
    [loadFileVersions, projectId, showToast, token]
  );

  const closeVersionsDialog = useCallback(() => {
    setVersionsDialog({
      open: false,
      file: null,
      versions: [],
      loading: false,
      error: null
    });
  }, []);

  const handleDownloadVersion = useCallback(
    async (version: ProjectFileVersion) => {
      if (!projectId || !token) {
        showToast({
          title: 'Download not allowed',
          body: 'You must be signed in to download file versions.',
          intent: 'warning'
        });
        return;
      }

      try {
        const { blob } = await downloadProjectFileVersion(
          token,
          projectId,
          version.projectFileId,
          version.id
        );

        const extension = getFileExtension(version.fileName);
        const baseName = extension
          ? version.fileName.slice(0, version.fileName.length - extension.length)
          : version.fileName;
        const downloadName = `${baseName}_v${version.versionNumber}${
          extension ?? ''
        }`;

        triggerFileDownload(downloadName, blob);
      } catch (err) {
        console.error('Failed to download project file version', err);
        showToast({
          title: 'Download failed',
          body: formatApiError(
            err,
            'Unable to download the selected file version.'
          ),
          intent: 'error'
        });
      }
    },
    [projectId, showToast, token]
  );

  const handleDeleteVersion = useCallback(
    async (version: ProjectFileVersion) => {
      if (!projectId || !token) {
        showToast({
          title: 'Delete not allowed',
          body: 'You must be signed in to delete file versions.',
          intent: 'warning'
        });
        return;
      }

      try {
        await deleteProjectFileVersion(
          token,
          projectId,
          version.projectFileId,
          version.id
        );

        setVersionsDialog((previous) => {
          if (!previous.file || previous.file.id !== version.projectFileId) {
            return previous;
          }
          return {
            ...previous,
            versions: previous.versions.filter((item) => item.id !== version.id)
          };
        });

        showToast({
          title: 'Version deleted',
          intent: 'success'
        });
      } catch (err) {
        console.error('Failed to delete project file version', err);
        showToast({
          title: 'Delete failed',
          body: formatApiError(
            err,
            'Unable to delete the selected file version.'
          ),
          intent: 'error'
        });
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
    handleDownloadFile,
    replaceDialog: {
      open: replaceDialogOpen,
      target: replaceTarget,
      pendingFileName: pendingUploadFile?.name ?? null,
      isReplacing
    },
    handleReplaceConfirm,
    handleReplaceCancel,
    openVersionsDialog,
    closeVersionsDialog,
    versionsDialog,
    handleDownloadVersion,
    handleDeleteVersion
  };
};
