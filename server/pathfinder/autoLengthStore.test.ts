import { createHash } from 'node:crypto';
import type { PoolClient } from 'pg';
import { describe, expect, it, vi } from 'vitest';
import { canonicalPurposeJson } from '../../shared/pathfinderPurposePolicy.js';
import { revisionResultEnvelopeSchema } from '../../shared/pathfinderRevisionResults.js';
import { emptyAutoLengthView } from '../../shared/pathfinderAutoLength.js';
import { syntheticBarrierWriteInputs } from './barrierWriteFixtures.js';
import { buildAutoLengthSource, projectAutoLengthView, publishAutoLength, readAutoLengths, registerAutoLengthAdmission } from './autoLengthStore.js';

const hash = (value: unknown): string => createHash('sha256').update(canonicalPurposeJson(value)).digest('hex');
type Row = Record<string, unknown>;
function fixture(ordinal = '1') {
  const f = syntheticBarrierWriteInputs(), projectId = f.dependencies.projectId, cableId = f.dependencies.cableId,
    admissionId = f.id(101), jobId = f.id(102), proposalId = f.id(103), baselineHash = 'c'.repeat(64);
  const sealBody = { schemaVersion: 'wfc.pf.cable-revision-result.v1', id: f.id(104), projectId, admissionId, jobId, cableId, proposalId,
    proposalHash: hash({ dependencies: f.dependencies, result: f.result, baselineHash }), baselineHash,
    dependencyHash: hash(f.dependencies), engineResultSha256: hash(f.result), ledgerHash: hash(f.result.lengthLedger), oldModel: null,
    summary: { calculationMode: 'calculate', newModel: f.dependencies.model, routeText: '/A', rawLengthMeters: 5, designLengthMeters: '7', unroundedMeters: '6.6',
      delta: { rawLengthMeters: null, designLengthMeters: null, unroundedMeters: null, baseline: 'unavailable' }, reasonCodes: [] }, comparisonRef: null,
    observedEvents: [], lengthLedger: f.result.lengthLedger, physicalChangeProven: false, createdAt: '2026-10-21T16:00:00.000Z' };
  const seal = revisionResultEnvelopeSchema.parse({ ...sealBody, revisionResultSha256: hash(sealBody) });
  const input = { projectId, cableId, jobId, proposalId, dependencies: f.dependencies, result: f.result, seal };
  const source = buildAutoLengthSource({ ...input, admissionOrdinal: ordinal });
  const stored = { project_id: projectId, cable_id: cableId, job_id: jobId, id: proposalId, status: 'calculated',
    proposal_hash: seal.proposalHash, dependency_hash: seal.dependencyHash, dependencies: f.dependencies, result: f.result, seal,
    ordinal, admission_id: admissionId, sealed_admission_id: admissionId, target_ordinal: ordinal, job_state: 'running', cancel_requested: false, item_state: 'complete', item_status: 'calculated' };
  const existing = { admission_ordinal: ordinal, proposal_id: proposalId, length_text: '7', source, source_sha256: hash(source) };
  const read: Row = { cable_id: cableId, latest_ordinal: ordinal, latest_job_id: jobId, latest_job_state: 'running', latest_cancel_requested: false,
    latest_item_state: 'complete', latest_item_status: 'calculated', latest_baseline_status: 'ready', source_ordinal: ordinal,
    source_proposal_id: proposalId, length_text: '7', source, source_sha256: hash(source), source_admission_id: admissionId, source_job_id: jobId,
    source_order_admission_id: admissionId, source_order_job_id: jobId, source_proposal_hash: seal.proposalHash,
    source_dependency_hash: seal.dependencyHash, source_proposal_status: 'calculated', seal_hash: seal.revisionResultSha256,
    seal_engine_result_hash: seal.engineResultSha256, seal_dependency_hash: seal.dependencyHash, seal_ledger_hash: seal.ledgerHash, seal_design_text: '7',
    seal_calculated_at: seal.createdAt, seal_barrier_status: source.barrierStatus };
  return { ...f, input, source, stored, existing, read, admissionId, ordinal };
}
function client(handler: (sql: string, values: unknown[]) => Row[] | Promise<Row[]>) {
  let selectedTarget: unknown;
  const query = vi.fn(async (sql: string, values: unknown[] = []) => {
    if (sql.includes('auto-length:target-lock')) return { rows: typeof selectedTarget === 'string' ? [{ admission_ordinal: selectedTarget }] : [] };
    const rows = await handler(sql, values);
    if (sql.includes('auto-length:publish-source')) selectedTarget = rows[0]?.target_ordinal;
    return { rows };
  });
  return { db: { query } as unknown as PoolClient, query };
}

describe('exact immutable Auto source', () => {
  it('copies C# design length, not raw geometry or an editable Design value', () => {
    const f = fixture(); expect(f.source.lengthMetersText).toBe('7'); expect(f.source.lengthMetersText).not.toBe(String(f.result.route!.lengthMeters));
    expect(f.source.barrierStatus).toBe('no-barriers-declared'); expect(f.source.revisionResultHash).toBe(f.input.seal.revisionResultSha256);
  });
  it.each(['seal', 'result', 'dependencies', 'length', 'ledger', 'proposal', 'project', 'mode', 'proof'])('rejects crossed or malformed %s', field => {
    const f = fixture(), input = structuredClone(f.input);
    if (field === 'seal') input.seal.revisionResultSha256 = '1'.repeat(64);
    if (field === 'result') input.result.message = 'Changed exact engine output';
    if (field === 'dependencies') input.dependencies.cableWriteRevision = '8';
    if (field === 'length') input.result.design!.designLengthMeters = '7.5';
    if (field === 'ledger') input.seal.lengthLedger!.designLengthMeters = '8';
    if (field === 'proposal') input.proposalId = f.id(999);
    if (field === 'project') input.projectId = f.id(999);
    if (field === 'mode') input.result.calculationMode = 'design' as 'calculate';
    if (field === 'proof' && input.result.schemaVersion === 'pathfinder.model.response.v3') input.result.barriers.proof = null;
    expect(() => buildAutoLengthSource({ ...input, admissionOrdinal: '1' })).toThrow();
  });
  it('rejects a self-consistently rehashed seal carrying a different same-final-value ledger', () => {
    const f = fixture(), input = structuredClone(f.input);
    input.seal.lengthLedger!.ceilingIncrementMeters = '0.5';
    input.seal.ledgerHash = hash(input.seal.lengthLedger);
    const { revisionResultSha256: _old, ...body } = input.seal;
    input.seal.revisionResultSha256 = hash(body);
    expect(revisionResultEnvelopeSchema.safeParse(input.seal).success).toBe(true);
    expect(() => buildAutoLengthSource({ ...input, admissionOrdinal: '1' })).toThrowError(expect.objectContaining({ code: 'AUTO_LENGTH_RESULT_PROOF' }));
  });
});

describe('admission order and per-cable watermark', () => {
  it.each([true, false])('registers exact new targets including all-blocked nullable job=%s', runnable => {
    const f = fixture(), input = { projectId: f.input.projectId, admissionId: f.admissionId, jobId: runnable ? f.input.jobId : null, cableIds: [f.input.cableId] };
    const c = client((sql, values) => {
      if (sql.includes('auto-length:registration')) return [{ id: input.admissionId, job_id: input.jobId, total: 1, ordinal: null, created_xid: '90', transaction_xid: '90' }];
      if (sql.includes('auto-length:members')) return [{ cable_id: input.cableIds[0] }];
      if (sql.includes('auto-length:order')) { expect(values[2]).toBe(input.jobId); return [{ ordinal: '9' }]; }
      if (sql.includes('auto-length:targets')) { expect(values).toEqual([input.projectId, input.cableIds, '9']); return []; }
      throw new Error('Unexpected SQL');
    });
    return expect(registerAutoLengthAdmission(c.db, input)).resolves.toEqual({ admissionOrdinal: '9', duplicate: false });
  });
  it('replays the original order without touching latest targets', async () => {
    const f = fixture(), ids = [f.input.cableId], c = client(sql => {
      if (sql.includes('auto-length:registration')) return [{ id: f.admissionId, job_id: f.input.jobId, total: 1, ordinal: '1', target_count: 1,
        targets_sha256: hash(ids), created_xid: '80', transaction_xid: '90' }];
      if (sql.includes('auto-length:members')) return [{ cable_id: ids[0] }];
      throw new Error('Replay must not write or advance targets');
    });
    await expect(registerAutoLengthAdmission(c.db, { projectId: f.input.projectId, admissionId: f.admissionId, jobId: f.input.jobId, cableIds: ids }))
      .resolves.toEqual({ admissionOrdinal: '1', duplicate: true });
    expect(c.query).toHaveBeenCalledTimes(2);
  });
  it('refuses historical unregistered jobs rather than backfilling a new order', async () => {
    const f = fixture(), c = client(sql => sql.includes('registration')
      ? [{ id: f.admissionId, job_id: f.input.jobId, total: 1, ordinal: null, created_xid: '80', transaction_xid: '90' }]
      : [{ cable_id: f.input.cableId }]);
    await expect(registerAutoLengthAdmission(c.db, { projectId: f.input.projectId, admissionId: f.admissionId, jobId: f.input.jobId, cableIds: [f.input.cableId] }))
      .rejects.toMatchObject({ code: 'AUTO_LENGTH_NEW_ADMISSION_REQUIRED' });
    expect(c.query).toHaveBeenCalledTimes(2);
  });
  it('does not assign a target outside the exact immutable baseline membership', async () => {
    const f = fixture(), c = client(sql => sql.includes('registration')
      ? [{ id: f.admissionId, job_id: f.input.jobId, total: 1, ordinal: null, created_xid: '90', transaction_xid: '90' }]
      : [{ cable_id: f.id(999) }]);
    await expect(registerAutoLengthAdmission(c.db, { projectId: f.input.projectId, admissionId: f.admissionId, jobId: f.input.jobId, cableIds: [f.input.cableId] }))
      .rejects.toMatchObject({ code: 'AUTO_LENGTH_ADMISSION_MEMBERS' });
  });
});

describe('same-transaction Auto publication', () => {
  it('publishes immediately for an exact complete cable item while its parent still runs', async () => {
    const f = fixture(), c = client((sql, values) => {
      if (sql.includes('publish-source')) return [f.stored];
      if (sql.includes('existing')) return [];
      if (sql.includes('auto-length:publish */')) { expect(values[4]).toBe('7'); expect(values[5]).toEqual(f.source); return [{ cable_id: f.input.cableId }]; }
      throw new Error('Unexpected SQL or cable business write');
    });
    await expect(publishAutoLength(c.db, f.input)).resolves.toEqual({ status: 'published', admissionOrdinal: '1' });
    for (const [sql] of c.query.mock.calls) expect(sql).not.toMatch(/(?:UPDATE|INSERT INTO)\s+(?:cables|cable_history|pf_apply_receipts)\b/i);
  });
  it('reconciles an exact already-published source after a lost acknowledgment', async () => {
    const f = fixture(), c = client(sql => {
      if (sql.includes('publish-source')) return [f.stored];
      if (sql.includes('existing')) return [f.existing];
      throw new Error('An exact replay must not rewrite Auto');
    });
    await expect(publishAutoLength(c.db, f.input)).resolves.toEqual({ status: 'duplicate', admissionOrdinal: '1' });
  });
  it('does not promote an older completion after a newer failed or blocked target was admitted', async () => {
    const f = fixture(), c = client(sql => {
      if (sql.includes('publish-source')) return [{ ...f.stored, target_ordinal: '2' }];
      throw new Error('A superseded source must not write');
    });
    await expect(publishAutoLength(c.db, f.input)).resolves.toEqual({ status: 'superseded', admissionOrdinal: '1' });
    expect(c.query).toHaveBeenCalledTimes(2);
  });
  it('allows an exact historical unregistered v8 job to finish without an Auto order, value or backfill', async () => {
    const f = fixture(), c = client(sql => {
      if (sql.includes('publish-source')) return [{ ...f.stored, ordinal: null, admission_id: null, target_ordinal: null }];
      throw new Error('A historical completion must not create an Auto order or value');
    });
    await expect(publishAutoLength(c.db, f.input)).resolves.toEqual({ status: 'historical-unregistered', admissionOrdinal: null });
    expect(c.query).toHaveBeenCalledTimes(1);
  });
  it('does not disguise a registered admission with a missing target as historical', async () => {
    const f = fixture(), c = client(() => [{ ...f.stored, target_ordinal: null }]);
    await expect(publishAutoLength(c.db, f.input)).rejects.toMatchObject({ code: 'AUTO_LENGTH_ADMISSION_SCOPE' });
  });
  it('does not use the historical skip for a missing or unverified stored result', async () => {
    const f = fixture(), empty = client(() => []);
    await expect(publishAutoLength(empty.db, f.input)).rejects.toMatchObject({ code: 'AUTO_LENGTH_STORED_SOURCE_REQUIRED' });
    const bad = { ...f.result, calculationMode: 'design' }, c = client(() => [{ ...f.stored, ordinal: null, admission_id: null, result: bad }]);
    await expect(publishAutoLength(c.db, { ...f.input, result: bad })).rejects.toMatchObject({ code: 'BARRIER_WRITE_PROOF_REQUIRED' });
  });
  it.each([{ cancel_requested: true }, { job_state: 'failed' }, { job_state: 'cancelled' }, { status: 'stale' },
    { item_state: 'running' }, { item_status: 'no_path' }, { item_status: 'stale' }])('does not promote a failed or noncurrent item %j', patch => {
    const f = fixture(), c = client(sql => {
      if (sql.includes('publish-source')) return [{ ...f.stored, ...patch }];
      throw new Error('Invalid item must not publish');
    });
    return expect(publishAutoLength(c.db, f.input)).rejects.toMatchObject({ code: 'AUTO_LENGTH_ITEM_NOT_CURRENT' });
  });
  it('refuses fresh output attached to the old stored replay seal', async () => {
    const f = fixture(), c = client(() => [f.stored]), result = { ...f.result, message: 'A second engine execution is not the first immutable result.' };
    await expect(publishAutoLength(c.db, { ...f.input, result })).rejects.toMatchObject({ code: 'AUTO_LENGTH_STORED_SOURCE_CHANGED' });
  });
  it('rejects a poisoned prior source instead of overwriting its history silently', async () => {
    const f = fixture(), c = client(sql => sql.includes('publish-source') ? [f.stored] : [{ ...f.existing, source_sha256: '1'.repeat(64) }]);
    await expect(publishAutoLength(c.db, f.input)).rejects.toMatchObject({ code: 'AUTO_LENGTH_SOURCE_INTEGRITY' });
  });
});

describe('bounded ordinary cable display projection', () => {
  it('returns an exact value with no authority or geometry fields', () => {
    const f = fixture(), view = projectAutoLengthView(f.read, f.input.projectId, f.input.cableId);
    expect(view).toEqual({ autoCalculatedLength: 7, autoLengthStatus: 'last-successful', autoLengthCalculatedAt: '2026-10-21T16:00:00.000Z',
      autoLengthBarrierStatus: 'no-barriers-declared', autoLengthMatchesLatestRequest: true });
  });
  it('does not change the Auto number after manual Design edits or legitimate Apply revision increments', () => {
    const f = fixture(), edited = { ...f.read, design_length: '999', routing: '/MANUAL', install_length: '850', cable_write_revision: '999' };
    expect(projectAutoLengthView(edited, f.input.projectId, f.input.cableId)).toEqual(projectAutoLengthView(f.read, f.input.projectId, f.input.cableId));
  });
  it.each(['failed', 'cancelled'])('retains an already-published checked item when its parent later becomes %s', job => {
    const f = fixture(), view = projectAutoLengthView({ ...f.read, latest_job_state: job }, f.input.projectId, f.input.cableId);
    expect(view.autoCalculatedLength).toBe(7); expect(view.autoLengthStatus).toBe('last-successful'); expect(view.autoLengthMatchesLatestRequest).toBe(true);
  });
  it.each([
    [{ latest_job_state: 'queued', latest_item_state: 'waiting', latest_item_status: 'ready' }, 'pending'],
    [{ latest_job_state: 'failed' }, 'failed'], [{ latest_job_state: 'cancelled' }, 'cancelled'],
    [{ latest_item_status: 'stale' }, 'stale'], [{ latest_job_id: null, latest_job_state: null, latest_item_state: null }, 'blocked'],
  ] as const)('labels an older successful value honestly while a newer request has state %j', (patch, expected) => {
    const f = fixture(), view = projectAutoLengthView({ ...f.read, latest_ordinal: '2', ...patch }, f.input.projectId, f.input.cableId);
    expect(view.autoCalculatedLength).toBe(7); expect(view.autoLengthStatus).toBe(expected); expect(view.autoLengthMatchesLatestRequest).toBe(false);
  });
  it.each(['source_sha256', 'source_proposal_id', 'seal_hash', 'seal_dependency_hash', 'seal_ledger_hash', 'seal_design_text', 'source_order_job_id'])
    ('withholds a corrupted source when %s is crossed', field => {
      const f = fixture(), view = projectAutoLengthView({ ...f.read, [field]: 'wrong' }, f.input.projectId, f.input.cableId);
      expect(view).toEqual({ ...emptyAutoLengthView(), autoLengthStatus: 'unavailable' });
    });
  it('shows a completed failed item as blocked while sibling calculations still run', () => {
    const f = fixture(), view = projectAutoLengthView({ ...f.read, source: null, latest_item_status: 'no_path' }, f.input.projectId, f.input.cableId);
    expect(view.autoCalculatedLength).toBeNull(); expect(view.autoLengthStatus).toBe('blocked');
  });
  it('does not call a missing completed-success projection pending merely because siblings run', () => {
    const f = fixture(), view = projectAutoLengthView({ ...f.read, source: null }, f.input.projectId, f.input.cableId);
    expect(view.autoCalculatedLength).toBeNull(); expect(view.autoLengthStatus).toBe('unavailable');
  });
  it('does not convert missing rows or old estimates into a successful value', () => {
    const f = fixture(); expect(projectAutoLengthView({ old_tray_estimate: 99 }, f.input.projectId, f.input.cableId)).toEqual(emptyAutoLengthView());
  });
  it.each(['calculatedAt', 'barrierStatus'] as const)('detects a self-consistent rehashed false %s label against immutable output scalars', field => {
    const f = fixture(), source = { ...f.source, [field]: field === 'calculatedAt' ? '2026-10-20T16:00:00.000Z' : 'bypassed' };
    const view = projectAutoLengthView({ ...f.read, source, source_sha256: hash(source) }, f.input.projectId, f.input.cableId);
    expect(view).toEqual({ ...emptyAutoLengthView(), autoLengthStatus: 'unavailable' });
  });
  it('reads a large cable page in bounded set-based chunks without geometry or authority collection', async () => {
    const f = fixture(), ids = Array.from({ length: 1001 }, (_, at) => f.id(at + 500));
    const c = client((sql, values) => {
      expect(sql).toContain('auto-length:read'); expect(sql).not.toMatch(/p[.]result\s*(?:,|AS)|p[.]dependencies|engine_identity|mesh|login|grant/);
      const requested = values[1] as string[]; expect(requested.length).toBeLessThanOrEqual(500); return requested.map(cable_id => ({ cable_id }));
    });
    const views = await readAutoLengths(c.db, f.input.projectId, ids); expect(views.size).toBe(1001); expect(c.query).toHaveBeenCalledTimes(3);
    expect(views.get(ids[1000])).toEqual(emptyAutoLengthView());
  });
  it('rejects an extra crossed cable row and propagates a database refusal without inventing zero', async () => {
    const f = fixture(), crossed = client(() => [{ cable_id: f.id(999) }]);
    await expect(readAutoLengths(crossed.db, f.input.projectId, [f.input.cableId])).rejects.toMatchObject({ code: 'AUTO_LENGTH_READ_SCOPE' });
    const refused = Error('Synthetic read failure'), broken = client(() => { throw refused; });
    await expect(readAutoLengths(broken.db, f.input.projectId, [f.input.cableId])).rejects.toBe(refused);
  });
});
