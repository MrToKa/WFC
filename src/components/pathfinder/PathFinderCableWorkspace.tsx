import { useCallback, useEffect, useRef, useState } from 'react';
import { Button, Portal } from '@fluentui/react-components';
import { requestFloatingCableWindow, type FloatingCableWindowRequest } from '@/hooks/useFloatingCablePanel';
import { useCableInformationPanelStyles } from '@/pages/ProjectDetails/CableInformationPanel.styles';
import { fetchPathFinderJob, type PathFinderPreferences, type PathFinderJob } from '@/api/pathfinder';
import { pathFinderRequestDeadline } from '@/api/pathfinderRequestDeadline';
import { calculationSubmissionRefusalMessage } from '../../../shared/pathfinderCalculationSubmission';
import { AUTOMATIC_PAIR_POLICY } from '../../../shared/pathfinderAutomaticPair';
import { sameSupportedBarrierAdmissionIntent as sameBarrierAdmissionIntent } from '../../../shared/pathfinderBarrierSupported';
import { fetchPathFinderCableWorkflowDetail, type CableWorkflowDetailQuery, type CableWorkflowRow } from '@/api/pathfinderCableWorkflow';
import { fetchLocationImpacts, type LocationImpactSummary } from '@/api/pathfinderLocationImpacts';
import type { CableEndpointReceipt } from '@/api/pathfinderCableEndpoints';
import { usePathfinderLocationImpactProgress } from '@/hooks/usePathfinderLocationImpactProgress';
import { usePathfinderInitialFillProgress } from '@/hooks/usePathfinderInitialFillProgress';
import type { EndpointCurrentScope } from '../../../shared/pathfinderEndpointBindings';
import type { LocationImpactCalculation } from '../../../shared/pathfinderLocationImpacts';
import { cableWorkflowRowSchema, classifyCableWorkflow } from '../../../shared/pathfinderCableWorkflow';
import { isPathFinderCableEligible } from '../../../shared/pathfinderCableEligibility';
import type { usePathFinder } from '@/pages/ProjectDetails/hooks/usePathFinder';
import type { PathFinderWorkflowDisplay, PathFinderWorkflowReview, PathFinderWorkflowCalculationPreferences } from '@/pages/ProjectDetails/PathFinderResults';
import { pathFinderWorkflowDisplayScope } from '@/pages/ProjectDetails/PathFinderResults';
import { policyUuidSchema } from '../../../shared/pathfinderPurposePolicy';
import { cableWorkflowReason, PathFinderNeedsRoutingList } from './PathFinderNeedsRoutingList';
import { PathFinderCableRoutingPanel, type PathFinderCalculationDiagnostics } from './PathFinderCableRoutingPanel';
import type { PathFinderEndpointForegroundContexts } from '@/pages/ProjectDetails/pathFinderEndpointVisibility';

type Access = { projectId: string | null; loadedProjectId: string | null; accountId: string | null; token: string | null; isAdmin: boolean };
const automaticUpdatePending = (calculation: CableWorkflowRow['calculation']) => !calculation.acceptedMatchesCurrent
  && ['pending','running','unknown'].includes(calculation.automaticUpdate?.status ?? '');
const calculationFinished = (calculation: CableWorkflowRow['calculation']) => !automaticUpdatePending(calculation)
  && (['complete','failed','cancelled'].includes(calculation.jobStatus??'') || calculation.itemState==='complete' && calculation.outcome==='calculated'
    && calculation.currentness==='current' && calculation.proposalId!==null && (calculation.acceptedMatchesCurrent || Boolean(calculation.itemApplicability)));
// A shared-location job can still be processing other cables after this item
// has a sealed current result. Only this item's outstanding work blocks it.
const selectedCalculationPending = (calculation: CableWorkflowRow['calculation']) => automaticUpdatePending(calculation)
  || ['queued', 'running'].includes(calculation.jobStatus ?? '') && !calculationFinished(calculation);
export type PathFinderCableWorkspaceProps = Access & { pf: ReturnType<typeof usePathFinder>; active: boolean;
  preferences: PathFinderPreferences | null; selectedCableId?: string | null; refreshKey?: number; onSelect: (row: CableWorkflowRow) => void;
  readPreferences?: CableWorkflowDetailQuery | null;
  display?: PathFinderWorkflowDisplay; onTogglePath?: (cableId: string) => void; review?: PathFinderWorkflowReview | null;
  onEndpointForegroundContexts?: (value: PathFinderEndpointForegroundContexts | null) => void;
  onCalculationStart?: (cableId: string) => void; onConfigureCalculation?: () => void;
  getCalculationPreferences?: (drillThroughWalls: boolean) => PathFinderPreferences | null;
  onCalculationPreferences?: (value: PathFinderWorkflowCalculationPreferences) => void };
type Impact = { id: string; current: EndpointCurrentScope; calculation: LocationImpactCalculation | null; originCableId: string | null };
type CalculationAttempt = Readonly<{ epoch: number; owner: string }>;
type SubmittedCalculation = { cableId: string; jobId: string | null; preferences: PathFinderPreferences; previousJobId: string | null; previousProposalId: string | null; attempt: CalculationAttempt | null };
type SavedCalculation = { cableId: string; impactId: string; preferences: PathFinderPreferences; previousJobId: string | null; previousProposalId: string | null; reading: boolean; attempt: CalculationAttempt };
type CalculationFeedback = { cableId: string; message: string; working: boolean; attempt: CalculationAttempt | null };
type SettledDiagnostics = { owner: string; model: string; cableId: string; jobId: string; proposalId: string; proposalHash: string };
type CalculationDiagnosticSnapshot = { owner: string; model: string; value: PathFinderCalculationDiagnostics };
const displayCandidate = (calculation: CableWorkflowRow['calculation']) => calculation.outcome === 'calculated'
  && calculation.currentness === 'current' && calculation.itemState === 'complete' && calculation.proposalId !== null && calculation.proposalHash !== null;
const savedDisplayCandidate = (calculation: CableWorkflowRow['calculation']) => calculation.savedExactDisplay === true
  && calculation.outcome === 'calculated' && calculation.itemState === 'complete' && calculation.jobStatus === 'complete'
  && calculation.proposalId !== null && calculation.proposalHash !== null;
const MAX_RETAINED_CALCULATION_ATTEMPTS = 128;
// Charge a status/detail round once. Its terminal read, state refresh and exact
// recheck must still finish on the last allowed round. Recovery remains GET-only.
const CALCULATION_READ_WINDOW_MS = 120_000;
const CALCULATION_POLL_ROUNDS = 80;
const CALCULATION_RECOVERY_WINDOWS = 1;
const CALCULATION_RECOVERY_DELAY_MS = 5_000;
const workflowReadPreferences = (props: PathFinderCableWorkspaceProps) => props.readPreferences === undefined ? props.preferences : props.readPreferences;
type WorkspaceState = NonNullable<PathFinderCableWorkspaceProps['pf']['data']>;
const workspaceReadScope = (props: PathFinderCableWorkspaceProps, state = props.pf.data) => JSON.stringify([
  workflowReadPreferences(props), props.pf.preparationViewerGeneration, state?.artifacts.map(item => [item.id, item.snapshotSha256]),
]);
const activeModelScope = (model: WorkspaceState['activeModel'] | undefined) => JSON.stringify([model?.modelVersionId, model?.selectionRevision, model?.contentFingerprint]);
const modelScope = (props: PathFinderCableWorkspaceProps) => activeModelScope(props.pf.data?.activeModel);
// A pending job reads its frozen command preferences. A later next-calculation
// draft must not stop that watcher; account and prepared-model ownership still do.
const calculationWatchOwner = (props: PathFinderCableWorkspaceProps) => JSON.stringify([
  props.projectId, props.loadedProjectId, props.accountId, props.token, props.isAdmin, props.pf.preparationViewerGeneration,
]);
const calculationAttemptOwner = (props: PathFinderCableWorkspaceProps) => JSON.stringify([
  calculationWatchOwner(props), modelScope(props), props.pf.data?.artifacts.map(item => [item.id, item.snapshotSha256]),
]);
const readFailure = (code: string) => Object.assign(new Error(code), { code });
async function readWithinCalculationBudget<T>(signal: AbortSignal, expiresAt: number, read: (signal: AbortSignal) => Promise<T>): Promise<T> {
  const remaining = Math.min(30_000, expiresAt - Date.now());
  if (remaining <= 0) throw readFailure('CALCULATION_READ_BUDGET');
  const deadline = pathFinderRequestDeadline(signal, remaining, () => readFailure('CALCULATION_READ_TIMEOUT'));
  try { return await deadline.wait(() => read(deadline.signal)); }
  finally { deadline.dispose(); }
}
const readCalculationJob = (projectId: string, token: string, jobId: string, signal: AbortSignal, expiresAt: number) =>
  readWithinCalculationBudget(signal, expiresAt, boundedSignal => fetchPathFinderJob(projectId, token, jobId, boundedSignal));
const retryableCalculationRead = (error: unknown) => {
  const value = error as { status?: unknown; code?: unknown; message?: unknown; name?: unknown } | null;
  const status = typeof value?.status === 'number' ? value.status : null;
  if (status !== null) return status === 408 || status === 429 || status >= 500;
  if (value?.name === 'AbortError' || ['INVALID_REQUEST', 'INVALID_RESPONSE', 'CALCULATION_SCOPE_CHANGED'].includes(String(value?.code ?? value?.message))) return false;
  return true;
};
function verifyDetailScope(detail: Awaited<ReturnType<typeof fetchPathFinderCableWorkflowDetail>>, projectId: string, cableId: string) {
  if (detail.projectId !== projectId || detail.cableId !== cableId || detail.row.projectId !== projectId || detail.row.cable.id !== cableId)
    throw readFailure('CALCULATION_SCOPE_CHANGED');
}
function calculationHint(job: PathFinderJob | null, projectId: string, jobId: string, cableId: string): 'pending' | 'inspect' | null {
  if (!job) return null;
  if (job.projectId !== projectId || job.id !== jobId) throw readFailure('CALCULATION_SCOPE_CHANGED');
  const item = job.items?.find(value => value.cableId === cableId);
  if (!item) return null;
  return !job.cancelRequested && ['queued', 'running'].includes(job.status) && ['waiting', 'running'].includes(item.state) ? 'pending' : 'inspect';
}

/** Account/model ownership retains selections and unresolved commands across policy edits. */
export function PathFinderCableWorkspace(props: PathFinderCableWorkspaceProps) {
  const access = props.pf.preparationAccess, model = props.pf.data?.activeModel;
  const owner = JSON.stringify([props.projectId, props.loadedProjectId, props.accountId, props.token, props.isAdmin, model]);
  if (!props.isAdmin || !props.accountId || !props.token || !props.projectId || props.projectId !== props.loadedProjectId
    || access?.projectId !== props.projectId || access.loadedProjectId !== props.projectId || access.token !== props.token || !access.isAdmin) return null;
  return <OwnedWorkspace key={owner} {...props} owner={owner} />;
}
function OwnedWorkspace(props: PathFinderCableWorkspaceProps & { owner: string }) {
  const [selected, setSelected] = useState<CableWorkflowRow | null>(null), [open, setOpen] = useState(false);
  const selectedRef = useRef(selected); selectedRef.current = selected;
  const verifiedRefreshScope = useRef<{ scope: string; cableId: string; jobId: string | null; proposalId: string | null; proposalHash: string | null } | null>(null);
  const [impact, setImpact] = useState<Impact | null>(null), [revision, setRevision] = useState(0), [notice, setNotice] = useState<string | null>(null);
  const [calculating, setCalculating] = useState(false);
  const [refreshingSelected, setRefreshingSelected] = useState(false), [selectedReadError, setSelectedReadError] = useState<string | null>(null);
  const [drillDraft, setDrillDraft] = useState<{ cableId: string; checked: boolean } | null>(null);
  const [calculationFeedback, setCalculationFeedback] = useState<CalculationFeedback | null>(null);
  const attemptEpoch = useRef(0);
  const [calculationDiagnostics, setCalculationDiagnostics] = useState<CalculationDiagnosticSnapshot | null>(null);
  const calculationDiagnosticsRef = useRef(calculationDiagnostics); calculationDiagnosticsRef.current = calculationDiagnostics;
  const [diagnosticReadRevision, setDiagnosticReadRevision] = useState(0);
  const [submittedCalculation, setSubmittedCalculation] = useState<SubmittedCalculation | null>(null);
  const [savedCalculation, setSavedCalculation] = useState<SavedCalculation | null>(null);
  const savedCalculationRef = useRef(savedCalculation); savedCalculationRef.current = savedCalculation;
  const impactStatusRef = useRef<LocationImpactSummary | null>(null);
  const [endpointRefreshKey, setEndpointRefreshKey] = useState(0);
  const [settledDiagnostics, setSettledDiagnostics] = useState<SettledDiagnostics | null>(null);
  const settledDiagnosticsRef = useRef(settledDiagnostics); settledDiagnosticsRef.current = settledDiagnostics;
  const diagnosticsEpoch = useRef(0), refreshedDiagnostics = useRef(new Set<string>());
  const protectedDiagnostics = useRef<SettledDiagnostics | null>(null);
  const submittedRef = useRef(submittedCalculation); submittedRef.current = submittedCalculation;
  // Changing the selected cable is not evidence about an earlier POST. Keep
  // every unresolved attempt in this owner, including ACKs received while a
  // different cable is open. Only an exact observed job can settle its ACK.
  const submissions = useRef(new Map<string, SubmittedCalculation>()), feedback = useRef(new Map<string, CalculationFeedback>());
  const rememberSubmission = useCallback((cableId: string, value: SubmittedCalculation | null) => {
    if (value) submissions.current.set(cableId, value); else { submissions.current.delete(cableId); feedback.current.delete(cableId); }
    if (selectedRef.current?.cable.id === cableId) { submittedRef.current = value; setSubmittedCalculation(value); }
  }, []);
  const rememberFeedback = useCallback((value: CalculationFeedback) => {
    if (submissions.current.has(value.cableId)) feedback.current.set(value.cableId, value); else feedback.current.delete(value.cableId);
    if (selectedRef.current?.cable.id === value.cableId) setCalculationFeedback(value);
  }, []);
  const [popup, setPopup] = useState<FloatingCableWindowRequest | null>(null), popupRef = useRef<FloatingCableWindowRequest | null>(null);
  const [preview, setPreview] = useState<{ row: CableWorkflowRow; anchor: HTMLElement } | null>(null);
  const dwell = useRef<ReturnType<typeof setTimeout> | null>(null), leave = useRef<ReturnType<typeof setTimeout> | null>(null);
  const stopTimers = useCallback(() => { if (dwell.current) clearTimeout(dwell.current); if (leave.current) clearTimeout(leave.current); dwell.current = null; leave.current = null; }, []);
  const dismissPreview = useCallback(() => { stopTimers(); setPreview(null); }, [stopTimers]);
  const leavePreview = useCallback(() => { if (dwell.current) clearTimeout(dwell.current); dwell.current = null; if (leave.current) clearTimeout(leave.current);
    leave.current = setTimeout(() => { setPreview(null); leave.current = null; }, 150); }, []);
  const keepPreview = useCallback(() => { if (leave.current) clearTimeout(leave.current); leave.current = null; }, []);
  const previewCable = (row: CableWorkflowRow, anchor: HTMLElement) => {
    stopTimers(); if (open || !enabled) return;
    dwell.current = setTimeout(() => { dwell.current = null; if (callbacks.current.active && anchor.isConnected) setPreview({ row, anchor }); }, 1000);
  };
  const openCable = (row: CableWorkflowRow) => {
    if (!enabled || row.projectId !== props.projectId || !isPathFinderCableEligible(row.mto)) return;
    // User activation belongs to this click, before the editor is mounted.
    const request = requestFloatingCableWindow({ title: row.cable.tag || 'Cable routing' }, popupRef.current);
    popupRef.current = request; setPopup(request); dismissPreview();
    diagnosticsEpoch.current++; settledDiagnosticsRef.current = null; protectedDiagnostics.current = null; setSettledDiagnostics(null);
    read.current?.abort(); setRefreshingSelected(false);
    if (selectedRef.current?.cable.id !== row.cable.id) setSelectedReadError(null);
    setSelected(row); selectedRef.current = row; setOpen(true); setNotice(null);
    calculationDiagnosticsRef.current = null; setCalculationDiagnostics(null);
    setDiagnosticReadRevision(value => value + 1);
    setDrillDraft({ cableId: row.cable.id, checked: false });
    setCalculationFeedback(feedback.current.get(row.cable.id) ?? null);
    const retained = submissions.current.get(row.cable.id) ?? null;
    submittedRef.current = retained; setSubmittedCalculation(retained);
    if (retained?.jobId) props.onCalculationPreferences?.({ cableId: retained.cableId, jobId: retained.jobId, preferences: retained.preferences });
    props.onSelect(row);
    // The list is a bounded observation, not the current selected result. Keep
    // window activation synchronous, then inspect this cable by a fresh GET.
    void refreshSelected();
  };
  const callbacks = useRef(props); callbacks.current = props;
  const alive = useRef(false), read = useRef<AbortController | null>(null), historyRead = useRef<AbortController | null>(null);
  const lastCalculation = useRef(''), lastWrite = useRef('');
  const lastExternalRefresh = useRef(props.refreshKey);
  const model = props.pf.data?.activeModel, preferences = props.preferences, readPreferences = workflowReadPreferences(props);
  const lastReadPreferences = useRef(readPreferences);
  if (readPreferences) lastReadPreferences.current = readPreferences;
  const barrierPreferenceKey = JSON.stringify(preferences?.barrierRouting);
  const panelActive = props.active && props.pf.viewerPhase === 'ready' && Boolean(model?.modelVersionId);
  const enabled = panelActive && Boolean(readPreferences);
  const calculationEnabled = enabled && Boolean(preferences);
  const selectedEligible = Boolean(selected && isPathFinderCableEligible(selected.mto));
  const drillThroughWalls = Boolean(selected && drillDraft?.cableId === selected.cable.id && drillDraft.checked);
  const selectedPreferences = props.getCalculationPreferences ? props.getCalculationPreferences(drillThroughWalls) : preferences;
  const calculationBlockedReason = enabled && !selectedPreferences
    ? 'You can save From/To assignments now. Configure the current route settings and barriers before calculating routing. Existing Cable list values are retained.' : null;
  const calculation = calculationEnabled && selectedEligible && preferences ? { preferences, timeoutMilliseconds: 120000 } : null;
  const selectedReadScope = workspaceReadScope(props);
  const previousReadScope = useRef(selectedReadScope);
  const acceptVerifiedRefresh = useCallback((row: CableWorkflowRow, state: WorkspaceState) => {
    verifiedRefreshScope.current = { scope: workspaceReadScope(callbacks.current, state), cableId: row.cable.id,
      jobId: row.calculation.jobId, proposalId: row.calculation.proposalId, proposalHash: row.calculation.proposalHash };
    setSelectedReadError(null);
  }, []);
  const authorityLost = useCallback(() => callbacks.current.pf.refresh(), []);
  const retainCalculationDiagnostics = useCallback((job: PathFinderJob, cableId: string, jobId: string) => {
    const current = callbacks.current;
    if (job.projectId !== current.projectId || job.id !== jobId) throw readFailure('CALCULATION_SCOPE_CHANGED');
    const item = job.items?.find(value => value.cableId === cableId);
    const snapshot: CalculationDiagnosticSnapshot = { owner: calculationWatchOwner(current), model: modelScope(current), value: {
      cableId, jobId, jobStatus: job.status, itemStatus: item?.status ?? null, itemState: item?.state ?? null,
      itemMessage: item?.message ?? null, jobFailure: job.failure,
      readError: item ? null : 'The exact calculation job did not include an outcome for this cable. Refresh cable status to check it.',
    } };
    calculationDiagnosticsRef.current = snapshot; setCalculationDiagnostics(snapshot);
  }, []);
  const backgroundState = useRef<{ scope: string; promise: Promise<WorkspaceState | null | undefined> } | null>(null);
  const backgroundStateRefresh = useCallback(() => {
    const current = callbacks.current, scope = JSON.stringify([calculationWatchOwner(current), modelScope(current)]);
    if (backgroundState.current?.scope === scope) return backgroundState.current.promise;
    const pending = { scope, promise: Promise.resolve().then(() => current.pf.refreshState()) };
    backgroundState.current = pending;
    void pending.promise.finally(() => { if (backgroundState.current === pending) backgroundState.current = null; }).catch(() => {});
    return pending.promise;
  }, []);
  const deferDiagnostics = useCallback((row: CableWorkflowRow) => {
    if (!displayCandidate(row.calculation) || !row.calculation.jobId || !row.calculation.proposalId || !row.calculation.proposalHash) return;
    const next = { owner: calculationWatchOwner(callbacks.current), model: modelScope(callbacks.current), cableId: row.cable.id,
      jobId: row.calculation.jobId, proposalId: row.calculation.proposalId, proposalHash: row.calculation.proposalHash };
    settledDiagnosticsRef.current = next; setSettledDiagnostics(next);
  }, []);
  const refreshSelected = useCallback(async (retryResult = false) => {
    const row = selectedRef.current, current = callbacks.current;
    const submittedQuery = submittedRef.current;
    const query = row && submittedQuery && submittedQuery.cableId === row.cable.id && submittedQuery.jobId !== null
      ? submittedQuery.preferences : workflowReadPreferences(current) ?? lastReadPreferences.current;
    if (!alive.current || !row || !current.active || !query || !current.projectId || !current.token) return;
    if (retryResult) current.onCalculationStart?.(row.cable.id);
    read.current?.abort(); const ticket = new AbortController(); read.current = ticket; setRefreshingSelected(true);
    if (retryResult) { calculationDiagnosticsRef.current = null; setCalculationDiagnostics(null); setDiagnosticReadRevision(value => value + 1); }
    const expectedOwner = calculationWatchOwner(current), expectedModel = modelScope(current), expectedScope = workspaceReadScope(current);
    try {
      const detail = await readWithinCalculationBudget(ticket.signal, Date.now() + 30_000, signal =>
        fetchPathFinderCableWorkflowDetail(current.projectId!, current.token!, row.cable.id, query, signal));
      if (!alive.current || ticket.signal.aborted || read.current !== ticket || selectedRef.current?.cable.id !== row.cable.id || !callbacks.current.active
        || calculationWatchOwner(callbacks.current) !== expectedOwner || modelScope(callbacks.current) !== expectedModel || workspaceReadScope(callbacks.current) !== expectedScope
        || callbacks.current.selectedCableId != null && callbacks.current.selectedCableId !== row.cable.id) return;
      if (detail.projectId !== current.projectId || detail.cableId !== row.cable.id || detail.row.projectId !== current.projectId || detail.row.cable.id !== row.cable.id)
        throw new Error('CALCULATION_SCOPE_CHANGED');
      setSelected(detail.row); selectedRef.current = detail.row; setSelectedReadError(null);
      const savedWatch = savedCalculationRef.current, savedImpact = impactStatusRef.current;
      const savedJobMatches = savedWatch?.cableId === row.cable.id && savedImpact?.id === savedWatch.impactId
        && savedImpact.jobId !== null && detail.row.calculation.jobId === savedImpact.jobId && detail.row.calculation.jobId !== savedWatch.previousJobId;
      if (savedJobMatches && calculationFinished(detail.row.calculation)) current.onCalculationPreferences?.({ cableId: row.cable.id,
        jobId: savedImpact.jobId!, preferences: structuredClone(savedWatch.preferences) });
      if ((retryResult || JSON.stringify(row) !== JSON.stringify(detail.row))
        && (savedWatch?.cableId !== row.cable.id || savedJobMatches && calculationFinished(detail.row.calculation))
        && !automaticUpdatePending(detail.row.calculation)) current.onSelect(detail.row);
      const submitted = submittedRef.current, observed = detail.row.calculation;
      if (submitted?.cableId === row.cable.id && submitted.jobId !== null && observed.jobId === submitted.jobId
        && calculationFinished(observed)
        && (observed.outcome !== 'calculated' || observed.proposalId !== submitted.previousProposalId)) {
        if (!displayCandidate(observed)) await current.pf.refreshState();
        if (!alive.current || ticket.signal.aborted || read.current !== ticket || selectedRef.current?.cable.id !== row.cable.id) return;
        rememberSubmission(row.cable.id, null);
        if (displayCandidate(observed)) deferDiagnostics(detail.row);
        setEndpointRefreshKey(value => value + 1);
        rememberFeedback({ cableId: row.cable.id, attempt: submitted.attempt, working: false, message: observed.jobStatus === 'complete' && observed.outcome === 'calculated'
          ? 'The calculation finished. Loading and checking its exact route before Show is available…'
          : 'This cable’s calculation stopped without an applicable route. Check its diagnostics before trying again.' });
      }
      const saved = savedCalculationRef.current;
      const expectedImpact = impactStatusRef.current;
      if (saved?.cableId === row.cable.id && expectedImpact?.id === saved.impactId && expectedImpact.jobId !== null
        && observed.jobId === expectedImpact.jobId && observed.jobId !== saved.previousJobId) {
        if (!automaticUpdatePending(observed) && (['complete', 'failed', 'cancelled'].includes(observed.jobStatus ?? '') || observed.itemState === 'complete' && observed.currentness === 'current')) {
          if (!displayCandidate(observed)) await current.pf.refreshState();
          if (!alive.current || ticket.signal.aborted || read.current !== ticket || savedCalculationRef.current !== saved) return;
          savedCalculationRef.current = null; setSavedCalculation(null); setEndpointRefreshKey(value => value + 1);
          if (displayCandidate(observed)) deferDiagnostics(detail.row);
          rememberFeedback({ cableId: row.cable.id, attempt: saved.attempt, working: false, message: observed.outcome === 'calculated' && observed.currentness === 'current' && observed.proposalId !== saved.previousProposalId
            ? 'The calculation finished. Loading and checking its exact route before Show is available…'
            : 'The recalculation stopped without a current route. Check its diagnostics before calculating again.' });
        } else if (retryResult) { const resumed = { ...saved, reading: true }; savedCalculationRef.current = resumed; setSavedCalculation(resumed); }
      } else if (saved?.cableId === row.cable.id && retryResult) { const resumed = { ...saved, reading: true }; savedCalculationRef.current = resumed; setSavedCalculation(resumed); }
    } catch (error) { if (alive.current && !ticket.signal.aborted && read.current === ticket) {
      const message = 'The cable could not be refreshed. Last read values are retained; refresh again before reviewing or applying a result.';
      setSelectedReadError(message);
      if (error && typeof error === 'object' && 'status' in error && [401, 403].includes(Number(error.status))) authorityLost();
    } }
    finally { if (read.current === ticket) { read.current = null; if (alive.current) setRefreshingSelected(false); } }
  }, [rememberSubmission, rememberFeedback, authorityLost, deferDiagnostics]);
  const refreshDiagnostics = useCallback((forceSelected = false) => {
    // Owned calculations already have a bounded selected-item watcher. Progress
    // notifications must not race it with expensive full cable/list reads while
    // the engine is still running. Explicit Refresh remains available below.
    const selectedId = selectedRef.current?.cable.id;
    const protectedResult = protectedDiagnostics.current, row = selectedRef.current;
    if (!forceSelected && alive.current && row && protectedResult?.cableId === row.cable.id
      && protectedResult.owner === calculationWatchOwner(callbacks.current) && protectedResult.model === modelScope(callbacks.current)
      && protectedResult.jobId === row.calculation.jobId && protectedResult.proposalId === row.calculation.proposalId
      && protectedResult.proposalHash === row.calculation.proposalHash) {
      setRevision(value => value + 1); return;
    }
    if (alive.current && (!selectedId || submittedRef.current?.cableId !== selectedId && savedCalculationRef.current?.cableId !== selectedId
      && settledDiagnosticsRef.current?.cableId !== selectedId)) {
      setRevision(value => value + 1); void refreshSelected();
    }
  }, [refreshSelected]);
  useEffect(() => { alive.current = true; return () => { alive.current = false; read.current?.abort(); historyRead.current?.abort(); stopTimers();
    if (popupRef.current?.window && !popupRef.current.window.closed) popupRef.current.window.close(); }; }, [stopTimers]);
  useEffect(() => {
    if (previousReadScope.current === selectedReadScope) return;
    previousReadScope.current = selectedReadScope; read.current?.abort(); read.current = null; setRefreshingSelected(false);
    const verified = verifiedRefreshScope.current, row = selectedRef.current;
    verifiedRefreshScope.current = null;
    if (verified?.scope === selectedReadScope && row?.cable.id === verified.cableId && row.calculation.jobId === verified.jobId
      && row.calculation.proposalId === verified.proposalId && row.calculation.proposalHash === verified.proposalHash) {
      setSelectedReadError(null); return;
    }
    if (selectedRef.current) setSelectedReadError('The current model or route settings changed. Refresh this cable before reviewing or applying its result.');
  }, [selectedReadScope]);
  // A same-model Viewer reload remounts this owner while Tab retains the user's
  // selected ID. Restore its current row by GET, never an old display payload or
  // a replayed command. Opening the popup still requires user activation.
  useEffect(() => {
    const current = callbacks.current, cableId = current.selectedCableId, query = workflowReadPreferences(current);
    if (!enabled || selectedRef.current || !policyUuidSchema.safeParse(cableId).success || !cableId || !query || !current.projectId || !current.token) return;
    const expectedOwner = current.owner, expectedReadScope = workspaceReadScope(current);
    const ticket = new AbortController(); read.current?.abort(); read.current = ticket; setRefreshingSelected(true);
    const live = () => alive.current && !ticket.signal.aborted && read.current === ticket && callbacks.current.active
      && callbacks.current.owner === expectedOwner && workspaceReadScope(callbacks.current) === expectedReadScope
      && callbacks.current.selectedCableId === cableId && !selectedRef.current;
    void fetchPathFinderCableWorkflowDetail(current.projectId, current.token, cableId, query, ticket.signal).then(detail => {
      if (!live()) return;
      verifyDetailScope(detail, current.projectId!, cableId);
      if (!callbacks.current.pf.data) return;
      acceptVerifiedRefresh(detail.row, callbacks.current.pf.data);
      setSelected(detail.row); selectedRef.current = detail.row; callbacks.current.onSelect(detail.row);
    }).catch(error => {
      if (!live()) return;
      setNotice('The selected cable could not be restored. Search and reopen it to check its current result. No calculation was submitted.');
      if (error && typeof error === 'object' && 'status' in error && [401, 403].includes(Number(error.status))) authorityLost();
    }).finally(() => { if (read.current === ticket) { read.current = null; if (alive.current) setRefreshingSelected(false); } });
    return () => { ticket.abort(); };
  }, [enabled, props.owner, props.selectedCableId, selected?.cable.id, selectedReadScope, acceptVerifiedRefresh, authorityLost]);
  useEffect(() => { if (!props.active) { dismissPreview(); if (popupRef.current?.window && !popupRef.current.window.closed) popupRef.current.window.close(); } }, [props.active, dismissPreview]);
  useEffect(() => {
    if (lastExternalRefresh.current === props.refreshKey) return;
    if (!props.active) return;
    lastExternalRefresh.current = props.refreshKey; refreshDiagnostics(true);
  }, [props.active, props.refreshKey, refreshDiagnostics]);
  useEffect(() => {
    if (!props.active) read.current?.abort();
    // A finished cable can leave the Needs routing filter without losing its
    // open editor. Only an explicit different cable changes this selection.
    if (props.selectedCableId != null && selectedRef.current && props.selectedCableId !== selectedRef.current.cable.id) {
      read.current?.abort(); selectedRef.current = null; setSelected(null); setOpen(false);
      submittedRef.current = null; setSubmittedCalculation(null);
    }
  }, [props.active, props.selectedCableId]);
  // Restore only the most recent matching owned impact from a bounded history page.
  // Its original authority is never renewed by this GET or a browser reload.
  useEffect(() => {
    if (!calculationEnabled || impact || !props.projectId || !props.token || !props.accountId || !preferences) return;
    const expectedBarrierIntent: unknown = barrierPreferenceKey === undefined ? undefined : JSON.parse(barrierPreferenceKey);
    const ticket = new AbortController(); historyRead.current = ticket;
    void fetchLocationImpacts(props.projectId, props.token, props.accountId, { limit: 25 }, ticket.signal).then(page => {
      if (!alive.current || ticket.signal.aborted || historyRead.current !== ticket) return;
      const found = page.impacts.find(item => item.modelVersionId === model?.modelVersionId && item.selectionRevision === model?.selectionRevision
        && item.contentFingerprint === model?.contentFingerprint && item.calculation?.preferences.secondaryDistanceMeters === preferences.secondaryDistanceMeters
        && item.calculation.preferences.preferVerticalApproach === preferences.preferVerticalApproach
        && sameBarrierAdmissionIntent((item.calculation.preferences as PathFinderPreferences).barrierRouting, expectedBarrierIntent));
      if (found) setImpact({ id: found.id, current: found.current, calculation: found.calculation, originCableId: null });
    }).catch(() => { /* Explicit progress refresh remains available; no automatic retry storm. */ });
    return () => { ticket.abort(); if (historyRead.current === ticket) historyRead.current = null; };
  }, [calculationEnabled, impact, props.projectId, props.token, props.accountId, model?.modelVersionId, model?.selectionRevision, model?.contentFingerprint, preferences?.secondaryDistanceMeters, preferences?.preferVerticalApproach, barrierPreferenceKey]);
  const calculationChanged = useCallback((value: NonNullable<ReturnType<typeof usePathfinderLocationImpactProgress>['impact']>) => {
      impactStatusRef.current = value;
      const watched = savedCalculationRef.current;
      if (watched?.impactId === value.id && value.jobId === null && ['complete', 'blocked', 'superseded', 'cancelled', 'failed', 'awaiting-authority', 'restore-fenced'].includes(value.status)) {
        savedCalculationRef.current = null; setSavedCalculation(null);
        rememberFeedback({ cableId: watched.cableId, attempt: watched.attempt, working: false, message: 'The shared-location recalculation stopped before a job was created for this cable. Check its diagnostics, then choose Calculate routing again.' });
      }
      const key = JSON.stringify([value.id, value.status, value.completed, value.readyCables, value.blockedCables]);
      if (key === lastCalculation.current) return; lastCalculation.current = key;
      if (['complete', 'blocked', 'superseded', 'cancelled', 'failed', 'awaiting-authority', 'restore-fenced'].includes(value.status)) refreshDiagnostics();
  }, [refreshDiagnostics, rememberFeedback]);
  const writeChanged = useCallback((value: NonNullable<ReturnType<typeof usePathfinderInitialFillProgress>['progress']>) => {
      const key = JSON.stringify([value.impactId, value.outstanding, value.counters]);
      if (key === lastWrite.current) return; lastWrite.current = key;
      if (!value.outstanding || value.counters.written + value.counters['already-written'] > 0) refreshDiagnostics();
  }, [refreshDiagnostics]);
  const ownedSavedImpact = Boolean(savedCalculation && savedCalculation.impactId === impact?.id && savedCalculation.cableId === selected?.cable.id);
  const impactReadsActive = enabled && Boolean(impact) && (calculationEnabled || ownedSavedImpact);
  const progress = usePathfinderLocationImpactProgress({ ...props, active: impactReadsActive, current: impact?.current ?? null,
    calculation: impact?.calculation ?? null, impactId: impact?.id ?? null, onAuthorityLost: authorityLost, onChanged: calculationChanged,
    foregroundWindow: ownedSavedImpact && open ? popupRef.current?.window ?? null : null });
  impactStatusRef.current = progress.impact;
  const writes = usePathfinderInitialFillProgress({ ...props, active: impactReadsActive, impactId: impact?.id ?? null,
    cableId: selected?.cable.id === impact?.originCableId ? selected?.cable.id ?? null : null, onAuthorityLost: authorityLost, onChanged: writeChanged });
  // First reads may already be terminal: observing them must also refresh the
  // receipt-backed cable row, without waiting for a change that will never come.
  useEffect(() => { if (progress.impact) calculationChanged(progress.impact); }, [progress.impact, calculationChanged]);
  useEffect(() => { if (writes.progress) writeChanged(writes.progress); }, [writes.progress, writeChanged]);
  const saved = useCallback(async (receipt: CableEndpointReceipt, current?: EndpointCurrentScope, originalCalculation?: LocationImpactCalculation | null) => {
    if (!alive.current) return;
    read.current?.abort(); read.current = null; setRefreshingSelected(false);
    backgroundState.current = null;
    const row = selectedRef.current;
    callbacks.current.onCalculationStart?.(receipt.cableId);
    diagnosticsEpoch.current++; settledDiagnosticsRef.current = null; protectedDiagnostics.current = null; setSettledDiagnostics(null);
    const watch: SavedCalculation | null = originalCalculation && receipt.locationImpact && row?.cable.id === receipt.cableId
      ? { cableId: receipt.cableId, impactId: receipt.locationImpact.id, preferences: structuredClone(originalCalculation.preferences),
        previousJobId: row.calculation.jobId, previousProposalId: row.calculation.proposalId, reading: false,
        attempt: Object.freeze({ epoch: ++attemptEpoch.current, owner: calculationAttemptOwner(callbacks.current) }) } : null;
    savedCalculationRef.current = watch; setSavedCalculation(watch);
    if (watch) rememberFeedback({ cableId: watch.cableId, attempt: watch.attempt, working: true, message: 'Locations saved. Waiting for this cable’s recalculation…' });
    setNotice(originalCalculation
      ? 'Shared location saved. Affected non-MV cables are queued for recalculation. Existing cable values require review.'
      : 'Shared location saved. Configure the current route settings and barriers, then calculate routing. This Save did not request recalculation or automatic Cable list updates.');
    if (receipt.locationImpact && current) { lastCalculation.current = ''; lastWrite.current = ''; setImpact({ id: receipt.locationImpact.id, current, calculation: originalCalculation ?? null, originCableId: receipt.cableId }); }
    void backgroundStateRefresh().catch(() => { /* The exact impact reader does not depend on global history. */ });
    // The acknowledged impact already owns its exact GET watcher. A global
    // history refresh must not delay learning the selected cable's new job.
    if (watch && savedCalculationRef.current === watch) { const ready = { ...watch, reading: true }; savedCalculationRef.current = ready; setSavedCalculation(ready); }
    refreshDiagnostics();
  }, [refreshDiagnostics, rememberFeedback, backgroundStateRefresh]);
  const selectedStatus = selected ? classifyCableWorkflow(selected) : null;
  const selectedAutomaticUpdatePending = Boolean(selected && automaticUpdatePending(selected.calculation));
  // Reopening a cable follows an already admitted update by GET; it does not
  // create another calculation or renew the original write authority.
  useEffect(() => {
    const row = selectedRef.current, current = callbacks.current;
    if (!enabled || !selectedAutomaticUpdatePending || submittedRef.current || savedCalculationRef.current || !row?.calculation.jobId) return;
    const query = workflowReadPreferences(current) ?? lastReadPreferences.current;
    if (!query) return;
    current.onCalculationStart?.(row.cable.id);
    const snapshot = structuredClone(query);
    current.onCalculationPreferences?.({ cableId: row.cable.id, jobId: row.calculation.jobId, preferences: snapshot });
    rememberSubmission(row.cable.id,{cableId:row.cable.id,jobId:row.calculation.jobId,preferences:snapshot,previousJobId:null,previousProposalId:null,attempt:null});
  },[enabled,selectedAutomaticUpdatePending,selected?.cable.id,selected?.calculation.jobId,rememberSubmission]);
  // Follow only an explicitly submitted selected-cable calculation. This is a
  // bounded read of its current metadata, never a second calculation or write.
  useEffect(() => {
    if (!submittedCalculation?.jobId || calculating || !enabled || !props.projectId || !props.token) return;
    const submitted = submittedCalculation, projectId = props.projectId, token = props.token, ticket = new AbortController();
    const expectedOwner = calculationWatchOwner(props), expectedModel = modelScope(props);
    let stopped = false, timer: ReturnType<typeof setTimeout> | undefined, rounds = 0, recoveries = 0;
    let deadline = Date.now() + CALCULATION_READ_WINDOW_MS;
    const live = () => !stopped && !ticket.signal.aborted && alive.current && callbacks.current.active
      && selectedRef.current?.cable.id === submitted.cableId && submittedRef.current === submitted
      && (callbacks.current.selectedCableId == null || callbacks.current.selectedCableId === submitted.cableId)
      && calculationWatchOwner(callbacks.current) === expectedOwner && modelScope(callbacks.current) === expectedModel;
    const readOwned = async () => {
      if (!live()) return null;
      const detail = await readWithinCalculationBudget(ticket.signal, deadline, signal =>
        fetchPathFinderCableWorkflowDetail(projectId, token, submitted.cableId, submitted.preferences, signal));
      if (!live()) return null;
      verifyDetailScope(detail, projectId, submitted.cableId); return detail;
    };
    const retry = (message?: string) => {
      if (!live()) return;
      if (rounds >= CALCULATION_POLL_ROUNDS || Date.now() >= deadline) {
        if (recoveries < CALCULATION_RECOVERY_WINDOWS) {
          recoveries++;
          rememberFeedback({ cableId: submitted.cableId, attempt: submitted.attempt, working: true, message: 'The result check is taking longer than expected. Checking this same calculation again automatically…' });
          timer = setTimeout(() => { if (!live()) return; rounds = 0; deadline = Date.now() + CALCULATION_READ_WINDOW_MS; void poll(); }, CALCULATION_RECOVERY_DELAY_MS);
          return;
        }
        const exhausted = 'The calculation outcome is not confirmed. Refresh this cable to inspect its current job. No new calculation or Apply was sent.';
        setNotice(exhausted); rememberFeedback({ cableId: submitted.cableId, attempt: submitted.attempt, message: exhausted, working: false }); return;
      }
      if (message) rememberFeedback({ cableId: submitted.cableId, attempt: submitted.attempt, message, working: true });
      timer = setTimeout(() => void poll(), 1500);
    };
    const readState = async () => {
      const state = await readWithinCalculationBudget(ticket.signal, deadline, () => callbacks.current.pf.refreshState()); if (!live()) return null;
      if (!state) throw readFailure('CALCULATION_STATE_READ_UNCONFIRMED');
      if (state.projectId !== projectId || activeModelScope(state.activeModel) !== expectedModel) throw readFailure('CALCULATION_SCOPE_CHANGED');
      return state;
    };
    const poll = async () => {
      try {
        {
          if (rounds >= CALCULATION_POLL_ROUNDS || Date.now() >= deadline) { retry(); return; }
          rounds++;
          const job = await readCalculationJob(projectId, token, submitted.jobId!, ticket.signal, deadline); if (!live()) return;
          const hint = calculationHint(job ?? null, projectId, submitted.jobId!, submitted.cableId);
          if (job) retainCalculationDiagnostics(job, submitted.cableId, submitted.jobId!);
          if (hint === 'pending') { retry(job?.status === 'queued' ? 'This cable’s calculation is queued.' : 'Calculating this cable’s routing…'); return; }
          if (hint === 'inspect') {
            rememberFeedback({ cableId: submitted.cableId, attempt: submitted.attempt, working: true, message: 'Checking this cable’s calculation result…' });
            // A sealed item may still await its own automatic write. Check its
            // row first; refresh project-wide state only after terminal proof.
          }
        }
        let detail = await readOwned(); if (!detail) return;
        const current = callbacks.current;
        let observed = detail.row.calculation; const ownsNewJob = observed.jobId === submitted.jobId;
        if (ownsNewJob) {
          rememberFeedback({ cableId: submitted.cableId, attempt: submitted.attempt, working: automaticUpdatePending(observed) || ['queued', 'running'].includes(observed.jobStatus ?? ''),
            message: observed.itemState === 'complete' && automaticUpdatePending(observed) ? 'Routing calculated. Updating the automatic Cable list values…'
              : observed.jobStatus === 'running' ? 'Calculating this cable’s routing…' : observed.jobStatus === 'queued'
              ? 'This cable’s calculation is queued.' : observed.jobStatus === 'complete' && observed.outcome === 'calculated'
                 ? 'The calculation finished. Loading and checking its exact route before Show is available…'
                : 'This cable’s calculation stopped without an applicable route. Refresh the cable diagnostics before trying again.' });
          setSelected(detail.row); selectedRef.current = detail.row; setSelectedReadError(null);
          if (calculationFinished(observed)) {
            if (observed.outcome === 'calculated' && observed.proposalId === submitted.previousProposalId) throw new Error('EARLIER_PROPOSAL_RETAINED');
            const successful = displayCandidate(observed);
            const state = successful ? current.pf.data : await readState(); if (!state || !live()) return;
            if (state.projectId !== projectId || activeModelScope(state.activeModel) !== expectedModel) throw readFailure('CALCULATION_SCOPE_CHANGED');
            // A terminal status is not the route proof. Re-read the exact owned
            // result after global state converges; never settle from the earlier
            // row or let our own artifact refresh leave a permanent scope error.
            if (!successful && observed.outcome === 'calculated') { detail = await readOwned(); if (!detail) return; }
            observed = detail.row.calculation;
            if (observed.jobId !== submitted.jobId || !calculationFinished(observed)
              || observed.outcome === 'calculated' && observed.proposalId === submitted.previousProposalId) {
              retry('The calculation finished. Checking its current result…'); return;
            }
            acceptVerifiedRefresh(detail.row, state);
            setSelected(detail.row); selectedRef.current = detail.row; current.onSelect(detail.row);
            rememberSubmission(submitted.cableId, null);
            if (displayCandidate(observed)) deferDiagnostics(detail.row); else setRevision(value => value + 1);
            setEndpointRefreshKey(value => value + 1);
            rememberFeedback({cableId:submitted.cableId,attempt:submitted.attempt,working:false,message:observed.outcome==='calculated'
              ? 'The calculation finished. Loading and checking its exact route before Show is available…'
              : 'This cable’s calculation stopped without an applicable route. Check its diagnostics before trying again.'});
            setNotice(observed.outcome === 'calculated' ? 'Calculation complete. Loading and checking its exact route before Show is available.'
              : 'The new calculation stopped without an applicable result. Existing Cable list values were retained.');
            return;
          }
        }
        retry();
      } catch (error) {
        if (!live()) return;
        if (error && typeof error === 'object' && 'status' in error && [401, 403].includes(Number(error.status))) authorityLost();
        if (retryableCalculationRead(error)) {
          retry('The calculation result could not be read yet. Checking again automatically…');
        } else {
          const message = 'The new calculation could not be checked. Refresh this cable before reviewing a result. Existing values were retained.';
          setNotice(message); rememberFeedback({ cableId: submitted.cableId, attempt: submitted.attempt, message, working: false });
        }
      }
    };
    void poll();
    return () => { stopped = true; ticket.abort(); if (timer) clearTimeout(timer); };
  }, [submittedCalculation, calculating, enabled, props.projectId, props.token, authorityLost, rememberSubmission, rememberFeedback, acceptVerifiedRefresh, deferDiagnostics, retainCalculationDiagnostics]);
  // Save already requested a background recalculation. Follow its new selected
  // cable result by bounded GETs, without creating a second calculation. Its
  // baseline can never be mistaken for the replacement result.
  useEffect(() => {
    if (!savedCalculation?.reading || !enabled || !props.projectId || !props.token || selected?.cable.id !== savedCalculation.cableId || submittedCalculation) return;
    const watch = savedCalculation, ticket = new AbortController(), projectId = props.projectId, token = props.token;
    const expectedOwner = calculationWatchOwner(props), expectedModel = modelScope(props);
    let stopped = false, timer: ReturnType<typeof setTimeout> | undefined, rounds = 0, recoveries = 0;
    let deadline = Date.now() + CALCULATION_READ_WINDOW_MS;
    const live = () => !stopped && !ticket.signal.aborted && alive.current && callbacks.current.active
      && savedCalculationRef.current === watch && selectedRef.current?.cable.id === watch.cableId
      && (callbacks.current.selectedCableId == null || callbacks.current.selectedCableId === watch.cableId)
      && calculationWatchOwner(callbacks.current) === expectedOwner && modelScope(callbacks.current) === expectedModel;
    const readOwned = async () => {
      if (!live()) return null;
      const detail = await readWithinCalculationBudget(ticket.signal, deadline, signal =>
        fetchPathFinderCableWorkflowDetail(projectId, token, watch.cableId, watch.preferences, signal));
      if (!live()) return null;
      verifyDetailScope(detail, projectId, watch.cableId); return detail;
    };
    const retry = (message: string) => {
      if (!live()) return;
      if (rounds >= CALCULATION_POLL_ROUNDS || Date.now() >= deadline) {
        if (recoveries < CALCULATION_RECOVERY_WINDOWS) {
          recoveries++;
          rememberFeedback({ cableId: watch.cableId, attempt: watch.attempt, working: true, message: 'The result check is taking longer than expected. Checking this same calculation again automatically…' });
          timer = setTimeout(() => { if (!live()) return; rounds = 0; deadline = Date.now() + CALCULATION_READ_WINDOW_MS; void poll(); }, CALCULATION_RECOVERY_DELAY_MS);
          return;
        }
        rememberFeedback({ cableId: watch.cableId, attempt: watch.attempt, working: false,
        message: 'This cable’s recalculation is not confirmed yet. Refresh cable status to check it; no second calculation was submitted.' }); return; }
      rememberFeedback({ cableId: watch.cableId, attempt: watch.attempt, working: true, message });
      timer = setTimeout(() => void poll(), 1500);
    };
    const readState = async () => {
      const state = await readWithinCalculationBudget(ticket.signal, deadline, () => callbacks.current.pf.refreshState()); if (!live()) return null;
      if (!state) throw readFailure('CALCULATION_STATE_READ_UNCONFIRMED');
      if (state.projectId !== projectId || activeModelScope(state.activeModel) !== expectedModel) throw readFailure('CALCULATION_SCOPE_CHANGED');
      return state;
    };
    const poll = async () => {
      try {
        {
          if (rounds >= CALCULATION_POLL_ROUNDS || Date.now() >= deadline) { retry('Locations saved. Checking this cable’s recalculation…'); return; }
          rounds++;
          const expectedImpact = impactStatusRef.current;
          if (expectedImpact?.id !== watch.impactId || !expectedImpact.jobId) { retry('Locations saved. Waiting for this cable’s new calculation…'); return; }
          const job = await readCalculationJob(projectId, token, expectedImpact.jobId, ticket.signal, deadline); if (!live()) return;
          const hint = calculationHint(job ?? null, projectId, expectedImpact.jobId, watch.cableId);
          if (job) retainCalculationDiagnostics(job, watch.cableId, expectedImpact.jobId);
          if (hint === 'pending') { retry('Recalculating this cable for the saved locations…'); return; }
          if (hint === 'inspect') {
            rememberFeedback({ cableId: watch.cableId, attempt: watch.attempt, working: true, message: 'Checking this cable’s recalculation result…' });
            // Other cables and this item's automatic writer may still run.
            // Their progress does not require repeated project-wide refreshes.
          }
        }
        let detail = await readOwned(); if (!detail) return;
        const expectedImpact = impactStatusRef.current;
        let observed = detail.row.calculation; const newJob = expectedImpact?.id === watch.impactId && expectedImpact.jobId !== null
          && observed.jobId === expectedImpact.jobId && observed.jobId !== watch.previousJobId;
        const replacement = newJob && observed.proposalId !== null && observed.proposalId !== watch.previousProposalId && observed.currentness === 'current';
        if (newJob) { setSelected(detail.row); selectedRef.current = detail.row; setSelectedReadError(null); }
        if (!automaticUpdatePending(observed) && (newJob && ['complete', 'failed', 'cancelled'].includes(observed.jobStatus ?? '') || replacement && observed.itemState === 'complete')) {
          const successful = displayCandidate(observed);
          const state = successful ? callbacks.current.pf.data : await readState(); if (!state || !live()) return;
          if (state.projectId !== projectId || activeModelScope(state.activeModel) !== expectedModel) throw readFailure('CALCULATION_SCOPE_CHANGED');
          if (!successful && observed.outcome === 'calculated') { detail = await readOwned(); if (!detail) return; }
          observed = detail.row.calculation;
          const impact = impactStatusRef.current;
          if (impact?.id !== watch.impactId || !impact.jobId || observed.jobId !== impact.jobId || observed.jobId === watch.previousJobId
            || !calculationFinished(observed) || observed.outcome === 'calculated' && observed.proposalId === watch.previousProposalId) {
            retry('Locations saved. Checking this cable’s current recalculation…'); return;
          }
          acceptVerifiedRefresh(detail.row, state);
          // Results must start with this Save's immutable policy, rather than
          // serially rediscovering it or using a later next-calculation draft.
          callbacks.current.onCalculationPreferences?.({ cableId: watch.cableId, jobId: observed.jobId!, preferences: structuredClone(watch.preferences) });
          setSelected(detail.row); selectedRef.current = detail.row; callbacks.current.onSelect(detail.row);
          savedCalculationRef.current = null; setSavedCalculation(null); setEndpointRefreshKey(value => value + 1);
          if (displayCandidate(observed)) deferDiagnostics(detail.row); else setRevision(value => value + 1);
          rememberFeedback({ cableId: watch.cableId, attempt: watch.attempt, working: false, message: observed.outcome === 'calculated' && observed.currentness === 'current'
            ? 'The calculation finished. Loading and checking its exact route before Show is available…'
            : 'The recalculation stopped without a current route. Check its diagnostics before calculating again.' });
          return;
        }
        retry(newJob && observed.itemState === 'complete' && automaticUpdatePending(observed)
          ? 'Routing calculated. Updating the automatic Cable list values…' : newJob && observed.jobStatus === 'running'
          ? 'Recalculating this cable for the saved locations…' : 'Locations saved. Waiting for this cable’s new calculation…');
      } catch (error) {
        if (!live()) return;
        if (error && typeof error === 'object' && 'status' in error && [401, 403].includes(Number(error.status))) authorityLost();
        if (retryableCalculationRead(error)) retry('This cable’s recalculation could not be read yet. Checking again automatically…');
        else rememberFeedback({ cableId: watch.cableId, attempt: watch.attempt, working: false, message: 'This cable’s recalculation could not be checked. Refresh cable status; saved locations and existing cable values are retained.' });
      }
    };
    void poll();
    return () => { stopped = true; ticket.abort(); if (timer) clearTimeout(timer); };
  }, [savedCalculation, submittedCalculation, enabled, props.projectId, props.token, selected?.cable.id, authorityLost, rememberFeedback, acceptVerifiedRefresh, deferDiagnostics, retainCalculationDiagnostics]);
  const calculateSelected = async () => {
    const row = selectedRef.current, current = callbacks.current;
    if (!alive.current || !enabled || !current.active || calculating || submittedRef.current || !row
      || !isPathFinderCableEligible(row.mto) || savedCalculationRef.current?.cableId === row.cable.id || selectedCalculationPending(row.calculation)) return;
    const attempt = Object.freeze({ epoch: ++attemptEpoch.current, owner: calculationAttemptOwner(current) });
    const selectedPreferences = current.getCalculationPreferences ? current.getCalculationPreferences(drillThroughWalls) : current.preferences;
    if (!selectedPreferences) {
      const message = 'Configure the current route settings and barriers before calculating. No calculation was submitted and the existing cable values are retained.';
      setNotice(message); rememberFeedback({ cableId: row.cable.id, attempt, message, working: false });
      current.onConfigureCalculation?.();
      return;
    }
    if (submissions.current.size >= MAX_RETAINED_CALCULATION_ATTEMPTS) {
      const message = '128 unresolved cable calculations are retained in this workspace. Inspect their exact pending work before starting another calculation. No request was submitted.';
      setNotice(message); rememberFeedback({ cableId: row.cable.id, attempt, message, working: false }); return;
    }
    const snapshot = structuredClone(selectedPreferences);
    read.current?.abort(); read.current = null; setRefreshingSelected(false);
    backgroundState.current = null;
    diagnosticsEpoch.current++; settledDiagnosticsRef.current = null; protectedDiagnostics.current = null; setSettledDiagnostics(null);
    const submitted = { cableId: row.cable.id, jobId: null as string | null, preferences: snapshot, previousJobId: row.calculation.jobId, previousProposalId: row.calculation.proposalId, attempt };
    rememberSubmission(row.cable.id, submitted); setCalculating(true); setNotice(null); current.onCalculationStart?.(row.cable.id);
    rememberFeedback({ cableId: row.cable.id, attempt, message: 'Submitting this cable’s calculation…', working: true });
    try {
      const result = await current.pf.submitCalculation([row.cable.id], snapshot);
      if (!alive.current) return;
      if (result.kind === 'not-submitted' || result.kind === 'rejected') {
        rememberSubmission(row.cable.id, null);
        const message = result.kind === 'not-submitted'
          ? 'No calculation was submitted. Check the current model and route settings, then choose Calculate routing again.'
          : calculationSubmissionRefusalMessage(result.code);
        if (selectedRef.current?.cable.id === row.cable.id) setNotice(message);
        rememberFeedback({ cableId: row.cable.id, attempt, message, working: false });
      } else if (result.kind === 'acknowledged' && policyUuidSchema.safeParse(result.jobId).success && result.jobId !== submitted.previousJobId) {
        const acknowledged = { ...submitted, jobId: result.jobId }; rememberSubmission(row.cable.id, acknowledged);
        if (selectedRef.current?.cable.id === row.cable.id) current.onCalculationPreferences?.({ cableId: row.cable.id, jobId: acknowledged.jobId, preferences: snapshot });
        rememberFeedback({ cableId: row.cable.id, attempt, message: 'This cable’s calculation is queued. Checking its exact job…', working: true });
        void backgroundStateRefresh().catch(() => { /* The exact job reader does not depend on global history. */ });
      } else {
        const message = 'The calculation submission is unconfirmed. No automatic retry was sent. Refresh this cable to inspect independently verified results; do not submit it again until its outcome is known.';
        if (selectedRef.current?.cable.id === row.cable.id) setNotice(message);
        rememberFeedback({ cableId: row.cable.id, attempt, message, working: false });
      }
    }
    catch { if (alive.current) {
      const message = 'The calculation submission is unconfirmed. Refresh this cable to inspect its current state. No automatic retry or Apply was sent.';
      if (selectedRef.current?.cable.id === row.cable.id) setNotice(message);
      rememberFeedback({ cableId: row.cable.id, attempt, message, working: false });
    } }
    finally { if (alive.current) setCalculating(false); }
  };
  const parsedVerifiedRow = cableWorkflowRowSchema.safeParse(props.display?.verifiedRow);
  const verifiedRow = parsedVerifiedRow.success ? parsedVerifiedRow.data : null;
  const observedRevision = props.pf.data?.cables?.find(row => row.id === selected?.cable.id)?.cableWriteRevision;
  const verifiedRowMatches = Boolean(props.active && enabled && selected && verifiedRow && !submittedCalculation && !savedCalculation && !refreshingSelected && !selectedReadError
    && previousReadScope.current === selectedReadScope && props.display?.verifiedScope === pathFinderWorkflowDisplayScope(props.pf, props.accountId)
    && props.display?.cableId === selected.cable.id && verifiedRow.projectId === props.projectId && verifiedRow.cable.id === selected.cable.id
    && props.display.jobId === selected.calculation.jobId && props.display.proposalId === selected.calculation.proposalId
    && props.display.proposalHash === selected.calculation.proposalHash && verifiedRow.calculation.jobId === props.display.jobId
    && verifiedRow.calculation.proposalId === props.display.proposalId && verifiedRow.calculation.proposalHash === props.display.proposalHash
    && (props.display.source !== 'saved-exact' && displayCandidate(verifiedRow.calculation)
      || props.display.source === 'saved-exact' && savedDisplayCandidate(verifiedRow.calculation))
    && !automaticUpdatePending(verifiedRow.calculation)
    && !['failed', 'cancelled'].includes(verifiedRow.calculation.jobStatus ?? '')
    && BigInt(verifiedRow.cable.cableWriteRevision) >= BigInt(selected.cable.cableWriteRevision)
    && (observedRevision === undefined || BigInt(verifiedRow.cable.cableWriteRevision) >= BigInt(observedRevision)));
  const displayedSelection = verifiedRowMatches ? verifiedRow! : selected;
  // Recorded-policy proof can replace an older list hint for presentation. It
  // remains tied to this model/preparation and exact tuple; it never calls the
  // parent selection callback or becomes a write/review grant.
  useEffect(() => {
    if (!verifiedRowMatches || !verifiedRow || !selectedRef.current || JSON.stringify(selectedRef.current) === JSON.stringify(verifiedRow)) return;
    setSelected(verifiedRow); selectedRef.current = verifiedRow;
  }, [verifiedRowMatches, verifiedRow]);
  useEffect(() => {
    const queued = settledDiagnostics;
    if (!props.active || !enabled || !queued || settledDiagnosticsRef.current !== queued || !props.display?.ready || props.display.verifiedScope !== pathFinderWorkflowDisplayScope(props.pf, props.accountId)
      || !selected || submittedCalculation || savedCalculation
      || refreshingSelected || selectedReadError || calculationWatchOwner(props) !== queued.owner || modelScope(props) !== queued.model
      || selected.cable.id !== queued.cableId || props.display.cableId !== queued.cableId || props.display.jobId !== queued.jobId
      || props.display.proposalId !== queued.proposalId || props.display.proposalHash !== queued.proposalHash) return;
    const key = JSON.stringify(queued);
    protectedDiagnostics.current = queued;
    settledDiagnosticsRef.current = null; setSettledDiagnostics(null);
    if (refreshedDiagnostics.current.has(key)) return;
    if (refreshedDiagnostics.current.size >= MAX_RETAINED_CALCULATION_ATTEMPTS) refreshedDiagnostics.current.delete(refreshedDiagnostics.current.values().next().value!);
    refreshedDiagnostics.current.add(key);
    const epoch = diagnosticsEpoch.current, current = callbacks.current;
    // This history/list read starts only after the own result is drawable. Its
    // failure cannot retract a route that was independently verified already.
    void backgroundStateRefresh().then(state => {
      const row = selectedRef.current;
      if (!alive.current || !callbacks.current.active || diagnosticsEpoch.current !== epoch || !state || calculationWatchOwner(callbacks.current) !== queued.owner
        || modelScope(callbacks.current) !== queued.model || state.projectId !== current.projectId || activeModelScope(state.activeModel) !== queued.model
        || row?.cable.id !== queued.cableId || row.calculation.jobId !== queued.jobId || row.calculation.proposalId !== queued.proposalId
        || row.calculation.proposalHash !== queued.proposalHash || submittedRef.current || savedCalculationRef.current) return;
      acceptVerifiedRefresh(row, state); setRevision(value => value + 1);
    }).catch(() => { /* Current display proof is independent of the optional history refresh. */ });
  }, [settledDiagnostics, props.display, selected, submittedCalculation, savedCalculation, refreshingSelected, selectedReadError, props, enabled, acceptVerifiedRefresh, backgroundStateRefresh]);
  const failedCalculation = selected && selected.calculation.jobId && selected.calculation.outcome !== 'calculated'
    && (['complete', 'failed', 'cancelled'].includes(selected.calculation.jobStatus ?? '') || selected.calculation.itemState === 'blocked') ? selected : null;
  const failureDiagnosticKey = failedCalculation ? JSON.stringify([calculationWatchOwner(props), modelScope(props), failedCalculation.cable.id,
    failedCalculation.calculation.jobId, failedCalculation.calculation.jobStatus, failedCalculation.calculation.outcome]) : null;
  useEffect(() => {
    // Terminal diagnostics are display-only. A failed result has no drawable
    // proposal, so it cannot wait for the successful-result history refresh.
    if (!failureDiagnosticKey || !props.active || refreshingSelected || selectedReadError || submittedCalculation || savedCalculation) return;
    const current = callbacks.current, row = selectedRef.current;
    if (!row?.calculation.jobId || !current.projectId || !current.token) return;
    const cableId = row.cable.id, jobId = row.calculation.jobId;
    const owner = calculationWatchOwner(current), model = modelScope(current), retained = calculationDiagnosticsRef.current;
    if (retained?.owner === owner && retained.model === model && retained.value.cableId === cableId && retained.value.jobId === jobId
      && (retained.value.readError || ['complete', 'failed', 'cancelled'].includes(retained.value.jobStatus ?? '')
        || ['complete', 'blocked'].includes(retained.value.itemState ?? ''))) return;
    const ticket = new AbortController();
    const live = () => alive.current && !ticket.signal.aborted && callbacks.current.active
      && calculationWatchOwner(callbacks.current) === owner && modelScope(callbacks.current) === model
      && selectedRef.current?.cable.id === cableId && selectedRef.current.calculation.jobId === jobId
      && (callbacks.current.selectedCableId == null || callbacks.current.selectedCableId === cableId);
    void readCalculationJob(current.projectId, current.token, jobId, ticket.signal, Date.now() + 30_000).then(job => {
      if (!live()) return;
      if (!job) throw readFailure('CALCULATION_DIAGNOSTIC_UNAVAILABLE');
      retainCalculationDiagnostics(job, cableId, jobId);
    }).catch(() => {
      if (!live()) return;
      const snapshot: CalculationDiagnosticSnapshot = { owner, model, value: { cableId, jobId,
        jobStatus: row.calculation.jobStatus, itemStatus: null, itemState: null, itemMessage: null, jobFailure: null,
        readError: 'This calculation’s diagnostic could not be read. Refresh cable status to check the same job; no new calculation was submitted.',
      } };
      calculationDiagnosticsRef.current = snapshot; setCalculationDiagnostics(snapshot);
    });
    return () => ticket.abort();
  }, [failureDiagnosticKey, diagnosticReadRevision, props.active, refreshingSelected, selectedReadError, submittedCalculation, savedCalculation, retainCalculationDiagnostics]);
  const matchedReview = props.review && selected && props.review.cableId === selected.cable.id
    && (props.review.pending || !submittedCalculation && !refreshingSelected && !selectedReadError && previousReadScope.current === selectedReadScope && Boolean(readPreferences)
      && props.review.proposalId !== null && props.review.proposalId === selected.calculation.proposalId) ? props.review : null;
  // The Results owner checks the exact recorded proposal and current barrier
  // proof. The next-calculation draft cannot change that review policy.
  const popupReview = matchedReview;
  const selectedCalculation = displayedSelection?.calculation;
  const displaySourceMatches = Boolean(selected && props.display?.cableId === selected.cable.id
    && props.display.verifiedScope === pathFinderWorkflowDisplayScope(props.pf, props.accountId)
    && (!props.display.verifiedRow || verifiedRowMatches)
    && props.display.jobId === selectedCalculation?.jobId && props.display.proposalId === selectedCalculation?.proposalId
    && props.display.proposalHash === selectedCalculation?.proposalHash
    && (props.display.source !== 'saved-exact' && selectedCalculation?.currentness === 'current'
      || props.display.source === 'saved-exact' && verifiedRowMatches && selectedCalculation && savedDisplayCandidate(selectedCalculation))
    && !submittedCalculation && !(displayedSelection && automaticUpdatePending(displayedSelection.calculation)) && savedCalculation?.cableId !== selected.cable.id && !refreshingSelected && !selectedReadError);
  const displayMatches = displaySourceMatches && Boolean(props.display?.ready);
  // Exact proposal text can be read before its viewer foreground is ready.
  // Show still requires the complete verified display payload above.
  const displayTextMatches = displaySourceMatches && selectedCalculation?.outcome === 'calculated' && selectedCalculation.itemState === 'complete'
    && !['failed', 'cancelled'].includes(selectedCalculation.jobStatus ?? '')
    && (Boolean(props.display?.ready) || typeof props.display?.routing === 'string');
  const waitingForSavedCalculation = savedCalculation?.cableId === selected?.cable.id && Boolean(savedCalculation);
  const displayCheckFeedback = !displayMatches && !waitingForSavedCalculation && !submittedCalculation && selected
    && props.display?.cableId === selected.cable.id && props.display.jobId === selected.calculation.jobId
    && props.display.proposalId === selected.calculation.proposalId && props.display.proposalHash === selected.calculation.proposalHash
    && props.display.message ? { cableId: selected.cable.id, working: props.display.checking === true, message: props.display.message } : null;
  const selectedFeedback = calculationFeedback?.cableId === selected?.cable.id ? calculationFeedback : null;
  const currentFeedback = selectedFeedback ? { cableId: selectedFeedback.cableId, working: selectedFeedback.working,
    message: selectedFeedback.message, currentAttempt: selectedFeedback.attempt?.owner === calculationAttemptOwner(props) } : null;
  if (currentFeedback && displayMatches && currentFeedback.message.startsWith('The calculation finished.')) {
    currentFeedback.working = false;
    currentFeedback.message = selected?.calculation.acceptedMatchesCurrent
      ? 'The current route and Design length are saved in Cable list. Use Show to inspect this result.'
      : 'The current route is ready. Manually changed cable values are retained; compare them, then Review and Apply.';
  }
  const preparationUpdated = selected?.calculation.outcome === 'stale' && selected.calculation.currentness === 'changed'
    && selected.calculation.reasonCodes.includes('ROUTING_PREPARATION_UPDATED');
  const popupFeedback = preparationUpdated && currentFeedback?.currentAttempt ? currentFeedback : displayCheckFeedback ?? currentFeedback;
  return <section aria-label="Cable routing workspace">
    <PathFinderNeedsRoutingList {...props} active={enabled} modelScopeKey={JSON.stringify([props.owner, revision])}
      preferences={readPreferences ?? { secondaryDistanceMeters: 2, preferVerticalApproach: true }} selectedCableId={selected?.cable.id ?? null}
      onAuthorityLost={authorityLost} onSelect={openCable} onPreview={previewCable} onPreviewLeave={leavePreview} />
    {calculationBlockedReason ? <p role="status">{calculationBlockedReason} Choose Calculate routing to open the configuration. You can still search cables and open their windows.</p> : null}
    {preview && !open && props.active ? <CableHoverPreview row={preview.row} anchor={preview.anchor} onEnter={keepPreview} onLeave={leavePreview}
      onClose={dismissPreview} onOpen={() => openCable(preview.row)} /> : null}
    {notice ? <p role="status">{notice}</p> : null}
    {selected ? <p role="status">Selected cable: {selected.cable.tag ?? 'Untagged cable'} — {submittedCalculation || waitingForSavedCalculation ? 'Recalculating'
      : selectedStatus?.status === 'ready-for-review' && !displayMatches ? 'Checking the calculated result' : selectedStatus?.status === 'up-to-date' ? 'Updated in Cable list'
      : selectedStatus?.status === 'ready-for-review' ? 'Ready for review; existing values remain until Apply' : selectedStatus?.status === 'calculating' ? 'Recalculating' : 'Needs routing or attention'}.</p> : null}
    {selected && !open ? <Button onClick={() => openCable(selected)}>Open selected cable</Button> : null}
    {selected ? <Button disabled={!panelActive || refreshingSelected} onClick={() => { setRevision(value => value + 1); void refreshSelected(true); void progress.refresh(); void writes.refresh(); }}>Refresh selected cable</Button> : null}
    {impact ? <section aria-label="Affected cable progress">
      <h4>Shared location progress</h4>
      {progress.impact ? <p role="status">{progress.impact.status === 'complete' ? 'Calculation complete' : progress.impact.status.replaceAll('-', ' ')}: {progress.impact.completed} / {progress.impact.total} affected cables.</p> : <p>Reading affected calculation…</p>}
      {progress.error ? <p role="alert">{progress.error}</p> : null}
      {writes.progress ? <p role="status">Cable list updates: {writes.progress.counters.written + writes.progress.counters['already-written']} written; {writes.progress.counters['review-required']} require review.
        {writes.progress.outstanding ? ' Automatic updates are still being processed.' : ' Automatic update processing has stopped.'}</p> : null}
      {writes.progress?.selected?.reasonCode ? <p>Update needs attention: {writes.progress.selected.reasonCode.toLowerCase().replaceAll('_', ' ')}.</p> : null}
      {writes.error ? <p role="alert">{writes.error}</p> : null}
      <details><summary>Advanced progress details</summary><p>Calculation and conditional initial fill are separate. Updated is shown only after live cable evidence confirms the receipt-backed values.</p>
        <p>History reads do not renew the original administrator permission.</p>
        {progress.impact?.reasonCodes.map(code => <p key={code}>{code}</p>)}
      </details>
    </section> : null}
    <PathFinderCableRoutingPanel requestedPopup={popup} cable={displayedSelection} open={open && props.active} onClose={() => setOpen(false)} access={{ ...props,
      active: panelActive, model: model?.modelVersionId && model.contentFingerprint ? { modelVersionId: model.modelVersionId,
        selectionRevision: model.selectionRevision, contentFingerprint: model.contentFingerprint } : null,
      preparationKey: JSON.stringify([props.pf.preparationViewerGeneration, props.pf.data?.artifacts.map(item => [item.id, item.snapshotSha256])]),
      // Endpoint-only Save requests no calculation or write authority. New
      // ready saves use the explicit automatic-ownership policy.
      calculation, initialFill: null, automaticPairPolicy: calculationEnabled && selectedEligible ? AUTOMATIC_PAIR_POLICY : null,
      readSelection: props.pf.readSelection, onSaved: saved, onAuthorityLost: authorityLost,
    }} onCalculate={enabled && selectedEligible && !submittedCalculation && !waitingForSavedCalculation && !popupReview?.pending && selected && !selectedCalculationPending(selected.calculation) ? calculateSelected : undefined}
      calculationBlockedReason={calculationBlockedReason} onConfigureCalculation={props.onConfigureCalculation}
      drillThroughWalls={drillThroughWalls} onDrillThroughWallsChange={checked => {
        if (selected) setDrillDraft({ cableId: selected.cable.id, checked });
      }} submittedDrillThroughWalls={submittedCalculation?.cableId === selected?.cable.id ? submittedCalculation?.preferences.barrierRouting?.drillThroughWalls : null}
      calculationFeedback={popupFeedback}
      calculationDiagnostics={!selectedReadError && calculationDiagnostics?.owner === calculationWatchOwner(props)
        && calculationDiagnostics.model === modelScope(props) && calculationDiagnostics.value.cableId === selected?.cable.id
        && calculationDiagnostics.value.jobId === selected?.calculation.jobId ? calculationDiagnostics.value : null}
      onRefresh={async () => { await progress.refresh(); await refreshSelected(true); }} refreshing={refreshingSelected} refreshError={selectedReadError}
      onTogglePath={selected && props.onTogglePath ? () => props.onTogglePath?.(selected.cable.id) : undefined}
      onShowLocation={props.pf.viewerPhase === 'ready' ? props.pf.showLocation : undefined}
      onEndpointForegroundContexts={props.onEndpointForegroundContexts}
      pathVisible={displayMatches && props.display?.visible}
      pathReady={displayMatches} pathSource={displayTextMatches ? props.display?.source : null} endpointRefreshKey={endpointRefreshKey}
      calculatedRouting={displayTextMatches ? props.display?.routing : undefined}
      calculatedDesignLength={displayTextMatches ? props.display?.designLength : undefined}
      review={popupReview}
      calculationPending={submittedCalculation?.cableId === selected?.cable.id || waitingForSavedCalculation || selectedAutomaticUpdatePending}
      actionsBusy={calculating || props.pf.busy} />
  </section>;
}

/** Hover is a read-only preview. It never reads selection, changes the route or replaces an editor draft. */
function CableHoverPreview({ row, anchor, onEnter, onLeave, onClose, onOpen }: { row: CableWorkflowRow; anchor: HTMLElement;
  onEnter: () => void; onLeave: () => void; onClose: () => void; onOpen: () => void }) {
  const styles = useCableInformationPanelStyles(), rect = anchor.getBoundingClientRect();
  const left = Math.max(8, Math.min(rect.right + 12, window.innerWidth - 436)), top = Math.max(8, Math.min(rect.top, window.innerHeight - 300));
  useEffect(() => { const escape = (event: KeyboardEvent) => { if (event.key === 'Escape' && !event.defaultPrevented) { event.preventDefault(); onClose(); } };
    document.addEventListener('keydown', escape); return () => document.removeEventListener('keydown', escape); }, [onClose]);
  return <Portal><div role="dialog" aria-modal="false" aria-label={row.cable.tag || 'Cable preview'} className={styles.panel}
    style={{ left, top, width: 'min(420px, calc(100vw - 16px))', maxHeight: 'calc(100vh - 16px)' }}
    onPointerEnter={onEnter} onPointerLeave={onLeave} onFocus={onEnter} onBlur={onLeave} data-cable-preview="true">
    <h3 className={styles.heading}>{row.cable.tag || 'Cable preview'}</h3>
    <p>From: {row.cable.fromLocation || 'No location name'}<br />To: {row.cable.toLocation || 'No location name'}</p>
    <p>{cableWorkflowReason(row)}</p>
    <p>Routing: {row.cable.routing || 'Not set'}<br />Design length: {row.cable.designLength ?? 'Not set'} m</p>
    <div className={styles.actions}><Button onClick={onOpen}>Open cable in separate window</Button><Button onClick={onClose}>Close preview</Button></div>
  </div></Portal>;
}
