// @vitest-environment node
import { describe,expect,it } from 'vitest';
import { manualPhysicalCodes } from './manualRoutingContracts.js';
describe('bounded ordered manual routing input and native output',()=>{
  it('keeps exact ordered physical occurrences while removing terminal approach notation',()=>{
    expect(manualPhysicalCodes(' /secondary /a / b /a/SECONDARY ')).toEqual(['/A','/B','/A']);
  });
  it.each(['/SECONDARY','/A/SECONDARY/B','/A/A','/A/Bad tag','/A\n/B',''])('rejects unsupported manual input %j',text=>{
    expect(()=>manualPhysicalCodes(text)).toThrow();
  });
  it('bounds physical codes and accepts a maximal valid input with native-added approach notation',()=>{
    expect(()=>manualPhysicalCodes(Array.from({length:101},(_,i)=>'/A'+i).join(''))).toThrow();
    const input=Array.from({length:64},(_,i)=>'/'+String(i).padEnd(255,'A')).join('');expect(input).toHaveLength(16384);
    expect(manualPhysicalCodes(input)).toHaveLength(64);
    expect(manualPhysicalCodes('/SECONDARY'+input+'/SECONDARY',true)).toEqual(manualPhysicalCodes(input));
    expect(()=>manualPhysicalCodes(input+'A')).toThrow();
  });
});
