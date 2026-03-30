import type { CableVersion } from '@/api/client';

export type CableVersionFieldDiff = {
  label: string;
  previousValue: string;
  nextValue: string;
};

const versionTimestampFormatter = new Intl.DateTimeFormat(undefined, {
  dateStyle: 'medium',
  timeStyle: 'short'
});

export const formatCableVersionTimestamp = (value: string): string => {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime())
    ? value
    : versionTimestampFormatter.format(parsed);
};

export const formatCableVersionUser = (version: CableVersion): string => {
  const rawName = version.changedBy
    ? [version.changedBy.firstName, version.changedBy.lastName]
        .filter(Boolean)
        .join(' ')
        .trim()
    : '';

  return rawName || version.changedBy?.email || '-';
};

export const formatCableVersionValue = (value: string | number | null): string =>
  value === null || value === '' ? '-' : String(value);

export const diffCableVersions = (
  current: CableVersion,
  previous: CableVersion | null
): CableVersionFieldDiff[] => {
  if (!previous) {
    return [];
  }

  const fields: Array<{
    label: string;
    currentValue: string | number | null;
    previousValue: string | number | null;
  }> = [
    {
      label: 'Cable ID',
      currentValue: current.cableId,
      previousValue: previous.cableId
    },
    {
      label: 'Revision',
      currentValue: current.revision,
      previousValue: previous.revision
    },
    {
      label: 'MTO',
      currentValue: current.mto,
      previousValue: previous.mto
    },
    {
      label: 'Tag',
      currentValue: current.tag,
      previousValue: previous.tag
    },
    {
      label: 'Type',
      currentValue: current.typeName,
      previousValue: previous.typeName
    },
    {
      label: 'From location',
      currentValue: current.fromLocation,
      previousValue: previous.fromLocation
    },
    {
      label: 'To location',
      currentValue: current.toLocation,
      previousValue: previous.toLocation
    },
    {
      label: 'Routing',
      currentValue: current.routing,
      previousValue: previous.routing
    },
    {
      label: 'Design length [m]',
      currentValue: current.designLength,
      previousValue: previous.designLength
    },
    {
      label: 'Install length [m]',
      currentValue: current.installLength,
      previousValue: previous.installLength
    },
    {
      label: 'Pull date',
      currentValue: current.pullDate,
      previousValue: previous.pullDate
    },
    {
      label: 'Connected from',
      currentValue: current.connectedFrom,
      previousValue: previous.connectedFrom
    },
    {
      label: 'Connected to',
      currentValue: current.connectedTo,
      previousValue: previous.connectedTo
    },
    {
      label: 'Tested',
      currentValue: current.tested,
      previousValue: previous.tested
    }
  ];

  return fields
    .filter(
      (field) =>
        formatCableVersionValue(field.currentValue) !==
        formatCableVersionValue(field.previousValue)
    )
    .map((field) => ({
      label: field.label,
      previousValue: formatCableVersionValue(field.previousValue),
      nextValue: formatCableVersionValue(field.currentValue)
    }));
};
