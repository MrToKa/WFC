const ROUTINGS_STORAGE_PREFIX = 'wfc:roxtec-routings';

const isBrowserEnvironment =
  typeof window !== 'undefined' && typeof window.localStorage !== 'undefined';

const buildRoutingsStorageKey = (projectId: string, roxtecId: number): string =>
  `${ROUTINGS_STORAGE_PREFIX}:${projectId}:${roxtecId}`;

export const getRoxtecRoutings = (
  projectId: string,
  roxtecId: number
): string[] => {
  if (!isBrowserEnvironment) {
    return [];
  }

  try {
    const rawValue = window.localStorage.getItem(
      buildRoutingsStorageKey(projectId, roxtecId)
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
  roxtecId: number,
  routings: string[]
): void => {
  if (!isBrowserEnvironment) {
    return;
  }

  const normalizedRoutings = routings
    .map((routing) => routing.trim())
    .filter((routing) => routing.length > 0);

  try {
    const storageKey = buildRoutingsStorageKey(projectId, roxtecId);
    if (normalizedRoutings.length === 0) {
      window.localStorage.removeItem(storageKey);
      return;
    }

    window.localStorage.setItem(storageKey, JSON.stringify(normalizedRoutings));
  } catch (error) {
    console.warn('Failed to store Roxtec routings', error);
  }
};
