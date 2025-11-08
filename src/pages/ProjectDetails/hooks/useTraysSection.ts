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
  CableImportSummary,
  MaterialTray,
  Tray,
  createTray,
  deleteTray,
  exportTrays,
  fetchAllMaterialTrays,
  fetchTrays,
  getTraysTemplate,
  importTrays,
  updateTray
} from '@/api/client';

import {
  TRAYS_PER_PAGE,
  TrayFormErrors,
  TrayFormState,
  buildTrayInput,
  emptyTrayForm,
  parseTrayApiErrors,
  toTrayFormState
} from '../../ProjectDetails.forms';
import { sanitizeFileSegment } from '../../ProjectDetails.utils';

export type TraySearchCriteria = 'all' | 'name' | 'type' | 'purpose' | 'width' | 'height';

type ShowToast = (options: {
  title: string;
  body?: string;
  intent?: ToastIntent;
}) => void;

type UseTraysSectionParams = {
  projectId?: string;
  project: { id: string; projectNumber: string } | null;
  token: string | null;
  showToast: ShowToast;
};

type TrayDialogMode = 'create' | 'edit';

type TrayDialogController = {
  open: boolean;
  mode: TrayDialogMode;
  values: TrayFormState;
  errors: TrayFormErrors;
  submitting: boolean;
  materialTrays: MaterialTray[];
  handleFieldChange: (
    field: keyof TrayFormState
  ) => (
    event: ChangeEvent<HTMLInputElement>,
    data: { value: string }
  ) => void;
  handleTypeSelect: (_event: unknown, data: { optionValue?: string }) => void;
  handlePurposeSelect: (_event: unknown, data: { optionValue?: string }) => void;
  handleSubmit: (event: FormEvent<HTMLFormElement>) => Promise<void>;
  reset: () => void;
};

type UseTraysSectionResult = {
  trays: Tray[];
  traysLoading: boolean;
  traysRefreshing: boolean;
  traysError: string | null;
  traysImporting: boolean;
  traysExporting: boolean;
  traysGettingTemplate: boolean;
  pendingTrayId: string | null;
  pagedTrays: Tray[];
  totalTrayPages: number;
  traysPage: number;
  showTrayPagination: boolean;
  fileInputRef: RefObject<HTMLInputElement | null>;
  searchText: string;
  searchCriteria: TraySearchCriteria;
  setSearchText: (value: string) => void;
  setSearchCriteria: (value: TraySearchCriteria) => void;
  reloadTrays: (options?: { showSpinner?: boolean }) => Promise<void>;
  goToPreviousPage: () => void;
  goToNextPage: () => void;
  openCreateTrayDialog: () => void;
  openEditTrayDialog: (tray: Tray) => void;
  handleDeleteTray: (tray: Tray) => Promise<void>;
  handleImportTrays: (event: ChangeEvent<HTMLInputElement>) => Promise<void>;
  handleExportTrays: (
    freeSpaceByTrayId?: Record<string, number | null>
  ) => Promise<void>;
  handleGetTraysTemplate: () => Promise<void>;
  trayDialog: TrayDialogController;
};

const defaultProjectSnapshot = (project: { id: string; projectNumber: string } | null) =>
  project
    ? { id: project.id, projectNumber: project.projectNumber }
    : null;

export const useTraysSection = ({
  projectId,
  project,
  token,
  showToast
}: UseTraysSectionParams): UseTraysSectionResult => {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const projectSnapshot = defaultProjectSnapshot(project);

  const [trays, setTrays] = useState<Tray[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isRefreshing, setIsRefreshing] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [isImporting, setIsImporting] = useState<boolean>(false);
  const [isExporting, setIsExporting] = useState<boolean>(false);
  const [isGettingTemplate, setIsGettingTemplate] = useState<boolean>(false);
  const [pendingTrayId, setPendingTrayId] = useState<string | null>(null);
  const [page, setPage] = useState<number>(1);

  const [materialTrays, setMaterialTrays] = useState<MaterialTray[]>([]);

  const [isDialogOpen, setDialogOpen] = useState<boolean>(false);
  const [dialogMode, setDialogMode] = useState<TrayDialogMode>('create');
  const [dialogValues, setDialogValues] =
    useState<TrayFormState>(emptyTrayForm);
  const [dialogErrors, setDialogErrors] = useState<TrayFormErrors>({});
  const [dialogSubmitting, setDialogSubmitting] = useState<boolean>(false);
  const [editingTrayId, setEditingTrayId] = useState<string | null>(null);

  const [searchText, setSearchText] = useState<string>('');
  const [searchCriteria, setSearchCriteria] = useState<TraySearchCriteria>('all');

  const sortTrays = useCallback(
    (items: Tray[]) =>
      [...items].sort((a, b) =>
        a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })
      ),
    []
  );

  const filteredTrays = useMemo(() => {
    const normalizedFilter = searchText.trim().toLowerCase();
    if (!normalizedFilter) {
      return trays;
    }
    return trays.filter((tray) => {
      if (searchCriteria === 'all') {
        const values = [
          tray.name,
          tray.type,
          tray.purpose,
          tray.widthMm !== null ? String(tray.widthMm) : '',
          tray.heightMm !== null ? String(tray.heightMm) : '',
          tray.lengthMm !== null ? String(tray.lengthMm) : ''
        ];
        return values.some((value) =>
          (value ?? '').toLowerCase().includes(normalizedFilter)
        );
      }
      
      // Filter by specific criteria
      let value = '';
      switch (searchCriteria) {
        case 'name':
          value = tray.name ?? '';
          break;
        case 'type':
          value = tray.type ?? '';
          break;
        case 'purpose':
          value = tray.purpose ?? '';
          break;
        case 'width':
          value = tray.widthMm !== null ? String(tray.widthMm) : '';
          break;
        case 'height':
          value = tray.heightMm !== null ? String(tray.heightMm) : '';
          break;
      }
      return value.toLowerCase().includes(normalizedFilter);
    });
  }, [searchText, searchCriteria, trays]);

  const totalPages = useMemo(() => {
    if (filteredTrays.length === 0) {
      return 1;
    }
    return Math.max(1, Math.ceil(filteredTrays.length / TRAYS_PER_PAGE));
  }, [filteredTrays.length]);

  const pagedTrays = useMemo(() => {
    if (filteredTrays.length === 0) {
      return [];
    }
    const startIndex = (page - 1) * TRAYS_PER_PAGE;
    return filteredTrays.slice(startIndex, startIndex + TRAYS_PER_PAGE);
  }, [filteredTrays, page]);

  useEffect(() => {
    const nextPage = Math.max(1, Math.ceil(trays.length / TRAYS_PER_PAGE));
    if (page > nextPage) {
      setPage(nextPage);
    }
  }, [page, trays.length]);

  const reloadTrays = useCallback(
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
        const response = await fetchTrays(projectId);
        setTrays(sortTrays(response.trays));
        setPage(1);
      } catch (err) {
        console.error('Failed to load trays', err);
        if (err instanceof ApiError) {
          if (err.status === 404) {
            setTrays([]);
            setPage(1);
            setError(
              'Trays endpoint is unavailable. Ensure the server is running the latest version.'
            );
          } else {
            setError(err.message);
          }
        } else {
          setError('Failed to load trays.');
        }
      } finally {
        setIsLoading(false);
        setIsRefreshing(false);
      }
    },
    [projectId, sortTrays]
  );

  useEffect(() => {
    if (!projectId) {
      return;
    }
    void reloadTrays({ showSpinner: true });
  }, [projectId, reloadTrays]);

  // Fetch material trays
  useEffect(() => {
      const loadMaterialTrays = async () => {
        try {
          const response = await fetchAllMaterialTrays();
          setMaterialTrays(response.trays);
        } catch (err) {
          console.error('Failed to load material trays', err);
        }
      };
      void loadMaterialTrays();
  }, []);

  const goToPreviousPage = useCallback(() => {
    setPage((previous) => Math.max(1, previous - 1));
  }, []);

  const goToNextPage = useCallback(() => {
    setPage((previous) => Math.min(totalPages, previous + 1));
  }, [totalPages]);

  const handleSearchTextChange = useCallback((value: string) => {
    setSearchText(value);
    setPage(1);
  }, []);

  const handleSearchCriteriaChange = useCallback((value: TraySearchCriteria) => {
    setSearchCriteria(value);
    setPage(1);
  }, []);

  const handleFieldChange =
    (field: keyof TrayFormState) =>
    (_event: ChangeEvent<HTMLInputElement>, data: { value: string }) => {
      setDialogValues((previous: TrayFormState) => ({
        ...previous,
        [field]: data.value
      }));
    };

  const handlePurposeSelect = useCallback(
    (_event: unknown, data: { optionValue?: string }) => {
      setDialogValues((previous: TrayFormState) => ({
        ...previous,
        purpose: data.optionValue ?? ''
      }));
    },
    []
  );

  const handleTypeSelect = useCallback(
    (_event: unknown, data: { optionValue?: string }) => {
      setDialogValues((previous: TrayFormState) => ({
        ...previous,
        type: data.optionValue ?? ''
      }));
    },
    []
  );

  const resetDialog = useCallback(() => {
    setDialogOpen(false);
    setDialogErrors({});
    setDialogValues(emptyTrayForm);
    setDialogSubmitting(false);
    setEditingTrayId(null);
  }, []);

  const openCreateTrayDialog = useCallback(() => {
    setDialogMode('create');
    setDialogValues(emptyTrayForm);
    setDialogErrors({});
    setDialogOpen(true);
    setEditingTrayId(null);
  }, []);

  const openEditTrayDialog = useCallback((tray: Tray) => {
    setDialogMode('edit');
    setDialogValues(toTrayFormState(tray));
    setDialogErrors({});
    setDialogOpen(true);
    setEditingTrayId(tray.id);
  }, []);

  const handleSubmit = useCallback(
    async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();

      if (!projectSnapshot || !token) {
        setDialogErrors({
          general: 'You need to be signed in as an admin to manage trays.'
        });
        return;
      }

      const { input, errors } = buildTrayInput(dialogValues);

      if (Object.keys(errors).length > 0) {
        setDialogErrors(errors);
        return;
      }

      setDialogSubmitting(true);
      setDialogErrors({});

      try {
        if (dialogMode === 'create') {
          const response = await createTray(token, projectSnapshot.id, input);
          setTrays((previous: Tray[]) => sortTrays([...previous, response.tray]));
          setPage(1);
          showToast({ intent: 'success', title: 'Tray created' });
        } else if (editingTrayId) {
          const response = await updateTray(
            token,
            projectSnapshot.id,
            editingTrayId,
            input
          );
        setTrays((previous: Tray[]) =>
          sortTrays(
            previous.map((item) =>
              item.id === editingTrayId ? response.tray : item
            )
          )
          );
          showToast({ intent: 'success', title: 'Tray updated' });
        }
        resetDialog();
      } catch (err) {
        console.error('Save tray failed', err);
        if (err instanceof ApiError) {
          setDialogErrors(parseTrayApiErrors(err.payload));
          showToast({
            intent: 'error',
            title: 'Failed to save tray',
            body: err.message
          });
        } else {
          const message = 'Failed to save tray. Please try again.';
          setDialogErrors({ general: message });
          showToast({
            intent: 'error',
            title: 'Failed to save tray',
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
      editingTrayId,
      projectSnapshot,
      resetDialog,
      showToast,
      sortTrays,
      token
    ]
  );

  const handleDeleteTray = useCallback(
    async (tray: Tray) => {
      if (!projectSnapshot || !token) {
        showToast({
          intent: 'error',
          title: 'Admin access required',
          body: 'You need to be signed in as an admin to delete trays.'
        });
        return;
      }

      const confirmed = window.confirm(
        `Delete tray "${tray.name}"? This action cannot be undone.`
      );

      if (!confirmed) {
        return;
      }

      setPendingTrayId(tray.id);

      try {
        await deleteTray(token, projectSnapshot.id, tray.id);
        setTrays((previous: Tray[]) => {
          const next = previous.filter((item) => item.id !== tray.id);
          const nextPages = Math.max(
            1,
            Math.ceil(next.length / TRAYS_PER_PAGE)
          );
          if (page > nextPages) {
            setPage(nextPages);
          }
          return next;
        });
        showToast({ intent: 'success', title: 'Tray deleted' });
      } catch (err) {
        console.error('Delete tray failed', err);
        showToast({
          intent: 'error',
          title: 'Failed to delete tray',
          body: err instanceof ApiError ? err.message : undefined
        });
      } finally {
        setPendingTrayId(null);
      }
    },
    [page, projectSnapshot, showToast, token]
  );

  const handleImportTrays = useCallback(
    async (event: ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];

      if (!file) {
        return;
      }

      event.target.value = '';

      if (!projectSnapshot || !token) {
        showToast({
          intent: 'error',
          title: 'Admin access required',
          body: 'You need to be signed in as an admin to import trays.'
        });
        return;
      }

      setIsImporting(true);

      try {
        const response = await importTrays(token, projectSnapshot.id, file);
        setTrays(sortTrays(response.trays));
        setPage(1);

        const summary: CableImportSummary = response.summary;
        showToast({
          intent: 'success',
          title: 'Trays imported',
          body: `${summary.inserted} added, ${summary.updated} updated, ${summary.skipped} skipped.`
        });
      } catch (err) {
        console.error('Import trays failed', err);
        if (err instanceof ApiError && err.status === 404) {
          showToast({
            intent: 'error',
            title: 'Import endpoint unavailable',
            body: 'Please restart the API server after updating it.'
          });
        } else {
          showToast({
            intent: 'error',
            title: 'Failed to import trays',
            body: err instanceof ApiError ? err.message : undefined
          });
        }
      } finally {
        setIsImporting(false);
      }
    },
    [projectSnapshot, showToast, sortTrays, token]
  );

  const handleExportTrays = useCallback(
    async (freeSpaceByTrayId?: Record<string, number | null>) => {
      if (!projectSnapshot || !token) {
        showToast({
          intent: 'error',
          title: 'Admin access required',
          body: 'You need to be signed in as an admin to export trays.'
        });
        return;
      }

      setIsExporting(true);

      try {
        const blob = await exportTrays(token, projectSnapshot.id, {
          freeSpaceByTrayId
        });
        const link = document.createElement('a');
        const url = window.URL.createObjectURL(blob);
        const fileName = `${sanitizeFileSegment(
          projectSnapshot.projectNumber
        )}-trays.xlsx`;

        link.href = url;
        link.download = fileName;
        document.body.appendChild(link);
        link.click();
        link.remove();
        window.URL.revokeObjectURL(url);

        showToast({ intent: 'success', title: 'Trays exported' });
      } catch (err) {
        console.error('Export trays failed', err);
        if (err instanceof ApiError && err.status === 404) {
          showToast({
            intent: 'error',
            title: 'Export endpoint unavailable',
            body: 'Please restart the API server after updating it.'
          });
        } else {
          showToast({
            intent: 'error',
            title: 'Failed to export trays',
            body: err instanceof ApiError ? err.message : undefined
          });
        }
      } finally {
        setIsExporting(false);
      }
    },
    [projectSnapshot, showToast, token]
  );

  const handleGetTraysTemplate = useCallback(async () => {
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
      const blob = await getTraysTemplate(token, projectSnapshot.id);
      const link = document.createElement('a');
      const url = window.URL.createObjectURL(blob);
      const fileName = 'trays-template.xlsx';

      link.href = url;
      link.download = fileName;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);

      showToast({ intent: 'success', title: 'Template downloaded' });
    } catch (err) {
      console.error('Get trays template failed', err);
      showToast({
        intent: 'error',
        title: 'Failed to get template',
        body: err instanceof ApiError ? err.message : undefined
      });
    } finally {
      setIsGettingTemplate(false);
    }
  }, [projectSnapshot, showToast, token]);

  return {
    trays,
    traysLoading: isLoading,
    traysRefreshing: isRefreshing,
    traysError: error,
    traysImporting: isImporting,
    traysExporting: isExporting,
    traysGettingTemplate: isGettingTemplate,
    pendingTrayId,
    pagedTrays,
    totalTrayPages: totalPages,
    traysPage: page,
    showTrayPagination: filteredTrays.length > TRAYS_PER_PAGE,
    fileInputRef,
    searchText,
    searchCriteria,
    setSearchText: handleSearchTextChange,
    setSearchCriteria: handleSearchCriteriaChange,
    reloadTrays,
    goToPreviousPage,
    goToNextPage,
    openCreateTrayDialog,
    openEditTrayDialog,
    handleDeleteTray,
    handleImportTrays,
    handleExportTrays,
    handleGetTraysTemplate,
    trayDialog: {
      open: isDialogOpen,
      mode: dialogMode,
      values: dialogValues,
      errors: dialogErrors,
      submitting: dialogSubmitting,
      materialTrays,
      handleFieldChange,
      handleTypeSelect,
      handlePurposeSelect,
      handleSubmit,
      reset: resetDialog
    }
  };
};
