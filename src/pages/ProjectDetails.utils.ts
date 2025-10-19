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

const INTERNAL_TRAY_LENGTH_METERS = 3;

const normalizeTrayKey = (value: string): string =>
  value.trim().toLowerCase().replace(/\s+/g, ' ');

const parseRoutingSegments = (routing: string): string[] => {
  const normalized = routing
    .replace(/->/g, '>')
    .replace(/[→↦‣]/g, '>')
    .replace(/\r?\n/g, '>');

  return normalized
    .split(/[>,;|/\\]/)
    .map((segment) => segment.trim())
    .map((segment) => segment.replace(/^[-–—]+/, '').replace(/[-–—]+$/, ''))
    .map((segment) => segment.replace(/\s+/g, ' '))
    .filter((segment) => segment.length > 0);
};

export const computeDesignLength = (
  routing: string | null,
  trayLengths: Map<string, number>,
  secondaryTrayLength: number | null
): number | null => {
  if (!routing) {
    return null;
  }

  const segments = parseRoutingSegments(routing);

  if (segments.length === 0) {
    return null;
  }

  const secondary = secondaryTrayLength ?? 0;
  let total = 0;

  for (const segment of segments) {
    const key = normalizeTrayKey(segment);

    if (key.startsWith('internal')) {
      total += INTERNAL_TRAY_LENGTH_METERS;
      continue;
    }

    if (key.startsWith('secondary')) {
      total += secondary;
      continue;
    }

    const trayLength = trayLengths.get(key);

    if (trayLength) {
      total += trayLength;
    }
  }

  if (total === 0) {
    return null;
  }

  const designLength = total * 1.1;
  return Math.round(designLength * 100) / 100;
};
