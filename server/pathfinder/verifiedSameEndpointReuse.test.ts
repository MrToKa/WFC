// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PoolClient } from 'pg';
const seams=vi.hoisted(()=>({common:vi.fn(),identity:vi.fn()}));
vi.mock('./dependencies.js',async original=>({...await original<typeof import('./dependencies.js')>(),collectBarrierCommonMetadata:seams.common}));
vi.mock('./calculationEngineIdentity.js',()=>({calculationEngineIdentity:seams.identity,barrierCalculationEngineIdentity:seams.identity,mixedBarrierCalculationEngineIdentity:seams.identity}));
import { syntheticBarrierWriteInputs } from './barrierWriteFixtures.js';
import { buildCableEngineRequest } from './worker.js';
import { createVerifiedSameEndpointReuse, readSameEndpointMetadata, readVerifiedSameEndpointCurrent } from './verifiedSameEndpointReuse.js';
import { SAME_ENDPOINT_REUSE_LIMITS } from './sameEndpointCalculationReuse.js';
import { hash } from './dependencies.js';

function fixture(captured=false){
  const f=syntheticBarrierWriteInputs(),{calculationMode:_mode,...response}=f.result;
  if(captured)f.dependencies.barriers.storage!.capture={blobId:f.id(101),sha256:'c'.repeat(64),bytes:100};
  const {schemaVersion:_version,cableId:_cable,cableWriteRevision:_revision,cableInputs:_inputs,from:_from,to:_to,
    endpointResolution:_resolution,barriers:_barriers,...commonInputs}=structuredClone(f.dependencies);
  const common={status:'ready',inputs:{...commonInputs,registryRevision:'4'},bindingContext:{traceId:f.id(100)}};
  seams.common.mockImplementation(async()=>structuredClone(common));seams.identity.mockResolvedValue(f.dependencies.engineIdentity);
  const publication:Record<string,unknown>={revision:f.dependencies.barriers.binding.registryRevision,
    snapshot_id:f.dependencies.barriers.binding.snapshot!.snapshotId,model_version_id:f.dependencies.model.id,
    snapshot_revision:f.dependencies.barriers.binding.registryRevision,snapshot_sha256:f.dependencies.barriers.binding.snapshot!.contentSha256,
    storage_intent_id:f.dependencies.barriers.storage!.intentId,manifest_blob:f.dependencies.barriers.storage!.manifest,
    intent_state:'complete',capture_sha256:'c'.repeat(64),request_sha256:'d'.repeat(64),capture_blob_id:f.id(101),manifest_blob_id:f.dependencies.barriers.storage!.manifest.blobId};
  const command={scope:f.dependencies.barriers.binding.scope,expectedRegistryRevision:'0'};
  Object.assign(publication,{frozen_intent_id:f.dependencies.barriers.storage!.intentId,frozen_snapshot_id:publication.snapshot_id,
    frozen_command:command,intent_request:structuredClone(command),request_sha256:hash(command),actor_id:f.id(13),login_id:f.id(14),
    frozen_actor_id:f.id(13),frozen_login_id:f.id(14),manifest_capture_id:f.dependencies.barriers.storage!.intentId,manifest_capture_sha256:'c'.repeat(64)});
  const query=vi.fn(async(sql:string)=>{expect(sql).toContain('same-endpoint:publication-metadata');return{rows:[structuredClone(publication)]};});
  const client={query} as unknown as PoolClient;
  const target={...structuredClone(f.dependencies),cableId:f.id(91),cableWriteRevision:'900'};
  const collect=vi.fn(async()=>({status:'ready',message:'',cable:{id:target.cableId,cable_write_revision:target.cableWriteRevision},dependencies:target}));
  const reuse=createVerifiedSameEndpointReuse({request:buildCableEngineRequest,collect});
  const request=buildCableEngineRequest(f.dependencies,response.requestId,60000);
  return{...f,response,common,publication,client,query,target,collect,reuse,request};
}
function capacityFixture(){
  const f=fixture();
  const policy={enabled:true as const,minimumFreeSpacePercent:30,tolerancePercentagePoints:3 as const,layoutSha256:'e'.repeat(64)};
  f.dependencies.settings.trayCapacity=structuredClone(policy);f.target.settings.trayCapacity=structuredClone(policy);
  f.common.inputs.settings.trayCapacity=structuredClone(policy);
  f.request={...buildCableEngineRequest(f.dependencies,f.response.requestId,43210),excludedRouteCodes:['/FULL']};
  const capacity={schemaVersion:'wfc.pf.tray-capacity-diagnostics.v1' as const,minimumFreeSpacePercent:30,effectiveMinimumFreeSpacePercent:27,
    tolerancePercentagePoints:3 as const,occupancySha256:'1'.repeat(64),groupCableCount:2,blockedRouteCodes:[],unavailableRouteCodes:[],
    trays:[{routeCode:'/A',freeSpacePercent:40,status:'fits' as const}],outcome:'rerouted' as const,attempts:2,excludedRouteCodes:['/FULL']};
  f.response.trayCapacity=structuredClone(capacity);
  return{...f,capacity};
}
function balanceFixture(){
  const f=fixture(),policy={mode:'destination-groups-v1' as const,layoutSha256:'e'.repeat(64)};
  f.dependencies.settings.routingBalance=structuredClone(policy);f.target.settings.routingBalance=structuredClone(policy);
  f.common.inputs.settings.routingBalance=structuredClone(policy);
  const weights=[{routeCode:'/A',multiplier:4}];
  f.request={...buildCableEngineRequest(f.dependencies,f.response.requestId,43210),routeCostMultipliers:weights};
  const capacity={schemaVersion:'wfc.pf.tray-capacity-diagnostics.v1' as const,minimumFreeSpacePercent:30,effectiveMinimumFreeSpacePercent:27,
    tolerancePercentagePoints:3 as const,occupancySha256:'1'.repeat(64),groupCableCount:2,restrictionEnabled:false,
    blockedRouteCodes:[],unavailableRouteCodes:[],trays:[{routeCode:'/A',freeSpacePercent:10,occupancyPercent:90,status:'fits' as const}],
    outcome:'balanced' as const,attempts:1,excludedRouteCodes:[],query:{timeoutMilliseconds:43210,excludedRouteCodes:[],routeCostMultipliers:weights}};
  f.response.trayCapacity=structuredClone(capacity);return{...f,capacity};
}
beforeEach(()=>vi.resetAllMocks());afterEach(()=>vi.restoreAllMocks());
describe('source-verified private common metadata capability',()=>{
  it('keeps per-cable Purpose filtering outside shared metadata while retaining it in exact request identity',async()=>{
    const f=fixture();f.dependencies.cablePurposeRouting={purpose:'VFD',allowedRouteCodes:['/A']};
    expect(await readSameEndpointMetadata(f.client,f.dependencies)).not.toBeNull();
    const request=buildCableEngineRequest(f.dependencies,f.response.requestId,60000);
    expect(request.allowedPurposeRouteCodes).toEqual(['/A']);
    const target={...f.dependencies,cablePurposeRouting:{purpose:'Power',allowedRouteCodes:['/B']}};
    expect(buildCableEngineRequest(target,f.response.requestId,60000).allowedPurposeRouteCodes).toEqual(['/B']);
  });
  it.each(['state','capture SHA','capture blob','manifest blob','intent ID','snapshot ID','manifest capture','request hash','request body','scope','missing scope','previous revision','actor'] as const)(
    'refuses initially invalid captured publication %s before creating a source token',async change=>{
      const f=fixture(true);expect(await readSameEndpointMetadata(f.client,f.dependencies)).not.toBeNull();
      if(change==='state')f.publication.intent_state='pending';
      if(change==='capture SHA')f.publication.capture_sha256='e'.repeat(64);
      if(change==='capture blob')f.publication.capture_blob_id=f.id(199);
      if(change==='manifest blob')f.publication.manifest_blob_id=f.id(199);
      if(change==='intent ID')f.publication.frozen_intent_id=f.id(199);
      if(change==='snapshot ID')f.publication.frozen_snapshot_id=f.id(199);
      if(change==='manifest capture')f.publication.manifest_capture_sha256='e'.repeat(64);
      if(change==='request hash')f.publication.request_sha256='e'.repeat(64);
      if(change==='request body')f.publication.intent_request={different:true};
      if(change==='missing scope')f.publication.frozen_command={expectedRegistryRevision:'0'};
      if(change==='actor')f.publication.frozen_actor_id=f.id(199);
      if(change==='scope'||change==='previous revision'){
        const command={...(f.publication.frozen_command as Record<string,unknown>),...(change==='scope'?{scope:{different:true}}:{expectedRegistryRevision:'2'})};
        Object.assign(f.publication,{frozen_command:command,intent_request:command,request_sha256:hash(command)});
      }
      expect(await f.reuse.prepareSource(f.client,f.dependencies,f.request,f.response)).toBeNull();
    });
  it('uses the actual metadata reader for valid V8 and ignores only the nonmathematical global registry audit increment',async()=>{
    const f=fixture();expect(Object.hasOwn(f.dependencies,'registryRevision')).toBe(false);
    const before=await readSameEndpointMetadata(f.client,f.dependencies);expect(before).not.toBeNull();
    f.common.inputs.registryRevision='999';const after=await readSameEndpointMetadata(f.client,f.dependencies);
    expect(after?.fingerprint).toBe(before?.fingerprint);expect(after?.common.inputs?.barriers).toEqual(f.dependencies.barriers);
    expect(f.query).toHaveBeenCalledTimes(2);expect(seams.identity.mock.calls.every(call=>call.length===0)).toBe(true);
  });
  it('exposes no capability before confirmed source commit, then reconstructs a separate recipient and canonical exact-result binding',async()=>{
    const f=fixture(),prepared=await f.reuse.prepareSource(f.client,f.dependencies,f.request,f.response);
    expect(prepared).not.toBeNull();expect(await f.reuse.current(f.client,f.target)).toBeNull();
    f.reuse.commitSource(prepared!);
    // PostgreSQL JSONB property ordering is irrelevant; preserve complete bodies.
    const exact={...f.response,calculationMode:'calculate'},reordered=Object.fromEntries(Object.entries(exact).reverse());
    const token=await f.reuse.current(f.client,f.target,undefined,reordered),facts=readVerifiedSameEndpointCurrent(token);
    expect(facts?.current.dependencies?.cableId).toBe(f.target.cableId);expect(facts?.current.dependencies?.cableWriteRevision).toBe('900');
    expect(readVerifiedSameEndpointCurrent({current:facts?.current,verified:true})).toBeNull();
    expect(await f.reuse.current(f.client,f.target,undefined,{...exact,requestId:f.id(199)})).toBeNull();
    expect(f.collect).toHaveBeenCalledOnce();
    expect(await facts!.recheck(f.client)).toBe(true);f.reuse.clear();expect(await facts!.recheck(f.client)).toBe(false);
  });
  it.each(['model','settings','routing','preparation','trace','head','manifest','capture','request','intent state'] as const)(
    'refuses the token after current %s metadata changes',async change=>{
      const f=fixture(),prepared=await f.reuse.prepareSource(f.client,f.dependencies,f.request,f.response);f.reuse.commitSource(prepared!);
      if(change==='model')f.common.inputs.model.selectionRevision='2';
      if(change==='settings')f.common.inputs.settings.additionalBendingPercent='11';
      if(change==='routing')f.common.inputs.routing.routingPolicyRevision='2';
      if(change==='preparation')f.common.inputs.preparation.geometryRevision='3';
      if(change==='trace')f.common.bindingContext.traceId=f.id(103);
      if(change==='head')f.publication.revision='9';
      if(change==='manifest')f.publication.manifest_blob={different:true};
      if(change==='capture')f.publication.capture_sha256='e'.repeat(64);
      if(change==='request')f.publication.request_sha256='e'.repeat(64);
      if(change==='intent state')f.publication.intent_state='failed';
      expect(await f.reuse.current(f.client,f.target)).toBeNull();expect(f.collect).not.toHaveBeenCalled();
    });
  it('refuses a fresh recipient binding/cable revision projection which differs from its own admitted dependency',async()=>{
    const f=fixture(),prepared=await f.reuse.prepareSource(f.client,f.dependencies,f.request,f.response);f.reuse.commitSource(prepared!);
    f.collect.mockResolvedValue({status:'ready',message:'',cable:{id:f.target.cableId,cable_write_revision:'901'},dependencies:{...f.target,cableWriteRevision:'901'}});
    expect(await f.reuse.current(f.client,f.target)).toBeNull();
  });
  it('rejects changed implementation signatures and expired source work without accepting an old capability',async()=>{
    const f=fixture();let clock=0;vi.spyOn(performance,'now').mockImplementation(()=>clock);
    const prepared=await f.reuse.prepareSource(f.client,f.dependencies,f.request,f.response);f.reuse.commitSource(prepared!);
    const token=await f.reuse.current(f.client,f.target),facts=readVerifiedSameEndpointCurrent(token);expect(facts).not.toBeNull();
    seams.identity.mockResolvedValue({...f.dependencies.engineIdentity,contentSha256:'e'.repeat(64)});
    expect(await facts!.recheck(f.client)).toBe(false);seams.identity.mockResolvedValue(f.dependencies.engineIdentity);
    clock=SAME_ENDPOINT_REUSE_LIMITS.milliseconds;expect(await facts!.recheck(f.client)).toBe(false);
  });
  it('reconstructs actual capacity exclusions and remaining timeout for result-only writer reuse',async()=>{
    const f=capacityFixture(),prepared=await f.reuse.prepareSource(f.client,f.dependencies,f.request,f.response);
    expect(prepared).not.toBeNull();f.reuse.commitSource(prepared!);
    expect(f.reuse.find(f.target,buildCableEngineRequest(f.target,f.id(198),60000))).toBeNull();
    expect(f.reuse.find(f.target,{...buildCableEngineRequest(f.target,f.id(198),43210),excludedRouteCodes:['/FULL']})).not.toBeNull();
    const result={...f.response,calculationMode:'calculate',trayCapacity:{...f.capacity,attempts:1,occupancySha256:'2'.repeat(64)}};
    const token=await f.reuse.current(f.client,f.target,undefined,result),facts=readVerifiedSameEndpointCurrent(token);
    expect(facts?.current.dependencies?.cableId).toBe(f.target.cableId);expect(await facts!.recheck(f.client)).toBe(true);
    expect(result.trayCapacity.attempts).toBe(1);expect(f.response.trayCapacity?.attempts).toBe(2);
  });
  it('allows separately typed unavailable capacity observations without weakening the native result comparison',async()=>{
    const f=capacityFixture(),prepared=await f.reuse.prepareSource(f.client,f.dependencies,f.request,f.response);f.reuse.commitSource(prepared!);
    const result={...f.response,calculationMode:'calculate',trayCapacity:{...f.capacity,outcome:'unavailable',attempts:1,
      occupancySha256:'3'.repeat(64),unavailableRouteCodes:['/A'],trays:[{routeCode:'/A',freeSpacePercent:null,status:'unavailable'}]}};
    expect(await f.reuse.current(f.client,f.target,undefined,result)).not.toBeNull();
    expect(await f.reuse.current(f.client,f.target,undefined,{...result,route:{...f.response.route!,lengthMeters:99}})).toBeNull();
  });
  it.each(['wrong exclusions','wrong outcome','failed outcome','wrong threshold','zero attempts','missing coverage','blocked section','untyped metadata','non-calculated'] as const)(
    'does not strip %s capacity metadata to manufacture equivalent success',async change=>{
      const f=capacityFixture(),prepared=await f.reuse.prepareSource(f.client,f.dependencies,f.request,f.response);f.reuse.commitSource(prepared!);
      const result:Record<string,unknown>={...f.response,calculationMode:'calculate'},capacity:Record<string,unknown>=structuredClone(f.capacity);
      if(change==='wrong exclusions')capacity.excludedRouteCodes=['/OTHER'];
      if(change==='wrong outcome')capacity.outcome='fits';
      if(change==='failed outcome')capacity.outcome='no-capacity';
      if(change==='wrong threshold')capacity.effectiveMinimumFreeSpacePercent=20;
      if(change==='zero attempts')capacity.attempts=0;
      if(change==='missing coverage')capacity.trays=[];
      if(change==='blocked section'){capacity.blockedRouteCodes=['/A'];capacity.trays=[{routeCode:'/A',freeSpacePercent:10,status:'below-minimum'}];}
      if(change==='untyped metadata')capacity.unexpectedProof=true;
      if(change==='non-calculated')result.status='no_path';
      result.trayCapacity=capacity;
      expect(await f.reuse.current(f.client,f.target,undefined,result)).toBeNull();
    });
  it('rejects changed exclusion keys and frozen capacity policy despite the same endpoints',async()=>{
    const f=capacityFixture(),prepared=await f.reuse.prepareSource(f.client,f.dependencies,f.request,f.response);f.reuse.commitSource(prepared!);
    expect(await f.reuse.current(f.client,f.target,{...f.request,excludedRouteCodes:['/OTHER']})).toBeNull();
    f.target.settings.trayCapacity!.minimumFreeSpacePercent=25;
    expect(await f.reuse.current(f.client,f.target,undefined,{...f.response,calculationMode:'calculate'})).toBeNull();
  });
  it('refuses invalid capacity source metadata and calculated-looking failed sources',async()=>{
    const f=capacityFixture();f.response.trayCapacity!.outcome='no-capacity';
    expect(await f.reuse.prepareSource(f.client,f.dependencies,f.request,f.response)).toBeNull();
    f.response.trayCapacity!.outcome='rerouted';f.response.status='no_path';
    expect(await f.reuse.prepareSource(f.client,f.dependencies,f.request,f.response)).toBeNull();
  });
  it('retains exact full-body comparison when project capacity routing is disabled',async()=>{
    const f=fixture(),prepared=await f.reuse.prepareSource(f.client,f.dependencies,f.request,f.response);f.reuse.commitSource(prepared!);
    const exact={...f.response,calculationMode:'calculate'};
    expect(await f.reuse.current(f.client,f.target,undefined,exact)).not.toBeNull();
    expect(await f.reuse.current(f.client,f.target,undefined,{...exact,trayCapacity:capacityFixture().capacity})).toBeNull();
  });
  it('reconstructs weighted balance-only native input and permits low free space with the restriction off',async()=>{
    const f=balanceFixture(),prepared=await f.reuse.prepareSource(f.client,f.dependencies,f.request,f.response);
    expect(prepared).not.toBeNull();f.reuse.commitSource(prepared!);
    expect(f.reuse.find(f.target,buildCableEngineRequest(f.target,f.id(199),43210))).toBeNull();
    expect(f.reuse.find(f.target,{...buildCableEngineRequest(f.target,f.id(199),43210),routeCostMultipliers:[{routeCode:'/A',multiplier:4}]})).not.toBeNull();
    const result={...f.response,calculationMode:'calculate',trayCapacity:{...f.capacity,attempts:2,occupancySha256:'2'.repeat(64),
      trays:[{routeCode:'/A',freeSpacePercent:5,occupancyPercent:95,status:'fits'}]}};
    const current=await f.reuse.current(f.client,f.target,undefined,result),facts=readVerifiedSameEndpointCurrent(current);
    expect(facts?.current.dependencies?.cableId).toBe(f.target.cableId);expect(await facts!.recheck(f.client)).toBe(true);
    expect(await f.reuse.current(f.client,f.target,{...f.request,routeCostMultipliers:[{routeCode:'/A',multiplier:5}]},result)).toBeNull();
    expect(await f.reuse.current(f.client,f.target,undefined,{...result,route:{...f.response.route!,lengthMeters:100}})).toBeNull();
  });
  it.each(['missing query','changed weights','changed timeout','changed exclusions','restriction enabled','wrong outcome','below-minimum status','duplicate weights'] as const)(
    'does not strip inconsistent balance-only metadata: %s',async change=>{
      const f=balanceFixture(),prepared=await f.reuse.prepareSource(f.client,f.dependencies,f.request,f.response);f.reuse.commitSource(prepared!);
      const capacity:Record<string,unknown>=structuredClone(f.capacity);
      const query=capacity.query as Record<string,unknown>;
      if(change==='missing query')delete capacity.query;
      if(change==='changed weights')query.routeCostMultipliers=[{routeCode:'/A',multiplier:5}];
      if(change==='changed timeout')query.timeoutMilliseconds=60000;
      if(change==='changed exclusions')query.excludedRouteCodes=['/FULL'];
      if(change==='restriction enabled')capacity.restrictionEnabled=true;
      if(change==='wrong outcome')capacity.outcome='fits';
      if(change==='below-minimum status')capacity.trays=[{routeCode:'/A',freeSpacePercent:10,status:'below-minimum'}];
      if(change==='duplicate weights')query.routeCostMultipliers=[{routeCode:'/A',multiplier:4},{routeCode:'/A',multiplier:4}];
      expect(await f.reuse.current(f.client,f.target,undefined,{...f.response,calculationMode:'calculate',trayCapacity:capacity})).toBeNull();
    });
  it('requires exact weighted query metadata and minimum enforcement when balance and restriction are both on',async()=>{
    const f=balanceFixture(),policy={enabled:true as const,minimumFreeSpacePercent:30,tolerancePercentagePoints:3 as const,layoutSha256:'e'.repeat(64)};
    f.dependencies.settings.trayCapacity=structuredClone(policy);f.target.settings.trayCapacity=structuredClone(policy);
    f.common.inputs.settings.trayCapacity=structuredClone(policy);
    const good={...f.capacity,restrictionEnabled:true,outcome:'fits' as const,trays:[{routeCode:'/A',freeSpacePercent:40,status:'fits' as const}]};
    f.response.trayCapacity=good;
    const prepared=await f.reuse.prepareSource(f.client,f.dependencies,f.request,f.response);expect(prepared).not.toBeNull();f.reuse.commitSource(prepared!);
    expect(await f.reuse.current(f.client,f.target,undefined,{...f.response,calculationMode:'calculate'})).not.toBeNull();
    expect(await f.reuse.current(f.client,f.target,undefined,{...f.response,calculationMode:'calculate',trayCapacity:{...good,
      trays:[{routeCode:'/A',freeSpacePercent:10,status:'fits'}]}})).toBeNull();
    f.target.settings.routingBalance!.layoutSha256='d'.repeat(64);
    expect(await f.reuse.current(f.client,f.target)).toBeNull();
  });
  it('refuses a balance source whose diagnostic query does not bind its actual native weights',async()=>{
    const f=balanceFixture();f.response.trayCapacity!.query!.routeCostMultipliers=[{routeCode:'/A',multiplier:3}];
    expect(await f.reuse.prepareSource(f.client,f.dependencies,f.request,f.response)).toBeNull();
  });
});
