import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Body1, Button, Caption1, Spinner } from '@fluentui/react-components';
import type { PathFinderJob, PathFinderPreferences, PathFinderProposal } from '@/api/pathfinder';
import { MAX_PATH_POINTS } from '../../../viewer-runtime/protocol.mjs';
import type { usePathFinder } from './hooks/usePathFinder';
import { useRoutingsViewerStyles } from './RoutingsViewerTab.styles';
import { PathFinderRecalculationPanel } from './PathFinderRecalculationPanel';
import { PathFinderRevisionResults, type PathFinderCalculationScope } from './PathFinderRevisionResults';
import { usePathfinderPendingApply } from './hooks/usePathfinderPendingApply';
import { usePathfinderBatchReview } from './hooks/usePathfinderBatchReview';
import { PathFinderBatchReview } from './PathFinderBatchReview';
import { computedPathObjectIds, proposalEndpointObjectIds, proposalEndpointObjectIdsFromContexts, type PathFinderEndpointForegroundContexts } from './pathFinderEndpointVisibility';
import { sealedCableItemApplicabilitySchema } from '../../../shared/pathfinderItemApplicability';
import { fetchPathFinderCableWorkflowDetail, type CableWorkflowDetailQuery } from '@/api/pathfinderCableWorkflow';
import { PathFinderCableComparison } from '@/components/pathfinder/PathFinderCableComparison';
import { cableComparisonInputSchema, type CableComparisonInput } from '../../../shared/pathfinderCableComparison';
import { cableWorkflowRowSchema, type CableWorkflowRow } from '../../../shared/pathfinderCableWorkflow';
import { revisionResultEnvelopeSchema } from '../../../shared/pathfinderRevisionResults';
import { PathFinderDirectSecondary } from './PathFinderDirectSecondary';
import { PathFinderBarrierResult } from './PathFinderBarrierResult';
import { sameSupportedBarrierAdmissionIntent as sameBarrierAdmissionIntent } from '../../../shared/pathfinderBarrierSupported';
import { canonicalDecimalString } from '../../../shared/pathfinderLengthLedger';
import type { AutoLengthView } from '../../../shared/pathfinderAutoLength';
import type { PathFinderCalculatedItemIdentity } from './hooks/usePathfinderAutoLengthRead';

export type PathFinderWorkflowDisplayRequest = { cableId: string; requestId: number; action: 'show' | 'hide' };
export type PathFinderWorkflowDisplay = { cableId: string | null; jobId: string | null; proposalId: string | null; proposalHash: string | null;
  ready: boolean; visible: boolean; routing: string | null; designLength: string | null;
  /** Read-only status for this exact result; it supplies no display or write proof. */
  checking?: boolean; message?: string | null;
  source?: 'current-calculation' | 'saved-exact' | null;
  /** Exact current row read under the proposal's recorded policy, for display only. */
  verifiedRow?: CableWorkflowRow | null; verifiedScope?: string | null };
type WorkflowPath = Parameters<ReturnType<typeof usePathFinder>['showPath']>[0];
type WorkflowDraw = { key: string; operation: number; currentDisplay: () => boolean;
  showPath: ReturnType<typeof usePathFinder>['showPath']; running: boolean };
export function pathFinderWorkflowDisplayScope(pf: ReturnType<typeof usePathFinder>, accountId: string | null): string {
  return JSON.stringify([pf.preparationAccess, pf.preparationViewerGeneration, pf.data?.activeModel, pf.data?.registryRevision,
    pf.data?.settings, pf.data?.artifacts.map(item => [item.id, item.snapshotSha256]), accountId]);
}
function proposalDisplayModelCurrent(proposal: PathFinderProposal, state: ReturnType<typeof usePathFinder>['data']): boolean {
  const evidence = proposal.dependencies, artifact = state?.artifacts[0];
  return !evidence || Boolean(state && evidence.projectId === state.projectId && evidence.model.id === state.activeModel.modelVersionId
    && evidence.model.selectionRevision === state.activeModel.selectionRevision && evidence.model.contentFingerprint === state.activeModel.contentFingerprint
    && artifact && artifact.id === evidence.artifact.id && artifact.modelVersionId === state.activeModel.modelVersionId && artifact.snapshotSha256 === evidence.artifact.sha256);
}
/** The authenticated workflow reader verifies the receipt and all current
 * dependencies. This acknowledgement changes presentation only, never writes. */
function currentAcceptedDisplayRow(proposal: PathFinderProposal, row: CableWorkflowRow | null | undefined) {
  const parsed = cableWorkflowRowSchema.safeParse(row), result = revisionResultEnvelopeSchema.safeParse(proposal.revisionResult);
  if (!parsed.success || !result.success || proposal.status !== 'calculated' || !proposal.route?.success || !proposal.design || proposal.compatibilityIssue) return false;
  const value = parsed.data, calculation = value.calculation, envelope = result.data;
  if (value.projectId !== proposal.projectId || value.cable.id !== proposal.cableId || calculation.jobId !== proposal.jobId
    || calculation.proposalId !== proposal.id || calculation.proposalHash !== proposal.proposalHash
    || calculation.jobStatus !== 'complete' || calculation.itemState !== 'complete' || calculation.outcome !== 'calculated'
    || calculation.currentness !== 'current' || !calculation.acceptedMatchesCurrent
    || envelope.projectId !== proposal.projectId || envelope.cableId !== proposal.cableId || envelope.jobId !== proposal.jobId
    || envelope.proposalId !== proposal.id || envelope.proposalHash !== proposal.proposalHash
    || envelope.revisionResultSha256 !== proposal.revisionResultHash || envelope.baselineHash !== proposal.revisionBaselineHash
    || envelope.dependencyHash !== proposal.provenance?.dependencyHash || value.cable.routing !== proposal.route.routeText
    || value.cable.designLength === null) return false;
  try { return canonicalDecimalString(value.cable.designLength) === canonicalDecimalString(proposal.design.designLengthMeters); } catch { return false; }
}
function matchingEndpointForeground(value: PathFinderEndpointForegroundContexts | null | undefined,
  pf: ReturnType<typeof usePathFinder>, accountId: string | null | undefined, cableId: string) {
  const access = pf.preparationAccess, model = pf.data?.activeModel;
  return value && access?.isAdmin && access.projectId === access.loadedProjectId && value.projectId === access.projectId
    && value.accountId === accountId && value.token === access.token && value.cableId === cableId
    && value.modelVersionId === model?.modelVersionId && value.selectionRevision === model.selectionRevision
    && value.contentFingerprint === model.contentFingerprint
    && value.preparationKey === JSON.stringify([pf.preparationViewerGeneration, pf.data?.artifacts.map(item => [item.id, item.snapshotSha256])]) ? value : null;
}
/** Only a positively acknowledged selected-cable job owns this snapshot. */
export type PathFinderWorkflowCalculationPreferences = { cableId: string; jobId: string; preferences: PathFinderPreferences };
const VERIFICATION_READ_WINDOW_MS = 30_000;
const VERIFICATION_RETRY_DELAYS = [500, 1500, 3000, 5000, 5000, 5000];
const verificationPending = (message: string) => Object.assign(new Error(message), { code: 'WORKFLOW_VERIFICATION_PENDING' });
const ENDPOINT_FOREGROUND_RETRY_DELAYS = [250, 750];
function waitForEndpointForegroundRetry(delay: number, signal: AbortSignal): Promise<boolean> {
  if (signal.aborted) return Promise.resolve(false);
  return new Promise(resolve => {
    const finish = (ready: boolean) => { clearTimeout(timer); signal.removeEventListener('abort', abort); resolve(ready); };
    const abort = () => finish(false), timer = setTimeout(() => finish(true), delay);
    signal.addEventListener('abort', abort, { once: true });
  });
}
function retryableVerificationRead(error: unknown) {
  if (!error || typeof error !== 'object') return false;
  const status = 'status' in error && error.status != null ? Number(error.status) : null;
  if (status !== null) return status === 408 || status === 429 || status >= 500;
  if ('code' in error && ['REQUEST_TIMEOUT', 'WORKFLOW_VERIFICATION_PENDING'].includes(String(error.code))) return true;
  return error instanceof TypeError || error instanceof DOMException && error.name === 'TimeoutError'
    || error instanceof Error && error.message === 'WORKFLOW_READ_UNAVAILABLE';
}
/** One display-only bridge to the existing owned review/recovery controller.
 * The popup never implements a second writer or creates a replacement command. */
export type PathFinderWorkflowReview = {
  cableId: string; proposalId: string | null; comparison: CableComparisonInput | null;
  comparisonLoading: boolean; comparisonError: string | null; message: string | null;
  reviewed: boolean; applied: boolean; canReview: boolean; canApply: boolean; busy: boolean;
  recordedDrillThroughWalls?: boolean | null;
  pending: boolean; canRecover: boolean; recoveryMessage: string | null; recoveryError: string | null;
  autoLength?: AutoLengthView | null; autoLengthLoading?: boolean; autoLengthError?: string | null; refreshAutoLength?: () => void;
  review: () => void; apply: () => void; retry: () => void; closePending: () => void;
};
type Props = { pf: ReturnType<typeof usePathFinder>; selectedCableId: string | null; workflowSelection?: CableWorkflowRow | null; accountId?: string | null; active?: boolean; displayOwned?: boolean; claimViewer?: () => () => boolean; options?: PathFinderPreferences | null; onBatchBusyChange?: (busy: boolean) => void; onCableValuesChanged?: () => void;
  backgroundOptions?: PathFinderPreferences | null; readPreferences?: CableWorkflowDetailQuery | null;
  workflowCalculationPreferences?: PathFinderWorkflowCalculationPreferences | null;
  workflowConfigurationReady?: boolean;
  workflowDisplayRequest?: PathFinderWorkflowDisplayRequest | null; onWorkflowDisplayChange?: (value: PathFinderWorkflowDisplay) => void;
  endpointForegroundContexts?: PathFinderEndpointForegroundContexts | null;
  onWorkflowReviewChange?: (value: PathFinderWorkflowReview | null) => void;
  onCalculationCommitted?: (value: PathFinderCalculatedItemIdentity) => void };
const resultLabel = (status: string) => ({ calculated: 'Ready for review', model_needs_review: 'Model review required', no_path: 'No connected path', settings_required: 'Project values required', category_required: 'Cable category required', locations_required: 'Resolve locations', stale: 'Outdated', deadline_exceeded: 'Calculation timed out', resource_limit: 'Calculation limit reached', invalid_request: 'Review the input' }[status] ?? 'Review required');
export function pathFinderJobOutputLabel(update: NonNullable<PathFinderJob['items']>[number]['automaticUpdate']): string {
  if (!update) return 'Cable list update: not reported';
  const labels = { pending: 'waiting to save', running: 'saving', written: 'saved', 'already-written': 'already saved',
    'review-required': 'confirmation required', stale: 'not saved — inputs changed', 'authority-expired': 'not saved — authorization expired',
    refused: 'not saved', unknown: 'save not confirmed' };
  return `Cable list update: ${labels[update.status]}${update.reasonCode ? ` (${update.reasonCode.toLowerCase().replaceAll('_', ' ')})` : ''}`;
}
function hasExactItemApplicability(proposal: PathFinderProposal | null, projectId: string | null | undefined) {
  const proof = sealedCableItemApplicabilitySchema.safeParse(proposal?.itemApplicability);
  return Boolean(proposal && projectId && proof.success && (proposal.provenance?.dependencyVersion === 'pathfinder.dependencies.v7'
    && proof.data.schemaVersion === 'wfc.pf.sealed-cable-applicability.v1' && proof.data.dependencyVersion === 'pathfinder.dependencies.v7'
    || proposal.provenance?.dependencyVersion === 'pathfinder.dependencies.v8'
    && proof.data.schemaVersion === 'wfc.pf.sealed-cable-applicability.v2' && proof.data.dependencyVersion === 'pathfinder.dependencies.v8')
    && proposal.projectId === projectId && proof.data.projectId === projectId && proof.data.jobId === proposal.jobId
    && proof.data.cableId === proposal.cableId && proof.data.proposalId === proposal.id && proof.data.dependencyHash === proposal.provenance.dependencyHash);
}
/** Background progress is not a new selected result. A whole-job completion
 * replaces its own sealed-item or accepted-result authority without changing the checked path.
 * This key only schedules reads; the full verifier below still grants readiness. */
function workflowCompletionKey(row: CableWorkflowRow | null, checked: PathFinderProposal | null) {
  const calculation = row?.calculation;
  if (!row || !calculation) return null;
  const item = sealedCableItemApplicabilitySchema.safeParse(calculation.itemApplicability);
  const known = checked?.projectId === row.projectId && checked.cableId === row.cable.id
    && checked.jobId === calculation.jobId && checked.id === calculation.proposalId && checked.proposalHash === calculation.proposalHash ? checked : null;
  const exactItem = item.success && item.data.projectId === row.projectId && item.data.cableId === row.cable.id
    && item.data.jobId === calculation.jobId && item.data.proposalId === calculation.proposalId
    && (!known || item.data.dependencyVersion === known.provenance?.dependencyVersion && item.data.dependencyHash === known.provenance.dependencyHash);
  const acceptedItem = calculation.outcome === 'calculated' && calculation.acceptedMatchesCurrent && (() => {
    if (!known) return true;
    if (!known.route?.success || !known.design || row.cable.routing !== known.route.routeText || row.cable.designLength === null) return false;
    try { return canonicalDecimalString(row.cable.designLength) === canonicalDecimalString(known.design.designLengthMeters); } catch { return false; }
  })();
  return calculation.itemState === 'complete' && calculation.currentness === 'current'
    && (calculation.jobStatus === 'complete' || ['queued', 'running'].includes(calculation.jobStatus ?? '') && (exactItem || acceptedItem))
    ? 'selected-result-complete'
    : [calculation.jobStatus, calculation.itemApplicability ?? null];
}
export function PathFinderResults({ pf, selectedCableId, workflowSelection = null, workflowCalculationPreferences = null, workflowConfigurationReady, accountId, active = true, displayOwned = true, claimViewer, options, backgroundOptions, readPreferences, onBatchBusyChange, onCableValuesChanged,
  workflowDisplayRequest, onWorkflowDisplayChange, onWorkflowReviewChange, onCalculationCommitted, endpointForegroundContexts }: Props) {
  const styles = useRoutingsViewerStyles();
  const [proposal, setProposal] = useState<PathFinderProposal | null>(null), [job, setJob] = useState<PathFinderJob | null>(null);
  const [reviewId, setReviewId] = useState<string | null>(null), [pathDisplayed, setPathDisplayed] = useState(false), [applied, setApplied] = useState(false);
  const reviewTicket = useRef<object | null>(null), [reviewBusy, setReviewBusy] = useState(false);
  const [previewLoading, setPreviewLoading] = useState(false);
  const displayRequestLatest = useRef({ pf, selectedCableId, active, displayOwned });
  displayRequestLatest.current = { pf, selectedCableId, active, displayOwned };
  const [workflowDisplayProof, setWorkflowDisplayProof] = useState<{ key: string; proposalId: string; proposalHash: string; accepted: boolean; source: 'current-calculation' | 'saved-exact' } | null>(null);
  const [workflowProposalRead, setWorkflowProposalRead] = useState<{ key: string; proposalId: string; proposalHash: string; row: CableWorkflowRow; scope: string; source: 'current-calculation' | 'saved-exact' } | null>(null);
  const [workflowCheck, setWorkflowCheck] = useState<{ key: string; checking: boolean; message: string } | null>(null);
  const verifiedWorkflowPath = useRef<{ key: string; path: WorkflowPath } | null>(null);
  const workflowDraw = useRef<WorkflowDraw | null>(null);
  const [scopeReadiness, setScopeReadiness] = useState<PathFinderCalculationScope>({ admissionId: null, jobId: null, ready: false, message: 'Choose a completed calculation in Cable revision results below.' });
  const scope = useRef(scopeReadiness);
  const historyScope = useRef(scopeReadiness), workflowScope = useRef<string | null>(null);
  const workflowIdentity = useRef<string | null>(null), suppressedWorkflow = useRef<string | null>(null);
  const [historyReadiness, setHistoryReadiness] = useState(scopeReadiness);
  const [workflowScopeOwner, setWorkflowScopeOwner] = useState<string | null>(null), [workflowAttempt, setWorkflowAttempt] = useState(0);
  const [notice, setNotice] = useState<string | null>(null), data = pf.data;
  const closeHadReceipt = useRef(false);
  const confirmedCableWrite = () => { pf.refresh(); onCableValuesChanged?.(); };
  const pendingApply = usePathfinderPendingApply({
    projectId: pf.preparationAccess?.projectId ?? null, loadedProjectId: pf.preparationAccess?.loadedProjectId ?? null,
    token: pf.preparationAccess?.token ?? null, isAdmin: pf.preparationAccess?.isAdmin ?? false,
    accountId: accountId ?? null, active, action: async (path, body) => {
      const result = await (pf.actionWithoutRefresh ?? pf.action)(path, body);
      if (path.endsWith('/close-pending-apply')) closeHadReceipt.current = result?.status === 'already-applied';
      return result;
    },
  });
  const ownershipKey = JSON.stringify([accountId, pf.preparationAccess]);
  const batch = usePathfinderBatchReview({ identityKey: ownershipKey,
    contextKey: JSON.stringify([data?.activeModel, data?.registryRevision, data?.settings, data?.artifacts.map(item => [item.id, item.snapshotSha256])]),
    active, blocked: !active || options === null || pf.viewerPhase === 'error' || pf.viewerPhase === 'loading', options,
    readProposal: pf.readProposal, reviewProposal: pf.reviewProposal, pendingApply, onApplied: confirmedCableWrite,
  });
  useEffect(() => { onBatchBusyChange?.(batch.busy); return () => onBatchBusyChange?.(false); }, [batch.busy, onBatchBusyChange]);
  const operation = useRef(0), reviewContext = useRef(''), endpointRead = useRef<AbortController | null>(null);
  const displayed = useRef({ owned: displayOwned, path: pathDisplayed, clear: pf.clear });
  displayed.current = { owned: displayOwned, path: pathDisplayed, clear: pf.clear };
  const adoptScope = useCallback((value: PathFinderCalculationScope, force = false) => {
    const previous = scope.current;
    scope.current = value;
    if (!force && previous.admissionId === value.admissionId && previous.jobId === value.jobId && previous.ready === value.ready && previous.message === value.message
      && previous.wholeJobReady === value.wholeJobReady && previous.jobStatus === value.jobStatus && previous.cancelRequested === value.cancelRequested) return;
    setScopeReadiness(value);
    if (!force && previous.admissionId === value.admissionId && previous.jobId === value.jobId) return;
    endpointRead.current?.abort(); operation.current++;
    setProposal(null); setReviewId(null); setPathDisplayed(false); setApplied(false); setPreviewLoading(false); setNotice(null);
    if (displayed.current.owned && displayed.current.path) displayed.current.clear();
  }, []);
  const receiveScope = useCallback((value: PathFinderCalculationScope) => {
    historyScope.current = value; setHistoryReadiness(value); if (!workflowScope.current) adoptScope(value);
  }, [adoptScope]);
  const selectHistory = useCallback(() => {
    suppressedWorkflow.current = workflowIdentity.current; workflowScope.current = null; setWorkflowScopeOwner(null); adoptScope(historyScope.current, true);
  }, [adoptScope]);
  useEffect(() => { endpointRead.current?.abort(); operation.current++; setProposal(null); setReviewId(null); setPathDisplayed(false); setApplied(false); setPreviewLoading(false); setNotice(null); return () => { endpointRead.current?.abort(); operation.current++; }; }, [ownershipKey, selectedCableId, data?.activeModel.modelVersionId, data?.activeModel.selectionRevision]);
  useEffect(() => { endpointRead.current?.abort(); operation.current++; setReviewId(null); setPathDisplayed(false); setApplied(false); setPreviewLoading(false); setNotice(null); return () => { endpointRead.current?.abort(); operation.current++; }; }, [active]);
  useEffect(() => { if (!displayOwned) {
    // A different presentation may own the viewer while this selected cable's
    // read-only result is loading. Only history inspection owns the display.
    if (workflowScope.current === null) endpointRead.current?.abort();
    operation.current++; setReviewId(null); setPathDisplayed(false); setApplied(false); setPreviewLoading(false); setNotice(null);
  } }, [displayOwned]);
  const optionsKey = JSON.stringify(options);
  // Reading stored cable values does not require permission for a new
  // calculation. Keep these transport preferences out of every write gate.
  const comparisonPreferences = readPreferences === undefined ? options : readPreferences;
  const readPreferencesKey = JSON.stringify(comparisonPreferences);
  useEffect(() => { endpointRead.current?.abort(); operation.current++; setReviewId(null); setPathDisplayed(false); setApplied(false); setNotice(null); }, [optionsKey]);
  const selectedRevision = data?.cables.find(cable => cable.id === proposal?.cableId)?.cableWriteRevision;
  const settingsKey = JSON.stringify(data?.settings);
  const dependencyNotice = useRef<{ proposalId: string | null; key: string } | null>(null);
  useEffect(() => {
    const proposalId = proposal?.id ?? null, key = JSON.stringify([data?.registryRevision, data?.activeModel.selectionRevision, settingsKey, selectedRevision]);
    const previous = dependencyNotice.current; dependencyNotice.current = { proposalId, key };
    // The first proposal read also resolves selectedRevision. Preserve a notice
    // from that same read, and do not race a newly confirmed review. Opening a
    // different proposal already resets review state synchronously above.
    if (previous?.proposalId === proposalId && previous.key !== key) { setReviewId(null); setApplied(false); setNotice(null); }
  }, [data?.registryRevision, data?.activeModel.selectionRevision, settingsKey, selectedRevision, proposal?.id]);
  // Claiming the viewer changes displayOwned after the proposal read starts.
  // That is a presentation transition, not a change to the live cable identity;
  // retain its owned comparison while the separate display/write gates update.
  const comparisonContext = pathFinderWorkflowDisplayScope(pf, accountId ?? null);
  const comparisonBase = [ownershipKey, active, selectedCableId, data?.activeModel, settingsKey, optionsKey, readPreferencesKey, comparisonContext];
  const comparisonOwner = JSON.stringify([...comparisonBase, scopeReadiness.admissionId, scopeReadiness.jobId]);
  const comparisonLatest = useRef({ owner: comparisonOwner, cables: data?.cables }); comparisonLatest.current = { owner: comparisonOwner, cables: data?.cables };
  const comparisonRead = useRef<{ controller: AbortController; cableId: string; observedRevision: string | undefined } | null>(null);
  const [comparison, setComparison] = useState<{ owner: string; proposalId: string; proposalHash: string; revisionResultHash: string | null;
    observedRevision: string | undefined; loading: boolean; input: CableComparisonInput | null; error: string | null; acceptedRow?: CableWorkflowRow | null } | null>(null);
  useEffect(() => { comparisonRead.current?.controller.abort(); comparisonRead.current = null; setComparison(value => value?.owner === comparisonOwner ? value : null);
    return () => { comparisonRead.current?.controller.abort(); comparisonRead.current = null; }; }, [comparisonOwner]);
  useEffect(() => {
    const current = comparisonRead.current;
    if (current && current.observedRevision !== data?.cables.find(value => value.id === current.cableId)?.cableWriteRevision) {
      current.controller.abort(); comparisonRead.current = null;
    }
  }, [data?.cables]);
  const readComparison = async (detail: PathFinderProposal, atOperation: number) => {
    const access = pf.preparationAccess, preferences = comparisonPreferences === undefined ? detail.routingPreferences : comparisonPreferences;
    const owner = comparisonOwner, controller = new AbortController(), observedRevision = data?.cables.find(value => value.id === detail.cableId)?.cableWriteRevision;
    comparisonRead.current?.controller.abort(); comparisonRead.current = { controller, cableId: detail.cableId, observedRevision };
    const state = { owner, proposalId: detail.id, proposalHash: detail.proposalHash, revisionResultHash: detail.revisionResultHash ?? null, observedRevision };
    const current = () => !controller.signal.aborted && comparisonRead.current?.controller === controller && operation.current === atOperation
      && comparisonLatest.current.owner === owner
      && comparisonLatest.current.cables?.find(value => value.id === detail.cableId)?.cableWriteRevision === observedRevision;
    setComparison({ ...state, loading: true, input: null, error: null });
    try {
      if (!access?.isAdmin || !access.projectId || access.projectId !== access.loadedProjectId || access.projectId !== detail.projectId || !access.token || !preferences)
        throw new Error('CURRENT_COMPARISON_SCOPE_REQUIRED');
      const live = await fetchPathFinderCableWorkflowDetail(access.projectId, access.token, detail.cableId,
        preferences, controller.signal);
      if (!current()) return;
      const input = cableComparisonInputSchema.safeParse({ projectId: access.projectId, cableId: detail.cableId,
        current: { source: 'live-cable-read', contextSha256: live.contextSha256, mto: live.row.mto, cable: live.row.cable },
        proposal: { projectId: detail.projectId, cableId: detail.cableId, proposalId: detail.id, proposalHash: detail.proposalHash,
          revisionResultHash: detail.revisionResultHash ?? null, cableWriteRevision: detail.cableWriteRevision,
          routing: detail.route?.routeText ?? null, designLength: detail.design?.designLengthMeters ?? null } });
      if (!input.success || live.projectId !== access.projectId || live.cableId !== detail.cableId || live.row.projectId !== access.projectId
        || live.row.cable.id !== detail.cableId) throw new Error('COMPARISON_SCOPE_MISMATCH');
      setComparison({ ...state, loading: false, input: input.data, error: null, acceptedRow: currentAcceptedDisplayRow(detail, live.row) ? live.row : null });
    } catch {
      if (current()) setComparison({ ...state, loading: false, input: null, error: 'Live cable comparison is unavailable. Open this exact proposal again to refresh it. The model and saved proposal remain available.' });
    } finally { if (comparisonRead.current?.controller === controller) comparisonRead.current = null; }
  };
  const openProposal = async (id: string, expectedJobId: string) => {
    const selectedScope = scope.current;
    if (!active || !selectedScope.admissionId || selectedScope.jobId !== expectedJobId) return;
    const currentDisplay = claimViewer?.() ?? (() => true);
    const current = ++operation.current;
    comparisonRead.current?.controller.abort(); comparisonRead.current = null; setComparison(null);
    endpointRead.current?.abort(); const controller = new AbortController(); endpointRead.current = controller;
    setNotice(null); setProposal(null); setReviewId(null); setPathDisplayed(false); setApplied(false); setPreviewLoading(true);
    try {
      const detail = await pf.readProposal(id); if (!detail || operation.current !== current || !currentDisplay()) return;
      if (scope.current.admissionId !== selectedScope.admissionId || scope.current.jobId !== expectedJobId) return;
      if (detail.id !== id || detail.jobId !== expectedJobId) { setNotice('This proposal does not belong to the selected calculation. Open a result from that calculation again.'); return; }
      setProposal(detail);
      void readComparison(detail, current);
      if (!detail.route?.success || detail.route.points.length < 1) { pf.clear(); setNotice('This proposal has no drawable path. Its diagnostic is shown below.'); return; }
      if (detail.route.points.length > MAX_PATH_POINTS) { setNotice('This exact path exceeds the viewer point budget. The result is retained without truncation.'); return; }
      const access = pf.preparationAccess;
      const endpointIds = data && access?.projectId && access.token
        ? await proposalEndpointObjectIds(detail, data, { projectId: access.projectId, token: access.token }, controller.signal) : [];
      if (controller.signal.aborted || operation.current !== current || !currentDisplay()) return;
      const objectIds = computedPathObjectIds(detail.route.objectIds, endpointIds);
      if (!objectIds) { setNotice('This path and its From/To objects exceed the viewer object budget. The result is retained without truncation.'); return; }
      const displayed = await pf.showPath({ pathId: detail.id, points: detail.route.points, objectIds });
      if (operation.current !== current || !currentDisplay()) return;
      if (displayed) setPathDisplayed(true); else setNotice('The proposal is available below. Load the active model and reopen it to view the exact path before confirming review.');
    } catch (error) {
      if (controller.signal.aborted || operation.current !== current || !currentDisplay()) return;
      const status = error && typeof error === 'object' && 'status' in error ? error.status : null;
      if (status === 401 || status === 403) { pf.refresh(); setNotice('Current administrator access is required to show the From/To objects.'); }
      else setNotice('The From/To objects could not be checked. Open the path again.');
    } finally { if (endpointRead.current === controller) endpointRead.current = null; if (operation.current === current) setPreviewLoading(false); }
  };
  const workflowRow = cableWorkflowRowSchema.safeParse(workflowSelection);
  const workflowTarget = workflowRow.success && workflowRow.data.projectId === pf.preparationAccess?.projectId && workflowRow.data.cable.id === selectedCableId
    && workflowRow.data.calculation.outcome === 'calculated' && workflowRow.data.calculation.proposalId && workflowRow.data.calculation.proposalHash && workflowRow.data.calculation.jobId
    ? workflowRow.data : null;
  const workflowExpectedPreferences = workflowCalculationPreferences?.cableId === workflowTarget?.cable.id
    && workflowCalculationPreferences?.jobId === workflowTarget?.calculation.jobId ? workflowCalculationPreferences?.preferences : undefined;
  // An acknowledged immutable request identifies a policy; it does not make a
  // dirty, pending or unavailable current barrier configuration ready.
  const workflowConfigurationAvailable = workflowConfigurationReady ?? (options !== null);
  const workflowPreferencesKey = JSON.stringify([workflowExpectedPreferences, workflowConfigurationAvailable]);
  // Selecting a cable reads its result without changing model appearance. Only
  // an explicit Show may claim the viewer; a new context starts hidden.
  // Progress or a saved location must not reopen a deliberately hidden path.
  const globalWorkflowRevision = data?.cables.find(cable => cable.id === selectedCableId)?.cableWriteRevision;
  const selectedWorkflowRevision = workflowTarget?.cable.cableWriteRevision;
  // The own terminal row can precede the broad list refresh. Catching up to
  // that same revision is not a new result; a genuinely newer write still is.
  const observedWorkflowRevision = selectedWorkflowRevision && /^(0|[1-9][0-9]*)$/.test(selectedWorkflowRevision)
    && (!globalWorkflowRevision || /^(0|[1-9][0-9]*)$/.test(globalWorkflowRevision) && BigInt(selectedWorkflowRevision) > BigInt(globalWorkflowRevision))
    ? selectedWorkflowRevision : globalWorkflowRevision;
  const observedWorkflowJob = data?.jobs.find(value => value.id === workflowTarget?.calculation.jobId && value.projectId === workflowTarget.projectId);
  const observedWorkflowStop = observedWorkflowJob?.cancelRequested ? 'cancel-requested'
    : ['failed', 'cancelled'].includes(observedWorkflowJob?.status ?? '') ? observedWorkflowJob!.status : null;
  const workflowReadContext = JSON.stringify([data?.registryRevision, data?.artifacts.map(item => [item.id, item.snapshotSha256])]);
  const displayVerificationScope = pathFinderWorkflowDisplayScope(pf, accountId ?? null);
  const workflowDisplayContext = JSON.stringify([ownershipKey, active, selectedCableId, data?.activeModel, settingsKey, optionsKey, readPreferencesKey, workflowReadContext, observedWorkflowRevision, displayVerificationScope]);
  const workflowProposalKey = workflowTarget ? JSON.stringify([workflowTarget.calculation.jobId, workflowTarget.calculation.proposalId,
    workflowTarget.calculation.proposalHash, workflowTarget.cable.cableWriteRevision]) : null;
  const workflowHidden = useRef<{ context: string; hidden: boolean; proposalKey: string | null }>({ context: workflowDisplayContext, hidden: true, proposalKey: null });
  if (workflowHidden.current.context !== workflowDisplayContext) workflowHidden.current = { context: workflowDisplayContext, hidden: true, proposalKey: null };
  const handledDisplayRequest = useRef(-1);
  // The hint identifies one selected result. Replacing list rows or updating
  // their progress must never silently retarget the selected proposal.
  const selectedWorkflowIdentity = workflowTarget ? JSON.stringify([ownershipKey, active, selectedCableId, data?.activeModel, settingsKey, optionsKey, readPreferencesKey, workflowReadContext, observedWorkflowRevision, displayVerificationScope, workflowPreferencesKey, workflowAttempt,
    workflowTarget.calculation.jobId, workflowTarget.calculation.proposalId, workflowTarget.calculation.proposalHash, workflowTarget.cable.cableWriteRevision]) : null;
  workflowIdentity.current = selectedWorkflowIdentity;
  const workflowKey = workflowTarget ? JSON.stringify([selectedWorkflowIdentity, workflowCompletionKey(workflowTarget, proposal), observedWorkflowStop, workflowTarget.calculation.itemState,
    workflowTarget.calculation.currentness, workflowTarget.calculation.reviewable, workflowTarget.calculation.savedExactDisplay === true]) : null;
  // A retained proposal is useful history, but it cannot stand in for a newer
  // calculation while its exact metadata and endpoint foreground are loading.
  const displayReady = Boolean(active && !observedWorkflowStop && workflowKey && workflowDisplayProof?.key === workflowKey && proposal && workflowTarget
    && workflowDisplayProof.proposalId === proposal.id && workflowDisplayProof.proposalHash === proposal.proposalHash
    && workflowProposalRead?.key === workflowKey && workflowProposalRead.scope === displayVerificationScope
    && workflowProposalRead.row.calculation.itemState === 'complete'
    && (workflowDisplayProof.source === 'current-calculation' && workflowProposalRead.source === 'current-calculation'
      && workflowProposalRead.row.calculation.currentness === 'current'
      || workflowDisplayProof.source === 'saved-exact' && workflowProposalRead.source === 'saved-exact'
        && workflowProposalRead.row.calculation.savedExactDisplay === true && workflowProposalRead.row.calculation.jobStatus === 'complete')
    && workflowTarget.calculation.jobId === proposal.jobId && workflowTarget.calculation.proposalId === proposal.id
    && workflowTarget.calculation.proposalHash === proposal.proposalHash);
  const proposalCableId = proposal?.cableId ?? null, proposalJobId = proposal?.jobId ?? null,
    proposalId = proposal?.id ?? null, proposalHash = proposal?.proposalHash ?? null;
  // The exact proposal text is already useful while its display foreground is
  // loading. Keep it distinct from Show readiness and the stored Cable list.
  const selectedProposalRead = Boolean(active && workflowKey && workflowProposalRead?.key === workflowKey && proposal
    && workflowProposalRead.scope === displayVerificationScope
    && workflowProposalRead.proposalId === proposal.id && workflowProposalRead.proposalHash === proposal.proposalHash
    && workflowTarget?.calculation.jobId === proposal.jobId && workflowTarget.calculation.proposalId === proposal.id
    && workflowTarget.calculation.proposalHash === proposal.proposalHash);
  const proposalRouting = selectedProposalRead ? proposal?.route?.routeText ?? null : null;
  const proposalDesignLength = selectedProposalRead && proposal?.design?.designLengthMeters !== undefined ? String(proposal.design.designLengthMeters) : null;
  const verifiedRow = selectedProposalRead ? workflowProposalRead?.row ?? null : null;
  const verifiedScope = verifiedRow ? workflowProposalRead?.scope ?? null : null;
  const displaySource = selectedProposalRead ? workflowProposalRead?.source ?? null : null;
  const displayCheck = active && !displayReady && workflowCheck?.key === workflowKey ? workflowCheck : null;
  const displayCableId = displayCheck ? workflowTarget?.cable.id ?? proposalCableId : proposalCableId;
  const displayJobId = displayCheck ? workflowTarget?.calculation.jobId ?? proposalJobId : proposalJobId;
  const displayProposalId = displayCheck ? workflowTarget?.calculation.proposalId ?? proposalId : proposalId;
  const displayProposalHash = displayCheck ? workflowTarget?.calculation.proposalHash ?? proposalHash : proposalHash;
  useEffect(() => { onWorkflowDisplayChange?.({ cableId: displayCableId, jobId: displayJobId, proposalId: displayProposalId, proposalHash: displayProposalHash,
    ready: displayReady, visible: displayReady && active && displayOwned && pathDisplayed, routing: proposalRouting, designLength: proposalDesignLength,
    source: displaySource, verifiedRow, verifiedScope, ...(displayCheck ? { checking: displayCheck.checking, message: displayCheck.message } : {}) }); },
  [onWorkflowDisplayChange, displayCheck, displayCableId, displayJobId, displayProposalId, displayProposalHash, displayReady, proposalRouting, proposalDesignLength, displaySource, verifiedRow, verifiedScope, active, displayOwned, pathDisplayed]);
  const workflowLatest = useRef({ key: workflowKey, proposalKey: workflowProposalKey, ready: displayReady, target: workflowTarget, pf, readPreferences: comparisonPreferences, expectedPreferences: workflowExpectedPreferences, claimViewer, endpointForegroundContexts,
    comparisonBase });
  workflowLatest.current = { key: workflowKey, proposalKey: workflowProposalKey, ready: displayReady, target: workflowTarget, pf, readPreferences: comparisonPreferences, expectedPreferences: workflowExpectedPreferences, claimViewer, endpointForegroundContexts,
    comparisonBase };
  const drawWorkflowPath = useCallback(async (ticket: WorkflowDraw) => {
    const current = () => workflowDraw.current === ticket && operation.current === ticket.operation
      && workflowLatest.current.key === ticket.key && workflowScope.current === ticket.key
      && !workflowHidden.current.hidden && ticket.currentDisplay();
    if (ticket.running || !current()) return;
    ticket.running = true;
    try {
      for (;;) {
        const checked = verifiedWorkflowPath.current;
        if (!current() || checked?.key !== ticket.key) return;
        const path = checked.path, shown = await ticket.showPath(path);
        if (!current()) return;
        setPathDisplayed(Boolean(shown));
        if (!shown) setNotice('The checked route could not be displayed. Load the active model and try Show again.');
        // Endpoint foreground may arrive during a draw. Render that newest
        // complete payload after this draw, never concurrently with it.
        if (verifiedWorkflowPath.current?.path === path) return;
      }
    } catch {
      if (current()) { setPathDisplayed(false); setNotice('The checked route could not be displayed. Try Show again.'); }
    } finally {
      ticket.running = false;
      if (current()) setPreviewLoading(false);
    }
  }, []);
  const enrichWorkflowPath = useCallback((key: string, endpointIds: string[]) => {
    const checked = verifiedWorkflowPath.current;
    if (workflowLatest.current.key !== key || workflowScope.current !== key || checked?.key !== key) return;
    // Foreground can converge through either reader. A later empty/partial
    // lookup must never remove already verified objects from this exact path.
    const objectIds = computedPathObjectIds(checked.path.objectIds.map(id => `dbid:${id}`), endpointIds);
    if (!objectIds || objectIds.length === checked.path.objectIds.length && objectIds.every((id, index) => id === checked.path.objectIds[index])) return;
    verifiedWorkflowPath.current = { key, path: { ...checked.path, objectIds } };
    const ticket = workflowDraw.current;
    if (ticket?.key === key) void drawWorkflowPath(ticket);
  }, [drawWorkflowPath]);
  useEffect(() => {
    if (!displayReady || !workflowKey || workflowDisplayProof?.key !== workflowKey || !proposal || !data) return;
    const contexts = matchingEndpointForeground(endpointForegroundContexts, pf, accountId, proposal.cableId);
    if (contexts) enrichWorkflowPath(workflowKey, proposalEndpointObjectIdsFromContexts(proposal, data,
      { projectId: contexts.projectId, token: contexts.token }, contexts));
  }, [endpointForegroundContexts, displayReady, workflowKey, workflowDisplayProof, proposal, data, pf, accountId, enrichWorkflowPath]);
  useEffect(() => {
    const latest = displayRequestLatest.current;
    if (!workflowDisplayRequest || !latest.active || workflowDisplayRequest.cableId !== latest.selectedCableId
      || !Number.isSafeInteger(workflowDisplayRequest.requestId) || workflowDisplayRequest.requestId <= handledDisplayRequest.current) return;
    handledDisplayRequest.current = workflowDisplayRequest.requestId;
    if (workflowDisplayRequest.action === 'show') {
      // Show consumes the exact payload that made this button ready. Repeating
      // every geometry/proof GET here used to add another long loading cycle.
      // A changed result, model, settings or history owner cannot reuse it.
      const checked = verifiedWorkflowPath.current, current = workflowLatest.current;
      if (current.ready && checked?.key === current.key && workflowScope.current === current.key) {
        workflowHidden.current.hidden = false; workflowHidden.current.proposalKey = current.proposalKey; suppressedWorkflow.current = null;
        const atOperation = ++operation.current, currentDisplay = current.claimViewer?.() ?? (() => true);
        setReviewId(null); setApplied(false); setPreviewLoading(true);
        const ticket: WorkflowDraw = { key: checked.key, operation: atOperation, currentDisplay, showPath: current.pf.showPath, running: false };
        workflowDraw.current = ticket; void drawWorkflowPath(ticket);
        return;
      }
      // History selection clears workflowScope but retains suppression. A new
      // Show must schedule a read even when the selected result is unchanged.
      const retrySelected = workflowScope.current !== null || suppressedWorkflow.current !== null;
      workflowHidden.current.hidden = false; workflowHidden.current.proposalKey = workflowLatest.current.proposalKey; suppressedWorkflow.current = null;
      if (retrySelected) setWorkflowAttempt(value => value + 1);
      return;
    }
    workflowHidden.current.hidden = true;
    if (workflowScope.current === null) endpointRead.current?.abort();
    operation.current++;
    // Hide controls appearance; it does not abandon the selected result like
    // choosing history does. Later job progress must still refresh readiness.
    if (workflowScope.current !== null) {
      suppressedWorkflow.current = null;
      if (!workflowLatest.current.ready) setWorkflowAttempt(value => value + 1);
    }
    if (latest.displayOwned) latest.pf.clear();
    setPathDisplayed(false); setPreviewLoading(false);
  }, [workflowDisplayRequest, drawWorkflowPath]);
  useEffect(() => {
    const initial = workflowLatest.current, access = initial.pf.preparationAccess, target = initial.target;
    const displayRequested = workflowHidden.current.context === workflowDisplayContext && !workflowHidden.current.hidden
      && initial.proposalKey !== null && workflowHidden.current.proposalKey === initial.proposalKey;
    if (workflowIdentity.current !== null && suppressedWorkflow.current === workflowIdentity.current) return;
    if (!workflowKey || !target || !active || !accountId || !initial.pf.data || !access?.isAdmin || !access.projectId || access.projectId !== access.loadedProjectId || !access.token) {
      if (workflowScope.current) selectHistory(); return;
    }
    const projectId = access.projectId, token = access.token;
    workflowScope.current = workflowKey; setWorkflowScopeOwner(workflowKey);
    verifiedWorkflowPath.current = null;
    setWorkflowDisplayProof(null);
    setWorkflowProposalRead(null);
    setWorkflowCheck({ key: workflowKey, checking: true, message: 'Checking this cable’s calculated path for Show…' });
    adoptScope({ admissionId: null, jobId: target.calculation.jobId, ready: false, message: 'Checking the selected cable calculation…' }, true);
    if (observedWorkflowStop) {
      setPreviewLoading(false);
      const message = 'This calculation was cancelled or failed. Its saved path is preview only.';
      setNotice(message); setWorkflowCheck({ key: workflowKey, checking: false, message });
      return;
    }
    const atOperation = ++operation.current, currentDisplay = displayRequested ? initial.claimViewer?.() ?? (() => true) : () => true, controller = new AbortController();
    endpointRead.current = controller; setPreviewLoading(true);
    // Show/Hide and viewer ownership can change without changing the selected
    // immutable result. They fence drawing separately from result hydration.
    const current = () => !controller.signal.aborted && workflowScope.current === workflowKey && workflowLatest.current.key === workflowKey;
    let retryTimer: ReturnType<typeof setTimeout> | null = null, retryCount = 0;
    const deadlineTimer = setTimeout(() => {
      if (!current()) return;
      const message = 'The calculated path could not be checked within 30 seconds. Its saved result is retained. Refresh cable status to check it; no new calculation was submitted.';
      setWorkflowCheck({ key: workflowKey, checking: false, message }); setNotice(message); setPreviewLoading(false);
      if (retryTimer) clearTimeout(retryTimer);
      controller.abort();
    }, VERIFICATION_READ_WINDOW_MS);
    const stopCheck = (message: string) => {
      clearTimeout(deadlineTimer); setNotice(message); setWorkflowCheck({ key: workflowKey, checking: false, message });
    };
    const verify = async () => {
      retryTimer = null;
      const foreground = new AbortController();
      let routeVerified = false;
      let endpointAuthorityFailure: unknown = null;
      let settledEndpoints: PromiseSettledResult<string[]> | null = null;
      const revokeAuthority = () => {
        if (!current()) return;
        verifiedWorkflowPath.current = null; setWorkflowDisplayProof(null); setWorkflowProposalRead(null); setReviewId(null); setApplied(false);
        operation.current++; controller.abort();
        if (displayed.current.owned) initial.pf.clear();
        if (retryTimer) { clearTimeout(retryTimer); retryTimer = null; }
        setPathDisplayed(false); setPreviewLoading(false); initial.pf.refresh(); stopCheck('Current administrator access is required to inspect this cable result.');
      };
      setWorkflowProposalRead(null);
      try {
        // The acknowledged job already fixes its policy. Read its independent
        // details together, while older results still resolve their recorded
        // policy from the proposal before requesting the live cable evidence.
        const expectedPreferences = initial.expectedPreferences;
        const earlyPreferences = expectedPreferences ?? null;
        const reads = [
          initial.pf.readProposal(target.calculation.proposalId!, controller.signal), initial.pf.readJob(target.calculation.jobId!, controller.signal),
          earlyPreferences ? fetchPathFinderCableWorkflowDetail(projectId, token, target.cable.id, earlyPreferences, controller.signal) : Promise.resolve(null),
        ] as const;
        // Handle every rejection immediately, while letting the exact proposal
        // start its independent endpoint foreground before the live row arrives.
        const completedReads = Promise.allSettled(reads);
        const [proposalRead] = await Promise.allSettled([reads[0]]);
        if (!current()) return;
        if (proposalRead.status === 'rejected') throw proposalRead.reason;
        const detail = proposalRead.value;
        if (!current()) return;
        if (!detail) throw new Error('WORKFLOW_READ_UNAVAILABLE');
        if (detail.id !== target.calculation.proposalId || detail.proposalHash !== target.calculation.proposalHash || detail.projectId !== target.projectId
          || detail.cableId !== target.cable.id || detail.jobId !== target.calculation.jobId) throw new Error('WORKFLOW_PROPOSAL_SCOPE_CHANGED');
        const parsedEnvelope = revisionResultEnvelopeSchema.safeParse(detail.revisionResult), envelope = parsedEnvelope.success ? parsedEnvelope.data : null;
        if (detail.revisionResult && (!envelope || envelope.projectId !== detail.projectId || envelope.cableId !== detail.cableId || envelope.jobId !== detail.jobId
          || envelope.proposalId !== detail.id || envelope.proposalHash !== detail.proposalHash || envelope.revisionResultSha256 !== detail.revisionResultHash
          || envelope.baselineHash !== detail.revisionBaselineHash || envelope.dependencyHash !== detail.provenance?.dependencyHash)) throw new Error('WORKFLOW_RESULT_SCOPE_CHANGED');
        if (expectedPreferences && (!detail.routingPreferences || expectedPreferences.secondaryDistanceMeters !== detail.routingPreferences.secondaryDistanceMeters
          || expectedPreferences.preferVerticalApproach !== detail.routingPreferences.preferVerticalApproach
          || !sameBarrierAdmissionIntent(expectedPreferences.barrierRouting, detail.routingPreferences.barrierRouting))) throw new Error('WORKFLOW_CALCULATION_PREFERENCES_CHANGED');
        // Read this exact proposal under its original submitted policy. The
        // popup's next-calculation checkbox is never an approval policy change.
        // An existing result keeps its server-recorded policy even while the
        // next-calculation configuration is unavailable. Currentness is still
        // checked by the server; this read grants no Review/Apply authority.
        const preferences = detail.routingPreferences ?? initial.readPreferences;
        const readEndpointForeground = () => {
          const foregroundState = workflowLatest.current.pf.data;
          return Promise.allSettled([foregroundState && proposalDisplayModelCurrent(detail, foregroundState)
            ? proposalEndpointObjectIds(detail, foregroundState, { projectId, token }, AbortSignal.any([controller.signal, foreground.signal]),
              matchingEndpointForeground(workflowLatest.current.endpointForegroundContexts, workflowLatest.current.pf, accountId, detail.cableId))
            : Promise.resolve([] as string[])]).then(([result]) => {
            settledEndpoints = result;
            if (result.status === 'rejected') {
              const error = result.reason as { status?: unknown };
              if (error?.status === 401 || error?.status === 403) {
                endpointAuthorityFailure = result.reason;
                revokeAuthority();
              }
            }
            return result;
          });
        };
        const endpointResult = readEndpointForeground();
        const [, parentRead, earlyCableRead] = await completedReads;
        if (!current()) return;
        for (const read of [parentRead, earlyCableRead]) if (read.status === 'rejected') {
          const error = read.reason as { status?: unknown }; if (error?.status === 401 || error?.status === 403) throw read.reason;
        }
        const [cableRead] = earlyPreferences ? [earlyCableRead] : await Promise.allSettled([
          preferences ? fetchPathFinderCableWorkflowDetail(projectId, token, detail.cableId, preferences, controller.signal) : Promise.resolve(null),
        ]);
        if (!current()) return;
        if (cableRead.status === 'rejected') {
          const error = cableRead.reason as { status?: unknown }; if (error?.status === 401 || error?.status === 403) throw cableRead.reason;
          if (retryableVerificationRead(cableRead.reason)) throw cableRead.reason;
        }
        const parent = parentRead.status === 'fulfilled' && parentRead.value?.projectId === detail.projectId && parentRead.value.id === detail.jobId ? parentRead.value : null;
        if (!parent && !displayRequested) throw new Error('WORKFLOW_READ_UNAVAILABLE');
        const live = cableRead.status === 'fulfilled' ? cableRead.value : null;
        if (live && (live.projectId !== detail.projectId || live.cableId !== detail.cableId || live.row.projectId !== detail.projectId || live.row.cable.id !== detail.cableId))
          throw new Error('WORKFLOW_CURRENT_RESULT_CHANGED');
        if (live && (live.row.calculation.jobId !== detail.jobId || live.row.calculation.proposalId !== detail.id || live.row.calculation.proposalHash !== detail.proposalHash))
          throw verificationPending('The selected result and the current cable record have not converged. Checking this same result again…');
        if (live && globalWorkflowRevision && /^(0|[1-9][0-9]*)$/.test(globalWorkflowRevision)
          && BigInt(globalWorkflowRevision) > BigInt(live.row.cable.cableWriteRevision))
          throw verificationPending('The current cable record has not caught up with its saved revision. Checking this same result again…');
        const currentCalculatedItem = Boolean(live?.row.calculation.currentness === 'current' && live.row.calculation.itemState === 'complete'
          && live.row.calculation.outcome === 'calculated');
        const liveCurrent = Boolean(currentCalculatedItem && live?.row.calculation.reviewable && live.row.cable.cableWriteRevision === detail.cableWriteRevision);
        // The server binds acceptedMatchesCurrent to this exact job/proposal
        // tuple. Its own receipt may advance the cable revision; that permits
        // display of the accepted path without renewing Review/Apply authority.
        const acceptedDisplayCurrent = (() => {
          if (!live || !currentCalculatedItem || !live.row.calculation.acceptedMatchesCurrent || !detail.route?.success || !detail.design
            || live.row.cable.routing !== detail.route.routeText || live.row.cable.designLength === null) return false;
          try { return canonicalDecimalString(live.row.cable.designLength) === canonicalDecimalString(detail.design.designLengthMeters); } catch { return false; }
        })();
        const wholeJobReady = Boolean(envelope && parent?.status === 'complete' && !parent.cancelRequested && liveCurrent);
        const itemReady = Boolean(envelope && parent && ['queued', 'running'].includes(parent.status) && !parent.cancelRequested && liveCurrent
          && hasExactItemApplicability(detail, access.projectId));
        const acceptedDisplayReady = Boolean(envelope && acceptedDisplayCurrent && parent && !parent.cancelRequested
          && ['complete', 'queued', 'running'].includes(parent.status));
        // A separate server proof permits inspection of the already saved exact
        // geometry after an implementation update. It never renews currentness,
        // calculation scope, Review or Apply authority.
        const savedExactDisplayReady = Boolean(envelope && live?.row.calculation.savedExactDisplay === true
          && live.row.calculation.itemState === 'complete' && live.row.calculation.outcome === 'calculated'
          && live.row.calculation.jobStatus === 'complete' && parent?.status === 'complete' && !parent.cancelRequested
          && detail.route?.success && detail.design && live.row.cable.routing === detail.route.routeText
          && live.row.cable.designLength !== null && (() => {
            try { return canonicalDecimalString(live.row.cable.designLength) === canonicalDecimalString(detail.design.designLengthMeters); } catch { return false; }
          })());
        const issue = !envelope ? 'This historical path has no verifiable calculation admission. It is preview only; use Cable revision results or calculate a fresh proposal before Review and Apply.'
          : !parent ? 'The exact calculation state is unavailable. This path is preview only; reopen the selected cable result to check again.'
            : parent.cancelRequested || ['cancelled', 'failed'].includes(parent.status) ? 'This calculation was cancelled or failed. Its saved path is preview only.'
              : savedExactDisplayReady ? 'The saved route is ready to show. Calculate routing to review a new result.'
                : !liveCurrent ? 'The current cable proof is unavailable or changed. This path is preview only; refresh the cable list and calculate again when needed.'
                : !wholeJobReady && !itemReady ? 'This calculation is still running and this cable has no current sealed item. Review is blocked until it is ready.' : null;
        const selectedScope: PathFinderCalculationScope = { admissionId: envelope?.admissionId ?? null, jobId: detail.jobId, ready: wholeJobReady || itemReady,
          wholeJobReady, jobStatus: parent?.status ?? null, cancelRequested: parent?.cancelRequested ?? false, message: issue };
        scope.current = selectedScope; setScopeReadiness(selectedScope); setProposal(detail); setNotice(issue);
        const latest = workflowLatest.current, observedRevision = latest.pf.data?.cables.find(value => value.id === detail.cableId)?.cableWriteRevision;
        const comparisonOwner = JSON.stringify([...latest.comparisonBase, selectedScope.admissionId, selectedScope.jobId]);
        const input = live ? cableComparisonInputSchema.safeParse({ projectId: detail.projectId, cableId: detail.cableId,
          current: { source: 'live-cable-read', contextSha256: live.contextSha256, mto: live.row.mto, cable: live.row.cable },
          proposal: { projectId: detail.projectId, cableId: detail.cableId, proposalId: detail.id, proposalHash: detail.proposalHash,
            revisionResultHash: detail.revisionResultHash ?? null, cableWriteRevision: detail.cableWriteRevision,
            routing: detail.route?.routeText ?? null, designLength: detail.design?.designLengthMeters ?? null } }) : null;
        setComparison({ owner: comparisonOwner, proposalId: detail.id, proposalHash: detail.proposalHash, revisionResultHash: detail.revisionResultHash ?? null,
          observedRevision, loading: false, input: input?.success ? input.data : null, error: input?.success ? null : 'Live cable comparison is unavailable. Reopen this selected result to check again.',
          acceptedRow: live && currentAcceptedDisplayRow(detail, live.row) ? live.row : null });
        // Route geometry has its own exact calculation evidence. Optional
        // equipment highlighting must not delay a drawable checked route.
        if (!live || !savedExactDisplayReady && (!currentCalculatedItem || (!liveCurrent && !acceptedDisplayReady))) {
          if (envelope && parent && !parent.cancelRequested && !['failed', 'cancelled'].includes(parent.status) && !detail.compatibilityIssue
            && (!live || live.row.calculation.currentness === 'unavailable' || ['waiting', 'running'].includes(live.row.calculation.itemState ?? '')
              || ['pending', 'running', 'unknown'].includes(live.row.calculation.automaticUpdate?.status ?? '')))
            throw verificationPending('The calculated path is saved, but its current cable proof is still becoming available. Checking again automatically…');
          stopCheck(issue ?? 'This calculated path has no current display proof. Refresh cable status to check its saved result.'); return;
        }
        if (!proposalDisplayModelCurrent(detail, latest.pf.data)) {
          stopCheck('The model preparation for this result is still refreshing. Refresh cable status before showing its path.'); return;
        }
        if (!detail.route?.success || !detail.route.points.length) { if (displayRequested) initial.pf.clear(); stopCheck('This proposal has no drawable path. Its diagnostic is shown below.'); return; }
        if (detail.route.points.length > MAX_PATH_POINTS) { stopCheck('This exact path exceeds the viewer point budget. The result is retained without truncation.'); return; }
        if (!(((wholeJobReady || itemReady) && !detail.stale || acceptedDisplayReady || savedExactDisplayReady) && !detail.compatibilityIssue)) {
          stopCheck(detail.compatibilityIssue ?? issue ?? 'This calculated path is no longer current. Calculate routing to create a current result.'); return;
        }
        const routeObjectIds = computedPathObjectIds(detail.route.objectIds, []);
        if (!routeObjectIds) { stopCheck('This exact path exceeds the viewer object budget. The result is retained without truncation.'); return; }
        if (endpointAuthorityFailure !== null) throw endpointAuthorityFailure;
        const displaySource = currentCalculatedItem && (liveCurrent || acceptedDisplayReady) ? 'current-calculation' : 'saved-exact';
        const availableEndpoints = settledEndpoints as PromiseSettledResult<string[]> | null;
        const knownContexts = matchingEndpointForeground(latest.endpointForegroundContexts, latest.pf, accountId, detail.cableId);
        const knownEndpoints = knownContexts && latest.pf.data
          ? proposalEndpointObjectIdsFromContexts(detail, latest.pf.data, { projectId, token }, knownContexts) : [];
        const initialObjectIds = computedPathObjectIds(detail.route.objectIds,
          [...knownEndpoints, ...(availableEndpoints?.status === 'fulfilled' ? availableEndpoints.value : [])]) ?? routeObjectIds;
        verifiedWorkflowPath.current = { key: workflowKey, path: { pathId: detail.id, points: detail.route.points, objectIds: initialObjectIds } };
        setWorkflowProposalRead({ key: workflowKey, proposalId: detail.id, proposalHash: detail.proposalHash, row: live.row,
          scope: pathFinderWorkflowDisplayScope(latest.pf, accountId ?? null), source: displaySource });
        setWorkflowDisplayProof({ key: workflowKey, proposalId: detail.id, proposalHash: detail.proposalHash, accepted: acceptedDisplayReady, source: displaySource });
        routeVerified = true;
        clearTimeout(deadlineTimer); setWorkflowCheck(null);
        if (operation.current === atOperation) setPreviewLoading(false);
        if (displayRequested && currentDisplay()) {
          const ticket: WorkflowDraw = { key: workflowKey, operation: atOperation, currentDisplay, showPath: initial.pf.showPath, running: false };
          workflowDraw.current = ticket; setPreviewLoading(true); void drawWorkflowPath(ticket);
        }
        let endpointIds = await endpointResult;
        // The live route proof can briefly hold the same project row lock as
        // these reads. Retry only optional foreground after that proof settles.
        for (const delay of ENDPOINT_FOREGROUND_RETRY_DELAYS) {
          if (!current()) return;
          if (endpointIds.status === 'fulfilled' || !retryableVerificationRead(endpointIds.reason)) break;
          if (!await waitForEndpointForegroundRetry(delay, controller.signal) || !current()) return;
          endpointIds = await readEndpointForeground();
        }
        if (!current()) return;
        if (endpointIds.status === 'rejected') {
          const error = endpointIds.reason as { status?: unknown };
          if (error?.status === 401 || error?.status === 403) throw endpointIds.reason;
          return;
        }
        enrichWorkflowPath(workflowKey, endpointIds.value);
      } catch (error) {
        if (!current()) return;
        if (!routeVerified && retryableVerificationRead(error) && retryCount < VERIFICATION_RETRY_DELAYS.length) {
          const message = 'The route check was temporarily unavailable. Retrying the exact result automatically…';
          setNotice(message); setWorkflowCheck({ key: workflowKey, checking: true, message });
          retryTimer = setTimeout(() => { if (current()) void verify(); }, VERIFICATION_RETRY_DELAYS[retryCount++]);
          return;
        }
        const status = error && typeof error === 'object' && 'status' in error ? error.status : null;
        if (status === 401 || status === 403) revokeAuthority();
        else stopCheck(routeVerified ? 'The checked route could not be displayed. Try Show again.'
          : retryableVerificationRead(error)
            ? 'The calculated path could not be checked after bounded automatic retries. Its saved result is retained. Refresh cable status to check it; no new calculation was submitted.'
            : 'The selected cable calculation changed or could not be verified. Refresh the cable list and open the result again.');
      } finally {
        foreground.abort();
        if (!retryTimer) {
          if (endpointRead.current === controller) endpointRead.current = null;
          const drawing = workflowDraw.current;
          if (operation.current === atOperation && !(drawing?.key === workflowKey && drawing.operation === atOperation && drawing.running)) setPreviewLoading(false);
        }
      }
    };
    void verify();
    return () => { clearTimeout(deadlineTimer); if (retryTimer) clearTimeout(retryTimer); controller.abort(); operation.current++; };
  }, [workflowKey, workflowDisplayContext, observedWorkflowStop, active, accountId, adoptScope, selectHistory, drawWorkflowPath, enrichWorkflowPath]);
  const confirmReview = async () => {
    if (reviewTicket.current || !active || !displayOwned || !proposal || !pathDisplayed || !effectiveCanApply || stale || pf.busy || !pendingApply.canStart) return;
    const current = operation.current, context = reviewContext.current, target = proposal;
    const ticket = {}; reviewTicket.current = ticket; setReviewBusy(true);
    try {
      const reviewed = await pf.reviewProposal(target);
      if (!reviewed || operation.current !== current || reviewContext.current !== context || reviewed.proposal.id !== target.id || reviewed.proposal.proposalHash !== target.proposalHash) return;
      setProposal(reviewed.proposal); setReviewId(reviewed.reviewId); setNotice('Review confirmed for this immutable proposal.');
    } catch {
      if (operation.current === current && reviewContext.current === context) setNotice('Review was not confirmed. Refresh this exact proposal before trying again. No Apply was sent.');
    } finally {
      if (reviewTicket.current === ticket) { reviewTicket.current = null; setReviewBusy(false); }
    }
  };
  const apply = async () => {
    if (!active || !displayOwned || !proposal || !reviewId || !effectiveCanApply || stale || !pendingApply.canStart || pf.busy) return;
    const current = operation.current;
    const confirmed = await pendingApply.start({ proposalId: proposal.id, proposalHash: proposal.proposalHash, cableId: proposal.cableId,
      reviewId, expectedCableWriteRevision: proposal.cableWriteRevision, revisionResultHash: proposal.revisionResultHash ?? null });
    if (confirmed) { if (operation.current === current) setApplied(true); confirmedCableWrite(); }
  };
  const summary = data?.proposals.find(value => value.id === proposal?.id), stale = proposal?.stale || summary?.stale || false;
  const acknowledgedWorkflow = Boolean(workflowScopeOwner && proposal && workflowCalculationPreferences?.cableId === proposal.cableId
    && workflowCalculationPreferences.jobId === proposal.jobId);
  const resultPreferences = workflowScopeOwner && proposal
    ? workflowConfigurationAvailable && (options !== null || acknowledgedWorkflow) ? proposal.routingPreferences : null
    : options;
  const preferencesMatch = resultPreferences === undefined || Boolean(resultPreferences && proposal?.routingPreferences && resultPreferences.secondaryDistanceMeters === proposal.routingPreferences.secondaryDistanceMeters && resultPreferences.preferVerticalApproach === proposal.routingPreferences.preferVerticalApproach
    && sameBarrierAdmissionIntent(resultPreferences.barrierRouting, proposal.routingPreferences.barrierRouting));
  const proposalJob = data?.jobs.find(value => value.id === proposal?.jobId);
  const checkedJobStatus = workflowScopeOwner ? scopeReadiness.jobStatus : proposalJob?.status ?? scopeReadiness.jobStatus;
  const calculationCancelled = Boolean(proposalJob?.cancelRequested || scopeReadiness.cancelRequested || checkedJobStatus === 'cancelled' || scopeReadiness.jobStatus === 'cancelled');
  const calculationFailed = proposalJob?.status === 'failed' || scopeReadiness.jobStatus === 'failed';
  const wholeJobReady = scopeReadiness.wholeJobReady ?? scopeReadiness.ready;
  const sealedItemReady = ['queued', 'running'].includes(checkedJobStatus ?? '') && hasExactItemApplicability(proposal, pf.preparationAccess?.projectId);
  const comparisonMatchesProposal = comparison?.owner === comparisonOwner && comparison.proposalId === proposal?.id && comparison.proposalHash === proposal?.proposalHash
    && comparison.revisionResultHash === (proposal?.revisionResultHash ?? null);
  const knownLiveRevisionMismatch = Boolean(comparisonMatchesProposal && comparison?.input
    && comparison.input.current.cable.cableWriteRevision !== proposal?.cableWriteRevision);
  const ownedComparison = comparisonMatchesProposal && comparison?.observedRevision === selectedRevision ? comparison : null;
  const comparisonReady = Boolean(ownedComparison?.input && !ownedComparison.loading && !ownedComparison.error);
  const protectedResult = Boolean(proposal?.provenance?.dependencyVersion === 'pathfinder.dependencies.v8'
    && (proposal.barriers?.schemaVersion === 'wfc.pf.barrier-execution.v1'
      || proposal.barriers?.schemaVersion === 'wfc.pf.barrier-execution.v2'
      && proposal.provenance.engineIdentity?.schemaVersion === 'wfc.pf.engine-identity.v3'
      && proposal.routingPreferences?.barrierRouting?.schemaVersion === 'wfc.pf.barrier-admission-intent.v2')
    && ['clear', 'bypassed', 'no-barriers-declared'].includes(proposal.barriers.diagnostics.status));
  const savedCurrentResult = Boolean(active && comparisonReady && protectedResult && preferencesMatch && proposal && !calculationCancelled && !calculationFailed
    && scopeReadiness.jobStatus === 'complete' && scopeReadiness.admissionId === proposal.revisionResult?.admissionId
    && proposal.jobId === scopeReadiness.jobId && proposalDisplayModelCurrent(proposal, data)
    && currentAcceptedDisplayRow(proposal, ownedComparison?.acceptedRow));
  const displayStale = stale && !savedCurrentResult;
  const effectiveCanApply = Boolean(!savedCurrentResult && comparisonReady && protectedResult && proposal && proposal.status === 'calculated' && scopeReadiness.admissionId && proposal.jobId === scopeReadiness.jobId && !calculationCancelled
    && (!workflowScopeOwner || scopeReadiness.ready)
    && !calculationFailed && !knownLiveRevisionMismatch && (wholeJobReady && (!checkedJobStatus || checkedJobStatus === 'complete') || sealedItemReady) && preferencesMatch && !stale && !proposal.compatibilityIssue
    && proposal.canApply && !(summary && summary.proposalHash === proposal.proposalHash && !summary.canApply));
  const projectionCallback = useRef(onCalculationCommitted); projectionCallback.current = onCalculationCommitted;
  const lastProjection = useRef('');
  const completedSelectedItem = Boolean(active && accountId && selectedCableId && proposal?.cableId === selectedCableId && protectedResult
    && (proposal?.provenance?.engineIdentity?.schemaVersion === 'wfc.pf.engine-identity.v2' && proposal.barriers?.schemaVersion === 'wfc.pf.barrier-execution.v1'
      || proposal?.provenance?.engineIdentity?.schemaVersion === 'wfc.pf.engine-identity.v3' && proposal.barriers?.schemaVersion === 'wfc.pf.barrier-execution.v2')
    && proposal.status === 'calculated' && proposal.route?.success && proposal.design && proposal.revisionResultHash
    && scopeReadiness.admissionId && proposal.jobId === scopeReadiness.jobId && (!workflowScopeOwner || scopeReadiness.ready) && !calculationCancelled && !calculationFailed
    && !stale && !proposal.compatibilityIssue && preferencesMatch && (wholeJobReady && (!checkedJobStatus || checkedJobStatus === 'complete') || sealedItemReady));
  const projectionIdentity = completedSelectedItem && proposal?.provenance ? JSON.stringify([ownershipKey, proposal.projectId, proposal.cableId, proposal.jobId,
    proposal.id, proposal.proposalHash, proposal.revisionResultHash, proposal.provenance.dependencyHash]) : null;
  useEffect(() => {
    if (!projectionIdentity || !proposal?.provenance || lastProjection.current === projectionIdentity) return;
    lastProjection.current = projectionIdentity;
    projectionCallback.current?.({ projectId: proposal.projectId, cableId: proposal.cableId, jobId: proposal.jobId, proposalId: proposal.id,
      proposalHash: proposal.proposalHash, revisionResultHash: proposal.revisionResultHash!, dependencyHash: proposal.provenance.dependencyHash });
    // An exact item identity, not job progress or presentation state, requests
    // one ordinary read. The separate write gates remain untouched.
  }, [projectionIdentity, proposal]);
  const proposalJobIssue = !proposal || effectiveCanApply || savedCurrentResult ? null : calculationCancelled
    ? 'This calculation was cancelled. Its saved path can be inspected, but cannot be reviewed or applied. Choose a completed calculation in Cable revision results, or calculate non-MV cables again if needed.'
    : calculationFailed ? 'This calculation failed. Its saved path can be inspected, but cannot be reviewed or applied. Calculate again before reviewing the result.'
    : checkedJobStatus && checkedJobStatus !== 'complete'
      ? `This calculation is ${checkedJobStatus}. Review and Apply require a completed calculation or this cable's individually sealed, current result. Calculate again after a failed job, or wait for the current job to finish.`
      : !proposalJob && !scopeReadiness.ready ? 'This calculation is outside the recent job list. Its current state could not be confirmed here. Check the calculation state in Cable revision results below.' : null;
  const nonMvCableIds = (data?.cables ?? []).filter(value => ['LV', 'Control', 'Instrumentation'].includes(value.mto ?? '')).map(value => value.id);
  const selectedCable = data?.cables.find(value => value.id === selectedCableId);
  const selectedCategoryAllowed = Boolean(selectedCable && ['LV', 'Control', 'Instrumentation'].includes(selectedCable.mto ?? ''));
  reviewContext.current = JSON.stringify([ownershipKey, active, displayOwned, selectedCableId, scopeReadiness.admissionId, scopeReadiness.jobId, data?.activeModel, data?.registryRevision, settingsKey, optionsKey, selectedRevision, proposal?.id, proposal?.proposalHash, proposal?.revisionResultHash, stale, effectiveCanApply]);
  const canConfirmReview = Boolean(active && displayOwned && !reviewBusy && !pf.busy && !batch.busy && !previewLoading && !stale && pathDisplayed && effectiveCanApply && !reviewId && pendingApply.canStart);
  const canApplyReviewed = Boolean(active && displayOwned && !reviewBusy && !pf.busy && !batch.busy && !stale && reviewId && effectiveCanApply && !applied && pendingApply.canStart);
  const reviewOwner = JSON.stringify([reviewContext.current, reviewId, pathDisplayed, applied, previewLoading, pf.busy, batch.busy,
    pendingApply.pending?.idempotencyKey, pendingApply.canRetry, pendingApply.busy, reviewBusy]);
  const reviewActions = useRef({ owner: reviewOwner, review: confirmReview, apply,
    retry: () => pendingApply.retry().then(confirmed => { if (confirmed) confirmedCableWrite(); }),
    closePending: () => { closeHadReceipt.current = false; return pendingApply.close().then(confirmed => {
      if (confirmed) { setReviewId(null); if (closeHadReceipt.current) confirmedCableWrite(); }
    }); } });
  reviewActions.current = { owner: reviewOwner, review: confirmReview, apply,
    retry: () => pendingApply.retry().then(confirmed => { if (confirmed) confirmedCableWrite(); }),
    closePending: () => { closeHadReceipt.current = false; return pendingApply.close().then(confirmed => {
      if (confirmed) { setReviewId(null); if (closeHadReceipt.current) confirmedCableWrite(); }
    }); } };
  const selectedProposal = proposal?.cableId === selectedCableId ? proposal : null;
  const acceptedDisplayedResult = displayReady && workflowDisplayProof?.accepted;
  const popupMessage = !selectedProposal ? previewLoading ? 'Reading this cable’s exact calculation…' : notice ?? 'Calculate routing or refresh this cable to inspect its exact result.'
    : !protectedResult ? 'This historical or unchecked result needs a fresh calculation with the current barrier settings.'
      : !preferencesMatch ? 'The barrier settings or routing preferences changed. Calculate again.'
        : previewLoading ? 'Reading this cable’s exact calculation and From/To display objects…'
          : acceptedDisplayedResult || savedCurrentResult ? 'This exact routing is already saved in Cable list. Use Show to inspect it; another Apply is not needed.'
            : stale ? 'This result is outdated. Calculate routing again.'
              : proposalJobIssue ?? notice ?? (!pathDisplayed ? 'Use Show to inspect the exact path before confirming review.' : null);
  const popupComparison = selectedProposal ? ownedComparison?.input ?? null : null;
  const popupComparisonLoading = Boolean(previewLoading && !selectedProposal || selectedProposal && ownedComparison?.loading);
  const popupComparisonError = selectedProposal ? ownedComparison?.error ?? null : null;
  const pendingForCable = Boolean(selectedCableId && pendingApply.pending?.cableId === selectedCableId);
  const workflowReview = useMemo<PathFinderWorkflowReview | null>(() => selectedCableId ? {
    cableId: selectedCableId, proposalId: selectedProposal?.id ?? null, comparison: popupComparison,
    comparisonLoading: popupComparisonLoading, comparisonError: popupComparisonError, message: popupMessage,
    reviewed: Boolean(selectedProposal && reviewId), applied: Boolean(selectedProposal && applied),
    recordedDrillThroughWalls: selectedProposal?.routingPreferences?.barrierRouting?.drillThroughWalls ?? null,
    canReview: Boolean(selectedProposal && canConfirmReview), canApply: Boolean(selectedProposal && canApplyReviewed),
    busy: Boolean(reviewBusy || pf.busy || batch.busy || previewLoading || pendingApply.busy), pending: pendingForCable,
    canRecover: Boolean(pendingForCable && active && !pf.busy && pendingApply.canRetry),
    recoveryMessage: pendingApply.message, recoveryError: pendingApply.error,
    ...Object.fromEntries((['review', 'apply', 'retry', 'closePending'] as const).map(action => [action, () => {
      if (reviewActions.current.owner === reviewOwner) void reviewActions.current[action]();
    }])) as Pick<PathFinderWorkflowReview, 'review' | 'apply' | 'retry' | 'closePending'>,
  } : null, [selectedCableId, selectedProposal?.id, popupComparison, popupComparisonLoading, popupComparisonError, popupMessage,
    reviewId, applied, selectedProposal?.routingPreferences?.barrierRouting?.drillThroughWalls, canConfirmReview, canApplyReviewed, pf.busy, batch.busy, previewLoading, pendingApply.busy, pendingForCable,
    active, pendingApply.canRetry, pendingApply.message, pendingApply.error, reviewOwner, reviewBusy]);
  useEffect(() => { onWorkflowReviewChange?.(workflowReview); }, [onWorkflowReviewChange, workflowReview]);
  useEffect(() => () => { onWorkflowReviewChange?.(null); }, [onWorkflowReviewChange]);
  const proposals = (data?.proposals ?? []).filter(value => scopeReadiness.jobId !== null && value.jobId === scopeReadiness.jobId && (!selectedCableId || value.cableId === selectedCableId));
  return <section className={styles.result} aria-label="Path Finder calculations">
    <h3>Calculate and review</h3>
    <Body1>Calculate proposals manually or explicitly enable automatic recalculation.</Body1>
    {pendingApply.pending ? <section aria-label="Pending Apply reconciliation" className={styles.result}>
      <h4>Pending Apply</h4>
      <Body1>The exact Apply command is retained for this account and project. Its outcome must be confirmed before another proposal can be reviewed or applied.</Body1>
      <Caption1>Proposal {pendingApply.pending.proposalId}; original cable revision {pendingApply.pending.expectedCableWriteRevision}. Current model or cable changes do not replace this command.</Caption1>
      <Button disabled={!pendingApply.canRetry || pf.busy} onClick={() => void pendingApply.retry().then(confirmed => { if (confirmed) confirmedCableWrite(); })}>Retry pending Apply</Button>
      <Button disabled={!pendingApply.canRetry || pf.busy} onClick={() => { closeHadReceipt.current = false; void pendingApply.close().then(confirmed => {
        if (confirmed) { setReviewId(null); if (closeHadReceipt.current) confirmedCableWrite(); }
      }); }}>Close pending request</Button>
      <Caption1>Closing reconciles an existing Apply receipt or records that this exact request cannot apply later. It does not apply a replacement result.</Caption1>
    </section> : null}
    {pendingApply.busy ? <Spinner size="tiny" label="Reconciling the exact Apply command…" /> : null}
    {pendingApply.error ? <Body1 role="alert">{pendingApply.error}</Body1> : null}
    {pendingApply.message ? <Body1 role="status">{pendingApply.message}</Body1> : null}
    {pf.preparationAccess ? <PathFinderRecalculationPanel {...pf.preparationAccess} accountId={accountId ?? null} active={active} preferences={backgroundOptions !== undefined ? backgroundOptions : options}
      contextKey={JSON.stringify([data?.activeModel, pf.preparationViewerGeneration, options])}
      onChanged={pf.refresh} onAuthorityLost={pf.cancelOperation} /> : null}
    <PathFinderBatchReview batch={batch} disabled={pf.busy || !active || !pendingApply.canStart || !historyReadiness.ready}
      disabledReason={!active ? 'Open Path with current administrator access to review results.' : !pendingApply.canStart ? 'Reconcile any pending Apply request before reviewing another result.' : historyReadiness.message} />
    {pf.preparationAccess ? <PathFinderRevisionResults {...pf.preparationAccess} accountId={accountId??null} active={active && Boolean(data)} busy={pf.busy || batch.busy}
      contextKey={JSON.stringify([data?.activeModel, data?.registryRevision, settingsKey, optionsKey])}
      onAuthorityLost={pf.cancelOperation} onOpenProposal={openProposal} batch={batch} cables={data?.cables ?? []} jobs={data?.jobs ?? []}
      readJob={pf.readJob} onScopeReadinessChange={receiveScope} onHistorySelection={selectHistory} /> : null}
    {workflowTarget ? <Button disabled={!active || previewLoading || pf.busy || batch.busy} onClick={() => {
      workflowHidden.current.hidden = false; workflowHidden.current.proposalKey = workflowProposalKey; suppressedWorkflow.current = null; setWorkflowAttempt(value => value + 1);
    }}>Reopen selected cable result</Button> : null}
    <Caption1>Calculations use the active model, shared locations, connection gap and allowances from Project Details. Instrumentation follows Control.</Caption1>
    <div className={styles.actions}>
      <Button disabled={options === null || !data?.artifacts.length || pf.busy || !nonMvCableIds.length || nonMvCableIds.length > 10000} onClick={() => void (options ? pf.calculate(nonMvCableIds, true, options) : pf.calculate(nonMvCableIds, true))}>Calculate non-MV cables</Button>
      <Button disabled={options === null || !data?.artifacts.length || pf.busy || !selectedCableId || !selectedCategoryAllowed} onClick={() => void (options ? pf.calculate([selectedCableId!], true, options) : pf.calculate([selectedCableId!], true))}>Calculate selected cable</Button>
    </div>
    <Caption1>Manual calculation includes LV, Control and Instrumentation only. MV and unknown categories are excluded. For cancelled results, choose a completed calculation or calculate non-MV cables again if needed.</Caption1>
    {pf.busy ? <Spinner size="tiny" label="Saving or checking Path Finder data…" /> : null}
    {previewLoading ? <Spinner size="tiny" label="Loading the exact computed path…" /> : null}
    {notice ? <Body1 role="status">{notice}</Body1> : null}
    <details open={Boolean(data?.jobs.length)}><summary>Calculation jobs</summary>
      {(data?.jobs ?? []).slice(0, 5).map(item => <div key={item.id} className={styles.result} data-testid="pathfinder-job" data-state={item.status}>
        <Body1>{item.kind === 'lookup' ? 'Ordered lookup — ' : item.kind === 'preview' ? 'Standalone path — ' : ''}{item.status === 'running' || item.status === 'queued' ? 'Calculating' : item.status === 'complete' ? 'Complete' : item.status === 'cancelled' ? 'Cancelled' : 'Failed'}: {item.completed} / {item.total}{item.kind === 'lookup' || item.kind === 'preview' ? ' result' : ' cables'}</Body1>
        {item.cancelRequested && item.status !== 'cancelled' ? <Caption1>Cancellation requested; waiting for the calculation to stop.</Caption1> : null}
        {item.failure ? <Caption1>{item.failure}</Caption1> : null}
        <div className={styles.actions}><Button disabled={pf.busy} onClick={() => void pf.readJob(item.id).then(result => { if (result) setJob(result); })}>Job details</Button>
          {['queued', 'running'].includes(item.status) ? <Button disabled={pf.busy || item.cancelRequested} onClick={() => void pf.action(`/jobs/${item.id}`, undefined, 'DELETE')}>Cancel job</Button> : null}</div>
      </div>)}
      {job?.items ? <><Caption1>Calculation and Cable list saving are separate. The update status below belongs to this exact calculation.</Caption1>
        <ul aria-label="Calculation outcomes">{job.items.map(item => <li key={item.cableId}>{data?.cables.find(cable => cable.id === item.cableId)?.tag ?? 'Cable'}: {item.status === 'calculated' ? 'Route calculated' : resultLabel(item.status)}{item.message ? ` — ${item.message}` : ''}
          {item.automaticUpdate || item.status === 'calculated' ? <span> — {pathFinderJobOutputLabel(item.automaticUpdate)}</span> : null}</li>)}</ul></> : null}
    </details>
    <ul className={styles.cableList} aria-label="Path Finder proposals">
      {proposals.slice(0, 5).map(item => <li key={item.id}><Button disabled={pf.busy || batch.busy || previewLoading} aria-pressed={proposal?.id === item.id} onClick={() => void openProposal(item.id, item.jobId)}>
        {data?.cables.find(cable => cable.id === item.cableId)?.tag ?? 'Cable'} — {savedCurrentResult && item.id === proposal?.id && item.proposalHash === proposal.proposalHash ? 'Saved in Cable list' : item.stale ? 'Outdated' : item.status === 'calculated' && !item.canApply ? 'Review blocked' : resultLabel(item.status)}{item.synthetic ? ' — local synthetic fixture' : ''}
      </Button></li>)}
    </ul>
    <Caption1>{proposals.length ? 'Recent proposals from the selected calculation are shown here.' : 'Use Inspect, then Open exact proposal in Viewer in the selected calculation above.'} Cable revision results contains every cable in that calculation, with pages of up to 100.</Caption1>
    {proposal ? <section className={styles.result} aria-label="Proposal review" data-testid="pathfinder-proposal" data-stale={String(displayStale)}>
      <h4>{savedCurrentResult ? 'Saved in Cable list' : 'Proposal review'}</h4>
      <Body1>Cable: {data?.cables.find(cable => cable.id === proposal.cableId)?.tag ?? proposal.cableId}</Body1>
      <Body1>{savedCurrentResult ? 'This exact route and design length are already saved. No Review or Apply is needed.' : proposal.synthetic ? 'Local synthetic fixture for demonstration.' : 'Review the route and length before applying.'}</Body1>
      {displayStale ? <Body1 role="alert">This result is outdated. Calculate a new proposal before reviewing or applying it.</Body1> : null}
      {!savedCurrentResult ? <Body1>{proposal.message}</Body1> : null}
      {!protectedResult ? <Body1 role="alert">This historical or unchecked result can be inspected, but cannot receive a new review or Apply. Calculate a fresh route with the current barrier settings.</Body1> : null}
      {ownedComparison?.loading ? <Caption1 role="status">Reading live cable values for comparison…</Caption1> : null}
      {ownedComparison?.error ? <Body1 role="status">{ownedComparison.error}</Body1> : null}
      {savedCurrentResult && ownedComparison?.input ? <section aria-label="Saved cable values"><h5>Saved cable values</h5>
        <p>Design length: {ownedComparison.input.current.cable.designLength} m</p>
        <p style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{ownedComparison.input.current.cable.routing}</p>
      </section> : !ownedComparison?.loading ? <PathFinderCableComparison input={ownedComparison?.input ?? null} /> : null}
      {proposalJobIssue ? <Body1 role="alert">{proposalJobIssue}</Body1> : null}
      {proposal.routingPreferences ? <Caption1>Calculated with SECONDARY trigger {proposal.routingPreferences.secondaryDistanceMeters} m; vertical approach {proposal.routingPreferences.preferVerticalApproach ? 'preferred' : 'not preferred'}.</Caption1> : <Caption1>The original routing preferences are unavailable.</Caption1>}
      {options !== null && !preferencesMatch ? <Body1 role="alert">This proposal uses different routing preferences. Calculate a new proposal with the current Path values before reviewing or applying.</Body1> : null}
      {proposal.compatibilityIssue ? <Body1 role="alert">{proposal.compatibilityIssue}</Body1> : null}
      <Caption1>Calculation mode: {proposal.calculationMode === 'design' ? 'Design length only; verified route reused' : proposal.calculationMode === 'calculate' ? 'Full route calculation' : 'Unavailable for this historical result'}.</Caption1>
      {proposal.provenance ? <details style={{ minWidth: 0, overflowWrap: 'anywhere' }}><summary>Calculation provenance</summary>
        <Caption1>Dependency version: {proposal.provenance.dependencyVersion}; digest: {proposal.provenance.dependencyHash}.</Caption1>
        <Caption1>Recorded engine digest: {proposal.provenance.engineIdentity?.contentSha256 ?? 'Unavailable for this historical result'}.</Caption1>
        {['pathfinder.dependencies.v7','pathfinder.dependencies.v8'].includes(proposal.provenance.dependencyVersion) ? <Caption1>Shared location calculation. {hasExactItemApplicability(proposal, pf.preparationAccess?.projectId) ? 'An individually sealed cable result is recorded.' : 'Individual applicability is not confirmed.'} Human review and current server checks are still required.</Caption1>
          : proposal.provenance.automatic ? <Caption1>Automatic generation: {proposal.provenance.automatic.generation}; authority epoch: {proposal.provenance.automatic.authorityEpoch}; {proposal.provenance.automatic.current ? 'current' : 'no longer current'}{proposal.provenance.automatic.reasonCode ? ` — ${proposal.provenance.automatic.reasonCode.toLowerCase().replaceAll('_', ' ')}` : ''}.</Caption1> : <Caption1>No durable automatic enrollment recorded.</Caption1>}
        <Caption1>These recorded facts do not replace human review or grant Apply authority.</Caption1>
      </details> : <Caption1>Calculation provenance is unavailable for this historical result.</Caption1>}
      {proposal.route ? <><Body1>Geometric length: {proposal.route.lengthMeters} m</Body1><Caption1>From approach: {proposal.route.fromDistanceMeters} m{proposal.route.fromRequiresSecondary ? ' (SECONDARY)' : ''}; To approach: {proposal.route.toDistanceMeters} m{proposal.route.toRequiresSecondary ? ' (SECONDARY)' : ''}</Caption1><Caption1>Connection gaps: {proposal.route.connectionGapCount}; total gap length: {proposal.route.connectionGapLengthMeters} m</Caption1><details><summary>Exact route text</summary><p style={{ overflowWrap: 'anywhere' }}>{proposal.route.routeText}</p></details></> : null}
      {proposal.design ? <><Body1>Before percentage: {proposal.design.lengthBeforePercentageMeters} m</Body1><Caption1>Before rounding: {proposal.design.unroundedLengthMeters} m</Caption1><Body1>Design length: {proposal.design.designLengthMeters} m</Body1></> : null}
      <PathFinderDirectSecondary decision={proposal.directSecondary} />
      <PathFinderBarrierResult execution={proposal.barriers} stale={displayStale} currentIntent={resultPreferences?.barrierRouting} />
      {proposal.lengthLedger ? <details><summary>Exact length components</summary>
        <p>Raw geometry: {proposal.lengthLedger.rawLengthDecimalMeters} m. Connection gaps are already included.</p>
        <p>Removed From approach: {proposal.lengthLedger.from.removedApproachMeters} m; removed To approach: {proposal.lengthLedger.to.removedApproachMeters} m.</p>
        <p>SECONDARY ends: {proposal.lengthLedger.secondaryEnds}; replacement: {proposal.lengthLedger.replacementMeters} m; Secondary tray length: {proposal.lengthLedger.settings.secondaryTrayLengthMeters??'Not required'}{proposal.lengthLedger.schemaVersion === 'wfc.pf.length-components.v2' ? ' (recorded only; unused for direct SECONDARY)' : ''}.</p>
        <p>Before clamp: {proposal.lengthLedger.beforeClampMeters} m; clamp adjustment: {proposal.lengthLedger.clampAdjustmentMeters} m; after clamp: {proposal.lengthLedger.afterClampMeters} m.</p>
        <p>For end connection: {proposal.lengthLedger.settings.endConnectionLengthMeters} m; Additional % for bending: {proposal.lengthLedger.settings.additionalBendingPercent}%.</p>
        <p>Bending increment: {proposal.lengthLedger.bendingIncrementMeters} m; ceiling increment: {proposal.lengthLedger.ceilingIncrementMeters} m.</p>
        <Caption1>Project Details revision: {proposal.lengthLedger.settingsRevision}; immutable result: {proposal.revisionResultHash??'Unavailable'}.</Caption1>
      </details> : <Caption1>Exact length components are unavailable for this historical or unsuccessful result.</Caption1>}
      <Caption1>Installed length is not changed by Apply.</Caption1>
      {!savedCurrentResult ? <div className={styles.actions}>
        <Button disabled={!canConfirmReview} onClick={() => void confirmReview()}>Confirm proposal review</Button>
        <Button appearance="primary" disabled={!canApplyReviewed} onClick={() => void apply()}>Apply reviewed result</Button>
      </div> : pathDisplayed ? <Body1 role="status">Saved route shown in the model.</Body1> : null}
      {!pathDisplayed && !previewLoading ? <Caption1>The exact path has not been displayed. Load the model and use Open path again before confirming individual review.</Caption1> : null}
      <Button disabled={!active || pf.busy || batch.busy || previewLoading || pf.viewerPhase === 'error'} onClick={() => void openProposal(proposal.id, proposal.jobId)}>Open path again</Button>
      {!effectiveCanApply && !stale ? <Caption1>{proposal.engineeringMessage}</Caption1> : null}
    </section> : null}
  </section>;
}
