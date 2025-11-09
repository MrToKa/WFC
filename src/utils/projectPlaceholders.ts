const STORAGE_PREFIX = 'wfc:variables-api';

const isBrowserEnvironment =
  typeof window !== 'undefined' && typeof window.localStorage !== 'undefined';

const buildStorageKey = (projectId: string): string =>
  `${STORAGE_PREFIX}:${projectId}`;

export const getProjectPlaceholders = (
  projectId: string
): Record<string, string> => {
  if (!isBrowserEnvironment) {
    return {};
  }

  const key = buildStorageKey(projectId);

  try {
    const rawValue = window.localStorage.getItem(key);
    if (!rawValue) {
      return {};
    }

    const parsed = JSON.parse(rawValue);
    return typeof parsed === 'object' && parsed !== null ? parsed : {};
  } catch (error) {
    console.warn('Failed to parse stored Variables API placeholders', error);
    return {};
  }
};

export const setProjectPlaceholders = (
  projectId: string,
  placeholders: Record<string, string>
): void => {
  if (!isBrowserEnvironment) {
    return;
  }

  const key = buildStorageKey(projectId);

  try {
    if (Object.keys(placeholders).length === 0) {
      window.localStorage.removeItem(key);
      return;
    }

    window.localStorage.setItem(key, JSON.stringify(placeholders));
  } catch (error) {
    console.warn('Failed to store Variables API placeholders', error);
  }
};

export const clearProjectPlaceholders = (projectId: string): void => {
  if (!isBrowserEnvironment) {
    return;
  }
  window.localStorage.removeItem(buildStorageKey(projectId));
};

export const getPlaceholdersStorageKey = (projectId: string): string =>
  buildStorageKey(projectId);
