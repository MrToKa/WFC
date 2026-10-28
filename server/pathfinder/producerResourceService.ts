import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import type { Pool } from 'pg';
import { canonicalPurposeJson, policyUuidSchema } from '../../shared/pathfinderPurposePolicy.js';
import { PRODUCER_RESOURCE_LIMITS } from '../../shared/pathfinderProducerResource.js';
import { calculationGrantAuthoritySchema, calculationGrantProvenance, grantTransaction, type CalculationGrantAuthority } from './calculationAuthority.js';
import { ViewerSessionError } from '../viewerSessions/errors.js';
import type { AuthorizedViewerResource, ViewerSessionDto, ViewerVersion } from '../viewerSessions/types.js';
import { schedulerTransaction } from './schedulerTransaction.js';

type Row = Record<string, any>;
export type ProducerResourceIdentity = { projectId: string; modelVersionId: string; sessionId: string; capability: string };
const secretPattern = /^[A-Za-z0-9_-]{43}$(?![\s\S])/;
const digest = (value: string) => createHash('sha256').update(value).digest('hex');
const equal = (a: string, b: string) => /^[a-f0-9]{64}$/.test(a) && /^[a-f0-9]{64}$/.test(b) && timingSafeEqual(Buffer.from(a, 'hex'), Buffer.from(b, 'hex'));
const fail = (code: string, status = 409): never => { throw new ViewerSessionError(code, status); };
const iso = (v: unknown) => new Date(v as string).toISOString();
type Capability = { authority: CalculationGrantAuthority; authoritySha256: string; capabilitySha256: string; session: ViewerSessionDto; requests: number; responseBytes: number };
type Revocation = Pick<Capability, 'authority' | 'authoritySha256' | 'capabilitySha256'> & { pending?: Promise<void> };
function version(row: Row): ViewerVersion {
  if (!Number.isSafeInteger(Number(row.total_bytes)) || Number(row.total_bytes) < 0 || Number(row.total_bytes) > 8 * 1024 ** 3 || !Number.isSafeInteger(row.resource_count) || row.resource_count < 0 || row.resource_count > 100000 || !Array.isArray(row.manifest?.resources)) return fail('MODEL_UNAVAILABLE');
  return { id: row.id, projectId: row.project_id, contentFingerprint: row.content_fingerprint, supportProfile: row.support_profile,
    format: row.format, sdkVersion: row.sdk_version, entrypoint: row.entrypoint, resourceCount: row.resource_count,
    totalBytes: Number(row.total_bytes), manifest: row.manifest, storagePrefix: row.storage_prefix };
}

export function createProducerResourceService(options: { pool: Pool; clock?: () => number }) {
  const { pool } = options, now = options.clock ?? Date.now;
  const capabilities = new Map<string, Capability>(), revocations = new Map<string, Revocation>(), creating = new Set<string>();
  let stopped = false;
  function find(raw: ProducerResourceIdentity): { input: ProducerResourceIdentity; stored: Capability } {
    if (stopped) return fail('VIEWER_STOPPED', 503);
    const input = { projectId: policyUuidSchema.parse(raw.projectId), modelVersionId: policyUuidSchema.parse(raw.modelVersionId), sessionId: policyUuidSchema.parse(raw.sessionId), capability: raw.capability };
    if (!secretPattern.test(input.capability ?? '')) return fail('AUTH_REQUIRED', 401);
    const stored = capabilities.get(input.sessionId);
    if (!stored || stored.session.projectId !== input.projectId || stored.session.modelVersionId !== input.modelVersionId || !equal(stored.capabilitySha256, digest(input.capability))) return fail('AUTH_REQUIRED', 401);
    if (Date.parse(stored.session.expiresAt) <= now()) return fail('SESSION_EXPIRED', 410);
    return { input, stored };
  }
  function assertSession(input: ProducerResourceIdentity, stored: Capability, s: Row): void {
    if (!s || s.id !== input.sessionId || s.project_id !== input.projectId || s.model_version_id !== input.modelVersionId || s.capability_sha256 !== stored.capabilitySha256) return fail('SESSION_REVOKED', 410);
    if (s.revoked_at) return fail('SESSION_REVOKED', 410);
    if (iso(s.expires_at) !== stored.session.expiresAt || Date.parse(s.expires_at) <= now()) return fail('SESSION_EXPIRED', 410);
    if (s.load_id !== stored.session.loadId || s.lease_id !== stored.authority.leaseId || s.installation_epoch !== stored.authority.installationEpoch || String(s.selection_revision) !== stored.authority.selectionRevision ||
      s.content_fingerprint !== stored.authority.contentFingerprint || canonicalPurposeJson(s.grant_ref) !== canonicalPurposeJson(calculationGrantProvenance(stored.authority))) return fail('SESSION_REVOKED', 410);
  }
  const service = {
    async create(input: { authority: CalculationGrantAuthority; loadId: string; signal?: AbortSignal }): Promise<{ session: ViewerSessionDto; capability: string }> {
      if (stopped) return fail('VIEWER_STOPPED', 503);
      const authority = Object.freeze(calculationGrantAuthoritySchema.parse(input.authority)), loadId = policyUuidSchema.parse(input.loadId);
      if (authority.operation !== 'prepare') return fail('ACCESS_REVOKED', 403);
      if (creating.has(authority.leaseId) || [...capabilities.values()].some(v => v.authority.leaseId === authority.leaseId)) return fail('PRODUCER_SESSION_EXISTS');
      if (capabilities.size + revocations.size + creating.size >= PRODUCER_RESOURCE_LIMITS.activeCapabilities) return fail('VIEWER_BUSY', 503);
      creating.add(authority.leaseId);
      const capability = randomBytes(32).toString('base64url'), capabilitySha256 = digest(capability), id = randomUUID();
      try {
        const session = await grantTransaction(pool, authority, 'prepare', async c => {
          const prior = (await c.query('SELECT id FROM pf_producer_resource_sessions WHERE lease_id=$1', [authority.leaseId])).rows;
          if (prior.length) return fail('PRODUCER_SESSION_EXISTS');
          const count = (await c.query<{ count: string }>('SELECT count(*)::text AS count FROM pf_producer_resource_sessions WHERE project_id=$1', [authority.projectId])).rows[0];
          if (!count || BigInt(count.count) >= BigInt(PRODUCER_RESOURCE_LIMITS.retainedSessionsPerProject)) return fail('PRODUCER_SESSION_RETENTION_LIMIT', 413);
          const at = now(), expires = Math.min(at + PRODUCER_RESOURCE_LIMITS.capabilityLifetimeMilliseconds, Date.parse(authority.leaseExpiresAt));
          if (expires <= at) return fail('SESSION_EXPIRED', 410);
          const dto: ViewerSessionDto = { sessionId: id, projectId: authority.projectId, modelVersionId: authority.modelVersionId, loadId, expiresAt: new Date(expires).toISOString(), absoluteExpiresAt: new Date(expires).toISOString() };
          await c.query(`INSERT INTO pf_producer_resource_sessions(id,project_id,model_version_id,load_id,lease_id,installation_epoch,selection_revision,content_fingerprint,capability_sha256,grant_ref,created_at,expires_at)
            VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`, [id, authority.projectId, authority.modelVersionId, loadId, authority.leaseId, authority.installationEpoch, authority.selectionRevision, authority.contentFingerprint, capabilitySha256, calculationGrantProvenance(authority), new Date(at), new Date(expires)]);
          return dto;
        }, input.signal);
        // Unknown COMMIT never installs a process capability. A restart likewise
        // cannot recover the owner secret from this hash-only session table.
        input.signal?.throwIfAborted(); if (stopped) return fail('VIEWER_STOPPED', 503);
        capabilities.set(id, { authority, authoritySha256: digest(canonicalPurposeJson(authority)), capabilitySha256, session, requests: 0, responseBytes: 0 });
        return { session: { ...session }, capability };
      } finally { creating.delete(authority.leaseId); }
    },
    async authorizeResource(raw: ProducerResourceIdentity, signal?: AbortSignal): Promise<AuthorizedViewerResource> {
      const { input, stored } = find(raw);
      const result = await grantTransaction(pool, stored.authority, 'prepare', async c => {
        const row = (await c.query<Row>(`SELECT to_jsonb(s)||jsonb_build_object('selection_revision',s.selection_revision::text) AS session,row_to_json(m) AS version FROM pf_producer_resource_sessions s
          JOIN model_versions m ON m.project_id=s.project_id AND m.id=s.model_version_id
          WHERE s.id=$1 AND s.project_id=$2 AND s.model_version_id=$3 AND s.capability_sha256=$4 FOR SHARE OF s`, [input.sessionId, input.projectId, input.modelVersionId, stored.capabilitySha256])).rows[0];
        if (!row) return fail('SESSION_NOT_FOUND', 401);
        const s = row.session;
        assertSession(input, stored, s);
        if (row.version.state !== 'ready' || row.version.health !== 'healthy' || row.version.content_fingerprint !== stored.authority.contentFingerprint) return fail('MODEL_UNAVAILABLE');
        return { session: { ...stored.session }, version: version(row.version) };
      }, signal);
      signal?.throwIfAborted(); find(input); return result;
    },
    async authorizePathFinder(raw: ProducerResourceIdentity, signal?: AbortSignal): Promise<{ authorized: true; loadId: string }> {
      const { input, stored } = find(raw);
      const result = await grantTransaction(pool, stored.authority, 'prepare', async c => {
        // grantTransaction fences issuer, current healthy model, selection,
        // content, installation and the exact live prepare lease before/after
        // this read. A broker ping needs no manifest or model resource rows.
        const s = (await c.query<Row>(`SELECT id,project_id,model_version_id,load_id,lease_id,installation_epoch,
          selection_revision::text AS selection_revision,content_fingerprint,capability_sha256,grant_ref,expires_at,revoked_at
          FROM pf_producer_resource_sessions WHERE id=$1 AND project_id=$2 AND model_version_id=$3 AND capability_sha256=$4 FOR SHARE`,
        [input.sessionId, input.projectId, input.modelVersionId, stored.capabilitySha256])).rows[0];
        if (!s) return fail('SESSION_NOT_FOUND', 401);
        assertSession(input, stored, s); return { authorized: true as const, loadId: stored.session.loadId };
      }, signal);
      signal?.throwIfAborted(); find(input); return result;
    },
    reserveRequest(input: ProducerResourceIdentity): void {
      const { stored } = find(input);
      if (stored.requests >= PRODUCER_RESOURCE_LIMITS.requests) return fail('PRODUCER_RESOURCE_BUDGET', 429);
      stored.requests++;
    },
    reserveResponse(input: ProducerResourceIdentity, bytes: number): void {
      const { stored } = find(input);
      if (!Number.isSafeInteger(bytes) || bytes < 0 || bytes > PRODUCER_RESOURCE_LIMITS.responseBytes - stored.responseBytes) return fail('PRODUCER_RESOURCE_BUDGET', 429);
      stored.responseBytes += bytes;
    },
    async revoke(input: { sessionId: string; authority: CalculationGrantAuthority }): Promise<void> {
      const id = policyUuidSchema.parse(input.sessionId), authority = calculationGrantAuthoritySchema.parse(input.authority), stored = revocations.get(id) ?? capabilities.get(id);
      if (!stored || !equal(stored.authoritySha256, digest(canonicalPurposeJson(authority)))) return fail('AUTH_REQUIRED', 401);
      let owned = revocations.get(id);
      if (!owned) {
        owned = { authority: stored.authority, authoritySha256: stored.authoritySha256, capabilitySha256: stored.capabilitySha256 };
        revocations.set(id, owned);
        // Refuse all new capability use before any awaited database operation.
        // Keep the exact cleanup owner/hash after a definite or uncertain failure.
        capabilities.delete(id);
      }
      if (owned.pending) return owned.pending;
      const cleanup = owned;
      const pending: Promise<void> = schedulerTransaction(pool, async c => {
        const result = await c.query<{ id: string }>(`UPDATE pf_producer_resource_sessions SET revoked_at=COALESCE(revoked_at,clock_timestamp())
          WHERE id=$1 AND project_id=$2 AND lease_id=$3 AND capability_sha256=$4 AND model_version_id=$5 AND installation_epoch=$6 RETURNING id`,
        [id, authority.projectId, authority.leaseId, cleanup.capabilitySha256, authority.modelVersionId, authority.installationEpoch]);
        if (result.rows.length !== 1 || result.rows[0].id !== id) return fail('SESSION_NOT_FOUND', 401);
      }).then(() => { if (revocations.get(id) === cleanup) revocations.delete(id); })
        .finally(() => { if (cleanup.pending === pending) cleanup.pending = undefined; });
      cleanup.pending = pending;
      // The shared bounded transaction awaits the known UPDATE and COMMIT. No
      // cancellation race is allowed to abandon an uncertain cleanup mutation.
      return pending;
    },
    close(): void { stopped = true; capabilities.clear(); },
  };
  return service;
}
export type ProducerResourceService = ReturnType<typeof createProducerResourceService>;
