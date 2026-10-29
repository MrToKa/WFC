// @vitest-environment node
import { afterAll,beforeAll,describe,expect,it } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash,randomUUID } from 'node:crypto';
import { runEngine } from './engine.js';
import { defaultOptions } from './jobContracts.js';
import { syntheticLookupSnapshot } from './lookupFixture.js';
const dll=process.env.PF_LOOKUP_ENGINE_DLL,saved={root:process.env.PF_ROOT,dll:process.env.PF_ENGINE_DLL},projectId=randomUUID(),modelVersionId=randomUUID(),snapshotId=randomUUID();
let root:string,sha256:string;
describe.skipIf(!dll)('new dedicated lookup DTO through production Node and an explicitly selected fresh .NET worker',()=>{
  beforeAll(async()=>{root=path.resolve('pathfinder-engine/.scratch/lookup-node-'+randomUUID());await fs.mkdir(path.join(root,'snapshots'),{recursive:true});
    const bytes=Buffer.from(JSON.stringify(syntheticLookupSnapshot(projectId,modelVersionId,'a'.repeat(64))));sha256=createHash('sha256').update(bytes).digest('hex');
    await fs.writeFile(path.join(root,'snapshots',snapshotId+'.json'),bytes,{flag:'wx'});process.env.PF_ENGINE_DLL=dll;process.env.PF_ROOT=root;
  });
  afterAll(async()=>{
    if(saved.root===undefined)delete process.env.PF_ROOT;else process.env.PF_ROOT=saved.root;if(saved.dll===undefined)delete process.env.PF_ENGINE_DLL;else process.env.PF_ENGINE_DLL=saved.dll;
    const base=path.resolve('pathfinder-engine/.scratch');if(root&&root.startsWith(base+path.sep)&&path.basename(root).startsWith('lookup-node-')&&(await fs.lstat(root)).isDirectory()&&!(await fs.lstat(root)).isSymbolicLink())await fs.rm(root,{recursive:true});
  });
  const request=()=>({schemaVersion:'pathfinder.model.runner.v1',requestId:randomUUID(),operation:'lookup',projectId,modelVersionId,snapshotId,snapshotSha256:sha256,timeoutMilliseconds:30000,routeText:'/BC001',options:{...defaultOptions,connectionToleranceMeters:1}});
  it('accepts distinct private-parser plan output through the production response validator without storage',async()=>{
    const result=await runEngine({schemaVersion:'pathfinder.model.runner.v1',requestId:randomUUID(),operation:'lookup-plan',projectId,modelVersionId,timeoutMilliseconds:30000,routeText:'/bc001/SECONDARY/BC001/BC002/BC001'},new AbortController().signal);
    expect(result.status).toBe('lookup_planned');expect(result.routeCodes).toEqual(['/BC001','/BC002']);expect(result.route).toBeUndefined();
  },40000);
  it('fits the mathematical fixture and returns exact 10m plus immutable lookup scope and used gap',async()=>{
    const result=await runEngine(request(),new AbortController().signal);expect(result.status).toBe('calculated');expect(result.route?.lengthMeters).toBe(10);expect(result.design).toBeNull();expect(result.usedConnectionGapMeters).toBe(1);
    expect(result.lookupScope).toMatchObject({requestedCodeCount:1,uniqueCodeCount:1,discoveredObjectCount:2,resolvedOwnerCount:1,resolvedLeafCount:1});expect(result.engineeringAccepted).toBe(false);
  },40000);
  it('keeps exact native reversal and SECONDARY/duplicate semantics',async()=>{
    const forward=await runEngine({...request(),routeText:'/SECONDARY/BC001/BC001'},new AbortController().signal),reverse=await runEngine({...request(),reverse:true},new AbortController().signal);
    expect(forward.route?.routeText).toBe('/BC001');expect(reverse.route?.lengthMeters).toBe(10);expect(reverse.route?.pathPoints).toEqual([...forward.route!.pathPoints].reverse());
  },40000);
  it('refuses a different requested capture scope instead of looking outside its immutable inventory',async()=>{
    expect((await runEngine({...request(),routeText:'/BC002'},new AbortController().signal)).status).toBe('invalid_request');
  },40000);
  it('refuses dedicated lookup geometry for both planning preparation and cable calculation',async()=>{
    expect((await runEngine({...request(),operation:'prepare',routeText:undefined},new AbortController().signal)).status).toBe('invalid_request');
    expect((await runEngine({...request(),operation:'calculate',routeText:undefined,category:'Control',from:{x:0,y:0,z:.5},to:{x:10,y:0,z:.5},projectSettings:{revision:'1',secondaryTrayLength:'5',endConnectionLength:'6',additionalBendingPercent:'10'}},new AbortController().signal)).status).toBe('invalid_request');
  },40000);
});
