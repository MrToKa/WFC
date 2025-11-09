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

export const roundToDecimalPlaces = (value: number, decimals: number): number => {
  if (decimals <= 0) {
    return Math.round(value);
  }
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
};

export const formatDecimalInputValue = (value: number, decimals: number): string => {
  const rounded = roundToDecimalPlaces(value, decimals);
  if (decimals <= 0) {
    return rounded.toFixed(0);
  }

  const fixed = rounded.toFixed(decimals);

  if (decimals === 1) {
    return fixed.replace(/\.0$/, '');
  }

  return fixed.replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, '');
};

export const limitDecimalInput = (value: string, decimals: number): string => {
  if (!value) {
    return '';
  }

  const trimmed = value.trim();
  if (trimmed === '') {
    return '';
  }

  const normalized = trimmed.replace(',', '.');

  if (normalized === '-' || normalized === '+') {
    return '';
  }

  if (normalized === '.') {
    return decimals > 0 ? '0.' : '';
  }

  const decimalIndex = normalized.indexOf('.');

  if (decimalIndex === -1) {
    return normalized;
  }

  if (decimals <= 0) {
    return normalized.slice(0, decimalIndex);
  }

  const decimalsPart = normalized.slice(decimalIndex + 1);

  if (decimalsPart.length <= decimals) {
    return normalized;
  }

  return `${normalized.slice(0, decimalIndex + 1)}${decimalsPart.slice(
    0,
    decimals
  )}`;
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

