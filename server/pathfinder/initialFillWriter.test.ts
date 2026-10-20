// @vitest-environment node
import type { Pool } from 'pg';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createInitialFillWriter } from './initialFillWriter.js';
import { initialFillIdempotencyKey } from './initialFillIdentity.js';
import { hash } from './dependencies.js';
import { defaultOptions, type EngineResponse, type ScopedDependencySnapshot } from './jobContracts.js';
import { syntheticEngineIdentity } from './calculationFixtures.js';
import { locationImpactItemSchema } from '../../shared/pathfinderLocationImpacts.js';
import { INITIAL_FILL_ROUTING_WHITESPACE, initialFillProvenanceSchema, type InitialFillMandate } from '../../shared/pathfinderInitialFill.js';
import { PathFinderError } from './errors.js';

// This suite executes the real writer, transaction wrapper, ledger validator and
// history helper. Immutable mandate authority and engineering reads are explicit
// injected/mocked boundaries; the SQL transport is transactional synthetic data.
const mandateMocks = vi.hoisted(() => ({ read: vi.fn(), requireCurrent: vi.fn() }));
vi.mock('./initialFillMandates.js', () => ({ readInitialFillMandate: mandateMocks.read, requireCurrentInitialFillMandate: mandateMocks.requireCurrent }));
type Row = Record<string, any>;
const id = (n: number) => `f7000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const now = Date.parse('2026-10-20T12:00:00.000Z');
beforeEach(() => { vi.resetAllMocks(); vi.useFakeTimers(); vi.setSystemTime(now); });
afterEach(() => { vi.useRealTimers(); });

function fixture() {
  const projectId = id(1), cableId = id(2), proposalId = id(3), jobId = id(4), mandateId = id(5), impactId = id(6);
  const current = { modelVersionId: id(7), selectionRevision: '1', contentFingerprint: 'a'.repeat(64), aggregateId: id(8), artifactId: id(9), projectionSha256: 'b'.repeat(64), captureFrameId: id(10), geometryRevision: '2', traceId: id(11) };
  const mandate: InitialFillMandate = { schemaVersion: 'wfc.pf.initial-fill-mandate.v1', id: mandateId, projectId, impactId,
    impactContentSha256: 'c'.repeat(64), commandSha256: 'd'.repeat(64), idempotencyKey: id(12), mode: 'when-both-empty', actorId: id(13), actorAdminRevision: '2',
    loginId: id(14), loginExpiresAt: new Date(now + 60000).toISOString(), authorityExpiresAt: new Date(now + 30000).toISOString(), installationEpoch: id(15),
    current, eligibleCableIds: [cableId], createdAt: new Date(now).toISOString(), contentSha256: 'e'.repeat(64) };
  const endpoint = (locationId: string) => ({ locationId, locationRevision: '1', bindingRevision: '1', point: [1, 2, 3] as [number, number, number], bindingId: id(16), bindingContentSha256: 'f'.repeat(64),
    mode: 'fixed-world' as const, captureFrameId: current.captureFrameId, qualifiedProjectFrameId: null, aggregateId: current.aggregateId, projectionSha256: current.projectionSha256, sourceObjectRevisionId: null, migrationDecisionId: null });
  const dependencies: ScopedDependencySnapshot = { schemaVersion: 'pathfinder.dependencies.v7', projectId, cableId, cableWriteRevision: '7',
    model: { id: current.modelVersionId, selectionRevision: '1', contentFingerprint: current.contentFingerprint }, artifact: { id: current.artifactId, sha256: current.projectionSha256 },
    preparation: { aggregateId: current.aggregateId, geometryRevision: current.geometryRevision, captureFrameId: current.captureFrameId, projectionSha256: current.projectionSha256 },
    routing: { catalogRevision: '1', routingContentSha256: 'a'.repeat(64), routingPolicyRevision: '1', routingPolicySha256: 'b'.repeat(64) },
    cableInputs: { fromLocation: 'FROM', toLocation: 'TO', mto: 'LV', cableTypeId: id(17) },
    settings: { revision: '2', connectionGap: '1', secondaryTrayLength: null, endConnectionLength: '1', additionalBendingPercent: '10' }, options: { ...defaultOptions },
    from: endpoint(id(18)), to: endpoint(id(19)), endpointResolution: { schemaVersion: 'pathfinder.endpoint-resolution.v1', matchingPolicy: 'nfc-trim-uppercase-v1', from: { logicalKey: 'FROM', locationId: id(18) }, to: { logicalKey: 'TO', locationId: id(19) } },
    comparison: null, engineVersion: 'pathfinder-45c24bf5-pf1-modelrunner-v1', engineIdentity: syntheticEngineIdentity() };
  const result: EngineResponse = { schemaVersion: 'pathfinder.model.response.v1', requestId: id(20), status: 'calculated', message: 'Synthetic writer fixture.', engineeringAccepted: false,
    route: { success: true, message: '', routeText: '/A', routeCodes: ['A'], segmentIds: ['dbid:1'], pathPoints: [{ x: 0, y: 0, z: 0 }, { x: 5, y: 0, z: 0 }], lengthMeters: 5, fromDistanceMeters: 1, toDistanceMeters: 1, fromRequiresSecondary: false, toRequiresSecondary: false, connectionGapCount: 0, connectionGapLengthMeters: 0 },
    design: { lengthBeforePercentageMeters: '6', unroundedLengthMeters: '6.6', designLengthMeters: '7' }, lengthLedger: { schemaVersion: 'wfc.pf.length-components.v1', formulaVersion: 'pathfinder-45c24bf5', settingsRevision: '2',
      raw: { lengthMeters: 5, fromDistanceMeters: 1, toDistanceMeters: 1 }, rawLengthDecimalMeters: '5', from: { requiresSecondary: false, removedApproachMeters: '0' }, to: { requiresSecondary: false, removedApproachMeters: '0' },
      settings: { secondaryTrayLengthMeters: null, endConnectionLengthMeters: '1', additionalBendingPercent: '10' }, secondaryEnds: 0, replacementMeters: '0', beforeClampMeters: '5', clampAdjustmentMeters: '0', afterClampMeters: '5',
      beforePercentageMeters: '6', bendingIncrementMeters: '0.6', unroundedMeters: '6.6', ceilingIncrementMeters: '0.4', designLengthMeters: '7', gapAccounting: 'already-in-raw-geometry' } };
  const proposal: Row = { id: proposalId, project_id: projectId, cable_id: cableId, job_id: jobId, status: 'calculated', proposal_hash: 'c'.repeat(64), dependency_hash: hash(dependencies), dependencies, result, job_state: 'complete', cancel_requested: false };
  const seal: Row = { admissionId: id(21), revisionResultSha256: 'd'.repeat(64), baselineHash: 'e'.repeat(64), engineResultSha256: hash(result), ledgerHash: hash(result.lengthLedger), dependencyHash: hash(dependencies) };
  const itemBody = { schemaVersion: 'wfc.pf.location-impact-item.v1' as const, projectId, impactId, cableId, generation: '3', cableWriteRevision: '7', fromLogicalKey: 'FROM', toLogicalKey: 'TO', category: 'LV', eligible: true };
  const item = locationImpactItemSchema.parse({ ...itemBody, contentSha256: hash(itemBody) });
  const member: Row = { generation: '3', record_sha256: item.contentSha256, record: item };
  const keyInput = () => ({ projectId, cableId, proposalId, proposalHash: proposal.proposal_hash, mandateId, expectedCableWriteRevision: dependencies.cableWriteRevision });
  const request = { schemaVersion: 'wfc.pf.initial-fill-request.v1' as const, idempotencyKey: initialFillIdempotencyKey(keyInput()), proposalId, expectedProposalHash: proposal.proposal_hash, mandateId, expectedCableWriteRevision: dependencies.cableWriteRevision };
  const state = { cable: { id: cableId, project_id: projectId, mto: 'LV', from_location: 'FROM', to_location: 'TO', cable_type_id: id(17), routing: null, design_length: null, install_length: '123.4500', cable_write_revision: '7', revision: 'engineering-1', tag: 'Synthetic cable', updated_at: new Date(now).toISOString() } as Row,
    history: [] as Row[], receipts: [] as Row[], admin: true, loginRevoked: false, projectExists: true, proposalPresent: true, snapshotPresent: true,
    casMiss: false, historyFails: false, historyMissing: false, receiptFails: false, commitLostAck: false, beforeCommitFails: false,
    writes: 0, commits: 0, postUpdate: null as null | ((value: Row) => void), onCommit: null as null | ((count: number) => void) };
  let backup: Pick<typeof state, 'cable' | 'history' | 'receipts'> | null = null;
  const query = vi.fn(async (sql: string, args: any[] = []) => {
    if (sql === 'BEGIN') { backup = structuredClone({ cable: state.cable, history: state.history, receipts: state.receipts }); return { rows: [] }; }
    if (sql === 'COMMIT') {
      state.commits++; if (state.beforeCommitFails && state.commits === 2) throw Error('Synthetic commit transport failure before durability.');
      backup = null; state.onCommit?.(state.commits); if (state.commitLostAck && state.commits === 2) throw Error('Synthetic acknowledgement lost after durability.'); return { rows: [] };
    }
    if (sql === 'ROLLBACK') { if (backup) Object.assign(state, structuredClone(backup)); backup = null; return { rows: [] }; }
    if (sql.startsWith('SET LOCAL') || sql.startsWith('SELECT set_config') || sql.startsWith('INSERT INTO viewer_login_bindings')) return { rows: [] };
    if (sql.startsWith('SELECT id FROM projects')) return { rows: state.projectExists ? [{ id: projectId }] : [] };
    if (sql.startsWith('SELECT is_admin FROM users')) return { rows: [{ is_admin: state.admin }] };
    if (sql.startsWith('SELECT user_id,expires_at,revoked_at')) return { rows: [{ user_id: mandate.actorId, expires_at: mandate.loginExpiresAt, revoked_at: state.loginRevoked ? new Date(now) : null }] };
    if (sql.includes('initial-fill:receipt')) return { rows: state.receipts.filter(value => value.idempotency_key === args[1] && value.actor_id === mandate.actorId) };
    if (sql.includes('initial-fill:proposal') || sql.includes('FROM pf_proposals WHERE')) return { rows: state.proposalPresent ? [proposal] : [] };
    if (sql.includes('FROM pf_location_impact_items')) return { rows: [member] };
    if (sql.includes('FROM cables c') && sql.endsWith('FOR UPDATE')) return { rows: state.snapshotPresent ? [{ value: structuredClone(state.cable) }] : [] };
    if (sql.startsWith('UPDATE cables c')) {
      state.writes++; if (state.casMiss || state.cable.cable_write_revision !== args[4] || state.cable.design_length !== null || state.cable.routing !== null && state.cable.routing.trim() !== '') return { rows: [] };
      state.cable = { ...state.cable, routing: args[2], design_length: args[3], cable_write_revision: (BigInt(state.cable.cable_write_revision) + 1n).toString(), updated_at: new Date(now + 1).toISOString() };
      state.postUpdate?.(state.cable); return { rows: [{ value: structuredClone(state.cable) }] };
    }
    if (sql.startsWith('INSERT INTO cable_versions')) { if (state.historyFails) throw Error('Synthetic history failure.'); if (state.historyMissing) return { rows: [] }; state.history.push({ id: args[0], cable: structuredClone(state.cable), actorId: args[3] }); return { rows: [{ id: args[0] }] }; }
    if (sql.startsWith('INSERT INTO pf_apply_receipts')) {
      if (state.receiptFails) throw Error('Synthetic receipt failure.'); state.receipts.push({ id: args[0], project_id: args[1], actor_id: args[2], idempotency_key: args[3], payload_hash: args[4], proposal_id: args[5], cable_id: args[6], before_snapshot: args[7], after_snapshot: args[8], provenance: args[9] }); return { rows: [] };
    }
    throw Error('Unexpected synthetic SQL: ' + sql.slice(0, 150));
  });
  const release = vi.fn(), pool = { connect: vi.fn(async () => ({ query, release })) } as unknown as Pool;
  mandateMocks.read.mockResolvedValue(mandate); mandateMocks.requireCurrent.mockResolvedValue(mandate);
  const collect = vi.fn(async () => ({ dependencies, cable: { cable_write_revision: dependencies.cableWriteRevision } })), identity = vi.fn(async () => syntheticEngineIdentity()), snapshot = vi.fn(async () => ({})),
    verifySeal = vi.fn(async () => seal), proof = vi.fn(async () => true), applicability = vi.fn(async () => ({ applicable: true }));
  const writer = createInitialFillWriter(pool, { collect: collect as any, identity, snapshot: snapshot as any, seal: verifySeal as any, proof, applicability: applicability as any });
  const fence = vi.fn(async () => undefined);
  const run = (signal?: AbortSignal) => writer.apply(projectId, request, fence, signal);
  const resignMember = () => { const { contentSha256: _hash, ...body } = member.record; member.record.contentSha256 = hash(body); member.record_sha256 = member.record.contentSha256; };
  return { projectId, cableId, proposalId, jobId, mandate, dependencies, result, proposal, seal, member, request, state, query, release, pool, collect, identity, snapshot, verifySeal, proof, applicability, fence, run, resignMember };
}

describe('conditional initial-fill writer with synthetic transactional SQL and explicit proof adapters', () => {
  it('writes only the exact pair once with real history, separate automatic provenance and unchanged install length', async () => {
    const f = fixture(), outcome = await f.run(); expect(outcome.status).toBe('written'); expect(f.state.cable).toMatchObject({ routing: '/A', design_length: '7', install_length: '123.4500', cable_write_revision: '8', revision: 'engineering-1' });
    expect(f.state.history).toHaveLength(1); expect(f.state.receipts).toHaveLength(1); expect(f.state.history[0].cable).toEqual(f.state.cable);
    const receipt = f.state.receipts[0], provenance = initialFillProvenanceSchema.parse(receipt.provenance);
    expect(provenance).toMatchObject({ engineeringAccepted: false, validationMethod: 'automatic-initial-fill', nativeParity: 'not-performed', request: f.request, authorized: { actorId: f.mandate.actorId, loginId: f.mandate.loginId, targetGeneration: '3' } });
    expect(f.collect).toHaveBeenCalledWith(expect.anything(), f.projectId, f.cableId, f.dependencies.options, 'pathfinder.dependencies.v7', true, expect.anything());
    expect(f.fence).toHaveBeenCalledTimes(3); expect(mandateMocks.requireCurrent).toHaveBeenCalledTimes(3);
    expect(f.query.mock.calls.map(([sql]) => sql).join('\n')).not.toMatch(/pf_reviews|UPDATE pf_location|INSERT INTO pf_jobs/);
    expect(f.query.mock.calls.find(([sql]) => sql.startsWith('UPDATE cables c'))?.[1]?.slice(4)).toEqual(['7', INITIAL_FILL_ROUTING_WHITESPACE]);
  });
  it.each([null, '', ' \t\n\u00a0\ufeff'])('accepts only truly blank routing %j paired with SQL NULL design', async routing => {
    const f = fixture(); f.state.cable.routing = routing; expect((await f.run()).status).toBe('written');
  });
  it.each([
    { routing: '/MANUAL', design_length: null }, { routing: null, design_length: '0' }, { routing: '', design_length: 0 },
    { routing: '', design_length: '' }, { routing: '', design_length: undefined }, { routing: '', design_length: NaN },
    { routing: '/OLD', design_length: '99' }, { routing: '\u200b', design_length: null },
  ])('preserves existing or invalid pair %j and requires human review', async value => {
    const f = fixture(); Object.assign(f.state.cable, value); const before = structuredClone(f.state.cable); expect(await f.run()).toMatchObject({ status: 'review-required', receiptId: null });
    expect(f.state.cable).toEqual(before); expect(f.state.writes).toBe(0); expect(f.state.history).toHaveLength(0); expect(f.state.receipts).toHaveLength(0);
  });
  it.each(['MV', 'Unknown'])('does not write an ineligible current %s cable even if injected engineering reads are permissive', async mto => {
    const f = fixture(); f.state.cable.mto = mto; expect((await f.run()).status).toBe('review-required'); expect(f.state.writes).toBe(0);
  });
  it('does not turn calculation-only absence of a mandate into write authority', async () => {
    const f = fixture(); mandateMocks.read.mockResolvedValue(null); await expect(f.run()).rejects.toMatchObject({ code: 'INITIAL_FILL_MANDATE_REQUIRED' }); expect(f.state.writes).toBe(0); expect(f.fence).not.toHaveBeenCalled();
  });
  it.each(['admin', 'login', 'project'] as const)('requires the current original %s at the real transaction boundary', async kind => {
    const f = fixture(); if (kind === 'admin') f.state.admin = false; if (kind === 'login') f.state.loginRevoked = true; if (kind === 'project') f.state.projectExists = false;
    await expect(f.run()).rejects.toMatchObject({ code: kind === 'admin' ? 'ADMIN_REQUIRED' : kind === 'login' ? 'LOGIN_REVOKED' : 'PROJECT_NOT_FOUND' }); expect(f.state.writes).toBe(0);
  });
  it.each([1, 2, 3])('rolls back if exact live mandate authority is refused at check %i', async call => {
    const f = fixture(), before = structuredClone(f.state.cable); mandateMocks.requireCurrent.mockImplementation(async () => {
      if (mandateMocks.requireCurrent.mock.calls.length === call) throw new PathFinderError('LOCATION_IMPACT_TARGET_SUPERSEDED', 409); return f.mandate;
    }); await expect(f.run()).rejects.toMatchObject({ code: 'LOCATION_IMPACT_TARGET_SUPERSEDED' }); expect(f.state.cable).toEqual(before); expect(f.state.history).toHaveLength(0); expect(f.state.receipts).toHaveLength(0);
  });
  it.each([1, 2, 3])('rolls back if the exact consumer claim is lost at fence %i', async call => {
    const f = fixture(), before = structuredClone(f.state.cable); f.fence.mockImplementation(async () => { if (f.fence.mock.calls.length === call) throw new PathFinderError('INITIAL_FILL_CLAIM_LOST', 409); });
    await expect(f.run()).rejects.toMatchObject({ code: 'INITIAL_FILL_CLAIM_LOST' }); expect(f.state.cable).toEqual(before); expect(f.state.history).toHaveLength(0); expect(f.state.receipts).toHaveLength(0);
  });
  it.each(['revision', 'from', 'to', 'category', 'generation', 'hash', 'eligible'] as const)('refuses changed immutable original member %s before a cable write', async kind => {
    const f = fixture(); if (kind === 'revision') f.member.record.cableWriteRevision = '6'; if (kind === 'from') f.member.record.fromLogicalKey = 'OTHER'; if (kind === 'to') f.member.record.toLogicalKey = 'OTHER';
    if (kind === 'category') f.member.record.category = 'Control'; if (kind === 'generation') f.member.generation = '4'; if (kind === 'eligible') f.member.record.eligible = false;
    if (kind === 'hash') f.member.record_sha256 = '0'.repeat(64); else f.resignMember(); await expect(f.run()).rejects.toBeDefined(); expect(f.state.writes).toBe(0);
  });
  it.each(['proposal-hash', 'request-key', 'legacy-dependencies', 'proposal-status', 'missing-proposal', 'missing-snapshot', 'no-seal', 'not-applicable', 'changed-dependencies', 'changed-write-revision', 'invalid-ledger', 'oversized-route'] as const)('refuses %s without recording any pair/history/receipt', async kind => {
    const f = fixture(); if (kind === 'proposal-hash') f.request.expectedProposalHash = 'f'.repeat(64); if (kind === 'request-key') f.request.idempotencyKey = id(999);
    if (kind === 'legacy-dependencies') (f.dependencies as Row).schemaVersion = 'pathfinder.dependencies.v5'; if (kind === 'proposal-status') f.proposal.status = 'no_path'; if (kind === 'missing-proposal') f.state.proposalPresent = false;
    if (kind === 'missing-snapshot') f.state.snapshotPresent = false; if (kind === 'no-seal') f.verifySeal.mockResolvedValue(null as any); if (kind === 'not-applicable') f.applicability.mockResolvedValue({ applicable: false });
    if (kind === 'changed-dependencies') f.collect.mockResolvedValue({ dependencies: { ...f.dependencies, settings: { ...f.dependencies.settings, revision: '999' } }, cable: { cable_write_revision: '7' } });
    if (kind === 'changed-write-revision') f.collect.mockResolvedValue({ dependencies: f.dependencies, cable: { cable_write_revision: '8' } });
    if (kind === 'invalid-ledger') f.result.lengthLedger!.settings.endConnectionLengthMeters = '9'; if (kind === 'oversized-route') f.result.route!.routeText = '/' + 'A'.repeat(8001);
    const before = structuredClone(f.state.cable); await expect(f.run()).rejects.toBeDefined(); expect(f.state.cable).toEqual(before); expect(f.state.history).toHaveLength(0); expect(f.state.receipts).toHaveLength(0);
  });
  it('keeps the CAS and both-blank conditions in the actual SQL, refusing a missed update', async () => {
    const f = fixture(); f.state.casMiss = true; await expect(f.run()).rejects.toMatchObject({ code: 'CABLE_WRITE_CONFLICT' }); const sql = f.query.mock.calls.find(([sql]) => sql.startsWith('UPDATE cables c'))![0];
    expect(sql).toContain('c.cable_write_revision=$5'); expect(sql).toContain('c.design_length IS NULL'); expect(sql).toContain("c.routing IS NULL OR btrim(c.routing,$6)=''"); expect(f.state.receipts).toHaveLength(0);
  });
  it.each(['install', 'business-revision', 'wrong-route', 'wrong-design', 'write-revision', 'dropped-field'] as const)('rolls back a nonconforming returned %s change', async kind => {
    const f = fixture(), before = structuredClone(f.state.cable); f.state.postUpdate = after => { if (kind === 'install') after.install_length = '0'; if (kind === 'business-revision') after.revision = 'changed'; if (kind === 'wrong-route') after.routing = '/OTHER'; if (kind === 'wrong-design') after.design_length = '8'; if (kind === 'write-revision') after.cable_write_revision = '9'; if (kind === 'dropped-field') delete after.tag; };
    await expect(f.run()).rejects.toMatchObject({ code: 'INITIAL_FILL_WRITE_INTEGRITY' }); expect(f.state.cable).toEqual(before); expect(f.state.history).toHaveLength(0); expect(f.state.receipts).toHaveLength(0);
  });
  it.each(['history-failure', 'history-no-row', 'receipt-failure', 'commit-before-durability'] as const)('atomically rolls back the pair when %s occurs', async kind => {
    const f = fixture(), before = structuredClone(f.state.cable); f.state.historyFails = kind === 'history-failure'; f.state.historyMissing = kind === 'history-no-row'; f.state.receiptFails = kind === 'receipt-failure'; f.state.beforeCommitFails = kind === 'commit-before-durability';
    await expect(f.run()).rejects.toBeDefined(); expect(f.state.cable).toEqual(before); expect(f.state.history).toHaveLength(0); expect(f.state.receipts).toHaveLength(0);
  });
  it('recognizes one durable exact receipt after lost COMMIT acknowledgement, without another write or renewed authority', async () => {
    const f = fixture(); f.state.commitLostAck = true; await expect(f.run()).rejects.toMatchObject({ code: 'ENDPOINT_COMMIT_OUTCOME_UNKNOWN' }); expect(f.state.receipts).toHaveLength(1);
    const authorityCalls = mandateMocks.requireCurrent.mock.calls.length; f.state.commitLostAck = false; vi.setSystemTime(now + 86400000);
    expect(await f.run()).toMatchObject({ status: 'already-written', receiptId: f.state.receipts[0].id, cableId: f.cableId }); expect(f.state.writes).toBe(1); expect(f.state.history).toHaveLength(1); expect(mandateMocks.requireCurrent).toHaveBeenCalledTimes(authorityCalls); expect(f.proof).toHaveBeenCalledTimes(1); expect(f.release).toHaveBeenCalledWith(true);
  });
  it.each(['payload', 'request', 'proof', 'seal', 'proposal-missing'] as const)('never blesses a corrupt historical %s replay', async kind => {
    const f = fixture(); await f.run(); if (kind === 'payload') f.state.receipts[0].payload_hash = 'f'.repeat(64); if (kind === 'request') f.state.receipts[0].provenance.request.expectedCableWriteRevision = '6';
    if (kind === 'proof') f.proof.mockResolvedValue(false); if (kind === 'seal') f.verifySeal.mockResolvedValue(null as any); if (kind === 'proposal-missing') f.state.proposalPresent = false;
    await expect(f.run()).rejects.toMatchObject({ code: expect.stringMatching(/^INITIAL_FILL_RECEIPT_(?:CONFLICT|INTEGRITY)$/) }); expect(f.state.writes).toBe(1); expect(f.state.history).toHaveLength(1);
  });
  it('returns unknown after mandate expiry during successful COMMIT and reconciles the durable receipt later', async () => {
    const f = fixture(); f.state.onCommit = count => { if (count === 2) vi.setSystemTime(now + 30000); }; await expect(f.run()).rejects.toMatchObject({ code: 'INITIAL_FILL_COMMIT_OUTCOME_UNKNOWN' });
    expect(f.state.receipts).toHaveLength(1); expect((await f.run()).status).toBe('already-written'); expect(f.state.writes).toBe(1);
  });
  it('retains exact durable recovery after abort during COMMIT and never dispatches a replacement request', async () => {
    const f = fixture(), controller = new AbortController(); f.state.onCommit = count => { if (count === 2) controller.abort(); };
    await expect(f.run(controller.signal)).rejects.toMatchObject({ code: 'ENDPOINT_COMMIT_OUTCOME_UNKNOWN' }); expect(f.state.receipts).toHaveLength(1); expect((await f.run()).status).toBe('already-written'); expect(f.state.writes).toBe(1);
  });
  it('does not acquire a connection for an already aborted exact request', async () => {
    const f = fixture(), controller = new AbortController(); controller.abort(); await expect(f.run(controller.signal)).rejects.toBeDefined(); expect(f.pool.connect).not.toHaveBeenCalled();
  });
});
