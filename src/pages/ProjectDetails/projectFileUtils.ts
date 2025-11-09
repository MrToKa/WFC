import type { ProjectFile } from '@/api/client';

export type ProjectFileCategory = 'word' | 'excel' | 'pdf' | 'images';

export const PROJECT_FILE_CATEGORIES: ProjectFileCategory[] = [
  'word',
  'excel',
  'pdf',
  'images'
];

export const PROJECT_FILE_CATEGORY_LABELS: Record<ProjectFileCategory, string> =
  {
    word: 'Word',
    excel: 'Excel',
    pdf: 'PDF',
    images: 'Pictures'
  };

export const PROJECT_FILE_ACCEPT_TYPES: Record<ProjectFileCategory, string> = {
  word: '.doc,.docx',
  excel: '.xls,.xlsx',
  pdf: '.pdf',
  images: '.jpg,.jpeg,.png'
};

const getFileExtension = (fileName: string): string => {
  const lastDot = fileName.lastIndexOf('.');
  if (lastDot === -1) {
    return '';
  }
  return fileName.slice(lastDot).toLowerCase();
};

export const formatProjectFileSize = (bytes: number): string => {
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

export const formatProjectFileTimestamp = (value: string): string =>
  new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short'
  }).format(new Date(value));

export const getProjectFileCategory = (
  file: ProjectFile
): ProjectFileCategory | 'other' => {
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

