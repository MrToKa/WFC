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
  CableType,
  createCableType,
  deleteCableType,
  exportCableTypes,
  fetchCableTypes,
  getCableTypesTemplate,
  importCableTypes,
  updateCableType
} from '@/api/client';

import {
  CABLE_TYPES_PER_PAGE,
  CableTypeFormErrors,
  CableTypeFormState,
  buildCableTypeInput,
  emptyCableTypeForm,
  parseCableTypeApiErrors,
  toCableTypeFormState
} from '../../ProjectDetails.forms';
import { sanitizeFileSegment } from '../../ProjectDetails.utils';

export type CableTypeSearchCriteria = 'all' | 'name' | 'purpose' | 'diameter' | 'weight';

type ShowToast = (options: {
  title: string;
  body?: string;
  intent?: ToastIntent;
}) => void;

type UseCableTypesSectionParams = {
  projectId?: string;
  project: { id: string; projectNumber: string } | null;
  token: string | null;
  showToast: ShowToast;
  onMutate?: () => void;
};

type CableTypeDialogMode = 'create' | 'edit';

type CableTypeDialogController = {
  open: boolean;
  mode: CableTypeDialogMode;
  values: CableTypeFormState;
  errors: CableTypeFormErrors;
  submitting: boolean;
  handleFieldChange: (
    field: keyof CableTypeFormState
  ) => (
    event: ChangeEvent<HTMLInputElement>,
    data: { value: string }
  ) => void;
  handlePurposeSelect: (_event: unknown, data: { optionValue?: string }) => void;
  handleSubmit: (event: FormEvent<HTMLFormElement>) => Promise<void>;
  reset: () => void;
};

type UseCableTypesSectionResult = {
  cableTypes: CableType[];
  cableTypesLoading: boolean;
  cableTypesRefreshing: boolean;
  cableTypesError: string | null;
  cableTypesImporting: boolean;
  cableTypesExporting: boolean;
  cableTypesGettingTemplate: boolean;
  pendingCableTypeId: string | null;
  pagedCableTypes: CableType[];
  totalCableTypePages: number;
  cableTypePage: number;
  showCableTypePagination: boolean;
  fileInputRef: RefObject<HTMLInputElement | null>;
  searchText: string;
  searchCriteria: CableTypeSearchCriteria;
  setSearchText: (value: string) => void;
  setSearchCriteria: (value: CableTypeSearchCriteria) => void;
  reloadCableTypes: (options?: { showSpinner?: boolean }) => Promise<void>;
  goToPreviousPage: () => void;
  goToNextPage: () => void;
  openCreateCableTypeDialog: () => void;
  openEditCableTypeDialog: (cableType: CableType) => void;
  handleDeleteCableType: (cableType: CableType) => Promise<void>;
  handleImportCableTypes: (
    event: ChangeEvent<HTMLInputElement>
  ) => Promise<void>;
  handleExportCableTypes: () => Promise<void>;
  handleGetCableTypesTemplate: () => Promise<void>;
  cableTypeDialog: CableTypeDialogController;
};

const defaultProjectSnapshot = (project: { id: string; projectNumber: string } | null) =>
  project
    ? { id: project.id, projectNumber: project.projectNumber }
    : null;

export const useCableTypesSection = ({
  projectId,
  project,
  token,
  showToast,
  onMutate
}: UseCableTypesSectionParams): UseCableTypesSectionResult => {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const projectSnapshot = defaultProjectSnapshot(project);

  const [cableTypes, setCableTypes] = useState<CableType[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isRefreshing, setIsRefreshing] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [isImporting, setIsImporting] = useState<boolean>(false);
  const [isExporting, setIsExporting] = useState<boolean>(false);
  const [isGettingTemplate, setIsGettingTemplate] = useState<boolean>(false);
  const [pendingCableTypeId, setPendingCableTypeId] = useState<string | null>(
    null
  );
  const [page, setPage] = useState<number>(1);

  const [isDialogOpen, setDialogOpen] = useState<boolean>(false);
  const [dialogMode, setDialogMode] = useState<CableTypeDialogMode>('create');
  const [dialogValues, setDialogValues] =
    useState<CableTypeFormState>(emptyCableTypeForm);
  const [dialogErrors, setDialogErrors] =
    useState<CableTypeFormErrors>({});
  const [dialogSubmitting, setDialogSubmitting] =
    useState<boolean>(false);
  const [editingCableTypeId, setEditingCableTypeId] = useState<string | null>(
    null
  );

  const [searchText, setSearchText] = useState<string>('');
  const [searchCriteria, setSearchCriteria] = useState<CableTypeSearchCriteria>('all');

  const sortCableTypes = useCallback(
    (types: CableType[]) =>
      [...types].sort((a, b) =>
        a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })
      ),
    []
  );

  const filteredCableTypes = useMemo(() => {
    const normalizedFilter = searchText.trim().toLowerCase();
    if (!normalizedFilter) {
      return cableTypes;
    }
    return cableTypes.filter((cableType) => {
      if (searchCriteria === 'all') {
        const values = [
          cableType.name,
          cableType.purpose,
          cableType.diameterMm !== null ? String(cableType.diameterMm) : '',
          cableType.weightKgPerM !== null ? String(cableType.weightKgPerM) : ''
        ];
        return values.some((value) =>
          (value ?? '').toLowerCase().includes(normalizedFilter)
        );
      }
      
      // Filter by specific criteria
      let value = '';
      switch (searchCriteria) {
        case 'name':
          value = cableType.name ?? '';
          break;
        case 'purpose':
          value = cableType.purpose ?? '';
          break;
        case 'diameter':
          value = cableType.diameterMm !== null ? String(cableType.diameterMm) : '';
          break;
        case 'weight':
          value = cableType.weightKgPerM !== null ? String(cableType.weightKgPerM) : '';
          break;
      }
      return value.toLowerCase().includes(normalizedFilter);
    });
  }, [searchText, searchCriteria, cableTypes]);

  const totalPages = useMemo(() => {
    if (filteredCableTypes.length === 0) {
      return 1;
    }
    return Math.max(1, Math.ceil(filteredCableTypes.length / CABLE_TYPES_PER_PAGE));
  }, [filteredCableTypes.length]);

  const pagedCableTypes = useMemo(() => {
    if (filteredCableTypes.length === 0) {
      return [];
    }
    const startIndex = (page - 1) * CABLE_TYPES_PER_PAGE;
    return filteredCableTypes.slice(startIndex, startIndex + CABLE_TYPES_PER_PAGE);
  }, [filteredCableTypes, page]);

  useEffect(() => {
    const nextPage = Math.max(
      1,
      Math.ceil(filteredCableTypes.length / CABLE_TYPES_PER_PAGE)
    );
    if (page > nextPage) {
      setPage(nextPage);
    }
  }, [filteredCableTypes.length, page]);

  const reloadCableTypes = useCallback(
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
        const response = await fetchCableTypes(projectId);
        setCableTypes(sortCableTypes(response.cableTypes));
        setPage(1);
      } catch (err) {
        console.error('Failed to load cable types', err);
        if (err instanceof ApiError) {
          if (err.status === 404) {
            setCableTypes([]);
            setPage(1);
            setError(
              'Cable types endpoint is unavailable. Ensure the server is running the latest version.'
            );
          } else {
            setError(err.message);
          }
        } else {
          setError('Failed to load cable types.');
        }
      } finally {
        setIsLoading(false);
        setIsRefreshing(false);
      }
    },
    [projectId, sortCableTypes]
  );

  useEffect(() => {
    if (!projectId) {
      return;
    }
    void reloadCableTypes({ showSpinner: true });
  }, [projectId, reloadCableTypes]);

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

  const handleSearchCriteriaChange = useCallback((value: CableTypeSearchCriteria) => {
    setSearchCriteria(value);
    setPage(1);
  }, []);

  const handleFieldChange =
    (field: keyof CableTypeFormState) =>
    (_event: ChangeEvent<HTMLInputElement>, data: { value: string }) => {
      setDialogValues((previous: CableTypeFormState) => ({
        ...previous,
        [field]: data.value
      }));
    };

  const handlePurposeSelect = useCallback(
    (_event: unknown, data: { optionValue?: string }) => {
      setDialogValues((previous: CableTypeFormState) => ({
        ...previous,
        purpose: data.optionValue ?? ''
      }));
    },
    []
  );

  const resetDialog = useCallback(() => {
    setDialogOpen(false);
    setDialogErrors({});
    setDialogValues(emptyCableTypeForm);
    setDialogSubmitting(false);
    setEditingCableTypeId(null);
  }, []);

  const openCreateCableTypeDialog = useCallback(() => {
    setDialogMode('create');
    setDialogValues(emptyCableTypeForm);
    setDialogErrors({});
    setDialogOpen(true);
    setEditingCableTypeId(null);
  }, []);

  const openEditCableTypeDialog = useCallback((cableType: CableType) => {
    setDialogMode('edit');
    setDialogValues(toCableTypeFormState(cableType));
    setDialogErrors({});
    setDialogOpen(true);
    setEditingCableTypeId(cableType.id);
  }, []);

  const handleSubmit = useCallback(
    async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();

      if (!projectSnapshot || !token) {
        setDialogErrors({
          general: 'You need to be signed in as an admin to manage cable types.'
        });
        return;
      }

      const { input, errors } = buildCableTypeInput(dialogValues);

      if (Object.keys(errors).length > 0) {
        setDialogErrors(errors);
        return;
      }

      setDialogSubmitting(true);
      setDialogErrors({});

      try {
        if (dialogMode === 'create') {
          const response = await createCableType(
            token,
            projectSnapshot.id,
            input
          );
          setCableTypes((previous: CableType[]) =>
            sortCableTypes([...previous, response.cableType])
          );
          setPage(1);
          showToast({ intent: 'success', title: 'Cable type created' });
        } else if (editingCableTypeId) {
          const response = await updateCableType(
            token,
            projectSnapshot.id,
            editingCableTypeId,
            input
          );
        setCableTypes((previous: CableType[]) =>
          sortCableTypes(
            previous.map((item) =>
              item.id === editingCableTypeId ? response.cableType : item
            )
          )
          );
          showToast({ intent: 'success', title: 'Cable type updated' });
        }
        void onMutate?.();
        resetDialog();
      } catch (err) {
        console.error('Save cable type failed', err);
        if (err instanceof ApiError) {
          setDialogErrors(parseCableTypeApiErrors(err.payload));
          showToast({
            intent: 'error',
            title: 'Failed to save cable type',
            body: err.message
          });
        } else {
          const message = 'Failed to save cable type. Please try again.';
          setDialogErrors({
            general: message
          });
          showToast({
            intent: 'error',
            title: 'Failed to save cable type',
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
      editingCableTypeId,
      onMutate,
      projectSnapshot,
      resetDialog,
      showToast,
      sortCableTypes,
      token
    ]
  );

  const handleDeleteCableType = useCallback(
    async (cableType: CableType) => {
      if (!projectSnapshot || !token) {
        showToast({
          intent: 'error',
          title: 'Admin access required',
          body: 'You need to be signed in as an admin to delete cable types.'
        });
        return;
      }

      const confirmed = window.confirm(
        `Delete cable type "${cableType.name}"? This action cannot be undone.`
      );

      if (!confirmed) {
        return;
      }

      setPendingCableTypeId(cableType.id);

      try {
        await deleteCableType(token, projectSnapshot.id, cableType.id);
        setCableTypes((previous: CableType[]) => {
          const next = previous.filter((item) => item.id !== cableType.id);
          const nextPages = Math.max(
            1,
            Math.ceil(next.length / CABLE_TYPES_PER_PAGE)
          );
          if (page > nextPages) {
            setPage(nextPages);
          }
          return next;
        });
        showToast({ intent: 'success', title: 'Cable type deleted' });
        void onMutate?.();
      } catch (err) {
        console.error('Delete cable type failed', err);
        showToast({
          intent: 'error',
          title: 'Failed to delete cable type',
          body: err instanceof ApiError ? err.message : undefined
        });
      } finally {
        setPendingCableTypeId(null);
      }
    },
    [onMutate, page, projectSnapshot, showToast, token]
  );

  const handleImportCableTypes = useCallback(
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
          body: 'You need to be signed in as an admin to import cable types.'
        });
        return;
      }

      setIsImporting(true);

      try {
        const response = await importCableTypes(
          token,
          projectSnapshot.id,
          file
        );
        setCableTypes(sortCableTypes(response.cableTypes));
        setPage(1);
        void onMutate?.();

        const summary: CableImportSummary = response.summary;
        showToast({
          intent: 'success',
          title: 'Cable types imported',
          body: `${summary.inserted} added, ${summary.updated} updated, ${summary.skipped} skipped.`
        });
      } catch (err) {
        console.error('Import cable types failed', err);
        if (err instanceof ApiError && err.status === 404) {
          showToast({
            intent: 'error',
            title: 'Import endpoint unavailable',
            body: 'Please restart the API server after updating it.'
          });
        } else {
          showToast({
            intent: 'error',
            title: 'Failed to import cable types',
            body: err instanceof ApiError ? err.message : undefined
          });
        }
      } finally {
        setIsImporting(false);
      }
    },
    [onMutate, projectSnapshot, showToast, sortCableTypes, token]
  );

  const handleExportCableTypes = useCallback(async () => {
    if (!projectSnapshot || !token) {
      showToast({
        intent: 'error',
        title: 'Admin access required',
        body: 'You need to be signed in as an admin to export cable types.'
      });
      return;
    }

    setIsExporting(true);

    try {
      const blob = await exportCableTypes(token, projectSnapshot.id);
      const link = document.createElement('a');
      const url = window.URL.createObjectURL(blob);
      const fileName = `${sanitizeFileSegment(
        projectSnapshot.projectNumber
      )}-cables.xlsx`;

      link.href = url;
      link.download = fileName;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);

      showToast({ intent: 'success', title: 'Cable types exported' });
    } catch (err) {
      console.error('Export cable types failed', err);
      if (err instanceof ApiError && err.status === 404) {
        showToast({
          intent: 'error',
          title: 'Export endpoint unavailable',
          body: 'Please restart the API server after updating it.'
        });
      } else {
        showToast({
          intent: 'error',
          title: 'Failed to export cable types',
          body: err instanceof ApiError ? err.message : undefined
        });
      }
    } finally {
      setIsExporting(false);
    }
  }, [projectSnapshot, showToast, token]);

  const handleGetCableTypesTemplate = useCallback(async () => {
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
      const blob = await getCableTypesTemplate(token, projectSnapshot.id);
      const link = document.createElement('a');
      const url = window.URL.createObjectURL(blob);
      const fileName = 'cable-types-template.xlsx';

      link.href = url;
      link.download = fileName;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);

      showToast({ intent: 'success', title: 'Template downloaded' });
    } catch (err) {
      console.error('Get cable types template failed', err);
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
    cableTypes,
    cableTypesLoading: isLoading,
    cableTypesRefreshing: isRefreshing,
    cableTypesError: error,
    cableTypesImporting: isImporting,
    cableTypesExporting: isExporting,
    cableTypesGettingTemplate: isGettingTemplate,
    pendingCableTypeId,
    pagedCableTypes,
    totalCableTypePages: totalPages,
    cableTypePage: page,
    showCableTypePagination: filteredCableTypes.length > CABLE_TYPES_PER_PAGE,
    fileInputRef,
    searchText,
    searchCriteria,
    setSearchText: handleSearchTextChange,
    setSearchCriteria: handleSearchCriteriaChange,
    reloadCableTypes,
    goToPreviousPage,
    goToNextPage,
    openCreateCableTypeDialog,
    openEditCableTypeDialog,
    handleDeleteCableType,
    handleImportCableTypes,
    handleExportCableTypes,
    handleGetCableTypesTemplate,
    cableTypeDialog: {
      open: isDialogOpen,
      mode: dialogMode,
      values: dialogValues,
      errors: dialogErrors,
      submitting: dialogSubmitting,
      handleFieldChange: handleFieldChange,
      handlePurposeSelect,
      handleSubmit,
      reset: resetDialog
    }
  };
};
