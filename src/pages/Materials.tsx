import type { ChangeEvent, FormEvent } from 'react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Body1,
  Button,
  Caption1,
  Dialog,
  DialogActions,
  DialogBody,
  DialogContent,
  DialogSurface,
  DialogTitle,
  Field,
  Input,
  Spinner,
  Tab,
  TabList,
  TabValue,
  Title3,
  makeStyles,
  mergeClasses,
  shorthands,
  tokens
} from '@fluentui/react-components';
import {
  ApiError,
  MaterialSupport,
  MaterialTray,
  PaginationMeta,
  createMaterialSupport,
  createMaterialTray,
  deleteMaterialSupport,
  deleteMaterialTray,
  exportMaterialSupports,
  exportMaterialTrays,
  fetchMaterialSupports,
  fetchMaterialTrays,
  importMaterialSupports,
  importMaterialTrays,
  updateMaterialSupport,
  updateMaterialTray
} from '@/api/client';
import { useAuth } from '@/context/AuthContext';
import { useToast } from '@/context/ToastContext';

type MaterialsTab = 'trays' | 'supports';

type TrayFormState = {
  type: string;
  heightMm: string;
  widthMm: string;
  weightKgPerM: string;
};

type SupportFormState = {
  type: string;
  heightMm: string;
  widthMm: string;
  lengthMm: string;
  weightKg: string;
};

type TrayFormErrors = Partial<Record<keyof TrayFormState, string>>;
type SupportFormErrors = Partial<Record<keyof SupportFormState, string>>;

const PAGE_SIZE = 10;

const useStyles = makeStyles({
  root: {
    width: '100%',
    maxWidth: '100%',
    display: 'flex',
    flexDirection: 'column',
    gap: '1.5rem',
    ...shorthands.padding('2rem', '1.5rem', '4rem')
  },
  header: {
    display: 'flex',
    flexDirection: 'column',
    gap: '0.5rem'
  },
  actionsRow: {
    display: 'flex',
    gap: '0.75rem',
    flexWrap: 'wrap',
    alignItems: 'center'
  },
  hiddenInput: {
    display: 'none'
  },
  tableWrapper: {
    width: '100%',
    overflowX: 'auto'
  },
  table: {
    width: '100%',
    borderCollapse: 'collapse'
  },
  tableHeadCell: {
    padding: '0.75rem 1rem',
    textAlign: 'left',
    backgroundColor: tokens.colorNeutralBackground2,
    borderBottom: `1px solid ${tokens.colorNeutralStroke1}`,
    whiteSpace: 'nowrap',
    fontWeight: tokens.fontWeightSemibold
  },
  tableCell: {
    padding: '0.75rem 1rem',
    borderBottom: `1px solid ${tokens.colorNeutralStroke1}`
  },
  numericCell: {
    textAlign: 'right',
    whiteSpace: 'nowrap'
  },
  actionsCell: {
    display: 'flex',
    justifyContent: 'flex-end',
    gap: '0.5rem',
    whiteSpace: 'nowrap'
  },
  emptyState: {
    display: 'grid',
    gap: '0.5rem'
  },
  errorText: {
    color: tokens.colorStatusDangerForeground1
  },
  pagination: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: '1rem',
    flexWrap: 'wrap',
    marginTop: '1rem'
  },
  dialogActions: {
    display: 'flex',
    justifyContent: 'flex-end',
    gap: '0.5rem'
  }
});

const initialTrayForm: TrayFormState = {
  type: '',
  heightMm: '',
  widthMm: '',
  weightKgPerM: ''
};

const initialSupportForm: SupportFormState = {
  type: '',
  heightMm: '',
  widthMm: '',
  lengthMm: '',
  weightKg: ''
};

const sanitizeFileSegment = (value: string): string =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'materials';

const parseNumberInput = (value: string): { numeric: number | null; error?: string } => {
  const trimmed = value.trim();
  if (trimmed === '') {
    return { numeric: null };
  }

  const normalized = trimmed.replace(',', '.');
  const parsed = Number(normalized);

  if (!Number.isFinite(parsed) || parsed < 0) {
    return { numeric: null, error: 'Enter a valid non-negative number' };
  }

  return { numeric: parsed };
};

const buildTimestampedFileName = (prefix: string): string => {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  return `${sanitizeFileSegment(prefix)}-${timestamp}.xlsx`;
};

const downloadBlob = (blob: Blob, fileName: string): void => {
  const link = document.createElement('a');
  const url = window.URL.createObjectURL(blob);
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.URL.revokeObjectURL(url);
};

const toFormValue = (value: number | null): string =>
  value === null || Number.isNaN(value) ? '' : String(value);

const normalizePagination = (pagination: PaginationMeta): PaginationMeta => {
  if (pagination.totalItems === 0) {
    return {
      page: 1,
      pageSize: pagination.pageSize,
      totalItems: 0,
      totalPages: 1
    };
  }

  return pagination;
};
export const Materials = () => {
  const styles = useStyles();
  const { user, token } = useAuth();
  const { showToast } = useToast();

  const isAdmin = Boolean(user?.isAdmin);

  const [selectedTab, setSelectedTab] = useState<MaterialsTab>('trays');

  const numberFormatter = useMemo(
    () =>
      new Intl.NumberFormat(undefined, {
        maximumFractionDigits: 2
      }),
    []
  );

  const weightFormatter = useMemo(
    () =>
      new Intl.NumberFormat(undefined, {
        minimumFractionDigits: 3,
        maximumFractionDigits: 3
      }),
    []
  );

  const formatNumeric = useCallback(
    (value: number | null) => {
      if (value === null || Number.isNaN(value)) {
        return '-';
      }
      return numberFormatter.format(value);
    },
    [numberFormatter]
  );

  const formatWeight = useCallback(
    (value: number | null) => {
      if (value === null || Number.isNaN(value)) {
        return '-';
      }
      return weightFormatter.format(value);
    },
    [weightFormatter]
  );

  const [trays, setTrays] = useState<MaterialTray[]>([]);
  const [trayPagination, setTrayPagination] = useState<PaginationMeta | null>(null);
  const [trayPage, setTrayPage] = useState<number>(1);
  const [traysError, setTraysError] = useState<string | null>(null);
  const [isLoadingTrays, setIsLoadingTrays] = useState<boolean>(true);
  const [isRefreshingTrays, setIsRefreshingTrays] = useState<boolean>(false);
  const [isExportingTrays, setIsExportingTrays] = useState<boolean>(false);
  const [isImportingTrays, setIsImportingTrays] = useState<boolean>(false);
  const [trayPendingId, setTrayPendingId] = useState<string | null>(null);

  const [supports, setSupports] = useState<MaterialSupport[]>([]);
  const [supportPagination, setSupportPagination] = useState<PaginationMeta | null>(null);
  const [supportPage, setSupportPage] = useState<number>(1);
  const [supportsError, setSupportsError] = useState<string | null>(null);
  const [isLoadingSupports, setIsLoadingSupports] = useState<boolean>(true);
  const [isRefreshingSupports, setIsRefreshingSupports] = useState<boolean>(false);
  const [isExportingSupports, setIsExportingSupports] = useState<boolean>(false);
  const [isImportingSupports, setIsImportingSupports] = useState<boolean>(false);
  const [supportPendingId, setSupportPendingId] = useState<string | null>(null);

  const trayFileInputRef = useRef<HTMLInputElement | null>(null);
  const supportFileInputRef = useRef<HTMLInputElement | null>(null);

  const [isTrayDialogOpen, setIsTrayDialogOpen] = useState<boolean>(false);
  const [trayDialogMode, setTrayDialogMode] = useState<'create' | 'edit'>('create');
  const [editingTray, setEditingTray] = useState<MaterialTray | null>(null);
  const [trayForm, setTrayForm] = useState<TrayFormState>(initialTrayForm);
  const [trayFormErrors, setTrayFormErrors] = useState<TrayFormErrors>({});
  const [isTraySubmitting, setIsTraySubmitting] = useState<boolean>(false);

  const [isSupportDialogOpen, setIsSupportDialogOpen] = useState<boolean>(false);
  const [supportDialogMode, setSupportDialogMode] = useState<'create' | 'edit'>('create');
  const [editingSupport, setEditingSupport] = useState<MaterialSupport | null>(null);
  const [supportForm, setSupportForm] = useState<SupportFormState>(initialSupportForm);
  const [supportFormErrors, setSupportFormErrors] = useState<SupportFormErrors>({});
  const [isSupportSubmitting, setIsSupportSubmitting] = useState<boolean>(false);

  const loadTrays = useCallback(
    async (page: number, options?: { silent?: boolean }) => {
      if (options?.silent) {
        setIsRefreshingTrays(true);
      } else {
        setIsLoadingTrays(true);
      }
      setTraysError(null);

      try {
        const result = await fetchMaterialTrays({ page, pageSize: PAGE_SIZE });

        if (result.pagination.totalItems === 0 && page !== 1) {
          setTrayPage(1);
          return;
        }

        if (
          result.pagination.totalItems > 0 &&
          result.pagination.totalPages > 0 &&
          page > result.pagination.totalPages
        ) {
          setTrayPage(result.pagination.totalPages);
          return;
        }

        setTrays(result.trays);
        setTrayPagination(normalizePagination(result.pagination));
      } catch (error) {
        console.error('Fetch material trays failed', error);
        setTraysError('Failed to load trays. Please try again.');
      } finally {
        if (options?.silent) {
          setIsRefreshingTrays(false);
        } else {
          setIsLoadingTrays(false);
        }
      }
    },
    []
  );

  const loadSupports = useCallback(
    async (page: number, options?: { silent?: boolean }) => {
      if (options?.silent) {
        setIsRefreshingSupports(true);
      } else {
        setIsLoadingSupports(true);
      }
      setSupportsError(null);

      try {
        const result = await fetchMaterialSupports({ page, pageSize: PAGE_SIZE });

        if (result.pagination.totalItems === 0 && page !== 1) {
          setSupportPage(1);
          return;
        }

        if (
          result.pagination.totalItems > 0 &&
          result.pagination.totalPages > 0 &&
          page > result.pagination.totalPages
        ) {
          setSupportPage(result.pagination.totalPages);
          return;
        }

        setSupports(result.supports);
        setSupportPagination(normalizePagination(result.pagination));
      } catch (error) {
        console.error('Fetch material supports failed', error);
        setSupportsError('Failed to load supports. Please try again.');
      } finally {
        if (options?.silent) {
          setIsRefreshingSupports(false);
        } else {
          setIsLoadingSupports(false);
        }
      }
    },
    []
  );

  useEffect(() => {
    void loadTrays(trayPage);
  }, [trayPage, loadTrays]);

  useEffect(() => {
    void loadSupports(supportPage);
  }, [supportPage, loadSupports]);
  const handleTabSelect = useCallback(
    (_event: unknown, data: { value: TabValue }) => {
      setSelectedTab(data.value as MaterialsTab);
    },
    []
  );

  const openTrayCreateDialog = useCallback(() => {
    setTrayDialogMode('create');
    setEditingTray(null);
    setTrayForm(initialTrayForm);
    setTrayFormErrors({});
    setIsTrayDialogOpen(true);
  }, []);

  const openTrayEditDialog = useCallback((tray: MaterialTray) => {
    setTrayDialogMode('edit');
    setEditingTray(tray);
    setTrayForm({
      type: tray.type,
      heightMm: toFormValue(tray.heightMm),
      widthMm: toFormValue(tray.widthMm),
      weightKgPerM: toFormValue(tray.weightKgPerM)
    });
    setTrayFormErrors({});
    setIsTrayDialogOpen(true);
  }, []);

  const closeTrayDialog = useCallback(() => {
    setIsTrayDialogOpen(false);
    setTrayDialogMode('create');
    setEditingTray(null);
    setTrayForm(initialTrayForm);
    setTrayFormErrors({});
  }, []);

  const openSupportCreateDialog = useCallback(() => {
    setSupportDialogMode('create');
    setEditingSupport(null);
    setSupportForm(initialSupportForm);
    setSupportFormErrors({});
    setIsSupportDialogOpen(true);
  }, []);

  const openSupportEditDialog = useCallback((support: MaterialSupport) => {
    setSupportDialogMode('edit');
    setEditingSupport(support);
    setSupportForm({
      type: support.type,
      heightMm: toFormValue(support.heightMm),
      widthMm: toFormValue(support.widthMm),
      lengthMm: toFormValue(support.lengthMm),
      weightKg: toFormValue(support.weightKg)
    });
    setSupportFormErrors({});
    setIsSupportDialogOpen(true);
  }, []);

  const closeSupportDialog = useCallback(() => {
    setIsSupportDialogOpen(false);
    setSupportDialogMode('create');
    setEditingSupport(null);
    setSupportForm(initialSupportForm);
    setSupportFormErrors({});
  }, []);

  const handleTrayFieldChange = useCallback(
    (field: keyof TrayFormState) =>
      (_event: ChangeEvent<HTMLInputElement>, data: { value: string }) => {
        setTrayForm((previous) => ({ ...previous, [field]: data.value }));
        setTrayFormErrors((previous) => ({ ...previous, [field]: undefined }));
      },
    []
  );

  const handleSupportFieldChange = useCallback(
    (field: keyof SupportFormState) =>
      (_event: ChangeEvent<HTMLInputElement>, data: { value: string }) => {
        setSupportForm((previous) => ({ ...previous, [field]: data.value }));
        setSupportFormErrors((previous) => ({ ...previous, [field]: undefined }));
      },
    []
  );
  const handleTraySubmit = useCallback(
    async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();

      if (!isAdmin || !token) {
        showToast({
          intent: 'error',
          title: 'Admin access required',
          body: 'You need to be signed in as an admin to manage trays.'
        });
        return;
      }

      const errors: TrayFormErrors = {};
      const type = trayForm.type.trim();
      if (!type) {
        errors.type = 'Type is required';
      }

      const heightResult = parseNumberInput(trayForm.heightMm);
      if (heightResult.error) {
        errors.heightMm = heightResult.error;
      }

      const widthResult = parseNumberInput(trayForm.widthMm);
      if (widthResult.error) {
        errors.widthMm = widthResult.error;
      }

      const weightResult = parseNumberInput(trayForm.weightKgPerM);
      if (weightResult.error) {
        errors.weightKgPerM = weightResult.error;
      }

      if (Object.keys(errors).length > 0) {
        setTrayFormErrors(errors);
        return;
      }

      setIsTraySubmitting(true);

      try {
        if (trayDialogMode === 'create') {
          await createMaterialTray(token, {
            type,
            heightMm: heightResult.numeric,
            widthMm: widthResult.numeric,
            weightKgPerM: weightResult.numeric
          });
          showToast({ intent: 'success', title: 'Tray added' });

          if (trayPage !== 1) {
            setTrayPage(1);
          } else {
            await loadTrays(trayPage, { silent: true });
          }
        } else if (editingTray) {
          await updateMaterialTray(token, editingTray.id, {
            type,
            heightMm: heightResult.numeric,
            widthMm: widthResult.numeric,
            weightKgPerM: weightResult.numeric
          });
          showToast({ intent: 'success', title: 'Tray updated' });
          await loadTrays(trayPage, { silent: true });
        }

        closeTrayDialog();
      } catch (error) {
        console.error('Save material tray failed', error);
        if (error instanceof ApiError && error.status === 409) {
          setTrayFormErrors((previous) => ({
            ...previous,
            type: 'A tray with this type already exists'
          }));
        } else {
          showToast({
            intent: 'error',
            title: 'Failed to save tray',
            body: 'Please try again.'
          });
        }
      } finally {
        setIsTraySubmitting(false);
      }
    },
    [
      closeTrayDialog,
      editingTray,
      isAdmin,
      loadTrays,
      showToast,
      token,
      trayDialogMode,
      trayForm,
      trayPage
    ]
  );
  const handleSupportSubmit = useCallback(
    async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();

      if (!isAdmin || !token) {
        showToast({
          intent: 'error',
          title: 'Admin access required',
          body: 'You need to be signed in as an admin to manage supports.'
        });
        return;
      }

      const errors: SupportFormErrors = {};
      const type = supportForm.type.trim();
      if (!type) {
        errors.type = 'Type is required';
      }

      const heightResult = parseNumberInput(supportForm.heightMm);
      if (heightResult.error) {
        errors.heightMm = heightResult.error;
      }

      const widthResult = parseNumberInput(supportForm.widthMm);
      if (widthResult.error) {
        errors.widthMm = widthResult.error;
      }

      const lengthResult = parseNumberInput(supportForm.lengthMm);
      if (lengthResult.error) {
        errors.lengthMm = lengthResult.error;
      }

      const weightResult = parseNumberInput(supportForm.weightKg);
      if (weightResult.error) {
        errors.weightKg = weightResult.error;
      }

      if (Object.keys(errors).length > 0) {
        setSupportFormErrors(errors);
        return;
      }

      setIsSupportSubmitting(true);

      try {
        if (supportDialogMode === 'create') {
          await createMaterialSupport(token, {
            type,
            heightMm: heightResult.numeric,
            widthMm: widthResult.numeric,
            lengthMm: lengthResult.numeric,
            weightKg: weightResult.numeric
          });
          showToast({ intent: 'success', title: 'Support added' });

          if (supportPage !== 1) {
            setSupportPage(1);
          } else {
            await loadSupports(supportPage, { silent: true });
          }
        } else if (editingSupport) {
          await updateMaterialSupport(token, editingSupport.id, {
            type,
            heightMm: heightResult.numeric,
            widthMm: widthResult.numeric,
            lengthMm: lengthResult.numeric,
            weightKg: weightResult.numeric
          });
          showToast({ intent: 'success', title: 'Support updated' });
          await loadSupports(supportPage, { silent: true });
        }

        closeSupportDialog();
      } catch (error) {
        console.error('Save material support failed', error);
        if (error instanceof ApiError && error.status === 409) {
          setSupportFormErrors((previous) => ({
            ...previous,
            type: 'A support with this type already exists'
          }));
        } else {
          showToast({
            intent: 'error',
            title: 'Failed to save support',
            body: 'Please try again.'
          });
        }
      } finally {
        setIsSupportSubmitting(false);
      }
    },
    [
      closeSupportDialog,
      editingSupport,
      isAdmin,
      loadSupports,
      showToast,
      supportDialogMode,
      supportForm,
      supportPage,
      token
    ]
  );
  const handleTrayImportClick = useCallback(() => {
    if (!isAdmin) {
      showToast({
        intent: 'error',
        title: 'Admin access required',
        body: 'You need to be signed in as an admin to import trays.'
      });
      return;
    }
    trayFileInputRef.current?.click();
  }, [isAdmin, showToast]);

  const handleSupportImportClick = useCallback(() => {
    if (!isAdmin) {
      showToast({
        intent: 'error',
        title: 'Admin access required',
        body: 'You need to be signed in as an admin to import supports.'
      });
      return;
    }
    supportFileInputRef.current?.click();
  }, [isAdmin, showToast]);

  const handleTrayImportChange = useCallback(
    async (event: ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      event.target.value = '';

      if (!file) {
        return;
      }

      if (!isAdmin || !token) {
        showToast({
          intent: 'error',
          title: 'Admin access required',
          body: 'You need to be signed in as an admin to import trays.'
        });
        return;
      }

      setIsImportingTrays(true);
      try {
        const result = await importMaterialTrays(token, file);
        await loadTrays(trayPage, { silent: true });
        showToast({
          intent: 'success',
          title: 'Tray import complete',
          body: `Created ${result.summary.created}, updated ${result.summary.updated}, skipped ${result.summary.skipped}.`
        });
      } catch (error) {
        console.error('Import material trays failed', error);
        if (error instanceof ApiError && error.status === 404) {
          showToast({
            intent: 'error',
            title: 'Import endpoint unavailable',
            body: 'Please restart the API server after updating it.'
          });
        } else {
          showToast({
            intent: 'error',
            title: 'Failed to import trays',
            body: 'Please check your file and try again.'
          });
        }
      } finally {
        setIsImportingTrays(false);
      }
    },
    [isAdmin, loadTrays, showToast, token, trayPage]
  );

  const handleSupportImportChange = useCallback(
    async (event: ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      event.target.value = '';

      if (!file) {
        return;
      }

      if (!isAdmin || !token) {
        showToast({
          intent: 'error',
          title: 'Admin access required',
          body: 'You need to be signed in as an admin to import supports.'
        });
        return;
      }

      setIsImportingSupports(true);
      try {
        const result = await importMaterialSupports(token, file);
        await loadSupports(supportPage, { silent: true });
        showToast({
          intent: 'success',
          title: 'Support import complete',
          body: `Created ${result.summary.created}, updated ${result.summary.updated}, skipped ${result.summary.skipped}.`
        });
      } catch (error) {
        console.error('Import material supports failed', error);
        if (error instanceof ApiError && error.status === 404) {
          showToast({
            intent: 'error',
            title: 'Import endpoint unavailable',
            body: 'Please restart the API server after updating it.'
          });
        } else {
          showToast({
            intent: 'error',
            title: 'Failed to import supports',
            body: 'Please check your file and try again.'
          });
        }
      } finally {
        setIsImportingSupports(false);
      }
    },
    [isAdmin, loadSupports, showToast, supportPage, token]
  );

  const handleExportTrays = useCallback(async () => {
    setIsExportingTrays(true);
    try {
      const blob = await exportMaterialTrays(token ?? undefined);
      downloadBlob(blob, buildTimestampedFileName('materials-trays'));
      showToast({ intent: 'success', title: 'Trays exported' });
    } catch (error) {
      console.error('Export material trays failed', error);
      if (error instanceof ApiError && error.status === 404) {
        showToast({
          intent: 'error',
          title: 'Export endpoint unavailable',
          body: 'Please restart the API server after updating it.'
        });
      } else {
        showToast({
          intent: 'error',
          title: 'Failed to export trays',
          body: 'Please try again.'
        });
      }
    } finally {
      setIsExportingTrays(false);
    }
  }, [showToast, token]);

  const handleExportSupports = useCallback(async () => {
    setIsExportingSupports(true);
    try {
      const blob = await exportMaterialSupports(token ?? undefined);
      downloadBlob(blob, buildTimestampedFileName('materials-supports'));
      showToast({ intent: 'success', title: 'Supports exported' });
    } catch (error) {
      console.error('Export material supports failed', error);
      if (error instanceof ApiError && error.status === 404) {
        showToast({
          intent: 'error',
          title: 'Export endpoint unavailable',
          body: 'Please restart the API server after updating it.'
        });
      } else {
        showToast({
          intent: 'error',
          title: 'Failed to export supports',
          body: 'Please try again.'
        });
      }
    } finally {
      setIsExportingSupports(false);
    }
  }, [showToast, token]);
  const handleTrayDelete = useCallback(
    async (tray: MaterialTray) => {
      if (!isAdmin || !token) {
        showToast({
          intent: 'error',
          title: 'Admin access required',
          body: 'You need to be signed in as an admin to delete trays.'
        });
        return;
      }

      const confirmed = window.confirm(
        `Delete tray '${tray.type}'? This action cannot be undone.`
      );
      if (!confirmed) {
        return;
      }

      setTrayPendingId(tray.id);
      try {
        await deleteMaterialTray(token, tray.id);
        showToast({ intent: 'success', title: 'Tray deleted' });

        if (
          trays.length === 1 &&
          trayPagination &&
          trayPagination.totalItems > 0 &&
          trayPagination.page > 1
        ) {
          setTrayPage(trayPagination.page - 1);
        } else {
          await loadTrays(trayPage, { silent: true });
        }
      } catch (error) {
        console.error('Delete material tray failed', error);
        showToast({
          intent: 'error',
          title: 'Failed to delete tray',
          body: 'Please try again.'
        });
      } finally {
        setTrayPendingId(null);
      }
    },
    [
      isAdmin,
      loadTrays,
      showToast,
      token,
      trayPage,
      trayPagination,
      trays
    ]
  );

  const handleSupportDelete = useCallback(
    async (support: MaterialSupport) => {
      if (!isAdmin || !token) {
        showToast({
          intent: 'error',
          title: 'Admin access required',
          body: 'You need to be signed in as an admin to delete supports.'
        });
        return;
      }

      const confirmed = window.confirm(
        `Delete support '${support.type}'? This action cannot be undone.`
      );
      if (!confirmed) {
        return;
      }

      setSupportPendingId(support.id);
      try {
        await deleteMaterialSupport(token, support.id);
        showToast({ intent: 'success', title: 'Support deleted' });

        if (
          supports.length === 1 &&
          supportPagination &&
          supportPagination.totalItems > 0 &&
          supportPagination.page > 1
        ) {
          setSupportPage(supportPagination.page - 1);
        } else {
          await loadSupports(supportPage, { silent: true });
        }
      } catch (error) {
        console.error('Delete material support failed', error);
        showToast({
          intent: 'error',
          title: 'Failed to delete support',
          body: 'Please try again.'
        });
      } finally {
        setSupportPendingId(null);
      }
    },
    [
      isAdmin,
      loadSupports,
      showToast,
      supportPage,
      supportPagination,
      supports,
      token
    ]
  );

  const trayTotalPages = trayPagination ? trayPagination.totalPages : 1;
  const supportTotalPages = supportPagination ? supportPagination.totalPages : 1;
  return (
    <section className={styles.root} aria-labelledby='materials-heading'>
      <div className={styles.header}>
        <Title3 id='materials-heading'>Materials</Title3>
        <Body1>Reference trays and supports that can be reused across projects.</Body1>
      </div>

      <TabList
        selectedValue={selectedTab}
        onTabSelect={handleTabSelect}
        aria-label='Materials categories'
      >
        <Tab value='trays'>Trays</Tab>
        <Tab value='supports'>Supports</Tab>
      </TabList>

      <div role='tabpanel' aria-label={selectedTab === 'trays' ? 'Trays' : 'Supports'}>
        {selectedTab === 'trays' ? (
          <>
            <div className={styles.actionsRow}>
              <Button onClick={() => loadTrays(trayPage, { silent: true })} disabled={isRefreshingTrays}>
                {isRefreshingTrays ? 'Refreshing...' : 'Refresh'}
              </Button>
              {isAdmin ? (
                <>
                  <Button appearance='primary' onClick={openTrayCreateDialog}>
                    Add tray
                  </Button>
                  <Button onClick={handleTrayImportClick} disabled={isImportingTrays}>
                    {isImportingTrays ? 'Importing...' : 'Import from Excel'}
                  </Button>
                  <input
                    ref={trayFileInputRef}
                    type='file'
                    className={styles.hiddenInput}
                    accept='.xlsx'
                    onChange={handleTrayImportChange}
                  />
                </>
              ) : null}
              <Button onClick={handleExportTrays} disabled={isExportingTrays}>
                {isExportingTrays ? 'Exporting...' : 'Export to Excel'}
              </Button>
            </div>

            {traysError ? <Body1 className={styles.errorText}>{traysError}</Body1> : null}

            {isLoadingTrays ? (
              <Spinner label='Loading trays...' />
            ) : trays.length === 0 ? (
              <div className={styles.emptyState}>
                <Caption1>No trays found</Caption1>
                <Body1>
                  {isAdmin
                    ? 'Use the actions above to add or import tray definitions.'
                    : 'Trays will appear here once an administrator adds them.'}
                </Body1>
              </div>
            ) : (
              <>
                <div className={styles.tableWrapper}>
                  <table className={styles.table}>
                    <thead>
                      <tr>
                        <th className={styles.tableHeadCell}>Type</th>
                        <th className={mergeClasses(styles.tableHeadCell, styles.numericCell)}>
                          Height [mm]
                        </th>
                        <th className={mergeClasses(styles.tableHeadCell, styles.numericCell)}>
                          Width [mm]
                        </th>
                        <th className={mergeClasses(styles.tableHeadCell, styles.numericCell)}>
                          Weight [kg/m]
                        </th>
                        {isAdmin ? <th className={styles.tableHeadCell}>Actions</th> : null}
                      </tr>
                    </thead>
                    <tbody>
                      {trays.map((tray) => {
                        const isBusy = trayPendingId === tray.id;
                        return (
                          <tr key={tray.id}>
                            <td className={styles.tableCell}>{tray.type}</td>
                            <td className={mergeClasses(styles.tableCell, styles.numericCell)}>
                              {formatNumeric(tray.heightMm)}
                            </td>
                            <td className={mergeClasses(styles.tableCell, styles.numericCell)}>
                              {formatNumeric(tray.widthMm)}
                            </td>
                            <td className={mergeClasses(styles.tableCell, styles.numericCell)}>
                              {formatWeight(tray.weightKgPerM)}
                            </td>
                            {isAdmin ? (
                              <td className={mergeClasses(styles.tableCell, styles.actionsCell)}>
                                <Button
                                  size='small'
                                  onClick={() => openTrayEditDialog(tray)}
                                  disabled={isBusy || isTraySubmitting}
                                >
                                  Edit
                                </Button>
                                <Button
                                  size='small'
                                  appearance='secondary'
                                  onClick={() => handleTrayDelete(tray)}
                                  disabled={isBusy}
                                >
                                  {isBusy ? 'Deleting...' : 'Delete'}
                                </Button>
                              </td>
                            ) : null}
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                <div className={styles.pagination}>
                  <Button
                    size='small'
                    onClick={() => setTrayPage((previous) => Math.max(1, previous - 1))}
                    disabled={trayPage <= 1}
                  >
                    Previous
                  </Button>
                  <Body1>
                    Page {Math.max(1, Math.min(trayPage, Math.max(1, trayTotalPages)))} of {Math.max(1, trayTotalPages)}
                  </Body1>
                  <Button
                    size='small'
                    onClick={() =>
                      setTrayPage((previous) =>
                        trayTotalPages > 0 ? Math.min(trayTotalPages, previous + 1) : previous
                      )
                    }
                    disabled={trayTotalPages > 0 ? trayPage >= trayTotalPages : true}
                  >
                    Next
                  </Button>
                </div>
              </>
            )}
          </>
        ) : (
          <>
            <div className={styles.actionsRow}>
              <Button
                onClick={() => loadSupports(supportPage, { silent: true })}
                disabled={isRefreshingSupports}
              >
                {isRefreshingSupports ? 'Refreshing...' : 'Refresh'}
              </Button>
              {isAdmin ? (
                <>
                  <Button appearance='primary' onClick={openSupportCreateDialog}>
                    Add support
                  </Button>
                  <Button onClick={handleSupportImportClick} disabled={isImportingSupports}>
                    {isImportingSupports ? 'Importing...' : 'Import from Excel'}
                  </Button>
                  <input
                    ref={supportFileInputRef}
                    type='file'
                    className={styles.hiddenInput}
                    accept='.xlsx'
                    onChange={handleSupportImportChange}
                  />
                </>
              ) : null}
              <Button onClick={handleExportSupports} disabled={isExportingSupports}>
                {isExportingSupports ? 'Exporting...' : 'Export to Excel'}
              </Button>
            </div>

            {supportsError ? <Body1 className={styles.errorText}>{supportsError}</Body1> : null}

            {isLoadingSupports ? (
              <Spinner label='Loading supports...' />
            ) : supports.length === 0 ? (
              <div className={styles.emptyState}>
                <Caption1>No supports found</Caption1>
                <Body1>
                  {isAdmin
                    ? 'Use the actions above to add or import support definitions.'
                    : 'Supports will appear here once an administrator adds them.'}
                </Body1>
              </div>
            ) : (
              <>
                <div className={styles.tableWrapper}>
                  <table className={styles.table}>
                    <thead>
                      <tr>
                        <th className={styles.tableHeadCell}>Type</th>
                        <th className={mergeClasses(styles.tableHeadCell, styles.numericCell)}>
                          Height [mm]
                        </th>
                        <th className={mergeClasses(styles.tableHeadCell, styles.numericCell)}>
                          Width [mm]
                        </th>
                        <th className={mergeClasses(styles.tableHeadCell, styles.numericCell)}>
                          Length [mm]
                        </th>
                        <th className={mergeClasses(styles.tableHeadCell, styles.numericCell)}>
                          Weight [kg]
                        </th>
                        {isAdmin ? <th className={styles.tableHeadCell}>Actions</th> : null}
                      </tr>
                    </thead>
                    <tbody>
                      {supports.map((support) => {
                        const isBusy = supportPendingId === support.id;
                        return (
                          <tr key={support.id}>
                            <td className={styles.tableCell}>{support.type}</td>
                            <td className={mergeClasses(styles.tableCell, styles.numericCell)}>
                              {formatNumeric(support.heightMm)}
                            </td>
                            <td className={mergeClasses(styles.tableCell, styles.numericCell)}>
                              {formatNumeric(support.widthMm)}
                            </td>
                            <td className={mergeClasses(styles.tableCell, styles.numericCell)}>
                              {formatNumeric(support.lengthMm)}
                            </td>
                            <td className={mergeClasses(styles.tableCell, styles.numericCell)}>
                              {formatWeight(support.weightKg)}
                            </td>
                            {isAdmin ? (
                              <td className={mergeClasses(styles.tableCell, styles.actionsCell)}>
                                <Button
                                  size='small'
                                  onClick={() => openSupportEditDialog(support)}
                                  disabled={isBusy || isSupportSubmitting}
                                >
                                  Edit
                                </Button>
                                <Button
                                  size='small'
                                  appearance='secondary'
                                  onClick={() => handleSupportDelete(support)}
                                  disabled={isBusy}
                                >
                                  {isBusy ? 'Deleting...' : 'Delete'}
                                </Button>
                              </td>
                            ) : null}
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                <div className={styles.pagination}>
                  <Button
                    size='small'
                    onClick={() => setSupportPage((previous) => Math.max(1, previous - 1))}
                    disabled={supportPage <= 1}
                  >
                    Previous
                  </Button>
                  <Body1>
                    Page {Math.max(1, Math.min(supportPage, Math.max(1, supportTotalPages)))} of {Math.max(1, supportTotalPages)}
                  </Body1>
                  <Button
                    size='small'
                    onClick={() =>
                      setSupportPage((previous) =>
                        supportTotalPages > 0 ? Math.min(supportTotalPages, previous + 1) : previous
                      )
                    }
                    disabled={supportTotalPages > 0 ? supportPage >= supportTotalPages : true}
                  >
                    Next
                  </Button>
                </div>
              </>
            )}
          </>
        )}
      </div>
      <Dialog
        open={isTrayDialogOpen}
        onOpenChange={(_, data) => {
          if (!data.open) {
            closeTrayDialog();
          }
        }}
      >
        <DialogSurface>
          <form onSubmit={handleTraySubmit}>
            <DialogBody>
              <DialogTitle>
                {trayDialogMode === 'create'
                  ? 'Add tray'
                  : `Edit tray${editingTray ? `: ${editingTray.type}` : ''}`}
              </DialogTitle>
              <DialogContent>
                <Field
                  label='Type'
                  required
                  validationState={trayFormErrors.type ? 'error' : undefined}
                  validationMessage={trayFormErrors.type}
                >
                  <Input value={trayForm.type} onChange={handleTrayFieldChange('type')} required />
                </Field>
                <Field
                  label='Height [mm]'
                  validationState={trayFormErrors.heightMm ? 'error' : undefined}
                  validationMessage={trayFormErrors.heightMm}
                >
                  <Input value={trayForm.heightMm} onChange={handleTrayFieldChange('heightMm')} />
                </Field>
                <Field
                  label='Width [mm]'
                  validationState={trayFormErrors.widthMm ? 'error' : undefined}
                  validationMessage={trayFormErrors.widthMm}
                >
                  <Input value={trayForm.widthMm} onChange={handleTrayFieldChange('widthMm')} />
                </Field>
                <Field
                  label='Weight [kg/m]'
                  validationState={trayFormErrors.weightKgPerM ? 'error' : undefined}
                  validationMessage={trayFormErrors.weightKgPerM}
                >
                  <Input
                    value={trayForm.weightKgPerM}
                    onChange={handleTrayFieldChange('weightKgPerM')}
                  />
                </Field>
              </DialogContent>
              <DialogActions className={styles.dialogActions}>
                <Button appearance='secondary' onClick={closeTrayDialog}>
                  Cancel
                </Button>
                <Button appearance='primary' type='submit' disabled={isTraySubmitting}>
                  {isTraySubmitting ? 'Saving...' : 'Save'}
                </Button>
              </DialogActions>
            </DialogBody>
          </form>
        </DialogSurface>
      </Dialog>

      <Dialog
        open={isSupportDialogOpen}
        onOpenChange={(_, data) => {
          if (!data.open) {
            closeSupportDialog();
          }
        }}
      >
        <DialogSurface>
          <form onSubmit={handleSupportSubmit}>
            <DialogBody>
              <DialogTitle>
                {supportDialogMode === 'create'
                  ? 'Add support'
                  : `Edit support${editingSupport ? `: ${editingSupport.type}` : ''}`}
              </DialogTitle>
              <DialogContent>
                <Field
                  label='Type'
                  required
                  validationState={supportFormErrors.type ? 'error' : undefined}
                  validationMessage={supportFormErrors.type}
                >
                  <Input
                    value={supportForm.type}
                    onChange={handleSupportFieldChange('type')}
                    required
                  />
                </Field>
                <Field
                  label='Height [mm]'
                  validationState={supportFormErrors.heightMm ? 'error' : undefined}
                  validationMessage={supportFormErrors.heightMm}
                >
                  <Input
                    value={supportForm.heightMm}
                    onChange={handleSupportFieldChange('heightMm')}
                  />
                </Field>
                <Field
                  label='Width [mm]'
                  validationState={supportFormErrors.widthMm ? 'error' : undefined}
                  validationMessage={supportFormErrors.widthMm}
                >
                  <Input
                    value={supportForm.widthMm}
                    onChange={handleSupportFieldChange('widthMm')}
                  />
                </Field>
                <Field
                  label='Length [mm]'
                  validationState={supportFormErrors.lengthMm ? 'error' : undefined}
                  validationMessage={supportFormErrors.lengthMm}
                >
                  <Input
                    value={supportForm.lengthMm}
                    onChange={handleSupportFieldChange('lengthMm')}
                  />
                </Field>
                <Field
                  label='Weight [kg]'
                  validationState={supportFormErrors.weightKg ? 'error' : undefined}
                  validationMessage={supportFormErrors.weightKg}
                >
                  <Input
                    value={supportForm.weightKg}
                    onChange={handleSupportFieldChange('weightKg')}
                  />
                </Field>
              </DialogContent>
              <DialogActions className={styles.dialogActions}>
                <Button appearance='secondary' onClick={closeSupportDialog}>
                  Cancel
                </Button>
                <Button appearance='primary' type='submit' disabled={isSupportSubmitting}>
                  {isSupportSubmitting ? 'Saving...' : 'Save'}
                </Button>
              </DialogActions>
            </DialogBody>
          </form>
        </DialogSurface>
      </Dialog>
    </section>
  );
};
