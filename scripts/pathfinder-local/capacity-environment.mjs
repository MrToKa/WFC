export const LEGACY_CAPACITY_PROFILE='wfc.pf.current-bounded-capture-and-model.v1';
export const LARGE_CAPACITY_PROFILE='wfc.pf.bounded-128m-capture-and-model.v2';
const fail=()=>{throw Object.assign(Error('PF_CAPACITY_CONFIG_INVALID'),{code:'PF_CAPACITY_CONFIG_INVALID'});};
const key='PF_PREPARATION_CAPACITY_PROFILE';
const plain=value=>value!==null&&typeof value==='object'&&Object.getPrototypeOf(value)===Object.prototype;
export function localCapacityProfile(value){
  if(value===undefined)return LEGACY_CAPACITY_PROFILE;
  if(value!==LEGACY_CAPACITY_PROFILE&&value!==LARGE_CAPACITY_PROFILE)return fail();
  return value;
}
export function assertCapacityEnvironment(environment,configured){
  const expected=localCapacityProfile(configured);
  const array=Array.isArray(environment),entries=array?environment:plain(environment)?Object.entries(environment):null;
  if(!entries||entries.length>1024)return fail();
  let value,seen=false,characters=0;
  for(const entry of entries){
    let name,current;
    if(array){
      if(typeof entry!=='string'||entry.length>16384)return fail();
      const at=entry.indexOf('=');if(at<1)return fail();
      name=entry.slice(0,at);current=entry.slice(at+1);characters+=entry.length;
    }else{
      [name,current]=entry;if(typeof current!=='string'||name.length+current.length>16384)return fail();
      characters+=name.length+current.length;
    }
    if(characters>1024*1024)return fail();
    if(name!==key)continue;
    if(seen)return fail();seen=true;value=current;
  }
  const actual=localCapacityProfile(value);
  if(actual!==expected)return fail();
}
/** A profile setter never leaves an existing API bound to obsolete settings. */
export function capacityProfileTransition(configured,requested,apiPresent){
  const current=localCapacityProfile(configured),profile=localCapacityProfile(requested);
  if(typeof apiPresent!=='boolean')return fail();
  const changed=profile!==current;
  if(changed&&apiPresent)throw Object.assign(Error('PF_CAPACITY_REQUIRES_API_RECREATE'),{code:'PF_CAPACITY_REQUIRES_API_RECREATE'});
  return Object.freeze({profile,changed});
}
