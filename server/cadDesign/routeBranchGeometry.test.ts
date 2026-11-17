// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { getAalborgPocPorts, MATE_OPPOSING_FACE } from '../../shared/cadPocPorts.js';
import { FITTING_SOURCES } from '../../shared/cadFittingSources.js';
import corridors from '../../shared/fixtures/cad-tee-corridors.json' with { type: 'json' };
import curves from '../../shared/fixtures/cad-routing-curves.json' with { type: 'json' };
import { alignConnectorPorts } from '../../shared/cadTransforms.js';
vi.mock('../db.js',()=>({pool:{query:vi.fn(),connect:vi.fn()}}));
vi.mock('../config.js',()=>({config:{jwtSecret:'test-only',bcryptRounds:4}}));
vi.mock('../services/objectStorageService.js',()=>({getObjectStream:vi.fn(),getProjectBucket:vi.fn()}));
import { buildCadChain, cadRouteSegments, resolveCadRouteMaterial, routePort, type PublicationInstance, type PublicationConnection, type PublicationTransition } from './routePublication.js';
import { deriveCadTrayExport } from './routeTrayExports.js';

const id=(n:number)=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const tee:PublicationInstance={id:id(1),catalog_item_id:id(2),material_asset_id:id(3),revision:1,part_number:'KSLT 60.303 S',
  original_filename:FITTING_SOURCES[0].filename,source_sha256:FITTING_SOURCES[0].sha256,component_kind:'straight',cut_length_mm:null,
  x_mm:0,y_mm:0,z_mm:0,qx:0,qy:0,qz:0,qw:1};
const group={id:id(10),tag:'BC027-1',name:'BC027-1',purpose:'Control',revision:1};
function attachedPart(largeBend=false,branch=false,gap=0){
  const part={...tee,id:id(4),catalog_item_id:id(5),material_asset_id:id(6),part_number:largeBend?'KSLBG 60.303 S':'KL 60.303 F',
    original_filename:largeBend?FITTING_SOURCES[2].filename:'NDX_KL_60-303_F_MED_214.step',
    source_sha256:largeBend?FITTING_SOURCES[2].sha256:'d381a3f4a09559e99119e3e591137f73780d16bf832019f93b20627adc5609cd',cut_length_mm:largeBend?null:1000};
  const targetName=branch?'branch':'end';
  const source=getAalborgPocPorts(part.original_filename,part.source_sha256).find(port=>port.id==='start')!;
  const target=getAalborgPocPorts(tee.original_filename,tee.source_sha256).find(port=>port.id===targetName)!;
  const aligned=alignConnectorPorts({position:{x:0,y:0,z:0},rotation:{x:0,y:0,z:0,w:1}},target.local,source.local,MATE_OPPOSING_FACE);
  return {...part,x_mm:aligned.position.x+gap,y_mm:aligned.position.y,z_mm:aligned.position.z,
    qx:aligned.rotation.x,qy:aligned.rotation.y,qz:aligned.rotation.z,qw:aligned.rotation.w};
}
const connection=(branch=false):PublicationConnection=>({source_instance_id:id(4),source_name:'start',target_instance_id:tee.id,target_name:branch?'branch':'end'});

describe('branched saved CAD route geometry',()=>{
  it('pins the nominal tee axes to the measured clear corridors and KLBG coaxial walls',()=>{
    for(const sample of corridors){
      expect(sample.planes[0].bounds[0]).toBeCloseTo(-945,6);
      expect(sample.corridors).toHaveLength(3);
      for(const arm of sample.corridors){expect(arm.samples).toBe(303);expect(arm.solidIntersections).toEqual([]);}
    }
    for(const source of curves){
      expect(FITTING_SOURCES.some(row=>row.filename===source.name&&row.sha256===source.sha256)).toBe(true);
      expect(source.cylinders.map(cylinder=>Math.round(cylinder.radius)).sort((a,b)=>a-b)).toEqual([900,1200]);
      for(const cylinder of source.cylinders){expect(cylinder.location[0]).toBeCloseTo(-900,6);expect(cylinder.location[2]).toBeCloseTo(-145,6);}
    }
  });
  it('uses three unique nominal axis arms and one real port per arm',()=>{
    const graph=buildCadChain([tee],[]),segments=cadRouteSegments(group,graph);
    expect(graph.points).toEqual([]);expect(graph.lengthMetres).toBeCloseTo(2.385,9);
    expect(graph.endpoints.map(port=>port.portName)).toEqual(['start','end','branch']);
    expect(segments).toHaveLength(3);expect(new Set(segments.map(segment=>segment.id)).size).toBe(3);
    expect(segments[0].id).toBe('cad:'+group.id);
    for(const segment of segments){expect(segment.name).toBe('/BC027-1');expect(segment.ports).toHaveLength(1);
      expect(segment.pointsMetres.at(-1)).toEqual([-.795,.03,0]);}
    expect(resolveCadRouteMaterial([tee])).toEqual({trayType:tee.part_number,widthMm:300,heightMm:60});
  });
  it('keeps arm identities stable when source input order changes',()=>{
    const straight=attachedPart(),edge=connection();
    const first=cadRouteSegments(group,buildCadChain([tee,straight],[edge]));
    const second=cadRouteSegments(group,buildCadChain([straight,tee],[edge]));
    expect(first).toEqual(second);expect(first).toHaveLength(4);
  });
  it('retains the KLBG R1050 arc instead of its shorter chord',()=>{
    const bend=attachedPart(true),graph=buildCadChain([tee,bend],[connection()]);
    expect(graph.paths).toHaveLength(4);expect(graph.endpoints).toHaveLength(3);
    expect(graph.lengthMetres).toBeCloseTo(2.385+.290+1.050*Math.PI/2,5);
    expect(graph.paths!.find(path=>path.key===bend.id+':body')!.points).toHaveLength(259);
  });
  it('retains a 50mm installation bridge with opposing measured frames and hashes its graph',()=>{
    const straight=attachedPart(false,true,50),transition:PublicationTransition={...connection(true),kind:'routing-transition'};
    const graph=buildCadChain([tee,straight],[],[transition]);
    expect(graph.paths).toHaveLength(5);expect(graph.lengthMetres).toBeCloseTo(3.435,8);
    const bridge=graph.paths!.find(path=>path.key.startsWith('join:'))!;
    expect(bridge.points[0].map((value,index)=>value-bridge.points[1][index])).toEqual([.05,0,0]);
    expect(bridge.ports[1].outward).toEqual(routePort(tee,'branch').outward.map(value=>-value));
    const exported=deriveCadTrayExport(id(20),id(21),group,[tee,straight],graph,[transition]);
    expect(exported.source.schemaVersion).toBe('wfc.cad.route-tray-source.v2');
    expect(exported.source.centerlineGraph).toEqual(graph.paths);
    expect(exported.fields.lengthMm).toBeCloseTo(3435,5);
  });
  it('retains disconnected tee and straight sections without an artificial bridge',()=>{
    const straight={...attachedPart(),x_mm:10000};
    const graph=buildCadChain([tee,straight],[]);
    expect(graph.paths).toHaveLength(4);expect(graph.endpoints).toHaveLength(5);
    expect(graph.lengthMetres).toBeCloseTo(3.385,9);
    expect(graph.paths!.some(path=>path.key.startsWith('join:'))).toBe(false);
  });
  it('rejects duplicate occupied ports and altered STEP bytes',()=>{
    const straight=attachedPart();
    expect(()=>buildCadChain([tee,straight],[connection(),connection()])).toThrow('multiple connections');
    expect(()=>buildCadChain([{...tee,source_sha256:'0'.repeat(64)}],[])).toThrow('verified straight and bend');
  });
});
