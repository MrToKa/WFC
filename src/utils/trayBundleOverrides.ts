import type { ProjectCableCategorySettings } from '@/api/types';
import type { CableCategoryKey } from '@/pages/ProjectDetails/hooks/cableLayoutDefaults';

const STORAGE_KEY = 'wfc:tray-bundle-overrides';

type StoredMap = Record<
  string,
  {
    useCustom: boolean;
    categories: Partial<Record<CableCategoryKey, ProjectCableCategorySettings>>;
  }
>;

export type TrayBundleOverride = {
  useCustom: boolean;
  categories: Partial<Record<CableCategoryKey, ProjectCableCategorySettings>>;
};

const isBrowserEnvironment =
  typeof window !== 'undefined' && typeof window.localStorage !== 'undefined';

const buildKey = (projectId: string, trayId: string): string =>
  `${projectId}:${trayId}`;

const loadOverrides = (): StoredMap => {
  if (!isBrowserEnvironment) {
    return {};
  }

  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return {};
    }

    const parsed = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) {
      return {};
    }

    return parsed as StoredMap;
  } catch (error) {
    console.warn('Failed to read stored tray bundle overrides', error);
    return {};
  }
};

const persistOverrides = (map: StoredMap) => {
  if (!isBrowserEnvironment) {
    return;
  }

  try {
    if (Object.keys(map).length === 0) {
      window.localStorage.removeItem(STORAGE_KEY);
      return;
    }
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(map));
  } catch (error) {
    console.warn('Failed to persist tray bundle overrides', error);
  }
};

export const getTrayBundleOverrides = (
  projectId: string | null | undefined,
  trayId: string | null | undefined
): TrayBundleOverride | null => {
  if (!projectId || !trayId) {
    return null;
  }

  const map = loadOverrides();
  const key = buildKey(projectId, trayId);
  const value = map[key];

  if (!value) {
    return null;
  }

  return {
    useCustom: Boolean(value.useCustom),
    categories: value.categories ?? {}
  };
};

export const setTrayBundleOverrides = (
  projectId: string | null | undefined,
  trayId: string | null | undefined,
  override: TrayBundleOverride
): TrayBundleOverride => {
  if (!projectId || !trayId) {
    return override;
  }

  const map = loadOverrides();
  const key = buildKey(projectId, trayId);

  map[key] = {
    useCustom: Boolean(override.useCustom),
    categories: override.categories ?? {}
  };

  persistOverrides(map);
  return map[key];
};

export const clearTrayBundleOverrides = (
  projectId: string | null | undefined,
  trayId: string | null | undefined
): void => {
  if (!projectId || !trayId) {
    return;
  }

  const map = loadOverrides();
  const key = buildKey(projectId, trayId);

  if (!(key in map)) {
    return;
  }

  delete map[key];
  persistOverrides(map);
};
