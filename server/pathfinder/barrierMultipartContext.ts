import { createHash } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import { z } from 'zod';
import { barrierCanonicalJson } from '../../shared/pathfinderBarriers.js';
import { barrierMultipartCanonicalBytes, barrierMultipartHashInput, barrierMultipartScopeSchema, type BarrierMultipartScope } from '../../shared/pathfinderBarrierMultipart.js';
import { barrierMultipartAdmitCommandSchema, barrierMultipartSessionSchema, type BarrierMultipartAdmitCommand,
  barrierMultipartSessionCommandHashInput, type BarrierMultipartSession } from '../../shared/pathfinderBarrierMultipartSessions.js';
import { policyUuidSchema } from '../../shared/pathfinderPurposePolicy.js';
import { barrierFrameObservationHashInput, validateBarrierFrameObservation, type BarrierFrameObservation } from '../../viewer-runtime/barrier-capture.mjs';
import { BARRIER_MULTIPART_PRODUCER_PROFILE } from '../../viewer-runtime/barrier-multipart-protocol.mjs';
import { barrierRegistryTransaction } from './barrierRegistryRepository.js';
import { createBarrierMultipartRepository, type BarrierMultipartRepositoryAdapters } from './barrierMultipartRepository.js';
import { barrierFrameProjectionHash, currentBarrierScope } from './barrierScope.js';
import { PathFinderError } from './errors.js';
import type { JobPrincipal } from './jobContracts.js';

export type BarrierMultipartViewerIdentity = Readonly<{ projectId: string; modelVersionId: string; viewerSessionId: string; cookieSecret: string }>;
export const barrierMultipartProducerProfileSchema = z.object({ schemaVersion: z.literal('wfc.pf.barrier-multipart-producer.v2'), sdkVersion: z.literal('7.130.0'),
  triangleOrder: z.literal('sdk7130-rendered-triangle-order-v1'), geometryDigest: z.literal('sha256-bounded-chunk-chain-v1'),
  visibility: z.literal('selected-scope-includes-hidden-geometry-v1') }).strict();
export const barrierMultipartAdmissionBodySchema = z.object({ command: barrierMultipartAdmitCommandSchema,
  frameObservation: z.unknown().refine(validateBarrierFrameObservation), producerProfile: barrierMultipartProducerProfileSchema }).strict();
type Admission = z.infer<typeof barrierMultipartAdmissionBodySchema>;
type ProducerProfile = z.infer<typeof barrierMultipartProducerProfileSchema>;
type BindingRow = { intent_id: string; project_id: string; viewer_session_id: string; actor_id: string; login_id: string;
  model_version_id: string; model_load_id: string; scope_sha256: string; command_sha256: string; frame_sha256: string;
  frame_observation: unknown; producer_profile: unknown; context_sha256: string; effective_deadline: Date; command?: unknown; frozen?: unknown };
type ViewerRow = { user_id: string; login_id: string; login_expires_at: Date; load_id: string; selection_revision: string;
  expires_at: Date; absolute_expires_at: Date; revoked_at: Date | null; login_revoked_at: Date | null;
  active_model_version_id: string; current_selection_revision: string; state: string; health: string };
const fail = (code: string, status = 409): never => { throw new PathFinderError(code, status, 'The protected multipart Viewer context is unavailable or changed.'); };
const hash = (value: unknown) => createHash('sha256').update(barrierMultipartCanonicalBytes(value)).digest('hex');
const frameHash = (value: BarrierFrameObservation) => createHash('sha256').update(barrierCanonicalJson(barrierFrameObservationHashInput(value))).digest('hex');
const equal = (left: unknown, right: unknown) => barrierCanonicalJson(left) === barrierCanonicalJson(right);
const secretHash = (value: string) => createHash('sha256').update(value).digest('hex');
function identityCopy(input: BarrierMultipartViewerIdentity): BarrierMultipartViewerIdentity {
  const value = { ...input }; for (const id of [value.projectId, value.modelVersionId, value.viewerSessionId]) policyUuidSchema.parse(id);
  if (!/^[A-Za-z0-9_-]{43}$/.test(value.cookieSecret)) fail('BARRIER_MULTIPART_VIEWER_ACCESS_DENIED', 401); return Object.freeze(value);
}
async function connect(pool: Pool): Promise<PoolClient> {
  let expired = false, timer: ReturnType<typeof setTimeout> | undefined;
  const pending = pool.connect().then(client => { if (expired) { client.release(); return fail('BARRIER_MULTIPART_DATABASE_BUSY', 503); } return client; });
  try { return await Promise.race([pending, new Promise<never>((_, reject) => { timer = setTimeout(() => { expired = true; reject(new PathFinderError('BARRIER_MULTIPART_DATABASE_BUSY', 503)); }, 5000); })]); }
  finally { clearTimeout(timer); }
}
async function lockViewer(client: PoolClient, identity: BarrierMultipartViewerIdentity, who: JobPrincipal, expectedLoad?: string) {
  const row = (await client.query<ViewerRow>(`/* barrier-multipart:viewer-context */
    SELECT s.user_id,s.login_id,l.expires_at AS login_expires_at,s.load_id,s.selection_revision::text,s.expires_at,s.absolute_expires_at,s.revoked_at,
      l.revoked_at AS login_revoked_at,p.active_model_version_id,p.selection_revision::text AS current_selection_revision,v.state,v.health
    FROM viewer_resource_sessions s JOIN viewer_login_bindings l ON l.login_id=s.login_id AND l.user_id=s.user_id
    JOIN model_versions v ON v.project_id=s.project_id AND v.id=s.model_version_id JOIN project_model_selections p ON p.project_id=s.project_id
    WHERE s.id=$1 AND s.project_id=$2 AND s.model_version_id=$3 AND s.user_id=$4 AND s.login_id=$5 AND s.secret_hash=$6 FOR SHARE OF s,l,v,p`,
  [identity.viewerSessionId, identity.projectId, identity.modelVersionId, who.userId, who.loginId, secretHash(identity.cookieSecret)])).rows[0];
  if (!row || row.revoked_at || row.login_revoked_at || row.active_model_version_id !== identity.modelVersionId
    || row.current_selection_revision !== String(row.selection_revision) || row.state !== 'ready' || row.health !== 'healthy'
    || new Date(row.login_expires_at).getTime() !== who.loginExpiresAt || expectedLoad !== undefined && row.load_id !== expectedLoad)
    fail('BARRIER_MULTIPART_VIEWER_CHANGED');
  const absolute = Math.min(new Date(row.absolute_expires_at).getTime(), who.loginExpiresAt), deadline = Math.min(absolute, new Date(row.expires_at).getTime());
  if (!Number.isSafeInteger(deadline) || deadline <= Date.now()) fail('BARRIER_MULTIPART_VIEWER_EXPIRED');
  return { deadline, absolute, loadId: row.load_id, selectionRevision: row.current_selection_revision };
}
/** Cookie capability resolves the principal on the server; no Bearer token,
 * actor/login field, caller URL or client current-role flag enters the iframe. */
export async function resolveBarrierMultipartViewerPrincipal(pool: Pool, rawIdentity: BarrierMultipartViewerIdentity, signal?: AbortSignal): Promise<JobPrincipal> {
  const identity = identityCopy(rawIdentity); signal?.throwIfAborted(); const client = await connect(pool);
  let who: JobPrincipal;
  try {
    await client.query('BEGIN'); await client.query("SET LOCAL statement_timeout='5000ms';SET LOCAL lock_timeout='3000ms'");
    const row = (await client.query<{ user_id: string; login_id: string; login_expires_at: Date }>(`SELECT s.user_id,s.login_id,l.expires_at AS login_expires_at
      FROM viewer_resource_sessions s JOIN viewer_login_bindings l ON l.login_id=s.login_id AND l.user_id=s.user_id
      WHERE s.id=$1 AND s.project_id=$2 AND s.model_version_id=$3 AND s.secret_hash=$4`,
    [identity.viewerSessionId, identity.projectId, identity.modelVersionId, secretHash(identity.cookieSecret)])).rows[0];
    if (!row) fail('BARRIER_MULTIPART_VIEWER_ACCESS_DENIED', 401);
    who = { userId: policyUuidSchema.parse(row.user_id), loginId: policyUuidSchema.parse(row.login_id), loginExpiresAt: new Date(row.login_expires_at).getTime() };
  } finally { try { await client.query('ROLLBACK'); } finally { client.release(); } }
  let deadline = 0;
  await barrierRegistryTransaction(pool, identity.projectId, who, async locked => { deadline = (await lockViewer(locked, identity, who)).deadline; }, signal,
    () => { if (deadline <= Date.now()) fail('BARRIER_MULTIPART_VIEWER_EXPIRED'); });
  return Object.freeze(who);
}
export function barrierMultipartContextHashInput(session: BarrierMultipartSession, context: {
  viewerSessionId: string; frameObservation: BarrierFrameObservation; producerProfile: ProducerProfile; effectiveDeadline: string;
}) {
  return { domain: 'wfc.pf.barrier-multipart-context.v2', value: { intentId: session.id, scopeSha256: session.scopeSha256,
    profileSha256: session.profileSha256, viewerSessionId: context.viewerSessionId, frameObservation: context.frameObservation,
    producerProfile: context.producerProfile, effectiveDeadline: context.effectiveDeadline } };
}
function verifyFrame(frame: BarrierFrameObservation, scope: BarrierMultipartScope, identity: BarrierMultipartViewerIdentity) {
  if (!validateBarrierFrameObservation(frame) || frameHash(frame) !== frame.contentSha256 || frame.projectId !== identity.projectId
    || frame.modelVersionId !== identity.modelVersionId || frame.loadId !== scope.modelLoadId || frame.contentFingerprint !== scope.modelScope.contentFingerprint
    || barrierFrameProjectionHash({ coordinateFrame: frame.coordinateFrame, displayToWorldMetres: frame.displayToWorldMetres,
      globalOffsetMetres: frame.globalOffsetMetres }) !== scope.modelScope.captureFrameSha256) fail('BARRIER_MULTIPART_FRAME_CHANGED');
}

/** The returned repository always has the protected binding hook. Only the
 * generic foundation factory remains usable without a Viewer in isolated tests. */
export async function createProtectedBarrierMultipartRepository(pool: Pool, input: {
  identity: BarrierMultipartViewerIdentity; who: JobPrincipal; storage: BarrierMultipartRepositoryAdapters['storage'];
  admission?: Admission; intentId?: string; signal?: AbortSignal;
}) {
  const identity = identityCopy(input.identity), who = Object.freeze({ ...input.who });
  let admission: Admission | undefined, binding: BindingRow | null = null, expected: BarrierMultipartAdmitCommand;
  let viewerDeadline = 0;
  if (input.admission) {
    admission = barrierMultipartAdmissionBodySchema.parse(JSON.parse(JSON.stringify(input.admission)));
    expected = admission.command;
  } else {
    const intentId = policyUuidSchema.parse(input.intentId);
    binding = await barrierRegistryTransaction(pool, identity.projectId, who, async client => {
      const row = (await client.query<BindingRow>(`SELECT c.*,s.command,s.frozen FROM pf_barrier_multipart_viewer_contexts c
        JOIN pf_barrier_multipart_sessions s ON s.id=c.intent_id AND s.project_id=c.project_id
        WHERE c.project_id=$1 AND c.intent_id=$2 AND c.actor_id=$3 AND c.login_id=$4 FOR SHARE OF c,s`, [identity.projectId, intentId, who.userId, who.loginId])).rows[0];
      if (!row) fail('BARRIER_MULTIPART_CONTEXT_REQUIRED');
      viewerDeadline = (await lockViewer(client, identity, who, row.model_load_id)).deadline; return row;
    }, input.signal, () => { if (viewerDeadline <= Date.now()) fail('BARRIER_MULTIPART_VIEWER_EXPIRED'); });
    expected = barrierMultipartAdmitCommandSchema.parse(binding.command);
  }
  const frame = JSON.parse(JSON.stringify(admission?.frameObservation ?? binding?.frame_observation)) as BarrierFrameObservation;
  const profile = barrierMultipartProducerProfileSchema.parse(admission?.producerProfile ?? binding?.producer_profile);
  if (!equal(profile, BARRIER_MULTIPART_PRODUCER_PROFILE) || expected.scope.modelScope.projectId !== identity.projectId
    || expected.scope.modelScope.modelVersionId !== identity.modelVersionId) fail('BARRIER_MULTIPART_CONTEXT_CHANGED');
  verifyFrame(frame, expected.scope, identity);
  let absolute = 0;
  async function currentScope(client: PoolClient, projectId: string): Promise<BarrierMultipartScope> {
    const modelScope = await currentBarrierScope(client, projectId), viewer = await lockViewer(client, identity, who, expected.scope.modelLoadId);
    if (viewer.selectionRevision !== modelScope.selectionRevision) fail('BARRIER_MULTIPART_VIEWER_CHANGED');
    viewerDeadline = viewer.deadline; absolute = viewer.absolute;
    const scope = barrierMultipartScopeSchema.parse({ ...expected.scope, modelScope, modelLoadId: viewer.loadId }); verifyFrame(frame, scope, identity);
    if (!equal(scope, expected.scope)) fail('BARRIER_MULTIPART_SCOPE_CHANGED');
    if (binding) {
      const row = (await client.query<BindingRow>('SELECT * FROM pf_barrier_multipart_viewer_contexts WHERE project_id=$1 AND intent_id=$2 FOR SHARE', [projectId, binding.intent_id])).rows[0];
      if (!row || !sameBinding(row, binding)) fail('BARRIER_MULTIPART_CONTEXT_CHANGED');
      viewerDeadline = Math.min(viewerDeadline, new Date(binding.effective_deadline).getTime());
    }
    if (viewerDeadline <= Date.now()) fail('BARRIER_MULTIPART_VIEWER_EXPIRED'); return scope;
  }
  function sameBinding(left: BindingRow, right: BindingRow): boolean {
    return ['intent_id', 'project_id', 'viewer_session_id', 'actor_id', 'login_id', 'model_version_id', 'model_load_id', 'scope_sha256', 'command_sha256', 'frame_sha256', 'context_sha256']
      .every(key => left[key as keyof BindingRow] === right[key as keyof BindingRow]) && equal(left.frame_observation, right.frame_observation)
      && equal(left.producer_profile, right.producer_profile) && new Date(left.effective_deadline).getTime() === new Date(right.effective_deadline).getTime();
  }
  async function onAdmission(client: PoolClient, session: BarrierMultipartSession, duplicate: boolean) {
    if (!admission || !equal(session.command, expected)) fail('BARRIER_MULTIPART_CONTEXT_CHANGED');
    await currentScope(client, session.projectId);
    const effectiveDeadline = new Date(Math.min(new Date(session.jobDeadline).getTime(), absolute)).toISOString();
    const context = { viewerSessionId: identity.viewerSessionId, frameObservation: frame, producerProfile: profile, effectiveDeadline };
    const value: BindingRow = { intent_id: session.id, project_id: session.projectId, viewer_session_id: identity.viewerSessionId,
      actor_id: who.userId, login_id: who.loginId, model_version_id: identity.modelVersionId, model_load_id: expected.scope.modelLoadId,
      scope_sha256: session.scopeSha256, command_sha256: session.requestSha256, frame_sha256: frame.contentSha256, frame_observation: frame,
      producer_profile: profile, context_sha256: hash(barrierMultipartContextHashInput(session, context)), effective_deadline: new Date(effectiveDeadline) };
    if (duplicate) {
      const row = (await client.query<BindingRow>('SELECT * FROM pf_barrier_multipart_viewer_contexts WHERE project_id=$1 AND intent_id=$2 FOR SHARE', [session.projectId, session.id])).rows[0];
      if (!row || !sameBinding(row, value)) fail('BARRIER_MULTIPART_CONTEXT_CHANGED'); binding = row;
    } else {
      const row = (await client.query<BindingRow>(`INSERT INTO pf_barrier_multipart_viewer_contexts(intent_id,project_id,viewer_session_id,actor_id,login_id,model_version_id,model_load_id,scope_sha256,command_sha256,frame_sha256,frame_observation,producer_profile,context_sha256,effective_deadline)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb,$12::jsonb,$13,$14) RETURNING *`, [value.intent_id, value.project_id, value.viewer_session_id,
        who.userId, who.loginId, identity.modelVersionId, value.model_load_id, value.scope_sha256, value.command_sha256, value.frame_sha256, JSON.stringify(frame), JSON.stringify(profile), value.context_sha256, value.effective_deadline])).rows[0];
      if (!row || !sameBinding(row, value)) fail('BARRIER_MULTIPART_CONTEXT_CHANGED'); binding = row;
    }
    viewerDeadline = Math.min(viewerDeadline, new Date(effectiveDeadline).getTime());
  }
  if (binding) {
    const frozen = barrierMultipartSessionSchema.parse(binding.frozen), payload = { viewerSessionId: identity.viewerSessionId,
      frameObservation: frame, producerProfile: profile, effectiveDeadline: new Date(binding.effective_deadline).toISOString() };
    if (binding.viewer_session_id !== identity.viewerSessionId || binding.actor_id !== who.userId || binding.login_id !== who.loginId
      || binding.project_id !== identity.projectId || binding.model_version_id !== identity.modelVersionId || binding.model_load_id !== expected.scope.modelLoadId
      || binding.frame_sha256 !== frame.contentSha256 || frozen.id !== binding.intent_id || frozen.principal.actorId !== who.userId
      || frozen.principal.loginId !== who.loginId || !equal(frozen.command, expected) || binding.scope_sha256 !== hash(barrierMultipartHashInput('scope', expected.scope))
      || binding.scope_sha256 !== frozen.scopeSha256 || binding.command_sha256 !== hash(barrierMultipartSessionCommandHashInput(expected))
      || binding.command_sha256 !== frozen.requestSha256 || frozen.profileSha256 !== hash(barrierMultipartHashInput('profile', expected.profile))
      || binding.context_sha256 !== hash(barrierMultipartContextHashInput(frozen, payload))
      || new Date(binding.effective_deadline).getTime() > new Date(frozen.jobDeadline).getTime()) fail('BARRIER_MULTIPART_CONTEXT_CHANGED');
  }
  const repository = createBarrierMultipartRepository(pool, { storage: input.storage, currentScope, onAdmission,
    async authorizeContext(client, projectId, principal) {
      if (projectId !== identity.projectId || principal.userId !== who.userId || principal.loginId !== who.loginId || principal.loginExpiresAt !== who.loginExpiresAt)
        fail('BARRIER_MULTIPART_CONTEXT_CHANGED');
      await currentScope(client, projectId);
      const revision = (await client.query<{ revision: string }>('SELECT revision::text FROM pf_barrier_heads WHERE project_id=$1 FOR SHARE', [projectId])).rows[0]?.revision ?? '0';
      if (revision !== expected.expectedRegistryRevision) fail('BARRIER_MULTIPART_HEAD_CHANGED');
    },
    assertBeforeCommit() { if (!Number.isFinite(viewerDeadline) || viewerDeadline <= Date.now()) fail('BARRIER_MULTIPART_VIEWER_EXPIRED'); } });
  async function context() {
    if (!binding) fail('BARRIER_MULTIPART_CONTEXT_REQUIRED');
    return barrierRegistryTransaction(pool, identity.projectId, who, async client => {
      await currentScope(client, identity.projectId); const row = (await client.query<{ frozen: unknown; state: string; session_revision: string; updated_at: Date;
        lease_expires_at: Date | null; charged_bytes: string; charged_files: number; counts: unknown; roots: unknown }>('SELECT * FROM pf_barrier_multipart_sessions WHERE project_id=$1 AND id=$2 FOR SHARE', [identity.projectId, binding!.intent_id])).rows[0];
      if (!row) fail('BARRIER_MULTIPART_CONTEXT_REQUIRED');
      const frozen = barrierMultipartSessionSchema.parse(row.frozen), session = barrierMultipartSessionSchema.parse({ ...frozen, state: row.state, sessionRevision: String(row.session_revision),
        updatedAt: new Date(row.updated_at).toISOString(), leaseDeadline: row.lease_expires_at ? new Date(row.lease_expires_at).toISOString() : null,
        reservation: { ...frozen.reservation, chargedBytes: Number(row.charged_bytes), chargedFiles: row.charged_files }, counts: row.counts, roots: row.roots });
      const head = (await client.query<{ revision: string }>('SELECT revision::text FROM pf_barrier_heads WHERE project_id=$1 FOR SHARE', [identity.projectId])).rows[0]?.revision ?? '0';
      if (head !== session.command.expectedRegistryRevision) fail('BARRIER_MULTIPART_HEAD_CHANGED');
      const payload = { viewerSessionId: identity.viewerSessionId, frameObservation: frame, producerProfile: profile,
        effectiveDeadline: new Date(binding!.effective_deadline).toISOString() };
      if (binding!.scope_sha256 !== session.scopeSha256 || binding!.command_sha256 !== session.requestSha256 || binding!.context_sha256 !== hash(barrierMultipartContextHashInput(session, payload))) fail('BARRIER_MULTIPART_CONTEXT_CHANGED');
      return { schemaVersion: 'wfc.pf.barrier-multipart-context.v2' as const, session, context: { ...payload, contextSha256: binding!.context_sha256 } };
    }, input.signal, () => { if (viewerDeadline <= Date.now()) fail('BARRIER_MULTIPART_VIEWER_EXPIRED'); });
  }
  return { repository, context };
}
