// @vitest-environment node
import type { PoolClient } from 'pg';
import { describe, expect, it, vi } from 'vitest';
import { syntheticBarrierWriteInputs } from './barrierWriteFixtures.js';
import { hash } from './dependencies.js';
import { buildAutoLengthSource } from './autoLengthStore.js';
import { revisionResultEnvelopeSchema } from '../../shared/pathfinderRevisionResults.js';
import { readCurrentAutomaticRouting } from './currentAutomaticRouting.js';
import { PathFinderError } from './errors.js';

function fixture(){
  const f=syntheticBarrierWriteInputs(),d=f.dependencies,projectId=d.projectId,cableId=d.cableId,jobId=f.id(101),proposalId=f.id(102),baselineHash='c'.repeat(64);
  f.result.route!.routeCodes=['/A'];
  const body={schemaVersion:'wfc.pf.cable-revision-result.v1',id:f.id(103),projectId,cableId,jobId,proposalId,admissionId:f.id(104),
    proposalHash:hash({dependencies:d,result:f.result,baselineHash}),baselineHash,dependencyHash:hash(d),engineResultSha256:hash(f.result),ledgerHash:hash(f.result.lengthLedger),oldModel:null,
    summary:{calculationMode:'calculate',newModel:d.model,routeText:'/A',rawLengthMeters:5,designLengthMeters:'7',unroundedMeters:'6.6',
      delta:{rawLengthMeters:null,designLengthMeters:null,unroundedMeters:null,baseline:'unavailable'},reasonCodes:[]},comparisonRef:null,observedEvents:[],lengthLedger:f.result.lengthLedger,
    physicalChangeProven:false,createdAt:'2026-11-15T10:00:00.000Z'};
  const seal=revisionResultEnvelopeSchema.parse({...body,revisionResultSha256:hash(body)}),source=buildAutoLengthSource({projectId,cableId,jobId,proposalId,dependencies:d,result:f.result,seal,admissionOrdinal:'1'});
  const row={dependencies:d,result:f.result,record:seal,source,source_sha256:hash(source),proposal_id:proposalId,status:'calculated'};
  const current=structuredClone(d),query=vi.fn(async()=>({rows:[row]}));
  const collect=vi.fn(async()=>({dependencies:current,cable:{},status:'ready',message:''}));
  const barrierFence=vi.fn(async()=>d.engineIdentity),capacity=vi.fn(async()=>null);
  const run=()=>readCurrentAutomaticRouting({query} as unknown as PoolClient,projectId,cableId,{collect,barrierFence,capacity});
  const rebind=()=>{
    row.record.engineResultSha256=hash(row.result);row.record.dependencyHash=hash(row.dependencies);
    row.record.proposalHash=hash({dependencies:row.dependencies,result:row.result,baselineHash:row.record.baselineHash});
    const{revisionResultSha256:_old,...body}=row.record;row.record.revisionResultSha256=hash(body);
    row.source=buildAutoLengthSource({projectId,cableId,jobId,proposalId,dependencies:row.dependencies,result:row.result,seal:row.record,admissionOrdinal:'1'});
    row.source_sha256=hash(row.source);
  };
  return{f,row,current,query,collect,barrierFence,capacity,run,rebind};
}
describe('current automatic fallback from a fresh release action',()=>{
  it('uses only a fully sealed current source, ignoring incidental business write revision',async()=>{
    const f=fixture();f.current.cableWriteRevision='999';expect(await f.run()).toBe('/A');expect(f.barrierFence).toHaveBeenCalledTimes(2);
  });
  it.each(['model','endpoint','settings','purpose','geometry'] as const)('keeps a prior %s source display-only',async kind=>{
    const f=fixture();if(kind==='model')f.current.model.selectionRevision='99';if(kind==='endpoint')Object.assign(f.current.from,{bindingRevision:'99'});
    if(kind==='settings')f.current.settings.endConnectionLength='20';if(kind==='purpose')f.current.cableInputs.cableTypeId=f.f.id(999);
    if(kind==='geometry')f.current.preparation.geometryRevision='99';expect(await f.run()).toBeNull();
  });
  it('refuses a stale barrier or implementation and a corrupt source hash',async()=>{
    const f=fixture();f.barrierFence.mockRejectedValue(new PathFinderError('PROPOSAL_STALE',409));expect(await f.run()).toBeNull();
    const other=fixture();other.row.source_sha256='0'.repeat(64);expect(await other.run()).toBeNull();expect(other.collect).not.toHaveBeenCalled();
  });
  it('treats malformed bounded proof data as unavailable instead of rejecting unrelated import rows',async()=>{
    const f=fixture();f.row.dependencies={schemaVersion:'pathfinder.dependencies.v8'} as never;expect(await f.run()).toBeNull();
  });
  it('refuses current capacity conflicts instead of restoring a historical route',async()=>{
    const f=fixture();f.capacity.mockResolvedValue({restrictionEnabled:true,evaluate:()=>({blockedRouteCodes:['/A'],unavailableRouteCodes:[]})} as never);
    expect(await f.run()).toBeNull();
  });
  it('does not turn a database transport failure into an empty fallback',async()=>{
    const f=fixture();f.query.mockRejectedValue(new Error('Transport disconnected'));await expect(f.run()).rejects.toThrow('Transport disconnected');
  });
  it.each(['seal route','code concatenation','purpose'] as const)('rejects a self-consistent source with crossed %s semantics',async kind=>{
    const f=fixture();if(kind==='seal route')f.row.record.summary.routeText='/B';
    if(kind==='code concatenation')f.row.result.route!.routeCodes=['A'];
    if(kind==='purpose'){f.row.dependencies.cablePurposeRouting={purpose:'Control',allowedRouteCodes:['/B']};f.current.cablePurposeRouting=f.row.dependencies.cablePurposeRouting;}
    f.rebind();expect(await f.run()).toBeNull();
  });
});
