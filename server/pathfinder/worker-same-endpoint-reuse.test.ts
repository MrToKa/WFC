// @vitest-environment node
import { EventEmitter } from 'node:events';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Pool, PoolClient } from 'pg';
import type { EngineExecutor } from './engineSession.js';
import type { PathFinderJobs } from './jobs.js';
import { syntheticBarrierWriteInputs } from './barrierWriteFixtures.js';
import { syntheticBarrierEngineIdentity } from './calculationFixtures.js';
import { PathFinderError } from './errors.js';
import type { BarrierDependencySnapshot } from './jobContracts.js';

const seams = vi.hoisted(() => ({ claim: vi.fn(), acquire: vi.fn(), transaction: vi.fn(), collect: vi.fn(), enrollment: vi.fn(),
  identity: vi.fn(), baseline: vi.fn(), seal: vi.fn(), verify: vi.fn(), publish: vi.fn(), physical: vi.fn(),snapshot:vi.fn(),capacity:vi.fn() }));
vi.mock('./trayCapacityRouting.js',()=>({readTrayCapacityRouting:seams.capacity}));
vi.mock('./workerScheduling.js', async original => ({ ...await original<typeof import('./workerScheduling.js')>(), claimCalculationSlice: seams.claim }));
vi.mock('./dependencies.js', async original => ({ ...await original<typeof import('./dependencies.js')>(), collectDependenciesForVersion: seams.collect }));
vi.mock('./operationAuthority.js', async original => ({ ...await original<typeof import('./operationAuthority.js')>(), operationTransaction: seams.transaction }));
vi.mock('./grantWorkerAuthority.js', () => ({ acquireGrantJobExecution: seams.acquire }));
vi.mock('./calculationEngineIdentity.js', () => ({ calculationEngineIdentity: seams.identity, barrierCalculationEngineIdentity: seams.identity, mixedBarrierCalculationEngineIdentity: seams.identity }));
vi.mock('./recalculationRepository.js', () => ({ requireEnrollmentAuthority: seams.enrollment, readRecalculationJobAuthority: async () => ({ enrolled: false }) }));
vi.mock('./storage.js', () => ({ readSnapshot: seams.snapshot }));
vi.mock('./revisionResultRepository.js', () => ({ readRevisionBaseline: seams.baseline, sealRevisionResult: seams.seal, verifyRevisionResultForProposal: seams.verify }));
vi.mock('./autoLengthStore.js', () => ({ publishAutoLength: seams.publish }));
vi.mock('./barrierWrites.js', () => ({ requireCurrentBarrierWriteScope: seams.physical }));
import { buildCableEngineRequest, createPathFinderWorker, unavailableBarrierEngineResponse } from './worker.js';
import { createVerifiedSameEndpointReuse } from './verifiedSameEndpointReuse.js';
import type { BarrierCommonCalculationCollection } from './dependencies.js';
import { hash } from './dependencies.js';

type Row = Record<string, any>;
const active: Array<ReturnType<typeof createPathFinderWorker>> = [];
/** Real worker loop, one-item quanta and real reuse/strategy/ledger logic.
 * Only SQL, authority, immutable seals and native execution are synthetic seams. */
function fixture(options: { count?: number; engineFailure?: boolean; unknownCommit?: boolean; staleSource?: boolean;
  purposeRoute?:'allowed'|'forbidden'|'text-mismatch';
  mutateTarget?: (dependencies: BarrierDependencySnapshot) => void; revokeTarget?: boolean; cancelSource?: boolean;capacity?:boolean;capacityNoAlternative?:boolean;
  balance?:boolean;settledSource?:boolean;clearReuseAtSlice?:number[];interleaveGroup?:boolean;capacityNoAlternativeGroup?:boolean;finalCapacityChange?:'hash'|'free';
  invalidDonor?:'hash'|'wrong-pair'|'wrong-seal-job'|'wrong-seal-cable' } = {}) {
  const f = syntheticBarrierWriteInputs(), { calculationMode: _mode, ...rawOutput } = f.result;
  if(options.purposeRoute)f.dependencies.cablePurposeRouting={purpose:'Power',allowedRouteCodes:[options.purposeRoute==='forbidden'?'/VFD':'/A']};
  if(options.purposeRoute)rawOutput.route!.routeCodes=['/A'];
  if(options.purposeRoute==='text-mismatch')rawOutput.route!.routeText='/VFD';
  const job = { id: f.id(201), project_id: f.dependencies.projectId, authority_kind: 'current-login', requested_by: f.id(202),
    login_id: f.id(203), login_expires_at: new Date(Date.now() + 600000), owner_token: null as string | null, lease_until: null as Date | null,
    state: 'queued', kind: 'calculate', cancel_requested: false, timeout_ms: 60000, completed: 0, failure: null };
  const items = Array.from({ length: options.count ?? 3 }, (_, at) => ({ cable_id: f.id(210 + at), state: 'waiting', status: 'ready',
    dependencies: { ...structuredClone(f.dependencies), cableId: f.id(210 + at), cableWriteRevision: String(20 + at),
      cableInputs: { ...f.dependencies.cableInputs, cableTypeId: f.id(220 + at) } } }));
  if (items[1]) options.mutateTarget?.(items[1].dependencies);
  if(options.interleaveGroup&&items[1]){
    items[1].dependencies.cableInputs.fromLocation='OTHER';items[1].dependencies.endpointResolution.from.logicalKey='OTHER';
  }
  if(options.capacity||options.capacityNoAlternative||options.capacityNoAlternativeGroup)for(const item of items)item.dependencies.settings.trayCapacity={enabled:true,minimumFreeSpacePercent:30,tolerancePercentagePoints:3,layoutSha256:'d'.repeat(64)};
  if(options.balance)for(const item of items)item.dependencies.settings.routingBalance={mode:'destination-groups-v1',layoutSha256:'d'.repeat(64)};
  const samePair=(left:BarrierDependencySnapshot,right:BarrierDependencySnapshot)=>hash([left.endpointResolution.from.logicalKey,left.endpointResolution.to.logicalKey,left.cableInputs.mto])
    ===hash([right.endpointResolution.from.logicalKey,right.endpointResolution.to.logicalKey,right.cableInputs.mto]);
  const capacityObservations:Array<{cableId:string;weights:unknown;sourceId:string|null}>=[];
  const capacityReads=new Map<string,number>();
  seams.capacity.mockImplementation(async(_client:PoolClient,input:Row)=>{
    const selected=items.find(item=>item.cable_id===input.cableId)!,restricted=Boolean(options.capacity||options.capacityNoAlternative||options.capacityNoAlternativeGroup);
    const reads=(capacityReads.get(input.cableId)??0)+1;capacityReads.set(input.cableId,reads);
    const finalChange=options.finalCapacityChange&&input.cableId===items.at(-1)!.cable_id&&reads>=2;
    const occupancySha256=(finalChange?'d':'c').repeat(64);
    const group=options.capacityNoAlternative?[input.cableId]:items.filter(item=>samePair(item.dependencies,selected.dependencies)).map(item=>item.cable_id);
    const weights=options.balance?[{routeCode:'/A',multiplier:proposals.length?9:2}]:[];
    const donor=options.settledSource?proposals.find(proposal=>(proposal.status==='calculated'||proposal.status==='no_path'&&proposal.result?.trayCapacity?.outcome==='no-capacity')
      &&(options.invalidDonor==='wrong-pair'||samePair(proposal.dependencies,selected.dependencies))):undefined;
    const settled=donor?{id:donor.id,proposalHash:options.invalidDonor==='hash'?'0'.repeat(64):donor.proposalHash,
      cableId:donor.cableId,dependencies:structuredClone(donor.dependencies),result:structuredClone(donor.result)}:null;
    capacityObservations.push({cableId:input.cableId,weights:structuredClone(weights),sourceId:settled?.id??null});
    const evaluate=(codes:string[])=>{const routeCodes=[...new Set(codes.map(value=>'/'+value.replace(/^\/+/,'')))];
      const blocked=finalChange&&options.finalCapacityChange==='free'?[]:(options.capacityNoAlternative&&input.cableId===items[0].cable_id
        ||options.capacityNoAlternativeGroup&&samePair(selected.dependencies,items[0].dependencies))?routeCodes:[];
      return {schemaVersion:'wfc.pf.tray-capacity-diagnostics.v1' as const,minimumFreeSpacePercent:30,effectiveMinimumFreeSpacePercent:27,tolerancePercentagePoints:3 as const,
        restrictionEnabled:restricted,occupancySha256,groupCableCount:group.length,blockedRouteCodes:blocked,unavailableRouteCodes:[],
        trays:routeCodes.map(routeCode=>({routeCode,freeSpacePercent:blocked.length?26:options.balance&&!restricted?10:27,status:blocked.length?'below-minimum' as const:'fits' as const}))};};
    return {policy:{enabled:restricted,minimumFreeSpacePercent:30,effectiveMinimumFreeSpacePercent:27,tolerancePercentagePoints:3},
      minimumFreeSpacePercent:30,effectiveMinimumFreeSpacePercent:27,tolerancePercentagePoints:3,occupancySha256,groupCableCount:group.length,groupCableIds:group,groupKey:'test',
      restrictionEnabled:restricted,routeCostMultipliers:weights,sameToGroupKey:'TO',sameToGroupCableIds:items.map(item=>item.cable_id),preferredCorridors:[],settledSource:settled,
      evaluate,score:(codes:string[])=>({assessment:evaluate(codes),bottleneckOccupiedPercent:73,meanOccupiedPercent:73,knownTrayCount:codes.length,unknownTrayCount:0,sharedSuffixRouteCodes:[]})};
  });
  const proposals: Array<Row> = [], outputs: Array<Row> = [],autoLengths:Array<Row>=[], events: string[] = [], collections = new Map<string, number>();
  let unknownSent = false, slices = 0;
  const query = vi.fn(async (raw: string, values: any[] = []) => {
    const sql = raw.replace(/\s+/g, ' ').trim();
    if (sql.startsWith('SELECT impact_id FROM pf_location_impact_enrollments')) return { rows: [] };
    if (sql.startsWith('SELECT * FROM pf_jobs')) return { rows: [{ ...job }] };
    if (sql.startsWith('SELECT * FROM pf_job_items')) return { rows: items.filter(item => item.state === 'waiting').slice(0, 1).map(item => ({ ...item })) };
    if (sql.startsWith("UPDATE pf_job_items SET state='running'")) { items.find(item => item.cable_id === values[2])!.state = 'running'; return { rows: [] }; }
    if (sql.startsWith('SELECT result,dependencies,status FROM pf_proposals')) return { rows: [] };
    if (sql.startsWith('INSERT INTO pf_proposals')) {
      const record = { id: values[0], projectId: values[1], jobId: values[2], cableId: values[3], status: values[4],
        dependencies: structuredClone(values[5]), result: structuredClone(values[8]), proposalHash: values[9] };
      proposals.push(record); return { rows: [{ id: record.id }] };
    }
    if (sql.startsWith("UPDATE pf_job_items SET state='complete'")) {
      const item = items.find(value => value.cable_id === values[2])!; item.state = 'complete'; item.status = values[3]; return { rows: [{ cable_id: item.cable_id }] };
    }
    if (sql.startsWith('UPDATE pf_jobs SET completed=completed+1')) { job.completed++; return { rows: [] }; }
    if (sql.startsWith('SELECT 1 FROM pf_job_items')) return { rows: items.some(item => item.state === 'waiting') ? [{}] : [] };
    if (sql.startsWith('UPDATE pf_jobs SET state=$3,owner_token=NULL')) { job.state = values[2]; job.owner_token = null; return { rows: [] }; }
    if (sql.startsWith('UPDATE pf_jobs SET state=CASE')) { job.state = job.cancel_requested ? 'cancelled' : values[2] ? 'queued' : 'failed'; job.owner_token = null; return { rows: [] }; }
    if (sql.startsWith('UPDATE pf_jobs j SET lease_until')) return { rows: [{ id: job.id }] };
    throw new Error('Unexpected isolated worker SQL: ' + sql);
  });
  const client = { query } as unknown as PoolClient;
  const owner = new EventEmitter() as EventEmitter & { query: ReturnType<typeof vi.fn>; release: ReturnType<typeof vi.fn>; end: ReturnType<typeof vi.fn> };
  owner.query = vi.fn(async () => ({ rows: [{ locked: true }] })); owner.release = vi.fn(); owner.end = vi.fn(async () => undefined);
  const pool = { query, connect: vi.fn(async () => owner) } as unknown as Pool;
  seams.claim.mockImplementation(async () => { if (job.state !== 'queued') return null; slices++;
    if(options.clearReuseAtSlice?.includes(slices)){reuse.clear();events.push('cache-cleared');}
    job.state = 'running'; job.owner_token = f.id(204);
    job.lease_until = new Date(Date.now() + 30000); return { ...job }; });
  seams.acquire.mockImplementation(async () => ({ principal: { userId: job.requested_by, loginId: job.login_id, loginExpiresAt: Date.now() + 600000 }, finish: vi.fn(async () => undefined) }));
  seams.transaction.mockImplementation(async (_pool: Pool, _project: string, _principal: unknown, _operation: string,
    work: (client: PoolClient) => Promise<unknown>, signal: AbortSignal) => {
    signal.throwIfAborted();const saved={proposals:structuredClone(proposals),autoLengths:structuredClone(autoLengths),items:structuredClone(items),job:structuredClone(job)};
    const count = proposals.length;let value:unknown;
    try{value=await work(client);signal.throwIfAborted();}catch(error){
      proposals.splice(0,proposals.length,...saved.proposals);autoLengths.splice(0,autoLengths.length,...saved.autoLengths);
      items.splice(0,items.length,...saved.items);Object.assign(job,saved.job);throw error;
    }
    if (options.unknownCommit && !unknownSent && proposals.length > count) { unknownSent = true; events.push('unknown-commit');
      throw new PathFinderError('PATHFINDER_COMMIT_OUTCOME_UNKNOWN', 503); }
    return value;
  });
  seams.collect.mockImplementation(async (_client: PoolClient, _project: string, cableId: string) => {
    const count = (collections.get(cableId) ?? 0) + 1; collections.set(cableId, count);
    const dependencies = structuredClone(items.find(item => item.cable_id === cableId)!.dependencies);
    if (options.staleSource && cableId === items[0].cable_id && count === 2) dependencies.cableWriteRevision = '999';
    return { dependencies };
  });
  seams.baseline.mockImplementation(async (_client: PoolClient, input: Row) => ({ baselineHash: hash({ cableId: input.cableId }) }));
  seams.seal.mockImplementation(async (_client: PoolClient, input: Row) => ({ proposalId: input.proposalId, admissionId: f.id(205),
    baselineHash: hash({ cableId: input.cableId }), dependencyHash: hash(input.dependencies), engineResultSha256: hash(input.result),
    revisionResultSha256: hash({ proposalId: input.proposalId, cableId: input.cableId }) }));
  seams.verify.mockImplementation(async(_client:PoolClient,input:Row)=>{
    const donor=proposals.find(value=>value.id===input.proposalId);
    if(!donor||donor.proposalHash!==input.proposalHash||hash(donor.result)!==hash(input.result)||hash(donor.dependencies)!==hash(input.dependencies))return null;
    return {jobId:options.invalidDonor==='wrong-seal-job'?f.id(999):donor.jobId,
      cableId:options.invalidDonor==='wrong-seal-cable'?f.id(998):donor.cableId,proposalId:donor.id,
      engineResultSha256:hash(donor.result),dependencyHash:hash(donor.dependencies)};
  });
  seams.enrollment.mockImplementation(async (_client: PoolClient, input: Row) => {
    if (options.revokeTarget && input.cableId === items[1]?.cable_id) throw new PathFinderError('LOCATION_IMPACT_AUTHORITY_EXPIRED', 409);
  });
  seams.publish.mockImplementation(async(_client:PoolClient,input:Row)=>{autoLengths.push(structuredClone(input));return{status:'published'};});
  seams.physical.mockResolvedValue(f.dependencies.engineIdentity);
  const engine: EngineExecutor = { execute: vi.fn(async request => {
    const at = outputs.length; if (options.engineFailure && at === 0) { outputs.push({ failed: true }); throw new PathFinderError('ENGINE_DEADLINE', 408); }
    if((options.capacityNoAlternative||options.capacityNoAlternativeGroup)&&Array.isArray(request.excludedRouteCodes)&&request.excludedRouteCodes.length){
      const output={...unavailableBarrierEngineResponse(request.requestId,f.dependencies.barriers,'TRAY_CAPACITY_EXHAUSTED'),status:'no_path' as const};outputs.push(output);return output;
    }
    const output = structuredClone({ ...rawOutput, requestId: request.requestId }); outputs.push(output);
    if (options.cancelSource && at === 0) job.cancel_requested = true;
    return output;
  }), close: vi.fn(async () => undefined) };
  const metadataRead=vi.fn(async()=>({fingerprint:'unchanged-shared-metadata',common:{inputs:{},status:'ready',bindingContext:{}} as BarrierCommonCalculationCollection}));
  const replicaCollect=vi.fn(async(client:PoolClient,projectId:string,cableId:string)=>seams.collect(client,projectId,cableId));
  const reuse=createVerifiedSameEndpointReuse({request:buildCableEngineRequest,readMetadata:metadataRead,collect:replicaCollect});
  const worker = createPathFinderWorker(pool, {} as PathFinderJobs, () => engine, async () => f.dependencies.engineIdentity,reuse); active.push(worker);
  return { worker, engine, job, items, proposals, outputs,autoLengths, collections, events,metadataRead,replicaCollect,reuse,capacityObservations, get slices() { return slices; } };
}
beforeEach(() => { vi.resetAllMocks(); seams.identity.mockResolvedValue(syntheticBarrierEngineIdentity()); });
afterEach(async () => { for (const worker of active.splice(0)) await worker.stop().catch(() => undefined); });

describe('exact same-endpoint computation reuse across actual one-item worker slices', () => {
  it.each([{capacity:false,balance:false},{capacity:true,balance:false},{capacity:false,balance:true}])(
    'refuses forbidden native output before publication or reuse with routing options %j',async options=>{
      const f=fixture({count:2,...options,purposeRoute:'forbidden'});
      f.worker.start();await vi.waitFor(()=>expect(f.job.state).toBe('complete'));await f.worker.stop();
      expect(f.proposals.map(value=>value.status)).toEqual(['invalid_request','invalid_request']);
      expect(f.proposals.every(value=>!value.result.route&&/not permitted/.test(value.result.message))).toBe(true);
      expect(f.autoLengths).toHaveLength(0);expect(f.engine.execute).toHaveBeenCalledTimes(2);
    });
  it('rejects native route text that names a forbidden tray despite an allowed route code array',async()=>{
    const f=fixture({count:2,purposeRoute:'text-mismatch'});
    f.worker.start();await vi.waitFor(()=>expect(f.job.state).toBe('complete'));await f.worker.stop();
    expect(f.proposals.map(value=>value.status)).toEqual(['invalid_request','invalid_request']);
    expect(f.autoLengths).toHaveLength(0);expect(f.engine.execute).toHaveBeenCalledTimes(2);
  });
  it('publishes and reuses an exact permitted Purpose-bound native result',async()=>{
    const f=fixture({count:2,purposeRoute:'allowed'});
    f.worker.start();await vi.waitFor(()=>expect(f.job.state).toBe('complete'));await f.worker.stop();
    expect(f.proposals.map(value=>value.status)).toEqual(['calculated','calculated']);
    expect(f.autoLengths).toHaveLength(2);expect(f.engine.execute).toHaveBeenCalledOnce();
    expect(vi.mocked(f.engine.execute).mock.calls[0][0].allowedPurposeRouteCodes).toEqual(['/A']);
  });
  it('separates the Purpose of otherwise identical cables while retaining the permitted source for its own network',async()=>{
    const f=fixture({count:3,purposeRoute:'allowed'});
    f.items[1].dependencies.cablePurposeRouting={purpose:'VFD',allowedRouteCodes:['/VFD']};
    f.worker.start();await vi.waitFor(()=>expect(f.job.state).toBe('complete'));await f.worker.stop();
    expect(f.proposals.map(value=>value.status)).toEqual(['calculated','invalid_request','calculated']);
    expect(f.autoLengths).toHaveLength(2);expect(f.engine.execute).toHaveBeenCalledTimes(2);
    expect(f.proposals[2].result.requestId).toBe(f.proposals[0].result.requestId);
  });
  it('hydrates a committed balanced whole path after cache loss without splitting an exact pair on new load weights',async()=>{
    const f=fixture({count:2,balance:true,settledSource:true,clearReuseAtSlice:[2]});
    f.worker.start();await vi.waitFor(()=>expect(f.job.state).toBe('complete'));await f.worker.stop();
    expect(f.events).toContain('cache-cleared');expect(f.engine.execute).toHaveBeenCalledOnce();
    expect(f.proposals).toHaveLength(2);expect(f.autoLengths).toHaveLength(2);
    const [source,target]=f.proposals;
    expect(vi.mocked(f.engine.execute).mock.calls[0][0].routeCostMultipliers).toEqual([{routeCode:'/A',multiplier:2}]);
    expect(f.capacityObservations.some(value=>value.cableId===target.cableId&&hash(value.weights)===hash([{routeCode:'/A',multiplier:9}])&&value.sourceId===source.id)).toBe(true);
    expect(target.result.requestId).toBe(source.result.requestId);expect(target.result.route).toEqual(source.result.route);
    for(const proposal of f.proposals){
      expect(proposal.result.trayCapacity).toMatchObject({restrictionEnabled:false,outcome:'balanced',trays:[{freeSpacePercent:10}],
        query:{routeCostMultipliers:[{routeCode:'/A',multiplier:2}],excludedRouteCodes:[],timeoutMilliseconds:60000}});
    }
    expect(seams.verify).toHaveBeenCalledOnce();expect(seams.verify.mock.calls[0][1]).toEqual({projectId:f.job.project_id,
      proposalId:source.id,proposalHash:source.proposalHash,dependencies:source.dependencies,result:source.result});
    expect(target.cableId).not.toBe(source.cableId);expect(target.proposalHash).not.toBe(source.proposalHash);
  });
  it('restores the actual exact-pair donor after an interleaved group changes weights and the native cache is cleared',async()=>{
    const f=fixture({count:3,balance:true,settledSource:true,interleaveGroup:true,clearReuseAtSlice:[3]});
    f.worker.start();await vi.waitFor(()=>expect(f.job.state).toBe('complete'));await f.worker.stop();
    expect(f.engine.execute).toHaveBeenCalledTimes(2);expect(f.proposals).toHaveLength(3);expect(f.autoLengths).toHaveLength(3);
    const [source,other,target]=f.proposals;
    expect(other.result.requestId).not.toBe(source.result.requestId);expect(other.result.trayCapacity.query.routeCostMultipliers).toEqual([{routeCode:'/A',multiplier:9}]);
    expect(target.result.requestId).toBe(source.result.requestId);expect(target.result.route).toEqual(source.result.route);
    expect(target.result.design).toEqual(source.result.design);expect(target.result.trayCapacity.query).toEqual(source.result.trayCapacity.query);
    expect(seams.verify).toHaveBeenCalledOnce();expect(seams.verify.mock.calls[0][1].proposalId).toBe(source.id);
    expect(f.capacityObservations.some(value=>value.cableId===target.cableId&&value.sourceId===source.id)).toBe(true);
  });
  it('keeps an exact pair entirely unrouted when its sealed no-capacity decision is restored after other-group work',async()=>{
    const f=fixture({count:3,balance:true,capacityNoAlternativeGroup:true,settledSource:true,interleaveGroup:true,clearReuseAtSlice:[3]});
    f.worker.start();await vi.waitFor(()=>expect(f.job.state).toBe('complete'));await f.worker.stop();
    expect(f.engine.execute).toHaveBeenCalledTimes(3);expect(f.proposals.map(value=>value.status)).toEqual(['no_path','calculated','no_path']);
    const [source,other,target]=f.proposals;
    expect(source.result.trayCapacity).toMatchObject({outcome:'no-capacity',attempts:2,excludedRouteCodes:['/A']});
    expect(target.result.requestId).toBe(source.result.requestId);expect(target.result.route).toBeUndefined();
    expect(target.result.trayCapacity.query).toEqual(source.result.trayCapacity.query);
    expect(other.result.trayCapacity.query.routeCostMultipliers).toEqual([{routeCode:'/A',multiplier:9}]);
    expect(f.autoLengths).toHaveLength(1);expect(f.autoLengths[0].cableId).toBe(other.cableId);
    expect(seams.verify).toHaveBeenCalledOnce();expect(seams.verify.mock.calls[0][1].proposalId).toBe(source.id);
  });
  it('refreshes a copied sealed refusal occupancy hash without another native search while every excluded tray remains blocked',async()=>{
    const f=fixture({count:3,balance:true,capacityNoAlternativeGroup:true,settledSource:true,interleaveGroup:true,
      clearReuseAtSlice:[3],finalCapacityChange:'hash'});
    f.worker.start();await vi.waitFor(()=>expect(f.job.state).toBe('complete'));await f.worker.stop();
    expect(f.engine.execute).toHaveBeenCalledTimes(3);expect(f.proposals.map(value=>value.status)).toEqual(['no_path','calculated','no_path']);
    const [source,,target]=f.proposals;
    expect(source.result.trayCapacity.occupancySha256).toBe('c'.repeat(64));expect(target.result.trayCapacity.occupancySha256).toBe('d'.repeat(64));
    expect(target.result.requestId).toBe(source.result.requestId);expect(target.result.trayCapacity.query).toEqual(source.result.trayCapacity.query);
    expect(target.result.trayCapacity.blockedRouteCodes).toEqual(['/A']);expect(f.autoLengths).toHaveLength(1);
  });
  it('marks a restored no-capacity decision stale if a previously excluded tray is now free',async()=>{
    const f=fixture({count:3,balance:true,capacityNoAlternativeGroup:true,settledSource:true,interleaveGroup:true,
      clearReuseAtSlice:[3],finalCapacityChange:'free'});
    f.worker.start();await vi.waitFor(()=>expect(f.job.state).toBe('complete'));await f.worker.stop();
    expect(f.engine.execute).toHaveBeenCalledTimes(3);expect(f.proposals.map(value=>value.status)).toEqual(['no_path','calculated','stale']);
    expect(f.proposals[2].result.route).toBeUndefined();expect(f.proposals[2].result.requestId).toBe(f.proposals[0].result.requestId);
    expect(f.autoLengths).toHaveLength(1);expect(f.autoLengths[0].cableId).toBe(f.items[1].cable_id);
  });
  it('refuses a tampered persisted donor hash and performs an independent weighted solve',async()=>{
    const f=fixture({count:2,balance:true,settledSource:true,clearReuseAtSlice:[2],invalidDonor:'hash'});
    f.worker.start();await vi.waitFor(()=>expect(f.job.state).toBe('complete'));await f.worker.stop();
    expect(f.engine.execute).toHaveBeenCalledTimes(2);expect(seams.verify).toHaveBeenCalledOnce();
    expect(f.proposals[1].result.requestId).not.toBe(f.proposals[0].result.requestId);
    expect(f.proposals[0].result.trayCapacity.query.routeCostMultipliers).toEqual([{routeCode:'/A',multiplier:2}]);
    expect(f.proposals[1].result.trayCapacity.query.routeCostMultipliers).toEqual([{routeCode:'/A',multiplier:9}]);
  });
  it('rejects a donor outside the actual exact-pair group before accepting its seal',async()=>{
    const f=fixture({count:2,balance:true,settledSource:true,interleaveGroup:true,clearReuseAtSlice:[2],invalidDonor:'wrong-pair'});
    f.worker.start();await vi.waitFor(()=>expect(f.job.state).toBe('complete'));await f.worker.stop();
    expect(f.engine.execute).toHaveBeenCalledTimes(2);expect(seams.verify).not.toHaveBeenCalled();
    expect(f.proposals[1].result.requestId).not.toBe(f.proposals[0].result.requestId);
    expect(f.proposals.map(value=>value.cableId)).toEqual(f.items.map(value=>value.cable_id));
  });
  it.each(['wrong-seal-job','wrong-seal-cable'] as const)('rejects a persisted donor with a %s binding',async invalidDonor=>{
    const f=fixture({count:2,balance:true,settledSource:true,clearReuseAtSlice:[2],invalidDonor});
    f.worker.start();await vi.waitFor(()=>expect(f.job.state).toBe('complete'));await f.worker.stop();
    expect(f.engine.execute).toHaveBeenCalledTimes(2);expect(seams.verify).toHaveBeenCalledOnce();
    expect(f.proposals[1].result.requestId).not.toBe(f.proposals[0].result.requestId);expect(f.autoLengths).toHaveLength(2);
  });
  it('counts a capacity endpoint group once and keeps copied native calculations fast at the tolerant boundary',async()=>{
    const f=fixture({count:13,capacity:true});f.worker.start();await vi.waitFor(()=>expect(f.job.state).toBe('complete'));await f.worker.stop();
    expect(f.engine.execute).toHaveBeenCalledOnce();expect(f.proposals).toHaveLength(13);expect(f.autoLengths).toHaveLength(13);
    expect(f.proposals.every(value=>value.result.trayCapacity?.effectiveMinimumFreeSpacePercent===27&&value.result.trayCapacity.outcome==='fits')).toBe(true);
  });
  it('finishes the capacity-refused cable without route and continues the next eligible cable',async()=>{
    const f=fixture({count:2,capacityNoAlternative:true,mutateTarget:target=>{target.cableInputs.fromLocation='OTHER';target.endpointResolution.from.logicalKey='OTHER';}});
    f.worker.start();await vi.waitFor(()=>expect(f.job.state).toBe('complete'));await f.worker.stop();
    expect(f.proposals.map(value=>value.status)).toEqual(['no_path','calculated']);expect(f.proposals[0].result.route).toBeUndefined();
    expect(f.proposals[0].result.trayCapacity?.outcome).toBe('no-capacity');expect(f.autoLengths).toHaveLength(1);
    expect(f.engine.execute).toHaveBeenCalledTimes(3);expect(f.job.completed).toBe(2);
  });
  it('calculates one native path for thirteen distinct cable baselines while collecting/sealing/publishing every recipient independently', async () => {
    const f = fixture({ count: 13 }); f.worker.start(); await vi.waitFor(() => expect(f.job.state).toBe('complete')); await f.worker.stop();
    expect(f.slices).toBe(13); expect(f.engine.execute).toHaveBeenCalledOnce(); expect(f.proposals).toHaveLength(13);
    expect(new Set(f.proposals.map(proposal => proposal.id)).size).toBe(13);
    expect(new Set(f.proposals.map(proposal => proposal.proposalHash)).size).toBe(13);
    expect(new Set(f.proposals.map(proposal => proposal.result.requestId))).toEqual(new Set([f.outputs[0].requestId]));
    for (const [at, proposal] of f.proposals.entries()) {
      expect(proposal.cableId).toBe(f.items[at].cable_id); expect(proposal.dependencies.cableWriteRevision).toBe(String(20 + at));
      expect(proposal.result).toEqual({ ...f.outputs[0], calculationMode: 'calculate' });
      expect(f.collections.get(proposal.cableId)).toBe(2);
    }
    expect(seams.baseline).toHaveBeenCalledTimes(13); expect(seams.seal).toHaveBeenCalledTimes(13); expect(seams.publish).toHaveBeenCalledTimes(13);
    expect(new Set(seams.seal.mock.calls.map(call => call[1].proposalId)).size).toBe(13);
    expect(seams.identity).toHaveBeenCalledTimes(2); expect(seams.physical).toHaveBeenCalledOnce();
    expect(f.replicaCollect).toHaveBeenCalledTimes(24);expect(seams.snapshot).toHaveBeenCalledOnce();expect(f.autoLengths).toHaveLength(13);
  });
  it('rolls back recipient publication when the held common capability changes at its final fence',async()=>{
    const f=fixture({count:2});let reads=0;
    // Source prepare, target preflight, target postflight, then final fence.
    f.metadataRead.mockImplementation(async()=>({fingerprint:++reads===4?'changed':'unchanged-shared-metadata',
      common:{inputs:{},status:'ready',bindingContext:{}} as BarrierCommonCalculationCollection}));
    f.worker.start();await vi.waitFor(()=>expect(f.job.state).toBe('failed'));await f.worker.stop();
    expect(f.engine.execute).toHaveBeenCalledOnce();expect(f.proposals).toHaveLength(1);expect(f.job.completed).toBe(1);
    expect(f.autoLengths).toHaveLength(1);expect(f.autoLengths[0].cableId).toBe(f.items[0].cable_id);
    expect(seams.publish).toHaveBeenCalledTimes(2);expect(seams.physical).toHaveBeenCalledOnce();expect(seams.snapshot).toHaveBeenCalledOnce();
    expect(f.replicaCollect).toHaveBeenCalledTimes(2);
  });
  it('does not seed source work whose completion acknowledgement is unknown', async () => {
    const f = fixture({ count: 2, unknownCommit: true }); f.worker.start(); await vi.waitFor(() => expect(f.job.state).toBe('complete')); await f.worker.stop();
    expect(f.events).toContain('unknown-commit'); expect(f.engine.execute).toHaveBeenCalledTimes(2);
    expect(new Set(f.proposals.map(proposal => proposal.result.requestId)).size).toBe(2);
  });
  it.each(['location', 'logical pair', 'settings', 'category'] as const)('runs native calculation again for a changed recipient %s', async change => {
    const f = fixture({ count: 2, mutateTarget: target => {
      if (change === 'location') target.from.point[0] += 0.001;
      if (change === 'logical pair') { target.cableInputs.fromLocation = 'OTHER'; target.endpointResolution.from.logicalKey = 'OTHER'; }
      if (change === 'settings') target.settings.additionalBendingPercent = '11';
      if (change === 'category') target.cableInputs.mto = 'Control';
    } });
    f.worker.start(); await vi.waitFor(() => expect(f.job.state).toBe('complete')); await f.worker.stop();
    expect(f.engine.execute).toHaveBeenCalledTimes(2); expect(seams.baseline).toHaveBeenCalledTimes(2); expect(seams.seal).toHaveBeenCalledTimes(2);
    expect(f.collections.get(f.items[1].cable_id)).toBe(2);
    if (change === 'location') expect(vi.mocked(f.engine.execute).mock.calls[1][0].from).toMatchObject({ x: 0.001 });
    if (change === 'settings') expect(vi.mocked(f.engine.execute).mock.calls[1][0].projectSettings).toMatchObject({ additionalBendingPercent: '11' });
  });
  it('does not seed a source which becomes stale after native execution', async () => {
    const f = fixture({ count: 2, staleSource: true }); f.worker.start(); await vi.waitFor(() => expect(f.job.state).toBe('complete')); await f.worker.stop();
    expect(f.proposals.map(proposal => proposal.status)).toEqual(['stale', 'calculated']); expect(f.engine.execute).toHaveBeenCalledTimes(2);
    expect(seams.publish).toHaveBeenCalledOnce();
  });
  it('does not seed a failed native computation for an otherwise identical next cable', async () => {
    const f = fixture({ count: 2, engineFailure: true }); f.worker.start(); await vi.waitFor(() => expect(f.job.state).toBe('complete')); await f.worker.stop();
    expect(f.engine.execute).toHaveBeenCalledTimes(2); expect(f.proposals[0].status).not.toBe('calculated'); expect(f.proposals[1].status).toBe('calculated');
  });
  it('keeps the recipient authority check even when a reusable computation exists', async () => {
    const f = fixture({ count: 2, revokeTarget: true }); f.worker.start(); await vi.waitFor(() => expect(f.job.state).toBe('failed')); await f.worker.stop();
    expect(f.engine.execute).toHaveBeenCalledOnce(); expect(f.proposals).toHaveLength(1); expect(seams.publish).toHaveBeenCalledOnce();
    expect(f.collections.has(f.items[1].cable_id)).toBe(true);
  });
  it('does not publish or reuse a source cancelled during execution', async () => {
    const f = fixture({ count: 2, cancelSource: true }); f.worker.start(); await vi.waitFor(() => expect(f.job.state).toBe('cancelled')); await f.worker.stop();
    expect(f.engine.execute).toHaveBeenCalledOnce(); expect(f.proposals).toHaveLength(0); expect(seams.publish).not.toHaveBeenCalled();
  });
});
