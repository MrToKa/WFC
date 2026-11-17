// @vitest-environment node
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createHash, randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { encodeCadOverlay } from './cadOverlay.js';
import { runEngine } from './engine.js';
import { defaultOptions } from './jobContracts.js';
import { syntheticStraightSnapshot } from './syntheticFixture.js';

// Read from the live project's Routings builder in the embedded browser on 2026-11-17.
// KL 60.303 local centreline is (0, 30, z) mm. BC903: (5400,70650,17500),
// rotation (0,0,0), length 1800. BC027-2: (4610,68540,19300),
// rotation (90,0,180), length 6000. Equipment points are the saved -WG-3117 endpoints.
const projectId=randomUUID(),modelVersionId=randomUUID(),snapshotId=randomUUID();
const branchId=`cad:${randomUUID()}`,mainId=`cad:${randomUUID()}`;
let root:string,sha:string;
beforeAll(async()=>{
  root=await fs.mkdtemp(path.join(os.tmpdir(),'wfc-bc903-'));
  await fs.mkdir(path.join(root,'snapshots'));
  const bytes=Buffer.from(JSON.stringify(syntheticStraightSnapshot(projectId,modelVersionId,'a'.repeat(64))));
  sha=createHash('sha256').update(bytes).digest('hex');
  await fs.writeFile(path.join(root,'snapshots',`${snapshotId}.json`),bytes,{flag:'wx'});
  vi.stubEnv('PF_ROOT',root);
  vi.stubEnv('PF_ENGINE_DLL',process.env.PF_MODEL_RUNNER_DLL??path.resolve('pathfinder-engine/tools/PathFinder.ModelRunner/bin/Debug/net9.0/PathFinder.ModelRunner.dll'));
});
afterAll(async()=>{
  vi.unstubAllEnvs();
  if(path.dirname(path.resolve(root))!==path.resolve(os.tmpdir())||!path.basename(root).startsWith('wfc-bc903-'))
    throw new Error('Refusing cleanup outside the owned BC903 regression directory');
  await fs.rm(root,{recursive:true,force:true});
});
const port=(pointMetres:number[],outward:number[],v:number[])=>({pointMetres,outward,u:[1,0,0],v,widthMetres:.3,heightMetres:.06});
const overlay=(version=3)=>encodeCadOverlay({schemaVersion:`wfc.pf.cad-overlay-payload.v${version}`,projectId,modelVersionId,baseSnapshotSha256:sha,
  segments:[{id:branchId,name:'/BC903',allowedCategoryMask:4,pointsMetres:[[5.4,70.68,17.5],[5.4,70.68,19.3]],
    ports:[port([5.4,70.68,17.5],[0,0,-1],[0,1,0]),port([5.4,70.68,19.3],[0,0,1],[0,1,0])]},
  {id:mainId,name:'/BC027-2',allowedCategoryMask:4,pointsMetres:[[4.61,68.54,19.33],[4.61,74.54,19.33]],
    ports:[port([4.61,68.54,19.33],[0,-1,0],[0,0,1]),port([4.61,74.54,19.33],[0,1,0],[0,0,1])]}]});
const calculate=(gap=1.2,version=3)=>runEngine({schemaVersion:'pathfinder.model.runner.v1',requestId:randomUUID(),operation:'calculate',projectId,modelVersionId,
  snapshotId,snapshotSha256:sha,timeoutMilliseconds:30000,category:'Control',includeLengthLedger:true,
  from:{x:5.633498219775822,y:70.5099999010227,z:17.079999968424254},
  to:{x:4.825416188525821,y:72.94217177602272,z:17.069999968424256},
  allowedPurposeRouteCodes:['/BC903','/BC027-2'],cadOverlay:overlay(version),
  options:{...defaultOptions,connectionToleranceMeters:gap,secondaryDistanceMeters:2,preferVerticalApproach:true},
  projectSettings:{revision:'1',secondaryTrayLength:'7',endConnectionLength:'6',additionalBendingPercent:'10'}},new AbortController().signal);

describe('live BC903 endpoint-to-straight connection in the actual native runner',()=>{
  it('uses BC903 for the saved WG-3117 From point at the configured 1.2 metre gap',async()=>{
    const result=await calculate();
    expect(result.status).toBe('calculated');
    expect(result.route?.routeCodes).toEqual(['/BC903','/BC027-2','/SECONDARY']);
    expect(result.route?.segmentIds).toContain(branchId);
    expect(result.route?.segmentIds).toContain(mainId);
    expect(result.lengthLedger?.raw.fromDistanceMeters).toBeCloseTo(.5097268668751938,10);
    expect(result.lengthLedger?.from.requiresSecondary).toBe(false);
    expect(result.lengthLedger?.to.requiresSecondary).toBe(true);
  },40000);
  it('admits the measured 0.790569 metre branch only within the configured gap',async()=>{
    expect((await calculate(.79)).route?.success??false).toBe(false);
    expect((await calculate(.8)).route?.success).toBe(true);
  },40000);
  it.each([1,2])('preserves historical v%i endpoint-only overlay behavior',async version=>{
    expect((await calculate(1.2,version)).route?.success??false).toBe(false);
  },40000);
});
