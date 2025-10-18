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
