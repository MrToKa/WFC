import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import { constants, type Stats } from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import type { Pool } from 'pg';
import { canonicalPurposeJson, policyUuidSchema, policyHashSchema, policyRevisionSchema } from '../../shared/pathfinderPurposePolicy.js';
import { calculationGrantSchema, calculationGrantProvenanceSchema, CALCULATION_GRANT_LIMITS, type CalculationGrant } from '../../shared/pathfinderCalculationGrant.js';
import { preparationAggregateV2Schema } from '../../shared/pathfinderPreparation.js';
import { GEOMETRY_TRACE_DERIVATION, geometryTraceCreateSchema, geometryTraceReceiptSchema } from '../../shared/pathfinderGeometryTrace.js';
import { revisionComparisonContextSchema, revisionComparisonCreateSchema, revisionComparisonReceiptSchema, type RevisionComparisonChoice } from '../../shared/pathfinderRevisionComparison.js';
import { calculationGrantAuthoritySchema, grantTransaction, type CalculationGrantAuthority } from './calculationAuthority.js';
import { calculationGrantLeaseClaimSchema, createCalculationGrantRepository, newCalculationGrantLeaseOwner } from './calculationGrantRepository.js';
import { grantOperationPrincipal } from './operationAuthority.js';
import type { GeometryTraceRepository } from './geometryTraceRepository.js';
import type { RevisionComparisonRepository } from './revisionComparisonRepository.js';
import type { ManagedPreparationWorkflowResult } from './managedPreparationWorkflow.js';
import { markRecalculationDirty } from './recalculationSchema.js';
import { pathFinderRoot } from './storage.js';
import { PathFinderError } from './errors.js';

const codeSchema = z.string().regex(/^[A-Z][A-Z0-9_]{0,95}$(?![\s\S])/);
const phase = z.enum(['planned', 'leased', 'invoking', 'complete', 'released', 'quarantined']);
/** Definite pre-claim refusals only; unknown commit, invoked work and quarantine are never replayed automatically. */
export const PREPARED_MAINTENANCE_RETRYABLE_CODES = ['CALCULATION_GRANT_LEASE_BUSY', 'SCHEDULER_DATABASE_BUSY'] as const;
const traceStep = z.object({ claim: calculationGrantLeaseClaimSchema, authority: calculationGrantAuthoritySchema.nullable(),
  command: geometryTraceCreateSchema, phase, receipt: geometryTraceReceiptSchema.nullable(), dirty: z.boolean() }).strict();
const compareStep = z.object({ claim: calculationGrantLeaseClaimSchema, authority: calculationGrantAuthoritySchema.nullable(),
  command: revisionComparisonCreateSchema.nullable(), phase, receipt: revisionComparisonReceiptSchema.nullable() }).strict();
export const grantPreparedMaintenanceRecordSchema = z.object({ schemaVersion: z.literal('wfc.pf.private-prepared-maintenance.v1'),
  purpose: z.literal('grant-trace-and-comparison-only'), id: policyUuidSchema, revision: policyRevisionSchema,
  projectId: policyUuidSchema, sourceSha256: policyHashSchema, grant: calculationGrantProvenanceSchema,
  model: z.object({ modelVersionId: policyUuidSchema, selectionRevision: policyRevisionSchema, contentFingerprint: policyHashSchema }).strict(),
  aggregate: z.object({ id: policyUuidSchema, sessionId: policyUuidSchema, projectionSha256: policyHashSchema }).strict(),
  trace: traceStep, comparison: compareStep.nullable(), state: z.enum(['running', 'complete', 'skipped', 'blocked']), reasonCode: codeSchema.nullable(),
}).strict().superRefine((v, context) => {
  const mismatch = v.projectId !== v.grant.projectId || v.trace.command.aggregateId !== v.aggregate.id ||
    v.trace.command.expectedProjectionSha256 !== v.aggregate.projectionSha256 ||
    [v.trace, ...(v.comparison ? [v.comparison] : [])].some((step, index) => {
      const c = step.claim;
      return c.operation !== (index === 0 ? 'trace' : 'compare') || c.projectId !== v.projectId || c.grantId !== v.grant.grantId ||
        c.grantRevision !== v.grant.grantRevision || c.grantEpoch !== v.grant.grantEpoch || c.installationEpoch !== v.grant.installationEpoch ||
        c.modelVersionId !== v.model.modelVersionId || c.selectionRevision !== v.model.selectionRevision || c.contentFingerprint !== v.model.contentFingerprint ||
        step.authority !== null && (Object.entries(c).some(([key, value]) => step.authority![key as keyof CalculationGrantAuthority] !== value) ||
          step.authority.issuerId !== v.grant.issuerId || step.authority.issuerAdminRevision !== v.grant.issuerAdminRevision);
    });
  const trace = v.trace.receipt?.trace, comparison = v.comparison?.receipt?.comparison;
  if (mismatch || v.trace.dirty && v.trace.receipt === null || v.trace.phase === 'released' && (!v.trace.receipt || !v.trace.dirty) ||
    trace && (trace.projectId !== v.projectId || trace.modelVersionId !== v.model.modelVersionId || trace.aggregateId !== v.aggregate.id ||
      trace.projection.sha256 !== v.aggregate.projectionSha256 || trace.derivationVersion !== GEOMETRY_TRACE_DERIVATION) ||
    comparison && (comparison.projectId !== v.projectId || comparison.target.aggregateId !== v.aggregate.id || comparison.target.traceId !== trace?.id ||
      comparison.target.projectionSha256 !== v.aggregate.projectionSha256 || comparison.target.traceContentSha256 !== trace?.contentSha256 ||
      !v.comparison?.command || !equal(v.comparison.command.source, pair(comparison.source)) || !equal(v.comparison.command.target, pair(comparison.target))) ||
    (v.state === 'complete' || v.state === 'skipped') && (v.trace.phase !== 'released' || !trace || !v.trace.dirty || v.comparison?.phase !== 'released') ||
    v.state === 'complete' && !comparison || v.comparison?.phase === 'released' && !comparison && v.state !== 'skipped')
    context.addIssue({ code: 'custom', message: 'Private maintenance command, owner and confirmed completion must agree.' });
});
export type GrantPreparedMaintenanceRecord = z.infer<typeof grantPreparedMaintenanceRecordSchema>;
export interface GrantPreparedMaintenanceJournal {
  list(): Promise<GrantPreparedMaintenanceRecord[]>;
  save(previous: GrantPreparedMaintenanceRecord | null, next: GrantPreparedMaintenanceRecord): Promise<GrantPreparedMaintenanceRecord>;
}
const LIMITS = Object.freeze({ files: 4096, records: 128, recordBytes: 2 * 1024 ** 2, totalBytes: 512 * 1024 ** 2 });
const equal = (a: unknown, b: unknown) => canonicalPurposeJson(a) === canonicalPurposeJson(b);
const fail = (code: string): never => { throw new PathFinderError(code, 503); };
const privateOwner = (s: Stats) => process.platform === 'win32' || (s.mode & 0o077) === 0 && (typeof process.getuid !== 'function' || s.uid === process.getuid());
/** Append-only private revisions retain exact original commands and owner secrets; none are public model provenance. */
export function createGrantPreparedMaintenanceJournal(): GrantPreparedMaintenanceJournal {
  const sync = async (p: string) => { const h = await fs.open(p, 'r'); try { await h.sync(); } finally { await h.close(); } };
  const directory = async () => {
    const root = await pathFinderRoot(), dir = path.join(root, 'grant-prepared-maintenance'); let created = false;
    try { await fs.mkdir(dir, { mode: 0o700 }); created = true; } catch (e) { if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e; }
    const s = await fs.lstat(dir); if (!s.isDirectory() || s.isSymbolicLink() || !privateOwner(s) || await fs.realpath(dir) !== path.resolve(dir)) return fail('PREPARED_MAINTENANCE_JOURNAL_PATH');
    if (created) await sync(root); return dir;
  };
  const scan = async (dir: string) => {
    const names: Array<{ name: string; id: string; revision: bigint }> = [], heads = new Map<string, (typeof names)[number]>(); let bytes = 0;
    const opened = await fs.opendir(dir);
    for await (const entry of opened) {
      const m = /^([a-f0-9-]{36})\.([0-9]{20})\.json$/.exec(entry.name);
      if (!m || !policyUuidSchema.safeParse(m[1]).success || names.length >= LIMITS.files || !entry.isFile() || entry.isSymbolicLink()) return fail('PREPARED_MAINTENANCE_JOURNAL_PATH');
      const s = await fs.lstat(path.join(dir, entry.name));
      if (!s.isFile() || s.isSymbolicLink() || s.nlink !== 1 || !privateOwner(s) || s.size > LIMITS.recordBytes) return fail('PREPARED_MAINTENANCE_JOURNAL_PATH');
      bytes += s.size; if (bytes > LIMITS.totalBytes) return fail('PREPARED_MAINTENANCE_JOURNAL_LIMIT');
      const item = { name: entry.name, id: m[1], revision: BigInt(m[2]) }; names.push(item);
      if (!heads.has(item.id) || heads.get(item.id)!.revision < item.revision) heads.set(item.id, item);
    }
    if (heads.size > LIMITS.records) return fail('PREPARED_MAINTENANCE_JOURNAL_LIMIT'); return { names, heads, bytes };
  };
  const read = async (dir: string, name: string) => {
    const filename = path.join(dir, name), before = await fs.lstat(filename);
    if (!before.isFile() || before.isSymbolicLink() || before.nlink !== 1 || before.size > LIMITS.recordBytes || !privateOwner(before)) return fail('PREPARED_MAINTENANCE_JOURNAL_PATH');
    const h = await fs.open(filename, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    try {
      const s = await h.stat(); if (!s.isFile() || s.nlink !== 1 || s.ino !== before.ino || s.dev !== before.dev || !privateOwner(s) || s.size > LIMITS.recordBytes) return fail('PREPARED_MAINTENANCE_JOURNAL_PATH');
      const bytes = await h.readFile(); if (bytes.length !== s.size) return fail('PREPARED_MAINTENANCE_JOURNAL_INTEGRITY');
      let raw: unknown; try { raw = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); } catch { return fail('PREPARED_MAINTENANCE_JOURNAL_INVALID'); }
      const value = grantPreparedMaintenanceRecordSchema.parse(raw);
      if (name !== `${value.id}.${value.revision.padStart(20, '0')}.json` || !bytes.equals(Buffer.from(canonicalPurposeJson(value)))) return fail('PREPARED_MAINTENANCE_JOURNAL_INTEGRITY');
      return { value, bytes };
    } finally { await h.close(); }
  };
  return {
    async list() { const dir = await directory(), scanned = await scan(dir), records: GrantPreparedMaintenanceRecord[] = [];
      for (const item of [...scanned.heads.values()].sort((a, b) => a.id.localeCompare(b.id))) records.push((await read(dir, item.name)).value); return records; },
    async save(previous, raw) {
      const next = grantPreparedMaintenanceRecordSchema.parse(raw), dir = await directory(), scanned = await scan(dir), head = scanned.heads.get(next.id);
      const bytes = Buffer.from(canonicalPurposeJson(next));
      if (head) { const actual = (await read(dir, head.name)).value; if (equal(actual, next)) return actual;
        if (!previous || !equal(actual, previous)) return fail('PREPARED_MAINTENANCE_JOURNAL_CONFLICT'); }
      else if (previous || next.revision !== '0') return fail('PREPARED_MAINTENANCE_JOURNAL_CONFLICT');
      if (previous && (next.revision !== (BigInt(previous.revision) + 1n).toString() || next.sourceSha256 !== previous.sourceSha256 ||
        !equal(next.trace.claim, previous.trace.claim) || !equal(next.trace.command, previous.trace.command) ||
        previous.trace.authority && !equal(previous.trace.authority, next.trace.authority) || previous.trace.receipt && !equal(previous.trace.receipt, next.trace.receipt) ||
        previous.trace.dirty && !next.trace.dirty || previous.comparison && (!next.comparison || !equal(previous.comparison.claim, next.comparison.claim) ||
          previous.comparison.command && !equal(previous.comparison.command, next.comparison.command) || previous.comparison.authority && !equal(previous.comparison.authority, next.comparison.authority) ||
          previous.comparison.receipt && !equal(previous.comparison.receipt, next.comparison.receipt)))) return fail('PREPARED_MAINTENANCE_JOURNAL_CONFLICT');
      if (bytes.length > LIMITS.recordBytes || scanned.names.length >= LIMITS.files || scanned.bytes + bytes.length > LIMITS.totalBytes || !head && scanned.heads.size >= LIMITS.records) return fail('PREPARED_MAINTENANCE_JOURNAL_LIMIT');
      const name = `${next.id}.${next.revision.padStart(20, '0')}.json`; let h;
      try { h = await fs.open(path.join(dir, name), 'wx', 0o600); await h.writeFile(bytes); await h.sync(); }
      catch (e) { if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e; if (!(await read(dir, name)).bytes.equals(bytes)) return fail('PREPARED_MAINTENANCE_JOURNAL_CONFLICT'); }
      finally { await h?.close(); }
      await sync(dir); return next;
    },
  };
}
export type PreparedMaintenanceCandidate = { projectId: string; grant: CalculationGrant; modelVersionId: string; selectionRevision: string; contentFingerprint: string };
export type PreparedMaintenanceInput = { candidate: PreparedMaintenanceCandidate; result: ManagedPreparationWorkflowResult };
export type PreparedMaintenanceOutcome = { status: 'complete' | 'skipped'; traceId: string; comparisonId: string | null; reasonCode: string | null };
export type GrantPreparedMaintenanceOptions = {
  traces: Pick<GeometryTraceRepository, 'create'>; comparisons: Pick<RevisionComparisonRepository, 'context' | 'create'>;
  repository?: Pick<ReturnType<typeof createCalculationGrantRepository>, 'claim' | 'release' | 'quarantine'>;
  journal?: GrantPreparedMaintenanceJournal; transaction?: typeof grantTransaction; dirty?: typeof markRecalculationDirty; uuid?: () => string;
};
function pair(choice: Pick<RevisionComparisonChoice, 'aggregateId' | 'traceId' | 'projectionSha256' | 'traceContentSha256'>) { return {
  aggregateId: choice.aggregateId, traceId: choice.traceId, projectionSha256: choice.projectionSha256, traceContentSha256: choice.traceContentSha256,
}; }
function safeCode(error: unknown) { return error instanceof PathFinderError && codeSchema.safeParse(error.code).success ? error.code : 'PREPARED_MAINTENANCE_OUTCOME_UNKNOWN'; }

/** Only automatic immutable observations; mappings, engineering confirmation and Apply are intentionally absent. */
export function createGrantPreparedMaintenance(pool: Pool, options: GrantPreparedMaintenanceOptions) {
  const repository = options.repository ?? createCalculationGrantRepository(pool), journal = options.journal ?? createGrantPreparedMaintenanceJournal(),
    transaction = options.transaction ?? grantTransaction, dirty = options.dirty ?? markRecalculationDirty, uuid = options.uuid ?? randomUUID;
  let running: { id: string; promise: Promise<PreparedMaintenanceOutcome> } | undefined, pending = false, blockCode: string | null = null;
  async function perform(input: PreparedMaintenanceInput, signal?: AbortSignal): Promise<PreparedMaintenanceOutcome> {
    const candidate = input.candidate, g = calculationGrantSchema.parse(candidate.grant), aggregate = preparationAggregateV2Schema.parse(input.result.aggregate);
    const grant = calculationGrantProvenanceSchema.parse({ kind: 'calculation-grant', projectId: g.projectId, grantId: g.id, grantRevision: g.grantRevision,
      grantEpoch: g.grantEpoch, installationEpoch: g.installationEpoch, issuerId: g.enabledBy, issuerAdminRevision: g.issuerAdminRevision });
    if (!g.enabled || input.result.status !== 'published' || input.result.producer.joined !== true || input.result.sessionId !== aggregate.sessionId ||
      input.result.traceInputs.aggregateId !== aggregate.id || input.result.traceInputs.sessionId !== aggregate.sessionId || input.result.traceInputs.artifactId !== aggregate.artifactId ||
      input.result.traceInputs.coordinateFrameId !== aggregate.coordinateFrameId || !equal(input.result.traceInputs.partIds, aggregate.partReferences.map(p => p.partId)) ||
      candidate.projectId !== g.projectId || aggregate.projectId !== g.projectId || aggregate.modelVersionId !== candidate.modelVersionId ||
      aggregate.selectionRevision !== candidate.selectionRevision || aggregate.contentFingerprint !== candidate.contentFingerprint || !equal(aggregate.producerGrant, grant)) return fail('PREPARED_MAINTENANCE_SCOPE_DENIED');
    const scope = { projectId: g.projectId, grant, model: { modelVersionId: aggregate.modelVersionId, selectionRevision: aggregate.selectionRevision, contentFingerprint: aggregate.contentFingerprint },
      aggregate: { id: aggregate.id, sessionId: aggregate.sessionId, projectionSha256: aggregate.projection.sha256 } };
    const sha = createHash('sha256').update(canonicalPurposeJson(scope)).digest('hex'), id = `${sha.slice(0, 8)}-${sha.slice(8, 12)}-5${sha.slice(13, 16)}-8${sha.slice(17, 20)}-${sha.slice(20, 32)}`;
    const existing = (await journal.list()).find(r => r.id === id);
    let record: GrantPreparedMaintenanceRecord;
    const outcome = (r: GrantPreparedMaintenanceRecord): PreparedMaintenanceOutcome => ({ status: r.state === 'skipped' ? 'skipped' : 'complete',
      traceId: r.trace.receipt!.trace.id, comparisonId: r.comparison?.receipt?.comparison.id ?? null, reasonCode: r.reasonCode });
    if (existing) {
      if (existing.sourceSha256 !== sha || !equal(existing.grant, grant) || !equal(existing.aggregate, scope.aggregate) || !equal(existing.model, scope.model)) return fail('PREPARED_MAINTENANCE_JOURNAL_CONFLICT');
      if (existing.state === 'complete' || existing.state === 'skipped') { pending = false; blockCode = null; return outcome(existing); }
      const unchangedNoWorkRefusal = (PREPARED_MAINTENANCE_RETRYABLE_CODES as readonly string[]).includes(existing.reasonCode ?? '') &&
        (existing.trace.phase === 'planned' && existing.trace.authority === null && existing.comparison === null ||
          existing.trace.phase === 'released' && existing.comparison?.phase === 'planned' && existing.comparison.authority === null);
      if (!unchangedNoWorkRefusal) { pending = true; blockCode = existing.reasonCode ?? 'PREPARED_MAINTENANCE_RECONCILIATION_REQUIRED'; return fail(blockCode); }
    }
    const claim = (operation: 'trace' | 'compare') => ({ projectId: g.projectId, grantId: g.id, grantRevision: g.grantRevision, grantEpoch: g.grantEpoch,
      installationEpoch: g.installationEpoch, operation, modelVersionId: aggregate.modelVersionId, selectionRevision: aggregate.selectionRevision,
      contentFingerprint: aggregate.contentFingerprint, ...newCalculationGrantLeaseOwner() });
    record = existing ? await journal.save(existing, { ...existing, revision: (BigInt(existing.revision) + 1n).toString(), state: 'running', reasonCode: null })
      : await journal.save(null, grantPreparedMaintenanceRecordSchema.parse({ schemaVersion: 'wfc.pf.private-prepared-maintenance.v1', purpose: 'grant-trace-and-comparison-only',
      id, revision: '0', ...scope, sourceSha256: sha, trace: { claim: claim('trace'), authority: null, command: { schemaVersion: 'wfc.pf.geometry-trace-create.v1',
        aggregateId: aggregate.id, expectedProjectionSha256: aggregate.projection.sha256, derivationVersion: GEOMETRY_TRACE_DERIVATION, idempotencyKey: uuid() },
        phase: 'planned', receipt: null, dirty: false }, comparison: null, state: 'running', reasonCode: null }));
    pending = true; blockCode = null;
    const save = async (patch: Partial<GrantPreparedMaintenanceRecord>) => { record = await journal.save(record,
      grantPreparedMaintenanceRecordSchema.parse({ ...record, ...patch, revision: (BigInt(record.revision) + 1n).toString() })); };
    const controller = new AbortController(), joinedSignal = AbortSignal.any([controller.signal, ...(signal ? [signal] : [])]);
    const timer = setTimeout(() => controller.abort(), CALCULATION_GRANT_LIMITS.executionLeaseMilliseconds); timer.unref?.();
    let active: CalculationGrantAuthority | undefined, invoked = false, joined = false, stage: 'trace' | 'comparison' = 'trace';
    try {
      if (record.trace.phase !== 'released') {
        joinedSignal.throwIfAborted(); active = await repository.claim(record.trace.claim, joinedSignal);
        await save({ trace: { ...record.trace, authority: active, phase: 'leased' } });
        await save({ trace: { ...record.trace, phase: 'invoking' } }); invoked = true;
        const receipt = geometryTraceReceiptSchema.parse(await options.traces.create(g.projectId, grantOperationPrincipal(active), record.trace.command, joinedSignal)); joined = true;
        if (receipt.trace.projectId !== g.projectId || receipt.trace.modelVersionId !== aggregate.modelVersionId || receipt.trace.aggregateId !== aggregate.id ||
          receipt.trace.projection.sha256 !== aggregate.projection.sha256 || receipt.trace.derivationVersion !== GEOMETRY_TRACE_DERIVATION) return fail('PREPARED_MAINTENANCE_TRACE_SCOPE_DENIED');
        await save({ trace: { ...record.trace, receipt, phase: 'complete' } });
        await transaction(pool, active, 'trace', c => dirty(c, { projectId: g.projectId, domain: 'geometry', reason: 'GEOMETRY_TRACE_PUBLISHED',
          sourceRevision: receipt.trace.id + ':' + receipt.trace.contentSha256 }), joinedSignal);
        await save({ trace: { ...record.trace, dirty: true } });
        await repository.release(active); active = undefined; await save({ trace: { ...record.trace, phase: 'released' } });
      }
      const receipt = record.trace.receipt!;
      stage = 'comparison'; invoked = false; joined = false;
      if (!record.comparison) await save({ comparison: { claim: claim('compare'), authority: null, command: null, phase: 'planned', receipt: null } });
      joinedSignal.throwIfAborted(); active = await repository.claim(record.comparison!.claim, joinedSignal);
      await save({ comparison: { ...record.comparison!, authority: active, phase: 'leased' } });
      const context = revisionComparisonContextSchema.parse(await options.comparisons.context(g.projectId, grantOperationPrincipal(active)));
      if (context.projectId !== g.projectId || context.activeModelVersionId !== aggregate.modelVersionId) return fail('PREPARED_MAINTENANCE_COMPARISON_SCOPE_DENIED');
      const target = context.choices.find(c => c.aggregateId === aggregate.id && c.traceId === receipt.trace.id && c.traceContentSha256 === receipt.trace.contentSha256 && c.projectionSha256 === aggregate.projection.sha256);
      if (!target || target.modelVersionId !== aggregate.modelVersionId) return fail('PREPARED_MAINTENANCE_TARGET_TRACE_REQUIRED');
      const choices = context.choices.filter(c => c.aggregateId !== target.aggregateId && Date.parse(c.createdAt) <= Date.parse(target.createdAt))
        .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt) || b.traceId.localeCompare(a.traceId));
      const source = choices.find(c => c.modelVersionId !== target.modelVersionId) ?? choices[0];
      if (!source) {
        await repository.release(active); active = undefined;
        await save({ comparison: { ...record.comparison!, phase: 'released' }, state: 'skipped', reasonCode: 'TWO_TRACED_AGGREGATES_REQUIRED' });
        pending = false; return outcome(record);
      }
      const command = revisionComparisonCreateSchema.parse({ schemaVersion: 'wfc.pf.revision-comparison-create.v1', source: pair(source), target: pair(target),
        expectedComparisonRevision: context.comparisonRevision, idempotencyKey: uuid(), reason: 'Automatic immutable revision observations; human engineering review remains required.' });
      await save({ comparison: { ...record.comparison!, command, phase: 'invoking' } }); invoked = true;
      const compared = revisionComparisonReceiptSchema.parse(await options.comparisons.create(g.projectId, grantOperationPrincipal(active), command, joinedSignal)); joined = true;
      if (compared.comparison.projectId !== g.projectId || !equal(command.source, pair(compared.comparison.source)) || !equal(command.target, pair(compared.comparison.target)))
        return fail('PREPARED_MAINTENANCE_COMPARISON_RECEIPT_SCOPE_DENIED');
      await save({ comparison: { ...record.comparison!, receipt: compared, phase: 'complete' } });
      await repository.release(active); active = undefined;
      await save({ comparison: { ...record.comparison!, phase: 'released' }, state: 'complete', reasonCode: null });
      pending = false; return outcome(record);
    } catch (error) {
      blockCode = safeCode(error);
      if (active) {
        try {
          if (invoked && !joined) { await repository.quarantine(active, blockCode); await save(stage === 'trace'
            ? { trace: { ...record.trace, phase: 'quarantined' } } : { comparison: { ...record.comparison!, phase: 'quarantined' } }); }
          else await repository.release(active);
        } catch { blockCode = 'PREPARED_MAINTENANCE_CLEANUP_UNKNOWN'; }
      }
      await save({ state: 'blocked', reasonCode: blockCode }).catch(() => { blockCode = 'PREPARED_MAINTENANCE_JOURNAL_OUTCOME_UNKNOWN'; });
      return fail(blockCode);
    } finally { clearTimeout(timer); }
  }
  const api = {
    get pending() { return pending; }, get blockCode() { return blockCode; },
    onPrepared(input: PreparedMaintenanceInput, signal?: AbortSignal): Promise<PreparedMaintenanceOutcome> {
      const key = canonicalPurposeJson({ projectId: input.candidate.projectId, aggregateId: input.result.aggregate.id, grantRevision: input.candidate.grant.grantRevision });
      if (running) { if (running.id === key) return running.promise; return Promise.reject(new PathFinderError('PREPARED_MAINTENANCE_BUSY', 503)); }
      const promise = perform(input, signal).catch(error => { blockCode = safeCode(error); throw error; }).finally(() => { if (running?.promise === promise) running = undefined; });
      running = { id: key, promise }; return promise;
    },
  };
  return api;
}
