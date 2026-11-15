import { excelImportErrorToast, excelImportSuccessToast } from '@/utils/excelImportFeedback';
import { describeRoutingImportConflict } from '../../../../shared/cableRoutingImport';
import type { CableImportDialogState } from '../CableImportDialog';
import type { CableListColumnId } from '@/api/cableListPreferences';
import { fetchRecalculationContext } from '@/api/pathfinderRecalculations';
import type { ChangeEvent, FormEvent, RefObject } from 'react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import type { ToastIntent } from '@fluentui/react-components';

import {
  ApiError,
  Cable,
  CableInput,
  CableVersion,
  type CableMtoOption,
  createCable,
  deleteCable,
  exportCables,
  fetchCables,
  fetchCableRows,
  fetchCableVersions,
  getCablesTemplate,
  importCables,
  updateCable,
} from '@/api/client';

import {
  CABLE_LIST_PER_PAGE,
  CABLE_LIST_PAGE_SIZE_OPTIONS,
  CableFormErrors,
  CableFormState,
  buildCableInput,
  changeCableFormField,
  emptyCableForm,
  parseCableFormErrors,
  toCableFormState,
} from '../../ProjectDetails.forms';
import { sanitizeFileSegment } from '../../ProjectDetails.utils';

export type CableSearchCriteria =
  | 'all'
  | 'tag'
  | 'typeName'
  | 'fromLocation'
  | 'toLocation'
  | 'routing'
  | 'delivery';

type ShowToast = (options: {
  title: string;
  body?: string;
  intent?: ToastIntent;
  timeout?: number;
  action?: { label: string; onClick: () => void };
}) => void;

type UseCableListSectionParams = {
  active?: boolean;
  projectId?: string;
  project: { id: string; projectNumber: string } | null;
  token: string | null;
  exportToken?: string | null;
  showToast: ShowToast;
};

type CableDialogMode = 'create' | 'edit';

type CableDialogController = {
  open: boolean;
  mode: CableDialogMode;
  values: CableFormState;
  errors: CableFormErrors;
  submitting: boolean;
  handleFieldChange: (
    field: keyof CableFormState,
  ) => (event: ChangeEvent<HTMLInputElement>, data: { value: string }) => void;
  handleCableTypeSelect: (event: unknown, data: { optionValue?: string }) => void;
  handleMtoSelect: (event: unknown, data: { optionValue?: string }) => void;
  handleSubmit: (event: FormEvent<HTMLFormElement>) => Promise<void>;
  reset: () => void;
};

type CableVersionsDialogState = {
  open: boolean;
  cable: Cable | null;
  versions: CableVersion[];
  loading: boolean;
  error: string | null;
};

type UseCableListSectionResult = {
  cables: Cable[];
  cablesLoading: boolean;
  cablesRefreshing: boolean;
  cablesError: string | null;
  cablesImporting: boolean;
  cablesExporting: boolean;
  cablesGettingTemplate: boolean;
  pendingCableId: string | null;
  pagedCables: Cable[];
  totalCablePages: number;
  cablesPage: number;
  cablesPageSize: number;
  setCablesPageSize: (pageSize: number) => void;
  showCablePagination: boolean;
  fileInputRef: RefObject<HTMLInputElement | null>;
  inlineEditingEnabled: boolean;
  setInlineEditingEnabled: (value: boolean) => void;
  inlineUpdatingIds: Set<string>;
  cableDrafts: Record<string, CableFormState>;
  reloadCables: (options?: { showSpinner?: boolean }) => Promise<void>;
  goToPreviousPage: () => void;
  goToNextPage: () => void;
  goToPage: (page: number) => void;
  openCreateCableDialog: (defaultCableTypeId?: string) => void;
  openEditCableDialog: (cable: Cable) => void;
  handleDeleteCable: (cable: Cable) => Promise<void>;
  handleImportCables: (event: ChangeEvent<HTMLInputElement>) => Promise<void>;
  cableImportDialog: {
    state: CableImportDialogState;
    onProtectChange: (checked: boolean) => void;
    onCommit: () => void;
    onClose: () => void;
  };
  handleExportCables: (
    view?: 'list' | 'report' | 'change-tracker',
    mto?: CableMtoOption | null,
    columns?: CableListColumnId[],
  ) => Promise<void>;
  handleGetCablesTemplate: (view?: 'list' | 'report') => Promise<void>;
  handleCableDraftChange: (cableId: string, field: keyof CableFormState, value: string) => void;
  handleCableTextFieldBlur: (cable: Cable, field: keyof CableFormState) => Promise<void>;
  handleInlineMtoChange: (cable: Cable, nextMto: string) => Promise<void>;
  handleInlineCableTypeChange: (cable: Cable, nextCableTypeId: string) => Promise<void>;
  openCableVersionsDialog: (cable: Cable) => void;
  closeCableVersionsDialog: () => void;
  cableVersionsDialog: CableVersionsDialogState;
  filterText: string;
  filterCriteria: CableSearchCriteria;
  setFilterText: (value: string) => void;
  setFilterCriteria: (value: CableSearchCriteria) => void;
  cableDialog: CableDialogController;
};

const defaultProjectSnapshot = (project: { id: string; projectNumber: string } | null) =>
  project ? { id: project.id, projectNumber: project.projectNumber } : null;

const formatApiError = (error: unknown, fallback: string): string => {
  if (error instanceof ApiError) {
    return error.message;
  }

  if (error instanceof Error && error.message) {
    return error.message;
  }

  return fallback;
};

const draftFields: (keyof CableFormState)[] = [
  'cableId',
  'revision',
  'mto',
  'tag',
  'cableTypeId',
  'fromLocation',
  'toLocation',
  'routing',
  'delivery',
  'designLength',
  'installLength',
  'pullDate',
  'connectedFrom',
  'connectedTo',
  'tested',
  'manualRoutingProtected',
  'executionUnlockReason',
];
const draftChanged = (draft: CableFormState, base: CableFormState) =>
  draftFields.some((field) => (draft[field] ?? '') !== (base[field] ?? ''));
const manualReadPending = (cable: Cable) =>
  ['pending', 'stale'].includes(cable.manualRouteLengthStatus ?? '') &&
  !cable.routingDiagnostics?.some((reason) =>
    reason.includes('MANUAL_CALCULATION_AUTHORITY_REQUIRED'),
  );
const olderCableRead = (current: Cable, next: Cable) =>
  (['routingControlRevision', 'cableWriteRevision'] as const).some((field) => {
    const before = current[field],
      after = next[field];
    if (!before) return false;
    if (!after) return true;
    return /^\d+$/.test(before) && /^\d+$/.test(after)
      ? BigInt(after) < BigInt(before)
      : before !== after;
  });

export const useCableListSection = ({
  active = false,
  projectId,
  project,
  token,
  exportToken = token,
  showToast,
}: UseCableListSectionParams): UseCableListSectionResult => {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const latestRequest = useRef(0);
  const manualReadEpoch = useRef(0);
  const manualReadBudget = useRef({ scope: '', attempts: 0 });
  const draftBases = useRef<Record<string, CableFormState>>({});
  const projectSnapshot = defaultProjectSnapshot(project);

  const [cables, setCables] = useState<Cable[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isRefreshing, setIsRefreshing] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [isImporting, setIsImporting] = useState<boolean>(false);
  const importFile = useRef<File | null>(null),
    importTicket = useRef(0);
  const importDigest = useRef<string | null>(null);
  const [importDialog, setImportDialog] = useState<CableImportDialogState>({
    open: false,
    fileName: '',
    protectRouting: false,
    loading: false,
    committing: false,
    summary: null,
    error: null,
    completed: false,
  });
  useEffect(() => {
    importTicket.current++;
    importFile.current = null;
    importDigest.current = null;
    setImportDialog({
      open: false,
      fileName: '',
      protectRouting: false,
      loading: false,
      committing: false,
      summary: null,
      error: null,
      completed: false,
    });
    setIsImporting(false);
  }, [projectSnapshot?.id, token]);
  const [isExporting, setIsExporting] = useState<boolean>(false);
  const [isGettingTemplate, setIsGettingTemplate] = useState<boolean>(false);
  const [pendingCableId, setPendingCableId] = useState<string | null>(null);
  const [page, setPage] = useState<number>(1);
  const [pageSize, setPageSize] = useState<number>(CABLE_LIST_PER_PAGE);

  const [isDialogOpen, setDialogOpen] = useState<boolean>(false);
  const [dialogMode, setDialogMode] = useState<CableDialogMode>('create');
  const [dialogValues, setDialogValues] = useState<CableFormState>(emptyCableForm);
  const [dialogErrors, setDialogErrors] = useState<CableFormErrors>({});
  const [dialogSubmitting, setDialogSubmitting] = useState<boolean>(false);
  const [editingCableId, setEditingCableId] = useState<string | null>(null);
  const [cableVersionsDialog, setCableVersionsDialog] = useState<CableVersionsDialogState>({
    open: false,
    cable: null,
    versions: [],
    loading: false,
    error: null,
  });

  const [inlineEditingEnabled, setInlineEditingEnabledState] = useState<boolean>(false);
  const [inlineUpdatingIds, setInlineUpdatingIds] = useState<Set<string>>(new Set());
  const [cableDrafts, setCableDrafts] = useState<Record<string, CableFormState>>({});
  const [filterText, setFilterText] = useState<string>('');
  const [filterCriteria, setFilterCriteria] = useState<CableSearchCriteria>('all');

  const sortCables = useCallback(
    (items: Cable[]) => [...items].sort((a, b) => a.cableId - b.cableId),
    [],
  );

  const getNextFreeCableId = useCallback((): number => {
    const occupiedIds = new Set<number>();

    for (const cable of cables) {
      if (Number.isInteger(cable.cableId) && cable.cableId >= 0) {
        occupiedIds.add(cable.cableId);
      }
    }

    let nextCableId = 1;
    while (occupiedIds.has(nextCableId)) {
      nextCableId += 1;
    }

    return nextCableId;
  }, [cables]);

  const filteredCables = useMemo(() => {
    const normalizedFilter = filterText.trim().toLowerCase();
    return cables.filter((cable) => {
      if (!normalizedFilter) {
        return true;
      }

      if (filterCriteria === 'all') {
        const values = [
          cable.revision,
          cable.mto,
          cable.tag,
          cable.typeName,
          cable.fromLocation,
          cable.toLocation,
          cable.routing,
          cable.delivery,
          cable.designLength !== null ? String(cable.designLength) : '',
        ];
        return values.some((value) => (value ?? '').toLowerCase().includes(normalizedFilter));
      }

      // Filter by specific criteria
      let value = '';
      switch (filterCriteria) {
        case 'tag':
          value = cable.tag ?? '';
          break;
        case 'typeName':
          value = cable.typeName ?? '';
          break;
        case 'fromLocation':
          value = cable.fromLocation ?? '';
          break;
        case 'toLocation':
          value = cable.toLocation ?? '';
          break;
        case 'routing':
          value = cable.routing ?? '';
          break;
        case 'delivery':
          value = cable.delivery ?? '';
          break;
      }
      return value.toLowerCase().includes(normalizedFilter);
    });
  }, [cables, filterText, filterCriteria]);

  const totalPages = useMemo(() => {
    if (filteredCables.length === 0) {
      return 1;
    }
    return Math.max(1, Math.ceil(filteredCables.length / pageSize));
  }, [filteredCables.length, pageSize]);

  const pagedCables = useMemo(() => {
    if (filteredCables.length === 0) {
      return [];
    }
    const startIndex = (page - 1) * pageSize;
    return filteredCables.slice(startIndex, startIndex + pageSize);
  }, [page, pageSize, filteredCables]);

  useEffect(() => {
    if (page > totalPages) {
      setPage(totalPages);
    }
  }, [page, totalPages]);

  const handleFilterTextChange = useCallback(
    (value: string) => {
      if (value !== filterText || page !== 1) manualReadEpoch.current++;
      setFilterText(value);
      setPage(1);
    },
    [filterText, page],
  );

  const handlePageSizeChange = useCallback(
    (nextPageSize: number) => {
      if (!CABLE_LIST_PAGE_SIZE_OPTIONS.some((option) => option === nextPageSize)) {
        return;
      }
      if (nextPageSize !== pageSize || page !== 1) manualReadEpoch.current++;
      setPageSize(nextPageSize);
      setPage(1);
    },
    [pageSize, page],
  );

  const handleFilterCriteriaChange = useCallback(
    (value: CableSearchCriteria) => {
      if (value !== filterCriteria || page !== 1) manualReadEpoch.current++;
      setFilterCriteria(value);
      setPage(1);
    },
    [filterCriteria, page],
  );

  const reloadCables = useCallback(
    async ({ showSpinner = true }: { showSpinner?: boolean } = {}) => {
      manualReadEpoch.current++;
      const request = ++latestRequest.current;
      if (!projectId) {
        setCables([]);
        setIsLoading(false);
        setIsRefreshing(false);
        return;
      }

      if (showSpinner) {
        setIsLoading(true);
      } else {
        setIsRefreshing(true);
      }

      setError(null);

      try {
        const response = await fetchCables(projectId);
        if (request !== latestRequest.current) return;
        setCables(sortCables(response.cables));
        setPage(1);
      } catch (err) {
        if (request !== latestRequest.current) return;
        console.error('Failed to load cables', err);
        if (err instanceof ApiError) {
          if (err.status === 404) {
            setCables([]);
            setPage(1);
            setError(
              'Cables endpoint is unavailable. Ensure the server is running the latest version.',
            );
          } else {
            setError(err.message);
          }
        } else {
          setError('Failed to load cables.');
        }
      } finally {
        if (request === latestRequest.current) {
          setIsLoading(false);
          setIsRefreshing(false);
        }
      }
    },
    [projectId, sortCables],
  );

  useEffect(() => {
    setCables([]);
    setPage(1);
    void reloadCables({ showSpinner: true });
    return () => {
      latestRequest.current += 1;
    };
  }, [projectId, reloadCables]);

  const loadCableVersions = useCallback(
    async (cableId: string) => {
      if (!projectId) {
        return;
      }

      setCableVersionsDialog((previous) =>
        previous.cable && previous.cable.id === cableId
          ? { ...previous, loading: true, error: null }
          : previous,
      );

      try {
        const response = await fetchCableVersions(projectId, cableId);
        setCableVersionsDialog((previous) =>
          previous.cable && previous.cable.id === cableId
            ? {
                ...previous,
                versions: response.versions,
                loading: false,
                error: null,
              }
            : previous,
        );
      } catch (error) {
        console.error('Failed to load cable versions', error);
        const message = formatApiError(error, 'Failed to load cable revisions.');
        setCableVersionsDialog((previous) =>
          previous.cable && previous.cable.id === cableId
            ? {
                ...previous,
                loading: false,
                error: message,
              }
            : previous,
        );
      }
    },
    [projectId],
  );

  const openCableVersionsDialog = useCallback(
    (cable: Cable) => {
      if (!projectId) {
        return;
      }

      setCableVersionsDialog({
        open: true,
        cable,
        versions: [],
        loading: true,
        error: null,
      });

      void loadCableVersions(cable.id);
    },
    [loadCableVersions, projectId],
  );

  const closeCableVersionsDialog = useCallback(() => {
    setCableVersionsDialog({
      open: false,
      cable: null,
      versions: [],
      loading: false,
      error: null,
    });
  }, []);

  const goToPreviousPage = useCallback(() => {
    if (page > 1) manualReadEpoch.current++;
    setPage((previous) => Math.max(1, previous - 1));
  }, [page]);

  const goToNextPage = useCallback(() => {
    if (page < totalPages) manualReadEpoch.current++;
    setPage((previous) => Math.min(totalPages, previous + 1));
  }, [page, totalPages]);

  const goToPage = useCallback(
    (nextPage: number) => {
      if (Math.min(Math.max(1, nextPage), totalPages) !== page) manualReadEpoch.current++;
      setPage(() => Math.min(Math.max(1, nextPage), totalPages));
    },
    [page, totalPages],
  );

  const handleFieldChange =
    (field: keyof CableFormState) =>
    (_event: ChangeEvent<HTMLInputElement>, data: { value: string }) => {
      setDialogValues((previous: CableFormState) =>
        changeCableFormField(previous, field, data.value),
      );
    };

  const handleCableTypeSelect = (_event: unknown, data: { optionValue?: string }) => {
    setDialogValues((previous: CableFormState) => ({
      ...previous,
      cableTypeId: data.optionValue ?? '',
    }));
  };

  const handleMtoSelect = (_event: unknown, data: { optionValue?: string }) => {
    setDialogValues((previous: CableFormState) => ({
      ...previous,
      mto: data.optionValue ?? '',
    }));
  };

  const resetDialog = useCallback(() => {
    setDialogOpen(false);
    setDialogErrors({});
    setDialogValues(emptyCableForm);
    setDialogSubmitting(false);
    setEditingCableId(null);
  }, []);

  const openCreateCableDialog = useCallback(
    (defaultCableTypeId?: string) => {
      const nextCableId = getNextFreeCableId();
      setDialogMode('create');
      setDialogErrors({});
      setDialogValues({
        ...emptyCableForm,
        cableId: String(nextCableId),
        cableTypeId: defaultCableTypeId ?? '',
      });
      setDialogOpen(true);
      setEditingCableId(null);
    },
    [getNextFreeCableId],
  );

  const openEditCableDialog = useCallback((cable: Cable) => {
    manualReadEpoch.current++;
    setDialogMode('edit');
    setDialogErrors({});
    setDialogValues(toCableFormState(cable));
    setDialogOpen(true);
    setEditingCableId(cable.id);
  }, []);

  const setInlineEditingEnabled = useCallback((value: boolean) => {
    setInlineEditingEnabledState(value);
  }, []);

  useEffect(() => {
    const previousBases = draftBases.current;
    const nextBases = Object.fromEntries(
      cables.map((cable) => [cable.id, toCableFormState(cable)]),
    );
    draftBases.current = nextBases;
    setCableDrafts((previous) =>
      Object.fromEntries(
        cables.map((cable) => {
          const draft = previous[cable.id],
            base = previousBases[cable.id];
          return [
            cable.id,
            draft && base && draftChanged(draft, base) ? draft : nextBases[cable.id],
          ];
        }),
      ),
    );
  }, [cables]);

  useEffect(() => {
    if (!inlineEditingEnabled) setCableDrafts({ ...draftBases.current });
  }, [inlineEditingEnabled]);

  const pollBlocked =
    isLoading ||
    isRefreshing ||
    isImporting ||
    dialogSubmitting ||
    pendingCableId !== null ||
    inlineUpdatingIds.size > 0;
  const pendingVisible = pagedCables.filter(
    (cable) =>
      cable.projectId === projectId &&
      manualReadPending(cable) &&
      !(isDialogOpen && editingCableId === cable.id) &&
      !(cableDrafts[cable.id] && draftChanged(cableDrafts[cable.id], toCableFormState(cable))),
  );
  const pendingVisibleKey = pendingVisible
    .map((cable) => `${cable.id}:${cable.routingControlRevision ?? ''}`)
    .join('|');
  const visibleClean = pagedCables.filter(cable => cable.projectId === projectId
    && !(isDialogOpen && editingCableId === cable.id)
    && !(cableDrafts[cable.id] && draftChanged(cableDrafts[cable.id], toCableFormState(cable))));
  const readToken = token ?? exportToken;
  const visibleKey = pagedCables.map(cable => cable.id).join('|');
  const visibleCleanKey = visibleClean.map(cable => cable.id).join('|');
  const pollState = useRef({ projectId, token, pendingVisible, pollBlocked, visibleClean, readToken, active });
  pollState.current = { projectId, token, pendingVisible, pollBlocked, visibleClean, readToken, active };
  const pollScope = JSON.stringify([
    projectId,
    token,
    page,
    pageSize,
    filterText,
    filterCriteria,
    latestRequest.current,
    manualReadEpoch.current,
  ]);
  useEffect(() => {
    if (
      !projectId ||
      projectSnapshot?.id !== projectId ||
      !token ||
      pollBlocked ||
      !pendingVisibleKey
    )
      return;
    if (manualReadBudget.current.scope !== pollScope)
      manualReadBudget.current = { scope: pollScope, attempts: 0 };
    let closed = false,
      timer: ReturnType<typeof setTimeout> | undefined;
    const ticket = latestRequest.current,
      epoch = manualReadEpoch.current;
    const targetIds = new Set(pollState.current.pendingVisible.map((cable) => cable.id));
    const currentOwner = () =>
      !closed &&
      latestRequest.current === ticket &&
      manualReadEpoch.current === epoch &&
      pollState.current.projectId === projectId &&
      pollState.current.token === token &&
      !pollState.current.pollBlocked;
    const poll = async () => {
      if (!currentOwner() || manualReadBudget.current.attempts >= 30) return;
      manualReadBudget.current.attempts++;
      try {
        const response = await fetchCableRows(projectId, [...targetIds]);
        if (!currentOwner()) return;
        const fresh = new Map(
          response.cables
            .filter((cable) => cable.projectId === projectId && targetIds.has(cable.id))
            .map((cable) => [cable.id, cable]),
        );
        setCables((previous) => {
          if (!currentOwner()) return previous;
          const allowed = new Set(pollState.current.pendingVisible.map((cable) => cable.id));
          let changed = false;
          const next = previous.map((cable) => {
            const value = fresh.get(cable.id);
            if (
              !value ||
              !allowed.has(cable.id) ||
              olderCableRead(cable, value) ||
              JSON.stringify(cable) === JSON.stringify(value)
            )
              return cable;
            changed = true;
            return value;
          });
          return changed ? next : previous;
        });
      } catch {
        /* Keep the visible values; the existing Refresh action remains available. */
      }
      if (currentOwner() && manualReadBudget.current.attempts < 30)
        timer = setTimeout(() => void poll(), 2000);
    };
    timer = setTimeout(() => void poll(), 2000);
    return () => {
      closed = true;
      if (timer) clearTimeout(timer);
    };
  }, [projectId, projectSnapshot?.id, token, pollScope, pendingVisibleKey, pollBlocked]);

  // Observe the finite job's small status record. Only progress changes and the
  // final save drain read the visible business rows, never the entire project.
  useEffect(() => {
    if (!active || !projectId || projectSnapshot?.id !== projectId || !readToken || pollBlocked || !visibleKey || !pollState.current.visibleClean.length) return;
    let closed = false, timer: ReturnType<typeof setTimeout> | undefined, operation: AbortController | undefined;
    let attempts = 0, failures = 0, lastProgress = '', drains = 2, deadline = Date.now() + 1800000;
    const ticket = latestRequest.current, epoch = manualReadEpoch.current;
    const owner = () => !closed && pollState.current.active && pollState.current.projectId === projectId
      && pollState.current.readToken === readToken && latestRequest.current === ticket && manualReadEpoch.current === epoch && !pollState.current.pollBlocked;
    const poll = async () => {
      if (!owner() || Date.now() >= deadline || attempts++ >= 900) return;
      let delay = 2000, again = false;
      operation = new AbortController();
      const timeout = setTimeout(() => operation?.abort(), 10000);
      try {
        const context = await fetchRecalculationContext(projectId, readToken, operation.signal);
        if (!owner()) return;
        const progress = JSON.stringify([context.controlRevision, context.desiredGeneration, context.jobId, context.status,
          context.completed, context.progress]);
        const authorityLive = !!context.authority && Date.parse(context.authority.expiresAt) > Date.now();
        if (authorityLive) deadline = Math.min(deadline, Date.parse(context.authority!.expiresAt));
        const running = context.enabled && !context.paused && authorityLive
          && ['debouncing', 'collecting', 'queued', 'calculating', 'complete'].includes(context.status)
          && (['debouncing', 'collecting', 'queued', 'calculating'].includes(context.status) || (context.progress?.saving ?? 0) > 0);
        const finalDrain = !running && context.status === 'complete' && !context.paused && authorityLive && drains > 0;
        if (context.jobId && (progress !== lastProgress || finalDrain)) {
          const ids = pollState.current.visibleClean.map(cable => cable.id).slice(0, 100);
          if (ids.length) {
            const response = await fetchCableRows(projectId, ids);
            if (!owner()) return;
            const fresh = new Map(response.cables.filter(cable => cable.projectId === projectId && ids.includes(cable.id)).map(cable => [cable.id, cable]));
            setCables(previous => {
              if (!owner()) return previous;
              const allowed = new Set(pollState.current.visibleClean.map(cable => cable.id));
              let changed = false;
              const next = previous.map(cable => {
                const value = fresh.get(cable.id);
                if (!value || !allowed.has(cable.id) || olderCableRead(cable, value) || JSON.stringify(cable) === JSON.stringify(value)) return cable;
                changed = true; return value;
              });
              return changed ? next : previous;
            });
          }
        }
        failures = 0; lastProgress = progress;
        if (running) drains = 2;
        else if (finalDrain) drains--;
        again = running || finalDrain;
      } catch (error) {
        if (!owner()) return;
        if ([401, 403, 404].includes((error as { status?: number })?.status ?? 0)
          || (error as { code?: string })?.code === 'INVALID_RESPONSE') return;
        delay = Math.min(15000, 2000 * 2 ** Math.min(++failures, 3)); again = true;
      } finally { clearTimeout(timeout); }
      if (again && owner() && attempts < 900) timer = setTimeout(() => void poll(), delay);
    };
    void poll();
    return () => { closed = true; operation?.abort(); if (timer) clearTimeout(timer); };
  }, [active, projectId, projectSnapshot?.id, readToken, pollScope, visibleKey, visibleCleanKey, pollBlocked]);

  const handleCableDraftChange = useCallback(
    (cableId: string, field: keyof CableFormState, value: string) => {
      manualReadEpoch.current++;
      setCableDrafts((previous: Record<string, CableFormState>) => {
        const baseDraft =
          previous[cableId] ??
          (() => {
            const cable = cables.find((item) => item.id === cableId);
            return cable ? toCableFormState(cable) : { ...emptyCableForm };
          })();

        return {
          ...previous,
          [cableId]: changeCableFormField(baseDraft, field, value),
        };
      });
    },
    [cables],
  );

  const updateCableInline = useCallback(
    async (cable: Cable, changes: Partial<CableInput>) => {
      if (!projectSnapshot || !token) {
        showToast({
          intent: 'error',
          title: 'Sign-in required',
          body: 'You need to be signed in to update cables.',
        });
        return;
      }

      if (Object.keys(changes).length === 0) {
        return;
      }

      manualReadEpoch.current++;
      setInlineUpdatingIds((previous: Set<string>) => {
        const next = new Set(previous);
        next.add(cable.id);
        return next;
      });

      try {
        const response = await updateCable(token, projectSnapshot.id, cable.id, changes);
        setCables((previous: Cable[]) =>
          sortCables(previous.map((item) => (item.id === cable.id ? response.cable : item))),
        );
        setCableDrafts((previous: Record<string, CableFormState>) => ({
          ...previous,
          [cable.id]: toCableFormState(response.cable),
        }));

        if (
          cableVersionsDialog.open &&
          cableVersionsDialog.cable &&
          cableVersionsDialog.cable.id === cable.id
        ) {
          setCableVersionsDialog((previous) =>
            previous.cable && previous.cable.id === cable.id
              ? { ...previous, cable: response.cable }
              : previous,
          );
          void loadCableVersions(cable.id);
        }
      } catch (err) {
        console.error('Inline cable update failed', err);
        showToast({
          intent: 'error',
          title: 'Failed to update cable',
          body: err instanceof ApiError ? err.message : undefined,
        });
      } finally {
        setInlineUpdatingIds((previous: Set<string>) => {
          const next = new Set(previous);
          next.delete(cable.id);
          return next;
        });
      }
    },
    [
      cableVersionsDialog.cable,
      cableVersionsDialog.open,
      loadCableVersions,
      projectSnapshot,
      showToast,
      sortCables,
      token,
    ],
  );

  const handleInlineCableTypeChange = useCallback(
    async (cable: Cable, nextCableTypeId: string) => {
      if (nextCableTypeId === '' || nextCableTypeId === cable.cableTypeId) {
        return;
      }
      await updateCableInline(cable, { cableTypeId: nextCableTypeId });
    },
    [updateCableInline],
  );

  const handleInlineMtoChange = useCallback(
    async (cable: Cable, nextMto: string) => {
      const normalizedMto = nextMto.trim();
      const currentMto = cable.mto ?? '';

      if (normalizedMto === currentMto) {
        return;
      }

      await updateCableInline(cable, {
        mto: normalizedMto === '' ? null : (normalizedMto as NonNullable<CableInput['mto']>),
      });
    },
    [updateCableInline],
  );

  const handleCableTextFieldBlur = useCallback(
    async (cable: Cable, field: keyof CableFormState) => {
      const draft = cableDrafts[cable.id];
      if (!draft) {
        return;
      }

      let changes: Partial<CableInput> | null = null;

      switch (field) {
        case 'revision':
        case 'tag':
        case 'fromLocation':
        case 'toLocation':
        case 'delivery': {
          const normalized = draft[field].trim();
          const current = (cable[field] ?? '').trim();

          if (normalized === current) {
            return;
          }

          changes = { [field]: normalized } as Partial<CableInput>;
          break;
        }
        case 'routing': {
          const normalized = draft.routing.trim();
          const current = (
            cable.routingControl
              ? (cable.routingControl.manualRouting ?? '')
              : (cable.routing ?? '')
          ).trim();
          const protectedRoute = normalized !== '' && draft.manualRoutingProtected === 'true';
          if (
            normalized === current &&
            protectedRoute === (cable.routingControl?.manualProtected ?? Boolean(current))
          )
            return;
          changes = {
            routing: normalized,
            manualRoutingProtected: protectedRoute,
            ...(cable.cableWriteRevision
              ? { expectedCableWriteRevision: cable.cableWriteRevision }
              : {}),
            ...(cable.routingControlRevision
              ? { expectedRoutingControlRevision: cable.routingControlRevision }
              : {}),
          };
          break;
        }
        case 'designLength': {
          const trimmed = draft[field].trim();
          const current = (cable[field] ?? null) as number | null;

          if (trimmed === '') {
            if (current === null) {
              return;
            }
            changes = { [field]: null } as Partial<CableInput>;
          } else {
            const parsed = Number(trimmed);
            if (!Number.isFinite(parsed) || !Number.isInteger(parsed) || parsed < 0) {
              const label = 'Design length';
              showToast({
                intent: 'error',
                title: `Invalid ${label.toLowerCase()}`,
                body: `${label} must be a non-negative integer.`,
              });
              return;
            }

            if (parsed === current) {
              return;
            }

            changes = { [field]: parsed } as Partial<CableInput>;
          }
          break;
        }
        default:
          return;
      }

      if (!changes) {
        return;
      }

      await updateCableInline(cable, changes);
    },
    [cableDrafts, showToast, updateCableInline],
  );

  const handleSubmit = useCallback(
    async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();

      if (!projectSnapshot || !token) {
        setDialogErrors({
          general: 'You need to be signed in to manage cables.',
        });
        return;
      }

      const { input, errors } = buildCableInput(dialogValues);

      if (Object.keys(errors).length > 0) {
        setDialogErrors(errors);
        return;
      }

      manualReadEpoch.current++;
      setDialogSubmitting(true);
      setDialogErrors({});

      try {
        if (dialogMode === 'create') {
          const response = await createCable(token, projectSnapshot.id, input);
          setCables((previous: Cable[]) => sortCables([...previous, response.cable]));
          setPage(1);
          showToast({ intent: 'success', title: 'Cable added' });
        } else if (editingCableId) {
          const response = await updateCable(token, projectSnapshot.id, editingCableId, input);
          setCables((previous: Cable[]) =>
            sortCables(
              previous.map((item) => (item.id === editingCableId ? response.cable : item)),
            ),
          );
          setCableDrafts((previous: Record<string, CableFormState>) => ({
            ...previous,
            [editingCableId]: toCableFormState(response.cable),
          }));
          if (
            cableVersionsDialog.open &&
            cableVersionsDialog.cable &&
            cableVersionsDialog.cable.id === editingCableId
          ) {
            setCableVersionsDialog((previous) =>
              previous.cable && previous.cable.id === editingCableId
                ? { ...previous, cable: response.cable }
                : previous,
            );
            await loadCableVersions(editingCableId);
          }
          showToast({ intent: 'success', title: 'Cable updated' });
        }
        resetDialog();
      } catch (err) {
        console.error('Save cable failed', err);
        if (err instanceof ApiError) {
          setDialogErrors(parseCableFormErrors(err.payload));
          showToast({
            intent: 'error',
            title: 'Failed to save cable',
            body: err.message,
          });
        } else {
          const message = 'Failed to save cable. Please try again.';
          setDialogErrors({
            general: message,
          });
          showToast({
            intent: 'error',
            title: 'Failed to save cable',
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
      cableVersionsDialog.cable,
      cableVersionsDialog.open,
      editingCableId,
      loadCableVersions,
      projectSnapshot,
      resetDialog,
      showToast,
      sortCables,
      token,
    ],
  );

  const handleDeleteCable = useCallback(
    async (cable: Cable) => {
      if (!projectSnapshot || !token) {
        showToast({
          intent: 'error',
          title: 'Sign-in required',
          body: 'You need to be signed in to delete cables.',
        });
        return;
      }

      const confirmed = window.confirm(
        `Delete cable "${cable.cableId}"? This action cannot be undone.`,
      );

      if (!confirmed) {
        return;
      }

      manualReadEpoch.current++;
      setPendingCableId(cable.id);

      try {
        await deleteCable(token, projectSnapshot.id, cable.id);
        setCables((previous: Cable[]) => previous.filter((item) => item.id !== cable.id));
        if (
          cableVersionsDialog.open &&
          cableVersionsDialog.cable &&
          cableVersionsDialog.cable.id === cable.id
        ) {
          closeCableVersionsDialog();
        }
        showToast({ intent: 'success', title: 'Cable deleted' });
      } catch (err) {
        console.error('Delete cable failed', err);
        showToast({
          intent: 'error',
          title: 'Failed to delete cable',
          body: err instanceof ApiError ? err.message : undefined,
        });
      } finally {
        setPendingCableId(null);
      }
    },
    [
      cableVersionsDialog.cable,
      cableVersionsDialog.open,
      closeCableVersionsDialog,
      projectSnapshot,
      showToast,
      token,
    ],
  );

  const previewCableImport = useCallback(
    async (file: File, protectRouting: boolean) => {
      if (!projectSnapshot || !token) return;
      const ticket = ++importTicket.current;
      importFile.current = file;
      importDigest.current = null;
      setIsImporting(true);
      setImportDialog({
        open: true,
        fileName: file.name,
        protectRouting,
        loading: true,
        committing: false,
        summary: null,
        error: null,
        completed: false,
      });
      try {
        const response = await importCables(token, projectSnapshot.id, file, {
          preview: true,
          protectRouting,
        });
        if (ticket !== importTicket.current) return;
        if (
          response.preview !== true ||
          !response.revisionDigest ||
          !/^[a-f0-9]{64}$/.test(response.revisionDigest)
        )
          throw new Error('The import preview could not be verified. No changes were saved.');
        importDigest.current = response.revisionDigest;
        setImportDialog((previous) => ({ ...previous, summary: response.summary, loading: false }));
      } catch (err) {
        if (ticket === importTicket.current)
          setImportDialog((previous) => ({
            ...previous,
            loading: false,
            error: err instanceof Error ? err.message : 'The workbook could not be checked.',
          }));
      } finally {
        if (ticket === importTicket.current) setIsImporting(false);
      }
    },
    [projectSnapshot, token],
  );
  const handleImportCables = useCallback(
    async (event: ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      event.target.value = '';
      if (!file) return;
      if (!projectSnapshot || !token) {
        showToast({
          intent: 'error',
          title: 'Sign-in required',
          body: 'You need to be signed in to import cables.',
        });
        return;
      }
      await previewCableImport(file, false);
    },
    [projectSnapshot, token, showToast, previewCableImport],
  );
  const commitCableImport = useCallback(async () => {
    const file = importFile.current,
      digest = importDigest.current;
    if (
      !file ||
      !digest ||
      !projectSnapshot ||
      !token ||
      importDialog.loading ||
      importDialog.committing ||
      importDialog.completed
    )
      return;
    manualReadEpoch.current++;
    const ticket = ++importTicket.current;
    setIsImporting(true);
    setImportDialog((previous) => ({ ...previous, committing: true, error: null }));
    try {
      const response = await importCables(token, projectSnapshot.id, file, {
        protectRouting: importDialog.protectRouting,
        expectedRevisionDigest: digest,
      });
      if (ticket !== importTicket.current) return;
      if (response.preview)
        throw new Error('The import was not confirmed. Check the current workbook again.');
      setCables(sortCables(response.cables));
      setPage(1);
      if (cableVersionsDialog.open && cableVersionsDialog.cable)
        void loadCableVersions(cableVersionsDialog.cable.id);
      const completedReport: CableImportDialogState = {
        open: true,
        fileName: file.name,
        protectRouting: importDialog.protectRouting,
        summary: response.summary,
        loading: false,
        committing: false,
        completed: true,
        error: null,
      };
      setImportDialog(completedReport);
      const conflicts = response.summary.blockedRouting ?? [];
      const toast = excelImportSuccessToast(file.name, response.summary, 'Cables');
      showToast({
        ...toast,
        intent: conflicts.length ? 'warning' : toast.intent,
        body: [
          toast.body,
          ...(conflicts.length
            ? [
                String(conflicts.length) + ' routes were retained because of execution protection.',
                ...conflicts.slice(0, 5).map(describeRoutingImportConflict),
              ]
            : []),
        ]
          .filter(Boolean)
          .join('\n'),
        timeout: conflicts.length ? 20000 : undefined,
        action: {
          label: 'View all',
          onClick: () =>
            setImportDialog((previous) =>
              previous.loading || previous.committing ? previous : completedReport,
            ),
        },
      });
    } catch (err) {
      if (ticket !== importTicket.current) return;
      setImportDialog((previous) => ({
        ...previous,
        committing: false,
        error:
          err instanceof Error
            ? err.message
            : 'Import was not confirmed. Check the current cable list before retrying.',
      }));
      showToast(excelImportErrorToast(err, file.name));
    } finally {
      if (ticket === importTicket.current) setIsImporting(false);
    }
  }, [projectSnapshot, token, importDialog, cableVersionsDialog, loadCableVersions, showToast]);

  const handleExportCables = useCallback(
    async (
      view: 'list' | 'report' | 'change-tracker' = 'list',
      mto: CableMtoOption | null = null,
      columns?: CableListColumnId[],
    ) => {
      if (!projectSnapshot || !exportToken) {
        showToast({
          intent: 'error',
          title: 'Sign-in required',
          body: 'You need to be signed in to export cables.',
        });
        return;
      }

      setIsExporting(true);

      try {
        const blob = await exportCables(exportToken, projectSnapshot.id, {
          filterText,
          criteria: filterCriteria,
          view,
          mto,
          columns,
        });
        const link = document.createElement('a');
        const url = window.URL.createObjectURL(blob);
        const suffix =
          view === 'report'
            ? mto
              ? `cables-report-${sanitizeFileSegment(mto)}`
              : 'cables-report'
            : view === 'change-tracker'
              ? 'change-tracker'
              : 'cable-list';
        const fileName = `${sanitizeFileSegment(projectSnapshot.projectNumber)}-${suffix}.xlsx`;

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
            body: 'Please restart the API server after updating it.',
          });
        } else {
          showToast({
            intent: 'error',
            title: 'Failed to export cables',
            body: err instanceof ApiError ? err.message : undefined,
          });
        }
      } finally {
        setIsExporting(false);
      }
    },
    [filterCriteria, filterText, projectSnapshot, showToast, exportToken],
  );

  const handleGetCablesTemplate = useCallback(
    async (view?: 'list' | 'report') => {
      if (!projectSnapshot || !token) {
        showToast({
          intent: 'error',
          title: 'Admin access required',
          body: 'You need to be signed in as an admin to get the template.',
        });
        return;
      }

      setIsGettingTemplate(true);

      try {
        const blob = await getCablesTemplate(token, projectSnapshot.id, view);
        const link = document.createElement('a');
        const url = window.URL.createObjectURL(blob);
        const fileSuffix = view === 'report' ? 'cables-report' : 'cable-list';
        const fileName = `${fileSuffix}-template.xlsx`;

        link.href = url;
        link.download = fileName;
        document.body.appendChild(link);
        link.click();
        link.remove();
        window.URL.revokeObjectURL(url);

        showToast({ intent: 'success', title: 'Template downloaded' });
      } catch (err) {
        console.error('Get cables template failed', err);
        showToast({
          intent: 'error',
          title: 'Failed to get template',
          body: err instanceof ApiError ? err.message : undefined,
        });
      } finally {
        setIsGettingTemplate(false);
      }
    },
    [projectSnapshot, showToast, token],
  );

  return {
    cables,
    cablesLoading: isLoading,
    cablesRefreshing: isRefreshing,
    cablesError: error,
    cablesImporting: isImporting,
    cablesExporting: isExporting,
    cablesGettingTemplate: isGettingTemplate,
    pendingCableId,
    pagedCables,
    totalCablePages: totalPages,
    cablesPage: page,
    cablesPageSize: pageSize,
    setCablesPageSize: handlePageSizeChange,
    showCablePagination: totalPages > 1,
    fileInputRef,
    inlineEditingEnabled,
    setInlineEditingEnabled,
    inlineUpdatingIds,
    cableDrafts,
    reloadCables,
    goToPreviousPage,
    goToNextPage,
    goToPage,
    openCreateCableDialog,
    openEditCableDialog,
    handleDeleteCable,
    handleImportCables,
    cableImportDialog: {
      state: importDialog,
      onProtectChange: (checked: boolean) => {
        if (importFile.current && !importDialog.committing)
          void previewCableImport(importFile.current, checked);
      },
      onCommit: () => {
        void commitCableImport();
      },
      onClose: () => {
        if (!importDialog.committing) {
          importTicket.current++;
          setIsImporting(false);
          setImportDialog((previous) => ({ ...previous, open: false }));
        }
      },
    },
    handleExportCables,
    handleGetCablesTemplate,
    handleCableDraftChange,
    handleCableTextFieldBlur,
    handleInlineMtoChange,
    handleInlineCableTypeChange,
    openCableVersionsDialog,
    closeCableVersionsDialog,
    cableVersionsDialog,
    filterText,
    filterCriteria,
    setFilterText: handleFilterTextChange,
    setFilterCriteria: handleFilterCriteriaChange,
    cableDialog: {
      open: isDialogOpen,
      mode: dialogMode,
      values: dialogValues,
      errors: dialogErrors,
      submitting: dialogSubmitting,
      handleFieldChange,
      handleCableTypeSelect,
      handleMtoSelect,
      handleSubmit,
      reset: resetDialog,
    },
  };
};
