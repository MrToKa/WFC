import test from 'node:test';
import assert from 'node:assert/strict';
import {selectDeliveryPolicy,POST_B27_AUTOMATIC_PAIR_V6} from './delivery-policy-selector-v6.mjs';
import * as qualifier from './migration-conservation-v6.mjs';
const selection=()=>({schemaVersion:'wfc.pf.delivery-policy-selection.v1',profile:POST_B27_AUTOMATIC_PAIR_V6});
test('v6 selector exposes only the explicit fixed new qualifier',()=>{
 const selected=selectDeliveryPolicy(selection());assert.equal(selected.profile,'post-b27-automatic-pair-additive-v6');assert.equal(selected.qualifierFilename,'migration-conservation-v6.mjs');
 assert.equal(selected.qualifier.qualifyMigrationInventories,qualifier.qualifyMigrationInventories);assert.equal(selected.qualifier.qualifyRuntimeInventories,qualifier.qualifyRuntimeInventories);
 assert.equal(selected.qualifier.assertQualificationReceipt,qualifier.assertQualificationReceipt);assert.ok(Object.isFrozen(selected)&&Object.isFrozen(selected.qualifier));
});
test('v6 cannot select legacy, v4, v5, unknown, caller paths or extra options',()=>{
 for(const value of [undefined,null,{}, {...selection(),profile:'post-b9-no-ddl-conservation-v4'}, {...selection(),profile:'post-b20-terminal-closure-additive-v5'}, {...selection(),profile:'b9'}, {...selection(),qualifierFilename:'foreign.mjs'}, {...selection(),profile:POST_B27_AUTOMATIC_PAIR_V6+'\n'}])
  assert.throws(()=>selectDeliveryPolicy(value),{code:'V6_EXPLICIT_POLICY_REQUIRED'});
 assert.throws(()=>selectDeliveryPolicy(selection(),true),{code:'V6_EXPLICIT_POLICY_REQUIRED'});
});
test('v6 selection refuses hidden, symbol and accessor properties without invoking accessors',()=>{
 for(const decorate of [v=>Object.defineProperty(v,'hidden',{value:true}),v=>{v[Symbol('extra')]=true;},v=>Object.defineProperty(v,'profile',{enumerable:true,get(){throw Error('GETTER_MUST_NOT_RUN');}})]){
  const value=selection();decorate(value);assert.throws(()=>selectDeliveryPolicy(value),{code:'V6_EXPLICIT_POLICY_REQUIRED'});
 }
});
