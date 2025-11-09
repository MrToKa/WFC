const STORAGE_PREFIX = 'wfc:custom-variables';

const isBrowserEnvironment =
  typeof window !== 'undefined' && typeof window.localStorage !== 'undefined';

const buildStorageKey = (projectId: string): string =>
  `${STORAGE_PREFIX}:${projectId}`;

export type CustomVariable = {
  id: string;
  name: string;
};

const parseStoredValue = (rawValue: string | null): CustomVariable[] => {
  if (!rawValue) {
    return [];
  }

  try {
    const parsed = JSON.parse(rawValue);
    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed
      .map((item) => {
        if (
          item &&
          typeof item === 'object' &&
          typeof item.id === 'string' &&
          typeof item.name === 'string'
        ) {
          return { id: item.id, name: item.name };
        }
        return null;
      })
      .filter((item): item is CustomVariable => Boolean(item));
  } catch (error) {
    console.warn('Failed to parse stored custom variables', error);
    return [];
  }
};

export const getCustomVariables = (projectId: string): CustomVariable[] => {
  if (!isBrowserEnvironment) {
    return [];
  }
  return parseStoredValue(
    window.localStorage.getItem(buildStorageKey(projectId))
  );
};

export const setCustomVariables = (
  projectId: string,
  variables: CustomVariable[]
): void => {
  if (!isBrowserEnvironment) {
    return;
  }

  const filtered = variables.filter(
    (variable) =>
      variable &&
      typeof variable.id === 'string' &&
      variable.id.trim() !== ''
  );

  const key = buildStorageKey(projectId);

  if (filtered.length === 0) {
    window.localStorage.removeItem(key);
    return;
  }

  try {
    window.localStorage.setItem(key, JSON.stringify(filtered));
  } catch (error) {
    console.warn('Failed to store custom variables', error);
  }
};

export const clearCustomVariables = (projectId: string): void => {
  if (!isBrowserEnvironment) {
    return;
  }
  window.localStorage.removeItem(buildStorageKey(projectId));
};
