import { useCallback, useEffect, useRef, useState } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import { updateTray } from '@/api/client';
import type { Tray, TrayInput } from '@/api/client';
import type { useToast } from '@/context/ToastContext';

export const useTrefoilClampSettings = (
  projectId: string | undefined,
  tray: Tray | null,
  token: string | null,
  showToast: ReturnType<typeof useToast>['showToast'],
  setTray: (tray: Tray) => void,
  setTrays: Dispatch<SetStateAction<Tray[]>>,
) => {
  const [saving, setSaving] = useState(false);
  const saveInProgress = useRef(false);
  const activeTrayId = useRef(tray?.id);
  useEffect(() => {
    activeTrayId.current = tray?.id;
  }, [tray?.id]);

  const saveSettings = useCallback(
    async (settings: Partial<TrayInput>) => {
      if (!tray || !projectId || !token || saveInProgress.current) return;
      const previousTray = tray;
      saveInProgress.current = true;
      setSaving(true);
      setTray({ ...tray, ...settings });
      try {
        const response = await updateTray(token, projectId, tray.id, settings);
        if (activeTrayId.current === tray.id) setTray(response.tray);
        setTrays((previous) =>
          previous.map((item) => (item.id === response.tray.id ? response.tray : item)),
        );
      } catch (error) {
        if (activeTrayId.current === previousTray.id) setTray(previousTray);
        console.error('Failed to save trefoil clamp settings', error);
        showToast({
          intent: 'error',
          title: 'Failed to save trefoil clamp settings',
          body: 'Please try again.',
        });
      } finally {
        saveInProgress.current = false;
        setSaving(false);
      }
    },
    [tray, projectId, token, showToast, setTray, setTrays],
  );

  return {
    useTrefoilClamps: tray?.useTrefoilClamps ?? false,
    trefoilClampSpacingMm: tray?.trefoilClampSpacingMm ?? 600,
    trefoilClampSettingsSaving: saving,
    saveTrefoilClampSettings: saveSettings,
  };
};
