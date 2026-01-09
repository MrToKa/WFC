import type { ChangeEvent, FormEvent, RefObject } from 'react';
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState
} from 'react';

import type { ToastIntent } from '@fluentui/react-components';

import {
  ApiError,
  Cable,
  CableImportSummary,
  CableInput,
  createCable,
  deleteCable,
  exportCables,
  fetchCables,
  getCablesTemplate,
  importCables,
  updateCable
} from '@/api/client';

import {
  CABLE_LIST_PER_PAGE,
  CableFormErrors,
  CableFormState,
  buildCableInput,
  emptyCableForm,
  parseCableFormErrors,
  toCableFormState
} from '../../ProjectDetails.forms';
import {
  isIsoDateString,
  sanitizeFileSegment,
  toNullableString
} from '../../ProjectDetails.utils';

export type CableSearchCriteria = 'all' | 'tag' | 'typeName' | 'fromLocation' | 'toLocation' | 'routing';

type ShowToast = (options: {
  title: string;
  body?: string;
  intent?: ToastIntent;
}) => void;

type UseCableListSectionParams = {
  projectId?: string;
  project: { id: string; projectNumber: string } | null;
  token: string | null;
  showToast: ShowToast;
};

type CableDialogMode = 'create' | 'edit';

type CableDialogController = {
  open: boolean;
  mode: CableDialogMode;
  values: CableFormState;
  errors: CableFormErrors;
  submitting: boolean;
  handleFieldChange: (
    field: keyof CableFormState
  ) => (
    event: ChangeEvent<HTMLInputElement>,
    data: { value: string }
  ) => void;
  handleCableTypeSelect: (
    event: unknown,
    data: { optionValue?: string }
  ) => void;
  handleSubmit: (event: FormEvent<HTMLFormElement>) => Promise<void>;
  reset: () => void;
};

type UseCableListSectionResult = {
  cables: Cable[];
  cablesLoading: boolean;
  cablesRefreshing: boolean;
  cablesError: string | null;
  cablesImporting: boolean;
  cablesExporting: boolean;
  cablesGettingTemplate: boolean;
  pendingCableId: string | null;
  pagedCables: Cable[];
  totalCablePages: number;
  cablesPage: number;
  showCablePagination: boolean;
  fileInputRef: RefObject<HTMLInputElement | null>;
  inlineEditingEnabled: boolean;
  setInlineEditingEnabled: (value: boolean) => void;
  inlineUpdatingIds: Set<string>;
  cableDrafts: Record<string, CableFormState>;
  reloadCables: (options?: { showSpinner?: boolean }) => Promise<void>;
  goToPreviousPage: () => void;
  goToNextPage: () => void;
  openCreateCableDialog: (defaultCableTypeId?: string) => void;
  openEditCableDialog: (cable: Cable) => void;
  handleDeleteCable: (cable: Cable) => Promise<void>;
  handleImportCables: (event: ChangeEvent<HTMLInputElement>) => Promise<void>;
  handleExportCables: (view?: 'list' | 'report') => Promise<void>;
  handleGetCablesTemplate: (view?: 'list' | 'report') => Promise<void>;
  handleCableDraftChange: (
    cableId: string,
    field: keyof CableFormState,
    value: string
  ) => void;
  handleCableTextFieldBlur: (
    cable: Cable,
    field: keyof CableFormState
  ) => Promise<void>;
  handleInlineCableTypeChange: (
    cable: Cable,
    nextCableTypeId: string
  ) => Promise<void>;
  filterText: string;
  filterCriteria: CableSearchCriteria;
  setFilterText: (value: string) => void;
  setFilterCriteria: (value: CableSearchCriteria) => void;
  cableDialog: CableDialogController;
};

const defaultProjectSnapshot = (project: { id: string; projectNumber: string } | null) =>
  project
    ? { id: project.id, projectNumber: project.projectNumber }
    : null;

export const useCableListSection = ({
  projectId,
  project,
  token,
  showToast
}: UseCableListSectionParams): UseCableListSectionResult => {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const projectSnapshot = defaultProjectSnapshot(project);

  const [cables, setCables] = useState<Cable[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isRefreshing, setIsRefreshing] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [isImporting, setIsImporting] = useState<boolean>(false);
  const [isExporting, setIsExporting] = useState<boolean>(false);
  const [isGettingTemplate, setIsGettingTemplate] = useState<boolean>(false);
  const [pendingCableId, setPendingCableId] = useState<string | null>(null);
  const [page, setPage] = useState<number>(1);

  const [isDialogOpen, setDialogOpen] = useState<boolean>(false);
  const [dialogMode, setDialogMode] = useState<CableDialogMode>('create');
  const [dialogValues, setDialogValues] =
    useState<CableFormState>(emptyCableForm);
  const [dialogErrors, setDialogErrors] =
    useState<CableFormErrors>({});
  const [dialogSubmitting, setDialogSubmitting] =
    useState<boolean>(false);
  const [editingCableId, setEditingCableId] = useState<string | null>(null);

  const [inlineEditingEnabled, setInlineEditingEnabledState] =
    useState<boolean>(false);
  const [inlineUpdatingIds, setInlineUpdatingIds] = useState<Set<string>>(
    new Set()
  );
  const [cableDrafts, setCableDrafts] = useState<
    Record<string, CableFormState>
  >({});
  const [filterText, setFilterText] = useState<string>('');
  const [filterCriteria, setFilterCriteria] = useState<CableSearchCriteria>('all');

  const sortCables = useCallback((items: Cable[]) => {
    const toSortKey = (cable: Cable): string =>
      (cable.tag ?? '').toLocaleLowerCase();

    return [...items].sort((a, b) => {
      const tagComparison = toSortKey(a).localeCompare(toSortKey(b), undefined, {
        sensitivity: 'base'
      });

      if (tagComparison !== 0) {
        return tagComparison;
      }

      return a.cableId - b.cableId;
    });
  }, []);

  const filteredCables = useMemo(() => {
    const normalizedFilter = filterText.trim().toLowerCase();
    return cables.filter((cable) => {
      if (!normalizedFilter) {
        return true;
      }
      
      if (filterCriteria === 'all') {
        const values = [
          cable.cableId,
          cable.tag,
          cable.typeName,
          cable.fromLocation,
          cable.toLocation,
          cable.routing,
          cable.designLength !== null ? String(cable.designLength) : ''
        ];
        return values.some((value) =>
          (value ?? '').toLowerCase().includes(normalizedFilter)
        );
      }
      
      // Filter by specific criteria
      let value = '';
      switch (filterCriteria) {
        case 'tag':
          value = cable.tag ?? cable.cableId ?? '';
          break;
        case 'typeName':
          value = cable.typeName ?? '';
          break;
        case 'fromLocation':
          value = cable.fromLocation ?? '';
          break;
        case 'toLocation':
          value = cable.toLocation ?? '';
          break;
        case 'routing':
          value = cable.routing ?? '';
          break;
      }
      return value.toLowerCase().includes(normalizedFilter);
    });
  }, [cables, filterText, filterCriteria]);

  const totalPages = useMemo(() => {
    if (filteredCables.length === 0) {
      return 1;
    }
    return Math.max(
      1,
      Math.ceil(filteredCables.length / CABLE_LIST_PER_PAGE)
    );
  }, [filteredCables.length]);

  const pagedCables = useMemo(() => {
    if (filteredCables.length === 0) {
      return [];
    }
    const startIndex = (page - 1) * CABLE_LIST_PER_PAGE;
    return filteredCables.slice(
      startIndex,
      startIndex + CABLE_LIST_PER_PAGE
    );
  }, [page, filteredCables]);

  useEffect(() => {
    if (page > totalPages) {
      setPage(totalPages);
    }
  }, [page, totalPages]);

  const handleFilterTextChange = useCallback((value: string) => {
    setFilterText(value);
    setPage(1);
  }, []);

  const handleFilterCriteriaChange = useCallback((value: CableSearchCriteria) => {
    setFilterCriteria(value);
    setPage(1);
  }, []);

  const reloadCables = useCallback(
    async ({ showSpinner = true }: { showSpinner?: boolean } = {}) => {
      if (!projectId) {
        return;
      }

      if (showSpinner) {
        setIsLoading(true);
      } else {
        setIsRefreshing(true);
      }

      setError(null);

      try {
        const response = await fetchCables(projectId);
        setCables(sortCables(response.cables));
        setPage(1);
      } catch (err) {
        console.error('Failed to load cables', err);
        if (err instanceof ApiError) {
          if (err.status === 404) {
            setCables([]);
            setPage(1);
            setError(
              'Cables endpoint is unavailable. Ensure the server is running the latest version.'
            );
          } else {
            setError(err.message);
          }
        } else {
          setError('Failed to load cables.');
        }
      } finally {
        setIsLoading(false);
        setIsRefreshing(false);
      }
    },
    [projectId, sortCables]
  );

  useEffect(() => {
    if (!projectId) {
      return;
    }
    void reloadCables({ showSpinner: true });
  }, [projectId, reloadCables]);

  const goToPreviousPage = useCallback(() => {
    setPage((previous) => Math.max(1, previous - 1));
  }, []);

  const goToNextPage = useCallback(() => {
    setPage((previous) => Math.min(totalPages, previous + 1));
  }, [totalPages]);

  const handleFieldChange =
    (field: keyof CableFormState) =>
    (_event: ChangeEvent<HTMLInputElement>, data: { value: string }) => {
      setDialogValues((previous: CableFormState) => ({
        ...previous,
        [field]: data.value
      }));
    };

  const handleCableTypeSelect = (
    _event: unknown,
    data: { optionValue?: string }
  ) => {
    setDialogValues((previous: CableFormState) => ({
      ...previous,
      cableTypeId: data.optionValue ?? ''
    }));
  };

  const resetDialog = useCallback(() => {
    setDialogOpen(false);
    setDialogErrors({ });
    setDialogValues(emptyCableForm);
    setDialogSubmitting(false);
    setEditingCableId(null);
  }, []);

  const openCreateCableDialog = useCallback(
    (defaultCableTypeId?: string) => {
      setDialogMode('create');
      setDialogErrors({});
      setDialogValues({
        ...emptyCableForm,
        cableTypeId: defaultCableTypeId ?? ''
      });
      setDialogOpen(true);
      setEditingCableId(null);
    },
    []
  );

  const openEditCableDialog = useCallback((cable: Cable) => {
    setDialogMode('edit');
    setDialogErrors({});
    setDialogValues(toCableFormState(cable));
    setDialogOpen(true);
    setEditingCableId(cable.id);
  }, []);

  const setInlineEditingEnabled = useCallback((value: boolean) => {
    setInlineEditingEnabledState(value);
  }, []);

  const rebuildCableDrafts = useCallback(() => {
    setCableDrafts(
      cables.reduce((acc, cable) => {
        acc[cable.id] = toCableFormState(cable);
        return acc;
      }, {} as Record<string, CableFormState>)
    );
  }, [cables]);

  useEffect(() => {
    rebuildCableDrafts();
  }, [rebuildCableDrafts]);

  useEffect(() => {
    if (!inlineEditingEnabled) {
      rebuildCableDrafts();
    }
  }, [inlineEditingEnabled, rebuildCableDrafts]);

  const handleCableDraftChange = useCallback(
    (cableId: string, field: keyof CableFormState, value: string) => {
      setCableDrafts((previous: Record<string, CableFormState>) => {
        const baseDraft =
          previous[cableId] ??
          (() => {
            const cable = cables.find((item) => item.id === cableId);
            return cable ? toCableFormState(cable) : { ...emptyCableForm };
          })();

        return {
          ...previous,
          [cableId]: {
            ...baseDraft,
            [field]: value
          }
        };
      });
    },
    [cables]
  );

  const updateCableInline = useCallback(
    async (cable: Cable, changes: Partial<CableInput>) => {
      if (!projectSnapshot || !token) {
        showToast({
          intent: 'error',
          title: 'Sign-in required',
          body: 'You need to be signed in to update cables.'
        });
        return;
      }

      if (Object.keys(changes).length === 0) {
        return;
      }

      setInlineUpdatingIds((previous: Set<string>) => {
        const next = new Set(previous);
        next.add(cable.id);
        return next;
      });

      try {
        const response = await updateCable(
          token,
          projectSnapshot.id,
          cable.id,
          changes
        );
        setCables((previous: Cable[]) =>
          sortCables(
            previous.map((item) =>
              item.id === cable.id ? response.cable : item
            )
          )
        );
        setCableDrafts((previous: Record<string, CableFormState>) => ({
          ...previous,
          [cable.id]: toCableFormState(response.cable)
        }));
      } catch (err) {
        console.error('Inline cable update failed', err);
        showToast({
          intent: 'error',
          title: 'Failed to update cable',
          body: err instanceof ApiError ? err.message : undefined
        });
      } finally {
        setInlineUpdatingIds((previous: Set<string>) => {
          const next = new Set(previous);
          next.delete(cable.id);
          return next;
        });
      }
    },
    [projectSnapshot, showToast, sortCables, token]
  );

  const handleInlineCableTypeChange = useCallback(
    async (cable: Cable, nextCableTypeId: string) => {
      if (nextCableTypeId === '' || nextCableTypeId === cable.cableTypeId) {
        return;
      }
      await updateCableInline(cable, { cableTypeId: nextCableTypeId });
    },
    [updateCableInline]
  );

  const handleCableTextFieldBlur = useCallback(
    async (cable: Cable, field: keyof CableFormState) => {
      const draft = cableDrafts[cable.id];
      if (!draft) {
        return;
      }

      let changes: Partial<CableInput> | null = null;

      switch (field) {
        case 'tag':
        case 'fromLocation':
        case 'toLocation':
        case 'routing': {
          const normalized = toNullableString(draft[field]);
          const current = (cable[field] ?? null) as string | null;

          if (normalized === current) {
            return;
          }

          changes = { [field]: normalized } as Partial<CableInput>;
          break;
        }
        case 'designLength':
        case 'installLength': {
          const trimmed = draft[field].trim();
          const current = (cable[field] ?? null) as number | null;

          if (trimmed === '') {
            if (current === null) {
              return;
            }
            changes = { [field]: null } as Partial<CableInput>;
          } else {
            const parsed = Number(trimmed);
            if (
              !Number.isFinite(parsed) ||
              !Number.isInteger(parsed) ||
              parsed < 0
            ) {
              const label =
                field === 'designLength' ? 'Design length' : 'Install length';
              showToast({
                intent: 'error',
                title: `Invalid ${label.toLowerCase()}`,
                body: `${label} must be a non-negative integer.`
              });
              return;
            }

            if (parsed === current) {
              return;
            }

            changes = { [field]: parsed } as Partial<CableInput>;
          }
          break;
        }
        case 'pullDate':
        case 'connectedFrom':
        case 'connectedTo':
        case 'tested': {
          const value = draft[field].trim();
          const current = cable[field] ?? null;

          if (value === '') {
            if (current === null) {
              return;
            }
            changes = { [field]: null } as Partial<CableInput>;
          } else {
            const normalized = value.slice(0, 10);

            if (!isIsoDateString(normalized)) {
              showToast({
                intent: 'error',
                title: 'Invalid date',
                body: 'Use the YYYY-MM-DD format for dates.'
              });
              return;
            }

            if (normalized === current) {
              return;
            }

            changes = { [field]: normalized } as Partial<CableInput>;
          }
          break;
        }
        default:
          return;
      }

      if (!changes) {
        return;
      }

      await updateCableInline(cable, changes);
    },
    [cableDrafts, showToast, updateCableInline]
  );

  const handleSubmit = useCallback(
    async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();

      if (!projectSnapshot || !token) {
        setDialogErrors({
          general: 'You need to be signed in to manage cables.'
        });
        return;
      }

      const { input, errors } = buildCableInput(dialogValues);

      if (Object.keys(errors).length > 0) {
        setDialogErrors(errors);
        return;
      }

      setDialogSubmitting(true);
      setDialogErrors({});

      try {
        if (dialogMode === 'create') {
          const response = await createCable(token, projectSnapshot.id, input);
          setCables((previous: Cable[]) =>
            sortCables([...previous, response.cable])
          );
          setPage(1);
          showToast({ intent: 'success', title: 'Cable added' });
        } else if (editingCableId) {
          const response = await updateCable(
            token,
            projectSnapshot.id,
            editingCableId,
            input
          );
          setCables((previous: Cable[]) =>
            sortCables(
              previous.map((item) =>
                item.id === editingCableId ? response.cable : item
              )
            )
          );
          showToast({ intent: 'success', title: 'Cable updated' });
        }
        resetDialog();
      } catch (err) {
        console.error('Save cable failed', err);
        if (err instanceof ApiError) {
          setDialogErrors(parseCableFormErrors(err.payload));
          showToast({
            intent: 'error',
            title: 'Failed to save cable',
            body: err.message
          });
        } else {
          const message = 'Failed to save cable. Please try again.';
          setDialogErrors({
            general: message
          });
          showToast({
            intent: 'error',
            title: 'Failed to save cable',
            body: message
          });
        }
      } finally {
        setDialogSubmitting(false);
      }
    },
    [
      dialogMode,
      dialogValues,
      editingCableId,
      projectSnapshot,
      resetDialog,
      showToast,
      sortCables,
      token
    ]
  );

  const handleDeleteCable = useCallback(
    async (cable: Cable) => {
      if (!projectSnapshot || !token) {
        showToast({
          intent: 'error',
          title: 'Sign-in required',
          body: 'You need to be signed in to delete cables.'
        });
        return;
      }

      const confirmed = window.confirm(
        `Delete cable "${cable.cableId}"? This action cannot be undone.`
      );

      if (!confirmed) {
        return;
      }

      setPendingCableId(cable.id);

      try {
        await deleteCable(token, projectSnapshot.id, cable.id);
        setCables((previous: Cable[]) => {
          const next = previous.filter((item) => item.id !== cable.id);
          const nextPages = Math.max(
            1,
            Math.ceil(next.length / CABLE_LIST_PER_PAGE)
          );
          if (page > nextPages) {
            setPage(nextPages);
          }
          return next;
        });
        showToast({ intent: 'success', title: 'Cable deleted' });
      } catch (err) {
        console.error('Delete cable failed', err);
        showToast({
          intent: 'error',
          title: 'Failed to delete cable',
          body: err instanceof ApiError ? err.message : undefined
        });
      } finally {
        setPendingCableId(null);
      }
    },
    [page, projectSnapshot, showToast, token]
  );

  const handleImportCables = useCallback(
    async (event: ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];

      if (!file) {
        return;
      }

      event.target.value = '';

      if (!projectSnapshot || !token) {
        showToast({
          intent: 'error',
          title: 'Sign-in required',
          body: 'You need to be signed in to import cables.'
        });
        return;
      }

      setIsImporting(true);

      try {
        const response = await importCables(token, projectSnapshot.id, file);
        setCables(sortCables(response.cables));
        setPage(1);

        const summary: CableImportSummary = response.summary;
        showToast({
          intent: 'success',
          title: 'Cables imported',
          body: `${summary.inserted} added, ${summary.updated} updated, ${summary.skipped} skipped.`
        });
      } catch (err) {
        console.error('Import cables failed', err);
        if (err instanceof ApiError && err.status === 404) {
          showToast({
            intent: 'error',
            title: 'Import endpoint unavailable',
            body: 'Please restart the API server after updating it.'
          });
        } else {
          showToast({
            intent: 'error',
            title: 'Failed to import cables',
            body: err instanceof ApiError ? err.message : undefined
          });
        }
      } finally {
        setIsImporting(false);
      }
    },
    [projectSnapshot, showToast, sortCables, token]
  );

  const handleExportCables = useCallback(
    async (view: 'list' | 'report' = 'list') => {
      if (!projectSnapshot || !token) {
        showToast({
          intent: 'error',
          title: 'Sign-in required',
          body: 'You need to be signed in to export cables.'
        });
        return;
      }

      setIsExporting(true);

      try {
        const blob = await exportCables(token, projectSnapshot.id, {
          filterText,
          view
        });
        const link = document.createElement('a');
        const url = window.URL.createObjectURL(blob);
        const suffix = view === 'report' ? 'cables-report' : 'cable-list';
        const fileName = `${sanitizeFileSegment(
          projectSnapshot.projectNumber
        )}-${suffix}.xlsx`;

        link.href = url;
        link.download = fileName;
        document.body.appendChild(link);
        link.click();
        link.remove();
        window.URL.revokeObjectURL(url);

        showToast({ intent: 'success', title: 'Cables exported' });
      } catch (err) {
        console.error('Export cables failed', err);
        if (err instanceof ApiError && err.status === 404) {
          showToast({
            intent: 'error',
            title: 'Export endpoint unavailable',
            body: 'Please restart the API server after updating it.'
          });
        } else {
          showToast({
            intent: 'error',
            title: 'Failed to export cables',
            body: err instanceof ApiError ? err.message : undefined
          });
        }
      } finally {
        setIsExporting(false);
      }
    },
    [
      filterText,
      projectSnapshot,
      showToast,
      token
    ]
  );

  const handleGetCablesTemplate = useCallback(
    async (view?: 'list' | 'report') => {
      if (!projectSnapshot || !token) {
        showToast({
          intent: 'error',
          title: 'Admin access required',
          body: 'You need to be signed in as an admin to get the template.'
        });
        return;
      }

      setIsGettingTemplate(true);

      try {
        const blob = await getCablesTemplate(token, projectSnapshot.id, view);
        const link = document.createElement('a');
        const url = window.URL.createObjectURL(blob);
        const fileSuffix = view === 'report' ? 'cables-report' : 'cable-list';
        const fileName = `${fileSuffix}-template.xlsx`;

        link.href = url;
        link.download = fileName;
        document.body.appendChild(link);
        link.click();
        link.remove();
        window.URL.revokeObjectURL(url);

        showToast({ intent: 'success', title: 'Template downloaded' });
      } catch (err) {
        console.error('Get cables template failed', err);
        showToast({
          intent: 'error',
          title: 'Failed to get template',
          body: err instanceof ApiError ? err.message : undefined
        });
      } finally {
        setIsGettingTemplate(false);
      }
    },
    [projectSnapshot, showToast, token]
  );

  return {
    cables,
    cablesLoading: isLoading,
    cablesRefreshing: isRefreshing,
    cablesError: error,
    cablesImporting: isImporting,
    cablesExporting: isExporting,
    cablesGettingTemplate: isGettingTemplate,
    pendingCableId,
    pagedCables,
    totalCablePages: totalPages,
    cablesPage: page,
    showCablePagination: filteredCables.length > CABLE_LIST_PER_PAGE,
    fileInputRef,
    inlineEditingEnabled,
    setInlineEditingEnabled,
    inlineUpdatingIds,
    cableDrafts,
    reloadCables,
    goToPreviousPage,
    goToNextPage,
    openCreateCableDialog,
    openEditCableDialog,
    handleDeleteCable,
    handleImportCables,
    handleExportCables,
    handleGetCablesTemplate,
    handleCableDraftChange,
    handleCableTextFieldBlur,
    handleInlineCableTypeChange,
    filterText,
    filterCriteria,
    setFilterText: handleFilterTextChange,
    setFilterCriteria: handleFilterCriteriaChange,
    cableDialog: {
      open: isDialogOpen,
      mode: dialogMode,
      values: dialogValues,
      errors: dialogErrors,
      submitting: dialogSubmitting,
      handleFieldChange,
      handleCableTypeSelect,
      handleSubmit,
      reset: resetDialog
    }
  };
};

