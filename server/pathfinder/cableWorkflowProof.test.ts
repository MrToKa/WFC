// @vitest-environment node
import type { PoolClient } from 'pg';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CableWorkflowRow } from '../../shared/pathfinderCableWorkflow.js';
import type { DependencySnapshot, EngineResponse } from './jobContracts.js';
import { defaultOptions } from './jobContracts.js';
import { hash } from './dependencies.js';
import { createCableWorkflowProofReader, readWorkflowVerifiedProposal, WORKFLOW_PROOF_BYTES } from './cableWorkflowProof.js';

const proof = vi.hoisted(() => ({ seal: vi.fn(), enrollment: vi.fn(), scope: vi.fn() }));
vi.mock('./revisionResultRepository.js', () => ({ verifyRevisionResultForProposal: proof.seal }));
vi.mock('./recalculationRepository.js', () => ({ readRecalculationJobAuthority: proof.enrollment }));
vi.mock('./routingScope.js', () => ({ requireVersionedCalculationScope: proof.scope }));

type Data = Record<string, any>;
const id = (n: number) => 'ce000000-0000-4000-8000-' + n.toString(16).padStart(12, '0');
const projectId = id(1), cableId = id(2), jobId = id(3), proposalId = id(4);
const beforeRevision = '9007199254740993', afterRevision = '9007199254740994';
function fixture() {
  const settings = { revision: '2', connectionGap: '1', secondaryTrayLength: null, endConnectionLength: '1.00', additionalBendingPercent: '10.0' };
  const dependencies = { schemaVersion: 'pathfinder.dependencies.v5', projectId, cableId, cableWriteRevision: beforeRevision,
    registryRevision: '5', model: { id: id(10), selectionRevision: '2', contentFingerprint: 'a'.repeat(64) }, settings,
    options: { ...defaultOptions }, comparison: null } as unknown as DependencySnapshot;
  const ledger = { schemaVersion: 'wfc.pf.length-components.v1', formulaVersion: 'pathfinder-45c24bf5', settingsRevision: '2',
    raw: { lengthMeters: 5, fromDistanceMeters: 1, toDistanceMeters: 1 }, rawLengthDecimalMeters: '5',
    from: { requiresSecondary: false, removedApproachMeters: '0' }, to: { requiresSecondary: false, removedApproachMeters: '0' },
    settings: { secondaryTrayLengthMeters: null, endConnectionLengthMeters: '1', additionalBendingPercent: '10' }, secondaryEnds: 0,
    replacementMeters: '0', beforeClampMeters: '5', clampAdjustmentMeters: '0', afterClampMeters: '5', beforePercentageMeters: '6',
    bendingIncrementMeters: '0.6', unroundedMeters: '6.6', ceilingIncrementMeters: '0.4', designLengthMeters: '7', gapAccounting: 'already-in-raw-geometry' };
  const result = { schemaVersion: 'pathfinder.model.response.v1', requestId: id(11), status: 'calculated', message: 'Synthetic proof fixture.',
    engineeringAccepted: false, route: { success: true, message: '', routeText: '/A', routeCodes: ['A'], segmentIds: ['dbid:1'],
      pathPoints: [{ x: 0, y: 0, z: 0 }, { x: 5, y: 0, z: 0 }], lengthMeters: 5, fromDistanceMeters: 1, toDistanceMeters: 1,
      fromRequiresSecondary: false, toRequiresSecondary: false, connectionGapCount: 0, connectionGapLengthMeters: 0 },
    design: { lengthBeforePercentageMeters: '6', unroundedLengthMeters: '6.6', designLengthMeters: '7' }, lengthLedger: ledger } as EngineResponse;
  const raw: Data = { id: proposalId, project_id: projectId, cable_id: cableId, job_id: jobId, status: 'calculated',
    proposal_hash: hash({ fixture: 'proposal' }), dependency_hash: hash(dependencies), dependencies, result, job_state: 'complete', cancel_requested: false };
  const seal = { projectId, cableId, jobId, revisionResultSha256: 'b'.repeat(64), ledgerHash: hash(ledger), baselineHash: 'c'.repeat(64) };
  proof.seal.mockResolvedValue(seal);
  const before = { id: cableId, project_id: projectId, routing: '/OLD', design_length: '3.0000', install_length: '2.0000',
    cable_write_revision: beforeRevision, tag: 'Synthetic cable', revision: '1', updated_at: '2026-10-20T00:00:00Z' };
  const after = { ...before, routing: '/A', design_length: '7.0000', cable_write_revision: afterRevision, updated_at: '2026-10-20T00:01:00Z' };
  const provenance = { schemaVersion: 'pathfinder.apply.v2', proposalId, proposalHash: raw.proposal_hash, reviewId: id(5), dependencies,
    validationMethod: 'manual-review', review: { id: id(5), actorId: id(6), loginId: id(7), dependencyHash: raw.dependency_hash,
      revisionResultSha256: seal.revisionResultSha256 }, revisionResult: { revisionResultSha256: seal.revisionResultSha256,
      dependencyHash: raw.dependency_hash, baselineHash: seal.baselineHash, ledgerHash: seal.ledgerHash } };
  const receipt: Data = { id: id(8), project_id: projectId, cable_id: cableId, proposal_id: proposalId, actor_id: id(6), idempotency_key: id(9),
    before_snapshot: before, after_snapshot: after, provenance, review_id: id(5), review_actor: id(6), review_proposal: proposalId,
    review_proposal_hash: raw.proposal_hash, validation_method: 'manual-review', revision_result_sha256: seal.revisionResultSha256,
    review_dependency_sha256: raw.dependency_hash, review_login_id: id(7) };
  receipt.payload_hash = hash({ proposalId, idempotencyKey: receipt.idempotency_key, reviewId: receipt.review_id, expectedCableWriteRevision: beforeRevision });
  const cable: CableWorkflowRow['cable'] = { id: cableId, tag: 'Synthetic cable', fromLocation: 'FROM', toLocation: 'TO', routing: '/A',
    designLength: '7.00', installLength: '2', cableWriteRevision: afterRevision };
  const current = { ...dependencies, cableWriteRevision: afterRevision };
  const query = vi.fn(async (sql: string) => {
    if (sql.includes('cable-workflow:proposal-proof')) return { rows: [raw] };
    if (sql.includes('cable-workflow:accepted-proof')) return { rows: [receipt] };
    throw Error('Unexpected SQL in proof fixture.');
  });
  const client = { query } as unknown as PoolClient;
  const check = vi.fn(), reader = createCableWorkflowProofReader(client, projectId, check);
  return { dependencies, result, ledger, raw, seal, before, after, provenance, receipt, cable, current, query, client, check, reader };
}
beforeEach(() => {
  vi.clearAllMocks(); proof.scope.mockImplementation(() => undefined); proof.enrollment.mockResolvedValue({ enrolled: false });
});

describe('cable workflow positive result evidence (synthetic boundaries)', () => {
  it('uses exact job/project/cable identity and existing seal, scope and C# ledger validators', async () => {
    const f = fixture();
    expect(await f.reader.reviewable(cableId, jobId, proposalId, f.dependencies)).toEqual({ currentness: 'current', reviewable: true, reasonCodes: [] });
    expect(proof.scope).toHaveBeenCalledWith(f.dependencies);
    expect(proof.seal).toHaveBeenCalledWith(f.client, { projectId, proposalId, result: f.result, dependencies: f.dependencies, proposalHash: f.raw.proposal_hash });
    expect(f.query.mock.calls[0][0]).toContain('octet_length(p.dependencies::text)+octet_length(p.result::text)<=$4');
    expect(WORKFLOW_PROOF_BYTES).toBe(256 * 1024);
  });
  it.each(['project_id', 'cable_id', 'id'])('rejects exchanged %s proof identity', async field => {
    const f = fixture(); f.raw[field] = id(99);
    expect(await readWorkflowVerifiedProposal(f.client, projectId, cableId, proposalId)).toBeNull();
  });
  it.each(['dependencies', 'result'])('never promotes an SQL-refused oversized %s projection', async field => {
    const f = fixture(); f.raw[field] = null;
    expect(await readWorkflowVerifiedProposal(f.client, projectId, cableId, proposalId)).toBeNull();
  });
  it('rejects an altered dependency body even when its display fields look usable', async () => {
    const f = fixture(); f.dependencies.cableWriteRevision = '9';
    expect(await readWorkflowVerifiedProposal(f.client, projectId, cableId, proposalId)).toBeNull();
    expect(proof.seal).not.toHaveBeenCalled();
  });
  it.each(['scope', 'seal', 'ledger', 'route', 'design'])('fails closed for unavailable %s evidence', async failure => {
    const f = fixture();
    if (failure === 'scope') proof.scope.mockImplementation(() => { throw Error('Legacy scope.'); });
    if (failure === 'seal') proof.seal.mockResolvedValue(null);
    if (failure === 'ledger') delete f.result.lengthLedger;
    if (failure === 'route') f.result.route!.success = false;
    if (failure === 'design') f.result.design!.designLengthMeters = '-1';
    expect(await f.reader.reviewable(cableId, jobId, proposalId, f.dependencies)).toMatchObject({ currentness: 'unavailable', reviewable: false });
  });
  it.each(['jobId', 'cableId', 'projectId', 'ledgerHash'])('rejects an exchanged sealed %s', async field => {
    const f = fixture(); proof.seal.mockResolvedValue({ ...f.seal, [field]: field === 'ledgerHash' ? 'd'.repeat(64) : id(99) });
    expect(await readWorkflowVerifiedProposal(f.client, projectId, cableId, proposalId)).toBeNull();
  });
  it.each(['queued', 'running', 'cancelled', 'failed'])('never marks the %s parent job reviewable', async state => {
    const f = fixture(); f.raw.job_state = state;
    expect(await f.reader.reviewable(cableId, jobId, proposalId, f.dependencies)).toMatchObject({ reviewable: false });
  });
  it('preserves strict global-registry v5 staleness and checks enrollment once per job', async () => {
    const f = fixture();
    expect(await f.reader.reviewable(cableId, jobId, proposalId, { ...f.dependencies, registryRevision: '6' })).toMatchObject({ currentness: 'changed', reviewable: false });
    proof.enrollment.mockResolvedValue({ enrolled: true, valid: false, code: 'AUTOMATIC_GENERATION_SUPERSEDED' });
    const first = await f.reader.reviewable(cableId, jobId, proposalId, f.dependencies);
    expect(first).toMatchObject({ currentness: 'changed', reviewable: false, reasonCodes: ['AUTOMATIC_GENERATION_SUPERSEDED'] });
    await f.reader.reviewable(cableId, jobId, proposalId, f.dependencies);
    expect(proof.enrollment).toHaveBeenCalledTimes(1); expect(proof.seal).toHaveBeenCalledTimes(1);
  });
  it('refuses a cross-job proposal and cancellation request even with available points', async () => {
    const f = fixture(); expect(await f.reader.reviewable(cableId, id(99), proposalId, f.dependencies)).toMatchObject({ reviewable: false });
    f.raw.cancel_requested = true;
    expect(await f.reader.reviewable(cableId, jobId, proposalId, f.dependencies)).toMatchObject({ reviewable: false, reasonCodes: ['CALCULATION_CANCEL_REQUESTED'] });
  });
});

describe('receipt-backed current accepted cable display', () => {
  it('proves the exact large own-write revision transition and decimal scale without requiring the old login alive', async () => {
    const f = fixture(), currentForOptions = vi.fn(async () => f.current);
    expect(await f.reader.accepted(f.cable, currentForOptions)).toBe(true);
    expect(f.current.cableWriteRevision).toBe(afterRevision);
    expect(currentForOptions).toHaveBeenCalledWith(f.dependencies.options);
    expect(f.query.mock.calls[0][0]).toContain('ORDER BY r.applied_at DESC,r.id DESC LIMIT 1');
    expect(proof.enrollment).not.toHaveBeenCalled();
  });
  it.each(['cableWriteRevision', 'routing', 'designLength', 'installLength'])('rejects an intervening current %s change', async field => {
    const f = fixture(); (f.cable as Data)[field] = field === 'routing' ? '/OTHER' : '99';
    expect(await f.reader.accepted(f.cable, async () => f.current)).toBe(false);
  });
  it.each(['model', 'settings', 'registryRevision', 'options'])('does not exempt a concurrent %s dependency change', async field => {
    const f = fixture();
    const current = { ...f.current, [field]: field === 'registryRevision' ? '6' : field === 'options'
      ? { ...f.dependencies.options, preferVerticalApproach: false } : { ...(f.current as Data)[field], revision: '99' } };
    expect(await f.reader.accepted(f.cable, async () => current)).toBe(false);
  });
  it.each(['snapshot', 'transition', 'preserved-install', 'business-revision', 'output', 'payload', 'review', 'provenance', 'seal'])('refuses broken %s receipt proof', async failure => {
    const f = fixture();
    if (failure === 'snapshot') f.receipt.after_snapshot = null;
    if (failure === 'transition') f.before.cable_write_revision = '1';
    if (failure === 'preserved-install') f.before.install_length = '1';
    if (failure === 'business-revision') f.after.revision = '2';
    if (failure === 'output') { f.after.routing = '/OTHER'; f.cable.routing = '/OTHER'; }
    if (failure === 'payload') f.receipt.payload_hash = 'f'.repeat(64);
    if (failure === 'review') f.receipt.review_actor = id(99);
    if (failure === 'provenance') f.provenance.revisionResult.baselineHash = 'f'.repeat(64);
    if (failure === 'seal') proof.seal.mockResolvedValue(null);
    expect(await f.reader.accepted(f.cable, async () => f.current)).toBe(false);
  });
  it('does not reinterpret a historical receipt when current engineering inputs are unavailable', async () => {
    const f = fixture(); expect(await f.reader.accepted(f.cable, async () => null)).toBe(false);
  });
  it('retains deadline refusal across the accepted-proof fail-closed catch', async () => {
    const f = fixture(); f.check.mockImplementation(() => { throw Error('Deadline.'); });
    await expect(f.reader.accepted(f.cable, async () => f.current)).rejects.toThrow('Deadline.');
  });
});
