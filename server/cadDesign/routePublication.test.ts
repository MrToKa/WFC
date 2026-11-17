// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { STRAIGHT_SOURCE_SHA256 } from '../../shared/cadLengths.js';
import { STRAIGHT_SOURCES } from '../../shared/cadStraightSources.js';
import { FITTING_SOURCES } from '../../shared/cadFittingSources.js';
vi.mock('../db.js',()=>({pool:{query:vi.fn(),connect:vi.fn()}}));
vi.mock('../config.js',()=>({config:{jwtSecret:'test-only',bcryptRounds:4}}));
vi.mock('../services/objectStorageService.js',()=>({getObjectStream:vi.fn(),getProjectBucket:vi.fn()}));
import { buildCadChain, cadRouteSegments, resolveCadRouteMaterial, routePort, validateCadAttachment, type PublicationInstance } from './routePublication.js';

const straight:PublicationInstance={id:'00000000-0000-4000-8000-000000000001',catalog_item_id:'catalog',material_asset_id:'asset',revision:1,part_number:'KL 60.303 F',
  original_filename:'NDX_KL_60-303_F_MED_214.step',source_sha256:STRAIGHT_SOURCE_SHA256,component_kind:'straight',cut_length_mm:1500,
  x_mm:0,y_mm:0,z_mm:0,qx:0,qy:0,qz:0,qw:1};
const verifiedStraight=(filename:string):PublicationInstance=>{
  const source=STRAIGHT_SOURCES.find(row=>row.filename.toUpperCase()===filename.toUpperCase());
  if(!source)throw new Error(`Missing verified STEP fixture: ${filename}`);
  return {...straight,original_filename:source.filename,source_sha256:source.sha256};
};
describe('server-derived publishable CAD chains',()=>{
  it.each(FITTING_SOURCES)('admits the source-derived routing geometry: $filename',source=>{
    const fitting={...straight,original_filename:source.filename,source_sha256:source.sha256,cut_length_mm:null};
    const result=buildCadChain([fitting],[]);
    if(source.ports.length===3){expect(result.paths).toHaveLength(3);expect(result.endpoints).toHaveLength(3);expect(result.lengthMetres).toBeCloseTo(2.385,8);}
    else{expect(result.points).toHaveLength(259);expect(result.endpoints).toHaveLength(2);expect(result.lengthMetres).toBeCloseTo(.290+1.050*Math.PI/2,5);}
  });
  it('derives a trimmed straight in canonical metres without changing the saved manufacturer source',()=>{
    const result=buildCadChain([straight],[]);
    expect(result.points).toEqual([[0,.03,0],[0,.03,1.5]]);
    expect(result.lengthMetres).toBe(1.5);
    expect(result.endpoints).toHaveLength(2);
    expect(straight.cut_length_mm).toBe(1500);
  });
  it('joins a physically aligned two-piece chain and retains actual total length',()=>{
    const second={...straight,id:'00000000-0000-4000-8000-000000000002',z_mm:1500};
    const result=buildCadChain([straight,second],[{source_instance_id:straight.id,target_instance_id:second.id,source_name:'end',target_name:'start'}]);
    expect(result.lengthMetres).toBe(3);
    expect(result.points).toEqual([[0,.03,0],[0,.03,1.5],[0,.03,3]]);
    expect(result.endpoints.map(p=>[p.instanceId,p.portName])).toEqual([[straight.id,'start'],[second.id,'end']]);
  });
  it('publishes a 600 mm wide cut with its actual port profile',()=>{
    const wide=verifiedStraight('NDX_KL_60-603_E5_MED_214.step');
    expect(buildCadChain([wide],[]).lengthMetres).toBe(1.5);
    expect(routePort(wide,'end')).toMatchObject({pointMetres:[0,.03,1.5],widthMetres:.6,heightMetres:.06});
  });
  it('rotates the measured 100 mm profile centerline and preserves the cut length',()=>{
    const high={...verifiedStraight('NDX_KL_100-603_MED_214.step'),x_mm:1000,y_mm:2000,z_mm:3000,qx:Math.SQRT1_2,qw:Math.SQRT1_2};
    const chain=buildCadChain([high],[]);
    expect(chain.points[0][0]).toBeCloseTo(1);
    expect(chain.points[0][1]).toBeCloseTo(2);
    expect(chain.points[0][2]).toBeCloseTo(3.05);
    expect(chain.points[1][0]).toBeCloseTo(1);
    expect(chain.points[1][1]).toBeCloseTo(.5);
    expect(chain.points[1][2]).toBeCloseTo(3.05);
    expect(chain.lengthMetres).toBeCloseTo(1.5);
    expect(routePort(high,'end')).toMatchObject({widthMetres:.6,heightMetres:.1});
  });
  it('rejects coincident connection frames with different profile widths or heights',()=>{
    for(const filename of ['NDX_KL_60-603_MED_214.step','NDX_KL_100-303_MED_214.step']){
      const second={...verifiedStraight(filename),id:'second',z_mm:1500};
      expect(()=>buildCadChain([straight,second],[{source_instance_id:straight.id,target_instance_id:second.id,source_name:'end',target_name:'start'}])).toThrow('profiles must match');
    }
  });
  it('uses the SHA-pinned STEP bend R650 plus two 145mm legs, rather than a port chord or R795 arc',()=>{
    const bend={...straight,original_filename:'NDX_KLBK_60-303_MED_214.step',source_sha256:'7a5cf4947a9ea5fa213ceef84ba952fe2a9a63dee752f0c23a598320802c0014',component_kind:'bend',cut_length_mm:null};
    const result=buildCadChain([bend],[]);
    expect(result.points[0]).toEqual([.15,.03,0]);
    expect(result.points[1]).toEqual([.15,.03,-.145]);
    expect(result.points.at(-1)).toEqual([-.645,.03,-.795]);
    expect(Math.abs(result.lengthMetres-(.290+.650*Math.PI/2))).toBeLessThan(.000002);
    expect(result.points).toHaveLength(259);
  });
  it.each([{...straight,source_sha256:'0'.repeat(64)},{...straight,component_kind:'bend'},
    {...straight,original_filename:'unknown.step'}])('rejects geometry without approved source identity',row=>{
    expect(()=>buildCadChain([row],[])).toThrow('verified straight and bend');
  });
  it('keeps separated sections under one route without bridging or counting the empty gap',()=>{
    const second={...straight,id:'second',x_mm:10400,y_mm:80350,z_mm:17530,cut_length_mm:2050};
    const result=buildCadChain([straight,second],[]);
    expect(result.points).toEqual([]);expect(result.paths).toHaveLength(2);
    expect(result.endpoints).toHaveLength(4);expect(result.lengthMetres).toBeCloseTo(3.55,9);
    expect(result.paths!.map(path=>path.points)).toEqual([[[0,.03,0],[0,.03,1.5]],[[10.4,80.38,17.53],[10.4,80.38,19.58]]]);
    const group={id:'00000000-0000-4000-8000-000000000099',tag:'BC904'};
    const segments=cadRouteSegments(group,result);
    expect(segments).toHaveLength(2);expect(segments.every(segment=>segment.name==='/BC904')).toBe(true);
    expect(cadRouteSegments(group,buildCadChain([second,straight],[]))).toEqual(segments);
  });
  it('retains a connected section alongside an isolated section',()=>{
    const second={...straight,id:'second',z_mm:1500},third={...straight,id:'third',x_mm:10000};
    const result=buildCadChain([straight,second,third],[{source_instance_id:straight.id,target_instance_id:second.id,source_name:'end',target_name:'start'}]);
    expect(result.paths).toHaveLength(3);expect(result.endpoints).toHaveLength(4);expect(result.lengthMetres).toBe(4.5);
  });
  it('rejects a loop even when another disconnected section has open ends',()=>{
    const second={...straight,id:'second',cut_length_mm:100},short={...straight,cut_length_mm:100},isolated={...straight,id:'isolated',x_mm:10000};
    expect(()=>buildCadChain([short,second,isolated],[],[
      {kind:'routing-transition',source_instance_id:short.id,target_instance_id:second.id,source_name:'end',target_name:'start'},
      {kind:'routing-transition',source_instance_id:second.id,target_instance_id:short.id,source_name:'end',target_name:'start'},
    ])).toThrow('loop');
  });
  it('rejects stale saved connector geometry and connections outside the group',()=>{
    const second={...straight,id:'second',z_mm:1501.1};
    const connection={source_instance_id:straight.id,target_instance_id:second.id,source_name:'end',target_name:'start'};
    expect(()=>buildCadChain([straight,second],[connection])).toThrow('no longer aligned');
    expect(()=>buildCadChain([straight],[connection])).toThrow('belong to this route');
  });
  it('enforces bounded nonempty groups',()=>{
    expect(()=>buildCadChain([],[])).toThrow('1–32');
    expect(()=>buildCadChain(Array.from({length:33},(_,i)=>({...straight,id:String(i)})),[])).toThrow('1–32');
  });
});
describe('explicit existing-network attachment validation',()=>{
  const source={pointMetres:[0,0,0] as [number,number,number],outward:[0,0,1] as [number,number,number],u:[1,0,0] as [number,number,number],v:[0,1,0] as [number,number,number],widthMetres:.3,heightMetres:.06};
  const target={...source,outward:[0,0,-1] as [number,number,number]};
  it('accepts coincident matching opposite faces including symmetric 180 degree roll',()=>{
    expect(()=>validateCadAttachment(source,target)).not.toThrow();
    expect(()=>validateCadAttachment(source,{...target,u:[-1,0,0],v:[0,-1,0]})).not.toThrow();
  });
  it.each([{...target,pointMetres:[0,0,.002] as [number,number,number]},source,
    {...target,u:[0,1,0] as [number,number,number],v:[-1,0,0] as [number,number,number]},
    {...target,widthMetres:.6},{...target,heightMetres:.1}])('rejects gap, same-facing, rolled or incompatible profiles',port=>{
    expect(()=>validateCadAttachment(source,port)).toThrow('matching network profile');
  });
});
describe('published route Materials identity',()=>{
  const linked={...straight,material_tray_id:'tray',material_tray_type:'KL 60.303 F',material_width_mm:'300',material_height_mm:'60'};
  it('uses the actual linked straight SKU and dimensions',()=>{
    expect(resolveCadRouteMaterial([linked])).toEqual({trayType:'KL 60.303 F',widthMm:300,heightMm:60});
  });
  it.each([
    ['NDX_KL_60-603_F_MED_214.step',600,60],
    ['NDX_KL_100-603_MED_214.step',600,100],
  ] as const)('uses measured Materials dimensions for %s', (filename,widthMm,heightMm)=>{
    const row={...verifiedStraight(filename),material_tray_id:'tray',part_number:filename,material_tray_type:filename,material_width_mm:widthMm,material_height_mm:heightMm};
    expect(resolveCadRouteMaterial([row])).toEqual({trayType:filename,widthMm,heightMm});
    expect(()=>resolveCadRouteMaterial([{...row,material_width_mm:300}])).toThrow('no longer match');
  });
  it('rejects bend-only and unlinked straight groups without assigning a fitting SKU as tray type',()=>{
    expect(()=>resolveCadRouteMaterial([{...linked,component_kind:'bend',part_number:'BEND-SKU'}])).toThrow('straight component linked');
    expect(()=>resolveCadRouteMaterial([straight])).toThrow('straight component linked');
  });
  it.each([{...linked,material_width_mm:'600'},{...linked,material_height_mm:'100'},{...linked,material_tray_type:'OTHER-SKU'}])('rejects mismatched Materials profile or SKU',row=>{
    expect(()=>resolveCadRouteMaterial([row])).toThrow('no longer match');
  });
});
