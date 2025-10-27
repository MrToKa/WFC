import type { ChangeEvent } from 'react';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ApiError,
  MaterialSupport,
  PaginationMeta,
  createMaterialSupport,
  deleteMaterialSupport,
  exportMaterialSupports,
  fetchMaterialSupports,
  importMaterialSupports,
  updateMaterialSupport
} from '@/api/client';
import { SupportFormErrors, SupportFormState, initialSupportForm, PAGE_SIZE } from '../Materials.types';
import { buildTimestampedFileName, downloadBlob, normalizePagination, parseNumberInput, toFormValue } from '../Materials.utils';

type ShowToast = (props: {
  intent: 'success' | 'error' | 'warning' | 'info';
  title: string;
  body?: string;
}) => void;

type UseSupportsParams = {
  token: string | null;
  isAdmin: boolean;
  showToast: ShowToast;
};

export const useSupports = ({ token, isAdmin, showToast }: UseSupportsParams) => {
  const [supports, setSupports] = useState<MaterialSupport[]>([]);
  const [supportPagination, setSupportPagination] = useState<PaginationMeta | null>(null);
  const [supportPage, setSupportPage] = useState<number>(1);
  const [supportsError, setSupportsError] = useState<string | null>(null);
  const [isLoadingSupports, setIsLoadingSupports] = useState<boolean>(true);
  const [isRefreshingSupports, setIsRefreshingSupports] = useState<boolean>(false);
  const [isExportingSupports, setIsExportingSupports] = useState<boolean>(false);
  const [isImportingSupports, setIsImportingSupports] = useState<boolean>(false);
  const [supportPendingId, setSupportPendingId] = useState<string | null>(null);

  const [isSupportDialogOpen, setIsSupportDialogOpen] = useState<boolean>(false);
  const [supportDialogMode, setSupportDialogMode] = useState<'create' | 'edit'>('create');
  const [editingSupport, setEditingSupport] = useState<MaterialSupport | null>(null);
  const [supportForm, setSupportForm] = useState<SupportFormState>(initialSupportForm);
  const [supportFormErrors, setSupportFormErrors] = useState<SupportFormErrors>({});
  const [isSupportSubmitting, setIsSupportSubmitting] = useState<boolean>(false);

  const supportFileInputRef = useRef<HTMLInputElement | null>(null);

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
    void loadSupports(supportPage);
  }, [supportPage, loadSupports]);

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

  const handleSupportFieldChange = useCallback(
    (field: keyof SupportFormState) =>
      (_event: ChangeEvent<HTMLInputElement>, data: { value: string }) => {
        setSupportForm((previous) => ({ ...previous, [field]: data.value }));
        setSupportFormErrors((previous) => ({ ...previous, [field]: undefined }));
      },
    []
  );

  const handleSupportSubmit = useCallback(
    async (event: React.FormEvent<HTMLFormElement>) => {
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
    [isAdmin, loadSupports, showToast, supportPage, supportPagination, supports, token]
  );

  return {
    supports,
    supportPagination,
    supportPage,
    setSupportPage,
    supportsError,
    isLoadingSupports,
    isRefreshingSupports,
    isExportingSupports,
    isImportingSupports,
    supportPendingId,
    supportFileInputRef,
    isSupportDialogOpen,
    supportDialogMode,
    editingSupport,
    supportForm,
    supportFormErrors,
    isSupportSubmitting,
    loadSupports,
    openSupportCreateDialog,
    openSupportEditDialog,
    closeSupportDialog,
    handleSupportFieldChange,
    handleSupportSubmit,
    handleSupportImportClick,
    handleSupportImportChange,
    handleExportSupports,
    handleSupportDelete
  };
};
