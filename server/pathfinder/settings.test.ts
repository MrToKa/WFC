// @vitest-environment node
import { describe,expect,it,vi } from 'vitest';
import type { PoolClient } from 'pg';
import { createProjectSchema,updateProjectSchema } from '../validators.js';
import { defaultOptions } from './jobContracts.js';
import { engineProjectSettings,projectRoutingSettings } from './settings.js';

const row={connection_gap:'1',secondary_tray_length:'5',end_connection_length:'6',additional_bending_percent:'10',pf_settings_revision:'7'};
function database(value:unknown){return {query:vi.fn(async()=>({rows:value===undefined?[]:[value]}))} as unknown as PoolClient;}
describe('Project Details routing settings authority',()=>{
  it.each([0,-1,101,NaN,Infinity,-Infinity,null,'1'])('rejects invalid project gap %s',value=>{
    expect(updateProjectSchema.safeParse({connectionGap:value}).success).toBe(false);
  });
  it('accepts positive bounded gaps on both create and update without altering their value',()=>{
    expect(createProjectSchema.parse({projectNumber:'P',name:'P',customer:'C',connectionGap:1.125}).connectionGap).toBe(1.125);
    expect(updateProjectSchema.parse({connectionGap:.001}).connectionGap).toBe(.001);
  });
  it('overrides a caller tolerance from the current exact persisted project value',async()=>{
    const requested={...defaultOptions,connectionToleranceMeters:99},result=await projectRoutingSettings(database(row),'project',requested);
    expect(result.options.connectionToleranceMeters).toBe(1);expect(requested.connectionToleranceMeters).toBe(99);expect(result.options.sampleSpacingMeters).toBe(defaultOptions.sampleSpacingMeters);
    expect(result.settings).toEqual({revision:'7',connectionGap:'1',secondaryTrayLength:'5',endConnectionLength:'6',additionalBendingPercent:'10'});
    expect((await projectRoutingSettings(database({...row,connection_gap:'0.125'}),'project',requested)).options.connectionToleranceMeters).toBe(.125);
  });
  it.each([undefined,{...row,connection_gap:'NaN'},{...row,connection_gap:'0'},{...row,connection_gap:'101'}])('fails closed for missing or corrupted persisted gap',async value=>{
    await expect(projectRoutingSettings(database(value),'project',defaultOptions)).rejects.toMatchObject({code:'PROJECT_SETTINGS_INVALID'});
  });
  it('keeps the original strict C# design DTO separate from the routing gap',()=>{
    expect(engineProjectSettings({revision:'7',connectionGap:'1',secondaryTrayLength:'5',endConnectionLength:'6',additionalBendingPercent:'10'})).toEqual({revision:'7',secondaryTrayLength:'5',endConnectionLength:'6',additionalBendingPercent:'10'});
  });
});
