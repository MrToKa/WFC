import type { ChangeEvent, FormEvent } from 'react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Body1,
  Button,
  Spinner,
  Tab,
  TabList,
  TabValue,
  Title3
} from '@fluentui/react-components';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import {
  ApiError,
  CableImportSummary,
  Cable,
  CableInput,
  CableType,
  Tray,
  Project,
  createCable,
  createCableType,
  createTray,
  deleteCable,
  deleteCableType,
  deleteTray,
  exportCables,
  exportCableTypes,
  exportTrays,
  fetchCables,
  fetchCableTypes,
  fetchTrays,
  fetchProject,
  importCables,
  importCableTypes,
  importTrays,
  updateCable,
  updateCableType,
  updateTray
} from '@/api/client';
import { useAuth } from '@/context/AuthContext';
import { useToast } from '@/context/ToastContext';
import { useProjectDetailsStyles } from './ProjectDetails.styles';
import {
  buildCableInput,
  buildCableTypeInput,
  buildTrayInput,
  CABLE_LIST_PER_PAGE,
  CABLE_TYPES_PER_PAGE,
  TRAYS_PER_PAGE,
  CableFormErrors,
  CableFormState,
  CableTypeFormErrors,
  CableTypeFormState,
  ProjectDetailsTab,
  TrayFormErrors,
  TrayFormState,
  emptyCableForm,
  emptyCableTypeForm,
  emptyTrayForm,
  parseCableFormErrors,
  parseCableTypeApiErrors,
  parseTrayApiErrors,
  toCableFormState,
  toCableTypeFormState,
  toTrayFormState
} from './ProjectDetails.forms';
import {
  formatNumeric,
  sanitizeFileSegment,
  toNullableString
} from './ProjectDetails.utils';
import { CableDialog } from './ProjectDetails/CableDialog';
import { CableListTab } from './ProjectDetails/CableListTab';
import { CableTypeDialog } from './ProjectDetails/CableTypeDialog';
import { CableTypesTab } from './ProjectDetails/CableTypesTab';
import { DetailsTab } from './ProjectDetails/DetailsTab';
import { TrayDialog } from './ProjectDetails/TrayDialog';
import { TraysTab } from './ProjectDetails/TraysTab';


export const ProjectDetails = () => {
  const styles = useProjectDetailsStyles();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { projectId } = useParams<{ projectId: string }>();
  const { user, token } = useAuth();
  const { showToast } = useToast();

  const isAdmin = Boolean(user?.isAdmin);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const cablesFileInputRef = useRef<HTMLInputElement | null>(null);
  const traysFileInputRef = useRef<HTMLInputElement | null>(null);

  const [project, setProject] = useState<Project | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedTab, setSelectedTab] = useState<ProjectDetailsTab>(() => {
    const tabParam = searchParams.get('tab');
    return tabParam === 'details' ||
      tabParam === 'cables' ||
      tabParam === 'cable-list' ||
      tabParam === 'trays'
      ? (tabParam as ProjectDetailsTab)
      : 'details';
  });

  const [cableTypes, setCableTypes] = useState<CableType[]>([]);
  const [cableTypesLoading, setCableTypesLoading] = useState<boolean>(true);
  const [cableTypesRefreshing, setCableTypesRefreshing] =
    useState<boolean>(false);
  const [cableTypesError, setCableTypesError] = useState<string | null>(null);
  const [isImporting, setIsImporting] = useState<boolean>(false);
  const [isExporting, setIsExporting] = useState<boolean>(false);
  const [pendingCableTypeId, setPendingCableTypeId] = useState<string | null>(
    null
  );
  const [cablePage, setCablePage] = useState<number>(1);

  const [isCableTypeDialogOpen, setCableTypeDialogOpen] =
    useState<boolean>(false);
  const [cableTypeDialogMode, setCableTypeDialogMode] = useState<
    'create' | 'edit'
  >('create');
  const [cableTypeDialogValues, setCableTypeDialogValues] =
    useState<CableTypeFormState>(emptyCableTypeForm);
  const [cableTypeDialogErrors, setCableTypeDialogErrors] =
    useState<CableTypeFormErrors>({});
  const [cableTypeDialogSubmitting, setCableTypeDialogSubmitting] =
    useState<boolean>(false);
  const [editingCableTypeId, setEditingCableTypeId] = useState<string | null>(
    null
  );

  const [cables, setCables] = useState<Cable[]>([]);
  const [cablesLoading, setCablesLoading] = useState<boolean>(true);
  const [cablesRefreshing, setCablesRefreshing] = useState<boolean>(false);
  const [cablesError, setCablesError] = useState<string | null>(null);
  const [cablesImporting, setCablesImporting] = useState<boolean>(false);
  const [cablesExporting, setCablesExporting] = useState<boolean>(false);
  const [pendingCableId, setPendingCableId] = useState<string | null>(null);
  const [cablesPage, setCablesPage] = useState<number>(1);

  const [isCableDialogOpen, setCableDialogOpen] = useState<boolean>(false);
  const [cableDialogMode, setCableDialogMode] = useState<'create' | 'edit'>(
    'create'
  );
  const [cableDialogValues, setCableDialogValues] =
    useState<CableFormState>(emptyCableForm);
  const [cableDialogErrors, setCableDialogErrors] =
    useState<CableFormErrors>({});
  const [cableDialogSubmitting, setCableDialogSubmitting] =
    useState<boolean>(false);
  const [editingCableId, setEditingCableId] = useState<string | null>(null);
  const [trays, setTrays] = useState<Tray[]>([]);
  const [traysLoading, setTraysLoading] = useState<boolean>(true);
  const [traysRefreshing, setTraysRefreshing] = useState<boolean>(false);
  const [traysError, setTraysError] = useState<string | null>(null);
  const [traysImporting, setTraysImporting] = useState<boolean>(false);
  const [traysExporting, setTraysExporting] = useState<boolean>(false);
  const [pendingTrayId, setPendingTrayId] = useState<string | null>(null);
  const [traysPage, setTraysPage] = useState<number>(1);
  const [isTrayDialogOpen, setTrayDialogOpen] = useState<boolean>(false);
  const [trayDialogMode, setTrayDialogMode] = useState<'create' | 'edit'>(
    'create'
  );
  const [trayDialogValues, setTrayDialogValues] =
    useState<TrayFormState>(emptyTrayForm);
  const [trayDialogErrors, setTrayDialogErrors] =
    useState<TrayFormErrors>({});
  const [trayDialogSubmitting, setTrayDialogSubmitting] =
    useState<boolean>(false);
  const [editingTrayId, setEditingTrayId] = useState<string | null>(null);
  const [inlineEditingEnabled, setInlineEditingEnabled] =
    useState<boolean>(false);
  const [cableDrafts, setCableDrafts] = useState<
    Record<string, CableFormState>
  >({});
  const [inlineUpdatingIds, setInlineUpdatingIds] = useState<Set<string>>(
    new Set()
  );

  const sortCableTypes = useCallback(
    (types: CableType[]) =>
      [...types].sort((a, b) =>
        a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })
      ),
    []
  );

  const sortCables = useCallback(
    (items: Cable[]) =>
      [...items].sort((a, b) =>
        a.cableId.localeCompare(b.cableId, undefined, {
          sensitivity: 'base'
        })
      ),
    []
  );

  const sortTrays = useCallback(
    (items: Tray[]) =>
      [...items].sort((a, b) =>
        a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })
      ),
    []
  );


  const totalCablePages = useMemo(() => {
    if (cableTypes.length === 0) {
      return 1;
    }
    return Math.max(1, Math.ceil(cableTypes.length / CABLE_TYPES_PER_PAGE));
  }, [cableTypes.length]);

  const pagedCableTypes = useMemo(() => {
    if (cableTypes.length === 0) {
      return [];
    }
    const startIndex = (cablePage - 1) * CABLE_TYPES_PER_PAGE;
    return cableTypes.slice(startIndex, startIndex + CABLE_TYPES_PER_PAGE);
  }, [cableTypes, cablePage]);

  const showPagination = cableTypes.length > CABLE_TYPES_PER_PAGE;

  useEffect(() => {
    const totalPages = Math.max(
      1,
      Math.ceil(cableTypes.length / CABLE_TYPES_PER_PAGE)
    );
    if (cablePage > totalPages) {
      setCablePage(totalPages);
    }
  }, [cableTypes.length, cablePage]);

  const totalCableListPages = useMemo(() => {
    if (cables.length === 0) {
      return 1;
    }
    return Math.max(1, Math.ceil(cables.length / CABLE_LIST_PER_PAGE));
  }, [cables.length]);

  const pagedCables = useMemo(() => {
    if (cables.length === 0) {
      return [];
    }
    const startIndex = (cablesPage - 1) * CABLE_LIST_PER_PAGE;
    return cables.slice(startIndex, startIndex + CABLE_LIST_PER_PAGE);
  }, [cables, cablesPage]);

  const showCablePagination = cables.length > CABLE_LIST_PER_PAGE;

  const totalTrayPages = useMemo(() => {
    if (trays.length === 0) {
      return 1;
    }
    return Math.max(1, Math.ceil(trays.length / TRAYS_PER_PAGE));
  }, [trays.length]);

  const pagedTrays = useMemo(() => {
    if (trays.length === 0) {
      return [];
    }
    const startIndex = (traysPage - 1) * TRAYS_PER_PAGE;
    return trays.slice(startIndex, startIndex + TRAYS_PER_PAGE);
  }, [trays, traysPage]);

  const showTrayPagination = trays.length > TRAYS_PER_PAGE;

  const handleCableTypesPreviousPage = useCallback(() => {
    setCablePage((previous) => Math.max(1, previous - 1));
  }, []);

  const handleCableTypesNextPage = useCallback(() => {
    setCablePage((previous) => Math.min(totalCablePages, previous + 1));
  }, [totalCablePages]);

  const handleCablesPreviousPage = useCallback(() => {
    setCablesPage((previous) => Math.max(1, previous - 1));
  }, []);

  const handleCablesNextPage = useCallback(() => {
    setCablesPage((previous) => Math.min(totalCableListPages, previous + 1));
  }, [totalCableListPages]);

  const handleTraysPreviousPage = useCallback(() => {
    setTraysPage((previous) => Math.max(1, previous - 1));
  }, []);

  const handleTraysNextPage = useCallback(() => {
    setTraysPage((previous) => Math.min(totalTrayPages, previous + 1));
  }, [totalTrayPages]);

  useEffect(() => {
    const totalPages = Math.max(
      1,
      Math.ceil(cables.length / CABLE_LIST_PER_PAGE)
    );
    if (cablesPage > totalPages) {
      setCablesPage(totalPages);
    }
  }, [cables.length, cablesPage]);

  useEffect(() => {
    const totalPages = Math.max(1, Math.ceil(trays.length / TRAYS_PER_PAGE));
    if (traysPage > totalPages) {
      setTraysPage(totalPages);
    }
  }, [trays.length, traysPage]);

  useEffect(() => {
    const loadProject = async () => {
      if (!projectId) {
        setError('Project not found.');
        setIsLoading(false);
        return;
      }

      setIsLoading(true);
      setError(null);

      try {
        const response = await fetchProject(projectId);
        setProject(response.project);
      } catch (err) {
        console.error('Failed to load project', err);
        const message =
          err instanceof ApiError
            ? err.status === 404
              ? 'Project not found.'
              : err.message
            : 'Failed to load project.';
        setError(message);
      } finally {
        setIsLoading(false);
      }
    };

    void loadProject();
  }, [projectId]);

  const loadCableTypes = useCallback(
    async (showSpinner: boolean) => {
      if (!projectId) {
        return;
      }

      if (showSpinner) {
        setCableTypesLoading(true);
      } else {
        setCableTypesRefreshing(true);
      }

      setCableTypesError(null);

      try {
        const response = await fetchCableTypes(projectId);
        setCableTypes(sortCableTypes(response.cableTypes));
        setCablePage(1);
      } catch (err) {
        console.error('Failed to load cable types', err);
        if (err instanceof ApiError) {
          if (err.status === 404) {
            setCableTypes([]);
            setCablePage(1);
            setCableTypesError(
              'Cable types endpoint is unavailable. Ensure the server is running the latest version.'
            );
          } else {
            setCableTypesError(err.message);
          }
        } else {
          setCableTypesError('Failed to load cable types.');
        }
      } finally {
        setCableTypesLoading(false);
        setCableTypesRefreshing(false);
      }
    },
    [projectId, sortCableTypes]
  );

  const loadCables = useCallback(
    async (showSpinner: boolean) => {
      if (!projectId) {
        return;
      }

      if (showSpinner) {
        setCablesLoading(true);
      } else {
        setCablesRefreshing(true);
      }

      setCablesError(null);

      try {
        const response = await fetchCables(projectId);
        setCables(sortCables(response.cables));
        setCablesPage(1);
      } catch (err) {
        console.error('Failed to load cables', err);
        if (err instanceof ApiError) {
          if (err.status === 404) {
            setCables([]);
            setCablesPage(1);
            setCablesError(
              'Cables endpoint is unavailable. Ensure the server is running the latest version.'
            );
          } else {
            setCablesError(err.message);
          }
        } else {
          setCablesError('Failed to load cables.');
        }
      } finally {
        setCablesLoading(false);
        setCablesRefreshing(false);
      }
    },
    [projectId, sortCables]
  );

  const loadTrays = useCallback(
    async (showSpinner: boolean) => {
      if (!projectId) {
        return;
      }

      if (showSpinner) {
        setTraysLoading(true);
      } else {
        setTraysRefreshing(true);
      }

      setTraysError(null);

      try {
        const response = await fetchTrays(projectId);
        setTrays(sortTrays(response.trays));
        setTraysPage(1);
      } catch (err) {
        console.error('Failed to load trays', err);
        if (err instanceof ApiError) {
          if (err.status === 404) {
            setTrays([]);
            setTraysPage(1);
            setTraysError(
              'Trays endpoint is unavailable. Ensure the server is running the latest version.'
            );
          } else {
            setTraysError(err.message);
          }
        } else {
          setTraysError('Failed to load trays.');
        }
      } finally {
        setTraysLoading(false);
        setTraysRefreshing(false);
      }
    },
    [projectId, sortTrays]
  );


  useEffect(() => {
    if (!projectId) {
      return;
    }
    void loadCableTypes(true);
  }, [projectId, loadCableTypes]);

  useEffect(() => {
    if (!projectId) {
      return;
    }
    void loadCables(true);
  }, [projectId, loadCables]);

  useEffect(() => {
    if (!projectId) {
      return;
    }
    void loadTrays(true);
  }, [projectId, loadTrays]);


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

  const formattedDates = useMemo(() => {
    if (!project) {
      return null;
    }

    const format = (value: string) =>
      new Intl.DateTimeFormat(undefined, {
        dateStyle: 'medium',
        timeStyle: 'short'
      }).format(new Date(value));

    return {
      created: format(project.createdAt),
      updated: format(project.updatedAt)
    };
  }, [project]);

  const handleTabSelect = useCallback(
    (_event: unknown, data: { value: TabValue }) => {
      const tab = data.value as ProjectDetailsTab;
      setSelectedTab(tab);
      setSearchParams((previous) => {
        const next = new URLSearchParams(previous);
        if (tab === 'details') {
          next.delete('tab');
        } else {
          next.set('tab', tab);
        }
        return next;
      });
    },
    [setSearchParams]
  );

  useEffect(() => {
    const tabParam = searchParams.get('tab');
    const validTabs: ProjectDetailsTab[] = ['details', 'cables', 'cable-list', 'trays'];
    const nextTab =
      tabParam && validTabs.includes(tabParam as ProjectDetailsTab)
        ? (tabParam as ProjectDetailsTab)
        : 'details';
    if (nextTab !== selectedTab) {
      setSelectedTab(nextTab);
    }
  }, [searchParams, selectedTab]);


  const handleCableTypeDialogFieldChange =
    (field: keyof CableTypeFormState) =>
    (_event: ChangeEvent<HTMLInputElement>, data: { value: string }) => {
      setCableTypeDialogValues((previous) => ({
        ...previous,
        [field]: data.value
      }));
    };

  const handleTrayDialogFieldChange =
    (field: keyof TrayFormState) =>
    (_event: ChangeEvent<HTMLInputElement>, data: { value: string }) => {
      setTrayDialogValues((previous) => ({
        ...previous,
        [field]: data.value
      }));
    };

  const resetCableTypeDialog = useCallback(() => {
    setCableTypeDialogOpen(false);
    setCableTypeDialogErrors({});
    setCableTypeDialogValues(emptyCableTypeForm);
    setCableTypeDialogSubmitting(false);
    setEditingCableTypeId(null);
  }, []);

  const openCreateCableTypeDialog = useCallback(() => {
    setCableTypeDialogMode('create');
    setCableTypeDialogValues(emptyCableTypeForm);
    setCableTypeDialogErrors({});
    setCableTypeDialogOpen(true);
    setEditingCableTypeId(null);
  }, []);

  const openEditCableTypeDialog = useCallback((cableType: CableType) => {
    setCableTypeDialogMode('edit');
    setCableTypeDialogValues(toCableTypeFormState(cableType));
    setCableTypeDialogErrors({});
    setCableTypeDialogOpen(true);
    setEditingCableTypeId(cableType.id);
  }, []);


  const handleSubmitCableTypeDialog = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (!project || !token) {
      setCableTypeDialogErrors({
        general: 'You need to be signed in as an admin to manage cable types.'
      });
      return;
    }

    const { input, errors } = buildCableTypeInput(cableTypeDialogValues);

    if (Object.keys(errors).length > 0) {
      setCableTypeDialogErrors(errors);
      return;
    }

    setCableTypeDialogSubmitting(true);
    setCableTypeDialogErrors({});

    try {
      if (cableTypeDialogMode === 'create') {
        const response = await createCableType(token, project.id, input);
        setCableTypes((previous) =>
          sortCableTypes([...previous, response.cableType])
        );
        setCablePage(1);
        showToast({ intent: 'success', title: 'Cable type created' });
      } else if (editingCableTypeId) {
        const response = await updateCableType(
          token,
          project.id,
          editingCableTypeId,
          input
        );
        setCableTypes((previous) =>
          sortCableTypes(
            previous
              .map((item) =>
                item.id === editingCableTypeId ? response.cableType : item
              )
          )
        );
        showToast({ intent: 'success', title: 'Cable type updated' });
      }
      void loadCables(false);
      resetCableTypeDialog();
    } catch (err) {
      console.error('Save cable type failed', err);
      if (err instanceof ApiError) {
        setCableTypeDialogErrors(parseCableTypeApiErrors(err.payload));
        showToast({
          intent: 'error',
          title: 'Failed to save cable type',
          body: err.message
        });
      } else {
        const message = 'Failed to save cable type. Please try again.';
        setCableTypeDialogErrors({
          general: message
        });
        showToast({
          intent: 'error',
          title: 'Failed to save cable type',
          body: message
        });
      }
    } finally {
      setCableTypeDialogSubmitting(false);
    }
  };

  const handleDeleteCableType = async (cableType: CableType) => {
    if (!project || !token) {
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
      await deleteCableType(token, project.id, cableType.id);
      setCableTypes((previous) => {
        const next = previous.filter((item) => item.id !== cableType.id);
        const totalPages = Math.max(
          1,
          Math.ceil(next.length / CABLE_TYPES_PER_PAGE)
        );
        if (cablePage > totalPages) {
          setCablePage(totalPages);
        }
        return next;
      });
      showToast({ intent: 'success', title: 'Cable type deleted' });
      void loadCables(false);
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
  };

  const handleImportCableTypes = async (
    event: ChangeEvent<HTMLInputElement>
  ) => {
    const file = event.target.files?.[0];

    if (!file) {
      return;
    }

    event.target.value = '';

    if (!project || !token) {
      showToast({
        intent: 'error',
        title: 'Admin access required',
        body: 'You need to be signed in as an admin to import cable types.'
      });
      return;
    }

    setIsImporting(true);

    try {
      const response = await importCableTypes(token, project.id, file);
      setCableTypes(sortCableTypes(response.cableTypes));
      setCablePage(1);
      void loadCables(false);

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
  };

  const handleExportCableTypes = async () => {
    if (!project || !token) {
      showToast({
        intent: 'error',
        title: 'Admin access required',
        body: 'You need to be signed in as an admin to export cable types.'
      });
      return;
    }

    setIsExporting(true);

    try {
      const blob = await exportCableTypes(token, project.id);
      const link = document.createElement('a');
      const url = window.URL.createObjectURL(blob);
      const fileName = `${sanitizeFileSegment(
        project.projectNumber
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
};

  const handleImportTrays = async (
    event: ChangeEvent<HTMLInputElement>
  ) => {
    const file = event.target.files?.[0];

    if (!file) {
      return;
    }

    event.target.value = '';

    if (!project || !token) {
      showToast({
        intent: 'error',
        title: 'Admin access required',
        body: 'You need to be signed in as an admin to import trays.'
      });
      return;
    }

    setTraysImporting(true);

    try {
      const response = await importTrays(token, project.id, file);
      setTrays(sortTrays(response.trays));
      setTraysPage(1);

      const summary: CableImportSummary = response.summary;
      showToast({
        intent: 'success',
        title: 'Trays imported',
        body: summary.inserted + ' added, ' + summary.updated + ' updated, ' + summary.skipped + ' skipped.'
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
      setTraysImporting(false);
    }
  };

  const handleExportTrays = async () => {
    if (!project || !token) {
      showToast({
        intent: 'error',
        title: 'Admin access required',
        body: 'You need to be signed in as an admin to export trays.'
      });
      return;
    }

    setTraysExporting(true);

    try {
      const blob = await exportTrays(token, project.id);
      const link = document.createElement('a');
      const url = window.URL.createObjectURL(blob);
      const fileName = sanitizeFileSegment(project.projectNumber) + '-trays.xlsx';

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
      setTraysExporting(false);
    }
  };

  const handleCableDialogFieldChange =
    (field: keyof CableFormState) =>
    (_event: ChangeEvent<HTMLInputElement>, data: { value: string }) => {
      setCableDialogValues((previous) => ({
        ...previous,
        [field]: data.value
      }));
    };

  const selectedCableType = useMemo(
    () =>
      cableTypes.find(
        (type) => type.id === cableDialogValues.cableTypeId
      ) ?? null,
    [cableTypes, cableDialogValues.cableTypeId]
  );

  const handleCableTypeSelect = (
    _event: unknown,
    data: { optionValue?: string }
  ) => {
    setCableDialogValues((previous) => ({
      ...previous,
      cableTypeId: data.optionValue ?? ''
    }));
  };

  const resetCableDialog = useCallback(() => {
    setCableDialogOpen(false);
    setCableDialogErrors({});
    setCableDialogValues(emptyCableForm);
    setCableDialogSubmitting(false);
    setEditingCableId(null);
  }, []);

  const openCreateCableDialog = useCallback(() => {
    if (cableTypes.length === 0) {
      showToast({
        intent: 'error',
        title: 'Cable type required',
        body: 'Create at least one cable type before adding cables.'
      });
      return;
    }

    setCableDialogMode('create');
    setCableDialogErrors({});
    setCableDialogValues({
      ...emptyCableForm,
      cableTypeId: cableTypes[0]?.id ?? ''
    });
    setCableDialogOpen(true);
    setEditingCableId(null);
  }, [cableTypes, showToast]);

  const openEditCableDialog = useCallback((cable: Cable) => {
    setCableDialogMode('edit');
    setCableDialogErrors({});
    setCableDialogValues(toCableFormState(cable));
    setCableDialogOpen(true);
    setEditingCableId(cable.id);
  }, []);


  const resetTrayDialog = useCallback(() => {
    setTrayDialogOpen(false);
    setTrayDialogErrors({});
    setTrayDialogValues(emptyTrayForm);
    setTrayDialogSubmitting(false);
    setEditingTrayId(null);
  }, []);

  const openCreateTrayDialog = useCallback(() => {
    setTrayDialogMode('create');
    setTrayDialogValues(emptyTrayForm);
    setTrayDialogErrors({});
    setTrayDialogOpen(true);
    setEditingTrayId(null);
  }, []);

  const openEditTrayDialog = useCallback((tray: Tray) => {
    setTrayDialogMode('edit');
    setTrayDialogErrors({});
    setTrayDialogValues(toTrayFormState(tray));
    setTrayDialogOpen(true);
    setEditingTrayId(tray.id);
  }, []);

  const handleSubmitTrayDialog = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (!project || !token) {
      setTrayDialogErrors({
        general: 'You need to be signed in as an admin to manage trays.'
      });
      return;
    }

    const { input, errors } = buildTrayInput(trayDialogValues);

    if (Object.keys(errors).length > 0) {
      setTrayDialogErrors(errors);
      return;
    }

    setTrayDialogSubmitting(true);
    setTrayDialogErrors({});

    try {
      if (trayDialogMode === 'create') {
        const response = await createTray(token, project.id, input);
        setTrays((previous) => sortTrays([...previous, response.tray]));
        setTraysPage(1);
        showToast({ intent: 'success', title: 'Tray created' });
      } else if (editingTrayId) {
        const response = await updateTray(token, project.id, editingTrayId, input);
        setTrays((previous) =>
          sortTrays(
            previous.map((item) =>
              item.id === editingTrayId ? response.tray : item
            )
          )
        );
        showToast({ intent: 'success', title: 'Tray updated' });
      }
      resetTrayDialog();
    } catch (err) {
      console.error('Save tray failed', err);
      if (err instanceof ApiError) {
        setTrayDialogErrors(parseTrayApiErrors(err.payload));
        showToast({
          intent: 'error',
          title: 'Failed to save tray',
          body: err.message
        });
      } else {
        const message = 'Failed to save tray. Please try again.';
        setTrayDialogErrors({ general: message });
        showToast({
          intent: 'error',
          title: 'Failed to save tray',
          body: message
        });
      }
    } finally {
      setTrayDialogSubmitting(false);
    }
  };

  const handleSubmitCableDialog = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (!project || !token) {
      setCableDialogErrors({
        general: 'You need to be signed in as an admin to manage cables.'
      });
      return;
    }

    const { input, errors } = buildCableInput(cableDialogValues);

    if (Object.keys(errors).length > 0) {
      setCableDialogErrors(errors);
      return;
    }

    setCableDialogSubmitting(true);
    setCableDialogErrors({});

    try {
      if (cableDialogMode === 'create') {
        const response = await createCable(token, project.id, input);
        setCables((previous) => sortCables([...previous, response.cable]));
        setCablesPage(1);
        showToast({ intent: 'success', title: 'Cable added' });
      } else if (editingCableId) {
        const response = await updateCable(
          token,
          project.id,
          editingCableId,
          input
        );
        setCables((previous) =>
          sortCables(
            previous.map((item) =>
              item.id === editingCableId ? response.cable : item
            )
          )
        );
        showToast({ intent: 'success', title: 'Cable updated' });
      }
      resetCableDialog();
    } catch (err) {
      console.error('Save cable failed', err);
      if (err instanceof ApiError) {
        setCableDialogErrors(parseCableFormErrors(err.payload));
        showToast({
          intent: 'error',
          title: 'Failed to save cable',
          body: err.message
        });
      } else {
        const message = 'Failed to save cable. Please try again.';
        setCableDialogErrors({
          general: message
        });
        showToast({
          intent: 'error',
          title: 'Failed to save cable',
          body: message
        });
      }
    } finally {
      setCableDialogSubmitting(false);
    }
  };


  const handleDeleteTray = async (tray: Tray) => {
    if (!project || !token) {
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
      await deleteTray(token, project.id, tray.id);
      setTrays((previous) => {
        const next = previous.filter((item) => item.id !== tray.id);
        const totalPages = Math.max(
          1,
          Math.ceil(next.length / TRAYS_PER_PAGE)
        );
        if (traysPage > totalPages) {
          setTraysPage(totalPages);
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
  };


  const openTrayDetails = useCallback(
    (tray: Tray) => {
      if (!projectId) {
        return;
      }
      navigate(`/projects/${projectId}/trays/${tray.id}`);
    },
    [navigate, projectId]
  );

  const handleDeleteCable = async (cable: Cable) => {
    if (!project || !token) {
      showToast({
        intent: 'error',
        title: 'Admin access required',
        body: 'You need to be signed in as an admin to delete cables.'
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
      await deleteCable(token, project.id, cable.id);
      setCables((previous) => {
        const next = previous.filter((item) => item.id !== cable.id);
        const totalPages = Math.max(
          1,
          Math.ceil(next.length / CABLE_LIST_PER_PAGE)
        );
        if (cablesPage > totalPages) {
          setCablesPage(totalPages);
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
  };

  const handleImportCables = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];

    if (!file) {
      return;
    }

    event.target.value = '';

    if (!project || !token) {
      showToast({
        intent: 'error',
        title: 'Admin access required',
        body: 'You need to be signed in as an admin to import cables.'
      });
      return;
    }

    setCablesImporting(true);

    try {
      const response = await importCables(token, project.id, file);
      setCables(sortCables(response.cables));
      setCablesPage(1);

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
      setCablesImporting(false);
    }
  };

  const handleExportCables = async () => {
    if (!project || !token) {
      showToast({
        intent: 'error',
        title: 'Admin access required',
        body: 'You need to be signed in as an admin to export cables.'
      });
      return;
    }

    setCablesExporting(true);

    try {
      const blob = await exportCables(token, project.id);
      const link = document.createElement('a');
      const url = window.URL.createObjectURL(blob);
      const fileName = `${sanitizeFileSegment(
        project.projectNumber
      )}-cable-list.xlsx`;

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
      setCablesExporting(false);
    }
  };

  const handleCableDraftChange = useCallback(
    (cableId: string, field: keyof CableFormState, value: string) => {
      setCableDrafts((previous) => {
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
      if (!project || !token) {
        showToast({
          intent: 'error',
          title: 'Admin access required',
          body: 'You need to be signed in as an admin to update cables.'
        });
        return;
      }

      if (Object.keys(changes).length === 0) {
        return;
      }

      setInlineUpdatingIds((previous) => {
        const next = new Set(previous);
        next.add(cable.id);
        return next;
      });

      try {
        const response = await updateCable(token, project.id, cable.id, changes);
        setCables((previous) =>
          sortCables(
            previous.map((item) =>
              item.id === cable.id ? response.cable : item
            )
          )
        );
        setCableDrafts((previous) => ({
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
        setCableDrafts((previous) => ({
          ...previous,
          [cable.id]: toCableFormState(cable)
        }));
      } finally {
        setInlineUpdatingIds((previous) => {
          const next = new Set(previous);
          next.delete(cable.id);
          return next;
        });
      }
    },
    [project, token, showToast, updateCable, sortCables]
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
    async (
      cable: Cable,
      field: 'tag' | 'fromLocation' | 'toLocation' | 'routing'
    ) => {
      const draft = cableDrafts[cable.id];
      if (!draft) {
        return;
      }

      const normalized = toNullableString(draft[field]);
      const current = (cable[field] ?? null) as string | null;

      if (normalized === current) {
        return;
      }

      const changes = {
        [field]: normalized
      } as Partial<CableInput>;

      await updateCableInline(cable, changes);
    },
    [cableDrafts, updateCableInline]
  );

  const isInlineEditable = inlineEditingEnabled && isAdmin;

  if (isLoading) {
    return (
      <section className={styles.root}>
        <Spinner label="Loading project..." />
      </section>
    );
  }

  if (error) {
    return (
      <section className={styles.root}>
        <Body1 className={styles.errorText}>{error}</Body1>
        <Button onClick={() => navigate('/', { replace: true })}>
          Back to projects
        </Button>
      </section>
    );
  }

  if (!project) {
    return (
      <section className={styles.root}>
        <Body1>Project not available.</Body1>
        <Button onClick={() => navigate('/', { replace: true })}>
          Back to projects
        </Button>
      </section>
    );
  }

  return (
    <section className={styles.root} aria-labelledby="project-details-heading">
      <div className={styles.header}>
        <Title3 id="project-details-heading">
          {project.projectNumber} &mdash; {project.name}
        </Title3>
        <Body1>Customer: {project.customer}</Body1>
      </div>

      <TabList
        className={styles.tabList}
        selectedValue={selectedTab}
        onTabSelect={handleTabSelect}
        aria-label="Project sections"
      >
        <Tab value="details">Details</Tab>
        <Tab value="cables">Cable types</Tab>
        <Tab value="cable-list">Cables list</Tab>
        <Tab value="trays">Trays</Tab>
      </TabList>

      {selectedTab === 'details' ? (
        <DetailsTab
          styles={styles}
          project={project}
          formattedDates={formattedDates}
        />
      ) : null}

      {selectedTab === 'cables' ? (
        <CableTypesTab
          styles={styles}
          isAdmin={isAdmin}
          isRefreshing={cableTypesRefreshing}
          onRefresh={() => void loadCableTypes(false)}
          onCreate={openCreateCableTypeDialog}
          onImportClick={() => fileInputRef.current?.click()}
          onExport={() => void handleExportCableTypes()}
          onImportFileChange={handleImportCableTypes}
          isImporting={isImporting}
          isExporting={isExporting}
          fileInputRef={fileInputRef}
          error={cableTypesError}
          isLoading={cableTypesLoading}
          items={pagedCableTypes}
          pendingId={pendingCableTypeId}
          onEdit={openEditCableTypeDialog}
          onDelete={(cableType) => void handleDeleteCableType(cableType)}
          formatNumeric={formatNumeric}
          showPagination={showPagination}
          page={cablePage}
          totalPages={totalCablePages}
          paginationHandlers={{
            onPrevious: handleCableTypesPreviousPage,
            onNext: handleCableTypesNextPage
          }}
        />
      ) : null}

      {selectedTab === 'trays' ? (
        <TraysTab
          styles={styles}
          isAdmin={isAdmin}
          isRefreshing={traysRefreshing}
          onRefresh={() => void loadTrays(false)}
          onCreate={openCreateTrayDialog}
          onImportClick={() => traysFileInputRef.current?.click()}
          onExport={() => void handleExportTrays()}
          onImportFileChange={handleImportTrays}
          isImporting={traysImporting}
          isExporting={traysExporting}
          fileInputRef={traysFileInputRef}
          error={traysError}
          isLoading={traysLoading}
          items={pagedTrays}
          pendingId={pendingTrayId}
          onDetails={openTrayDetails}
          onDelete={(tray) => void handleDeleteTray(tray)}
          formatNumeric={formatNumeric}
          showPagination={showTrayPagination}
          page={traysPage}
          totalPages={totalTrayPages}
          onPreviousPage={handleTraysPreviousPage}
          onNextPage={handleTraysNextPage}
        />
      ) : null}
      {selectedTab === 'cable-list' ? (
        <CableListTab
          styles={styles}
          isAdmin={isAdmin}
          isRefreshing={cablesRefreshing}
          onRefresh={() => void loadCables(false)}
          onCreate={openCreateCableDialog}
          onImportClick={() => cablesFileInputRef.current?.click()}
          onExport={() => void handleExportCables()}
          onImportFileChange={handleImportCables}
          isImporting={cablesImporting}
          isExporting={cablesExporting}
          fileInputRef={cablesFileInputRef}
          inlineEditingEnabled={inlineEditingEnabled}
          onInlineEditingToggle={setInlineEditingEnabled}
          inlineUpdatingIds={inlineUpdatingIds}
          isInlineEditable={isInlineEditable}
          cableTypes={cableTypes}
          items={pagedCables}
          drafts={cableDrafts}
          onDraftChange={handleCableDraftChange}
          onTextFieldBlur={handleCableTextFieldBlur}
          onInlineCableTypeChange={handleInlineCableTypeChange}
          pendingId={pendingCableId}
          onEdit={openEditCableDialog}
          onDelete={(cable) => void handleDeleteCable(cable)}
          error={cablesError}
          isLoading={cablesLoading}
          showPagination={showCablePagination}
          page={cablesPage}
          totalPages={totalCableListPages}
          onPreviousPage={handleCablesPreviousPage}
          onNextPage={handleCablesNextPage}
        />
      ) : null}

      <Button appearance="secondary" onClick={() => navigate(-1)}>
        Back
      </Button>

      <TrayDialog
        styles={styles}
        open={isTrayDialogOpen}
        mode={trayDialogMode}
        values={trayDialogValues}
        errors={trayDialogErrors}
        submitting={trayDialogSubmitting}
        onFieldChange={handleTrayDialogFieldChange}
        onSubmit={handleSubmitTrayDialog}
        onDismiss={resetTrayDialog}
      />

      <CableTypeDialog
        styles={styles}
        open={isCableTypeDialogOpen}
        mode={cableTypeDialogMode}
        values={cableTypeDialogValues}
        errors={cableTypeDialogErrors}
        submitting={cableTypeDialogSubmitting}
        onFieldChange={handleCableTypeDialogFieldChange}
        onSubmit={handleSubmitCableTypeDialog}
        onDismiss={resetCableTypeDialog}
      />

      <CableDialog
        styles={styles}
        open={isCableDialogOpen}
        mode={cableDialogMode}
        values={cableDialogValues}
        errors={cableDialogErrors}
        submitting={cableDialogSubmitting}
        cableTypes={cableTypes}
        onFieldChange={handleCableDialogFieldChange}
        onCableTypeSelect={handleCableTypeSelect}
        onSubmit={handleSubmitCableDialog}
        onDismiss={resetCableDialog}
      />
    </section>
  );
};
