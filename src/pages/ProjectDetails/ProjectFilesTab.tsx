import type { ChangeEvent, RefObject } from 'react';

import {
  Body1,
  Button,
  Caption1,
  Spinner,
  mergeClasses
} from '@fluentui/react-components';

import type { ProjectFile } from '@/api/client';

import type { ProjectDetailsStyles } from '../ProjectDetails.styles';

type ProjectFilesTabProps = {
  styles: ProjectDetailsStyles;
  files: ProjectFile[];
  isLoading: boolean;
  isRefreshing: boolean;
  isUploading: boolean;
  downloadingFileId: string | null;
  pendingFileId: string | null;
  error: string | null;
  canUpload: boolean;
  maxFileSizeBytes: number;
  onRefresh: () => void;
  onFileInputChange: (event: ChangeEvent<HTMLInputElement>) => Promise<void>;
  onDownload: (file: ProjectFile) => Promise<void>;
  onDelete: (fileId: string) => Promise<void>;
  fileInputAccept: string;
  fileInputRef: RefObject<HTMLInputElement | null>;
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

export const ProjectFilesTab = ({
  styles,
  files,
  isLoading,
  isRefreshing,
  isUploading,
  downloadingFileId,
  pendingFileId,
  error,
  canUpload,
  maxFileSizeBytes,
  onRefresh,
  onFileInputChange,
  onDownload,
  onDelete,
  fileInputAccept,
  fileInputRef
}: ProjectFilesTabProps) => (
  <div className={styles.tabPanel} role="tabpanel" aria-label="Project files">
    <div className={styles.actionsRow}>
      <Button onClick={onRefresh} disabled={isRefreshing}>
        {isRefreshing ? 'Refreshing...' : 'Refresh'}
      </Button>
      {canUpload ? (
        <>
          <Button
            appearance="primary"
            onClick={() => fileInputRef.current?.click()}
            disabled={isUploading}
          >
            {isUploading ? 'Uploading...' : 'Upload file'}
          </Button>
          <input
            ref={fileInputRef}
            className={styles.hiddenInput}
            type="file"
            accept={fileInputAccept}
            onChange={onFileInputChange}
          />
        </>
      ) : null}
    </div>

    {canUpload ? (
      <Caption1>
        Accepted formats: .doc, .docx, .xls, .xlsx, .pdf, .jpg, .jpeg, .png (up
        to {formatFileSize(maxFileSizeBytes)}).
      </Caption1>
    ) : null}

    {error ? <Body1 className={styles.errorText}>{error}</Body1> : null}

    {isLoading ? (
      <Spinner label="Loading files..." />
    ) : files.length === 0 ? (
      <div className={styles.emptyState}>
        <Caption1>No files uploaded yet</Caption1>
        <Body1>
          {canUpload
            ? 'Use the upload button above to attach documents and images to this project.'
            : 'There are no files uploaded for this project.'}
        </Body1>
      </div>
    ) : (
      <div className={styles.tableContainer}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th className={styles.tableHeadCell}>File name</th>
              <th className={styles.tableHeadCell}>Size</th>
              <th className={styles.tableHeadCell}>Uploaded by</th>
              <th className={styles.tableHeadCell}>Uploaded at</th>
              <th className={styles.tableHeadCell}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {files.map((file) => {
              const isDeleting = pendingFileId === file.id;
              const isDownloading = downloadingFileId === file.id;
              const rawUploaderName = file.uploadedBy
                ? [file.uploadedBy.firstName, file.uploadedBy.lastName]
                    .filter(Boolean)
                    .join(' ')
                    .trim()
                : '';
              const uploader =
                rawUploaderName && rawUploaderName !== ''
                  ? rawUploaderName
                  : file.uploadedBy?.email ?? '—';
              return (
                <tr key={file.id}>
                  <td className={styles.tableCell}>{file.fileName}</td>
                  <td
                    className={mergeClasses(
                      styles.tableCell,
                      styles.numericCell
                    )}
                  >
                    {formatFileSize(file.sizeBytes)}
                  </td>
                  <td className={styles.tableCell}>{uploader}</td>
                  <td className={styles.tableCell}>
                    {formatDateTime(file.uploadedAt)}
                  </td>
                  <td
                    className={mergeClasses(
                      styles.tableCell,
                      styles.actionsCell
                    )}
                  >
                    <Button
                      size="small"
                      appearance="secondary"
                      onClick={() => void onDownload(file)}
                      disabled={isDownloading}
                    >
                      {isDownloading ? 'Downloading...' : 'Download'}
                    </Button>
                    {file.canDelete ? (
                      <Button
                        size="small"
                        appearance="outline"
                        onClick={() => void onDelete(file.id)}
                        disabled={isDeleting}
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
  </div>
);
