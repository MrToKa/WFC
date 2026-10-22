import { createHash, randomUUID } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import {
  BARRIER_MULTIPART_PROFILE, barrierMultipartCanonicalBytes, barrierMultipartCanonicalJson, barrierMultipartHashInput,
  barrierMultipartMaskFits, barrierMultipartPageHashInput, barrierMultipartRangeHashInput, barrierMultipartScopeSchema,
  barrierMultipartSealHashInput, type BarrierMultipartFragment, type BarrierMultipartGeometryRange,
  type BarrierMultipartPage, type BarrierMultipartScope, type BarrierMultipartSeal,
} from '../../shared/pathfinderBarrierMultipart.js';
import {
  BARRIER_MULTIPART_SESSION_LIMITS as L, barrierMultipartAdmitCommandSchema, barrierMultipartAdmitReceiptSchema,
  barrierMultipartCancelCommandSchema, barrierMultipartCancelReceiptSchema, barrierMultipartListQuerySchema,
  barrierMultipartReceiptPageSchema, barrierMultipartReceiptQuerySchema, barrierMultipartReconcileCommandSchema,
  barrierMultipartSessionCommandHashInput, barrierMultipartSessionListSchema, barrierMultipartSessionSchema,
  barrierMultipartStageCommandSchema, barrierMultipartStagePageCommandSchema, barrierMultipartStagePartCommandSchema,
  barrierMultipartStageReceiptSchema, barrierMultipartStageSealCommandSchema,
  type BarrierMultipartSession, type BarrierMultipartStageReceipt,
} from '../../shared/pathfinderBarrierMultipartSessions.js';
import { policyUuidSchema } from '../../shared/pathfinderPurposePolicy.js';
import { assertLoginNotExpired, requireCurrentLogin } from './auth.js';
import { barrierRegistryTransaction } from './barrierRegistryRepository.js';
import { PathFinderError } from './errors.js';
import type { JobPrincipal } from './jobContracts.js';
import { encodeBarrierMultipartControl, type AssertBarrierMultipartReservation, type BarrierMultipartStorageTicket,
  type BarrierMultipartStoredBytes, type BarrierMultipartScannedEntry } from './barrierMultipartStorage.js';

type Storage = {
  store: (ticket: BarrierMultipartStorageTicket, bytes: Buffer, assertion: AssertBarrierMultipartReservation, options?: { signal?: AbortSignal }) => Promise<BarrierMultipartStoredBytes>;
  read: (ticket: BarrierMultipartStorageTicket, assertion: AssertBarrierMultipartReservation, options?: { signal?: AbortSignal }) => Promise<Buffer>;
};
export type BarrierMultipartRepositoryAdapters = {
  /** Server-owned protected Viewer context, including its current model LOAD,
   * exact selection and frame. Never a callback or default from an HTTP body. */
  currentScope: (client: PoolClient, projectId: string) => Promise<BarrierMultipartScope>;
  storage: Storage; assertBeforeCommit?: () => void;
  /** Trusted server-only atomic protected-Viewer binding. Public route factories
   * must supply it; historical generic storage fixtures may omit it. */
  onAdmission?: (client: PoolClient, session: BarrierMultipartSession, duplicate: boolean) => Promise<void>;
  /** Protected transport only: hold the exact Viewer/context locks through each
   * transaction, including metadata reconciliation and duplicate cancellation. */
  authorizeContext?: (client: PoolClient, projectId: string, who: JobPrincipal) => Promise<void>;
};
type SessionRow = { id: string; project_id: string; actor_id: string; login_id: string; idempotency_key: string;
  request_sha256: string; command: unknown; frozen: unknown; state: BarrierMultipartSession['state']; session_revision: string;
  reserved_bytes: string; reserved_files: number; charged_bytes: string; charged_files: number; job_deadline: Date;
  lease_token: string | null; lease_expires_at: Date | null; pending_allocation: string | null;
  counts: BarrierMultipartSession['counts']; roots: BarrierMultipartSession['roots']; created_at: Date; updated_at: Date };
type AllocationRow = { id: string; project_id: string; session_id: string; actor_id: string; login_id: string; idempotency_key: string;
  request_sha256: string; command: unknown; ticket: BarrierMultipartStorageTicket; summary: Summary; item_kind: 'page' | 'seal' | 'part';
  stream_kind: BarrierMultipartPage['kind'] | null; item_index: number; first_ordinal: string | null; record_count: number | null;
  content_sha256: string; lease_token: string; lease_expires_at: Date; expected_revision: string; state: 'pending' | 'stored' };
type ReceiptRow = { session_id: string; actor_id: string; login_id: string; allocation_id: string | null; request_sha256: string; command: unknown; receipt: unknown };
type Summary = { sourceVertices: number; sourceTriangles: number; unavailable: number; nonTriangle: number;
  referencedVertices: number; triangles: number; plannedBytes: number; partsStarted: number;
  lastPart: null | { index: number; vertices: number; triangles: number; bytes: number; refs: number; fragmentOrdinal: number } };
const emptySummary = (): Summary => ({ sourceVertices: 0, sourceTriangles: 0, unavailable: 0, nonTriangle: 0,
  referencedVertices: 0, triangles: 0, plannedBytes: 0, partsStarted: 0, lastPart: null });
const fail = (code: string, status = 409): never => { throw new PathFinderError(code, status,
  'Multipart data is unavailable or changed. Retain the exact command; staged data has no publication or routing authority.'); };
const hashBytes = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
const hashValue = (value: unknown) => hashBytes(Buffer.from(barrierMultipartCanonicalBytes(value)));
const commandHash = (value: unknown) => hashValue(barrierMultipartSessionCommandHashInput(value));
const equal = (left: unknown, right: unknown) => barrierMultipartCanonicalJson(left) === barrierMultipartCanonicalJson(right);
const iso = (value: Date | string) => new Date(value).toISOString();
const integer = (value: string | number) => { const result = Number(value); if (!Number.isSafeInteger(result) || result < 0) fail('BARRIER_MULTIPART_INTEGRITY'); return result; };
const nextRevision = (revision: string) => { const value = BigInt(revision) + 1n; if (value > 9223372036854775807n) fail('BARRIER_MULTIPART_REVISION_LIMIT', 413); return value.toString(); };
const sessionSelect = 'SELECT * FROM pf_barrier_multipart_sessions';
const allocationSelect = 'SELECT * FROM pf_barrier_multipart_allocations';
const noAuthority = { qualification: 'NOT_MEASURED', geometryValidation: 'NOT_VALIDATED', authority: 'none' } as const;

export function createBarrierMultipartRepository(pool: Pool, adapters: BarrierMultipartRepositoryAdapters) {
  if (typeof adapters.currentScope !== 'function' || typeof adapters.storage?.store !== 'function' || typeof adapters.storage?.read !== 'function')
    throw new TypeError('Trusted multipart scope and storage adapters are required.');
  const tx = <T>(projectId: string, who: JobPrincipal, operation: (client: PoolClient) => Promise<T>, signal?: AbortSignal, final?: () => void) =>
    barrierRegistryTransaction(pool, projectId, who, async client => {
      await adapters.authorizeContext?.(client, projectId, who); return operation(client);
    }, signal, () => { adapters.assertBeforeCommit?.(); final?.(); });
  function deadlines(row: SessionRow, lease?: Date): void {
    if (new Date(row.job_deadline).getTime() <= Date.now()) fail('BARRIER_MULTIPART_JOB_EXPIRED');
    if (lease && new Date(lease).getTime() <= Date.now()) fail('BARRIER_MULTIPART_LEASE_EXPIRED');
  }
  async function sessionRow(client: PoolClient, projectId: string, id: string): Promise<SessionRow> {
    const row = (await client.query<SessionRow>(sessionSelect + ' WHERE project_id=$1 AND id=$2 FOR UPDATE', [projectId, policyUuidSchema.parse(id)])).rows[0];
    if (!row) fail('BARRIER_MULTIPART_NOT_FOUND', 404); return row;
  }
  function checked(row: SessionRow, projectId: string, who: JobPrincipal): BarrierMultipartSession {
    const frozen = barrierMultipartSessionSchema.parse(row.frozen);
    if (row.actor_id !== who.userId || row.login_id !== who.loginId) fail('BARRIER_MULTIPART_OWNER_CHANGED', 403);
    if (frozen.id !== row.id || frozen.projectId !== projectId || row.project_id !== projectId
      || frozen.principal.actorId !== row.actor_id || frozen.principal.loginId !== row.login_id
      || frozen.requestSha256 !== row.request_sha256 || row.request_sha256 !== commandHash(row.command)
      || !equal(frozen.command, row.command) || frozen.command.idempotencyKey !== row.idempotency_key
      || frozen.scopeSha256 !== hashValue(barrierMultipartHashInput('scope', frozen.command.scope))
      || frozen.profileSha256 !== hashValue(barrierMultipartHashInput('profile', frozen.command.profile))
      || frozen.reservation.bytes !== integer(row.reserved_bytes) || frozen.reservation.files !== row.reserved_files
      || frozen.createdAt !== iso(row.created_at) || frozen.jobDeadline !== iso(row.job_deadline)) fail('BARRIER_MULTIPART_INTEGRITY');
    return barrierMultipartSessionSchema.parse({ ...frozen, state: row.state, sessionRevision: String(row.session_revision),
      updatedAt: iso(row.updated_at), leaseDeadline: row.lease_expires_at ? iso(row.lease_expires_at) : null,
      reservation: { ...frozen.reservation, chargedBytes: integer(row.charged_bytes), chargedFiles: row.charged_files }, counts: row.counts, roots: row.roots });
  }
  async function current(client: PoolClient, projectId: string, session: BarrierMultipartSession, who: JobPrincipal): Promise<void> {
    const scope = barrierMultipartScopeSchema.parse(await adapters.currentScope(client, projectId));
    if (!equal(scope, session.command.scope)) fail('BARRIER_MULTIPART_SCOPE_CHANGED');
    const revision = (await client.query<{ revision: string }>('SELECT revision::text FROM pf_barrier_heads WHERE project_id=$1 FOR UPDATE', [projectId])).rows[0]?.revision ?? '0';
    if (revision !== session.command.expectedRegistryRevision) fail('BARRIER_MULTIPART_HEAD_CHANGED');
    const role = (await client.query<{ is_admin: boolean }>('SELECT is_admin FROM users WHERE id=$1 FOR SHARE', [who.userId])).rows[0];
    if (role?.is_admin !== true) fail('ADMIN_REQUIRED', 403);
    await requireCurrentLogin(client, who); assertLoginNotExpired(who);
  }
  async function totals(client: PoolClient) {
    await client.query('SELECT pg_advisory_xact_lock(1447449393,132609)');
    const row = (await client.query<{ bytes: string; files: string }>('SELECT COALESCE(sum(reserved_bytes),0)::text AS bytes,(COALESCE(sum(reserved_files),0)+1)::text AS files FROM pf_barrier_multipart_sessions')).rows[0];
    const globalReservedBytes = integer(row?.bytes ?? '0'), globalReservedFiles = integer(row?.files ?? '1');
    if (globalReservedBytes > L.totalBytes || globalReservedFiles > L.totalFiles) fail('BARRIER_MULTIPART_GLOBAL_QUOTA', 413);
    return { globalReservedBytes, globalReservedFiles };
  }
  async function prior(client: PoolClient, projectId: string, who: JobPrincipal, key: string, raw: unknown): Promise<unknown | null> {
    const row = (await client.query<ReceiptRow>('SELECT * FROM pf_barrier_multipart_receipts WHERE project_id=$1 AND actor_id=$2 AND idempotency_key=$3', [projectId, who.userId, key])).rows[0];
    if (!row) return null;
    if (row.login_id !== who.loginId) fail('BARRIER_MULTIPART_OWNER_CHANGED', 403);
    if (row.request_sha256 !== commandHash(raw) || !equal(row.command, raw)) fail('BARRIER_MULTIPART_IDEMPOTENCY_CONFLICT');
    return row.receipt;
  }
  async function assertReservation(client: PoolClient, projectId: string, who: JobPrincipal, ticket: BarrierMultipartStorageTicket,
    signal?: AbortSignal, entry?: BarrierMultipartScannedEntry, mode: 'pending' | 'stored' = 'pending') {
    signal?.throwIfAborted(); const row = await sessionRow(client, projectId, ticket.sessionId), session = checked(row, projectId, who);
    const allocation = (await client.query<AllocationRow>(allocationSelect + ' WHERE project_id=$1 AND session_id=$2 AND id=$3 FOR UPDATE', [projectId, row.id, ticket.allocationId])).rows[0];
    if (!allocation || !equal(allocation.ticket, ticket) || allocation.request_sha256 !== ticket.requestSha256
      || allocation.actor_id !== who.userId || allocation.login_id !== who.loginId || allocation.content_sha256 !== ticket.sha256
      || allocation.request_sha256 !== commandHash(allocation.command)) fail('BARRIER_MULTIPART_RESERVATION_CHANGED');
    if (row.state === 'cancelled') fail('BARRIER_MULTIPART_CANCELLED');
    if (mode === 'pending' && (row.pending_allocation !== allocation.id || row.lease_token !== allocation.lease_token
        || allocation.state !== 'pending' || iso(row.lease_expires_at!) !== iso(allocation.lease_expires_at)
        || String(row.session_revision) !== allocation.expected_revision)) fail('BARRIER_MULTIPART_RESERVATION_CHANGED');
    if (mode === 'stored' && (allocation.state !== 'stored' || (await client.query('SELECT 1 FROM pf_barrier_multipart_receipts WHERE project_id=$1 AND session_id=$2 AND allocation_id=$3 AND actor_id=$4 AND login_id=$5 AND request_sha256=$6',
      [projectId, row.id, allocation.id, who.userId, who.loginId, allocation.request_sha256])).rows.length !== 1)) fail('BARRIER_MULTIPART_STORED_RECEIPT_REQUIRED');
    const lease = mode === 'pending' ? allocation.lease_expires_at : undefined;
    deadlines(row, lease); await current(client, projectId, session, who); deadlines(row, lease);
    if (entry) {
      const retained = (await client.query<AllocationRow>(allocationSelect + " WHERE ticket->>'blobId'=$1 AND ticket->>'kind'=$2", [entry.blobId, entry.kind])).rows[0];
      if (!retained || retained.ticket.blobId !== entry.blobId || retained.ticket.kind !== entry.kind
        || retained.ticket.projectId !== retained.project_id || retained.ticket.sessionId !== retained.session_id
        || retained.ticket.allocationId !== retained.id || retained.ticket.requestSha256 !== retained.request_sha256
        || retained.ticket.reservedBytes !== 2 * retained.ticket.bytes || retained.ticket.reservedFiles !== 2
        || entry.allocationId === null && entry.bytes !== retained.ticket.bytes
        || entry.allocationId !== null && (entry.allocationId !== retained.id || entry.bytes > retained.ticket.bytes))
        fail('BARRIER_MULTIPART_FOREIGN_STORAGE');
    }
    const result = await totals(client); signal?.throwIfAborted(); assertLoginNotExpired(who); return result;
  }
  async function admit(projectId: string, who: JobPrincipal, raw: unknown, signal?: AbortSignal) {
    const command = barrierMultipartAdmitCommandSchema.parse(raw); let deadline: number | null = null;
    return tx(projectId, who, async client => {
      const old = (await client.query<SessionRow>(sessionSelect + ' WHERE project_id=$1 AND actor_id=$2 AND idempotency_key=$3 FOR UPDATE', [projectId, who.userId, command.idempotencyKey])).rows[0];
      if (old) {
        if (old.request_sha256 !== commandHash(command) || !equal(old.command, command)) fail('BARRIER_MULTIPART_IDEMPOTENCY_CONFLICT');
        const session = checked(old, projectId, who); await adapters.onAdmission?.(client, session, true);
        return barrierMultipartAdmitReceiptSchema.parse({ schemaVersion: 'wfc.pf.barrier-multipart-admit-receipt.v2', session, duplicate: true });
      }
      if ((await client.query('SELECT 1 FROM pf_barrier_multipart_allocations WHERE project_id=$1 AND actor_id=$2 AND idempotency_key=$3 UNION ALL SELECT 1 FROM pf_barrier_multipart_receipts WHERE project_id=$1 AND actor_id=$2 AND idempotency_key=$3', [projectId, who.userId, command.idempotencyKey])).rows.length)
        fail('BARRIER_MULTIPART_IDEMPOTENCY_CONFLICT');
      const created = Date.now(), jobDeadline = Math.min(created + L.jobMilliseconds, who.loginExpiresAt);
      const session = barrierMultipartSessionSchema.parse({ schemaVersion: 'wfc.pf.barrier-multipart-session.v2', id: randomUUID(), projectId,
        state: 'admitted', sessionRevision: '0', principal: { kind: 'current-login-admin', actorId: who.userId, loginId: who.loginId },
        command, requestSha256: commandHash(command), scopeSha256: hashValue(barrierMultipartHashInput('scope', command.scope)),
        profileSha256: hashValue(barrierMultipartHashInput('profile', command.profile)), createdAt: new Date(created).toISOString(), updatedAt: new Date(created).toISOString(),
        jobDeadline: new Date(jobDeadline).toISOString(), leaseDeadline: null, reservation: { ...command.reservation, chargedBytes: 0, chargedFiles: 0 },
        counts: { pages: 0, seals: 0, parts: 0 }, roots: { nodes: null, fragments: null, 'geometry-ranges': null, plan: null }, ...noAuthority });
      await current(client, projectId, session, who); const reserved = await totals(client);
      if (reserved.globalReservedBytes + command.reservation.bytes > L.totalBytes || reserved.globalReservedFiles + command.reservation.files > L.totalFiles
        || command.reservation.files < 2) fail('BARRIER_MULTIPART_GLOBAL_QUOTA', 413);
      const inserted = (await client.query<SessionRow>(`INSERT INTO pf_barrier_multipart_sessions(id,project_id,actor_id,login_id,idempotency_key,request_sha256,command,frozen,state,
        reserved_bytes,reserved_files,job_deadline,counts,roots,created_at,updated_at) VALUES($1,$2,$3,$4,$5,$6,$7::jsonb,$8::jsonb,'admitted',$9,$10,$11,$12::jsonb,$13::jsonb,$14,$14) RETURNING *`,
      [session.id, projectId, who.userId, who.loginId, command.idempotencyKey, session.requestSha256, JSON.stringify(command), JSON.stringify(session),
        command.reservation.bytes, command.reservation.files, new Date(jobDeadline), JSON.stringify(session.counts), JSON.stringify(session.roots), new Date(created)])).rows[0];
      if (!inserted || !equal(checked(inserted, projectId, who), session)) fail('BARRIER_MULTIPART_INTEGRITY');
      await adapters.onAdmission?.(client, session, false);
      await current(client, projectId, session, who); deadline = jobDeadline;
      return barrierMultipartAdmitReceiptSchema.parse({ schemaVersion: 'wfc.pf.barrier-multipart-admit-receipt.v2', session, duplicate: false });
    }, signal, () => { if (deadline !== null && deadline <= Date.now()) fail('BARRIER_MULTIPART_JOB_EXPIRED'); });
  }
  async function storedPage(client: PoolClient, sessionId: string, kind: BarrierMultipartPage['kind'], index: number): Promise<BarrierMultipartPage | null> {
    const row = (await client.query<{ command: { page: BarrierMultipartPage }; summary: Summary }>("SELECT command,summary FROM pf_barrier_multipart_allocations WHERE session_id=$1 AND item_kind='page' AND stream_kind=$2 AND item_index=$3 AND state='stored'", [sessionId, kind, index])).rows[0];
    return row?.command.page ?? null;
  }
  async function recordAt(client: PoolClient, sessionId: string, kind: 'nodes' | 'fragments' | 'geometry-ranges', ordinal: number) {
    const row = (await client.query<{ command: { page: BarrierMultipartPage } }>("SELECT command FROM pf_barrier_multipart_allocations WHERE session_id=$1 AND item_kind='page' AND stream_kind=$2 AND state='stored' AND first_ordinal<=$3 AND first_ordinal+record_count>$3", [sessionId, kind, ordinal])).rows[0];
    if (!row) fail('BARRIER_MULTIPART_FOREIGN_REFERENCE'); return row.command.page.records[ordinal - row.command.page.firstOrdinal];
  }
  async function validatePage(client: PoolClient, session: BarrierMultipartSession, page: BarrierMultipartPage): Promise<Summary> {
    if (page.pageSha256 !== hashValue(barrierMultipartPageHashInput(page))) fail('BARRIER_MULTIPART_PAGE_HASH');
    if (session.roots[page.kind] !== null) fail('BARRIER_MULTIPART_STREAM_SEALED');
    const maximum = page.kind === 'nodes' ? BARRIER_MULTIPART_PROFILE.limits.nodes : page.kind === 'fragments'
      ? BARRIER_MULTIPART_PROFILE.limits.fragments : BARRIER_MULTIPART_PROFILE.limits.ranges;
    if (page.firstOrdinal + page.records.length > maximum) fail('BARRIER_MULTIPART_STREAM_LIMIT', 413);
    const priorKind = ({ fragments: 'nodes', 'geometry-ranges': 'fragments', plan: 'geometry-ranges' } as const)[page.kind as 'fragments' | 'geometry-ranges' | 'plan'];
    if (priorKind && session.roots[priorKind] === null) fail('BARRIER_MULTIPART_STREAM_ORDER');
    const previous = page.index === 0 ? null : await storedPage(client, session.id, page.kind, page.index - 1);
    if (page.index === 0 ? page.firstOrdinal !== 0 || page.previousPageSha256 !== null
      : !previous || page.firstOrdinal !== previous.firstOrdinal + previous.records.length || page.previousPageSha256 !== previous.pageSha256)
      fail('BARRIER_MULTIPART_PAGE_ORDER');
    const summary = emptySummary(), parentCount = session.command.scope.selectedParents.length;
    let previousRecord = previous?.records.at(-1);
    let part: Summary['lastPart'] = null;
    if (page.kind === 'plan' && previous) part = (await client.query<{ summary: Summary }>("SELECT summary FROM pf_barrier_multipart_allocations WHERE session_id=$1 AND item_kind='page' AND stream_kind='plan' AND item_index=$2 AND state='stored'", [session.id, page.index - 1])).rows[0]?.summary.lastPart ?? null;
    let offset = 0;
    for (const record of page.records) {
      if ('membershipMask' in record && !barrierMultipartMaskFits(record.membershipMask, parentCount)) fail('BARRIER_MULTIPART_MEMBERSHIP');
      if (page.kind === 'nodes' && 'dbId' in record) {
        if (previousRecord && 'dbId' in previousRecord && record.dbId <= previousRecord.dbId) fail('BARRIER_MULTIPART_NODE_ORDER');
      } else if (page.kind === 'fragments' && 'fragmentId' in record) {
        if (previousRecord && 'fragmentId' in previousRecord && record.fragmentId <= previousRecord.fragmentId) fail('BARRIER_MULTIPART_FRAGMENT_ORDER');
        const owner = await recordAt(client, session.id, 'nodes', record.ownerNodeOrdinal);
        if (!('dbId' in owner) || owner.dbId !== record.ownerDbId || owner.membershipMask !== record.membershipMask) fail('BARRIER_MULTIPART_FOREIGN_OWNER');
        summary.sourceVertices += record.sourceVertexCount; summary.sourceTriangles += record.sourceTriangleCount;
        if (record.primitive === 'unavailable') summary.unavailable++; else if (record.primitive !== 'triangles') summary.nonTriangle++;
      } else if (page.kind === 'geometry-ranges' && 'sourceIndicesSha256' in record) {
        const source = await recordAt(client, session.id, 'fragments', record.fragmentOrdinal) as BarrierMultipartFragment;
        if (source.primitive !== 'triangles' || record.sourceGeometrySha256 !== source.sourceGeometrySha256 || record.transformSha256 !== source.transformSha256
          || record.membershipMask !== source.membershipMask || record.referencedVertexCount > source.sourceVertexCount
          || record.triangleStart + record.triangleCount > source.sourceTriangleCount) fail('BARRIER_MULTIPART_RANGE_SOURCE');
        const last = previousRecord && 'sourceIndicesSha256' in previousRecord ? previousRecord : null;
        if (!last ? record.fragmentOrdinal !== 0 || record.triangleStart !== 0 : record.fragmentOrdinal === last.fragmentOrdinal
          ? record.triangleStart !== last.triangleStart + last.triangleCount : record.fragmentOrdinal !== last.fragmentOrdinal + 1 || record.triangleStart !== 0)
          fail('BARRIER_MULTIPART_RANGE_COVERAGE');
        if (last && record.fragmentOrdinal !== last.fragmentOrdinal) {
          const lastSource = await recordAt(client, session.id, 'fragments', last.fragmentOrdinal) as BarrierMultipartFragment;
          if (last.triangleStart + last.triangleCount !== lastSource.sourceTriangleCount) fail('BARRIER_MULTIPART_RANGE_COVERAGE');
        }
        summary.referencedVertices += record.referencedVertexCount; summary.triangles += record.triangleCount;
      } else if (page.kind === 'plan' && 'rangeSha256' in record) {
        if (record.rangeOrdinal !== page.firstOrdinal + offset) fail('BARRIER_MULTIPART_PLAN_ORDER');
        const source = await recordAt(client, session.id, 'geometry-ranges', record.rangeOrdinal) as BarrierMultipartGeometryRange;
        if (record.rangeSha256 !== hashValue(barrierMultipartRangeHashInput(source)) || record.fragmentOrdinal !== source.fragmentOrdinal
          || record.triangleStart !== source.triangleStart || record.triangleCount !== source.triangleCount || record.referencedVertexCount !== source.referencedVertexCount)
          fail('BARRIER_MULTIPART_PLAN_SOURCE');
        if (!part || record.partIndex === part.index + 1) {
          if (record.partIndex !== (part ? part.index + 1 : 0)) fail('BARRIER_MULTIPART_PART_ORDER');
          part = { index: record.partIndex, vertices: 0, triangles: 0, bytes: 8192, refs: 0, fragmentOrdinal: -1 }; summary.partsStarted++;
          summary.plannedBytes += 8192;
        }
        if (record.partIndex !== part.index) fail('BARRIER_MULTIPART_PART_ORDER');
        part.vertices += record.referencedVertexCount; part.triangles += record.triangleCount; part.bytes += record.plannedEncodedBytesUpperBound;
        if (part.fragmentOrdinal !== record.fragmentOrdinal) part.refs++; part.fragmentOrdinal = record.fragmentOrdinal;
        const bounds = BARRIER_MULTIPART_PROFILE.part;
        if (part.vertices > bounds.vertices || part.triangles > bounds.triangles || part.bytes > bounds.bytes || part.refs > bounds.fragmentRefs) fail('BARRIER_MULTIPART_PART_LIMIT', 413);
        summary.referencedVertices += record.referencedVertexCount; summary.triangles += record.triangleCount; summary.plannedBytes += record.plannedEncodedBytesUpperBound;
      } else fail('BARRIER_MULTIPART_PAGE_INVALID');
      previousRecord = record; offset++;
    }
    summary.lastPart = part; return summary;
  }
  async function validateSeal(client: PoolClient, session: BarrierMultipartSession, seal: BarrierMultipartSeal) {
    if (seal.sealSha256 !== hashValue(barrierMultipartSealHashInput(seal))) fail('BARRIER_MULTIPART_SEAL_HASH');
    if (session.roots[seal.kind] !== null) fail('BARRIER_MULTIPART_STREAM_SEALED');
    const aggregate = (await client.query<{ pages: number; records: string; source_vertices: string; source_triangles: string; unavailable: string; non_triangle: string;
      referenced_vertices: string; triangles: string; planned_bytes: string; parts: string }>(`SELECT count(*)::integer AS pages,COALESCE(sum(record_count),0)::text AS records,
      COALESCE(sum((summary->>'sourceVertices')::numeric),0)::text AS source_vertices,COALESCE(sum((summary->>'sourceTriangles')::numeric),0)::text AS source_triangles,
      COALESCE(sum((summary->>'unavailable')::numeric),0)::text AS unavailable,COALESCE(sum((summary->>'nonTriangle')::numeric),0)::text AS non_triangle,
      COALESCE(sum((summary->>'referencedVertices')::numeric),0)::text AS referenced_vertices,COALESCE(sum((summary->>'triangles')::numeric),0)::text AS triangles,
      COALESCE(sum((summary->>'plannedBytes')::numeric),0)::text AS planned_bytes,COALESCE(sum((summary->>'partsStarted')::numeric),0)::text AS parts
      FROM pf_barrier_multipart_allocations WHERE session_id=$1 AND item_kind='page' AND stream_kind=$2 AND state='stored'`, [session.id, seal.kind])).rows[0];
    const last = await storedPage(client, session.id, seal.kind, seal.pageCount - 1);
    if (!aggregate || aggregate.pages !== seal.pageCount || integer(aggregate.records) !== seal.recordCount || last?.pageSha256 !== seal.tailPageSha256) fail('BARRIER_MULTIPART_SEAL_COVERAGE');
    if (seal.kind === 'nodes' || seal.kind === 'fragments') {
      for (const [ordinal, parent] of session.command.scope.selectedParents.entries()) {
        if (seal.kind === 'nodes') {
          const nodes = (await client.query<{ record: { membershipMask: string } }>(`SELECT entry AS record FROM pf_barrier_multipart_allocations allocation
            CROSS JOIN LATERAL jsonb_array_elements(allocation.command->'page'->'records') entry
            WHERE allocation.session_id=$1 AND allocation.item_kind='page' AND allocation.stream_kind='nodes' AND allocation.state='stored'
            AND (entry->>'dbId')::bigint=$2 LIMIT 2`, [session.id, parent.dbId])).rows;
          if (nodes.length !== 1 || (BigInt('0x' + nodes[0].record.membershipMask) & (1n << BigInt(ordinal))) === 0n) fail('BARRIER_MULTIPART_PARENT_NODE_COVERAGE');
        } else {
          const allowed = [...'0123456789abcdef'].filter((_, digit) => (digit & (1 << (ordinal % 4))) !== 0);
          // This is intentionally a PostgreSQL text[] predicate, not a JSON document.
          const present = (await client.query(`SELECT 1 FROM pf_barrier_multipart_allocations allocation
            CROSS JOIN LATERAL jsonb_array_elements(allocation.command->'page'->'records') entry
            WHERE allocation.session_id=$1 AND allocation.item_kind='page' AND allocation.stream_kind='fragments' AND allocation.state='stored'
            AND substring(entry->>'membershipMask' FROM $2 FOR 1)=ANY($3::text[]) LIMIT 1`, [session.id, 32 - Math.floor(ordinal / 4), allowed])).rows.length;
          if (present !== 1) fail('BARRIER_MULTIPART_PARENT_FRAGMENT_COVERAGE');
        }
      }
    }
    let expected: unknown;
    if (seal.kind === 'nodes') expected = { nodes: integer(aggregate.records) };
    else if (seal.kind === 'fragments') expected = { fragments: integer(aggregate.records), sourceVertices: integer(aggregate.source_vertices),
      sourceTriangles: integer(aggregate.source_triangles), unavailable: integer(aggregate.unavailable), nonTriangle: integer(aggregate.non_triangle) };
    else if (seal.kind === 'geometry-ranges') {
      const end = last!.records.at(-1) as BarrierMultipartGeometryRange, source = await recordAt(client, session.id, 'fragments', end.fragmentOrdinal) as BarrierMultipartFragment;
      const fragments = (await client.query<{ command: { seal: { totals: { fragments: number; sourceTriangles: number; unavailable: number; nonTriangle: number } } } }>("SELECT command FROM pf_barrier_multipart_allocations WHERE session_id=$1 AND item_kind='seal' AND stream_kind='fragments' AND state='stored'", [session.id])).rows[0]?.command.seal;
      if (!fragments || fragments.totals.unavailable || fragments.totals.nonTriangle || end.fragmentOrdinal !== fragments.totals.fragments - 1
        || end.triangleStart + end.triangleCount !== source.sourceTriangleCount || integer(aggregate.triangles) !== fragments.totals.sourceTriangles) fail('BARRIER_MULTIPART_RANGE_COVERAGE');
      expected = { ranges: integer(aggregate.records), referencedVertices: integer(aggregate.referenced_vertices), triangles: integer(aggregate.triangles) };
    } else expected = { parts: integer(aggregate.parts), ranges: integer(aggregate.records), referencedVertices: integer(aggregate.referenced_vertices), triangles: integer(aggregate.triangles),
      plannedEncodedBytesUpperBound: integer(aggregate.planned_bytes), nodeSealSha256: session.roots.nodes, fragmentSealSha256: session.roots.fragments, rangeSealSha256: session.roots['geometry-ranges'] };
    if (!equal(seal.totals, expected)) fail('BARRIER_MULTIPART_SEAL_TOTALS');
    if (seal.kind === 'plan') {
      const ranges = (await client.query<{ command: { seal: { recordCount: number } } }>("SELECT command FROM pf_barrier_multipart_allocations WHERE session_id=$1 AND item_kind='seal' AND stream_kind='geometry-ranges' AND state='stored'", [session.id])).rows[0]?.command.seal;
      if (!ranges || ranges.recordCount !== seal.recordCount) fail('BARRIER_MULTIPART_PLAN_COVERAGE');
    }
  }
  async function stage(projectId: string, who: JobPrincipal, raw: unknown, payload?: Buffer, signal?: AbortSignal): Promise<BarrierMultipartStageReceipt> {
    const command = barrierMultipartStageCommandSchema.parse(raw), requestSha256 = commandHash(command);
    if ('payload' in command && (!Buffer.isBuffer(payload) || payload.length !== command.payload.bytes)) fail('BARRIER_MULTIPART_PART_BYTES', 400);
    const bytes = 'page' in command ? encodeBarrierMultipartControl(command.page) : 'seal' in command ? encodeBarrierMultipartControl(command.seal) : Buffer.from(payload!);
    if ('payload' in command && (command.payload.bytes !== bytes.length || command.payload.sha256 !== hashBytes(bytes))) fail('BARRIER_MULTIPART_PART_BYTES', 400);
    let reservationDeadline: number | null = null;
    const admitted = await tx(projectId, who, async client => {
      const row = await sessionRow(client, projectId, command.intentId), session = checked(row, projectId, who);
      const replay = await prior(client, projectId, who, command.idempotencyKey, command);
      if (replay) return { replay: barrierMultipartStageReceiptSchema.parse({ ...(replay as object), duplicate: true }) };
      const pending = (await client.query<AllocationRow>(allocationSelect + ' WHERE project_id=$1 AND actor_id=$2 AND idempotency_key=$3', [projectId, who.userId, command.idempotencyKey])).rows[0];
      if (pending) {
        if (pending.login_id !== who.loginId) fail('BARRIER_MULTIPART_OWNER_CHANGED', 403);
        if (pending.request_sha256 !== requestSha256 || !equal(pending.command, command)) fail('BARRIER_MULTIPART_IDEMPOTENCY_CONFLICT');
        fail('BARRIER_MULTIPART_COMMAND_UNCERTAIN', 503);
      }
      if ((await client.query(sessionSelect + ' WHERE project_id=$1 AND actor_id=$2 AND idempotency_key=$3', [projectId, who.userId, command.idempotencyKey])).rows.length) fail('BARRIER_MULTIPART_IDEMPOTENCY_CONFLICT');
      if (row.state === 'cancelled') fail('BARRIER_MULTIPART_CANCELLED');
      if (row.pending_allocation !== null) fail('BARRIER_MULTIPART_COMMAND_UNCERTAIN', 503);
      if (String(row.session_revision) !== command.expectedSessionRevision || session.scopeSha256 !== command.scopeSha256 || session.profileSha256 !== command.profileSha256) fail('BARRIER_MULTIPART_SESSION_CHANGED');
      deadlines(row); await current(client, projectId, session, who);
      const summary = 'page' in command ? await validatePage(client, session, command.page) : emptySummary();
      if ('seal' in command) await validateSeal(client, session, command.seal);
      if ('payload' in command) {
        const plan = (await client.query<{ command: { seal: { totals: { parts: number } } } }>("SELECT command FROM pf_barrier_multipart_allocations WHERE session_id=$1 AND item_kind='seal' AND stream_kind='plan' AND state='stored'", [session.id])).rows[0]?.command.seal;
        if (session.roots.plan !== command.planSealSha256 || !plan || command.partIndex >= plan.totals.parts) fail('BARRIER_MULTIPART_PART_PLAN');
        const bound = (await client.query<{ bytes: string; ranges: number }>(`SELECT (COALESCE(sum((entry->>'plannedEncodedBytesUpperBound')::bigint),0)+8192)::text AS bytes,count(*)::integer AS ranges
          FROM pf_barrier_multipart_allocations allocation CROSS JOIN LATERAL jsonb_array_elements(allocation.command->'page'->'records') entry
          WHERE allocation.session_id=$1 AND allocation.item_kind='page' AND allocation.stream_kind='plan' AND allocation.state='stored' AND (entry->>'partIndex')::integer=$2`, [session.id, command.partIndex])).rows[0];
        if (!bound || bound.ranges < 1 || command.payload.bytes > integer(bound.bytes)) fail('BARRIER_MULTIPART_PART_LIMIT', 413);
      }
      const kind = 'page' in command ? 'page' : 'seal' in command ? 'seal' : 'part', stream = 'page' in command ? command.page.kind : 'seal' in command ? command.seal.kind : null,
        index = 'page' in command ? command.page.index : 'seal' in command ? 0 : command.partIndex;
      if ((await client.query("SELECT 1 FROM pf_barrier_multipart_allocations WHERE session_id=$1 AND item_kind=$2 AND stream_kind IS NOT DISTINCT FROM $3 AND item_index=$4", [session.id, kind, stream, index])).rows.length) fail('BARRIER_MULTIPART_SLOT_CONFLICT');
      const ticket: BarrierMultipartStorageTicket = Object.freeze({ projectId, sessionId: session.id, allocationId: randomUUID(), blobId: randomUUID(), requestSha256,
        sha256: hashBytes(bytes), bytes: bytes.length, kind: kind === 'part' ? 'part' : 'control', reservedBytes: bytes.length * 2, reservedFiles: 2 });
      if (integer(row.charged_bytes) + ticket.reservedBytes > session.reservation.bytes || row.charged_files + 2 > session.reservation.files) fail('BARRIER_MULTIPART_SESSION_QUOTA', 413);
      await totals(client); const token = randomUUID(), lease = new Date(Math.min(Date.now() + L.leaseMilliseconds, new Date(row.job_deadline).getTime(), who.loginExpiresAt));
      if (lease.getTime() <= Date.now()) fail('BARRIER_MULTIPART_LEASE_EXPIRED');
      const allocation = (await client.query<AllocationRow>(`INSERT INTO pf_barrier_multipart_allocations(id,project_id,session_id,actor_id,login_id,idempotency_key,request_sha256,command,ticket,summary,item_kind,stream_kind,item_index,first_ordinal,record_count,content_sha256,lease_token,lease_expires_at,expected_revision,state)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9::jsonb,$10::jsonb,$11,$12,$13,$14,$15,$16,$17,$18,$19,'pending') RETURNING *`,
      [ticket.allocationId, projectId, session.id, who.userId, who.loginId, command.idempotencyKey, requestSha256, JSON.stringify(command), JSON.stringify(ticket), JSON.stringify(summary), kind, stream, index,
        'page' in command ? command.page.firstOrdinal : null, 'page' in command ? command.page.records.length : null, ticket.sha256, token, lease, command.expectedSessionRevision])).rows[0];
      if (!allocation || allocation.id !== ticket.allocationId || !equal(allocation.ticket, ticket) || allocation.request_sha256 !== requestSha256
        || !equal(allocation.command, command) || !equal(allocation.summary, summary) || allocation.lease_token !== token || iso(allocation.lease_expires_at) !== iso(lease)) fail('BARRIER_MULTIPART_RESERVATION_CHANGED');
      const changed = (await client.query<SessionRow>("UPDATE pf_barrier_multipart_sessions SET state='staging',charged_bytes=charged_bytes+$3,charged_files=charged_files+2,lease_token=$4,lease_expires_at=$5,pending_allocation=$6,updated_at=$7 WHERE project_id=$1 AND id=$2 AND session_revision=$8 AND pending_allocation IS NULL RETURNING *", [projectId, session.id, ticket.reservedBytes, token, lease, ticket.allocationId, new Date(), command.expectedSessionRevision])).rows[0];
      if (!changed || changed.pending_allocation !== ticket.allocationId || changed.lease_token !== token || integer(changed.charged_bytes) !== integer(row.charged_bytes) + ticket.reservedBytes
        || changed.charged_files !== row.charged_files + 2) fail('BARRIER_MULTIPART_SESSION_CHANGED');
      checked(changed, projectId, who);
      await current(client, projectId, session, who); deadlines(row, lease); reservationDeadline = lease.getTime(); return { ticket, token, lease };
    }, signal, () => { if (reservationDeadline !== null && reservationDeadline <= Date.now()) fail('BARRIER_MULTIPART_LEASE_EXPIRED'); });
    if ('replay' in admitted) return barrierMultipartStageReceiptSchema.parse(admitted.replay);
    const { ticket, token, lease } = admitted;
    const assertion: AssertBarrierMultipartReservation = (value, entry) => tx(projectId, who, client => assertReservation(client, projectId, who, value, signal, entry), signal,
      () => { if (lease.getTime() <= Date.now()) fail('BARRIER_MULTIPART_LEASE_EXPIRED'); });
    const stored = await adapters.storage.store(ticket, bytes, assertion, { signal });
    let finalDeadline: number | null = null;
    return tx(projectId, who, async client => {
      const row = await sessionRow(client, projectId, ticket.sessionId), session = checked(row, projectId, who);
      if (row.pending_allocation !== ticket.allocationId || row.lease_token !== token || String(row.session_revision) !== command.expectedSessionRevision) fail('BARRIER_MULTIPART_RESERVATION_CHANGED');
      await assertReservation(client, projectId, who, ticket, signal);
      const readback = await adapters.storage.read(ticket, (value, entry) => assertReservation(client, projectId, who, value, signal, entry), { signal });
      if (!readback.equals(bytes) || !equal(stored, { blobId: ticket.blobId, sha256: ticket.sha256, bytes: ticket.bytes, durability: 'file-and-directory-fsynced' })) fail('BARRIER_MULTIPART_STORAGE_INTEGRITY');
      const sessionRevision = nextRevision(command.expectedSessionRevision), base = { schemaVersion: 'wfc.pf.barrier-multipart-stage-receipt.v2', intentId: session.id,
        sessionRevision, commandSha256: requestSha256, scopeSha256: session.scopeSha256, profileSha256: session.profileSha256, stored, duplicate: false, ...noAuthority };
      const receipt = barrierMultipartStageReceiptSchema.parse('page' in command ? { ...base, kind: 'page', pageKind: command.page.kind, index: command.page.index,
        firstOrdinal: command.page.firstOrdinal, recordCount: command.page.records.length, previousPageSha256: command.page.previousPageSha256, pageSha256: command.page.pageSha256 }
        : 'seal' in command ? { ...base, kind: 'seal', sealKind: command.seal.kind, sealSha256: command.seal.sealSha256, pageCount: command.seal.pageCount, recordCount: command.seal.recordCount, tailPageSha256: command.seal.tailPageSha256 }
          : { ...base, kind: 'part', partIndex: command.partIndex, planSealSha256: command.planSealSha256 });
      const counts = { ...session.counts }, roots = { ...session.roots }; if ('page' in command) counts.pages++; else if ('seal' in command) { counts.seals++; roots[command.seal.kind] = command.seal.sealSha256; } else counts.parts++;
      if ((await client.query("UPDATE pf_barrier_multipart_allocations SET state='stored' WHERE project_id=$1 AND id=$2 AND state='pending' RETURNING id", [projectId, ticket.allocationId])).rows.length !== 1) fail('BARRIER_MULTIPART_RESERVATION_CHANGED');
      const saved = (await client.query<{ receipt: unknown }>('INSERT INTO pf_barrier_multipart_receipts(project_id,session_id,actor_id,login_id,idempotency_key,allocation_id,request_sha256,command,receipt) VALUES($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9::jsonb) RETURNING receipt',
        [projectId, session.id, who.userId, who.loginId, command.idempotencyKey, ticket.allocationId, requestSha256, JSON.stringify(command), JSON.stringify(receipt)])).rows[0];
      if (!saved || !equal(saved.receipt, receipt)) fail('BARRIER_MULTIPART_RECEIPT_INTEGRITY');
      const changed = (await client.query<SessionRow>('UPDATE pf_barrier_multipart_sessions SET session_revision=$3,counts=$4::jsonb,roots=$5::jsonb,lease_token=NULL,lease_expires_at=NULL,pending_allocation=NULL,updated_at=$6 WHERE project_id=$1 AND id=$2 AND session_revision=$7 AND pending_allocation=$8 AND lease_token=$9 RETURNING *',
        [projectId, session.id, sessionRevision, JSON.stringify(counts), JSON.stringify(roots), new Date(), command.expectedSessionRevision, ticket.allocationId, token])).rows[0];
      if (!changed || !equal(checked(changed, projectId, who).counts, counts) || !equal(changed.roots, roots)
        || changed.pending_allocation !== null || changed.lease_token !== null || String(changed.session_revision) !== sessionRevision) fail('BARRIER_MULTIPART_SESSION_CHANGED');
      await current(client, projectId, session, who); deadlines(row, lease); finalDeadline = lease.getTime(); return receipt;
    }, signal, () => { if (finalDeadline !== null && finalDeadline <= Date.now()) fail('BARRIER_MULTIPART_LEASE_EXPIRED'); });
  }
  const get = (projectId: string, who: JobPrincipal, intentId: string, signal?: AbortSignal) => tx(projectId, who,
    async client => checked(await sessionRow(client, projectId, intentId), projectId, who), signal);
  const list = (projectId: string, who: JobPrincipal, raw: unknown = { cursor: 0, limit: L.listPageSize }, signal?: AbortSignal) => tx(projectId, who, async client => {
    const query = barrierMultipartListQuerySchema.parse(raw), rows = (await client.query<SessionRow>(sessionSelect + ' WHERE project_id=$1 AND actor_id=$2 AND login_id=$3 ORDER BY created_at,id LIMIT $4 OFFSET $5', [projectId, who.userId, who.loginId, query.limit + 1, query.cursor])).rows;
    return barrierMultipartSessionListSchema.parse({ schemaVersion: 'wfc.pf.barrier-multipart-session-list.v2', sessions: rows.slice(0, query.limit).map(row => checked(row, projectId, who)), nextCursor: rows.length > query.limit ? query.cursor + query.limit : null });
  }, signal);
  const receipts = (projectId: string, who: JobPrincipal, raw: unknown, signal?: AbortSignal) => tx(projectId, who, async client => {
    const query = barrierMultipartReceiptQuerySchema.parse(raw); checked(await sessionRow(client, projectId, query.intentId), projectId, who);
    const rows = (await client.query<{ receipt: unknown }>("SELECT receipt FROM pf_barrier_multipart_receipts WHERE project_id=$1 AND session_id=$2 AND actor_id=$3 AND login_id=$4 AND allocation_id IS NOT NULL ORDER BY created_at,idempotency_key LIMIT $5 OFFSET $6", [projectId, query.intentId, who.userId, who.loginId, query.limit + 1, query.cursor])).rows;
    return barrierMultipartReceiptPageSchema.parse({ schemaVersion: 'wfc.pf.barrier-multipart-receipt-page.v2', intentId: query.intentId, receipts: rows.slice(0, query.limit).map(row => barrierMultipartStageReceiptSchema.parse(row.receipt)), nextCursor: rows.length > query.limit ? query.cursor + query.limit : null });
  }, signal);
  const reconcile = (projectId: string, who: JobPrincipal, raw: unknown, signal?: AbortSignal) => tx(projectId, who, async client => {
    const query = barrierMultipartReconcileCommandSchema.parse(raw); checked(await sessionRow(client, projectId, query.intentId), projectId, who);
    const row = (await client.query<ReceiptRow>('SELECT * FROM pf_barrier_multipart_receipts WHERE project_id=$1 AND session_id=$2 AND actor_id=$3 AND login_id=$4 AND idempotency_key=$5', [projectId, query.intentId, who.userId, who.loginId, query.idempotencyKey])).rows[0];
    if (!row) fail('BARRIER_MULTIPART_COMMAND_UNCERTAIN', 503);
    if (row.request_sha256 !== query.commandSha256 || row.request_sha256 !== commandHash(row.command)) fail('BARRIER_MULTIPART_IDEMPOTENCY_CONFLICT');
    return row.allocation_id === null ? barrierMultipartCancelReceiptSchema.parse({ ...(row.receipt as object), duplicate: true }) : barrierMultipartStageReceiptSchema.parse({ ...(row.receipt as object), duplicate: true });
  }, signal);
  const cancel = (projectId: string, who: JobPrincipal, raw: unknown, signal?: AbortSignal) => tx(projectId, who, async client => {
    const command = barrierMultipartCancelCommandSchema.parse(raw), row = await sessionRow(client, projectId, command.intentId), session = checked(row, projectId, who);
    const replay = await prior(client, projectId, who, command.idempotencyKey, command); if (replay) return barrierMultipartCancelReceiptSchema.parse({ ...(replay as object), duplicate: true });
    if ((await client.query('SELECT 1 FROM pf_barrier_multipart_allocations WHERE project_id=$1 AND actor_id=$2 AND idempotency_key=$3 UNION ALL SELECT 1 FROM pf_barrier_multipart_sessions WHERE project_id=$1 AND actor_id=$2 AND idempotency_key=$3', [projectId, who.userId, command.idempotencyKey])).rows.length) fail('BARRIER_MULTIPART_IDEMPOTENCY_CONFLICT');
    if (row.state === 'cancelled' || command.expectedSessionRevision !== session.sessionRevision || command.scopeSha256 !== session.scopeSha256 || command.profileSha256 !== session.profileSha256) fail('BARRIER_MULTIPART_SESSION_CHANGED');
    await current(client, projectId, session, who);
    const updated = barrierMultipartSessionSchema.parse({ ...session, state: 'cancelled', sessionRevision: nextRevision(session.sessionRevision), updatedAt: new Date().toISOString(), leaseDeadline: null });
    const receipt = barrierMultipartCancelReceiptSchema.parse({ schemaVersion: 'wfc.pf.barrier-multipart-cancel-receipt.v2', session: updated, commandSha256: commandHash(command), duplicate: false });
    const cancelled = (await client.query<SessionRow>("UPDATE pf_barrier_multipart_sessions SET state='cancelled',session_revision=$3,lease_token=NULL,lease_expires_at=NULL,pending_allocation=NULL,updated_at=$4 WHERE project_id=$1 AND id=$2 AND session_revision=$5 RETURNING *", [projectId, row.id, updated.sessionRevision, new Date(updated.updatedAt), session.sessionRevision])).rows[0];
    if (!cancelled || !equal(checked(cancelled, projectId, who), updated)) fail('BARRIER_MULTIPART_SESSION_CHANGED');
    const saved = (await client.query<{ receipt: unknown }>('INSERT INTO pf_barrier_multipart_receipts(project_id,session_id,actor_id,login_id,idempotency_key,allocation_id,request_sha256,command,receipt) VALUES($1,$2,$3,$4,$5,NULL,$6,$7::jsonb,$8::jsonb) RETURNING receipt', [projectId, row.id, who.userId, who.loginId, command.idempotencyKey, commandHash(command), JSON.stringify(command), JSON.stringify(receipt)])).rows[0];
    if (!saved || !equal(saved.receipt, receipt)) fail('BARRIER_MULTIPART_RECEIPT_INTEGRITY');
    await current(client, projectId, session, who); return receipt;
  }, signal);
  async function readPage(projectId: string, who: JobPrincipal, intentId: string, kind: BarrierMultipartPage['kind'], index: number, signal?: AbortSignal): Promise<BarrierMultipartPage> {
    if (!['nodes', 'fragments', 'geometry-ranges', 'plan'].includes(kind) || !Number.isSafeInteger(index) || index < 0 || index >= BARRIER_MULTIPART_PROFILE.limits.pages) fail('BARRIER_MULTIPART_PAGE_QUERY', 400);
    let jobDeadline: number | null = null;
    return tx(projectId, who, async client => {
      const row = await sessionRow(client, projectId, intentId), session = checked(row, projectId, who); deadlines(row);
      const allocation = (await client.query<AllocationRow>(allocationSelect + " WHERE project_id=$1 AND session_id=$2 AND item_kind='page' AND stream_kind=$3 AND item_index=$4 AND state='stored' FOR SHARE", [projectId, session.id, kind, index])).rows[0];
      if (!allocation) fail('BARRIER_MULTIPART_PAGE_NOT_FOUND', 404);
      const command = barrierMultipartStagePageCommandSchema.parse(allocation.command);
      if (command.intentId !== session.id || command.page.kind !== kind || command.page.index !== index
        || command.scopeSha256 !== session.scopeSha256 || command.profileSha256 !== session.profileSha256) fail('BARRIER_MULTIPART_PAGE_INTEGRITY');
      const bytes = await adapters.storage.read(allocation.ticket, (ticket, entry) => assertReservation(client, projectId, who, ticket, signal, entry, 'stored'), { signal });
      if (!bytes.equals(encodeBarrierMultipartControl(command.page))) fail('BARRIER_MULTIPART_PAGE_INTEGRITY');
      await current(client, projectId, session, who); deadlines(row); jobDeadline = new Date(row.job_deadline).getTime(); return command.page;
    }, signal, () => { if (jobDeadline !== null && jobDeadline <= Date.now()) fail('BARRIER_MULTIPART_JOB_EXPIRED'); });
  }
  /** Internal bounded opaque-byte read only. It proves storage/currentness,
   * never codec validity, collision qualification or publication authority. */
  async function readPart(projectId: string, who: JobPrincipal, intentId: string, index: number, signal?: AbortSignal): Promise<Buffer> {
    if (!Number.isSafeInteger(index) || index < 0 || index >= BARRIER_MULTIPART_PROFILE.limits.parts) fail('BARRIER_MULTIPART_PART_QUERY', 400);
    let jobDeadline: number | null = null;
    return tx(projectId, who, async client => {
      const row = await sessionRow(client, projectId, intentId), session = checked(row, projectId, who); deadlines(row);
      const allocation = (await client.query<AllocationRow>(allocationSelect + " WHERE project_id=$1 AND session_id=$2 AND item_kind='part' AND item_index=$3 AND state='stored' FOR SHARE", [projectId, session.id, index])).rows[0];
      if (!allocation) fail('BARRIER_MULTIPART_PART_NOT_FOUND', 404);
      const command = barrierMultipartStagePartCommandSchema.parse(allocation.command);
      if (command.intentId !== session.id || command.partIndex !== index || command.planSealSha256 !== session.roots.plan
        || command.scopeSha256 !== session.scopeSha256 || command.profileSha256 !== session.profileSha256
        || allocation.ticket.sha256 !== command.payload.sha256 || allocation.ticket.bytes !== command.payload.bytes) fail('BARRIER_MULTIPART_PART_INTEGRITY');
      const bytes = await adapters.storage.read(allocation.ticket, (ticket, entry) => assertReservation(client, projectId, who, ticket, signal, entry, 'stored'), { signal });
      if (bytes.length !== command.payload.bytes || createHash('sha256').update(bytes).digest('hex') !== command.payload.sha256) fail('BARRIER_MULTIPART_PART_INTEGRITY');
      await current(client, projectId, session, who); deadlines(row); jobDeadline = new Date(row.job_deadline).getTime(); return bytes;
    }, signal, () => { if (jobDeadline !== null && jobDeadline <= Date.now()) fail('BARRIER_MULTIPART_JOB_EXPIRED'); });
  }
  return { admit, begin: admit, get, list, receipts, reconcile, cancel, readPage, readPart,
    stagePage: (projectId: string, who: JobPrincipal, raw: unknown, signal?: AbortSignal) => stage(projectId, who, barrierMultipartStagePageCommandSchema.parse(raw), undefined, signal),
    stageSeal: (projectId: string, who: JobPrincipal, raw: unknown, signal?: AbortSignal) => stage(projectId, who, barrierMultipartStageSealCommandSchema.parse(raw), undefined, signal),
    stagePart: (projectId: string, who: JobPrincipal, raw: unknown, bytes: Buffer, signal?: AbortSignal) => stage(projectId, who, barrierMultipartStagePartCommandSchema.parse(raw), bytes, signal) };
}
export type BarrierMultipartRepository = ReturnType<typeof createBarrierMultipartRepository>;
