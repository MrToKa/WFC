// @vitest-environment node
import type { Pool, PoolClient } from 'pg';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { LengthLedger } from '../../shared/pathfinderLengthLedger.js';
import { defaultOptions, engineResponseSchema, type BarrierDependencySnapshot, type DependencySnapshot } from './jobContracts.js';
import { BARRIER_RUNTIME_PROFILE, barrierRouteHashInput, createBarrierRuntimePolicy, type BarrierRuntimeContext } from '../../shared/pathfinderBarrierRuntime.js';
import { syntheticBarrierEngineIdentity } from './calculationFixtures.js';
import { readBarrierWriteEvidence } from './barrierWrites.js';
import { PathFinderError } from './errors.js';
import type { collectDependencyBatchInTransaction } from './dependencyBatch.js';
import { persistRevisionAdmission, readRevisionBaseline, revisionResultHash, sealRevisionResult, verifyRevisionResultForProposal, createRevisionResults,
  type RevisionAdmissionInput } from './revisionResultRepository.js';

const applicabilitySeams = vi.hoisted(() => ({ authority:vi.fn(),applicable:vi.fn() }));
vi.mock('./recalculationRepository.js', () => ({ readRecalculationJobAuthority: applicabilitySeams.authority }));
vi.mock('./proposalApplicability.js', () => ({ readProposalApplicability: applicabilitySeams.applicable }));
const initialFillProof = vi.hoisted(() => vi.fn());
vi.mock('./initialFillReceiptProof.js', () => ({ createInitialFillReceiptProofReader: () => initialFillProof }));
beforeEach(() => { initialFillProof.mockReset(); initialFillProof.mockResolvedValue(false); applicabilitySeams.authority.mockReset();applicabilitySeams.authority.mockResolvedValue({enrolled:false});
  applicabilitySeams.applicable.mockReset();applicabilitySeams.applicable.mockResolvedValue({applicable:false,evidence:null}); });
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
/** Strict protected empty-declaration calculation: this is an integrity fixture,
 * not a certificate about actual civil geometry or user engineering acceptance. */
function protectedCalculation() {
  const preparation = { aggregateId: id(100), geometryRevision: '2', captureFrameId: id(101), projectionSha256: '1'.repeat(64) },
    scope = { projectId: pid, modelVersionId: model.id, selectionRevision: model.selectionRevision, contentFingerprint: model.contentFingerprint,
      captureFrameId: preparation.captureFrameId, captureFrameSha256: '2'.repeat(64), coordinateFrame: 'canonical-world-metres' as const },
    policy = createBarrierRuntimePolicy(false);
  const barriers: BarrierRuntimeContext = { schemaVersion: 'wfc.pf.barrier-runtime.v1', binding: { scope, registryRevision: '3',
    snapshot: { snapshotId: id(102), scope, registryRevision: '3', contentSha256: '3'.repeat(64), mode: 'explicit-empty' }, policy, policySha256: revisionResultHash(policy) },
    profile: structuredClone(BARRIER_RUNTIME_PROFILE), profileSha256: revisionResultHash(BARRIER_RUNTIME_PROFILE),
    storage: { intentId: id(103), manifest: { blobId: id(104), sha256: '4'.repeat(64), bytes: 1000 }, capture: null } };
  const endpoint = (locationId: string, point: [number, number, number]) => ({ ...preparation, locationId, locationRevision: '1', bindingRevision: '1', point,
    bindingId: id(105), bindingContentSha256: '5'.repeat(64), mode: 'fixed-world' as const, qualifiedProjectFrameId: null, sourceObjectRevisionId: null, migrationDecisionId: null });
  const from = endpoint(id(106), [0, 0, 0]), to = endpoint(id(107), [5, 0, 0]);
  // Geometry revision belongs to preparation rather than endpoint provenance.
  const { geometryRevision: _fromRevision, ...fromPoint } = from, { geometryRevision: _toRevision, ...toPoint } = to;
  const deps: BarrierDependencySnapshot = { schemaVersion: 'pathfinder.dependencies.v8', projectId: pid, cableId: id(10), cableWriteRevision: '9007199254740993', model,
    artifact: { id: id(108), sha256: preparation.projectionSha256 }, preparation,
    routing: { catalogRevision: '2', routingContentSha256: '6'.repeat(64), routingPolicyRevision: '3', routingPolicySha256: '7'.repeat(64) },
    cableInputs: { fromLocation: 'From', toLocation: 'To', mto: 'LV', cableTypeId: id(109) }, settings: structuredClone(settings),
    options: { ...defaultOptions, barrierRouting: { schemaVersion: 'wfc.pf.barrier-admission-intent.v1', scope,
      expectedRegistryRevision: '3', expectedSnapshot: barriers.binding.snapshot, drillThroughWalls: false } }, from: fromPoint, to: toPoint,
    endpointResolution: { schemaVersion: 'pathfinder.endpoint-resolution.v1', matchingPolicy: 'nfc-trim-uppercase-v1',
      from: { logicalKey: 'FROM', locationId: from.locationId }, to: { logicalKey: 'TO', locationId: to.locationId } }, comparison: null,
    engineVersion: 'pathfinder-45c24bf5-pf1-modelrunner-v1', engineIdentity: syntheticBarrierEngineIdentity(), barriers };
  const routeHash = revisionResultHash(barrierRouteHashInput([[0, 0, 0], [5, 0, 0]])), { calculationMode: _mode, ...oldOutput } = output();
  const parsed = engineResponseSchema.parse({ ...oldOutput, schemaVersion: 'pathfinder.model.response.v3', effectiveCategory: 'LV', barriers: {
    schemaVersion: 'wfc.pf.barrier-execution.v1', context: barriers,
    proof: { schemaVersion: 'wfc.pf.barrier-check-proof.v2', binding: barriers.binding, routeSha256: routeHash, status: 'no-barriers-declared', routePointCount: 2,
      totalSegments: 1, checkedSegments: 0, blocking: null, failedSegmentIndex: null, reasonCode: 'EXPLICIT_EMPTY_SCOPE', coverage: 'registered-selected-objects-only', engineeringAccepted: false },
    directSecondary: { schemaVersion: 'wfc.pf.constrained-direct-secondary.v2', policyVersion: 'nearest-eligible-tray-or-registered-barriers.v2', binding: barriers.binding,
      directRouteSha256: routeHash, mode: 'tray-network', directCheck: null, reasonCode: 'DISTANCE_NOT_QUALIFIED', distanceDecision: {
        schemaVersion: 'wfc.pf.direct-secondary.v1', policyVersion: 'nearest-eligible-tray-or.v1', coordinateFrame: 'canonical-world-metres', mode: 'tray-network',
        fromPoint: [0, 0, 0], toPoint: [5, 0, 0], distanceMeters: 5, nearestFromMeters: 1, nearestToMeters: 1, eligibleTrays: 1, comparison: null } },
    diagnostics: { status: 'no-barriers-declared', reasonCode: 'EXPLICIT_EMPTY_SCOPE', searchComplete: true, candidatesTruncated: false, pairAttempts: 0, collisionQueries: 0,
      work: '1', plannerAttempts: 0, straightPairAttempts: 0, localEdgeChecks: 0, localPhaseUsed: false, straightPhaseTruncated: false }, connectors: { from: null, to: null }, qualification: null } });
  return { deps, result: { ...parsed, calculationMode: 'calculate' } };
}
function fixture() {
  const admissions: Row[] = [], baselines: Row[] = [], seals: Row[] = [], proposals: Row[] = [], accepted: Row[] = [], events: Row[] = [], calls: Array<{ sql: string; values: unknown[] }> = [];
  let admin = true, failedWithoutOutput = false,jobState='queued',cancelRequested=false; const deletedCables = new Set<string>(),dependencyVersions=new Map<string,string>();
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
      return { rows: rows.map(b => { const s = seals.find(s => s.admission_id === b.admission_id && s.cable_id === b.cable_id), p = proposals.find(p => p.id === s?.proposal_id); return { ...b, record: s?.record ?? null, sealed_row: s ?? null, proposal_status: p?.status,
        dependency_version:dependencyVersions.get(String(b.cable_id))??(p?.dependencies as Row|undefined)?.schemaVersion,item_status: null, item_message: null,
        job_state: failedWithoutOutput ? 'failed' : jobState,cancel_requested:cancelRequested,job_failure: failedWithoutOutput ? 'Synthetic engine fault.' : null }; }) };
    }
    if (sql.startsWith('SELECT id,cable_write_revision::text FROM cables')) return { rows: baselines.filter(b => (values[1] as string[]).includes(String(b.cable_id)) && !deletedCables.has(String(b.cable_id))).map(b => ({ id: b.cable_id, cable_write_revision: (b.baseline as { currentCable: { cableWriteRevision: string } }).currentCable.cableWriteRevision })) };
    return { rows: [] };
  };
  const client = { query, release: vi.fn() } as unknown as PoolClient, pool = { connect: async () => client } as unknown as Pool;
  const input = (count = 1): RevisionAdmissionInput => ({ projectId: pid, jobId: jid, generation: null, kind: 'manual', inputSha256: 'b'.repeat(64), options: { ...defaultOptions },
    items: Array.from({ length: count }, (_, i) => ({ cable: cable(i + 10), dependencies: dependencies(id(i + 10)), status: 'ready', message: '' })) });
  const prepare = async (result: unknown = output(),deps:DependencySnapshot=dependencies()) => {
    const admissionId = await persistRevisionAdmission(client, input()), baseline = await readRevisionBaseline(client, { projectId: pid, jobId: jid, cableId: id(10) }), proposalId = id(20);
    proposals.push({ project_id: pid, id: proposalId, job_id: jid, cable_id: id(10), status: 'calculated', proposal_hash: revisionResultHash({ dependencies: deps, result, baselineHash: baseline.baselineHash }), dependency_hash: revisionResultHash(deps), dependencies: deps, result });
    return { admissionId, baseline, deps, proposalId, result };
  };
  return { client, pool, admissions, baselines, seals, proposals, accepted, events, calls, input, prepare,dependencyVersions,
    setJob:(state:string,cancel=false)=>{jobState=state;cancelRequested=cancel;},setAdmin: (value: boolean) => { admin = value; }, failJob: () => { failedWithoutOutput = true; }, deleteCable: (cableId: string) => { deletedCables.add(cableId); } };
}
async function protectedAcceptedBaselineFixture() {
  const f = fixture(), { deps, result } = protectedCalculation(), p = await f.prepare(result, deps);
  const seal = await sealRevisionResult(f.client, { projectId: pid, jobId: jid, cableId: id(10), proposalId: p.proposalId,
    dependencyHash: revisionResultHash(deps), result, dependencies: deps }), evidence = readBarrierWriteEvidence(deps, result);
  if (!evidence) throw Error('Expected complete strict protected synthetic calculation.');
  const before = { id: id(10), project_id: pid, tag: 'Synthetic cable', from_location: 'From', to_location: 'To', routing: '/OLD',
    design_length: '4.0000', install_length: '3.12500', cable_write_revision: '9007199254740993', revision: 'engineering-1', updated_at: '2026-10-21T00:00:00Z' },
    after = { ...before, routing: '/A', design_length: '7.0000', cable_write_revision: '9007199254740994', updated_at: '2026-10-21T00:01:00Z' };
  const provenance = { schemaVersion: 'pathfinder.apply.v3', proposalId: p.proposalId, proposalHash: seal.proposalHash, reviewId: id(120), dependencies: deps,
    validationMethod: 'manual-review', nativeParity: 'not-performed', barrierEvidence: evidence,
    review: { id: id(120), actorId: who.userId, loginId: who.loginId, validationMethod: 'manual-review', dependencyHash: seal.dependencyHash, revisionResultSha256: seal.revisionResultSha256 },
    revisionResult: { admissionId: seal.admissionId, revisionResultSha256: seal.revisionResultSha256, baselineHash: seal.baselineHash,
      engineResultSha256: seal.engineResultSha256, ledgerHash: seal.ledgerHash, dependencyHash: seal.dependencyHash } };
  const row: Row = { receipt_id: id(121), cable_id: id(10), proposal_id: p.proposalId, applied_at: '2026-10-21T00:01:00Z',
    after_revision: after.cable_write_revision, after_routing: after.routing, after_design_length: after.design_length,
    proposal_hash: seal.proposalHash, dependency_hash: seal.dependencyHash, model_ref: model, route_text: result.route!.routeText,
    raw_length: result.route!.lengthMeters, design_length: result.design!.designLengthMeters, unrounded_length: result.design!.unroundedLengthMeters,
    sealed_hash: seal.revisionResultSha256, engine_result_sha256: seal.engineResultSha256, ledger_sha256: seal.ledgerHash,
    initial_fill_kind: false, protected_apply_kind: true, accepted_before: before, accepted_after: after,
    accepted_provenance: provenance, accepted_dependencies: deps, accepted_result: result,
    receipt_actor_id: who.userId, receipt_idempotency_key: id(122),
    receipt_payload_hash: revisionResultHash({ proposalId: p.proposalId, idempotencyKey: id(122), reviewId: provenance.reviewId, expectedCableWriteRevision: before.cable_write_revision }),
    accepted_review_id: provenance.reviewId, accepted_review_actor: who.userId, accepted_review_proposal: p.proposalId, accepted_review_proposal_hash: seal.proposalHash,
    accepted_validation_method: 'manual-review', accepted_review_result_sha256: seal.revisionResultSha256,
    accepted_review_dependency_sha256: seal.dependencyHash, accepted_review_login_id: who.loginId };
  f.accepted.push(row);
  const run = async () => {
    const input = f.input(); input.jobId = id(123); input.options = deps.options; input.items[0].cable = after;
    input.items[0].dependencies = { ...deps, cableWriteRevision: after.cable_write_revision };
    await persistRevisionAdmission(f.client, input);
    return (await readRevisionBaseline(f.client, { projectId: pid, jobId: input.jobId, cableId: id(10) })).baseline;
  };
  return { f, deps, result, seal, evidence, before, after, provenance, row, run };
}

describe('immutable admission snapshots and revision envelopes', () => {
  it('recognizes an exact protected apply.v3 baseline through the real pure proof, seal, human review and receipt links', async () => {
    const value = await protectedAcceptedBaselineFixture(), baseline = await value.run();
    expect(baseline.acceptedMatchesCurrent).toBe(true);
    expect(baseline.lastAcceptedApply).toMatchObject({ receiptId: value.row.receipt_id, proposalId: value.seal.proposalId,
      proposalHash: value.seal.proposalHash, dependencyHash: value.seal.dependencyHash, engineResultSha256: value.seal.engineResultSha256,
      revisionResultSha256: value.seal.revisionResultSha256, routeText: '/A', rawLengthMeters: 5, designLengthMeters: '7',
      afterCableWriteRevision: '9007199254740994', afterRouting: '/A', afterDesignLength: '7.0000' });
    expect(value.after.install_length).toBe(value.before.install_length); expect(initialFillProof).not.toHaveBeenCalled();
    const sql = value.f.calls.find(call => call.sql.includes('SELECT DISTINCT ON'))!.sql;
    expect(sql).toContain("LEFT JOIN pf_reviews v ON v.project_id=r.project_id AND v.id::text=r.provenance->>'reviewId'");
    for (const alias of ['accepted_before', 'accepted_after', 'accepted_provenance', 'accepted_dependencies', 'accepted_result', 'accepted_review_login_id',
      'accepted_review_proposal_hash', 'accepted_review_result_sha256', 'accepted_review_dependency_sha256']) expect(sql).toContain(`AS ${alias}`);
  });
  it.each(['execution-evidence', 'route-evidence', 'policy-evidence', 'profile-evidence', 'context-evidence', 'result-evidence', 'dependency-evidence',
    'retained-result', 'retained-dependencies', 'provenance-dependencies', 'provenance-proposal', 'review-id', 'review-actor', 'review-proposal', 'review-proposal-hash',
    'review-login', 'review-method', 'review-dependency', 'review-result', 'revision-baseline', 'revision-ledger', 'revision-result', 'receipt-payload', 'receipt-key',
    'before-revision', 'after-revision', 'after-route', 'after-length', 'installed-length', 'business-field', 'missing-before', 'legacy-version'] as const)(
    'does not admit a protected accepted baseline with a tampered %s link', async kind => {
      const value = await protectedAcceptedBaselineFixture(), { row, provenance, evidence, before, after, result } = value;
      if (kind === 'execution-evidence') evidence.executionSha256 = 'f'.repeat(64);
      if (kind === 'route-evidence') evidence.routeSha256 = 'f'.repeat(64);
      if (kind === 'policy-evidence') evidence.policySha256 = 'f'.repeat(64);
      if (kind === 'profile-evidence') evidence.profileSha256 = 'f'.repeat(64);
      if (kind === 'context-evidence') evidence.contextSha256 = 'f'.repeat(64);
      if (kind === 'result-evidence') evidence.engineResultSha256 = 'f'.repeat(64);
      if (kind === 'dependency-evidence') evidence.dependencySha256 = 'f'.repeat(64);
      if (kind === 'retained-result') result.route!.pathPoints[0].x = 99;
      if (kind === 'retained-dependencies') row.accepted_dependencies = { ...value.deps, cableWriteRevision: '7' };
      if (kind === 'provenance-dependencies') provenance.dependencies = { ...value.deps, cableWriteRevision: '7' };
      if (kind === 'provenance-proposal') provenance.proposalHash = 'f'.repeat(64);
      if (kind === 'review-id') row.accepted_review_id = id(999);
      if (kind === 'review-actor') row.accepted_review_actor = id(999);
      if (kind === 'review-proposal') row.accepted_review_proposal = id(999);
      if (kind === 'review-proposal-hash') row.accepted_review_proposal_hash = 'f'.repeat(64);
      if (kind === 'review-login') row.accepted_review_login_id = id(999);
      if (kind === 'review-method') provenance.review.validationMethod = 'automatic-initial-fill';
      if (kind === 'review-dependency') row.accepted_review_dependency_sha256 = 'f'.repeat(64);
      if (kind === 'review-result') row.accepted_review_result_sha256 = 'f'.repeat(64);
      if (kind === 'revision-baseline') provenance.revisionResult.baselineHash = 'f'.repeat(64);
      if (kind === 'revision-ledger') provenance.revisionResult.ledgerHash = 'f'.repeat(64);
      if (kind === 'revision-result') provenance.revisionResult.engineResultSha256 = 'f'.repeat(64);
      if (kind === 'receipt-payload') row.receipt_payload_hash = 'f'.repeat(64);
      if (kind === 'receipt-key') row.receipt_idempotency_key = id(999);
      if (kind === 'before-revision') before.cable_write_revision = '7';
      if (kind === 'after-revision') after.cable_write_revision = '9007199254740995';
      if (kind === 'after-route') after.routing = '/OTHER';
      if (kind === 'after-length') after.design_length = '99';
      if (kind === 'installed-length') after.install_length = '99';
      if (kind === 'business-field') after.revision = 'changed';
      if (kind === 'missing-before') row.accepted_before = null;
      if (kind === 'legacy-version') provenance.schemaVersion = 'pathfinder.apply.v2';
      expect((await value.run()).lastAcceptedApply).toBeNull(); expect(initialFillProof).not.toHaveBeenCalled();
      expect(value.f.calls.filter(call => call.sql.includes('SELECT DISTINCT ON'))).toHaveLength(2);
    });
  it('partitions current collection explicitly into v5, v7 and v8 without leaking a v8 row into legacy collection',async()=>{
    const f=fixture(),input=f.input(3),admission=await persistRevisionAdmission(f.client,input);
    f.dependencyVersions.set(id(10),'pathfinder.dependencies.v5');f.dependencyVersions.set(id(11),'pathfinder.dependencies.v7');f.dependencyVersions.set(id(12),'pathfinder.dependencies.v8');
    const collect=vi.fn(async(_client:PoolClient,request:Parameters<typeof collectDependencyBatchInTransaction>[1])=>({items:(request.cableIds??[]).map(cableId=>({id:cableId,cable:cable(),dependencies:null,status:'locations_required',message:''})),options:defaultOptions,registryRevision:'1',bytes:1}));
    await createRevisionResults(f.pool,{collectCurrentPage:collect}).listPage(pid,who,admission);
    expect(collect).toHaveBeenCalledTimes(3);
    expect(collect.mock.calls.map(([,request])=>({ids:request.cableIds,version:request.dependencyVersion??'pathfinder.dependencies.v5'}))).toEqual([
      {ids:[id(10)],version:'pathfinder.dependencies.v5'},{ids:[id(11)],version:'pathfinder.dependencies.v7'},{ids:[id(12)],version:'pathfinder.dependencies.v8'}]);
  });
  it.each(['pathfinder.dependencies.v8'] as const)('preserves exact per-item authority currentness for %s',async version=>{
    const f=fixture(),deps={...dependencies(),schemaVersion:version} as DependencySnapshot,p=await f.prepare(output(),deps);
    await sealRevisionResult(f.client,{projectId:pid,jobId:jid,cableId:id(10),proposalId:p.proposalId,dependencyHash:revisionResultHash(deps),result:p.result,dependencies:deps});
    const collect=vi.fn(async()=>({items:[{id:id(10),cable:cable(),dependencies:deps,status:'ready',message:''}],options:defaultOptions,registryRevision:'1',bytes:1}));
    applicabilitySeams.authority.mockImplementation(async(_client:PoolClient,input:{cableId?:string})=>input.cableId?{enrolled:true,valid:false,code:'LOCATION_IMPACT_TARGET_SUPERSEDED'}:{enrolled:true,valid:true});
    const page=await createRevisionResults(f.pool,{collectCurrentPage:collect}).listPage(pid,who,p.admissionId);
    expect(page.rows[0].currentness).toEqual({state:'changed',reasonCodes:['LOCATION_IMPACT_TARGET_SUPERSEDED']});
    expect(applicabilitySeams.applicable).not.toHaveBeenCalled();expect(collect).toHaveBeenCalledWith(f.client,expect.objectContaining({dependencyVersion:version}));
  });
  it.each(['pathfinder.dependencies.v5', 'pathfinder.dependencies.v7'] as const)('keeps completed %s history inspectable without offering new batch review eligibility', async version => {
    const f = fixture(), deps = { ...dependencies(), schemaVersion: version } as DependencySnapshot, p = await f.prepare(output(), deps); f.setJob('complete');
    await sealRevisionResult(f.client, { projectId: pid, jobId: jid, cableId: id(10), proposalId: p.proposalId, dependencyHash: revisionResultHash(deps), result: p.result, dependencies: deps });
    const collect = vi.fn(async () => ({ items: [{ id: id(10), cable: cable(), dependencies: deps, status: 'ready', message: '' }], options: defaultOptions, registryRevision: '1', bytes: 1 }));
    const page = await createRevisionResults(f.pool, { collectCurrentPage: collect }).listPage(pid, who, p.admissionId);
    expect(page.rows[0].result?.proposalId).toBe(p.proposalId);
    expect(page.rows[0].currentness).toEqual({ state: 'unavailable', reasonCodes: ['BARRIER_WRITE_PROOF_REQUIRED'] });
    expect(page.rows[0]).not.toHaveProperty('itemApplicability'); expect(applicabilitySeams.applicable).not.toHaveBeenCalled();
  });
  it.each(['no_path', 'resource_limit', 'settings_required'])('does not offer a v8 %s outcome as an applicable batch row', async status => {
    const f = fixture(), deps = { ...dependencies(), schemaVersion: 'pathfinder.dependencies.v8' } as DependencySnapshot;
    const { lengthLedger: _ledger, design: _design, ...body } = output(), result = { ...body, status,
      route: status === 'settings_required' ? body.route : { ...body.route, success: false, routeText: '', routeCodes: [], segmentIds: [], pathPoints: [],
        lengthMeters: 0, fromDistanceMeters: 0, toDistanceMeters: 0 } }, p = await f.prepare(result, deps); f.proposals[0].status = status; f.setJob('running');
    await sealRevisionResult(f.client, { projectId: pid, jobId: jid, cableId: id(10), proposalId: p.proposalId, dependencyHash: revisionResultHash(deps), result, dependencies: deps });
    const collect = vi.fn(async () => ({ items: [{ id: id(10), cable: cable(), dependencies: deps, status: 'ready', message: '' }], options: defaultOptions, registryRevision: '1', bytes: 1 }));
    const page = await createRevisionResults(f.pool, { collectCurrentPage: collect }).listPage(pid, who, p.admissionId);
    expect(page.rows[0].currentness).toEqual({ state: 'unavailable', reasonCodes: ['CALCULATION_OUTPUT_NOT_APPLICABLE'] });
    expect(applicabilitySeams.applicable).not.toHaveBeenCalled();
  });
  it('projects exact v2 display evidence only after delegating the bounded v8 physical proof and item authority check',async()=>{
    // Applicability is an explicit boundary mock here; proposalApplicability
    // tests exercise the real v8 retained response/strategy guard separately.
    const f=fixture(),deps={...dependencies(),schemaVersion:'pathfinder.dependencies.v8'} as DependencySnapshot,p=await f.prepare(output(),deps);
    const seal=await sealRevisionResult(f.client,{projectId:pid,jobId:jid,cableId:id(10),proposalId:p.proposalId,dependencyHash:revisionResultHash(deps),result:p.result,dependencies:deps});
    const evidence={schemaVersion:'wfc.pf.sealed-cable-applicability.v2',dependencyVersion:'pathfinder.dependencies.v8',projectId:pid,jobId:jid,cableId:id(10),proposalId:p.proposalId,dependencyHash:seal.dependencyHash,scope:'sealed-cable-item'};
    applicabilitySeams.applicable.mockResolvedValue({applicable:true,evidence});
    const collect=vi.fn(async()=>({items:[{id:id(10),cable:cable(),dependencies:deps,status:'ready',message:''}],options:defaultOptions,registryRevision:'1',bytes:1}));
    const page=await createRevisionResults(f.pool,{collectCurrentPage:collect}).listPage(pid,who,p.admissionId);
    expect(page.rows[0].currentness.state).toBe('current');expect(page.rows[0].itemApplicability).toEqual(evidence);
    expect(applicabilitySeams.applicable).toHaveBeenCalledWith(f.client,expect.objectContaining({dependencyVersion:'pathfinder.dependencies.v8',seal}));
  });
  it('does not expose a completed v8 row as current when its retained strategy proof cannot authorize readiness',async()=>{
    const f=fixture(),deps={...dependencies(),schemaVersion:'pathfinder.dependencies.v8'} as DependencySnapshot,p=await f.prepare(output(),deps);f.setJob('complete');
    await sealRevisionResult(f.client,{projectId:pid,jobId:jid,cableId:id(10),proposalId:p.proposalId,dependencyHash:revisionResultHash(deps),result:p.result,dependencies:deps});
    const collect=vi.fn(async()=>({items:[{id:id(10),cable:cable(),dependencies:deps,status:'ready',message:''}],options:defaultOptions,registryRevision:'1',bytes:1}));
    const page=await createRevisionResults(f.pool,{collectCurrentPage:collect}).listPage(pid,who,p.admissionId);
    expect(page.rows[0].currentness).toEqual({state:'unavailable',reasonCodes:['BARRIER_ITEM_PROOF_UNAVAILABLE']});expect(page.rows[0]).not.toHaveProperty('itemApplicability');
  });
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
  it.each([false, true, 'limit'] as const)('recognizes only the newest initial-fill baseline with complete retained proof, valid=%s', async valid => {
    const f = fixture(), p = await f.prepare();
    const seal = await sealRevisionResult(f.client, { projectId: pid, jobId: jid, cableId: id(10), proposalId: p.proposalId,
      dependencyHash: revisionResultHash(p.deps), result: p.result, dependencies: p.deps });
    if (valid === 'limit') initialFillProof.mockRejectedValue(new PathFinderError('INITIAL_FILL_PROOF_READ_LIMIT', 413));
    else initialFillProof.mockResolvedValue(valid);
    f.accepted.push({ receipt_id: id(30), cable_id: id(10), proposal_id: p.proposalId, applied_at: '2026-10-20T00:00:00Z', after_revision: '9007199254740993',
      after_routing: '/OLD', after_design_length: '4.00', proposal_hash: f.proposals[0].proposal_hash, dependency_hash: seal.dependencyHash, model_ref: model,
      route_text: '/A', raw_length: 5, design_length: '7', unrounded_length: '6.6', sealed_hash: seal.revisionResultSha256,
      engine_result_sha256: seal.engineResultSha256, ledger_sha256: seal.ledgerHash, initial_fill_kind: true,
      receipt_actor_id: who.userId, receipt_idempotency_key: id(31), receipt_payload_hash: 'f'.repeat(64), accepted_before: { original: 'before' },
      accepted_after: { original: 'after' }, accepted_provenance: { schemaVersion: 'pathfinder.initial-fill.v1' }, accepted_dependencies: p.deps, accepted_result: p.result });
    const input = f.input(); input.jobId = id(99);
    if (valid === 'limit') { await expect(persistRevisionAdmission(f.client, input)).rejects.toMatchObject({ code: 'INITIAL_FILL_PROOF_READ_LIMIT' }); expect(f.admissions).toHaveLength(1); return; }
    const admissionId = await persistRevisionAdmission(f.client, input);
    const row = f.baselines.find(row => row.admission_id === admissionId)!.baseline as { lastAcceptedApply: unknown; acceptedMatchesCurrent: boolean };
    expect(row.lastAcceptedApply !== null).toBe(valid); expect(row.acceptedMatchesCurrent).toBe(valid);
    expect(initialFillProof).toHaveBeenCalledOnce(); expect(initialFillProof.mock.calls[0][0]).toMatchObject({ projectId: pid, cableId: id(10), seal,
      dependencies: p.deps, result: p.result });
    const sql = f.calls.find(call => call.sql.includes('SELECT DISTINCT ON'))!.sql;
    expect(sql).toContain('octet_length(p.dependencies::text)+octet_length(p.result::text)<=262144');
    expect(sql).toContain("IN('pathfinder.initial-fill.v1','pathfinder.initial-fill.v2','pathfinder.apply.v3')");
  });
  it('delegates the newest protected initial-fill baseline to the complete historical receipt reader', async () => {
    // This suite mocks only the immutable receipt-reader boundary. Its separate
    // suite checks an actual v8/v3 chain and exact policy/result hashes.
    const f = fixture(), p = await f.prepare(), seal = await sealRevisionResult(f.client, { projectId: pid, jobId: jid, cableId: id(10), proposalId: p.proposalId,
      dependencyHash: revisionResultHash(p.deps), result: p.result, dependencies: p.deps });
    initialFillProof.mockResolvedValue(true);
    f.accepted.push({ receipt_id: id(30), cable_id: id(10), proposal_id: p.proposalId, applied_at: '2026-10-20T00:00:00Z', after_revision: '9007199254740993',
      after_routing: '/OLD', after_design_length: '4.00', proposal_hash: f.proposals[0].proposal_hash, dependency_hash: seal.dependencyHash, model_ref: model,
      route_text: '/A', raw_length: 5, design_length: '7', unrounded_length: '6.6', initial_fill_kind: true,
      accepted_dependencies: p.deps, accepted_result: p.result, accepted_provenance: { schemaVersion: 'pathfinder.initial-fill.v2' } });
    const input = f.input(); input.jobId = id(99); const admissionId = await persistRevisionAdmission(f.client, input);
    expect((f.baselines.find(row => row.admission_id === admissionId)!.baseline as { lastAcceptedApply: unknown }).lastAcceptedApply).not.toBeNull();
    expect(initialFillProof).toHaveBeenCalledWith(expect.objectContaining({ provenance: { schemaVersion: 'pathfinder.initial-fill.v2' }, seal }));
  });
  it.each(['pathfinder.apply.v3', 'pathfinder.apply.v999'])('refuses a newest %s baseline lacking complete protected receipt proof', async version => {
    const f = fixture(), p = await f.prepare(), seal = await sealRevisionResult(f.client, { projectId: pid, jobId: jid, cableId: id(10), proposalId: p.proposalId,
      dependencyHash: revisionResultHash(p.deps), result: p.result, dependencies: p.deps });
    f.accepted.push({ receipt_id: id(30), cable_id: id(10), proposal_id: p.proposalId, protected_apply_kind: true, accepted_provenance: { schemaVersion: version },
      accepted_dependencies: p.deps, accepted_result: p.result, proposal_hash: seal.proposalHash });
    const input = f.input(); input.jobId = id(99); const admissionId = await persistRevisionAdmission(f.client, input);
    expect((f.baselines.find(row => row.admission_id === admissionId)!.baseline as { lastAcceptedApply: unknown }).lastAcceptedApply).toBeNull();
    expect(initialFillProof).not.toHaveBeenCalled(); expect(f.calls.filter(call => call.sql.includes('SELECT DISTINCT ON'))).toHaveLength(2);
  });
  it('refuses an oversized or unknown new-kind newest receipt without silently selecting older accepted data', async () => {
    const f = fixture(); f.accepted.push({ receipt_id: id(30), cable_id: id(10), proposal_id: id(31), initial_fill_kind: true,
      accepted_result: null, accepted_provenance: null });
    const admissionId = await persistRevisionAdmission(f.client, f.input());
    expect((f.baselines.find(row => row.admission_id === admissionId)!.baseline as { lastAcceptedApply: unknown }).lastAcceptedApply).toBeNull();
    expect(initialFillProof).not.toHaveBeenCalled(); expect(f.calls.filter(call => call.sql.includes('SELECT DISTINCT ON'))).toHaveLength(1);
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
