import type { ChangeEvent, FormEvent } from 'react';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { OptionOnSelectData } from '@fluentui/react-components';
import {
  ApiError,
  MaterialLoadCurveSummary,
  MaterialTray,
  PaginationMeta,
  createMaterialTray,
  deleteMaterialTray,
  exportMaterialTrays,
  fetchMaterialTrays,
  fetchMaterialLoadCurveSummaries,
  importMaterialTrays,
  updateMaterialTray
} from '@/api/client';
import { TrayFormErrors, TrayFormState, initialTrayForm, PAGE_SIZE } from '../Materials.types';
import { buildTimestampedFileName, downloadBlob, normalizePagination, parseNumberInput, toFormValue } from '../Materials.utils';

type ShowToast = (props: {
  intent: 'success' | 'error' | 'warning' | 'info';
  title: string;
  body?: string;
}) => void;

type UseTraysParams = {
  token: string | null;
  isAdmin: boolean;
  showToast: ShowToast;
};

export const useTrays = ({ token, isAdmin, showToast }: UseTraysParams) => {
  const [trays, setTrays] = useState<MaterialTray[]>([]);
  const [trayPagination, setTrayPagination] = useState<PaginationMeta | null>(null);
  const [trayPage, setTrayPage] = useState<number>(1);
  const [traysError, setTraysError] = useState<string | null>(null);
  const [isLoadingTrays, setIsLoadingTrays] = useState<boolean>(true);
  const [isRefreshingTrays, setIsRefreshingTrays] = useState<boolean>(false);
  const [isExportingTrays, setIsExportingTrays] = useState<boolean>(false);
  const [isImportingTrays, setIsImportingTrays] = useState<boolean>(false);
  const [trayPendingId, setTrayPendingId] = useState<string | null>(null);

  const [isTrayDialogOpen, setIsTrayDialogOpen] = useState<boolean>(false);
  const [trayDialogMode, setTrayDialogMode] = useState<'create' | 'edit'>('create');
  const [editingTray, setEditingTray] = useState<MaterialTray | null>(null);
  const [trayForm, setTrayForm] = useState<TrayFormState>(initialTrayForm);
  const [trayFormErrors, setTrayFormErrors] = useState<TrayFormErrors>({});
  const [isTraySubmitting, setIsTraySubmitting] = useState<boolean>(false);

  const [isTrayLoadCurveDialogOpen, setIsTrayLoadCurveDialogOpen] = useState<boolean>(false);
  const [trayLoadCurveTray, setTrayLoadCurveTray] = useState<MaterialTray | null>(null);
  const [trayLoadCurveSelection, setTrayLoadCurveSelection] = useState<string>('');
  const [trayLoadCurveSummaries, setTrayLoadCurveSummaries] = useState<
    MaterialLoadCurveSummary[]
  >([]);
  const [isLoadingTrayLoadCurves, setIsLoadingTrayLoadCurves] = useState<boolean>(false);
  const [isSubmittingTrayLoadCurve, setIsSubmittingTrayLoadCurve] = useState<boolean>(false);
  const [trayLoadCurveError, setTrayLoadCurveError] = useState<string | null>(null);
  const [trayLoadCurvePendingId, setTrayLoadCurvePendingId] = useState<string | null>(null);

  const trayFileInputRef = useRef<HTMLInputElement | null>(null);

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

  useEffect(() => {
    void loadTrays(trayPage);
  }, [trayPage, loadTrays]);

  const loadTrayLoadCurves = useCallback(async () => {
    setTrayLoadCurveError(null);
    setIsLoadingTrayLoadCurves(true);
    try {
      const result = await fetchMaterialLoadCurveSummaries();
      setTrayLoadCurveSummaries(result.loadCurves);
    } catch (error) {
      console.error('Fetch material load curve summaries failed', error);
      setTrayLoadCurveSummaries([]);
      setTrayLoadCurveError('Failed to load load curves. Please try again.');
    } finally {
      setIsLoadingTrayLoadCurves(false);
    }
  }, []);

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
      manufacturer: tray.manufacturer ?? '',
      heightMm: toFormValue(tray.heightMm),
      rungHeightMm: toFormValue(tray.rungHeightMm),
      widthMm: toFormValue(tray.widthMm),
      weightKgPerM: toFormValue(tray.weightKgPerM),
      imageTemplateId: tray.imageTemplateId
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

  const openTrayLoadCurveDialog = useCallback(
    (tray: MaterialTray) => {
      if (!isAdmin) {
        showToast({
          intent: 'error',
          title: 'Admin access required',
          body: 'You need to be signed in as an admin to assign load curves.'
        });
        return;
      }
      setTrayLoadCurveTray(tray);
      setTrayLoadCurveSelection(tray.loadCurveId ?? '');
      setTrayLoadCurveError(null);
      setIsTrayLoadCurveDialogOpen(true);
      void loadTrayLoadCurves();
    },
    [isAdmin, loadTrayLoadCurves, showToast]
  );

  const closeTrayLoadCurveDialog = useCallback(() => {
    setIsTrayLoadCurveDialogOpen(false);
    setTrayLoadCurveTray(null);
    setTrayLoadCurveSelection('');
    setTrayLoadCurveSummaries([]);
    setTrayLoadCurveError(null);
  }, []);

  const handleTrayLoadCurveChange = useCallback(
    (_event: unknown, data: OptionOnSelectData) => {
      setTrayLoadCurveSelection(data.optionValue ?? '');
      setTrayLoadCurveError(null);
    },
    []
  );

  const handleTrayLoadCurveSubmit = useCallback(
    async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();

      if (!isAdmin || !token) {
        showToast({
          intent: 'error',
          title: 'Admin access required',
          body: 'You need to be signed in as an admin to assign load curves.'
        });
        return;
      }

      if (!trayLoadCurveTray) {
        return;
      }

      const currentSelection = trayLoadCurveTray.loadCurveId ?? '';
      if (trayLoadCurveSelection === currentSelection) {
        closeTrayLoadCurveDialog();
        return;
      }

      setIsSubmittingTrayLoadCurve(true);
      setTrayLoadCurvePendingId(trayLoadCurveTray.id);
      try {
        await updateMaterialTray(token, trayLoadCurveTray.id, {
          loadCurveId: trayLoadCurveSelection === '' ? null : trayLoadCurveSelection
        });

        showToast({
          intent: 'success',
          title: trayLoadCurveSelection ? 'Load curve assigned to tray' : 'Load curve unassigned'
        });
        await loadTrays(trayPage, { silent: true });
        closeTrayLoadCurveDialog();
      } catch (error) {
        console.error('Update tray load curve assignment failed', error);
        setTrayLoadCurveError('Failed to update load curve assignment. Please try again.');
        if (error instanceof ApiError && (error.status === 400 || error.status === 404)) {
          showToast({
            intent: 'error',
            title: 'Load curve not found',
            body: 'Refresh and try again.'
          });
        } else {
          showToast({
            intent: 'error',
            title: 'Failed to update load curve assignment',
            body: 'Please try again.'
          });
        }
      } finally {
        setIsSubmittingTrayLoadCurve(false);
        setTrayLoadCurvePendingId(null);
      }
    },
    [
      closeTrayLoadCurveDialog,
      isAdmin,
      loadTrays,
      showToast,
      token,
      trayLoadCurveSelection,
      trayLoadCurveTray,
      trayPage
    ]
  );

  const handleTrayFieldChange = useCallback(
    (field: keyof TrayFormState) =>
      (_event: ChangeEvent<HTMLInputElement>, data: { value: string }) => {
        setTrayForm((previous) => ({ ...previous, [field]: data.value }));
        setTrayFormErrors((previous) => ({ ...previous, [field]: undefined }));
      },
    []
  );

  const handleTrayImageTemplateChange = useCallback((templateId: string | null) => {
    setTrayForm((previous) => ({ ...previous, imageTemplateId: templateId }));
    setTrayFormErrors((previous) => ({ ...previous, imageTemplateId: undefined }));
  }, []);

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

      const rungHeightResult = parseNumberInput(trayForm.rungHeightMm);
      if (rungHeightResult.error) {
        errors.rungHeightMm = rungHeightResult.error;
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

      const manufacturer = trayForm.manufacturer.trim();
      const nextManufacturer = manufacturer === '' ? null : manufacturer;

      setIsTraySubmitting(true);

      const imageTemplateId = trayForm.imageTemplateId ?? null;

      try {
        if (trayDialogMode === 'create') {
          await createMaterialTray(token, {
            type,
            manufacturer: nextManufacturer,
            heightMm: heightResult.numeric,
            rungHeightMm: rungHeightResult.numeric,
            widthMm: widthResult.numeric,
            weightKgPerM: weightResult.numeric,
            imageTemplateId
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
            manufacturer: nextManufacturer,
            heightMm: heightResult.numeric,
            rungHeightMm: rungHeightResult.numeric,
            widthMm: widthResult.numeric,
            weightKgPerM: weightResult.numeric,
            imageTemplateId
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
        } else if (error instanceof ApiError && error.status === 400) {
          showToast({
            intent: 'error',
            title: 'Failed to save tray',
            body: error.message
          });
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
    [isAdmin, loadTrays, showToast, token, trayPage, trayPagination, trays]
  );

  return {
    trays,
    trayPagination,
    trayPage,
    setTrayPage,
    traysError,
    isLoadingTrays,
    isRefreshingTrays,
    isExportingTrays,
    isImportingTrays,
    trayPendingId,
    trayFileInputRef,
    isTrayDialogOpen,
    trayDialogMode,
    editingTray,
    trayForm,
    trayFormErrors,
    isTraySubmitting,
    isTrayLoadCurveDialogOpen,
    trayLoadCurveTray,
    trayLoadCurveSelection,
    trayLoadCurveSummaries,
    isLoadingTrayLoadCurves,
    isSubmittingTrayLoadCurve,
    trayLoadCurveError,
    trayLoadCurvePendingId,
    loadTrays,
    loadTrayLoadCurves,
    openTrayCreateDialog,
    openTrayEditDialog,
    closeTrayDialog,
    openTrayLoadCurveDialog,
    closeTrayLoadCurveDialog,
    handleTrayLoadCurveChange,
    handleTrayLoadCurveSubmit,
    handleTrayFieldChange,
    handleTrayImageTemplateChange,
    handleTraySubmit,
    handleTrayImportClick,
    handleTrayImportChange,
    handleExportTrays,
    handleTrayDelete
  };
};
