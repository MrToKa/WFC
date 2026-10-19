import { useCallback, useEffect, useRef, useState } from 'react';
import { z } from 'zod';
import { parsePurposeJson } from '../../../../shared/pathfinderPurposePolicy';

export const PENDING_APPLY_STORAGE_KEY = 'wfc.pathfinder.pending-apply.v1';
const MAX_BYTES = 16_384, MAX_INTENTS = 8;
const uuid = z.string().uuid(), hash = z.string().length(64).regex(/^[a-f0-9]{64}$/);
const revision = z.string().regex(/^(0|[1-9][0-9]{0,18})(?![\s\S])/);
const intentSchema = z.object({
  projectId: uuid, accountId: uuid, proposalId: uuid, proposalHash: hash, cableId: uuid,
  reviewId: uuid, idempotencyKey: uuid, expectedCableWriteRevision: revision,
  revisionResultHash: hash.nullable(), createdAt: z.string().datetime(),
}).strict();
const storeSchema = z.object({ version: z.literal(1), intents: z.array(intentSchema).max(MAX_INTENTS) }).strict()
  .refine(value => new Set(value.intents.map(item => `${item.accountId}/${item.projectId}`)).size === value.intents.length);
export type PendingApplyIntent = Readonly<z.infer<typeof intentSchema>>;
export type PendingApplyInput = Omit<PendingApplyIntent, 'projectId' | 'accountId' | 'idempotencyKey' | 'createdAt'>;
export type PendingApplyAccess = {
  projectId: string | null; loadedProjectId: string | null; accountId: string | null;
  token: string | null; isAdmin: boolean; active: boolean;
  action: (path: string, body: unknown) => Promise<Record<string, unknown> | null>;
};
type State = { identity: string; ready: boolean; pending: PendingApplyIntent | null; busy: boolean; message: string | null; error: string | null };
const initial = (identity: string): State => ({ identity, ready: false, pending: null, busy: false, message: null, error: null });
const ownerOf = (item: Pick<PendingApplyIntent, 'projectId' | 'accountId'>) => `${item.accountId}/${item.projectId}`;
function readStore(): z.infer<typeof storeSchema> {
  const raw = sessionStorage.getItem(PENDING_APPLY_STORAGE_KEY);
  return raw === null ? { version: 1, intents: [] } : storeSchema.parse(parsePurposeJson(raw, { maximumBytes: MAX_BYTES }));
}
function writeStore(value: z.infer<typeof storeSchema>) {
  const raw = JSON.stringify(storeSchema.parse(value));
  if (new TextEncoder().encode(raw).byteLength > MAX_BYTES) throw new Error('Pending Apply storage limit reached.');
  // A first POST requires durable recovery. No memory-only fallback may lose its key on reload.
  sessionStorage.setItem(PENDING_APPLY_STORAGE_KEY, raw);
  if (sessionStorage.getItem(PENDING_APPLY_STORAGE_KEY) !== raw) throw new Error('Pending Apply could not be retained.');
}
const receiptSchema = z.object({ duplicate: z.boolean(), receipt: z.object({
  id: uuid, projectId: uuid, proposalId: uuid, cableId: uuid, appliedAt: z.string().min(1).max(128),
  before: z.object({ id: uuid, project_id: uuid, cable_write_revision: revision }).passthrough(),
  after: z.object({ id: uuid, project_id: uuid, cable_write_revision: revision }).passthrough(),
  provenance: z.object({ schemaVersion: z.literal('pathfinder.apply.v2'), proposalId: uuid,
    proposalHash: hash, reviewId: uuid,
    review: z.object({ id: uuid, actorId: uuid }).passthrough(),
    revisionResult: z.object({ revisionResultSha256: hash }).passthrough(),
  }).passthrough(),
}).passthrough() });
const recoverySchema = z.object({ schemaVersion: z.literal('wfc.pf.apply-recovery.v1'), projectId: uuid, proposalId: uuid,
  idempotencyKey: uuid, reviewId: uuid, expectedCableWriteRevision: revision,
  status: z.enum(['already-applied', 'closed-without-apply']), duplicate: z.boolean(), receipt: z.unknown(),
}).strict();
function matchingReceipt(value: unknown, intent: PendingApplyIntent): boolean {
  const parsed = receiptSchema.safeParse(value);
  if (!parsed.success) return false;
  const receipt = parsed.data.receipt;
  return receipt.projectId === intent.projectId && receipt.proposalId === intent.proposalId && receipt.cableId === intent.cableId
    && receipt.before.id === intent.cableId && receipt.after.id === intent.cableId
    && receipt.before.project_id === intent.projectId && receipt.after.project_id === intent.projectId
    && receipt.before.cable_write_revision === intent.expectedCableWriteRevision
    && receipt.provenance.proposalId === intent.proposalId && receipt.provenance.proposalHash === intent.proposalHash
    && receipt.provenance.reviewId === intent.reviewId
    && receipt.provenance.review.id === intent.reviewId && receipt.provenance.review.actorId === intent.accountId
    && (intent.revisionResultHash === null || receipt.provenance.revisionResult.revisionResultSha256 === intent.revisionResultHash);
}

/** Retains an exact human Apply command; never replays automatically or treats staleness as rollback. */
export function usePathfinderPendingApply(access: PendingApplyAccess) {
  const identity = JSON.stringify([access.projectId, access.loadedProjectId, access.accountId, access.token, access.isAdmin]);
  const allowed = Boolean(access.isAdmin && access.token && uuid.safeParse(access.accountId).success
    && uuid.safeParse(access.projectId).success && access.projectId === access.loadedProjectId);
  const [state, setState] = useState<State>(() => initial(identity));
  const latest = useRef({ identity, allowed, active: access.active }); latest.current = { identity, allowed, active: access.active };
  const request = useRef<object | null>(null);
  const mounted = useRef(false);
  const ownedState = state.identity === identity ? state : initial(identity);
  const live = useCallback(() => mounted.current && latest.current.identity === identity && latest.current.allowed, [identity]);
  useEffect(() => {
    mounted.current = true;
    request.current = null;
    if (!allowed) { setState(initial(identity)); return () => { mounted.current = false; }; }
    try {
      const stored = readStore(), owner = `${access.accountId}/${access.projectId}`;
      const pending = stored.intents.find(item => ownerOf(item) === owner);
      setState({ ...initial(identity), ready: true, pending: pending ? Object.freeze(pending) : null });
    } catch {
      setState({ ...initial(identity), error: 'Pending Apply recovery storage is unavailable or invalid. No new Apply will be sent. Preserve this browser session and ask an operator to reconcile it.' });
    }
    return () => { mounted.current = false; };
  }, [identity, allowed, access.accountId, access.projectId]);

  const execute = useCallback(async (intent: PendingApplyIntent, ticket: object, mode: 'apply' | 'close' = 'apply'): Promise<boolean> => {
    if (!live() || !latest.current.active || request.current !== ticket) return false;
    setState(value => ({ ...value, busy: true, error: null, message: null }));
    try {
      const result = await access.action(`/proposals/${intent.proposalId}/${mode === 'close' ? 'close-pending-apply' : 'apply'}`, {
        idempotencyKey: intent.idempotencyKey, reviewId: intent.reviewId,
        expectedCableWriteRevision: intent.expectedCableWriteRevision,
      });
      if (!live() || request.current !== ticket) return false;
      let closedWithoutApply = false, confirmed = mode === 'apply' && matchingReceipt(result, intent);
      if (mode === 'close') {
        const recovery = recoverySchema.safeParse(result);
        if (recovery.success && recovery.data.projectId === intent.projectId && recovery.data.proposalId === intent.proposalId
          && recovery.data.idempotencyKey === intent.idempotencyKey && recovery.data.reviewId === intent.reviewId
          && recovery.data.expectedCableWriteRevision === intent.expectedCableWriteRevision) {
          closedWithoutApply = recovery.data.status === 'closed-without-apply' && recovery.data.receipt === null;
          confirmed = closedWithoutApply || recovery.data.status === 'already-applied'
            && matchingReceipt({ receipt: recovery.data.receipt, duplicate: recovery.data.duplicate }, intent);
        }
      }
      if (!confirmed) {
        setState(value => ({ ...value, error: result === null
          ? 'The pending request outcome is unconfirmed. The exact command is retained. Retry pending Apply or close the same pending request to reconcile it.'
          : 'The Apply or recovery receipt does not match the retained command. The command is still pending; do not create a replacement.' }));
        return false;
      }
      const stored = readStore(), current = stored.intents.find(item => ownerOf(item) === ownerOf(intent));
      if (!current || JSON.stringify(current) !== JSON.stringify(intent)) throw new Error('Pending Apply recovery identity changed.');
      writeStore({ version: 1, intents: stored.intents.filter(item => ownerOf(item) !== ownerOf(intent)) });
      setState(value => ({ ...value, pending: null, message: closedWithoutApply
        ? 'The pending request was closed without applying cable values. Its original key is blocked from any later Apply. Calculate and review a new proposal before applying.'
        : 'Routing and design length applied together. Installed length was preserved. The matching Apply receipt is confirmed.', error: null }));
      return true;
    } catch {
      if (live() && request.current === ticket) setState(value => ({ ...value,
        error: 'The Apply outcome or recovery update is unconfirmed. The exact command is retained. Retry pending Apply to reconcile it.' }));
      return false;
    } finally {
      if (live() && request.current === ticket) { request.current = null; setState(value => ({ ...value, busy: false })); }
    }
  }, [live, access.action]);

  const start = useCallback(async (input: PendingApplyInput): Promise<boolean> => {
    if (!live() || !latest.current.active || !ownedState.ready || ownedState.pending || request.current) return false;
    const ticket = {}; request.current = ticket;
    try {
      const stored = readStore(), owner = `${access.accountId}/${access.projectId}`;
      const existing = stored.intents.find(item => ownerOf(item) === owner);
      if (existing) { setState(value => ({ ...value, pending: Object.freeze(existing) })); request.current = null; return false; }
      if (stored.intents.length >= MAX_INTENTS) throw new Error('Pending Apply recovery is full.');
      const intent = Object.freeze(intentSchema.parse({ ...input, projectId: access.projectId, accountId: access.accountId,
        idempotencyKey: crypto.randomUUID(), createdAt: new Date().toISOString() }));
      writeStore({ version: 1, intents: [...stored.intents, intent] });
      setState(value => ({ ...value, pending: intent, message: null, error: null }));
      return await execute(intent, ticket);
    } catch {
      if (live()) setState(value => ({ ...value, ready: false, error: 'The exact Apply command could not be safely retained. No new Apply will be sent. Preserve this browser session and ask an operator to reconcile recovery storage.' }));
      if (request.current === ticket) request.current = null;
      return false;
    }
  }, [live, ownedState.ready, ownedState.pending, access.projectId, access.accountId, execute]);
  const retry = useCallback(async (): Promise<boolean> => {
    if (!live() || !latest.current.active || !ownedState.ready || !ownedState.pending || request.current) return false;
    const ticket = {}; request.current = ticket;
    return execute(ownedState.pending, ticket);
  }, [live, ownedState.ready, ownedState.pending, execute]);
  const close = useCallback(async (): Promise<boolean> => {
    if (!live() || !latest.current.active || !ownedState.ready || !ownedState.pending || request.current) return false;
    const ticket = {}; request.current = ticket;
    return execute(ownedState.pending, ticket, 'close');
  }, [live, ownedState.ready, ownedState.pending, execute]);
  return { ...ownedState, enabled: allowed, start, retry, close,
    canStart: allowed && access.active && ownedState.ready && !ownedState.pending && !ownedState.busy,
    canRetry: allowed && access.active && ownedState.ready && Boolean(ownedState.pending) && !ownedState.busy };
}
