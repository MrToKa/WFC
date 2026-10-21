// @vitest-environment node
import type { PoolClient } from 'pg';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { sealedCableItemApplicabilitySchema } from '../../shared/pathfinderItemApplicability.js';
import { readProposalApplicability, type ProposalApplicabilityInput } from './proposalApplicability.js';
import { freezeScopedCableDependencies, hash, type CommonCalculationInputs } from './dependencies.js';
import { syntheticEngineIdentity, syntheticBarrierEngineIdentity } from './calculationFixtures.js';
import type { EndpointCalculationPoint } from './endpointCalculationProvenance.js';
import { BARRIER_RUNTIME_PROFILE, barrierRouteHashInput, createBarrierRuntimePolicy, type BarrierRuntimeContext } from '../../shared/pathfinderBarrierRuntime.js';
import type { BarrierDependencySnapshot } from './jobContracts.js';

const authority = vi.hoisted(() => vi.fn());
const wholeAuthority = vi.hoisted(() => vi.fn());
vi.mock('./locationImpactRepository.js', () => ({ readLocationImpactJobAuthority: authority }));
vi.mock('./recalculationRepository.js', () => ({ readRecalculationJobAuthority: wholeAuthority }));
const id = (n: number) => `ad300000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const projectId = id(1), cableId = id(2), jobId = id(3), proposalId = id(4);
function fixture(jobState = 'running') {
  const common: CommonCalculationInputs = { projectId, registryRevision: '9', comparison: null,
    routing: { catalogRevision: '2', routingContentSha256: 'a'.repeat(64), routingPolicyRevision: '3', routingPolicySha256: 'b'.repeat(64) },
    model: { id: id(5), selectionRevision: '1', contentFingerprint: 'c'.repeat(64) }, artifact: { id: id(6), sha256: 'd'.repeat(64) },
    preparation: { aggregateId: id(7), geometryRevision: '1', captureFrameId: id(8), projectionSha256: 'd'.repeat(64) },
    settings: { revision: '1', connectionGap: '1', secondaryTrayLength: '7', endConnectionLength: '5', additionalBendingPercent: '10' },
    options: { connectionToleranceMeters: 1, sampleSpacingMeters: 0.125, secondaryDistanceMeters: 2, preferVerticalApproach: true,
      maxGraphNodes: 200000, maxGraphConnections: 1000000 }, engineVersion: 'pathfinder-45c24bf5-pf1-modelrunner-v1', engineIdentity: syntheticEngineIdentity() };
  const point = (n: number): EndpointCalculationPoint => ({ locationId: id(n), locationRevision: '1', bindingRevision: '1', point: [n, 2, 3],
    bindingId: id(n + 10), bindingContentSha256: 'e'.repeat(64), mode: 'fixed-world', captureFrameId: id(8), qualifiedProjectFrameId: null,
    aggregateId: id(7), projectionSha256: 'd'.repeat(64), sourceObjectRevisionId: null, migrationDecisionId: null });
  const dependencies = freezeScopedCableDependencies(common, { id: cableId, from_location: 'FROM', to_location: 'TO', mto: 'LV',
    cable_type_id: id(9), cable_write_revision: '7' }, point(10), point(11)).dependencies!;
  const dependencyHash = hash(dependencies), seal = { projectId, cableId, jobId, proposalId, dependencyHash };
  const input: ProposalApplicabilityInput = { ...seal, dependencyVersion: 'pathfinder.dependencies.v7', jobState, cancelRequested: false, seal };
  const row = { state: 'complete', status: 'calculated', dependencies: dependencies as unknown, job_state: jobState, cancel_requested: false };
  const state = { rows: [row] }, query = vi.fn(async (_text: string, _values?: unknown[]) => ({ rows: state.rows }));
  const client = { query } as unknown as PoolClient;
  return { input, row, state, dependencies, client, query, run: () => readProposalApplicability(client, input) };
}
beforeEach(() => { vi.clearAllMocks(); wholeAuthority.mockResolvedValue({enrolled:false}); authority.mockResolvedValue({ scope: 'location-impact', enrolled: true, valid: true,
  generation: '9', authorityEpoch: '1', impactId: id(50), code: 'LOCATION_IMPACT_AUTHORITY_CURRENT' }); });

/** Synthetic retained integrity fixture only. No real storage/collision or
 * engineering qualification is represented by its explicit empty declaration. */
function barrierFixture(jobState = 'running') {
  const f = fixture(jobState), base = f.dependencies;
  const scope = { projectId, modelVersionId: base.model.id, selectionRevision: base.model.selectionRevision, contentFingerprint: base.model.contentFingerprint,
    captureFrameId: id(8), captureFrameSha256: 'b'.repeat(64), coordinateFrame: 'canonical-world-metres' as const };
  const policy = createBarrierRuntimePolicy(false), barriers: BarrierRuntimeContext = { schemaVersion:'wfc.pf.barrier-runtime.v1',
    binding:{scope,registryRevision:'3',snapshot:{snapshotId:id(60),scope,registryRevision:'3',contentSha256:'c'.repeat(64),mode:'explicit-empty'},policy,policySha256:hash(policy)},
    profile:structuredClone(BARRIER_RUNTIME_PROFILE),profileSha256:hash(BARRIER_RUNTIME_PROFILE),storage:{intentId:id(61),manifest:{blobId:id(62),sha256:'d'.repeat(64),bytes:1000},capture:null} };
  const dependencies = { ...base, schemaVersion:'pathfinder.dependencies.v8',engineIdentity:syntheticBarrierEngineIdentity(),barriers,
    options:{...base.options,barrierRouting:{schemaVersion:'wfc.pf.barrier-admission-intent.v1',scope,expectedRegistryRevision:'3',expectedSnapshot:barriers.binding.snapshot,drillThroughWalls:false}} } as BarrierDependencySnapshot;
  const points = [dependencies.from.point,dependencies.to.point], routeSha256=hash(barrierRouteHashInput(points));
  const result = { schemaVersion:'pathfinder.model.response.v3',requestId:id(63),status:'calculated',message:'Synthetic strict retained body',engineeringAccepted:false,
    calculationMode:'calculate',effectiveCategory:'LV',route:{success:true,message:'',routeText:'/A',routeCodes:['/A'],segmentIds:['a'],
      pathPoints:points.map(point=>({x:point[0],y:point[1],z:point[2]})),lengthMeters:1,fromDistanceMeters:0.1,toDistanceMeters:0.1,fromRequiresSecondary:false,toRequiresSecondary:false,
      connectionGapCount:0,connectionGapLengthMeters:0},design:{lengthBeforePercentageMeters:'6',unroundedLengthMeters:'6.6',designLengthMeters:'7'},
    barriers:{schemaVersion:'wfc.pf.barrier-execution.v1',context:barriers,proof:{schemaVersion:'wfc.pf.barrier-check-proof.v2',binding:barriers.binding,routeSha256,
      status:'no-barriers-declared',routePointCount:2,totalSegments:1,checkedSegments:0,blocking:null,failedSegmentIndex:null,reasonCode:'EXPLICIT_EMPTY_SCOPE',coverage:'registered-selected-objects-only',engineeringAccepted:false},
      directSecondary:{schemaVersion:'wfc.pf.constrained-direct-secondary.v2',policyVersion:'nearest-eligible-tray-or-registered-barriers.v2',
        distanceDecision:{schemaVersion:'wfc.pf.direct-secondary.v1',policyVersion:'nearest-eligible-tray-or.v1',coordinateFrame:'canonical-world-metres',mode:'tray-network',fromPoint:points[0],toPoint:points[1],
          distanceMeters:1,nearestFromMeters:0.1,nearestToMeters:0.1,eligibleTrays:1,comparison:null},binding:barriers.binding,directRouteSha256:routeSha256,mode:'tray-network',directCheck:null,reasonCode:'DISTANCE_NOT_QUALIFIED'},
      diagnostics:{status:'no-barriers-declared',reasonCode:'DRILLING_BYPASS',searchComplete:true,candidatesTruncated:false,pairAttempts:0,collisionQueries:0,work:'1',plannerAttempts:0,straightPairAttempts:0,localEdgeChecks:0,localPhaseUsed:false,straightPhaseTruncated:false},
      connectors:{from:null,to:null},qualification:null} };
  const row = { ...f.row,dependencies:dependencies as unknown,proposal_dependencies:dependencies as unknown,result:result as unknown,
    proposal_hash:'',dependency_hash:hash(dependencies),proposal_status:'calculated' };
  const input:ProposalApplicabilityInput={...f.input,dependencyVersion:'pathfinder.dependencies.v8',dependencyHash:hash(dependencies),seal:null};
  const reseal = () => { const baselineHash='e'.repeat(64);row.dependency_hash=hash(row.dependencies);input.dependencyHash=row.dependency_hash;
    row.proposal_hash=hash({dependencies:row.dependencies,result:row.result,baselineHash});input.seal={projectId,jobId,cableId,proposalId,dependencyHash:input.dependencyHash,
      proposalHash:row.proposal_hash,engineResultSha256:hash(row.result),baselineHash}; };
  reseal(); f.query.mockResolvedValue({rows:[row]});
  return {...f,input,row,dependencies,result,reseal,run:()=>readProposalApplicability(f.client,input)};
}

describe('version-specific sealed cable applicability with mocked SQL and scoped authority', () => {
  it.each(['queued','running','complete'])('permits independently ready v8 only with exact retained physical strategy and current scoped authority (%s)',async parent=>{
    const f=barrierFixture(parent),value=await f.run();
    expect(value).toEqual({applicable:true,evidence:{schemaVersion:'wfc.pf.sealed-cable-applicability.v2',dependencyVersion:'pathfinder.dependencies.v8',
      projectId,jobId,cableId,proposalId,dependencyHash:f.input.dependencyHash,scope:'sealed-cable-item'}});
    expect(f.query.mock.calls[0][0]).toContain('octet_length(i.dependencies::text)+octet_length(p.dependencies::text)+octet_length(p.result::text)<=262144');
    expect(f.query.mock.calls[0][1]).toEqual([projectId,jobId,cableId,proposalId]);
    expect(authority).toHaveBeenCalledExactlyOnceWith(f.client,{projectId,jobId,cableId,lock:true});expect(wholeAuthority).not.toHaveBeenCalled();
  });
  it.each(['queued','running','complete'])('keeps a non-enrolled v8 job whole-job ready only at complete (%s)',async parent=>{
    const f=barrierFixture(parent);authority.mockResolvedValue(null);
    expect(await f.run()).toEqual({applicable:parent==='complete',evidence:null});
    expect(wholeAuthority).toHaveBeenCalledExactlyOnceWith(f.client,{projectId,jobId,cableId,lock:true});
  });
  it('does not turn a valid whole-project grant into independent cable-item authority',async()=>{
    const f=barrierFixture();authority.mockResolvedValue(null);wholeAuthority.mockResolvedValue({enrolled:true,valid:true,generation:'4',authorityEpoch:'1'});
    expect(await f.run()).toEqual({applicable:false,evidence:null});
    f.input.jobState='complete';f.row.job_state='complete';expect(await f.run()).toEqual({applicable:true,evidence:null});
    wholeAuthority.mockResolvedValue({enrolled:true,valid:false,code:'AUTOMATIC_AUTHORITY_CHANGED'});expect(await f.run()).toEqual({applicable:false,evidence:null});
  });
  it('refuses a superseded or expired v8 scoped item without falling back to whole-job completion',async()=>{
    const f=barrierFixture('complete');authority.mockResolvedValue({enrolled:true,valid:false,code:'LOCATION_IMPACT_TARGET_SUPERSEDED'});
    expect(await f.run()).toEqual({applicable:false,evidence:null});expect(wholeAuthority).not.toHaveBeenCalled();
  });
  it.each(['legacy-response','wrong-route-hash','wrong-endpoint','wrong-frame','design-reuse'] as const)('refuses coherently resealed v8 %s before authority checks',async kind=>{
    const f=barrierFixture();
    if(kind==='legacy-response') f.result.schemaVersion='pathfinder.model.response.v1';
    if(kind==='wrong-route-hash') f.result.barriers.proof.routeSha256='0'.repeat(64);
    if(kind==='wrong-endpoint') f.result.barriers.directSecondary.distanceDecision.fromPoint=[99,2,3];
    if(kind==='wrong-frame') f.result.barriers.context.binding.scope.captureFrameId=id(99);
    if(kind==='design-reuse') f.result.calculationMode='design';
    f.reseal();expect(await f.run()).toEqual({applicable:false,evidence:null});expect(authority).not.toHaveBeenCalled();
  });
  it.each(['missing-proposal','wrong-proposal-dependencies','wrong-result-seal','wrong-proposal-hash','missing-v2-seal'] as const)('refuses unavailable or tampered v8 retained proof: %s',async kind=>{
    const f=barrierFixture('complete');
    if(kind==='missing-proposal') f.query.mockResolvedValue({rows:[]});
    if(kind==='wrong-proposal-dependencies') f.row.proposal_dependencies={...f.dependencies,cableWriteRevision:'99'};
    if(kind==='wrong-result-seal') f.input.seal!.engineResultSha256='0'.repeat(64);
    if(kind==='wrong-proposal-hash') f.row.proposal_hash='0'.repeat(64);
    if(kind==='missing-v2-seal') delete f.input.seal!.baselineHash;
    expect(await f.run()).toEqual({applicable:false,evidence:null});expect(authority).not.toHaveBeenCalled();
  });
  it.each(['queued', 'running', 'complete'])('permits one exact sealed v7 completed item with parent %s without waiting for siblings', async parent => {
    const f = fixture(parent), result = await f.run();
    expect(result.applicable).toBe(true); expect(sealedCableItemApplicabilitySchema.parse(result.evidence)).toEqual({
      schemaVersion: 'wfc.pf.sealed-cable-applicability.v1', dependencyVersion: 'pathfinder.dependencies.v7', projectId, cableId, jobId, proposalId,
      dependencyHash: f.input.dependencyHash, scope: 'sealed-cable-item' });
    expect(f.query).toHaveBeenCalledOnce(); const [sql, values] = f.query.mock.calls[0];
    expect(sql).toContain('WHERE i.project_id=$1 AND i.job_id=$2 AND i.cable_id=$3 FOR SHARE OF i,j');
    expect(sql).toContain('CASE WHEN octet_length(i.dependencies::text)<=262144'); expect(values).toEqual([projectId, jobId, cableId]);
    expect(sql).not.toMatch(/\b(?:INSERT|DELETE|CREATE|ALTER)\b|\bUPDATE\s+\w+\s+SET|count\s*\(/i);
    expect(authority).toHaveBeenCalledExactlyOnceWith(f.client, { projectId, jobId, cableId, lock: true });
  });
  it.each(['pathfinder.dependencies.v5', 'pathfinder.dependencies.v6'])('preserves whole-job completion semantics for legacy %s', async version => {
    for (const parent of ['queued', 'running', 'complete']) {
      const f = fixture(parent); f.input.dependencyVersion = version; f.input.seal = null;
      expect(await f.run()).toEqual({ applicable: parent === 'complete', evidence: null }); expect(f.query).not.toHaveBeenCalled();
    }
    expect(authority).not.toHaveBeenCalled();
  });
  it.each(['cancelled', 'failed', 'unavailable'])('does not permit a completed item with revoked parent %s', async parent => {
    const f = fixture(parent); expect(await f.run()).toEqual({ applicable: false, evidence: null });
    expect(f.query).not.toHaveBeenCalled(); expect(authority).not.toHaveBeenCalled();
  });
  it.each(['pathfinder.dependencies.v5', 'pathfinder.dependencies.v6', 'pathfinder.dependencies.v7'])('rejects requested cancellation for %s before any proof reads', async version => {
    const f = fixture('complete'); f.input.dependencyVersion = version; f.input.cancelRequested = true;
    expect(await f.run()).toEqual({ applicable: false, evidence: null }); expect(f.query).not.toHaveBeenCalled(); expect(authority).not.toHaveBeenCalled();
  });
  it('does not treat a nonsealed result as a completed cable proof', async () => {
    const f = fixture(); f.input.seal = null;
    expect(await f.run()).toEqual({ applicable: false, evidence: null }); expect(f.query).not.toHaveBeenCalled(); expect(authority).not.toHaveBeenCalled();
  });
  it.each(['projectId', 'jobId', 'cableId', 'proposalId', 'dependencyHash'] as const)('requires seal ownership of the exact %s', async field => {
    const f = fixture(); f.input.seal = { ...f.input.seal!, [field]: field === 'dependencyHash' ? 'f'.repeat(64) : id(99) };
    expect(await f.run()).toEqual({ applicable: false, evidence: null }); expect(f.query).not.toHaveBeenCalled(); expect(authority).not.toHaveBeenCalled();
  });
  it.each(['waiting', 'running', 'blocked'])('does not promote an item in state %s into readiness', async state => {
    const f = fixture(); f.row.state = state;
    expect(await f.run()).toEqual({ applicable: false, evidence: null }); expect(authority).not.toHaveBeenCalled();
  });
  it.each(['no_path', 'stale', 'resource_limit', 'deadline_exceeded', 'calculating', 'locations_required'])('requires a calculated outcome instead of %s', async status => {
    const f = fixture(); f.row.status = status;
    expect(await f.run()).toEqual({ applicable: false, evidence: null }); expect(authority).not.toHaveBeenCalled();
  });
  it.each(['missing-item', 'null-dependencies', 'wrong-hash', 'legacy-dependencies', 'cancelled-row', 'changed-parent'] as const)(
    'refuses unavailable, stale or mismatched item evidence: %s', async kind => {
      const f = fixture();
      if (kind === 'missing-item') f.state.rows = [];
      if (kind === 'null-dependencies') f.row.dependencies = null;
      if (kind === 'wrong-hash') f.row.dependencies = { ...f.dependencies, cableWriteRevision: '8' };
      if (kind === 'legacy-dependencies') { f.row.dependencies = { ...f.dependencies, schemaVersion: 'pathfinder.dependencies.v6' }; f.input.dependencyHash = hash(f.row.dependencies); f.input.seal = { ...f.input.seal!, dependencyHash: f.input.dependencyHash }; }
      if (kind === 'cancelled-row') f.row.cancel_requested = true;
      if (kind === 'changed-parent') f.row.job_state = 'complete';
      expect(await f.run()).toEqual({ applicable: false, evidence: null }); expect(authority).not.toHaveBeenCalled();
    });
  it.each([null, { enrolled: false }, { scope: 'location-impact', enrolled: true, valid: false, code: 'LOCATION_IMPACT_TARGET_SUPERSEDED' },
    { scope: 'location-impact', enrolled: true, valid: false, code: 'LOCATION_IMPACT_AUTHORITY_EXPIRED' }])('requires actual current scoped authority: %s', async value => {
    const f = fixture(); authority.mockResolvedValue(value);
    expect(await f.run()).toEqual({ applicable: false, evidence: null }); expect(authority).toHaveBeenCalledOnce();
  });
  it('propagates a failed SQL proof read instead of manufacturing a display approval', async () => {
    const f = fixture(), failure = new Error('Synthetic SQL read failure.'); f.query.mockRejectedValue(failure);
    await expect(f.run()).rejects.toBe(failure); expect(authority).not.toHaveBeenCalled();
  });
  it('propagates authority errors instead of treating unavailable proof as a successful legacy fallback', async () => {
    const f = fixture(), failure = new Error('Synthetic authority integrity failure.'); authority.mockRejectedValue(failure);
    await expect(f.run()).rejects.toBe(failure);
  });
});
