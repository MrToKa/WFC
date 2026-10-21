import { useCallback, useEffect, useRef, useState } from 'react';
import { z } from 'zod';
import type { PathFinderPreferences, PathFinderProposal } from '@/api/pathfinder';
import type { PendingApplyInput } from './usePathfinderPendingApply';
import { sameBarrierAdmissionIntent } from '../../../../shared/pathfinderBarrierAdmission';

export const MAX_BATCH_REVIEW_SELECTION = 1000;
const uuid = z.string().uuid(), hash = z.string().regex(/^[a-f0-9]{64}$/);
const candidateSchema = z.object({
  proposalId: uuid, proposalHash: hash, revisionResultHash: hash.nullable(), cableId: uuid,
  cableWriteRevision: z.string().regex(/^(0|[1-9][0-9]{0,18})$/), tag: z.string().max(4096),
  routeText: z.string().min(1).max(8000), designLength: z.string().regex(/^(?:0|[1-9][0-9]{0,6})$/)
    .refine(value => BigInt(value) <= 1_000_000n),
}).strict();

export type BatchReviewCandidate = z.infer<typeof candidateSchema>;
export type BatchReviewStatus = 'selected' | 'reviewing' | 'reviewed' | 'applying' | 'applied' | 'blocked';
export type BatchReviewEntry = BatchReviewCandidate & { status: BatchReviewStatus; reviewId: string | null; message: string | null };
export type BatchReviewAccess = {
  identityKey: string; contextKey: string; active: boolean; blocked: boolean;
  options?: PathFinderPreferences | null;
  readProposal: (id: string) => Promise<PathFinderProposal | null>;
  reviewProposal: (proposal: PathFinderProposal) => Promise<{ reviewId: string; proposal: PathFinderProposal } | null>;
  pendingApply: { start: (input: PendingApplyInput) => Promise<boolean>; canStart: boolean; canStartNow?: () => boolean };
  onApplied?: () => void;
};
type BatchState = { scope: string; entries: BatchReviewEntry[]; busy: boolean; error: string | null; message: string | null };
type Ticket = { scope: string; cancelled: boolean; mode: 'review' | 'apply'; confirmedApply: boolean };
const scopeOf = (access: BatchReviewAccess) => JSON.stringify([access.identityKey, access.contextKey,
  access.options === undefined ? 'unspecified' : access.options]);
const initial = (scope: string): BatchState => ({ scope, entries: [], busy: false, error: null, message: null });
const canStartPending = (access: BatchReviewAccess) => access.pendingApply.canStartNow?.() ?? access.pendingApply.canStart;
const sameCandidate = (left: BatchReviewCandidate, right: BatchReviewCandidate) => left.proposalId === right.proposalId
  && left.proposalHash === right.proposalHash && left.revisionResultHash === right.revisionResultHash
  && left.cableId === right.cableId && left.cableWriteRevision === right.cableWriteRevision
  && left.routeText === right.routeText && left.designLength === right.designLength;
function matchesProposal(candidate: BatchReviewCandidate, proposal: PathFinderProposal | null, options: BatchReviewAccess['options']): proposal is PathFinderProposal {
  return Boolean(proposal && proposal.id === candidate.proposalId && proposal.proposalHash === candidate.proposalHash
    && proposal.cableId === candidate.cableId && proposal.cableWriteRevision === candidate.cableWriteRevision
    && (proposal.revisionResultHash ?? null) === candidate.revisionResultHash
    && proposal.status === 'calculated' && !proposal.stale && proposal.canApply && !proposal.compatibilityIssue
    && proposal.provenance?.dependencyVersion === 'pathfinder.dependencies.v8'
    && proposal.barriers?.schemaVersion === 'wfc.pf.barrier-execution.v1'
    && ['clear', 'bypassed', 'no-barriers-declared'].includes(proposal.barriers.diagnostics.status)
    && proposal.route?.success && proposal.route.routeText === candidate.routeText
    && proposal.design?.designLengthMeters === candidate.designLength
    && options !== null && (options === undefined || proposal.routingPreferences
      && proposal.routingPreferences.secondaryDistanceMeters === options.secondaryDistanceMeters
      && proposal.routingPreferences.preferVerticalApproach === options.preferVerticalApproach
      && sameBarrierAdmissionIntent(proposal.routingPreferences.barrierRouting,options.barrierRouting)));
}

/** Explicit human batch review and sequential Apply; the shared pending hook owns every durable command. */
export function usePathfinderBatchReview(access: BatchReviewAccess) {
  const scope = scopeOf(access), latest = useRef(access); latest.current = access;
  const [state, setState] = useState<BatchState>(() => initial(scope));
  const stateRef = useRef(state), mounted = useRef(false), operation = useRef<Ticket | null>(null);
  const publish = useCallback((value: BatchState) => { stateRef.current = value; if (mounted.current) setState(value); }, []);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; if (operation.current) operation.current.cancelled = true; }; }, []);
  useEffect(() => {
    if (stateRef.current.scope === scope) return;
    if (operation.current) operation.current.cancelled = true;
    operation.current = null; publish(initial(scope));
  }, [scope, publish]);
  const owned = useCallback((ticket: Ticket) => mounted.current && operation.current === ticket && scopeOf(latest.current) === ticket.scope, []);
  const runnable = useCallback((ticket: Ticket) => owned(ticket) && !ticket.cancelled && latest.current.active && !latest.current.blocked && latest.current.options !== null, [owned]);
  const updateEntry = useCallback((ticket: Ticket, proposalId: string, patch: Partial<BatchReviewEntry>) => {
    if (!owned(ticket)) return;
    const value = stateRef.current;
    publish({ ...value, entries: value.entries.map(item => item.proposalId === proposalId ? { ...item, ...patch } : item) });
  }, [owned, publish]);
  const fail = useCallback((ticket: Ticket, candidate: BatchReviewCandidate, message: string) => {
    if (!owned(ticket)) return;
    updateEntry(ticket, candidate.proposalId, { status: 'blocked', reviewId: null, message });
    publish({ ...stateRef.current, error: message, message: 'The batch stopped. Completed items are retained; no later item was sent.' });
  }, [owned, publish, updateEntry]);
  const select = useCallback((input: BatchReviewCandidate, checked: boolean) => {
    const currentAccess = latest.current, currentScope = scopeOf(currentAccess);
    if (!mounted.current || operation.current || !currentAccess.active || currentAccess.blocked) return;
    const current = stateRef.current.scope === currentScope ? stateRef.current : initial(currentScope);
    const parsed = candidateSchema.safeParse(input);
    if (!parsed.success) { publish({ ...current, error: 'This result cannot be selected. Refresh its calculation scope.' }); return; }
    const candidate = parsed.data, existing = current.entries.find(item => item.proposalId === candidate.proposalId);
    if (!checked) {
      publish({ ...current, entries: current.entries.filter(item => item.proposalId !== candidate.proposalId || item.status === 'applied'), error: null, message: null }); return;
    }
    if (existing) {
      if (!sameCandidate(existing, candidate)) publish({ ...current, error: 'The selected immutable result changed. Clear the selection and review the current result.' });
      return;
    }
    if (current.entries.some(item => item.cableId === candidate.cableId && item.status !== 'applied')) {
      publish({ ...current, error: 'Select only one proposal for each cable. Remove its earlier selection first.' }); return;
    }
    if (current.entries.length >= MAX_BATCH_REVIEW_SELECTION) {
      publish({ ...current, error: `Select at most ${MAX_BATCH_REVIEW_SELECTION} results in one batch.` }); return;
    }
    publish({ ...current, entries: [...current.entries, { ...candidate, status: 'selected', reviewId: null, message: null }], error: null, message: null });
  }, [publish]);
  const clearSelection = useCallback(() => {
    if (!mounted.current || operation.current) return;
    const current = stateRef.current.scope === scopeOf(latest.current) ? stateRef.current : initial(scopeOf(latest.current));
    publish({ ...current, entries: current.entries.filter(item => item.status === 'applied'), error: null, message: null });
  }, [publish]);
  const begin = useCallback((mode: Ticket['mode']): Ticket | null => {
    const value = latest.current;
    if (!mounted.current || operation.current || !value.active || value.blocked || value.options === null || !canStartPending(value)
      || stateRef.current.scope !== scopeOf(value)) return null;
    const ticket: Ticket = { scope: scopeOf(value), cancelled: false, mode, confirmedApply: false }; operation.current = ticket;
    publish({ ...stateRef.current, busy: true, error: null, message: null }); return ticket;
  }, [publish]);
  const finish = useCallback((ticket: Ticket) => {
    if (!owned(ticket)) return;
    operation.current = null;
    publish({ ...stateRef.current, busy: false, message: ticket.cancelled
      ? 'Batch stopped. Completed items are retained. No further request will be sent.' : stateRef.current.message });
    if (ticket.confirmedApply) latest.current.onApplied?.();
  }, [owned, publish]);
  const confirmReview = useCallback(async (): Promise<boolean> => {
    const queue = stateRef.current.entries.filter(item => item.status === 'selected' || item.status === 'blocked');
    if (!queue.length) return false;
    const ticket = begin('review'); if (!ticket) return false;
    try {
      for (const candidate of queue) {
        if (!runnable(ticket) || !canStartPending(latest.current)) return false;
        updateEntry(ticket, candidate.proposalId, { status: 'reviewing', reviewId: null, message: null });
        let detail: PathFinderProposal | null;
        try { detail = await latest.current.readProposal(candidate.proposalId); }
        catch { fail(ticket, candidate, 'The exact proposal could not be read. Refresh it before reviewing again.'); return false; }
        if (!runnable(ticket)) { if (owned(ticket)) updateEntry(ticket, candidate.proposalId, { status: 'selected', message: null }); return false; }
        if (!matchesProposal(candidate, detail, latest.current.options)) { fail(ticket, candidate, 'This selected result is outdated, unavailable or uses different routing preferences. Calculate and select a current proposal.'); return false; }
        if (!canStartPending(latest.current)) { fail(ticket, candidate, 'Reconcile the pending Apply request before reviewing another result.'); return false; }
        let reviewed: Awaited<ReturnType<BatchReviewAccess['reviewProposal']>>;
        try { reviewed = await latest.current.reviewProposal(detail); }
        catch { fail(ticket, candidate, 'Review was not confirmed. No Apply was sent. Refresh the result before trying again.'); return false; }
        if (!owned(ticket)) return false;
        if (!reviewed || !uuid.safeParse(reviewed.reviewId).success || !matchesProposal(candidate, reviewed.proposal, latest.current.options)) {
          fail(ticket, candidate, 'Review was not confirmed for this exact result. No Apply was sent.'); return false;
        }
        updateEntry(ticket, candidate.proposalId, { status: 'reviewed', reviewId: reviewed.reviewId, message: 'Review confirmed. Awaiting explicit Apply.' });
        if (!runnable(ticket)) return false;
      }
      if (owned(ticket)) publish({ ...stateRef.current, message: 'Selected results reviewed. Apply reviewed selection explicitly to update the cable list.' });
      return true;
    } finally { finish(ticket); }
  }, [begin, fail, finish, owned, publish, runnable, updateEntry]);
  const applyReviewed = useCallback(async (): Promise<boolean> => {
    const queue = stateRef.current.entries.filter(item => item.status === 'reviewed' && item.reviewId !== null);
    if (!queue.length) return false;
    const ticket = begin('apply'); if (!ticket) return false;
    try {
      for (const candidate of queue) {
        if (!runnable(ticket) || !canStartPending(latest.current)) return false;
        let detail: PathFinderProposal | null;
        try { detail = await latest.current.readProposal(candidate.proposalId); }
        catch { fail(ticket, candidate, 'This reviewed proposal could not be checked. No Apply was sent for it.'); return false; }
        if (!runnable(ticket)) return false;
        if (!matchesProposal(candidate, detail, latest.current.options)) { fail(ticket, candidate, 'The reviewed result changed or is no longer applicable. Review a current proposal before Apply.'); return false; }
        if (!canStartPending(latest.current)) { fail(ticket, candidate, 'Reconcile the pending Apply request before continuing this batch.'); return false; }
        updateEntry(ticket, candidate.proposalId, { status: 'applying', message: null });
        let confirmed = false;
        try { confirmed = await latest.current.pendingApply.start({ proposalId: candidate.proposalId, proposalHash: candidate.proposalHash,
          cableId: candidate.cableId, reviewId: candidate.reviewId!, expectedCableWriteRevision: candidate.cableWriteRevision,
          revisionResultHash: candidate.revisionResultHash }); }
        catch { /* The shared pending hook owns the exact uncertain command. Never replace its key. */ }
        if (!owned(ticket)) return false;
        if (!confirmed) { fail(ticket, candidate, 'The Apply outcome is unconfirmed. Reconcile the exact pending request before continuing.'); return false; }
        updateEntry(ticket, candidate.proposalId, { status: 'applied', message: 'Routing and design length applied together. Installed length preserved.' });
        ticket.confirmedApply = true;
        if (!runnable(ticket)) return false;
      }
      if (owned(ticket)) publish({ ...stateRef.current, message: 'All reviewed results in this batch were applied. Installed lengths were preserved.' });
      return true;
    } finally { finish(ticket); }
  }, [begin, fail, finish, owned, publish, runnable, updateEntry]);
  const cancel = useCallback(() => {
    const ticket = operation.current;
    if (!ticket || !owned(ticket)) return;
    ticket.cancelled = true;
    publish({ ...stateRef.current, message: 'Stopping after the current request. No later item will be sent.' });
  }, [owned, publish]);
  const visible = state.scope === scope ? state : initial(scope);
  const counts = { selected: visible.entries.filter(item => item.status !== 'applied').length,
    reviewed: visible.entries.filter(item => item.status === 'reviewed').length,
    applied: visible.entries.filter(item => item.status === 'applied').length,
    blocked: visible.entries.filter(item => item.status === 'blocked').length, total: visible.entries.length };
  const allowed = access.active && !access.blocked && access.options !== null && !visible.busy && access.pendingApply.canStart;
  return { ...visible, counts, select, clearSelection, confirmReview, applyReviewed, cancel,
    canReview: allowed && visible.entries.some(item => item.status === 'selected' || item.status === 'blocked'),
    canApply: allowed && counts.reviewed > 0 };
}
