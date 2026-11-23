// @vitest-environment node
import {describe,it,expect,vi} from 'vitest';
import type {PoolClient} from 'pg';
import {modelLocationMatchFixture} from './modelLocationMatchFixtures.js';
import {endpointFixtureId as id} from './endpointBindingFixtures.js';
import {syntheticBarrierWriteInputs} from './barrierWriteFixtures.js';
import {syntheticInitialFillBarrierInputs} from './initialFillBarrierFixtures.js';
import {engineResponseSchema,type EngineResponse,type DependencySnapshot} from './jobContracts.js';
import {endpointBindingSchema,type EndpointBinding} from '../../shared/pathfinderEndpointBindings.js';
import {endpointCalculationPoint} from './endpointCalculationProvenance.js';
import {blockedEquipmentSides,equipmentCentrePoint,probeEquipmentCentreFallback,equipmentCentreCommandId,equipmentCentreProofRecord,
  appendEquipmentCentreProbe,retireCentreSupersededJob} from './equipmentCentreFallback.js';
import {buildCableEngineRequest,requireCableEngineStrategy,calculatedRouteCapacityBlocked} from './worker.js';
import {executeCapacityRouting} from './capacityRoutingExecution.js';
import type {TrayCapacityRoutingContext} from './trayCapacityRouting.js';
import {requireCalculationLengthLedger} from './lengthLedger.js';
import {appendEquipmentCentreFallbackInTransaction,endpointBindingTransaction,endpointBindingHash} from './endpointBindingRepository.js';
import {readCableEndpointDisplay} from './cableEndpointDisplay.js';
import {evaluateCrossModelEndpointMatch} from './crossModelEndpointMatch.js';

/** In-memory SQL and synthetic transport proofs, not physical model evidence. */
async function fixture(both=false){
  const f=await modelLocationMatchFixture(),command=f.command();
  if(both){command.scan.candidates[0].bounds={minimum:[-1,-1,-1],maximum:[1,1,1]};command.scan.candidates[0].bottomCentre=[0,0,-1];}
  await f.repo.assign(f.projectId,f.who,command);
  const source=f.state.bindings.get(f.state.heads.get(f.resolved('Equipment'))!)!;
  const initial=syntheticBarrierWriteInputs();initial.legacy.projectId=f.projectId;
  initial.legacy.model={id:f.context.current.modelVersionId,selectionRevision:f.context.current.selectionRevision,contentFingerprint:f.context.current.contentFingerprint};
  initial.legacy.preparation={aggregateId:f.context.current.aggregateId,geometryRevision:f.context.current.geometryRevision,
    captureFrameId:f.context.current.captureFrameId,projectionSha256:f.context.current.projectionSha256};
  initial.legacy.artifact={id:f.context.current.artifactId,sha256:f.context.current.projectionSha256};
  initial.response.route!.pathPoints=[{x:0,y:0,z:0},{x:2,y:3,z:4}];
  const x=syntheticInitialFillBarrierInputs(initial.legacy,initial.response),deps=x.dependencies;
  if(x.result.schemaVersion!=='pathfinder.model.response.v3'||x.result.barriers.schemaVersion!=='wfc.pf.barrier-execution.v1'
    ||deps.barriers.schemaVersion!=='wfc.pf.barrier-runtime.v1')throw Error('fixture');
  const execution=x.result.barriers,context=deps.barriers;
  deps.from={...deps.from,aggregateId:f.context.current.aggregateId,captureFrameId:f.context.current.captureFrameId,projectionSha256:f.context.current.projectionSha256};
  context.binding.snapshot!.mode='mesh-set';context.storage!.capture={blobId:id(810),sha256:'1'.repeat(64),bytes:1024};
  deps.options.barrierRouting!.expectedSnapshot=structuredClone(context.binding.snapshot);
  execution.context=structuredClone(context);execution.proof!.binding=structuredClone(context.binding);
  execution.proof!.status='clear-selected-scope';execution.proof!.checkedSegments=1;execution.proof!.reasonCode='REGISTERED_SCOPE_CLEAR';
  execution.directSecondary!.binding=structuredClone(context.binding);execution.diagnostics.status='clear';execution.diagnostics.reasonCode='SYNTHETIC_CLEAR';
  execution.qualification={captureSha256:'1'.repeat(64),pureVerificationSha256:'2'.repeat(64),decompositionSha256:'3'.repeat(64),
    computationalMemberships:[{computationalMeshId:'shell:000000',parentSelectionIds:[id(811)],fragmentIds:[1]}]};
  deps.to=endpointCalculationPoint(source);deps.endpointResolution.to.locationId=source.locationId;
  const fromSource=f.state.bindings.get(f.state.heads.get(f.resolved(command.names[0]))!)!;
  if(both){deps.from=endpointCalculationPoint(fromSource);deps.endpointResolution.from.locationId=fromSource.locationId;}
  const {calculationMode:_mode,...responseBody}=x.result;
  const success=engineResponseSchema.parse(responseBody),failed=structuredClone(success);
  if(failed.schemaVersion!=='pathfinder.model.response.v3')throw Error('fixture');
  failed.status='no_path';delete failed.route;delete failed.design;delete failed.lengthLedger;failed.barriers.proof=null;
  failed.barriers.diagnostics.status='blocked';failed.barriers.diagnostics.reasonCode=both?'BOTH_ENDPOINTS_IN_BARRIER':'TO_ENDPOINT_IN_BARRIER';
  const candidates=[...(both?[{side:'from' as const,source:fromSource,current:f.context.current}]:[]),{side:'to' as const,source,current:f.context.current}];
  const execute=vi.fn(async(request:ReturnType<typeof buildCableEngineRequest>)=>({request,response:engineResponseSchema.parse({...success,requestId:request.requestId})}));
  const validate=vi.fn((response:EngineResponse,trial:DependencySnapshot)=>{requireCableEngineStrategy(response,trial);requireCalculationLengthLedger(response,trial.settings);});
  const options={dependencies:deps,failedResult:failed,candidates,request:(trial:DependencySnapshot,key:string)=>buildCableEngineRequest(trial,key,30000),execute,validate,signal:new AbortController().signal};
  const base=f.client.query.getMockImplementation()!;
  f.client.query.mockImplementation(async(sql:string,args:unknown[]=[])=>{
    const key=String(args[1])+':'+String(args[2]);
    if(sql.startsWith('/* centre-fallback:command */')||sql.startsWith('/* centre-fallback:display-command */'))return {rows:f.state.commands.has(key)?[f.state.commands.get(key)!]:[]};
    if(sql.startsWith('/* centre-fallback:source-proposal */'))return {rows:[{dependencies:deps,result:{...failed,calculationMode:'calculate'},status:'no_path'}]};
    if(sql.startsWith('/* centre-fallback:original-head */')||sql.startsWith('/* centre-fallback:display-source */')){
      const record=f.state.bindings.get(String(args[2]));return {rows:record?[{record,record_sha256:record.contentSha256}]:[]};
    }
    if(sql.startsWith('INSERT INTO pf_endpoint_binding_commands')&&sql.includes("'confirm'")){
      f.state.commands.set(key,{kind:'confirm',request_sha256:String(args[3]),request:args[4],receipt:args[5]});return {rows:[]};
    }
    return base(sql,args);
  });
  const probe=()=>probeEquipmentCentreFallback(options);
  const input=async()=>{
    const p=(await probe())!;if(!p)throw Error('probe');
    const evidence={schemaVersion:'wfc.pf.endpoint-centre-fallback.v1' as const,sourceBindingId:source.id,sourceBindingSha256:source.contentSha256,
      current:f.context.current,commandId:equipmentCentreCommandId(source.id,p.dependencySha256),actorId:f.who.userId,sourceJobId:id(820),sourceCableId:deps.cableId,
      side:'to' as const,sourceDependencySha256:p.dependencySha256,failedRequestId:p.failedResult.requestId,failedResultSha256:endpointBindingHash(p.failedResult),
      trialRequestId:p.trialResult.requestId,trialRequestSha256:endpointBindingHash(p.trialRequest),trialResultSha256:endpointBindingHash(p.trialResult),
      barrierProofSha256:endpointBindingHash('barriers' in p.trialResult?p.trialResult.barriers?.proof:null),policy:'blocked-automatic-bottom-to-same-bounds-centre.v1' as const,
      approximate:true as const,engineeringAccepted:false as const,authority:'machine-derived-under-current-human-job' as const};
    return {source,current:f.context.current,evidence,proofRecord:equipmentCentreProofRecord(p)};
  };
  const append=async(value:Awaited<ReturnType<typeof input>>)=>endpointBindingTransaction(f.pool,f.projectId,f.who,c=>appendEquipmentCentreFallbackInTransaction(c,f.projectId,f.who,value));
  return {...f,source,deps,success,failed,options,execute,validate,probe,input,append};
}
describe('verified approximate equipment centre fallback',()=>{
  it('probes once at the same equipment centre with every original numeric option and barrier preserved',async()=>{
    const f=await fixture(),before=structuredClone(f.deps),p=await f.probe();
    expect(p?.trialResult.status).toBe('calculated');expect(f.execute).toHaveBeenCalledTimes(1);
    expect(p?.trialRequest.to).toEqual({x:2,y:3,z:4});expect(p?.trialRequest.barriers).toEqual(f.deps.barriers);
    expect(p?.trialRequest.requestId).not.toBe(f.failed.requestId);expect(f.deps).toEqual(before);expect(f.validate).toHaveBeenCalled();
  });
  it.each(['ENDPOINT_IN_BARRIER','CANDIDATE_PAIR_LIMIT','ENDPOINT_OCCUPANCY_INDETERMINATE','NO_PATH'])('does not guess a blocked side from %s',async reason=>{
    const f=await fixture();f.failed.barriers.diagnostics.reasonCode=reason;expect(await f.probe()).toBeNull();expect(f.execute).not.toHaveBeenCalled();
  });
  it('does not move a healthy auto endpoint when the failed side is manual or missing',async()=>{
    const f=await fixture();f.failed.barriers.diagnostics.reasonCode='FROM_ENDPOINT_IN_BARRIER';expect(await f.probe()).toBeNull();expect(f.execute).not.toHaveBeenCalled();
    f.failed.barriers.diagnostics.reasonCode='BOTH_ENDPOINTS_IN_BARRIER';expect(await f.probe()).toBeNull();expect(f.execute).not.toHaveBeenCalled();
  });
  it('refuses manual, picked, malformed and already-fallback heads',async()=>{
    const f=await fixture();for(const derivation of ['manual-world-point','picked-surface-point','matched-model-centre-fallback.v1'])
      expect(equipmentCentrePoint({...f.source,derivation} as EndpointBinding)).toBeNull();
    expect(equipmentCentrePoint({...f.source,contentSha256:'0'.repeat(64)})).toBeNull();
  });
  it('leaves the source unchanged on native no-path or cancellation',async()=>{
    const f=await fixture(),before=f.state.heads.get(f.source.locationId);f.execute.mockImplementationOnce(async request=>({request,response:{...f.failed,requestId:request.requestId}}));
    expect(await f.probe()).toBeNull();expect(f.state.heads.get(f.source.locationId)).toBe(before);
    const controller=new AbortController();controller.abort();await expect(probeEquipmentCentreFallback({...f.options,signal:controller.signal})).rejects.toThrow();
  });
  it('does not use incomplete, resource-limited or drilling observations to change a head',async()=>{
    const f=await fixture();f.failed.barriers.diagnostics.searchComplete=false;expect(blockedEquipmentSides(f.failed)).toEqual([]);
    f.failed.barriers.diagnostics.searchComplete=true;f.failed.status='resource_limit';expect(blockedEquipmentSides(f.failed)).toEqual([]);
    f.failed.status='no_path';f.failed.barriers.context.binding.policy.drillThroughWalls=true;expect(blockedEquipmentSides(f.failed)).toEqual([]);
  });
  it('retains the final native capacity attempt request ID rather than the initial probe ID',async()=>{
    const f=await fixture();f.execute.mockImplementationOnce(async request=>({request:{...request,requestId:id(889)},response:{...f.success,requestId:id(889)}}));
    const p=await f.probe();expect(p?.trialRequest.requestId).toBe(id(889));expect(p?.trialResult.requestId).toBe(id(889));
  });
  it('keeps unknown BC018/BC019 capacity warnings with disabled restrictions and allows the fully barrier-verified source append',async()=>{
    const f=await fixture();f.success.route!.routeCodes=['/BC018','/BC019'];f.success.route!.routeText='/BC018/BC019';
    const assessment={schemaVersion:'wfc.pf.tray-capacity-diagnostics.v1' as const,restrictionEnabled:false,minimumFreeSpacePercent:30,effectiveMinimumFreeSpacePercent:27,
      tolerancePercentagePoints:3 as const,occupancySha256:'a'.repeat(64),groupCableCount:1,blockedRouteCodes:[],unavailableRouteCodes:['/BC018','/BC019'],trays:[]};
    const context:TrayCapacityRoutingContext={policy:{enabled:false,minimumFreeSpacePercent:30,effectiveMinimumFreeSpacePercent:27,tolerancePercentagePoints:3},
      restrictionEnabled:false,minimumFreeSpacePercent:30,effectiveMinimumFreeSpacePercent:27,tolerancePercentagePoints:3,occupancySha256:'a'.repeat(64),groupCableCount:1,
      groupCableIds:[f.deps.cableId],groupKey:'group',routeCostMultipliers:[],parallelPowerTrayOccupancies:[],sameToGroupKey:'to',sameToGroupCableIds:[f.deps.cableId],preferredCorridors:[],settledSource:null,
      evaluate:()=>assessment,score:()=>({assessment,bottleneckOccupiedPercent:null,meanOccupiedPercent:null,knownTrayCount:0,unknownTrayCount:2,sharedSuffixRouteCodes:[]})};
    const p=(await probeEquipmentCentreFallback({...f.options,execute:async(request,trial)=>executeCapacityRouting({request,context,signal:f.options.signal,
      execute:async finalRequest=>({...f.success,requestId:finalRequest.requestId}),
      validate:response=>{requireCableEngineStrategy(response,trial);requireCalculationLengthLedger(response,trial.settings);}})}))!;
    expect(p.trialResult.trayCapacity).toMatchObject({restrictionEnabled:false,outcome:'unavailable',unavailableRouteCodes:['/BC018','/BC019']});
    expect(calculatedRouteCapacityBlocked(context.evaluate(p.trialResult.route!.routeCodes))).toBe(false);
    await endpointBindingTransaction(f.pool,f.projectId,f.who,c=>appendEquipmentCentreProbe(c,{projectId:f.projectId,jobId:id(820),cableId:f.deps.cableId,principal:f.who,
      probe:p,finiteDeadline:Date.now()+10000,signal:f.options.signal}));
    const after=f.state.bindings.get(f.state.heads.get(f.source.locationId)!)!;expect(after.pointProjectMetres).toEqual([2,3,4]);
    const saved=f.state.commands.get(f.who.userId+':'+after.centreFallbackEvidence!.commandId)!;
    expect((saved.request as {proof:{trialResult:EngineResponse}}).proof.trialResult.trayCapacity?.unavailableRouteCodes).toEqual(['/BC018','/BC019']);
  });
  it('refuses a verified centre source append when enabled restrictions assess a genuinely blocked tray',async()=>{
    const f=await fixture(),p=(await f.probe())!,before=structuredClone(f.state.heads);
    const checked={restrictionEnabled:true,blockedRouteCodes:['/BC018'],unavailableRouteCodes:['/BC019']};
    if(!calculatedRouteCapacityBlocked(checked))await endpointBindingTransaction(f.pool,f.projectId,f.who,c=>appendEquipmentCentreProbe(c,
      {projectId:f.projectId,jobId:id(820),cableId:f.deps.cableId,principal:f.who,probe:p,finiteDeadline:Date.now()+10000,signal:f.options.signal}));
    expect(calculatedRouteCapacityBlocked(checked)).toBe(true);expect(f.state.heads).toEqual(before);
    expect(f.queries.some(sql=>sql.includes('/* centre-fallback:source-proposal */'))).toBe(false);
  });
  it('rejects missing final proof and forged terminal points despite successful status',async()=>{
    const f=await fixture();f.execute.mockImplementationOnce(async request=>{
      const response=structuredClone(f.success);if(response.schemaVersion==='pathfinder.model.response.v3')response.barriers.proof!.routeSha256='0'.repeat(64);
      return {request,response:{...response,requestId:request.requestId}};
    });await expect(f.probe()).rejects.toThrow();expect(f.state.heads.get(f.source.locationId)).toBe(f.source.id);
  });
  it('appends an auditable source revision once and enables ordinary all-sharing generation dirtiness',async()=>{
    const f=await fixture(),value=await f.input(),receipt=await f.append(value);
    expect(receipt.binding).toMatchObject({derivation:'matched-model-centre-fallback.v1',pointProjectMetres:[2,3,4],supersedesBindingId:f.source.id,
      autoMatchEvidence:{sdkObjectId:f.source.autoMatchEvidence!.sdkObjectId},centreFallbackEvidence:{approximate:true,engineeringAccepted:false}});
    expect(f.queries).toContain("SET LOCAL wfc.pathfinder_location_impact='0'");
    expect((await f.append(value)).binding.id).toBe(receipt.binding.id);expect(f.state.bindings.size).toBe(4);
    const context=await f.repo.context(f.projectId,f.who);expect(context.current).toEqual(f.context.current);
    const display=await readCableEndpointDisplay(f.client as unknown as PoolClient,{projectId:f.projectId,current:f.context.current,
      location:{...f.state.locations.get(f.source.locationId)!,aliases:[]},head:receipt.binding},()=>{});
    expect(display).toMatchObject({sdkObjectId:f.source.autoMatchEvidence!.sdkObjectId,pointProjectMetres:[2,3,4],bindingId:receipt.binding.id});
    expect(evaluateCrossModelEndpointMatch({previous:receipt.binding,locationRevision:receipt.binding.locationRevision,currentModelVersionId:id(999),logicalName:'Equipment',candidates:f.command().scan.candidates}))
      .toMatchObject({accepted:true,distanceMetres:0});
  });
  it.each(['healthy-side','wrong-centre','different-head','changed-model','proof-hash'])('rolls back %s without overwriting a source',async kind=>{
    const f=await fixture(),value=await f.input(),before=structuredClone(f.state.heads);
    if(kind==='healthy-side')value.evidence.side='from' as 'to';
    if(kind==='wrong-centre'){
      (value.proofRecord.trialRequest as Record<string,unknown>).to={x:2,y:3,z:4.1};value.evidence.trialRequestSha256=endpointBindingHash(value.proofRecord.trialRequest);
    }
    if(kind==='different-head')f.state.heads.set(f.source.locationId,id(991));
    if(kind==='changed-model')value.current={...value.current,modelVersionId:id(992)};
    if(kind==='proof-hash')value.evidence.barrierProofSha256='0'.repeat(64);
    await expect(f.append(value)).rejects.toThrow();if(kind!=='different-head')expect(f.state.heads).toEqual(before);
  });
  it('keeps the separate centre provenance mandatory and formula exact',async()=>{
    const f=await fixture(),receipt=await f.append(await f.input());
    expect(endpointBindingSchema.safeParse({...receipt.binding,centreFallbackEvidence:undefined}).success).toBe(false);
    expect(endpointBindingSchema.safeParse({...receipt.binding,pointProjectMetres:[2,3,4.00001]}).success).toBe(false);
  });
  it('preserves the current-model centre when Find and assign runs again',async()=>{
    const f=await fixture(),receipt=await f.append(await f.input()),command=f.command();command.idempotencyKey=id(831);
    const result=await f.repo.assign(f.projectId,f.who,command);
    expect(result.results.find(r=>r.locationId===f.source.locationId)?.status).toBe('preserved');
    expect(f.state.heads.get(f.source.locationId)).toBe(receipt.binding.id);
  });
  it('keeps source-object display and centre coordinates through a same-model carry',async()=>{
    const f=await fixture(),receipt=await f.append(await f.input()),binding=receipt.binding,current=f.context.current;
    const draft={...binding,id:id(840),bindingRevision:'3',supersedesBindingId:binding.id,sameModelReuse:{schemaVersion:'wfc.pf.endpoint-same-model-reuse.v1' as const,
      sourceBindingId:binding.id,sourceBindingSha256:binding.contentSha256,originalBindingId:binding.id,originalBindingSha256:binding.contentSha256,
      sourceAggregateId:binding.aggregateId,sourceArtifactId:binding.artifactId,sourceProjectionSha256:binding.projectionSha256,sourceCaptureFrameId:binding.captureFrameId,
      modelVersionId:binding.modelVersionId,contentFingerprint:current.contentFingerprint,frameProjectionSha256:'a'.repeat(64),sourceTraceId:current.traceId!,sourceTraceContentSha256:'b'.repeat(64),
      targetTraceId:current.traceId!,targetTraceContentSha256:'b'.repeat(64),requalifiedBy:f.who.userId,requalifiedAt:new Date().toISOString()}};
    const {contentSha256:_old,...body}=draft,carried=endpointBindingSchema.parse({...body,contentSha256:endpointBindingHash(body)});
    const display=await readCableEndpointDisplay(f.client as unknown as PoolClient,{projectId:f.projectId,current,
      location:{...f.state.locations.get(f.source.locationId)!,aliases:[]},head:carried},()=>{});
    expect(display).toMatchObject({pointProjectMetres:[2,3,4],bindingId:id(840),sdkObjectId:binding.autoMatchEvidence!.sdkObjectId});
  });
  it('refuses a corrupted machine receipt when recovering object display',async()=>{
    const f=await fixture(),receipt=await f.append(await f.input()),binding=receipt.binding;
    const saved=f.state.commands.get(f.who.userId+':'+binding.centreFallbackEvidence!.commandId)!;
    (saved.receipt as {binding:EndpointBinding}).binding={...binding,contentSha256:'0'.repeat(64)};
    expect(await readCableEndpointDisplay(f.client as unknown as PoolClient,{projectId:f.projectId,current:f.context.current,
      location:{...f.state.locations.get(f.source.locationId)!,aliases:[]},head:binding},()=>{})).toBeNull();
  });
  it('checks BOTH blocked endpoints in one full trial and commits both source heads in one transaction',async()=>{
    const f=await fixture(true),p=(await f.probe())!;
    expect(f.execute).toHaveBeenCalledTimes(1);expect(p.trialRequest.from).toEqual({x:0,y:0,z:0});expect(p.trialRequest.to).toEqual({x:2,y:3,z:4});
    await endpointBindingTransaction(f.pool,f.projectId,f.who,c=>appendEquipmentCentreProbe(c,{projectId:f.projectId,jobId:id(820),cableId:f.deps.cableId,
      principal:f.who,probe:p,finiteDeadline:Date.now()+10000,signal:new AbortController().signal}));
    for(const candidate of p.candidates)expect(f.state.bindings.get(f.state.heads.get(candidate.source.locationId)!)?.derivation).toBe('matched-model-centre-fallback.v1');
    expect(f.state.bindings.size).toBe(5);
  });
  it('rolls back BOTH heads when finite authority expires after the source append',async()=>{
    const f=await fixture(true),p=(await f.probe())!,heads=structuredClone(f.state.heads),before=f.state.bindings.size,now=Date.now();
    const base=f.client.query.getMockImplementation()!,clock=vi.spyOn(Date,'now').mockReturnValue(now);
    f.client.query.mockImplementation(async(sql:string,args:unknown[]=[])=>{const result=await base(sql,args);if(sql.startsWith('INSERT INTO pf_endpoint_binding_commands'))clock.mockReturnValue(now+101);return result;});
    try{
      await expect(endpointBindingTransaction(f.pool,f.projectId,f.who,c=>appendEquipmentCentreProbe(c,{projectId:f.projectId,jobId:id(820),cableId:f.deps.cableId,
        principal:f.who,probe:p,finiteDeadline:now+100,signal:new AbortController().signal}))).rejects.toMatchObject({code:'AUTOMATIC_AUTHORITY_EXPIRED'});
      expect(f.state.heads).toEqual(heads);expect(f.state.bindings.size).toBe(before);
    }finally{clock.mockRestore();}
  });
  it('retires only the old owner quantum after committed heads without publishing the probe or pausing fresh automatic work',async()=>{
    const query=vi.fn(async(_sql:string,_args:unknown[])=>({rows:[]}));await retireCentreSupersededJob({query} as unknown as PoolClient,{projectId:id(1),jobId:id(2),ownerToken:id(3)});
    expect(query).toHaveBeenCalledTimes(2);expect(query.mock.calls[1][1]).toEqual([id(1),id(2),id(3)]);
    const sql=query.mock.calls.map(call=>call[0]).join('\n');expect(sql).toContain("state='cancelled'");expect(sql).toContain("owner_token=$3");
    expect(sql).not.toMatch(/pf_proposals|cables SET|pf_recalculation_state|pf_apply_receipts|paused=true/);
  });
});
