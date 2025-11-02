import { useCallback, useEffect, useMemo, useState } from 'react';

import { ApiError, Project, updateProject } from '@/api/client';
import type { CableBundleSpacing } from '@/api/types';

import { parseNumberInput } from '../../ProjectDetails.utils';
import {
  CABLE_CATEGORY_CONFIG,
  CABLE_CATEGORY_ORDER,
  DEFAULT_CABLE_SPACING,
  DEFAULT_CATEGORY_SETTINGS,
  type CableCategoryKey
} from './cableLayoutDefaults';

type ShowToast = (props: {
  intent: 'success' | 'error' | 'warning' | 'info';
  title: string;
  body?: string;
}) => void;

type CategoryKey = CableCategoryKey;

type CategoryInputState = {
  maxRows: string;
  maxColumns: string;
  bundleSpacing: CableBundleSpacing | null;
  trefoil: boolean;
  trefoilSpacing: boolean;
};

type CategoryErrorState = {
  maxRows?: string;
  maxColumns?: string;
  general?: string;
};

const CATEGORY_KEYS: CategoryKey[] = CABLE_CATEGORY_ORDER;

const formatCategoryInput = (
  project: Project | null,
  key: CategoryKey
): CategoryInputState => {
  const settings = project?.cableLayout?.[key] ?? null;
  const defaults = DEFAULT_CATEGORY_SETTINGS[key];
  const maxRows = settings?.maxRows ?? defaults.maxRows;
  const maxColumns = settings?.maxColumns ?? defaults.maxColumns;
  const bundleSpacing = settings?.bundleSpacing ?? defaults.bundleSpacing;
  const trefoil =
    settings?.trefoil === null || settings?.trefoil === undefined
      ? defaults.trefoil
      : settings.trefoil;
  const trefoilSpacing =
    settings?.trefoilSpacingBetweenBundles === null ||
    settings?.trefoilSpacingBetweenBundles === undefined
      ? defaults.trefoilSpacingBetweenBundles
      : settings.trefoilSpacingBetweenBundles;

  return {
    maxRows: maxRows !== null && maxRows !== undefined ? String(maxRows) : '',
    maxColumns:
      maxColumns !== null && maxColumns !== undefined ? String(maxColumns) : '',
    bundleSpacing,
    trefoil: Boolean(trefoil),
    trefoilSpacing: Boolean(trefoilSpacing)
  };
};

const createInitialCategoryInputs = (project: Project | null) =>
  CATEGORY_KEYS.reduce<Record<CategoryKey, CategoryInputState>>((acc, key) => {
    acc[key] = formatCategoryInput(project, key);
    return acc;
  }, {} as Record<CategoryKey, CategoryInputState>);

const createInitialCategoryErrors = () =>
  CATEGORY_KEYS.reduce<Record<CategoryKey, CategoryErrorState>>((acc, key) => {
    acc[key] = {};
    return acc;
  }, {} as Record<CategoryKey, CategoryErrorState>);

const createInitialSavingState = () =>
  CATEGORY_KEYS.reduce<Record<CategoryKey, boolean>>((acc, key) => {
    acc[key] = false;
    return acc;
  }, {} as Record<CategoryKey, boolean>);

export type CableSpacingController = {
  label: string;
  currentValue: number | null;
  input: string;
  error: string | null;
  saving: boolean;
  onInputChange: (value: string) => void;
  onSave: () => Promise<void>;
};

export type CableCategoryController = {
  key: CategoryKey;
  label: string;
  showTrefoil: boolean;
  allowTrefoilSpacing: boolean;
  currentMaxRows: number | null;
  currentMaxColumns: number | null;
  currentBundleSpacing: CableBundleSpacing | null;
  currentTrefoil: boolean | null;
  currentTrefoilSpacing: boolean | null;
  displayMaxRows: number;
  displayMaxColumns: number;
  displayBundleSpacing: CableBundleSpacing;
  displayTrefoil: boolean | null;
  displayTrefoilSpacing: boolean | null;
  inputMaxRows: string;
  inputMaxColumns: string;
  inputBundleSpacing: CableBundleSpacing | null;
  inputTrefoil: boolean;
  inputTrefoilSpacing: boolean;
  errors: CategoryErrorState;
  saving: boolean;
  onMaxRowsChange: (value: string) => void;
  onMaxColumnsChange: (value: string) => void;
  onBundleSpacingChange: (value: CableBundleSpacing | null) => void;
  onTrefoilChange: (value: boolean) => void;
  onTrefoilSpacingChange: (value: boolean) => void;
  onSave: () => Promise<void>;
};

type UseCableLayoutSettingsParams = {
  project: Project | null;
  token: string | null;
  isAdmin: boolean;
  showToast: ShowToast;
  reloadProject: () => Promise<void>;
};

type UseCableLayoutSettingsResult = {
  cableSpacingField: CableSpacingController;
  categoryCards: CableCategoryController[];
};

const parseIntegerInput = (
  value: string,
  fieldName: 'maxRows' | 'maxColumns'
): { numeric: number | null; error?: string } => {
  const trimmed = value.trim();
  if (trimmed === '') {
    return { numeric: null };
  }

  const parsed = Number(trimmed);
  if (!Number.isFinite(parsed)) {
    return { numeric: null, error: `Enter a whole number for ${fieldName === 'maxRows' ? 'max rows' : 'max columns'}` };
  }

  if (!Number.isInteger(parsed)) {
    return { numeric: null, error: 'Only whole numbers are allowed' };
  }

  if (parsed < 1) {
    return { numeric: null, error: 'Value must be at least 1' };
  }

  if (parsed > 1_000) {
    return { numeric: null, error: 'Value is too large' };
  }

  return { numeric: parsed };
};

export const useCableLayoutSettings = ({
  project,
  token,
  isAdmin,
  showToast,
  reloadProject
}: UseCableLayoutSettingsParams): UseCableLayoutSettingsResult => {
  const [spacingInput, setSpacingInput] = useState<string>('');
  const [spacingError, setSpacingError] = useState<string | null>(null);
  const [spacingSaving, setSpacingSaving] = useState<boolean>(false);

  const [categoryInputs, setCategoryInputs] = useState<
    Record<CategoryKey, CategoryInputState>
  >(() => createInitialCategoryInputs(null));
  const [categoryErrors, setCategoryErrors] = useState<
    Record<CategoryKey, CategoryErrorState>
  >(() => createInitialCategoryErrors());
  const [categorySaving, setCategorySaving] = useState<
    Record<CategoryKey, boolean>
  >(() => createInitialSavingState());

  useEffect(() => {
    const currentValue =
      project?.cableLayout?.cableSpacing ?? DEFAULT_CABLE_SPACING;
    setSpacingInput(String(currentValue));
    setSpacingError(null);
  }, [project?.cableLayout?.cableSpacing]);

  useEffect(() => {
    setCategoryInputs(createInitialCategoryInputs(project));
    setCategoryErrors(createInitialCategoryErrors());
    setCategorySaving(createInitialSavingState());
  }, [project]);

  const handleSpacingChange = useCallback((value: string) => {
    setSpacingInput(value);
    setSpacingError(null);
  }, []);

  const handleSaveSpacing = useCallback(async () => {
    const label = 'Space between the cables';

    if (!project || !token) {
      const message = 'You need to be signed in to update the cable spacing.';
      setSpacingError(message);
      showToast({
        intent: 'error',
        title: 'Sign-in required',
        body: message
      });
      return;
    }

    if (!isAdmin) {
      const message = 'Only administrators can update the cable spacing.';
      setSpacingError(message);
      showToast({
        intent: 'error',
        title: 'Administrator access required',
        body: message
      });
      return;
    }

    const parsed = parseNumberInput(spacingInput);
    if (parsed.error) {
      setSpacingError(parsed.error);
      return;
    }

    if (parsed.numeric !== null) {
      if (parsed.numeric < 1 || parsed.numeric > 5) {
        setSpacingError('Value must be between 1 and 5.');
        return;
      }
    }

    const currentValue = project.cableLayout?.cableSpacing ?? null;
    const nextValue =
      parsed.numeric !== null
        ? Math.round(parsed.numeric * 1000) / 1000
        : null;

    if (currentValue === nextValue) {
      setSpacingError('No changes to save.');
      return;
    }

    setSpacingSaving(true);
    setSpacingError(null);

    try {
      await updateProject(token, project.id, {
        cableLayout: {
          cableSpacing: nextValue
        }
      });
      await reloadProject();
      showToast({
        intent: 'success',
        title: `${label} updated`
      });
    } catch (error) {
      console.error('Failed to update cable spacing', error);
      const message =
        error instanceof ApiError
          ? error.message
          : 'Failed to update cable spacing.';
      setSpacingError(message);
      showToast({
        intent: 'error',
        title: 'Update failed',
        body: message
      });
    } finally {
      setSpacingSaving(false);
    }
  }, [isAdmin, project, reloadProject, showToast, spacingInput, token]);

  const handleMaxRowsChange = useCallback((key: CategoryKey, value: string) => {
    setCategoryInputs((previous) => ({
      ...previous,
      [key]: {
        ...previous[key],
        maxRows: value
      }
    }));
    setCategoryErrors((previous) => ({
      ...previous,
      [key]: { ...previous[key], maxRows: undefined, general: undefined }
    }));
  }, []);

  const handleMaxColumnsChange = useCallback(
    (key: CategoryKey, value: string) => {
      setCategoryInputs((previous) => ({
        ...previous,
        [key]: {
          ...previous[key],
          maxColumns: value
        }
      }));
      setCategoryErrors((previous) => ({
        ...previous,
        [key]: { ...previous[key], maxColumns: undefined, general: undefined }
      }));
    },
    []
  );

  const handleBundleSpacingChange = useCallback(
    (key: CategoryKey, value: CableBundleSpacing | null) => {
      setCategoryInputs((previous) => ({
        ...previous,
        [key]: {
          ...previous[key],
          bundleSpacing: value
        }
      }));
      setCategoryErrors((previous) => ({
        ...previous,
        [key]: { ...previous[key], general: undefined }
      }));
    },
    []
  );

  const handleTrefoilChange = useCallback((key: CategoryKey, value: boolean) => {
    setCategoryInputs((previous) => ({
      ...previous,
      [key]: {
        ...previous[key],
        trefoil: value,
        trefoilSpacing: value ? previous[key].trefoilSpacing : false
      }
    }));
    setCategoryErrors((previous) => ({
      ...previous,
      [key]: { ...previous[key], general: undefined }
    }));
  }, []);

  const handleTrefoilSpacingChange = useCallback(
    (key: CategoryKey, value: boolean) => {
      setCategoryInputs((previous) => ({
        ...previous,
        [key]: {
          ...previous[key],
          trefoilSpacing: value
        }
      }));
      setCategoryErrors((previous) => ({
        ...previous,
        [key]: { ...previous[key], general: undefined }
      }));
    },
    []
  );

  const handleSaveCategory = useCallback(
    async (key: CategoryKey) => {
      const config = CABLE_CATEGORY_CONFIG[key];
      const defaults = DEFAULT_CATEGORY_SETTINGS[key];
      const inputs = categoryInputs[key];

      if (!project || !token) {
        const message = `You need to be signed in to update ${config.label.toLowerCase()}.`;
        setCategoryErrors((previous) => ({
          ...previous,
          [key]: { ...previous[key], general: message }
        }));
        showToast({
          intent: 'error',
          title: 'Sign-in required',
          body: message
        });
        return;
      }

      if (!isAdmin) {
        const message = `Only administrators can update ${config.label.toLowerCase()}.`;
        setCategoryErrors((previous) => ({
          ...previous,
          [key]: { ...previous[key], general: message }
        }));
        showToast({
          intent: 'error',
          title: 'Administrator access required',
          body: message
        });
        return;
      }

      const maxRowsResult = parseIntegerInput(inputs.maxRows, 'maxRows');
      const maxColumnsResult = parseIntegerInput(inputs.maxColumns, 'maxColumns');

      const nextErrors: CategoryErrorState = {};
      if (maxRowsResult.error) {
        nextErrors.maxRows = maxRowsResult.error;
      }
      if (maxColumnsResult.error) {
        nextErrors.maxColumns = maxColumnsResult.error;
      }

      if (nextErrors.maxRows || nextErrors.maxColumns) {
        setCategoryErrors((previous) => ({
          ...previous,
          [key]: { ...previous[key], ...nextErrors }
        }));
        return;
      }

      const maxRowsValue = maxRowsResult.numeric;
      const maxColumnsValue = maxColumnsResult.numeric;
      const bundleSpacingValue = inputs.bundleSpacing;
      const trefoilValue = config.showTrefoil ? inputs.trefoil : null;
      const trefoilSpacingValue = config.allowTrefoilSpacing
        ? inputs.trefoil
          ? inputs.trefoilSpacing
          : false
        : null;

      const currentSettings = project.cableLayout?.[key] ?? null;
      const currentMaxRows = currentSettings?.maxRows ?? null;
      const currentMaxColumns = currentSettings?.maxColumns ?? null;
      const currentBundleSpacing = currentSettings?.bundleSpacing ?? null;
      const currentTrefoil = config.showTrefoil
        ? currentSettings?.trefoil ?? false
        : null;
      const currentTrefoilSpacing = config.allowTrefoilSpacing
        ? currentSettings?.trefoilSpacingBetweenBundles ?? defaults.trefoilSpacingBetweenBundles
        : null;

      const hasChanges =
        currentMaxRows !== maxRowsValue ||
        currentMaxColumns !== maxColumnsValue ||
        currentBundleSpacing !== bundleSpacingValue ||
        (config.showTrefoil
          ? Boolean(currentTrefoil) !== trefoilValue
          : false) ||
        (config.allowTrefoilSpacing
          ? Boolean(currentTrefoilSpacing) !== trefoilSpacingValue
          : false);

      if (!hasChanges) {
        setCategoryErrors((previous) => ({
          ...previous,
          [key]: { ...previous[key], general: 'No changes to save.' }
        }));
        return;
      }

      setCategorySaving((previous) => ({
        ...previous,
        [key]: true
      }));
      setCategoryErrors((previous) => ({
        ...previous,
        [key]: {}
      }));

      const payload: Record<string, unknown> = {
        maxRows: maxRowsValue,
        maxColumns: maxColumnsValue,
        bundleSpacing: bundleSpacingValue
      };
      if (trefoilValue !== null) {
        payload.trefoil = trefoilValue;
      }
      if (trefoilSpacingValue !== null) {
        payload.trefoilSpacingBetweenBundles = trefoilSpacingValue;
      }

      try {
        await updateProject(token, project.id, {
          cableLayout: {
            [key]: payload
          }
        });
        await reloadProject();
        showToast({
          intent: 'success',
          title: `${config.label} updated`
        });
      } catch (error) {
        console.error(`Failed to update ${config.label}`, error);
        const message =
          error instanceof ApiError
            ? error.message
            : `Failed to update ${config.label.toLowerCase()}.`;
        setCategoryErrors((previous) => ({
          ...previous,
          [key]: { general: message }
        }));
        showToast({
          intent: 'error',
          title: 'Update failed',
          body: message
        });
      } finally {
        setCategorySaving((previous) => ({
          ...previous,
          [key]: false
        }));
      }
    },
    [categoryInputs, isAdmin, project, reloadProject, showToast, token]
  );

  const cableSpacingField = useMemo<CableSpacingController>(
    () => ({
      label: 'Space between the cables',
      currentValue:
        project?.cableLayout?.cableSpacing ?? DEFAULT_CABLE_SPACING,
      input: spacingInput,
      error: spacingError,
      saving: spacingSaving,
      onInputChange: handleSpacingChange,
      onSave: handleSaveSpacing
    }),
    [
      handleSaveSpacing,
      handleSpacingChange,
      project?.cableLayout?.cableSpacing,
      spacingError,
      spacingInput,
      spacingSaving
    ]
  );

  const categoryCards = useMemo<CableCategoryController[]>(() => {
    return CATEGORY_KEYS.map((key) => {
      const config = CABLE_CATEGORY_CONFIG[key];
      const currentSettings = project?.cableLayout?.[key] ?? null;
      const defaults = DEFAULT_CATEGORY_SETTINGS[key];
      const displayMaxRows = currentSettings?.maxRows ?? defaults.maxRows;
      const displayMaxColumns = currentSettings?.maxColumns ?? defaults.maxColumns;
      const displayBundleSpacing = currentSettings?.bundleSpacing ?? defaults.bundleSpacing;
      const displayTrefoil = config.showTrefoil
        ? currentSettings?.trefoil ?? defaults.trefoil
        : null;
      const displayTrefoilSpacing = config.allowTrefoilSpacing
        ? currentSettings?.trefoilSpacingBetweenBundles ?? defaults.trefoilSpacingBetweenBundles
        : null;
      const inputState = categoryInputs[key];
      const errorState = categoryErrors[key];
      const savingState = categorySaving[key];

      return {
        key,
        label: config.label,
        showTrefoil: config.showTrefoil,
        allowTrefoilSpacing: config.allowTrefoilSpacing,
        currentMaxRows: currentSettings?.maxRows ?? null,
        currentMaxColumns: currentSettings?.maxColumns ?? null,
        currentBundleSpacing: currentSettings?.bundleSpacing ?? null,
        currentTrefoil: config.showTrefoil
          ? currentSettings?.trefoil ?? null
          : null,
        currentTrefoilSpacing: config.allowTrefoilSpacing
          ? currentSettings?.trefoilSpacingBetweenBundles ?? null
          : null,
        displayMaxRows,
        displayMaxColumns,
        displayBundleSpacing,
        displayTrefoil,
        displayTrefoilSpacing,
        inputMaxRows:
          inputState?.maxRows ?? (defaults.maxRows ? String(defaults.maxRows) : ''),
        inputMaxColumns:
          inputState?.maxColumns ??
          (defaults.maxColumns ? String(defaults.maxColumns) : ''),
        inputBundleSpacing: inputState?.bundleSpacing ?? defaults.bundleSpacing,
        inputTrefoil:
          inputState?.trefoil ?? (config.showTrefoil ? defaults.trefoil : false),
        inputTrefoilSpacing:
          inputState?.trefoilSpacing ??
          (config.allowTrefoilSpacing ? defaults.trefoilSpacingBetweenBundles : false),
        errors: errorState ?? {},
        saving: savingState ?? false,
        onMaxRowsChange: (value: string) => handleMaxRowsChange(key, value),
        onMaxColumnsChange: (value: string) =>
          handleMaxColumnsChange(key, value),
        onBundleSpacingChange: (value: CableBundleSpacing | null) =>
          handleBundleSpacingChange(key, value),
        onTrefoilChange: (value: boolean) => handleTrefoilChange(key, value),
        onTrefoilSpacingChange: (value: boolean) =>
          handleTrefoilSpacingChange(key, value),
        onSave: () => handleSaveCategory(key)
      };
    });
  }, [
    categoryErrors,
    categoryInputs,
    categorySaving,
    handleBundleSpacingChange,
    handleMaxColumnsChange,
    handleMaxRowsChange,
    handleSaveCategory,
    handleTrefoilChange,
    handleTrefoilSpacingChange,
    project?.cableLayout
  ]);

  return {
    cableSpacingField,
    categoryCards
  };
};
