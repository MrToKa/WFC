import test from 'node:test';
import assert from 'node:assert/strict';
import {selectDeliveryPolicy,POST_B20_TERMINAL_CLOSURE_V5} from './delivery-policy-selector-v5.mjs';
import * as qualifier from './migration-conservation-v5.mjs';
const selection=()=>({schemaVersion:'wfc.pf.delivery-policy-selection.v1',profile:POST_B20_TERMINAL_CLOSURE_V5});
test('v5 selector exposes only the explicit fixed new qualifier',()=>{
 const selected=selectDeliveryPolicy(selection());assert.equal(selected.profile,'post-b20-terminal-closure-additive-v5');assert.equal(selected.qualifierFilename,'migration-conservation-v5.mjs');
 assert.equal(selected.qualifier.qualifyMigrationInventories,qualifier.qualifyMigrationInventories);assert.equal(selected.qualifier.qualifyRuntimeInventories,qualifier.qualifyRuntimeInventories);
 assert.equal(selected.qualifier.assertQualificationReceipt,qualifier.assertQualificationReceipt);assert.ok(Object.isFrozen(selected)&&Object.isFrozen(selected.qualifier));
});
test('v5 cannot select legacy, v4, unknown, caller paths or extra options',()=>{
 for(const value of [undefined,null,{}, {...selection(),profile:'post-b9-no-ddl-conservation-v4'}, {...selection(),profile:'b9'}, {...selection(),qualifierFilename:'foreign.mjs'}, {...selection(),profile:POST_B20_TERMINAL_CLOSURE_V5+'\n'}])
  assert.throws(()=>selectDeliveryPolicy(value),{code:'V5_EXPLICIT_POLICY_REQUIRED'});
 assert.throws(()=>selectDeliveryPolicy(selection(),true),{code:'V5_EXPLICIT_POLICY_REQUIRED'});
});
test('v5 selection refuses hidden, symbol and accessor properties without invoking accessors',()=>{
 for(const decorate of [v=>Object.defineProperty(v,'hidden',{value:true}),v=>{v[Symbol('extra')]=true;},v=>Object.defineProperty(v,'profile',{enumerable:true,get(){throw Error('GETTER_MUST_NOT_RUN');}})]){
  const value=selection();decorate(value);assert.throws(()=>selectDeliveryPolicy(value),{code:'V5_EXPLICIT_POLICY_REQUIRED'});
 }
});
