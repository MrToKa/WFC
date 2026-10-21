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
import { computedPathObjectIds, proposalEndpointObjectIds } from './pathFinderEndpointVisibility';
import { sealedCableItemApplicabilitySchema } from '../../../shared/pathfinderItemApplicability';
import { fetchPathFinderCableWorkflowDetail, type CableWorkflowDetailQuery } from '@/api/pathfinderCableWorkflow';
import { PathFinderCableComparison } from '@/components/pathfinder/PathFinderCableComparison';
import { cableComparisonInputSchema, type CableComparisonInput } from '../../../shared/pathfinderCableComparison';
import { cableWorkflowRowSchema, type CableWorkflowRow } from '../../../shared/pathfinderCableWorkflow';
import { revisionResultEnvelopeSchema } from '../../../shared/pathfinderRevisionResults';
import { PathFinderDirectSecondary } from './PathFinderDirectSecondary';
import { PathFinderBarrierResult } from './PathFinderBarrierResult';
import { sameBarrierAdmissionIntent } from '../../../shared/pathfinderBarrierAdmission';
import type { AutoLengthView } from '../../../shared/pathfinderAutoLength';
import type { PathFinderCalculatedItemIdentity } from './hooks/usePathfinderAutoLengthRead';

export type PathFinderWorkflowDisplayRequest = { cableId: string; requestId: number; action: 'show' | 'hide' };
export type PathFinderWorkflowDisplay = { cableId: string | null; visible: boolean; routing: string | null; designLength: string | null };
/** One display-only bridge to the existing owned review/recovery controller.
 * The popup never implements a second writer or creates a replacement command. */
export type PathFinderWorkflowReview = {
  cableId: string; proposalId: string | null; comparison: CableComparisonInput | null;
  comparisonLoading: boolean; comparisonError: string | null; message: string | null;
  reviewed: boolean; applied: boolean; canReview: boolean; canApply: boolean; busy: boolean;
  pending: boolean; canRecover: boolean; recoveryMessage: string | null; recoveryError: string | null;
  autoLength?: AutoLengthView | null; autoLengthLoading?: boolean; autoLengthError?: string | null; refreshAutoLength?: () => void;
  review: () => void; apply: () => void; retry: () => void; closePending: () => void;
};
type Props = { pf: ReturnType<typeof usePathFinder>; selectedCableId: string | null; workflowSelection?: CableWorkflowRow | null; accountId?: string | null; active?: boolean; displayOwned?: boolean; claimViewer?: () => () => boolean; options?: PathFinderPreferences | null; onBatchBusyChange?: (busy: boolean) => void; onCableValuesChanged?: () => void;
  backgroundOptions?: PathFinderPreferences | null; readPreferences?: CableWorkflowDetailQuery | null;
  workflowDisplayRequest?: PathFinderWorkflowDisplayRequest | null; onWorkflowDisplayChange?: (value: PathFinderWorkflowDisplay) => void;
  onWorkflowReviewChange?: (value: PathFinderWorkflowReview | null) => void;
  onCalculationCommitted?: (value: PathFinderCalculatedItemIdentity) => void };
const resultLabel = (status: string) => ({ calculated: 'Ready for review', model_needs_review: 'Model review required', no_path: 'No connected path', settings_required: 'Project values required', category_required: 'Cable category required', locations_required: 'Resolve locations', stale: 'Outdated', deadline_exceeded: 'Calculation timed out', resource_limit: 'Calculation limit reached', invalid_request: 'Review the input' }[status] ?? 'Review required');
function hasExactItemApplicability(proposal: PathFinderProposal | null, projectId: string | null | undefined) {
  const proof = sealedCableItemApplicabilitySchema.safeParse(proposal?.itemApplicability);
  return Boolean(proposal && projectId && proof.success && (proposal.provenance?.dependencyVersion === 'pathfinder.dependencies.v7'
    && proof.data.schemaVersion === 'wfc.pf.sealed-cable-applicability.v1' && proof.data.dependencyVersion === 'pathfinder.dependencies.v7'
    || proposal.provenance?.dependencyVersion === 'pathfinder.dependencies.v8'
    && proof.data.schemaVersion === 'wfc.pf.sealed-cable-applicability.v2' && proof.data.dependencyVersion === 'pathfinder.dependencies.v8')
    && proposal.projectId === projectId && proof.data.projectId === projectId && proof.data.jobId === proposal.jobId
    && proof.data.cableId === proposal.cableId && proof.data.proposalId === proposal.id && proof.data.dependencyHash === proposal.provenance.dependencyHash);
}
export function PathFinderResults({ pf, selectedCableId, workflowSelection = null, accountId, active = true, displayOwned = true, claimViewer, options, backgroundOptions, readPreferences, onBatchBusyChange, onCableValuesChanged,
  workflowDisplayRequest, onWorkflowDisplayChange, onWorkflowReviewChange, onCalculationCommitted }: Props) {
  const styles = useRoutingsViewerStyles();
  const [proposal, setProposal] = useState<PathFinderProposal | null>(null), [job, setJob] = useState<PathFinderJob | null>(null);
  const [reviewId, setReviewId] = useState<string | null>(null), [pathDisplayed, setPathDisplayed] = useState(false), [applied, setApplied] = useState(false);
  const reviewTicket = useRef<object | null>(null), [reviewBusy, setReviewBusy] = useState(false);
  const [previewLoading, setPreviewLoading] = useState(false);
  const displayRequestLatest = useRef({ pf, selectedCableId, active, displayOwned });
  displayRequestLatest.current = { pf, selectedCableId, active, displayOwned };
  const proposalCableId = proposal?.cableId ?? null, proposalRouting = proposal?.route?.routeText ?? null;
  const proposalDesignLength = proposal?.design?.designLengthMeters === undefined ? null : String(proposal.design.designLengthMeters);
  useEffect(() => { onWorkflowDisplayChange?.({ cableId: proposalCableId, visible: active && displayOwned && pathDisplayed,
    routing: proposalRouting, designLength: proposalDesignLength }); }, [onWorkflowDisplayChange, proposalCableId, proposalRouting, proposalDesignLength, active, displayOwned, pathDisplayed]);
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
  useEffect(() => { if (!displayOwned) { endpointRead.current?.abort(); operation.current++; setReviewId(null); setPathDisplayed(false); setApplied(false); setPreviewLoading(false); setNotice(null); } }, [displayOwned]);
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
  const comparisonOwner = JSON.stringify([ownershipKey, active, selectedCableId, data?.activeModel, settingsKey, optionsKey, readPreferencesKey, scopeReadiness.admissionId, scopeReadiness.jobId]);
  const comparisonLatest = useRef({ owner: comparisonOwner, cables: data?.cables }); comparisonLatest.current = { owner: comparisonOwner, cables: data?.cables };
  const comparisonRead = useRef<{ controller: AbortController; cableId: string; observedRevision: string | undefined } | null>(null);
  const [comparison, setComparison] = useState<{ owner: string; proposalId: string; proposalHash: string; revisionResultHash: string | null;
    observedRevision: string | undefined; loading: boolean; input: CableComparisonInput | null; error: string | null } | null>(null);
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
      setComparison({ ...state, loading: false, input: input.data, error: null });
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
  // Selecting a cable reads its result without changing model appearance. Only
  // an explicit Show may claim the viewer; a new context starts hidden.
  // Progress or a saved location must not reopen a deliberately hidden path.
  const workflowDisplayContext = JSON.stringify([ownershipKey, active, selectedCableId, data?.activeModel, settingsKey, optionsKey, readPreferencesKey]);
  const workflowProposalKey = workflowTarget ? JSON.stringify([workflowTarget.calculation.jobId, workflowTarget.calculation.proposalId,
    workflowTarget.calculation.proposalHash, workflowTarget.cable.cableWriteRevision]) : null;
  const workflowHidden = useRef<{ context: string; hidden: boolean; proposalKey: string | null }>({ context: workflowDisplayContext, hidden: true, proposalKey: null });
  if (workflowHidden.current.context !== workflowDisplayContext) workflowHidden.current = { context: workflowDisplayContext, hidden: true, proposalKey: null };
  const handledDisplayRequest = useRef(-1);
  // The hint identifies one selected result. Replacing list rows or updating
  // their progress must never silently retarget the selected proposal.
  const selectedWorkflowIdentity = workflowTarget ? JSON.stringify([ownershipKey, active, selectedCableId, data?.activeModel, settingsKey, optionsKey, readPreferencesKey, workflowAttempt,
    workflowTarget.calculation.jobId, workflowTarget.calculation.proposalId, workflowTarget.calculation.proposalHash, workflowTarget.cable.cableWriteRevision]) : null;
  workflowIdentity.current = selectedWorkflowIdentity;
  const workflowKey = workflowTarget ? JSON.stringify([selectedWorkflowIdentity, workflowTarget.calculation.jobStatus, workflowTarget.calculation.itemState,
    workflowTarget.calculation.currentness, workflowTarget.calculation.reviewable, workflowTarget.calculation.itemApplicability ?? null]) : null;
  const workflowLatest = useRef({ key: workflowKey, proposalKey: workflowProposalKey, target: workflowTarget, pf, readPreferences: comparisonPreferences, claimViewer,
    comparisonBase: [ownershipKey, active, selectedCableId, data?.activeModel, settingsKey, optionsKey, readPreferencesKey] });
  workflowLatest.current = { key: workflowKey, proposalKey: workflowProposalKey, target: workflowTarget, pf, readPreferences: comparisonPreferences, claimViewer,
    comparisonBase: [ownershipKey, active, selectedCableId, data?.activeModel, settingsKey, optionsKey, readPreferencesKey] };
  useEffect(() => {
    const latest = displayRequestLatest.current;
    if (!workflowDisplayRequest || !latest.active || workflowDisplayRequest.cableId !== latest.selectedCableId
      || !Number.isSafeInteger(workflowDisplayRequest.requestId) || workflowDisplayRequest.requestId <= handledDisplayRequest.current) return;
    handledDisplayRequest.current = workflowDisplayRequest.requestId;
    if (workflowDisplayRequest.action === 'show') {
      // History selection clears workflowScope but retains suppression. A new
      // Show must schedule a read even when the selected result is unchanged.
      const retrySelected = workflowScope.current !== null || suppressedWorkflow.current !== null;
      workflowHidden.current.hidden = false; workflowHidden.current.proposalKey = workflowLatest.current.proposalKey; suppressedWorkflow.current = null;
      if (retrySelected) setWorkflowAttempt(value => value + 1);
      return;
    }
    workflowHidden.current.hidden = true;
    endpointRead.current?.abort(); operation.current++; suppressedWorkflow.current = workflowIdentity.current;
    if (latest.displayOwned) latest.pf.clear();
    setPathDisplayed(false); setPreviewLoading(false);
  }, [workflowDisplayRequest]);
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
    adoptScope({ admissionId: null, jobId: target.calculation.jobId, ready: false, message: 'Checking the selected cable calculation…' }, true);
    const atOperation = ++operation.current, currentDisplay = displayRequested ? initial.claimViewer?.() ?? (() => true) : () => true, controller = new AbortController();
    endpointRead.current = controller; setPreviewLoading(true);
    const current = () => !controller.signal.aborted && operation.current === atOperation && workflowScope.current === workflowKey
      && workflowLatest.current.key === workflowKey && currentDisplay();
    void (async () => {
      try {
        const detail = await initial.pf.readProposal(target.calculation.proposalId!);
        if (!current() || !detail) return;
        if (detail.id !== target.calculation.proposalId || detail.proposalHash !== target.calculation.proposalHash || detail.projectId !== target.projectId
          || detail.cableId !== target.cable.id || detail.jobId !== target.calculation.jobId) throw new Error('WORKFLOW_PROPOSAL_SCOPE_CHANGED');
        const parsedEnvelope = revisionResultEnvelopeSchema.safeParse(detail.revisionResult), envelope = parsedEnvelope.success ? parsedEnvelope.data : null;
        if (detail.revisionResult && (!envelope || envelope.projectId !== detail.projectId || envelope.cableId !== detail.cableId || envelope.jobId !== detail.jobId
          || envelope.proposalId !== detail.id || envelope.proposalHash !== detail.proposalHash || envelope.revisionResultSha256 !== detail.revisionResultHash
          || envelope.baselineHash !== detail.revisionBaselineHash || envelope.dependencyHash !== detail.provenance?.dependencyHash)) throw new Error('WORKFLOW_RESULT_SCOPE_CHANGED');
        const preferences = initial.readPreferences === undefined ? detail.routingPreferences : initial.readPreferences;
        const [parentRead, cableRead] = await Promise.allSettled([
          initial.pf.readJob(detail.jobId),
          preferences ? fetchPathFinderCableWorkflowDetail(projectId, token, detail.cableId, preferences, controller.signal) : Promise.resolve(null),
        ]);
        if (!current()) return;
        for (const read of [parentRead, cableRead]) if (read.status === 'rejected') {
          const error = read.reason as { status?: unknown }; if (error?.status === 401 || error?.status === 403) throw read.reason;
        }
        const parent = parentRead.status === 'fulfilled' && parentRead.value?.projectId === detail.projectId && parentRead.value.id === detail.jobId ? parentRead.value : null;
        const live = cableRead.status === 'fulfilled' ? cableRead.value : null;
        if (live && (live.projectId !== detail.projectId || live.cableId !== detail.cableId || live.row.projectId !== detail.projectId || live.row.cable.id !== detail.cableId
          || live.row.calculation.jobId !== detail.jobId || live.row.calculation.proposalId !== detail.id || live.row.calculation.proposalHash !== detail.proposalHash)) throw new Error('WORKFLOW_CURRENT_RESULT_CHANGED');
        const liveCurrent = Boolean(live?.row.calculation.currentness === 'current' && live.row.calculation.reviewable && live.row.calculation.itemState === 'complete'
          && live.row.calculation.outcome === 'calculated' && live.row.cable.cableWriteRevision === detail.cableWriteRevision);
        const wholeJobReady = Boolean(envelope && parent?.status === 'complete' && !parent.cancelRequested && liveCurrent);
        const itemReady = Boolean(envelope && parent && ['queued', 'running'].includes(parent.status) && !parent.cancelRequested && liveCurrent
          && hasExactItemApplicability(detail, access.projectId));
        const issue = !envelope ? 'This historical path has no verifiable calculation admission. It is preview only; use Cable revision results or calculate a fresh proposal before Review and Apply.'
          : !parent ? 'The exact calculation state is unavailable. This path is preview only; reopen the selected cable result to check again.'
            : parent.cancelRequested || ['cancelled', 'failed'].includes(parent.status) ? 'This calculation was cancelled or failed. Its saved path is preview only.'
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
          observedRevision, loading: false, input: input?.success ? input.data : null, error: input?.success ? null : 'Live cable comparison is unavailable. Reopen this selected result to check again.' });
        // Endpoint assignment and diagnostic refreshes must not isolate the
        // model or change Ghost. Metadata remains available without a preview.
        if (!displayRequested) return;
        if (!detail.route?.success || !detail.route.points.length) { initial.pf.clear(); setNotice('This proposal has no drawable path. Its diagnostic is shown below.'); return; }
        if (detail.route.points.length > MAX_PATH_POINTS) { setNotice('This exact path exceeds the viewer point budget. The result is retained without truncation.'); return; }
        const endpointIds = latest.pf.data ? await proposalEndpointObjectIds(detail, latest.pf.data, { projectId, token }, controller.signal) : [];
        if (!current()) return; const objectIds = computedPathObjectIds(detail.route.objectIds, endpointIds);
        if (!objectIds) { setNotice('This path and its From/To objects exceed the viewer object budget. The result is retained without truncation.'); return; }
        const shown = await initial.pf.showPath({ pathId: detail.id, points: detail.route.points, objectIds });
        if (!current()) return; setPathDisplayed(Boolean(shown));
        if (!shown) setNotice('The selected proposal is available. Load the active model and reopen the selected cable result to view its exact path.');
      } catch (error) {
        if (!current()) return;
        const status = error && typeof error === 'object' && 'status' in error ? error.status : null;
        if (status === 401 || status === 403) { initial.pf.refresh(); setNotice('Current administrator access is required to inspect this cable result.'); }
        else setNotice('The selected cable calculation changed or could not be verified. Refresh the cable list and open the result again.');
      } finally { if (endpointRead.current === controller) endpointRead.current = null; if (operation.current === atOperation) setPreviewLoading(false); }
    })();
    return () => { controller.abort(); operation.current++; };
  }, [workflowKey, workflowDisplayContext, active, accountId, adoptScope, selectHistory]);
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
  const preferencesMatch = options === undefined || Boolean(options && proposal?.routingPreferences && options.secondaryDistanceMeters === proposal.routingPreferences.secondaryDistanceMeters && options.preferVerticalApproach === proposal.routingPreferences.preferVerticalApproach
    && sameBarrierAdmissionIntent(options.barrierRouting, proposal.routingPreferences.barrierRouting));
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
    && proposal.barriers?.schemaVersion === 'wfc.pf.barrier-execution.v1'
    && ['clear', 'bypassed', 'no-barriers-declared'].includes(proposal.barriers.diagnostics.status));
  const effectiveCanApply = Boolean(comparisonReady && protectedResult && proposal && proposal.status === 'calculated' && scopeReadiness.admissionId && proposal.jobId === scopeReadiness.jobId && !calculationCancelled
    && (!workflowScopeOwner || scopeReadiness.ready)
    && !calculationFailed && !knownLiveRevisionMismatch && (wholeJobReady && (!checkedJobStatus || checkedJobStatus === 'complete') || sealedItemReady) && preferencesMatch && !stale && !proposal.compatibilityIssue
    && proposal.canApply && !(summary && summary.proposalHash === proposal.proposalHash && !summary.canApply));
  const projectionCallback = useRef(onCalculationCommitted); projectionCallback.current = onCalculationCommitted;
  const lastProjection = useRef('');
  const completedSelectedItem = Boolean(active && accountId && selectedCableId && proposal?.cableId === selectedCableId && protectedResult
    && proposal?.provenance?.engineIdentity?.schemaVersion === 'wfc.pf.engine-identity.v2'
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
  const proposalJobIssue = !proposal || effectiveCanApply ? null : calculationCancelled
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
  const popupMessage = !selectedProposal ? previewLoading ? 'Reading this cable’s exact calculation…' : 'Calculate routing or refresh this cable to inspect its exact result.'
    : !protectedResult ? 'This historical or unchecked result needs a fresh calculation with the current barrier settings.'
      : !preferencesMatch ? 'The barrier settings or routing preferences changed. Calculate again.'
        : stale ? 'This result is outdated. Calculate routing again.'
          : proposalJobIssue ?? (!pathDisplayed ? 'Use Show to inspect the exact path before confirming review.' : notice);
  const popupComparison = selectedProposal ? ownedComparison?.input ?? null : null;
  const popupComparisonLoading = Boolean(previewLoading && !selectedProposal || selectedProposal && ownedComparison?.loading);
  const popupComparisonError = selectedProposal ? ownedComparison?.error ?? null : null;
  const pendingForCable = Boolean(selectedCableId && pendingApply.pending?.cableId === selectedCableId);
  const workflowReview = useMemo<PathFinderWorkflowReview | null>(() => selectedCableId ? {
    cableId: selectedCableId, proposalId: selectedProposal?.id ?? null, comparison: popupComparison,
    comparisonLoading: popupComparisonLoading, comparisonError: popupComparisonError, message: popupMessage,
    reviewed: Boolean(selectedProposal && reviewId), applied: Boolean(selectedProposal && applied),
    canReview: Boolean(selectedProposal && canConfirmReview), canApply: Boolean(selectedProposal && canApplyReviewed),
    busy: Boolean(reviewBusy || pf.busy || batch.busy || previewLoading || pendingApply.busy), pending: pendingForCable,
    canRecover: Boolean(pendingForCable && active && !pf.busy && pendingApply.canRetry),
    recoveryMessage: pendingApply.message, recoveryError: pendingApply.error,
    ...Object.fromEntries((['review', 'apply', 'retry', 'closePending'] as const).map(action => [action, () => {
      if (reviewActions.current.owner === reviewOwner) void reviewActions.current[action]();
    }])) as Pick<PathFinderWorkflowReview, 'review' | 'apply' | 'retry' | 'closePending'>,
  } : null, [selectedCableId, selectedProposal?.id, popupComparison, popupComparisonLoading, popupComparisonError, popupMessage,
    reviewId, applied, canConfirmReview, canApplyReviewed, pf.busy, batch.busy, previewLoading, pendingApply.busy, pendingForCable,
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
      {job?.items ? <ul aria-label="Calculation outcomes">{job.items.map(item => <li key={item.cableId}>{data?.cables.find(cable => cable.id === item.cableId)?.tag ?? 'Cable'}: {resultLabel(item.status)}{item.message ? ` — ${item.message}` : ''}</li>)}</ul> : null}
    </details>
    <ul className={styles.cableList} aria-label="Path Finder proposals">
      {proposals.slice(0, 5).map(item => <li key={item.id}><Button disabled={pf.busy || batch.busy || previewLoading} aria-pressed={proposal?.id === item.id} onClick={() => void openProposal(item.id, item.jobId)}>
        {data?.cables.find(cable => cable.id === item.cableId)?.tag ?? 'Cable'} — {item.stale ? 'Outdated' : item.status === 'calculated' && !item.canApply ? 'Review blocked' : resultLabel(item.status)}{item.synthetic ? ' — local synthetic fixture' : ''}
      </Button></li>)}
    </ul>
    <Caption1>{proposals.length ? 'Recent proposals from the selected calculation are shown here.' : 'Use Inspect, then Open exact proposal in Viewer in the selected calculation above.'} Cable revision results contains every cable in that calculation, with pages of up to 100.</Caption1>
    {proposal ? <section className={styles.result} aria-label="Proposal review" data-testid="pathfinder-proposal" data-stale={String(stale)}>
      <h4>Proposal review</h4>
      <Body1>Cable: {data?.cables.find(cable => cable.id === proposal.cableId)?.tag ?? proposal.cableId}</Body1>
      <Body1>{proposal.synthetic ? 'Local synthetic fixture for demonstration.' : 'Review the route and length before applying.'}</Body1>
      {stale ? <Body1 role="alert">This result is outdated. Calculate a new proposal before reviewing or applying it.</Body1> : null}
      <Body1>{proposal.message}</Body1>
      {!protectedResult ? <Body1 role="alert">This historical or unchecked result can be inspected, but cannot receive a new review or Apply. Calculate a fresh route with the current barrier settings.</Body1> : null}
      {ownedComparison?.loading ? <Caption1 role="status">Reading live cable values for comparison…</Caption1> : null}
      {ownedComparison?.error ? <Body1 role="status">{ownedComparison.error}</Body1> : null}
      {!ownedComparison?.loading ? <PathFinderCableComparison input={ownedComparison?.input ?? null} /> : null}
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
      <PathFinderBarrierResult execution={proposal.barriers} stale={stale} currentIntent={options?.barrierRouting} />
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
      <div className={styles.actions}>
        <Button disabled={!canConfirmReview} onClick={() => void confirmReview()}>Confirm proposal review</Button>
        <Button appearance="primary" disabled={!canApplyReviewed} onClick={() => void apply()}>Apply reviewed result</Button>
      </div>
      {!pathDisplayed && !previewLoading ? <Caption1>The exact path has not been displayed. Load the model and use Open path again before confirming individual review.</Caption1> : null}
      <Button disabled={!active || pf.busy || batch.busy || previewLoading || pf.viewerPhase === 'error'} onClick={() => void openProposal(proposal.id, proposal.jobId)}>Open path again</Button>
      {!effectiveCanApply && !stale ? <Caption1>{proposal.engineeringMessage}</Caption1> : null}
    </section> : null}
  </section>;
}
