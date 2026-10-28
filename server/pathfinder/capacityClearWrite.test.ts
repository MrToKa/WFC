// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PoolClient } from 'pg';
import { syntheticBarrierWriteInputs } from './barrierWriteFixtures.js';
import { automaticPairHash } from './automaticPairReceiptProof.js';
import { isCapacityNoPathResult, validCapacityClearEvidence, automaticPairCapacityClearTransition, readCurrentCapacityClearEvidence,
  capacityClearItemApplicable, readCurrentPositiveCapacity } from './capacityClearWrite.js';
import type { TrayCapacityDiagnostics } from '../../shared/pathfinderTrayCapacity.js';
import { readTrayCapacityRouting } from './trayCapacityRouting.js';
import { readLocationImpactJobAuthority } from './locationImpactRepository.js';
import { readRecalculationJobAuthority } from './recalculationRepository.js';
import { requireCurrentAutomaticPairMandate } from './automaticPairMandates.js';
import type { AutomaticPairMandate } from '../../shared/pathfinderAutomaticPair.js';
vi.mock('./automaticPairMandates.js', () => ({ requireCurrentAutomaticPairMandate: vi.fn(async (_client, mandate) => mandate) }));
vi.mock('./trayCapacityRouting.js',async original=>({...await original<typeof import('./trayCapacityRouting.js')>(),readTrayCapacityRouting:vi.fn()}));
vi.mock('./locationImpactRepository.js',async original=>({...await original<typeof import('./locationImpactRepository.js')>(),readLocationImpactJobAuthority:vi.fn()}));
vi.mock('./recalculationRepository.js',async original=>({...await original<typeof import('./recalculationRepository.js')>(),readRecalculationJobAuthority:vi.fn()}));
beforeEach(()=>vi.clearAllMocks());

function positiveFixture(){
  const {dependencies,result}=syntheticBarrierWriteInputs();
  dependencies.settings.trayCapacity={enabled:true,minimumFreeSpacePercent:42,tolerancePercentagePoints:3,layoutSha256:'c'.repeat(64)};
  const checked:TrayCapacityDiagnostics={schemaVersion:'wfc.pf.tray-capacity-diagnostics.v1',minimumFreeSpacePercent:42,effectiveMinimumFreeSpacePercent:39,
    tolerancePercentagePoints:3,restrictionEnabled:true,occupancySha256:'f'.repeat(64),groupCableCount:2,blockedRouteCodes:[],unavailableRouteCodes:[],
    trays:[{routeCode:'/A',freeSpacePercent:39,status:'fits'}]};
  const evaluate=vi.fn(()=>checked),context={policy:{enabled:true},minimumFreeSpacePercent:42,effectiveMinimumFreeSpacePercent:39,tolerancePercentagePoints:3,evaluate};
  vi.mocked(readTrayCapacityRouting).mockResolvedValue(context as never);
  const client={} as PoolClient,input={dependencies,result,jobId:'b7700000-0000-4000-8000-000000000004'};
  return{dependencies,result,checked,evaluate,context,client,input};
}

describe('current positive automatic-pair capacity fence',()=>{
  it('checks the actual complete route and exact job under the transaction at the configured tolerance',async()=>{
    const f=positiveFixture();expect(await readCurrentPositiveCapacity(f.client,f.input)).toBe(true);
    expect(readTrayCapacityRouting).toHaveBeenCalledWith(f.client,{projectId:f.dependencies.projectId,cableId:f.dependencies.cableId,jobId:f.input.jobId});
    expect(f.evaluate).toHaveBeenCalledWith(f.result.route!.routeCodes);
  });
  it.each(['blocked list','blocked assessment'] as const)('refuses newly overfilled placement from %s',async kind=>{
    const f=positiveFixture();f.checked.trays[0]={routeCode:'/A',freeSpacePercent:38,status:'below-minimum'};
    if(kind==='blocked list')f.checked.blockedRouteCodes=['/A'];
    expect(await readCurrentPositiveCapacity(f.client,f.input)).toBe(false);
  });
  it('keeps unknown placement inputs eligible with the existing warning policy',async()=>{
    const f=positiveFixture();f.checked.trays[0]={routeCode:'/A',freeSpacePercent:null,status:'unavailable'};f.checked.unavailableRouteCodes=['/A'];
    expect(await readCurrentPositiveCapacity(f.client,f.input)).toBe(true);
    f.dependencies.settings.trayCapacity!.minimumFreeSpacePercent=null;
    Object.assign(f.context,{minimumFreeSpacePercent:null,effectiveMinimumFreeSpacePercent:null});
    Object.assign(f.checked,{minimumFreeSpacePercent:null,effectiveMinimumFreeSpacePercent:null,policyIssue:'CAPACITY_MINIMUM_REQUIRED'});
    expect(await readCurrentPositiveCapacity(f.client,f.input)).toBe(true);
  });
  it.each(['missing context','changed restriction','changed minimum'] as const)('refuses %s without guessing current placement',async kind=>{
    const f=positiveFixture();if(kind==='missing context')vi.mocked(readTrayCapacityRouting).mockResolvedValue(null);
    if(kind==='changed restriction')f.context.policy.enabled=false;
    if(kind==='changed minimum')f.context.minimumFreeSpacePercent=43;
    expect(await readCurrentPositiveCapacity(f.client,f.input)).toBe(false);
  });
  it('skips all placement reads with the restriction OFF and rejects a non-successful ON result',async()=>{
    const f=positiveFixture();delete f.dependencies.settings.trayCapacity;
    expect(await readCurrentPositiveCapacity(f.client,f.input)).toBe(true);expect(readTrayCapacityRouting).not.toHaveBeenCalled();
    f.dependencies.settings.trayCapacity={enabled:true,minimumFreeSpacePercent:42,tolerancePercentagePoints:3,layoutSha256:'c'.repeat(64)};
    f.result.status='no_path';expect(await readCurrentPositiveCapacity(f.client,f.input)).toBe(false);expect(readTrayCapacityRouting).not.toHaveBeenCalled();
  });
  it('propagates cancellation before current placement can authorize a write',async()=>{
    const f=positiveFixture(),controller=new AbortController();controller.abort();
    await expect(readCurrentPositiveCapacity(f.client,f.input,controller.signal)).rejects.toMatchObject({name:'AbortError'});
    expect(readTrayCapacityRouting).not.toHaveBeenCalled();
  });
});

function fixture(){
  const {dependencies,result}=syntheticBarrierWriteInputs();
  dependencies.settings.trayCapacity={enabled:true,minimumFreeSpacePercent:42,tolerancePercentagePoints:3,layoutSha256:'c'.repeat(64)};
  const checked={schemaVersion:'wfc.pf.tray-capacity-diagnostics.v1' as const,minimumFreeSpacePercent:42,effectiveMinimumFreeSpacePercent:39,
    tolerancePercentagePoints:3 as const,occupancySha256:'f'.repeat(64),groupCableCount:2,blockedRouteCodes:['/A'],unavailableRouteCodes:[],
    trays:[{routeCode:'/A',freeSpacePercent:20,status:'below-minimum' as const}]};
  Object.assign(result,{status:'no_path',trayCapacity:{...checked,outcome:'no-capacity',attempts:2,excludedRouteCodes:['/A']}});
  delete result.route;delete result.design;delete result.lengthLedger;
  if(result.schemaVersion==='pathfinder.model.response.v3')Object.assign(result.barriers,{proof:null,qualification:null,directSecondary:null,
    connectors:{from:null,to:null},diagnostics:{...result.barriers.diagnostics,status:'blocked'}});
  const evidence={schemaVersion:'wfc.pf.capacity-clear-evidence.v1' as const,projectId:dependencies.projectId,cableId:dependencies.cableId,
    dependencySha256:automaticPairHash(dependencies),engineResultSha256:automaticPairHash(result),verifiedExclusions:checked};
  return{dependencies,result,evidence};
}
describe('audited capacity no-path withdrawal',()=>{
  it.each(['explicit-job','automatic-generation','location-impact'] as const)('allows a ready capacity item only under its current %s output mandate before siblings finish',async kind=>{
    const f=fixture(),client={} as PoolClient,input={projectId:f.dependencies.projectId,jobId:'b7700000-0000-4000-8000-000000000004',cableId:f.dependencies.cableId,jobState:'running',cancelRequested:false};
    const mandate={...input,source:{kind}} as unknown as AutomaticPairMandate;
    expect(await capacityClearItemApplicable(client,input,mandate)).toBe(true);
    expect(requireCurrentAutomaticPairMandate).toHaveBeenCalledExactlyOnceWith(client,mandate);
    expect(readLocationImpactJobAuthority).not.toHaveBeenCalled();expect(readRecalculationJobAuthority).not.toHaveBeenCalled();
  });
  it.each(['projectId','jobId','cableId'] as const)('refuses borrowing an output mandate with another capacity %s',async field=>{
    const f=fixture(),client={} as PoolClient,input={projectId:f.dependencies.projectId,jobId:'b7700000-0000-4000-8000-000000000004',cableId:f.dependencies.cableId,jobState:'running',cancelRequested:false};
    const mandate={...input,[field]:'b7700000-0000-4000-8000-000000000099',source:{kind:'explicit-job'}} as unknown as AutomaticPairMandate;
    expect(await capacityClearItemApplicable(client,input,mandate)).toBe(false);expect(requireCurrentAutomaticPairMandate).not.toHaveBeenCalled();
  });
  it('does not clear with a cancelled item or expired output mandate',async()=>{
    const f=fixture(),client={} as PoolClient,input={projectId:f.dependencies.projectId,jobId:'b7700000-0000-4000-8000-000000000004',cableId:f.dependencies.cableId,jobState:'running',cancelRequested:false};
    const mandate={...input,source:{kind:'explicit-job'}} as unknown as AutomaticPairMandate;
    expect(await capacityClearItemApplicable(client,{...input,cancelRequested:true},mandate)).toBe(false);expect(requireCurrentAutomaticPairMandate).not.toHaveBeenCalled();
    vi.mocked(requireCurrentAutomaticPairMandate).mockRejectedValueOnce(Object.assign(new Error('Expired'),{code:'AUTOMATIC_PAIR_AUTHORITY_EXPIRED'}));
    await expect(capacityClearItemApplicable(client,input,mandate)).rejects.toMatchObject({code:'AUTOMATIC_PAIR_AUTHORITY_EXPIRED'});
  });
  it('rechecks the exact original job occupancy and every excluded tray under the current transaction',async()=>{
    const f=fixture(),client={} as PoolClient,evaluate=vi.fn(()=>f.evidence.verifiedExclusions);
    vi.mocked(readTrayCapacityRouting).mockResolvedValue({evaluate} as never);
    const evidence=await readCurrentCapacityClearEvidence(client,{dependencies:f.dependencies,result:f.result,jobId:'b7700000-0000-4000-8000-000000000004'});
    expect(evidence).toEqual(f.evidence);expect(evaluate).toHaveBeenCalledWith(['/A']);
    expect(readTrayCapacityRouting).toHaveBeenCalledWith(client,{projectId:f.dependencies.projectId,cableId:f.dependencies.cableId,jobId:'b7700000-0000-4000-8000-000000000004'});
    evaluate.mockReturnValue({...f.evidence.verifiedExclusions,occupancySha256:'e'.repeat(64)});
    expect(await readCurrentCapacityClearEvidence(client,{dependencies:f.dependencies,result:f.result,jobId:'b7700000-0000-4000-8000-000000000004'})).toBeNull();
  });
  it('keeps independently finished location jobs valid but refuses cancelled, revoked or unfinished ordinary jobs',async()=>{
    const client={} as PoolClient,input={projectId:'b7700000-0000-4000-8000-000000000001',jobId:'b7700000-0000-4000-8000-000000000004',
      cableId:'b7700000-0000-4000-8000-000000000002',jobState:'running',cancelRequested:false};
    vi.mocked(readLocationImpactJobAuthority).mockResolvedValue({enrolled:true,valid:true} as never);
    expect(await capacityClearItemApplicable(client,input)).toBe(true);
    vi.mocked(readLocationImpactJobAuthority).mockResolvedValue({enrolled:true,valid:false} as never);
    expect(await capacityClearItemApplicable(client,input)).toBe(false);
    vi.mocked(readLocationImpactJobAuthority).mockResolvedValue(null);
    vi.mocked(readRecalculationJobAuthority).mockResolvedValue({enrolled:false,valid:false} as never);
    expect(await capacityClearItemApplicable(client,input)).toBe(false);
    expect(await capacityClearItemApplicable(client,{...input,jobState:'complete'})).toBe(true);
    expect(await capacityClearItemApplicable(client,{...input,jobState:'complete',cancelRequested:true})).toBe(false);
  });
  it('recognizes only a bounded protected no-path under the configured project threshold',()=>{
    const f=fixture();expect(isCapacityNoPathResult(f.dependencies,f.result)).toBe(true);expect(validCapacityClearEvidence(f.dependencies,f.result,f.evidence)).toBe(true);
  });
  it('rejects an explicitly disabled restriction in a sealed result while retaining historical absence',()=>{
    const f=fixture();expect(isCapacityNoPathResult(f.dependencies,f.result)).toBe(true);
    f.result.trayCapacity!.restrictionEnabled=true;
    expect(isCapacityNoPathResult(f.dependencies,f.result)).toBe(true);
    f.result.trayCapacity!.restrictionEnabled=false;
    f.evidence.engineResultSha256=automaticPairHash(f.result);
    expect(isCapacityNoPathResult(f.dependencies,f.result)).toBe(false);
    expect(validCapacityClearEvidence(f.dependencies,f.result,f.evidence)).toBe(false);
  });
  it('rejects current or historical exclusion evidence that explicitly disables the restriction',async()=>{
    const f=fixture(),client={} as PoolClient;
    Object.assign(f.evidence.verifiedExclusions,{restrictionEnabled:false});
    expect(validCapacityClearEvidence(f.dependencies,f.result,f.evidence)).toBe(false);
    vi.mocked(readTrayCapacityRouting).mockResolvedValue({evaluate:()=>f.evidence.verifiedExclusions} as never);
    expect(await readCurrentCapacityClearEvidence(client,{dependencies:f.dependencies,result:f.result,jobId:'b7700000-0000-4000-8000-000000000004'})).toBeNull();
  });
  it.each(['generic no path','search limit','disabled','different minimum','not calculate','no exclusions'] as const)('rejects %s',kind=>{
    const f=fixture();if(kind==='generic no path')delete f.result.trayCapacity;
    if(kind==='search limit')f.result.trayCapacity!.outcome='search-limit';
    if(kind==='disabled')delete f.dependencies.settings.trayCapacity;
    if(kind==='different minimum')f.result.trayCapacity!.minimumFreeSpacePercent=30;
    if(kind==='not calculate')Object.assign(f.result,{calculationMode:'design'});
    if(kind==='no exclusions')f.result.trayCapacity!.excludedRouteCodes=[];
    expect(isCapacityNoPathResult(f.dependencies,f.result)).toBe(false);
  });
  it.each(['stale occupancy','extra exclusion','fitting tray','changed result','wrong cable'] as const)('refuses %s at the immutable receipt boundary',kind=>{
    const f=fixture();if(kind==='stale occupancy')f.evidence.verifiedExclusions.occupancySha256='e'.repeat(64);
    if(kind==='extra exclusion')f.evidence.verifiedExclusions.blockedRouteCodes.push('/B');
    if(kind==='fitting tray')f.evidence.verifiedExclusions.trays[0].freeSpacePercent=80;
    if(kind==='changed result')f.result.message='Changed';if(kind==='wrong cable')f.evidence.cableId=f.dependencies.projectId;
    expect(validCapacityClearEvidence(f.dependencies,f.result,f.evidence)).toBe(false);
  });
  it('permits only the automatic route/design pair and a unit revision transition',()=>{
    const f=fixture(),before={id:f.dependencies.cableId,project_id:f.dependencies.projectId,routing:'/A',design_length:'7',install_length:'99',tag:'T',cable_write_revision:'7'};
    const after={...before,routing:null,design_length:null,cable_write_revision:'8'};
    expect(automaticPairCapacityClearTransition(before.project_id,before.id,before,after)).toBe(true);
    expect(automaticPairCapacityClearTransition(before.project_id,before.id,before,{...after,install_length:'0'})).toBe(false);
    expect(automaticPairCapacityClearTransition(before.project_id,before.id,before,{...after,tag:'Changed'})).toBe(false);
    expect(automaticPairCapacityClearTransition(before.project_id,before.id,before,{...after,cable_write_revision:'9'})).toBe(false);
  });
});
