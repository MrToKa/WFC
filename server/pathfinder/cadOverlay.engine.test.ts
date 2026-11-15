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
  it('routes both endpoints on an actual 1200 mm standalone CAD segment with its own native identity',async()=>{
    const independent={...payload(),schemaVersion:'wfc.pf.cad-overlay-payload.v2',segments:[{...payload().segments[0],independent:true,
      pointsMetres:[[10,3,.5],[11.2,3,.5]],ports:[{...port(10,-1),pointMetres:[10,3,.5]},{...port(11.2,1),pointMetres:[11.2,3,.5]}]}]};
    const result=await calculate({...request(),from:{x:10,y:3,z:.5},to:{x:11.2,y:3,z:.5},cadOverlay:encodeCadOverlay(independent)});
    expect(result.status).toBe('calculated');expect(result.route?.segmentIds).toEqual([cadId]);
    expect(result.route?.routeCodes).toEqual(['/CAD001']);expect(result.route?.lengthMeters).toBeCloseTo(1.2,12);
    expect(result.lengthLedger?.raw.lengthMeters).toBeCloseTo(1.2,12);expect(result.design?.designLengthMeters).toBe('2');
  },40000);
  it('cannot silently bridge original components through an independent CAD route at coincident real ports',async()=>{
    const standalone=encodeCadOverlay({...payload(),schemaVersion:'wfc.pf.cad-overlay-payload.v2',segments:[{...payload().segments[0],independent:true}]});
    const result=await calculate({...request(),cadOverlay:standalone});
    expect(result.route?.success??false).toBe(false);
    const attached=await calculate({...request(),cadOverlay:encodeCadOverlay(payload())});
    expect(attached.route?.success).toBe(true);expect(attached.route?.segmentIds).toContain(cadId);
  },40000);
  it('materializes a standalone composite in the actual native preparation proof',async()=>{
    const cadOverlay=encodeCadOverlay({...payload(),schemaVersion:'wfc.pf.cad-overlay-payload.v2',segments:[{...payload().segments[0],independent:true}]});
    const result=await prepareProof({schemaVersion:'pathfinder.model.runner.v1',requestId:randomUUID(),operation:'prepare',projectId,modelVersionId,
      snapshotId,snapshotSha256:sha,timeoutMilliseconds:30000,cadOverlay});
    expect(result.status).toBe('prepared');expect(result.prepared).toMatchObject({segmentCount:3});
  },40000);
  it('native validation itself rejects disguised or incomplete standalone semantics before graph use',async()=>{
    const rawEnvelope=(value:unknown)=>{const bytes=Buffer.from(JSON.stringify(value));return {schemaVersion:'wfc.pf.cad-overlay.v1',
      sha256:createHash('sha256').update(bytes).digest('hex'),payloadBase64:bytes.toString('base64')};};
    for(const value of [{...payload(),segments:[{...payload().segments[0],independent:true}]},
      {...payload(),schemaVersion:'wfc.pf.cad-overlay-payload.v2',segments:[{...payload().segments[0],independent:true,ports:[port(10,-1)]}]},
      {...payload(),schemaVersion:'wfc.pf.cad-overlay-payload.v2',segments:[{...payload().segments[0],independent:false}]}]){
      const result=await calculate({...request(),cadOverlay:rawEnvelope(value)});
      expect(result.status).toBe('invalid_request');expect(result.route?.success??false).toBe(false);
    }
  },40000);
  it('automatic v3 forms the actual CAD/base component at the project gap and changes it when gap changes',async()=>{
    const automatic={...payload(),schemaVersion:'wfc.pf.cad-overlay-payload.v3',segments:[{...payload().segments[0],
      pointsMetres:[[10.25,0,.5],[10.5,0,.5]],ports:[port(10.25,-1),port(10.5,1)]}]};
    const cadOverlay=encodeCadOverlay(automatic),options={...request().options,connectionToleranceMeters:.25};
    const within=await calculate({...request(),options,cadOverlay});
    expect(within.status).toBe('calculated');expect(within.route?.segmentIds).toContain(cadId);
    expect(within.route?.routeCodes).toContain('/CAD001');expect(within.route?.lengthMeters).toBeCloseTo(20.5,12);
    expect(within.route?.connectionGapCount).toBe(1);expect(within.route?.connectionGapLengthMeters).toBe(.25);
    expect(within.lengthLedger?.raw.lengthMeters).toBeCloseTo(20.5,12);
    const beyond=await calculate({...request(),options:{...options,connectionToleranceMeters:.25-Number.EPSILON},cadOverlay});
    expect(beyond.route?.success??false).toBe(false);
    expect(preparedKey(within)).toBe(preparedKey(beyond)); // The graph key must additionally bind the actual query gap.
    const again=await calculate({...request(),options,cadOverlay});
    expect(again.route).toEqual(within.route);
  },40000);
  it('automatic v3 leaves distant CAD consumers on their own 1200 mm component without isolation mode',async()=>{
    const automatic={...payload(),schemaVersion:'wfc.pf.cad-overlay-payload.v3',segments:[{...payload().segments[0],
      pointsMetres:[[10,3,.5],[11.2,3,.5]],ports:[{...port(10,-1),pointMetres:[10,3,.5]},{...port(11.2,1),pointMetres:[11.2,3,.5]}]}]};
    const result=await calculate({...request(),from:{x:10,y:3,z:.5},to:{x:11.2,y:3,z:.5},cadOverlay:encodeCadOverlay(automatic)});
    expect(result.status).toBe('calculated');expect(result.route?.segmentIds).toEqual([cadId]);
    expect(result.route?.lengthMeters).toBeCloseTo(1.2,12);expect(result.route?.connectionGapCount).toBe(0);
  },40000);
  it('new automatic policy cannot masquerade as a historical isolated payload',async()=>{
    const old=encodeCadOverlay({...payload(),schemaVersion:'wfc.pf.cad-overlay-payload.v2',segments:[{...payload().segments[0],independent:true}]});
    const current=encodeCadOverlay({...payload(),schemaVersion:'wfc.pf.cad-overlay-payload.v3'});
    const historical=await calculate({...request(),cadOverlay:old}),automatic=await calculate({...request(),cadOverlay:current});
    expect(historical.route?.success??false).toBe(false);expect(automatic.route?.success).toBe(true);
    expect(preparedKey(automatic)).not.toBe(preparedKey(historical));expect(old.sha256).not.toBe(current.sha256);
    const bytes=Buffer.from(JSON.stringify({...payload(),schemaVersion:'wfc.pf.cad-overlay-payload.v3',segments:[{...payload().segments[0],independent:true}]}));
    const refused=await calculate({...request(),cadOverlay:{schemaVersion:'wfc.pf.cad-overlay.v1',sha256:createHash('sha256').update(bytes).digest('hex'),payloadBase64:bytes.toString('base64')}});
    expect(refused.status).toBe('invalid_request');
  },40000);
});
