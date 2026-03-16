import type { ChangeEvent, FormEvent, RefObject } from 'react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ToastIntent } from '@fluentui/react-components';
import {
  ApiError,
  MaterialCableType,
  createMaterialCableType,
  deleteMaterialCableType,
  exportMaterialCableTypes,
  fetchMaterialCableTypes,
  getMaterialCableTypesTemplate,
  importMaterialCableTypes,
  updateMaterialCableType,
} from '@/api/client';
import {
  CABLE_TYPES_PER_PAGE,
  CableTypeFormErrors,
  CableTypeFormState,
  buildMaterialCableTypeInput,
  emptyCableTypeForm,
  parseCableTypeApiErrors,
} from '../../ProjectDetails.forms';
import type { CableTypeSearchCriteria } from '../../ProjectDetails/hooks/useCableTypesSection';
import { buildTimestampedFileName, downloadBlob } from '../Materials.utils';

type ShowToast = (options: { title: string; body?: string; intent?: ToastIntent }) => void;

type CableTypeDialogMode = 'create' | 'edit';

type CableTypeDialogController = {
  open: boolean;
  mode: CableTypeDialogMode;
  values: CableTypeFormState;
  errors: CableTypeFormErrors;
  submitting: boolean;
  handleFieldChange: (
    field: keyof CableTypeFormState,
  ) => (event: ChangeEvent<HTMLInputElement>, data: { value: string }) => void;
  handlePurposeSelect: (_event: unknown, data: { optionValue?: string }) => void;
  handleSubmit: (event: FormEvent<HTMLFormElement>) => Promise<void>;
  reset: () => void;
};

type UseCableTypesParams = {
  token: string | null;
  isAdmin: boolean;
  showToast: ShowToast;
};

type UseCableTypesResult = {
  cableTypes: MaterialCableType[];
  cableTypesLoading: boolean;
  cableTypesRefreshing: boolean;
  cableTypesError: string | null;
  cableTypesImporting: boolean;
  cableTypesExporting: boolean;
  cableTypesGettingTemplate: boolean;
  pendingCableTypeId: string | null;
  pagedCableTypes: MaterialCableType[];
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
  goToPage: (page: number) => void;
  openCreateCableTypeDialog: () => void;
  openEditCableTypeDialog: (cableType: MaterialCableType) => void;
  handleDeleteCableType: (cableType: MaterialCableType) => Promise<void>;
  handleImportCableTypes: (event: ChangeEvent<HTMLInputElement>) => Promise<void>;
  handleExportCableTypes: () => Promise<void>;
  handleGetCableTypesTemplate: () => Promise<void>;
  cableTypeDialog: CableTypeDialogController;
};

const toCableTypeFormState = (cableType: MaterialCableType): CableTypeFormState => ({
  name: cableType.name,
  purpose: cableType.purpose ?? '',
  material: cableType.material ?? '',
  description: cableType.description ?? '',
  manufacturer: cableType.manufacturer ?? '',
  partNo: cableType.partNo ?? '',
  remarks: cableType.remarks ?? '',
  diameterMm: cableType.diameterMm !== null ? String(cableType.diameterMm) : '',
  weightKgPerM: cableType.weightKgPerM !== null ? String(cableType.weightKgPerM) : '',
});

export const useCableTypes = ({
  token,
  isAdmin,
  showToast,
}: UseCableTypesParams): UseCableTypesResult => {
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const [cableTypes, setCableTypes] = useState<MaterialCableType[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isRefreshing, setIsRefreshing] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [isImporting, setIsImporting] = useState<boolean>(false);
  const [isExporting, setIsExporting] = useState<boolean>(false);
  const [isGettingTemplate, setIsGettingTemplate] = useState<boolean>(false);
  const [pendingCableTypeId, setPendingCableTypeId] = useState<string | null>(null);
  const [page, setPage] = useState<number>(1);

  const [isDialogOpen, setDialogOpen] = useState<boolean>(false);
  const [dialogMode, setDialogMode] = useState<CableTypeDialogMode>('create');
  const [dialogValues, setDialogValues] = useState<CableTypeFormState>(emptyCableTypeForm);
  const [dialogErrors, setDialogErrors] = useState<CableTypeFormErrors>({});
  const [dialogSubmitting, setDialogSubmitting] = useState<boolean>(false);
  const [editingCableTypeId, setEditingCableTypeId] = useState<string | null>(null);

  const [searchText, setSearchText] = useState<string>('');
  const [searchCriteria, setSearchCriteria] = useState<CableTypeSearchCriteria>('all');

  const sortCableTypes = useCallback(
    (types: MaterialCableType[]) =>
      [...types].sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })),
    [],
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
          cableType.weightKgPerM !== null ? String(cableType.weightKgPerM) : '',
        ];
        return values.some((value) => (value ?? '').toLowerCase().includes(normalizedFilter));
      }

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
    const nextPage = Math.max(1, Math.ceil(filteredCableTypes.length / CABLE_TYPES_PER_PAGE));
    if (page > nextPage) {
      setPage(nextPage);
    }
  }, [filteredCableTypes.length, page]);

  const reloadCableTypes = useCallback(
    async ({ showSpinner = true }: { showSpinner?: boolean } = {}) => {
      if (showSpinner) {
        setIsLoading(true);
      } else {
        setIsRefreshing(true);
      }

      setError(null);

      try {
        const response = await fetchMaterialCableTypes();
        setCableTypes(sortCableTypes(response.cableTypes));
        setPage(1);
      } catch (err) {
        console.error('Failed to load material cable types', err);
        if (err instanceof ApiError) {
          if (err.status === 404) {
            setCableTypes([]);
            setPage(1);
            setError(
              'Cable types endpoint is unavailable. Ensure the server is running the latest version.',
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
    [sortCableTypes],
  );

  useEffect(() => {
    void reloadCableTypes({ showSpinner: true });
  }, [reloadCableTypes]);

  const goToPreviousPage = useCallback(() => {
    setPage((previous) => Math.max(1, previous - 1));
  }, []);

  const goToNextPage = useCallback(() => {
    setPage((previous) => Math.min(totalPages, previous + 1));
  }, [totalPages]);

  const goToPage = useCallback(
    (nextPage: number) => {
      setPage(() => Math.min(Math.max(1, nextPage), totalPages));
    },
    [totalPages],
  );

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
        [field]: data.value,
      }));
    };

  const handlePurposeSelect = useCallback((_event: unknown, data: { optionValue?: string }) => {
    setDialogValues((previous: CableTypeFormState) => ({
      ...previous,
      purpose: data.optionValue ?? '',
    }));
  }, []);

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

  const openEditCableTypeDialog = useCallback((cableType: MaterialCableType) => {
    setDialogMode('edit');
    setDialogValues(toCableTypeFormState(cableType));
    setDialogErrors({});
    setDialogOpen(true);
    setEditingCableTypeId(cableType.id);
  }, []);

  const handleSubmit = useCallback(
    async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();

      if (!isAdmin || !token) {
        setDialogErrors({
          general: 'You need to be signed in as an admin to manage cable types.',
        });
        return;
      }

      const { input, errors } = buildMaterialCableTypeInput(dialogValues);

      if (Object.keys(errors).length > 0) {
        setDialogErrors(errors);
        return;
      }

      setDialogSubmitting(true);
      setDialogErrors({});

      try {
        if (dialogMode === 'create') {
          const response = await createMaterialCableType(token, input);
          setCableTypes((previous: MaterialCableType[]) =>
            sortCableTypes([...previous, response.cableType]),
          );
          setPage(1);
          showToast({ intent: 'success', title: 'Cable type created' });
        } else if (editingCableTypeId) {
          const response = await updateMaterialCableType(token, editingCableTypeId, input);
          setCableTypes((previous: MaterialCableType[]) =>
            sortCableTypes(
              previous.map((item) => (item.id === editingCableTypeId ? response.cableType : item)),
            ),
          );
          showToast({ intent: 'success', title: 'Cable type updated' });
        }
        resetDialog();
      } catch (err) {
        console.error('Save material cable type failed', err);
        if (err instanceof ApiError) {
          setDialogErrors(parseCableTypeApiErrors(err.payload));
          showToast({
            intent: 'error',
            title: 'Failed to save cable type',
            body: err.message,
          });
        } else {
          const message = 'Failed to save cable type. Please try again.';
          setDialogErrors({
            general: message,
          });
          showToast({
            intent: 'error',
            title: 'Failed to save cable type',
            body: message,
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
      isAdmin,
      resetDialog,
      showToast,
      sortCableTypes,
      token,
    ],
  );

  const handleDeleteCableType = useCallback(
    async (cableType: MaterialCableType) => {
      if (!isAdmin || !token) {
        showToast({
          intent: 'error',
          title: 'Admin access required',
          body: 'You need to be signed in as an admin to delete cable types.',
        });
        return;
      }

      const confirmed = window.confirm(
        `Delete cable type "${cableType.name}"? This action cannot be undone.`,
      );

      if (!confirmed) {
        return;
      }

      setPendingCableTypeId(cableType.id);

      try {
        await deleteMaterialCableType(token, cableType.id);
        setCableTypes((previous: MaterialCableType[]) => {
          const next = previous.filter((item) => item.id !== cableType.id);
          const nextPages = Math.max(1, Math.ceil(next.length / CABLE_TYPES_PER_PAGE));
          if (page > nextPages) {
            setPage(nextPages);
          }
          return next;
        });
        showToast({ intent: 'success', title: 'Cable type deleted' });
      } catch (err) {
        console.error('Delete material cable type failed', err);
        showToast({
          intent: 'error',
          title: 'Failed to delete cable type',
          body: err instanceof ApiError ? err.message : undefined,
        });
      } finally {
        setPendingCableTypeId(null);
      }
    },
    [isAdmin, page, showToast, token],
  );

  const handleImportCableTypes = useCallback(
    async (event: ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];

      if (!file) {
        return;
      }

      event.target.value = '';

      if (!isAdmin || !token) {
        showToast({
          intent: 'error',
          title: 'Admin access required',
          body: 'You need to be signed in as an admin to import cable types.',
        });
        return;
      }

      setIsImporting(true);

      try {
        const response = await importMaterialCableTypes(token, file);
        setCableTypes(sortCableTypes(response.cableTypes));
        setPage(1);

        showToast({
          intent: 'success',
          title: 'Cable types imported',
          body: `${response.summary.inserted} added, ${response.summary.updated} updated, ${response.summary.skipped} skipped.`,
        });
      } catch (err) {
        console.error('Import material cable types failed', err);
        if (err instanceof ApiError && err.status === 404) {
          showToast({
            intent: 'error',
            title: 'Import endpoint unavailable',
            body: 'Please restart the API server after updating it.',
          });
        } else {
          showToast({
            intent: 'error',
            title: 'Failed to import cable types',
            body: err instanceof ApiError ? err.message : undefined,
          });
        }
      } finally {
        setIsImporting(false);
      }
    },
    [isAdmin, showToast, sortCableTypes, token],
  );

  const handleExportCableTypes = useCallback(async () => {
    if (!isAdmin || !token) {
      showToast({
        intent: 'error',
        title: 'Admin access required',
        body: 'You need to be signed in as an admin to export cable types.',
      });
      return;
    }

    setIsExporting(true);

    try {
      const blob = await exportMaterialCableTypes(token);
      downloadBlob(blob, buildTimestampedFileName('materials-cable-types'));
      showToast({ intent: 'success', title: 'Cable types exported' });
    } catch (err) {
      console.error('Export material cable types failed', err);
      if (err instanceof ApiError && err.status === 404) {
        showToast({
          intent: 'error',
          title: 'Export endpoint unavailable',
          body: 'Please restart the API server after updating it.',
        });
      } else {
        showToast({
          intent: 'error',
          title: 'Failed to export cable types',
          body: err instanceof ApiError ? err.message : undefined,
        });
      }
    } finally {
      setIsExporting(false);
    }
  }, [isAdmin, showToast, token]);

  const handleGetCableTypesTemplate = useCallback(async () => {
    if (!isAdmin || !token) {
      showToast({
        intent: 'error',
        title: 'Admin access required',
        body: 'You need to be signed in as an admin to get the template.',
      });
      return;
    }

    setIsGettingTemplate(true);

    try {
      const blob = await getMaterialCableTypesTemplate(token);
      downloadBlob(blob, buildTimestampedFileName('materials-cable-types-template'));
      showToast({ intent: 'success', title: 'Template downloaded' });
    } catch (err) {
      console.error('Get material cable types template failed', err);
      showToast({
        intent: 'error',
        title: 'Failed to get template',
        body: err instanceof ApiError ? err.message : undefined,
      });
    } finally {
      setIsGettingTemplate(false);
    }
  }, [isAdmin, showToast, token]);

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
    goToPage,
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
      reset: resetDialog,
    },
  };
};
