// @vitest-environment node
import type { Pool, PoolClient } from 'pg';
import { describe, expect, it, vi } from 'vitest';
import type { LengthLedger } from '../../shared/pathfinderLengthLedger.js';
import { defaultOptions, type DependencySnapshot } from './jobContracts.js';
import type { collectDependencyBatchInTransaction } from './dependencyBatch.js';
import { persistRevisionAdmission, readRevisionBaseline, revisionResultHash, sealRevisionResult, verifyRevisionResultForProposal, createRevisionResults,
  type RevisionAdmissionInput } from './revisionResultRepository.js';

vi.mock('./recalculationRepository.js', () => ({ readRecalculationJobAuthority: async () => ({ enrolled: false }) }));
type Row = Record<string, unknown>;
const id = (n: number) => 'd9000000-0000-4000-8000-' + n.toString(16).padStart(12, '0');
const pid = id(1), jid = id(2), model = { id: id(3), selectionRevision: '1', contentFingerprint: 'a'.repeat(64) },
  who = { userId: id(4), loginId: id(5), loginExpiresAt: Date.parse('2099-01-01T00:00:00Z') };
const settings = { revision: '2', connectionGap: '1', secondaryTrayLength: null, endConnectionLength: '1.00', additionalBendingPercent: '10.0' };
function dependencies(cableId = id(10)): DependencySnapshot { return { schemaVersion: 'pathfinder.dependencies.v5', projectId: pid, cableId,
  cableWriteRevision: '9007199254740993', model, settings, options: { ...defaultOptions }, comparison: null } as unknown as DependencySnapshot; }
const ledger: LengthLedger = { schemaVersion: 'wfc.pf.length-components.v1', formulaVersion: 'pathfinder-45c24bf5', settingsRevision: '2',
  raw: { lengthMeters: 5, fromDistanceMeters: 1, toDistanceMeters: 1 }, rawLengthDecimalMeters: '5',
  from: { requiresSecondary: false, removedApproachMeters: '0' }, to: { requiresSecondary: false, removedApproachMeters: '0' },
  settings: { secondaryTrayLengthMeters: null, endConnectionLengthMeters: '1', additionalBendingPercent: '10' }, secondaryEnds: 0,
  replacementMeters: '0', beforeClampMeters: '5', clampAdjustmentMeters: '0', afterClampMeters: '5', beforePercentageMeters: '6',
  bendingIncrementMeters: '0.6', unroundedMeters: '6.6', ceilingIncrementMeters: '0.4', designLengthMeters: '7', gapAccounting: 'already-in-raw-geometry' };
function output() { return { schemaVersion: 'pathfinder.model.response.v1', requestId: id(6), status: 'calculated', message: 'Synthetic fixture only.', engineeringAccepted: false,
  calculationMode: 'calculate', route: { success: true, message: '', routeText: '/A', routeCodes: ['/A'], segmentIds: ['a'], pathPoints: [{ x: 0, y: 0, z: 0 }, { x: 5, y: 0, z: 0 }],
    lengthMeters: 5, fromDistanceMeters: 1, toDistanceMeters: 1, fromRequiresSecondary: false, toRequiresSecondary: false, connectionGapCount: 0, connectionGapLengthMeters: 0 },
  design: { lengthBeforePercentageMeters: '6.00', unroundedLengthMeters: '6.60', designLengthMeters: '7' }, lengthLedger: structuredClone(ledger) }; }
function cable(n = 10): Row { return { id: id(n), tag: 'Synthetic cable', from_location: 'From', to_location: 'To', routing: '/OLD', design_length: '4.0000', install_length: '3.12500', cable_write_revision: '9007199254740993' }; }
function fixture() {
  const admissions: Row[] = [], baselines: Row[] = [], seals: Row[] = [], proposals: Row[] = [], accepted: Row[] = [], events: Row[] = [], calls: Array<{ sql: string; values: unknown[] }> = [];
  let admin = true, failedWithoutOutput = false; const deletedCables = new Set<string>();
  const query = async (sql: string, values: unknown[] = []) => {
    calls.push({ sql, values });
    if (sql.startsWith('SELECT id FROM projects')) return { rows: [{ id: pid }] };
    if (sql.startsWith('SELECT is_admin FROM users')) return { rows: [{ is_admin: admin }] };
    if (sql.startsWith('SELECT user_id,expires_at,revoked_at FROM viewer_login_bindings')) return { rows: [{ user_id: who.userId, expires_at: new Date(who.loginExpiresAt), revoked_at: null }] };
    if (sql.includes('SELECT DISTINCT ON (r.cable_id)')) return { rows: accepted.filter(r => (values[1] as string[]).includes(String(r.cable_id))) };
    if (sql.startsWith('SELECT generation::text,domain,reason,source_revision')) return { rows: events };
    if (sql.startsWith('INSERT INTO pf_revision_admissions')) {
      admissions.push({ id: values[0], project_id: values[1], job_id: values[2], generation: values[3], kind: values[4], input_sha256: values[5], options: values[6], model_ref: values[7], total: values[8], observed_events: JSON.parse(String(values[9])), created_at: '2026-10-19T12:00:00.123Z', cursor_created_at: '2026-10-19T12:00:00.123456Z' }); return { rows: [] };
    }
    if (sql.startsWith('INSERT INTO pf_revision_baselines')) { for (const row of JSON.parse(String(values[2])) as Row[]) baselines.push({ ...row, project_id: values[0], admission_id: values[1] }); return { rows: [] }; }
    if (sql.startsWith('INSERT INTO pf_revision_results')) { seals.push({ id: values[0], project_id: values[1], admission_id: values[2], job_id: values[3], cable_id: values[4], proposal_id: values[5], baseline_sha256: values[6], dependency_sha256: values[7], engine_result_sha256: values[8], ledger_sha256: values[9], record_sha256: values[10], record: values[11] }); return { rows: [] }; }
    if (sql.startsWith('SELECT id,project_id,job_id,generation::text')) {
      if (sql.includes('(job_id=$2')) return { rows: admissions.filter(a => a.project_id === values[0] && (a.job_id !== null && a.job_id === values[1] || a.kind === 'automatic' && a.generation === values[2])) };
      if (sql.includes('AND id=$2')) return { rows: admissions.filter(a => a.project_id === values[0] && a.id === values[1]) };
      return { rows: [...admissions].reverse().slice(0, Number(values[3])) };
    }
    if (sql.startsWith('SELECT cable_id FROM pf_revision_baselines')) return { rows: baselines.filter(b => b.admission_id === values[1]).map(b => ({ cable_id: b.cable_id })) };
    if (sql.startsWith('SELECT b.*,a.id AS admission_id')) { const a = admissions.find(a => a.job_id === values[1] && a.project_id === values[0]); return { rows: a ? baselines.filter(b => b.admission_id === a.id && b.cable_id === values[2]) : [] }; }
    if (sql.startsWith('SELECT * FROM pf_revision_baselines')) return { rows: baselines.filter(b => b.project_id === values[0] && b.admission_id === values[1] && b.cable_id === values[2]) };
    if (sql.startsWith('SELECT * FROM pf_revision_results')) return { rows: seals.filter(s => s.project_id === values[0] && s.proposal_id === values[1]) };
    if (sql.startsWith('SELECT project_id,id,job_id,cable_id,proposal_hash') || sql.startsWith('SELECT dependencies,result,proposal_hash')) return { rows: proposals.filter(p => p.project_id === values[0] && p.id === values[1]) };
    if (sql.startsWith('SELECT b.*,i.status')) {
      let rows = baselines.filter(b => b.project_id === values[0] && b.admission_id === values[1]);
      rows = sql.includes('b.cable_id>$3') ? rows.filter(b => values[2] === null || String(b.cable_id) > String(values[2])).slice(0, Number(values[3])) : rows.filter(b => b.cable_id === values[2]);
      return { rows: rows.map(b => { const s = seals.find(s => s.admission_id === b.admission_id && s.cable_id === b.cable_id), p = proposals.find(p => p.id === s?.proposal_id); return { ...b, record: s?.record ?? null, sealed_row: s ?? null, proposal_status: p?.status, item_status: null, item_message: null, job_state: failedWithoutOutput ? 'failed' : 'queued', job_failure: failedWithoutOutput ? 'Synthetic engine fault.' : null }; }) };
    }
    if (sql.startsWith('SELECT id,cable_write_revision::text FROM cables')) return { rows: baselines.filter(b => (values[1] as string[]).includes(String(b.cable_id)) && !deletedCables.has(String(b.cable_id))).map(b => ({ id: b.cable_id, cable_write_revision: (b.baseline as { currentCable: { cableWriteRevision: string } }).currentCable.cableWriteRevision })) };
    return { rows: [] };
  };
  const client = { query, release: vi.fn() } as unknown as PoolClient, pool = { connect: async () => client } as unknown as Pool;
  const input = (count = 1): RevisionAdmissionInput => ({ projectId: pid, jobId: jid, generation: null, kind: 'manual', inputSha256: 'b'.repeat(64), options: { ...defaultOptions },
    items: Array.from({ length: count }, (_, i) => ({ cable: cable(i + 10), dependencies: dependencies(id(i + 10)), status: 'ready', message: '' })) });
  const prepare = async (result: unknown = output()) => {
    const admissionId = await persistRevisionAdmission(client, input()), baseline = await readRevisionBaseline(client, { projectId: pid, jobId: jid, cableId: id(10) }), deps = dependencies(), proposalId = id(20);
    proposals.push({ project_id: pid, id: proposalId, job_id: jid, cable_id: id(10), status: 'calculated', proposal_hash: revisionResultHash({ dependencies: deps, result, baselineHash: baseline.baselineHash }), dependency_hash: revisionResultHash(deps), dependencies: deps, result });
    return { admissionId, baseline, deps, proposalId, result };
  };
  return { client, pool, admissions, baselines, seals, proposals, accepted, events, calls, input, prepare, setAdmin: (value: boolean) => { admin = value; }, failJob: () => { failedWithoutOutput = true; }, deleteCable: (cableId: string) => { deletedCables.add(cableId); } };
}

describe('immutable admission snapshots and revision envelopes', () => {
  it('preserves SQL decimal text and large cable revisions; legacy values have no inferred geometry', async () => {
    const f = fixture(), admission = await persistRevisionAdmission(f.client, f.input());
    const b = await readRevisionBaseline(f.client, { projectId: pid, jobId: jid, cableId: id(10) });
    expect(b.admissionId).toBe(admission); expect(b.baseline.currentCable).toMatchObject({ designLength: '4.0000', installLength: '3.12500', cableWriteRevision: '9007199254740993' });
    expect(b.baseline.lastAcceptedApply).toBeNull(); expect(b.baseline.acceptedMatchesCurrent).toBe(false);
    expect(f.calls.find(c => c.sql.includes('SELECT DISTINCT ON'))?.sql).toContain("r.after_snapshot->>'design_length'");
  });
  it('refuses missing fields and numeric coercion before creating any admission', async () => {
    const f = fixture(), input = f.input(); input.items[0].cable.design_length = 4;
    await expect(persistRevisionAdmission(f.client, input)).rejects.toMatchObject({ code: 'REVISION_BASELINE_NUMERIC_TEXT_REQUIRED' }); expect(f.admissions).toHaveLength(0);
    delete input.items[0].cable.install_length;
    await expect(persistRevisionAdmission(f.client, input)).rejects.toMatchObject({ code: 'REVISION_BASELINE_CABLE_FIELDS_REQUIRED' });
  });
  it('keeps a latest accepted historical result separate after intervening cable revision changes', async () => {
    const f = fixture(); f.accepted.push({ receipt_id: id(30), cable_id: id(10), proposal_id: id(31), applied_at: '2026-10-18T00:00:00Z', after_revision: '9007199254740992',
      after_routing: '/OLD', after_design_length: '4.00', proposal_hash: 'c'.repeat(64), dependency_hash: 'd'.repeat(64), model_ref: model,
      route_text: '/OLD', raw_length: 2.5, design_length: '4', unrounded_length: '3.2' });
    await persistRevisionAdmission(f.client, f.input()); const b = await readRevisionBaseline(f.client, { projectId: pid, jobId: jid, cableId: id(10) });
    expect(b.baseline.acceptedMatchesCurrent).toBe(false); expect(b.baseline.lastAcceptedApply).toMatchObject({ rawLengthMeters: 2.5, engineResultSha256: null });
  });
  it('accepts numeric-scale equality only with exact after-revision and route equality', async () => {
    const f = fixture(); f.accepted.push({ receipt_id: id(30), cable_id: id(10), proposal_id: id(31), applied_at: '2026-10-18T00:00:00Z', after_revision: '9007199254740993',
      after_routing: '/OLD', after_design_length: '4.00', proposal_hash: 'c'.repeat(64), dependency_hash: 'd'.repeat(64), model_ref: model,
      route_text: '/OLD', raw_length: 2.5, design_length: '4', unrounded_length: '3.2' });
    await persistRevisionAdmission(f.client, f.input()); expect((await readRevisionBaseline(f.client, { projectId: pid, jobId: jid, cableId: id(10) })).baseline.acceptedMatchesCurrent).toBe(true);
  });
  it('reuses the original baseline on exact admission replay and refuses a changed scope', async () => {
    const f = fixture(), input = f.input(), a = await persistRevisionAdmission(f.client, input); f.accepted.push({ invalid: 'later receipt must not be consulted' });
    expect(await persistRevisionAdmission(f.client, input)).toBe(a); expect(f.admissions).toHaveLength(1);
    expect(f.calls.filter(c => c.sql.includes('SELECT DISTINCT ON'))).toHaveLength(1);
    const changed = f.input(); changed.items[0].cable.id = id(50); await expect(persistRevisionAdmission(f.client, changed)).rejects.toMatchObject({ code: 'REVISION_ADMISSION_CONFLICT' });
  });
  it('retains an all-blocked automatic generation without manufacturing a job', async () => {
    const f = fixture(), input = f.input(3); input.jobId = null; input.kind = 'automatic'; input.generation = '27';
    for (const item of input.items) { item.dependencies = null; item.status = 'location_required'; item.message = 'Confirm the missing location.'; }
    await persistRevisionAdmission(f.client, input); expect(f.admissions[0]).toMatchObject({ job_id: null, generation: '27', total: 3 }); expect(f.baselines).toHaveLength(3);
  });
  it.each([false, true])('binds the observed-events JSON array as JSON text, populated=%s', async populated => {
    const f = fixture(), input = f.input();
    if (populated) { input.kind = 'automatic'; input.generation = '27'; f.events.push({ generation: '27', domain: 'endpoints', reason: 'LOCATION_REGISTRY_CHANGED', source_revision: '12' }); }
    await persistRevisionAdmission(f.client, input);
    const insert = f.calls.find(call => call.sql.startsWith('INSERT INTO pf_revision_admissions'))!;
    expect(insert.sql).toContain('$10::jsonb'); expect(typeof insert.values[9]).toBe('string');
    const expected = populated ? [{ generation: '27', domain: 'endpoints', reason: 'LOCATION_REGISTRY_CHANGED', sourceRevisionSha256: revisionResultHash('12') }] : [];
    expect(JSON.parse(insert.values[9] as string)).toEqual(expected); expect(f.admissions[0].observed_events).toEqual(expected);
    if (!populated) expect(insert.values[9]).toBe('[]');
  });
  it('seals exact baseline/result/dependency/ledger hashes without a circular result hash', async () => {
    const f = fixture(), p = await f.prepare(), value = await sealRevisionResult(f.client, { projectId: pid, jobId: jid, cableId: id(10), proposalId: p.proposalId, dependencyHash: revisionResultHash(p.deps), result: p.result, dependencies: p.deps });
    expect(value.baselineHash).toBe(p.baseline.baselineHash); expect(value.lengthLedger).toEqual(ledger); expect(value.physicalChangeProven).toBe(false);
    expect(value.summary.delta).toEqual({ rawLengthMeters: null, designLengthMeters: '3', unroundedMeters: null, baseline: 'current-values' });
    expect(await verifyRevisionResultForProposal(f.client, { projectId: pid, proposalId: p.proposalId, result: p.result, dependencies: p.deps, proposalHash: f.proposals[0].proposal_hash as string })).toEqual(value);
  });
  it('refuses missing or mismatched opted-in successful length components before sealing', async () => {
    const f = fixture(), result = output(); result.lengthLedger.settingsRevision = '999'; const p = await f.prepare(result);
    await expect(sealRevisionResult(f.client, { projectId: pid, jobId: jid, cableId: id(10), proposalId: p.proposalId, dependencyHash: revisionResultHash(p.deps), result: p.result, dependencies: p.deps })).rejects.toMatchObject({ code: 'ENGINE_LENGTH_LEDGER_INVALID' }); expect(f.seals).toHaveLength(0);
  });
  it('retains failed output without a fake ledger or design', async () => {
    const f = fixture(), result = { schemaVersion: 'pathfinder.model.response.v1', requestId: id(6), status: 'no_path', message: 'No path.', engineeringAccepted: false, calculationMode: 'calculate' }, p = await f.prepare(result);
    const value = await sealRevisionResult(f.client, { projectId: pid, jobId: jid, cableId: id(10), proposalId: p.proposalId, dependencyHash: revisionResultHash(p.deps), result, dependencies: p.deps });
    expect(value.lengthLedger).toBeNull(); expect(value.summary.designLengthMeters).toBeNull(); expect(value.summary.reasonCodes).toContain('CALCULATION_OUTPUT_UNAVAILABLE');
  });
  it.each(['no_path', 'resource_limit'])('keeps %s failed-route placeholders out of new lengths and accepted-current deltas', async status => {
    const f = fixture(); f.accepted.push({ receipt_id: id(30), cable_id: id(10), proposal_id: id(31), applied_at: '2026-10-18T00:00:00Z', after_revision: '9007199254740993',
      after_routing: '/OLD', after_design_length: '4.00', proposal_hash: 'c'.repeat(64), dependency_hash: 'd'.repeat(64), model_ref: model,
      route_text: '/OLD', raw_length: 2.5, design_length: '4', unrounded_length: '3.2' });
    const { lengthLedger: _ledger, design: _design, ...successful } = output();
    const result = { ...successful, status, design: null, route: { ...successful.route, success: false, routeText: '', routeCodes: [], segmentIds: [], pathPoints: [],
      lengthMeters: 0, fromDistanceMeters: 0, toDistanceMeters: 0 } }, p = await f.prepare(result);
    expect(p.baseline.baseline.acceptedMatchesCurrent).toBe(true);
    const value = await sealRevisionResult(f.client, { projectId: pid, jobId: jid, cableId: id(10), proposalId: p.proposalId, dependencyHash: revisionResultHash(p.deps), result, dependencies: p.deps });
    expect(value.engineResultSha256).toBe(revisionResultHash(result)); expect(f.proposals[0].result).toEqual(result);
    expect(value.summary).toMatchObject({ routeText: null, rawLengthMeters: null, designLengthMeters: null, unroundedMeters: null,
      delta: { rawLengthMeters: null, designLengthMeters: null, unroundedMeters: null, baseline: 'accepted-current' } });
    expect(value.summary.reasonCodes).not.toContain('OBSERVED_ROUTE_TEXT_CHANGED'); expect(value.lengthLedger).toBeNull();
  });
  it('retains successful geometry when Details settings are missing, without inventing design values', async () => {
    const f = fixture(), { lengthLedger: _ledger, design: _design, ...successful } = output();
    const result = { ...successful, route: { ...successful.route, fromRequiresSecondary: true }, status: 'settings_required', design: null }, p = await f.prepare(result);
    const value = await sealRevisionResult(f.client, { projectId: pid, jobId: jid, cableId: id(10), proposalId: p.proposalId, dependencyHash: revisionResultHash(p.deps), result, dependencies: p.deps });
    expect(value.summary).toMatchObject({ routeText: '/A', rawLengthMeters: 5, designLengthMeters: null, unroundedMeters: null });
    expect(value.summary.delta.designLengthMeters).toBeNull(); expect(value.summary.delta.unroundedMeters).toBeNull(); expect(value.lengthLedger).toBeNull();
    expect(value.summary.reasonCodes).toContain('DESIGN_OUTPUT_UNAVAILABLE');
  });
  it('rejects baseline tampering and leaves genuinely legacy missing seals unavailable', async () => {
    const f = fixture(), p = await f.prepare(); expect(await verifyRevisionResultForProposal(f.client, { projectId: pid, proposalId: id(99), result: {}, dependencies: {} })).toBeNull();
    (f.baselines[0].baseline as { acceptedMatchesCurrent: boolean }).acceptedMatchesCurrent = true;
    await expect(readRevisionBaseline(f.client, { projectId: pid, jobId: jid, cableId: id(10) })).rejects.toThrow(); expect(p.proposalId).toBe(id(20));
  });
  it('keyset-pages a 2140-row all-blocked admission with one bounded current collection per page', async () => {
    const f = fixture(), input = f.input(2140); input.kind = 'automatic'; input.generation = '27'; input.jobId = null;
    for (const item of input.items) { item.dependencies = null; item.status = 'location_required'; }
    const admission = await persistRevisionAdmission(f.client, input), collect = vi.fn(async (_client: PoolClient, request: Parameters<typeof collectDependencyBatchInTransaction>[1]) => ({ items: (request.cableIds ?? []).map((cableId: string) => ({ id: cableId, cable: cable(), dependencies: null, status: 'location_required', message: '' })), options: { ...defaultOptions }, registryRevision: '1', bytes: 1 }));
    const repo = createRevisionResults(f.pool, { collectCurrentPage: collect }), first = await repo.listPage(pid, who, admission, { limit: 100 });
    expect(first.rows).toHaveLength(100); expect(first.nextAfterCableId).toBe(first.rows.at(-1)?.cableId); expect(collect).toHaveBeenCalledTimes(1);
    const next = await repo.listPage(pid, who, admission, { afterCableId: first.nextAfterCableId!, limit: 100 });
    expect(next.rows).toHaveLength(100); expect(new Set([...first.rows, ...next.rows].map(r => r.cableId)).size).toBe(200);
    expect(first.rows.every(r => r.result === null && r.currentness.state === 'unavailable')).toBe(true);
  });
  it('uses live principal authorization for every read and refuses oversized wire pages', async () => {
    const f = fixture(), admission = await persistRevisionAdmission(f.client, f.input()); f.setAdmin(false);
    await expect(createRevisionResults(f.pool).listPage(pid, who, admission)).rejects.toMatchObject({ code: 'ADMIN_REQUIRED' });
    f.setAdmin(true); await expect(createRevisionResults(f.pool).listPage(pid, who, admission, { limit: 101 })).rejects.toThrow();
  });
  it('exposes a job failure before output without fabricating a new design result', async () => {
    const f = fixture(), admission = await persistRevisionAdmission(f.client, f.input()); f.failJob();
    const collect = vi.fn(async (_client: PoolClient, request: Parameters<typeof collectDependencyBatchInTransaction>[1]) => ({ items: (request.cableIds ?? []).map(cableId => ({ id: cableId, cable: cable(), dependencies: null, status: 'ready', message: '' })), options: { ...defaultOptions }, registryRevision: '1', bytes: 1 }));
    const page = await createRevisionResults(f.pool, { collectCurrentPage: collect }).listPage(pid, who, admission);
    expect(page.rows[0]).toMatchObject({ status: 'failed', message: 'Synthetic engine fault.', result: null });
  });
  it('keeps the immutable baseline and reports a removed cable without collecting a nonexistent current input', async () => {
    const f = fixture(), admission = await persistRevisionAdmission(f.client, f.input()); f.deleteCable(id(10));
    const collect = vi.fn(); const page = await createRevisionResults(f.pool, { collectCurrentPage: collect }).listPage(pid, who, admission);
    expect(page.rows[0].baseline.currentCable.id).toBe(id(10)); expect(page.rows[0].currentness).toEqual({ state: 'missing', reasonCodes: ['CABLE_NOT_FOUND'] });
    expect(f.baselines).toHaveLength(1); expect(collect).not.toHaveBeenCalled();
  });
});
