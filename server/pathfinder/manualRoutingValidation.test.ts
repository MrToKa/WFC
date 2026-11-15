// @vitest-environment node
import { describe,expect,it } from 'vitest';
import { syntheticBarrierWriteInputs } from './barrierWriteFixtures.js';
import { validateManualRoutingResult } from './manualRoutingValidation.js';
import type { ManualRoutingDependencies } from './manualRoutingContracts.js';
function fixture(){
  const f=syntheticBarrierWriteInputs(),{calculationMode:_mode,...response}=f.result;
  response.route!.routeCodes=['/A'];if(response.schemaVersion==='pathfinder.model.response.v3')response.barriers.directSecondary=null;
  const d:ManualRoutingDependencies={schemaVersion:'pathfinder.manual-route.dependencies.v1',manualRevision:'1',
    constraint:{schemaVersion:'pathfinder.manual-ordered-route.v1',routeText:'/A'},protected:f.dependencies,capacity:null};
  return{response,d};
}
describe('manual full cable result verification',()=>{
  it('uses native design and complete ledger, including optional MTO category projection',()=>{
    const f=fixture();f.d.protected.cableInputs.mto=null;f.d.protected.cablePurposeRouting={purpose:'Control',allowedRouteCodes:['/A']};
    expect(validateManualRoutingResult(f.response,f.d,f.response.requestId)).toBe(7);
  });
  it('refuses a physically proved route outside the frozen cable purpose permissions',()=>{
    const f=fixture();f.d.protected.cablePurposeRouting={purpose:'Control',allowedRouteCodes:['/B']};
    expect(()=>validateManualRoutingResult(f.response,f.d,f.response.requestId)).toThrowError(expect.objectContaining({code:'MANUAL_ROUTE_PURPOSE_NOT_PERMITTED'}));
  });
  it('never substitutes raw tray length for native full cable design or accepts a crossed ledger',()=>{
    const f=fixture();expect(f.response.route!.lengthMeters).toBe(5);expect(validateManualRoutingResult(f.response,f.d,f.response.requestId)).toBe(7);
    f.response.design!.designLengthMeters='5';expect(()=>validateManualRoutingResult(f.response,f.d,f.response.requestId)).toThrow();
  });
});
