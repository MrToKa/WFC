import type { ChangeEvent, FormEvent } from 'react';
import { useCallback, useEffect, useState } from 'react';
import {
  ApiError,
  MaterialLoadCurve,
  MaterialLoadCurveInput,
  MaterialLoadCurveUpdateInput,
  PaginationMeta,
  createMaterialLoadCurve,
  deleteMaterialLoadCurve,
  fetchMaterialLoadCurves,
  updateMaterialLoadCurve
} from '@/api/client';
import {
  LoadCurveFormErrors,
  LoadCurveFormState,
  initialLoadCurveForm,
  PAGE_SIZE
} from '../Materials.types';
import { normalizePagination } from '../Materials.utils';

type ShowToast = (props: {
  intent: 'success' | 'error' | 'warning' | 'info';
  title: string;
  body?: string;
}) => void;

type UseLoadCurvesParams = {
  token: string | null;
  isAdmin: boolean;
  showToast: ShowToast;
};

const validateLoadCurveForm = (form: LoadCurveFormState): LoadCurveFormErrors => {
  const nextErrors: LoadCurveFormErrors = {};

  if (!form.name.trim()) {
    nextErrors.name = 'Name is required';
  }

  return nextErrors;
};

const buildLoadCurvePayload = (form: LoadCurveFormState): MaterialLoadCurveInput => ({
  name: form.name.trim(),
  description: form.description.trim() === '' ? null : form.description.trim()
});

export const useLoadCurves = ({ token, isAdmin, showToast }: UseLoadCurvesParams) => {
  const [loadCurves, setLoadCurves] = useState<MaterialLoadCurve[]>([]);
  const [loadCurvePagination, setLoadCurvePagination] = useState<PaginationMeta | null>(null);
  const [loadCurvePage, setLoadCurvePage] = useState<number>(1);
  const [loadCurvesError, setLoadCurvesError] = useState<string | null>(null);
  const [isLoadingLoadCurves, setIsLoadingLoadCurves] = useState<boolean>(true);
  const [isRefreshingLoadCurves, setIsRefreshingLoadCurves] = useState<boolean>(false);
  const [loadCurvePendingId, setLoadCurvePendingId] = useState<string | null>(null);

  const [isLoadCurveDialogOpen, setIsLoadCurveDialogOpen] = useState<boolean>(false);
  const [loadCurveDialogMode, setLoadCurveDialogMode] = useState<'create' | 'edit'>('create');
  const [editingLoadCurve, setEditingLoadCurve] = useState<MaterialLoadCurve | null>(null);
  const [loadCurveForm, setLoadCurveForm] = useState<LoadCurveFormState>(initialLoadCurveForm);
  const [loadCurveFormErrors, setLoadCurveFormErrors] = useState<LoadCurveFormErrors>({});
  const [isLoadCurveSubmitting, setIsLoadCurveSubmitting] = useState<boolean>(false);

  const loadLoadCurves = useCallback(
    async (page: number, options?: { silent?: boolean }) => {
      if (options?.silent) {
        setIsRefreshingLoadCurves(true);
      } else {
        setIsLoadingLoadCurves(true);
      }
      setLoadCurvesError(null);

      try {
        const result = await fetchMaterialLoadCurves({ page, pageSize: PAGE_SIZE });

        if (result.pagination.totalItems === 0 && page !== 1) {
          setLoadCurvePage(1);
          return;
        }

        if (
          result.pagination.totalItems > 0 &&
          result.pagination.totalPages > 0 &&
          page > result.pagination.totalPages
        ) {
          setLoadCurvePage(result.pagination.totalPages);
          return;
        }

        setLoadCurves(result.loadCurves);
        setLoadCurvePagination(normalizePagination(result.pagination));
      } catch (error) {
        console.error('Fetch material load curves failed', error);
        setLoadCurvesError('Failed to load load curves. Please try again.');
      } finally {
        if (options?.silent) {
          setIsRefreshingLoadCurves(false);
        } else {
          setIsLoadingLoadCurves(false);
        }
      }
    },
    []
  );

  useEffect(() => {
    void loadLoadCurves(loadCurvePage);
  }, [loadLoadCurves, loadCurvePage]);

  const openLoadCurveCreateDialog = useCallback(() => {
    if (!isAdmin) {
      showToast({
        intent: 'error',
        title: 'Admin access required',
        body: 'Only administrators can create load curves.'
      });
      return;
    }
    setLoadCurveDialogMode('create');
    setEditingLoadCurve(null);
    setLoadCurveForm(initialLoadCurveForm);
    setLoadCurveFormErrors({});
    setIsLoadCurveDialogOpen(true);
  }, [isAdmin, showToast]);

  const openLoadCurveEditDialog = useCallback(
    (loadCurve: MaterialLoadCurve) => {
      if (!isAdmin) {
        showToast({
          intent: 'error',
          title: 'Admin access required',
          body: 'Only administrators can edit load curves.'
        });
        return;
      }
      setLoadCurveDialogMode('edit');
      setEditingLoadCurve(loadCurve);
      setLoadCurveForm({
        name: loadCurve.name,
        description: loadCurve.description ?? ''
      });
      setLoadCurveFormErrors({});
      setIsLoadCurveDialogOpen(true);
    },
    [isAdmin, showToast]
  );

  const closeLoadCurveDialog = useCallback(() => {
    setIsLoadCurveDialogOpen(false);
    setLoadCurveDialogMode('create');
    setEditingLoadCurve(null);
    setLoadCurveForm(initialLoadCurveForm);
    setLoadCurveFormErrors({});
  }, []);

  const handleLoadCurveFieldChange = useCallback(
    (field: keyof LoadCurveFormState) =>
      (_event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>, data: { value: string }) => {
        setLoadCurveForm((previous) => ({ ...previous, [field]: data.value }));
        setLoadCurveFormErrors((previous) => ({ ...previous, [field]: undefined }));
      },
    []
  );

  const handleLoadCurveSubmit = useCallback(
    async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();

      if (!isAdmin || !token) {
        showToast({
          intent: 'error',
          title: 'Admin access required',
          body: 'You need to be signed in as an admin to save load curves.'
        });
        return;
      }

      const validationResult = validateLoadCurveForm(loadCurveForm);
      const hasErrors = Object.keys(validationResult).length > 0;
      if (hasErrors) {
        setLoadCurveFormErrors(validationResult);
        return;
      }

      setIsLoadCurveSubmitting(true);
      try {
        if (loadCurveDialogMode === 'create') {
          const payload = buildLoadCurvePayload(loadCurveForm);
          await createMaterialLoadCurve(token, payload);
          showToast({ intent: 'success', title: 'Load curve created' });
          closeLoadCurveDialog();
          setLoadCurvePage(1);
          await loadLoadCurves(1, { silent: true });
        } else if (editingLoadCurve) {
          const payload: MaterialLoadCurveUpdateInput = buildLoadCurvePayload(loadCurveForm);
          await updateMaterialLoadCurve(token, editingLoadCurve.id, payload);
          showToast({ intent: 'success', title: 'Load curve updated' });
          closeLoadCurveDialog();
          await loadLoadCurves(loadCurvePage, { silent: true });
        }
      } catch (error) {
        console.error('Save material load curve failed', error);
        if (error instanceof ApiError && error.status === 409) {
          setLoadCurveFormErrors((previous) => ({
            ...previous,
            name: 'A load curve with this name already exists'
          }));
        } else {
          showToast({
            intent: 'error',
            title: 'Failed to save load curve',
            body: 'Please try again.'
          });
        }
      } finally {
        setIsLoadCurveSubmitting(false);
      }
    },
    [
      isAdmin,
      token,
      showToast,
      loadCurveForm,
      loadCurveDialogMode,
      editingLoadCurve,
      closeLoadCurveDialog,
      loadLoadCurves,
      loadCurvePage
    ]
  );

  const handleLoadCurveDelete = useCallback(
    async (loadCurve: MaterialLoadCurve) => {
      if (!isAdmin || !token) {
        showToast({
          intent: 'error',
          title: 'Admin access required',
          body: 'You need to be signed in as an admin to delete load curves.'
        });
        return;
      }

      const confirmed = window.confirm(
        `Delete load curve '${loadCurve.name}'? This action cannot be undone.`
      );
      if (!confirmed) {
        return;
      }

      setLoadCurvePendingId(loadCurve.id);
      try {
        await deleteMaterialLoadCurve(token, loadCurve.id);
        showToast({ intent: 'success', title: 'Load curve deleted' });

        if (
          loadCurves.length === 1 &&
          loadCurvePagination &&
          loadCurvePagination.totalItems > 0 &&
          loadCurvePagination.page > 1
        ) {
          setLoadCurvePage(loadCurvePagination.page - 1);
        } else {
          await loadLoadCurves(loadCurvePage, { silent: true });
        }
      } catch (error) {
        console.error('Delete material load curve failed', error);
        showToast({
          intent: 'error',
          title: 'Failed to delete load curve',
          body: 'Please try again.'
        });
      } finally {
        setLoadCurvePendingId(null);
      }
    },
    [
      isAdmin,
      token,
      showToast,
      loadCurves.length,
      loadCurvePagination,
      loadLoadCurves,
      loadCurvePage
    ]
  );

  return {
    loadCurves,
    loadCurvePagination,
    loadCurvePage,
    setLoadCurvePage,
    loadCurvesError,
    isLoadingLoadCurves,
    isRefreshingLoadCurves,
    loadCurvePendingId,
    isLoadCurveDialogOpen,
    loadCurveDialogMode,
    editingLoadCurve,
    loadCurveForm,
    loadCurveFormErrors,
    isLoadCurveSubmitting,
    loadLoadCurves,
    openLoadCurveCreateDialog,
    openLoadCurveEditDialog,
    closeLoadCurveDialog,
    handleLoadCurveFieldChange,
    handleLoadCurveSubmit,
    handleLoadCurveDelete
  };
};
