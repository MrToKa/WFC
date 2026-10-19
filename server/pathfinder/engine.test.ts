// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { runEngine } from './engine.js';
import { syntheticGapSnapshot, syntheticStraightSnapshot } from './syntheticFixture.js';
import { defaultOptions, optionsSchema, routeCompatibilityIssue } from './jobContracts.js';
import { geometryHash, hash } from './dependencies.js';
import type { DependencySnapshot } from './jobContracts.js';
import { nextAutomaticCursor } from './worker.js';

const saved = {root:process.env.PF_ROOT,dll:process.env.PF_ENGINE_DLL};
const projectId = randomUUID(),modelVersionId = randomUUID(),snapshotId = randomUUID(),gapSnapshotId=randomUUID();
let root:string,sha256:string,gapSha256:string;
beforeAll(async () => {
  root = path.resolve('pathfinder-engine/.scratch/engine-client-'+randomUUID());
  await fs.mkdir(path.join(root,'snapshots'),{recursive:true});
  const bytes = Buffer.from(JSON.stringify(syntheticStraightSnapshot(projectId,modelVersionId,'a'.repeat(64))));
  sha256 = createHash('sha256').update(bytes).digest('hex');
  await fs.writeFile(path.join(root,'snapshots',snapshotId+'.json'),bytes,{flag:'wx'});
  const gapBytes=Buffer.from(JSON.stringify(syntheticGapSnapshot(projectId,modelVersionId,'a'.repeat(64))));
  gapSha256=createHash('sha256').update(gapBytes).digest('hex');
  await fs.writeFile(path.join(root,'snapshots',gapSnapshotId+'.json'),gapBytes,{flag:'wx'});
  process.env.PF_ROOT = root; process.env.PF_ENGINE_DLL = process.env.PF_MODEL_RUNNER_DLL ?? path.resolve('pathfinder-engine/tools/PathFinder.ModelRunner/bin/Release/net9.0/PathFinder.ModelRunner.dll');
});
afterAll(() => {
  if (saved.root === undefined) delete process.env.PF_ROOT; else process.env.PF_ROOT = saved.root;
  if (saved.dll === undefined) delete process.env.PF_ENGINE_DLL; else process.env.PF_ENGINE_DLL = saved.dll;
});
function request() {
  return {schemaVersion:'pathfinder.model.runner.v1',requestId:randomUUID(),operation:'calculate',projectId,modelVersionId,snapshotId,snapshotSha256:sha256,timeoutMilliseconds:30000,
    category:'Instrumentation',from:{x:0,y:0,z:.5},to:{x:10,y:0,z:.5},options:{...defaultOptions,preferVerticalApproach:false},
    projectSettings:{revision:'1',secondaryTrayLength:'5',endConnectionLength:'6',additionalBendingPercent:'10'}};
}
describe('actual .NET private process through production Node client',() => {
  it('calculates exact real Core fixture and maps Instrumentation to Control',async () => {
    const result = await runEngine(request(),new AbortController().signal);
    expect(result.status).toBe('calculated'); expect(result.effectiveCategory).toBe('Control'); expect(result.route?.lengthMeters).toBe(10); expect(result.design?.designLengthMeters).toBe('18');
    expect(result.engineeringAccepted).toBe(false); expect(result.route?.segmentIds).toEqual(['synthetic:tray-1']);
  },40000);
  it('preserves smallest decimal through C# and the production response validator',async () => {
    const result = await runEngine({...request(),operation:'design',route:{success:true,lengthMeters:0,fromDistanceMeters:0,toDistanceMeters:0,fromRequiresSecondary:false,toRequiresSecondary:false},
      projectSettings:{revision:'2',secondaryTrayLength:null,endConnectionLength:'0.0000000000000000000000000001',additionalBendingPercent:'0'}},new AbortController().signal);
    expect(result.status).toBe('calculated'); expect(result.design?.unroundedLengthMeters).toBe('0.0000000000000000000000000001'); expect(result.design?.designLengthMeters).toBe('1');
  },40000);
  it('does not infer success from a zero exit code',async () => expect((await runEngine({...request(),category:'unknown'},new AbortController().signal)).status).toBe('category_required'),40000);
  it('rejects cross-project artifact scope in the real child',async () => expect((await runEngine({...request(),projectId:randomUUID()},new AbortController().signal)).status).toBe('invalid_request'),40000);
  it('handles the real hard worker deadline as a controlled failed result',async () => expect((await runEngine({...request(),timeoutMilliseconds:1},new AbortController().signal)).status).toBe('deadline_exceeded'),40000);
  it('cancels and awaits the spawned owned process',async () => {
    const cancellation = new AbortController(); let pid:number|undefined;
    const result = runEngine(request(),cancellation.signal,value => {pid=value; setTimeout(() => cancellation.abort(),25);});
    await expect(result).rejects.toMatchObject({code:'CALCULATION_CANCELLED'});
    expect(pid).toBeDefined(); expect(() => process.kill(pid!,0)).toThrow();
  },40000);
  it('refuses pre-cancelled work before spawning',async () => {
    const cancellation = new AbortController(); cancellation.abort(); let spawned=false;
    await expect(runEngine(request(),cancellation.signal,() => {spawned=true;})).rejects.toBeDefined(); expect(spawned).toBe(false);
  });
  it('preserves original ordered lookup semantics without equipment/design inventions',async () => {
    const result=await runEngine({...request(),operation:'lookup',routeText:'/BC001/BC001/SECONDARY'},new AbortController().signal);
    expect(result.status).toBe('calculated');expect(result.route?.lengthMeters).toBe(10);expect(result.route?.fromDistanceMeters).toBe(0);expect(result.route?.fromRequiresSecondary).toBe(false);expect(result.design).toBeNull();expect(result.effectiveCategory).toBeNull();
  },40000);
  it('reverses the exact lookup points through original C# Reverse',async () => {
    const result=await runEngine({...request(),operation:'lookup',routeText:'/BC001',reverse:true},new AbortController().signal);
    expect(result.status).toBe('calculated');expect(result.route?.lengthMeters).toBe(10);expect(result.route?.pathPoints[0].x).toBe(10);expect(result.route?.pathPoints.at(-1)?.x).toBe(0);
  },40000);
  it('changes actual tray connectivity at the configured gap without inventing a path',async()=>{
    const common={...request(),snapshotId:gapSnapshotId,snapshotSha256:gapSha256,to:{x:20.5,y:0,z:.5}};
    const disconnected=await runEngine({...common,options:{...defaultOptions,connectionToleranceMeters:.25}},new AbortController().signal);
    expect(disconnected.status).toBe('no_path');expect(disconnected.route?.success).toBe(false);
    const connected=await runEngine({...common,options:{...defaultOptions,connectionToleranceMeters:1}},new AbortController().signal);
    expect(connected.status).toBe('calculated');expect(connected.route?.lengthMeters).toBe(20.5);expect(connected.route?.connectionGapCount).toBe(1);expect(connected.route?.connectionGapLengthMeters).toBe(.5);
  },40000);
  it('uses SECONDARY replacement, reserve once and percentage in the original exact design formula',async()=>{
    const result=await runEngine({...request(),from:{x:0,y:4,z:.5}},new AbortController().signal);
    expect(result.status).toBe('calculated');expect(result.route?.fromRequiresSecondary).toBe(true);expect(result.route?.fromDistanceMeters).toBe(4);
    expect(result.design?.lengthBeforePercentageMeters).toBe('21');expect(result.design?.designLengthMeters).toBe('24');
  },40000);
});
describe('proposal compatibility and stable dependency hashing',() => {
  it('matches existing route bounds and never truncates a result',() => {
    expect(routeCompatibilityIssue('/A/SECONDARY/B')).toBeNull();
    expect(routeCompatibilityIssue(Array.from({length:101},(_,index)=>'/A'+index).join(''))).toMatch('100 segments');
    expect(routeCompatibilityIssue('/'+'A'.repeat(8000))).toMatch('8,000 characters');
  });
  it('is independent of JSONB object property order',() => expect(hash({b:2,a:{d:4,c:3}})).toBe(hash({a:{c:3,d:4},b:2})));
  it('reuses geometry across settings/write revisions while binding new provenance',() => {
    const value = {schemaVersion:'pathfinder.dependencies.v2',routing:{catalogRevision:'1',routingContentSha256:'c'.repeat(64),routingPolicyRevision:'1',routingPolicySha256:'d'.repeat(64)},projectId,cableId:randomUUID(),cableWriteRevision:'1',registryRevision:'1',
      settings:{revision:'1',connectionGap:'.25',secondaryTrayLength:'5',endConnectionLength:'6',additionalBendingPercent:'10'},model:{id:modelVersionId,selectionRevision:'1',contentFingerprint:'a'.repeat(64)},
      artifact:{id:snapshotId,sha256:'a'.repeat(64)},options:defaultOptions,cableInputs:{fromLocation:'A',toLocation:'B',mto:'Control',cableTypeId:randomUUID()},
      from:{locationId:randomUUID(),bindingRevision:'1',point:[0,0,.5]},to:{locationId:randomUUID(),bindingRevision:'1',point:[10,0,.5]},engineVersion:'pathfinder-45c24bf5-pf1-modelrunner-v1'} as DependencySnapshot;
    const changed = {...value,cableWriteRevision:'3',registryRevision:'3',settings:{...value.settings,revision:'3',endConnectionLength:'8'}};
    expect(geometryHash(value)).toBe(geometryHash(changed)); expect(hash(value)).not.toBe(hash(changed));
    expect(geometryHash(value)).not.toBe(geometryHash({...changed,model:{...changed.model,selectionRevision:'3'}}));
    expect(geometryHash(value)).not.toBe(geometryHash({...value,settings:{...value.settings,connectionGap:'1'},options:{...value.options,connectionToleranceMeters:1}}));
  });
  it('scans a sixth eligible project rather than repeating the first five forever',() => {
    const rows=Array.from({length:6},(_,index)=>({project_id:String(index).padStart(8,'0')+'-1111-4111-8111-111111111111'}));
    let cursor:string|null=null;const seen=new Set<string>();
    for(let pass=0;pass<2;pass++) {const page=rows.filter(row=>cursor===null || row.project_id>cursor).slice(0,5);page.forEach(row=>seen.add(row.project_id));cursor=nextAutomaticCursor(page);}
    expect(seen.size).toBe(6);expect(cursor).toBeNull();
  });
  it('rejects options outside original native guards and private engine budgets',() => {
    expect(optionsSchema.safeParse({...defaultOptions,connectionToleranceMeters:0}).success).toBe(false);
    expect(optionsSchema.safeParse({...defaultOptions,maxGraphNodes:1}).success).toBe(false);
    expect(optionsSchema.safeParse({...defaultOptions,maxGraphConnections:4_000_001}).success).toBe(false);
  });
});
