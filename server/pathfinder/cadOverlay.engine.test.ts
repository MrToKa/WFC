// @vitest-environment node
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createHash, randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { syntheticGapSnapshot } from './syntheticFixture.js';
import { encodeCadOverlay } from './cadOverlay.js';
import { runEngine } from './engine.js';
import { defaultOptions } from './jobContracts.js';

const projectId=randomUUID(),modelVersionId=randomUUID(),snapshotId=randomUUID(),cadId=`cad:${randomUUID()}`;
let root:string,sha:string;
beforeAll(async()=>{
  root=await fs.mkdtemp(path.join(os.tmpdir(),'wfc-cad-overlay-'));
  await fs.mkdir(path.join(root,'snapshots'));
  const source=Buffer.from(JSON.stringify(syntheticGapSnapshot(projectId,modelVersionId,'a'.repeat(64))));
  sha=createHash('sha256').update(source).digest('hex');
  await fs.writeFile(path.join(root,'snapshots',`${snapshotId}.json`),source,{flag:'wx'});
  vi.stubEnv('PF_ROOT',root);
  vi.stubEnv('PF_ENGINE_DLL',process.env.PF_MODEL_RUNNER_DLL??path.resolve('pathfinder-engine/tools/PathFinder.ModelRunner/bin/Debug/net9.0/PathFinder.ModelRunner.dll'));
});
afterAll(async()=>{
  vi.unstubAllEnvs();
  if(path.dirname(path.resolve(root))!==path.resolve(os.tmpdir())||!path.basename(root).startsWith('wfc-cad-overlay-'))
    throw new Error('Refusing cleanup outside the owned CAD overlay test directory');
  await fs.rm(root,{recursive:true,force:true});
});
const port=(x:number,outward:number)=>({pointMetres:[x,0,.5],outward:[outward,0,0],u:[0,1,0],v:[0,0,1],widthMetres:1,heightMetres:1});
const payload=()=>({schemaVersion:'wfc.pf.cad-overlay-payload.v1',projectId,modelVersionId,baseSnapshotSha256:sha,
  segments:[{id:cadId,name:'/CAD001',allowedCategoryMask:4,pointsMetres:[[10,0,.5],[10.5,0,.5]],ports:[port(10,-1),port(10.5,1)]}]});
const request=()=>({schemaVersion:'pathfinder.model.runner.v1',requestId:randomUUID(),operation:'calculate',projectId,modelVersionId,
  snapshotId,snapshotSha256:sha,timeoutMilliseconds:30000,category:'Control',includeLengthLedger:true,from:{x:0,y:0,z:.5},to:{x:20.5,y:0,z:.5},
  allowedPurposeRouteCodes:['/BC001','/BC002','/CAD001'],options:{...defaultOptions,connectionToleranceMeters:.01,preferVerticalApproach:false},
  projectSettings:{revision:'1',secondaryTrayLength:'0',endConnectionLength:'0',additionalBendingPercent:'0'}});
const calculate=(input:ReturnType<typeof request>&Record<string,unknown>)=>runEngine(input,new AbortController().signal);
const preparedKey=(result:Awaited<ReturnType<typeof runEngine>>)=>(result.prepared as {key?:string}|undefined)?.key;
async function prepareProof(input:Record<string,unknown>):Promise<{status?:string;prepared?:unknown}> {
  if(process.platform==='linux')return runEngine(input as Parameters<typeof runEngine>[0],new AbortController().signal);
  // Production preparation monitoring intentionally requires Linux /proc.
  // On Windows verify the actual C# stdio contract without faking RSS evidence.
  return new Promise((resolve,reject)=>{
    const child=spawn('dotnet',[process.env.PF_ENGINE_DLL!],{stdio:['pipe','pipe','ignore'],windowsHide:true,timeout:30000});
    const chunks:Buffer[]=[];let size=0;
    child.stdout.on('data',(chunk:Buffer)=>{size+=chunk.length;if(size>32*1024*1024){child.kill();reject(new Error('Engine response budget exceeded'));}else chunks.push(chunk);});
    child.on('error',reject);child.on('close',code=>{try{if(code!==0)throw new Error('Engine preparation failed');resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));}catch(error){reject(error);}});
    child.stdin.on('error',reject);child.stdin.end(JSON.stringify(input));
  });
}

describe('actual C# base-network plus immutable CAD overlay',()=>{
  it('bridges a disconnected original network with the published CAD route and measures its length',async()=>{
    const base=await calculate(request());
    expect(base.route?.success??false).toBe(false);
    const composite=await calculate({...request(),cadOverlay:encodeCadOverlay(payload())});
    expect(composite.status).toBe('calculated');
    expect(composite.route?.success).toBe(true);
    expect(composite.route?.routeCodes).toContain('/CAD001');
    expect(composite.route?.segmentIds).toContain(cadId);
    expect(composite.route?.lengthMeters).toBeCloseTo(20.5,8);
    expect(composite.lengthLedger?.raw.lengthMeters).toBeCloseTo(20.5,8);
    expect(composite.design?.designLengthMeters).toBe('21');
    expect(preparedKey(composite)).not.toBe(preparedKey(base));
  },40000);
  it('returns an actual engine preparation proof before publication can claim the CAD segment is usable',async()=>{
    const result=await prepareProof({schemaVersion:'pathfinder.model.runner.v1',requestId:randomUUID(),operation:'prepare',projectId,modelVersionId,snapshotId,snapshotSha256:sha,
      timeoutMilliseconds:30000,cadOverlay:encodeCadOverlay(payload())});
    expect(result.status).toBe('prepared');
    expect(result.prepared).toMatchObject({segmentCount:3});
  },40000);
  it('applies normal cable purpose exclusion to CAD routes',async()=>{
    const result=await calculate({...request(),allowedPurposeRouteCodes:['/BC001','/BC002'],cadOverlay:encodeCadOverlay(payload())});
    expect(result.route?.success??false).toBe(false);
  },40000);
  it('uses an overlay-specific graph cache identity and leaves the base snapshot bytes intact',async()=>{
    const first=await calculate({...request(),cadOverlay:encodeCadOverlay(payload())});
    const other=payload();other.segments[0].name='/CAD002';
    const second=await calculate({...request(),allowedPurposeRouteCodes:['/BC001','/BC002','/CAD002'],cadOverlay:encodeCadOverlay(other)});
    expect(preparedKey(first)).not.toBe(preparedKey(second));
    expect(createHash('sha256').update(await fs.readFile(path.join(root,'snapshots',`${snapshotId}.json`))).digest('hex')).toBe(sha);
  },40000);
  it('rejects changed payload bytes and cross-project/base identities',async()=>{
    const valid=encodeCadOverlay(payload());
    for(const cadOverlay of [{...valid,sha256:'0'.repeat(64)},encodeCadOverlay({...payload(),projectId:randomUUID()}),
      encodeCadOverlay({...payload(),baseSnapshotSha256:'f'.repeat(64)})]) {
      const result=await calculate({...request(),cadOverlay});
      expect(result.status).toBe('invalid_request');
      expect(result.route?.success??false).toBe(false);
    }
  },40000);
});
