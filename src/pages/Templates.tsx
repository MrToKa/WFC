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
  makeStyles,
  mergeClasses,
  shorthands,
  tokens
} from '@fluentui/react-components';

import {
  ApiError,
  TemplateFile,
  deleteTemplateFile,
  downloadTemplateFile,
  fetchTemplateFiles,
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

      setIsUploading(true);

      try {
        const response = await uploadTemplateFile(token, selectedFile);
        setFiles((prev) => [response.file, ...prev]);
        showToast({
          title: 'Template uploaded',
          body: `"${selectedFile.name}" uploaded successfully.`,
          intent: 'success'
        });
      } catch (err) {
        console.error('Failed to upload template file', err);
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
    [isAdmin, selectedCategory, showToast, token]
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
          {isAdmin ? (
            <Body1>
              Use the upload button above to add shared {CATEGORY_LABELS[selectedCategory]} files.
            </Body1>
          ) : null}
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
    </section>
  );
};
