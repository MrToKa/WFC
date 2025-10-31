import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react';

import {
  Body1,
  Button,
  Caption1,
  Spinner,
  Tab,
  TabList,
  TabValue,
  Title3,
  Dialog,
  DialogSurface,
  DialogBody,
  DialogTitle,
  DialogActions,
  DialogContent,
  makeStyles,
  mergeClasses,
  shorthands,
  tokens
} from '@fluentui/react-components';

import {
  ApiError,
  TemplateFile,
  TemplateFileVersion,
  deleteTemplateFile,
  downloadTemplateFile,
  fetchTemplateFiles,
  fetchTemplateVersions,
  deleteTemplateVersion,
  downloadTemplateVersion,
  uploadTemplateFile
} from '@/api/client';
import { useAuth } from '@/context/AuthContext';
import { useToast } from '@/context/ToastContext';
import { TemplateImagePreview } from './Materials/components/TemplateImagePreview';

const useStyles = makeStyles({
  root: {
    display: 'flex',
    flexDirection: 'column',
    gap: '1.5rem',
    width: '100%',
    maxWidth: '100%',
    ...shorthands.padding('0', '0', '2rem')
  },
  header: {
    display: 'flex',
    flexDirection: 'column',
    gap: '0.5rem'
  },
  actions: {
    display: 'flex',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: '0.75rem'
  },
  tableWrapper: {
    width: '100%',
    overflowX: 'auto'
  },
  table: {
    width: '100%',
    borderCollapse: 'collapse',
    minWidth: '40rem'
  },
  replaceDialogSurface: {
    width: 'min(90vw, 32rem)'
  },
  versionsDialogSurface: {
    width: 'min(95vw, 80rem)',
    maxWidth: '80rem'
  },
  versionsDialogContent: {
    overflowX: 'auto',
    maxHeight: '70vh'
  },
  versionsDialogTable: {
    width: '100%',
    minWidth: '56rem',
    borderCollapse: 'collapse'
  },
  headCell: {
    textAlign: 'left',
    padding: '0.75rem 1rem',
    backgroundColor: tokens.colorNeutralBackground2,
    borderBottom: `1px solid ${tokens.colorNeutralStroke1}`
  },
  cell: {
    padding: '0.75rem 1rem',
    borderBottom: `1px solid ${tokens.colorNeutralStroke1}`,
    verticalAlign: 'middle',
    wordBreak: 'break-word'
  },
  numericCell: {
    textAlign: 'right'
  },
  actionsCell: {
    display: 'flex',
    gap: '0.5rem',
    flexWrap: 'wrap',
    alignItems: 'center'
  },
  emptyState: {
    padding: '1rem',
    borderRadius: tokens.borderRadiusMedium,
    border: `1px solid ${tokens.colorNeutralStroke1}`,
    backgroundColor: tokens.colorNeutralBackground2
  },
  errorText: {
    color: tokens.colorStatusDangerForeground1
  },
  hiddenInput: {
    display: 'none'
  }
});

const MAX_FILE_SIZE_BYTES = 25 * 1024 * 1024;
type TemplateCategory = 'word' | 'excel' | 'pdf' | 'images';

const TEMPLATE_CATEGORIES: TemplateCategory[] = ['word', 'excel', 'pdf', 'images'];

const CATEGORY_LABELS: Record<TemplateCategory, string> = {
  word: 'Word',
  excel: 'Excel',
  pdf: 'PDF',
  images: 'Pictures'
};

const CATEGORY_ACCEPT_TYPES: Record<TemplateCategory, string> = {
  word: '.doc,.docx',
  excel: '.xls,.xlsx',
  pdf: '.pdf',
  images: '.jpg,.jpeg,.png'
};

const formatFileSize = (bytes: number): string => {
  if (!Number.isFinite(bytes) || bytes <= 0) {
    return '0 B';
  }

  const units = ['B', 'KB', 'MB', 'GB'];
  const exponent = Math.min(
    Math.floor(Math.log(bytes) / Math.log(1024)),
    units.length - 1
  );
  const value = bytes / 1024 ** exponent;
  const decimals = value >= 10 || exponent === 0 ? 0 : 1;
  return `${value.toFixed(decimals)} ${units[exponent]}`;
};

const formatDateTime = (value: string): string =>
  new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short'
  }).format(new Date(value));

const getFileExtension = (fileName: string): string => {
  const lastDot = fileName.lastIndexOf('.');
  if (lastDot === -1) {
    return '';
  }
  return fileName.slice(lastDot).toLowerCase();
};

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

const normalizeFileName = (fileName: string): string => {
  const extension = getFileExtension(fileName);
  const baseName = fileName.slice(0, fileName.length - extension.length).trim();
  const normalizedBase = baseName
    ? baseName
        .normalize('NFKD')
        .replace(/[\u0000-\u001f\u007f]/g, '')
        .replace(/\s+/g, ' ')
        .slice(0, 200)
    : 'template';
  return `${normalizedBase}${extension}`;
};

const getTemplateCategory = (file: TemplateFile): TemplateCategory | 'other' => {
  const extension = getFileExtension(file.fileName);
  const contentType = (file.contentType ?? '').toLowerCase();

  if (
    extension === '.doc' ||
    extension === '.docx' ||
    contentType.includes('wordprocessing')
  ) {
    return 'word';
  }

  if (
    extension === '.xls' ||
    extension === '.xlsx' ||
    contentType.includes('spreadsheet') ||
    contentType.includes('excel')
  ) {
    return 'excel';
  }

  if (extension === '.pdf' || contentType.includes('pdf')) {
    return 'pdf';
  }

  if (
    extension === '.jpg' ||
    extension === '.jpeg' ||
    extension === '.png' ||
    contentType.startsWith('image/')
  ) {
    return 'images';
  }

  return 'other';
};

export const Templates = () => {
  const styles = useStyles();
  const { user, token } = useAuth();
  const { showToast } = useToast();
  const isAdmin = Boolean(user?.isAdmin);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const [files, setFiles] = useState<TemplateFile[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isRefreshing, setIsRefreshing] = useState<boolean>(false);
  const [isUploading, setIsUploading] = useState<boolean>(false);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selectedCategory, setSelectedCategory] = useState<TemplateCategory>('word');
  const [pendingUploadFile, setPendingUploadFile] = useState<File | null>(null);
  const [replaceTarget, setReplaceTarget] = useState<TemplateFile | null>(null);
  const [replaceDialogOpen, setReplaceDialogOpen] = useState<boolean>(false);
  const [isReplacing, setIsReplacing] = useState<boolean>(false);

  type VersionsDialogState = {
    open: boolean;
    template: TemplateFile | null;
    versions: TemplateFileVersion[];
    loading: boolean;
    error: string | null;
  };

  const [versionsDialog, setVersionsDialog] = useState<VersionsDialogState>({
    open: false,
    template: null,
    versions: [],
    loading: false,
    error: null
  });

  const upsertTemplateFile = useCallback((template: TemplateFile) => {
    setFiles((previous) => {
      const others = previous.filter((file) => file.id !== template.id);
      const next = [template, ...others];
      next.sort(
        (a, b) =>
          new Date(b.uploadedAt).getTime() - new Date(a.uploadedAt).getTime()
      );
      return next;
    });
  }, []);

  const loadFiles = useCallback(
    async (options?: { showSpinner?: boolean }) => {
      if (options?.showSpinner ?? true) {
        setIsLoading(true);
      } else {
        setIsRefreshing(true);
      }

      setError(null);

      if (!token) {
        setFiles([]);
        setIsLoading(false);
        setIsRefreshing(false);
        return;
      }

      try {
        const response = await fetchTemplateFiles(token);
        setFiles(response.files);
      } catch (err) {
        console.error('Failed to load template files', err);
        const message = formatApiError(err, 'Failed to load template files.');
        setError(message);
        showToast({
          intent: 'error',
          title: 'Failed to load template files.',
          body: message
        });
      } finally {
        setIsLoading(false);
        setIsRefreshing(false);
      }
    },
    [showToast, token]
  );

  useEffect(() => {
    void loadFiles({ showSpinner: true });
  }, [loadFiles]);

  const loadTemplateVersions = useCallback(
    async (templateId: string) => {
      if (!token) {
        return;
      }

      setVersionsDialog((previous) =>
        previous.template && previous.template.id === templateId
          ? { ...previous, loading: true, error: null }
          : previous
      );

      try {
        const response = await fetchTemplateVersions(token, templateId);
        setVersionsDialog((previous) =>
          previous.template && previous.template.id === templateId
            ? { ...previous, versions: response.versions, loading: false }
            : previous
        );
      } catch (err) {
        console.error('Failed to load template versions', err);
        const message = formatApiError(
          err,
          'Failed to load template versions.'
        );
        setVersionsDialog((previous) =>
          previous.template && previous.template.id === templateId
            ? { ...previous, error: message, loading: false }
            : previous
        );
      }
    },
    [token]
  );

  const openVersionsDialog = useCallback(
    (template: TemplateFile) => {
      setVersionsDialog({
        open: true,
        template,
        versions: [],
        loading: true,
        error: null
      });

      if (token) {
        void loadTemplateVersions(template.id);
      }
    },
    [loadTemplateVersions, token]
  );

  const closeVersionsDialog = useCallback(() => {
    setVersionsDialog({
      open: false,
      template: null,
      versions: [],
      loading: false,
      error: null
    });
  }, []);

  const handleDownloadVersion = useCallback(
    async (version: TemplateFileVersion) => {
      if (!token) {
        showToast({
          intent: 'warning',
          title: 'Download not allowed',
          body: 'You must be signed in to download templates.'
        });
        return;
      }

      try {
        const { blob } = await downloadTemplateVersion(
          token,
          version.templateId,
          version.id
        );
        const extension = getFileExtension(version.fileName);
        const downloadName = extension
          ? `${version.fileName.slice(
              0,
              version.fileName.length - extension.length
            )}_v${version.versionNumber}${extension}`
          : `${version.fileName}_v${version.versionNumber}`;
        triggerFileDownload(downloadName, blob);
      } catch (err) {
        console.error('Failed to download template version', err);
        showToast({
          intent: 'error',
          title: 'Download failed',
          body: formatApiError(
            err,
            'Unable to download the selected version.'
          )
        });
      }
    },
    [showToast, token]
  );

  const handleDeleteVersion = useCallback(
    async (version: TemplateFileVersion) => {
      if (!token) {
        showToast({
          intent: 'warning',
          title: 'Delete not allowed',
          body: 'You must be signed in to delete template versions.'
        });
        return;
      }

      const confirmed = window.confirm(
        `Delete version ${version.versionNumber} of \"${version.fileName}\"? This action cannot be undone.`
      );

      if (!confirmed) {
        return;
      }

      try {
        await deleteTemplateVersion(token, version.templateId, version.id);
        setVersionsDialog((previous) => {
          if (!previous.template || previous.template.id !== version.templateId) {
            return previous;
          }
          return {
            ...previous,
            versions: previous.versions.filter((item) => item.id !== version.id)
          };
        });
        showToast({ intent: 'success', title: 'Version deleted' });
      } catch (err) {
        console.error('Failed to delete template version', err);
        showToast({
          intent: 'error',
          title: 'Failed to delete version',
          body: formatApiError(
            err,
            'Unable to delete the selected version.'
          )
        });
      }
    },
    [showToast, token]
  );

  const resetReplaceState = useCallback(() => {
    setPendingUploadFile(null);
    setReplaceTarget(null);
    setReplaceDialogOpen(false);
    setIsReplacing(false);
  }, []);

  const handleReplaceCancel = useCallback(() => {
    resetReplaceState();
  }, [resetReplaceState]);

  const handleReplaceConfirm = useCallback(async () => {
    if (!pendingUploadFile || !replaceTarget) {
      resetReplaceState();
      return;
    }

    if (!token) {
      showToast({
        intent: 'warning',
        title: 'Replace not allowed',
        body: 'You must be signed in to upload templates.'
      });
      resetReplaceState();
      return;
    }

    setIsReplacing(true);

    try {
      const response = await uploadTemplateFile(token, pendingUploadFile, {
        replaceTemplateId: replaceTarget.id
      });

      upsertTemplateFile(response.file);

      showToast({
        intent: 'success',
        title: 'Template replaced',
        body: `"${response.file.fileName}" updated successfully.`
      });

      void loadTemplateVersions(replaceTarget.id);

      resetReplaceState();
    } catch (err) {
      console.error('Failed to replace template file', err);
      showToast({
        intent: 'error',
        title: 'Replace failed',
        body: formatApiError(err, 'Unable to replace the selected file.')
      });
      setIsReplacing(false);
    }
  }, [
    loadTemplateVersions,
    pendingUploadFile,
    replaceTarget,
    resetReplaceState,
    showToast,
    token,
    upsertTemplateFile
  ]);
  const handleUpload = useCallback(
    async (event: ChangeEvent<HTMLInputElement>) => {
      const selectedFile = event.target.files?.[0];

      if (!selectedFile) {
        return;
      }

      if (!token) {
        showToast({
          title: 'Upload not allowed',
          body: 'You must be signed in to upload templates.',
          intent: 'warning'
        });
        event.target.value = '';
        return;
      }

      if (!isAdmin) {
        showToast({
          title: 'Insufficient permissions',
          body: 'Only administrators can upload template files.',
          intent: 'error'
        });
        event.target.value = '';
        return;
      }

      if (selectedFile.size > MAX_FILE_SIZE_BYTES) {
        showToast({
          title: 'File is too large',
          body: 'Maximum allowed size is 25 MB.',
          intent: 'error'
        });
        event.target.value = '';
        return;
      }

      const acceptedExtensions = CATEGORY_ACCEPT_TYPES[selectedCategory]
        .split(',')
        .map((value) => value.trim());
      const extension = getFileExtension(selectedFile.name);

      if (!acceptedExtensions.includes(extension)) {
        showToast({
          title: 'Unsupported file type',
          body: `Please upload a ${CATEGORY_LABELS[selectedCategory]} file (${acceptedExtensions.join(', ')}).`,
          intent: 'error'
        });
        event.target.value = '';
        return;
      }

      const normalizedFileName = normalizeFileName(selectedFile.name);
      const existingTemplate = files.find(
        (current) =>
          current.fileName.toLowerCase() === normalizedFileName.toLowerCase()
      );

      if (existingTemplate) {
        setPendingUploadFile(selectedFile);
        setReplaceTarget(existingTemplate);
        setReplaceDialogOpen(true);
        event.target.value = '';
        return;
      }

      setIsUploading(true);

      try {
        const response = await uploadTemplateFile(token, selectedFile);
        upsertTemplateFile(response.file);
        showToast({
          title: 'Template uploaded',
          body: `"${selectedFile.name}" uploaded successfully.`,
          intent: 'success'
        });
      } catch (err) {
        console.error('Failed to upload template file', err);

         if (err instanceof ApiError && err.status === 409) {
           const conflictTemplateId =
             typeof err.templateId === 'string' ? err.templateId : undefined;
           const normalizedLower = normalizedFileName.toLowerCase();
           const matchingTemplate =
             (conflictTemplateId
               ? files.find((item) => item.id === conflictTemplateId)
               : undefined) ??
             files.find(
               (item) => item.fileName.toLowerCase() === normalizedLower
             );

           if (matchingTemplate) {
             setPendingUploadFile(selectedFile);
             setReplaceTarget(matchingTemplate);
             setReplaceDialogOpen(true);
             return;
           }

           showToast({
             title: 'File already exists',
             body:
               'A template with this name already exists. Refresh the list to get the latest files and try again.',
             intent: 'error'
           });
           void loadFiles({ showSpinner: false });
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
    [
      files,
      isAdmin,
      loadFiles,
      selectedCategory,
      showToast,
      token,
      upsertTemplateFile
    ]
  );

  const handleDelete = useCallback(
    async (templateId: string) => {
      if (!token) {
        showToast({
          title: 'Delete not allowed',
          body: 'You must be signed in to delete templates.',
          intent: 'warning'
        });
        return;
      }

      setDeletingId(templateId);

      try {
        await deleteTemplateFile(token, templateId);
        setFiles((prev) => prev.filter((file) => file.id !== templateId));
        setVersionsDialog((previous) =>
          previous.template && previous.template.id === templateId
            ? {
                open: false,
                template: null,
                versions: [],
                loading: false,
                error: null
              }
            : previous
        );
        showToast({ title: 'Template deleted', intent: 'success' });
      } catch (err) {
        console.error('Failed to delete template file', err);
        showToast({
          title: 'Delete failed',
          body: formatApiError(err, 'Unable to delete the selected template.'),
          intent: 'error'
        });
      } finally {
        setDeletingId(null);
      }
    },
    [showToast, token]
  );

  const handleDownload = useCallback(
    async (file: TemplateFile) => {
      if (!token) {
        showToast({
          title: 'Download not allowed',
          body: 'You must be signed in to download templates.',
          intent: 'warning'
        });
        return;
      }

      setDownloadingId(file.id);

      try {
        const { blob } = await downloadTemplateFile(token, file.id);
        triggerFileDownload(file.fileName, blob);
      } catch (err) {
        console.error('Failed to download template file', err);
        showToast({
          title: 'Download failed',
          body: formatApiError(err, 'Unable to download the selected template.'),
          intent: 'error'
        });
      } finally {
        setDownloadingId(null);
      }
    },
    [showToast, token]
  );

  const filteredFiles = useMemo(
    () => files.filter((file) => getTemplateCategory(file) === selectedCategory),
    [files, selectedCategory]
  );

  const currentAcceptTypes = CATEGORY_ACCEPT_TYPES[selectedCategory];

  const emptyMessage =
    selectedCategory === 'images'
      ? 'No picture files uploaded yet.'
      : `No ${CATEGORY_LABELS[selectedCategory]} files uploaded yet.`;

  return (
    <section className={styles.root} aria-labelledby="templates-heading">
      <div className={styles.header}>
        <Title3 id="templates-heading">Templates</Title3>
        <Body1>
          Manage Excel and document templates used across projects. Uploaded
          templates are available to every project.
        </Body1>
      </div>

      <TabList
        selectedValue={selectedCategory}
        onTabSelect={(_, data: { value: TabValue }) =>
          setSelectedCategory(data.value as TemplateCategory)
        }
        aria-label="Template categories"
      >
        {TEMPLATE_CATEGORIES.map((category) => (
          <Tab key={category} value={category}>
            {CATEGORY_LABELS[category]}
          </Tab>
        ))}
      </TabList>

      <div className={styles.actions}>
        <Button onClick={() => void loadFiles({ showSpinner: false })} disabled={isRefreshing}>
          {isRefreshing ? 'Refreshing...' : 'Refresh'}
        </Button>
        {isAdmin ? (
          <>
            <Button
              appearance="primary"
              onClick={() => fileInputRef.current?.click()}
              disabled={isUploading}
            >
              {isUploading
                ? 'Uploading...'
                : `Upload ${CATEGORY_LABELS[selectedCategory]} file`}
            </Button>
            <input
              ref={fileInputRef}
              className={styles.hiddenInput}
              type="file"
              accept={currentAcceptTypes}
              onChange={handleUpload}
            />
          </>
        ) : null}
      </div>

      {isAdmin ? (
        <Caption1>
          Accepted formats for {CATEGORY_LABELS[selectedCategory]}:{' '}
          {currentAcceptTypes.replace(/,/g, ', ')} (up to{' '}
          {formatFileSize(MAX_FILE_SIZE_BYTES)}).
        </Caption1>
      ) : null}

      {error ? <Body1 className={styles.errorText}>{error}</Body1> : null}

      {isLoading ? (
        <Spinner label="Loading templates..." />
      ) : filteredFiles.length === 0 ? (
        <div className={styles.emptyState}>
          <Caption1>{emptyMessage}</Caption1>
          <Body1>No files available in this category.</Body1>
        </div>
      ) : (
        <div className={styles.tableWrapper}>
          <table className={styles.table}>
            <thead>
              <tr>
                {selectedCategory === 'images' ? (
                  <th className={styles.headCell}>Preview</th>
                ) : null}
                <th className={styles.headCell}>Template</th>
                <th className={styles.headCell}>Size</th>
                <th className={styles.headCell}>Uploaded by</th>
                <th className={styles.headCell}>Uploaded at</th>
                <th className={styles.headCell}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filteredFiles.map((file) => {
                const rawUploaderName = file.uploadedBy
                  ? [file.uploadedBy.firstName, file.uploadedBy.lastName]
                      .filter(Boolean)
                      .join(' ')
                      .trim()
                  : '';
                const uploader =
                  rawUploaderName !== ''
                    ? rawUploaderName
                    : file.uploadedBy?.email ?? '—';
                const isDownloading = downloadingId === file.id;
                const isDeleting = deletingId === file.id;

                return (
                  <tr key={file.id}>
                    {selectedCategory === 'images' ? (
                      <td className={styles.cell}>
                        <TemplateImagePreview
                          token={token}
                          templateId={file.id}
                          fileName={file.fileName}
                          contentType={file.contentType}
                        />
                      </td>
                    ) : null}
                    <td className={styles.cell}>{file.fileName}</td>
                    <td className={mergeClasses(styles.cell, styles.numericCell)}>
                      {formatFileSize(file.sizeBytes)}
                    </td>
                    <td className={styles.cell}>{uploader}</td>
                    <td className={styles.cell}>{formatDateTime(file.uploadedAt)}</td>
                    <td className={mergeClasses(styles.cell, styles.actionsCell)}>
                      <Button
                        size="small"
                        appearance="secondary"
                        onClick={() => openVersionsDialog(file)}
                      >
                        Versions
                      </Button>
                      <Button
                        size="small"
                        appearance="secondary"
                        onClick={() => void handleDownload(file)}
                        disabled={isDownloading}
                      >
                        {isDownloading ? 'Downloading...' : 'Download'}
                      </Button>
                      {file.canDelete ? (
                        <Button
                          size="small"
                          appearance="outline"
                          disabled={isDeleting}
                          onClick={() => void handleDelete(file.id)}
                        >
                          {isDeleting ? 'Deleting...' : 'Delete'}
                        </Button>
                      ) : null}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <Dialog
        open={replaceDialogOpen}
        onOpenChange={(_, data) => {
          if (!data.open) {
            handleReplaceCancel();
          }
        }}
      >
        <DialogSurface className={styles.replaceDialogSurface}>
          <DialogBody>
            <DialogTitle>Replace template?</DialogTitle>
            <DialogContent>
              <Body1>
                {replaceTarget && pendingUploadFile
                  ? `Do you want to replace "${replaceTarget.fileName}" with "${pendingUploadFile.name}"?`
                  : 'Do you want to replace the existing file?'}
              </Body1>
            </DialogContent>
            <DialogActions>
              <Button
                appearance="secondary"
                onClick={handleReplaceCancel}
                disabled={isReplacing}
              >
                Cancel
              </Button>
              <Button
                appearance="primary"
                onClick={() => void handleReplaceConfirm()}
                disabled={isReplacing}
              >
                {isReplacing ? 'Replacing...' : 'Replace'}
              </Button>
            </DialogActions>
          </DialogBody>
        </DialogSurface>
      </Dialog>

      <Dialog
        open={versionsDialog.open}
        onOpenChange={(_, data) => {
          if (!data.open) {
            closeVersionsDialog();
          }
        }}
      >
        <DialogSurface className={styles.versionsDialogSurface}>
          <DialogBody>
            <DialogTitle>
              Previous versions - {versionsDialog.template?.fileName ?? ''}
            </DialogTitle>
            <DialogContent className={styles.versionsDialogContent}>
              {versionsDialog.loading ? (
                <Spinner label="Loading versions..." />
              ) : versionsDialog.error ? (
                <Body1 className={styles.errorText}>{versionsDialog.error}</Body1>
              ) : versionsDialog.versions.length === 0 ? (
                <Caption1>No previous versions.</Caption1>
              ) : (
                <table className={styles.versionsDialogTable}>
                  <thead>
                    <tr>
                      <th className={styles.headCell}>Version</th>
                      <th className={styles.headCell}>Size</th>
                      <th className={styles.headCell}>Uploaded by</th>
                      <th className={styles.headCell}>Uploaded at</th>
                      <th className={styles.headCell}>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {versionsDialog.versions.map((version) => {
                      const rawName = version.uploadedBy
                        ? [version.uploadedBy.firstName, version.uploadedBy.lastName]
                            .filter(Boolean)
                            .join(' ')
                            .trim()
                        : '';
                      const versionUploader =
                        rawName !== ''
                          ? rawName
                          : version.uploadedBy?.email ?? '—';

                      return (
                        <tr key={version.id}>
                          <td className={styles.cell}>v{version.versionNumber}</td>
                          <td className={mergeClasses(styles.cell, styles.numericCell)}>
                            {formatFileSize(version.sizeBytes)}
                          </td>
                          <td className={styles.cell}>{versionUploader}</td>
                          <td className={styles.cell}>{formatDateTime(version.uploadedAt)}</td>
                          <td className={mergeClasses(styles.cell, styles.actionsCell)}>
                            <Button
                              size="small"
                              appearance="secondary"
                              onClick={() => void handleDownloadVersion(version)}
                            >
                              Download
                            </Button>
                            {isAdmin ? (
                              <Button
                                size="small"
                                appearance="outline"
                                onClick={() => void handleDeleteVersion(version)}
                              >
                                Delete
                              </Button>
                            ) : null}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </DialogContent>
            <DialogActions>
              <Button onClick={closeVersionsDialog}>Close</Button>
            </DialogActions>
          </DialogBody>
        </DialogSurface>
      </Dialog>
    </section>
  );
};
