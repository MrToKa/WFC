// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Pool, PoolClient } from 'pg';
import { createCableWorkflowRepository } from './cableWorkflowRepository.js';
import { classifyCableWorkflow } from '../../shared/pathfinderCableWorkflow.js';
import type { CableWorkflowDetailQuery } from '../../shared/pathfinderCableWorkflowQueries.js';
import { defaultOptions, type DependencySnapshot } from './jobContracts.js';
import { endpointBindingFixture } from '../../shared/pathfinderEndpointFixtures.js';
import { MIXED_BARRIER_POLICY } from '../../shared/pathfinderBarrierMixed.js';
import { supportedBarrierAdmissionIntentSchema } from '../../shared/pathfinderBarrierSupported.js';
import { PathFinderError } from './errors.js';

const mocks = vi.hoisted(() => ({ tx: vi.fn(), common: vi.fn(), barrierCommon: vi.fn(), heads: vi.fn(), automatic: vi.fn(), verified: vi.fn(), reviewable: vi.fn(), accepted: vi.fn(), savedExactDisplay: vi.fn() }));
vi.mock('./cableWorkflowRead.js', () => ({ cableWorkflowReadTransaction: mocks.tx }));
vi.mock('./dependencies.js', async original => ({ ...await original<typeof import('./dependencies.js')>(), collectCommonCalculationInputs: mocks.common, collectBarrierCommonCalculationInputs: mocks.barrierCommon,
  createCablePurposeRoutingReader:async()=>((purpose:unknown)=>purpose==='Control'?{purpose:'Control',allowedRouteCodes:['/B001']}:null),
  freezeCableDependencies: (common: object, cable: Record<string, unknown>) => ({ cable, status: 'ready', message: '', dependencies: { ...common, cableId: cable.id, cableWriteRevision: cable.cable_write_revision } }),
  freezeCableDependenciesForVersion: (common: object, cable: Record<string, unknown>) => ({ cable, status: 'ready', message: '', dependencies: { ...common, cableId: cable.id, cableWriteRevision: cable.cable_write_revision } }) }));
vi.mock('./endpointBindingRepository.js', () => ({ readCurrentEndpointBindingContext: vi.fn(async () => null), readNeededEndpointBindingHeads: mocks.heads }));
vi.mock('./automaticEndpointCandidates.js', () => ({ readAutomaticEndpointCandidates: mocks.automatic }));
vi.mock('./cableWorkflowProof.js', () => ({ createCableWorkflowProofReader: () => ({ verified: mocks.verified, reviewable: mocks.reviewable, accepted: mocks.accepted, savedExactDisplay: mocks.savedExactDisplay }) }));
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const projectId = id(1), who = { userId: id(2), loginId: id(3), loginExpiresAt: Date.now() + 1000_000 };
function cable(n: number) { return { id: id(1000 + n), cable_type_id: id(4), cable_type_purpose:'Control', mto: 'Control', cable_write_revision: '7', tag: `SYNTHETIC-${n}`,
  from_location: 'A', to_location: 'B', routing: null, design_length: null, install_length: '123', input_oversize: false }; }
function meta(n: number, patch: Record<string, unknown> = {}) { return { cable_id: id(1000 + n), admission_id: id(10), job_id: id(11), job_status: 'running',
  cancel_requested: false, item_state: 'waiting', item_status: 'ready', baseline_status: 'ready', proposal_id: null, proposal_hash: null, proposal_status: null, ...patch }; }
function common() { return { status: 'ready', bindingContext: { modelVersionId: id(5), selectionRevision: '1', artifactId: id(6), aggregateId: id(7),
  contentFingerprint: 'a'.repeat(64), captureFrameId: id(8), projectionSha256: 'b'.repeat(64), geometryRevision: '2', traceId: id(9) },
  inputs: { projectId, registryRevision: '1', model: { id: id(5), selectionRevision: '1', contentFingerprint: 'a'.repeat(64) },
    options: { ...defaultOptions, connectionToleranceMeters: 1 }, settings: { revision: '1' }, engineIdentity: { contentSha256: 'c'.repeat(64) } } }; }
function fixture(count = 1) {
  const state = { cables: Array.from({ length: count }, (_, n) => cable(n)), metadata: new Map<string, ReturnType<typeof meta>>(),
    admissionCount: 1, generation: '1', latest: id(10), aliases: true, common: common(), badScan: false, hasReceipt: false, allowReview: true,
    savedIdentity: null as Record<string, unknown> | null, receiptCableIds: [] as string[] };
  const query = vi.fn(async (sql: string, values: unknown[] = []) => {
    if (sql.includes('cable-workflow:context')) return { rows: [{ active_model_version_id: id(5), selection_revision: '1', admission_count: state.admissionCount,
      context: { generation: state.generation, latest: state.latest } }] };
    if (sql.includes('cable-purpose:locked-scope-types')) {const ids=values[1] as string[];return{rows:state.cables.filter(c=>ids.includes(c.id)).map(c=>({...c}))};}
    if (sql.includes('cable-workflow:candidates')) {
      const after = values[1] as string | null, exact = values[2] as string | null, asciiNeedle = values[3] as string | null;
      // Simulate only the conservative candidate protocol; real PostgreSQL tests verify its SQL implementation.
      const found = state.cables.filter(value => value.mto !== 'MV' && (!after || value.id > after) && (!exact || value.id === exact)
        && (asciiNeedle === null || value.input_oversize || [value.tag, value.from_location, value.to_location]
          .some(text => text !== null && (/[^\x20-\x7e]/.test(text) || text.toUpperCase().includes(asciiNeedle))))).slice(0, 201);
      return { rows: state.badScan && found.length ? [found[0], found[0]] : found };
    }
    if (sql.includes('cable-workflow:needed-locations')) return { rows: state.aliases ? [{ normalized_alias: 'A', id: id(20), name: 'A', revision: '1', has_legacy: false },
      { normalized_alias: 'B', id: id(21), name: 'B', revision: '1', has_legacy: false }] : [] };
    if (sql.includes('cable-workflow:latest-admissions')) return { rows: (values[1] as string[]).flatMap(cableId => state.metadata.has(cableId) ? [state.metadata.get(cableId)!] : []) };
    if (sql.includes('cable-workflow:accepted-identities')) return { rows: [...new Set([...state.receiptCableIds, ...(state.hasReceipt ? [state.cables[0].id] : [])])]
      .filter(cableId => (values[1] as string[]).includes(cableId)).map(cable_id => ({ cable_id })) };
    if (sql.includes('cable-workflow:saved-route-identity')) return { rows: state.savedIdentity ? [state.savedIdentity] : [] };
    throw Error('Unexpected SQL in explicit mocked read-model protocol: ' + sql.slice(0, 80));
  });
  const client = { query } as unknown as PoolClient;
  mocks.tx.mockImplementation(async (_pool, _project, _who, operation) => operation(client, () => undefined));
  mocks.common.mockImplementation(async () => state.common);
  mocks.barrierCommon.mockImplementation(async () => state.common);
  mocks.heads.mockImplementation(async () => new Map([20, 21].map(n => { const binding = { ...endpointBindingFixture(), projectId, locationId: id(n) }; return [id(n), { binding, ready: true }]; })));
  mocks.automatic.mockResolvedValue(new Map());
  mocks.verified.mockImplementation(async () => ({ dependencies: { options: state.common.inputs?.options ?? defaultOptions } }));
  mocks.reviewable.mockImplementation(async (_cable, _job, _proposal, current) => ({ currentness: current ? 'current' : 'changed', reviewable: !!current && state.allowReview, reasonCodes: [] }));
  mocks.accepted.mockResolvedValue(false);
  mocks.savedExactDisplay.mockResolvedValue(false);
  const repo = createCableWorkflowRepository({} as Pool, { cursorKey: Buffer.alloc(32, 42) });
  return { state, query, repo };
}
beforeEach(() => vi.clearAllMocks());

describe('stored route after a separate later unsuccessful attempt',()=>{
  function retainedRoute() {
    const f=fixture();f.state.hasReceipt=true;f.state.cables[0].routing='/SAVED' as never;f.state.cables[0].design_length='58' as never;
    f.state.savedIdentity={receipt_id:id(90),job_id:id(80),proposal_id:id(81),proposal_hash:'a'.repeat(64)};
    f.state.metadata.set(id(1000),meta(0,{job_status:'complete',item_state:'blocked',item_status:'routing_preparation_required'}));
    return f;
  }
  it.each(['current','saved-exact'] as const)('keeps latest attempt diagnostics and independently proves the %s stored tuple',async currentness=>{
    const f=retainedRoute();mocks.accepted.mockResolvedValue(currentness==='current');mocks.savedExactDisplay.mockResolvedValue(currentness==='saved-exact');
    const detail=await f.repo.detail(projectId,who,id(1000),{});
    expect(detail.row.calculation).toMatchObject({jobId:id(11),jobStatus:'complete',itemState:'blocked',outcome:'stale',currentness:'changed',
      reasonCodes:['ROUTING_PREPARATION_REQUIRED','ROUTING_PREPARATION_UPDATED'],proposalId:null,proposalHash:null,reviewable:false,acceptedMatchesCurrent:false});
    expect(detail.row.savedRoute).toEqual({receiptId:id(90),jobId:id(80),proposalId:id(81),proposalHash:'a'.repeat(64),currentness});
    expect(mocks.accepted).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({id:id(1000),routing:'/SAVED',designLength:'58'}),expect.any(Function),
      {receiptId:id(90),jobId:id(80),proposalId:id(81),proposalHash:'a'.repeat(64)});
    expect(classifyCableWorkflow(detail.row).status).toBe('up-to-date');
    expect((await f.repo.page(projectId,who,{filter:'up-to-date'})).rows).toEqual([detail.row]);
    expect((await f.repo.page(projectId,who,{filter:'needs-routing'})).rows).toEqual([]);
    expect(f.query.mock.calls.every(([sql])=>!/^\s*(?:INSERT|UPDATE|DELETE)\b/i.test(sql))).toBe(true);
  });
  it.each(['failed','cancelled'] as const)('retains a %s later job without changing its saved route identity',async jobStatus=>{
    const f=retainedRoute();Object.assign(f.state.metadata.get(id(1000))!,{job_status:jobStatus,item_status:'failed'});mocks.accepted.mockResolvedValue(true);
    const detail=await f.repo.detail(projectId,who,id(1000),{});
    expect(detail.row.calculation).toMatchObject({jobId:id(11),jobStatus,outcome:'failed',acceptedMatchesCurrent:false,reviewable:false});
    expect(detail.row.savedRoute).toMatchObject({jobId:id(80),proposalId:id(81),currentness:'current'});
  });
  it.each(['unproved','invalid-identity','missing-values','pending','automatic-pending','new-calculated'] as const)('does not expose stored geometry for %s evidence',async kind=>{
    const f=retainedRoute();
    if(kind==='invalid-identity')f.state.savedIdentity!.proposal_hash='invalid';
    if(kind==='missing-values')f.state.cables[0].routing=null;
    if(kind==='pending')Object.assign(f.state.metadata.get(id(1000))!,{job_status:'running',item_state:'waiting'});
    if(kind==='automatic-pending')Object.assign(f.state.metadata.get(id(1000))!,{automatic_update_status:'pending',automatic_update_receipt:null,automatic_update_reason:null});
    if(kind==='new-calculated')Object.assign(f.state.metadata.get(id(1000))!,{item_state:'complete',proposal_status:'calculated',proposal_id:id(30),proposal_hash:'f'.repeat(64)});
    expect((await f.repo.detail(projectId,who,id(1000),{})).row.savedRoute).toBeUndefined();
    if(kind!=='unproved')expect(f.query.mock.calls.some(([sql])=>sql.includes('saved-route-identity'))).toBe(kind==='invalid-identity');
  });
});

describe('read-only saved geometry qualification in workflow projection',()=>{
  function savedRow(jobStatus: 'complete' | 'failed' = 'complete'){
    const f=fixture();f.state.hasReceipt=true;f.state.cables[0].routing='/SAVED' as never;f.state.cables[0].design_length='58' as never;
    f.state.metadata.set(id(1000),meta(0,{job_status:jobStatus,item_state:'complete',proposal_status:'calculated',proposal_id:id(30),proposal_hash:'f'.repeat(64)}));
    mocks.reviewable.mockResolvedValue({currentness:'changed',reviewable:false,reasonCodes:['PROPOSAL_DEPENDENCIES_CHANGED']});mocks.savedExactDisplay.mockResolvedValue(true);
    return f;
  }
  it.each(['complete', 'failed'] as const)('exposes only the qualified saved tuple after %s parent with changed write authority',async jobStatus=>{
    const f=savedRow(jobStatus),detail=await f.repo.detail(projectId,who,id(1000),{});
    expect(detail.row.calculation).toMatchObject({savedExactDisplay:true,currentness:'changed',reviewable:false,acceptedMatchesCurrent:false,proposalId:id(30),proposalHash:'f'.repeat(64)});
    expect(mocks.savedExactDisplay).toHaveBeenCalledWith(expect.objectContaining({id:id(1000),routing:'/SAVED',designLength:'58'}),expect.any(Function),{jobId:id(11),proposalId:id(30),proposalHash:'f'.repeat(64)});
    expect(classifyCableWorkflow(detail.row).status).toBe('up-to-date');
  });
  it.each(['current','accepted','no-receipt','cancelled','running','pending'] as const)('does not perform extra saved proof for %s evidence',async kind=>{
    const f=savedRow();
    if(kind==='current')mocks.reviewable.mockResolvedValue({currentness:'current',reviewable:true,reasonCodes:[]});
    if(kind==='accepted')mocks.accepted.mockResolvedValue(true);
    if(kind==='no-receipt')f.state.hasReceipt=false;
    if(kind==='cancelled')f.state.metadata.get(id(1000))!.cancel_requested=true;
    if(kind==='running')f.state.metadata.get(id(1000))!.job_status='running';
    if(kind==='pending'){f.state.metadata.get(id(1000))!.job_status='running';f.state.metadata.get(id(1000))!.item_state='running';}
    const detail=await f.repo.detail(projectId,who,id(1000),{});
    expect(detail.row.calculation.savedExactDisplay).toBeUndefined();expect(mocks.savedExactDisplay).not.toHaveBeenCalled();
  });
  it('does not expose a failed saved proof',async()=>{
    const f=savedRow();mocks.savedExactDisplay.mockResolvedValue(false);const detail=await f.repo.detail(projectId,who,id(1000),{});
    expect(detail.row.calculation.savedExactDisplay).toBeUndefined();expect(detail.row.calculation).toMatchObject({currentness:'changed',reviewable:false,acceptedMatchesCurrent:false});
  });
});

describe('saved route status after a compatible engine upgrade', () => {
  it('keeps fifteen compatible saved pairs and one strict current pair Updated while retaining the two real exceptions', async () => {
    const f = fixture(18), compatible = new Set(f.state.cables.slice(0, 15).map(value => value.id));
    const strictCurrent = f.state.cables[15], manuallyChanged = f.state.cables[16], missingLocation = f.state.cables[17];
    for (const [n, value] of f.state.cables.entries()) {
      if (value === missingLocation) {
        f.state.metadata.set(value.id, meta(n, { job_status: 'complete', item_state: 'blocked', item_status: 'locations_required' }));
        continue;
      }
      Object.assign(value, { routing: '/SAVED/SECONDARY', design_length: '20' });
      f.state.receiptCableIds.push(value.id);
      f.state.metadata.set(value.id, meta(n, { job_status: 'complete', item_state: 'complete', proposal_status: 'calculated',
        proposal_id: id(2000 + n), proposal_hash: 'f'.repeat(64) }));
    }
    Object.assign(manuallyChanged, { routing: '/MANUAL/SECONDARY', design_length: '25', cable_write_revision: '9' });
    mocks.reviewable.mockResolvedValue({ currentness: 'changed', reviewable: false, reasonCodes: ['PROPOSAL_DEPENDENCIES_CHANGED'] });
    mocks.accepted.mockImplementation(async (value: { id: string }) => value.id === strictCurrent.id);
    mocks.savedExactDisplay.mockImplementation(async (value: { id: string }) => compatible.has(value.id));
    const before = structuredClone(f.state.cables);
    const needs = await f.repo.page(projectId, who, { filter: 'needs-routing' });
    expect(needs.rows.map(value => value.cable.id)).toEqual([manuallyChanged.id, missingLocation.id]);
    const updated = await f.repo.page(projectId, who, { filter: 'up-to-date' });
    expect(updated.rows).toHaveLength(16);
    expect(updated.rows.slice(0, 15).every(value => value.calculation.savedExactDisplay === true
      && value.calculation.currentness === 'changed' && !value.calculation.reviewable && !value.calculation.acceptedMatchesCurrent)).toBe(true);
    expect(f.state.cables).toEqual(before);
    expect(f.query.mock.calls.every(([sql]) => !/^\s*(?:INSERT|UPDATE|DELETE)\b/i.test(sql))).toBe(true);
  });
});

describe('bounded cable diagnostics, mocked SQL protocol and explicit proof/auth seams', () => {
  it('checks the linked Purpose after common input locking rather than the earlier row projection',async()=>{
    const f=fixture();
    f.state.metadata.set(id(1000),meta(0,{job_status:'complete',item_state:'complete',proposal_status:'calculated',proposal_id:id(30),proposal_hash:'f'.repeat(64)}));
    mocks.common.mockImplementationOnce(async()=>{
      f.state.cables[0]={...f.state.cables[0],cable_type_purpose:'Unconfigured'};
      return f.state.common;
    });
    mocks.verified.mockResolvedValue({dependencies:{schemaVersion:'pathfinder.dependencies.v7',options:defaultOptions}});
    const value=await f.repo.detail(projectId,who,id(1000),{});
    expect(value.row.calculation).toMatchObject({currentness:'changed',reviewable:false});
    expect(mocks.reviewable.mock.calls[0][3]).toBeNull();
  });
  function mixedIntent(){
    const scope={projectId,modelVersionId:id(5),selectionRevision:'1',contentFingerprint:'a'.repeat(64),
      captureFrameId:id(8),captureFrameSha256:'b'.repeat(64),coordinateFrame:'canonical-world-metres' as const};
    return supportedBarrierAdmissionIntentSchema.parse({schemaVersion:'wfc.pf.barrier-admission-intent.v2',geometryPolicy:MIXED_BARRIER_POLICY,scope,
      expectedRegistryRevision:'3',expectedSnapshot:{schemaVersion:'wfc.pf.barrier-snapshot-reference.v2',geometryPolicy:MIXED_BARRIER_POLICY,
        snapshotId:id(50),scope:structuredClone(scope),registryRevision:'3',contentSha256:'d'.repeat(64),mode:'explicit-empty'},drillThroughWalls:false});
  }
  it.each(['secondary', 'vertical', 'missing-barrier', 'drilling', 'unavailable-barrier'] as const)(
    'keeps a receipt-proven saved route Updated independently of draft %s preferences', async kind => {
      const f = fixture(), intent = mixedIntent();
      const recorded = { ...f.state.common.inputs.options, barrierRouting: intent };
      const requested: CableWorkflowDetailQuery = { secondaryDistanceMeters: recorded.secondaryDistanceMeters, preferVerticalApproach: recorded.preferVerticalApproach,
        ...(kind === 'missing-barrier' ? {} : { barrierRouting: ['drilling', 'unavailable-barrier'].includes(kind) ? { ...intent, drillThroughWalls: true } : intent }) };
      if (kind === 'secondary') requested.secondaryDistanceMeters = 99;
      if (kind === 'vertical') requested.preferVerticalApproach = !recorded.preferVerticalApproach;
      f.state.hasReceipt = true; f.state.cables[0].routing = '/SAVED' as never; f.state.cables[0].design_length = '58' as never;
      f.state.metadata.set(id(1000), meta(0, { job_status: 'complete', item_state: 'complete', proposal_status: 'calculated', proposal_id: id(30), proposal_hash: 'f'.repeat(64) }));
      mocks.barrierCommon.mockImplementation(async (_client, _project, options) => {
        if (kind === 'unavailable-barrier' && options.barrierRouting.drillThroughWalls)
          throw new PathFinderError('BARRIER_CONTEXT_CHANGED', 409);
        return { ...f.state.common, inputs: { ...f.state.common.inputs, options } };
      });
      mocks.verified.mockResolvedValue({ dependencies: { schemaVersion: 'pathfinder.dependencies.v8', options: recorded } });
      mocks.accepted.mockImplementation(async (_cable, currentForOptions) => {
        const current = await currentForOptions(recorded, 'pathfinder.dependencies.v8');
        return current?.settings.revision === '1' && JSON.stringify(current.options) === JSON.stringify(recorded)
          && current.cablePurposeRouting?.purpose === 'Control';
      });
      const before = structuredClone(f.state.cables[0]);
      const detail = await f.repo.detail(projectId, who, id(1000), requested);
      expect(mocks.reviewable.mock.calls[0][3]).toBeNull();
      expect(detail.row.calculation).toMatchObject({ currentness: 'current', acceptedMatchesCurrent: true, reviewable: false });
      expect(classifyCableWorkflow(detail.row).status).toBe('up-to-date');
      expect((await f.repo.page(projectId, who, { ...requested, filter: 'needs-routing' })).rows).toEqual([]);
      expect((await f.repo.page(projectId, who, { ...requested, filter: 'up-to-date' })).rows).toHaveLength(1);
      expect(f.state.cables[0]).toEqual(before);
      // A real shared-settings change still fails the same saved dependency check.
      f.state.common.inputs.settings.revision = '2';
      const stale = await f.repo.detail(projectId, who, id(1000), requested);
      expect(stale.row.calculation).toMatchObject({ currentness: kind === 'unavailable-barrier' ? 'unavailable' : 'changed', acceptedMatchesCurrent: false, reviewable: false });
      expect((await f.repo.page(projectId, who, { ...requested, filter: 'needs-routing' })).rows).toHaveLength(1);
    },
  );
  it.each(['current', 'saved-exact'] as const)('checks a separate %s saved receipt with its recorded options after a failed attempt', async currentness => {
    const f = fixture(), recorded = { ...f.state.common.inputs.options, barrierRouting: mixedIntent() };
    f.state.hasReceipt = true; f.state.cables[0].routing = '/SAVED' as never; f.state.cables[0].design_length = '58' as never;
    f.state.savedIdentity = { receipt_id: id(90), job_id: id(80), proposal_id: id(81), proposal_hash: 'a'.repeat(64) };
    f.state.metadata.set(id(1000), meta(0, { job_status: 'complete', item_state: 'complete', item_status: 'no_path' }));
    mocks.barrierCommon.mockImplementation(async (_client, _project, options) => ({ ...f.state.common, inputs: { ...f.state.common.inputs, options } }));
    const verifyRecorded = async (_cable: unknown, currentForOptions: (options: unknown, version: DependencySnapshot['schemaVersion']) => Promise<DependencySnapshot | null>) => {
      const current = await currentForOptions(recorded, 'pathfinder.dependencies.v8');
      return current !== null && JSON.stringify(current.options) === JSON.stringify(recorded);
    };
    if (currentness === 'current') mocks.accepted.mockImplementation(verifyRecorded);
    else mocks.savedExactDisplay.mockImplementation(verifyRecorded);
    const detail = await f.repo.detail(projectId, who, id(1000), { preferVerticalApproach: false });
    expect(detail.row.savedRoute?.currentness).toBe(currentness);
    expect(detail.row.calculation).toMatchObject({ outcome: 'no-path', acceptedMatchesCurrent: false, reviewable: false });
    expect(classifyCableWorkflow(detail.row).status).toBe('up-to-date');
  });
  it('recognizes exact mixed current preferences through the existing proof/readiness seam',async()=>{
    const f=fixture(),intent=mixedIntent(),options={...f.state.common.inputs.options,barrierRouting:intent};
    f.state.metadata.set(id(1000),meta(0,{job_status:'complete',item_state:'complete',proposal_status:'calculated',proposal_id:id(30),proposal_hash:'f'.repeat(64)}));
    mocks.barrierCommon.mockResolvedValue({...f.state.common,inputs:{...f.state.common.inputs,options}});
    mocks.verified.mockResolvedValue({dependencies:{schemaVersion:'pathfinder.dependencies.v8',options}});
    const value=await f.repo.detail(projectId,who,id(1000),{barrierRouting:structuredClone(intent)});
    expect(value.row.calculation).toMatchObject({currentness:'current',reviewable:true});
    expect(mocks.reviewable.mock.calls[0][3]).toMatchObject({options});expect(mocks.barrierCommon).toHaveBeenCalledOnce();expect(mocks.common).not.toHaveBeenCalled();
  });
  it.each([
    ['same-options','BARRIER_CALCULATION_STORAGE_INVALID'],['recorded-tolerance','BARRIER_CALCULATION_STORAGE_INVALID'],
    ['same-options','BARRIER_BLOB_MISSING'],['recorded-tolerance','BARRIER_BLOB_MISSING'],
  ] as const)('retains saved cable fields with an explicit missing-barrier diagnostic for %s / %s',async(kind,reasonCode)=>{
    const f=fixture(),intent=mixedIntent(),options={...defaultOptions,
      connectionToleranceMeters:kind==='recorded-tolerance'?2:defaultOptions.connectionToleranceMeters,barrierRouting:intent};
    f.state.hasReceipt=true;f.state.cables[0].routing='/SAVED' as never;f.state.cables[0].design_length='58' as never;
    f.state.metadata.set(id(1000),meta(0,{job_status:'complete',item_state:'complete',proposal_status:'calculated',proposal_id:id(30),proposal_hash:'f'.repeat(64)}));
    mocks.barrierCommon.mockRejectedValue(new PathFinderError(reasonCode,409));
    mocks.verified.mockResolvedValue({dependencies:{schemaVersion:'pathfinder.dependencies.v8',options}});
    mocks.accepted.mockImplementation(async(_cable,fresh)=>Boolean(await fresh(options,'pathfinder.dependencies.v8')));
    const detail=await f.repo.detail(projectId,who,id(1000),{barrierRouting:intent});
    expect(detail.row.cable).toMatchObject({routing:'/SAVED',designLength:'58',installLength:'123',cableWriteRevision:'7'});
    expect(detail.row.calculation).toMatchObject({outcome:'calculated',currentness:'unavailable',reviewable:false,acceptedMatchesCurrent:false,
      reasonCodes:expect.arrayContaining([reasonCode])});
    expect(detail.row.savedRoute).toBeUndefined();expect(detail.row.calculation.savedExactDisplay).toBeUndefined();
    expect(mocks.savedExactDisplay).not.toHaveBeenCalled();
    expect(mocks.barrierCommon).toHaveBeenCalledTimes(kind==='recorded-tolerance'?2:1);
    expect(f.query.mock.calls.every(([sql])=>!/\b(?:INSERT|UPDATE|DELETE)\b/i.test(sql))).toBe(true);
    const page=await f.repo.page(projectId,who,{barrierRouting:intent});
    expect(page.rows).toEqual([detail.row]);expect(classifyCableWorkflow(page.rows[0]).status).toBe('blocked');
  });
  it.each([
    new PathFinderError('BARRIER_STORAGE_BUSY',503),new PathFinderError('BARRIER_CALCULATION_DEADLINE',503),
    new PathFinderError('ADMIN_REQUIRED',403),new PathFinderError('LOGIN_REVOKED',401),
    new PathFinderError('BARRIER_BLOB_INTEGRITY',500),Object.assign(new Error('Unclassified I/O failure'),{code:'EIO'}),
  ])('does not disguise transient, authority or unexpected common-read failure as readable history (%s)',async error=>{
    const f=fixture();mocks.barrierCommon.mockRejectedValue(error);
    await expect(f.repo.detail(projectId,who,id(1000),{barrierRouting:mixedIntent()})).rejects.toBe(error);
    expect(mocks.reviewable).not.toHaveBeenCalled();expect(mocks.accepted).not.toHaveBeenCalled();
  });
  it.each(['legacy-lane','registry-generation','frame','drilling'] as const)('does not mark mixed preferences current after an exchanged %s',async field=>{
    const f=fixture(),intent=mixedIntent(),recorded=structuredClone(intent);
    let saved=recorded;
    if(field==='legacy-lane')saved=supportedBarrierAdmissionIntentSchema.parse({schemaVersion:'wfc.pf.barrier-admission-intent.v1',scope:recorded.scope,
      expectedRegistryRevision:recorded.expectedRegistryRevision,expectedSnapshot:recorded.expectedSnapshot?{snapshotId:recorded.expectedSnapshot.snapshotId,
        scope:recorded.expectedSnapshot.scope,registryRevision:recorded.expectedSnapshot.registryRevision,contentSha256:recorded.expectedSnapshot.contentSha256,mode:'explicit-empty'}:null,drillThroughWalls:false});
    if(field==='registry-generation'){recorded.expectedRegistryRevision='4';recorded.expectedSnapshot!.registryRevision='4';}
    if(field==='frame'){recorded.scope.captureFrameSha256='f'.repeat(64);recorded.expectedSnapshot!.scope.captureFrameSha256='f'.repeat(64);}
    if(field==='drilling')recorded.drillThroughWalls=true;
    f.state.metadata.set(id(1000),meta(0,{job_status:'complete',item_state:'complete',proposal_status:'calculated',proposal_id:id(30),proposal_hash:'f'.repeat(64)}));
    mocks.verified.mockResolvedValue({dependencies:{schemaVersion:'pathfinder.dependencies.v8',options:{...defaultOptions,barrierRouting:saved}}});
    const value=await f.repo.detail(projectId,who,id(1000),{barrierRouting:intent});
    expect(value.row.calculation).toMatchObject({currentness:'changed',reviewable:false});expect(mocks.reviewable.mock.calls[0][3]).toBeNull();
  });
  it('continues beyond200 checked nonmatches and finds the actual active cable on the next page', async () => {
    const f = fixture(201); for (let n = 0; n < 200; n++) f.state.metadata.set(id(1000 + n), meta(n, { item_state: 'blocked', item_status: 'locations_required' }));
    f.state.metadata.set(id(1200), meta(200));
    const first = await f.repo.page(projectId, who, { filter: 'calculating' });
    expect(first.rows).toEqual([]); expect(first.scannedCount).toBe(200); expect(first.nextCursor).not.toBeNull();
    const second = await f.repo.page(projectId, who, { filter: 'calculating', cursor: first.nextCursor });
    expect(second.rows.map(value => value.cable.id)).toEqual([id(1200)]); expect(second.nextCursor).toBeNull(); expect(second.scannedCount).toBe(1);
  });
  it('stops at the requested match without consuming a later match, including limit1', async () => {
    const f = fixture(3), first = await f.repo.page(projectId, who, { filter: 'all', limit: 1 });
    expect(first.scannedCount).toBe(1); expect(first.scannedThroughCableId).toBe(id(1000)); expect(first.rows).toHaveLength(1);
    const second = await f.repo.page(projectId, who, { filter: 'all', limit: 1, cursor: first.nextCursor });
    expect(second.rows[0].cable.id).toBe(id(1001));
  });
  it('uses exact literal Unicode matching without SQL wildcard interpretation', async () => {
    const f = fixture(3); f.state.cables[1].tag = 'cafe\u0301_%\\';
    const result = await f.repo.page(projectId, who, { filter: 'all', search: '  CAFÉ_%\\  ' });
    expect(result.rows.map(value => value.cable.id)).toEqual([id(1001)]); expect(result.scannedCount).toBe(3);
    expect(f.query.mock.calls.find(([sql]) => sql.includes('cable-workflow:candidates'))?.[0]).not.toMatch(/LIKE|ILIKE/);
  });
  it('finds a literal ASCII target beyond the first400 project rows in the first bounded page', async () => {
    const f = fixture(405); f.state.cables[404].tag = 'Last_%\\target';
    const result = await f.repo.page(projectId, who, { filter: 'all', search: '_%\\TARGET' });
    expect(result.rows.map(value => value.cable.id)).toEqual([id(1404)]);
    expect(result.scannedCount).toBe(1); expect(result.nextCursor).toBeNull();
    expect(f.query.mock.calls.find(([sql]) => sql.includes('cable-workflow:candidates'))?.[1])
      .toEqual([projectId, null, null, '_%\\TARGET']);
  });
  it.each([['Straße', 'strasse', 'STRASSE'], ['\u212aelvin', 'kelvin', 'KELVIN'], ['cafe\u0301', 'CAFÉ', null]] as const)
    ('retains exact Unicode matching for %s without a lossy SQL uppercase comparison', async (tag, search, sqlNeedle) => {
      const f = fixture(3); f.state.cables[1].tag = tag;
      const result = await f.repo.page(projectId, who, { filter: 'all', search });
      expect(result.rows.map(value => value.cable.id)).toEqual([id(1001)]);
      const candidateQuery = f.query.mock.calls.find(([sql]) => sql.includes('cable-workflow:candidates'))!;
      expect(candidateQuery[1]?.[3]).toBe(sqlNeedle);
      expect(candidateQuery[0]).toContain('COLLATE "C" ~ \'[^ -~]\'');
    });
  it('never filters away an oversized nonmatching candidate before its existing refusal', async () => {
    const f = fixture(2); f.state.cables[0].input_oversize = true;
    await expect(f.repo.page(projectId, who, { search: 'NO-MATCH' })).rejects.toMatchObject({ code: 'WORKFLOW_CABLE_INPUT_LIMIT' });
  });
  it('rejects query/context/account cursor changes, excessive history and nonadvancing scan rows', async () => {
    const f = fixture(2), first = await f.repo.page(projectId, who, { filter: 'all', limit: 1 });
    await expect(f.repo.page(projectId, who, { filter: 'all', limit: 2, cursor: first.nextCursor })).rejects.toMatchObject({ code: 'WORKFLOW_CURSOR_INVALID' });
    f.state.admissionCount++; await expect(f.repo.page(projectId, who, { filter: 'all', limit: 1, cursor: first.nextCursor })).rejects.toMatchObject({ code: 'WORKFLOW_CURSOR_INVALID' });
    f.state.admissionCount = 10001; await expect(f.repo.page(projectId, who, {})).rejects.toMatchObject({ code: 'WORKFLOW_ADMISSION_LIMIT', status: 413 });
    f.state.admissionCount = 1; f.state.badScan = true; await expect(f.repo.page(projectId, who, {})).rejects.toMatchObject({ code: 'WORKFLOW_SCAN_INTEGRITY' });
  });
  it('preserves newest waiting/blocked admission evidence rather than falling back to an older success', async () => {
    const f = fixture(2); f.state.aliases = false;
    f.state.metadata.set(id(1000), meta(0, { item_state: 'blocked', item_status: 'locations_required' })); f.state.metadata.set(id(1001), meta(1));
    const result = await f.repo.page(projectId, who, { filter: 'all' });
    expect(classifyCableWorkflow(result.rows[0]).status).toBe('needs-routing'); expect(result.rows[0].from.status).toBe('missing');
    expect(classifyCableWorkflow(result.rows[1]).status).toBe('calculating'); expect(mocks.verified).not.toHaveBeenCalled();
    const sql = f.query.mock.calls.find(([text]) => text.includes('cable-workflow:latest-admissions'))![0];
    expect(sql).toContain('ORDER BY b.cable_id,a.created_at DESC,a.id DESC'); expect(sql).not.toContain("p.status='calculated'");
  });
  it.each(['waiting', 'running'] as const)('retains actual %s item state while current model/settings becomes unavailable', async itemState => {
    const f = fixture(); f.state.metadata.set(id(1000), meta(0, { item_state: itemState }));
    f.state.common = { ...common(), inputs: null, bindingContext: null, status: 'settings_required', message: '' } as unknown as ReturnType<typeof common>;
    const result = await f.repo.page(projectId, who, { filter: 'all' });
    expect(result.rows[0].calculation).toMatchObject({ itemState, outcome: 'not-evaluated', reasonCodes: ['SETTINGS_REQUIRED'] });
    expect(classifyCableWorkflow(result.rows[0]).status).toBe('calculating');
  });
  it('marks a previous routing preparation blocker historical only after fresh authoritative admission succeeds', async () => {
    const f = fixture(), previous = meta(0, { job_status: 'complete', item_state: 'blocked', item_status: 'routing_preparation_required' });
    f.state.metadata.set(id(1000), previous);
    const retained = structuredClone(previous);
    const detail = await f.repo.detail(projectId, who, id(1000), {});
    expect(detail.row.calculation).toMatchObject({ jobId: id(11), jobStatus: 'complete', itemState: 'blocked', outcome: 'stale',
      currentness: 'changed', reasonCodes: ['ROUTING_PREPARATION_REQUIRED', 'ROUTING_PREPARATION_UPDATED'], errorCode: null,
      proposalId: null, proposalHash: null, reviewable: false, acceptedMatchesCurrent: false });
    expect(classifyCableWorkflow(detail.row).status).toBe('needs-routing');
    const page = await f.repo.page(projectId, who, { filter: 'needs-routing' });
    expect(page.rows).toHaveLength(1); expect(page.rows[0].calculation).toEqual(detail.row.calculation);
    expect(mocks.common).toHaveBeenCalled();
    expect(mocks.verified).not.toHaveBeenCalled(); expect(mocks.reviewable).not.toHaveBeenCalled(); expect(mocks.accepted).not.toHaveBeenCalled();
    expect(f.state.metadata.get(id(1000))).toEqual(retained);
    expect(f.query.mock.calls.every(([sql]) => !/^\s*(?:INSERT|UPDATE|DELETE)\b/i.test(sql))).toBe(true);
  });
  it.each(['routing_preparation_required', 'model_unavailable', 'settings_required'])(
    'keeps the previous routing blocker unverified when fresh admission is %s', async currentStatus => {
      const f = fixture();
      f.state.metadata.set(id(1000), meta(0, { job_status: 'complete', item_state: 'blocked', item_status: 'routing_preparation_required' }));
      f.state.common = { ...common(), inputs: null, bindingContext: null, status: currentStatus, message: '' } as unknown as ReturnType<typeof common>;
      const detail = await f.repo.detail(projectId, who, id(1000), {});
      expect(detail.row.calculation).toMatchObject({ outcome: 'model-required', currentness: 'unavailable', reviewable: false, acceptedMatchesCurrent: false });
      expect(detail.row.calculation.reasonCodes).toContain(currentStatus.toUpperCase());
      expect(detail.row.calculation.reasonCodes).not.toContain('ROUTING_PREPARATION_UPDATED');
      expect(classifyCableWorkflow(detail.row).status).toBe('blocked');
    },
  );
  it.each([
    { job_status: 'queued', item_state: 'waiting' }, { job_status: 'running', item_state: 'running' },
    { job_status: 'running', item_state: 'blocked' }, { job_status: 'failed', item_state: 'blocked' },
    { job_status: 'cancelled', item_state: 'blocked' }, { job_status: 'complete', item_state: 'blocked', cancel_requested: true },
    { job_status: 'complete', item_state: 'complete' },
    { job_status: 'complete', item_state: 'blocked', proposal_id: id(30), proposal_hash: 'f'.repeat(64), proposal_status: 'failed' },
  ])('does not reinterpret active, failed, cancelled or proposal-backed attempts (%j)', async patch => {
    const f = fixture(); f.state.metadata.set(id(1000), meta(0, { item_status: 'routing_preparation_required', ...patch }));
    const detail = await f.repo.detail(projectId, who, id(1000), {});
    expect(detail.row.calculation.reasonCodes).not.toContain('ROUTING_PREPARATION_UPDATED');
    expect(detail.row.calculation.currentness).toBe('unavailable');
    expect(detail.row.calculation.outcome).not.toBe('stale');
    expect(detail.row.calculation.reviewable).toBe(false); expect(detail.row.calculation.acceptedMatchesCurrent).toBe(false);
  });
  it.each(['settings_required', 'resource_limit', 'deadline_exceeded', 'no_path', 'failed', 'endpoint_preparation_required'])(
    'keeps another completed blocker unchanged after the network is ready (%s)', async itemStatus => {
      const f = fixture(); f.state.metadata.set(id(1000), meta(0, { job_status: 'complete', item_state: 'blocked', item_status: itemStatus }));
      const detail = await f.repo.detail(projectId, who, id(1000), {});
      expect(detail.row.calculation.reasonCodes).not.toContain('ROUTING_PREPARATION_UPDATED');
      expect(detail.row.calculation.reasonCodes).toContain(itemStatus.toUpperCase());
      expect(detail.row.calculation.currentness).toBe('unavailable');
      expect(detail.row.calculation.outcome).not.toBe('stale');
    },
  );
  it('retains blocked settings and resource/deadline outcome reasons without inventing an error code from free text', async () => {
    const f = fixture(3);
    for (const [n, status] of ['settings_required', 'resource_limit', 'deadline_exceeded'].entries())
      f.state.metadata.set(id(1000 + n), meta(n, { item_state: 'blocked', item_status: status }));
    const result = await f.repo.page(projectId, who, { filter: 'all' });
    expect(result.rows.map(value => value.calculation.outcome)).toEqual(['settings-required', 'resource-limit', 'deadline-exceeded']);
    expect(result.rows.every(value => value.calculation.errorCode === null && value.calculation.reasonCodes.length > 0)).toBe(true);
  });
  it('uses positive proof and current preferences, preserving incomplete-job review gates and one common context read', async () => {
    const f = fixture(2);
    for (let n = 0; n < 2; n++) f.state.metadata.set(id(1000 + n), meta(n, { job_status: 'complete', item_state: 'complete', proposal_status: 'calculated', proposal_id: id(30 + n), proposal_hash: 'f'.repeat(64) }));
    const result = await f.repo.page(projectId, who, { filter: 'ready-for-review' });
    expect(result.rows).toHaveLength(2); expect(mocks.common).toHaveBeenCalledTimes(1);
    f.state.allowReview = false; f.state.metadata.get(id(1000))!.job_status = 'running';
    const changed = await f.repo.detail(projectId, who, id(1000), {});
    expect(classifyCableWorkflow(changed.row)).toEqual({ status: 'blocked', reasonCodes: ['CALCULATED_AWAITING_JOB_COMPLETION'] });
    mocks.verified.mockResolvedValue({ dependencies: { options: { ...defaultOptions, secondaryDistanceMeters: 99 } } });
    const mismatch = await f.repo.detail(projectId, who, id(1000), {}); expect(mismatch.row.calculation.currentness).toBe('changed');
  });
  it('only asks for receipt proof when the latest receipt and exact displayed proposal tuple exist', async () => {
    const f = fixture(); await f.repo.page(projectId, who, {}); expect(mocks.accepted).not.toHaveBeenCalled();
    f.state.hasReceipt = true; mocks.accepted.mockResolvedValue(true); f.state.cables[0].routing = '/SYNTHETIC' as never; f.state.cables[0].design_length = '12' as never;
    f.state.metadata.set(id(1000),meta(0,{job_status:'complete',item_state:'complete',proposal_status:'calculated',proposal_id:id(30),proposal_hash:'f'.repeat(64)}));
    const result = await f.repo.page(projectId, who, { filter: 'up-to-date' });
    expect(mocks.accepted).toHaveBeenCalledTimes(1); expect(result.rows[0].calculation.acceptedMatchesCurrent).toBe(true);
    expect(mocks.accepted).toHaveBeenCalledWith(expect.objectContaining({id:id(1000)}),expect.any(Function),{jobId:id(11),proposalId:id(30),proposalHash:'f'.repeat(64)});
  });
  it('reports automatic write progress from the exact latest admission without calling it an accepted result',async()=>{
    const f=fixture();f.state.metadata.set(id(1000),meta(0,{job_status:'complete',item_state:'complete',proposal_status:'calculated',proposal_id:id(30),proposal_hash:'f'.repeat(64),
      automatic_update_status:'pending',automatic_update_receipt:null,automatic_update_reason:null}));
    const detail=await f.repo.detail(projectId,who,id(1000),{});
    expect(detail.row.calculation.automaticUpdate).toEqual({status:'pending',receiptId:null,reasonCode:null});
    expect(detail.row.calculation.acceptedMatchesCurrent).toBe(false);
    expect(f.query.mock.calls.some(([sql])=>sql.includes('LEFT JOIN pf_automatic_pair_dispatch d ON d.project_id=a.project_id AND d.job_id=a.job_id AND d.cable_id=b.cable_id'))).toBe(true);
  });
  it.each(['missing-admission','waiting-without-proposal','missing-hash'] as const)('does not let an older receipt mark %s current',async kind=>{
    const f=fixture();f.state.hasReceipt=true;mocks.accepted.mockResolvedValue(true);
    if(kind!=='missing-admission')f.state.metadata.set(id(1000),meta(0,kind==='missing-hash'?{job_status:'complete',item_state:'complete',proposal_status:'calculated',proposal_id:id(30)}:{}));
    if(kind==='missing-hash'){
      await expect(f.repo.detail(projectId,who,id(1000),{})).rejects.toThrow('Job and proposal references must retain their exact identities.');
      expect(mocks.accepted).not.toHaveBeenCalled();return;
    }
    const value=await f.repo.detail(projectId,who,id(1000),{});
    expect(mocks.accepted).not.toHaveBeenCalled();expect(value.row.calculation.acceptedMatchesCurrent).toBe(false);
  });
  it('excludes MV, keeps optional MTO values eligible and refuses oversized fields before projection', async () => {
    const f = fixture(3); f.state.cables[0].mto = 'MV'; f.state.cables[1].mto = 'Unknown';
    const result = await f.repo.page(projectId, who, { filter: 'all' });
    expect(result.rows.map(value => value.cable.id)).toEqual([id(1001), id(1002)]); expect(classifyCableWorkflow(result.rows[0]).status).toBe('needs-routing');
    f.state.cables[1].input_oversize = true; await expect(f.repo.page(projectId, who, {})).rejects.toMatchObject({ code: 'WORKFLOW_CABLE_INPUT_LIMIT' });
    const sql = f.query.mock.calls.find(([text]) => text.includes('cable-workflow:candidates'))![0]; expect(sql).toContain('CASE WHEN octet_length'); expect(sql).toContain('LIMIT 201');
  });
  it('requires exact current-project detail ownership and uses the same read-only boundary for every request', async () => {
    const f = fixture(), result = await f.repo.detail(projectId, who, id(1000), {});
    expect(result.cableId).toBe(id(1000)); expect(result.row.projectId).toBe(projectId);
    await expect(f.repo.detail(projectId, who, id(9999), {})).rejects.toMatchObject({ code: 'CABLE_NOT_FOUND' });
    expect(mocks.tx).toHaveBeenCalledTimes(2); expect(f.query.mock.calls.every(([sql]) => /^\s*(?:\/\*[\s\S]*?\*\/\s*)?SELECT\b/i.test(sql))).toBe(true);
  });
});
