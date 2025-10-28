import { useState, useEffect, useMemo, useCallback } from 'react';
import { CableType, Tray, updateTray } from '../../../api/client';
import { GroundingSelection } from '../TrayDetails.types';

export const useGroundingCable = (
  projectId: string | undefined,
  trayId: string | undefined,
  projectCableTypes: CableType[],
  token: string | null,
  showToast: ReturnType<typeof import('../../../context/ToastContext').useToast>['showToast'],
  setTray: (tray: Tray) => void,
  setTrays: React.Dispatch<React.SetStateAction<Tray[]>>
) => {
  const [groundingSelectionsByTrayId, setGroundingSelectionsByTrayId] = useState<
    Record<string, GroundingSelection>
  >({});
  const [groundingPreferenceSaving, setGroundingPreferenceSaving] = useState<boolean>(false);

  useEffect(() => {
    setGroundingSelectionsByTrayId((previous) =>
      Object.keys(previous).length > 0 ? {} : previous
    );
  }, [projectId]);

  const groundingCableTypes = useMemo(
    () =>
      projectCableTypes.filter((type) => {
        const purpose = type.purpose?.trim().toLowerCase();
        return purpose === 'grounding';
      }),
    [projectCableTypes]
  );

  const currentGroundingPreference =
    trayId && groundingSelectionsByTrayId[trayId]
      ? groundingSelectionsByTrayId[trayId]
      : null;

  const includeGroundingCable = currentGroundingPreference?.include ?? false;
  const selectedGroundingCableTypeId = currentGroundingPreference?.typeId ?? null;

  const selectedGroundingCableType = useMemo(() => {
    if (!selectedGroundingCableTypeId) {
      return null;
    }
    return (
      groundingCableTypes.find((type) => type.id === selectedGroundingCableTypeId) ?? null
    );
  }, [groundingCableTypes, selectedGroundingCableTypeId]);

  const groundingCableWeightKgPerM = useMemo(() => {
    if (!includeGroundingCable || !selectedGroundingCableType) {
      return null;
    }
    const weight = selectedGroundingCableType.weightKgPerM;
    return weight !== null && !Number.isNaN(weight) ? weight : null;
  }, [includeGroundingCable, selectedGroundingCableType]);

  const persistGroundingPreference = useCallback(
    async (
      previousPreference: GroundingSelection | null,
      nextPreference: GroundingSelection
    ) => {
      if (!trayId) {
        return;
      }

      if (!projectId || !token) {
        setGroundingSelectionsByTrayId((previous) => {
          if (!previousPreference) {
            const { [trayId]: _omit, ...rest } = previous;
            return rest;
          }
          return {
            ...previous,
            [trayId]: previousPreference
          };
        });
        if (!token) {
          return;
        }
        showToast({
          intent: 'error',
          title: 'Unable to save grounding cable setting',
          body: 'Missing project information.'
        });
        return;
      }

      setGroundingPreferenceSaving(true);

      try {
        const response = await updateTray(token, projectId, trayId, {
          includeGroundingCable: nextPreference.include,
          groundingCableTypeId: nextPreference.typeId ?? null
        });

        setTray(response.tray);
        setTrays((previous) => {
          const hasTray = previous.some((item) => item.id === response.tray.id);
          if (!hasTray) {
            return previous;
          }
          return previous.map((item) =>
            item.id === response.tray.id ? response.tray : item
          );
        });
        setGroundingSelectionsByTrayId((previous) => ({
          ...previous,
          [trayId]: {
            include: response.tray.includeGroundingCable,
            typeId: response.tray.groundingCableTypeId
          }
        }));
      } catch (error) {
        console.error('Failed to save grounding cable preference', error);
        setGroundingSelectionsByTrayId((previous) => {
          if (!previousPreference) {
            const { [trayId]: _omit, ...rest } = previous;
            return rest;
          }
          return {
            ...previous,
            [trayId]: previousPreference
          };
        });
        showToast({
          intent: 'error',
          title: 'Failed to save grounding cable setting',
          body: 'Please try again.'
        });
      } finally {
        setGroundingPreferenceSaving(false);
      }
    },
    [projectId, trayId, token, showToast, setTray, setTrays]
  );

  return {
    groundingCableTypes,
    includeGroundingCable,
    selectedGroundingCableTypeId,
    selectedGroundingCableType,
    groundingCableWeightKgPerM,
    currentGroundingPreference,
    groundingPreferenceSaving,
    groundingSelectionsByTrayId,
    setGroundingSelectionsByTrayId,
    persistGroundingPreference
  };
};
