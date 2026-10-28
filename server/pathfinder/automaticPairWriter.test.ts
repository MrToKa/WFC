// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import type { Pool, PoolClient } from 'pg';
import { AUTOMATIC_PAIR_POLICY, automaticPairMandateHashInput, automaticPairProvenanceSchema, automaticPairCapacityClearProvenanceSchema, type AutomaticPairMandate } from '../../shared/pathfinderAutomaticPair.js';
import { syntheticBarrierWriteInputs } from './barrierWriteFixtures.js';
import { automaticPairHash } from './automaticPairReceiptProof.js';
import { automaticPairIdempotencyKey, createAutomaticPairWriter } from './automaticPairWriter.js';
import { schedulerTransaction } from './schedulerTransaction.js';
import { createVerifiedSameEndpointReuse, type VerifiedSameEndpointReuse } from './verifiedSameEndpointReuse.js';
import { buildCableEngineRequest } from './worker.js';
import type { BarrierCommonCalculationCollection } from './dependencies.js';
import { automaticPairFailureOutcome } from './automaticPairProducer.js';
import type { readCurrentPositiveCapacity } from './capacityClearWrite.js';

type Row = Record<string, any>;
function fixture(options:{reuse?:VerifiedSameEndpointReuse;cableId?:string;capacityClear?:boolean;positiveCapacity?:boolean}={}) {
  const { dependencies, result, id } = syntheticBarrierWriteInputs();
  if(options.cableId)dependencies.cableId=options.cableId;
  if(options.capacityClear||options.positiveCapacity)
    dependencies.settings.trayCapacity={enabled:true,minimumFreeSpacePercent:30,tolerancePercentagePoints:3,layoutSha256:'c'.repeat(64)};
  if(options.capacityClear){
    Object.assign(result,{status:'no_path',message:'No capacity-compliant alternative.',trayCapacity:{schemaVersion:'wfc.pf.tray-capacity-diagnostics.v1',
      minimumFreeSpacePercent:30,effectiveMinimumFreeSpacePercent:27,tolerancePercentagePoints:3,occupancySha256:'f'.repeat(64),groupCableCount:1,
      blockedRouteCodes:['/A'],unavailableRouteCodes:[],trays:[{routeCode:'/A',freeSpacePercent:20,status:'below-minimum'}],outcome:'no-capacity',attempts:2,excludedRouteCodes:['/A']}});
    delete result.route;delete result.design;delete result.lengthLedger;
    if(result.schemaVersion==='pathfinder.model.response.v3')Object.assign(result.barriers,{proof:null,qualification:null,directSecondary:null,
      connectors:{from:null,to:null},diagnostics:{...result.barriers.diagnostics,status:'blocked'}});
  }
  const now = Date.now(), historyId = id(81), projectId = dependencies.projectId, cableId = dependencies.cableId, jobId = id(4), actorId = id(13);
  const baseline: Row = { id: cableId, project_id: projectId, cable_id: 1, mto: 'LV', from_location: 'FROM', to_location: 'TO', cable_type_id: id(17),
    routing: '/OLD', design_length: '10', install_length: '99', cable_write_revision: '7', revision: '1', tag: 'Cable', delivery: null,
    pull_date: null, connected_from: null, connected_to: null, tested: null, updated_at: new Date(now - 1000).toISOString() };
  const owned = { kind: 'automatic' as const, originReceiptId: id(60), previousReceiptId: id(60), previousReceiptSha256: 'a'.repeat(64), afterCableWriteRevision: '7', history: { id: id(61), version: '3' } };
  const draft: AutomaticPairMandate = { schemaVersion: 'wfc.pf.automatic-pair-mandate.v1', id: id(5), projectId, jobId, cableId, actorId,
    actorAdminRevision: '2', loginId: id(14), loginExpiresAt: new Date(now + 60000).toISOString(), authorityExpiresAt: new Date(now + 30000).toISOString(),
    installationEpoch: id(15), createdAt: new Date(now - 500).toISOString(), policy: AUTOMATIC_PAIR_POLICY, source: { kind: 'explicit-job' },
    requestSha256: 'b'.repeat(64), dependencyHash: automaticPairHash(dependencies), cableWriteRevision: '7', baselineSha256: automaticPairHash(baseline), ownership: owned, contentSha256: '0'.repeat(64) };
  const mandate = { ...draft, contentSha256: automaticPairHash(automaticPairMandateHashInput(draft)) };
  const p: Row = { id: id(3), job_id: jobId, cable_id: cableId, proposal_hash: 'c'.repeat(64), dependency_hash: automaticPairHash(dependencies), status: options.capacityClear?'no_path':'calculated', dependencies, result,
    job_state: 'complete', cancel_requested: false, request_hash: mandate.requestSha256, item_state: 'complete', item_status: options.capacityClear?'no_path':'calculated' };
  const seal: Row = { projectId, cableId, jobId, admissionId: id(21), revisionResultSha256: 'd'.repeat(64), baselineHash: 'e'.repeat(64),
    engineResultSha256: automaticPairHash(result), ledgerHash: options.capacityClear?null:automaticPairHash(result.lengthLedger), dependencyHash: automaticPairHash(dependencies) };
  const state = { cable: structuredClone(baseline), receipts: [] as Row[], history: [] as Row[], commits: 0, writes: 0, lostAck: false, mutate: null as ((value: Row) => void) | null,
    historyFailed: false, receiptFailed: false, casMiss: false, admin: true,
    recovery: { status: 'unknown', attempts: 3, owner_token: null as string | null, lease_until: null as string | null } };
  let backup: Pick<typeof state, 'cable' | 'receipts' | 'history'> | null = null;
  const query = vi.fn(async (sql: string, args: any[] = []) => {
    if (sql === 'BEGIN') { backup = structuredClone({ cable: state.cable, receipts: state.receipts, history: state.history }); return { rows: [] }; }
    if (sql === 'COMMIT') { state.commits++; backup = null; if (state.lostAck && state.commits === 2) throw Error('Lost acknowledgement after durability'); return { rows: [] }; }
    if (sql === 'ROLLBACK') { if (backup) Object.assign(state, backup); backup = null; return { rows: [] }; }
    if (sql.startsWith('SET LOCAL') || sql.startsWith('SELECT set_config') || sql.startsWith('INSERT INTO viewer_login_bindings')) return { rows: [] };
    if (sql.startsWith('SELECT id FROM projects')) return { rows: [{ id: projectId }] };
    if (sql.startsWith('SELECT is_admin FROM users')) return { rows: [{ is_admin: state.admin }] };
    if (sql.startsWith('SELECT user_id,expires_at')) return { rows: [{ user_id: actorId, expires_at: mandate.loginExpiresAt, revoked_at: null }] };
    if (sql.includes('automatic-pair:mandate')) return { rows: [{ project_id: projectId, job_id: jobId, cable_id: cableId, id: mandate.id, actor_id: actorId,
      login_id: mandate.loginId, record_sha256: mandate.contentSha256, record: mandate }] };
    if (sql.includes('automatic-pair:result')) return { rows: [p] };
    if (sql.includes('automatic-pair:recovery-fence')) return { rows: [state.recovery] };
    if (sql.includes('existing-receipt')) return { rows: state.receipts.filter(r => r.idempotency_key === args[2]) };
    if (sql.includes('write-baseline')) return { rows: [{ value: structuredClone(state.cable) }] };
    if (sql.includes('automatic-pair:write */')) {
      state.writes++; if (state.casMiss) return { rows: [] };
      state.cable = { ...state.cable, routing: args[2], design_length: args[3], cable_write_revision: (BigInt(state.cable.cable_write_revision) + 1n).toString(), updated_at: new Date().toISOString() };
      state.mutate?.(state.cable); return { rows: [{ value: structuredClone(state.cable) }] };
    }
    if (sql.includes('write-history')) return { rows: state.history };
    if (sql.startsWith('INSERT INTO pf_apply_receipts')) {
      if (state.receiptFailed) throw Error('Receipt write failed'); state.receipts.push({ id: args[0], project_id: args[1], actor_id: args[2], idempotency_key: args[3], payload_hash: args[4],
        proposal_id: args[5], cable_id: args[6], before_snapshot: args[7], after_snapshot: args[8], provenance: args[9] }); return { rows: [] };
    }
    throw Error(sql);
  });
  const release = vi.fn(), pool = { connect: vi.fn(async () => ({ query, release })) } as unknown as Pool;
  const collect = vi.fn(async () => ({ dependencies, cable: { cable_write_revision: '7' } })), ownership = vi.fn(async () => owned), mandateFence = vi.fn(async () => mandate),
    barrierFence = vi.fn(async () => dependencies.engineIdentity), snapshot = vi.fn(async () => ({})), proof = vi.fn(async () => ({ receiptId: state.receipts[0]?.id })),
    applicability = vi.fn(async () => ({ applicable: true })), fence = vi.fn(async () => undefined), history = vi.fn(async () => {
      if (state.historyFailed) throw Error('History write failed'); state.history.push({ ...state.cable, id: historyId, change_source: 'pathfinder', changed_by: actorId, cable_number: 1 });
      return { id: historyId, versionNumber: '4' };
    });
  const capacityEvidence = vi.fn(async()=>{const {outcome:_outcome,attempts:_attempts,excludedRouteCodes:_excluded,...checked}=result.trayCapacity!;
    return {schemaVersion:'wfc.pf.capacity-clear-evidence.v1' as const,projectId,cableId,dependencySha256:automaticPairHash(dependencies),engineResultSha256:automaticPairHash(result),verifiedExclusions:checked};});
  const clearApplicability=vi.fn(async()=>true);
  const currentPositiveCapacity=vi.fn<typeof readCurrentPositiveCapacity>(async()=>true);
  const writer = createAutomaticPairWriter(pool, { collect: collect as any, ownership, mandateFence, barrierFence, snapshot: snapshot as any,capacityEvidence,clearApplicability,currentPositiveCapacity,
    seal: vi.fn(async () => seal) as any, applicability: applicability as any, history, proof: proof as any,
    ...(options.reuse?{verifiedCurrent:(client,deps,result,signal)=>options.reuse!.current(client,deps,undefined,result,signal)}:{}) });
  const claim = { projectId, jobId, cableId, ownerToken: id(90), leaseExpiresAt: new Date(now + 60000).toISOString() };
  return { state, baseline, mandate, p, seal, dependencies, result, owned, collect, ownership, mandateFence, barrierFence, snapshot, proof, applicability, fence, history, query, release,
    capacityEvidence,clearApplicability,currentPositiveCapacity,client:{query} as unknown as PoolClient,run: () => writer.apply(claim, fence), inspect: () => schedulerTransaction(pool, client => writer.inspectInTransaction(client, claim)) };
}
describe('automatic pair exact sealed write with transactional synthetic SQL', () => {
  it.each(['empty','automatic'] as const)('writes %s pairs from a new automatic-generation source while the batch is still running',async kind=>{
    const f=fixture(),m=f.mandate;
    if(kind==='empty'){
      Object.assign(f.baseline,{routing:null,design_length:null});Object.assign(f.state.cable,{routing:null,design_length:null});
      m.ownership={kind:'empty'};f.ownership.mockResolvedValue({kind:'empty'} as never);m.baselineSha256=automaticPairHash(f.baseline);
    }
    m.source={kind:'automatic-generation',generation:'2',controlRevision:'1',authorityEpoch:'1',authorization:{schemaVersion:'wfc.pf.automatic-generation-output-authority.v1',
      projectId:m.projectId,actorId:m.actorId,actorAdminRevision:m.actorAdminRevision,loginId:m.loginId,loginExpiresAt:m.loginExpiresAt,installationEpoch:m.installationEpoch,
      commandKey:m.id,commandSha256:'a'.repeat(64),controlRevision:'1',authorityEpoch:'1',createdAt:m.createdAt,authorityExpiresAt:m.authorityExpiresAt,policy:AUTOMATIC_PAIR_POLICY}};
    m.contentSha256=automaticPairHash(automaticPairMandateHashInput(m));f.p.job_state='running';
    expect(await f.run()).toMatchObject({status:'written'});
    expect(f.state.cable).toMatchObject({routing:'/A',design_length:'7',install_length:'99'});
    expect(automaticPairProvenanceSchema.parse(f.state.receipts[0].provenance).mandate.source).toEqual(m.source);
  });
  it('refuses a successful frozen-ON route if another cable has filled its trays before the writer acquires the lock',async()=>{
    const f=fixture({positiveCapacity:true});f.currentPositiveCapacity.mockResolvedValue(false);
    expect(await f.run()).toEqual({status:'refused',receiptId:null,code:'AUTOMATIC_PAIR_CAPACITY_CHANGED'});
    expect(f.currentPositiveCapacity).toHaveBeenCalledOnce();
    expect(f.currentPositiveCapacity.mock.calls[0][1]).toEqual({dependencies:f.dependencies,result:f.result,jobId:f.p.job_id});
    expect(f.state.cable).toEqual(f.baseline);expect(f.state.writes).toBe(0);expect(f.state.receipts).toHaveLength(0);expect(f.state.history).toHaveLength(0);
  });
  it('rolls back pair, audit and receipt if positive ON placement changes at the final fence, with a known refused disposition',async()=>{
    const f=fixture({positiveCapacity:true});f.currentPositiveCapacity.mockResolvedValueOnce(true).mockResolvedValue(false);
    const error=await f.run().then(()=>null,error=>error);
    expect(error).toMatchObject({code:'AUTOMATIC_PAIR_CAPACITY_CHANGED'});
    expect(automaticPairFailureOutcome(error,false)).toEqual({status:'refused',receiptId:null,code:'AUTOMATIC_PAIR_CAPACITY_CHANGED'});
    expect(f.currentPositiveCapacity).toHaveBeenCalledTimes(2);expect(f.state.writes).toBe(1);
    expect(f.state.cable).toEqual(f.baseline);expect(f.state.receipts).toHaveLength(0);expect(f.state.history).toHaveLength(0);
  });
  it('checks successful ON placement before and after writing without changing the normal receipt or geometry checks',async()=>{
    const f=fixture({positiveCapacity:true});expect(await f.run()).toMatchObject({status:'written'});
    expect(f.currentPositiveCapacity).toHaveBeenCalledTimes(2);expect(f.capacityEvidence).not.toHaveBeenCalled();
    expect(f.state.cable).toMatchObject({routing:'/A',design_length:'7',install_length:'99'});
    expect(automaticPairProvenanceSchema.parse(f.state.receipts[0].provenance).schemaVersion).toBe('pathfinder.automatic-pair.v1');
    expect(f.barrierFence).toHaveBeenCalledTimes(2);expect(f.snapshot).toHaveBeenCalledOnce();
  });
  it('keeps checkbox-OFF routing eligible and manual pairs protected without a positive capacity probe',async()=>{
    const off=fixture();off.currentPositiveCapacity.mockResolvedValue(false);expect(await off.run()).toMatchObject({status:'written'});
    expect(off.currentPositiveCapacity).not.toHaveBeenCalled();
    const manual=fixture({positiveCapacity:true});manual.ownership.mockResolvedValue({kind:'review-required',reasonCode:'MANUAL'} as never);
    expect(await manual.run()).toMatchObject({status:'review-required'});expect(manual.currentPositiveCapacity).not.toHaveBeenCalled();
    expect(manual.state.cable).toEqual(manual.baseline);expect(manual.state.writes).toBe(0);
  });
  it('withdraws only an exact automatic pair after a sealed capacity no-path and keeps installed length',async()=>{
    const f=fixture({capacityClear:true});expect(await f.run()).toMatchObject({status:'written'});
    expect(f.state.cable).toMatchObject({routing:null,design_length:null,install_length:'99',cable_write_revision:'8'});
    const provenance=automaticPairCapacityClearProvenanceSchema.parse(f.state.receipts[0].provenance);
    expect(provenance.revisionResult.ledgerHash).toBeNull();expect(provenance).not.toHaveProperty('barrierEvidence');
    expect(f.state.history).toHaveLength(1);expect(f.capacityEvidence).toHaveBeenCalledTimes(2);expect(f.applicability).not.toHaveBeenCalled();expect(f.currentPositiveCapacity).not.toHaveBeenCalled();
    expect(await f.run()).toMatchObject({status:'already-written'});expect(f.state.writes).toBe(1);
  });
  it('preserves manual pairs and does not record a no-path write for an already empty pair',async()=>{
    const manual=fixture({capacityClear:true});manual.ownership.mockResolvedValue({kind:'review-required',reasonCode:'MANUAL'} as never);
    expect(await manual.run()).toMatchObject({status:'review-required'});expect(manual.state.cable).toEqual(manual.baseline);expect(manual.state.writes).toBe(0);
    const empty=fixture({capacityClear:true});empty.mandate.ownership={kind:'empty'};empty.ownership.mockResolvedValue({kind:'empty'} as never);
    Object.assign(empty.baseline,{routing:null,design_length:null});Object.assign(empty.state.cable,{routing:null,design_length:null});
    empty.mandate.baselineSha256=automaticPairHash(empty.baseline);empty.mandate.contentSha256=automaticPairHash(automaticPairMandateHashInput(empty.mandate));
    expect(await empty.run()).toMatchObject({status:'refused',code:'AUTOMATIC_PAIR_EMPTY_NO_PATH'});expect(empty.state.writes).toBe(0);expect(empty.state.receipts).toHaveLength(0);
  });
  it.each(['cancelled','generic no path','changed occupancy','unsealed','inapplicable'] as const)('never clears after %s',async kind=>{
    const f=fixture({capacityClear:true});if(kind==='cancelled')f.p.cancel_requested=true;
    if(kind==='generic no path')delete f.result.trayCapacity;
    if(kind==='changed occupancy')f.capacityEvidence.mockResolvedValue(null as never);
    if(kind==='unsealed')f.seal.ledgerHash='a'.repeat(64);
    if(kind==='inapplicable')f.clearApplicability.mockResolvedValue(false);
    if(kind==='changed occupancy')expect(await f.run()).toMatchObject({status:'stale'});else await expect(f.run()).rejects.toBeDefined();
    expect(f.state.cable).toEqual(f.baseline);expect(f.state.writes).toBe(0);expect(f.state.receipts).toHaveLength(0);
  });
  it('rolls back a capacity clear whose occupancy changes at the final commit fence',async()=>{
    const f=fixture({capacityClear:true}),original=f.capacityEvidence.getMockImplementation()!;f.capacityEvidence.mockImplementationOnce(original).mockResolvedValue(null as never);
    await expect(f.run()).rejects.toMatchObject({code:'AUTOMATIC_PAIR_CAPACITY_CHANGED'});expect(f.state.cable).toEqual(f.baseline);expect(f.state.receipts).toHaveLength(0);
  });
  it.each(['administrator revoked','mandate expired','dependency changed','installed length write','receipt write'] as const)('protects a capacity clear when %s',async kind=>{
    const f=fixture({capacityClear:true});if(kind==='administrator revoked')f.state.admin=false;
    if(kind==='mandate expired')f.mandateFence.mockRejectedValue(Object.assign(Error('Expired'),{code:'AUTOMATIC_PAIR_AUTHORITY_EXPIRED'}));
    if(kind==='dependency changed')f.collect.mockResolvedValue({dependencies:{...f.dependencies,cableWriteRevision:'9'},cable:{cable_write_revision:'9'}});
    if(kind==='installed length write')f.state.mutate=after=>{after.install_length='0';};if(kind==='receipt write')f.state.receiptFailed=true;
    if(kind==='dependency changed')expect(await f.run()).toMatchObject({status:'stale'});else await expect(f.run()).rejects.toBeDefined();
    expect(f.state.cable).toEqual(f.baseline);expect(f.state.receipts).toHaveLength(0);expect(f.state.history).toHaveLength(0);
  });
  async function replicas(count=1){
    const metadata=vi.fn(async()=>({fingerprint:'source-confirmed',common:{inputs:{},status:'ready',bindingContext:{}} as BarrierCommonCalculationCollection}));
    const projected=new Map<string,ReturnType<typeof fixture>>();
    const project=vi.fn(async(_client:PoolClient,_project:string,cableId:string)=>{
      const target=projected.get(cableId)!;return{status:'ready',message:'',dependencies:target.dependencies,cable:structuredClone(target.state.cable)};
    });
    const reuse=createVerifiedSameEndpointReuse({request:buildCableEngineRequest,readMetadata:metadata,collect:project});
    const source=syntheticBarrierWriteInputs(),{calculationMode:_mode,...response}=source.result;
    const targets=Array.from({length:count},(_,at)=>fixture({reuse,cableId:source.id(200+at)}));
    targets.forEach(target=>projected.set(target.dependencies.cableId,target));
    const request=buildCableEngineRequest(source.dependencies,response.requestId,60000);
    const prepared=await reuse.prepareSource(targets[0].client,source.dependencies,request,response);expect(prepared).not.toBeNull();reuse.commitSource(prepared!);
    metadata.mockClear();return{targets,reuse,metadata,project};
  }
  it('writes thirteen replica pairs from one confirmed source with independent receipts and no geometry/snapshot reads',async()=>{
    const f=await replicas(13);
    for(const target of f.targets){
      expect(await target.run()).toMatchObject({status:'written'});expect(target.state.cable).toMatchObject({routing:'/A',design_length:'7',cable_write_revision:'8'});
      expect(target.state.receipts).toHaveLength(1);expect(target.state.history).toHaveLength(1);
      expect(target.collect).not.toHaveBeenCalled();expect(target.barrierFence).not.toHaveBeenCalled();expect(target.snapshot).not.toHaveBeenCalled();
      expect(target.ownership).toHaveBeenCalledOnce();expect(target.mandateFence).toHaveBeenCalledTimes(3);
      expect(target.state.receipts[0].provenance.dependencies.cableId).toBe(target.dependencies.cableId);
    }
    expect(f.project).toHaveBeenCalledTimes(13);expect(f.metadata).toHaveBeenCalledTimes(39);
    expect(new Set(f.targets.map(target=>target.state.receipts[0].id)).size).toBe(13);
  });
  it.each(['before write','after receipt'] as const)('rolls back a replica whose confirmed common metadata changes %s',async phase=>{
    const f=await replicas(),target=f.targets[0];let reads=0;
    f.metadata.mockImplementation(async()=>({fingerprint:++reads>=(phase==='before write'?2:3)?'changed':'source-confirmed',
      common:{inputs:{},status:'ready',bindingContext:{}} as BarrierCommonCalculationCollection}));
    await expect(target.run()).rejects.toMatchObject({code:'PROPOSAL_STALE'});
    expect(target.state.cable).toEqual(target.baseline);expect(target.state.history).toHaveLength(0);expect(target.state.receipts).toHaveLength(0);
    expect(target.collect).not.toHaveBeenCalled();expect(target.barrierFence).not.toHaveBeenCalled();expect(target.snapshot).not.toHaveBeenCalled();
    expect(target.state.writes).toBe(phase==='before write'?0:1);
  });
  it('retains manual ownership review on a geometry-free replica',async()=>{
    const f=await replicas(),target=f.targets[0];target.ownership.mockResolvedValue({kind:'review-required',reasonCode:'MANUAL'} as never);
    expect(await target.run()).toMatchObject({status:'review-required'});expect(target.state.writes).toBe(0);
    expect(target.collect).not.toHaveBeenCalled();expect(target.barrierFence).not.toHaveBeenCalled();expect(target.snapshot).not.toHaveBeenCalled();
  });
  it('uses the ordinary strict writer when no live source capability is available',async()=>{
    const f=await replicas(),target=f.targets[0];f.reuse.clear();expect(await target.run()).toMatchObject({status:'written'});
    expect(target.collect).toHaveBeenCalledOnce();expect(target.barrierFence).toHaveBeenCalledTimes(2);expect(target.snapshot).toHaveBeenCalledOnce();
  });
  it('updates both values from an exact result and preserves every other cable field', async () => {
    const f = fixture(); const outcome = await f.run(); expect(outcome.status).toBe('written'); expect(f.state.cable).toMatchObject({ routing: '/A', design_length: '7', install_length: '99', revision: '1', cable_write_revision: '8' });
    expect(f.state.receipts).toHaveLength(1); expect(f.state.history).toHaveLength(1); expect(f.barrierFence).toHaveBeenCalledTimes(2); expect(f.mandateFence).toHaveBeenCalledTimes(3);
    const p = automaticPairProvenanceSchema.parse(f.state.receipts[0].provenance); expect(p.mandate.ownership).toEqual(f.owned); expect(p.history.version).toBe('4');
    expect(f.query.mock.calls.some(([sql]) => sql.includes('pf_reviews'))).toBe(false);
  });
  it('recognizes a committed exact receipt before seeking expired authority', async () => {
    const f = fixture(); await f.run(); f.mandateFence.mockRejectedValue(Object.assign(Error('Expired'), { code: 'EXPIRED' }));
    expect(await f.run()).toMatchObject({ status: 'already-written' }); expect(f.state.writes).toBe(1); expect(f.mandateFence).toHaveBeenCalledTimes(3);
  });
  it('recovers lost COMMIT acknowledgement without another pair write', async () => {
    const f = fixture(); f.state.lostAck = true; await expect(f.run()).rejects.toMatchObject({ code: 'ENDPOINT_COMMIT_OUTCOME_UNKNOWN' });
    expect(f.state.receipts).toHaveLength(1); expect(await f.run()).toMatchObject({ status: 'already-written' }); expect(f.state.writes).toBe(1);
  });
  it('reconciles an exhausted committed receipt after a later manual edit without overwriting it', async () => {
    const f = fixture(); const written = await f.run(); f.state.cable = { ...f.state.cable, routing: '/MANUAL', design_length: '24', cable_write_revision: '9' };
    f.state.history.push({ change_source: 'manual', routing: '/MANUAL' }); const manual = structuredClone(f.state.cable);
    f.mandateFence.mockRejectedValue(Error('Expired authority must not be used'));
    expect(await f.inspect()).toEqual({ status: 'already-written', receiptId: written.receiptId });
    expect(f.state.cable).toEqual(manual); expect(f.state.writes).toBe(1); expect(f.proof).toHaveBeenCalled();
    expect(f.mandateFence).toHaveBeenCalledTimes(3); expect(f.ownership).toHaveBeenCalledOnce();
  });
  it('confirms no write only after acquiring the project and exhausted ownerless dispatch fence', async () => {
    const f = fixture(); expect(await f.inspect()).toEqual({ status: 'refused', receiptId: null, code: 'AUTOMATIC_PAIR_NOT_WRITTEN_CONFIRMED' });
    const queries = f.query.mock.calls.map(([sql]) => sql), project = queries.findIndex(sql => sql.startsWith('SELECT id FROM projects'));
    const dispatch = queries.findIndex(sql => sql.includes('automatic-pair:recovery-fence')), receipt = queries.findIndex(sql => sql.includes('existing-receipt'));
    expect(project).toBeLessThan(dispatch); expect(dispatch).toBeLessThan(receipt); expect(f.state.writes).toBe(0);
    expect(f.state.cable).toEqual(f.baseline); expect(f.mandateFence).not.toHaveBeenCalled(); expect(f.collect).not.toHaveBeenCalled();
  });
  it.each(['owner', 'attempts', 'status'] as const)('never proves absence while recovery %s is not fenced', async kind => {
    const f = fixture(); if (kind === 'owner') f.state.recovery.owner_token = 'live-owner';
    if (kind === 'attempts') f.state.recovery.attempts = 2; if (kind === 'status') f.state.recovery.status = 'running';
    await expect(f.inspect()).rejects.toMatchObject({ code: 'AUTOMATIC_PAIR_RECOVERY_FENCED' });
    expect(f.query.mock.calls.some(([sql]) => sql.includes('existing-receipt'))).toBe(false); expect(f.state.writes).toBe(0);
  });
  it('retains uncertainty when the stored receipt proof cannot be verified', async () => {
    const f = fixture(); await f.run(); f.proof.mockResolvedValue(null as never);
    await expect(f.inspect()).rejects.toMatchObject({ code: 'AUTOMATIC_PAIR_RECEIPT_INTEGRITY' }); expect(f.state.writes).toBe(1);
  });
  it('does not infer absence from a different exact job request', async () => {
    const f = fixture(); f.p.request_hash = 'f'.repeat(64);
    await expect(f.inspect()).rejects.toMatchObject({ code: 'AUTOMATIC_PAIR_EXACT_REQUEST_REQUIRED' }); expect(f.state.writes).toBe(0);
  });
  it.each(['routing only', 'length only', 'restored revision', 'other field'] as const)('preserves intervening %s', async kind => {
    const f = fixture(); if (kind === 'routing only') f.state.cable.routing = '/MANUAL'; if (kind === 'length only') f.state.cable.design_length = '11';
    if (kind === 'restored revision') f.state.cable.cable_write_revision = '9'; if (kind === 'other field') f.state.cable.tag = 'Changed';
    expect(await f.run()).toMatchObject({ status: 'review-required' }); expect(f.state.writes).toBe(0);
  });
  it('protects a newer same-value manual history even when values match', async () => {
    const f = fixture(); f.ownership.mockResolvedValue({ kind: 'review-required', reasonCode: 'MANUAL' } as never);
    expect(await f.run()).toMatchObject({ status: 'review-required' }); expect(f.state.writes).toBe(0);
  });
  it.each(['history', 'receipt', 'wrong route', 'unrelated write', 'CAS'] as const)('rolls back the pair after %s failure', async kind => {
    const f = fixture(); if (kind === 'history') f.state.historyFailed = true; if (kind === 'receipt') f.state.receiptFailed = true;
    if (kind === 'wrong route') f.state.mutate = after => { after.routing = '/WRONG'; }; if (kind === 'unrelated write') f.state.mutate = after => { after.install_length = '0'; };
    if (kind === 'CAS') f.state.casMiss = true; await expect(f.run()).rejects.toBeDefined(); expect(f.state.cable).toEqual(f.baseline); expect(f.state.receipts).toHaveLength(0); expect(f.state.history).toHaveLength(0);
  });
  it('does not update a stale mathematical dependency', async () => {
    const f = fixture(); f.collect.mockResolvedValue({ dependencies: { ...f.dependencies, cableWriteRevision: '9' }, cable: { cable_write_revision: '9' } });
    expect(await f.run()).toMatchObject({ status: 'stale' }); expect(f.state.writes).toBe(0);
  });
  it('refuses a nonapplicable scoped item', async () => { const f = fixture(); f.applicability.mockResolvedValue({ applicable: false });
    await expect(f.run()).rejects.toMatchObject({ code: 'PROPOSAL_NOT_APPLICABLE' }); expect(f.state.writes).toBe(0); });
  it('binds idempotency to mandate, exact proposal and revision', () => {
    const f = fixture(), request = { schemaVersion: 'wfc.pf.automatic-pair-write.v1' as const, mandateId: f.mandate.id, mandateSha256: f.mandate.contentSha256,
      projectId: f.mandate.projectId, jobId: f.mandate.jobId, cableId: f.mandate.cableId, proposalId: f.p.id, proposalHash: f.p.proposal_hash, expectedCableWriteRevision: '7' };
    expect(automaticPairIdempotencyKey(request)).toBe(automaticPairIdempotencyKey({ ...request }));
    expect(automaticPairIdempotencyKey({ ...request, expectedCableWriteRevision: '8' })).not.toBe(automaticPairIdempotencyKey(request));
  });
});
