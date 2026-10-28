// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PoolClient } from 'pg';
const mocks=vi.hoisted(()=>({catalog:vi.fn()}));
vi.mock('./catalog.js',()=>({readRoutingCatalog:mocks.catalog}));
import { geometryHash, readCablePurposeRouting } from './dependencies.js';
import { cablePurposeRoutingSchema, projectCablePurposes, policyCablePurposesSchema } from '../../shared/routingCablePurposes.js';
import type { ScopedDependencySnapshot } from './jobContracts.js';
const rules=[{purpose_key:'Drive tray',allowed_categories:['VFD']},{purpose_key:'Power tray',allowed_categories:['Power']}];
const client={query:vi.fn(async(sql:string)=>({rows:sql.startsWith('SELECT DISTINCT purpose')?[{purpose:'Power'},{purpose:'VFD'}]:rules}))} as unknown as PoolClient;
const tray=(id:string,name:string,purpose:string)=>({projectTrayId:id,rawName:name,purposeKey:purpose});
beforeEach(()=>{vi.clearAllMocks();mocks.catalog.mockResolvedValue({rows:[tray('a','/B001','Drive tray'),tray('b','/B002','Power tray')],diagnostics:[]});});
describe('independent cable Purpose route permission',()=>{
  it('keeps VFD and Power separate even when they share the same internal MTO class',async()=>{
    expect(await readCablePurposeRouting(client,'project','VFD')).toEqual({purpose:'VFD',allowedRouteCodes:['/B001']});
    expect(await readCablePurposeRouting(client,'project','Power')).toEqual({purpose:'Power',allowedRouteCodes:['/B002']});
  });
  it('normalizes NFC and outer whitespace, retains exact case and refuses unknown/blank purposes',async()=>{
    expect(await readCablePurposeRouting(client,'project',' VFD ')).toEqual({purpose:'VFD',allowedRouteCodes:['/B001']});
    for(const value of ['vfd','Unknown','',null])expect(await readCablePurposeRouting(client,'project',value)).toBeNull();
    expect(projectCablePurposes([' Cafe\u0301 ','Café',null,'','Power'])).toEqual(['Café','Power']);
  });
  it('fails closed for routing diagnostics, duplicate route names and reserved SECONDARY',async()=>{
    mocks.catalog.mockResolvedValue({rows:[tray('a','/B001','Drive tray'),tray('b','/b001','Power tray'),tray('c','/SECONDARY','Drive tray')],diagnostics:[]});
    expect(await readCablePurposeRouting(client,'project','VFD')).toBeNull();
    mocks.catalog.mockResolvedValue({rows:[tray('a','/B001','Drive tray')],diagnostics:[{code:'TRAY_NAME_COLLISION',projectTrayIds:['a'],message:'collision'}]});
    expect(await readCablePurposeRouting(client,'project','VFD')).toBeNull();
  });
  it('accepts sorted custom purposes and exact historic category order while rejecting duplicates',()=>{
    expect(policyCablePurposesSchema.parse(['Control','Power','VFD'])).toHaveLength(3);
    expect(policyCablePurposesSchema.parse(['MV','LV','Control'])).toHaveLength(3);
    expect(policyCablePurposesSchema.safeParse(['Power','Control']).success).toBe(false);
    expect(policyCablePurposesSchema.safeParse(['Power','Power']).success).toBe(false);
    expect(cablePurposeRoutingSchema.safeParse({purpose:'Power',allowedRouteCodes:['/B002','/B001']}).success).toBe(false);
    expect(cablePurposeRoutingSchema.safeParse({purpose:'Power',allowedRouteCodes:['/SECONDARY']}).success).toBe(false);
  });
  it('includes the exact allowed route set and Purpose in geometry identity',()=>{
    const base={schemaVersion:'pathfinder.dependencies.v7',settings:{},options:{},cablePurposeRouting:{purpose:'VFD',allowedRouteCodes:['/B001']}} as ScopedDependencySnapshot;
    expect(geometryHash({...base,cablePurposeRouting:{purpose:'Power',allowedRouteCodes:['/B002']}})).not.toBe(geometryHash(base));
  });
});
