import { useCallback, useEffect, useMemo, useState } from 'react';

import { ApiError, Project, updateProject } from '@/api/client';
import type { CustomBundleRange, CableCategoryKey } from '@/api/types';
import {
  validateBundleRanges,
  generateBundleRangeId
} from '@/utils/trayBundleOverrides';

import { CABLE_CATEGORY_ORDER } from './cableLayoutDefaults';

type ShowToast = (props: {
  intent: 'success' | 'error' | 'warning' | 'info';
  title: string;
  body?: string;
}) => void;

/**
 * Form state for a custom bundle range (min/max as strings for input handling)
 */
export type CustomBundleRangeFormState = {
  id: string;
  min: string;
  max: string;
};

export type CustomBundleRangesFormState = Record<CableCategoryKey, CustomBundleRangeFormState[]>;
export type CustomBundleRangesErrors = Record<CableCategoryKey, string | null>;

const createEmptyFormState = (): CustomBundleRangesFormState => ({
  mv: [],
  power: [],
  vfd: [],
  control: []
});

const createEmptyErrors = (): CustomBundleRangesErrors => ({
  mv: null,
  power: null,
  vfd: null,
  control: null
});

const buildFormStateFromProject = (
  project: Project | null
): CustomBundleRangesFormState => {
  const result = createEmptyFormState();
  const customRanges = project?.cableLayout?.customBundleRanges;

  if (!customRanges) {
    return result;
  }

  for (const key of CABLE_CATEGORY_ORDER) {
    const ranges = customRanges[key];
    if (ranges && ranges.length > 0) {
      result[key] = ranges.map((range) => ({
        id: range.id,
        min: String(range.min),
        max: String(range.max)
      }));
    }
  }

  return result;
};

const parseFormStateToRanges = (
  formState: CustomBundleRangesFormState
): Partial<Record<CableCategoryKey, CustomBundleRange[]>> => {
  const result: Partial<Record<CableCategoryKey, CustomBundleRange[]>> = {};

  for (const key of CABLE_CATEGORY_ORDER) {
    const ranges = formState[key];
    if (ranges.length > 0) {
      result[key] = ranges
        .map((range) => ({
          id: range.id,
          min: parseFloat(range.min) || 0,
          max: parseFloat(range.max) || 0
        }))
        .filter((range) => range.min >= 0 && range.max > 0);
    }
  }

  return result;
};

export type CustomBundleRangesController = {
  formState: CustomBundleRangesFormState;
  errors: CustomBundleRangesErrors;
  saving: boolean;
  hasChanges: boolean;
  onAddRange: (category: CableCategoryKey) => void;
  onRemoveRange: (category: CableCategoryKey, rangeId: string) => void;
  onChangeRange: (
    category: CableCategoryKey,
    rangeId: string,
    field: 'min' | 'max',
    value: string
  ) => void;
  onSave: () => Promise<void>;
  onReset: () => void;
};

type UseCustomBundleRangesParams = {
  project: Project | null;
  token: string | null;
  isAdmin: boolean;
  showToast: ShowToast;
  reloadProject: () => Promise<void>;
};

export const useCustomBundleRanges = ({
  project,
  token,
  isAdmin,
  showToast,
  reloadProject
}: UseCustomBundleRangesParams): CustomBundleRangesController => {
  const [formState, setFormState] = useState<CustomBundleRangesFormState>(() =>
    buildFormStateFromProject(null)
  );
  const [errors, setErrors] = useState<CustomBundleRangesErrors>(() =>
    createEmptyErrors()
  );
  const [saving, setSaving] = useState(false);

  // Sync form state when project changes
  useEffect(() => {
    setFormState(buildFormStateFromProject(project));
    setErrors(createEmptyErrors());
  }, [project]);

  const handleAddRange = useCallback((category: CableCategoryKey) => {
    setFormState((prev) => ({
      ...prev,
      [category]: [
        ...prev[category],
        {
          id: generateBundleRangeId(),
          min: '',
          max: ''
        }
      ]
    }));
    setErrors((prev) => ({ ...prev, [category]: null }));
  }, []);

  const handleRemoveRange = useCallback(
    (category: CableCategoryKey, rangeId: string) => {
      setFormState((prev) => ({
        ...prev,
        [category]: prev[category].filter((range) => range.id !== rangeId)
      }));
      setErrors((prev) => ({ ...prev, [category]: null }));
    },
    []
  );

  const handleChangeRange = useCallback(
    (
      category: CableCategoryKey,
      rangeId: string,
      field: 'min' | 'max',
      value: string
    ) => {
      setFormState((prev) => ({
        ...prev,
        [category]: prev[category].map((range) =>
          range.id === rangeId ? { ...range, [field]: value } : range
        )
      }));
      setErrors((prev) => ({ ...prev, [category]: null }));
    },
    []
  );

  const handleReset = useCallback(() => {
    setFormState(buildFormStateFromProject(project));
    setErrors(createEmptyErrors());
  }, [project]);

  const handleSave = useCallback(async () => {
    if (!project || !token) {
      showToast({
        intent: 'error',
        title: 'Sign-in required',
        body: 'You need to be signed in to update custom bundle ranges.'
      });
      return;
    }

    if (!isAdmin) {
      showToast({
        intent: 'error',
        title: 'Administrator access required',
        body: 'Only administrators can update custom bundle ranges.'
      });
      return;
    }

    // Validate all categories
    const newErrors = createEmptyErrors();
    let hasErrors = false;

    for (const key of CABLE_CATEGORY_ORDER) {
      const ranges = formState[key];
      if (ranges.length === 0) {
        continue;
      }

      // Parse ranges for validation
      const parsedRanges: CustomBundleRange[] = ranges.map((range) => ({
        id: range.id,
        min: parseFloat(range.min) || 0,
        max: parseFloat(range.max) || 0
      }));

      const validationError = validateBundleRanges(parsedRanges);
      if (validationError) {
        newErrors[key] = validationError;
        hasErrors = true;
      }
    }

    if (hasErrors) {
      setErrors(newErrors);
      return;
    }

    setSaving(true);
    setErrors(createEmptyErrors());

    try {
      const parsedRanges = parseFormStateToRanges(formState);
      const hasRanges = Object.values(parsedRanges).some(
        (ranges) => ranges && ranges.length > 0
      );

      await updateProject(token, project.id, {
        cableLayout: {
          customBundleRanges: hasRanges ? parsedRanges : null
        }
      });

      await reloadProject();
      showToast({
        intent: 'success',
        title: 'Custom bundle ranges updated'
      });
    } catch (error) {
      console.error('Failed to update custom bundle ranges', error);
      const message =
        error instanceof ApiError
          ? error.message
          : 'Failed to update custom bundle ranges.';
      showToast({
        intent: 'error',
        title: 'Update failed',
        body: message
      });
    } finally {
      setSaving(false);
    }
  }, [formState, isAdmin, project, reloadProject, showToast, token]);

  const hasChanges = useMemo(() => {
    const currentRanges = project?.cableLayout?.customBundleRanges ?? {};
    
    for (const key of CABLE_CATEGORY_ORDER) {
      const formRanges = formState[key];
      const projectRanges = currentRanges[key] ?? [];

      if (formRanges.length !== projectRanges.length) {
        return true;
      }

      for (let i = 0; i < formRanges.length; i++) {
        const formRange = formRanges[i];
        const projectRange = projectRanges[i];

        if (
          formRange.id !== projectRange.id ||
          String(projectRange.min) !== formRange.min ||
          String(projectRange.max) !== formRange.max
        ) {
          return true;
        }
      }
    }

    return false;
  }, [formState, project?.cableLayout?.customBundleRanges]);

  return {
    formState,
    errors,
    saving,
    hasChanges,
    onAddRange: handleAddRange,
    onRemoveRange: handleRemoveRange,
    onChangeRange: handleChangeRange,
    onSave: handleSave,
    onReset: handleReset
  };
};
