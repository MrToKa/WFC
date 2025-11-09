import { useCallback, useEffect, useMemo, useState } from 'react';
import { ApiError, Project, updateProject } from '@/api/client';
import {
  formatDecimalInputValue,
  limitDecimalInput,
  parseNumberInput,
  roundToDecimalPlaces
} from '../../ProjectDetails.utils';

type ShowToast = (props: {
  intent: 'success' | 'error' | 'warning' | 'info';
  title: string;
  body?: string;
}) => void;

type UpdatableNumericProjectField =
  | 'secondaryTrayLength'
  | 'supportDistance'
  | 'supportWeight'
  | 'trayLoadSafetyFactor';

type NumericFieldLabelMap = Record<UpdatableNumericProjectField, string>;

export const NUMERIC_FIELD_LABELS: NumericFieldLabelMap = {
  secondaryTrayLength: 'Secondary tray length',
  supportDistance: 'Default distance between supports',
  supportWeight: 'Support weight',
  trayLoadSafetyFactor: 'Tray load safety factor'
};

const FIELD_DECIMAL_PLACES: Record<UpdatableNumericProjectField, number> = {
  secondaryTrayLength: 1,
  supportDistance: 1,
  supportWeight: 1,
  trayLoadSafetyFactor: 0
};

type UseProjectNumericFieldParams = {
  project: Project | null;
  field: UpdatableNumericProjectField;
  token: string | null;
  isAdmin: boolean;
  showToast: ShowToast;
  reloadProject: () => Promise<void>;
};

export type NumericFieldController = {
  input: string;
  error: string | null;
  saving: boolean;
  decimals: number;
  onInputChange: (value: string) => void;
  onSave: () => Promise<void>;
};

export const useProjectNumericField = ({
  project,
  field,
  token,
  isAdmin,
  showToast,
  reloadProject
}: UseProjectNumericFieldParams): NumericFieldController => {
  const [input, setInput] = useState<string>('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState<boolean>(false);
  const decimals = FIELD_DECIMAL_PLACES[field] ?? 1;

  useEffect(() => {
    if (project) {
      const currentValue = project[field];
      setInput(
        currentValue !== null && currentValue !== undefined
          ? formatDecimalInputValue(currentValue, decimals)
          : ''
      );
    } else {
      setInput('');
    }
    setError(null);
  }, [project, field, decimals]);

  const onInputChange = useCallback(
    (value: string) => {
      const nextValue = limitDecimalInput(value, decimals);
      setInput(nextValue);
      setError(null);
    },
    [decimals]
  );

  const onSave = useCallback(async () => {
    const label = NUMERIC_FIELD_LABELS[field];

    if (!project || !token) {
      showToast({
        intent: 'error',
        title: 'Sign-in required',
        body: `You need to be signed in to update the ${label.toLowerCase()}.`
      });
      return;
    }

    if (!isAdmin) {
      showToast({
        intent: 'error',
        title: 'Administrator access required',
        body: `Only administrators can update the ${label.toLowerCase()}.`
      });
      return;
    }

    const parsed = parseNumberInput(input);
    if (parsed.error) {
      setError(parsed.error);
      return;
    }

    const nextValue =
      parsed.numeric !== null
        ? roundToDecimalPlaces(parsed.numeric, decimals)
        : null;
    const currentValue = project[field];

    if (currentValue === nextValue) {
      setError('No changes to save.');
      return;
    }

    setSaving(true);
    setError(null);

    try {
      await updateProject(token, project.id, {
        [field]: nextValue
      });
      await reloadProject();
      showToast({
        intent: 'success',
        title: `${label} updated`
      });
    } catch (error) {
      console.error(`Failed to update ${field}`, error);
      const message =
        error instanceof ApiError
          ? error.message
          : `Failed to update ${label.toLowerCase()}.`;
      setError(message);
      showToast({
        intent: 'error',
        title: 'Update failed',
        body: message
      });
    } finally {
      setSaving(false);
    }
  }, [decimals, field, input, isAdmin, project, reloadProject, showToast, token]);

  return useMemo(
    () => ({
      input,
      error,
      saving,
      decimals,
      onInputChange,
      onSave
    }),
    [decimals, error, input, onInputChange, onSave, saving]
  );
};
