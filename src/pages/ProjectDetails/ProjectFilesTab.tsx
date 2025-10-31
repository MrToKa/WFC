import { useMemo, useState, type ChangeEvent, type RefObject } from 'react';

import {
  Body1,
  Button,
  Caption1,
  Dialog,
  DialogActions,
  DialogBody,
  DialogContent,
  DialogSurface,
  DialogTitle,
  Spinner,
  Tab,
  TabList,
  TabValue,
  mergeClasses
} from '@fluentui/react-components';

import type { ProjectFile, ProjectFileVersion } from '@/api/client';

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
  onOpenVersions: (file: ProjectFile) => void;
  onCloseVersions: () => void;
  versionsDialog: {
    open: boolean;
    file: ProjectFile | null;
    versions: ProjectFileVersion[];
    loading: boolean;
    error: string | null;
  };
  onDownloadVersion: (version: ProjectFileVersion) => Promise<void>;
  onDeleteVersion: (version: ProjectFileVersion) => Promise<void>;
  replaceDialog: {
    open: boolean;
    target: ProjectFile | null;
    pendingFileName: string | null;
    isReplacing: boolean;
  };
  onReplaceConfirm: () => Promise<void>;
  onReplaceCancel: () => void;
  fileInputRef: RefObject<HTMLInputElement | null>;
};

type FileCategory = 'word' | 'excel' | 'pdf' | 'images';

const FILE_CATEGORIES: FileCategory[] = ['word', 'excel', 'pdf', 'images'];

const CATEGORY_LABELS: Record<FileCategory, string> = {
  word: 'Word',
  excel: 'Excel',
  pdf: 'PDF',
  images: 'Pictures'
};

const CATEGORY_ACCEPT_TYPES: Record<FileCategory, string> = {
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

const getFileCategory = (file: ProjectFile): FileCategory | 'other' => {
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
  onOpenVersions,
  onCloseVersions,
  versionsDialog,
  onDownloadVersion,
  onDeleteVersion,
  replaceDialog,
  onReplaceConfirm,
  onReplaceCancel,
  fileInputRef
}: ProjectFilesTabProps) => {
  const [selectedCategory, setSelectedCategory] = useState<FileCategory>('word');

  const {
    open: replaceDialogOpen,
    target: replaceTarget,
    pendingFileName,
    isReplacing
  } = replaceDialog;

  const versionsDialogFileName = versionsDialog.file?.fileName ?? '';

  const filteredFiles = useMemo(
    () => files.filter((file) => getFileCategory(file) === selectedCategory),
    [files, selectedCategory]
  );

  const currentAcceptTypes = CATEGORY_ACCEPT_TYPES[selectedCategory];

  const emptyMessage =
    selectedCategory === 'images'
      ? 'No picture files uploaded yet.'
      : `No ${CATEGORY_LABELS[selectedCategory]} files uploaded yet.`;

  return (
    <div className={styles.tabPanel} role="tabpanel" aria-label="Project files">
      <TabList
        selectedValue={selectedCategory}
        onTabSelect={(_, data: { value: TabValue }) =>
          setSelectedCategory(data.value as FileCategory)
        }
        aria-label="File categories"
      >
        {FILE_CATEGORIES.map((category) => (
          <Tab key={category} value={category}>
            {CATEGORY_LABELS[category]}
          </Tab>
        ))}
      </TabList>

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
              {isUploading
                ? 'Uploading...'
                : `Upload ${CATEGORY_LABELS[selectedCategory]} file`}
            </Button>
            <input
              ref={fileInputRef}
              className={styles.hiddenInput}
              type="file"
              accept={currentAcceptTypes}
              onChange={onFileInputChange}
            />
          </>
        ) : null}
      </div>

      {canUpload ? (
        <Caption1>
          Accepted formats for {CATEGORY_LABELS[selectedCategory]}:{' '}
          {currentAcceptTypes.replace(/,/g, ', ')} (up to{' '}
          {formatFileSize(maxFileSizeBytes)}).
        </Caption1>
      ) : null}

      {error ? <Body1 className={styles.errorText}>{error}</Body1> : null}

      {isLoading ? (
        <Spinner label="Loading files..." />
      ) : filteredFiles.length === 0 ? (
        <div className={styles.emptyState}>
          <Caption1>{emptyMessage}</Caption1>
          <Body1>
            {canUpload
              ? `Use the upload button above to attach ${CATEGORY_LABELS[
                  selectedCategory
                ].toLowerCase()} files to this project.`
              : `There are no ${CATEGORY_LABELS[
                  selectedCategory
                ].toLowerCase()} files uploaded for this project.`}
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
              {filteredFiles.map((file) => {
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
                        onClick={() => onOpenVersions(file)}
                      >
                        Versions
                      </Button>
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

      <Dialog
        open={replaceDialogOpen}
        onOpenChange={(_, data) => {
          if (!data.open) {
            onReplaceCancel();
          }
        }}
      >
        <DialogSurface className={styles.replaceDialogSurface}>
          <DialogBody>
            <DialogTitle>Replace file?</DialogTitle>
            <DialogContent>
              <Body1>
                {replaceTarget && pendingFileName
                  ? `Do you want to replace "${replaceTarget.fileName}" with "${pendingFileName}"?`
                  : 'Do you want to replace the existing file?'}
              </Body1>
            </DialogContent>
            <DialogActions>
              <Button
                appearance="secondary"
                onClick={onReplaceCancel}
                disabled={isReplacing}
              >
                Cancel
              </Button>
              <Button
                appearance="primary"
                onClick={() => void onReplaceConfirm()}
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
            onCloseVersions();
          }
        }}
      >
        <DialogSurface className={styles.versionsDialogSurface}>
          <DialogBody>
            <DialogTitle>
              Previous versions - {versionsDialogFileName}
            </DialogTitle>
            <DialogContent className={styles.versionsDialogContent}>
              {versionsDialog.loading ? (
                <Spinner label="Loading versions..." />
              ) : versionsDialog.error ? (
                <Body1 className={styles.errorText}>
                  {versionsDialog.error}
                </Body1>
              ) : versionsDialog.versions.length === 0 ? (
                <Caption1>No previous versions.</Caption1>
              ) : (
                <table className={styles.versionsDialogTable}>
                  <thead>
                    <tr>
                      <th className={styles.tableHeadCell}>Version</th>
                      <th className={styles.tableHeadCell}>Size</th>
                      <th className={styles.tableHeadCell}>Uploaded by</th>
                      <th className={styles.tableHeadCell}>Uploaded at</th>
                      <th className={styles.tableHeadCell}>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {versionsDialog.versions.map((version) => {
                      const rawVersionUploader = version.uploadedBy
                        ? [
                            version.uploadedBy.firstName,
                            version.uploadedBy.lastName
                          ]
                            .filter(Boolean)
                            .join(' ')
                            .trim()
                        : '';
                      const versionUploader =
                        rawVersionUploader && rawVersionUploader !== ''
                          ? rawVersionUploader
                          : version.uploadedBy?.email ?? '—';

                      return (
                        <tr key={version.id}>
                          <td className={styles.tableCell}>
                            v{version.versionNumber}
                          </td>
                          <td
                            className={mergeClasses(
                              styles.tableCell,
                              styles.numericCell
                            )}
                          >
                            {formatFileSize(version.sizeBytes)}
                          </td>
                          <td className={styles.tableCell}>
                            {versionUploader}
                          </td>
                          <td className={styles.tableCell}>
                            {formatDateTime(version.uploadedAt)}
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
                              onClick={() => void onDownloadVersion(version)}
                            >
                              Download
                            </Button>
                            {canUpload ? (
                              <Button
                                size="small"
                                appearance="outline"
                                onClick={() => void onDeleteVersion(version)}
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
              <Button onClick={onCloseVersions}>Close</Button>
            </DialogActions>
          </DialogBody>
        </DialogSurface>
      </Dialog>
    </div>
  );
};
