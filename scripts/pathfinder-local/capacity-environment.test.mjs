import test from 'node:test';import assert from 'node:assert/strict';
import {LEGACY_CAPACITY_PROFILE,LARGE_CAPACITY_PROFILE,localCapacityProfile,assertCapacityEnvironment,capacityProfileTransition} from './capacity-environment.mjs';
test('local preparation capacity defaults preserve legacy without requiring an environment key',()=>{
  assert.equal(localCapacityProfile(undefined),LEGACY_CAPACITY_PROFILE);
  assert.doesNotThrow(()=>assertCapacityEnvironment({},undefined));
  assert.doesNotThrow(()=>assertCapacityEnvironment({PF_PREPARATION_CAPACITY_PROFILE:LEGACY_CAPACITY_PROFILE},undefined));
  assert.doesNotThrow(()=>assertCapacityEnvironment(['PATH=/usr/bin'],undefined));
  assert.doesNotThrow(()=>assertCapacityEnvironment([`PF_PREPARATION_CAPACITY_PROFILE=${LEGACY_CAPACITY_PROFILE}`],undefined));
});
test('larger profile requires the exact explicit trusted environment binding',()=>{
  assert.equal(localCapacityProfile(LARGE_CAPACITY_PROFILE),LARGE_CAPACITY_PROFILE);
  assert.doesNotThrow(()=>assertCapacityEnvironment({PF_PREPARATION_CAPACITY_PROFILE:LARGE_CAPACITY_PROFILE},LARGE_CAPACITY_PROFILE));
  assert.doesNotThrow(()=>assertCapacityEnvironment([`PF_PREPARATION_CAPACITY_PROFILE=${LARGE_CAPACITY_PROFILE}`],LARGE_CAPACITY_PROFILE));
  for(const env of [{},{PF_PREPARATION_CAPACITY_PROFILE:LEGACY_CAPACITY_PROFILE}])assert.throws(()=>assertCapacityEnvironment(env,LARGE_CAPACITY_PROFILE),/PF_CAPACITY_CONFIG_INVALID/);
  assert.throws(()=>assertCapacityEnvironment({PF_PREPARATION_CAPACITY_PROFILE:LARGE_CAPACITY_PROFILE},undefined),/PF_CAPACITY_CONFIG_INVALID/);
});

test('raw container environment cannot hide duplicate capacity values in either order',()=>{
  const legacy=`PF_PREPARATION_CAPACITY_PROFILE=${LEGACY_CAPACITY_PROFILE}`,large=`PF_PREPARATION_CAPACITY_PROFILE=${LARGE_CAPACITY_PROFILE}`;
  for(const environment of [[legacy,large],[large,legacy],[legacy,legacy],[large,large]]){
    assert.throws(()=>assertCapacityEnvironment(environment,LARGE_CAPACITY_PROFILE),/PF_CAPACITY_CONFIG_INVALID/);
    assert.throws(()=>assertCapacityEnvironment(environment,undefined),/PF_CAPACITY_CONFIG_INVALID/);
  }
});

test('malformed or unbounded environment evidence is refused without exposing values',()=>{
  for(const environment of [null,undefined,'PF_PREPARATION_CAPACITY_PROFILE='+LARGE_CAPACITY_PROFILE,
    ['missing-equals'],['=missing-name'],[false],{PF_PREPARATION_CAPACITY_PROFILE:undefined},
    Array(1025).fill('X=1'),['X='+'x'.repeat(16384)],Array(100).fill('X='+'x'.repeat(12000))]){
    assert.throws(()=>assertCapacityEnvironment(environment,undefined),error=>error.code==='PF_CAPACITY_CONFIG_INVALID'&&error.message==='PF_CAPACITY_CONFIG_INVALID');
  }
});

test('profile changes require the exact owned API to be absent, including stopped containers',()=>{
  for(const [current,next] of [[undefined,LARGE_CAPACITY_PROFILE],[LARGE_CAPACITY_PROFILE,LEGACY_CAPACITY_PROFILE]]){
    assert.throws(()=>capacityProfileTransition(current,next,true),error=>error.code==='PF_CAPACITY_REQUIRES_API_RECREATE');
    assert.deepEqual(capacityProfileTransition(current,next,false),{profile:next,changed:true});
  }
});

test('a same-profile selection remains a no-op while the API exists and keeps legacy defaults',()=>{
  assert.deepEqual(capacityProfileTransition(undefined,LEGACY_CAPACITY_PROFILE,true),{profile:LEGACY_CAPACITY_PROFILE,changed:false});
  assert.deepEqual(capacityProfileTransition(LARGE_CAPACITY_PROFILE,LARGE_CAPACITY_PROFILE,true),{profile:LARGE_CAPACITY_PROFILE,changed:false});
  assert.deepEqual(capacityProfileTransition(LEGACY_CAPACITY_PROFILE,undefined,true),{profile:LEGACY_CAPACITY_PROFILE,changed:false});
  assert.equal(Object.isFrozen(capacityProfileTransition(undefined,undefined,false)),true);
  assert.throws(()=>capacityProfileTransition('unlimited',LARGE_CAPACITY_PROFILE,false),/PF_CAPACITY_CONFIG_INVALID/);
  assert.throws(()=>capacityProfileTransition(undefined,'unlimited',false),/PF_CAPACITY_CONFIG_INVALID/);
  assert.throws(()=>capacityProfileTransition(undefined,LARGE_CAPACITY_PROFILE,undefined),/PF_CAPACITY_CONFIG_INVALID/);
});
test('invalid local capacity values cannot silently widen an environment or become default',()=>{
  for(const value of ['',null,false,128,'128MiB','wfc.pf.bounded-128m-capture-and-model.v2\n','unlimited']){
    assert.throws(()=>localCapacityProfile(value),/PF_CAPACITY_CONFIG_INVALID/);
    assert.throws(()=>assertCapacityEnvironment({PF_PREPARATION_CAPACITY_PROFILE:value},undefined),/PF_CAPACITY_CONFIG_INVALID/);
  }
});
