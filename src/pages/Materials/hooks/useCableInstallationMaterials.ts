import type { ChangeEvent, FormEvent, RefObject } from 'react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ToastIntent } from '@fluentui/react-components';
import {
  ApiError,
  MaterialCableInstallationMaterial,
  createMaterialCableInstallationMaterial,
  deleteMaterialCableInstallationMaterial,
  exportMaterialCableInstallationMaterials,
  fetchMaterialCableInstallationMaterials,
  getMaterialCableInstallationMaterialsTemplate,
  importMaterialCableInstallationMaterials,
  updateMaterialCableInstallationMaterial,
} from '@/api/client';
import { CABLE_TYPES_PER_PAGE } from '../../ProjectDetails.forms';
import {
  buildMaterialCableInstallationMaterialInput,
  emptyCableInstallationMaterialForm,
  parseCableInstallationMaterialApiErrors,
  toCableInstallationMaterialFormState,
  type CableInstallationMaterialFormErrors,
  type CableInstallationMaterialFormState,
  type CableInstallationMaterialSearchCriteria,
} from '../CableInstallationMaterials.forms';
import { buildTimestampedFileName, downloadBlob } from '../Materials.utils';

type ShowToast = (options: { title: string; body?: string; intent?: ToastIntent }) => void;

type CableInstallationMaterialDialogMode = 'create' | 'edit';

type CableInstallationMaterialDialogController = {
  open: boolean;
  mode: CableInstallationMaterialDialogMode;
  values: CableInstallationMaterialFormState;
  errors: CableInstallationMaterialFormErrors;
  submitting: boolean;
  handleFieldChange: (
    field: keyof CableInstallationMaterialFormState,
  ) => (event: ChangeEvent<HTMLInputElement>, data: { value: string }) => void;
  handlePurposeSelect: (_event: unknown, data: { optionValue?: string }) => void;
  handleSubmit: (event: FormEvent<HTMLFormElement>) => Promise<void>;
  reset: () => void;
};

type UseCableInstallationMaterialsParams = {
  token: string | null;
  isAdmin: boolean;
  showToast: ShowToast;
};

type UseCableInstallationMaterialsResult = {
  cableInstallationMaterials: MaterialCableInstallationMaterial[];
  cableInstallationMaterialsLoading: boolean;
  cableInstallationMaterialsRefreshing: boolean;
  cableInstallationMaterialsError: string | null;
  cableInstallationMaterialsImporting: boolean;
  cableInstallationMaterialsExporting: boolean;
  cableInstallationMaterialsGettingTemplate: boolean;
  pendingCableInstallationMaterialId: string | null;
  pagedCableInstallationMaterials: MaterialCableInstallationMaterial[];
  totalCableInstallationMaterialPages: number;
  cableInstallationMaterialPage: number;
  showCableInstallationMaterialPagination: boolean;
  fileInputRef: RefObject<HTMLInputElement | null>;
  searchText: string;
  searchCriteria: CableInstallationMaterialSearchCriteria;
  setSearchText: (value: string) => void;
  setSearchCriteria: (value: CableInstallationMaterialSearchCriteria) => void;
  reloadCableInstallationMaterials: (options?: { showSpinner?: boolean }) => Promise<void>;
  goToPreviousPage: () => void;
  goToNextPage: () => void;
  goToPage: (page: number) => void;
  openCreateCableInstallationMaterialDialog: () => void;
  openEditCableInstallationMaterialDialog: (item: MaterialCableInstallationMaterial) => void;
  handleDeleteCableInstallationMaterial: (item: MaterialCableInstallationMaterial) => Promise<void>;
  handleImportCableInstallationMaterials: (event: ChangeEvent<HTMLInputElement>) => Promise<void>;
  handleExportCableInstallationMaterials: () => Promise<void>;
  handleGetCableInstallationMaterialsTemplate: () => Promise<void>;
  cableInstallationMaterialDialog: CableInstallationMaterialDialogController;
};

export const useCableInstallationMaterials = ({
  token,
  isAdmin,
  showToast,
}: UseCableInstallationMaterialsParams): UseCableInstallationMaterialsResult => {
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const [cableInstallationMaterials, setCableInstallationMaterials] = useState<
    MaterialCableInstallationMaterial[]
  >([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isRefreshing, setIsRefreshing] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [isImporting, setIsImporting] = useState<boolean>(false);
  const [isExporting, setIsExporting] = useState<boolean>(false);
  const [isGettingTemplate, setIsGettingTemplate] = useState<boolean>(false);
  const [pendingCableInstallationMaterialId, setPendingCableInstallationMaterialId] = useState<
    string | null
  >(null);
  const [page, setPage] = useState<number>(1);

  const [isDialogOpen, setDialogOpen] = useState<boolean>(false);
  const [dialogMode, setDialogMode] = useState<CableInstallationMaterialDialogMode>('create');
  const [dialogValues, setDialogValues] = useState<CableInstallationMaterialFormState>(
    emptyCableInstallationMaterialForm,
  );
  const [dialogErrors, setDialogErrors] = useState<CableInstallationMaterialFormErrors>({});
  const [dialogSubmitting, setDialogSubmitting] = useState<boolean>(false);
  const [editingCableInstallationMaterialId, setEditingCableInstallationMaterialId] = useState<
    string | null
  >(null);

  const [searchText, setSearchText] = useState<string>('');
  const [searchCriteria, setSearchCriteria] =
    useState<CableInstallationMaterialSearchCriteria>('all');

  const sortCableInstallationMaterials = useCallback(
    (items: MaterialCableInstallationMaterial[]) =>
      [...items].sort((a, b) => a.type.localeCompare(b.type, undefined, { sensitivity: 'base' })),
    [],
  );

  const filteredCableInstallationMaterials = useMemo(() => {
    const normalizedFilter = searchText.trim().toLowerCase();
    if (!normalizedFilter) {
      return cableInstallationMaterials;
    }

    return cableInstallationMaterials.filter((item) => {
      if (searchCriteria === 'all') {
        const values = [
          item.type,
          item.purpose,
          item.material,
          item.description,
          item.manufacturer,
          item.partNo,
        ];
        return values.some((value) => (value ?? '').toLowerCase().includes(normalizedFilter));
      }

      let value = '';
      switch (searchCriteria) {
        case 'type':
          value = item.type;
          break;
        case 'purpose':
          value = item.purpose ?? '';
          break;
        case 'material':
          value = item.material ?? '';
          break;
        case 'description':
          value = item.description ?? '';
          break;
        case 'manufacturer':
          value = item.manufacturer ?? '';
          break;
        case 'partNo':
          value = item.partNo ?? '';
          break;
      }

      return value.toLowerCase().includes(normalizedFilter);
    });
  }, [cableInstallationMaterials, searchCriteria, searchText]);

  const totalPages = useMemo(() => {
    if (filteredCableInstallationMaterials.length === 0) {
      return 1;
    }
    return Math.max(1, Math.ceil(filteredCableInstallationMaterials.length / CABLE_TYPES_PER_PAGE));
  }, [filteredCableInstallationMaterials.length]);

  const pagedCableInstallationMaterials = useMemo(() => {
    if (filteredCableInstallationMaterials.length === 0) {
      return [];
    }
    const startIndex = (page - 1) * CABLE_TYPES_PER_PAGE;
    return filteredCableInstallationMaterials.slice(startIndex, startIndex + CABLE_TYPES_PER_PAGE);
  }, [filteredCableInstallationMaterials, page]);

  useEffect(() => {
    const nextPage = Math.max(
      1,
      Math.ceil(filteredCableInstallationMaterials.length / CABLE_TYPES_PER_PAGE),
    );
    if (page > nextPage) {
      setPage(nextPage);
    }
  }, [filteredCableInstallationMaterials.length, page]);

  const reloadCableInstallationMaterials = useCallback(
    async ({ showSpinner = true }: { showSpinner?: boolean } = {}) => {
      if (showSpinner) {
        setIsLoading(true);
      } else {
        setIsRefreshing(true);
      }

      setError(null);

      try {
        const response = await fetchMaterialCableInstallationMaterials();
        setCableInstallationMaterials(
          sortCableInstallationMaterials(response.cableInstallationMaterials),
        );
        setPage(1);
      } catch (err) {
        console.error('Failed to load material cable installation materials', err);
        if (err instanceof ApiError) {
          if (err.status === 404) {
            setCableInstallationMaterials([]);
            setPage(1);
            setError(
              'Cable installation materials endpoint is unavailable. Ensure the server is running the latest version.',
            );
          } else {
            setError(err.message);
          }
        } else {
          setError('Failed to load cable installation materials.');
        }
      } finally {
        setIsLoading(false);
        setIsRefreshing(false);
      }
    },
    [sortCableInstallationMaterials],
  );

  useEffect(() => {
    void reloadCableInstallationMaterials({ showSpinner: true });
  }, [reloadCableInstallationMaterials]);

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

  const handleSearchCriteriaChange = useCallback(
    (value: CableInstallationMaterialSearchCriteria) => {
      setSearchCriteria(value);
      setPage(1);
    },
    [],
  );

  const handleFieldChange =
    (field: keyof CableInstallationMaterialFormState) =>
    (_event: ChangeEvent<HTMLInputElement>, data: { value: string }) => {
      setDialogValues((previous) => ({
        ...previous,
        [field]: data.value,
      }));
    };

  const handlePurposeSelect = useCallback((_event: unknown, data: { optionValue?: string }) => {
    setDialogValues((previous) => ({
      ...previous,
      purpose: data.optionValue ?? '',
    }));
  }, []);

  const resetDialog = useCallback(() => {
    setDialogOpen(false);
    setDialogErrors({});
    setDialogValues(emptyCableInstallationMaterialForm);
    setDialogSubmitting(false);
    setEditingCableInstallationMaterialId(null);
  }, []);

  const openCreateCableInstallationMaterialDialog = useCallback(() => {
    setDialogMode('create');
    setDialogValues(emptyCableInstallationMaterialForm);
    setDialogErrors({});
    setDialogOpen(true);
    setEditingCableInstallationMaterialId(null);
  }, []);

  const openEditCableInstallationMaterialDialog = useCallback(
    (item: MaterialCableInstallationMaterial) => {
      setDialogMode('edit');
      setDialogValues(toCableInstallationMaterialFormState(item));
      setDialogErrors({});
      setDialogOpen(true);
      setEditingCableInstallationMaterialId(item.id);
    },
    [],
  );

  const handleSubmit = useCallback(
    async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();

      if (!isAdmin || !token) {
        setDialogErrors({
          general: 'You need to be signed in as an admin to manage cable installation materials.',
        });
        return;
      }

      const { input, errors } = buildMaterialCableInstallationMaterialInput(dialogValues);

      if (Object.keys(errors).length > 0) {
        setDialogErrors(errors);
        return;
      }

      setDialogSubmitting(true);
      setDialogErrors({});

      try {
        if (dialogMode === 'create') {
          const response = await createMaterialCableInstallationMaterial(token, input);
          setCableInstallationMaterials((previous) =>
            sortCableInstallationMaterials([...previous, response.cableInstallationMaterial]),
          );
          setPage(1);
          showToast({ intent: 'success', title: 'Cable installation material created' });
        } else if (editingCableInstallationMaterialId) {
          const response = await updateMaterialCableInstallationMaterial(
            token,
            editingCableInstallationMaterialId,
            input,
          );
          setCableInstallationMaterials((previous) =>
            sortCableInstallationMaterials(
              previous.map((item) =>
                item.id === editingCableInstallationMaterialId
                  ? response.cableInstallationMaterial
                  : item,
              ),
            ),
          );
          showToast({ intent: 'success', title: 'Cable installation material updated' });
        }
        resetDialog();
      } catch (err) {
        console.error('Save material cable installation material failed', err);
        if (err instanceof ApiError) {
          setDialogErrors(parseCableInstallationMaterialApiErrors(err.payload));
          showToast({
            intent: 'error',
            title: 'Failed to save cable installation material',
            body: err.message,
          });
        } else {
          const message = 'Failed to save cable installation material. Please try again.';
          setDialogErrors({
            general: message,
          });
          showToast({
            intent: 'error',
            title: 'Failed to save cable installation material',
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
      editingCableInstallationMaterialId,
      isAdmin,
      resetDialog,
      showToast,
      sortCableInstallationMaterials,
      token,
    ],
  );

  const handleDeleteCableInstallationMaterial = useCallback(
    async (item: MaterialCableInstallationMaterial) => {
      if (!isAdmin || !token) {
        showToast({
          intent: 'error',
          title: 'Admin access required',
          body: 'You need to be signed in as an admin to delete cable installation materials.',
        });
        return;
      }

      const confirmed = window.confirm(
        `Delete cable installation material "${item.type}"? This action cannot be undone.`,
      );

      if (!confirmed) {
        return;
      }

      setPendingCableInstallationMaterialId(item.id);

      try {
        await deleteMaterialCableInstallationMaterial(token, item.id);
        setCableInstallationMaterials((previous) => {
          const next = previous.filter((existingItem) => existingItem.id !== item.id);
          const nextPages = Math.max(1, Math.ceil(next.length / CABLE_TYPES_PER_PAGE));
          if (page > nextPages) {
            setPage(nextPages);
          }
          return next;
        });
        showToast({ intent: 'success', title: 'Cable installation material deleted' });
      } catch (err) {
        console.error('Delete material cable installation material failed', err);
        showToast({
          intent: 'error',
          title: 'Failed to delete cable installation material',
          body: err instanceof ApiError ? err.message : undefined,
        });
      } finally {
        setPendingCableInstallationMaterialId(null);
      }
    },
    [isAdmin, page, showToast, token],
  );

  const handleImportCableInstallationMaterials = useCallback(
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
          body: 'You need to be signed in as an admin to import cable installation materials.',
        });
        return;
      }

      setIsImporting(true);

      try {
        const response = await importMaterialCableInstallationMaterials(token, file);
        setCableInstallationMaterials(
          sortCableInstallationMaterials(response.cableInstallationMaterials),
        );
        setPage(1);

        showToast({
          intent: 'success',
          title: 'Cable installation materials imported',
          body: `${response.summary.inserted} added, ${response.summary.updated} updated, ${response.summary.skipped} skipped.`,
        });
      } catch (err) {
        console.error('Import material cable installation materials failed', err);
        if (err instanceof ApiError && err.status === 404) {
          showToast({
            intent: 'error',
            title: 'Import endpoint unavailable',
            body: 'Please restart the API server after updating it.',
          });
        } else {
          showToast({
            intent: 'error',
            title: 'Failed to import cable installation materials',
            body: err instanceof ApiError ? err.message : undefined,
          });
        }
      } finally {
        setIsImporting(false);
      }
    },
    [isAdmin, showToast, sortCableInstallationMaterials, token],
  );

  const handleExportCableInstallationMaterials = useCallback(async () => {
    if (!isAdmin || !token) {
      showToast({
        intent: 'error',
        title: 'Admin access required',
        body: 'You need to be signed in as an admin to export cable installation materials.',
      });
      return;
    }

    setIsExporting(true);

    try {
      const blob = await exportMaterialCableInstallationMaterials(token);
      downloadBlob(blob, buildTimestampedFileName('materials-cable-installation-materials'));
      showToast({ intent: 'success', title: 'Cable installation materials exported' });
    } catch (err) {
      console.error('Export material cable installation materials failed', err);
      if (err instanceof ApiError && err.status === 404) {
        showToast({
          intent: 'error',
          title: 'Export endpoint unavailable',
          body: 'Please restart the API server after updating it.',
        });
      } else {
        showToast({
          intent: 'error',
          title: 'Failed to export cable installation materials',
          body: err instanceof ApiError ? err.message : undefined,
        });
      }
    } finally {
      setIsExporting(false);
    }
  }, [isAdmin, showToast, token]);

  const handleGetCableInstallationMaterialsTemplate = useCallback(async () => {
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
      const blob = await getMaterialCableInstallationMaterialsTemplate(token);
      downloadBlob(
        blob,
        buildTimestampedFileName('materials-cable-installation-materials-template'),
      );
      showToast({ intent: 'success', title: 'Template downloaded' });
    } catch (err) {
      console.error('Get material cable installation materials template failed', err);
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
    cableInstallationMaterials,
    cableInstallationMaterialsLoading: isLoading,
    cableInstallationMaterialsRefreshing: isRefreshing,
    cableInstallationMaterialsError: error,
    cableInstallationMaterialsImporting: isImporting,
    cableInstallationMaterialsExporting: isExporting,
    cableInstallationMaterialsGettingTemplate: isGettingTemplate,
    pendingCableInstallationMaterialId,
    pagedCableInstallationMaterials,
    totalCableInstallationMaterialPages: totalPages,
    cableInstallationMaterialPage: page,
    showCableInstallationMaterialPagination:
      filteredCableInstallationMaterials.length > CABLE_TYPES_PER_PAGE,
    fileInputRef,
    searchText,
    searchCriteria,
    setSearchText: handleSearchTextChange,
    setSearchCriteria: handleSearchCriteriaChange,
    reloadCableInstallationMaterials,
    goToPreviousPage,
    goToNextPage,
    goToPage,
    openCreateCableInstallationMaterialDialog,
    openEditCableInstallationMaterialDialog,
    handleDeleteCableInstallationMaterial,
    handleImportCableInstallationMaterials,
    handleExportCableInstallationMaterials,
    handleGetCableInstallationMaterialsTemplate,
    cableInstallationMaterialDialog: {
      open: isDialogOpen,
      mode: dialogMode,
      values: dialogValues,
      errors: dialogErrors,
      submitting: dialogSubmitting,
      handleFieldChange,
      handlePurposeSelect,
      handleSubmit,
      reset: resetDialog,
    },
  };
};
