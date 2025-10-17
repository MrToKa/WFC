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
  Dropdown,
  Option,
  Switch,
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
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import {
  ApiError,
  ApiErrorPayload,
  CableImportSummary,
  Cable,
  CableInput,
  CableType,
  CableTypeInput,
  Tray,
  TrayInput,
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

const useStyles = makeStyles({
  root: {
    display: 'flex',
    flexDirection: 'column',
    gap: '1.5rem',
    maxWidth: '80rem',
    width: '100%',
    margin: '0 auto',
    ...shorthands.padding('0', '0', '2rem')
  },
  header: {
    display: 'flex',
    flexDirection: 'column',
    gap: '0.5rem'
  },
  metadata: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(12rem, 1fr))',
    gap: '0.75rem'
  },
  panel: {
    borderRadius: tokens.borderRadiusMedium,
    border: `1px solid ${tokens.colorNeutralStroke1}`,
    backgroundColor: tokens.colorNeutralBackground2,
    ...shorthands.padding('1rem')
  },
  tabList: {
    alignSelf: 'flex-start'
  },
  tabPanel: {
    display: 'flex',
    flexDirection: 'column',
    gap: '1rem'
  },
  actionsRow: {
    display: 'flex',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: '0.75rem'
  },
  errorText: {
    color: tokens.colorStatusDangerForeground1
  },
  tableContainer: {
    width: '100%'
  },
  table: {
    width: '100%',
    borderCollapse: 'collapse'
  },
  tableHeadCell: {
    textAlign: 'left',
    padding: '0.75rem 1rem',
    backgroundColor: tokens.colorNeutralBackground2,
    borderBottom: `1px solid ${tokens.colorNeutralStroke1}`
  },
  tableCell: {
    padding: '0.75rem 1rem',
    borderBottom: `1px solid ${tokens.colorNeutralStroke1}`,
    verticalAlign: 'top',
    wordBreak: 'break-word'
  },
  numericCell: {
    textAlign: 'right'
  },
  actionsCell: {
    display: 'flex',
    gap: '0.5rem',
    flexWrap: 'wrap'
  },
  emptyState: {
    padding: '1rem',
    borderRadius: tokens.borderRadiusMedium,
    border: `1px solid ${tokens.colorNeutralStroke1}`,
    backgroundColor: tokens.colorNeutralBackground2,
    textAlign: 'center'
  },
  hiddenInput: {
    display: 'none'
  },
  dialogForm: {
    display: 'flex',
    flexDirection: 'column',
    gap: '0.75rem'
  },
  dialogActions: {
    display: 'flex',
    justifyContent: 'flex-end',
    gap: '0.5rem',
    flexWrap: 'wrap'
  },
  pagination: {
    display: 'flex',
    gap: '0.5rem',
    justifyContent: 'center',
    alignItems: 'center',
    flexWrap: 'wrap'
  }
});

const CABLE_TYPES_PER_PAGE = 10;
const CABLE_LIST_PER_PAGE = 10;
const TRAYS_PER_PAGE = 10;

type ProjectDetailsTab = 'details' | 'cables' | 'cable-list' | 'trays';

type CableTypeFormState = {
  name: string;
  purpose: string;
  diameterMm: string;
  weightKgPerM: string;
};

type CableTypeFormErrors = Partial<Record<keyof CableTypeFormState, string>> & {
  general?: string;
};

const emptyCableTypeForm: CableTypeFormState = {
  name: '',
  purpose: '',
  diameterMm: '',
  weightKgPerM: ''
};

const toFormState = (cableType: CableType): CableTypeFormState => ({
  name: cableType.name,
  purpose: cableType.purpose ?? '',
  diameterMm: cableType.diameterMm !== null ? String(cableType.diameterMm) : '',
  weightKgPerM:
    cableType.weightKgPerM !== null ? String(cableType.weightKgPerM) : ''
});

type TrayFormState = {
  name: string;
  type: string;
  purpose: string;
  widthMm: string;
  heightMm: string;
  lengthMm: string;
};

type TrayFormErrors = Partial<Record<keyof TrayFormState, string>> & {
  general?: string;
};

const emptyTrayForm: TrayFormState = {
  name: '',
  type: '',
  purpose: '',
  widthMm: '',
  heightMm: '',
  lengthMm: ''
};

const toTrayFormState = (tray: Tray): TrayFormState => ({
  name: tray.name,
  type: tray.type ?? '',
  purpose: tray.purpose ?? '',
  widthMm: tray.widthMm !== null ? String(tray.widthMm) : '',
  heightMm: tray.heightMm !== null ? String(tray.heightMm) : '',
  lengthMm: tray.lengthMm !== null ? String(tray.lengthMm) : ''
});

const formatNumeric = (value: number | null): string =>
  value === null
    ? '-'
    : new Intl.NumberFormat(undefined, {
        maximumFractionDigits: 3
      }).format(value);

const sanitizeFileSegment = (value: string): string =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'project';

const parseCableTypeApiErrors = (
  payload: ApiErrorPayload
): CableTypeFormErrors => {
  if (typeof payload === 'string') {
    return { general: payload };
  }

  const fieldErrors = Object.entries(payload.fieldErrors ?? {}).reduce<
    CableTypeFormErrors
  >((acc, [field, messages]) => {
    if (messages.length > 0 && field in emptyCableTypeForm) {
      acc[field as keyof CableTypeFormState] = messages[0];
    }
    return acc;
  }, {});

  const generalMessage = payload.formErrors?.[0];
  if (generalMessage) {
    fieldErrors.general = generalMessage;
  }

  return fieldErrors;
};

const parseTrayApiErrors = (payload: ApiErrorPayload): TrayFormErrors => {
  if (typeof payload === 'string') {
    return { general: payload };
  }

  const fieldErrors: TrayFormErrors = {};

  for (const [field, messages] of Object.entries(
    payload.fieldErrors ?? {}
  )) {
    if (messages.length === 0) {
      continue;
    }
    if (field in emptyTrayForm) {
      fieldErrors[field as keyof TrayFormState] = messages[0];
    }
  }

  const generalMessage = payload.formErrors?.[0];
  if (generalMessage) {
    fieldErrors.general = generalMessage;
  }

  return fieldErrors;
};

const toNullableString = (value: string): string | null => {
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
};

type CableFormState = {
  cableId: string;
  tag: string;
  cableTypeId: string;
  fromLocation: string;
  toLocation: string;
  routing: string;
};

type CableFormErrors = Partial<Record<keyof CableFormState, string>> & {
  general?: string;
};

const emptyCableForm: CableFormState = {
  cableId: '',
  tag: '',
  cableTypeId: '',
  fromLocation: '',
  toLocation: '',
  routing: ''
};

const toCableFormState = (cable: Cable): CableFormState => ({
  cableId: cable.cableId,
  tag: cable.tag ?? '',
  cableTypeId: cable.cableTypeId,
  fromLocation: cable.fromLocation ?? '',
  toLocation: cable.toLocation ?? '',
  routing: cable.routing ?? ''
});

const parseCableFormErrors = (payload: ApiErrorPayload): CableFormErrors => {
  if (typeof payload === 'string') {
    return { general: payload };
  }

  const fieldErrors: CableFormErrors = {};

  const fieldMessages = payload.fieldErrors ?? {};

  for (const [field, messages] of Object.entries(fieldMessages)) {
    if (messages.length === 0) {
      continue;
    }
    if (field in emptyCableForm) {
      fieldErrors[field as keyof CableFormState] = messages[0];
    }
  }

  const generalMessage = payload.formErrors?.[0];
  if (generalMessage) {
    fieldErrors.general = generalMessage;
  }

  return fieldErrors;
};

export const ProjectDetails = () => {
  const styles = useStyles();
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
    setCableTypeDialogValues(toFormState(cableType));
    setCableTypeDialogErrors({});
    setCableTypeDialogOpen(true);
    setEditingCableTypeId(cableType.id);
  }, []);

  const parseNumberInput = (value: string): { numeric: number | null; error?: string } => {
    const trimmed = value.trim();
    if (trimmed === '') {
      return { numeric: null };
    }
    const normalized = trimmed.replace(',', '.');
    const parsed = Number(normalized);
    if (!Number.isFinite(parsed)) {
      return { numeric: null, error: 'Enter a valid number' };
    }
    if (parsed < 0) {
      return { numeric: null, error: 'Value must be positive' };
    }
    return { numeric: parsed };
  };

  const buildCableTypeInput = (values: CableTypeFormState) => {
    const errors: CableTypeFormErrors = {};

    const name = values.name.trim();
    if (name === '') {
      errors.name = 'Name is required';
    }

    const diameterResult = parseNumberInput(values.diameterMm);
    if (diameterResult.error) {
      errors.diameterMm = diameterResult.error;
    }

    const weightResult = parseNumberInput(values.weightKgPerM);
    if (weightResult.error) {
      errors.weightKgPerM = weightResult.error;
    }

    const input: CableTypeInput = {
      name,
      purpose: (() => {
        const trimmed = values.purpose.trim();
        return trimmed === '' ? null : trimmed;
      })(),
      diameterMm: diameterResult.numeric,
      weightKgPerM: weightResult.numeric
    };

    return { input, errors };
  };

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

  const buildCableInput = (values: CableFormState) => {
    const errors: CableFormErrors = {};

    const cableId = values.cableId.trim();
    if (cableId === '') {
      errors.cableId = 'Cable ID is required';
    }

    const cableTypeId = values.cableTypeId.trim();
    if (cableTypeId === '') {
      errors.cableTypeId = 'Cable type is required';
    }

    const normalize = (text: string): string | null => {
      const trimmed = text.trim();
      return trimmed === '' ? null : trimmed;
    };

    const input: CableInput = {
      cableId,
      cableTypeId,
      tag: normalize(values.tag),
      fromLocation: normalize(values.fromLocation),
      toLocation: normalize(values.toLocation),
      routing: normalize(values.routing)
    };

    return { input, errors };
  };

  const buildTrayInput = (values: TrayFormState) => {
    const errors: TrayFormErrors = {};

    const name = values.name.trim();
    if (name === "") {
      errors.name = "Name is required";
    }

    const type = toNullableString(values.type);
    const purpose = toNullableString(values.purpose);
    const widthResult = parseNumberInput(values.widthMm);
    if (widthResult.error) {
      errors.widthMm = widthResult.error;
    }
    const heightResult = parseNumberInput(values.heightMm);
    if (heightResult.error) {
      errors.heightMm = heightResult.error;
    }
    const lengthResult = parseNumberInput(values.lengthMm);
    if (lengthResult.error) {
      errors.lengthMm = lengthResult.error;
    }

    const input: TrayInput = {
      name,
      type,
      purpose,
      widthMm: widthResult.numeric,
      heightMm: heightResult.numeric,
      lengthMm: lengthResult.numeric
    };

    return { input, errors };
  };



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
        <div className={styles.tabPanel}>
          {formattedDates ? (
            <div className={styles.metadata}>
              <div className={styles.panel}>
                <Caption1>Created</Caption1>
                <Body1>{formattedDates.created}</Body1>
              </div>
              <div className={styles.panel}>
                <Caption1>Last updated</Caption1>
                <Body1>{formattedDates.updated}</Body1>
              </div>
            </div>
          ) : null}

          <div className={styles.panel}>
            <Caption1>Description</Caption1>
            <Body1>
              {project.description
                ? project.description
                : 'No description provided.'}
            </Body1>
          </div>
        </div>
      ) : null}

      {selectedTab === 'cables' ? (
        <div className={styles.tabPanel}>
          <div className={styles.actionsRow}>
            <Button
              onClick={() => void loadCableTypes(false)}
              disabled={cableTypesRefreshing}
            >
              {cableTypesRefreshing ? 'Refreshing...' : 'Refresh'}
            </Button>
            {isAdmin ? (
              <>
                <Button appearance="primary" onClick={openCreateCableTypeDialog}>
                  Add cable type
                </Button>
                <Button
                  onClick={() => fileInputRef.current?.click()}
                  disabled={isImporting}
                >
                  {isImporting ? 'Importing...' : 'Import from Excel'}
                </Button>
                <Button
                  appearance="secondary"
                  onClick={() => void handleExportCableTypes()}
                  disabled={isExporting}
                >
                  {isExporting ? 'Exporting...' : 'Export to Excel'}
                </Button>
                <input
                  ref={fileInputRef}
                  className={styles.hiddenInput}
                  type="file"
                  accept=".xlsx"
                  onChange={handleImportCableTypes}
                />
              </>
            ) : null}
          </div>

          {cableTypesError ? (
            <Body1 className={styles.errorText}>{cableTypesError}</Body1>
          ) : null}

          {cableTypesLoading ? (
            <Spinner label="Loading cable types..." />
          ) : cableTypes.length === 0 ? (
            <div className={styles.emptyState}>
              <Caption1>No cable types found</Caption1>
              <Body1>
                {isAdmin
                  ? 'Use the buttons above to add or import cable types for this project.'
                  : 'There are no cable types recorded for this project yet.'}
              </Body1>
            </div>
          ) : (
            <div className={styles.tableContainer}>
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th className={styles.tableHeadCell}>Type</th>
                    <th className={styles.tableHeadCell}>Purpose</th>
                    <th
                      className={mergeClasses(
                        styles.tableHeadCell,
                        styles.numericCell
                      )}
                    >
                      Diameter [mm]
                    </th>
                    <th
                      className={mergeClasses(
                        styles.tableHeadCell,
                        styles.numericCell
                      )}
                    >
                      Weight [kg/m]
                    </th>
                    {isAdmin ? (
                      <th className={styles.tableHeadCell}>Actions</th>
                    ) : null}
                  </tr>
                </thead>
                <tbody>
                  {pagedCableTypes.map((cableType) => {
                    const isBusy = pendingCableTypeId === cableType.id;
                    return (
                      <tr key={cableType.id}>
                        <td className={styles.tableCell}>{cableType.name}</td>
                        <td className={styles.tableCell}>
                          {cableType.purpose ?? '-'}
                        </td>
                        <td
                          className={mergeClasses(
                            styles.tableCell,
                            styles.numericCell
                          )}
                        >
                          {formatNumeric(cableType.diameterMm)}
                        </td>
                        <td
                          className={mergeClasses(
                            styles.tableCell,
                            styles.numericCell
                          )}
                        >
                          {formatNumeric(cableType.weightKgPerM)}
                        </td>
                        {isAdmin ? (
                          <td
                            className={mergeClasses(
                              styles.tableCell,
                              styles.actionsCell
                            )}
                          >
                            <Button
                              size="small"
                              onClick={() => openEditCableTypeDialog(cableType)}
                              disabled={isBusy}
                            >
                              Edit
                            </Button>
                            <Button
                              size="small"
                              appearance="secondary"
                              onClick={() => void handleDeleteCableType(cableType)}
                              disabled={isBusy}
                            >
                              Delete
                            </Button>
                          </td>
                        ) : null}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              {showPagination ? (
                <div className={styles.pagination}>
                  <Button
                    size="small"
                    onClick={() =>
                      setCablePage((prev) => Math.max(1, prev - 1))
                    }
                    disabled={cablePage === 1}
                  >
                    Previous
                  </Button>
                  <Body1>
                    Page {cablePage} of {totalCablePages}
                  </Body1>
                  <Button
                    size="small"
                    onClick={() =>
                      setCablePage((prev) =>
                        Math.min(totalCablePages, prev + 1)
                      )
                    }
                    disabled={cablePage === totalCablePages}
                  >
                    Next
                  </Button>
                </div>
              ) : null}
            </div>
          )}
        </div>
      ) : null}

      {selectedTab === 'trays' ? (
        <div className={styles.tabPanel}>
          <div className={styles.actionsRow}>
            <Button
              onClick={() => void loadTrays(false)}
              disabled={traysRefreshing}
            >
              {traysRefreshing ? 'Refreshing...' : 'Refresh'}
            </Button>
            {isAdmin ? (
              <>
                <Button appearance="primary" onClick={openCreateTrayDialog}>
                  Add tray
                </Button>
                <Button
                  onClick={() => traysFileInputRef.current?.click()}
                  disabled={traysImporting}
                >
                  {traysImporting ? 'Importing...' : 'Import from Excel'}
                </Button>
                <Button
                  appearance="secondary"
                  onClick={() => void handleExportTrays()}
                  disabled={traysExporting}
                >
                  {traysExporting ? 'Exporting...' : 'Export to Excel'}
                </Button>
                <input
                  ref={traysFileInputRef}
                  className={styles.hiddenInput}
                  type="file"
                  accept=".xlsx"
                  onChange={handleImportTrays}
                />
              </>
            ) : null}
          </div>

          {traysError ? (
            <Body1 className={styles.errorText}>{traysError}</Body1>
          ) : null}

          {traysLoading ? (
            <Spinner label="Loading trays..." />
          ) : trays.length === 0 ? (
            <div className={styles.emptyState}>
              <Caption1>No trays found</Caption1>
              <Body1>
                {isAdmin
                  ? 'Use the buttons above to add or import trays for this project.'
                  : 'There are no trays recorded for this project yet.'}
              </Body1>
            </div>
          ) : (
            <div className={styles.tableContainer}>
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th className={styles.tableHeadCell}>Name</th>
                    <th className={styles.tableHeadCell}>Type</th>
                    <th className={styles.tableHeadCell}>Purpose</th>
                    <th
                      className={mergeClasses(
                        styles.tableHeadCell,
                        styles.numericCell
                      )}
                    >
                      Width [mm]
                    </th>
                    <th
                      className={mergeClasses(
                        styles.tableHeadCell,
                        styles.numericCell
                      )}
                    >
                      Height [mm]
                    </th>
                    <th
                      className={mergeClasses(
                        styles.tableHeadCell,
                        styles.numericCell
                      )}
                    >
                      Length
                    </th>
                    <th className={styles.tableHeadCell}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {pagedTrays.map((tray) => {
                    const isBusy = pendingTrayId === tray.id;
                    return (
                      <tr key={tray.id}>
                        <td className={styles.tableCell}>{tray.name}</td>
                        <td className={styles.tableCell}>{tray.type ?? '-'}</td>
                        <td className={styles.tableCell}>{tray.purpose ?? '-'}</td>
                        <td
                          className={mergeClasses(
                            styles.tableCell,
                            styles.numericCell
                          )}
                        >
                          {formatNumeric(tray.widthMm)}
                        </td>
                        <td
                          className={mergeClasses(
                            styles.tableCell,
                            styles.numericCell
                          )}
                        >
                          {formatNumeric(tray.heightMm)}
                        </td>
                        <td
                          className={mergeClasses(
                            styles.tableCell,
                            styles.numericCell
                          )}
                        >
                          {formatNumeric(tray.lengthMm)}
                        </td>
                        <td
                          className={mergeClasses(
                            styles.tableCell,
                            styles.actionsCell
                          )}
                        >
                          <Button
                            size="small"
                            onClick={() => openTrayDetails(tray)}
                            disabled={isBusy}
                          >
                            Details
                          </Button>
                          {isAdmin ? (
                            <Button
                              size="small"
                              appearance="secondary"
                              onClick={() => void handleDeleteTray(tray)}
                              disabled={isBusy}
                            >
                              Delete
                            </Button>
                          ) : null}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              {showTrayPagination ? (
                <div className={styles.pagination}>
                  <Button
                    size="small"
                    onClick={() =>
                      setTraysPage((prev) => Math.max(1, prev - 1))
                    }
                    disabled={traysPage === 1}
                  >
                    Previous
                  </Button>
                  <Body1>
                    Page {traysPage} of {totalTrayPages}
                  </Body1>
                  <Button
                    size="small"
                    onClick={() =>
                      setTraysPage((prev) =>
                        Math.min(totalTrayPages, prev + 1)
                      )
                    }
                    disabled={traysPage === totalTrayPages}
                  >
                    Next
                  </Button>
                </div>
              ) : null}
            </div>
          )}
        </div>
      ) : null}
      {selectedTab === 'cable-list' ? (
        <div className={styles.tabPanel}>
          <div className={styles.actionsRow}>
            <Button
              onClick={() => void loadCables(false)}
              disabled={cablesRefreshing}
            >
              {cablesRefreshing ? 'Refreshing...' : 'Refresh'}
            </Button>
            {isAdmin ? (
              <>
                <Button
                  appearance="primary"
                  onClick={openCreateCableDialog}
                  disabled={cableTypes.length === 0}
                >
                  Add cable
                </Button>
                <Button
                  onClick={() => cablesFileInputRef.current?.click()}
                  disabled={cablesImporting}
                >
                  {cablesImporting ? 'Importing...' : 'Import from Excel'}
                </Button>
                <Button
                  appearance="secondary"
                  onClick={() => void handleExportCables()}
                  disabled={cablesExporting}
                >
                  {cablesExporting ? 'Exporting...' : 'Export to Excel'}
                </Button>
                <input
                  ref={cablesFileInputRef}
                  className={styles.hiddenInput}
                  type="file"
                  accept=".xlsx"
                  onChange={handleImportCables}
                />
                <Switch
                  checked={inlineEditingEnabled}
                  label="Inline edit"
                  onChange={(_, data) =>
                    setInlineEditingEnabled(Boolean(data.checked))
                  }
                  disabled={inlineUpdatingIds.size > 0}
                />
              </>
            ) : null}
          </div>

          {cablesError ? (
            <Body1 className={styles.errorText}>{cablesError}</Body1>
          ) : null}

          {cablesLoading ? (
            <Spinner label="Loading cables..." />
          ) : cables.length === 0 ? (
            <div className={styles.emptyState}>
              <Caption1>No cables found</Caption1>
              <Body1>
                {isAdmin
                  ? 'Add a cable manually or import a list from Excel.'
                  : 'No cables have been recorded for this project yet.'}
              </Body1>
            </div>
          ) : (
            <div className={styles.tableContainer}>
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th className={styles.tableHeadCell}>Tag</th>
                    <th className={styles.tableHeadCell}>Type</th>
                    <th className={styles.tableHeadCell}>From location</th>
                    <th className={styles.tableHeadCell}>To location</th>
                    <th className={styles.tableHeadCell}>Routing</th>
                    {isAdmin ? (
                      <th className={styles.tableHeadCell}>Actions</th>
                    ) : null}
                  </tr>
                </thead>
                <tbody>
                  {pagedCables.map((cable) => {
                    const isBusy = pendingCableId === cable.id;
                    const draft =
                      cableDrafts[cable.id] ?? toCableFormState(cable);
                    const isRowUpdating = inlineUpdatingIds.has(cable.id);
                    const disableActions = isBusy || isRowUpdating;
                    const currentCableType = cableTypes.find(
                      (type) => type.id === draft.cableTypeId
                    );
                    return (
                      <tr key={cable.id}>
                        <td className={styles.tableCell}>
                          {isInlineEditable ? (
                            <Input
                              size="small"
                              value={draft.tag}
                              onChange={(_, data) =>
                                handleCableDraftChange(
                                  cable.id,
                                  'tag',
                                  data.value
                                )
                              }
                              onBlur={() =>
                                void handleCableTextFieldBlur(cable, 'tag')
                              }
                              disabled={isRowUpdating}
                              aria-label="Cable tag"
                            />
                          ) : (
                            cable.tag ?? '-'
                          )}
                        </td>
                        <td className={styles.tableCell}>
                          {isInlineEditable ? (
                            <Dropdown
                              size="small"
                              selectedOptions={
                                draft.cableTypeId
                                  ? [draft.cableTypeId]
                                  : []
                              }
                              value={currentCableType?.name ?? ''}
                              onOptionSelect={(_, data) => {
                                const nextTypeId =
                                  data.optionValue ?? cable.cableTypeId;
                                handleCableDraftChange(
                                  cable.id,
                                  'cableTypeId',
                                  nextTypeId ?? ''
                                );
                                if (
                                  !data.optionValue ||
                                  data.optionValue === cable.cableTypeId
                                ) {
                                  return;
                                }
                                void handleInlineCableTypeChange(
                                  cable,
                                  data.optionValue
                                );
                              }}
                              disabled={isRowUpdating}
                              aria-label="Cable type"
                            >
                              {cableTypes.map((type) => (
                                <Option key={type.id} value={type.id}>
                                  {type.name}
                                </Option>
                              ))}
                            </Dropdown>
                          ) : (
                            cable.typeName
                          )}
                        </td>
                        <td className={styles.tableCell}>
                          {isInlineEditable ? (
                            <Input
                              size="small"
                              value={draft.fromLocation}
                              onChange={(_, data) =>
                                handleCableDraftChange(
                                  cable.id,
                                  'fromLocation',
                                  data.value
                                )
                              }
                              onBlur={() =>
                                void handleCableTextFieldBlur(
                                  cable,
                                  'fromLocation'
                                )
                              }
                              disabled={isRowUpdating}
                              aria-label="From location"
                            />
                          ) : (
                            cable.fromLocation ?? '-'
                          )}
                        </td>
                        <td className={styles.tableCell}>
                          {isInlineEditable ? (
                            <Input
                              size="small"
                              value={draft.toLocation}
                              onChange={(_, data) =>
                                handleCableDraftChange(
                                  cable.id,
                                  'toLocation',
                                  data.value
                                )
                              }
                              onBlur={() =>
                                void handleCableTextFieldBlur(
                                  cable,
                                  'toLocation'
                                )
                              }
                              disabled={isRowUpdating}
                              aria-label="To location"
                            />
                          ) : (
                            cable.toLocation ?? '-'
                          )}
                        </td>
                        <td className={styles.tableCell}>
                          {isInlineEditable ? (
                            <Input
                              size="small"
                              value={draft.routing}
                              onChange={(_, data) =>
                                handleCableDraftChange(
                                  cable.id,
                                  'routing',
                                  data.value
                                )
                              }
                              onBlur={() =>
                                void handleCableTextFieldBlur(cable, 'routing')
                              }
                              disabled={isRowUpdating}
                              aria-label="Routing"
                            />
                          ) : (
                            cable.routing ?? '-'
                          )}
                        </td>
                        {isAdmin ? (
                          <td
                            className={mergeClasses(
                              styles.tableCell,
                              styles.actionsCell
                            )}
                          >
                            <Button
                              size="small"
                              onClick={() => openEditCableDialog(cable)}
                              disabled={disableActions}
                            >
                              Edit
                            </Button>
                            <Button
                              size="small"
                              appearance="secondary"
                              onClick={() => void handleDeleteCable(cable)}
                              disabled={disableActions}
                            >
                              Delete
                            </Button>
                          </td>
                        ) : null}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              {showCablePagination ? (
                <div className={styles.pagination}>
                  <Button
                    size="small"
                    onClick={() =>
                      setCablesPage((prev) => Math.max(1, prev - 1))
                    }
                    disabled={cablesPage === 1}
                  >
                    Previous
                  </Button>
                  <Body1>
                    Page {cablesPage} of {totalCableListPages}
                  </Body1>
                  <Button
                    size="small"
                    onClick={() =>
                      setCablesPage((prev) =>
                        Math.min(totalCableListPages, prev + 1)
                      )
                    }
                    disabled={cablesPage === totalCableListPages}
                  >
                    Next
                  </Button>
                </div>
              ) : null}
            </div>
          )}
        </div>
      ) : null}

      <Button appearance="secondary" onClick={() => navigate(-1)}>
        Back
      </Button>

            <Dialog
        open={isTrayDialogOpen}
        onOpenChange={(_, data) => {
          if (!data.open) {
            resetTrayDialog();
          }
        }}
      >
        <DialogSurface>
          <form className={styles.dialogForm} onSubmit={handleSubmitTrayDialog}>
            <DialogBody>
              <DialogTitle>
                {trayDialogMode === 'create' ? 'Add tray' : 'Edit tray'}
              </DialogTitle>
              <DialogContent>
                <Field
                  label="Name"
                  required
                  validationState={
                    trayDialogErrors.name ? 'error' : undefined
                  }
                  validationMessage={trayDialogErrors.name}
                >
                  <Input
                    value={trayDialogValues.name}
                    onChange={handleTrayDialogFieldChange('name')}
                    required
                  />
                </Field>
                <Field
                  label="Type"
                  validationState={
                    trayDialogErrors.type ? 'error' : undefined
                  }
                  validationMessage={trayDialogErrors.type}
                >
                  <Input
                    value={trayDialogValues.type}
                    onChange={handleTrayDialogFieldChange('type')}
                  />
                </Field>
                <Field
                  label="Purpose"
                  validationState={
                    trayDialogErrors.purpose ? 'error' : undefined
                  }
                  validationMessage={trayDialogErrors.purpose}
                >
                  <Input
                    value={trayDialogValues.purpose}
                    onChange={handleTrayDialogFieldChange('purpose')}
                  />
                </Field>
                <Field
                  label="Width [mm]"
                  validationState={
                    trayDialogErrors.widthMm ? 'error' : undefined
                  }
                  validationMessage={trayDialogErrors.widthMm}
                >
                  <Input
                    value={trayDialogValues.widthMm}
                    onChange={handleTrayDialogFieldChange('widthMm')}
                  />
                </Field>
                <Field
                  label="Height [mm]"
                  validationState={
                    trayDialogErrors.heightMm ? 'error' : undefined
                  }
                  validationMessage={trayDialogErrors.heightMm}
                >
                  <Input
                    value={trayDialogValues.heightMm}
                    onChange={handleTrayDialogFieldChange('heightMm')}
                  />
                </Field>
                <Field
                  label="Length"
                  validationState={
                    trayDialogErrors.lengthMm ? 'error' : undefined
                  }
                  validationMessage={trayDialogErrors.lengthMm}
                >
                  <Input
                    value={trayDialogValues.lengthMm}
                    onChange={handleTrayDialogFieldChange('lengthMm')}
                  />
                </Field>
                {trayDialogErrors.general ? (
                  <Body1 className={styles.errorText}>
                    {trayDialogErrors.general}
                  </Body1>
                ) : null}
              </DialogContent>
              <DialogActions className={styles.dialogActions}>
                <Button
                  type="button"
                  appearance="secondary"
                  onClick={resetTrayDialog}
                  disabled={trayDialogSubmitting}
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  appearance="primary"
                  disabled={trayDialogSubmitting}
                >
                  {trayDialogSubmitting
                    ? 'Saving...'
                    : trayDialogMode === 'create'
                      ? 'Add tray'
                      : 'Save changes'}
                </Button>
              </DialogActions>
            </DialogBody>
          </form>
        </DialogSurface>
      </Dialog>
<Dialog
        open={isCableTypeDialogOpen}
        onOpenChange={(_, data) => {
          if (!data.open) {
            resetCableTypeDialog();
          }
        }}
      >
        <DialogSurface>
          <form className={styles.dialogForm} onSubmit={handleSubmitCableTypeDialog}>
            <DialogBody>
              <DialogTitle>
                {cableTypeDialogMode === 'create'
                  ? 'Add cable type'
                  : 'Edit cable type'}
              </DialogTitle>
              <DialogContent>
                <Field
                  label="Name"
                  required
                  validationState={
                    cableTypeDialogErrors.name ? 'error' : undefined
                  }
                  validationMessage={cableTypeDialogErrors.name}
                >
                  <Input
                    value={cableTypeDialogValues.name}
                    onChange={handleCableTypeDialogFieldChange('name')}
                    required
                  />
                </Field>
                <Field
                  label="Purpose"
                  validationState={
                    cableTypeDialogErrors.purpose ? 'error' : undefined
                  }
                  validationMessage={cableTypeDialogErrors.purpose}
                >
                  <Input
                    value={cableTypeDialogValues.purpose}
                    onChange={handleCableTypeDialogFieldChange('purpose')}
                  />
                </Field>
                <Field
                  label="Diameter [mm]"
                  validationState={
                    cableTypeDialogErrors.diameterMm ? 'error' : undefined
                  }
                  validationMessage={cableTypeDialogErrors.diameterMm}
                >
                  <Input
                    value={cableTypeDialogValues.diameterMm}
                    onChange={handleCableTypeDialogFieldChange('diameterMm')}
                    inputMode="decimal"
                  />
                </Field>
                <Field
                  label="Weight [kg/m]"
                  validationState={
                    cableTypeDialogErrors.weightKgPerM ? 'error' : undefined
                  }
                  validationMessage={cableTypeDialogErrors.weightKgPerM}
                >
                  <Input
                    value={cableTypeDialogValues.weightKgPerM}
                    onChange={handleCableTypeDialogFieldChange('weightKgPerM')}
                    inputMode="decimal"
                  />
                </Field>
                {cableTypeDialogErrors.general ? (
                  <Body1 className={styles.errorText}>
                    {cableTypeDialogErrors.general}
                  </Body1>
                ) : null}
              </DialogContent>
              <DialogActions className={styles.dialogActions}>
                <Button
                  type="button"
                  onClick={resetCableTypeDialog}
                  disabled={cableTypeDialogSubmitting}
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  appearance="primary"
                  disabled={cableTypeDialogSubmitting}
                >
                  {cableTypeDialogSubmitting
                    ? 'Saving...'
                    : cableTypeDialogMode === 'create'
                      ? 'Add'
                      : 'Save'}
                </Button>
              </DialogActions>
            </DialogBody>
          </form>
      </DialogSurface>
      </Dialog>

      <Dialog
        open={isCableDialogOpen}
        onOpenChange={(_, data) => {
          if (!data.open) {
            resetCableDialog();
          }
        }}
      >
        <DialogSurface>
          <form className={styles.dialogForm} onSubmit={handleSubmitCableDialog}>
            <DialogBody>
              <DialogTitle>
                {cableDialogMode === 'create' ? 'Add cable' : 'Edit cable'}
              </DialogTitle>
              <DialogContent>
                <Field
                  label="Cable ID"
                  required
                  validationState={
                    cableDialogErrors.cableId ? 'error' : undefined
                  }
                  validationMessage={cableDialogErrors.cableId}
                >
                  <Input
                    value={cableDialogValues.cableId}
                    onChange={handleCableDialogFieldChange('cableId')}
                    required
                  />
                </Field>
                <Field label="Tag">
                  <Input
                    value={cableDialogValues.tag}
                    onChange={handleCableDialogFieldChange('tag')}
                  />
                </Field>
                <Field
                  label="Cable type"
                  required
                  validationState={
                    cableDialogErrors.cableTypeId ? 'error' : undefined
                  }
                  validationMessage={cableDialogErrors.cableTypeId}
                >
                  <Dropdown
                    placeholder="Select cable type"
                  selectedOptions={
                    cableDialogValues.cableTypeId
                      ? [cableDialogValues.cableTypeId]
                      : []
                  }
                  value={selectedCableType?.name ?? ''}
                  onOptionSelect={handleCableTypeSelect}
                >
                    {cableTypes.map((type) => (
                      <Option key={type.id} value={type.id}>
                        {type.name}
                      </Option>
                    ))}
                  </Dropdown>
                </Field>
                <Field label="From location">
                  <Input
                    value={cableDialogValues.fromLocation}
                    onChange={handleCableDialogFieldChange('fromLocation')}
                  />
                </Field>
                <Field label="To location">
                  <Input
                    value={cableDialogValues.toLocation}
                    onChange={handleCableDialogFieldChange('toLocation')}
                  />
                </Field>
                <Field label="Routing">
                  <Input
                    value={cableDialogValues.routing}
                    onChange={handleCableDialogFieldChange('routing')}
                  />
                </Field>
                {cableDialogErrors.general ? (
                  <Body1 className={styles.errorText}>
                    {cableDialogErrors.general}
                  </Body1>
                ) : null}
              </DialogContent>
              <DialogActions className={styles.dialogActions}>
                <Button
                  type="button"
                  appearance="secondary"
                  onClick={resetCableDialog}
                  disabled={cableDialogSubmitting}
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  appearance="primary"
                  disabled={cableDialogSubmitting}
                >
                  {cableDialogSubmitting
                    ? 'Saving...'
                    : cableDialogMode === 'create'
                      ? 'Add cable'
                      : 'Save changes'}
                </Button>
              </DialogActions>
            </DialogBody>
          </form>
        </DialogSurface>
      </Dialog>
    </section>
  );
};
