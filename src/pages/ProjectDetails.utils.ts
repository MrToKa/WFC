export const formatNumeric = (value: number | null): string =>
  value === null
    ? '-'
    : new Intl.NumberFormat(undefined, {
        maximumFractionDigits: 3
      }).format(value);

export const sanitizeFileSegment = (value: string): string =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'project';

export const toNullableString = (value: string): string | null => {
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
};

export const parseNumberInput = (
  value: string
): { numeric: number | null; error?: string } => {
  const trimmed = value.trim();

  if (trimmed === '') {
    return { numeric: null };
  }

  const normalized = trimmed.replace(',', '.');
  const parsed = Number(normalized);

  if (!Number.isFinite(parsed)) {
    return { numeric: null, error: 'Enter a valid number' };
  }

  if (parsed < 0) {
    return { numeric: null, error: 'Value must be positive' };
  }

  return { numeric: parsed };
};

const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export const formatDisplayDate = (value: string | null | undefined): string => {
  if (!value) {
    return '-';
  }

  const trimmed = value.trim();
  const iso = trimmed.slice(0, 10);

  if (!ISO_DATE_PATTERN.test(iso)) {
    return trimmed;
  }

  const [year, month, day] = iso.split('-');
  return `${day}-${month}-${year}`;
};

export const isIsoDateString = (value: string): boolean =>
  ISO_DATE_PATTERN.test(value.trim());

const WORD_EXTENSIONS = ['.doc', '.docx', '.docm', '.dot', '.dotx'];

export const isWordDocument = (
  fileName: string,
  contentType: string | null | undefined
): boolean => {
  const lowerName = fileName.toLowerCase();
  if (WORD_EXTENSIONS.some((extension) => lowerName.endsWith(extension))) {
    return true;
  }

  if (!contentType) {
    return false;
  }

  const lowerType = contentType.toLowerCase();
  return (
    lowerType === 'application/msword' ||
    lowerType.includes('wordprocessingml')
  );
};

