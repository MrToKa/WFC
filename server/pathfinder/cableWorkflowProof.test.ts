// @vitest-environment node
import type { PoolClient } from 'pg';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CableWorkflowRow } from '../../shared/pathfinderCableWorkflow.js';
import type { BarrierDependencySnapshot, DependencySnapshot, EngineResponse } from './jobContracts.js';
import { defaultOptions } from './jobContracts.js';
import { hash } from './dependencies.js';
import { createCableWorkflowProofReader, readWorkflowVerifiedProposal, WORKFLOW_PROOF_BYTES, normalizeSavedDisplayComparison } from './cableWorkflowProof.js';
import { BARRIER_RUNTIME_PROFILE, barrierRouteHashInput, createBarrierRuntimePolicy, type BarrierRuntimeContext } from '../../shared/pathfinderBarrierRuntime.js';
import { syntheticBarrierEngineIdentity } from './calculationFixtures.js';
import { readBarrierWriteEvidence } from './barrierWrites.js';
import { mixedBarrierEngineIdentityBodySchema, MIXED_BARRIER_OPENING_RUNTIME_PROFILE, MIXED_BARRIER_LARGE_SELECTION_RUNTIME_PROFILE,
  MIXED_BARRIER_POLICY, MIXED_BARRIER_COLLISION_VERSION, MIXED_BARRIER_VERIFIER_VERSION, INTER_TRAY_OPENING_MANEUVER_POLICY } from '../../shared/pathfinderBarrierMixed.js';

const proof = vi.hoisted(() => ({ seal: vi.fn(), enrollment: vi.fn(), scope: vi.fn(),scoped:vi.fn(), initialFill: vi.fn(),automaticPair:vi.fn() }));
vi.mock('./revisionResultRepository.js', () => ({ verifyRevisionResultForProposal: proof.seal }));
vi.mock('./recalculationRepository.js', () => ({ readRecalculationJobAuthority: proof.enrollment }));
vi.mock('./routingScope.js', () => ({ requireVersionedCalculationScope: proof.scope }));
vi.mock('./locationImpactRepository.js',()=>({readLocationImpactJobAuthority:proof.scoped}));
vi.mock('./initialFillReceiptProof.js', () => ({ createInitialFillReceiptProofReader: () => proof.initialFill }));
vi.mock('./automaticPairReceiptProof.js', () => ({createAutomaticPairReceiptProofReader:()=>proof.automaticPair}));

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
    proposal_hash: hash({ fixture: 'proposal' }), dependency_hash: hash(dependencies), dependencies, result, job_state: 'complete', cancel_requested: false,
    item_state: 'complete', item_status: 'calculated' };
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
    if (sql.includes('pathfinder:sealed-item-applicability')) return {rows:[{state:'complete',status:'calculated',dependencies:raw.dependencies,job_state:raw.job_state,cancel_requested:raw.cancel_requested}]};
    if (sql.includes('pathfinder:barrier-sealed-item-applicability')) return {rows:[{state:'complete',status:'calculated',dependencies:raw.dependencies,proposal_dependencies:raw.dependencies,result:raw.result,
      dependency_hash:raw.dependency_hash,proposal_hash:raw.proposal_hash,proposal_status:raw.status,job_state:raw.job_state,cancel_requested:raw.cancel_requested}]};
    throw Error('Unexpected SQL in proof fixture.');
  });
  const client = { query } as unknown as PoolClient;
  const check = vi.fn(), reader = createCableWorkflowProofReader(client, projectId, check);
  return { dependencies, result, ledger, raw, seal, before, after, provenance, receipt, cable, current, query, client, check, reader };
}
beforeEach(() => {
  vi.clearAllMocks(); proof.scope.mockImplementation(() => undefined); proof.enrollment.mockResolvedValue({ enrolled: false });
  proof.scoped.mockResolvedValue({enrolled:true,valid:true,scope:'location-impact'});
  proof.initialFill.mockResolvedValue(false);
});

/** Explicit empty scope is a synthetic integrity fixture, not geometry or
 * acceptance evidence. Scope/SQL boundaries are mocked; the physical-strategy
 * integrity helper and strict response parser execute in the real reader. */
function barrierFixture() {
  const f=fixture(),scope={projectId,modelVersionId:f.dependencies.model.id,selectionRevision:f.dependencies.model.selectionRevision,contentFingerprint:f.dependencies.model.contentFingerprint,
    captureFrameId:id(20),captureFrameSha256:'b'.repeat(64),coordinateFrame:'canonical-world-metres' as const},policy=createBarrierRuntimePolicy(false);
  const barriers:BarrierRuntimeContext={schemaVersion:'wfc.pf.barrier-runtime.v1',binding:{scope,registryRevision:'3',snapshot:{snapshotId:id(21),scope,registryRevision:'3',contentSha256:'c'.repeat(64),mode:'explicit-empty'},policy,policySha256:hash(policy)},
    profile:structuredClone(BARRIER_RUNTIME_PROFILE),profileSha256:hash(BARRIER_RUNTIME_PROFILE),storage:{intentId:id(22),manifest:{blobId:id(23),sha256:'d'.repeat(64),bytes:1000},capture:null}};
  const {registryRevision:_registry,...body}=f.dependencies as DependencySnapshot&{registryRevision:string};
  const dependencies={...body,schemaVersion:'pathfinder.dependencies.v8',barriers,engineIdentity:syntheticBarrierEngineIdentity(),cableInputs:{fromLocation:'FROM',toLocation:'TO',mto:'LV',cableTypeId:id(24)},
    from:{point:[0,0,0]},to:{point:[5,0,0]},options:{...body.options,barrierRouting:{schemaVersion:'wfc.pf.barrier-admission-intent.v1',scope,expectedRegistryRevision:'3',expectedSnapshot:barriers.binding.snapshot,drillThroughWalls:false}}} as BarrierDependencySnapshot;
  const routeHash=hash(barrierRouteHashInput([[0,0,0],[5,0,0]]));
  const result:Data={...f.result,schemaVersion:'pathfinder.model.response.v3',calculationMode:'calculate',effectiveCategory:'LV',barriers:{schemaVersion:'wfc.pf.barrier-execution.v1',context:barriers,
    proof:{schemaVersion:'wfc.pf.barrier-check-proof.v2',binding:barriers.binding,routeSha256:routeHash,status:'no-barriers-declared',routePointCount:2,totalSegments:1,checkedSegments:0,blocking:null,failedSegmentIndex:null,reasonCode:'EXPLICIT_EMPTY_SCOPE',coverage:'registered-selected-objects-only',engineeringAccepted:false},
    directSecondary:{schemaVersion:'wfc.pf.constrained-direct-secondary.v2',policyVersion:'nearest-eligible-tray-or-registered-barriers.v2',binding:barriers.binding,directRouteSha256:routeHash,mode:'tray-network',directCheck:null,reasonCode:'DISTANCE_NOT_QUALIFIED',
      distanceDecision:{schemaVersion:'wfc.pf.direct-secondary.v1',policyVersion:'nearest-eligible-tray-or.v1',coordinateFrame:'canonical-world-metres',mode:'tray-network',fromPoint:[0,0,0],toPoint:[5,0,0],distanceMeters:5,nearestFromMeters:1,nearestToMeters:1,eligibleTrays:1,comparison:null}},
    diagnostics:{status:'no-barriers-declared',reasonCode:'DRILLING_BYPASS',searchComplete:true,candidatesTruncated:false,pairAttempts:0,collisionQueries:0,work:'1',plannerAttempts:0,straightPairAttempts:0,localEdgeChecks:0,localPhaseUsed:false,straightPhaseTruncated:false},connectors:{from:null,to:null},qualification:null}};
  f.raw.dependencies=dependencies;f.raw.result=result;
  const reseal=()=>{f.raw.dependency_hash=hash(dependencies);f.raw.proposal_hash=hash({dependencies,result,baselineHash:f.seal.baselineHash});
    proof.seal.mockResolvedValue({...f.seal,proposalId,dependencyHash:f.raw.dependency_hash,proposalHash:f.raw.proposal_hash,engineResultSha256:hash(result)});};
  reseal();
  return {...f,dependencies,result,reseal};
}
function protectedAcceptedFixture(priorRevision = beforeRevision, writtenRevision = afterRevision) {
  const f = barrierFixture(); f.dependencies.cableWriteRevision = priorRevision; f.before.cable_write_revision = priorRevision;
  f.after.cable_write_revision = writtenRevision; f.cable.cableWriteRevision = writtenRevision; f.reseal();
  const evidence = readBarrierWriteEvidence(f.dependencies, f.result);
  if (!evidence) throw Error('Expected complete synthetic protected receipt evidence.');
  f.receipt.provenance = { ...f.provenance, schemaVersion: 'pathfinder.apply.v3', proposalHash: f.raw.proposal_hash,
    dependencies: f.dependencies, barrierEvidence: evidence,
    review: { ...f.provenance.review, dependencyHash: f.raw.dependency_hash, validationMethod: 'manual-review' },
    revisionResult: { ...f.provenance.revisionResult, dependencyHash: f.raw.dependency_hash, engineResultSha256: hash(f.result) } };
  f.receipt.review_proposal_hash = f.raw.proposal_hash; f.receipt.review_dependency_sha256 = f.raw.dependency_hash;
  f.receipt.payload_hash = hash({proposalId,idempotencyKey:f.receipt.idempotency_key,reviewId:f.receipt.review_id,expectedCableWriteRevision:priorRevision});
  return f;
}

function savedDisplayFixture() {
  const f = protectedAcceptedFixture('18', '19'); f.receipt.provenance.schemaVersion = 'pathfinder.automatic-pair.v1';
  proof.automaticPair.mockResolvedValue({before:f.receipt.before_snapshot,after:f.receipt.after_snapshot});
  const current = structuredClone({...f.dependencies,cableWriteRevision:'19'});
  current.engineIdentity.coreModuleSha256 = '9'.repeat(64);
  const {contentSha256:_prior,...body}=current.engineIdentity;current.engineIdentity.contentSha256=hash(body);
  const expected={jobId,proposalId,proposalHash:f.raw.proposal_hash},fresh=vi.fn(async()=>current);
  return {...f,current,expected,fresh};
}

describe('read-only saved exact path after an implementation-only engine update',()=>{
  it('retains the proven18→19 saved geometry without granting current review or acceptance',async()=>{
    const f=savedDisplayFixture(),before=structuredClone(f.current),dependencyHash=f.raw.dependency_hash;
    expect(await f.reader.savedExactDisplay(f.cable,f.fresh,f.expected)).toBe(true);
    expect(await f.reader.accepted(f.cable,f.fresh,f.expected)).toBe(false);
    expect(await f.reader.reviewable(cableId,jobId,proposalId,f.current)).toMatchObject({currentness:'changed',reviewable:false,reasonCodes:['PROPOSAL_DEPENDENCIES_CHANGED']});
    expect(f.current).toEqual(before);expect(f.dependencies.cableWriteRevision).toBe('18');expect(f.cable.cableWriteRevision).toBe('19');expect(f.raw.dependency_hash).toBe(dependencyHash);
    expect(f.query.mock.calls.every(([sql])=>!/^\s*(?:INSERT|UPDATE|DELETE)/.test(sql))).toBe(true);
  });
  it.each(['model','from','to','settings','options','barriers','cableInputs','preparation'] as const)('rejects a concurrent %s engineering change',async field=>{
    const f=savedDisplayFixture(),current=f.current as unknown as Data;
    if(field==='model')current.model={...current.model,id:id(99)};
    else if(field==='from'||field==='to')current[field]={...current[field],point:[99,0,0]};
    else if(field==='settings')current.settings={...current.settings,revision:'99'};
    else if(field==='options')current.options={...current.options,secondaryDistanceMeters:99};
    else if(field==='barriers')current.barriers={...current.barriers,binding:{...current.barriers.binding,registryRevision:'99'}};
    else if(field==='cableInputs')current.cableInputs={...current.cableInputs,fromLocation:'OTHER'};
    else current.preparation={aggregateId:id(99)};
    expect(await f.reader.savedExactDisplay(f.cable,f.fresh,f.expected)).toBe(false);
  });
  it.each(['same-engine','policy','upstream','schema','digest'] as const)('rejects %s engine evidence',async kind=>{
    const f=savedDisplayFixture(),engine=f.current.engineIdentity as unknown as Data;
    if(kind==='same-engine')f.current.engineIdentity=structuredClone(f.dependencies.engineIdentity);
    else if(kind==='policy')engine.policyVersions={...engine.policyVersions,routing:'different-policy'};
    else if(kind==='upstream')engine.version='different-upstream';
    else if(kind==='schema')engine.schemaVersion='wfc.pf.engine-identity.v1';
    else engine.contentSha256='0'.repeat(64);
    expect(await f.reader.savedExactDisplay(f.cable,f.fresh,f.expected)).toBe(false);
  });
  it.each(['jobId','proposalId','proposalHash'] as const)('rejects an exchanged exact %s',async field=>{
    const f=savedDisplayFixture();f.expected[field]=field==='proposalHash'?'0'.repeat(64):id(99);
    expect(await f.reader.savedExactDisplay(f.cable,f.fresh,f.expected)).toBe(false);
  });
  it.each(['job-queued','job-running','job-cancelled','job-failed','cancel-requested','item-running','item-failed'] as const)('rejects %s execution state',async kind=>{
    const f=savedDisplayFixture();if(kind.startsWith('job-'))f.raw.job_state=kind.slice(4);
    else if(kind==='cancel-requested')f.raw.cancel_requested=true;
    else if(kind==='item-running')f.raw.item_state='running';else f.raw.item_status='failed';
    expect(await f.reader.savedExactDisplay(f.cable,f.fresh,f.expected)).toBe(false);
  });
  it.each(['receipt','receipt-tuple','manual-revision','routing','length','install','geometry','seal'] as const)('rejects unproved/tampered %s',async kind=>{
    const f=savedDisplayFixture();
    if(kind==='receipt')proof.automaticPair.mockResolvedValue(null);
    else if(kind==='receipt-tuple')f.receipt.proposal_id=id(99);
    else if(kind==='manual-revision')f.cable.cableWriteRevision='20';
    else if(kind==='routing')f.cable.routing='/OTHER';
    else if(kind==='length')f.cable.designLength='99';
    else if(kind==='install')f.cable.installLength='99';
    else if(kind==='geometry')f.result.route.pathPoints[0].x=99;
    else proof.seal.mockResolvedValue(null);
    expect(await f.reader.savedExactDisplay(f.cable,f.fresh,f.expected)).toBe(false);
  });
  it('keeps legacy proofs outside the saved exact display exception',async()=>{
    const f=fixture();expect(await f.reader.savedExactDisplay(f.cable,async()=>f.current,{jobId,proposalId,proposalHash:f.raw.proposal_hash})).toBe(false);
  });
});

describe('bounded saved-display metadata comparison (not independent authority)',()=>{
  function metadataFixture(){
    const source=barrierFixture(),frozen=structuredClone({...source.dependencies,cableWriteRevision:'18'}) as unknown as Data;
    const identity=(profile:string)=>{const {schemaVersion:_version,contentSha256:_sha,...body}=syntheticBarrierEngineIdentity();
      const mixed=mixedBarrierEngineIdentityBodySchema.parse({...body,schemaVersion:'wfc.pf.engine-identity.v3',policyVersions:{...body.policyVersions,
        projection:'wfc.pf.model-runner-v3-mixed-barrier-projection.v1',barriers:MIXED_BARRIER_COLLISION_VERSION,qualification:MIXED_BARRIER_VERIFIER_VERSION,
        runtimeProfile:profile,geometryPolicy:MIXED_BARRIER_POLICY,interTrayManeuvers:INTER_TRAY_OPENING_MANEUVER_POLICY}});
      return{...mixed,contentSha256:hash(mixed)};};
    frozen.barriers.schemaVersion='wfc.pf.barrier-runtime.v2';frozen.barriers.profile=structuredClone(MIXED_BARRIER_OPENING_RUNTIME_PROFILE);frozen.barriers.profileSha256=hash(frozen.barriers.profile);
    frozen.engineIdentity=identity(frozen.barriers.profile.schemaVersion);
    const current:Data=structuredClone({...frozen,cableWriteRevision:'19'});
    current.settings.routingBalance={mode:'destination-groups-v1',layoutSha256:'9'.repeat(64)};
    current.barriers.profile=structuredClone(MIXED_BARRIER_LARGE_SELECTION_RUNTIME_PROFILE);current.barriers.profileSha256=hash(current.barriers.profile);
    current.engineIdentity=identity(current.barriers.profile.schemaVersion);
    const normalize=()=>normalizeSavedDisplayComparison(current as DependencySnapshot,frozen as DependencySnapshot);
    const equal=()=>{const value=normalize();return value!==null&&hash({...value,cableWriteRevision:'18'})===hash(frozen);};
    return{frozen,current,normalize,equal};
  }
  it('compares exactly the live128/256→2048/2048 profile upgrade and absent→derived balance without changing its inputs',()=>{
    const f=metadataFixture(),before=structuredClone(f.current);expect(f.equal()).toBe(true);expect(f.current).toEqual(before);
    expect(f.normalize()).toMatchObject({engineIdentity:f.frozen.engineIdentity,barriers:{profile:f.frozen.barriers.profile,profileSha256:f.frozen.barriers.profileSha256}});
    expect(f.normalize()!.settings).not.toHaveProperty('routingBalance');
  });
  it('keeps same-engine background occupancy changes display-only and still checks all settings',()=>{
    const f=metadataFixture();f.frozen.settings.routingBalance={mode:'destination-groups-v1',layoutSha256:'8'.repeat(64)};
    f.current.barriers=structuredClone(f.frozen.barriers);f.current.engineIdentity=structuredClone(f.frozen.engineIdentity);
    expect(f.equal()).toBe(true);expect(f.normalize()).toMatchObject({engineIdentity:f.frozen.engineIdentity});
    f.current.settings.endConnectionLength='99';expect(f.equal()).toBe(false);
  });
  it.each(['parents','components','prior-limit','other-profile','current-profile-sha','prior-profile-sha','engine-policy','snapshot','model','from','to','settings-revision','math-setting','balance-mode','balance-sha','balance-extra','prior-balance-invalid','balance-removal'] as const)('refuses a %s difference rather than generalizing the metadata upgrade',kind=>{
    const f=metadataFixture();
    if(kind==='parents')f.current.barriers.profile.qualification.maximumParents=4096;
    if(kind==='components')f.current.barriers.profile.qualification.maximumComponents=4096;
    if(kind==='prior-limit')f.frozen.barriers.profile.qualification.maximumComponents=128;
    if(kind==='other-profile')f.current.barriers.profile.qualification.maximumTriangles=999;
    if(['parents','components','other-profile'].includes(kind))f.current.barriers.profileSha256=hash(f.current.barriers.profile);
    if(kind==='prior-limit')f.frozen.barriers.profileSha256=hash(f.frozen.barriers.profile);
    if(kind==='current-profile-sha')f.current.barriers.profileSha256='0'.repeat(64);
    if(kind==='prior-profile-sha')f.frozen.barriers.profileSha256='0'.repeat(64);
    if(kind==='engine-policy'){f.current.engineIdentity=structuredClone(f.frozen.engineIdentity);}
    if(kind==='snapshot')f.current.barriers.binding.snapshot.snapshotId=id(99);
    if(kind==='model')f.current.model.id=id(99);
    if(kind==='from')f.current.from.point=[99,0,0];
    if(kind==='to')f.current.to.point=[99,0,0];
    if(kind==='settings-revision')f.current.settings.revision='99';
    if(kind==='math-setting')f.current.settings.endConnectionLength='99';
    if(kind==='balance-mode')f.current.settings.routingBalance.mode='other';
    if(kind==='balance-sha')f.current.settings.routingBalance.layoutSha256='bad';
    if(kind==='balance-extra')f.current.settings.routingBalance.authority=true;
    if(kind==='prior-balance-invalid')f.frozen.settings.routingBalance={mode:'other',layoutSha256:'8'.repeat(64)};
    if(kind==='balance-removal'){f.frozen.settings.routingBalance={mode:'destination-groups-v1',layoutSha256:'8'.repeat(64)};delete f.current.settings.routingBalance;}
    expect(f.equal()).toBe(false);
  });
});

describe('cable workflow positive result evidence (synthetic boundaries)', () => {
  it.each(['queued','running','complete'])('uses current sealed v8 readiness with %s siblings after validating its retained physical strategy',async state=>{
    const f=barrierFixture();f.raw.job_state=state;
    expect(await f.reader.reviewable(cableId,jobId,proposalId,f.dependencies)).toMatchObject({currentness:'current',reviewable:true,
      itemApplicability:{schemaVersion:'wfc.pf.sealed-cable-applicability.v2',dependencyVersion:'pathfinder.dependencies.v8',projectId,jobId,cableId,proposalId}});
    expect(proof.scoped).toHaveBeenCalledWith(f.client,{projectId,jobId,cableId,lock:true});
  });
  it.each(['queued','running','complete'])('keeps non-scoped v8 readiness whole-job only (%s)',async state=>{
    const f=barrierFixture();f.raw.job_state=state;proof.scoped.mockResolvedValue(null);
    expect(await f.reader.reviewable(cableId,jobId,proposalId,f.dependencies)).toMatchObject({reviewable:state==='complete',itemApplicability:null});
  });
  it('refuses superseded v8 cable authority even after the whole parent completed',async()=>{
    const f=barrierFixture();proof.scoped.mockResolvedValue({enrolled:true,valid:false,code:'LOCATION_IMPACT_TARGET_SUPERSEDED'});
    expect(await f.reader.reviewable(cableId,jobId,proposalId,f.dependencies)).toMatchObject({reviewable:false,itemApplicability:null});
  });
  it.each(['legacy-response','missing-proof','wrong-route-hash','wrong-endpoint','changed-context','design-mode','extra-response-field'] as const)('never marks a coherently resealed v8 %s as verified',async kind=>{
    const f=barrierFixture();
    if(kind==='legacy-response')f.result.schemaVersion='pathfinder.model.response.v1';
    if(kind==='missing-proof')f.result.barriers.proof=null;
    if(kind==='wrong-route-hash')f.result.barriers.proof.routeSha256='0'.repeat(64);
    if(kind==='wrong-endpoint')f.result.route.pathPoints[0].x=99;
    if(kind==='changed-context')f.result.barriers.context={...f.result.barriers.context,binding:{...f.result.barriers.context.binding,registryRevision:'4'}};
    if(kind==='design-mode')f.result.calculationMode='design';
    if(kind==='extra-response-field')f.result.callerAuthority=true;
    f.reseal();expect(await readWorkflowVerifiedProposal(f.client,projectId,cableId,proposalId)).toBeNull();
    expect(await f.reader.reviewable(cableId,jobId,proposalId,f.dependencies)).toMatchObject({currentness:'unavailable',reviewable:false});
    expect(proof.scoped).not.toHaveBeenCalled();
    expect(await f.reader.accepted(f.cable,async()=>({...f.dependencies,cableWriteRevision:afterRevision}))).toBe(false);
  });
  it('keeps exact historical seal/scope/ledger evidence inspectable without granting a new review', async () => {
    const f = fixture();
    expect(await readWorkflowVerifiedProposal(f.client, projectId, cableId, proposalId)).not.toBeNull();
    expect(await f.reader.reviewable(cableId, jobId, proposalId, f.dependencies)).toEqual({ currentness: 'unavailable', reviewable: false, reasonCodes: ['BARRIER_WRITE_PROOF_REQUIRED'] });
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
  it.each(['queued','running','complete'])('does not promote historical sealed v7 readiness with %s siblings to a new protected review',async state=>{
    const f=fixture(),{registryRevision:_registry,...body}=f.dependencies as DependencySnapshot&{registryRevision:string};
    const dependencies={...body,schemaVersion:'pathfinder.dependencies.v7'} as DependencySnapshot;
    f.raw.dependencies=dependencies;f.raw.dependency_hash=hash(dependencies);f.raw.job_state=state;
    proof.seal.mockResolvedValue({...f.seal,proposalId,dependencyHash:f.raw.dependency_hash});
    proof.enrollment.mockResolvedValue({enrolled:true,valid:false,code:'AUTOMATIC_GENERATION_SUPERSEDED'});
    const result=await f.reader.reviewable(cableId,jobId,proposalId,dependencies);
    expect(result).toMatchObject({currentness:'unavailable',reviewable:false,reasonCodes:['BARRIER_WRITE_PROOF_REQUIRED']});
    expect(proof.enrollment).not.toHaveBeenCalled();expect(proof.scoped).not.toHaveBeenCalled();
  });
  it('refuses independently ready v7 when its exact cable target is superseded',async()=>{
    const f=fixture(),{registryRevision:_registry,...body}=f.dependencies as DependencySnapshot&{registryRevision:string};
    const dependencies={...body,schemaVersion:'pathfinder.dependencies.v7'} as DependencySnapshot;f.raw.dependencies=dependencies;f.raw.dependency_hash=hash(dependencies);f.raw.job_state='running';
    proof.seal.mockResolvedValue({...f.seal,proposalId,dependencyHash:f.raw.dependency_hash});proof.scoped.mockResolvedValue({enrolled:true,valid:false,code:'LOCATION_IMPACT_TARGET_SUPERSEDED'});
    expect(await f.reader.reviewable(cableId,jobId,proposalId,dependencies)).toMatchObject({currentness:'unavailable',reviewable:false,reasonCodes:['BARRIER_WRITE_PROOF_REQUIRED']});
  });
  it('retains proof caching but never obtains new enrollment authority for collision-unaware history', async () => {
    const f = fixture();
    const changed=structuredClone(f.dependencies);if(!('registryRevision' in changed))throw Error('Expected the legacy fixture.');changed.registryRevision='6';
    expect(await f.reader.reviewable(cableId, jobId, proposalId, changed)).toMatchObject({ currentness: 'unavailable', reviewable: false });
    proof.enrollment.mockResolvedValue({ enrolled: true, valid: false, code: 'AUTOMATIC_GENERATION_SUPERSEDED' });
    const first = await f.reader.reviewable(cableId, jobId, proposalId, f.dependencies);
    expect(first).toMatchObject({ currentness: 'unavailable', reviewable: false, reasonCodes: ['BARRIER_WRITE_PROOF_REQUIRED'] });
    await f.reader.reviewable(cableId, jobId, proposalId, f.dependencies);
    expect(proof.enrollment).not.toHaveBeenCalled(); expect(proof.seal).toHaveBeenCalledTimes(1);
  });
  it('refuses a cross-job proposal and cancellation request even with available points', async () => {
    const f = barrierFixture(); expect(await f.reader.reviewable(cableId, id(99), proposalId, f.dependencies)).toMatchObject({ reviewable: false });
    f.raw.cancel_requested = true;
    expect(await f.reader.reviewable(cableId, jobId, proposalId, f.dependencies)).toMatchObject({ reviewable: false, reasonCodes: ['SCOPED_ITEM_NOT_APPLICABLE'] });
  });
});

describe('receipt-backed current accepted cable display', () => {
  it('binds protected own-write evidence to the exact displayed job/proposal/hash tuple',async()=>{
    const f=protectedAcceptedFixture(),currentForOptions=vi.fn(async()=>({...f.dependencies,cableWriteRevision:afterRevision}));
    expect(await f.reader.accepted(f.cable,currentForOptions,{jobId,proposalId,proposalHash:f.raw.proposal_hash})).toBe(true);
    expect(currentForOptions).toHaveBeenCalledOnce();
  });
  it.each(['job','proposal','hash','malformed'] as const)('does not use an older valid accepted result for an exchanged %s tuple',async kind=>{
    const f=protectedAcceptedFixture(),currentForOptions=vi.fn(async()=>({...f.dependencies,cableWriteRevision:afterRevision}));
    const expected={jobId,proposalId,proposalHash:f.raw.proposal_hash};
    if(kind==='job')expected.jobId=id(99);if(kind==='proposal')expected.proposalId=id(99);if(kind==='hash')expected.proposalHash='f'.repeat(64);if(kind==='malformed')expected.jobId='not-a-job-id';
    expect(await f.reader.accepted(f.cable,currentForOptions,expected)).toBe(false);expect(currentForOptions).not.toHaveBeenCalled();
    if(kind==='proposal'||kind==='malformed')expect(f.query.mock.calls.some(([sql])=>sql.includes('proposal-proof'))).toBe(false);
  });
  it('retains exact tuple protection for separately proven automatic initial-fill receipts',async()=>{
    const f=protectedAcceptedFixture();f.receipt.provenance.schemaVersion='pathfinder.initial-fill.v2';proof.initialFill.mockResolvedValue(true);
    expect(await f.reader.accepted(f.cable,async()=>({...f.dependencies,cableWriteRevision:afterRevision}),{jobId,proposalId,proposalHash:f.raw.proposal_hash})).toBe(true);
    expect(await f.reader.accepted(f.cable,async()=>({...f.dependencies,cableWriteRevision:afterRevision}),{jobId:id(99),proposalId,proposalHash:f.raw.proposal_hash})).toBe(false);
  });
  it('recognizes exact apply.v3 protected evidence with its immutable human review and own-write transition', async () => {
    const f = protectedAcceptedFixture(), currentForOptions = vi.fn(async () => ({ ...f.dependencies, cableWriteRevision: afterRevision }));
    expect(await f.reader.accepted(f.cable, currentForOptions)).toBe(true);
    expect(currentForOptions).toHaveBeenCalledWith(f.dependencies.options, 'pathfinder.dependencies.v8');
    expect(proof.enrollment).not.toHaveBeenCalled();
  });
  it.each(['legacy-label', 'missing-evidence', 'execution-digest', 'policy', 'result-digest', 'review-method', 'wrong-dependencies'] as const)(
    'does not recognize protected acceptance with exchanged %s', async kind => {
      const f = protectedAcceptedFixture(), provenance = f.receipt.provenance as Data;
      if (kind === 'legacy-label') provenance.schemaVersion = 'pathfinder.apply.v2';
      if (kind === 'missing-evidence') delete provenance.barrierEvidence;
      if (kind === 'execution-digest') provenance.barrierEvidence.executionSha256 = 'f'.repeat(64);
      if (kind === 'policy') provenance.barrierEvidence.policySha256 = 'f'.repeat(64);
      if (kind === 'result-digest') provenance.revisionResult.engineResultSha256 = 'f'.repeat(64);
      if (kind === 'review-method') provenance.review.validationMethod = 'automatic-initial-fill';
      if (kind === 'wrong-dependencies') provenance.dependencies = { ...f.dependencies, options: { ...f.dependencies.options, secondaryDistanceMeters: 99 } };
      const currentForOptions = vi.fn(); expect(await f.reader.accepted(f.cable, currentForOptions)).toBe(false); expect(currentForOptions).not.toHaveBeenCalled();
    });
  it('recognizes initial-fill.v2 only through its separate immutable receipt chain after physical evidence validation', async () => {
    const f = protectedAcceptedFixture(); f.receipt.provenance.schemaVersion = 'pathfinder.initial-fill.v2'; proof.initialFill.mockResolvedValue(true);
    expect(await f.reader.accepted(f.cable, async () => ({ ...f.dependencies, cableWriteRevision: afterRevision }))).toBe(true);
    expect(proof.initialFill).toHaveBeenCalledWith(expect.objectContaining({ dependencies: f.dependencies, result: f.result, provenance: f.receipt.provenance }));
  });
  it('recognizes automatic pair own writes only through exact historical proof and current tuple',async()=>{
    const f=protectedAcceptedFixture(); f.receipt.provenance.schemaVersion='pathfinder.automatic-pair.v1';
    proof.automaticPair.mockResolvedValue({before:f.receipt.before_snapshot,after:f.receipt.after_snapshot});
    expect(await f.reader.accepted(f.cable,async()=>({...f.dependencies,cableWriteRevision:afterRevision}),{jobId,proposalId,proposalHash:f.raw.proposal_hash})).toBe(true);
    expect(proof.automaticPair).toHaveBeenCalledWith({projectId,cableId,receiptId:f.receipt.id});
    expect(await f.reader.accepted(f.cable,async()=>({...f.dependencies,cableWriteRevision:afterRevision}),{jobId:id(99),proposalId,proposalHash:f.raw.proposal_hash})).toBe(false);
  });
  it.each(['unproved','different-transition'])('refuses automatic pair own-write exception with %s receipt',async kind=>{
    const f=protectedAcceptedFixture(); f.receipt.provenance.schemaVersion='pathfinder.automatic-pair.v1';
    proof.automaticPair.mockResolvedValue(kind==='unproved'?null:{before:f.receipt.before_snapshot,after:{...f.receipt.after_snapshot,routing:'/OTHER'}});
    const fresh=vi.fn(); expect(await f.reader.accepted(f.cable,fresh)).toBe(false); expect(fresh).not.toHaveBeenCalled();
  });
  it('does not let protected own-write proof excuse a subsequent barrier policy change', async () => {
    const f = protectedAcceptedFixture(), current = { ...f.dependencies, cableWriteRevision: afterRevision,
      options: { ...f.dependencies.options, barrierRouting: { ...f.dependencies.options.barrierRouting!, drillThroughWalls: true } } };
    expect(await f.reader.accepted(f.cable, async () => current)).toBe(false);
  });
  it('proves the exact large own-write revision transition and decimal scale without requiring the old login alive', async () => {
    const f = fixture(), currentForOptions = vi.fn(async () => f.current);
    expect(await f.reader.accepted(f.cable, currentForOptions)).toBe(true);
    expect(f.current.cableWriteRevision).toBe(afterRevision);
    expect(currentForOptions).toHaveBeenCalledWith(f.dependencies.options,f.dependencies.schemaVersion);
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
  it('recognizes a distinct proven initial-fill receipt with no fabricated review, retaining exact current dependency checks', async () => {
    const f = fixture(); f.before.routing = ''; (f.before as Data).design_length = null;
    f.receipt.provenance = { schemaVersion: 'pathfinder.initial-fill.v1' };
    for (const key of ['review_id', 'review_actor', 'review_proposal', 'review_proposal_hash', 'validation_method', 'review_login_id']) delete f.receipt[key];
    proof.initialFill.mockResolvedValue(true); const currentForOptions = vi.fn(async () => f.current);
    expect(await f.reader.accepted(f.cable, currentForOptions)).toBe(true);
    expect(proof.initialFill).toHaveBeenCalledExactlyOnceWith({ projectId, cableId, receiptId: f.receipt.id, proposalId,
      actorId: f.receipt.actor_id, idempotencyKey: f.receipt.idempotency_key, payloadHash: f.receipt.payload_hash,
      before: f.before, after: f.after, provenance: f.receipt.provenance, dependencies: f.dependencies, result: f.result, seal: f.seal });
    expect(currentForOptions).toHaveBeenCalledWith(f.dependencies.options, f.dependencies.schemaVersion);
    expect(proof.enrollment).not.toHaveBeenCalled();
  });
  it('never promotes an unproven newest initial-fill receipt or searches an older manual success', async () => {
    const f = fixture(); f.receipt.provenance = { schemaVersion: 'pathfinder.initial-fill.v1' }; const currentForOptions = vi.fn();
    expect(await f.reader.accepted(f.cable, currentForOptions)).toBe(false);
    expect(proof.initialFill).toHaveBeenCalledOnce(); expect(currentForOptions).not.toHaveBeenCalled();
    expect(f.query.mock.calls.filter(([sql]) => sql.includes('accepted-proof'))).toHaveLength(1);
  });
  it('does not allow a valid historical initial fill to exempt any later model/settings change', async () => {
    const f = fixture(); f.receipt.provenance = { schemaVersion: 'pathfinder.initial-fill.v1' }; proof.initialFill.mockResolvedValue(true);
    const current = { ...f.current, settings: { ...f.current.settings, revision: '99' } };
    expect(await f.reader.accepted(f.cable, async () => current)).toBe(false);
  });
});
