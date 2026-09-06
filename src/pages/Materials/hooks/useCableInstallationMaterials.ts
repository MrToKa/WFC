import type { ChangeEvent, FormEvent, RefObject } from 'react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ToastIntent } from '@fluentui/react-components';
import {
  ApiError,
  MaterialCableInstallationMaterial,
  type MaterialCableInstallationMaterialInput,
  createMaterialCableInstallationMaterial,
  createMaterialTrayInstallationMaterial,
  createMaterialInstrument,
  createMaterialInstrumentInstallationMaterial,
  deleteMaterialCableInstallationMaterial,
  deleteMaterialTrayInstallationMaterial,
  deleteMaterialInstrument,
  deleteMaterialInstrumentInstallationMaterial,
  exportMaterialCableInstallationMaterials,
  exportMaterialTrayInstallationMaterials,
  exportMaterialInstruments,
  exportMaterialInstrumentInstallationMaterials,
  fetchMaterialCableInstallationMaterials,
  fetchMaterialTrayInstallationMaterials,
  fetchMaterialInstruments,
  fetchMaterialInstrumentInstallationMaterials,
  getMaterialCableInstallationMaterialsTemplate,
  getMaterialTrayInstallationMaterialsTemplate,
  getMaterialInstrumentsTemplate,
  getMaterialInstrumentInstallationMaterialsTemplate,
  importMaterialCableInstallationMaterials,
  importMaterialTrayInstallationMaterials,
  importMaterialInstruments,
  importMaterialInstrumentInstallationMaterials,
  updateMaterialCableInstallationMaterial,
  updateMaterialTrayInstallationMaterial,
  updateMaterialInstrument,
  updateMaterialInstrumentInstallationMaterial,
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
  purposeOptions: string[];
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

type InstallationMaterialsCatalog = {
  singularLabel: string;
  singularTitle: string;
  pluralLabel: string;
  pluralTitle: string;
  fileStem: string;
  fetchAll: () => Promise<MaterialCableInstallationMaterial[]>;
  create: (
    token: string,
    input: MaterialCableInstallationMaterialInput,
  ) => Promise<MaterialCableInstallationMaterial>;
  update: (
    token: string,
    id: string,
    input: MaterialCableInstallationMaterialInput,
  ) => Promise<MaterialCableInstallationMaterial>;
  remove: (token: string, id: string) => Promise<void>;
  import: (
    token: string,
    file: File,
  ) => Promise<{
    items: MaterialCableInstallationMaterial[];
    summary: { inserted: number; updated: number; skipped: number };
  }>;
  export: (token: string) => Promise<Blob>;
  getTemplate: (token: string) => Promise<Blob>;
};

const cableInstallationMaterialsCatalog: InstallationMaterialsCatalog = {
  singularLabel: 'cable installation material',
  singularTitle: 'Cable installation material',
  pluralLabel: 'cable installation materials',
  pluralTitle: 'Cable installation materials',
  fileStem: 'materials-cable-installation-materials',
  fetchAll: async () =>
    (await fetchMaterialCableInstallationMaterials()).cableInstallationMaterials,
  create: async (token, input) =>
    (await createMaterialCableInstallationMaterial(token, input)).cableInstallationMaterial,
  update: async (token, id, input) =>
    (await updateMaterialCableInstallationMaterial(token, id, input)).cableInstallationMaterial,
  remove: deleteMaterialCableInstallationMaterial,
  import: async (token, file) => {
    const response = await importMaterialCableInstallationMaterials(token, file);
    return { items: response.cableInstallationMaterials, summary: response.summary };
  },
  export: exportMaterialCableInstallationMaterials,
  getTemplate: getMaterialCableInstallationMaterialsTemplate,
};

const trayInstallationMaterialsCatalog: InstallationMaterialsCatalog = {
  singularLabel: 'tray installation material',
  singularTitle: 'Tray installation material',
  pluralLabel: 'tray installation materials',
  pluralTitle: 'Trays installation materials',
  fileStem: 'materials-tray-installation-materials',
  fetchAll: async () => (await fetchMaterialTrayInstallationMaterials()).trayInstallationMaterials,
  create: async (token, input) =>
    (await createMaterialTrayInstallationMaterial(token, input)).trayInstallationMaterial,
  update: async (token, id, input) =>
    (await updateMaterialTrayInstallationMaterial(token, id, input)).trayInstallationMaterial,
  remove: deleteMaterialTrayInstallationMaterial,
  import: async (token, file) => {
    const response = await importMaterialTrayInstallationMaterials(token, file);
    return { items: response.trayInstallationMaterials, summary: response.summary };
  },
  export: exportMaterialTrayInstallationMaterials,
  getTemplate: getMaterialTrayInstallationMaterialsTemplate,
};

const instrumentsCatalog: InstallationMaterialsCatalog = {
  singularLabel: 'instrument',
  singularTitle: 'Instrument',
  pluralLabel: 'instruments',
  pluralTitle: 'Instruments',
  fileStem: 'materials-instruments',
  fetchAll: async () => (await fetchMaterialInstruments()).instruments,
  create: async (token, input) => (await createMaterialInstrument(token, input)).instrument,
  update: async (token, id, input) => (await updateMaterialInstrument(token, id, input)).instrument,
  remove: deleteMaterialInstrument,
  import: async (token, file) => {
    const response = await importMaterialInstruments(token, file);
    return { items: response.instruments, summary: response.summary };
  },
  export: exportMaterialInstruments,
  getTemplate: getMaterialInstrumentsTemplate,
};

const instrumentInstallationMaterialsCatalog: InstallationMaterialsCatalog = {
  singularLabel: 'instrument installation material',
  singularTitle: 'Instrument installation material',
  pluralLabel: 'instrument installation materials',
  pluralTitle: 'Instruments installation materials',
  fileStem: 'materials-instrument-installation-materials',
  fetchAll: async () =>
    (await fetchMaterialInstrumentInstallationMaterials()).instrumentInstallationMaterials,
  create: async (token, input) =>
    (await createMaterialInstrumentInstallationMaterial(token, input))
      .instrumentInstallationMaterial,
  update: async (token, id, input) =>
    (await updateMaterialInstrumentInstallationMaterial(token, id, input))
      .instrumentInstallationMaterial,
  remove: deleteMaterialInstrumentInstallationMaterial,
  import: async (token, file) => {
    const response = await importMaterialInstrumentInstallationMaterials(token, file);
    return { items: response.instrumentInstallationMaterials, summary: response.summary };
  },
  export: exportMaterialInstrumentInstallationMaterials,
  getTemplate: getMaterialInstrumentInstallationMaterialsTemplate,
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
  purposeFilter: string;
  purposeFilterOptions: string[];
  setSearchText: (value: string) => void;
  setSearchCriteria: (value: CableInstallationMaterialSearchCriteria) => void;
  setPurposeFilter: (value: string) => void;
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

const useInstallationMaterials = ({
  token,
  isAdmin,
  showToast,
  catalog,
}: UseCableInstallationMaterialsParams & {
  catalog: InstallationMaterialsCatalog;
}): UseCableInstallationMaterialsResult => {
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
  const [purposeFilter, setPurposeFilter] = useState<string>('');

  const sortCableInstallationMaterials = useCallback(
    (items: MaterialCableInstallationMaterial[]) =>
      [...items].sort((a, b) => a.type.localeCompare(b.type, undefined, { sensitivity: 'base' })),
    [],
  );

  const purposeOptions = useMemo(() => {
    const options = ['Grounding', 'Control', 'Power', 'VFD', 'MV'];
    const uniqueOptions = new Map<string, string>();

    for (const purpose of [
      ...options,
      ...cableInstallationMaterials.map((item) => item.purpose ?? ''),
    ]) {
      const trimmedPurpose = purpose.trim();
      if (trimmedPurpose !== '') {
        uniqueOptions.set(trimmedPurpose.toLocaleLowerCase(), trimmedPurpose);
      }
    }

    return [...uniqueOptions.values()].sort((a, b) =>
      a.localeCompare(b, undefined, { sensitivity: 'base' }),
    );
  }, [cableInstallationMaterials]);

  const purposeFilterOptions = useMemo(() => {
    const uniqueOptions = new Map<string, string>();

    for (const item of cableInstallationMaterials) {
      const trimmedPurpose = item.purpose?.trim();
      if (trimmedPurpose) {
        uniqueOptions.set(trimmedPurpose.toLocaleLowerCase(), trimmedPurpose);
      }
    }

    return [...uniqueOptions.values()].sort((left, right) =>
      left.localeCompare(right, undefined, { sensitivity: 'base' }),
    );
  }, [cableInstallationMaterials]);

  const filteredCableInstallationMaterials = useMemo(() => {
    const normalizedFilter = searchText.trim().toLowerCase();
    const normalizedPurpose = purposeFilter.trim().toLocaleLowerCase();

    return cableInstallationMaterials.filter((item) => {
      if (normalizedPurpose && item.purpose?.trim().toLocaleLowerCase() !== normalizedPurpose) {
        return false;
      }

      if (!normalizedFilter) return true;

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
  }, [cableInstallationMaterials, purposeFilter, searchCriteria, searchText]);

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
        const items = await catalog.fetchAll();
        setCableInstallationMaterials(sortCableInstallationMaterials(items));
        setPage(1);
      } catch (err) {
        console.error(`Failed to load ${catalog.pluralLabel}`, err);
        if (err instanceof ApiError) {
          if (err.status === 404) {
            setCableInstallationMaterials([]);
            setPage(1);
            setError(
              `${catalog.pluralTitle} endpoint is unavailable. Ensure the server is running the latest version.`,
            );
          } else {
            setError(err.message);
          }
        } else {
          setError(`Failed to load ${catalog.pluralLabel}.`);
        }
      } finally {
        setIsLoading(false);
        setIsRefreshing(false);
      }
    },
    [catalog, sortCableInstallationMaterials],
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

  const handlePurposeFilterChange = useCallback((value: string) => {
    setPurposeFilter(value);
    setPage(1);
  }, []);

  const handleFieldChange =
    (field: keyof CableInstallationMaterialFormState) =>
    (_event: ChangeEvent<HTMLInputElement>, data: { value: string }) => {
      setDialogValues((previous) => ({
        ...previous,
        [field]: data.value,
      }));
    };

  const handlePurposeSelect = useCallback((_event: unknown, data: { optionValue?: string }) => {
    const optionValue = data.optionValue;
    if (optionValue === undefined) {
      return;
    }

    setDialogValues((previous) => ({
      ...previous,
      purpose: optionValue,
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
          general: `You need to be signed in as an admin to manage ${catalog.pluralLabel}.`,
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
          const created = await catalog.create(token, input);
          setCableInstallationMaterials((previous) =>
            sortCableInstallationMaterials([...previous, created]),
          );
          setPage(1);
          showToast({ intent: 'success', title: `${catalog.singularTitle} created` });
        } else if (editingCableInstallationMaterialId) {
          const updated = await catalog.update(token, editingCableInstallationMaterialId, input);
          setCableInstallationMaterials((previous) =>
            sortCableInstallationMaterials(
              previous.map((item) =>
                item.id === editingCableInstallationMaterialId ? updated : item,
              ),
            ),
          );
          showToast({ intent: 'success', title: `${catalog.singularTitle} updated` });
        }
        resetDialog();
      } catch (err) {
        console.error(`Save ${catalog.singularLabel} failed`, err);
        if (err instanceof ApiError) {
          setDialogErrors(parseCableInstallationMaterialApiErrors(err.payload));
          showToast({
            intent: 'error',
            title: `Failed to save ${catalog.singularLabel}`,
            body: err.message,
          });
        } else {
          const message = `Failed to save ${catalog.singularLabel}. Please try again.`;
          setDialogErrors({
            general: message,
          });
          showToast({
            intent: 'error',
            title: `Failed to save ${catalog.singularLabel}`,
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
      catalog,
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
          body: `You need to be signed in as an admin to delete ${catalog.pluralLabel}.`,
        });
        return;
      }

      const confirmed = window.confirm(
        `Delete ${catalog.singularLabel} "${item.type}"? This action cannot be undone.`,
      );

      if (!confirmed) {
        return;
      }

      setPendingCableInstallationMaterialId(item.id);

      try {
        await catalog.remove(token, item.id);
        setCableInstallationMaterials((previous) => {
          const next = previous.filter((existingItem) => existingItem.id !== item.id);
          const nextPages = Math.max(1, Math.ceil(next.length / CABLE_TYPES_PER_PAGE));
          if (page > nextPages) {
            setPage(nextPages);
          }
          return next;
        });
        showToast({ intent: 'success', title: `${catalog.singularTitle} deleted` });
      } catch (err) {
        console.error(`Delete ${catalog.singularLabel} failed`, err);
        showToast({
          intent: 'error',
          title: `Failed to delete ${catalog.singularLabel}`,
          body: err instanceof ApiError ? err.message : undefined,
        });
      } finally {
        setPendingCableInstallationMaterialId(null);
      }
    },
    [catalog, isAdmin, page, showToast, token],
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
          body: `You need to be signed in as an admin to import ${catalog.pluralLabel}.`,
        });
        return;
      }

      setIsImporting(true);

      try {
        const response = await catalog.import(token, file);
        setCableInstallationMaterials(sortCableInstallationMaterials(response.items));
        setPage(1);

        showToast({
          intent: 'success',
          title: `${catalog.pluralTitle} imported`,
          body: `${response.summary.inserted} added, ${response.summary.updated} updated, ${response.summary.skipped} skipped.`,
        });
      } catch (err) {
        console.error(`Import ${catalog.pluralLabel} failed`, err);
        if (err instanceof ApiError && err.status === 404) {
          showToast({
            intent: 'error',
            title: 'Import endpoint unavailable',
            body: 'Please restart the API server after updating it.',
          });
        } else {
          showToast({
            intent: 'error',
            title: `Failed to import ${catalog.pluralLabel}`,
            body: err instanceof ApiError ? err.message : undefined,
          });
        }
      } finally {
        setIsImporting(false);
      }
    },
    [catalog, isAdmin, showToast, sortCableInstallationMaterials, token],
  );

  const handleExportCableInstallationMaterials = useCallback(async () => {
    if (!isAdmin || !token) {
      showToast({
        intent: 'error',
        title: 'Admin access required',
        body: `You need to be signed in as an admin to export ${catalog.pluralLabel}.`,
      });
      return;
    }

    setIsExporting(true);

    try {
      const blob = await catalog.export(token);
      downloadBlob(blob, buildTimestampedFileName(catalog.fileStem));
      showToast({ intent: 'success', title: `${catalog.pluralTitle} exported` });
    } catch (err) {
      console.error(`Export ${catalog.pluralLabel} failed`, err);
      if (err instanceof ApiError && err.status === 404) {
        showToast({
          intent: 'error',
          title: 'Export endpoint unavailable',
          body: 'Please restart the API server after updating it.',
        });
      } else {
        showToast({
          intent: 'error',
          title: `Failed to export ${catalog.pluralLabel}`,
          body: err instanceof ApiError ? err.message : undefined,
        });
      }
    } finally {
      setIsExporting(false);
    }
  }, [catalog, isAdmin, showToast, token]);

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
      const blob = await catalog.getTemplate(token);
      downloadBlob(blob, buildTimestampedFileName(`${catalog.fileStem}-template`));
      showToast({ intent: 'success', title: 'Template downloaded' });
    } catch (err) {
      console.error(`Get ${catalog.pluralLabel} template failed`, err);
      showToast({
        intent: 'error',
        title: 'Failed to get template',
        body: err instanceof ApiError ? err.message : undefined,
      });
    } finally {
      setIsGettingTemplate(false);
    }
  }, [catalog, isAdmin, showToast, token]);

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
    purposeFilter,
    purposeFilterOptions,
    setSearchText: handleSearchTextChange,
    setSearchCriteria: handleSearchCriteriaChange,
    setPurposeFilter: handlePurposeFilterChange,
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
      purposeOptions,
      handleFieldChange,
      handlePurposeSelect,
      handleSubmit,
      reset: resetDialog,
    },
  };
};

export const useCableInstallationMaterials = (
  params: UseCableInstallationMaterialsParams,
): UseCableInstallationMaterialsResult =>
  useInstallationMaterials({ ...params, catalog: cableInstallationMaterialsCatalog });

export const useTrayInstallationMaterials = (
  params: UseCableInstallationMaterialsParams,
): UseCableInstallationMaterialsResult =>
  useInstallationMaterials({ ...params, catalog: trayInstallationMaterialsCatalog });

export const useInstruments = (
  params: UseCableInstallationMaterialsParams,
): UseCableInstallationMaterialsResult =>
  useInstallationMaterials({ ...params, catalog: instrumentsCatalog });

export const useInstrumentInstallationMaterials = (
  params: UseCableInstallationMaterialsParams,
): UseCableInstallationMaterialsResult =>
  useInstallationMaterials({ ...params, catalog: instrumentInstallationMaterialsCatalog });
