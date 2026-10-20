import {describe,expect,it} from 'vitest';
import {parsePolicyJson,POLICY_BODY_BYTES} from './policyJson.js';

describe('bounded JSON parser envelopes',()=>{
  it('accepts an explicit 128MiB maximum without changing the default request ceiling',()=>{
    expect(POLICY_BODY_BYTES).toBe(1024**2);
    expect(parsePolicyJson(Buffer.from('{"valid":true}'),{maxBytes:128*1024**2})).toEqual({valid:true});
    expect(()=>parsePolicyJson(Buffer.alloc(POLICY_BODY_BYTES+1))).toThrow(expect.objectContaining({code:'POLICY_BODY_TOO_LARGE',status:413}));
  });
  it('refuses an oversized actual body before decode and refuses any unbounded configured maximum',()=>{
    expect(()=>parsePolicyJson(Buffer.alloc(128*1024**2+1),{maxBytes:128*1024**2})).toThrow(expect.objectContaining({code:'POLICY_BODY_TOO_LARGE'}));
    for(const maxBytes of [128*1024**2+1,Infinity,NaN,0,1.5])expect(()=>parsePolicyJson(Buffer.from('{}'),{maxBytes})).toThrow(expect.objectContaining({code:'INVALID_JSON_LIMIT'}));
  });
  it('preserves duplicate, finite-number, UTF-8 and depth validation in the larger envelope',()=>{
    const options={maxBytes:128*1024**2};
    for(const bytes of [Buffer.from('{"x":1,"x":2}'),Buffer.from('{"x":1e999}'),Buffer.from([0xff]),Buffer.from('['.repeat(50)+'0'+']'.repeat(50))])expect(()=>parsePolicyJson(bytes,options)).toThrow();
  });
});
