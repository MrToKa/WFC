import { describe, expect, it } from 'vitest';
import { cadOverlayPayloadSchema } from './pathfinderCadOverlay.js';

const port=(z:number)=>({pointMetres:[0,.03,z],outward:[0,0,z===0?-1:1],u:[1,0,0],v:[0,1,0],widthMetres:.3,heightMetres:.06});
const payload={schemaVersion:'wfc.pf.cad-overlay-payload.v1',projectId:'00000000-0000-4000-8000-000000000001',
  modelVersionId:'00000000-0000-4000-8000-000000000002',baseSnapshotSha256:'a'.repeat(64),segments:[{
    id:'cad:00000000-0000-4000-8000-000000000003',name:'/CAD001',allowedCategoryMask:7,
    pointsMetres:[[0,.03,0],[0,.03,1.2]],ports:[port(0),port(1.2)],
  }]};
describe('versioned independent CAD overlay admission',()=>{
  it('preserves historical attached v1 payloads',()=>expect(cadOverlayPayloadSchema.parse(payload)).toEqual(payload));
  it('admits independent v2 with the two real physical ports',()=>{
    const independent={...payload,schemaVersion:'wfc.pf.cad-overlay-payload.v2',segments:[{...payload.segments[0],independent:true}]};
    expect(cadOverlayPayloadSchema.parse(independent)).toEqual(independent);
  });
  it('refuses independent semantics under a version an old native worker could ignore',()=>{
    expect(cadOverlayPayloadSchema.safeParse({...payload,segments:[{...payload.segments[0],independent:true}]}).success).toBe(false);
  });
  it('refuses fabricated zero/one-port independent chains and false-valued isolation',()=>{
    for(const ports of [[],[port(0)]])expect(cadOverlayPayloadSchema.safeParse({...payload,schemaVersion:'wfc.pf.cad-overlay-payload.v2',
      segments:[{...payload.segments[0],independent:true,ports}]}).success).toBe(false);
    expect(cadOverlayPayloadSchema.safeParse({...payload,schemaVersion:'wfc.pf.cad-overlay-payload.v2',segments:[{...payload.segments[0],independent:false}]}).success).toBe(false);
  });
  it('admits automatic v3 without silently reinterpreting historical v2 isolation',()=>{
    const automatic={...payload,schemaVersion:'wfc.pf.cad-overlay-payload.v3'};
    expect(cadOverlayPayloadSchema.parse(automatic)).toEqual(automatic);
    expect(cadOverlayPayloadSchema.safeParse({...automatic,segments:[{...payload.segments[0],independent:true}]}).success).toBe(false);
    // A current composite may retain a previously attached segment's one
    // recorded physical port; no second port may be invented during migration.
    expect(cadOverlayPayloadSchema.parse({...automatic,segments:[{...payload.segments[0],ports:[port(0)]}]})).toBeDefined();
  });
});
