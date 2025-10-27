import { PaginationMeta } from '@/api/client';

export const sanitizeFileSegment = (value: string): string =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'materials';

export const parseNumberInput = (value: string): { numeric: number | null; error?: string } => {
  const trimmed = value.trim();
  if (trimmed === '') {
    return { numeric: null };
  }

  const normalized = trimmed.replace(',', '.');
  const parsed = Number(normalized);

  if (!Number.isFinite(parsed) || parsed < 0) {
    return { numeric: null, error: 'Enter a valid non-negative number' };
  }

  return { numeric: parsed };
};

export const buildTimestampedFileName = (prefix: string): string => {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  return `${sanitizeFileSegment(prefix)}-${timestamp}.xlsx`;
};

export const downloadBlob = (blob: Blob, fileName: string): void => {
  const link = document.createElement('a');
  const url = window.URL.createObjectURL(blob);
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.URL.revokeObjectURL(url);
};

export const toFormValue = (value: number | null): string =>
  value === null || Number.isNaN(value) ? '' : String(value);

export const normalizePagination = (pagination: PaginationMeta): PaginationMeta => {
  if (pagination.totalItems === 0) {
    return {
      page: 1,
      pageSize: pagination.pageSize,
      totalItems: 0,
      totalPages: 1
    };
  }

  return pagination;
};
