import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import type { Pool } from 'pg';
import { z } from 'zod';
import { canonicalPurposeJson, policyUuidSchema, policyRevisionSchema, policyHashSchema } from '../../shared/pathfinderPurposePolicy.js';
import { calculationGrantProvenanceSchema } from '../../shared/pathfinderCalculationGrant.js';
import { RECALCULATION_LIMITS } from '../../shared/pathfinderRecalculation.js';
import { calculationAuthorityOwnerHash, calculationGrantAuthoritySchema, grantTransaction, type CalculationGrantAuthority } from './calculationAuthority.js';
import { createCalculationGrantRepository, newCalculationGrantLeaseOwner } from './calculationGrantRepository.js';
import { enrollGrantGenerationInTransaction, readGrantGenerationCandidates, type GrantGenerationCandidate, type GrantRecalculationAdapter } from './grantRecalculation.js';
import { grantWorkerRecoveryAdapter, type GrantWorkerRecoveryAdapter } from './grantWorkerRecovery.js';
import type { GrantJobClaimRecovery } from './grantWorkerAuthority.js';
import { schedulerTransaction } from './schedulerTransaction.js';
import { pathFinderRoot } from './storage.js';
import { PathFinderError } from './errors.js';

const PURPOSE = 'generation-admission-only-no-engine' as const;
const scopeSchema = z.object({ projectId: policyUuidSchema, generation: policyRevisionSchema, controlRevision: policyRevisionSchema,
  authorityEpoch: policyRevisionSchema, provenance: calculationGrantProvenanceSchema, modelVersionId: policyUuidSchema,
  selectionRevision: policyRevisionSchema, contentFingerprint: policyHashSchema }).strict();
type AdmissionScope = z.infer<typeof scopeSchema>;
const fail = (code: string): never => { throw new PathFinderError(code, 503); };
const equal = (a: unknown, b: unknown) => canonicalPurposeJson(a) === canonicalPurposeJson(b);
/** Separate UUIDv5 namespace: this is a private admission owner key, never a pf_jobs identity. */
export function grantAdmissionOwnerKey(raw: AdmissionScope): string {
  const scope = scopeSchema.parse(raw);
  const bytes = createHash('sha1').update(Buffer.from('157d879869205dc4895f8c3af0179cd8', 'hex'))
    .update(canonicalPurposeJson({ purpose: PURPOSE, ...scope })).digest().subarray(0, 16);
  bytes[6] = (bytes[6] & 0x0f) | 0x50; bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
export const grantAdmissionRecordSchema = scopeSchema.extend({ schemaVersion: z.literal('wfc.pf.private-grant-admission.v1'),
  purpose: z.literal(PURPOSE), id: policyUuidSchema, leaseId: policyUuidSchema, ownerSha256: policyHashSchema }).strict()
  .refine(v => v.provenance.projectId === v.projectId && v.id === grantAdmissionOwnerKey(scopeSchema.parse({ projectId: v.projectId,
    generation: v.generation, controlRevision: v.controlRevision, authorityEpoch: v.authorityEpoch, provenance: v.provenance,
    modelVersionId: v.modelVersionId, selectionRevision: v.selectionRevision, contentFingerprint: v.contentFingerprint })));
export type GrantAdmissionRecord = z.infer<typeof grantAdmissionRecordSchema>;
export type GrantAdmissionJournal = {
  list(): Promise<GrantAdmissionRecord[]>;
  retain(record: GrantAdmissionRecord): Promise<void>;
  retire(record: GrantAdmissionRecord): Promise<void>;
};
export const GRANT_ADMISSION_LIMITS = Object.freeze({ entries: 4096, recordBytes: 16384, journalBytes: 8 * 1024 ** 2 });
function privateOwner(stat: { mode: number; uid: number }): boolean {
  return process.platform === 'win32' || (stat.mode & 0o077) === 0 && (typeof process.getuid !== 'function' || stat.uid === process.getuid());
}
/** Dedicated admission metadata, never a directory scan of worker calculate-owner intents. */
export function createGrantAdmissionJournal(): GrantAdmissionJournal {
  const sync = async (dir: string) => { const h = await fs.open(dir, 'r'); try { await h.sync(); } finally { await h.close(); } };
  const directory = async () => {
    const root = await pathFinderRoot(), dir = path.join(root, 'grant-admission-recovery'); let created = false;
    try { await fs.mkdir(dir, { mode: 0o700 }); created = true; } catch (e) { if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e; }
    const stat = await fs.lstat(dir);
    if (!stat.isDirectory() || stat.isSymbolicLink() || !privateOwner(stat) || await fs.realpath(dir) !== path.resolve(dir)) return fail('GRANT_ADMISSION_JOURNAL_PATH');
    if (created) await sync(root); return dir;
  };
  const read = async (filename: string): Promise<{ record: GrantAdmissionRecord; bytes: Buffer; ino: number; dev: number }> => {
    const before = await fs.lstat(filename);
    if (!before.isFile() || before.isSymbolicLink() || before.nlink !== 1 || before.size > GRANT_ADMISSION_LIMITS.recordBytes || !privateOwner(before)) return fail('GRANT_ADMISSION_JOURNAL_PATH');
    const h = await fs.open(filename, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    try {
      const opened = await h.stat();
      if (opened.ino !== before.ino || opened.dev !== before.dev || !opened.isFile() || opened.nlink !== 1 || !privateOwner(opened) || opened.size > GRANT_ADMISSION_LIMITS.recordBytes) return fail('GRANT_ADMISSION_JOURNAL_PATH');
      const bytes = await h.readFile(); if (bytes.length > GRANT_ADMISSION_LIMITS.recordBytes) return fail('GRANT_ADMISSION_JOURNAL_LIMIT');
      let raw: unknown; try { raw = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); } catch { return fail('GRANT_ADMISSION_JOURNAL_INVALID'); }
      const parsed = grantAdmissionRecordSchema.safeParse(raw);
      if (!parsed.success || !bytes.equals(Buffer.from(canonicalPurposeJson(parsed.data))) || path.basename(filename) !== parsed.data.id + '.json') return fail('GRANT_ADMISSION_JOURNAL_INVALID');
      return { record: parsed.data, bytes, ino: opened.ino, dev: opened.dev };
    } finally { await h.close(); }
  };
  return {
    async list() {
      const dir = await directory(), opened = await fs.opendir(dir), names: string[] = [];
      for await (const entry of opened) {
        if (names.length >= GRANT_ADMISSION_LIMITS.entries || !/^[a-f0-9-]{36}\.json$/.test(entry.name)) return fail('GRANT_ADMISSION_JOURNAL_LIMIT');
        names.push(entry.name);
      }
      const records: GrantAdmissionRecord[] = []; let bytes = 0;
      for (const name of names.sort()) { const loaded = await read(path.join(dir, name)); bytes += loaded.bytes.length;
        if (bytes > GRANT_ADMISSION_LIMITS.journalBytes) return fail('GRANT_ADMISSION_JOURNAL_LIMIT'); records.push(loaded.record); }
      return records;
    },
    async retain(raw) {
      const record = grantAdmissionRecordSchema.parse(raw), dir = await directory(), filename = path.join(dir, record.id + '.json');
      const bytes = Buffer.from(canonicalPurposeJson(record)); if (bytes.length > GRANT_ADMISSION_LIMITS.recordBytes) return fail('GRANT_ADMISSION_JOURNAL_LIMIT');
      const existing = await this.list();
      if (existing.some(r => r.id === record.id)) { if (!existing.some(r => equal(r, record))) return fail('GRANT_ADMISSION_JOURNAL_CONFLICT'); return; }
      if (existing.length >= GRANT_ADMISSION_LIMITS.entries) return fail('GRANT_ADMISSION_JOURNAL_LIMIT');
      let h;
      try { h = await fs.open(filename, 'wx', 0o600); await h.writeFile(bytes); await h.sync(); }
      catch (e) { if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e; if (!(await read(filename)).bytes.equals(bytes)) return fail('GRANT_ADMISSION_JOURNAL_CONFLICT'); }
      finally { await h?.close(); }
      await sync(dir);
    },
    async retire(raw) {
      const record = grantAdmissionRecordSchema.parse(raw), dir = await directory(), filename = path.join(dir, record.id + '.json');
      let prior: Awaited<ReturnType<typeof read>>;
      try { prior = await read(filename); } catch (e) { if ((e as NodeJS.ErrnoException).code === 'ENOENT') return; throw e; }
      if (!equal(prior.record, record)) return fail('GRANT_ADMISSION_JOURNAL_CONFLICT');
      const stat = await fs.lstat(filename);
      if (!stat.isFile() || stat.isSymbolicLink() || stat.ino !== prior.ino || stat.dev !== prior.dev || stat.nlink !== 1) return fail('GRANT_ADMISSION_JOURNAL_CONFLICT');
      await fs.unlink(filename); await sync(dir);
    },
  };
}
type GrantRepository = Pick<ReturnType<typeof createCalculationGrantRepository>, 'claim' | 'release'>;
export type GrantRecalculationProducerOptions = {
  repository?: GrantRepository; recovery?: GrantWorkerRecoveryAdapter; journal?: GrantAdmissionJournal;
  readCandidates?: typeof readGrantGenerationCandidates; enroll?: typeof enrollGrantGenerationInTransaction;
  transaction?: typeof grantTransaction; beforeTick?: (signal: AbortSignal) => Promise<void>;
  pollMilliseconds?: number; failureBackoffMilliseconds?: number; now?: () => number; onError?: (code: string) => void;
};
function candidateScope(candidate: GrantGenerationCandidate): AdmissionScope {
  const g = candidate.grant;
  return scopeSchema.parse({ projectId: candidate.projectId, generation: candidate.generation, controlRevision: candidate.controlRevision,
    authorityEpoch: candidate.authorityEpoch, provenance: { kind: 'calculation-grant', projectId: g.projectId, grantId: g.id,
      grantRevision: g.grantRevision, grantEpoch: g.grantEpoch, installationEpoch: g.installationEpoch, issuerId: g.enabledBy,
      issuerAdminRevision: g.issuerAdminRevision }, modelVersionId: candidate.modelVersionId, selectionRevision: candidate.selectionRevision,
    contentFingerprint: candidate.contentFingerprint });
}
function ownerIntent(record: GrantAdmissionRecord, value: GrantJobClaimRecovery): void {
  const c = value.claim;
  if (value.projectId !== record.projectId || value.jobId !== record.id || !equal(value.provenance, record.provenance) ||
    c.leaseId !== record.leaseId || calculationAuthorityOwnerHash(c.ownerToken) !== record.ownerSha256 || c.operation !== 'calculate' ||
    c.projectId !== record.projectId || c.grantId !== record.provenance.grantId || c.grantRevision !== record.provenance.grantRevision ||
    c.grantEpoch !== record.provenance.grantEpoch || c.installationEpoch !== record.provenance.installationEpoch ||
    c.modelVersionId !== record.modelVersionId || c.selectionRevision !== record.selectionRevision || c.contentFingerprint !== record.contentFingerprint)
    return fail('GRANT_ADMISSION_RECOVERY_CONFLICT');
}
/** This module never starts an engine: only these exact purpose/key/owner-bound admission leases have a no-engine join proof. */
async function recoverAdmission(pool: Pool, record: GrantAdmissionRecord, repository: GrantRepository, recovery: GrantWorkerRecoveryAdapter,
  journal: GrantAdmissionJournal, now: number, completedOwnIntent?: GrantJobClaimRecovery): Promise<void> {
  grantAdmissionRecordSchema.parse(record);
  const intent = await recovery.read({ projectId: record.projectId, jobId: record.id }); if (intent) ownerIntent(record, intent);
  const observed = await schedulerTransaction(pool, async c => {
    await c.query("SELECT pg_advisory_xact_lock(hashtext('wfc-pathfinder-calculation-grant-lease-v1'))");
    const row = (await c.query<Record<string, unknown>>(`SELECT id,project_id,grant_id,grant_revision::text,grant_epoch::text,installation_epoch,
      issuer_id,issuer_admin_revision::text,operation,model_version_id,selection_revision::text,content_fingerprint,owner_sha256,state,expires_at
      FROM pf_calculation_grant_leases WHERE id=$1 FOR UPDATE`, [record.leaseId])).rows[0];
    if (!row) return null;
    const p = record.provenance;
    if (row.id !== record.leaseId || row.project_id !== record.projectId || row.grant_id !== p.grantId || row.grant_revision !== p.grantRevision ||
      row.grant_epoch !== p.grantEpoch || row.installation_epoch !== p.installationEpoch || row.issuer_id !== p.issuerId ||
      row.issuer_admin_revision !== p.issuerAdminRevision || row.operation !== 'calculate' || row.model_version_id !== record.modelVersionId ||
      row.selection_revision !== record.selectionRevision || row.content_fingerprint !== record.contentFingerprint || row.owner_sha256 !== record.ownerSha256)
      return fail('GRANT_ADMISSION_RECOVERY_CONFLICT');
    if (!['active', 'released'].includes(String(row.state))) return fail('CALCULATION_GRANT_LEASE_QUARANTINED');
    if (row.state === 'released') return { released: true as const };
    if (!intent) return fail('CALCULATION_GRANT_LEASE_RECOVERY_REQUIRED');
    const expires = new Date(row.expires_at as string | number | Date); if (!Number.isFinite(expires.getTime())) return fail('GRANT_ADMISSION_RECOVERY_CONFLICT');
    // Another backend may still own this live admission. Its immutable final guard
    // would stop publication after a release, but recovery must not keep cancelling it.
    if (expires.getTime() > now && !completedOwnIntent) return fail('GRANT_ADMISSION_LEASE_IN_PROGRESS');
    if (completedOwnIntent) ownerIntent(record, completedOwnIntent);
    return { released: false as const, authority: calculationGrantAuthoritySchema.parse({ ...intent.claim, kind: 'calculation-grant',
      issuerId: p.issuerId, issuerAdminRevision: p.issuerAdminRevision, leaseExpiresAt: expires.toISOString() }) };
  });
  if (observed && !observed.released) await repository.release(observed.authority);
  if (intent) await recovery.retire(intent);
  await journal.retire(record);
}

/** Calculation admission only. Geometry/browser production, engine execution and Apply are separate authorities. */
export function createGrantRecalculationProducer(pool: Pool, adapter: GrantRecalculationAdapter, options: GrantRecalculationProducerOptions = {}) {
  const poll = options.pollMilliseconds ?? 1000, backoff = options.failureBackoffMilliseconds ?? 30000;
  if (!Number.isSafeInteger(poll) || poll < 250 || poll > 15000 || !Number.isSafeInteger(backoff) || backoff < 5000 || backoff > 60000)
    throw new Error('Invalid grant recalculation producer cadence.');
  const repository = options.repository ?? createCalculationGrantRepository(pool), recovery = options.recovery ?? grantWorkerRecoveryAdapter,
    journal = options.journal ?? createGrantAdmissionJournal(), readCandidates = options.readCandidates ?? readGrantGenerationCandidates,
    enroll = options.enroll ?? enrollGrantGenerationInTransaction, transaction = options.transaction ?? grantTransaction, now = options.now ?? Date.now;
  const controller = new AbortController(), states = new Map<string, { scope: string; settled: boolean; retryAt: number }>(),
    recoveryRetry = new Map<string, number>();
  let loop: Promise<void> | undefined, ticking: Promise<void> | undefined, lastErrorCode: string | null = null, cursor: string | null = null;
  const report = (error: unknown) => {
    lastErrorCode = error instanceof PathFinderError && /^[A-Z][A-Z0-9_]{0,95}$/.test(error.code) ? error.code : 'GRANT_RECALCULATION_PRODUCER_UNAVAILABLE';
    try { options.onError?.(lastErrorCode); } catch { lastErrorCode = 'GRANT_RECALCULATION_OBSERVER_FAILED'; }
  };
  async function runTick() {
    try {
      await options.beforeTick?.(controller.signal); controller.signal.throwIfAborted();
      let budget: number = RECALCULATION_LIMITS.producerProjectsPerTick;
      const pending = await journal.list();
      if (pending.length > GRANT_ADMISSION_LIMITS.entries) return fail('GRANT_ADMISSION_JOURNAL_LIMIT');
      const pendingIds = new Set(pending.map(r => r.id));
      for (const id of recoveryRetry.keys()) if (!pendingIds.has(id)) recoveryRetry.delete(id);
      for (const raw of pending) {
        const record = grantAdmissionRecordSchema.parse(raw);
        if (budget === 0 || controller.signal.aborted) break;
        if ((recoveryRetry.get(record.id) ?? 0) > now()) continue;
        budget--;
        try { await recoverAdmission(pool, record, repository, recovery, journal, now()); recoveryRetry.delete(record.id); }
        catch (error) { recoveryRetry.set(record.id, now() + backoff); report(error); }
      }
      if (!budget || controller.signal.aborted) return;
      const candidates = await readCandidates(pool, { limit: budget, signal: controller.signal, afterProjectId: cursor });
      if (candidates.length > budget) return fail('CALCULATION_GRANT_CANDIDATE_INTEGRITY');
      cursor = candidates.length === budget ? candidates.at(-1)!.projectId : null;
      for (const candidate of candidates) {
        controller.signal.throwIfAborted();
        const scope = candidateScope(candidate), id = grantAdmissionOwnerKey(scope), previous = states.get(candidate.projectId);
        if (previous?.scope === id && (previous.settled || previous.retryAt > now()) || pendingIds.has(id)) continue;
        if (!states.has(candidate.projectId) && states.size >= GRANT_ADMISSION_LIMITS.entries) return fail('GRANT_ADMISSION_BACKOFF_LIMIT');
        const claim = { projectId: scope.projectId, grantId: scope.provenance.grantId, grantRevision: scope.provenance.grantRevision,
          grantEpoch: scope.provenance.grantEpoch, installationEpoch: scope.provenance.installationEpoch, operation: 'calculate' as const,
          modelVersionId: scope.modelVersionId, selectionRevision: scope.selectionRevision, contentFingerprint: scope.contentFingerprint,
          ...newCalculationGrantLeaseOwner() };
        const record = grantAdmissionRecordSchema.parse({ ...scope, schemaVersion: 'wfc.pf.private-grant-admission.v1', purpose: PURPOSE,
          id, leaseId: claim.leaseId, ownerSha256: calculationAuthorityOwnerHash(claim.ownerToken) });
        const intent: GrantJobClaimRecovery = { projectId: scope.projectId, jobId: id, provenance: scope.provenance, claim };
        let retained = false;
        try {
          await journal.retain(record); retained = true; await recovery.retain(intent);
          const authority = await repository.claim(claim, controller.signal);
          await transaction(pool, authority, 'calculate', c => enroll(c, { authority, generation: scope.generation,
            controlRevision: scope.controlRevision, authorityEpoch: scope.authorityEpoch, preferences: candidate.grant.preferences,
            timeoutMilliseconds: candidate.grant.timeoutMilliseconds, signal: controller.signal, adapter }), controller.signal);
          states.set(candidate.projectId, { scope: id, settled: true, retryAt: 0 });
          await repository.release(authority); await recovery.retire(intent); await journal.retire(record);
          lastErrorCode = null;
        } catch (error) {
          const current = states.get(candidate.projectId);
          if (!(current?.scope === id && current.settled)) states.set(candidate.projectId, { scope: id, settled: false, retryAt: now() + backoff });
          if (retained) {
            try { await recoverAdmission(pool, record, repository, recovery, journal, now(), intent); }
            catch (cleanupError) { recoveryRetry.set(id, now() + backoff); report(cleanupError); }
          }
          if (!controller.signal.aborted) report(error);
        }
      }
    } catch (error) { if (!controller.signal.aborted) report(error); }
  }
  const producer = {
    get lastErrorCode() { return lastErrorCode; },
    tick(): Promise<void> { if (controller.signal.aborted) return Promise.resolve(); return ticking ??= runTick().finally(() => { ticking = undefined; }); },
    start(): void { if (loop || controller.signal.aborted) return; loop = (async () => { while (!controller.signal.aborted) {
      await producer.tick(); await delay(poll, undefined, { signal: controller.signal }).catch(() => undefined);
    } })(); },
    async stop(): Promise<void> { controller.abort(); await ticking; await loop; },
  };
  return producer;
}
