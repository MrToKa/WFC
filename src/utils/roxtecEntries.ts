const STORAGE_PREFIX = 'wfc:roxtec-entries';
const ROUTINGS_STORAGE_PREFIX = 'wfc:roxtec-routings';

const isBrowserEnvironment =
  typeof window !== 'undefined' && typeof window.localStorage !== 'undefined';

export type RoxtecEntry = {
  rowId: string;
  id: number;
  revision: string;
  tag: string;
  type: string;
  description: string;
};

const buildStorageKey = (projectId: string): string =>
  `${STORAGE_PREFIX}:${projectId}`;

const buildRoutingsStorageKey = (projectId: string, roxtecRowId: string): string =>
  `${ROUTINGS_STORAGE_PREFIX}:${projectId}:${roxtecRowId}`;

export const getRoxtecEntries = (projectId: string): RoxtecEntry[] => {
  if (!isBrowserEnvironment) {
    return [];
  }

  try {
    const rawValue = window.localStorage.getItem(buildStorageKey(projectId));
    if (!rawValue) {
      return [];
    }

    const parsed = JSON.parse(rawValue);
    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed.filter((entry): entry is RoxtecEntry => {
      return (
        typeof entry === 'object' &&
        entry !== null &&
        typeof entry.rowId === 'string' &&
        typeof entry.id === 'number' &&
        typeof entry.revision === 'string' &&
        typeof entry.tag === 'string' &&
        typeof entry.type === 'string' &&
        typeof entry.description === 'string'
      );
    });
  } catch (error) {
    console.warn('Failed to parse stored Roxtec entries', error);
    return [];
  }
};

export const setRoxtecEntries = (
  projectId: string,
  entries: RoxtecEntry[]
): void => {
  if (!isBrowserEnvironment) {
    return;
  }

  try {
    if (entries.length === 0) {
      window.localStorage.removeItem(buildStorageKey(projectId));
      return;
    }

    window.localStorage.setItem(buildStorageKey(projectId), JSON.stringify(entries));
  } catch (error) {
    console.warn('Failed to store Roxtec entries', error);
  }
};

export const clearRoxtecEntries = (projectId: string): void => {
  if (!isBrowserEnvironment) {
    return;
  }

  window.localStorage.removeItem(buildStorageKey(projectId));
};

export const getRoxtecEntryById = (
  projectId: string,
  id: number
): RoxtecEntry | null => {
  const entries = getRoxtecEntries(projectId);
  return entries.find((entry) => entry.id === id) ?? null;
};

export const getRoxtecRoutings = (
  projectId: string,
  roxtecRowId: string
): string[] => {
  if (!isBrowserEnvironment) {
    return [];
  }

  try {
    const rawValue = window.localStorage.getItem(
      buildRoutingsStorageKey(projectId, roxtecRowId)
    );
    if (!rawValue) {
      return [];
    }

    const parsed = JSON.parse(rawValue);
    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed.filter((routing): routing is string => {
      return typeof routing === 'string' && routing.trim().length > 0;
    });
  } catch (error) {
    console.warn('Failed to parse stored Roxtec routings', error);
    return [];
  }
};

export const setRoxtecRoutings = (
  projectId: string,
  roxtecRowId: string,
  routings: string[]
): void => {
  if (!isBrowserEnvironment) {
    return;
  }

  const normalizedRoutings = routings
    .map((routing) => routing.trim())
    .filter((routing) => routing.length > 0);

  try {
    const storageKey = buildRoutingsStorageKey(projectId, roxtecRowId);
    if (normalizedRoutings.length === 0) {
      window.localStorage.removeItem(storageKey);
      return;
    }

    window.localStorage.setItem(storageKey, JSON.stringify(normalizedRoutings));
  } catch (error) {
    console.warn('Failed to store Roxtec routings', error);
  }
};
