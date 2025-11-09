import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ApiError,
  MaterialSupport,
  Project,
  ProjectSupportOverridePayload,
  updateProject
} from '@/api/client';
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

type TrayTypeDetail = {
  trayType: string;
  widthMm: number | null;
  hasMultipleWidths: boolean;
};

const SUPPORT_LENGTH_MATCH_TOLERANCE = 15;
const SUPPORT_DISTANCE_DECIMAL_PLACES = 1;

type UseSupportDistanceOverridesParams = {
  project: Project | null;
  trayTypeDetails: TrayTypeDetail[];
  supports: MaterialSupport[];
  supportsLoading: boolean;
  supportsError: string | null;
  token: string | null;
  isAdmin: boolean;
  showToast: ShowToast;
  reloadProject: () => Promise<void>;
};

export type SupportDistanceOverrideField = {
  trayType: string;
  trayWidthMm: number | null;
  hasWidthConflict: boolean;
  currentDistance: number | null;
  currentSupportType: string | null;
  defaultValue: number | null;
  input: string;
  selectedSupportId: string | null;
  selectedSupportLabel: string;
  selectedSupportMissing: boolean;
  supportOptions: MaterialSupport[];
  supportsLoading: boolean;
  supportsError: string | null;
  error: string | null;
  saving: boolean;
  onInputChange: (value: string) => void;
  onSupportChange: (supportId: string | null) => void;
  onSave: () => Promise<void>;
};

export const useSupportDistanceOverrides = ({
  project,
  trayTypeDetails,
  supports,
  supportsLoading,
  supportsError,
  token,
  isAdmin,
  showToast,
  reloadProject
}: UseSupportDistanceOverridesParams) => {
  const [inputs, setInputs] = useState<Record<string, string>>({});
  const [supportIds, setSupportIds] = useState<Record<string, string | null>>({});
  const [errors, setErrors] = useState<Record<string, string | null | undefined>>({});
  const [saving, setSaving] = useState<Record<string, boolean>>({});

  useEffect(() => {
    const overrides = project?.supportDistanceOverrides ?? {};
    setInputs(() => {
      const next: Record<string, string> = {};
      trayTypeDetails.forEach(({ trayType }) => {
        const override = overrides[trayType];
        if (
          override &&
          override.distance !== null &&
          override.distance !== undefined
        ) {
          next[trayType] = formatDecimalInputValue(
            override.distance,
            SUPPORT_DISTANCE_DECIMAL_PLACES
          );
        } else {
          next[trayType] = '';
        }
      });
      return next;
    });
    setSupportIds(() => {
      const next: Record<string, string | null> = {};
      trayTypeDetails.forEach(({ trayType }) => {
        const override = overrides[trayType];
        next[trayType] =
          override && override.supportId ? override.supportId : null;
      });
      return next;
    });
    setErrors({});
    setSaving({});
  }, [project?.supportDistanceOverrides, trayTypeDetails]);

  const supportsById = useMemo(
    () =>
      supports.reduce<Record<string, MaterialSupport>>((acc, support) => {
        acc[support.id] = support;
        return acc;
      }, {}),
    [supports]
  );

  const supportOptionsByTrayType = useMemo(
    () =>
      trayTypeDetails.reduce<
        Record<
          string,
          {
            options: MaterialSupport[];
            widthMm: number | null;
            hasMultipleWidths: boolean;
          }
        >
      >((acc, detail) => {
        let options: MaterialSupport[] = [];

        if (detail.widthMm !== null && !detail.hasMultipleWidths) {
          const targetWidth = detail.widthMm;
          options = supports.filter(
            (support) =>
              support.lengthMm !== null &&
              Math.abs(support.lengthMm - targetWidth) <=
                SUPPORT_LENGTH_MATCH_TOLERANCE
          );
        } else {
          options = supports;
        }

        acc[detail.trayType] = {
          options,
          widthMm: detail.widthMm,
          hasMultipleWidths: detail.hasMultipleWidths
        };
        return acc;
      }, {}),
    [supports, trayTypeDetails]
  );

  const handleInputChange = useCallback(
    (trayType: string, value: string) => {
      const nextValue = limitDecimalInput(value, SUPPORT_DISTANCE_DECIMAL_PLACES);
      setInputs((previous) => ({
        ...previous,
        [trayType]: nextValue
      }));
      setErrors((previous) => {
        if (!previous[trayType]) {
          return previous;
        }
        return {
          ...previous,
          [trayType]: null
        };
      });
    },
    []
  );

  const handleSupportChange = useCallback(
    (trayType: string, supportId: string | null) => {
      const normalizedSupportId =
        supportId && supportId.trim() !== '' ? supportId : null;

      setSupportIds((previous) => {
        const next = { ...previous };
        next[trayType] = normalizedSupportId;
        return next;
      });
      setErrors((previous) => {
        if (!previous[trayType]) {
          return previous;
        }
        return {
          ...previous,
          [trayType]: null
        };
      });
    },
    []
  );

  const handleSave = useCallback(
    async (trayType: string) => {
      if (!project || !token) {
        showToast({
          intent: 'error',
          title: 'Sign-in required',
          body: 'You need to be signed in to update support settings.'
        });
        return;
      }

      if (!isAdmin) {
        showToast({
          intent: 'error',
          title: 'Administrator access required',
          body: 'Only administrators can update support settings.'
        });
        return;
      }

      const inputValue = inputs[trayType] ?? '';
      const parsed = parseNumberInput(inputValue);

      if (parsed.error) {
        setErrors((previous) => ({
          ...previous,
          [trayType]: parsed.error
        }));
        return;
      }

      const nextDistance =
        parsed.numeric !== null
          ? roundToDecimalPlaces(parsed.numeric, SUPPORT_DISTANCE_DECIMAL_PLACES)
          : null;
      const selectedSupportId = supportIds[trayType] ?? null;

      const currentOverride = project.supportDistanceOverrides[trayType];
      const currentDistance =
        currentOverride && currentOverride.distance !== null
          ? currentOverride.distance
          : null;
      const currentSupportId =
        currentOverride && currentOverride.supportId
          ? currentOverride.supportId
          : null;

      if (
        currentDistance === nextDistance &&
        currentSupportId === selectedSupportId
      ) {
        setErrors((previous) => ({
          ...previous,
          [trayType]: 'No changes to save.'
        }));
        return;
      }

      setSaving((previous) => ({
        ...previous,
        [trayType]: true
      }));
      setErrors((previous) => ({
        ...previous,
        [trayType]: null
      }));

      try {
        const nextOverrides = Object.entries(
          project.supportDistanceOverrides
        ).reduce<Record<string, ProjectSupportOverridePayload>>(
          (acc, [key, override]) => {
            acc[key] = {
              distance:
                override?.distance !== undefined && override?.distance !== null
                  ? override.distance
                  : null,
              supportId: override?.supportId ?? null
            };
            return acc;
          },
          {}
        );

        if (nextDistance === null && !selectedSupportId) {
          delete nextOverrides[trayType];
        } else {
          nextOverrides[trayType] = {
            distance: nextDistance,
            supportId: selectedSupportId
          };
        }

        await updateProject(token, project.id, {
          supportDistances: nextOverrides
        });
        await reloadProject();
        showToast({
          intent: 'success',
          title: `Support settings for ${trayType} updated`
        });
      } catch (error) {
        console.error(
          `Failed to update support settings for tray type "${trayType}"`,
          error
        );
        const message =
          error instanceof ApiError
            ? error.message
            : 'Failed to update support settings.';
        setErrors((previous) => ({
          ...previous,
          [trayType]: message
        }));
        showToast({
          intent: 'error',
          title: 'Update failed',
          body: message
        });
      } finally {
        setSaving((previous) => ({
          ...previous,
          [trayType]: false
        }));
      }
    },
    [inputs, supportIds, isAdmin, project, reloadProject, showToast, token]
  );

  const fields: SupportDistanceOverrideField[] = useMemo(() => {
    if (!project) {
      return [];
    }

    return trayTypeDetails.map((detail) => {
      const override = project.supportDistanceOverrides[detail.trayType];
      const currentDistance =
        override && override.distance !== null ? override.distance : null;
      const currentSupportType =
        override?.supportType ??
        (override?.supportId ? supportsById[override.supportId]?.type ?? null : null);
      const selectedSupportId = supportIds[detail.trayType] ?? null;
      const optionsInfo =
        supportOptionsByTrayType[detail.trayType] ?? {
          options: [] as MaterialSupport[],
          widthMm: detail.widthMm,
          hasMultipleWidths: detail.hasMultipleWidths
        };

      return {
        trayType: detail.trayType,
        trayWidthMm: optionsInfo.widthMm,
        hasWidthConflict: detail.hasMultipleWidths,
        currentDistance,
        currentSupportType,
        defaultValue: project.supportDistance ?? null,
        input: inputs[detail.trayType] ?? '',
        selectedSupportId,
        selectedSupportLabel:
          selectedSupportId
            ? supportsById[selectedSupportId]?.type ??
              override?.supportType ??
              'Support no longer available'
            : 'None (use default)',
        selectedSupportMissing: Boolean(
          selectedSupportId && !supportsById[selectedSupportId]
        ),
        supportOptions: optionsInfo.options,
        supportsLoading,
        supportsError,
        error: errors[detail.trayType] ?? null,
        saving: Boolean(saving[detail.trayType]),
        onInputChange: (value: string) => handleInputChange(detail.trayType, value),
        onSupportChange: (supportId: string | null) =>
          handleSupportChange(detail.trayType, supportId),
        onSave: () => handleSave(detail.trayType)
      };
    });
  }, [
    project,
    trayTypeDetails,
    supportIds,
    supportOptionsByTrayType,
    supportsById,
    inputs,
    supportsLoading,
    supportsError,
    errors,
    saving,
    handleInputChange,
    handleSupportChange,
    handleSave
  ]);

  return fields;
};
