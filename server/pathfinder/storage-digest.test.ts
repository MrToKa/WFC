// @vitest-environment node
import { createHash } from 'node:crypto';
import { describe,expect,it } from 'vitest';
import { snapshotDigest } from './storage.js';
describe('lookup reuse exact snapshot bytes',()=>{
  it('matches the published JSON bytes and distinguishes any geometry or capture change',()=>{
    const value={capture:{lookupRouteCodes:['/BC001'],visible:true},vertices:[[0,0,0],[10,0,0]]};
    expect(snapshotDigest(value)).toBe(createHash('sha256').update(Buffer.from(JSON.stringify(value))).digest('hex'));
    expect(snapshotDigest(value)).not.toBe(snapshotDigest({...value,vertices:[[0,0,0],[9,0,0]]}));
    expect(snapshotDigest(value)).not.toBe(snapshotDigest({...value,capture:{...value.capture,visible:false}}));
  });
  it('preserves finite-number guards before a reuse lookup can reach storage',()=>{
    for(const coordinate of [NaN,Infinity,-Infinity])expect(()=>snapshotDigest({vertices:[[coordinate,0,0]]})).toThrow('NON_FINITE_SNAPSHOT');
  });
});
