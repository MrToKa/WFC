import test from 'node:test';
import assert from 'node:assert/strict';
import {validateManagedSdkInventory} from './managed-runner.mjs';
const manifest={path:'sdk/vendor-manifest.json',bytes:166375,sha256:'747540a153fb18809c428d8ed177aa8a296cff1b5175ab85445e0a2ebdb36d75'};
const fixture=()=>[...Array.from({length:206},(_,i)=>({path:`sdk/${i}.js`,bytes:i===0?82552768:0,sha256:'a'.repeat(64)})),{...manifest}];
test('publisher vendor manifest is independently pinned and excluded from SDK file/byte totals',()=>{
  assert.deepEqual(validateManagedSdkInventory(fixture()),{sdkFiles:206,sdkBytes:82552768});
});
test('missing, duplicate, substituted or resized vendor manifest is refused',()=>{
  for(const mutate of [f=>f.pop(),f=>f.push({...manifest}),f=>f.at(-1).sha256='b'.repeat(64),f=>f.at(-1).bytes++]){
    const files=fixture();mutate(files);assert.throws(()=>validateManagedSdkInventory(files),{code:'PRODUCER_RUNTIME_INVENTORY_INVALID'});
  }
});
test('SDK files and their byte total remain strict after excluding the manifest',()=>{
  for(const mutate of [f=>f.shift(),f=>f[0].bytes++,f=>f[0].bytes=NaN]){
    const files=fixture();mutate(files);assert.throws(()=>validateManagedSdkInventory(files),{code:'PRODUCER_RUNTIME_INVENTORY_INVALID'});
  }
});
