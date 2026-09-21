import { useEffect, useRef, useState } from 'react';
import {
  DEFAULT_CABLE_LIST_COLUMNS,
  fetchCableListColumns,
  updateCableListColumns,
  type CableListColumnId,
} from '@/api/cableListPreferences';

export const useCableListColumns = (token: string | null) => {
  const [preferences, setPreferences] = useState<{
    token: string;
    columns: CableListColumnId[];
  } | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const session = useRef<object | null>(null);
  const saveInProgress = useRef(false);

  useEffect(() => {
    const currentSession = {};
    session.current = currentSession;
    setPreferences(null);
    setLoadError(null);
    setSaveError(null);
    setSaving(false);
    saveInProgress.current = false;
    setLoading(Boolean(token));

    if (token) {
      void fetchCableListColumns(token)
        .then(({ columns }) => {
          if (session.current !== currentSession) return;
          setPreferences({ token, columns });
          setLoading(false);
        })
        .catch(() => {
          if (session.current !== currentSession) return;
          setLoadError('Could not load your column settings. Please try again.');
          setLoading(false);
        });
    }

    return () => {
      session.current = null;
    };
  }, [token, reloadKey]);

  const ready = Boolean(token && preferences?.token === token);
  const columns = ready ? preferences!.columns : DEFAULT_CABLE_LIST_COLUMNS;

  const save = async (nextColumns: CableListColumnId[]): Promise<boolean> => {
    if (!token || !ready || saveInProgress.current) return false;
    const currentSession = session.current;
    saveInProgress.current = true;
    setSaving(true);
    setSaveError(null);
    try {
      const response = await updateCableListColumns(token, nextColumns);
      if (session.current !== currentSession) return false;
      setPreferences({ token, columns: response.columns });
      return true;
    } catch {
      if (session.current === currentSession) {
        setSaveError('Could not save your column settings. Please try again.');
      }
      return false;
    } finally {
      if (session.current === currentSession) {
        saveInProgress.current = false;
        setSaving(false);
      }
    }
  };

  return {
    columns,
    ready,
    loading,
    loadError,
    reload: () => setReloadKey((key) => key + 1),
    saving,
    saveError,
    clearSaveError: () => setSaveError(null),
    save,
  };
};
