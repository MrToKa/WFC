import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {calculationEngineEnvironment,calculationEngineSettings,assertCalculationEngineEnvironment,configureCalculationEngine} from './runtime-lib.mjs';
test('legacy engine settings preserve the existing oneshot compose default',()=>{
  assert.deepEqual(calculationEngineEnvironment({}),{});assert.deepEqual(calculationEngineSettings({}),{});
});
test('session selection and graph-cache rollback survive an environment round trip',()=>{
  for(const engineMode of ['oneshot','session'])for(const engineSessionProfile of ['bounded','interactive'])for(const graphPreparationCache of [true,false]){
    const settings={engineMode,engineSessionProfile,graphPreparationCache},environment=calculationEngineEnvironment(settings);
    assert.deepEqual(environment,{PF_ENGINE_MODE:engineMode,PF_ENGINE_SESSION_PROFILE:engineSessionProfile,PF_ENGINE_GRAPH_CACHE:graphPreparationCache?'1':'0'});
    assert.deepEqual(calculationEngineSettings(environment),settings);
    // Image/credential changes do not alter independent execution choices.
    assert.deepEqual(calculationEngineEnvironment({...settings,apiImage:'sha256:replacement',jwtSecret:'not emitted'}),environment);
  }
});
test('unknown execution modes and ambiguous cache flags are rejected',()=>{
  for(const engineMode of ['','SESSION','other',false,1,null])assert.throws(()=>calculationEngineEnvironment({engineMode}),/PF_ENGINE_MODE_INVALID/);
  for(const graphPreparationCache of ['0','1',0,1,null])assert.throws(()=>calculationEngineEnvironment({graphPreparationCache}),/PF_GRAPH_CACHE_CONFIG_INVALID/);
  for(const flag of ['','true','false','2',null])assert.throws(()=>calculationEngineSettings({PF_ENGINE_GRAPH_CACHE:flag}),/PF_GRAPH_CACHE_CONFIG_INVALID/);
  for(const profile of ['', 'INTERACTIVE', 'unlimited', null])assert.throws(()=>calculationEngineEnvironment({engineSessionProfile:profile}),/PF_ENGINE_SESSION_PROFILE_INVALID/);
});
test('compose supplies the recorded execution settings to the API',async()=>{
  const source=await fs.readFile(new URL('../../docker/pathfinder.compose.yml',import.meta.url),'utf8');
  assert.match(source,/PF_ENGINE_MODE: \$\{PF_ENGINE_MODE:-oneshot\}/);
  assert.match(source,/PF_ENGINE_SESSION_PROFILE: \$\{PF_ENGINE_SESSION_PROFILE:-bounded\}/);
  assert.match(source,/PF_ENGINE_GRAPH_CACHE: \$\{PF_ENGINE_GRAPH_CACHE:-0\}/);
});
test('resolved runtime choices must agree with recorded configuration',()=>{
  assert.doesNotThrow(()=>assertCalculationEngineEnvironment({PF_ENGINE_MODE:'oneshot',PF_ENGINE_GRAPH_CACHE:'0',PF_ENGINE_SESSION_PROFILE:'bounded'},{}));
  assert.doesNotThrow(()=>assertCalculationEngineEnvironment({PF_ENGINE_MODE:'session',PF_ENGINE_GRAPH_CACHE:'0',PF_ENGINE_SESSION_PROFILE:'interactive'},{engineMode:'session',graphPreparationCache:false,engineSessionProfile:'interactive'}));
  assert.throws(()=>assertCalculationEngineEnvironment({PF_ENGINE_MODE:'oneshot',PF_ENGINE_GRAPH_CACHE:'1'},{engineMode:'session'}),/PF_ENGINE_ENVIRONMENT_CHANGED/);
  assert.throws(()=>assertCalculationEngineEnvironment({PF_ENGINE_MODE:'session',PF_ENGINE_GRAPH_CACHE:'1',PF_ENGINE_SESSION_PROFILE:'bounded'},{engineMode:'session'}),/PF_ENGINE_ENVIRONMENT_CHANGED/);
});
test('configuration refuses unknown fields before touching a runtime',async()=>{
  for(const choices of [null,[],{}, {apiImage:'replacement'}, {engineMode:'session',jwtSecret:'foreign'}])
    await assert.rejects(configureCalculationEngine(null,choices),/PF_ENGINE_CONFIG_INVALID/);
});
